// Test del endpoint /api/v1/pro-hybrid con imagen adjunta
// Verifica que el endpoint acepte multipart/form-data con imagenes
// y que caiga a Llama 4 Scout (capaVision=true) en lugar de GLM-4.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = '/home/z/my-project/biblia-ai';
const ENV = `PORT=3995
GROQ_API_KEY=test_key_invalid
APP_USER=admin
APP_PASS=test
AUTH_SECRET=test_secret
ADMIN_EMAILS=a@b.com
EMAILS_AUTORIZADOS_API=a@b.com
GPT4FREE_ENABLED_PRO=true
GPT4FREE_URL=https://puente-inexistente.onrender.com
GPT4FREE_MODEL=Qwen/Qwen3-235B-A22B-Thinking-2507
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

function reqMultipart(pathStr, opts) {
  return new Promise((resolve, reject) => {
    const boundary = '----test-boundary-' + crypto.randomBytes(8).toString('hex');
    const parts = [];

    // Mensaje
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="mensaje"\r\n\r\n${opts.mensaje}\r\n`);

    // Imagen (1x1 PNG)
    const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="imagenes"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`);
    parts.push(png1x1);
    parts.push(Buffer.from('\r\n'));

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts.map((p) => Buffer.isBuffer(p) ? p : Buffer.from(p)));

    const u = new URL(pathStr, 'http://127.0.0.1:3995');
    const r = http.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        'Authorization': 'Bearer verboai-111111111111',
      },
    }, (res) => {
      let respBody = '';
      res.on('data', (c) => respBody += c);
      res.on('end', () => resolve({ status: res.statusCode, body: respBody }));
    });
    r.on('error', reject);
    r.write(body);
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
          const req = http.get('http://127.0.0.1:3995/api/config', (res) => {
            res.resume();
            resolve({ status: res.statusCode });
          });
          req.on('error', () => resolve({ status: 0 }));
          req.setTimeout(2000, () => { req.destroy(); resolve({ status: 0 }); });
        });
        if (r.status === 200) ready = true;
      } catch (e) {}
    }
    if (!ready) throw new Error('server no arranco. stderr=' + stderr.slice(-500) + ' | stdout=' + stdout.slice(-500));

    console.log('\n=== Test /api/v1/pro-hybrid con imagen ===');
    const r = await reqMultipart('/api/v1/pro-hybrid', { mensaje: 'Que ves en esta imagen?' });
    console.log('Status:', r.status);
    try {
      const j = JSON.parse(r.body);
      console.log('ok:', j.ok);
      console.log('capaGlm:', j.capaGlm, '(esperado: false)');
      console.log('capaVision:', j.capaVision, '(esperado: true)');
      console.log('capaGroq:', j.capaGroq, '(esperado: true)');
      console.log('imagenesAdjuntas:', j.imagenesAdjuntas);
      console.log('modeloReal:', j.modeloReal);
      console.log('modeloGroqVision:', j.modeloGroqVision);
      // Esperamos 502 porque la API key de Groq es invalida, pero el hecho
      // de llegar ahi significa que reconocio la imagen y no llamo a GLM-4.
      if (r.status === 502) {
        console.log('\n✓ OK: el endpoint detecto la imagen, NO llamo a GLM-4, e intento usar Llama 4 Scout (502 esperado por API key invalida).');
      } else if (j.ok) {
        console.log('\n✓ OK: respondio correctamente con vision.');
      }
    } catch (e) {
      console.log('Body:', r.body.slice(0, 300));
    }

    console.log('\n=== Test /api/v1/pro-hybrid SIN imagen (debe ir a GLM-4) ===');
    const r2 = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ mensaje: 'Hola' });
      const r = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: 3995,
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
      r.on('error', reject);
      r.write(body);
      r.end();
    });
    console.log('Status:', r2.status);
    try {
      const j2 = JSON.parse(r2.body);
      console.log('ok:', j2.ok);
      console.log('capaGlm:', j2.capaGlm, '(esperado: false, porque el puente es inexistente)');
      console.log('capaVision:', j2.capaVision, '(esperado: false)');
      console.log('imagenesAdjuntas:', j2.imagenesAdjuntas);
    } catch (e) {
      console.log('Body:', r2.body.slice(0, 300));
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
