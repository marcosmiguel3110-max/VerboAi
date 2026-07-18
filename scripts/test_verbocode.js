// Test de Verbo Code: verifica endpoints basicos
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV = `PORT=3993
GROQ_API_KEY=test
APP_USER=admin
APP_PASS=test
AUTH_SECRET=test_secret
ADMIN_EMAILS=a@b.com
EMAILS_AUTORIZADOS_API=a@b.com
`;

['api-tokens.json', 'historial.json', 'usuarios.json'].forEach((f) => {
  try { fs.unlinkSync(path.join(ROOT, 'memory', f)); } catch (e) {}
});
fs.writeFileSync(path.join(ROOT, 'memory', 'api-tokens.json'), JSON.stringify({
  tokens: [
    { id: 't-admin-1', nombre: 'admin', token: 'verboai-111111111111', propietario: 'local:admin', creditos: 1000, activo: true, creadoEn: new Date().toISOString(), ultimoUso: null },
  ],
}));
fs.writeFileSync(path.join(ROOT, 'memory', 'historial.json'), '{"chats":[]}');
fs.writeFileSync(path.join(ROOT, 'memory', 'usuarios.json'), '{}');
fs.writeFileSync(path.join(ROOT, '.env'), ENV);

const server = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
server.stdout.on('data', (d) => { stdout += d.toString(); });
server.stderr.on('data', (d) => { stderr += d.toString(); });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function req(pathStr, opts = {}) {
  return new Promise((resolve) => {
    const u = new URL(pathStr, 'http://127.0.0.1:3993');
    const cookie = opts.cookie || '';
    const r = http.request({
      method: opts.method || 'GET',
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { ...(opts.headers || {}), Cookie: cookie },
    }, (res) => {
      let b = ''; res.on('data', (c) => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', () => resolve({ status: 0, body: '' }));
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await sleep(300);
      try {
        const r = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:3993/api/config', (res) => { res.resume(); resolve({ status: res.statusCode }); });
          req.on('error', () => resolve({ status: 0 }));
          req.setTimeout(2000, () => { req.destroy(); resolve({ status: 0 }); });
        });
        if (r.status === 200) ready = true;
      } catch (e) {}
    }
    if (!ready) throw new Error('server no arranco: ' + stderr.slice(-300));

    // Generar cookie admin
    const h = crypto.createHmac('sha256', 'test_secret').update('local:admin').digest('hex');
    const cookie = 'verbo_auth=' + encodeURIComponent('local:admin.' + h) + '; HttpOnly; Path=/; SameSite=Lax';

    console.log('\n=== TEST 1: /verbocode/home/ sin auth ===');
    const t1 = await req('/verbocode/home/');
    console.log('  Status:', t1.status, '(esperado 401)');

    console.log('\n=== TEST 2: /verbocode/home/ con admin ===');
    const t2 = await req('/verbocode/home/', { cookie });
    console.log('  Status:', t2.status, '(esperado 200)');
    console.log('  Tiene HTML?', t2.body.includes('<!DOCTYPE html>'));

    console.log('\n=== TEST 3: GET /api/verbocode/models con admin ===');
    const t3 = await req('/api/verbocode/models', { cookie });
    console.log('  Status:', t3.status);
    try {
      const j = JSON.parse(t3.body);
      console.log('  Modelos:', (j.modelos || []).map(m => m.nombre).join(', '));
    } catch (e) { console.log('  Body:', t3.body.slice(0, 200)); }

    console.log('\n=== TEST 4: GET /api/verbocode/projects (vacío) ===');
    const t4 = await req('/api/verbocode/projects', { cookie });
    console.log('  Status:', t4.status);
    console.log('  Body:', t4.body.slice(0, 100));

    console.log('\n=== TEST 5: POST /api/verbocode/projects (crear) ===');
    const t5 = await req('/api/verbocode/projects', {
      method: 'POST',
      cookie,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Proyecto Test' }),
    });
    console.log('  Status:', t5.status);
    let proyectoId = null;
    try {
      const j = JSON.parse(t5.body);
      console.log('  ID:', j.proyecto?.id);
      console.log('  Nombre:', j.proyecto?.nombre);
      proyectoId = j.proyecto?.id;
    } catch (e) { console.log('  Body:', t5.body.slice(0, 200)); }

    if (proyectoId) {
      console.log('\n=== TEST 6: GET /api/verbocode/projects/:id ===');
      const t6 = await req(`/api/verbocode/projects/${proyectoId}`, { cookie });
      console.log('  Status:', t6.status);

      console.log('\n=== TEST 7: GET /verbocode/editor/:id/ ===');
      const t7 = await req(`/verbocode/editor/${proyectoId}/`, { cookie });
      console.log('  Status:', t7.status);

      console.log('\n=== TEST 8: DELETE /api/verbocode/projects/:id ===');
      const t8 = await req(`/api/verbocode/projects/${proyectoId}`, { method: 'DELETE', cookie });
      console.log('  Status:', t8.status);
    }

    console.log('\nOK: tests completados.');
    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('stderr:', stderr.slice(-500));
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
