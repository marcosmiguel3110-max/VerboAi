// Modulo de conexion a MongoDB.
//
// La app antes guardaba todo en archivos JSON dentro de /memory. Eso se
// pierde cada vez que el servicio se reinicia en Render (sistema de
// archivos efimero). Este modulo agrega MongoDB como almacenamiento
// persistente real, sin romper el resto del codigo:
//
// - Cada "archivo" viejo (historial.json, usuarios.json,
//   biblia-progreso.json) pasa a ser UN documento dentro de la coleccion
//   "estado_app" en MongoDB (_id: 'historial' | 'usuarios' | 'biblia-progreso').
// - Si MONGODB_URI no esta configurada, o la conexion falla, la app sigue
//   funcionando igual que antes usando solo los archivos locales.
//
// MANEJO DE ERRORES TLS:
// El error "tlsv1 alert internal error" (SSL alert 80) aparece cuando Atlas
// rechaza la conexion TLS. Las causas mas comunes son:
//   1. IP de Render no esta en la whitelist de Atlas (hay que permitir 0.0.0.0/0)
//   2. Incompatibilidad TLS entre Node 24 (OpenSSL 3.5) y Atlas
//   3. Falta SNI explicito
// Para ser robusto, probamos varias configuraciones hasta encontrar una que
// funcione. Si ninguna anda, la app sigue con archivos locales (no se cae).
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'biblia_ai';
const COLECCION = 'estado_app';

let client = null;
let db = null;

// Intenta una sola conexion con opciones dadas. Devuelve true/false.
// No loguea errores (lo hace el llamador con contexto).
async function intentarConexion(uri, opciones, etiqueta) {
  try {
    const c = new MongoClient(uri, opciones);
    await c.connect();
    await c.db(MONGODB_DB_NAME).command({ ping: 1 });
    // Si llegamos aca, la conexion funciona. La guardamos como la oficial.
    client = c;
    db = c.db(MONGODB_DB_NAME);
    console.log(`[mongodb] Conectado correctamente con config: ${etiqueta} (db "${MONGODB_DB_NAME}").`);
    return true;
  } catch (err) {
    console.warn(`[mongodb] Config "${etiqueta}" fallo: ${err.message.slice(0, 120)}`);
    return false;
  }
}

