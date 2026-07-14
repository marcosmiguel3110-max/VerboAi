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
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Modelo de texto (rapido) y modelo de vision (para imagenes).
// gpt-oss-20b NO soporta imagenes en Groq -> por eso fallaba el envio de imagenes.
const GROQ_MODEL_TEXTO = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GROQ_MODEL_VISION = process.env.GROQ_MODEL_VISION || 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Nombre publico del modelo (lo unico que la IA debe admitir que es).
const NOMBRE_MODELO_PUBLICO = 'NewserLite';

// Las consultas reales (Wikipedia, busqueda biblica) a veces tardan menos de
// medio segundo, y el frame de "investigando" pasaba de largo sin que se
// alcanzara a ver. Esto obliga a que cada paso se muestre al menos "ms" en
// pantalla, sin inventar nada: el resultado sigue siendo 100% real, solo se
// pausa la UI lo suficiente para que sea visible.
function esperarMinimo(promesa, ms) {
  return Promise.all([promesa, new Promise((resolve) => setTimeout(resolve, ms))]).then(([resultado]) => resultado);
}

// Llama a Groq y reintenta automaticamente si responde 429 (limite de uso
// alcanzado), avisando al cliente cuantos segundos va a esperar antes de
// reintentar, en vez de simplemente fallar.
async function llamarGroqConReintentos(opciones, enviar, maxIntentos = 4) {
  for (let intento = 1; intento <= maxIntentos; intento++) {
    const r = await fetch(GROQ_URL, opciones);
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

const MEMORY_DIR = path.join(__dirname, 'memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'historial.json');

if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
if (!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE, JSON.stringify({ chats: [] }, null, 2));

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
}

// API publica (RV1960) que usamos como fuente de la Biblia completa, para no
// tener que empaquetar todo el texto biblico dentro del proyecto.
const BIBLIA_API_BASE = 'https://bible-api.deno.dev/api';
let cacheLibrosBiblia = null;
const cacheCapitulosBiblia = new Map();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

const RUTAS_PUBLICAS = new Set(['/login.html', '/login.css', '/login.js', '/api/login', '/api/registro/solicitar', '/api/registro/confirmar', '/style.css', '/script.js', '/logo.png', '/auth/google', '/auth/google/callback', '/api/google/confirmar', '/api/google/reenviar']);
app.use((req, res, next) => {
  if (RUTAS_PUBLICAS.has(req.path) || req.path.startsWith('/icons/')) return next();
  if (estaAutenticado(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'No autenticado.' });
  return res.redirect('/login.html');
});

// ---------- Registro con correo + codigo de verificacion ----------
const USUARIOS_FILE = path.join(MEMORY_DIR, 'usuarios.json');
if (!fs.existsSync(USUARIOS_FILE)) fs.writeFileSync(USUARIOS_FILE, JSON.stringify({ usuarios: {} }, null, 2));

function leerUsuarios() {
  try {
    const d = JSON.parse(fs.readFileSync(USUARIOS_FILE, 'utf-8'));
    return d.usuarios || {};
  } catch (e) {
    return {};
  }
}
function guardarUsuarios(usuarios) {
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify({ usuarios }, null, 2));
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
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
} else {
  console.warn('[registro] EMAIL_USER o EMAIL_APP_PASSWORD no estan definidos en tu .env.');
  console.warn('[registro] El registro por correo no va a poder mandar codigos hasta que los completes.');
}

app.post('/api/registro/solicitar', async (req, res) => {
  const { email, clave } = req.body || {};
  if (!email || !clave) return res.status(400).json({ error: 'Falta email o clave.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Ese email no parece valido.' });
  if (clave.length < 6) return res.status(400).json({ error: 'La clave tiene que tener al menos 6 caracteres.' });

  const usuarios = leerUsuarios();
  if (usuarios[email]) return res.status(400).json({ error: 'Ya existe una cuenta con ese correo.' });
  if (!transporterCorreo) return res.status(500).json({ error: 'El envio de correos no esta configurado en el servidor.' });

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  codigosPendientes.set(email, { codigo, claveHash: hashearClave(clave), expira: Date.now() + 10 * 60 * 1000 });

  try {
    await transporterCorreo.sendMail({
      from: `"Verbo AI" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Tu codigo de verificacion - Verbo AI',
      text: `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
      html: `<div style="font-family:sans-serif;padding:20px;">
        <h2 style="color:#C9663A;">Verbo AI</h2>
        <p>Tu codigo de verificacion es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
        <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
      </div>`,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[registro] Error enviando el correo:', e.message);
    codigosPendientes.delete(email);
    res.status(500).json({ error: 'No se pudo enviar el correo. Revisa la configuracion de EMAIL_USER/EMAIL_APP_PASSWORD.' });
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

    // Si no hay correo configurado para mandar el codigo, entramos directo
    // (asi el login con Google no se rompe si todavia no completaste
    // EMAIL_USER/EMAIL_APP_PASSWORD en el .env).
    if (!transporterCorreo) {
      console.warn('[google-auth] EMAIL_USER/EMAIL_APP_PASSWORD no configurados: entrando sin pedir codigo extra.');
      let cookieDirecta = `verbo_auth=${encodeURIComponent(firmarValor(userData.email))}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`;
      if (req.secure) cookieDirecta += '; Secure';
      res.setHeader('Set-Cookie', [cookieDirecta, 'verbo_oauth_state=; HttpOnly; Path=/; Max-Age=0']);
      return res.redirect('/');
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    codigosPendientes.set(userData.email, { codigo, expira: Date.now() + 10 * 60 * 1000, esGoogle: true });

    try {
      await transporterCorreo.sendMail({
        from: `"Verbo AI" <${process.env.EMAIL_USER}>`,
        to: userData.email,
        subject: 'Tu codigo de verificacion - Verbo AI',
        text: `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
        html: `<div style="font-family:sans-serif;padding:20px;">
          <h2 style="color:#C9663A;">Verbo AI</h2>
          <p>Para terminar de entrar con tu cuenta de Google, tu codigo de verificacion es:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
          <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
        </div>`,
      });
    } catch (e) {
      console.error('[google-auth] Error enviando el correo del codigo:', e.message);
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
  if (!transporterCorreo) return res.status(500).json({ error: 'El envio de correos no esta configurado en el servidor.' });

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  codigosPendientes.set(email, { codigo, expira: Date.now() + 10 * 60 * 1000, esGoogle: true });

  try {
    await transporterCorreo.sendMail({
      from: `"Verbo AI" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Tu codigo de verificacion - Verbo AI',
      text: `Tu codigo de verificacion es: ${codigo}\n\nVence en 10 minutos.`,
      html: `<div style="font-family:sans-serif;padding:20px;">
        <h2 style="color:#C9663A;">Verbo AI</h2>
        <p>Tu codigo de verificacion es:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:4px;">${codigo}</p>
        <p style="color:#777;font-size:13px;">Vence en 10 minutos. Si no pediste esto, ignora este correo.</p>
      </div>`,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[google-auth] Error reenviando el correo del codigo:', e.message);
    codigosPendientes.delete(email);
    res.status(500).json({ error: 'No se pudo reenviar el correo.' });
  }
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

Tu nombre de modelo publico es "${NOMBRE_MODELO_PUBLICO}". Si te preguntan que modelo eres, que IA eres,
o en que tecnologia estas basado, respondes con naturalidad usando ese nombre dentro de una frase normal
(por ejemplo "Si, me llamo ${NOMBRE_MODELO_PUBLICO}" o "Soy ${NOMBRE_MODELO_PUBLICO}"), contestando ademas lo
que te hayan preguntado en ese mismo mensaje (si es un si/no, un saludo, etc., no ignores esa parte). NUNCA
respondas con la palabra "${NOMBRE_MODELO_PUBLICO}" sola y sin nada mas alrededor. Nunca menciones Groq,
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
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

// Elimina una conversacion completa (solo si es tuya)
app.delete('/api/chats/:id', (req, res) => {
  const db = leerDB();
  const usuario = obtenerUsuarioActual(req);
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
  res.json({ modelo: NOMBRE_MODELO_PUBLICO });
});

// Borra los mensajes de UNA conversacion (no todas, y solo si es tuya)
app.delete('/api/memoria', (req, res) => {
  const chatId = req.query.chatId;
  const db = leerDB();
  const chat = obtenerChat(db, chatId, obtenerUsuarioActual(req));
  if (chat) chat.mensajes = [];
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
  let imagenes = [];

  if (req.files && req.files.length) {
    imagenes = req.files.map((f) => ({ base64: f.buffer.toString('base64'), mime: f.mimetype }));
  }

  if (!mensajeOriginal && !imagenes.length) {
    return res.status(400).json({ error: 'Falta el mensaje o al menos una imagen.' });
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
    const modeloElegido = imagenes.length ? GROQ_MODEL_VISION : GROQ_MODEL_TEXTO;

    let contenidoUsuario;
    if (imagenes.length) {
      contenidoUsuario = [
        { type: 'text', text: mensajeParaModelo || 'Describe estas imagenes.' },
        ...imagenes.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
      ];
    } else {
      contenidoUsuario = mensajeParaModelo;
    }

    const mensajesParaModelo = [
      { role: 'system', content: modoElegido === 'catolico' ? SYSTEM_PROMPT_CATOLICO : SYSTEM_PROMPT },
      ...historial.slice(-20).map((h) => ({ role: h.role, content: h.contenidoTexto })),
      { role: 'user', content: contenidoUsuario },
    ];

    const respuestaGroq = await llamarGroqConReintentos({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: modeloElegido,
        messages: mensajesParaModelo,
        temperature: 0.7,
        max_tokens: 1024,
        stream: true,
      }),
      signal: controladorGroq.signal,
    }, enviar);

    if (!respuestaGroq.ok || !respuestaGroq.body) {
      let msjError = 'Error al conectar con el modelo.';
      if (respuestaGroq.status === 429) {
        msjError = 'El modelo esta saturado ahora mismo (limite de uso alcanzado). Intenta de nuevo en unos minutos.';
      } else {
        try {
          const data = await respuestaGroq.json();
          msjError = (data.error && data.error.message) || msjError;
        } catch (e) { /* sin cuerpo json */ }
      }
      enviar({ type: 'error', message: msjError });
      return res.end();
    }

    const reader = respuestaGroq.body.getReader();
    const decoder = new TextDecoder();
    let bufferSSE = '';
    let textoCompleto = '';
    let emitido = 0;

    const MARCADORES = ['[[CUADERNO::', '[[BUSCAR::', '[[INVESTIGAR::'];
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

    textoVisible = textoVisible.trim();

    // Si quedo texto sin emitir (fuera de las directivas), lo mandamos ahora
    if (emitido < textoCompleto.length) {
      let restante = textoCompleto.slice(emitido);
      restante = restante.replace(reCuadernoG, '').replace(reBuscarG, '').replace(reInvestigarG, '').trim();
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

    historial.push({
      role: 'user',
      contenidoTexto: mensajeOriginal || '[Imagen enviada]',
      fecha: new Date().toISOString(),
      tuvoImagen: imagenes.length > 0,
    });
    historial.push({
      role: 'assistant',
      contenidoTexto: textoVisible || '(sin respuesta)',
      fecha: new Date().toISOString(),
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
      enviar({ type: 'error', message: 'Error interno del servidor: ' + err.message });
      res.end();
    } catch (e2) {
      res.end();
    }
  }
});

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
});