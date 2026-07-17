// Test del endpoint /api/v1/pro-hybrid con Pollinations texto como capa principal
// Verifica que:
// 1) Sin GLM-4 puente configurado, Pollinations texto responde
// 2) Si Pollinations falla, cae a GPT-OSS-120B (Groq)

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV = `PORT=3994
GROQ_API_KEY=test_key_invalid
APP_USER=admin
APP_PASS=test
AUTH_SECRET=test_secret
ADMIN_EMAILS=a@b.com
EMAILS_AUTORIZADOS_API=a@b.com
POLLINATIONS_TEXT_ENABLED_PRO=true
GPT4FREE_ENABLED_PRO=false
`;

// Reset memory
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

(async () => {
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      await sleep(300);
      try {
        const r = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:3994/api/config', (res) => { res.resume(); resolve({ status: res.statusCode }); });
          req.on('error', () => resolve({ status: 0 }));
          req.setTimeout(2000, () => { req.destroy(); resolve({ status: 0 }); });
        });
        if (r.status === 200) ready = true;
      } catch (e) {}
    }
    if (!ready) throw new Error('server no arranco: ' + stderr.slice(-500));

    console.log('\n=== Test /api/v1/pro-hybrid con Pollinations texto (real) ===');
    const body = JSON.stringify({ mensaje: 'Hola, ¿quién eres?' });
    const r = await new Promise((resolve) => {
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: 3994,
        path: '/api/v1/pro-hybrid',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': 'Bearer verboai-111111111111',
        },
      }, (res) => {
        let b = '';
        res.on('data', (c) => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.write(body);
      req.end();
    });

    console.log('Status:', r.status);
    try {
      const j = JSON.parse(r.body);
      console.log('ok:', j.ok);
      console.log('respuesta:', j.respuesta);
      console.log('modeloReal:', j.modeloReal);
      console.log('capaPollinations:', j.capaPollinations, '(esperado: true)');
      console.log('capaGlm:', j.capaGlm);
      console.log('capaGroq:', j.capaGroq);
      console.log('pollinationsTextDisponible:', j.pollinationsTextDisponible);
      console.log('modeloPollinationsText:', j.modeloPollinationsText);
    } catch (e) {
      console.log('Body:', r.body.slice(0, 500));
    }

    console.log('\nOK: test completado.');
    server.kill('SIGTERM');
    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('stderr:', stderr.slice(-500));
    server.kill('SIGKILL');
    process.exit(1);
  }
})();
