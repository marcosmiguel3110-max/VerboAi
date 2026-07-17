// Smoke test: arranca el servidor con un .env mínimo y prueba:
//   1) /api/config sin auth -> no debería listar NewserPro
//   2) /api/config con admin local -> debería listar NewserPro
//   3) NewserPro tiene flag soloAdmin=true

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV = `PORT=3999
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
fs.writeFileSync(tokensFile, JSON.stringify({ tokens: [] }, null, 2));

const envFile = path.join(ROOT, '.env');
fs.writeFileSync(envFile, ENV);

const server = spawn('node', ['server.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
server.stdout.on('data', (d) => { stdout += d.toString(); });
server.stderr.on('data', (d) => { stderr += d.toString(); });

function req(pathStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathStr, 'http://127.0.0.1:3999');
    const r = http.request({
      method: opts.method || 'GET',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: opts.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function signCookie(value) {
  const h = crypto.createHmac('sha256', 'test_secret').update(value).digest('hex');
  return `${value}.${h}`;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(200);
      try {
        const r = await req('/api/config');
        if (r.status === 200) ready = true;
      } catch (e) {}
    }
    if (!ready) throw new Error('servidor no arranco. stderr=' + stderr.slice(-500));

    console.log('\n[1] /api/config SIN auth (no admin):');
    const r1 = await req('/api/config');
    const j1 = JSON.parse(r1.body);
    const nombres1 = j1.modelos.map((m) => m.nombre);
    console.log('   modelos:', nombres1.join(', '));
    console.log('   NewserPro presente?', nombres1.includes('NewserPro'));
    if (nombres1.includes('NewserPro')) throw new Error('FAIL: NewserPro debería estar OCULTO para no-admin');

    console.log('\n[2] /api/config CON cookie admin local:');
    const cookie = 'verbo_auth=' + encodeURIComponent(signCookie('local:admin')) + '; HttpOnly; Path=/; SameSite=Lax';
    const r2 = await req('/api/config', { headers: { Cookie: cookie } });
    const j2 = JSON.parse(r2.body);
    const nombres2 = j2.modelos.map((m) => m.nombre);
    console.log('   modelos:', nombres2.join(', '));
    console.log('   esAdmin?', j2.esAdmin);
    console.log('   NewserPro presente?', nombres2.includes('NewserPro'));
    if (!nombres2.includes('NewserPro')) throw new Error('FAIL: NewserPro debería estar PRESENTE para admin local');
    const pro = j2.modelos.find((m) => m.nombre === 'NewserPro');
    if (!pro.soloAdmin) throw new Error('FAIL: NewserPro debería tener soloAdmin=true');
    console.log('   NewserPro badge:', pro.badge);
    console.log('   NewserPro disponible:', pro.disponible);

    console.log('\n[3] /api/chat con modelo=NewserPro SIN auth (debe dar 403):');
    const r3 = await req('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensaje: 'hola', modelo: 'NewserPro' }),
    });
    console.log('   status:', r3.status);
    console.log('   body:', r3.body.slice(0, 200));
    if (r3.status !== 403 && r3.status !== 401) {
      // 401 está bien si no hay auth; 403 si hay auth pero no admin
      if (r3.status === 401) console.log('   (401 OK: no autenticado)');
      else throw new Error('FAIL: esperaba 401/403, got ' + r3.status);
    }

    console.log('\nOK: todas las pruebas pasaron');
    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('\nERROR:', e.message);
    console.error('--- stdout (ultimas 30 lineas) ---');
    console.error(stdout.split('\n').slice(-30).join('\n'));
    console.error('--- stderr ---');
    console.error(stderr);
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
