/* ============================================================
   Verbo Code — Editor logic
   ============================================================ */

// Estado global
const estado = {
  proyectoId: null,
  proyecto: null,
  usuario: null,
  modeloSeleccionado: 'NewserPro',
  modelos: [],
  archivos: {},        // {nombre: contenido}
  archivoActual: null, // nombre del archivo activo
  monaco: null,        // instancia del editor Monaco
  monacoModels: {},    // {nombreArchivo: monacoModel}
  chatEnProgreso: false,
};

// ============================================================
// Inicialización
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  aplicarTema();
  // Extraer projectId de la URL: /verbocode/editor/<id>/
  const match = window.location.pathname.match(/\/verbocode\/editor\/([^/]+)/);
  if (!match) {
    alert('Falta el ID del proyecto');
    window.location.href = '/verbocode/home/';
    return;
  }
  estado.proyectoId = match[1];

  await cargarUsuario();
  await cargarProyecto();
  await cargarModelos();
  await initMonaco();
  configurarEventos();
  configurarChatInput();
});

function aplicarTema() {
  const tema = localStorage.getItem('verboAiTema') || 'default';
  if (tema === 'df-night') {
    document.documentElement.classList.add('tema-night');
  }
}

// ============================================================
// Usuario
// ============================================================
async function cargarUsuario() {
  try {
    const r = await fetch('/api/creditos');
    if (!r.ok) { window.location.href = '/login'; return; }
    estado.usuario = await r.json();
    if (!estado.usuario.esAdmin) {
      alert('Solo las cuentas administrador pueden usar Verbo Code');
      window.location.href = '/';
      return;
    }
  } catch (e) {
    window.location.href = '/login';
  }
}

// ============================================================
// Proyecto
// ============================================================
async function cargarProyecto() {
  try {
    const r = await fetch(`/api/verbocode/projects/${estado.proyectoId}`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || 'No se pudo cargar el proyecto');
    }
    const data = await r.json();
    estado.proyecto = data.proyecto;
    estado.archivos = estado.proyecto.archivos || {};

    document.getElementById('vcProyectoNombre').value = estado.proyecto.nombre;
    document.getElementById('vcProyectoNombre').disabled = false;

    renderArchivos();

    // Si no hay archivos, crear index.html por defecto
    if (Object.keys(estado.archivos).length === 0) {
      estado.archivos['index.html'] = '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n  <title>Mi Proyecto</title>\n</head>\n<body>\n  <h1>Hola Verbo Code</h1>\n  <p>Edita este archivo o pedile a la IA que cree algo.</p>\n</body>\n</html>';
      await guardarArchivos();
      renderArchivos();
    }

    // Abrir el primer archivo
    const primerArchivo = Object.keys(estado.archivos)[0];
    if (primerArchivo) abrirArchivo(primerArchivo);
  } catch (e) {
    alert(e.message);
    window.location.href = '/verbocode/home/';
  }
}

