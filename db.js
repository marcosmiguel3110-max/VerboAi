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
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'biblia_ai';
const COLECCION = 'estado_app';

let client = null;
let db = null;

async function conectarMongo() {
  if (!MONGODB_URI) {
    console.warn('[mongodb] MONGODB_URI no esta definida. Se usara solo almacenamiento local en /memory.');
    return null;
  }
  try {
    // Opciones de conexion:
    // - serverSelectionTimeoutMS: 8000 (espera 8s a encontrar un servidor)
    // - tls: true (forzamos TLS porque Atlas lo requiere)
    // - tlsAllowInvalidCertificates: false (validamos certificados)
    // - retryWrites: true (reintentos automaticos en escrituras)
    //
    // El error "tlsv1 alert internal error" que aparecia antes era por una
    // negociacion TLS incompatible entre Node 24 y Atlas. Estas opciones lo
    // resuelven.
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      tls: true,
      retryWrites: true,
    });
    await client.connect();
    await client.db(MONGODB_DB_NAME).command({ ping: 1 });
    db = client.db(MONGODB_DB_NAME);
    console.log(`[mongodb] Conectado correctamente (base de datos "${MONGODB_DB_NAME}").`);
    return db;
  } catch (err) {
    console.error('[mongodb] No se pudo conectar:', err.message);
    console.warn('[mongodb] Se continua usando solo almacenamiento local en /memory.');
    client = null;
    db = null;
    return null;
  }
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

module.exports = { conectarMongo, estaConectado, leerDocumento, guardarDocumento };
