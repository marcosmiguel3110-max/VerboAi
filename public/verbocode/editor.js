/* ============================================================
   Verbo Code — Editor logic
   ============================================================ */

// Estado global
const estado = {
  proyectoId: null,
  proyecto: null,
  usuario: null,
  modeloSeleccionado: 'NewserPlus',
  modelos: [],
  archivos: {},        // {nombre: contenido}
  archivoActual: null, // nombre del archivo activo
  monaco: null,        // instancia del editor Monaco
  monacoModels: {},    // {nombreArchivo: monacoModel}
  chatEnProgreso: false,
  imagenPendiente: null,        // base64 de imagen adjunta
  nombreImagenPendiente: null,  // nombre del archivo de imagen
  modoDesign: false,            // modo Design (Canvas/3D) activado desde el botón del chat
  profundidad: 'medium',        // nivel de profundidad de código: medium | avanzado | extendido | ultracode
};

// ============================================================
// Inicialización
// ============================================================
// Resize de sidebars con el mouse: arrastrás la barrita entre paneles y el
// ancho se guarda en localStorage, así queda como lo dejaste la próxima vez
// que entrás. Los límites (min/max) evitan que se pueda dejar un panel
// inusable (0px o gigante tapando todo).
const VC_SIDEBAR_MIN = 160;
const VC_SIDEBAR_MAX = 560;
const VC_CHAT_MIN = 260;
const VC_CHAT_MAX = 680;

function configurarResizeSidebars() {
  const layout = document.querySelector('.vc-editor-layout');
  if (!layout) return;

  const anchoGuardado = JSON.parse(localStorage.getItem('vc_anchos_sidebar') || 'null') || {};
  let anchoSidebar = clamp(anchoGuardado.sidebar || 200, VC_SIDEBAR_MIN, VC_SIDEBAR_MAX);
  let anchoChat = clamp(anchoGuardado.chat || 360, VC_CHAT_MIN, VC_CHAT_MAX);

  const aplicarAnchos = () => {
    layout.style.gridTemplateColumns = `${anchoSidebar}px 6px 1fr 6px ${anchoChat}px`;
  };
  aplicarAnchos();

  const guardarAnchos = () => {
    localStorage.setItem('vc_anchos_sidebar', JSON.stringify({ sidebar: anchoSidebar, chat: anchoChat }));
  };

  document.querySelectorAll('.vc-resize-handle').forEach((handle) => {
    const tipo = handle.dataset.resize; // 'sidebar' o 'chat'
    handle.addEventListener('mousedown', (evStart) => {
      evStart.preventDefault();
      handle.classList.add('vc-resizing');
      document.body.classList.add('vc-resizing-activo');
      const inicioX = evStart.clientX;
      const inicioSidebar = anchoSidebar;
      const inicioChat = anchoChat;

      const onMove = (evMove) => {
        const delta = evMove.clientX - inicioX;
        if (tipo === 'sidebar') {
          anchoSidebar = clamp(inicioSidebar + delta, VC_SIDEBAR_MIN, VC_SIDEBAR_MAX);
        } else {
          anchoChat = clamp(inicioChat - delta, VC_CHAT_MIN, VC_CHAT_MAX);
        }
        aplicarAnchos();
      };
      const onUp = () => {
        handle.classList.remove('vc-resizing');
        document.body.classList.remove('vc-resizing-activo');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        guardarAnchos();
        if (estado.monaco && estado.monaco.layout) estado.monaco.layout();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      if (tipo === 'sidebar') anchoSidebar = 200; else anchoChat = 360;
      aplicarAnchos();
      guardarAnchos();
      if (estado.monaco && estado.monaco.layout) estado.monaco.layout();
    });
  });
}

function clamp(valor, min, max) {
  return Math.max(min, Math.min(max, valor));
}

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
  // IMPORTANTE: antes esto era `await initMonaco()` ANTES de configurar el
  // resto de la UI — si Monaco tardaba (o el CDN fallaba y había que esperar
  // el timeout completo), toda la página quedaba sin ningún botón ni el chat
  // funcionando durante ese tiempo, porque configurarEventos/configurarChatInput
  // ni siquiera se habían llamado todavía. Ahora el resto de la UI se activa
  // de una, y Monaco carga en paralelo sin bloquear nada.
  configurarEventos();
  configurarChatInput();
  configurarResizeSidebars();
  // Monaco es una librería pesada (parsear/ejecutar su JS le pega directo al
  // Total Blocking Time y al Time to Interactive del reporte de Lighthouse:
  // 380ms de TBT y 9.4s de TTI con FCP/LCP normales de 2.4s = síntoma
  // clásico de JS bloqueando el hilo principal DESPUÉS del primer pintado).
  // Ya no bloqueaba el resto de la UI (fix anterior), pero seguía arrancando
  // inmediato, compitiendo por el hilo principal justo cuando el navegador
  // todavía está pintando/procesando el resto de la página. Con
  // requestIdleCallback, arranca recién cuando el navegador tiene un hueco
  // libre de verdad — no cambia cuánto tarda Monaco en sí, pero saca ese
  // costo de la ventana crítica que Lighthouse mide.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => initMonaco(), { timeout: 2000 });
  } else {
    setTimeout(() => initMonaco(), 200);
  }

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
    localStorage.setItem('verboAiEsAdminVerboCode', estado.usuario.esAdmin ? 'true' : 'false');
    window.esUsuarioAdmin = !!estado.usuario.esAdmin;
    window.esUsuarioAdminVerboCode = !!estado.usuario.esAdmin;
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
  // Guarda para que, pase lo que pase, el require(['vs/editor/editor.main'])
  // de más abajo nunca se dispare dos veces en la misma carga de página — así
  // es como se producía el "Duplicate definition of module 'vs/editor/editor.main'"
  // (un módulo AMD no se puede registrar dos veces).
  if (window.__vcMonacoInitLanzado) return;
  window.__vcMonacoInitLanzado = true;

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

      // Timeout más corto que antes: como ya no bloquea el resto de la
      // página (el chat y los botones andan desde el vamos), no hace falta
      // esperar 15s para caer al fallback de textarea si el CDN falla.
      const timeout = setTimeout(() => {
        if (!estado.monaco) {
          console.warn('[verbocode] Monaco no cargó a tiempo, usando editor de texto simple.');
          initTextareaFallback();
          resolve();
        }
      }, 8000);

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

  // Botón imagen (subir imagen para que la IA la analice)
  document.getElementById('btnImagenChat').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        const chatInput = document.getElementById('vcChatInput');
        const promptActual = chatInput.value.trim();
        
        // Guardar la imagen en el estado para enviarla con el mensaje
        estado.imagenPendiente = base64;
        estado.nombreImagenPendiente = file.name;
        
        chatInput.value = promptActual ? `${promptActual}\n\n[Imagen adjunta: ${file.name}]` : `[Imagen adjunta: ${file.name}]`;
        chatInput.focus();
        mostrarToast('Imagen cargada. Presioná Enter para enviarla a la IA para análisis.', '');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  });

  // Botón Design (Canvas/3D): antes no tenía ningún listener, no hacía nada
  // al clickear. Ahora activa/desactiva "modo Design": prioriza canvas/three.js
  // y estética visual en lo que la IA genere hasta que se desactive de nuevo.
  // Antes esto mostraba un toast que desaparecía solo; ahora queda un tag
  // persistente arriba del textarea (@canvas) mientras el modo esté activo,
  // igual que con la profundidad (@extendido / @ultracode).
  const btnDesign = document.getElementById('btnDesign');
  if (btnDesign) {
    // Restaurar el modo Design tal como quedó la última vez (mismo criterio
    // que la profundidad) — si por lo que sea el estado en memoria se pierde
    // (ej. algo re-renderiza el composer sin querer), esto lo repone.
    estado.modoDesign = localStorage.getItem('vc_modo_design') === '1';
    btnDesign.classList.toggle('activo', estado.modoDesign);
    btnDesign.addEventListener('click', () => {
      estado.modoDesign = !estado.modoDesign;
      localStorage.setItem('vc_modo_design', estado.modoDesign ? '1' : '0');
      btnDesign.classList.toggle('activo', estado.modoDesign);
      actualizarTagsComposer();
    });
  }

  // Selector de profundidad (nuevo botón al lado de Preview)
  configurarSelectorProfundidad();

  // Botón terminal (abrir modal de terminal)
  document.getElementById('btnTerminal').addEventListener('click', () => {
    document.getElementById('modalTerminal').classList.remove('oculto');
    document.getElementById('vcTerminalInput').focus();
  });

  // Cerrar terminal
  document.getElementById('btnCerrarTerminal').addEventListener('click', () => {
    document.getElementById('modalTerminal').classList.add('oculto');
  });

  // Ejecutar comando en terminal
  document.getElementById('vcTerminalInput').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const input = e.target;
      const comando = input.value.trim();
      if (!comando) return;

      const output = document.getElementById('vcTerminalOutput');

      // clear/cls: se maneja acá mismo, sin ir al servidor.
      if (/^(clear|cls)$/i.test(comando)) {
        output.innerHTML = '';
        input.value = '';
        return;
      }

      // Mostrar comando ejecutado
      const cmdLine = document.createElement('div');
      cmdLine.className = 'vc-terminal-line command';
      cmdLine.textContent = `$ ${comando}`;
      output.appendChild(cmdLine);

      input.value = '';
      input.disabled = true;

      try {
        // Detectar lenguaje del comando
        let lenguaje = 'bash';
        let codigo = comando;

        if (comando.startsWith('python ') || comando.startsWith('python3 ')) {
          lenguaje = 'python';
          codigo = comando.replace(/^python3?\s+/, '');
        } else if (comando.startsWith('node ') || comando.startsWith('nodejs ')) {
          lenguaje = 'javascript';
          codigo = comando.replace(/^node(js)?\s+/, '');
        } else if (comando.startsWith('js ')) {
          lenguaje = 'javascript';
          codigo = comando.replace(/^js\s+/, '');
        }

        // Ejecutar: si es un comando de archivos (ls/cat/touch/rm/echo >/mv) se
        // aplica directo sobre el proyecto real; si no, se manda a Piston.
        const resp = await fetch('/api/verbocode/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lenguaje, codigo, proyectoId: estado.proyectoId }),
        });

        const data = await resp.json();

        if (data.exito) {
          const resultLine = document.createElement('div');
          resultLine.className = 'vc-terminal-line success';
          resultLine.textContent = data.stdout || '(sin salida)';
          output.appendChild(resultLine);

          if (data.stderr) {
            const errorLine = document.createElement('div');
            errorLine.className = 'vc-terminal-line error';
            errorLine.textContent = data.stderr;
            output.appendChild(errorLine);
          }

          // Si el comando tocó archivos del proyecto (touch/rm/echo>/mv), refrescar
          // el árbol de archivos y el editor abierto AL INSTANTE, sin esperar a la IA.
          if (data.archivosActualizados) {
            estado.archivos = data.archivosActualizados;
            estado.proyecto.archivos = data.archivosActualizados;
            renderArchivos();
            if (estado.archivoActual && !(estado.archivoActual in estado.archivos)) {
              const restante = Object.keys(estado.archivos)[0];
              if (restante) abrirArchivo(restante);
            } else if (estado.archivoActual && estado.monacoModels[estado.archivoActual]) {
              const nuevoContenido = estado.archivos[estado.archivoActual];
              if (nuevoContenido !== undefined && estado.monacoModels[estado.archivoActual].getValue() !== nuevoContenido) {
                estado.monacoModels[estado.archivoActual].setValue(nuevoContenido);
              }
            }
          }
        } else {
          const errorLine = document.createElement('div');
          errorLine.className = 'vc-terminal-line error';
          errorLine.textContent = data.error || 'Error al ejecutar comando';
          output.appendChild(errorLine);
        }
      } catch (e) {
        const errorLine = document.createElement('div');
        errorLine.className = 'vc-terminal-line error';
        errorLine.textContent = 'Error: ' + e.message;
        output.appendChild(errorLine);
      } finally {
        input.disabled = false;
        input.focus();
        output.scrollTop = output.scrollHeight;
      }
    }
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
// Tamaño (en caracteres) a partir del cual un archivo que la IA está
// escribiendo se considera "grande" y se muestra la card de "Compactando"
// con progreso en vez de volcar el texto crudo del tag al chat.
const UMBRAL_ARCHIVO_GRANDE = 1200;

