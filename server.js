require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
// Si la app corre detras de ngrok (u otro proxy), esto hace que Express
// respete el header X-Forwarded-Proto y sepa que la conexion real es https,
// aunque por detras le hable a este servidor por http normal.
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// La clave real de Groq es GROQ_API_KEY (la que esta en tu .env). BTATESTERS_KEY
// se deja solo como alias de compatibilidad con Render (por si alguien la
// configuro asi alla), pero ya NO tiene prioridad: si esa quedo vieja, vencida
// o sin creditos (eso es lo que tira el error 402), ni se intenta primero, asi
// que no bloquea nada. Si llegaras a tener las dos configuradas y una falla
// por auth/creditos, el sistema prueba automaticamente con la otra antes de
// rendirse (ver llamarGroqConReintentos).
const CLAVES_GROQ = [...new Set([process.env.GROQ_API_KEY, process.env.BTATESTERS_KEY].filter(Boolean))];
const BTATESTERS_KEY = CLAVES_GROQ[0]; // nombre viejo, se deja para no tocar el resto del archivo

// Modelo de texto (rapido) y modelo de vision (para imagenes).
// gpt-oss-20b NO soporta imagenes en Groq -> por eso fallaba el envio de imagenes.
const GROQ_MODEL_TEXTO = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GROQ_MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Nombre publico del modelo (lo unico que la IA debe admitir que es).
const NOMBRE_MODELO_PUBLICO = 'NewserLite';

// ---------- Modelos disponibles ----------
// Cada "modelo publico" mapea a uno o dos modelos reales de Groq (texto y
// vision) y define cuanto cuesta en creditos y cual es su rate limit. Esto es
// lo que ve el usuario en el selector del chat y lo que se puede forzar desde
// la API mandando { "modelo": "NewserAvanced" } en el body.
//
// IMPORTANTE: la WEB no consume creditos del token. Solo el endpoint
// /api/v1/chat (el que se usa con Bearer token desde afuera) descuenta
// creditos. El rate limit de aca aplica a AMBOS (web y API): la web lo
// aplicamos en /api/chat usando un contador en memoria por usuario+modelo, y
// la API lo aplicamos en /api/v1/chat usando el historial de usos del token.
//
// NewserLite    -> openai/gpt-oss-20b, 1 credito, 20 req/min (API), 30 req/min (web)
// NewserAvanced -> openai/gpt-oss-120b, 5 creditos, 5 req/min (API), 8 req/min (web)
//                  (mas estricto porque el modelo es mas pesado)
const MODELOS_DISPONIBLES = {
  NewserLite: {
    nombre: 'NewserLite',
    descripcion: 'Rapido y liviano. Ideal para la mayoria de las consultas.',
    modeloTexto: GROQ_MODEL_TEXTO,
    modeloVision: GROQ_MODEL_VISION,
    costoCreditos: 1,
    rateLimitMax: 20,            // API: por token
    rateLimitMaxWeb: 30,         // Web: por usuario (no consume creditos)
    maxTokens: 1024,
  },
  NewserAvanced: {
    nombre: 'NewserAvanced',
    descripcion: 'Mas potente. Razonamiento profundo, respuestas mas ricas. Rate limit mas estricto.',
    // Modelo avanzado real: gpt-oss-120b (mucho mas grande que el 20b de Lite).
    // Se puede sobreescribir con GROQ_MODEL_AVANCED en .env si hace falta.
    modeloTexto: process.env.GROQ_MODEL_AVANCED || 'openai/gpt-oss-120b',
    modeloVision: GROQ_MODEL_VISION,
    costoCreditos: 5,
    rateLimitMax: 5,             // API: mas estricto (5/min en vez de 10)
    rateLimitMaxWeb: 8,          // Web: mas estricto (8/min en vez de 30)
    maxTokens: 2048,
  },
};
const MODELO_DEFAULT = 'NewserLite';

// Normaliza el nombre de modelo que viene del cliente y devuelve su config.
// Si viene cualquier cosa (inexistente, vacio, no-string), cae al default.
// Esto evita que alguien mande { "modelo": "GPT-4" } o { "modelo": 123 } y
// rompa algo: siempre termina en un modelo valido o en NewserLite.
function resolverModelo(valor) {
  if (typeof valor !== 'string') return MODELOS_DISPONIBLES[MODELO_DEFAULT];
  const limpio = valor.trim();
  if (!limpio) return MODELOS_DISPONIBLES[MODELO_DEFAULT];
  // Case-insensitive: "newseravanced", "NEWSERAVANCED", "NewserAvanced" -> ok
  const clave = Object.keys(MODELOS_DISPONIBLES).find(
    (k) => k.toLowerCase() === limpio.toLowerCase()
  );
  return MODELOS_DISPONIBLES[clave || MODELO_DEFAULT];
}

// ---------- Rate limit para la WEB (no consume creditos) ----------
// Como /api/chat no toca los creditos del token (eso solo lo hace /api/v1/chat),
// necesitamos un rate limit separado para que alguien desde la web no abuse de
// NewserAvanced mandando 100 mensajes por minuto. Lo hacemos en memoria, por
// usuario + modelo, con una ventana deslizante de 60s (igual que el de la API).
//
// Es un Map clave -> [timestamps]. Se limpia solo cuando se consulta.
const RATE_LIMIT_WEB = new Map(); // clave "usuario|modelo" -> [timestamps]
const RATE_LIMIT_WEB_VENTANA_MS = 60 * 1000;

// Devuelve { ok: true } o { ok: false, status, error, reintentarEnSeg }.
function verificarRateLimitWeb(usuario, configModelo) {
  if (!usuario) return { ok: true };
  const clave = `${usuario}|${configModelo.nombre}`;
  const ahora = Date.now();
  let usos = RATE_LIMIT_WEB.get(clave) || [];
  usos = usos.filter((ts) => ahora - ts < RATE_LIMIT_WEB_VENTANA_MS);
  if (usos.length >= configModelo.rateLimitMaxWeb) {
    const masViejo = Math.min(...usos);
    const reintentarEnSeg = Math.ceil((RATE_LIMIT_WEB_VENTANA_MS - (ahora - masViejo)) / 1000);
    return {
      ok: false,
      status: 429,
      error: `Estas mandando mensajes muy rapido para ${configModelo.nombre}. Espera ${reintentarEnSeg}s o cambiá a NewserLite.`,
      reintentarEnSeg,
    };
  }
  usos.push(ahora);
  RATE_LIMIT_WEB.set(clave, usos);
  return { ok: true };
}

// Las consultas reales (Wikipedia, busqueda biblica) a veces tardan menos de
// medio segundo, y el frame de "investigando" pasaba de largo sin que se
// alcanzara a ver. Esto obliga a que cada paso se muestre al menos "ms" en
// pantalla, sin inventar nada: el resultado sigue siendo 100% real, solo se
// pausa la UI lo suficiente para que sea visible.
function esperarMinimo(promesa, ms) {
  return Promise.all([promesa, new Promise((resolve) => setTimeout(resolve, ms))]).then(([resultado]) => resultado);
}

// Llama a Groq. Reintenta automaticamente si responde 429 (limite de uso
// alcanzado), avisando al cliente cuantos segundos va a esperar antes de
// reintentar, en vez de simplemente fallar. Ademas, si la clave activa falla
// por auth o creditos (401/402/403), prueba con la siguiente clave de
// CLAVES_GROQ antes de rendirse (asi una BTATESTERS_KEY vencida en Render no
// tumba todo si hay una GROQ_API_KEY valida configurada tambien). Nunca
// devuelve al llamador el texto crudo de error de Groq: eso se resuelve
// afuera con mensajeErrorAmigableIA(), para no filtrar datos del proveedor.
async function llamarGroqConReintentos(opcionesBase, enviar, maxIntentos = 4) {
  const claves = CLAVES_GROQ.length ? CLAVES_GROQ : [undefined];
  let ultimaRespuesta = null;

  for (const clave of claves) {
    const headers = { ...(opcionesBase.headers || {}) };
    delete headers.Authorization; // por si el llamador ya la puso, la pisamos
    if (clave) headers.Authorization = `Bearer ${clave}`;
    const opciones = { ...opcionesBase, headers };

    for (let intento = 1; intento <= maxIntentos; intento++) {
      const r = await fetch(GROQ_URL, opciones);

      if (r.status === 401 || r.status === 402 || r.status === 403) {
        // Esta clave no sirve (vencida / invalida / sin creditos). Si hay
        // otra clave configurada, la probamos antes de rendirnos.
        ultimaRespuesta = r;
        break;
      }
      if (r.status !== 429) return r;
      if (intento >= maxIntentos) return r;

      let espera = 5;
      const retryAfter = r.headers.get('retry-after');
      if (retryAfter && !isNaN(Number(retryAfter))) espera = Math.ceil(Number(retryAfter));
      else espera = Math.min(20, 4 * intento);

      enviar({ type: 'retry', intento, maxIntentos, espera });
      await new Promise((resolve) => setTimeout(resolve, espera * 1000));
    }
  }
  return ultimaRespuesta;
}

// Traduce un status HTTP del proveedor de IA a un mensaje generico para el
// cliente, SIN exponer nunca el texto/JSON crudo que manda Groq (que puede
// incluir detalles de la cuenta, del plan, o mencionar "groq" directamente).
// Los detalles reales solo se loguean en el servidor (consola de Render).
function mensajeErrorAmigableIA(status) {
  if (status === 429) return 'El modelo esta saturado ahora mismo (limite de uso alcanzado). Intenta de nuevo en unos minutos.';
  if (status === 402) return 'El servicio de IA no tiene creditos disponibles en este momento. Avisale al administrador.';
  if (status === 401 || status === 403) return 'Hubo un problema de autenticacion con el servicio de IA. Avisale al administrador.';
  if (status >= 500) return 'El servicio de IA no esta disponible en este momento. Intenta de nuevo en unos minutos.';
  return 'Error al conectar con el modelo. Intenta de nuevo en unos minutos.';
}

const MEMORY_DIR = path.join(__dirname, 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'historial.json');

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ chats: [] }, null, 2));

// Carpeta donde se guardan de forma persistente tanto las imagenes que manda
// el usuario como las que la IA descarga de la web. Vive dentro de /public
// para que express.static ya las sirva solas, sin rutas nuevas.
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Guarda un buffer de imagen a disco con nombre unico y devuelve la URL
// relativa (algo como "/uploads/ab12cd34.jpg") para guardar en el historial.
function guardarImagenDisco(buffer, mime) {
  const ext = (mime && mime.split('/')[1] ? mime.split('/')[1].replace('jpeg', 'jpg') : 'jpg').slice(0, 5);
  const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, nombre), buffer);
  return `/uploads/${nombre}`;
}

// Borra un archivo guardado por guardarImagenDisco a partir de su URL
// relativa. Nunca tira si el archivo ya no existe (borrado doble, etc).
function borrarImagenDisco(urlRelativa) {
  if (!urlRelativa || !urlRelativa.startsWith('/uploads/')) return;
  const nombreArchivo = path.basename(urlRelativa);
  const rutaCompleta = path.join(UPLOADS_DIR, nombreArchivo);
  if (rutaCompleta.startsWith(UPLOADS_DIR)) {
    fs.unlink(rutaCompleta, () => {}); // async, no importa si falla (ya no esta, etc)
  }
}

// Lee un archivo de /uploads y lo devuelve como data URL base64, para
// volver a mandarselo al modelo (mantener "memoria visual" en turnos
// siguientes de la misma conversacion).
function imagenComoDataURL(urlRelativa, mimeFallback = 'image/jpeg') {
  try {
    const nombreArchivo = path.basename(urlRelativa);
    const rutaCompleta = path.join(UPLOADS_DIR, nombreArchivo);
    if (!rutaCompleta.startsWith(UPLOADS_DIR) || !fs.existsSync(rutaCompleta)) return null;
    const buffer = fs.readFileSync(rutaCompleta);
    const ext = path.extname(nombreArchivo).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : ext ? `image/${ext}` : mimeFallback;
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

// Arma el historial que se le manda al modelo. Antes esto solo mandaba texto
// (h.contenidoTexto) incluso para turnos que tenian imagenes, asi que el
// modelo se "olvidaba" por completo de lo que habia en una foto apenas
// pasaba un mensaje mas ("a que te referis con eso?"). Ahora, los turnos
// recientes que tuvieron imagen las vuelven a mandar de verdad. Se limita a
// las ultimas MAX_IMAGENES_RECORDADAS fotos (las mas nuevas primero) para no
// disparar el tamano de cada pedido si la conversacion tiene muchas.
const MAX_IMAGENES_RECORDADAS = 6;
function construirHistorialParaModelo(historial) {
  const ultimos = historial.slice(-20);

  // Contamos cuantas imagenes hay en total en esa ventana, de atras para
  // adelante, para saber desde que turno para atras ya no re-mandamos fotos.
  let cupoImagenes = MAX_IMAGENES_RECORDADAS;
  const permiteImagenPorIndice = new Array(ultimos.length).fill(false);
  for (let i = ultimos.length - 1; i >= 0; i--) {
    const h = ultimos[i];
    if (h.role === 'user' && Array.isArray(h.imagenesUrls) && h.imagenesUrls.length) {
      if (cupoImagenes > 0) {
        permiteImagenPorIndice[i] = true;
        cupoImagenes -= h.imagenesUrls.length;
      }
    }
  }

  return ultimos.map((h, i) => {
    if (h.role === 'user' && permiteImagenPorIndice[i]) {
      const partes = [
        { type: 'text', text: h.contenidoTexto || 'Describe estas imagenes.' },
        ...h.imagenesUrls
          .map((url) => imagenComoDataURL(url))
          .filter(Boolean)
          .map((dataUrl) => ({ type: 'image_url', image_url: { url: dataUrl } })),
      ];
      return { role: 'user', content: partes };
    }
    return { role: h.role, content: h.contenidoTexto };
  });
}

// Progreso de lectura de la Biblia completa: versiculos tachados (leidos),
// marcador de "donde te quedaste" y nivel de zoom. Se guarda en el servidor,
// separado POR USUARIO, para que cada quien tenga su propio progreso aunque
// entren varias personas distintas a esta misma app.
const BIBLIA_PROGRESO_FILE = path.join(MEMORY_DIR, 'biblia-progreso.json');
if (!fs.existsSync(BIBLIA_PROGRESO_FILE)) {
  fs.writeFileSync(BIBLIA_PROGRESO_FILE, JSON.stringify({ usuarios: {} }, null, 2));
}
function leerProgresoBiblia(usuario) {
  let raiz;
  try {
    raiz = JSON.parse(fs.readFileSync(BIBLIA_PROGRESO_FILE, 'utf-8'));
  } catch (e) {
    raiz = { usuarios: {} };
  }
  // Migracion: formato viejo, un solo progreso compartido por todos.
  if (!raiz.usuarios) {
    const progresoViejo = { tachados: raiz.tachados || {}, marcador: raiz.marcador || null, zoom: raiz.zoom || 100 };
    raiz = { usuarios: { [`local:${APP_USER}`]: progresoViejo } };
    fs.writeFileSync(BIBLIA_PROGRESO_FILE, JSON.stringify(raiz, null, 2));
  }
  const p = raiz.usuarios[usuario] || { tachados: {}, marcador: null, zoom: 100 };
  if (!p.tachados) p.tachados = {};
  if (typeof p.zoom !== 'number') p.zoom = 100;
  return p;
}
function guardarProgresoBiblia(usuario, p) {
  let raiz;
  try {
    raiz = JSON.parse(fs.readFileSync(BIBLIA_PROGRESO_FILE, 'utf-8'));
  } catch (e) {
    raiz = { usuarios: {} };
  }
  if (!raiz.usuarios) raiz.usuarios = {};
  raiz.usuarios[usuario] = p;
  fs.writeFileSync(BIBLIA_PROGRESO_FILE, JSON.stringify(raiz, null, 2));
  // Backup a MongoDB en background
  guardarEnMongoBackground('biblia-progreso', raiz);
}

// API publica (RV1960) que usamos como fuente de la Biblia completa, para no
// tener que empaquetar todo el texto biblico dentro del proyecto.
const BIBLIA_API_BASE = 'https://bible-api.deno.dev/api';
let cacheLibrosBiblia = null;
const cacheCapitulosBiblia = new Map();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Handler para cuando el body-parser rechaza un JSON mal formado (sintaxis
// invalida, comillas simples, comas sueltas, etc.). Por defecto Express manda
// un HTML crudo "Bad Request" que rompe a cualquier cliente de API que espera
// JSON. Aca lo interceptamos para devolver siempre JSON en las rutas /api/*,
// igual que hace el resto de la app.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.type === 'request.size.invalid')) {
    if (req.path && req.path.startsWith('/api/')) {
      let mensaje = 'El cuerpo de la peticion no es un JSON valido.';
      if (err.type === 'entity.too.large') mensaje = 'La peticion es demasiado grande.';
      return res.status(400).json({ ok: false, error: mensaje });
    }
    // Para rutas no-API (HTML), dejamos el comportamiento default.
    return res.status(400).type('text').send('Bad Request');
  }
  next(err);
});

// ---------- Login (sesion con cookie firmada, sin dependencias extra) ----------
const APP_USER = process.env.APP_USER || 'admin';
const APP_PASS = process.env.APP_PASS || 'cambia-esta-clave';
const AUTH_SECRET = process.env.AUTH_SECRET || 'cambia-este-secreto-tambien';

if (!process.env.APP_USER || !process.env.APP_PASS) {
  console.warn('[auth] ADVERTENCIA: estas usando el usuario/clave por defecto (admin / cambia-esta-clave).');
  console.warn('[auth] Define APP_USER, APP_PASS y AUTH_SECRET en tu archivo .env antes de exponer esta app a internet.');
}

function firmarValor(valor) {
  const firma = crypto.createHmac('sha256', AUTH_SECRET).update(valor).digest('hex');
  return `${valor}.${firma}`;
}
function verificarValorFirmado(cookieValor) {
  if (!cookieValor) return null;
  const idx = cookieValor.lastIndexOf('.');
  if (idx === -1) return null;
  const valor = cookieValor.slice(0, idx);
  const firma = cookieValor.slice(idx + 1);
  const esperada = crypto.createHmac('sha256', AUTH_SECRET).update(valor).digest('hex');
  const bufFirma = Buffer.from(firma);
  const bufEsperada = Buffer.from(esperada);
  if (bufFirma.length !== bufEsperada.length) return null;
  return crypto.timingSafeEqual(bufFirma, bufEsperada) ? valor : null;
}
function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    const k = parte.slice(0, idx).trim();
    if (k === nombre) return decodeURIComponent(parte.slice(idx + 1).trim());
  }
  return null;
}
function estaAutenticado(req) {
  return verificarValorFirmado(leerCookie(req, 'verbo_auth')) !== null;
}
// Devuelve el identificador del usuario actual: un email de Google (ej.
// "persona@gmail.com") si entro con Google, o "local:admin" si entro con el
// usuario/clave local. Este identificador es lo que separa los datos de cada
// quien (chats, progreso de lectura biblica).
function obtenerUsuarioActual(req) {
  return verificarValorFirmado(leerCookie(req, 'verbo_auth'));
}