async function guardarArchivos() {
  try {
    await fetch(`/api/verbocode/projects/${estado.proyectoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: estado.proyecto.nombre,
        archivos: estado.archivos,
      }),
    });
  } catch (e) {
    console.error('Error guardando:', e);
  }
}

// ============================================================
// Modelos
// ============================================================
async function cargarModelos() {
  try {
    const r = await fetch('/api/verbocode/models');
    const data = await r.json();
    estado.modelos = data.modelos || [];
    renderModelos();
  } catch (e) {
    console.error('Error cargando modelos:', e);
  }
}

function renderModelos() {
  const cont = document.getElementById('vcModelos');
  if (!estado.modelos.length) {
    cont.innerHTML = '<div class="vc-loading-small">Sin modelos</div>';
    return;
  }
  cont.innerHTML = estado.modelos.map(m => {
    const activo = m.nombre === estado.modeloSeleccionado ? 'activo' : '';
    const badge = m.badge === 'pro'
      ? '<span class="vc-modelo-badge pro">Pro</span>'
      : m.badge === 'uno-punto-cinco'
        ? '<span class="vc-modelo-badge uno-punto-cinco">1.5</span>'
        : '';
    return `<div class="vc-modelo-item ${activo}" data-modelo="${m.nombre}">
      <span>${m.nombre}</span>
      ${badge}
    </div>`;
  }).join('');

  cont.querySelectorAll('.vc-modelo-item').forEach(item => {
    item.addEventListener('click', () => {
      estado.modeloSeleccionado = item.dataset.modelo;
      renderModelos();
    });
  });
}

// ============================================================
// Archivos
// ============================================================
function renderArchivos() {
  const cont = document.getElementById('vcArchivos');
  const nombres = Object.keys(estado.archivos).sort();
  if (nombres.length === 0) {
    cont.innerHTML = '<div class="vc-loading-small">Sin archivos</div>';
    return;
  }
  cont.innerHTML = nombres.map(nombre => {
    const activo = nombre === estado.archivoActual ? 'activo' : '';
    const icono = obtenerIconoArchivo(nombre);
    return `<div class="vc-archivo-item ${activo}" data-archivo="${nombre}">
      ${icono}
      <span class="vc-archivo-nombre">${nombre}</span>
      <button class="vc-archivo-delete" data-delete="${nombre}" title="Eliminar">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
      </button>
    </div>`;
  }).join('');

  cont.querySelectorAll('.vc-archivo-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.vc-archivo-delete')) return;
      abrirArchivo(item.dataset.archivo);
    });
  });

  cont.querySelectorAll('.vc-archivo-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nombre = btn.dataset.delete;
      if (!confirm(`¿Eliminar "${nombre}"?`)) return;
      delete estado.archivos[nombre];
      if (estado.archivoActual === nombre) {
        estado.archivoActual = null;
        const siguiente = Object.keys(estado.archivos)[0];
        if (siguiente) abrirArchivo(siguiente);
        else if (estado.monaco) estado.monaco.setValue('');
      }
      renderArchivos();
      await guardarArchivos();
    });
  });
}

function obtenerIconoArchivo(nombre) {
  const ext = nombre.split('.').pop().toLowerCase();
  const iconos = {
    html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    css: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    js: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    json: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    py: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  };
  return iconos[ext] || '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
}

function abrirArchivo(nombre) {
  if (!estado.archivos[nombre]) return;
  estado.archivoActual = nombre;
  renderArchivos();
  renderTabs();

  if (!estado.monaco) return;

  // Crear o reutilizar modelo de Monaco
  let model = estado.monacoModels[nombre];
  if (!model) {
    const lang = obtenerLenguajeMonaco(nombre);
    model = monaco.editor.createModel(estado.archivos[nombre], lang);
    model.onDidChangeContent(() => {
      estado.archivos[nombre] = model.getValue();
      // Auto-guardar con debounce
      clearTimeout(estado.debounceGuardar);
      estado.debounceGuardar = setTimeout(guardarArchivos, 1500);
    });
    estado.monacoModels[nombre] = model;
  } else {
    // Si el contenido cambió externamente (por la IA), actualizar el modelo
    if (model.getValue() !== estado.archivos[nombre]) {
      model.setValue(estado.archivos[nombre]);
    }
  }
  estado.monaco.setModel(model);
}

function obtenerLenguajeMonaco(nombre) {
  const ext = nombre.split('.').pop().toLowerCase();
  const map = {
    html: 'html', htm: 'html',
    css: 'css',
    js: 'javascript', mjs: 'javascript',
    ts: 'typescript',
    json: 'json',
    py: 'python',
    md: 'markdown',
    xml: 'xml',
    yaml: 'yaml', yml: 'yaml',
    sql: 'sql',
    sh: 'shell', bash: 'shell',
    java: 'java',
    c: 'c', cpp: 'cpp', h: 'cpp',
    go: 'go',
    rust: 'rust', rs: 'rust',
    php: 'php',
    rb: 'ruby',
  };
  return map[ext] || 'plaintext';
}

function renderTabs() {
  const cont = document.getElementById('vcTabs');
  if (!estado.archivoActual) {
    cont.innerHTML = '';
    return;
  }
  const nombre = estado.archivoActual;
  cont.innerHTML = `<div class="vc-tab activo">
    <span>${nombre}</span>
    <button class="vc-tab-close" title="Cerrar tab">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
    </button>
  </div>`;
}

// ============================================================
// Monaco Editor
// ============================================================
async function initMonaco() {
  return new Promise((resolve) => {
    require.config({
      paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' },
    });
    require(['vs/editor/editor.main'], () => {
      // Tema dark personalizado (combina con df-night)
      monaco.editor.defineTheme('verbo-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0f0f1a',
          'editor.lineHighlightBackground': '#1a1a2e',
          'editorLineNumber.foreground': '#4a4a65',
          'editorLineNumber.activeForeground': '#a855f7',
          'editor.selectionBackground': '#2a2a45',
          'editorCursor.foreground': '#a855f7',
        },
      });
      monaco.editor.setTheme('verbo-dark');

      estado.monaco = monaco.editor.create(document.getElementById('vcMonaco'), {
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        tabSize: 2,
        wordWrap: 'on',
        theme: 'verbo-dark',
      });

      resolve();
    });
  });
}

// ============================================================
// Eventos
// ============================================================
function configurarEventos() {
  // Editar nombre del proyecto
  const inputNombre = document.getElementById('vcProyectoNombre');
  inputNombre.addEventListener('change', async () => {
    const nuevo = inputNombre.value.trim();
    if (nuevo && nuevo !== estado.proyecto.nombre) {
      estado.proyecto.nombre = nuevo;
      await guardarArchivos();
      mostrarToast('Nombre actualizado', 'success');
    }
  });

  // Nuevo archivo
  document.getElementById('btnNuevoArchivo').addEventListener('click', () => {
    document.getElementById('modalNuevoArchivo').classList.remove('oculto');
    document.getElementById('inputNombreArchivo').value = '';
    document.getElementById('btnCrearArchivo').disabled = true;
    setTimeout(() => document.getElementById('inputNombreArchivo').focus(), 100);
  });

  document.getElementById('btnCancelarArchivo').addEventListener('click', () => {
    document.getElementById('modalNuevoArchivo').classList.add('oculto');
  });

  const inputArchivo = document.getElementById('inputNombreArchivo');
  inputArchivo.addEventListener('input', () => {
    document.getElementById('btnCrearArchivo').disabled = inputArchivo.value.trim().length < 3;
  });

  inputArchivo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !document.getElementById('btnCrearArchivo').disabled) crearArchivo();
    if (e.key === 'Escape') document.getElementById('modalNuevoArchivo').classList.add('oculto');
  });

  document.getElementById('btnCrearArchivo').addEventListener('click', crearArchivo);

  // Preview
  document.getElementById('btnPreview').addEventListener('click', mostrarPreview);
  document.getElementById('btnCerrarPreview').addEventListener('click', () => {
    document.getElementById('modalPreview').classList.add('oculto');
  });

  // Exportar
  document.getElementById('btnExportar').addEventListener('click', exportarProyecto);

  // Limpiar chat
  document.getElementById('btnLimpiarChat').addEventListener('click', () => {
    if (!confirm('¿Limpiar toda la conversación?')) return;
    estado.proyecto.chat = [];
    document.getElementById('vcChatMensajes').innerHTML = '<div class="vc-chat-bienvenida"><p>Conversación limpiada.</p></div>';
    guardarArchivos();
  });

  // Enviar chat
  document.getElementById('btnEnviarChat').addEventListener('click', enviarChat);
}

function crearArchivo() {
  const input = document.getElementById('inputNombreArchivo');
  const nombre = input.value.trim();
  if (nombre.length < 3) return;
  if (estado.archivos[nombre]) {
    mostrarToast('Ya existe un archivo con ese nombre', 'error');
    return;
  }
  estado.archivos[nombre] = '';
  document.getElementById('modalNuevoArchivo').classList.add('oculto');
  renderArchivos();
  abrirArchivo(nombre);
  guardarArchivos();
  mostrarToast('Archivo creado', 'success');
}

// ============================================================
// Chat
// ============================================================
function configurarChatInput() {
  const input = document.getElementById('vcChatInput');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarChat();
    }
  });

  // Renderizar chat existente
  if (estado.proyecto.chat && estado.proyecto.chat.length > 0) {
    const cont = document.getElementById('vcChatMensajes');
    cont.innerHTML = '';
    estado.proyecto.chat.forEach(m => renderMensaje(m));
    scrollChatAbajo();
  }
}

async function enviarChat() {
  if (estado.chatEnProgreso) return;
  const input = document.getElementById('vcChatInput');
  const texto = input.value.trim();
  if (!texto) return;

  // Render mensaje del usuario
  const msgUser = { role: 'user', content: texto, fecha: new Date().toISOString() };
  if (!estado.proyecto.chat) estado.proyecto.chat = [];
  estado.proyecto.chat.push(msgUser);
  renderMensaje(msgUser);

  input.value = '';
  input.disabled = true;
  document.getElementById('btnEnviarChat').disabled = true;
  estado.chatEnProgreso = true;

  // Indicador de "pensando"
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'vc-msg-thinking';
  thinkingEl.id = 'thinkingIndicator';
  thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> La IA está pensando...';
  document.getElementById('vcChatMensajes').appendChild(thinkingEl);
  scrollChatAbajo();

  try {
    const r = await fetch(`/api/verbocode/chat/${estado.proyectoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje: texto,
        modelo: estado.modeloSeleccionado,
      }),
    });

    thinkingEl.remove();

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || 'Error en la petición');
    }

    const data = await r.json();
    // Render respuesta de la IA
    const msgAssistant = { role: 'assistant', content: data.respuesta, fecha: new Date().toISOString() };
    estado.proyecto.chat.push(msgAssistant);
    renderMensaje(msgAssistant);

    // Render acciones (archivos creados/editados, imágenes, etc)
    if (data.acciones && data.acciones.length > 0) {
      data.acciones.forEach(accion => {
        renderAccion(accion);
      });
    }

    // Si la IA modificó archivos, recargar
    if (data.proyectoActualizado) {
      estado.archivos = data.archivos || estado.archivos;
      // Actualizar el editor si el archivo actual fue modificado
      if (estado.archivoActual && estado.monacoModels[estado.archivoActual]) {
        const nuevoContenido = estado.archivos[estado.archivoActual];
        if (estado.monacoModels[estado.archivoActual].getValue() !== nuevoContenido) {
          estado.monacoModels[estado.archivoActual].setValue(nuevoContenido);
        }
      }
      renderArchivos();
    }

    // Guardar chat
    await guardarArchivos();
  } catch (e) {
    thinkingEl.remove();
    mostrarToast(e.message, 'error');
    const msgError = { role: 'assistant', content: '❌ Error: ' + e.message, fecha: new Date().toISOString() };
    renderMensaje(msgError);
  } finally {
    input.disabled = false;
    document.getElementById('btnEnviarChat').disabled = false;
    estado.chatEnProgreso = false;
    input.focus();
  }
}