// Busca el ÚLTIMO tag [[FILE_CREATE::/FILE_EDIT::nombre::]] que empezó mas
// no terminó todavía dentro del texto acumulado del stream. Si lo encuentra,
// devuelve dónde arranca el header, dónde termina (para poder contar
// caracteres reales escritos desde ahí) y el nombre de archivo/tipo.
function detectarBloqueEnCurso(texto) {
  // Antes esto solo reconocía FILE_CREATE/FILE_EDIT — cualquier otro tag
  // ([[TEXTURE::, [[IMAGE::, [[NPM_INSTALL::, etc) se mostraba crudo en vivo
  // mientras se generaba, porque no había nada que lo detectara. Ahora
  // reconoce CUALQUIER [[TAG:: sin importar cuántos campos tenga adentro.
  const re = /\[\[([A-Z_]+)::/g;
  let match, ultimo = null;
  while ((match = re.exec(texto)) !== null) ultimo = match;
  if (!ultimo) return null;
  const headerEnd = ultimo.index + ultimo[0].length;
  if (texto.indexOf(']]', headerEnd) !== -1) return null; // ya cerró, no está en curso
  const tipo = ultimo[1];
  // Para FILE_CREATE/FILE_EDIT el nombre de archivo es el primer campo (sirve
  // para la card de "Compactando" y para saber el tamaño de referencia en
  // ediciones). El resto de los tags no tienen esa estructura, así que se
  // ocultan igual pero sin nombre de archivo asociado.
  let archivo = null;
  if (tipo === 'FILE_CREATE' || tipo === 'FILE_EDIT') {
    const resto = texto.slice(headerEnd);
    const idxSep = resto.indexOf('::');
    if (idxSep !== -1) archivo = resto.slice(0, idxSep).trim();
  }
  return { tipo, archivo, headerStart: ultimo.index, headerEnd, cardEl: null };
}

// Nota: ya no hace falta una función separada para detectar bloques <think>
// en curso — con el rediseño de arriba, CUALQUIER texto que no sea parte de
// un tag [[ALGO::...]] en curso (esto incluye <think>) cae automáticamente
// en la rama de "narración" y va al indicador de pensando, nunca a msgDiv.

function crearCardCompactando(bloque) {
  const codeDiv = document.createElement('div');
  codeDiv.className = 'vc-msg-creando-codigo';
  codeDiv.innerHTML = `
    <div class="vc-creando-topbar">
      <span class="vc-creando-punto rojo"></span>
      <span class="vc-creando-punto amarillo"></span>
      <span class="vc-creando-punto verde"></span>
    </div>
    <div class="vc-creando-content">
      <div class="vc-creando-header">
        <span class="vc-creando-loading"></span>
        Compactando
        <span class="vc-creando-porcentaje"></span>
      </div>
      <div class="vc-creando-bar">
        <svg class="vc-creando-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <span class="vc-creando-archivo">${bloque.archivo || bloque.tipo.toLowerCase().replace('_', ' ')}</span>
      </div>
      <div class="vc-creando-scan"></div>
    </div>
  `;
  document.getElementById('vcChatMensajes').appendChild(codeDiv);
  scrollChatAbajo();
  return codeDiv;
}

// Actualiza la card con datos REALES: si es un FILE_EDIT de un archivo que
// ya conocemos (tenemos su tamaño anterior en estado.archivos), calculamos
// un % real (caracteres ya recibidos / tamaño anterior). Si es un archivo
// nuevo (FILE_CREATE) no hay forma honesta de saber el total final, así que
// en vez de inventar un número mostramos el tamaño real ya escrito en KB.
function actualizarCardCompactando(bloque, escritos) {
  const cardEl = bloque.cardEl;
  if (!cardEl) return;
  const porcentajeEl = cardEl.querySelector('.vc-creando-porcentaje');
  const scanEl = cardEl.querySelector('.vc-creando-scan');
  const archivoEl = cardEl.querySelector('.vc-creando-archivo');
  if (archivoEl && bloque.archivo) archivoEl.textContent = bloque.archivo;
  const refLen = (bloque.tipo === 'FILE_EDIT' && estado.archivos[bloque.archivo]) ? estado.archivos[bloque.archivo].length : null;
  if (refLen && refLen > 0) {
    const pct = Math.max(1, Math.min(99, Math.round((escritos / refLen) * 100)));
    porcentajeEl.textContent = pct + '%';
    scanEl.classList.add('real');
    scanEl.style.setProperty('--progreso', pct + '%');
  } else {
    porcentajeEl.textContent = (escritos / 1024).toFixed(1) + ' KB';
  }
  scrollChatAbajo();
}

function finalizarCardCompactando(cardEl) {
  if (!cardEl || !cardEl.parentNode) return;
  cardEl.classList.add('vc-creando-listo');
  const loadingEl = cardEl.querySelector('.vc-creando-loading');
  const porcentajeEl = cardEl.querySelector('.vc-creando-porcentaje');
  if (loadingEl) loadingEl.classList.add('vc-creando-loading-done');
  if (porcentajeEl) porcentajeEl.textContent = '100%';
  setTimeout(() => {
    cardEl.classList.add('vc-creando-colapsado');
    setTimeout(() => { if (cardEl.parentNode) cardEl.remove(); }, 350);
  }, 1200);
}

// Combina modo Design + nivel de profundidad en el/los tag(s) que se
// muestran arriba del textarea. Reglas pedidas: @canvas solo (Design sin
// profundidad especial), @extendido / @ultracode solo (profundidad sin
// Design), y @canvas-ultracode cuando las dos están activas a la vez con
// ultracode (mismo criterio para @canvas-extendido).
function actualizarTagsComposer() {
  const cont = document.getElementById('vcComposerTags');
  if (!cont) return;
  const tags = [];
  const nivel = estado.profundidad;
  const nivelConTag = nivel === 'extendido' || nivel === 'ultracode';

  if (estado.modoDesign && nivelConTag) {
    tags.push(`@canvas-${nivel}`);
  } else {
    if (estado.modoDesign) tags.push('@canvas');
    if (nivelConTag) tags.push(`@${nivel}`);
  }

  if (tags.length === 0) {
    cont.classList.add('oculto');
    cont.innerHTML = '';
    return;
  }
  cont.classList.remove('oculto');
  cont.innerHTML = tags.map((t) => `<span class="vc-composer-tag">${t}</span>`).join('');
}

const PROFUNDIDAD_INFO = [
  { nivel: 'medium', label: 'Medium', desc: 'Respuestas normales, rápidas.', desde: 0 },
  { nivel: 'avanzado', label: 'Avanzado', desc: 'Un poco más de cuidado en el código, sin cambiar mucho el tiempo de respuesta.', desde: 25 },
  { nivel: 'extendido', label: 'Extendido', desc: 'Más profundidad: arquitectura pensada, casos borde, más funcionalidad de la pedida literalmente.', desde: 50 },
  { nivel: 'ultracode', label: 'Ultracode', desc: 'El máximo nivel: código lo más completo y pulido posible, verifica lo que genera con la terminal. Consume mucho más — tiene su propio límite de uso.', desde: 75 },
];

function nivelDesdePosicion(pos) {
  let elegido = PROFUNDIDAD_INFO[0];
  for (const info of PROFUNDIDAD_INFO) {
    if (pos >= info.desde) elegido = info;
  }
  return elegido;
}

function configurarSelectorProfundidad() {
  const btn = document.getElementById('btnProfundidad');
  const popover = document.getElementById('vcProfundidadPopover');
  const slider = document.getElementById('vcProfundidadSlider');
  const fill = document.getElementById('vcProfundidadTrackFill');
  const label = document.getElementById('vcProfundidadLabel');
  const headerNivel = document.getElementById('vcProfundidadHeaderNivel');
  const desc = document.getElementById('vcProfundidadDesc');
  if (!btn || !popover || !slider) return;

  const aplicarPosicion = (pos, guardar) => {
    fill.style.width = pos + '%';
    const info = nivelDesdePosicion(pos);
    if (info.nivel !== estado.profundidad) {
      estado.profundidad = info.nivel;
      label.textContent = info.label;
      headerNivel.textContent = info.label;
      desc.textContent = info.desc;
      btn.classList.toggle('activo', info.nivel !== 'medium');
      actualizarTagsComposer();
    }
    if (guardar) localStorage.setItem('vc_profundidad_pos', pos);
  };

  // Restaurar la posición elegida la última vez (posición exacta del
  // slider, no solo el nivel, para que se sienta igual de "suave" al volver).
  const posGuardada = parseInt(localStorage.getItem('vc_profundidad_pos') || '0', 10);
  slider.value = Number.isFinite(posGuardada) ? posGuardada : 0;
  aplicarPosicion(parseInt(slider.value, 10), false);

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    popover.classList.toggle('oculto');
  });
  document.addEventListener('click', (ev) => {
    if (!popover.classList.contains('oculto') && !popover.contains(ev.target) && ev.target !== btn) {
      popover.classList.add('oculto');
    }
  });
  // 'input' dispara en cada frame del arrastre (no solo al soltar), por eso
  // el relleno de puntitos se mueve pegado al thumb — nada de saltos ni pasos.
  slider.addEventListener('input', () => aplicarPosicion(parseInt(slider.value, 10), false));
  slider.addEventListener('change', () => aplicarPosicion(parseInt(slider.value, 10), true));
}