const RUTAS_PUBLICAS = new Set(['/login.html', '/login.css', '/login.js', '/api/login', '/api/registro/solicitar', '/api/registro/confirmar', '/style.css', '/script.js', '/logo.png', '/auth/google', '/auth/google/callback', '/api/google/confirmar', '/api/google/reenviar', '/api/v1/chat', '/api/v1/info']);
app.use((req, res, next) => {
  if (RUTAS_PUBLICAS.has(req.path) || req.path.startsWith('/icons/') || req.path.startsWith('/uploads/')) return next();
  if (estaAutenticado(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado.' });
  return res.redirect('/login.html');
});

// ---------- Claves API (tokens tipo "verboai-XXXX") ----------
// Por ahora esta seccion de Settings solo lo puede usar un conjunto chiquito
// de correos. Cualquiera que no este en la lista ve "Prox" en su lugar.
const EMAILS_AUTORIZADOS_API = new Set(
  (process.env.EMAILS_AUTORIZADOS_API || 'marcos.miguel.3110@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

const API_TOKENS_FILE = path.join(MEMORY_DIR, 'api-tokens.json');
if (!fs.existsSync(API_TOKENS_FILE)) fs.writeFileSync(API_TOKENS_FILE, JSON.stringify({ tokens: [] }, null, 2));

// Creditos y limites por defecto para cada token nuevo. Se pueden cambiar
// por token despues si hace falta, pero arrancan con estos valores.
const TOKEN_CREDITOS_INICIALES = 1000;        // cuantas peticiones puede hacer
const TOKEN_RATE_LIMIT_VENTANA_MS = 60 * 1000; // ventana de 1 minuto
const TOKEN_RATE_LIMIT_MAX = 20;               // max 20 peticiones por minuto

function leerApiTokens() {
  try {
    const d = JSON.parse(fs.readFileSync(API_TOKENS_FILE, 'utf-8'));
    return Array.isArray(d.tokens) ? d.tokens : [];
  } catch (e) {
    return [];
  }
}
function guardarApiTokens(tokens) {
  const valor = { tokens };
  fs.writeFileSync(API_TOKENS_FILE, JSON.stringify(valor, null, 2));
  // Backup a MongoDB en background
  guardarEnMongoBackground('api-tokens', valor);
}

// Devuelve true si el usuario actual (email o "local:admin") tiene acceso a la
// seccion de Clave API. El admin local siempre entra (para probarlo).
function tieneAccesoApiTokens(usuario) {
  if (!usuario) return false;
  if (usuario.startsWith('local:')) return true;
  return EMAILS_AUTORIZADOS_API.has(usuario.toLowerCase());
}

// Genera un token aleatorio tipo "verboai-" + 24 digitos. Son solo digitos
// para que sea facil de copiar y pegar en cualquier lado sin sorpresas con
// caracteres raros. 24 digitos => 10^24 combinaciones, suficiente.
function generarTokenVerboai() {
  const digitos = crypto.randomBytes(12).toString('hex'); // 24 hex chars => 0-9 a-f
  // Para que sean SOLO digitos (no hex), los mapeamos a 0-9 tomando cada
  // par y haciendo modulo 10. Sigue siendo suficientemente aleatorio.
  let soloDigitos = '';
  for (let i = 0; i < digitos.length; i += 2) {
    const num = parseInt(digitos.slice(i, i + 2), 16);
    soloDigitos += String(num % 10);
  }
  return 'verboai-' + soloDigitos;
}

// Busca un token por su valor completo (lo que se manda en Authorization).
// Devuelve el objeto del token o null. Tambien aplica la "poda" automatica
// de tokens vencidos por inactividad (no se borran, solo se marcan).
function buscarTokenPorValor(valor) {
  if (!valor) return null;
  const tokens = leerApiTokens();
  return tokens.find((t) => t.token === valor && t.activo !== false) || null;
}

// Registra una peticion contra un token: descuenta credito y revisa el rate
// limit. Devuelve { ok: true } o { ok: false, status, error }.
//
// Opciones:
//   - costo (numero, default 1): cuantos creditos consume esta peticion.
//     NewserAvanced por ejemplo pasa 5 aca.
//   - rateLimitMax (numero, default TOKEN_RATE_LIMIT_MAX): limite de peticiones
//     por minuto que aplica a esta llamada. NewserAvanced pasa 10.
//
// El rate limit es por-token y por-ventana: contamos cuantas peticiones hizo
// este token en los ultimos 60s y lo bloqueamos si se pasa. Como el costo y
// el limite dependen del modelo, los pasamos como parametro en vez de tenerlos
// fijos en el token.
function registrarUsoToken(token, opciones = {}) {
  const costo = (typeof opciones.costo === 'number' && opciones.costo > 0) ? opciones.costo : 1;
  const rateLimitMax = (typeof opciones.rateLimitMax === 'number' && opciones.rateLimitMax > 0)
    ? opciones.rateLimitMax
    : TOKEN_RATE_LIMIT_MAX;

  const tokens = leerApiTokens();
  const idx = tokens.findIndex((t) => t.id === token.id);
  if (idx === -1) return { ok: false, status: 401, error: 'Token invalido.' };

  const t = tokens[idx];
  if (t.activo === false) return { ok: false, status: 401, error: 'Token revocado.' };
  if (typeof t.creditos !== 'number' || t.creditos < costo) {
    return {
      ok: false,
      status: 402,
      error: costo > 1
        ? `El token no tiene creditos suficientes para este modelo (necesita ${costo}, le quedan ${t.creditos || 0}).`
        : 'El token se quedo sin creditos.',
    };
  }

  const ahora = Date.now();
  // Limpia el historial de la ventana actual (mas viejos que VENTANA_MS)
  if (!Array.isArray(t.usos)) t.usos = [];
  t.usos = t.usos.filter((ts) => ahora - ts < TOKEN_RATE_LIMIT_VENTANA_MS);
  if (t.usos.length >= rateLimitMax) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit del token alcanzado: max ${rateLimitMax} peticiones por minuto para este modelo.`,
    };
  }

  t.usos.push(ahora);
  t.creditos = t.creditos - costo;
  t.ultimoUso = new Date(ahora).toISOString();
  tokens[idx] = t;
  guardarApiTokens(tokens);
  return { ok: true, creditosRestantes: t.creditos };
}

// Devuelve una version "sanitizada" del token para mandarle al frontend: SIN
// el valor completo (solo los ultimos 4 digitos), para que nunca se exponga
// el token en claro despues de creado (solo se ve 1 vez al generarlo).
function tokenPublico(t) {
  const visible = t.token ? t.token.slice(-4) : '????';
  return {
    id: t.id,
    prefijo: 'verboai-••••••••' + visible,
    creditos: t.creditos,
    creditosIniciales: t.creditosIniciales || t.creditos,
    rateLimit: TOKEN_RATE_LIMIT_MAX,
    rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    creadoEn: t.creadoEn,
    ultimoUso: t.ultimoUso || null,
    nombre: t.nombre || 'Token sin nombre',
    activo: t.activo !== false,
  };
}

// ---------- Registro con correo + codigo de verificacion ----------
const USUARIOS_FILE = path.join(MEMORY_DIR, 'usuarios.json');
if (!fs.existsSync(USUARIOS_FILE)) fs.writeFileSync(USUARIOS_FILE, JSON.stringify({ usuarios: {} }, null, 2));

// ---------- MongoDB (persistencia real, no se pierde al reiniciar) ----------
// Ahora que todos los archivos de /memory estan declarados, agregamos la
// integracion con MongoDB. Si MONGODB_URI esta configurada, todos los datos
// (chats, usuarios, tokens API, progreso biblico) se guardan tambien ahi.
// Si no esta o falla la conexion, todo sigue funcionando con los archivos
// locales de /memory (como antes).
//
// Las funciones leerX()/guardarX() siguen siendo sincronas (no rompen el
// codigo existente). Lo que hacemos es:
//   1. Al arrancar el server, cargamos desde Mongo a los archivos locales
//      (async, antes de app.listen).
//   2. Cada guardarX() escribe al archivo local (sincrono, como antes) Y
//      dispara un guardado a Mongo en background (async, no bloquea).
const mongoDb = require('./db');

// Carga inicial desde Mongo a los archivos locales. Se llama al arrancar,
// antes de app.listen. Si Mongo no tiene datos todavia (primera vez), no
// hace nada (los archivos locales ya estan con defaults vacios).
async function cargarDesdeMongoAlArrancar() {
  if (!mongoDb.estaConectado()) {
    console.log('[mongo-sync] Mongo no conectado, saltando carga inicial.');
    return;
  }
  console.log('[mongo-sync] Cargando datos desde MongoDB...');
  try {
    // 1. Historial de chats
    const historial = await mongoDb.leerDocumento('historial');
    if (historial && typeof historial === 'object') {
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(historial, null, 2));
      console.log('[mongo-sync] historial.json cargado desde Mongo.');
    }

    // 2. Usuarios
    const usuarios = await mongoDb.leerDocumento('usuarios');
    if (usuarios && typeof usuarios === 'object') {
      fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuarios, null, 2));
      console.log('[mongo-sync] usuarios.json cargado desde Mongo.');
    }

    // 3. Tokens API
    const tokens = await mongoDb.leerDocumento('api-tokens');
    if (tokens && typeof tokens === 'object') {
      fs.writeFileSync(API_TOKENS_FILE, JSON.stringify(tokens, null, 2));
      console.log('[mongo-sync] api-tokens.json cargado desde Mongo.');
    }

    // 4. Progreso biblico
    const progreso = await mongoDb.leerDocumento('biblia-progreso');
    if (progreso && typeof progreso === 'object') {
      fs.writeFileSync(BIBLIA_PROGRESO_FILE, JSON.stringify(progreso, null, 2));
      console.log('[mongo-sync] biblia-progreso.json cargado desde Mongo.');
    }
  } catch (e) {
    console.error('[mongo-sync] Error cargando desde Mongo:', e.message);
  }
}

// Dispara un guardado a Mongo en background (no bloquea la respuesta al
// usuario). Si Mongo no esta conectado o falla, no pasa nada: el archivo
// local ya quedo guardado antes de llamar a esto.
function guardarEnMongoBackground(id, valor) {
  if (!mongoDb.estaConectado()) return;
  // setImmediate para no bloquear el event loop actual
  setImmediate(async () => {
    try {
      await mongoDb.guardarDocumento(id, valor);
    } catch (e) {
      console.error(`[mongo-sync] Error guardando "${id}" en Mongo:`, e.message);
    }
  });
}

function leerUsuarios() {
  try {
    const d = JSON.parse(fs.readFileSync(USUARIOS_FILE, 'utf-8'));
    return d.usuarios || {};
  } catch (e) {
    return {};
  }
}
function guardarUsuarios(usuarios) {
  const valor = { usuarios };
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify(valor, null, 2));
  // Backup a MongoDB en background
  guardarEnMongoBackground('usuarios', valor);
}
function hashearClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(clave, sal, 64).toString('hex');
  return `${sal}:${hash}`;
}
function verificarClave(clave, saleHash) {
  const [sal, hash] = (saleHash || '').split(':');
  if (!sal || !hash) return false;
  const hashIntento = crypto.scryptSync(clave, sal, 64).toString('hex');
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(hashIntento, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Codigos de verificacion pendientes (en memoria: se pierden si reinicias el
// servidor a mitad de un registro, lo cual esta bien para algo de 10 minutos).
const codigosPendientes = new Map(); // email -> { codigo, claveHash, expira }

let transporterCorreo = null;
if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
  transporterCorreo = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 5000,
    greetingTimeout: 3000,
    socketTimeout: 5000
  });
} else {
  console.warn('[registro] EMAIL_USER o EMAIL_APP_PASSWORD no estan definidos en tu .env.');
  console.warn('[registro] El registro por correo no va a poder mandar codigos hasta que los completes.');
}

// Función para enviar correo con fallback a Resend API
async function enviarCorreoConFallback(destinatario, asunto, texto, html) {
  // Intentar con SMTP primero
  if (transporterCorreo) {
    try {
      await transporterCorreo.sendMail({
        from: `"Verbo AI" <${process.env.EMAIL_USER}>`,
        to: destinatario,
        subject: asunto,
        text: texto,
        html: html,
      });
      console.log('[email] Enviado via SMTP');
      return;
    } catch (e) {
      console.warn('[email] SMTP falló, intentando Resend API:', e.message);
    }
  }

  // Fallback a Resend API
  if (process.env.RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'Verbo AI <onboarding@resend.dev>',
          to: [destinatario],
          subject: asunto,
          html: html,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        // El error mas comun aca es que la cuenta de Resend sigue en modo
        // sandbox: solo deja enviar al correo con el que te registraste,
        // hasta que verifiques un dominio propio en resend.com/domains y
        // configures RESEND_FROM_EMAIL con un remitente de ese dominio.
        if (error.includes('You can only send testing emails')) {
          console.error('[email] Resend esta en modo sandbox: verifica un dominio en https://resend.com/domains y configura RESEND_FROM_EMAIL (ej: "Verbo AI <codigo@tudominio.com>") para poder enviar a cualquier destinatario.');
        }
        throw new Error(`Resend API error: ${error}`);
      }
      
      console.log('[email] Enviado via Resend API');
      return;
    } catch (e) {
      console.error('[email] Resend API falló:', e.message);
      throw e;
    }
  }

  // Fallback a Brevo API (no requiere dominio propio: alcanza con verificar
  // tu email de remitente con un codigo de 6 digitos en app.brevo.com)
  if (process.env.BREVO_API_KEY) {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: 'Verbo AI',
            email: process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_USER,
          },
          to: [{ email: destinatario }],
          subject: asunto,
          htmlContent: html,
          textContent: texto,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Brevo API error: ${error}`);
      }

      console.log('[email] Enviado via Brevo API');
      return;
    } catch (e) {
      console.error('[email] Brevo API falló:', e.message);
      throw e;
    }
  }

  throw new Error('No hay configuración de email disponible (SMTP, Resend ni Brevo)');
}

