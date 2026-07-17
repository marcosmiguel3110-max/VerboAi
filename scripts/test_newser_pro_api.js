// Test 2: token de API creado por un usuario NO admin pidiendo NewserPro -> 403
// Token creado por admin local pidiendo NewserPro -> pasa resolverModelo

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV = `PORT=3998
GROQ_API_KEY=test_key
APP_USER=admin
APP_PASS=test
AUTH_SECRET=test_secret
ADMIN_EMAILS=marcos.miguel.3110@gmail.com
EMAILS_AUTORIZADOS_API=marcos.miguel.3110@gmail.com
`;

const tokensFile = path.join(ROOT, 'memory', 'api-tokens.json');
const histFile = path.join(ROOT, 'memory', 'historial.json');
const usersFile = path.join(ROOT, 'memory', 'usuarios.json');
for (const f of [tokensFile, histFile, usersFile]) {
  try { fs.unlinkSync(f); } catch (e) {}
}

// Pre-crear 2 tokens: uno para admin local (propietario "local:admin"), otro para user normal (propietario "user@ejemplo.com")
const tokens = [
  { id: 't-admin-1', nombre: 'admin token', token: 'verboai-111111111111', propietario: 'local:admin', creditos: 1000, activo: true, creadoEn: new Date().toISOString(), ultimoUso: null },
  { id: 't-user-1', nombre: 'user token', token: 'verboai-222222222222', propietario: 'user@ejemplo.com', creditos: 1000, activo: true, creadoEn: new Date().toISOString(), ultimoUso: null },
];
fs.writeFileSync(tokensFile, JSON.stringify({ tokens }, null, 2));

const envFile = path.join(ROOT, '.env');
fs.writeFileSync(envFile, ENV);

const server = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
server.stdout.on('data', (d) => { stdout += d.toString(); });
server.stderr.on('data', (d) => { stderr += d.toString(); });

function req(pathStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathStr, 'http://127.0.0.1:3998');
    const r = http.request({
      method: opts.method || 'GET',
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: opts.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(200);
      try { const r = await req('/api/config'); if (r.status === 200) ready = true; } catch (e) {}
    }
    if (!ready) throw new Error('servidor no arranco. stderr=' + stderr.slice(-500));

    console.log('\n[A] /api/v1/info con token ADMIN (NewserPro debe estar en la lista):');
    const rA = await req('/api/v1/info', { headers: { Authorization: 'Bearer verboai-111111111111' } });
    const jA = JSON.parse(rA.body);
    const nomA = jA.modelos.map((m) => m.nombre);
    console.log('   esAdmin:', jA.esAdmin, '| modelos:', nomA.join(', '));
    if (!nomA.includes('NewserPro')) throw new Error('FAIL: admin token debería ver NewserPro');

    console.log('\n[B] /api/v1/info con token USER (NewserPro NO debe estar):');
    const rB = await req('/api/v1/info', { headers: { Authorization: 'Bearer verboai-222222222222' } });
    const jB = JSON.parse(rB.body);
    const nomB = jB.modelos.map((m) => m.nombre);
    console.log('   esAdmin:', jB.esAdmin, '| modelos:', nomB.join(', '));
    if (nomB.includes('NewserPro')) throw new Error('FAIL: user token NO debería ver NewserPro');

    console.log('\n[C] /api/v1/chat con token USER pidiendo modelo=NewserPro (debe dar 403):');
    const rC = await req('/api/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verboai-222222222222' },
      body: JSON.stringify({ mensaje: 'test', modelo: 'NewserPro' }),
    });
    console.log('   status:', rC.status);
    console.log('   body:', rC.body.slice(0, 250));
    if (rC.status !== 403) throw new Error('FAIL: esperaba 403, got ' + rC.status);

    console.log('\nOK: todas las pruebas de API pasaron');
    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('\nERROR:', e.message);
    console.error('--- stdout ---'); console.error(stdout.split('\n').slice(-30).join('\n'));
    console.error('--- stderr ---'); console.error(stderr);
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