// Card colapsable que agrupa las acciones (archivos creados/editados,
// comandos corridos, etc) de la respuesta que se está generando ahora. Tiene
// que ser una variable de módulo (no local a enviarChat) porque las
// funciones que la crean/actualizan/cierran están definidas afuera de esa
// función — antes esto tiraba "accionesGroupEl is not defined" y rompía
// CUALQUIER respuesta que tocara un archivo, a mitad de la generación.
let accionesGroupEl = null;

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
  const indicadorGenerando = document.getElementById('vcIndicadorGenerando');
  const texto = input.value.trim();
  if (!texto && !estado.imagenPendiente) return;
  // Declarado acá afuera (no dentro del try) para que el catch pueda verlo
  // y limpiar el contenido a medias si la generación se corta a mitad de
  // camino — si quedaba declarado con const adentro del try, el catch ni
  // siquiera podía referenciarlo.
  let msgDiv = null;
  accionesGroupEl = null; // por si un mensaje anterior falló antes de cerrar su propia card

  const rehabilitarInput = () => {
    try { input.disabled = false; } catch(e) {}
    try { btnEnviar.disabled = false; } catch(e) {}
    estado.chatEnProgreso = false;
    estado.imagenPendiente = null;
    estado.nombreImagenPendiente = null;
    try { input.focus(); } catch(e) {}
    // Ocultar indicador Generando Code
    if (indicadorGenerando) indicadorGenerando.classList.add('oculto');
    // Re-sincronizar los tags del composer (@canvas / @ultracode / etc) con
    // el estado real por las dudas — así, si algo los llegó a pisar durante
    // el ciclo de mensaje, quedan bien de nuevo apenas termina.
    actualizarTagsComposer();
  };

  const msgUser = { 
    role: 'user', 
    content: texto, 
    fecha: new Date().toISOString(),
    imagen: estado.imagenPendiente,
    nombreImagen: estado.nombreImagenPendiente,
  };
  if (!estado.proyecto.chat) estado.proyecto.chat = [];
  estado.proyecto.chat.push(msgUser);
  renderMensaje(msgUser);

  input.value = '';
  input.disabled = true;
  btnEnviar.disabled = true;
  estado.chatEnProgreso = true;

  // Mostrar indicador Generando Code
  if (indicadorGenerando) indicadorGenerando.classList.remove('oculto');

  // Limpiar elementos de peticiones anteriores que pudieron quedar
  const thinkingViejo = document.getElementById('thinkingIndicator');
  if (thinkingViejo && thinkingViejo.parentNode) thinkingViejo.remove();
  const invViejo = document.getElementById('investigandoIndicator');
  if (invViejo && invViejo.parentNode) invViejo.remove();

  let thinkingEl = document.createElement('div');
  thinkingEl.className = 'vc-msg-thinking';
  thinkingEl.id = 'thinkingIndicator';
  thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> Creando plan de acción...';
  document.getElementById('vcChatMensajes').appendChild(thinkingEl);
  scrollChatAbajo();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const bodyData = { 
      mensaje: texto, 
      modelo: estado.modeloSeleccionado,
      modoDesign: estado.modoDesign,
      profundidad: estado.profundidad,
    };
    
    if (estado.imagenPendiente) {
      bodyData.imagen = estado.imagenPendiente;
      bodyData.nombreImagen = estado.nombreImagenPendiente;
    }

    const r = await fetch(`/api/verbocode/chat/${estado.proyectoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!r.ok) {
      const errText = await r.text().catch(() => 'Error');
      try { const ej = JSON.parse(errText); throw new Error(ej.error || errText); } catch(_) { throw new Error(errText); }
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let textoRespuesta = '';
    let planRecibido = null;
    let modeloRecibido = 'VerboAITeams';
    let archivosActualizados = null;
    let proyectoActualizado = false;
    // Ver detectarBloqueEnCurso() / crearCardCompactando(): progreso REAL
    // (no simulado) de un archivo grande que la IA está escribiendo ahora.
    let bloqueActivo = null;

    msgDiv = document.createElement('div');
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
        let evt;
        try { evt = JSON.parse(line); } catch (e) { continue; }

        if (evt.type === 'status') {
          if (thinkingEl && thinkingEl.parentNode) {
            thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> ' + evt.text;
          }
        } else if (evt.type === 'plan') {
          planRecibido = evt.plan;
          if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
          const planDiv = document.createElement('div');
          planDiv.className = 'vc-msg-plan';
          planDiv.innerHTML = '<div class="vc-plan-header"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke-linecap="round" stroke-linejoin="round"/></svg> PLAN DE ACCIÓN</div><pre class="vc-plan-content"></pre>';
          document.getElementById('vcChatMensajes').appendChild(planDiv);
          scrollChatAbajo();
          // Efecto escritura NO BLOQUEANTE (no usa await para no frenar los chunks)
          const planPre = planDiv.querySelector('.vc-plan-content');
          let planIdx = 0;
          const planTexto = evt.plan;
          const planInterval = setInterval(() => {
            if (planIdx >= planTexto.length) {
              planPre.textContent = planTexto;
              clearInterval(planInterval);
              return;
            }
            planIdx += 2;
            planPre.textContent = planTexto.slice(0, planIdx);
            scrollChatAbajo();
          }, 8);
          // Después del plan viene la parte que más tarda (la generación real
          // del código, texturas, etc) — antes acá se borraba el indicador de
          // "pensando" y no quedaba NINGÚN feedback visual hasta que llegara
          // contenido real, así que en generaciones largas (sobre todo
          // Ultracode con texturas) la pantalla se veía completamente
          // congelada durante ese tramo, como si se hubiera colgado. Ahora
          // se vuelve a mostrar un indicador (se saca solo apenas aparece
          // contenido de verdad, más abajo en 'chunk'/'action').
          thinkingEl = document.createElement('div');
          thinkingEl.className = 'vc-msg-thinking';
          thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> Desarrollando código...';
          document.getElementById('vcChatMensajes').appendChild(thinkingEl);
          scrollChatAbajo();
        } else if (evt.type === 'chunk') {
          textoRespuesta += evt.text;

          // REDISEÑADO: antes esto trataba de calcular, char a char, qué
          // parte del texto era "segura" para mostrar en el mensaje — pero
          // el modelo no solo narra ANTES del primer tag, también narra
          // ENTRE tags ("Now let's create the HTML.", etc), y esa parte
          // intermedia se seguía colando porque solo se ocultaba lo de
          // antes del primer tag. En vez de perseguir cada lugar posible
          // donde puede aparecer narración, ahora la regla es simple y sin
          // huecos: msgDiv NUNCA se toca con contenido a medias mientras se
          // genera — todo el feedback en vivo (narración Y tags) pasa por
          // el indicador de "pensando" o por las cards de Compactando/
          // acciones. El mensaje final limpio llega de una sola vez en el
          // evento 'done' (ver más abajo), así que no hay forma de que se
          // cuele texto crudo a mitad de camino.
          if (!bloqueActivo) {
            const detectado = detectarBloqueEnCurso(textoRespuesta);
            if (detectado) bloqueActivo = detectado;
          } else if (!bloqueActivo.archivo && (bloqueActivo.tipo === 'FILE_CREATE' || bloqueActivo.tipo === 'FILE_EDIT')) {
            // El bloque ya se había detectado, pero en ese momento el nombre
            // de archivo todavía no había terminado de llegar por el stream
            // (solo llegó "[[FILE_CREATE::" y nada más todavía) — antes esto
            // quedaba pegado en null para siempre y la card mostraba
            // "file create" en vez del nombre real. Ahora se reintenta
            // extraerlo en cada chunk hasta que aparezca.
            const resto = textoRespuesta.slice(bloqueActivo.headerEnd);
            const idxSep = resto.indexOf('::');
            if (idxSep !== -1) bloqueActivo.archivo = resto.slice(0, idxSep).trim();
          }

          if (bloqueActivo) {
            const cerrado = textoRespuesta.indexOf(']]', bloqueActivo.headerEnd) !== -1;
            const escritos = textoRespuesta.length - bloqueActivo.headerEnd;

            if (cerrado) {
              if (bloqueActivo.cardEl) finalizarCardCompactando(bloqueActivo.cardEl);
              bloqueActivo = null;
            } else if (escritos > UMBRAL_ARCHIVO_GRANDE) {
              if (!bloqueActivo.cardEl) bloqueActivo.cardEl = crearCardCompactando(bloqueActivo);
              actualizarCardCompactando(bloqueActivo, escritos);
            } else if (thinkingEl && thinkingEl.parentNode) {
              // Bloque chico todavía en curso: mantener el indicador vivo
              // con el nombre del archivo en vez de dejarlo en blanco.
              thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> Escribiendo ' + (bloqueActivo.archivo || bloqueActivo.tipo.toLowerCase()) + '...';
            }
          } else {
            // No hay ningún tag en curso ahora mismo: lo que haya después
            // del último "]]" cerrado (o desde el principio si todavía no
            // cerró ninguno) es narración — mostrarla en el indicador, nunca
            // en el mensaje.
            const idxUltimoCierre = textoRespuesta.lastIndexOf(']]');
            const narracion = textoRespuesta.slice(idxUltimoCierre + 2).trim();
            if (narracion && thinkingEl && thinkingEl.parentNode) {
              thinkingEl.innerHTML = '<div class="vc-spinner" style="width:14px;height:14px;border-width:2px;"></div> ' + narracion.slice(-140);
              scrollChatAbajo();
            }
          }
        } else if (evt.type === 'action') {
          agregarAccionAlGrupo(evt.accion);
        } else if (evt.type === 'terminal_run') {
          // La IA está corriendo un comando de verdad AHORA MISMO. Prender el
          // punto rojo del botón de terminal y, si el modal está abierto,
          // mostrar el comando en vivo — igual que si lo hubiera tipeado el
          // usuario a mano.
          const dot = document.getElementById('vcTerminalDot');
          if (dot) dot.classList.remove('oculto');
          const output = document.getElementById('vcTerminalOutput');
          if (output) {
            const cmdLine = document.createElement('div');
            cmdLine.className = 'vc-terminal-line command';
            cmdLine.textContent = `$ ${evt.comando} (ejecutado por la IA)`;
            output.appendChild(cmdLine);
            output.scrollTop = output.scrollHeight;
          }
        } else if (evt.type === 'terminal_result') {
          const dot = document.getElementById('vcTerminalDot');
          if (dot) dot.classList.add('oculto');
          const output = document.getElementById('vcTerminalOutput');
          if (output) {
            const r = evt.resultado || {};
            if (r.stdout) {
              const okLine = document.createElement('div');
              okLine.className = 'vc-terminal-line success';
              okLine.textContent = r.stdout;
              output.appendChild(okLine);
            }
            if (r.stderr) {
              const errLine = document.createElement('div');
              errLine.className = 'vc-terminal-line error';
              errLine.textContent = r.stderr;
              output.appendChild(errLine);
            }
            output.scrollTop = output.scrollHeight;
          }
        } else if (evt.type === 'investigando') {
          // Limpiar indicador anterior si quedó sin cerrar
          const invViejo = document.getElementById('investigandoIndicator');
          if (invViejo && invViejo.parentNode) invViejo.remove();
          if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
          
          // Crear frame de investigación estilo ventana de navegador
          const invDiv = document.createElement('div');
          invDiv.className = 'vc-msg-investigando';
          invDiv.id = 'investigandoIndicator';
          invDiv.innerHTML = `
            <div class="vc-investigando-topbar">
              <span class="vc-investigando-punto rojo"></span>
              <span class="vc-investigando-punto amarillo"></span>
              <span class="vc-investigando-punto verde"></span>
            </div>
            <div class="vc-investigando-content">
              <div class="vc-investigando-header">
                <span class="vc-investigando-loading"></span>
                Buscando "${evt.query || '...'}" en webs
              </div>
              <div class="vc-investigando-bar">
                <svg class="vc-investigando-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>
                <span class="vc-investigando-sitio">Preparando búsqueda...</span>
              </div>
              <div class="vc-investigando-scan"></div>
            </div>
          `;
          document.getElementById('vcChatMensajes').appendChild(invDiv);
          scrollChatAbajo();
        } else if (evt.type === 'investigando_sitio') {
          const invEl = document.getElementById('investigandoIndicator');
          if (invEl) {
            const sitioEl = invEl.querySelector('.vc-investigando-sitio');
            const barraEl = invEl.querySelector('.vc-investigando-bar');
            
            // Actualizar icono según el sitio
            const iconoViejo = barraEl.querySelector('.vc-investigando-icon');
            if (iconoViejo) iconoViejo.remove();
            
            let icono = `<svg class="vc-investigando-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>`;
            if (/wikipedia/i.test(evt.sitio)) {
              icono = `<img class="vc-investigando-favicon" src="https://www.google.com/s2/favicons?domain=es.wikipedia.org&sz=64" alt="" />`;
            } else if (/biblia/i.test(evt.sitio)) {
              icono = `<svg class="vc-investigando-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`;
            }
            
            barraEl.insertAdjacentHTML('afterbegin', icono);
            sitioEl.textContent = evt.sitio;
          }
          scrollChatAbajo();
        } else if (evt.type === 'investigando_fin') {
          const invEl = document.getElementById('investigandoIndicator');
          if (invEl && invEl.parentNode) {
            invEl.classList.add('vc-investigando-listo');
            const headerEl = invEl.querySelector('.vc-investigando-header');
            const sitioEl = invEl.querySelector('.vc-investigando-sitio');
            const loadingEl = invEl.querySelector('.vc-investigando-loading');
            
            if (loadingEl) loadingEl.classList.add('vc-investigando-loading-done');
            headerEl.innerHTML = '<span class="vc-investigando-loading vc-investigando-loading-done"></span> Investigación completa';
            sitioEl.textContent = 'Listo ✓';
            
            setTimeout(() => {
              invEl.classList.add('vc-investigando-colapsado');
              setTimeout(() => invEl.remove(), 350);
            }, 1600);
          }
        } else if (evt.type === 'creando_codigo') {
          // Limpiar indicador anterior si quedó sin cerrar
          const codeViejo = document.getElementById('creandoCodigoIndicator');
          if (codeViejo && codeViejo.parentNode) codeViejo.remove();
          if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
          
          // Crear frame de creación de código
          const codeDiv = document.createElement('div');
          codeDiv.className = 'vc-msg-creando-codigo';
          codeDiv.id = 'creandoCodigoIndicator';
          codeDiv.innerHTML = `
            <div class="vc-creando-topbar">
              <span class="vc-creando-punto rojo"></span>
              <span class="vc-creando-punto amarillo"></span>
              <span class="vc-creando-punto verde"></span>
            </div>
            <div class="vc-creando-content">
              <div class="vc-creando-header">
                <span class="vc-creando-loading"></span>
                Creando código
              </div>
              <div class="vc-creando-bar">
                <svg class="vc-creando-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <span class="vc-creando-archivo">${evt.archivo || 'Generando...'}</span>
              </div>
              <div class="vc-creando-scan"></div>
            </div>
          `;
          document.getElementById('vcChatMensajes').appendChild(codeDiv);
          scrollChatAbajo();
        } else if (evt.type === 'creando_codigo_fin') {
          const codeEl = document.getElementById('creandoCodigoIndicator');
          if (codeEl && codeEl.parentNode) {
            codeEl.classList.add('vc-creando-listo');
            const headerEl = codeEl.querySelector('.vc-creando-header');
            const archivoEl = codeEl.querySelector('.vc-creando-archivo');
            const loadingEl = codeEl.querySelector('.vc-creando-loading');
            
            if (loadingEl) loadingEl.classList.add('vc-creando-loading-done');
            headerEl.innerHTML = '<span class="vc-creando-loading vc-creando-loading-done"></span> Código creado';
            archivoEl.textContent = 'Listo ✓';
            
            setTimeout(() => {
              codeEl.classList.add('vc-creando-colapsado');
              setTimeout(() => codeEl.remove(), 350);
            }, 1200);
          }
        } else if (evt.type === 'web_result') {
          // Mostrar resultados de la búsqueda web en el chat
          const webDiv = document.createElement('div');
          webDiv.className = 'vc-msg-accion';
          if (evt.resultados && evt.resultados.length > 0) {
            let html = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" stroke-linecap="round"/></svg> <span>Búsqueda web: "' + escapeHtmlPlan(evt.query) + '" → ' + evt.resultados.length + ' resultados</span>';
            // Mostrar los primeros 3 resultados
            const top3 = evt.resultados.slice(0, 3);
            for (const r of top3) {
              html += '<br><small style="opacity:0.7;margin-left:22px;">' + escapeHtmlPlan(r.titulo) + ' — ' + escapeHtmlPlan(r.resumen || '') + '</small>';
            }
            webDiv.innerHTML = html;
          } else {
            webDiv.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" stroke-linecap="round"/></svg> <span>Búsqueda web: "' + escapeHtmlPlan(evt.query) + '" → sin resultados</span>';
          }
          document.getElementById('vcChatMensajes').appendChild(webDiv);
          scrollChatAbajo();
        } else if (evt.type === 'done') {
          if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
          modeloRecibido = evt.modeloUsado || 'VerboAITeams';
          proyectoActualizado = evt.proyectoActualizado;
          archivosActualizados = evt.archivos;
          if (evt.plan) planRecibido = evt.plan;
          // Usar el texto LIMPIO que manda el server (sin tags crudos ni
          // bloques <think>) para el render final, en vez del buffer crudo
          // que se fue acumulando del streaming en vivo del lado del cliente.
          if (typeof evt.textoFinal === 'string') textoRespuesta = evt.textoFinal;
          msgDiv.innerHTML = formatearMarkdownConColapsado(textoRespuesta);
          finalizarGrupoAcciones();
          scrollChatAbajo();
          // Salir del while inmediatamente después de done
          break;
        } else if (evt.type === 'error') {
          throw new Error(evt.message);
        }
      }
    }

    if (modeloRecibido) {
      const meta = document.createElement('div');
      meta.className = 'vc-msg-meta';
      meta.textContent = '→ ' + modeloRecibido;
      msgDiv.appendChild(meta);
    }

    const msgAssistant = {
      role: 'assistant',
      content: textoRespuesta,
      fecha: new Date().toISOString(),
      modelo: modeloRecibido,
      plan: planRecibido,
    };
    estado.proyecto.chat.push(msgAssistant);

    if (proyectoActualizado && archivosActualizados) {
      estado.archivos = archivosActualizados;
      if (estado.archivoActual) {
        const nuevoContenido = estado.archivos[estado.archivoActual];
        if (nuevoContenido !== undefined && estado.monaco) {
          if (typeof monaco !== 'undefined' && estado.monaco.setModel) {
            if (estado.monacoModels[estado.archivoActual]) estado.monacoModels[estado.archivoActual].dispose();
            const model = monaco.editor.createModel(nuevoContenido, obtenerLenguajeMonaco(estado.archivoActual));
            model.onDidChangeContent(() => {
              estado.archivos[estado.archivoActual] = model.getValue();
              clearTimeout(estado.debounceGuardar);
              estado.debounceGuardar = setTimeout(guardarArchivos, 1500);
            });
            estado.monacoModels[estado.archivoActual] = model;
            estado.monaco.setModel(model);
          } else {
            estado.monaco.setValue(nuevoContenido);
          }
        }
      }
      renderArchivos();
    }

    await guardarArchivos();
  } catch (e) {
    if (thinkingEl && thinkingEl.parentNode) thinkingEl.remove();
    const errorMsg = e.name === 'AbortError' ? 'Timeout: el servidor tardó demasiado.' : e.message;
    mostrarToast(errorMsg, 'error');
    // BUG REAL encontrado acá: si la generación fallaba a mitad de camino
    // (después de ya haber recibido varios 'chunk' en vivo con texto crudo,
    // tags [[FILE_CREATE::...]] incluidos), el msgDiv que tenía ese texto
    // NUNCA se borraba ni se reemplazaba — se quedaba pegado en pantalla
    // para siempre con el tag crudo y todo el código adentro, mientras se
    // agregaba un mensaje de error APARTE (que además quedaba abajo, poco
    // visible). Ahora el error reemplaza directamente el contenido del
    // msgDiv que quedó a medias, en vez de dejarlo ahí y agregar uno nuevo.
    if (msgDiv && msgDiv.parentNode) {
      msgDiv.innerHTML = `<div class="vc-msg-error-inline">⚠ ${errorMsg}<br><span style="opacity:.75;font-size:12px">Se cortó la generación — probá pedirlo de nuevo, quizás con menos alcance de una.</span></div>`;
    } else {
      const msgError = { role: 'assistant', content: 'Error: ' + errorMsg + '\n\nIntentá de nuevo.', fecha: new Date().toISOString() };
      renderMensaje(msgError);
    }
    // Si había una card de acciones a medio armar (spinner "Trabajando..."
    // sin terminar nunca), sacarla del limbo en vez de dejarla girando para
    // siempre.
    if (accionesGroupEl && accionesGroupEl.parentNode) {
      const titulo = accionesGroupEl.querySelector('.vc-actions-titulo');
      if (titulo) titulo.textContent = (titulo.textContent || '') + ' (cortado)';
      accionesGroupEl.classList.remove('vc-actions-abierto');
    }
    accionesGroupEl = null;
  } finally {
    rehabilitarInput();
  }
}