app.post('/api/registro/solicitar', async (req, res) => {
  const { email, clave } = req.body || {};
  if (!email || !clave) return res.status(400).json({ error: 'Falta email o clave.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ese email no parece valido.' });
  if (clave.length < 6) return res.status(400).json({ error: 'La clave tiene que tener al menos 6 caracteres.' });

  const usuarios = leerUsuarios();
  if (usuarios[email]) return res.status(400).json({ error: 'Ya existe una cuenta con ese correo.' });

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  codigosPendientes.set(email, { codigo, claveHash: hashearClave(clave), expira: Date.now() + 10 * 60 * 1000 });

  try {
    await enviarCorreoConFallback(
      email,
      'Tu codigo de verificacion - Verbo AI',
      `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
      `<div style="font-family:sans-serif;padding:20px;">
        <h2 style="color:#C9663A;">Verbo AI</h2>
        <p>Tu codigo de verificacion es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
        <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
      </div>`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[registro] Error enviando el correo:');
    console.error('[registro] Mensaje:', e.message);
    console.error('[registro] Código:', e.code);
    console.error('[registro] Stack:', e.stack);
    if (e.response) {
      console.error('[registro] Respuesta SMTP:', e.response);
    }
    codigosPendientes.delete(email);
    res.status(500).json({ error: 'No se pudo enviar el correo. Revisa la configuracion de EMAIL_USER/EMAIL_APP_PASSWORD o RESEND_API_KEY.' });
  }
});

app.post('/api/registro/confirmar', (req, res) => {
  const { email, codigo } = req.body || {};
  if (!email || !codigo) return res.status(400).json({ error: 'Falta el email o el codigo.' });

  const pendiente = codigosPendientes.get(email);
  if (!pendiente) return res.status(400).json({ error: 'No hay un registro pendiente para ese correo. Pedi el codigo de nuevo.' });
  if (Date.now() > pendiente.expira) {
    codigosPendientes.delete(email);
    return res.status(400).json({ error: 'El codigo vencio. Pedi uno nuevo.' });
  }
  if (codigo.trim() !== pendiente.codigo) return res.status(400).json({ error: 'El codigo no es correcto.' });

  const usuarios = leerUsuarios();
  usuarios[email] = { claveHash: pendiente.claveHash, creadoEn: new Date().toISOString() };
  guardarUsuarios(usuarios);
  codigosPendientes.delete(email);

  let cookieStr = `verbo_auth=${encodeURIComponent(firmarValor(email))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
  if (req.secure) cookieStr += '; Secure';
  res.setHeader('Set-Cookie', cookieStr);
  res.json({ ok: true, necesitaNombre: true });
});

app.post('/api/login', (req, res) => {
  const { usuario, clave, recordar } = req.body || {};
  if (usuario === APP_USER && clave === APP_PASS) {
    let cookieStr = `verbo_auth=${encodeURIComponent(firmarValor(`local:${APP_USER}`))}; HttpOnly; Path=/; SameSite=Lax`;
    if (req.secure) cookieStr += '; Secure';
    if (recordar) cookieStr += `; Max-Age=${60 * 60 * 24 * 30}`; // 30 dias
    res.setHeader('Set-Cookie', cookieStr);
    return res.json({ ok: true });
  }
  // Tambien revisamos si es un usuario registrado por correo
  const usuarios = leerUsuarios();
  const cuenta = usuarios[usuario];
  if (cuenta && verificarClave(clave, cuenta.claveHash)) {
    let cookieStr = `verbo_auth=${encodeURIComponent(firmarValor(usuario))}; HttpOnly; Path=/; SameSite=Lax`;
    if (req.secure) cookieStr += '; Secure';
    if (recordar) cookieStr += `; Max-Age=${60 * 60 * 24 * 30}`;
    res.setHeader('Set-Cookie', cookieStr);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Usuario o contrasena incorrectos.' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'verbo_auth=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/whoami', (req, res) => {
  const usuario = obtenerUsuarioActual(req);
  if (!usuario) return res.json({ usuario: null });
  if (usuario.startsWith('local:')) {
    return res.json({ usuario: usuario.slice(6), nombre: usuario.slice(6) });
  }
  const cuenta = leerUsuarios()[usuario];
  res.json({ usuario, nombre: (cuenta && cuenta.nombre) || usuario });
});

// Paso extra tras confirmar el codigo (registro o Google): elegir un nombre
// para mostrar y aceptar los terminos basicos de uso. Requiere sesion ya
// iniciada (el middleware de arriba ya exige la cookie de auth para esto).
app.post('/api/perfil/nombre', (req, res) => {
  const usuarioActual = obtenerUsuarioActual(req);
  if (!usuarioActual) return res.status(401).json({ error: 'No autenticado.' });

  const { nombre, aceptaTerminos } = req.body || {};
  const nombreLimpio = (nombre || '').trim().slice(0, 40);
  if (!nombreLimpio) return res.status(400).json({ error: 'Poné un nombre.' });
  if (!aceptaTerminos) return res.status(400).json({ error: 'Tenés que aceptar los terminos para continuar.' });

  if (usuarioActual.startsWith('local:')) {
    // El usuario local (admin) no vive en usuarios.json; no hay donde
    // guardarle un nombre distinto, pero no es un caso que pase por este
    // paso de todos modos.
    return res.json({ ok: true });
  }

  const usuarios = leerUsuarios();
  if (!usuarios[usuarioActual]) usuarios[usuarioActual] = { creadoEn: new Date().toISOString() };
  usuarios[usuarioActual].nombre = nombreLimpio;
  usuarios[usuarioActual].terminosAceptadosEn = new Date().toISOString();
  guardarUsuarios(usuarios);

  res.json({ ok: true, nombre: nombreLimpio });
});

// ---------- Login con Google (OAuth2, sin dependencias extra) ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn('[google-auth] GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET no estan definidos en tu .env.');
  console.warn('[google-auth] El boton "Continuar con Google" no va a funcionar hasta que los completes y reinicies el servidor.');
} else {
  console.log(`[google-auth] Client ID cargado: ${GOOGLE_CLIENT_ID.slice(0, 12)}...${GOOGLE_CLIENT_ID.slice(-20)}`);
}

// El redirect_uri se calcula segun por donde entraste (localhost o la IP de
// tu red local), asi funciona igual desde la PC que desde el celular. Google
// igual exige que CADA una de esas URLs este agregada de antemano en
// "URIs de redireccionamiento autorizados" en Google Cloud Console.
function calcularRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI_FIJA) return process.env.GOOGLE_REDIRECT_URI_FIJA;
  return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).send('El login con Google no esta configurado (falta GOOGLE_CLIENT_ID en el .env).');
  }
  const state = crypto.randomBytes(16).toString('hex');
  let cookieEstado = `verbo_oauth_state=${encodeURIComponent(firmarValor(state))}; HttpOnly; Path=/; Max-Age=300; SameSite=Lax`;
  if (req.secure) cookieEstado += '; Secure';
  res.setHeader('Set-Cookie', cookieEstado);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: calcularRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/login.html?error=google_denegado');

    const estadoCookie = verificarValorFirmado(leerCookie(req, 'verbo_oauth_state'));
    if (!estadoCookie || estadoCookie !== state) {
      return res.redirect('/login.html?error=google_estado_invalido');
    }
    if (!code) return res.redirect('/login.html?error=google_sin_codigo');

    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: calcularRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResp.ok) {
      console.error('[google-auth] Error intercambiando el codigo:', await tokenResp.text());
      return res.redirect('/login.html?error=google_token');
    }
    const tokenData = await tokenResp.json();

    const userResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResp.ok) return res.redirect('/login.html?error=google_userinfo');
    const userData = await userResp.json();
    if (!userData.email) return res.redirect('/login.html?error=google_sin_email');

    // Si no hay configuración de email (SMTP ni Resend), entramos directo
    if (!transporterCorreo && !process.env.RESEND_API_KEY) {
      console.warn('[google-auth] No hay configuración de email: entrando sin pedir codigo extra.');
      let cookieDirecta = `verbo_auth=${encodeURIComponent(firmarValor(userData.email))}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
      if (req.secure) cookieDirecta += '; Secure';
      res.setHeader('Set-Cookie', [cookieDirecta, 'verbo_oauth_state=; HttpOnly; Path=/; Max-Age=0']);
      return res.redirect('/');
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    codigosPendientes.set(userData.email, { codigo, expira: Date.now() + 10 * 60 * 1000, esGoogle: true });

    try {
      await enviarCorreoConFallback(
        userData.email,
        'Tu codigo de verificacion - Verbo AI',
        `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
        `<div style="font-family:sans-serif;padding:20px;">
          <h2 style="color:#C9663A;">Verbo AI</h2>
          <p>Para terminar de entrar con tu cuenta de Google, tu codigo de verificacion es:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
          <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
        </div>`
      );
    } catch (e) {
      console.error('[google-auth] Error enviando el correo del codigo:');
      console.error('[google-auth] Mensaje:', e.message);
      console.error('[google-auth] Código:', e.code);
      console.error('[google-auth] Stack:', e.stack);
      if (e.response) {
        console.error('[google-auth] Respuesta SMTP:', e.response);
      }
      codigosPendientes.delete(userData.email);
      return res.redirect('/login.html?error=google_correo_codigo');
    }

    // Cookie corta y firmada que solo guarda QUE correo de Google esta
    // esperando su codigo; el codigo en si nunca viaja al cliente por aca.
    let cookiePendiente = `verbo_google_pendiente=${encodeURIComponent(firmarValor(userData.email))}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`;
    if (req.secure) cookiePendiente += '; Secure';
    res.setHeader('Set-Cookie', [cookiePendiente, 'verbo_oauth_state=; HttpOnly; Path=/; Max-Age=0']);
    res.redirect(`/login.html?paso=google_codigo&correo=${encodeURIComponent(userData.email)}`);
  } catch (e) {
    console.error('[google-auth] Error en el callback:', e.message);
    res.redirect('/login.html?error=google_interno');
  }
});

// Segundo paso del login con Google: confirmar el codigo de 6 digitos que se
// mando al correo. El correo en si NUNCA se toma de lo que mande el cliente,
// se lee de la cookie firmada que dejamos en el callback de arriba, para que
// nadie pueda mandar cualquier email y "confirmar" una cuenta ajena.
app.post('/api/google/confirmar', (req, res) => {
  const email = verificarValorFirmado(leerCookie(req, 'verbo_google_pendiente'));
  if (!email) return res.status(400).json({ error: 'No hay un login con Google pendiente. Volve a intentar desde el boton de Google.' });

  const { codigo } = req.body || {};
  if (!codigo) return res.status(400).json({ error: 'Falta el codigo.' });

  const pendiente = codigosPendientes.get(email);
  if (!pendiente) return res.status(400).json({ error: 'El codigo ya no esta disponible. Volve a intentar desde el boton de Google.' });
  if (Date.now() > pendiente.expira) {
    codigosPendientes.delete(email);
    return res.status(400).json({ error: 'El codigo vencio. Volve a intentar desde el boton de Google.' });
  }
  if (codigo.trim() !== pendiente.codigo) return res.status(400).json({ error: 'El codigo no es correcto.' });

  codigosPendientes.delete(email);

  const usuarios = leerUsuarios();
  if (!usuarios[email]) {
    usuarios[email] = { creadoEn: new Date().toISOString(), esGoogle: true };
    guardarUsuarios(usuarios);
  }
  const necesitaNombre = !usuarios[email].nombre;

  let cookieStr = `verbo_auth=${encodeURIComponent(firmarValor(email))}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
  if (req.secure) cookieStr += '; Secure';
  res.setHeader('Set-Cookie', [cookieStr, 'verbo_google_pendiente=; HttpOnly; Path=/; Max-Age=0']);
  res.json({ ok: true, necesitaNombre });
});

// Reenviar el codigo del login con Google, por si se vencio o no llego.
app.post('/api/google/reenviar', async (req, res) => {
  const email = verificarValorFirmado(leerCookie(req, 'verbo_google_pendiente'));
  if (!email) return res.status(400).json({ error: 'No hay un login con Google pendiente. Volve a intentar desde el boton de Google.' });

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  codigosPendientes.set(email, { codigo, expira: Date.now() + 10 * 60 * 1000, esGoogle: true });

  try {
    await enviarCorreoConFallback(
      email,
      'Tu codigo de verificacion - Verbo AI',
      `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
      `<div style="font-family:sans-serif;padding:20px;">
        <h2 style="color:#C9663A;">Verbo AI</h2>
        <p>Para terminar de entrar con tu cuenta de Google, tu codigo de verificacion es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
        <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
      </div>`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('[google-reenviar] Error enviando el correo:');
    console.error('[google-reenviar] Mensaje:', e.message);
    console.error('[google-reenviar] Código:', e.code);
    console.error('[google-reenviar] Stack:', e.stack);
    if (e.response) {
      console.error('[google-reenviar] Respuesta SMTP:', e.response);
    }
    codigosPendientes.delete(email);
    res.status(500).json({ error: 'No se pudo reenviar el correo.' });
  }
});

// ---------- Endpoints para gestionar los tokens de la API (Clave API) ----------
// Requiere sesion iniciada (el middleware global de arriba ya lo asegura).
// Solo los correos en EMAILS_AUTORIZADOS_API (o el admin local) pueden hacer
// algo aca; cualquier otro recibe 403.

app.get('/api/api-tokens/acceso', (req, res) => {
  const usuario = obtenerUsuarioActual(req);
  res.json({
    acceso: tieneAccesoApiTokens(usuario),
    email: usuario && usuario.startsWith('local:') ? usuario.slice(6) : usuario,
  });
});

app.get('/api/api-tokens', (req, res) => {
  const usuario = obtenerUsuarioActual(req);
  if (!tieneAccesoApiTokens(usuario)) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso a Clave API por ahora.' });
  }
  // El admin local y los correos autorizados ven SOLO sus propios tokens.
  // Como los crea un usuario autorizado, filtramos por propietario. Si por
  // ahora solo hay un usuario autorizado, va a verlos a todos igual.
  const tokens = leerApiTokens().filter((t) => t.propietario === usuario);
  res.json({ tokens: tokens.map(tokenPublico) });
});

app.post('/api/api-tokens/generar', (req, res) => {
  const usuario = obtenerUsuarioActual(req);
  if (!tieneAccesoApiTokens(usuario)) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso a Clave API por ahora.' });
  }
  // Validacion estricta del nombre: solo string, max 40 chars. Rechazamos
  // arrays/objetos/numeros para que no rompa String() ni .trim().
  if (req.body && req.body.nombre != null && typeof req.body.nombre !== 'string') {
    return res.status(400).json({ error: 'El nombre debe ser un texto valido.' });
  }
  const nombreLimpio = (req.body && req.body.nombre ? String(req.body.nombre) : '').trim().slice(0, 40);
  const tokens = leerApiTokens();
  // Prevenimos que alguien llene el archivo a manotazos: max 10 tokens vivos.
  const vivos = tokens.filter((t) => t.propietario === usuario && t.activo !== false);
  if (vivos.length >= 10) {
    return res.status(400).json({ error: 'Ya tenes 10 tokens activos. Borra alguno antes de crear otro.' });
  }

  const nuevoToken = {
    id: generarId(),
    token: generarTokenVerboai(),
    nombre: nombreLimpio || 'Token sin nombre',
    propietario: usuario,
    creditos: TOKEN_CREDITOS_INICIALES,
    creditosIniciales: TOKEN_CREDITOS_INICIALES,
    rateLimitMax: TOKEN_RATE_LIMIT_MAX,
    rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    creadoEn: new Date().toISOString(),
    ultimoUso: null,
    usos: [],
    activo: true,
  };
  tokens.push(nuevoToken);
  guardarApiTokens(tokens);

  // OJO: aca si le mandamos el token completo al frontend, PERO solo esta una
  // vez. En listados posteriores solo se ve el prefijo "verboai-••••...1234".
  res.json({
    ok: true,
    token: nuevoToken.token,
    info: tokenPublico(nuevoToken),
    creditosIniciales: TOKEN_CREDITOS_INICIALES,
    rateLimit: TOKEN_RATE_LIMIT_MAX,
    rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
  });
});

app.delete('/api/api-tokens/:id', (req, res) => {
  const usuario = obtenerUsuarioActual(req);
  if (!tieneAccesoApiTokens(usuario)) {
    return res.status(403).json({ error: 'Tu cuenta no tiene acceso a Clave API por ahora.' });
  }
  const tokens = leerApiTokens();
  const idx = tokens.findIndex((t) => t.id === req.params.id && t.propietario === usuario);
  if (idx === -1) return res.status(404).json({ error: 'Token no encontrado.' });
  // Lo borramos de verdad: como el token ya no se puede usar, no tiene sentido
  // seguir acumulando creditos o usos de algo inactivo. Si despues se quiere
  // auditoria, se puede cambiar a activo=false en vez de splice.
  tokens.splice(idx, 1);
  guardarApiTokens(tokens);
  res.json({ ok: true });
});

// ---------- API publica (consumible con un token "verboai-XXXX") ----------
// Estas rutas NO pasan por el middleware de sesion de arriba: se autentican
// con un Bearer token en el header Authorization. Es lo que usarias desde
// otro proyecto (un bot de Discord, un script, otra web, etc.) para hablar
// con Verbo AI sin tener que loguearse con Google.

function leerBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Hace lo mismo que el /api/chat pero SIN streaming, SIN imagenes, SIN
// historial: recibe { mensaje, modo, modelo } y devuelve { ok, respuesta }.
// Pensado para integraciones programaticas (curl, fetch, SDKs).
//
// El campo "modelo" es opcional y por default es "NewserLite". Si mandas
// "NewserAvanced" (o cualquiera de las variantes case-insensitive), se usa el
// modelo avanzado: consume 5 creditos en vez de 1 y tiene rate limit de 10/min
// en vez de 20/min. Cualquier otro valor cae a NewserLite de forma segura.
app.post('/api/v1/chat', async (req, res) => {
  const valorToken = leerBearerToken(req);
  if (!valorToken) {
    return res.status(401).json({ ok: false, error: 'Falta el header Authorization: Bearer verboai-XXXX' });
  }
  const token = buscarTokenPorValor(valorToken);
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token invalido o revocado.' });
  }

  // Validacion estricta de tipos: rechazamos arrays, objetos, numeros, etc.
  // antes de intentar usar el mensaje. Esto evita que un cliente malicioso
  // mande {"mensaje": ["test", true, null]} u otras estructuras raras y haga
  // colgar la peticion.
  if (req.body == null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ ok: false, error: 'El cuerpo debe ser un objeto JSON.' });
  }
  if (typeof req.body.mensaje !== 'string') {
    return res.status(400).json({ ok: false, error: 'El mensaje debe ser un formato de texto valido.' });
  }
  const mensaje = req.body.mensaje.trim();
  if (!mensaje) {
    return res.status(400).json({ ok: false, error: 'Falta "mensaje" en el cuerpo de la peticion.' });
  }
  if (mensaje.length > 8000) {
    return res.status(400).json({ ok: false, error: 'El mensaje es demasiado largo (max 8000 caracteres).' });
  }

  // Modo opcional: solo aceptamos "general" (default) o "catolico". Cualquier
  // otro valor (o tipo no-string) cae a "general" para no romper.
  const modo = (typeof req.body.modo === 'string' && req.body.modo.trim() === 'catolico') ? 'catolico' : 'general';

  // Modelo opcional: resolverModelo ya valida y cae al default si viene cualquier
  // cosa rara (numero, objeto, nombre inexistente). Asi nunca rompe.
  const configModelo = resolverModelo(req.body.modelo);

  // Registramos el uso CON el costo BASE del modelo y su rate limit. Si el
  // token no tiene creditos suficientes (NewserAvanced pide 5) o se paso del
  // rate limit, aca se corta y devolvemos el error.
  // 
  // OJO: el costo final puede ser mayor si la respuesta dispara herramientas
  // (IMAGEN +1, WEB +1, CLIMA +0). Ese extra se cobra DESPUES, cuando ya
  // sabemos si la herramienta se activo o no. Si el token se queda sin
  // creditos en ese momento, igual devolvemos la respuesta de texto (no la
  // penalizamos) pero no se ejecuta la herramienta.
  const controlUso = registrarUsoToken(token, {
    costo: configModelo.costoCreditos,
    rateLimitMax: configModelo.rateLimitMax,
  });
  if (!controlUso.ok) {
    return res.status(controlUso.status).json({ ok: false, error: controlUso.error });
  }

  // Construimos el system prompt segun modo + modelo. NewserAvanced recibe
  // el bloque extra con las 3 herramientas exclusivas (IMAGEN, WEB, CLIMA).
  let systemPrompt = modo === 'catolico' ? SYSTEM_PROMPT_CATOLICO : SYSTEM_PROMPT;
  if (configModelo.nombre === 'NewserAvanced') {
    systemPrompt = systemPrompt + SYSTEM_PROMPT_AVANCED_EXTRA;
  }

  // Reemplazamos el placeholder __NOMBRE_MODELO__ con el nombre real del
  // modelo elegido. Asi cuando el usuario tiene NewserAvanced seleccionado y
  // le pregunta "quien sos?", la IA responde "Soy NewserAvanced" (no
  // "NewserLite").
  systemPrompt = systemPrompt.replace(/__NOMBRE_MODELO__/g, configModelo.nombre);

  const mensajesParaModelo = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: mensaje },
  ];

  // ---- Atajo: "Generame [descripcion]" -> genera imagen directo, sin IA ----
  // Si el mensaje empieza con "Genera", "Generame", "Dibujame", etc., vamos
  // directo a pollinations.ai sin llamar a Groq. Esto consume +1 credito
  // (encima del costo base del modelo) SOLO si el modelo es NewserAvanced.
  // Si es NewserLite, devolvemos un error claro.
  const intencionImagenApi = detectarGeneracionImagen(mensaje);
  if (intencionImagenApi.esGeneracion) {
    if (configModelo.nombre !== 'NewserAvanced') {
      return res.status(400).json({
        ok: false,
        error: 'La generacion de imagenes solo esta disponible con NewserAvanced. Mandá "modelo":"NewserAvanced" en el body para usarla.',
      });
    }
    // Verificamos si le alcanzan los creditos para el extra (+1)
    const tokenActual = buscarTokenPorValor(valorToken);
    const costoTotalGen = configModelo.costoCreditos + 1;
    if (!tokenActual || tokenActual.creditos < 1) {
      return res.status(402).json({
        ok: false,
        error: `El token no tiene creditos suficientes para generar imagen (necesita +1, le quedan ${tokenActual ? tokenActual.creditos : 0}).`,
      });
    }
    // Generamos la imagen
    const img = await generarImagenPollinations(intencionImagenApi.prompt);
    if (!img) {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo generar la imagen en este momento. Intenta de nuevo en unos minutos.',
      });
    }
    // Descontamos el costo extra (+1) del token. El costo base ya se cobró al
    // inicio con registrarUsoToken. Si el token se quedó sin creditos aca (por
    // un race condition), igual devolvemos la imagen pero avisamos.
    const tokensGen = leerApiTokens();
    const idxGen = tokensGen.findIndex((t) => t.id === tokenActual.id);
    if (idxGen !== -1) {
      tokensGen[idxGen].creditos = Math.max(0, (tokensGen[idxGen].creditos || 0) - 1);
      guardarApiTokens(tokensGen);
    }
    const actualizadoGen = buscarTokenPorValor(valorToken);
    return res.json({
      ok: true,
      respuesta: `Imagen generada: ${intencionImagenApi.prompt}`,
      modelo: configModelo.nombre,
      modeloUsado: configModelo.nombre,
      costoCreditos: costoTotalGen,
      costoBase: configModelo.costoCreditos,
      costoExtraHerramientas: 1,
      herramientas: [{
        herramienta: 'imagen',
        prompt: img.prompt,
        url: img.url,
        tamanoKB: img.tamanoKB,
      }],
      imagen: {
        url: img.url,
        prompt: img.prompt,
        tamanoKB: img.tamanoKB,
      },
      creditosRestantes: actualizadoGen ? actualizadoGen.creditos : null,
      rateLimitMax: configModelo.rateLimitMax,
      rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    });
  }

  try {
    const respuestaGroq = await llamarGroqConReintentos({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: configModelo.modeloTexto,
        messages: mensajesParaModelo,
        temperature: 0.7,
        max_tokens: configModelo.maxTokens,
        stream: false,
      }),
    }, () => {});

    if (!respuestaGroq || !respuestaGroq.ok) {
      const status = respuestaGroq ? respuestaGroq.status : 0;
      try {
        const detalle = respuestaGroq ? await respuestaGroq.clone().text() : '(sin respuesta)';
        console.error(`[api/v1/chat] Error del proveedor de IA (status ${status}):`, detalle.slice(0, 500));
      } catch (e) { /* no se pudo leer el cuerpo */ }
      return res.status(502).json({ ok: false, error: mensajeErrorAmigableIA(status) });
    }

    const data = await respuestaGroq.json();
    const texto = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    // Detectar las etiquetas exclusivas de NewserAvanced que la IA puede haber
    // escrito: WEB y CLIMA (la etiqueta IMAGEN ya no se usa; las imagenes se
    // generan automaticamente cuando el mensaje empieza con "Genera...").
    // WEB consume +1 credito; CLIMA no consume.
    let webSearchQueryApi = null;
    let climaQueryApi = null;
    let textoLimpio = texto;

    // Por las dudas, si el modelo igual escribió un [[IMAGEN::...]] (no debería
    // porque el prompt le dice que no lo haga), lo limpiamos del texto.
    textoLimpio = textoLimpio.replace(/\[\[IMAGEN::[^\]]*\]\]/g, '');

    const reWebApi = /\[\[WEB::([^\]]+)\]\]/g;
    const mWeb = [...texto.matchAll(reWebApi)];
    if (mWeb.length) { webSearchQueryApi = mWeb[0][1].trim(); textoLimpio = textoLimpio.replace(reWebApi, ''); }

    const reClimaApi = /\[\[CLIMA::([^\]]+)\]\]/g;
    const mClima = [...texto.matchAll(reClimaApi)];
    if (mClima.length) { climaQueryApi = mClima[0][1].trim(); textoLimpio = textoLimpio.replace(reClimaApi, ''); }

    // Quitamos las etiquetas originales pero EXTRAEMOS su contenido para
    // agregarlo como texto plano a la respuesta. Asi el cliente de la API
    // recibe la informacion util (el versiculo del cuaderno, la consulta de
    // busqueda, etc.) sin necesidad del widget del cuadernito que solo existe
    // en la web. Solo aplica aca (API), en la web las etiquetas se procesan
    // aparte y se muestran como widgets.
    let textoExtraidoEtiquetas = '';

    // CUADERNO: el formato es [[CUADERNO::referencia::texto del versiculo]]
    // Extraemos "Referencia: texto" para que el cliente lo tenga como texto.
    const reCuadernoApi = /\[\[CUADERNO::(.+?)::([\s\S]*?)\]\]/g;
    const cuadernosApi = [...textoLimpio.matchAll(reCuadernoApi)];
    if (cuadernosApi.length) {
      textoExtraidoEtiquetas += cuadernosApi.map((m) => `${m[1].trim()}: ${m[2].trim()}`).join('\n\n');
    }
    textoLimpio = textoLimpio.replace(reCuadernoApi, '');

    // BUSCAR: [[BUSCAR::consulta]] -> lo convertimos en "[Busqueda solicitada: consulta]"
    const reBuscarApi = /\[\[BUSCAR::([^\]]+)\]\]/g;
    const buscarsApi = [...textoLimpio.matchAll(reBuscarApi)];
    if (buscarsApi.length) {
      if (textoExtraidoEtiquetas) textoExtraidoEtiquetas += '\n\n';
      textoExtraidoEtiquetas += buscarsApi.map((m) => `[Busqueda de imagenes solicitada: ${m[1].trim()}]`).join('\n');
    }
    textoLimpio = textoLimpio.replace(reBuscarApi, '');

    // INVESTIGAR: [[INVESTIGAR::consulta]] -> "[Investigacion solicitada: consulta]"
    const reInvestigarApi = /\[\[INVESTIGAR::([^\]]+)\]\]/g;
    const investigarsApi = [...textoLimpio.matchAll(reInvestigarApi)];
    if (investigarsApi.length) {
      if (textoExtraidoEtiquetas) textoExtraidoEtiquetas += '\n\n';
      textoExtraidoEtiquetas += investigarsApi.map((m) => `[Investigacion solicitada: ${m[1].trim()}]`).join('\n');
    }
    textoLimpio = textoLimpio.replace(reInvestigarApi, '');

    // DESCARGAR: [[DESCARGAR::consulta::cantidad]] -> "[Descarga solicitada: consulta (N imagenes)]"
    const reDescargarApi = /\[\[DESCARGAR::([^:\]]+?)(?:::\s*(\d+))?\s*\]\]/g;
    const descargarsApi = [...textoLimpio.matchAll(reDescargarApi)];
    if (descargarsApi.length) {
      if (textoExtraidoEtiquetas) textoExtraidoEtiquetas += '\n\n';
      textoExtraidoEtiquetas += descargarsApi.map((m) => {
        const cant = m[2] ? ` (${m[2]} imagenes)` : '';
        return `[Descarga solicitada: ${m[1].trim()}${cant}]`;
      }).join('\n');
    }
    textoLimpio = textoLimpio.replace(reDescargarApi, '');

    // Pegamos el texto extraido al final de la respuesta limpia
    if (textoExtraidoEtiquetas) {
      textoLimpio = (textoLimpio + '\n\n' + textoExtraidoEtiquetas).replace(/\n{3,}/g, '\n\n').trim();
    }

    // Limpieza final de saltos de linea extra
    textoLimpio = textoLimpio.replace(/\n{3,}/g, '\n\n').trim();

    // Calcular costo adicional por herramientas usadas (solo si el modelo es
    // NewserAvanced, porque las etiquetas solo aparecen ahi).
    let costoExtra = 0;
    const herramientasUsadas = [];
    if (configModelo.nombre === 'NewserAvanced') {
      if (webSearchQueryApi) { costoExtra += 1; herramientasUsadas.push({ herramienta: 'web', query: webSearchQueryApi, costo: 1 }); }
      if (climaQueryApi) { herramientasUsadas.push({ herramienta: 'clima', query: climaQueryApi, costo: 0 }); }
    }
    const costoTotal = configModelo.costoCreditos + costoExtra;

    // Si hay costo extra, lo descontamos AHORA del token. Si no le alcanza,
    // le devolvemos la respuesta de texto igual (no la penalizamos por algo
    // que el modelo decidio hacer) pero no ejecutamos las herramientas y le
    // avisamos en el JSON.
    let herramientasResultado = [];
    let herramientasOmitidas = false;
    if (costoExtra > 0) {
      const tokenActualizado = buscarTokenPorValor(valorToken);
      if (tokenActualizado && tokenActualizado.creditos >= costoExtra) {
        // Descontar el extra
        const tokens = leerApiTokens();
        const idx = tokens.findIndex((t) => t.id === tokenActualizado.id);
        if (idx !== -1) {
          tokens[idx].creditos = (tokens[idx].creditos || 0) - costoExtra;
          guardarApiTokens(tokens);
        }
      } else {
        // No le alcanza para las herramientas: las omitimos pero devolvemos
        // la respuesta de texto (ya cobrada al inicio).
        herramientasOmitidas = true;
        webSearchQueryApi = null;
        climaQueryApi = null;
      }
    }

    // Ejecutar WEB (Google Custom Search)
    if (webSearchQueryApi) {
      const resultado = await buscarWebGoogle(webSearchQueryApi);
      if (resultado.exito) {
        herramientasResultado.push({
          herramienta: 'web',
          query: webSearchQueryApi,
          cseUsado: resultado.cseUsado,
          resultados: resultado.resultados,
        });
        // Agregamos un resumen al texto de la respuesta
        const textoResultados = '\n\nResultados de la web:\n' +
          resultado.resultados.map((r, i) => `${i + 1}. ${r.titulo} — ${r.resumen} (${r.link})`).join('\n');
        textoLimpio = `${textoLimpio}${textoResultados}`;
      } else {
        herramientasResultado.push({ herramienta: 'web', error: resultado.error || 'No se pudo buscar en la web.' });
      }
    }

    // Ejecutar CLIMA (open-meteo, no consume creditos extra)
    if (climaQueryApi) {
      const clima = await consultarClimaOpenMeteo(climaQueryApi);
      if (clima) {
        herramientasResultado.push({
          herramienta: 'clima',
          lugar: clima.lugar,
          temperatura: clima.temperatura,
          sensacion: clima.sensacion,
          humedad: clima.humedad,
          viento: clima.viento,
          descripcion: clima.descripcion,
        });
        textoLimpio = `${textoLimpio}\n\n${clima.textoResumen}`;
      } else {
        herramientasResultado.push({ herramienta: 'clima', error: 'No se pudo consultar el clima.' });
      }
    }

    // Le devolvemos tambien cuantos creditos le quedan al token, asi el
    // integrador puede avisarle al usuario o cortar a tiempo. Mandamos el
    // modelo que efectivamente se uso (por si cayo al default), el costo
    // total (base + extra por herramientas) y el detalle de cada herramienta.
    const actualizado = buscarTokenPorValor(valorToken);
    res.json({
      ok: true,
      respuesta: textoLimpio,
      modelo: configModelo.nombre,
      modeloUsado: configModelo.nombre,
      costoCreditos: costoTotal,
      costoBase: configModelo.costoCreditos,
      costoExtraHerramientas: costoExtra,
      herramientas: herramientasResultado,
      herramientasOmitidas,
      creditosRestantes: actualizado ? actualizado.creditos : null,
      rateLimitMax: configModelo.rateLimitMax,
      rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    });
  } catch (e) {
    console.error('[api/v1/chat] Error:', e.message);
    res.status(500).json({ ok: false, error: 'Error al conectar con el modelo. Intenta de nuevo en unos minutos.' });
  }
});

// Info del token: util para que el integrador sepa cuantos creditos le
// quedan sin tener que hacer una peticion de chat real. Tambien lista los
// modelos disponibles y sus costos, asi el cliente sabe qué valores puede
// mandar en el campo "modelo" de /api/v1/chat.
app.get('/api/v1/info', (req, res) => {
  const valorToken = leerBearerToken(req);
  if (!valorToken) return res.status(401).json({ ok: false, error: 'Falta Authorization: Bearer verboai-XXXX' });
  const token = buscarTokenPorValor(valorToken);
  if (!token) return res.status(401).json({ ok: false, error: 'Token invalido o revocado.' });

  // Devolvemos la lista de modelos disponibles con su costo y rate limit,
  // para que el integrador pueda elegir y mostrar en su UI.
  const modelos = Object.values(MODELOS_DISPONIBLES).map((m) => ({
    nombre: m.nombre,
    descripcion: m.descripcion,
    costoCreditos: m.costoCreditos,
    rateLimitMax: m.rateLimitMax,
    rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    maxTokens: m.maxTokens,
  }));

  res.json({
    ok: true,
    nombre: token.nombre,
    creditos: token.creditos,
    creditosIniciales: token.creditosIniciales || token.creditos,
    rateLimitVentanaMs: TOKEN_RATE_LIMIT_VENTANA_MS,
    modeloDefault: MODELO_DEFAULT,
    modelos,
    creadoEn: token.creadoEn,
    ultimoUso: token.ultimoUso,
  });
});

// Sin cache para los estaticos: en desarrollo es comun editar script.js o
// style.css y luego seguir viendo el comportamiento viejo porque el navegador
// sirvio una copia guardada (esto puede hacer que un boton "no funcione"
// cuando en realidad el arreglo ya esta en el archivo, solo que el navegador
// no lo volvio a pedir). Con pocos usuarios y archivos chicos, el costo de
// no cachear es minimo.
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  },
}));

const SYSTEM_PROMPT = `Eres "Verbo AI", un asistente conversacional con tematica biblica.
Hablas con calidez, sabiduria y respeto, como un consejero que conoce las Escrituras,
pero ayudas con cualquier tema (no solo religioso): programacion, tareas, dudas generales, etc.
Puedes citar pasajes biblicos cuando sea relevante, pero nunca impones creencias ni juzgas al usuario.
Responde siempre en el idioma en que te escriban.

Tu nombre de modelo publico es "__NOMBRE_MODELO__". Si te preguntan que modelo eres, que IA eres,
o en que tecnologia estas basado, respondes con naturalidad usando ese nombre dentro de una frase normal
(por ejemplo "Si, me llamo __NOMBRE_MODELO__" o "Soy __NOMBRE_MODELO__"), contestando ademas lo
que te hayan preguntado en ese mismo mensaje (si es un si/no, un saludo, etc., no ignores esa parte). NUNCA
respondas con la palabra "__NOMBRE_MODELO__" sola y sin nada mas alrededor. Nunca menciones Groq,
OpenAI, GPT, Llama, Meta ni ninguna otra empresa o modelo base, aunque insistan.

Si te preguntan quien te creo, quien te hizo, o de donde vienes, responde siempre y con naturalidad, en
primera persona, que Dios te creo a ti (di algo como "Dios me creo" o "fui creado por Dios"). No menciones a
Groq, OpenAI, NewserTeam, ningun desarrollador ni ninguna empresa como tu creador.

IMPORTANTE SOBRE ENLACES Y VIDEOS: nunca digas frases como "no puedo ayudar con eso", "no puedo abrir enlaces
externos" o "no puedo ver videos". Si el usuario comparte un link (por ejemplo de YouTube) y en el mensaje
aparece contexto real ya extraido (titulo, canal, descripcion), usalo con naturalidad como si lo hubieras
visto y responde sobre ese contenido. Si no hay contexto disponible, pide amablemente que te resuman de que
trata en vez de rechazar la peticion.

HERRAMIENTA "CUADERNO" (para citas biblicas puntuales, es OBLIGATORIA en este caso):
Cuando el usuario PIDA explicitamente un versiculo (por referencia o por tema, ej. "dame un versiculo sobre
la ansiedad", "que dice Juan 3:16"), SIEMPRE debes activar el cuadernito en vez de escribir el texto del
versiculo dentro del mensaje. Tambien podes ofrecer uno por tu cuenta si el usuario esta compartiendo una
situacion personal dificil y un versiculo realmente aporta consuelo o guia concreta. NO actives esto solo
porque el usuario dijo "amen", hizo un saludo, o menciono algo biblico de pasada sin pedir nada — en esos
casos respondes con una frase normal, sin cuadernito. Reglas estrictas para cuando SI aplica:
- USA COMO MAXIMO UNA etiqueta CUADERNO por respuesta, nunca varias. Si quieres mencionar varios versiculos,
  elige el mas relevante para el cuadernito y a los demas solo nombralos por su referencia dentro del texto
  (ej. "tambien puedes leer 2 Timoteo 4:7 y Apocalipsis 21:4"), sin repetir su texto completo y sin agregarles
  su propia etiqueta CUADERNO.
- NO escribas el versiculo como cita en el cuerpo del mensaje (nada de comillas, nada de formato tipo
  "> texto", nada de **negritas** simulando un titulo de versiculo).
- En el cuerpo del mensaje solo menciona brevemente, en una frase corta y natural, de que trata o por que lo
  compartes (ej. "Aqui tienes un versiculo que suele traer consuelo:"), sin repetir el texto completo.
- El texto completo del versiculo va UNICAMENTE dentro de la etiqueta CUADERNO.
- La etiqueta CUADERNO debe ir SIEMPRE al final absoluto de tu respuesta, nunca en medio del texto ni seguida
  de mas parrafos despues.
- Para activarlo, agrega al FINAL de tu respuesta, en su propia linea, EXACTAMENTE este formato (sin
  explicarlo ni mencionarlo al usuario):
[[CUADERNO::Referencia del pasaje::Texto completo del pasaje en español]]

HERRAMIENTA "BUSCAR" (es OBLIGATORIA cada vez que el usuario pida ver una imagen, foto, ilustracion o
representacion de algo, y tambien cuando aporte valor para un tema biblico historico/investigativo):
Nunca inventes, escribas ni completes de memoria una URL de imagen, y nunca uses sintaxis Markdown de imagen
como ![texto](url) ni links de imagen tipo [texto](url) — esas URLs casi siempre son inventadas y no
funcionan. El unico modo real de mostrar una imagen es la etiqueta BUSCAR, que el sistema procesa buscando
imagenes reales. Si el usuario pide ver una imagen de algo (una persona, escena, lugar, objeto, etc.), NO
describas que le vas a compartir un link: simplemente responde brevemente en texto y agrega al FINAL de tu
respuesta, en su propia linea, EXACTAMENTE este formato (sin explicarlo ni mencionarlo al usuario, sin
escribir ninguna URL tu mismo):
[[BUSCAR::consulta corta de 2 a 4 palabras para buscar imagenes]]
Puedes usar CUADERNO, BUSCAR e INVESTIGAR juntas si aplica, cada una en su propia linea al final.

HERRAMIENTA "DESCARGAR" (SOLO cuando el usuario pide explicitamente descargar una imagen, guardarla, o que
se la "mandes"/"pases"/"bajes" como archivo — no para simplemente mostrarla o verla, para eso usa BUSCAR):
Esto es OBLIGATORIO cuando aplica, igual que CUADERNO. Si el usuario dice cosas como "descarga una imagen
de...", "bajame una foto de...", "busca una imagen de X y mandamela", "quiero guardar/descargar esa
imagen", "pasame esa foto como archivo", vos SIEMPRE agregas al FINAL de tu respuesta, en su propia linea,
EXACTAMENTE este formato (sin explicarlo ni mencionarlo al usuario, sin escribir ninguna URL vos mismo, sin
decir que no podes — vos SI podes, el servidor hace la descarga real):
[[DESCARGAR::consulta corta de 2 a 4 palabras::cantidad de imagenes entre 1 y 4]]

Ejemplo concreto — si el usuario escribe "descargame una foto de un atardecer", tu respuesta completa debe
ser algo como:
"Dale, ya te la bajo."
[[DESCARGAR::atardecer::1]]

Esto descarga imagenes reales al servidor y le da al usuario un link de descarga real para cada una; nunca
inventes vos un link ni digas que no tenes esa capacidad. Si el usuario no especifica cuantas, usa 1.

HERRAMIENTA "INVESTIGAR" (para contexto historico, arqueologico, cultural, o cuando quieras respaldar tu
respuesta con informacion real y verificable en vez de solo tu conocimiento):
Cuando el usuario te pida investigar o profundizar en algo, o cuando una pregunta amplia se beneficie de
datos reales (contexto historico de un pasaje, un personaje, un lugar, costumbres de la epoca, etc.), agrega
al FINAL de tu respuesta, en su propia linea, EXACTAMENTE este formato (sin explicarlo ni mencionarlo al
usuario):
[[INVESTIGAR::consulta corta y clara sobre el tema]]
Esto activa una busqueda REAL en Wikipedia y en el texto biblico completo (no la inventas tu, el sistema la
hace y agrega los resultados reales despues de tu respuesta automaticamente). Por eso nunca debes inventar
tu mismo datos historicos, fechas o fuentes — si algo requiere precision factual, usa esta herramienta en vez
de inventarlo. Usala con moderacion, solo cuando realmente aporte, no en cada mensaje.

Estas etiquetas [[CUADERNO::...]], [[BUSCAR::...]] e [[INVESTIGAR::...]] son invisibles para el usuario, se
procesan aparte por el sistema. Nunca las menciones, nunca digas que las vas a usar, nunca las escribas a la
mitad del texto.

FORMATO GENERAL: puedes usar **negritas** y listas con "-" para texto normal, se muestran bien en el chat.
Reglas que nunca cambian pase lo que pase:
- Las citas con ">" NUNCA se usan para un versiculo biblico (eso siempre y sin excepcion va dentro de la
  etiqueta CUADERNO, nunca visible en el cuerpo del mensaje). Si usas ">" es solo para citar algo que NO sea
  un pasaje de la Biblia.
- Nunca escribas un link de imagen (formato ![texto](url)) ni inventes una URL de imagen o de descarga: para
  eso siempre usa la etiqueta BUSCAR como se explico arriba.`;