async function conectarMongo() {
  if (!MONGODB_URI) {
    console.warn('[mongodb] MONGODB_URI no esta definida. Se usara solo almacenamiento local en /memory.');
    return null;
  }

  console.log('[mongodb] Intentando conectar a MongoDB Atlas...');

  // Aseguramos que la URI tenga parametros TLS explicitos. Atlas con +srv
  // deberia implicar TLS, pero a veces hace falta declararlo.
  let uri = MONGODB_URI;
  if (!/[?&]tls=/.test(uri)) {
    uri += (uri.includes('?') ? '&' : '?') + 'tls=true';
  }
  if (!/[?&]retryWrites=/.test(uri)) {
    uri += (uri.includes('?') ? '&' : '?') + 'retryWrites=true';
  }
  if (!/[?&]w=/.test(uri)) {
    uri += (uri.includes('?') ? '&' : '?') + 'w=majority';
  }

  // Probamos varias configuraciones en orden. La primera que conecta, gana.
  // Esto es necesario porque distintos environments (Render, local, etc.)
  // pueden necesitar opciones distintas, especialmente con Node 24 + OpenSSL 3.5.
  // OJO: si Mongo no conecta, el server tarda hasta 4*6s=24s en arrancar.
  // Por eso el timeout es corto (6s) y no 10s.
  const configuraciones = [
    // 1. Opciones default del driver (deberia andar en la mayoria de los casos)
    {
      etiqueta: 'default',
      uri: uri,
      opts: { serverSelectionTimeoutMS: 6000 },
    },
    // 2. TLS explicito + retryWrites
    {
      etiqueta: 'tls-explicito',
      uri: uri,
      opts: { serverSelectionTimeoutMS: 6000, tls: true, retryWrites: true },
    },
    // 3. TLS + permitir certificados invalidos (menos seguro, pero a veces
    //    es la unica forma de pasar proxys/firewalls que interceptan TLS).
    //    Solo lo usamos como ultimo recurso para que la app funcione.
    {
      etiqueta: 'tls-permissivo',
      uri: uri,
      opts: { serverSelectionTimeoutMS: 6000, tls: true, tlsAllowInvalidCertificates: true },
    },
    // 4. Sin opciones TLS (deja que el driver decida automaticamente)
    {
      etiqueta: 'sin-tls-opciones',
      uri: MONGODB_URI, // URI original sin parametros extra
      opts: { serverSelectionTimeoutMS: 6000 },
    },
  ];

  for (const cfg of configuraciones) {
    const ok = await intentarConexion(cfg.uri, cfg.opts, cfg.etiqueta);
    if (ok) return db;
  }

  // Si llegamos aca, ninguna configuracion funciono.
  console.error('[mongodb] ========================================');
  console.error('[mongodb] NO SE PUDO CONECTAR con ninguna configuracion.');
  console.error('[mongodb] Causas probables y soluciones:');
  console.error('[mongodb]');
  console.error('[mongodb] 1. IP WHITELIST DE ATLAS (causa mas comun):');
  console.error('[mongodb]    - Entrá a https://cloud.mongodb.com');
  console.error('[mongodb]    - Tu cluster -> "Network Access" (menu izquierdo)');
  console.error('[mongodb]    - "Add IP Address" -> "Allow Access From Anywhere"');
  console.error('[mongodb]    - Pone 0.0.0.0/0 (permitir todas las IPs)');
  console.error('[mongodb]    - Espera 1-2 minutos a que se aplique');
  console.error('[mongodb]');
  console.error('[mongodb] 2. USUARIO/PASSWORD INCORRECTO:');
  console.error('[mongodb]    - Verifica MONGODB_URI en .env / variables de Render');
  console.error('[mongodb]    - El usuario debe tener permisos de readWrite en la db');
  console.error('[mongodb]');
  console.error('[mongodb] 3. CLUSTER PAUSADO (free tier):');
  console.error('[mongodb]    - Entra a Atlas y verifica que el cluster este activo');
  console.error('[mongodb]    - Los clusters free se pausan despues de inactividad');
  console.error('[mongodb]');
  console.error('[mongodb] Mientras tanto, la app sigue funcionando con archivos');
  console.error('[mongodb] locales en /memory (pero se pierden al reiniciar).');
  console.error('[mongodb] ========================================');
  client = null;
  db = null;
  return null;
}

function estaConectado() {
  return !!db;
}

// Lee un documento completo (ej: 'historial'). Devuelve null si no hay
// conexion a Mongo o si el documento todavia no existe.
async function leerDocumento(id) {
  if (!db) return null;
  try {
    const doc = await db.collection(COLECCION).findOne({ _id: id });
    if (!doc) return null;
    const { _id, ...resto } = doc;
    return resto;
  } catch (err) {
    console.error(`[mongodb] Error leyendo "${id}":`, err.message);
    return null;
  }
}

// Guarda (reemplaza) un documento completo. No tira excepcion: si falla,
// solo lo avisa por consola, para que la app nunca se caiga por un problema
// de red con Mongo (el archivo local ya quedo guardado antes de esto).
async function guardarDocumento(id, valor) {
  if (!db) return false;
  try {
    await db.collection(COLECCION).replaceOne({ _id: id }, { _id: id, ...valor }, { upsert: true });
    return true;
  } catch (err) {
    console.error(`[mongodb] Error guardando "${id}":`, err.message);
    return false;
  }
}

// Lee todos los documentos cuyo _id empieza con un prefijo (ej: 'verbocode-')
// Devuelve array de { _id, valor } o [] si no hay conexión
async function leerTodosPorPrefijo(prefijo) {
  if (!db) return [];
  try {
    const docs = await db.collection(COLECCION).find({ _id: { $regex: `^${prefijo}` } }).toArray();
    return docs.map(doc => {
      const { _id, ...resto } = doc;
      return { _id, valor: resto };
    });
  } catch (err) {
    console.error(`[mongodb] Error leyendo todos con prefijo "${prefijo}":`, err.message);
    return [];
  }
}

module.exports = { conectarMongo, estaConectado, leerDocumento, guardarDocumento, leerTodosPorPrefijo };
