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
  imagenPendiente: null,        // base64 de imagen adjunta
  nombreImagenPendiente: null,  // nombre del archivo de imagen
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

        // Ejecutar usando Piston API
        const resp = await fetch('/api/verbocode/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lenguaje, codigo }),
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
  if (!texto && !estado.imagenPendiente) return;

  const rehabilitarInput = () => {
    try { input.disabled = false; } catch(e) {}
    try { btnEnviar.disabled = false; } catch(e) {}
    estado.chatEnProgreso = false;
    estado.imagenPendiente = null;
    estado.nombreImagenPendiente = null;
    try { input.focus(); } catch(e) {}
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

  // Limpiar elementos de peticiones anteriores que pudieron quedar
  const thinkingViejo = document.getElementById('thinkingIndicator');
  if (thinkingViejo && thinkingViejo.parentNode) thinkingViejo.remove();
  const invViejo = document.getElementById('investigandoIndicator');
  if (invViejo && invViejo.parentNode) invViejo.remove();

  const thinkingEl = document.createElement('div');
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
        } else if (evt.type === 'chunk') {
          textoRespuesta += evt.text;
          // Mostrar línea por línea: solo mostrar hasta el último salto de línea completo
          // Las líneas incompletas se guardan y se muestran cuando se completen
          const ultimaLinea = textoRespuesta.lastIndexOf('\n');
          if (ultimaLinea >= 0) {
            const textoVisible = textoRespuesta.slice(0, ultimaLinea + 1);
            const resto = textoRespuesta.slice(ultimaLinea + 1);
            msgDiv.innerHTML = formatearMarkdownConColapsado(textoVisible) + (resto ? '<span class="vc-typing-cursor">▋</span>' : '');
          } else {
            msgDiv.innerHTML = '<span class="vc-typing-cursor">▋</span>';
          }
          scrollChatAbajo();
        } else if (evt.type === 'action') {
          renderAccion(evt.accion);
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
          modeloRecibido = evt.modeloUsado || 'VerboAITeams';
          proyectoActualizado = evt.proyectoActualizado;
          archivosActualizados = evt.archivos;
          if (evt.plan) planRecibido = evt.plan;
          // Mostrar texto completo al terminar (incluye última línea)
          msgDiv.innerHTML = formatearMarkdownConColapsado(textoRespuesta);
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
    const msgError = { role: 'assistant', content: 'Error: ' + errorMsg + '\n\nIntentá de nuevo.', fecha: new Date().toISOString() };
    renderMensaje(msgError);
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
  
  // Convertir markdown básico (code blocks, inline code, bold)
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = formatearMarkdown(m.content || '');
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