function formatearMarkdownConColapsado(texto) {
  let html = texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const langLabel = lang || 'code';
    const codeId = 'code_' + Math.random().toString(36).substr(2, 9);
    return '<div class="vc-code-block"><div class="vc-code-header" onclick="toggleCodeBlock(\'' + codeId + '\')"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg><span>' + langLabel + '</span><span class="vc-code-toggle">colapsar</span></div><pre id="' + codeId + '" class="vc-code-content"><code>' + code.trim() + '</code></pre></div>';
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

window.toggleCodeBlock = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    el.previousElementSibling.querySelector('.vc-code-toggle').textContent = 'colapsar';
  } else {
    el.style.display = 'none';
    el.previousElementSibling.querySelector('.vc-code-toggle').textContent = 'expandir';
  }
};

function renderMensaje(m) {
  const cont = document.getElementById('vcChatMensajes');
  const div = document.createElement('div');
  div.className = 'vc-msg ' + (m.role === 'user' ? 'user' : 'assistant');
  
  // Si tiene imagen adjunta, mostrarla primero
  if (m.imagen) {
    const imgDiv = document.createElement('div');
    imgDiv.className = 'vc-msg-imagen';
    imgDiv.innerHTML = `<img src="${m.imagen}" alt="${m.nombreImagen || 'Imagen adjunta'}" />`;
    if (m.nombreImagen) {
      const imgLabel = document.createElement('div');
      imgLabel.className = 'vc-msg-imagen-label';
      imgLabel.textContent = m.nombreImagen;
      imgDiv.appendChild(imgLabel);
    }
    div.appendChild(imgDiv);
  }
  
  // Convertir markdown básico (code blocks colapsables, inline code, bold)
  // Usamos la MISMA función que en el streaming en vivo (formatearMarkdownConColapsado)
  // para que un mensaje recargado (ej. al reabrir el proyecto) se vea IGUAL que la
  // primera vez: bloques de código con su header/contenedor propio en vez de un
  // <pre> plano suelto, que es lo que causaba que el panel se viera "tapado" o
  // descuadrado la segunda vez que se abría la conversación.
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = formatearMarkdownConColapsado(m.content || '');
  div.appendChild(contentDiv);

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
    planDiv.innerHTML = '<div class="vc-plan-header"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" stroke-linecap="round" stroke-linejoin="round"/></svg> PLAN DE ACCIÓN</div><pre class="vc-plan-content">' + escapeHtmlPlan(m.plan) + '</pre>';
    div.appendChild(planDiv);
  }

  cont.appendChild(div);
  scrollChatAbajo();
}