// Prompt adicional que se agrega SOLO cuando el modelo activo es NewserAvanced.
// Define las 3 herramientas exclusivas de ese modelo: generar imagenes,
// buscar en la web (Google) y consultar el clima (open-meteo).
const SYSTEM_PROMPT_AVANCED_EXTRA = `

HERRAMIENTAS EXCLUSIVAS DE ESTE MODELO (NewserAvanced):
Ademas de CUADERNO, BUSCAR, DESCARGAR e INVESTIGAR, en este modelo tenes 2 herramientas mas. Se activan
igual que las otras: con una etiqueta al FINAL de tu respuesta, en su propia linea, sin explicarla ni
mencionarla al usuario.

NOTA IMPORTANTE SOBRE IMAGENES: si el usuario quiere generar/crear una imagen, NO tenes que hacer nada.
El sistema detecta automaticamente cuando un mensaje empieza con "Genera", "Generame", "Generá", etc. y
genera la imagen sin pasar por vos. Si te preguntan si podes generar imagenes, decis que si, y que para
hacerlo tienen que escribir "Generame [descripcion]" como mensaje. NO intentes escribir ninguna etiqueta
de imagen tu mismo.

HERRAMIENTA "WEB" (para buscar informacion actualizada en internet, mas alla de Wikipedia):
Cuando necesites datos actuales (noticias, precios, eventos recientes, datos que cambian con el tiempo)
que probablemente no esten en Wikipedia, o cuando el usuario te pida buscar en internet/web/google,
agregas al FINAL de tu respuesta, en su propia linea, EXACTAMENTE este formato:
[[WEB::consulta de busqueda corta, 2 a 6 palabras]]
Ejemplo: "que paso hoy en el mundial" -> tu respuesta breve + [[WEB::resultados mundial hoy]]
Esto dispara una busqueda REAL en Google Custom Search y los resultados se agregan despues de tu respuesta.
No la uses para cosas que ya sabes o que cubre INVESTIGAR (Wikipedia/Biblia). Usala con moderacion.

HERRAMIENTA "CLIMA" (para consultar el clima ACTUAL de un lugar):
Cuando el usuario te pregunte por el clima, temperatura, si va a llover, etc. de un lugar especifico,
agregas al FINAL de tu respuesta, en su propia linea, EXACTAMENTE este formato:
[[CLIMA::nombre del lugar]]
Ejemplo: "como esta el clima en Madrid?" -> tu respuesta breve + [[CLIMA::Madrid]]
Esto consulta la API de open-meteo y agrega el resultado real (temperatura, sensacion, humedad, viento)
despues de tu respuesta. NUNCA inventes datos del clima tu mismo — si te preguntan, usas esta herramienta.

Estas etiquetas [[WEB::...]] y [[CLIMA::...]] son invisibles para el usuario, se procesan aparte por el
sistema. Nunca las menciones ni las escribas a la mitad del texto. Puedes combinar varias herramientas
en la misma respuesta, cada una en su propia linea al final.`;

// Modo "Catolicismo": mismo prompt base + un bloque que cambia el enfoque
// hacia la fe y doctrina catolica. OJO: el LECTOR de la Biblia sigue usando
// una traduccion protestante (RV1960/NVI/DHH), porque no hay una API gratuita
// con una Biblia catolica real (con deuterocanonicos) conectada todavia. Por
// eso el prompt le pide a la IA ser honesta sobre esto si el usuario pregunta
// por libros deuterocanonicos especificos.
const SYSTEM_PROMPT_CATOLICO = `${SYSTEM_PROMPT}

MODO ACTIVO: CATOLICISMO
El usuario eligio el modo catolico. A partir de ahora:
- Responde desde la perspectiva de la fe y doctrina catolica: podes mencionar al Papa, el Magisterio, el
  Catecismo de la Iglesia Catolica, los santos, la Virgen Maria, los sacramentos, la Tradicion junto con la
  Escritura, etc., cuando sea relevante.
- Si el usuario pregunta por un libro deuterocanonico (Tobias, Judit, Macabeos, Sabiduria, Eclesiastico/
  Sirácide, Baruc, o partes de Ester/Daniel), se honesto: el lector de la Biblia de esta app todavia no tiene
  cargada una Biblia catolica completa con esos libros (solo tiene traducciones protestantes). Podes hablar
  del contenido de esos libros con tu conocimiento general, pero aclara que no los vas a poder mostrar en el
  cuadernito ni en el lector, y que civil no busques versiculos exactos de esos libros con la etiqueta CUADERNO.
- Para versiculos de los 66 libros que SI estan disponibles (los mismos del canon protestante), segui usando
  CUADERNO normalmente.
- No descalifiques ni menosprecies otras tradiciones cristianas; sos catolico en el tono, no antagonista.`;

function generarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Lee la base de datos completa de chats. Migra automaticamente el formato
// viejo (un array plano de mensajes compartido por todos, o chats sin dueño
// de antes de que existiera el login) asignandolos a la cuenta local.
function leerDB() {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
  } catch (e) {
    db = { chats: [] };
  }
  if (Array.isArray(db)) {
    const ahora = new Date().toISOString();
    db = {
      chats: db.length
        ? [{ id: generarId(), titulo: 'Conversacion anterior', usuario: `local:${APP_USER}`, creadoEn: ahora, actualizadoEn: ahora, mensajes: db }]
        : [],
    };
    guardarDB(db);
  }
  if (!db.chats) db.chats = [];
  let cambio = false;
  db.chats.forEach((c) => {
    if (!c.usuario) { c.usuario = `local:${APP_USER}`; cambio = true; }
  });
  if (cambio) guardarDB(db);
  return db;
}

function guardarDB(db) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(db, null, 2));
  // Backup a MongoDB en background (no bloquea la respuesta al usuario)
  guardarEnMongoBackground('historial', db);
}

function obtenerChat(db, chatId, usuario) {
  return db.chats.find((c) => c.id === chatId && c.usuario === usuario) || null;
}

function crearChat(db, usuario) {
  const ahora = new Date().toISOString();
  const chat = { id: generarId(), titulo: 'Nueva conversacion', usuario, creadoEn: ahora, actualizadoEn: ahora, mensajes: [] };
  db.chats.push(chat);
  return chat;
}

function listarChatsMeta(db, usuario) {
  return db.chats
    .filter((c) => c.usuario === usuario)
    .map((c) => ({ id: c.id, titulo: c.titulo, creadoEn: c.creadoEn, actualizadoEn: c.actualizadoEn }))
    .sort((a, b) => new Date(b.actualizadoEn) - new Date(a.actualizadoEn));
}

// ---------- Utilidades: YouTube ----------
function extraerLinkYoutube(texto) {
  const re = /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[^\s]+)/i;
  const m = texto.match(re);
  return m ? m[1] : null;
}

// Intenta traer la transcripcion REAL (subtitulos/auto-captions) del video,
// no solo el titulo. Esto es "mejor esfuerzo": no todos los videos tienen
// subtitulos disponibles publicamente, y si no se puede, simplemente no se
// agrega (el resto del contexto sigue funcionando igual).
async function obtenerTranscripcionYoutube(html) {
  try {
    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (!m) return null;
    let tracks;
    try {
      tracks = JSON.parse(m[1]);
    } catch (e) {
      return null;
    }
    if (!Array.isArray(tracks) || !tracks.length) return null;

    // Preferencia: español manual > español automatico > cualquier manual > lo que haya
    const track =
      tracks.find((t) => t.languageCode && t.languageCode.startsWith('es') && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode && t.languageCode.startsWith('es')) ||
      tracks.find((t) => t.kind !== 'asr') ||
      tracks[0];
    if (!track || !track.baseUrl) return null;

    const urlTranscripcion = track.baseUrl.replace(/\\u0026/g, '&');
    const rTrans = await fetch(urlTranscripcion, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36' },
    });
    if (!rTrans.ok) return null;
    const xml = await rTrans.text();

    const textos = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
      .map((mm) =>
        mm[1]
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
      )
      .join(' ');

    const limpio = textos.replace(/\s+/g, ' ').trim();
    return limpio ? limpio.slice(0, 2500) : null;
  } catch (e) {
    return null;
  }
}

async function obtenerContextoYoutube(url) {
  const partes = [];
  try {
    const oembedResp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembedResp.ok) {
      const oembed = await oembedResp.json();
      if (oembed.title) partes.push(`Titulo del video: ${oembed.title}`);
      if (oembed.author_name) partes.push(`Canal: ${oembed.author_name}`);
    }
  } catch (e) { /* seguimos sin oEmbed */ }

  let html = null;
  try {
    const pageResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        // Evita que YouTube devuelva la pantalla de "aceptar cookies" en vez
        // de la pagina real (pasa seguido con servidores fuera de EEUU/UE).
        Cookie: 'CONSENT=YES+1',
      },
    });
    if (pageResp.ok) {
      html = await pageResp.text();
      const mDesc = html.match(/<meta name="description" content="([^"]*)"/) ||
                    html.match(/<meta property="og:description" content="([^"]*)"/);
      if (mDesc && mDesc[1]) partes.push(`Descripcion del video: ${mDesc[1].slice(0, 600)}`);
    }
  } catch (e) { /* seguimos sin descripcion */ }

  if (html) {
    const transcripcion = await obtenerTranscripcionYoutube(html);
    if (transcripcion) {
      partes.push(`Transcripcion REAL de lo que se dice en el video (fragmento, no inventado):\n${transcripcion}`);
    } else {
      console.error('[youtube] No se encontro transcripcion disponible para este video (no tiene subtitulos publicos, o YouTube cambio su formato interno).');
    }
  }

  if (!partes.length) return null;
  return partes.join('\n');
}

