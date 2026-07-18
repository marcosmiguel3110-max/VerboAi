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

  // Guardar todo antes de cerrar la pestaña
  window.addEventListener('beforeunload', () => {
    if (estado.archivoActual && estado.monaco) {
      estado.archivos[estado.archivoActual] = estado.monaco.getValue();
      guardarArchivos();
    }
  });

  // Guardar cada 30 segundos por las dudas
  setInterval(() => {
    if (estado.archivoActual && estado.monaco) {
      estado.archivos[estado.archivoActual] = estado.monaco.getValue();
      guardarArchivos();
    }
  }, 30000);
});

function aplicarTema() {
  // Cargar el style.css de Verbo AI para tener los mismos fondos
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/style.css';
  document.head.appendChild(link);

  const tema = localStorage.getItem('verboAiTema') || 'default';
  if (tema === 'df-night') {
    document.documentElement.classList.add('tema-night');
  }
}

// ============================================================
// Usuario (con guardado en localStorage para próxima vez)
// ============================================================
async function cargarUsuario() {
  try {
    const r = await fetch('/api/creditos');
    if (!r.ok) { window.location.href = '/login'; return; }
    estado.usuario = await r.json();
    // Guardar en localStorage para que el botón Verbo Code del chat principal lo detecte
    localStorage.setItem('verboAiEsAdmin', estado.usuario.esAdmin ? 'true' : 'false');
    window.esUsuarioAdmin = !!estado.usuario.esAdmin;
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

  // Agrupar por carpeta
  const estructura = {};
  nombres.forEach(nombre => {
    const partes = nombre.split('/');
    if (partes.length === 1) {
      // Archivo en raíz
      if (!estructura['__root__']) estructura['__root__'] = [];
      estructura['__root__'].push(nombre);
    } else {
      // Archivo en subcarpeta
      const carpeta = partes[0];
      if (!estructura[carpeta]) estructura[carpeta] = [];
      estructura[carpeta].push(nombre);
    }
  });

  let html = '';

  // Archivos en raíz primero
  if (estructura['__root__']) {
    estructura['__root__'].forEach(nombre => {
      const activo = nombre === estado.archivoActual ? 'activo' : '';
      const icono = obtenerIconoArchivo(nombre);
      html += `<div class="vc-archivo-item ${activo}" data-archivo="${nombre}">
        <span class="vc-archivo-icono">${icono}</span>
        <span class="vc-archivo-nombre">${nombre.split('/').pop()}</span>
        <button class="vc-archivo-delete" data-delete="${nombre}" title="Eliminar">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    });
  }

  // Después carpetas
  Object.keys(estructura).sort().forEach(carpeta => {
    if (carpeta === '__root__') return;
    html += `<div class="vc-carpeta-item" data-carpeta="${carpeta}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span>${carpeta}</span>
      <span class="vc-carpeta-count">${estructura[carpeta].length}</span>
    </div>`;
    estructura[carpeta].forEach(nombre => {
      const activo = nombre === estado.archivoActual ? 'activo' : '';
      const icono = obtenerIconoArchivo(nombre);
      html += `<div class="vc-archivo-item vc-archivo-sub ${activo}" data-archivo="${nombre}">
        <span class="vc-archivo-icono">${icono}</span>
        <span class="vc-archivo-nombre">${nombre.split('/').pop()}</span>
        <button class="vc-archivo-delete" data-delete="${nombre}" title="Eliminar">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
        </button>
      </div>`;
    });
  });

  cont.innerHTML = html;

  // Eventos
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
    html: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    css: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    js: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    json: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    py: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    png: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    jpg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    jpeg: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return iconos[ext] || '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function abrirArchivo(nombre) {
  if (!estado.archivos[nombre]) return;
  estado.archivoActual = nombre;
  renderArchivos();
  renderTabs();

  if (!estado.monaco) return;

  // Si es Monaco real (tiene createModel y setModel)
  if (typeof monaco !== 'undefined' && estado.monaco.setModel) {
    // Siempre crear un modelo nuevo con el contenido actualizado.
    // Esto evita el bug de "no se puede abrir segundo archivo" que pasaba
    // cuando el modelo cacheado tenia contenido viejo y no se actualizaba.
    const lang = obtenerLenguajeMonaco(nombre);
    const contenido = estado.archivos[nombre];

    // Dispose del modelo viejo si existe (libera memoria)
    if (estado.monacoModels[nombre]) {
      estado.monacoModels[nombre].dispose();
    }

    // Crear modelo nuevo con el contenido actual
    const model = monaco.editor.createModel(contenido, lang);
    model.onDidChangeContent(() => {
      estado.archivos[nombre] = model.getValue();
      clearTimeout(estado.debounceGuardar);
      estado.debounceGuardar = setTimeout(guardarArchivos, 1500);
    });
    estado.monacoModels[nombre] = model;
    estado.monaco.setModel(model);
  } else {
    // Fallback textarea
    estado.monaco.setValue(estado.archivos[nombre]);
  }
}

function obtenerLenguajeMonaco(nombre) {
  // Tomar la extensión del archivo (la parte después del último punto)
  // Funciona con paths: "css/styles.css" → "css"
  const basename = nombre.split('/').pop();
  const ext = basename.split('.').pop().toLowerCase();
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
    mcmeta: 'json',  // Minecraft pack.mcmeta
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
  const basename = nombre.split('/').pop(); // Mostrar solo el nombre, no la carpeta
  cont.innerHTML = `<div class="vc-tab activo">
    <span class="vc-tab-nombre">${basename}</span>
    <button class="vc-tab-close" id="btnCerrarTab" title="Cerrar">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" stroke-linecap="round"/></svg>
    </button>
  </div>`;

  // Event listener para cerrar tab
  const btnCerrar = document.getElementById('btnCerrarTab');
  if (btnCerrar) {
    btnCerrar.addEventListener('click', (e) => {
      e.stopPropagation();
      estado.archivoActual = null;
      if (estado.monaco) {
        if (typeof monaco !== 'undefined' && estado.monaco.setModel) {
          estado.monaco.setModel(monaco.editor.createModel('', 'plaintext'));
        } else {
          estado.monaco.setValue('');
        }
      }
      renderArchivos();
      renderTabs();
    });
  }
}

// ============================================================
// Monaco Editor (con fallback a textarea si CDN falla)
// ============================================================
async function initMonaco() {
  return new Promise((resolve) => {
    // Verificar si el loader de Monaco está disponible
    if (typeof require === 'undefined' || typeof require.config !== 'function') {
      // Silencioso: no mostrar warning en consola para no molestar al usuario
      initTextareaFallback();
      resolve();
      return;
    }

    try {
      require.config({
        paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' },
      });

      // Timeout: si Monaco no carga en 15 segundos, usar fallback (silencioso)
      const timeout = setTimeout(() => {
        if (!estado.monaco) {
          initTextareaFallback();
          resolve();
        }
      }, 15000);

      require(['vs/editor/editor.main'], () => {
        clearTimeout(timeout);
        // Tema dark personalizado (combina con df-night)
        monaco.editor.defineTheme('verbo-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#1B1E29',
            'editor.lineHighlightBackground': '#242836',
            'editorLineNumber.foreground': '#4a4a65',
            'editorLineNumber.activeForeground': '#E08A5B',
            'editor.selectionBackground': '#383D50',
            'editorCursor.foreground': '#E08A5B',
          },
        });
        monaco.editor.defineTheme('verbo-light', {
          base: 'vs',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#FAF6EF',
            'editor.lineHighlightBackground': '#F0E9DC',
            'editorLineNumber.foreground': '#6B6155',
            'editorLineNumber.activeForeground': '#C9663A',
            'editor.selectionBackground': '#E9C8B4',
            'editorCursor.foreground': '#C9663A',
          },
        });

        // Elegir tema según localStorage
        const tema = localStorage.getItem('verboAiTema') || 'default';
        monaco.editor.setTheme(tema === 'df-night' ? 'verbo-dark' : 'verbo-light');

        estado.monaco = monaco.editor.create(document.getElementById('vcMonaco'), {
          automaticLayout: true,
          fontSize: 13,
          fontFamily: 'SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          tabSize: 2,
          wordWrap: 'on',
          theme: tema === 'df-night' ? 'verbo-dark' : 'verbo-light',
        });

        // ====== AUTO-SAVE COMPLETO ======
        // Guardar cuando cambia el contenido (debounce 1.5s)
        estado.monaco.onDidChangeModelContent(() => {
          if (estado.archivoActual) {
            estado.archivos[estado.archivoActual] = estado.monaco.getValue();
            clearTimeout(estado.debounceGuardar);
            estado.debounceGuardar = setTimeout(guardarArchivos, 1500);
          }
        });
        // Guardar al perder foco (por las dudas)
        estado.monaco.onDidBlurEditorText(() => {
          if (estado.archivoActual) {
            estado.archivos[estado.archivoActual] = estado.monaco.getValue();
            guardarArchivos();
          }
        });

        resolve();
      });
    } catch (e) {
      // Silencioso
      initTextareaFallback();
      resolve();
    }
  });
}

// Fallback: textarea simple si Monaco no carga
function initTextareaFallback() {
  const container = document.getElementById('vcMonaco');
  container.innerHTML = '<textarea id="vcTextareaFallback" style="width:100%;height:100%;border:none;outline:none;padding:12px;font-family:monospace;font-size:13px;resize:none;background:var(--vc-bg);color:var(--vc-text);"></textarea>';
  const textarea = document.getElementById('vcTextareaFallback');
  estado.monaco = {
    setValue: (v) => { textarea.value = v; },
    getValue: () => textarea.value,
    setModel: () => {},
  };
  textarea.addEventListener('input', () => {
    if (estado.archivoActual) {
      estado.archivos[estado.archivoActual] = textarea.value;
      clearTimeout(estado.debounceGuardar);
      estado.debounceGuardar = setTimeout(guardarArchivos, 1500);
    }
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

  // Probar (ejecutar HTML en nueva ventana full-screen)
  document.getElementById('btnProbar').addEventListener('click', probarProyecto);

  // Botón imagen (generar imagen y agregarla al proyecto)
  document.getElementById('btnImagenChat').addEventListener('click', () => {
    const input = document.getElementById('vcChatInput');
    const prompt = input.value.trim() || 'una imagen hermosa para mi proyecto';
    input.value = `Generame una imagen de: ${prompt}`;
    input.focus();
    mostrarToast('Vas a pedir una imagen. Presioná Enter para enviar.', '');
  });

  // Cerrar preview
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
  const btnEnviar = document.getElementById('btnEnviarChat');
  const texto = input.value.trim();
  if (!texto) return;

  // Función helper para rehabilitar el input SIEMPRE
  const rehabilitarInput = () => {
    try { input.disabled = false; } catch(e) {}
    try { btnEnviar.disabled = false; } catch(e) {}
    estado.chatEnProgreso = false;
    try { input.focus(); } catch(e) {}
  };

  // Render mensaje del usuario
  const msgUser = { role: 'user', content: texto, fecha: new Date().toISOString() };
  if (!estado.proyecto.chat) estado.proyecto.chat = [];
  estado.proyecto.chat.push(msgUser);
  renderMensaje(msgUser);

  input.value = '';
  input.disabled = true;
  btnEnviar.disabled = true;
  estado.chatEnProgreso = true;

  // Indicador de "pensando"
  const thinkingEl = document.createElement('div');
  thinkingEl.className = 'vc-msg-thinking';
  thinkingEl.id = 'thinkingIndicator';
  thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> La IA está pensando...';
  document.getElementById('vcChatMensajes').appendChild(thinkingEl);
  scrollChatAbajo();

  try {
    // Timeout del lado del cliente: 120 segundos (más tiempo para plan + código)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const r = await fetch(`/api/verbocode/chat/${estado.proyectoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensaje: texto,
        modelo: estado.modeloSeleccionado,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `Error ${r.status} en la petición`);
    }

    // Procesar respuesta SSE (streaming)
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textoRespuesta = '';
    let planRecibido = null;
    let modeloRecibido = 'VerboAITeams';
    let archivosActualizados = null;
    let proyectoActualizado = false;
    // Crear elemento del assistant vacío que vamos a ir llenando
    const msgDiv = document.createElement('div');
    msgDiv.className = 'vc-msg assistant';
    document.getElementById('vcChatMensajes').appendChild(msgDiv);
    scrollChatAbajo();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);

          if (evt.type === 'status') {
            // Actualizar indicador de "pensando"
            if (thinkingEl) {
              thinkingEl.innerHTML = `<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> ${evt.text}`;
            }
          } else if (evt.type === 'plan') {
            // Mostrar plan inmediatamente
            planRecibido = evt.plan;
            if (thinkingEl) thinkingEl.remove();
            const planDiv = document.createElement('div');
            planDiv.className = 'vc-msg-plan';
            planDiv.innerHTML = '<div class="vc-plan-header"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke-linecap="round" stroke-linejoin="round"/></svg> PLAN DE ACCIÓN</div><pre>' + escapeHtmlPlan(evt.plan) + '</pre>';
            document.getElementById('vcChatMensajes').appendChild(planDiv);
            scrollChatAbajo();
          } else if (evt.type === 'chunk') {
            // Texto de la respuesta (streaming)
            textoRespuesta += evt.text;
            msgDiv.innerHTML = formatearMarkdown(textoRespuesta);
            scrollChatAbajo();
          } else if (evt.type === 'action') {
            // Acción (archivo creado, imagen, etc)
            renderAccion(evt.accion);
          } else if (evt.type === 'done') {
            modeloRecibido = evt.modeloUsado || 'VerboAITeams';
            proyectoActualizado = evt.proyectoActualizado;
            archivosActualizados = evt.archivos;
            if (evt.plan) planRecibido = evt.plan;
          } else if (evt.type === 'error') {
            throw new Error(evt.message);
          }
        } catch (e) {
          // ignorar parse errors de líneas parciales
        }
      }
    }

    // Agregar meta del modelo al mensaje
    if (modeloRecibido) {
      const meta = document.createElement('div');
      meta.className = 'vc-msg-meta';
      meta.textContent = '→ ' + modeloRecibido;
      msgDiv.appendChild(meta);
    }

    // Guardar en el chat del proyecto
    const msgAssistant = {
      role: 'assistant',
      content: textoRespuesta,
      fecha: new Date().toISOString(),
      modelo: modeloRecibido,
      plan: planRecibido,
    };
    estado.proyecto.chat.push(msgAssistant);

    // Si la IA modificó archivos, actualizar
    if (proyectoActualizado && archivosActualizados) {
      estado.archivos = archivosActualizados;
      if (estado.archivoActual) {
        const nuevoContenido = estado.archivos[estado.archivoActual];
        if (nuevoContenido !== undefined) {
          if (typeof monaco !== 'undefined' && estado.monacoModels && estado.monacoModels[estado.archivoActual]) {
            if (estado.monacoModels[estado.archivoActual].getValue() !== nuevoContenido) {
              estado.monacoModels[estado.archivoActual].setValue(nuevoContenido);
            }
          } else if (estado.monaco) {
            estado.monaco.setValue(nuevoContenido);
          }
        }
      }
      renderArchivos();
    }

    await guardarArchivos();
  } catch (e) {
    if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
    const errorMsg = e.name === 'AbortError' ? 'Timeout: el servidor tardó demasiado en responder.' : e.message;
    mostrarToast(errorMsg, 'error');
    const msgError = { role: 'assistant', content: 'Error: ' + errorMsg + '\n\nIntentá de nuevo, ya podés escribir.', fecha: new Date().toISOString() };
    renderMensaje(msgError);
  } finally {
    rehabilitarInput();
  }
}