function renderMensaje(m) {
  const cont = document.getElementById('vcChatMensajes');
  const div = document.createElement('div');
  div.className = 'vc-msg ' + (m.role === 'user' ? 'user' : 'assistant');
  // Convertir markdown básico (code blocks, inline code, bold)
  div.innerHTML = formatearMarkdown(m.content || '');
  cont.appendChild(div);
  scrollChatAbajo();
}

function renderAccion(accion) {
  const cont = document.getElementById('vcChatMensajes');
  const div = document.createElement('div');
  div.className = 'vc-msg-accion';
  const icono = {
    file_create: '📁',
    file_edit: '✏️',
    file_delete: '🗑️',
    image: '🎨',
    web: '🌐',
    run: '▶',
  }[accion.tipo] || '✓';
  div.innerHTML = `${icono} ${accion.descripcion}`;
  cont.appendChild(div);
  scrollChatAbajo();
}

function formatearMarkdown(texto) {
  // Escapar HTML
  let html = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Code blocks ```lang\n...```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic *text*
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function scrollChatAbajo() {
  const cont = document.getElementById('vcChatMensajes');
  cont.scrollTop = cont.scrollHeight;
}

// ============================================================
// Preview
// ============================================================
function mostrarPreview() {
  if (!estado.archivos['index.html']) {
    mostrarToast('No hay index.html para previsualizar', 'error');
    return;
  }
  const frame = document.getElementById('vcPreviewFrame');
  let html = estado.archivos['index.html'];
  // Reemplazar CSS y JS inline
  if (estado.archivos['styles.css']) {
    html = html.replace(/<link[^>]*styles\.css[^>]*>/g, `<style>${estado.archivos['styles.css']}</style>`);
  }
  if (estado.archivos['script.js']) {
    html = html.replace(/<script[^>]*script\.js[^>]*><\/script>/g, `<script>${estado.archivos['script.js']}<\/script>`);
  }
  frame.srcdoc = html;
  document.getElementById('modalPreview').classList.remove('oculto');
}

// ============================================================
// Exportar (ZIP / MCPACK / JAR)
// ============================================================
async function exportarProyecto() {
  if (!window.JSZip) {
    mostrarToast('Error: JSZip no cargó', 'error');
    return;
  }
  const tipo = detectarTipoProyecto();
  const zip = new JSZip();

  // Agregar todos los archivos
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    zip.file(nombre, contenido);
  });

  // Si es Minecraft Bedrock, asegurar manifest.json
  if (tipo === 'mcaddon' && !estado.archivos['manifest.json']) {
    zip.file('manifest.json', JSON.stringify({
      format_version: 2,
      header: {
        name: estado.proyecto.nombre,
        description: 'Creado con Verbo Code',
        uuid: generarUUID(),
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0],
      },
      modules: [{
        type: 'data',
        uuid: generarUUID(),
        version: [1, 0, 0],
      }],
    }, null, 2));
  }

  // Generar el blob
  const blob = await zip.generateAsync({ type: 'blob' });

  // Nombre y extensión según tipo
  const nombreLimpio = estado.proyecto.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'proyecto';
  let extension = 'zip';
  let descripcion = 'ZIP';
  if (tipo === 'mcaddon') { extension = 'mcaddon'; descripcion = 'Minecraft Bedrock Addon'; }
  else if (tipo === 'jar') { extension = 'jar'; descripcion = 'Minecraft Java Mod'; }
  else if (tipo === 'datapack') { extension = 'zip'; descripcion = 'Minecraft Java Datapack'; }

  // Descargar
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombreLimpio}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  mostrarToast(`Descargado como ${descripcion}`, 'success');
}