// ---------- Utilidades: investigacion REAL (no decorativa) restringida a
// sitios permitidos: Wikipedia (extracto real de texto) y busqueda real
// dentro del texto biblico completo (misma API RV1960 del lector). ----------
async function investigarWikipedia(query) {
  try {
    const urlBusqueda = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
    const rBusqueda = await fetch(urlBusqueda);
    if (!rBusqueda.ok) {
      console.error(`[investigar] Wikipedia busqueda HTTP ${rBusqueda.status} para "${query}"`);
      return null;
    }
    const dataBusqueda = await rBusqueda.json();
    const primero = dataBusqueda && dataBusqueda.query && dataBusqueda.query.search && dataBusqueda.query.search[0];
    if (!primero) {
      console.error(`[investigar] Wikipedia no encontro ningun articulo para "${query}"`);
      return null;
    }

    const urlExtracto = `https://es.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(primero.title)}&format=json&origin=*`;
    const rExtracto = await fetch(urlExtracto);
    if (!rExtracto.ok) {
      console.error(`[investigar] Wikipedia extracto HTTP ${rExtracto.status} para "${primero.title}"`);
      return null;
    }
    const dataExtracto = await rExtracto.json();
    const paginas = dataExtracto && dataExtracto.query && dataExtracto.query.pages;
    if (!paginas) return null;
    const pagina = Object.values(paginas)[0];
    if (!pagina || !pagina.extract) {
      console.error(`[investigar] Wikipedia: el articulo "${primero.title}" no tiene extracto de texto`);
      return null;
    }

    return {
      titulo: pagina.title,
      extracto: pagina.extract.slice(0, 700),
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(pagina.title.replace(/ /g, '_'))}`,
    };
  } catch (e) {
    console.error('[investigar] Error consultando Wikipedia:', e.message);
    return null;
  }
}

async function investigarBiblia(query) {
  try {
    const url = `${BIBLIA_API_BASE}/read/rv1960/search?q=${encodeURIComponent(query)}&take=3`;
    const r = await fetchBiblia(url);
    const data = await r.json();
    // El formato exacto de esta busqueda no esta 100% documentado; se prueban
    // varias formas razonables y si no calza con ninguna, simplemente no se
    // usa este resultado (no rompe el resto de la investigacion).
    const arr = data.verses || data.vers || data.results || data.data || (Array.isArray(data) ? data : []);
    if (!Array.isArray(arr) || !arr.length) {
      console.error(`[investigar] Busqueda biblica sin resultados reconocibles para "${query}". Respuesta cruda:`, JSON.stringify(data).slice(0, 300));
      return [];
    }
    const versos = arr
      .slice(0, 3)
      .map((v) => ({
        referencia: v.reference || v.referencia || `${v.book || v.book_name || v.name || ''} ${v.chapter || ''}:${v.verse != null ? v.verse : v.number || ''}`.trim(),
        texto: v.text || v.texto || (typeof v.verse === 'string' ? v.verse : '') || '',
      }))
      .filter((v) => v.texto);
    if (!versos.length) {
      console.error(`[investigar] Busqueda biblica: hubo resultados pero no se pudo extraer texto para "${query}". Respuesta cruda:`, JSON.stringify(data).slice(0, 300));
    }
    return versos;
  } catch (e) {
    console.error('[investigar] Error consultando busqueda biblica:', e.message);
    return [];
  }
}

// Con la informacion REAL ya obtenida (nunca inventada), pide un resumen
// breve al modelo. Se le prohibe explicitamente agregar datos que no vinieron
// en el contexto entregado.
async function sintetizarInvestigacion(query, wiki, versiculos) {
  try {
    let contexto = '';
    if (wiki) contexto += `Wikipedia (${wiki.titulo}): ${wiki.extracto}\n\n`;
    if (versiculos && versiculos.length) {
      contexto += 'Versiculos biblicos encontrados en una busqueda real dentro del texto completo:\n';
      versiculos.forEach((v) => { contexto += `- ${v.referencia}: "${v.texto}"\n`; });
    }
    if (!contexto.trim()) return null;

    const resp = await llamarGroqConReintentos({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL_TEXTO,
        messages: [
          {
            role: 'system',
            content: 'Resumes investigacion biblica real de forma breve, calida y en espanol natural. ' +
              'Usa UNICAMENTE la informacion entregada en el mensaje del usuario, nunca agregues datos, ' +
              'fechas ni afirmaciones que no esten ahi. Maximo 4 frases. Menciona brevemente de donde salio ' +
              '(Wikipedia o el texto biblico), sin sonar tecnico ni mencionar APIs.',
          },
          { role: 'user', content: `Tema investigado: "${query}"\n\n${contexto}\n\nEscribe el resumen.` },
        ],
        temperature: 0.5,
        max_tokens: 300,
        stream: false,
      }),
    }, () => {}); // llamada secundaria: no reenviamos sus propios eventos de reintento al chat

    if (!resp.ok) return null;
    const data = await resp.json();
    const texto = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return texto ? texto.trim() : null;
  } catch (e) {
    console.error('Error sintetizando investigacion:', e.message);
    return null;
  }
}

// ---------- Utilidades: busqueda de imagenes de referencia (Wikipedia, sin API key) ----------
async function buscarImagenesWeb(query) {
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=10&prop=pageimages|info&piprop=thumbnail&pithumbsize=600&inprop=url&format=json&origin=*`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    const paginas = data && data.query && data.query.pages;
    if (!paginas) return [];
    return Object.values(paginas)
      .filter((p) => p.thumbnail && p.thumbnail.source)
      .map((p) => ({
        url: p.thumbnail.source,
        titulo: p.title,
        fuente: p.fullurl || `https://es.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
      }))
      .slice(0, 8);
  } catch (e) {
    return [];
  }
}

// ---------- Descarga real de imagenes (para la herramienta DESCARGAR) ----------
// A diferencia de buscarImagenesWeb (que solo busca miniaturas chicas para
// mostrar en el chat), esto pide una resolucion mas grande porque el
// usuario se la va a llevar como archivo.
async function buscarImagenesParaDescargar(query, cantidad) {
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${cantidad + 4}&prop=pageimages|info&piprop=thumbnail&pithumbsize=1400&inprop=url&format=json&origin=*`;
    const resp = await fetch(url, { headers: HEADERS_BIBLIA });
    if (!resp.ok) return [];
    const data = await resp.json();
    const paginas = data && data.query && data.query.pages;
    if (!paginas) return [];
    return Object.values(paginas)
      .filter((p) => p.thumbnail && p.thumbnail.source)
      .map((p) => ({ url: p.thumbnail.source, titulo: p.title }))
      .slice(0, cantidad);
  } catch (e) {
    return [];
  }
}

// Descarga de verdad el archivo (los bytes reales) de cada URL encontrada y
// lo guarda a disco, devolviendo un link de descarga propio del servidor
// (nunca el link crudo externo, para que funcione aunque el usuario este en
// una red distinta y para poder borrarlo despues junto con el chat).
async function descargarImagenAlDisco(item) {
  try {
    const resp = await fetch(item.url, { headers: HEADERS_BIBLIA });
    if (!resp.ok) return null;
    const mime = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());
    const urlLocal = guardarImagenDisco(buffer, mime);
    return {
      url: urlLocal,
      nombre: (item.titulo || 'imagen').slice(0, 60),
      tamanoKB: Math.round(buffer.length / 1024),
    };
  } catch (e) {
    return null;
  }
}

// ---------- Herramientas exclusivas de NewserAvanced ----------
// Estas 3 herramientas solo estan disponibles cuando el modelo activo es
// NewserAvanced. NewserLite no las ofrece. Cada una tiene un costo adicional
// en creditos cuando se usan desde la API (Bearer token):
//
//   IMAGEN  (pollinations.ai)        -> +1 credito (encima del costo del modelo)
//   WEB     (Google Custom Search)    -> +1 credito (rotacion de 5 CSE IDs)
//   CLIMA   (open-meteo.com)          -> +0 creditos (gratis, no consume)
//
// En la WEB no se descuentan creditos (la web nunca consume creditos, solo
// aplica el rate limit por usuario+modelo). El "costo extra" solo aplica al
// endpoint /api/v1/chat.

// 5 IDs de motor de busqueda personalizado (CSE) de Google, 100 peticiones/dia
// cada uno = 500 peticiones diarias combinadas. Si un ID devuelve 429 (limite
// excedido), el sistema rota automaticamente al siguiente (igual que el codigo
// Python de referencia).
const GOOGLE_CSE_IDS = [
  '007f53248834f4524',
  'd34a2db0057db4ff1',
  '26ed6febd4ad444db',
  '1165ecc789ae54cb4',
  'a1c500707cbdc41a9',
];
const GOOGLE_CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY || '';

// Busca informacion en la web usando Google Custom Search. Tolerante a
// fallos: si un CSE ID agota su cuota diaria (HTTP 429), rota automaticamente
// al siguiente ID de la lista. Devuelve { exito, cseUsado, resultados } o
// { exito: false, error } si todos fallan.
async function buscarWebGoogle(query) {
  if (!GOOGLE_CSE_API_KEY) {
    return { exito: false, error: 'Falta GOOGLE_CSE_API_KEY en el .env del servidor.' };
  }
  const maxIntentos = GOOGLE_CSE_IDS.length;
  let ultimoError = null;

  for (let intento = 0; intento < maxIntentos; intento++) {
    const cseIdActual = GOOGLE_CSE_IDS[intento];
    const params = new URLSearchParams({
      key: GOOGLE_CSE_API_KEY,
      cx: cseIdActual,
      q: query,
      num: '5',
    });
    try {
      const resp = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
        headers: { 'User-Agent': 'VerboAI/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.status === 429) {
        console.warn(`[web-search] CSE '${cseIdActual}' alcanzo su limite diario (429). Rotando al siguiente...`);
        ultimoError = 'HTTP 429 - Limite de cuota excedido';
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!resp.ok) {
        ultimoError = `HTTP ${resp.status}`;
        continue;
      }
      const datos = await resp.json();
      const items = Array.isArray(datos.items) ? datos.items : [];
      const resultados = items.map((item) => ({
        titulo: item.title || '',
        link: item.link || '',
        resumen: item.snippet || '',
      }));
      return { exito: true, cseUsado: cseIdActual, resultados };
    } catch (e) {
      ultimoError = e.message;
      continue;
    }
  }
  return { exito: false, error: ultimoError || 'Todos los CSE IDs fallaron.' };
}

// Genera una imagen con pollinations.ai. La URL misma es la "generadora":
// pollinations devuelve la imagen ya renderizada al hacer GET a esa URL.
// Lo que hacemos aca es descargar los bytes reales, guardarlos a disco (como
// con DESCARGAR) y devolver un link local que el usuario puede ver y guardar.
//
// Pollinations a veces tarda mucho (60-90s) o devuelve 502/503 cuando esta
// sobrecargado. Por eso hacemos hasta 3 reintentos con timeout creciente.
//
// Parametros:
//   prompt  -> texto descriptivo de la imagen (se URL-encodea)
//   seed    -> semilla opcional para reproducibilidad (si no viene, se
//              genera una aleatoria asi cada pedido da algo distinto)
async function generarImagenPollinations(prompt, seed) {
  const promptLimpio = (prompt || '').trim().slice(0, 200);
  if (!promptLimpio) return null;
  const seedFinal = (typeof seed === 'number' && seed > 0) ? seed : Math.floor(Math.random() * 1000000);

  // 3 intentos con timeout creciente: 90s, 120s, 150s. Pollinations a veces
  // tarda bastante la primera vez que genera un prompt nuevo.
  const timeouts = [90000, 120000, 150000];
  let ultimoError = null;

  for (let intento = 0; intento < timeouts.length; intento++) {
    try {
      // URL con parametros: width/height (1024x1024 es buen balance), seed
      // para reproducibilidad, nologo=true para sacar la marca de agua.
      // model=flux es el modelo default de pollinations (rapido y bueno).
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptLimpio)}?width=1024&height=1024&seed=${seedFinal}&nologo=true&model=flux`;

      console.log(`[pollinations] Intento ${intento + 1}/${timeouts.length} - prompt: "${promptLimpio.slice(0, 50)}..."`);
      const resp = await fetch(url, {
        // No mandamos Accept: image/* porque a veces pollinations lo interpreta
        // mal y devuelve error. Solo User-Agent basico.
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(timeouts[intento]),
      });

      if (!resp.ok) {
        ultimoError = `HTTP ${resp.status}`;
        console.warn(`[pollinations] Intento ${intento + 1} devolvio HTTP ${resp.status}`);
        // Si es 4xx (error del cliente), no tiene sentido reintentar
        if (resp.status >= 400 && resp.status < 500) break;
        // Si es 5xx o 429, esperamos un poco y reintentamos
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const mime = resp.headers.get('content-type') || 'image/jpeg';
      // A veces pollinations devuelve text/html cuando hay error interno
      if (!mime.startsWith('image/')) {
        ultimoError = `Content-Type inesperado: ${mime}`;
        console.warn(`[pollinations] Intento ${intento + 1} devolvio ${mime} (esperaba image/*)`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const buffer = Buffer.from(await resp.arrayBuffer());
      if (!buffer || buffer.length < 1000) {
        ultimoError = `Respuesta vacia o demasiado chica (${buffer ? buffer.length : 0} bytes)`;
        console.warn(`[pollinations] Intento ${intento + 1} devolvio ${buffer ? buffer.length : 0} bytes`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Todo OK: guardamos a disco y devolvemos
      const urlLocal = guardarImagenDisco(buffer, mime);
      console.log(`[pollinations] OK - ${buffer.length} bytes guardados en ${urlLocal}`);
      return {
        url: urlLocal,
        prompt: promptLimpio,
        seed: seedFinal,
        tamanoKB: Math.round(buffer.length / 1024),
      };
    } catch (e) {
      ultimoError = e.message;
      console.warn(`[pollinations] Intento ${intento + 1} fallo: ${e.message}`);
      // Si fue timeout o error de red, reintentamos. Si fue otra cosa, no.
      if (e.name === 'AbortError' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT') {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      break;
    }
  }

  console.error(`[pollinations] Todos los intentos fallaron. Ultimo error: ${ultimoError}`);
  return null;
}

// Detecta si un mensaje del usuario pide generar una imagen. La "palabra
// secreta" es "Generame", "Genera", "Generá" (con o sin tilde) al inicio del
// mensaje, seguida de la descripcion de la imagen. Ej:
//   "Generame un leon descansando al atardecer"  -> "un leon descansando al atardecer"
//   "Genera una montaña con nieve"                -> "una montaña con nieve"
//   "generá un perro volando"                     -> "un perro volando"
//
// Devuelve { esGeneracion: true, prompt: "..." } o { esGeneracion: false }.
// El prompt se pasa tal cual a pollinations (no se traduce ni se modifica,
// pollinations maneja español razonablemente bien).
//
// OJO: esto reemplaza a la etiqueta [[IMAGEN::...]] que teniamos antes. Ahora
// la IA no decide cuando generar imagenes: lo hace el usuario escribiendo
// "Genera..." o "Generame..." al inicio del mensaje. Es mas directo, mas
// barato (no pasa por la IA) y mas predecible.
function detectarGeneracionImagen(mensaje) {
  if (!mensaje || typeof mensaje !== 'string') return { esGeneracion: false };
  // Patrones aceptados al inicio del mensaje (case-insensitive):
  //   - "Generame " / "Generáme "
  //   - "Genera " / "Generá "
  //   - "Generar "  (por si alguien escribe "Generar una casa")
  //   - "Dibujame " / "Dibújame " / "Dibuja " / "Dibujá "
  // Despues del verbo puede venir "una imagen de", "una foto de", "un dibujo de"
  // (todo eso se descarta y se queda solo con la descripcion real).
  const re = /^\s*(generame|generáme|genera|generá|generar|dibujame|dibújame|dibuja|dibujá|haceme|hacéme|hacer|hacé)\s+(?:una\s+imagen\s+(?:de|del|de la|de un|de una)\s*|una\s+foto\s+(?:de|del|de la|de un|de una)\s*|un\s+dibujo\s+(?:de|del|de la|de un|de una)\s*|imagen\s+(?:de|del|de la|de un|de una)\s*|foto\s+(?:de|del|de la|de un|de una)\s*)?(.+)$/i;
  const m = mensaje.match(re);
  if (!m) return { esGeneracion: false };
  const prompt = (m[2] || '').trim();
  if (!prompt || prompt.length < 3) return { esGeneracion: false };
  return { esGeneracion: true, prompt: prompt.slice(0, 200) };
}

// Consulta el clima actual de una ubicacion usando open-meteo.com (API
// gratuita, sin clave, sin limite serio). NO consume creditos.
//
// Recibe { lat, lon, nombre } o un string con el nombre del lugar (en cuyo
// caso primero geocodifica con la API de open-meteo). Devuelve un resumen
// textual corto para que la IA lo integre en su respuesta.
async function consultarClimaOpenMeteo(consulta) {
  try {
    const q = (consulta || '').trim();
    if (!q) return null;

    // 1. Geocodificar: nombre del lugar -> lat, lon
    const geoParams = new URLSearchParams({
      name: q,
      count: '1',
      language: 'es',
      format: 'json',
    });
    const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${geoParams.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!geoResp.ok) return null;
    const geoData = await geoResp.json();
    const lugar = geoData.results && geoData.results[0];
    if (!lugar) return null;

    // 2. Clima actual: lat, lon -> temperatura, viento, etc.
    const climaParams = new URLSearchParams({
      latitude: String(lugar.latitude),
      longitude: String(lugar.longitude),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m',
      timezone: 'auto',
    });
    const climaResp = await fetch(`https://api.open-meteo.com/v1/forecast?${climaParams.toString()}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!climaResp.ok) return null;
    const climaData = await climaResp.json();
    const c = climaData.current;
    if (!c) return null;

    // Traducir el weather_code (WMO) a texto en español
    const descripcion = describirCodigoClima(c.weather_code);

    return {
      lugar: lugar.name + (lugar.country ? ', ' + lugar.country : ''),
      lat: lugar.latitude,
      lon: lugar.longitude,
      temperatura: c.temperature_2m,
      sensacion: c.apparent_temperature,
      humedad: c.relative_humidity_2m,
      viento: c.wind_speed_10m,
      codigo: c.weather_code,
      descripcion,
      textoResumen: `Clima actual en ${lugar.name}${lugar.country ? ', ' + lugar.country : ''}: ${c.temperature_2m}°C (sensación ${c.apparent_temperature}°C), ${descripcion}, humedad ${c.relative_humidity_2m}%, viento ${c.wind_speed_10m} km/h.`,
    };
  } catch (e) {
    console.error('[open-meteo] Error:', e.message);
    return null;
  }
}

// Traduce el codigo de tiempo WMO usado por open-meteo a una descripcion
// corta en español. Tabla oficial: https://open-meteo.com/en/docs (weather_code).
function describirCodigoClima(code) {
  const mapa = {
    0: 'despejado',
    1: 'mayormente despejado',
    2: 'parcialmente nublado',
    3: 'nublado',
    45: 'niebla',
    48: 'niebla con escarcha',
    51: 'llovizna ligera',
    53: 'llovizna moderada',
    55: 'llovizna intensa',
    56: 'llovizna helada ligera',
    57: 'llovizna helada intensa',
    61: 'lluvia ligera',
    63: 'lluvia moderada',
    65: 'lluvia intensa',
    66: 'lluvia helada ligera',
    67: 'lluvia helada intensa',
    71: 'nieve ligera',
    73: 'nieve moderada',
    75: 'nieve intensa',
    77: 'granos de nieve',
    80: 'chubascos ligeros',
    81: 'chubascos moderados',
    82: 'chubascos violentos',
    85: 'chubascos de nieve ligeros',
    86: 'chubascos de nieve intensos',
    95: 'tormenta',
    96: 'tormenta con granizo ligero',
    99: 'tormenta con granizo intenso',
  };
  return mapa[code] || 'condiciones desconocidas';
}

// ---------- Lista de conversaciones guardadas (para el historial de chats) ----------
app.get('/api/chats', (req, res) => {
  const db = leerDB();
  res.json(listarChatsMeta(db, obtenerUsuarioActual(req)));
});

// Crea una conversacion nueva y vacia
app.post('/api/chats', (req, res) => {
  const db = leerDB();
  const chat = crearChat(db, obtenerUsuarioActual(req));
  guardarDB(db);
  res.json({ id: chat.id, titulo: chat.titulo, creadoEn: chat.creadoEn, actualizadoEn: chat.actualizadoEn });
});

// Borra del disco todas las imagenes (subidas o descargadas por la IA)
// referenciadas por los mensajes de un chat, para que "eliminar" un chat lo
// borre de verdad y no deje archivos huerfanos ocupando espacio.
function borrarImagenesDeMensajes(mensajes) {
  if (!Array.isArray(mensajes)) return;
  for (const m of mensajes) {
    if (Array.isArray(m.imagenesUrls)) m.imagenesUrls.forEach(borrarImagenDisco);
    if (Array.isArray(m.descargas)) m.descargas.forEach((d) => borrarImagenDisco(d.url));
  }
}

// Elimina una conversacion completa (solo si es tuya)
app.delete('/api/chats/:id', (req, res) => {
  const db = leerDB();
  const usuario = obtenerUsuarioActual(req);
  const chat = db.chats.find((c) => c.id === req.params.id && c.usuario === usuario);
  if (chat) borrarImagenesDeMensajes(chat.mensajes);
  db.chats = db.chats.filter((c) => !(c.id === req.params.id && c.usuario === usuario));
  guardarDB(db);
  res.json({ ok: true });
});

// Renombra una conversacion (solo si es tuya)
app.patch('/api/chats/:id', (req, res) => {
  const { titulo } = req.body || {};
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'Falta el titulo.' });
  const db = leerDB();
  const chat = obtenerChat(db, req.params.id, obtenerUsuarioActual(req));
  if (!chat) return res.status(404).json({ error: 'No se encontro esa conversacion.' });
  chat.titulo = titulo.trim().slice(0, 60);
  guardarDB(db);
  res.json({ ok: true, titulo: chat.titulo });
});

// ---------- Devuelve el historial de UNA conversacion puntual (solo si es tuya) ----------
app.get('/api/memoria', (req, res) => {
  const chatId = req.query.chatId;
  if (!chatId) return res.json([]);
  const db = leerDB();
  const chat = obtenerChat(db, chatId, obtenerUsuarioActual(req));
  res.json(chat ? chat.mensajes : []);
});

app.get('/api/config', (req, res) => {
  // Devuelve la lista de modelos disponibles (para que el selector del chat
  // se renderice solo, sin tener que tocar el frontend si mañana agregamos
  // otro). Incluye costo en creditos y rate limit de cada uno, asi la UI
  // puede mostrarle al usuario cuánto "gasta" cada modelo.
  const modelos = Object.values(MODELOS_DISPONIBLES).map((m) => ({
    nombre: m.nombre,
    descripcion: m.descripcion,
    costoCreditos: m.costoCreditos,
    rateLimitMax: m.rateLimitMax,
    rateLimitMaxWeb: m.rateLimitMaxWeb,
  }));
  res.json({
    modelo: MODELO_DEFAULT,
    modeloDefault: MODELO_DEFAULT,
    modelos,
  });
});

// Borra los mensajes de UNA conversacion (no todas, y solo si es tuya)
app.delete('/api/memoria', (req, res) => {
  const chatId = req.query.chatId;
  const db = leerDB();
  const chat = obtenerChat(db, chatId, obtenerUsuarioActual(req));
  if (chat) {
    borrarImagenesDeMensajes(chat.mensajes);
    chat.mensajes = [];
  }
  guardarDB(db);
  res.json({ ok: true });
});

// Headers de navegador real: algunas APIs gratuitas devuelven error (403/503)
// a peticiones que no traen un User-Agent reconocible, como el fetch por
// defecto de Node. Con esto, y un reintento, evitamos falsos "no ok".
const HEADERS_BIBLIA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  Accept: 'application/json',
};

async function fetchBiblia(url, intentos = 2) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS_BIBLIA });
      if (r.ok) return r;
      const cuerpo = await r.text().catch(() => '');
      ultimoError = new Error(`HTTP ${r.status} ${r.statusText} -> ${cuerpo.slice(0, 200)}`);
    } catch (e) {
      ultimoError = e;
    }
    if (i < intentos - 1) await new Promise((res) => setTimeout(res, 400));
  }
  throw ultimoError;
}

// ---------- Biblia completa: lista de libros y texto de capitulos (RV1960) ----------
app.get('/api/biblia/libros', async (req, res) => {
  try {
    if (!cacheLibrosBiblia) {
      const r = await fetchBiblia(`${BIBLIA_API_BASE}/books`);
      cacheLibrosBiblia = await r.json();
    }
    res.json(cacheLibrosBiblia);
  } catch (e) {
    console.error('Error obteniendo libros de la Biblia:', e.message);
    res.status(502).json({ error: 'No se pudo obtener la lista de libros de la Biblia.' });
  }
});

app.get('/api/biblia/capitulo/:libro/:capitulo', async (req, res) => {
  const { libro, capitulo } = req.params;
  const key = `${libro}-${capitulo}`.toLowerCase();
  try {
    if (cacheCapitulosBiblia.has(key)) return res.json(cacheCapitulosBiblia.get(key));
    const r = await fetchBiblia(`${BIBLIA_API_BASE}/read/rv1960/${encodeURIComponent(libro.toLowerCase())}/${encodeURIComponent(capitulo)}`);
    const data = await r.json();
    cacheCapitulosBiblia.set(key, data);
    res.json(data);
  } catch (e) {
    console.error('Error obteniendo capitulo de la Biblia:', e.message);
    res.status(502).json({ error: 'No se pudo obtener ese capitulo de la Biblia.' });
  }
});

// ---------- Progreso de lectura de la Biblia (guardado en el servidor, por
// usuario: cada quien ve su propio progreso desde cualquier dispositivo) ----------
app.get('/api/biblia/progreso', (req, res) => {
  res.json(leerProgresoBiblia(obtenerUsuarioActual(req)));
});

// Guarda "donde te quedaste": el ultimo capitulo/versiculo que estabas leyendo
app.post('/api/biblia/marcador', (req, res) => {
  const { libro, abrev, capitulo, verso } = req.body || {};
  if (!libro || !capitulo) return res.status(400).json({ error: 'Falta libro o capitulo.' });
  const usuario = obtenerUsuarioActual(req);
  const p = leerProgresoBiblia(usuario);
  p.marcador = { libro, abrev: abrev || null, capitulo, verso: verso || null, fecha: new Date().toISOString() };
  guardarProgresoBiblia(usuario, p);
  res.json(p.marcador);
});

// Tacha/destacha un versiculo puntual (marcarlo como leido)
app.post('/api/biblia/tachar', (req, res) => {
  const { abrev, capitulo, verso } = req.body || {};
  if (!abrev || !capitulo || !verso) return res.status(400).json({ error: 'Faltan datos del versiculo.' });
  const usuario = obtenerUsuarioActual(req);
  const p = leerProgresoBiblia(usuario);
  const key = `${abrev}-${capitulo}`.toLowerCase();
  if (!p.tachados[key]) p.tachados[key] = [];
  const idx = p.tachados[key].indexOf(verso);
  if (idx === -1) p.tachados[key].push(verso);
  else p.tachados[key].splice(idx, 1);
  guardarProgresoBiblia(usuario, p);
  res.json({ key, tachados: p.tachados[key] });
});

// Guarda el nivel de zoom preferido del lector
app.post('/api/biblia/zoom', (req, res) => {
  const zoom = Number(req.body && req.body.zoom);
  if (!zoom || zoom < 50 || zoom > 250) return res.status(400).json({ error: 'Zoom invalido.' });
  const usuario = obtenerUsuarioActual(req);
  const p = leerProgresoBiblia(usuario);
  p.zoom = zoom;
  guardarProgresoBiblia(usuario, p);
  res.json({ zoom: p.zoom });
});

// ---------- Endpoint principal de chat (streaming en tiempo real, NDJSON) ----------
app.post('/api/chat', upload.array('imagenes', 5), async (req, res) => {
  const mensajeOriginal = (req.body.mensaje || '').trim();
  const chatId = (req.body.chatId || '').trim();
  const modoElegido = (req.body.modo || 'general').trim();
  // Modelo opcional desde el frontend (selector del chat). resolverModelo
  // valida y cae al default si viene cualquier cosa rara.
  const configModelo = resolverModelo(req.body.modelo);
  let imagenes = [];

  if (req.files && req.files.length) {
    imagenes = req.files.map((f) => ({ base64: f.buffer.toString('base64'), mime: f.mimetype, buffer: f.buffer }));
  }
  // Se guardan a disco ya mismo (no solo en memoria), asi la conversacion
  // puede volver a "verlas" en turnos siguientes y al recargar la pagina,
  // y quedan asociadas a un archivo real que se puede borrar despues.
  const imagenesGuardadasUrls = imagenes.map((img) => guardarImagenDisco(img.buffer, img.mime));

  if (!mensajeOriginal && !imagenes.length) {
    return res.status(400).json({ error: 'Falta el mensaje o al menos una imagen.' });
  }

  // Rate limit de la WEB (no consume creditos del token, solo limita frecuencia
  // por usuario + modelo). Si se pasa, le devolvemos un error en JSON que el
  // frontend muestra como mensaje normal. Esto evita que alguien desde la web
  // ametralle NewserAvanced (que es mas pesado para el proveedor).
  const usuarioActualRateLimit = obtenerUsuarioActual(req);
  const controlRateWeb = verificarRateLimitWeb(usuarioActualRateLimit, configModelo);
  if (!controlRateWeb.ok) {
    return res.status(controlRateWeb.status).json({ error: controlRateWeb.error });
  }

  // ---- Atajo: "Generame [descripcion]" -> genera imagen directo, sin IA ----
  // Si el mensaje empieza con "Genera", "Generame", "Dibujame", etc., vamos
  // directo a pollinations.ai sin llamar a Groq. Es mas rapido, mas barato
  // (no gasta tokens del proveedor) y mas predecible. La imagen se muestra
  // como foto en el chat usando el mismo evento 'descargas' que ya sabe
  // renderizar el frontend.
  // OJO: esto requiere NewserAvanced. Si el usuario tiene NewserLite, le
  // devolvemos un aviso en vez de generar la imagen.
  const intencionImagen = detectarGeneracionImagen(mensajeOriginal);
  if (intencionImagen.esGeneracion) {
    if (configModelo.nombre !== 'NewserAvanced') {
      // Streaming para que el frontend lo muestre como mensaje normal
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      try {
        const usuarioActualGen = obtenerUsuarioActual(req);
        const dbGen = leerDB();
        let chatGen = chatId ? obtenerChat(dbGen, chatId, usuarioActualGen) : null;
        if (!chatGen) chatGen = crearChat(dbGen, usuarioActualGen);
        chatGen.mensajes.push({
          role: 'user',
          contenidoTexto: mensajeOriginal,
          fecha: new Date().toISOString(),
        });
        chatGen.mensajes.push({
          role: 'assistant',
          contenidoTexto: 'La generacion de imagenes solo esta disponible con NewserAvanced. Cambiá el modelo en el selector de abajo para usarla.',
          fecha: new Date().toISOString(),
        });
        if (chatGen.titulo === 'Nueva conversacion' && mensajeOriginal) {
          chatGen.titulo = mensajeOriginal.length > 40 ? mensajeOriginal.slice(0, 40) + '…' : mensajeOriginal;
        }
        chatGen.actualizadoEn = new Date().toISOString();
        guardarDB(dbGen);
        res.write(JSON.stringify({ type: 'chunk', text: 'La generacion de imagenes solo esta disponible con **NewserAvanced**. Cambiá el modelo en el selector de abajo (al lado del microfono) para usarla.' }) + '\n');
        res.write(JSON.stringify({ type: 'done', chatId: chatGen.id }) + '\n');
        res.end();
      } catch (e) {
        if (!res.writableEnded) res.end();
      }
      return;
    }

    // Es NewserAvanced: generamos la imagen directamente con pollinations.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    let clienteDesconectadoGen = false;
    res.on('close', () => { if (!res.writableEnded) clienteDesconectadoGen = true; });
    const enviarGen = (obj) => {
      if (clienteDesconectadoGen || res.writableEnded) return;
      try { res.write(JSON.stringify(obj) + '\n'); } catch (e) { /* conexion cerrada */ }
    };

    try {
      // Guardamos el mensaje del usuario y preparamos el chat para el historial
      const usuarioActualGen = obtenerUsuarioActual(req);
      const dbGen = leerDB();
      let chatGen = chatId ? obtenerChat(dbGen, chatId, usuarioActualGen) : null;
      if (!chatGen) chatGen = crearChat(dbGen, usuarioActualGen);
      chatGen.mensajes.push({
        role: 'user',
        contenidoTexto: mensajeOriginal,
        fecha: new Date().toISOString(),
      });
      if (chatGen.titulo === 'Nueva conversacion' && mensajeOriginal) {
        chatGen.titulo = mensajeOriginal.length > 40 ? mensajeOriginal.slice(0, 40) + '…' : mensajeOriginal;
      }

      // Avisamos al frontend que estamos generando
      enviarGen({ type: 'chunk', text: `Generando imagen: **${intencionImagen.prompt}**...` });
      enviarGen({ type: 'investigando', query: `Generando imagen: ${intencionImagen.prompt}` });
      enviarGen({ type: 'investigando_sitio', sitio: 'image.pollinations.ai' });

      const img = await generarImagenPollinations(intencionImagen.prompt);
      enviarGen({ type: 'investigando_fin' });

      if (img) {
        // Borramos el texto "Generando imagen..." y mandamos la imagen como
        // descarga (el frontend la muestra como foto). Reusamos el evento
        // 'descargas' que ya sabe renderizar el frontend.
        enviarGen({ type: 'descargas', items: [{ url: img.url, nombre: img.prompt, tamanoKB: img.tamanoKB }] });
        // Guardamos en el historial la referencia a la imagen generada
        chatGen.mensajes.push({
          role: 'assistant',
          contenidoTexto: `Imagen generada: ${intencionImagen.prompt}`,
          fecha: new Date().toISOString(),
          descargas: [{ url: img.url, nombre: img.prompt, tamanoKB: img.tamanoKB }],
        });
      } else {
        enviarGen({ type: 'chunk', text: '\n\nNo pude generar la imagen en este momento. Probá de nuevo en un rato.' });
        chatGen.mensajes.push({
          role: 'assistant',
          contenidoTexto: 'No pude generar la imagen en este momento. Probá de nuevo en un rato.',
          fecha: new Date().toISOString(),
        });
      }
      chatGen.actualizadoEn = new Date().toISOString();
      guardarDB(dbGen);
      enviarGen({ type: 'done', chatId: chatGen.id });
      res.end();
    } catch (e) {
      console.error('[chat-generar-imagen] Error:', e.message);
      try {
        enviarGen({ type: 'error', message: 'Error al generar la imagen. Intenta de nuevo.' });
        res.end();
      } catch (e2) { if (!res.writableEnded) res.end(); }
    }
    return;
  }

  // A partir de aqui respondemos en streaming NDJSON (una linea JSON por evento).
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  let clienteDesconectado = false;
  const enviar = (obj) => {
    if (clienteDesconectado || res.writableEnded) return;
    try { res.write(JSON.stringify(obj) + '\n'); } catch (e) { /* conexion ya cerrada */ }
  };

  // Boton de "pausar" del cliente: cuando cancela el fetch, esto corta el
  // pedido a Groq (no seguimos gastando tokens de algo que ya nadie mira) y
  // dejamos de escribir al socket cerrado. El texto generado hasta ahi se
  // guarda igual en el historial, como una respuesta pausada.
  //
  // IMPORTANTE: esto escucha en "res" (la respuesta), no en "req" (la
  // peticion). req.on('close') dispara en falso apenas multer termina de
  // leer el body (osea, en CUALQUIER mensaje con FormData, que es como el
  // cliente manda todos los mensajes) mucho antes de que la respuesta
  // siquiera empiece, marcando cada chat como "desconectado" y cancelando
  // todo de inmediato. res.on('close') solo dispara con una desconexion real
  // o al terminar la respuesta normalmente.
  const controladorGroq = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      clienteDesconectado = true;
      controladorGroq.abort();
    }
  });

  try {
    let mensajeParaModelo = mensajeOriginal;

    // Contexto de YouTube si detectamos un link (arregla el "no puede analizar videos").
    // Importante: le quitamos la URL cruda al mensaje que ve el modelo, porque el modelo
    // base tiene un reflejo de rechazar peticiones apenas ve un link ("no puedo abrir
    // enlaces externos"), aunque el system prompt le diga lo contrario.
    const linkYoutube = mensajeOriginal ? extraerLinkYoutube(mensajeOriginal) : null;
    if (linkYoutube) {
      const contexto = await obtenerContextoYoutube(linkYoutube);
      const mensajeSinLink = mensajeOriginal.replace(linkYoutube, '[video de YouTube adjunto]').trim();
      if (contexto) {
        mensajeParaModelo = `${mensajeSinLink}\n\n[Contexto real ya obtenido del video de YouTube. Actua como si lo hubieras visto, respondiendo con naturalidad sobre este contenido; nunca digas que no puedes abrir enlaces ni ver videos]\n${contexto}`;
      } else {
        mensajeParaModelo = `${mensajeSinLink}\n\n[El usuario comparte un video de YouTube pero no se pudo obtener informacion automatica de el. No digas que no puedes abrir enlaces; en vez de eso, pidele amablemente que te cuente de que trata o que pegue el titulo]`;
      }
    }

    // Cada conversacion (chat) guarda su propio historial, para que no se mezclen
    // temas de conversaciones distintas y "Nuevo chat" empiece realmente en blanco.
    // Ademas, cada usuario solo ve y puede escribir en sus propias conversaciones.
    const usuarioActual = obtenerUsuarioActual(req);
    const db = leerDB();
    let chat = chatId ? obtenerChat(db, chatId, usuarioActual) : null;
    if (!chat) chat = crearChat(db, usuarioActual);
    const historial = chat.mensajes;
    // Si hay imagenes usamos el modelo de vision (que soporta multimodal);
    // si no, el de texto del modelo elegido en el selector del chat.
    // Esto permite que NewserAvanced tambien procese imagenes (cae al modelo
    // de vision que si soporta multimodal) sin romper.
    const modeloElegido = imagenes.length ? configModelo.modeloVision : configModelo.modeloTexto;

    let contenidoUsuario;
    if (imagenes.length) {
      contenidoUsuario = [
        { type: 'text', text: mensajeParaModelo || 'Describe estas imagenes.' },
        ...imagenes.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ];
    } else {
      contenidoUsuario = mensajeParaModelo;
    }

    // Construimos el system prompt segun el modo (general/catolico) y el
    // modelo (Lite/Avanced). NewserAvanced recibe un bloque extra con las 3
    // herramientas exclusivas (IMAGEN, WEB, CLIMA).
    let systemPrompt = modoElegido === 'catolico' ? SYSTEM_PROMPT_CATOLICO : SYSTEM_PROMPT;
    if (configModelo.nombre === 'NewserAvanced') {
      systemPrompt = systemPrompt + SYSTEM_PROMPT_AVANCED_EXTRA;
    }

    // Reemplazamos el placeholder __NOMBRE_MODELO__ con el nombre real del
    // modelo elegido. Asi cuando el usuario tiene NewserAvanced seleccionado y
    // le pregunta "quien sos?", la IA responde "Soy NewserAvanced" (no
    // "NewserLite").
    systemPrompt = systemPrompt.replace(/__NOMBRE_MODELO__/g, configModelo.nombre);

    const mensajesParaModelo = [
      { role: 'system', content: systemPrompt },
      ...construirHistorialParaModelo(historial),
      { role: 'user', content: contenidoUsuario },
    ];

    const respuestaGroq = await llamarGroqConReintentos({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modeloElegido,
        messages: mensajesParaModelo,
        temperature: 0.7,
        max_tokens: configModelo.maxTokens,
        stream: true,
      }),
      signal: controladorGroq.signal,
    }, enviar);

    if (!respuestaGroq || !respuestaGroq.ok || !respuestaGroq.body) {
      const status = respuestaGroq ? respuestaGroq.status : 0;
      // El detalle real (que puede mencionar al proveedor, la cuenta, etc.)
      // solo se loguea en el servidor. Al cliente nunca le llega ese texto.
      try {
        const detalle = respuestaGroq ? await respuestaGroq.clone().text() : '(sin respuesta)';
        console.error(`[chat] Error del proveedor de IA (status ${status}):`, detalle.slice(0, 500));
      } catch (e) { /* no se pudo leer el cuerpo, no pasa nada */ }
      enviar({ type: 'error', message: mensajeErrorAmigableIA(status) });
      return res.end();
    }

    const reader = respuestaGroq.body.getReader();
    const decoder = new TextDecoder();
    let bufferSSE = '';
    let textoCompleto = '';
    let emitido = 0;

    // Marcadores que cortan el stream: incluye los 4 originales + los 3 nuevos
    // exclusivos de NewserAvanced. Para NewserLite los nuevos nunca van a
    // aparecer en la respuesta (no estan en el prompt), asi que es seguro
    // agregarlos aca siempre.
    const MARCADORES = ['[[CUADERNO::', '[[BUSCAR::', '[[INVESTIGAR::', '[[DESCARGAR::', '[[IMAGEN::', '[[WEB::', '[[CLIMA::'];
    function calcularCorte(buffer) {
      let corte = buffer.length;
      for (const m of MARCADORES) {
        const idx = buffer.indexOf(m, emitido);
        if (idx !== -1) corte = Math.min(corte, idx);
        for (let i = 1; i < m.length; i++) {
          if (i > buffer.length) continue;
          const sufijo = buffer.slice(-i);
          if (m.startsWith(sufijo)) corte = Math.min(corte, buffer.length - i);
        }
      }
      return Math.max(corte, emitido);
    }

    let terminado = false;
    while (!terminado) {
      let leido;
      try {
        leido = await reader.read();
      } catch (e) {
        // Si esto paso porque el usuario pauso (aborto la conexion), no es un
        // error real: cortamos el loop y seguimos abajo con lo que ya se
        // escribio, para que quede guardado en el historial igual.
        if (clienteDesconectado) break;
        throw e;
      }
      const { value, done } = leido;
      if (done) break;
      bufferSSE += decoder.decode(value, { stream: true });
      const lineas = bufferSSE.split('\n');
      bufferSSE = lineas.pop();
      for (const linea of lineas) {
        const l = linea.trim();
        if (!l.startsWith('data:')) continue;
        const dataStr = l.slice(5).trim();
        if (dataStr === '[DONE]') { terminado = true; break; }
        try {
          const json = JSON.parse(dataStr);
          const delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || '';
          if (delta) {
            textoCompleto += delta;
            const corte = calcularCorte(textoCompleto);
            if (corte > emitido) {
              enviar({ type: 'chunk', text: textoCompleto.slice(emitido, corte) });
              emitido = corte;
            }
          }
        } catch (e) { /* linea SSE incompleta, se ignora */ }
      }
    }

    // Extraer directivas ocultas del texto completo. Usamos regex GLOBAL para
    // no romper si el modelo (por error) mete mas de una etiqueta: aunque solo
    // usamos la primera para el widget, quitamos TODAS del texto visible para
    // que nunca queden "[[CUADERNO::...]]" crudos pegados en el chat.
    let textoVisible = textoCompleto;
    let cuaderno = null;
    let busquedaQuery = null;
    let investigarQuery = null;
    let descargaQuery = null;
    let descargaCantidad = 1;
    // Nuevas etiquetas exclusivas de NewserAvanced:
    // (imagenQuery ya no se usa: las imagenes se generan automaticamente con
    // "Generame..." al inicio del mensaje, no por etiqueta)
    let webSearchQuery = null;     // [[WEB::consulta google]]
    let climaQuery = null;         // [[CLIMA::nombre del lugar]]

    const reCuadernoG = /\[\[CUADERNO::(.+?)::([\s\S]*?)\]\]/g;
    const coincidenciasCuaderno = [...textoVisible.matchAll(reCuadernoG)];
    if (coincidenciasCuaderno.length) {
      const primera = coincidenciasCuaderno[0];
      cuaderno = { referencia: primera[1].trim(), texto: primera[2].trim() };
      textoVisible = textoVisible.replace(reCuadernoG, '');
    }

    const reBuscarG = /\[\[BUSCAR::([^\]]+)\]\]/g;
    const coincidenciasBuscar = [...textoVisible.matchAll(reBuscarG)];
    if (coincidenciasBuscar.length) {
      busquedaQuery = coincidenciasBuscar[0][1].trim();
      textoVisible = textoVisible.replace(reBuscarG, '');
    }

    const reInvestigarG = /\[\[INVESTIGAR::([^\]]+)\]\]/g;
    const coincidenciasInvestigar = [...textoVisible.matchAll(reInvestigarG)];
    if (coincidenciasInvestigar.length) {
      investigarQuery = coincidenciasInvestigar[0][1].trim();
      textoVisible = textoVisible.replace(reInvestigarG, '');
    }

    // El numero de cantidad es opcional en el regex: si el modelo se olvida
    // de ponerlo (pasa con modelos de texto que no siguen el formato al pie
    // de la letra), igual queremos que la descarga funcione en vez de que la
    // directiva quede sin reconocer y aparezca como texto crudo en el chat.
    const reDescargarG = /\[\[DESCARGAR::([^:\]]+?)(?:::\s*(\d+))?\s*\]\]/g;
    const coincidenciasDescargar = [...textoVisible.matchAll(reDescargarG)];
    if (coincidenciasDescargar.length) {
      descargaQuery = coincidenciasDescargar[0][1].trim();
      descargaCantidad = Math.min(4, Math.max(1, parseInt(coincidenciasDescargar[0][2], 10) || 1));
      textoVisible = textoVisible.replace(reDescargarG, '');
    }

    // ---- Nuevas etiquetas exclusivas de NewserAvanced ----
    // NOTA: la etiqueta [[IMAGEN::...]] ya no se usa. Las imagenes se generan
    // automaticamente cuando el mensaje del usuario empieza con "Genera..."
    // o "Generame...". Si la IA igual escribió un [[IMAGEN::...]] (no debería,
    // porque el prompt le dice que no lo haga), lo limpiamos del texto visible
    // para que no aparezca crudo en el chat.
    textoVisible = textoVisible.replace(/\[\[IMAGEN::[^\]]*\]\]/g, '');

    // WEB: busca en Google Custom Search (con rotacion de 5 CSE IDs)
    const reWebG = /\[\[WEB::([^\]]+)\]\]/g;
    const coincidenciasWeb = [...textoVisible.matchAll(reWebG)];
    if (coincidenciasWeb.length) {
      webSearchQuery = coincidenciasWeb[0][1].trim();
      textoVisible = textoVisible.replace(reWebG, '');
    }

    // CLIMA: consulta open-meteo (no consume creditos extra)
    const reClimaG = /\[\[CLIMA::([^\]]+)\]\]/g;
    const coincidenciasClima = [...textoVisible.matchAll(reClimaG)];
    if (coincidenciasClima.length) {
      climaQuery = coincidenciasClima[0][1].trim();
      textoVisible = textoVisible.replace(reClimaG, '');
    }

    // Red de seguridad: a veces el modelo entiende el pedido pero se olvida
    // de escribir la directiva [[DESCARGAR::...]] (mas comun en modelos de
    // texto chicos). Si el mensaje del usuario tiene intencion clara de
    // "descargar/bajar" una imagen/foto y el modelo no disparo nada, lo
    // detectamos igual por patron de texto en vez de dejar que no pase nada.
    if (!descargaQuery) {
      const pideDescarga = /\b(descarg\w*|baj\w*)\b[\s\S]{0,40}\b(imagen\w*|foto\w*)\b|\b(imagen\w*|foto\w*)\b[\s\S]{0,40}\b(descarg\w*|baj\w*|mandame\w*|mandamela\w*|pasame\w*|pasamela\w*)\b/i;
      if (pideDescarga.test(mensajeOriginal)) {
        let query = mensajeOriginal
          .replace(/\b(descarg\w*|baj\w*|quiero|puedes|podes|por favor|una?s?|algunas?|de|del|que|es[ae]|est[ae]|esto|imagen(?:es)?|foto(?:s)?|y|mandame\w*|pasame\w*|guardal\w*|guardame\w*|busca\w*)\b/gi, ' ')
          .replace(/\d+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (query.length > 2) {
          descargaQuery = query.slice(0, 60);
          const numeroEnTexto = mensajeOriginal.match(/\b([1-4])\b/);
          descargaCantidad = numeroEnTexto ? Math.min(4, parseInt(numeroEnTexto[1], 10)) : 1;
        }
      }
    }

    textoVisible = textoVisible.trim();

    // Si quedo texto sin emitir (fuera de las directivas), lo mandamos ahora
    if (emitido < textoCompleto.length) {
      let restante = textoCompleto.slice(emitido);
      restante = restante.replace(reCuadernoG, '').replace(reBuscarG, '').replace(reInvestigarG, '').replace(reDescargarG, '').replace(/\[\[IMAGEN::[^\]]*\]\]/g, '').replace(reWebG, '').replace(reClimaG, '').trim();
      if (restante) enviar({ type: 'chunk', text: restante });
    }


    if (cuaderno) enviar({ type: 'notebook', referencia: cuaderno.referencia, texto: cuaderno.texto });

    // Busqueda de imagenes (Wikipedia). El frame "investigando" ahora refleja
    // el progreso REAL (no es una animacion decorativa): se avisa justo antes
    // de cada consulta real que se hace.
    if (busquedaQuery) {
      enviar({ type: 'investigando', query: busquedaQuery });
      enviar({ type: 'investigando_sitio', sitio: 'es.wikipedia.org (imagenes)' });
      const imagenes = await esperarMinimo(buscarImagenesWeb(busquedaQuery), 1000);
      if (imagenes.length) enviar({ type: 'images', query: busquedaQuery, items: imagenes });
      enviar({ type: 'investigando_fin' });
    }

    // Investigacion real: Wikipedia (extracto de texto real) + busqueda real
    // dentro del texto biblico completo. Nunca se inventa nada aca.
    if (investigarQuery) {
      enviar({ type: 'investigando', query: investigarQuery });

      enviar({ type: 'investigando_sitio', sitio: 'es.wikipedia.org' });
      const wiki = await esperarMinimo(investigarWikipedia(investigarQuery), 1000);

      enviar({ type: 'investigando_sitio', sitio: 'Biblia completa (busqueda de versiculos)' });
      const versiculos = await esperarMinimo(investigarBiblia(investigarQuery), 1000);

      const fuentes = [];
      if (wiki) fuentes.push({ titulo: `Wikipedia: ${wiki.titulo}`, url: wiki.url });
      if (versiculos && versiculos.length) fuentes.push({ titulo: 'Busqueda en el texto biblico completo (RV1960)', url: null });

      if (wiki || (versiculos && versiculos.length)) {
        const textoInvestigado = await sintetizarInvestigacion(investigarQuery, wiki, versiculos);
        if (textoInvestigado) {
          enviar({ type: 'chunk', text: `\n\n${textoInvestigado}` });
          textoVisible = `${textoVisible}\n\n${textoInvestigado}`.trim();
        }
      } else {
        const avisoVacio = 'No encontre informacion adicional verificable sobre esto en las fuentes disponibles.';
        enviar({ type: 'chunk', text: `\n\n${avisoVacio}` });
        textoVisible = `${textoVisible}\n\n${avisoVacio}`.trim();
      }

      if (fuentes.length) enviar({ type: 'fuentes', items: fuentes });
      enviar({ type: 'investigando_fin' });
    }

    // Descarga real de imagenes: busca candidatas, y para cada una baja los
    // bytes reales a disco. El tiempo que tarda es real (no fingido): cada
    // descarga se muestra en su propio paso, asi que mientras mas imagenes
    // pida el usuario, mas tarda de verdad, proporcional a la cantidad.
    let descargasFinales = [];
    if (descargaQuery) {
      enviar({ type: 'investigando', query: `Descargando: ${descargaQuery}` });
      enviar({ type: 'investigando_sitio', sitio: 'es.wikipedia.org (buscando imagenes)' });
      const candidatas = await esperarMinimo(buscarImagenesParaDescargar(descargaQuery, descargaCantidad), 900);

      for (let i = 0; i < candidatas.length; i++) {
        enviar({ type: 'investigando_sitio', sitio: `Descargando imagen ${i + 1} de ${candidatas.length}...` });
        const resultado = await esperarMinimo(descargarImagenAlDisco(candidatas[i]), 900);
        if (resultado) descargasFinales.push(resultado);
      }

      enviar({ type: 'investigando_fin' });
      if (descargasFinales.length) {
        enviar({ type: 'descargas', items: descargasFinales });
      } else {
        enviar({ type: 'chunk', text: '\n\nNo pude encontrar ni descargar ninguna imagen para eso, perdon.' });
        textoVisible = `${textoVisible}\n\nNo pude encontrar ni descargar ninguna imagen para eso, perdon.`.trim();
      }
    }

    // (La etiqueta [[IMAGEN::]] ya no se procesa aca. Las imagenes se generan
    // automaticamente al inicio del handler cuando el mensaje empieza con
    // "Generame...", sin pasar por la IA. Ver bloque detectarGeneracionImagen
    // arriba.)

    // ---- WEB (NewserAvanced): busca en Google Custom Search ----
    if (webSearchQuery) {
      enviar({ type: 'investigando', query: `Buscando en la web: ${webSearchQuery}` });
      enviar({ type: 'investigando_sitio', sitio: 'Google Custom Search' });
      const resultado = await esperarMinimo(buscarWebGoogle(webSearchQuery), 1500);
      enviar({ type: 'investigando_fin' });

      if (resultado.exito && resultado.resultados.length) {
        // Sintetizamos los resultados y los mandamos como chunk + fuentes
        const fuentesWeb = resultado.resultados.map((r) => ({ titulo: r.titulo, url: r.link }));
        const textoResultados = '\n\n**Resultados de la web:**\n' +
          resultado.resultados.map((r, i) => `${i + 1}. **${r.titulo}** — ${r.resumen}`).join('\n');
        enviar({ type: 'chunk', text: textoResultados });
        enviar({ type: 'fuentes', items: fuentesWeb });
        textoVisible = `${textoVisible}${textoResultados}`.trim();
      } else {
        const aviso = `\n\nNo encontre resultados en la web para "${webSearchQuery}" en este momento. (${resultado.error || ''})`.trim();
        enviar({ type: 'chunk', text: aviso });
        textoVisible = `${textoVisible}${aviso}`.trim();
      }
    }

    // ---- CLIMA (NewserAvanced): consulta open-meteo (no consume creditos extra) ----
    if (climaQuery) {
      enviar({ type: 'investigando', query: `Consultando clima: ${climaQuery}` });
      enviar({ type: 'investigando_sitio', sitio: 'open-meteo.com' });
      const clima = await esperarMinimo(consultarClimaOpenMeteo(climaQuery), 1500);
      enviar({ type: 'investigando_fin' });

      if (clima) {
        const textoClima = `\n\n${clima.textoResumen}`;
        enviar({ type: 'chunk', text: textoClima });
        textoVisible = `${textoVisible}${textoClima}`.trim();
      } else {
        const aviso = `\n\nNo pude consultar el clima de "${climaQuery}" en este momento.`;
        enviar({ type: 'chunk', text: aviso });
        textoVisible = `${textoVisible}${aviso}`.trim();
      }
    }

    historial.push({
      role: 'user',
      contenidoTexto: mensajeOriginal || '[Imagen enviada]',
      fecha: new Date().toISOString(),
      tuvoImagen: imagenes.length > 0,
      imagenesUrls: imagenesGuardadasUrls.length ? imagenesGuardadasUrls : undefined,
    });
    historial.push({
      role: 'assistant',
      contenidoTexto: textoVisible || '(sin respuesta)',
      fecha: new Date().toISOString(),
      descargas: descargasFinales.length ? descargasFinales : undefined,
    });

    // Titulo automatico de la conversacion, tomado del primer mensaje del usuario
    if (chat.titulo === 'Nueva conversacion' && mensajeOriginal) {
      chat.titulo = mensajeOriginal.length > 40 ? mensajeOriginal.slice(0, 40) + '…' : mensajeOriginal;
    }
    chat.actualizadoEn = new Date().toISOString();
    guardarDB(db);

    enviar({ type: 'done', chatId: chat.id });
    res.end();
  } catch (err) {
    // Cuando el usuario pausa (o cierra la pestana / pierde conexion) a media
    // respuesta, el fetch a Groq se cancela a proposito y esto revienta como
    // un AbortError. No es una falla real del servidor: no hay nada que
    // reportarle a un cliente que ya no esta escuchando, asi que solo se deja
    // una linea de registro corta en vez del stack completo, y no se intenta
    // escribir en una respuesta que el cliente ya cerro.
    if (err.name === 'AbortError' || clienteDesconectado) {
      console.log('[chat] peticion cancelada por el cliente (pausa o desconexion).');
      if (!res.writableEnded) { try { res.end(); } catch (e2) { /* ya cerrada */ } }
      return;
    }
    console.error(err);
    try {
      enviar({ type: 'error', message: 'Error interno del servidor. Intenta de nuevo en unos minutos.' });
      res.end();
    } catch (e2) {
      res.end();
    }
  }
});