function renderMensaje(m) {
  const cont = document.getElementById('vcChatMensajes');
  const div = document.createElement('div');
  div.className = 'vc-msg ' + (m.role === 'user' ? 'user' : 'assistant');
  // Convertir markdown básico (code blocks, inline code, bold)
  div.innerHTML = formatearMarkdown(m.content || '');

  // Si es mensaje del assistant y tiene modelo, mostrarlo abajo
  if (m.role === 'assistant' && m.modelo) {
    const meta = document.createElement('div');
    meta.className = 'vc-msg-meta';
    meta.textContent = '→ ' + m.modelo;
    div.appendChild(meta);
  }

  // Si tiene plan, mostrarlo debajo de la burbuja como caja especial
  if (m.role === 'assistant' && m.plan) {
    const planDiv = document.createElement('div');
    planDiv.className = 'vc-msg-plan';
    planDiv.innerHTML = '<div class="vc-plan-header"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke-linecap="round" stroke-linejoin="round"/></svg> PLAN DE ACCIÓN</div><pre>' + escapeHtmlPlan(m.plan) + '</pre>';
    div.appendChild(planDiv);
  }

  cont.appendChild(div);
  scrollChatAbajo();
}

function escapeHtmlPlan(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderAccion(accion) {
  const cont = document.getElementById('vcChatMensajes');
  const div = document.createElement('div');
  div.className = 'vc-msg-accion';
  // Iconos SVG reales en vez de emojis
  const iconos = {
    file_create: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    file_edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18l-3-3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    file_delete: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    web: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" stroke-linecap="round"/></svg>',
    run: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    npm_install: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    test: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const icono = iconos[accion.tipo] || '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  div.innerHTML = `${icono} <span>${accion.descripcion}</span>`;
  cont.appendChild(div);

  // Si es un test con resultado, mostrar el output
  if (accion.tipo === 'test' && accion.resultado) {
    const resultDiv = document.createElement('div');
    resultDiv.className = 'vc-msg-accion vc-test-result';
    const output = accion.resultado.stdout || accion.resultado.error || '(sin output)';
    const stderr = accion.resultado.stderr ? `\n--- stderr ---\n${accion.resultado.stderr}` : '';
    resultDiv.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19" stroke-linecap="round"/></svg> <pre>${output}${stderr}</pre>`;
    cont.appendChild(resultDiv);
  }

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
// Preview (modal) y Probar (nueva ventana full-screen)
// ============================================================
function mostrarPreview() {
  if (!estado.archivos['index.html']) {
    mostrarToast('No hay index.html para previsualizar', 'error');
    return;
  }
  const frame = document.getElementById('vcPreviewFrame');
  const html = construirHtmlParaPreview();
  frame.srcdoc = html;
  document.getElementById('modalPreview').classList.remove('oculto');
}

function probarProyecto() {
  if (!estado.archivos['index.html']) {
    mostrarToast('No hay index.html para probar', 'error');
    return;
  }
  // Abrir en nueva ventana/pestaña con el HTML completo
  const html = construirHtmlParaPreview();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Limpiar la URL después de 1 minuto (la página ya cargó)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  mostrarToast('Abriendo proyecto en nueva pestaña...', '');
}

// Construye el HTML combinando index.html + todos los CSS/JS inline
// Soporta archivos en carpetas y paquetes npm cargados desde esm.sh CDN
function construirHtmlParaPreview() {
  let html = estado.archivos['index.html'] || '';

  // Cargar package.json y agregar imports de esm.sh para las dependencias
  let deps = {};
  try {
    const pkg = JSON.parse(estado.archivos['package.json'] || '{}');
    deps = pkg.dependencies || {};
  } catch (e) {}

  // Reemplazar imports de npm en el JS por URLs de esm.sh
  // Ej: import React from 'react' → import React from 'https://esm.sh/react'
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    if (nombre.endsWith('.js') || nombre.endsWith('.mjs')) {
      let nuevoContenido = contenido;
      // Reemplazar importaciones de paquetes npm conocidos
      Object.keys(deps).forEach(pkg => {
        const reImport = new RegExp(`from ['"]${pkg}['"]`, 'g');
        nuevoContenido = nuevoContenido.replace(reImport, `from 'https://esm.sh/${pkg}'`);
        const reImport2 = new RegExp(`import\\(['"]${pkg}['"]\\)`, 'g');
        nuevoContenido = nuevoContenido.replace(reImport2, `import('https://esm.sh/${pkg}')`);
      });
      estado.archivos[nombre] = nuevoContenido;
    }
  });

  // Reemplazar todas las referencias a archivos CSS del proyecto
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    if (nombre.endsWith('.css') && nombre !== 'styles.css') {
      const basename = nombre.split('/').pop();
      const reFullPath = new RegExp(`<link[^>]*href=["']${nombre.replace(/\//g, '\\/')}["'][^>]*>`, 'g');
      const reBasename = new RegExp(`<link[^>]*href=["']${basename}["'][^>]*>`, 'g');
      html = html.replace(reFullPath, `<style>${contenido}</style>`);
      html = html.replace(reBasename, `<style>${contenido}</style>`);
    }
  });
  if (estado.archivos['styles.css']) {
    html = html.replace(/<link[^>]*styles\.css[^>]*>/g, `<style>${estado.archivos['styles.css']}</style>`);
  }

  // Reemplazar todas las referencias a archivos JS del proyecto
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    if (nombre.endsWith('.js') && nombre !== 'script.js') {
      const basename = nombre.split('/').pop();
      const reFullPath = new RegExp(`<script[^>]*src=["']${nombre.replace(/\//g, '\\/')}["'][^>]*><\\/script>`, 'g');
      const reBasename = new RegExp(`<script[^>]*src=["']${basename}["'][^>]*><\\/script>`, 'g');
      const esModulo = contenido.includes('import ') || contenido.includes('export ');
      const tag = esModulo ? `<script type="module">${contenido}<\/script>` : `<script>${contenido}<\/script>`;
      html = html.replace(reFullPath, tag);
      html = html.replace(reBasename, tag);
    }
  });
  if (estado.archivos['script.js']) {
    const js = estado.archivos['script.js'];
    const esModulo = js.includes('import ') || js.includes('export ');
    const tag = esModulo ? `<script type="module">${js}<\/script>` : `<script>${js}<\/script>`;
    html = html.replace(/<script[^>]*script\.js[^>]*><\/script>/g, tag);
  }

  return html;
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

  // Agregar todos los archivos respetando la estructura de carpetas
  // Los nombres con "/" se interpretan como carpetas automáticamente por JSZip
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    // Saltar archivos .url (son referencias a imágenes generadas, no archivos reales)
    if (nombre.endsWith('.url')) return;
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
