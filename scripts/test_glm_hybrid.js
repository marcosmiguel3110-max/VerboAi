// Test del endpoint /api/v1/pro-hybrid
// Verifica:
// 1) Sin token -> 401
// 2) Con token no-admin -> 403
// 3) Con token admin + GLM deshabilitado -> usa Groq (esperamos 502 porque la API key es test)
// 4) Con token admin + GLM habilitado + URL invalida -> fallback a Groq (502 igual)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV_BASE = `PORT=3996
GROQ_API_KEY=test_key_invalid
APP_USER=admin
APP_PASS=test
AUTH_SECRET=test_secret
ADMIN_EMAILS=a@b.com
EMAILS_AUTORIZADOS_API=a@b.com
`;

function req(p, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, 'http://127.0.0.1:3996');
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

async function runTest(label, env, expectations) {
  // Reset memory files
  ['api-tokens.json', 'historial.json', 'usuarios.json'].forEach((f) => {
    try { fs.unlinkSync(path.join(ROOT, 'memory', f)); } catch (e) {}
  });
  fs.writeFileSync(path.join(ROOT, 'memory', 'api-tokens.json'), JSON.stringify({
    tokens: [
      { id: 't-admin-1', nombre: 'admin', token: 'verboai-111111111111', propietario: 'local:admin', creditos: 1000, activo: true, creadoEn: new Date().toISOString(), ultimoUso: null },
      { id: 't-user-1', nombre: 'user', token: 'verboai-222222222222', propietario: 'user@ejemplo.com', creditos: 1000, activo: true, creadoEn: new Date().toISOString(), ultimoUso: null },
    ],
  }));
  fs.writeFileSync(path.join(ROOT, 'memory', 'historial.json'), '{"chats":[]}');
  fs.writeFileSync(path.join(ROOT, 'memory', 'usuarios.json'), '{}');
  fs.writeFileSync(path.join(ROOT, '.env'), env);

  const server = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  server.stdout.on('data', (d) => { stdout += d.toString(); });
  server.stderr.on('data', (d) => { stderr += d.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(200);
      try { const r = await req('/api/config'); if (r.status === 200) ready = true; } catch (e) {}
    }
    if (!ready) throw new Error('server no arranco: ' + stderr.slice(-300));

    console.log(`\n=== ${label} ===`);
    for (const exp of expectations) {
      const r = await req(exp.path, exp.opts);
      const ok = exp.expectStatus ? r.status === exp.expectStatus : true;
      console.log(`  ${ok ? '✓' : '✗'} ${exp.desc}: status=${r.status} (esperado ${exp.expectStatus || '*'})`);
      if (!ok) console.log(`     body: ${r.body.slice(0, 200)}`);
    }
  } finally {
    server.kill('SIGKILL');
    await sleep(300);
  }
}

(async () => {
  // Test 1: GLM deshabilitado (default)
  await runTest('GLM deshabilitado (default)', ENV_BASE, [
    { desc: 'Sin token', path: '/api/v1/pro-hybrid', opts: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensaje: 'hola' }) }, expectStatus: 401 },
    { desc: 'Token user (no admin)', path: '/api/v1/pro-hybrid', opts: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verboai-222222222222' }, body: JSON.stringify({ mensaje: 'hola' }) }, expectStatus: 403 },
    { desc: 'Token admin, mensaje vacio', path: '/api/v1/pro-hybrid', opts: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verboai-111111111111' }, body: JSON.stringify({ mensaje: '' }) }, expectStatus: 400 },
    { desc: 'Token admin, mensaje ok (cae a Groq = 502 por key invalida)', path: '/api/v1/pro-hybrid', opts: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verboai-111111111111' }, body: JSON.stringify({ mensaje: 'que es la teoria de cuerdas' }) }, expectStatus: 502 },
  ]);

  // Test 2: GLM habilitado con URL inexistente -> fallback a Groq
  const envGlm = ENV_BASE + 'GPT4FREE_ENABLED_PRO=true\nGPT4FREE_URL=https://puente-inexistente-12345.onrender.com\nGPT4FREE_TIMEOUT=5000\n';
  await runTest('GLM habilitado pero puente caido (fallback a Groq)', envGlm, [
    { desc: 'Token admin, GLM cae, fallback Groq 502', path: '/api/v1/pro-hybrid', opts: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer verboai-111111111111' }, body: JSON.stringify({ mensaje: 'test' }) }, expectStatus: 502 },
  ]);

  console.log('\nOK: tests completados.');
  process.exit(0);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