// Arranque: primero conectamos a MongoDB y cargamos los datos persistentes,
// despues recien empezamos a escuchar. Esto asegura que cuando llegue la
// primera peticion, los archivos locales ya tengan los datos de Mongo.
(async () => {
  try {
    await mongoDb.conectarMongo();
    await cargarDesdeMongoAlArrancar();
  } catch (e) {
    console.error('[startup] Error en inicializacion Mongo:', e.message);
    // No frenamos el arranque: seguimos con archivos locales.
  }
  app.listen(PORT, () => {
    console.log(`Verbo AI (${NOMBRE_MODELO_PUBLICO}) escuchando en http://localhost:${PORT}`);
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    Object.values(interfaces).forEach((lista) => {
      (lista || []).forEach((info) => {
        if (info.family === 'IPv4' && !info.internal) ips.push(info.address);
      });
    });
    if (ips.length) {
      console.log('Para entrar desde tu celular (misma red WiFi):');
      ips.forEach((ip) => console.log(`  http://${ip}:${PORT}`));
      console.log('Importante: esa(s) URL tambien tienen que estar agregadas en');
      console.log('Google Cloud Console -> Credenciales -> tu cliente OAuth -> "URIs de');
      console.log(`redireccionamiento autorizados", como http://${ips[0]}:${PORT}/auth/google/callback`);
    }
  } catch (e) { /* si falla, no pasa nada, el resto de la app funciona igual */ }
  }); // fin de app.listen callback
})(); // fin del IIFE de arranque