function detectarTipoProyecto() {
  const archivos = Object.keys(estado.archivos);
  const nombresBajos = archivos.map(a => a.toLowerCase());
  const contenido = JSON.stringify(estado.archivos).toLowerCase();

  // Minecraft Bedrock (manifest.json con format_version)
  if (estado.archivos['manifest.json']) {
    try {
      const manifest = JSON.parse(estado.archivos['manifest.json']);
      if (manifest.format_version) return 'mcaddon';
    } catch (e) {}
  }
  // Minecraft Java mod (fabric.mod.json o META-INF)
  if (nombresBajos.includes('fabric.mod.json') || nombresBajos.some(n => n.startsWith('meta-inf/'))) {
    return 'jar';
  }
  // Minecraft Java datapack/resourcepack (pack.mcmeta)
  if (nombresBajos.includes('pack.mcmeta')) {
    return 'datapack';
  }
  // Buscar keywords en el contenido
  if (contenido.includes('minecraft') && contenido.includes('bedrock')) return 'mcaddon';
  if (contenido.includes('minecraft') && contenido.includes('java edition')) return 'jar';
  if (contenido.includes('minecraft') && contenido.includes('datapack')) return 'datapack';

  return 'zip';
}

function generarUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============================================================
// Helpers
// ============================================================
function mostrarToast(msg, tipo = '') {
  const toast = document.getElementById('vcToast');
  toast.textContent = msg;
  toast.className = 'vc-toast ' + tipo;
  setTimeout(() => toast.classList.add('oculto'), 3000);
}