function escapeHtmlPlan(texto) {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ICONOS_ACCION = {
  file_create: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  file_edit: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18l-3-3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  file_delete: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  texture: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18" stroke-linecap="round"/></svg>',
  web: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" stroke-linecap="round"/></svg>',
  run: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  npm_install: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  test: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const ICONO_ACCION_DEFAULT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';

// Antes cada acción (archivo creado, comando corrido, etc) se mostraba como
// una card separada, siempre abierta, una debajo de la otra — con un juego
// grande de 5-6 archivos quedaba un chorro larguísimo de cards en el chat.
// Ahora se agrupan todas en UNA sola card colapsable tipo resumen de commit
// (ver referencia: filename + "+N -M", terminando en "Listo"), igual que un
// panel de cambios — más compacto y más fácil de escanear de un vistazo.
function crearGrupoAcciones() {
  const cont = document.getElementById('vcChatMensajes');
  const card = document.createElement('div');
  card.className = 'vc-actions-card';
  card.innerHTML = `
    <button type="button" class="vc-actions-header">
      <svg class="vc-actions-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <div class="vc-spinner" style="width:12px;height:12px;border-width:2px;"></div>
      <span class="vc-actions-titulo">Trabajando...</span>
    </button>
    <div class="vc-actions-body"></div>
  `;
  card.querySelector('.vc-actions-header').addEventListener('click', () => {
    card.classList.toggle('vc-actions-abierto');
  });
  card.classList.add('vc-actions-abierto'); // abierta mientras se genera, para ver el progreso en vivo
  cont.appendChild(card);
  scrollChatAbajo();
  return card;
}

function agregarAccionAlGrupo(accion) {
  if (!accionesGroupEl) accionesGroupEl = crearGrupoAcciones();
  accionesGroupEl._acciones = accionesGroupEl._acciones || [];
  accionesGroupEl._acciones.push(accion);
  const body = accionesGroupEl.querySelector('.vc-actions-body');
  const icono = ICONOS_ACCION[accion.tipo] || ICONO_ACCION_DEFAULT;

  const row = document.createElement('div');
  row.className = 'vc-actions-row' + (accion.incompleto ? ' vc-actions-row-incompleto' : '');

  let statsHtml = '';
  if ((accion.tipo === 'file_create' || accion.tipo === 'file_edit') && (accion.agregadas || accion.eliminadas)) {
    statsHtml = `<span class="vc-actions-stats">${accion.agregadas ? `<span class="vc-actions-add">+${accion.agregadas}</span>` : ''}${accion.eliminadas ? `<span class="vc-actions-del">-${accion.eliminadas}</span>` : ''}</span>`;
  }

  let descHtml;
  if (accion.nombre && (accion.tipo === 'file_create' || accion.tipo === 'file_edit')) {
    const verbo = accion.tipo === 'file_create' ? 'Creó' : 'Editó';
    descHtml = `${verbo} <span class="vc-actions-file">${accion.nombre}</span>${statsHtml}`;
  } else {
    descHtml = accion.descripcion;
  }
  row.innerHTML = `${icono}<span class="vc-actions-desc">${descHtml}</span>`;
  body.appendChild(row);

  // Output real de comandos/tests, colapsado dentro de la misma fila
  if ((accion.tipo === 'run' || accion.tipo === 'test') && accion.resultado) {
    const r = accion.resultado;
    const output = r.stdout || (r.exito || !r.error ? '(sin output)' : '');
    const stderr = r.stderr || r.error ? `\n--- error ---\n${r.stderr || r.error}` : '';
    const pre = document.createElement('pre');
    pre.className = 'vc-actions-output';
    pre.textContent = (output + stderr).trim();
    body.appendChild(pre);
  }

  accionesGroupEl.querySelector('.vc-actions-titulo').textContent = `${body.children.length} cambio${body.children.length === 1 ? '' : 's'}`;
  scrollChatAbajo();
}

function finalizarGrupoAcciones() {
  if (!accionesGroupEl) return;
  const header = accionesGroupEl.querySelector('.vc-actions-header');
  const spinner = header.querySelector('.vc-spinner');
  if (spinner) spinner.outerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#4a9a5c" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
  const body = accionesGroupEl.querySelector('.vc-actions-body');
  const listo = document.createElement('div');
  listo.className = 'vc-actions-row vc-actions-row-listo';
  listo.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#4a9a5c" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg><span class="vc-actions-desc">Listo</span>';
  body.appendChild(listo);

  // Banner de éxito: cuando terminó de escribir/aplicar código de verdad
  // (creó o editó al menos un archivo), mostrar una confirmación clara de
  // que quedó implementado — en vez de que el usuario tenga que asumirlo
  // por la ausencia de errores. Si algún RUN/TEST quedó con error sin
  // resolver (el auto-fix se dio por vencido), no se muestra el banner de
  // éxito — mejor no decir "listo" si en realidad no lo está.
  const lista = accionesGroupEl._acciones || [];
  const huboArchivos = lista.some((a) => a.tipo === 'file_create' || a.tipo === 'file_edit');
  const huboErrorSinResolver = lista.some((a) => (a.tipo === 'run' || a.tipo === 'test') && a.resultado && a.resultado.exito === false);
  if (huboArchivos && !huboErrorSinResolver) {
    const banner = document.createElement('div');
    banner.className = 'vc-success-banner';
    const cantidadArchivos = new Set(lista.filter((a) => a.tipo === 'file_create' || a.tipo === 'file_edit').map((a) => a.nombre)).size;
    banner.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke-linecap="round" stroke-linejoin="round"/><polyline points="22 4 12 14.01 9 11.01" stroke-linecap="round" stroke-linejoin="round"/></svg> Implementado con éxito — ${cantidadArchivos} archivo${cantidadArchivos === 1 ? '' : 's'} listo${cantidadArchivos === 1 ? '' : 's'}.`;
    document.getElementById('vcChatMensajes').appendChild(banner);
  }

  // Colapsar sola después de un rato, igual que la card de "Investigando"
  setTimeout(() => accionesGroupEl && accionesGroupEl.classList.remove('vc-actions-abierto'), 1800);
  accionesGroupEl = null;
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
// ANTES esto exigía que existiera EXACTAMENTE "index.html", así que cualquier
// proyecto que no fuera "solo HTML" (por ejemplo un juego generado como
// archivo .html con otro nombre, o un experimento de canvas que es puro .js
// sin HTML) no tenía forma de previsualizarse: el botón tiraba error y no
// mostraba nada. Ahora se resuelve un "archivo de entrada" con fallbacks:
// 1) index.html si existe, 2) cualquier otro .html si existe, 3) si no hay
// NINGÚN .html pero sí hay .js (típico de un experimento de canvas rápido),
// se arma un HTML mínimo con <canvas> automáticamente para poder verlo igual.
function resolverArchivoEntradaPreview() {
  if (estado.archivos['index.html']) return 'index.html';
  const htmls = Object.keys(estado.archivos).filter((n) => n.toLowerCase().endsWith('.html'));
  if (htmls.length > 0) {
    // Preferir el .html más corto de ruta (probablemente el de nivel raíz)
    htmls.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
    return htmls[0];
  }
  return null;
}

function proyectoTieneCodigoPrevisualizable() {
  if (resolverArchivoEntradaPreview()) return true;
  return Object.keys(estado.archivos).some((n) => n.toLowerCase().endsWith('.js'));
}

function mostrarPreview() {
  if (!proyectoTieneCodigoPrevisualizable()) {
    mostrarToast('Todavía no hay nada previsualizable (falta un .html o .js)', 'error');
    return;
  }
  const frame = document.getElementById('vcPreviewFrame');
  const html = construirHtmlParaPreview();
  frame.srcdoc = html;
  document.getElementById('modalPreview').classList.remove('oculto');
}

function probarProyecto() {
  if (!proyectoTieneCodigoPrevisualizable()) {
    mostrarToast('Todavía no hay nada previsualizable (falta un .html o .js)', 'error');
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

// Construye el HTML combinando el archivo de entrada (index.html u otro
// .html, resuelto por resolverArchivoEntradaPreview) + todos los CSS/JS
// inline. Soporta archivos en carpetas y paquetes npm cargados desde esm.sh.
// Si no hay NINGÚN archivo .html, arma un wrapper mínimo alrededor de todo
// el JS/CSS del proyecto (para poder ver algo tipo "juego rápido de canvas"
// aunque la IA todavía no haya generado un HTML separado).
function construirHtmlParaPreview() {
  const entrada = resolverArchivoEntradaPreview();
  let html = entrada ? (estado.archivos[entrada] || '') : '';

  if (!entrada) {
    // Sin HTML: armar un wrapper básico con <canvas> a pantalla completa por
    // si el JS del proyecto dibuja directo sobre un canvas con id "canvas" o
    // similar, y además crea el suyo propio si hace falta (no estorba).
    html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${(estado.proyecto && estado.proyecto.nombre) || 'Preview'}</title>
<style>html,body{margin:0;padding:0;background:#0a0a0a;overflow:hidden;height:100%;}
canvas{display:block;width:100%;height:100%;}</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script>window.canvas = document.getElementById('canvas');<\/script>
</body>
</html>`;
  }

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
  const jsInsertados = new Set();
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    if (nombre.endsWith('.js') && nombre !== 'script.js') {
      const basename = nombre.split('/').pop();
      const reFullPath = new RegExp(`<script[^>]*src=["']${nombre.replace(/\//g, '\\/')}["'][^>]*><\\/script>`, 'g');
      const reBasename = new RegExp(`<script[^>]*src=["']${basename}["'][^>]*><\\/script>`, 'g');
      const esModulo = contenido.includes('import ') || contenido.includes('export ');
      const tag = esModulo ? `<script type="module">${contenido}<\/script>` : `<script>${contenido}<\/script>`;
      const huboMatch = reFullPath.test(html) || reBasename.test(html);
      html = html.replace(reFullPath, tag);
      html = html.replace(reBasename, tag);
      if (huboMatch) jsInsertados.add(nombre);
    }
  });
  if (estado.archivos['script.js']) {
    const js = estado.archivos['script.js'];
    const esModulo = js.includes('import ') || js.includes('export ');
    const tag = esModulo ? `<script type="module">${js}<\/script>` : `<script>${js}<\/script>`;
    const huboMatch = /<script[^>]*script\.js[^>]*><\/script>/.test(html);
    html = html.replace(/<script[^>]*script\.js[^>]*><\/script>/g, tag);
    if (huboMatch) jsInsertados.add('script.js');
  }

  // Si el HTML de entrada no referenciaba ALGUNO de los .js del proyecto
  // (por ejemplo la IA se olvidó del <script src>, o es el wrapper sin HTML
  // que armamos arriba), los inyectamos igual antes de </body> para que el
  // juego/experimento se vea en vez de quedar en blanco silenciosamente.
  Object.entries(estado.archivos).forEach(([nombre, contenido]) => {
    if (!nombre.endsWith('.js') || jsInsertados.has(nombre)) return;
    const esModulo = contenido.includes('import ') || contenido.includes('export ');
    const tag = esModulo ? `<script type="module">${contenido}<\/script>` : `<script>${contenido}<\/script>`;
    html = html.includes('</body>') ? html.replace('</body>', `${tag}\n</body>`) : html + tag;
  });

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