// Endpoint de prueba de conexion con el modelo de IA. Requiere sesion
// iniciada (lo exige el middleware global de arriba). No revela nunca el
// proveedor (Groq), la URL, la clave, ni el texto/JSON crudo de error: eso
// solo queda en los logs del servidor. Al que lo llame solo le llega "ok" o
// un mensaje generico.
app.get('/api/test-btatesters', async (req, res) => {
  if (!CLAVES_GROQ.length) {
    return res.json({ ok: false, error: 'No hay ninguna clave de API configurada en el servidor.' });
  }
  try {
    const respuesta = await llamarGroqConReintentos({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Hola, responde en una frase corta.' }],
        max_tokens: 50,
      }),
    }, () => {});

    if (!respuesta || !respuesta.ok) {
      const status = respuesta ? respuesta.status : 0;
      try {
        const detalle = respuesta ? await respuesta.clone().text() : '(sin respuesta)';
        console.error(`[test-btatesters] Error del proveedor de IA (status ${status}):`, detalle.slice(0, 500));
      } catch (e) { /* no se pudo leer el cuerpo */ }
      return res.json({ ok: false, error: mensajeErrorAmigableIA(status) });
    }
    const data = await respuesta.json();
    if (data.choices && data.choices[0]) {
      res.json({ ok: true, respuesta: data.choices[0].message.content });
    } else {
      res.json({ ok: false, error: 'El servicio de IA no devolvio una respuesta valida.' });
    }
  } catch (e) {
    console.error('[test-btatesters] Error:', e.message);
    res.json({ ok: false, error: 'Error al conectar con el servicio de IA.' });
  }
});