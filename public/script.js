const elMensajes = document.getElementById('mensajes');
const elForm = document.getElementById('formChat');
const elInputTexto = document.getElementById('inputTexto');
const elInputImagen = document.getElementById('inputImagen');
const elIndicador = document.getElementById('indicadorCarga');
const elPreview = document.getElementById('previewNombreImagen');
const btnNuevoChat = document.getElementById('btnNuevoChat');
const btnBorrarMemoria = document.getElementById('btnBorrarMemoria');

const elFrameCuaderno = document.getElementById('frameCuaderno');
const elCuadernoLista = document.getElementById('cuadernoLista');
const btnCerrarCuaderno = document.getElementById('btnCerrarCuaderno');
const btnCuaderno = document.getElementById('btnCuaderno');
const btnAbrirBiblia = document.getElementById('btnAbrirBiblia');

const elModalBiblia = document.getElementById('modalBiblia');
const elTituloLibroCapitulo = document.getElementById('tituloLibroCapitulo');
const btnAbrirSelectorLibro = document.getElementById('btnAbrirSelectorLibro');
const btnCerrarSelectorLibro = document.getElementById('btnCerrarSelectorLibro');
const elSelectorLibro = document.getElementById('selectorLibro');
const elListaLibros = document.getElementById('listaLibros');
const elListaCapitulos = document.getElementById('listaCapitulos');
const btnCapAnterior = document.getElementById('btnCapAnterior');
const btnCapSiguiente = document.getElementById('btnCapSiguiente');
const elBibliaCuerpo = document.getElementById('biblaCuerpo');
const elAvisoMarcador = document.getElementById('biblaAvisoMarcador');
const btnCerrarBiblia = document.getElementById('btnCerrarBiblia');
const btnZoomMas = document.getElementById('btnZoomMas');
const btnZoomMenos = document.getElementById('btnZoomMenos');
const btnMarcarAqui = document.getElementById('btnMarcarAqui');

const elListaChats = document.getElementById('listaChats');

const elSidebar = document.getElementById('sidebar');
const elFondoSidebar = document.getElementById('fondoSidebar');
const btnToggleSidebar = document.getElementById('btnAbrirSidebarMovil');

function esVistaMovil() {
  return window.matchMedia('(max-width: 768px)').matches;
}
function abrirSidebarMovil() {
  elSidebar.classList.add('sidebar-abierto');
  elFondoSidebar.classList.remove('oculto');
  elFondoSidebar.classList.add('sidebar-abierto');
}
function cerrarSidebarMovil() {
  elSidebar.classList.remove('sidebar-abierto');
  elFondoSidebar.classList.remove('sidebar-abierto');
  setTimeout(() => elFondoSidebar.classList.add('oculto'), 200);
}
function alternarSidebar() {
  if (esVistaMovil()) {
    if (elSidebar.classList.contains('sidebar-abierto')) cerrarSidebarMovil();
    else abrirSidebarMovil();
  } else {
    elSidebar.classList.toggle('sidebar-colapsado');
  }
}
btnToggleSidebar.addEventListener('click', alternarSidebar);
elFondoSidebar.addEventListener('click', cerrarSidebarMovil);

const elLightbox = document.getElementById('lightbox');
const elLightboxImg = document.getElementById('lightboxImg');
const elLightboxCaption = document.getElementById('lightboxCaption');
const btnCerrarLightbox = document.getElementById('btnCerrarLightbox');

const overlayGenerandoImagen = document.getElementById('overlayGenerandoImagen');
const overlayGenerandoImagenPorcentaje = document.getElementById('overlayGenerandoImagenPorcentaje');
const overlayGenerandoImagenBarra = document.getElementById('overlayGenerandoImagenBarra');
const overlayGenerandoImagenPrompt = document.getElementById('overlayGenerandoImagenPrompt');
let overlayGenerandoImagenInterval = null;
let overlayGenerandoImagenProgreso = 0;

function mostrarOverlayGenerandoImagen(prompt) {
  if (!overlayGenerandoImagen) return;
  overlayGenerandoImagenProgreso = 0;
  if (overlayGenerandoImagenPorcentaje) overlayGenerandoImagenPorcentaje.textContent = '0%';
  if (overlayGenerandoImagenBarra) overlayGenerandoImagenBarra.style.width = '0%';
  if (overlayGenerandoImagenPrompt) overlayGenerandoImagenPrompt.textContent = prompt ? `"${prompt}"` : '';
  overlayGenerandoImagen.classList.remove('oculto');

  if (overlayGenerandoImagenInterval) clearInterval(overlayGenerandoImagenInterval);
  overlayGenerandoImagenInterval = setInterval(() => {

    const incremento = overlayGenerandoImagenProgreso < 50 ? 3
      : overlayGenerandoImagenProgreso < 80 ? 1.5
      : overlayGenerandoImagenProgreso < 90 ? 0.5
      : 0;
    if (incremento === 0) return;
    overlayGenerandoImagenProgreso = Math.min(90, overlayGenerandoImagenProgreso + incremento);
    if (overlayGenerandoImagenPorcentaje) overlayGenerandoImagenPorcentaje.textContent = Math.floor(overlayGenerandoImagenProgreso) + '%';
    if (overlayGenerandoImagenBarra) overlayGenerandoImagenBarra.style.width = overlayGenerandoImagenProgreso + '%';
  }, 500);
}

function ocultarOverlayGenerandoImagen() {
  if (!overlayGenerandoImagen) return;

  if (overlayGenerandoImagenPorcentaje) overlayGenerandoImagenPorcentaje.textContent = '100%';
  if (overlayGenerandoImagenBarra) overlayGenerandoImagenBarra.style.width = '100%';
  if (overlayGenerandoImagenInterval) {
    clearInterval(overlayGenerandoImagenInterval);
    overlayGenerandoImagenInterval = null;
  }

  setTimeout(() => {
    overlayGenerandoImagen.classList.add('oculto');
  }, 300);
}

let imagenesSeleccionadas = [];
let modoActual = localStorage.getItem('verboAiModo') || 'general';

let modeloActual = localStorage.getItem('verboAiModelo') || 'NewserLite';
let modelosDisponibles = [

  { nombre: 'NewserLite', descripcion: 'Rapido y liviano. Ideal para la mayoria de las consultas.', costoCreditos: 1, rateLimitMax: 20, rateLimitMaxWeb: 30 },
  { nombre: 'NewserAdvanced', descripcion: 'Mas potente. Genera imagenes, busca en la web y consulta el clima.', costoCreditos: 5, rateLimitMax: 5, rateLimitMaxWeb: 8, badge: 'beta', disponible: true },
  { nombre: 'NewserAdvanced1.5', descripcion: 'El mas potente. Razonamiento aun mas profundo antes de responder. Mejor en codigo: ejecuta codigo real y consulta APIs de prueba. Tambien genera imagenes con mas detalle (2 modelos de IA), maximo 2 por hora.', costoCreditos: 10, rateLimitMax: 3, rateLimitMaxWeb: 4, badge: 'pro', disponible: true },
  { nombre: 'NewserPro', descripcion: 'Exclusivo admin. Razonamiento profundo, ejecuta codigo real, busca en la web y genera imagenes en alta calidad. Mismo feature set que NewserAdvanced1.5.', costoCreditos: 0, rateLimitMax: 5, rateLimitMaxWeb: 6, badge: 'admin', disponible: true, soloAdmin: true },
];
let hayCuaderno = false;
let chatIdActual = localStorage.getItem('verboAiChatId') || null;

function fijarChatActual(id, opts = {}) {
  chatIdActual = id;
  if (id) localStorage.setItem('verboAiChatId', id);
  else localStorage.removeItem('verboAiChatId');

  // Refleja el UUID del chat en la barra de direcciones (https://tu-dominio/c/<uuid>).
  if (!opts.sinUrl) {
    const rutaNueva = id ? `/c/${id}` : '/';
    if (window.location.pathname !== rutaNueva) {
      window.history.pushState({ chatId: id || null }, '', rutaNueva);
    }
  }
}

function idChatDesdeUrl() {
  const m = window.location.pathname.match(/^\/c\/([a-zA-Z0-9-]+)$/);
  return m ? m[1] : null;
}

window.addEventListener('popstate', (ev) => {
  const id = (ev.state && ev.state.chatId) || idChatDesdeUrl();
  if (id && id !== chatIdActual) {
    cambiarDeChat(id);
  } else if (!id && chatIdActual) {
    iniciarNuevoChat(true);
  }
});

// Palabras reservadas reconocidas para el resaltado de bloques de codigo.
// Cubre los lenguajes mas comunes que la IA suele devolver en las respuestas.
const CODIGO_PALABRAS_CLAVE = new Set([
  'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'class', 'extends', 'new', 'this', 'import', 'export', 'from', 'default',
  'try', 'catch', 'finally', 'throw', 'async', 'await', 'typeof', 'instanceof', 'in', 'of', 'delete',
  'def', 'elif', 'pass', 'lambda', 'yield', 'with', 'as', 'del', 'global', 'nonlocal', 'raise', 'except',
  'public', 'private', 'protected', 'static', 'void', 'int', 'float', 'double', 'long', 'short', 'char',
  'string', 'bool', 'boolean', 'struct', 'enum', 'interface', 'implements', 'package', 'namespace',
  'using', 'include', 'fn', 'impl', 'trait', 'match', 'mod', 'pub', 'self', 'super', 'unsafe', 'go',
  'defer', 'chan', 'select', 'range', 'true', 'false', 'null', 'none', 'nil', 'undefined', 'not', 'and',
  'or', 'is', 'select', 'insert', 'update', 'delete', 'where', 'from', 'join', 'table', 'end', 'then',
]);

// Resalta un fragmento de codigo devolviendo HTML ya escapado, con spans
// segun el tipo de token (comentario, string, numero, funcion, palabra clave, variable).
function resaltarCodigo(codigo) {
  const tokenRe = /(\/\/[^\n]*|#[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)(\s*\()|([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let out = '';
  let ultimoIndice = 0;
  let m;
  while ((m = tokenRe.exec(codigo)) !== null) {
    out += escaparHtml(codigo.slice(ultimoIndice, m.index));
    const [, comentarioLinea, comentarioBloque, cadena, numero, funcNombre, funcParen, identificador] = m;
    if (comentarioLinea || comentarioBloque) {
      out += `<span class="tok-comentario">${escaparHtml(comentarioLinea || comentarioBloque)}</span>`;
    } else if (cadena) {
      out += `<span class="tok-string">${escaparHtml(cadena)}</span>`;
    } else if (numero) {
      out += `<span class="tok-numero">${escaparHtml(numero)}</span>`;
    } else if (funcNombre) {
      out += `<span class="tok-funcion">${escaparHtml(funcNombre)}</span>${escaparHtml(funcParen)}`;
    } else if (identificador) {
      if (CODIGO_PALABRAS_CLAVE.has(identificador.toLowerCase())) {
        out += `<span class="tok-keyword">${escaparHtml(identificador)}</span>`;
      } else {
        out += `<span class="tok-variable">${escaparHtml(identificador)}</span>`;
      }
    }
    ultimoIndice = tokenRe.lastIndex;
  }
  out += escaparHtml(codigo.slice(ultimoIndice));
  return out;
}

function renderizarTexto(textoPlano) {
  const lineas = textoPlano.replace(/\r\n/g, '\n').split('\n');
  const bloques = [];
  let listaActual = null;
  let citaActual = null;
  let codigoActual = null;

  const cerrarLista = () => { if (listaActual) { bloques.push(listaActual); listaActual = null; } };
  const cerrarCita = () => { if (citaActual) { bloques.push(citaActual); citaActual = null; } };

  const inline = (linea) => {

    let sinImagenes = linea.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '');
    let html = escaparHtml(sinImagenes);

    html = html.replace(
      /\[([^\[\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (m, texto, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${texto}</a>`
    );
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return convertirEnlaces(html);
  };

  for (const lineaOriginal of lineas) {
    const linea = lineaOriginal.trim();

    // Bloques de codigo delimitados por ``` (con lenguaje opcional despues de las comillas).
    const marcaCodigo = /^```\s*([A-Za-z0-9_+-]*)\s*$/.exec(linea);
    if (codigoActual) {
      if (marcaCodigo) {
        bloques.push({ tipo: 'codigo', lenguaje: codigoActual.lenguaje, codigo: codigoActual.lineas.join('\n') });
        codigoActual = null;
      } else {
        codigoActual.lineas.push(lineaOriginal);
      }
      continue;
    }
    if (marcaCodigo) {
      cerrarLista();
      cerrarCita();
      codigoActual = { lenguaje: marcaCodigo[1] || '', lineas: [] };
      continue;
    }

    if (/^>\s?/.test(linea)) {
      cerrarLista();
      if (!citaActual) citaActual = { tipo: 'cita', lineas: [] };
      citaActual.lineas.push(inline(linea.replace(/^>\s?/, '')));
      continue;
    }
    cerrarCita();

    if (/^[-*]\s+/.test(linea)) {
      if (!listaActual) listaActual = { tipo: 'lista', items: [] };
      listaActual.items.push(inline(linea.replace(/^[-*]\s+/, '')));
      continue;
    }
    cerrarLista();

    if (linea === '') {
      bloques.push({ tipo: 'espacio' });
    } else {
      bloques.push({ tipo: 'parrafo', html: inline(linea) });
    }
  }
  // Si el bloque de codigo quedo abierto (ej. texto llegando en streaming), lo cerramos igual.
  if (codigoActual) {
    bloques.push({ tipo: 'codigo', lenguaje: codigoActual.lenguaje, codigo: codigoActual.lineas.join('\n') });
    codigoActual = null;
  }
  cerrarLista();
  cerrarCita();

  let out = '';
  bloques.forEach((b, i) => {
    if (b.tipo === 'parrafo') {
      out += (out && bloques[i - 1] && bloques[i - 1].tipo === 'parrafo' ? '<br>' : '') + b.html;
    } else if (b.tipo === 'lista') {
      out += `<ul>${b.items.map((it) => `<li>${it}</li>`).join('')}</ul>`;
    } else if (b.tipo === 'cita') {
      out += `<blockquote>${b.lineas.join('<br>')}</blockquote>`;
    } else if (b.tipo === 'codigo') {
      const etiquetaLenguaje = b.lenguaje ? escaparHtml(b.lenguaje) : 'texto';
      out += `<pre class="bloque-codigo"><div class="bloque-codigo-barra"><span class="bloque-codigo-lenguaje">${etiquetaLenguaje}</span></div><code class="bloque-codigo-contenido">${resaltarCodigo(b.codigo)}</code></pre>`;
    } else if (b.tipo === 'espacio') {
      out += '<br><br>';
    }
  });
  return out;
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

const RE_URL = /((https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)'"\]])/gi;

function convertirEnlaces(htmlEscapado) {
  return htmlEscapado.replace(RE_URL, (match) => {
    const href = match.startsWith('http') ? match : `https://${match}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
  });
}

function crearBurbuja(rol, esError = false) {
  const div = document.createElement('div');
  div.className = `mensaje ${esError ? 'error' : rol === 'user' ? 'usuario' : 'ia'}`;
  elMensajes.appendChild(div);
  elMensajes.scrollTop = elMensajes.scrollHeight;
  return div;
}

function actualizarBurbujaPreservandoImagenes(burbuja, texto) {
  if (!burbuja) return;
  const elementosAPreservar = [];
  burbuja.querySelectorAll('.adjuntas-grid, .hoja-cuaderno, .fuentes-lista, .referencia-imagenes').forEach((el) => {
    elementosAPreservar.push(el.cloneNode(true));
  });
  burbuja.innerHTML = renderizarTexto(texto);
  elementosAPreservar.forEach((el) => {
    burbuja.appendChild(el);
  });
}

function pintarMensajeCompleto(rol, texto, imagenesUrls = null, esError = false) {
  const div = crearBurbuja(rol, esError);
  div.innerHTML = rol === 'user' || esError ? convertirEnlaces(escaparHtml(texto)) : renderizarTexto(texto);
  const urls = Array.isArray(imagenesUrls) ? imagenesUrls : imagenesUrls ? [imagenesUrls] : [];
  if (urls.length) {
    const grid = document.createElement('div');
    grid.className = 'adjuntas-grid';
    urls.forEach((url) => {
      const img = document.createElement('img');
      img.src = url;
      img.className = 'adjunta';
      img.addEventListener('click', () => abrirLightbox(url, ''));
      grid.appendChild(img);
    });
    div.appendChild(grid);
  }
  elMensajes.scrollTop = elMensajes.scrollHeight;
  return div;
}

async function cargarMemoria(chatId) {
  elMensajes.innerHTML = '';
  if (!chatId) return;
  try {
    const res = await fetch(`/api/memoria?chatId=${encodeURIComponent(chatId)}`);
    const historial = await res.json();
    historial.forEach((h) => pintarMensajeCompleto(h.role, h.contenidoTexto));
  } catch (e) {
    console.error('No se pudo cargar la memoria', e);
  }
}

let ultimosChatsCargados = [];

async function cargarListaChats() {
  try {
    const res = await fetch('/api/chats');
    const chats = await res.json();
    ultimosChatsCargados = chats;
    pintarListaChats(filtrarChatsPorBusqueda(chats));
    return chats;
  } catch (e) {
    console.error('No se pudo cargar la lista de chats', e);
    return [];
  }
}

function filtrarChatsPorBusqueda(chats) {
  const q = document.getElementById('buscarChats').value.trim().toLowerCase();
  if (!q) return chats;
  return chats.filter((c) => (c.titulo || '').toLowerCase().includes(q));
}

document.getElementById('buscarChats').addEventListener('input', () => {
  pintarListaChats(filtrarChatsPorBusqueda(ultimosChatsCargados));
});

function pintarListaChats(chats) {
  elListaChats.innerHTML = '';
  document.querySelectorAll('.menu-item-chat').forEach((m) => m.remove());
  if (!chats.length) {
    const vacio = document.createElement('p');
    vacio.className = 'lista-chats-vacio';
    vacio.textContent = 'Aun no hay conversaciones guardadas.';
    elListaChats.appendChild(vacio);
    return;
  }
  chats.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'item-chat' + (c.id === chatIdActual ? ' activo' : '');

    const titulo = document.createElement('span');
    titulo.className = 'item-chat-titulo';
    titulo.textContent = c.titulo || 'Conversacion';
    item.appendChild(titulo);

    const btnMenu = document.createElement('button');
    btnMenu.className = 'item-chat-menu';
    btnMenu.title = 'Mas opciones';
    btnMenu.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>';
    btnMenu.addEventListener('click', (ev) => {
      ev.stopPropagation();
      abrirMenuChat(c, btnMenu, titulo);
    });
    item.appendChild(btnMenu);

    item.addEventListener('click', () => cambiarDeChat(c.id));
    elListaChats.appendChild(item);
  });
}

const btnAbrirSettings = document.getElementById('btnAbrirSettings');
const overlaySettings = document.getElementById('overlaySettings');
const btnCerrarSettings = document.getElementById('btnCerrarSettings');

function aplicarModoUI() {
  document.querySelectorAll('.opcion-modo').forEach((op) => {
    op.classList.toggle('activa', op.dataset.modo === modoActual);
  });
}
aplicarModoUI();

document.querySelectorAll('.opcion-modo').forEach((boton) => {
  boton.addEventListener('click', () => {
    modoActual = boton.dataset.modo;
    localStorage.setItem('verboAiModo', modoActual);
    aplicarModoUI();
  });
});

document.querySelectorAll('.settings-nav-item').forEach((boton) => {
  boton.addEventListener('click', () => {
    document.querySelectorAll('.settings-nav-item').forEach((b) => b.classList.remove('activa'));
    boton.classList.add('activa');
    const seccion = boton.dataset.seccion;
    document.querySelectorAll('.settings-seccion').forEach((sec) => {
      sec.classList.toggle('oculto', sec.dataset.seccionPanel !== seccion);
    });
    if (seccion === 'creditos') {
      cargarCreditos();
      iniciarPollingCreditos();
    } else {
      detenerPollingCreditos();
    }
  });
});

let creditosPollingInterval = null;
let ultimoCreditosNumero = null;

async function cargarCreditos() {
  const elNumero = document.getElementById('creditosNumero');
  const elSub = document.getElementById('creditosSub');
  try {
    const r = await fetch('/api/creditos');
    if (!r.ok) {
      if (elNumero) elNumero.textContent = '?';
      if (elSub) elSub.textContent = 'No se pudo cargar.';
      return;
    }
    const d = await r.json();
    if (elNumero) {
      const nuevoTexto = d.esAdmin ? '\u221e' : String(d.creditos);
      if (ultimoCreditosNumero !== null && ultimoCreditosNumero !== nuevoTexto) {
        elNumero.classList.add('cambio');
        setTimeout(() => elNumero.classList.remove('cambio'), 300);
      }
      elNumero.textContent = nuevoTexto;
      ultimoCreditosNumero = nuevoTexto;
    }
    if (elSub) {
      if (d.esAdmin) elSub.textContent = 'Cuenta admin (ilimitados)';
      else if (d.creditosIniciales > 0) elSub.textContent = d.creditos + ' de ' + d.creditosIniciales + ' (' + Math.round((d.creditos / d.creditosIniciales) * 100) + '% disponible)';
      else elSub.textContent = '';
    }
    const stats = d.estadisticas || {};
    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setText('statTotalGastado', stats.totalGastado || 0);
    setText('statChats', stats.totalChats || 0);
    setText('statImagenes', stats.totalImagenes || 0);
    setText('statWeb', stats.totalBusquedasWeb || 0);
    setText('statClima', stats.totalClima || 0);
    setText('statActividad', stats.ultimaActividad ? formatearFechaCorta(stats.ultimaActividad) : '\u2014');
    const porModelo = stats.porModelo || {};
    const modelosUsados = Object.keys(porModelo).filter((k) => porModelo[k] > 0);
    const cont = document.getElementById('creditosPorModelo');
    const lista = document.getElementById('creditosPorModeloLista');
    if (cont && lista) {
      if (modelosUsados.length) {
        cont.style.display = 'block';
        lista.innerHTML = modelosUsados.map((m) => '<div class="creditos-por-modelo-item"><span class="creditos-por-modelo-nombre">' + escapeHtml(m) + '</span><span class="creditos-por-modelo-gasto">' + porModelo[m] + ' cr\u00e9ditos</span></div>').join('');
      } else cont.style.display = 'none';
    }
  } catch (e) {
    if (elNumero) elNumero.textContent = '?';
    if (elSub) elSub.textContent = 'Error de conexi\u00f3n';
  }
}

function formatearFechaCorta(iso) {
  if (!iso) return '\u2014';
  try {
    const f = new Date(iso);
    return f.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) + ' ' + f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

function iniciarPollingCreditos() { detenerPollingCreditos(); creditosPollingInterval = setInterval(cargarCreditos, 5000); }
function detenerPollingCreditos() { if (creditosPollingInterval) { clearInterval(creditosPollingInterval); creditosPollingInterval = null; } }

const btnRecargarCreditos = document.getElementById('btnRecargarCreditos');
const overlayAnuncioCreditos = document.getElementById('overlayAnuncioCreditos');
const anuncioCreditosTimer = document.getElementById('anuncioCreditosTimer');
const btnCerrarAnuncioCreditos = document.getElementById('btnCerrarAnuncioCreditos');
const anuncioCreditosContenedor = document.getElementById('anuncioCreditosContenedor');

// El <ins class="adsbygoogle"> tiene que crearse y "pushearse" de nuevo CADA VEZ que se
// abre el overlay. Antes estaba fijo en el HTML y AdSense solo lo procesaba una vez, en el
// primer load de la pagina, mientras el overlay estaba oculto (display:none) -> Google no
// renderiza anuncios dentro de contenedores ocultos, asi que quedaba vacio para siempre
// despues de esa unica pasada. Ahora se recrea el <ins> a mano y se llama a push() recien
// cuando el contenedor ya es visible.
function cargarAnuncioCreditos() {
  if (!anuncioCreditosContenedor) {
    console.error('[AdSense] Contenedor de anuncio no encontrado');
    return;
  }
  
  console.log('[AdSense] Iniciando carga de anuncio...');
  console.log('[AdSense] Contenedor visible:', !overlayAnuncioCreditos.classList.contains('oculto'));
  
  anuncioCreditosContenedor.innerHTML = '';

  const adClient = anuncioCreditosContenedor.dataset.adClient;
  const adSlot = anuncioCreditosContenedor.dataset.adSlot;
  
  console.log('[AdSense] Ad Client:', adClient);
  console.log('[AdSense] Ad Slot:', adSlot);

  // "ZZZZZZZZZZ" es un slot de ejemplo/placeholder, no un ID real de AdSense: reemplazalo
  // por el ID real que te da Google en tu panel de AdSense (Anuncios -> Por unidad de anuncio),
  // si no el anuncio nunca va a cargar (AdSense rechaza slots invalidos silenciosamente).
  if (!adSlot || adSlot === 'ZZZZZZZZZZ') {
    console.error('[AdSense] Slot no configurado o es placeholder');
    anuncioCreditosContenedor.innerHTML = '<div class="anuncio-creditos-placeholder">Anuncio no configurado (falta el ID real de la unidad de anuncio de AdSense).</div>';
    return;
  }

  // Agregar timestamp único para forzar que AdSense trate el slot como nuevo cada vez
  const timestamp = Date.now();
  const uniqueId = `adsense-${timestamp}`;

  const ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.id = uniqueId;
  ins.style.display = 'block';
  ins.style.width = '336px';
  ins.style.height = '280px';
  ins.setAttribute('data-ad-client', adClient);
  ins.setAttribute('data-ad-slot', adSlot);
  ins.setAttribute('data-ad-format', 'auto');
  ins.setAttribute('data-full-width-responsive', 'true');
  ins.setAttribute('data-ad-break-test', 'on'); // Forzar recarga
  anuncioCreditosContenedor.appendChild(ins);

  console.log('[AdSense] Elemento <ins> creado con ID:', uniqueId);
  console.log('[AdSense] Elemento <ins> en DOM:', document.getElementById(uniqueId) !== null);

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
    console.log(`[AdSense] push() ejecutado para ID: ${uniqueId}`);
    console.log('[AdSense] Total adsbygoogle en array:', window.adsbygoogle.length);
  } catch (e) {
    console.error('[AdSense] Error al ejecutar push():', e);
  }
  
  // Verificar después de 2 segundos si el anuncio se cargó
  setTimeout(() => {
    const insElement = document.getElementById(uniqueId);
    if (insElement) {
      console.log('[AdSense] Estado después de 2s - innerHTML length:', insElement.innerHTML.length);
      console.log('[AdSense] Estado después de 2s - tiene hijos:', insElement.children.length > 0);
      console.log('[AdSense] Estado después de 2s - innerHTML preview:', insElement.innerHTML.substring(0, 200));
      console.log('[AdSense] Estado después de 2s - computed display:', window.getComputedStyle(insElement).display);
      console.log('[AdSense] Estado después de 2s - computed visibility:', window.getComputedStyle(insElement).visibility);
      console.log('[AdSense] Estado después de 2s - computed opacity:', window.getComputedStyle(insElement).opacity);
      console.log('[AdSense] Estado después de 2s - computed z-index:', window.getComputedStyle(insElement).zIndex);
      console.log('[AdSense] Estado después de 2s - offsetHeight:', insElement.offsetHeight);
      console.log('[AdSense] Estado después de 2s - offsetWidth:', insElement.offsetWidth);
    } else {
      console.error('[AdSense] Elemento <ins> desapareció después de 2s');
    }
  }, 2000);
}

if (btnRecargarCreditos) {
  btnRecargarCreditos.addEventListener('click', () => {
    if (btnRecargarCreditos.disabled) return; // evita doble click -> doble push() a AdSense
    btnRecargarCreditos.disabled = true;
    if (overlayAnuncioCreditos) overlayAnuncioCreditos.classList.remove('oculto');
    if (btnCerrarAnuncioCreditos) btnCerrarAnuncioCreditos.classList.add('oculto');
    if (anuncioCreditosTimer) anuncioCreditosTimer.textContent = 'Espera 5 segundos...';
    // Se genera el anuncio recien aca, con el overlay ya visible, para que AdSense pueda
    // medir el contenedor y renderizar de verdad (y para que cada apertura pida uno nuevo).
    setTimeout(cargarAnuncioCreditos, 50);
    var seg = 5;
    var interval = setInterval(() => {
      seg--;
      if (seg > 0) {
        if (anuncioCreditosTimer) anuncioCreditosTimer.textContent = 'Espera ' + seg + ' segundos...';
      } else {
        clearInterval(interval);
        if (anuncioCreditosTimer) anuncioCreditosTimer.textContent = 'Listo!';
        if (btnCerrarAnuncioCreditos) btnCerrarAnuncioCreditos.classList.remove('oculto');
      }
    }, 1000);
  });
}

if (btnCerrarAnuncioCreditos) {
  btnCerrarAnuncioCreditos.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/creditos/recargar', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        if (overlayAnuncioCreditos) overlayAnuncioCreditos.classList.add('oculto');
        if (anuncioCreditosContenedor) anuncioCreditosContenedor.innerHTML = '';
        if (btnRecargarCreditos) btnRecargarCreditos.disabled = false;
        cargarCreditos();
      } else {
        alert(d.error || 'No se pudieron recargar los creditos.');
        if (btnRecargarCreditos) btnRecargarCreditos.disabled = false;
      }
    } catch (e) {
      alert('Error de conexion.');
      if (btnRecargarCreditos) btnRecargarCreditos.disabled = false;
    }
  });
}

btnAbrirSettings.addEventListener('click', () => {
  overlaySettings.classList.remove('oculto');
  if (!claveApiAccesoVerificado) verificarAccesoClaveApi();
});
btnCerrarSettings.addEventListener('click', () => { overlaySettings.classList.add('oculto'); detenerPollingCreditos(); });
overlaySettings.addEventListener('click', (ev) => { if (ev.target === overlaySettings) { overlaySettings.classList.add('oculto'); detenerPollingCreditos(); } });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !overlaySettings.classList.contains('oculto')) overlaySettings.classList.add('oculto');
});

// ---------- Actualizaciones (novedades) ----------
// Agrega o edita entradas acá. Las mas nuevas van primero.
const listaDeActualizaciones = [
  { fecha: '17 jul 2026', titulo: 'Creditos Y fixes y adds', texto: 'Agregadas funcionalidades para gestionar creditos y correcciones de bugs ademas agregamos nuevas caracteristicas.' },
];

const btnAbrirActualizaciones = document.getElementById('btnAbrirActualizaciones');
const btnCerrarActualizaciones = document.getElementById('btnCerrarActualizaciones');
const overlayActualizaciones = document.getElementById('overlayActualizaciones');
const listaActualizacionesEl = document.getElementById('listaActualizaciones');

function renderActualizaciones() {
  if (!listaActualizacionesEl) return;
  if (!listaDeActualizaciones.length) {
    listaActualizacionesEl.innerHTML = '<p class="lista-actualizaciones-vacio">Todavia no hay novedades publicadas.</p>';
    return;
  }
  listaActualizacionesEl.innerHTML = listaDeActualizaciones.map((a) => (
    '<div class="actualizacion-item">' +
      '<div class="actualizacion-item-fecha">' + escapeHtml(a.fecha || '') + '</div>' +
      '<div class="actualizacion-item-titulo">' + escapeHtml(a.titulo || '') + '</div>' +
      '<div class="actualizacion-item-texto">' + escapeHtml(a.texto || '') + '</div>' +
    '</div>'
  )).join('');
}

if (btnAbrirActualizaciones && overlayActualizaciones) {
  btnAbrirActualizaciones.addEventListener('click', () => {
    renderActualizaciones();
    overlayActualizaciones.classList.remove('oculto');
  });
}
if (btnCerrarActualizaciones && overlayActualizaciones) {
  btnCerrarActualizaciones.addEventListener('click', () => overlayActualizaciones.classList.add('oculto'));
}
if (overlayActualizaciones) {
  overlayActualizaciones.addEventListener('click', (ev) => {
    if (ev.target === overlayActualizaciones) overlayActualizaciones.classList.add('oculto');
  });
}
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && overlayActualizaciones && !overlayActualizaciones.classList.contains('oculto')) {
    overlayActualizaciones.classList.add('oculto');
  }
});

// ---------- Codes (canjear codigos por creditos) ----------
let esUsuarioAdmin = false;

const btnAbrirCodes = document.getElementById('btnAbrirCodes');
const btnCerrarCodes = document.getElementById('btnCerrarCodes');
const overlayCodes = document.getElementById('overlayCodes');
const inputCodigo = document.getElementById('inputCodigo');
const btnCanjearCodigo = document.getElementById('btnCanjearCodigo');
const codesMensaje = document.getElementById('codesMensaje');

function mostrarMensajeCodes(el, texto, tipo) {
  if (!el) return;
  el.textContent = texto;
  el.className = 'codes-mensaje' + (tipo ? ' ' + tipo : '');
}

if (btnAbrirCodes && overlayCodes) {
  btnAbrirCodes.addEventListener('click', () => {
    overlayCodes.classList.remove('oculto');
    mostrarMensajeCodes(codesMensaje, '', '');
    if (esUsuarioAdmin) cargarListaCodigosAdmin();
  });
}
if (btnCerrarCodes && overlayCodes) {
  btnCerrarCodes.addEventListener('click', () => overlayCodes.classList.add('oculto'));
}
if (overlayCodes) {
  overlayCodes.addEventListener('click', (ev) => {
    if (ev.target === overlayCodes) overlayCodes.classList.add('oculto');
  });
}

const btnMasCodes = document.getElementById('btnMasCodes');
function cerrarPanelMasCodes() {
  const existente = document.getElementById('panelMasCodes');
  if (existente) existente.remove();
}
document.addEventListener('click', cerrarPanelMasCodes);
if (btnMasCodes) {
  btnMasCodes.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const yaAbierto = document.getElementById('panelMasCodes');
    cerrarPanelMasCodes();
    if (yaAbierto) return; // el click ya lo cerro, no lo reabrimos

    const panel = document.createElement('div');
    panel.id = 'panelMasCodes';
    panel.className = 'nav-mas-panel';
    panel.addEventListener('click', (e) => e.stopPropagation());

    const btnVerboCode = document.createElement('button');
    btnVerboCode.id = 'btnVerboCode';
    btnVerboCode.className = 'nav-item nav-item-verbocode';
    // Detectar admin desde window (seteado por cargarUsuario) o localStorage
    const esAdminParaVerboCode = !!(window.esUsuarioAdmin || localStorage.getItem('verboAiEsAdmin') === 'true');
    if (esAdminParaVerboCode) {
      btnVerboCode.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg> Verbo Code <span class="badge-prox" style="background:linear-gradient(135deg,#d4af37,#b8860b);color:#1a1a1a;">Admin</span>';
      btnVerboCode.title = 'Abrir Verbo Code en nueva pestaña';
      btnVerboCode.addEventListener('click', () => {
        window.open('/verbocode/home/', '_blank');
      });
    } else {
      btnVerboCode.disabled = true;
      btnVerboCode.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg> Verbo Code <span class="badge-prox">Admin</span>';
      btnVerboCode.title = 'Solo disponible para cuentas administrador';
      btnVerboCode.addEventListener('click', () => {
        alert('Verbo Code está disponible solo para cuentas administrador.');
      });
    }
    panel.appendChild(btnVerboCode);

    document.body.appendChild(panel);

    const r = btnMasCodes.getBoundingClientRect();
    const panelAncho = panel.offsetWidth || 180;
    // En escritorio se abre a la derecha del boton; si no entra (ej. mobile), abajo.
    let left = r.right + 8;
    let top = r.top;
    if (left + panelAncho > window.innerWidth - 8) {
      left = Math.max(8, r.left);
      top = r.bottom + 6;
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  });
}

if (btnCanjearCodigo) {
  btnCanjearCodigo.addEventListener('click', async () => {
    const codigo = (inputCodigo.value || '').trim();
    if (!codigo) { mostrarMensajeCodes(codesMensaje, 'Escribi un codigo.', 'error'); return; }
    btnCanjearCodigo.disabled = true;
    try {
      const r = await fetch('/api/codigos/canjear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo }),
      });
      const d = await r.json();
      if (!r.ok) {
        mostrarMensajeCodes(codesMensaje, d.error || 'No se pudo canjear el codigo.', 'error');
      } else {
        mostrarMensajeCodes(codesMensaje, `Listo! Sumaste ${d.creditos} creditos.`, 'ok');
        inputCodigo.value = '';
        cargarCreditos();
      }
    } catch (e) {
      mostrarMensajeCodes(codesMensaje, 'Error de conexion.', 'error');
    }
    btnCanjearCodigo.disabled = false;
  });
}

// ---------- Codes: panel de admin para crear codigos sin redeploy ----------
const codigoNuevoTexto = document.getElementById('codigoNuevoTexto');
const codigoNuevoCreditos = document.getElementById('codigoNuevoCreditos');
const codigoNuevoUsos = document.getElementById('codigoNuevoUsos');
const btnCrearCodigo = document.getElementById('btnCrearCodigo');
const codesAdminMensaje = document.getElementById('codesAdminMensaje');
const listaCodigosAdmin = document.getElementById('listaCodigosAdmin');

async function cargarListaCodigosAdmin() {
  if (!listaCodigosAdmin) return;
  try {
    const r = await fetch('/api/codigos');
    const d = await r.json();
    if (!r.ok || !Array.isArray(d.codigos)) { listaCodigosAdmin.innerHTML = ''; return; }
    listaCodigosAdmin.innerHTML = d.codigos.map((c) => (
      '<div class="codigo-admin-item">' +
        '<span>' + escapeHtml(c.codigo) + ' — ' + c.creditos + ' cr — ' + c.usados + '/' + (c.usosMax === -1 ? '∞' : c.usosMax) + ' usos</span>' +
        '<button class="codigo-admin-item-borrar" data-codigo="' + escapeHtml(c.codigo) + '">Borrar</button>' +
      '</div>'
    )).join('');
    listaCodigosAdmin.querySelectorAll('.codigo-admin-item-borrar').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch('/api/codigos/' + encodeURIComponent(btn.dataset.codigo), { method: 'DELETE' });
        cargarListaCodigosAdmin();
      });
    });
  } catch (e) { /* si falla, dejamos la lista como estaba */ }
}

if (btnCrearCodigo) {
  btnCrearCodigo.addEventListener('click', async () => {
    const codigo = (codigoNuevoTexto.value || '').trim();
    const creditos = parseInt(codigoNuevoCreditos.value, 10);
    const usosMax = codigoNuevoUsos.value.trim() === '' ? 1 : parseInt(codigoNuevoUsos.value, 10);
    if (!codigo || !creditos) { mostrarMensajeCodes(codesAdminMensaje, 'Completa codigo y creditos.', 'error'); return; }
    btnCrearCodigo.disabled = true;
    try {
      const r = await fetch('/api/codigos/crear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo, creditos, usosMax }),
      });
      const d = await r.json();
      if (!r.ok) {
        mostrarMensajeCodes(codesAdminMensaje, d.error || 'No se pudo crear el codigo.', 'error');
      } else {
        mostrarMensajeCodes(codesAdminMensaje, `Codigo "${d.codigo}" creado.`, 'ok');
        codigoNuevoTexto.value = '';
        codigoNuevoCreditos.value = '';
        codigoNuevoUsos.value = '';
        cargarListaCodigosAdmin();
      }
    } catch (e) {
      mostrarMensajeCodes(codesAdminMensaje, 'Error de conexion.', 'error');
    }
    btnCrearCodigo.disabled = false;
  });
}

let claveApiAccesoVerificado = false;
let claveApiTieneAcceso = false;
let claveApiCargandoTokens = false;

const badgeProxClaveApi = document.getElementById('badgeProxClaveApi');
const claveApiProx = document.getElementById('claveApiProx');
const claveApiPanel = document.getElementById('claveApiPanel');
const btnGenerarToken = document.getElementById('btnGenerarToken');
const claveApiNombreNuevo = document.getElementById('claveApiNombreNuevo');
const claveApiTokenRecien = document.getElementById('claveApiTokenRecien');
const claveApiTokenRecienValor = document.getElementById('claveApiTokenRecienValor');
const btnCopiarTokenRecien = document.getElementById('btnCopiarTokenRecien');
const claveApiListaTokens = document.getElementById('claveApiListaTokens');

async function verificarAccesoClaveApi() {
  try {
    const r = await fetch('/api/api-tokens/acceso');
    if (!r.ok) throw new Error('no-auth');
    const d = await r.json();
    claveApiAccesoVerificado = true;
    claveApiTieneAcceso = !!d.acceso;
    aplicarEstadoClaveApi();
    if (claveApiTieneAcceso) cargarTokensClaveApi();
  } catch (e) {
    claveApiAccesoVerificado = true;
    claveApiTieneAcceso = false;
    aplicarEstadoClaveApi();
  }
}

function aplicarEstadoClaveApi() {
  if (claveApiTieneAcceso) {
    if (badgeProxClaveApi) badgeProxClaveApi.classList.add('oculto');
    if (claveApiProx) claveApiProx.classList.add('oculto');
    if (claveApiPanel) claveApiPanel.classList.remove('oculto');
  } else {
    if (badgeProxClaveApi) badgeProxClaveApi.classList.remove('oculto');
    if (claveApiProx) claveApiProx.classList.remove('oculto');
    if (claveApiPanel) claveApiPanel.classList.add('oculto');
  }
}

async function cargarTokensClaveApi() {
  if (!claveApiTieneAcceso || claveApiCargandoTokens) return;
  claveApiCargandoTokens = true;
  try {
    const r = await fetch('/api/api-tokens');
    if (!r.ok) {
      claveApiListaTokens.innerHTML = '<p class="clave-api-vacio">No se pudo cargar la lista de tokens. Probá de nuevo.</p>';
      return;
    }
    const d = await r.json();
    renderTokensClaveApi(d.tokens || []);
  } catch (e) {
    claveApiListaTokens.innerHTML = '<p class="clave-api-vacio">No se pudo cargar la lista de tokens. Probá de nuevo.</p>';
  } finally {
    claveApiCargandoTokens = false;
  }
}

function formatearFecha(iso) {
  if (!iso) return '—';
  try {
    const f = new Date(iso);
    return f.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return iso;
  }
}

function renderTokensClaveApi(tokens) {
  if (!tokens.length) {
    claveApiListaTokens.innerHTML = '<p class="clave-api-vacio">Todavia no generaste ningun token.</p>';
    return;
  }
  claveApiListaTokens.innerHTML = tokens.map((t) => {
    return `
      <div class="token-card" data-id="${t.id}">
        <div class="token-card-fila">
          <div class="token-card-nombre">${escapeHtml(t.nombre || 'Token sin nombre')}</div>
          <button class="btn-revocar-token" data-id="${t.id}" title="Borrar token">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Borrar
          </button>
        </div>
        <div class="token-card-token"><code>${escapeHtml(t.prefijo)}</code></div>
        <div class="token-card-stats">
          <div class="token-stat">
            <span class="token-stat-label">Rate limit</span>
            <span class="token-stat-valor">${t.rateLimit} / min</span>
          </div>
          <div class="token-stat">
            <span class="token-stat-label">Creado</span>
            <span class="token-stat-valor">${formatearFecha(t.creadoEn)}</span>
          </div>
          <div class="token-stat">
            <span class="token-stat-label">Ultimo uso</span>
            <span class="token-stat-valor">${formatearFecha(t.ultimoUso)}</span>
          </div>
        </div>
        <div class="token-card-descarga">
          <a href="/VerboAIpc.bat" download class="token-descarga-link" title="Descargar cliente para Windows">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Descargar VerboAIpc
          </a>
        </div>
      </div>
    `;
  }).join('');

  claveApiListaTokens.querySelectorAll('.btn-revocar-token').forEach((b) => {
    b.addEventListener('click', () => revocarTokenClaveApi(b.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function generarTokenClaveApi() {
  const nombre = (claveApiNombreNuevo.value || '').trim();
  btnGenerarToken.disabled = true;
  btnGenerarToken.classList.add('cargando');
  try {
    const r = await fetch('/api/api-tokens/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre }),
    });
    const d = await r.json();
    if (!r.ok) {
      alert(d.error || 'No se pudo generar el token.');
      return;
    }
    claveApiTokenRecienValor.textContent = d.token;
    claveApiTokenRecien.classList.remove('oculto');
    if (claveApiNombreNuevo) claveApiNombreNuevo.value = '';
    await cargarTokensClaveApi();
  } catch (e) {
    alert('No se pudo generar el token. Probá de nuevo.');
  } finally {
    btnGenerarToken.disabled = false;
    btnGenerarToken.classList.remove('cargando');
  }
}

async function revocarTokenClaveApi(id) {
  if (!id) return;
  if (!confirm('Borrar este token? Cualquier integracion que lo use va a dejar de andar de inmediato.')) return;
  try {
    const r = await fetch('/api/api-tokens/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'No se pudo borrar el token.');
      return;
    }
    await cargarTokensClaveApi();
  } catch (e) {
    alert('No se pudo borrar el token. Probá de nuevo.');
  }
}

async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

if (btnGenerarToken) btnGenerarToken.addEventListener('click', generarTokenClaveApi);
if (btnCopiarTokenRecien) btnCopiarTokenRecien.addEventListener('click', async () => {
  const texto = claveApiTokenRecienValor.textContent || '';
  const ok = await copiarAlPortapapeles(texto);
  if (ok) {
    btnCopiarTokenRecien.classList.add('copiado');
    btnCopiarTokenRecien.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg> Copiado';
    setTimeout(() => {
      btnCopiarTokenRecien.classList.remove('copiado');
      btnCopiarTokenRecien.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg> Copiar';
    }, 1800);
  } else {
    alert('No se pudo copiar. Copialo a mano: ' + texto);
  }
});

const btnSelectorModelo = document.getElementById('btnSelectorModelo');
const selectorModeloMenu = document.getElementById('selectorModeloMenu');
const selectorModeloNombre = document.getElementById('selectorModeloNombre');

function renderOpcionesModelo() {
  if (selectorModeloMenu) renderOpcionesModeloEn(selectorModeloMenu);
}

function aplicarModeloUI() {
  if (selectorModeloNombre) selectorModeloNombre.textContent = modeloActual;
  if (selectorModeloHeaderNombre) selectorModeloHeaderNombre.textContent = modeloActual;
  const headerSub = document.getElementById('chatHeaderSub');
  if (headerSub) headerSub.textContent = 'Modelo: ' + modeloActual;
  if (selectorModeloMenu) {
    selectorModeloMenu.querySelectorAll('.opcion-modelo').forEach((op) => {
      const activa = op.dataset.modelo === modeloActual;
      op.classList.toggle('activa', activa);
      op.setAttribute('aria-selected', String(activa));
    });
  }
}

function abrirSelectorModelo() {
  var esMovil = window.matchMedia('(max-width: 768px)').matches;
  var menuHeader = document.getElementById('selectorModeloMenuHeader');
  if (esMovil) {
    if (menuHeader) {
      renderOpcionesModeloEn(menuHeader);
      menuHeader.classList.remove('oculto');
    }
    if (btnSelectorModelo) btnSelectorModelo.classList.add('abierto');
    var btnHeader = document.getElementById('btnSelectorModeloHeader');
    if (btnHeader) btnHeader.classList.add('abierto');
  } else {
    if (selectorModeloMenu) {
      renderOpcionesModeloEn(selectorModeloMenu);
      selectorModeloMenu.classList.remove('oculto');
    }
    if (btnSelectorModelo) {
      btnSelectorModelo.classList.add('abierto');
      btnSelectorModelo.setAttribute('aria-expanded', 'true');
    }
  }
  aplicarModeloUI();
}

function cerrarSelectorModelo() {
  if (selectorModeloMenu) selectorModeloMenu.classList.add('oculto');
  if (btnSelectorModelo) {
    btnSelectorModelo.classList.remove('abierto');
    btnSelectorModelo.setAttribute('aria-expanded', 'false');
  }
  var menuHeader = document.getElementById('selectorModeloMenuHeader');
  if (menuHeader) menuHeader.classList.add('oculto');
  var btnHeader = document.getElementById('btnSelectorModeloHeader');
  if (btnHeader) btnHeader.classList.remove('abierto');
  setTimeout(function() {
    if (selectorModeloMenu) selectorModeloMenu.innerHTML = '';
    var mh = document.getElementById('selectorModeloMenuHeader');
    if (mh) mh.innerHTML = '';
  }, 50);
}

function renderOpcionesModeloEn(contenedor) {
  if (!contenedor) return;
  contenedor.innerHTML = modelosDisponibles.map(function(m) {
    var activa = m.nombre === modeloActual;
    var disponible = m.disponible !== false;
    var badges = '';
    if (disponible && m.costoCreditos && m.costoCreditos > 1) {
      badges += '<span class="opcion-modelo-badge">' + m.costoCreditos + ' creditos</span>';
    }
    if (m.badge === 'beta' || m.nombre === 'NewserAdvanced') {
      badges += '<span class="opcion-modelo-badge opcion-modelo-badge-beta">Beta</span>';
    }
    if (m.badge === 'pro' || m.nombre === 'NewserAdvanced1.5') {
      badges += '<span class="opcion-modelo-badge opcion-modelo-badge-pro">Pro</span>';
    }
    if (m.badge === 'admin' || m.nombre === 'NewserPro') {
      badges += '<span class="opcion-modelo-badge opcion-modelo-badge-admin">Admin</span>';
    }
    if (m.badge === 'pronto' || !disponible) {
      badges += '<span class="opcion-modelo-badge opcion-modelo-badge-pronto">Pronto</span>';
    }
    var claseNoDisponible = disponible ? '' : 'no-disponible';
    var checkSvg = disponible ? '<svg class="opcion-modelo-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
    var onclickAttr = disponible ? ' onclick="window.seleccionarModelo(\'' + m.nombre.replace(/'/g, "\\'") + '\')"' : ' disabled';
    return '<button type="button" class="opcion-modelo ' + (activa ? 'activa' : '') + ' ' + claseNoDisponible + '" data-modelo="' + escapeHtml(m.nombre) + '" role="option" aria-selected="' + activa + '"' + onclickAttr + '>' +
      '<div class="opcion-modelo-fila"><span class="opcion-modelo-nombre">' + escapeHtml(m.nombre) + '</span><span class="opcion-modelo-badges">' + badges + checkSvg + '</span></div>' +
      '<span class="opcion-modelo-desc">' + escapeHtml(m.descripcion || '') + '</span></button>';
  }).join('');
}

window.seleccionarModelo = function(nombre) {
  modeloActual = nombre;
  localStorage.setItem('verboAiModelo', modeloActual);
  aplicarModeloUI();
  cerrarSelectorModelo();
};

window.toggleSelectorModeloGlobal = function() {
  toggleSelectorModelo();
};

function toggleSelectorModelo() {
  var menuHeader = document.getElementById('selectorModeloMenuHeader');
  var estaOculto = true;
  if (menuHeader && !menuHeader.classList.contains('oculto')) estaOculto = false;
  if (selectorModeloMenu && !selectorModeloMenu.classList.contains('oculto')) estaOculto = false;
  if (estaOculto) abrirSelectorModelo();
  else cerrarSelectorModelo();
}

if (btnSelectorModelo) {
  btnSelectorModelo.onclick = function(ev) {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    toggleSelectorModelo();
    return false;
  };
}

const btnSelectorModeloHeader = document.getElementById('btnSelectorModeloHeader');
const selectorModeloHeaderNombre = document.getElementById('selectorModeloHeaderNombre');
if (btnSelectorModeloHeader) {
  btnSelectorModeloHeader.addEventListener('click', function(ev) {
    ev.stopPropagation();
    toggleSelectorModelo();
  });
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    var menuHeader = document.getElementById('selectorModeloMenuHeader');
    var menuOculto = true;
    if (selectorModeloMenu && !selectorModeloMenu.classList.contains('oculto')) menuOculto = false;
    if (menuHeader && !menuHeader.classList.contains('oculto')) menuOculto = false;
    if (!menuOculto) cerrarSelectorModelo();
  }
});

async function cargarModelosDisponibles() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return;
    const d = await r.json();
    if (Array.isArray(d.modelos) && d.modelos.length) {
      modelosDisponibles = d.modelos;
      if (!modelosDisponibles.some((m) => m.nombre === modeloActual)) {
        modeloActual = d.modeloDefault || 'NewserLite';
        localStorage.setItem('verboAiModelo', modeloActual);
      }
    }
    if (d.modeloDefault && !localStorage.getItem('verboAiModelo')) {
      modeloActual = d.modeloDefault;
    }
    renderOpcionesModelo();
    aplicarModeloUI();
  } catch (e) {
    renderOpcionesModelo();
    aplicarModeloUI();
  }
}

aplicarModeloUI();

let temaActual = localStorage.getItem('verboAiTema') || 'default';
function aplicarTema() {
  document.documentElement.classList.toggle('tema-night', temaActual === 'df-night');
  document.querySelectorAll('.opcion-tema').forEach((op) => {
    op.classList.toggle('activa', op.dataset.tema === temaActual);
  });
}
aplicarTema();
document.querySelectorAll('.opcion-tema').forEach((boton) => {
  boton.addEventListener('click', () => {
    temaActual = boton.dataset.tema;
    localStorage.setItem('verboAiTema', temaActual);
    aplicarTema();
  });
});

function cerrarMenusChat() {
  document.querySelectorAll('.menu-item-chat').forEach((m) => m.remove());
}
document.addEventListener('click', cerrarMenusChat);

function abrirMenuChat(chat, btnAncla, elTitulo) {
  cerrarMenusChat();
  const menu = document.createElement('div');
  menu.className = 'menu-item-chat';

  const opRenombrar = document.createElement('button');
  opRenombrar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Renombrar';
  opRenombrar.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    cerrarMenusChat();
    const nuevo = prompt('Nuevo nombre para esta conversacion:', chat.titulo || '');
    if (!nuevo || !nuevo.trim()) return;
    const res = await fetch(`/api/chats/${encodeURIComponent(chat.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: nuevo.trim() }),
    });
    if (res.ok) { chat.titulo = nuevo.trim(); elTitulo.textContent = chat.titulo; }
  });

  const opBorrar = document.createElement('button');
  opBorrar.className = 'opcion-borrar';
  opBorrar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg> Eliminar';
  opBorrar.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    cerrarMenusChat();
    if (!confirm('¿Eliminar esta conversacion? Esta accion no se puede deshacer.')) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        alert('No se pudo eliminar la conversacion. Intenta de nuevo.');
        return;
      }
    } catch (e) {
      alert('No se pudo eliminar la conversacion (sin conexion). Intenta de nuevo.');
      return;
    }
    if (chat.id === chatIdActual) {
      fijarChatActual(null);
      await iniciarNuevoChat(false);
    }
    await cargarListaChats();
  });

  menu.appendChild(opRenombrar);
  menu.appendChild(opBorrar);
  document.body.appendChild(menu);

  const r = btnAncla.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - 180)}px`;
}

async function cambiarDeChat(id) {
  if (id === chatIdActual) return;
  fijarChatActual(id);
  limpiarCuaderno();
  await cargarMemoria(id);
  cargarListaChats();
  cerrarSidebarMovil();
}

async function iniciarNuevoChat(actualizarLista = true) {
  try {
    const res = await fetch('/api/chats', { method: 'POST' });
    const chat = await res.json();
    fijarChatActual(chat.id);
  } catch (e) {
    fijarChatActual(null);
  }
  elMensajes.innerHTML = '';
  limpiarCuaderno();
  if (actualizarLista) cargarListaChats();
  cerrarSidebarMovil();
}

function abrirLightbox(url, titulo, fuente) {
  elLightboxImg.src = url;
  elLightboxImg.alt = titulo || '';
  elLightboxCaption.innerHTML = '';
  if (titulo) elLightboxCaption.appendChild(document.createTextNode(titulo));
  if (fuente) {
    const a = document.createElement('a');
    a.href = fuente;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = ' Ver fuente ↗';
    a.style.color = 'var(--acento-claro, #e08a5c)';
    elLightboxCaption.appendChild(a);
  }
  elLightbox.classList.remove('oculto');
}
function cerrarLightbox() {
  elLightbox.classList.add('oculto');
  elLightboxImg.src = '';
}
btnCerrarLightbox.addEventListener('click', cerrarLightbox);
elLightbox.addEventListener('click', (ev) => {
  if (ev.target === elLightbox) cerrarLightbox();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !elLightbox.classList.contains('oculto')) cerrarLightbox();
});

function limpiarCuaderno() {
  elCuadernoLista.innerHTML = '';
  hayCuaderno = false;
  elFrameCuaderno.classList.add('oculto');
  btnCuaderno.classList.add('oculto');
  btnCuaderno.classList.remove('btn-cuaderno-nuevo');
}

function agregarHojaCuaderno(nodo) {
  elCuadernoLista.appendChild(nodo);
  hayCuaderno = true;
  btnCuaderno.classList.remove('oculto');
  elCuadernoLista.scrollTop = elCuadernoLista.scrollHeight;
  if (window.innerWidth <= 768) {
    btnCuaderno.classList.add('btn-cuaderno-nuevo');
  } else {
    elFrameCuaderno.classList.remove('oculto');
  }
}

function fechaCorta() {
  return new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function mostrarCuaderno(referencia, texto) {
  const hoja = document.createElement('div');
  hoja.className = 'hoja-cuaderno';

  const fecha = document.createElement('p');
  fecha.className = 'hoja-cuaderno-fecha';
  fecha.textContent = fechaCorta();

  const ref = document.createElement('p');
  ref.className = 'cuaderno-referencia';
  ref.textContent = referencia;

  const cuerpo = document.createElement('p');
  cuerpo.className = 'cuaderno-texto';
  const mark = document.createElement('mark');
  mark.textContent = texto;
  cuerpo.appendChild(mark);

  hoja.append(fecha, ref, cuerpo);
  agregarHojaCuaderno(hoja);
}

function mostrarImagenesEnCuaderno(query, items) {
  if (!items.length) return;
  const hoja = document.createElement('div');
  hoja.className = 'hoja-cuaderno';

  const fecha = document.createElement('p');
  fecha.className = 'hoja-cuaderno-fecha';
  fecha.textContent = fechaCorta();

  const ref = document.createElement('p');
  ref.className = 'cuaderno-referencia';
  ref.textContent = `Imagenes: ${query}`;

  const grid = document.createElement('div');
  grid.className = 'hoja-cuaderno-imagenes';
  items.slice(0, 8).forEach((it) => {
    const img = document.createElement('img');
    img.src = it.url;
    img.alt = it.titulo || query;
    img.loading = 'lazy';
    img.addEventListener('click', () => abrirLightbox(it.url, it.titulo || query));
    grid.appendChild(img);
  });

  hoja.append(fecha, ref, grid);
  agregarHojaCuaderno(hoja);
}

btnCerrarCuaderno.addEventListener('click', () => {
  elFrameCuaderno.classList.add('oculto');
});

btnCuaderno.addEventListener('click', () => {
  if (!hayCuaderno) return;
  elFrameCuaderno.classList.toggle('oculto');
  btnCuaderno.classList.remove('btn-cuaderno-nuevo');
});

let librosBiblia = [];
let progresoBiblia = { tachados: {}, marcador: null, zoom: 100 };
let libroActual = null;
let capituloActual = null;

function nombreLibro(l) {
  const n = l.names || l.name;
  if (Array.isArray(n)) return n[0] || 'Libro';
  return n || l.nombre || l.book || l.title || 'Libro';
}
function abrevLibro(l) { return String(l.abrev || l.abbrev || l.short || l.id || nombreLibro(l)); }
function numCapitulos(l) {
  if (Array.isArray(l.chapters)) return l.chapters.length;
  if (typeof l.chapters === 'number') return l.chapters;
  return 1;
}
function extraerVersos(data) {
  const arr = data.vers || data.verses || data.versiculos || (Array.isArray(data) ? data : []);
  return arr.map((v, i) => ({
    numero: Number(v.number != null ? v.number : v.numero != null ? v.numero : i + 1),
    texto: v.verse || v.text || v.texto || v.content || '',
  }));
}

async function cargarProgresoBiblia() {
  try {
    const res = await fetch('/api/biblia/progreso');
    progresoBiblia = await res.json();
    if (!progresoBiblia.tachados) progresoBiblia.tachados = {};
  } catch (e) { /* seguimos con valores por defecto */ }
  aplicarZoomBiblia();
}

function aplicarZoomBiblia() {
  elBibliaCuerpo.style.fontSize = `${progresoBiblia.zoom || 100}%`;
}

async function cargarLibrosBiblia() {
  elBibliaCuerpo.innerHTML = '<p class="biblia-cargando">Cargando libros de la Biblia...</p>';
  try {
    const res = await fetch('/api/biblia/libros');
    if (!res.ok) throw new Error('respuesta no ok');
    let data = await res.json();
    librosBiblia = Array.isArray(data) ? data : data.books || data.data || [];
  } catch (e) {
    elBibliaCuerpo.innerHTML = '<p class="biblia-error">No se pudo cargar la Biblia ahora mismo. Revisa tu conexion e intenta de nuevo.</p>';
  }
}

let testamentoActivo = 'Antiguo Testamento';

function abrirSelectorLibro() {
  elSelectorLibro.classList.remove('oculto');
  elListaCapitulos.classList.add('oculto');
  elListaLibros.classList.remove('oculto');
  pintarListaLibros();
}
function cerrarSelectorLibro() {
  elSelectorLibro.classList.add('oculto');
}
btnAbrirSelectorLibro.addEventListener('click', abrirSelectorLibro);
btnCerrarSelectorLibro.addEventListener('click', cerrarSelectorLibro);

document.querySelectorAll('.tab-testamento').forEach((tab) => {
  tab.addEventListener('click', () => {
    testamentoActivo = tab.dataset.testamento;
    document.querySelectorAll('.tab-testamento').forEach((t) => t.classList.toggle('activa', t === tab));
    pintarListaLibros();
  });
});

function pintarListaLibros() {
  const filtrados = librosBiblia.filter((l) => (l.testament || l.testamento) === testamentoActivo);
  const lista = filtrados.length ? filtrados : librosBiblia;
  elListaLibros.innerHTML = '';
  lista.forEach((libro) => {
    const item = document.createElement('button');
    item.className = 'item-libro';
    if (libroActual && nombreLibro(libro) === nombreLibro(libroActual)) item.classList.add('activo');
    item.textContent = nombreLibro(libro);
    item.addEventListener('click', () => pintarListaCapitulos(libro));
    elListaLibros.appendChild(item);
  });
}

function pintarListaCapitulos(libro) {
  elListaLibros.classList.add('oculto');
  elListaCapitulos.classList.remove('oculto');
  elListaCapitulos.innerHTML = '';

  const volver = document.createElement('button');
  volver.className = 'volver-a-libros';
  volver.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg> ' + nombreLibro(libro);
  volver.addEventListener('click', () => {
    elListaCapitulos.classList.add('oculto');
    elListaLibros.classList.remove('oculto');
  });
  elListaCapitulos.appendChild(volver);

  const grid = document.createElement('div');
  grid.className = 'grid-capitulos';
  const total = numCapitulos(libro) || 1;
  for (let i = 1; i <= total; i++) {
    const boton = document.createElement('button');
    boton.className = 'item-capitulo';
    if (libroActual && nombreLibro(libro) === nombreLibro(libroActual) && capituloActual === i) boton.classList.add('activo');
    boton.textContent = i;
    boton.addEventListener('click', () => {
      cerrarSelectorLibro();
      cargarCapituloBiblia(libro, i);
    });
    grid.appendChild(boton);
  }
  elListaCapitulos.appendChild(grid);
}

async function cargarCapituloBiblia(libro, capitulo, irAlMarcador = false) {
  elBibliaCuerpo.innerHTML = '<p class="biblia-cargando">Cargando capitulo...</p>';
  libroActual = libro;
  capituloActual = capitulo;
  elTituloLibroCapitulo.textContent = `${nombreLibro(libro)} ${capitulo}`;
  actualizarBotonesNavCapitulo();
  const nombreParaUrl = nombreLibro(libro).toLowerCase();
  try {
    const res = await fetch(`/api/biblia/capitulo/${encodeURIComponent(nombreParaUrl)}/${encodeURIComponent(capitulo)}`);
    if (!res.ok) throw new Error('respuesta no ok');
    const data = await res.json();
    pintarCapituloBiblia(libro, capitulo, extraerVersos(data), irAlMarcador);
  } catch (e) {
    elBibliaCuerpo.innerHTML = '<p class="biblia-error">No se pudo cargar este capitulo. Intenta con otro o revisa tu conexion.</p>';
  }
}

function actualizarBotonesNavCapitulo() {
  const idxLibro = librosBiblia.findIndex((l) => nombreLibro(l) === nombreLibro(libroActual));
  btnCapAnterior.disabled = capituloActual <= 1 && idxLibro <= 0;
  btnCapSiguiente.disabled = capituloActual >= numCapitulos(libroActual) && idxLibro >= librosBiblia.length - 1;
}

btnCapAnterior.addEventListener('click', () => {
  if (capituloActual > 1) {
    cargarCapituloBiblia(libroActual, capituloActual - 1);
    return;
  }
  const idx = librosBiblia.findIndex((l) => nombreLibro(l) === nombreLibro(libroActual));
  if (idx > 0) {
    const libroAnterior = librosBiblia[idx - 1];
    cargarCapituloBiblia(libroAnterior, numCapitulos(libroAnterior) || 1);
  }
});
btnCapSiguiente.addEventListener('click', () => {
  if (capituloActual < (numCapitulos(libroActual) || 1)) {
    cargarCapituloBiblia(libroActual, capituloActual + 1);
    return;
  }
  const idx = librosBiblia.findIndex((l) => nombreLibro(l) === nombreLibro(libroActual));
  if (idx !== -1 && idx < librosBiblia.length - 1) {
    cargarCapituloBiblia(librosBiblia[idx + 1], 1);
  }
});

function pintarCapituloBiblia(libro, capitulo, versos, irAlMarcador) {
  const abrev = abrevLibro(libro);
  const key = `${abrev}-${capitulo}`.toLowerCase();
  const tachadosCap = progresoBiblia.tachados[key] || [];
  const esMarcador = progresoBiblia.marcador &&
    String(progresoBiblia.marcador.abrev).toLowerCase() === abrev.toLowerCase() &&
    Number(progresoBiblia.marcador.capitulo) === Number(capitulo);

  elBibliaCuerpo.innerHTML = '';

  const titulo = document.createElement('p');
  titulo.className = 'biblia-capitulo-titulo';
  titulo.textContent = `${nombreLibro(libro)} ${capitulo}`;
  elBibliaCuerpo.appendChild(titulo);

  if (!versos.length) {
    const vacio = document.createElement('p');
    vacio.className = 'biblia-error';
    vacio.textContent = 'No se encontraron versiculos para este capitulo.';
    elBibliaCuerpo.appendChild(vacio);
    return;
  }

  const parrafo = document.createElement('p');
  parrafo.className = 'biblia-parrafo';
  versos.forEach((v) => {
    const span = document.createElement('span');
    span.className = 'biblia-verso';
    if (tachadosCap.includes(v.numero)) span.classList.add('tachado');
    if (esMarcador && progresoBiblia.marcador.verso && Number(progresoBiblia.marcador.verso) === v.numero) {
      span.classList.add('marcado-actual');
    }
    const num = document.createElement('span');
    num.className = 'biblia-verso-num';
    num.textContent = v.numero;
    span.appendChild(num);
    span.appendChild(document.createTextNode(v.texto + ' '));
    span.addEventListener('click', () => alternarTachado(abrev, capitulo, v.numero, span));
    parrafo.appendChild(span);
  });
  elBibliaCuerpo.appendChild(parrafo);

  if (irAlMarcador) {
    const marcado = elBibliaCuerpo.querySelector('.marcado-actual');
    if (marcado) setTimeout(() => marcado.scrollIntoView({ block: 'center' }), 60);
  }
}

async function alternarTachado(abrev, capitulo, verso, elVerso) {
  elVerso.classList.toggle('tachado');
  try {
    const res = await fetch('/api/biblia/tachar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ abrev, capitulo, verso }),
    });
    const data = await res.json();
    progresoBiblia.tachados[data.key] = data.tachados;
  } catch (e) {
    elVerso.classList.toggle('tachado');
  }
}

async function abrirBiblia() {
  elModalBiblia.classList.remove('oculto');
  if (!librosBiblia.length) await cargarLibrosBiblia();
  if (!librosBiblia.length) return;

  if (progresoBiblia.marcador) {
    const idx = librosBiblia.findIndex(
      (l) => abrevLibro(l).toLowerCase() === String(progresoBiblia.marcador.abrev).toLowerCase() ||
             nombreLibro(l) === progresoBiblia.marcador.libro
    );
    if (idx !== -1) {
      await cargarCapituloBiblia(librosBiblia[idx], Number(progresoBiblia.marcador.capitulo), true);
      return;
    }
  }
  await cargarCapituloBiblia(librosBiblia[0], 1);
}

btnAbrirBiblia.addEventListener('click', abrirBiblia);
document.getElementById('btnAbrirBibliaNav').addEventListener('click', () => {
  abrirBiblia();
  cerrarSidebarMovil();
});
btnCerrarBiblia.addEventListener('click', () => elModalBiblia.classList.add('oculto'));

async function cambiarZoomBiblia(delta) {
  const nuevo = Math.min(220, Math.max(70, (progresoBiblia.zoom || 100) + delta));
  progresoBiblia.zoom = nuevo;
  aplicarZoomBiblia();
  try {
    await fetch('/api/biblia/zoom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoom: nuevo }),
    });
  } catch (e) { /* la preferencia se queda solo local si falla el guardado */ }
}
btnZoomMas.addEventListener('click', () => cambiarZoomBiblia(10));
btnZoomMenos.addEventListener('click', () => cambiarZoomBiblia(-10));

btnMarcarAqui.addEventListener('click', async () => {
  if (!libroActual || !capituloActual) return;
  const marcador = { libro: nombreLibro(libroActual), abrev: abrevLibro(libroActual), capitulo: capituloActual };
  try {
    const res = await fetch('/api/biblia/marcador', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(marcador),
    });
    progresoBiblia.marcador = await res.json();
    elAvisoMarcador.textContent = `Guardado: la proxima vez (incluso desde otro dispositivo) seguiras desde ${nombreLibro(libroActual)} ${capituloActual}.`;
  } catch (e) {
    elAvisoMarcador.textContent = 'No se pudo guardar el marcador, revisa tu conexion.';
  }
  elAvisoMarcador.classList.remove('oculto');
  setTimeout(() => elAvisoMarcador.classList.add('oculto'), 4000);
});

function pintarGaleria(query, items) {
  const detalles = document.createElement('details');
  detalles.className = 'referencia-imagenes';
  detalles.open = true;

  const resumen = document.createElement('summary');
  resumen.innerHTML = `
    <svg class="icono-summary" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Imagenes de referencia: ${escaparHtml(query)}
  `;
  detalles.appendChild(resumen);

  const grid = document.createElement('div');
  grid.className = 'galeria-grid';
  items.forEach((it) => {
    const item = document.createElement('div');
    item.className = 'galeria-item';
    const img = document.createElement('img');
    img.src = it.url;
    img.alt = it.titulo || query;
    img.loading = 'lazy';
    const span = document.createElement('span');
    span.textContent = it.titulo || 'Referencia';
    item.appendChild(img);
    item.appendChild(span);
    item.addEventListener('click', () => abrirLightbox(it.url, it.titulo || query, it.fuente));
    grid.appendChild(item);
  });
  detalles.appendChild(grid);

  elMensajes.appendChild(detalles);
  elMensajes.scrollTop = elMensajes.scrollHeight;
}

function crearEscritorTexto(contenedor, cursorEl) {
  let cola = '';
  const nodoTexto = document.createTextNode('');
  contenedor.insertBefore(nodoTexto, cursorEl);
  const temporizador = setInterval(() => {
    if (!cola.length) return;
    const tomar = Math.min(3, cola.length);
    nodoTexto.textContent += cola.slice(0, tomar);
    cola = cola.slice(tomar);
    elMensajes.scrollTop = elMensajes.scrollHeight;
  }, 14);
  return {
    agregar(t) { cola += t; },
    pendiente() { return cola.length > 0; },
    detener() { clearInterval(temporizador); },
  };
}

let temporizadorReintento = null;
function mostrarReintento(intento, maxIntentos, espera) {
  if (temporizadorReintento) clearInterval(temporizadorReintento);
  elIndicador.classList.remove('oculto');
  elIndicador.classList.add('reintentando');
  const spanTexto = elIndicador.querySelector('span');
  let restante = espera;
  const actualizar = () => {
    spanTexto.textContent = `Modelo saturado, reintentando (intento ${intento}/${maxIntentos}) en ${restante}s...`;
  };
  actualizar();
  temporizadorReintento = setInterval(() => {
    restante -= 1;
    if (restante <= 0) {
      clearInterval(temporizadorReintento);
      temporizadorReintento = null;
      spanTexto.textContent = 'Reintentando...';
      return;
    }
    actualizar();
  }, 1000);
}
function ocultarReintento() {
  if (temporizadorReintento) { clearInterval(temporizadorReintento); temporizadorReintento = null; }
  elIndicador.classList.remove('reintentando');
  elIndicador.querySelector('span').textContent = 'Meditando la respuesta...';
}

const ICONO_BIBLIA_SVG = `<svg class="investigando-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`;
const ICONO_LUPA_SVG = `<svg class="investigando-favicon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg>`;

function iconoParaSitioHTML(sitio) {
  if (/wikipedia/i.test(sitio)) {
    return `<img class="investigando-favicon" src="https://www.google.com/s2/favicons?domain=es.wikipedia.org&sz=64" alt="" />`;
  }
  if (/biblia/i.test(sitio)) {
    return ICONO_BIBLIA_SVG;
  }
  return ICONO_LUPA_SVG;
}

function crearFrameInvestigando(query) {
  const frame = document.createElement('div');
  frame.className = 'frame-investigando';
  frame.innerHTML = `
    <div class="investigando-topbar">
      <span class="punto rojo"></span><span class="punto amarillo"></span><span class="punto verde"></span>
    </div>
    <div class="investigando-contenido">
      <div class="investigando-header">
        <span class="investigando-punto"></span>
        Investigando "${escaparHtml(query)}" en sitios permitidos
      </div>
      <div class="investigando-barra">
        ${ICONO_LUPA_SVG}
        <span class="investigando-sitio">Preparando busqueda...</span>
      </div>
      <div class="investigando-scan"></div>
    </div>
  `;
  elMensajes.appendChild(frame);
  elMensajes.scrollTop = elMensajes.scrollHeight;

  const elSitio = frame.querySelector('.investigando-sitio');
  const elBarra = frame.querySelector('.investigando-barra');

  return {
    actualizarSitio(sitio) {
      elSitio.style.opacity = 0;
      setTimeout(() => {
        const iconoViejo = elBarra.querySelector('.investigando-favicon, .investigando-favicon-svg');
        if (iconoViejo) iconoViejo.remove();
        elBarra.insertAdjacentHTML('afterbegin', iconoParaSitioHTML(sitio));
        elSitio.textContent = `Consultando ${sitio}...`;
        elSitio.style.opacity = 1;
      }, 150);
    },
    finalizar() {
      frame.classList.add('investigando-listo');
      frame.querySelector('.investigando-header').innerHTML =
        '<span class="investigando-punto listo"></span> Investigacion completa';
      elSitio.style.opacity = 1;
      elSitio.textContent = 'Listo ✓';
      setTimeout(() => frame.classList.add('investigando-colapsado'), 1600);
    },
  };
}

function mostrarFuentes(items) {
  if (!items || !items.length) return;
  const cont = document.createElement('div');
  cont.className = 'fuentes-consultadas';
  const titulo = document.createElement('p');
  titulo.className = 'fuentes-titulo';
  titulo.textContent = 'Fuentes reales consultadas:';
  cont.appendChild(titulo);
  items.forEach((f) => {
    if (f.url) {
      const a = document.createElement('a');
      a.href = f.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = f.titulo;
      cont.appendChild(a);
    } else {
      const span = document.createElement('span');
      span.className = 'fuente-sin-link';
      span.textContent = f.titulo;
      cont.appendChild(span);
    }
  });
  elMensajes.appendChild(cont);
  elMensajes.scrollTop = elMensajes.scrollHeight;
}

let urlsMiniaturas = [];
function actualizarPreviewImagenes() {
  urlsMiniaturas.forEach((u) => URL.revokeObjectURL(u));
  urlsMiniaturas = [];
  elPreview.innerHTML = '';
  imagenesSeleccionadas.forEach((archivo, i) => {
    const url = URL.createObjectURL(archivo);
    urlsMiniaturas.push(url);
    const cont = document.createElement('div');
    cont.className = 'miniatura-imagen';
    const img = document.createElement('img');
    img.src = url;
    img.alt = archivo.name;
    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.title = 'Quitar esta imagen';
    btnQuitar.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/></svg>';
    btnQuitar.addEventListener('click', () => {
      imagenesSeleccionadas.splice(i, 1);
      actualizarPreviewImagenes();
    });
    cont.appendChild(img);
    cont.appendChild(btnQuitar);
    elPreview.appendChild(cont);
  });
}

function agregarImagenes(listaArchivos) {
  const nuevas = Array.from(listaArchivos).filter((f) => f.type.startsWith('image/'));
  if (!nuevas.length) return;
  for (const archivo of nuevas) {
    if (imagenesSeleccionadas.length >= 5) {
      alert('Podes adjuntar hasta 5 imagenes por mensaje.');
      break;
    }
    const yaEsta = imagenesSeleccionadas.some((f) => f.name === archivo.name && f.size === archivo.size);
    if (!yaEsta) imagenesSeleccionadas.push(archivo);
  }
  actualizarPreviewImagenes();
}

elInputImagen.addEventListener('change', () => {
  agregarImagenes(elInputImagen.files || []);
  elInputImagen.value = '';
});

const elChat = document.querySelector('.chat');
let contadorArrastre = 0;
elChat.addEventListener('dragenter', (ev) => {
  ev.preventDefault();
  contadorArrastre++;
  elChat.classList.add('zona-arrastre-activa');
});
elChat.addEventListener('dragover', (ev) => ev.preventDefault());
elChat.addEventListener('dragleave', () => {
  contadorArrastre = Math.max(0, contadorArrastre - 1);
  if (contadorArrastre === 0) elChat.classList.remove('zona-arrastre-activa');
});
elChat.addEventListener('drop', (ev) => {
  ev.preventDefault();
  contadorArrastre = 0;
  elChat.classList.remove('zona-arrastre-activa');
  if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
    agregarImagenes(ev.dataTransfer.files);
  }
});

document.addEventListener('paste', (ev) => {
  const items = ev.clipboardData && ev.clipboardData.items;
  if (!items) return;
  const archivosImagen = [];
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const archivo = item.getAsFile();
      if (archivo) archivosImagen.push(archivo);
    }
  }
  if (archivosImagen.length) agregarImagenes(archivosImagen);
});

const btnMicrofono = document.getElementById('btnMicrofono');
const iconoMic = btnMicrofono.querySelector('.icono-mic');
const iconoPausa = btnMicrofono.querySelector('.icono-pausa');

const ReconocimientoVoz = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocimiento = null;
let escuchando = false;

if (!ReconocimientoVoz) {
  btnMicrofono.classList.add('no-disponible');
  btnMicrofono.title = 'Dictado por voz no disponible en este navegador';
} else {
  reconocimiento = new ReconocimientoVoz();
  reconocimiento.lang = 'es-ES';
  reconocimiento.continuous = true;
  reconocimiento.interimResults = true;

  let textoBase = '';

  reconocimiento.addEventListener('result', (ev) => {
    let textoFinal = '';
    let textoParcial = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const fragmento = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) textoFinal += fragmento;
      else textoParcial += fragmento;
    }
    elInputTexto.value = `${textoBase}${textoFinal}${textoParcial}`.trim();
    if (textoFinal) textoBase = `${textoBase}${textoFinal} `;
  });

  reconocimiento.addEventListener('end', () => {
    escuchando = false;
    btnMicrofono.classList.remove('grabando');
    iconoMic.classList.remove('oculto');
    iconoPausa.classList.add('oculto');
  });

  reconocimiento.addEventListener('error', () => {
    escuchando = false;
    btnMicrofono.classList.remove('grabando');
    iconoMic.classList.remove('oculto');
    iconoPausa.classList.add('oculto');
  });

  btnMicrofono.addEventListener('click', () => {
    if (escuchando) {
      reconocimiento.stop();
      return;
    }
    textoBase = elInputTexto.value ? `${elInputTexto.value} ` : '';
    try {
      reconocimiento.start();
      escuchando = true;
      btnMicrofono.classList.add('grabando');
      iconoMic.classList.add('oculto');
      iconoPausa.classList.remove('oculto');
    } catch (e) { /* si ya estaba escuchando, el navegador tira error, lo ignoramos */ }
  });
}

const btnEnviar = document.getElementById('btnEnviar');
const iconoEnviar = btnEnviar.querySelector('.icono-enviar');
const iconoDetener = btnEnviar.querySelector('.icono-detener');
let controladorPausaActual = null;

function mostrarBotonPausar(controlador) {
  controladorPausaActual = controlador;
  iconoEnviar.classList.add('oculto');
  iconoDetener.classList.remove('oculto');
  btnEnviar.title = 'Pausar';
  btnEnviar.classList.add('pausando');
}
function ocultarBotonPausar() {
  controladorPausaActual = null;
  iconoEnviar.classList.remove('oculto');
  iconoDetener.classList.add('oculto');
  btnEnviar.title = 'Enviar';
  btnEnviar.classList.remove('pausando');
}
btnEnviar.addEventListener('click', (ev) => {
  if (controladorPausaActual) {
    ev.preventDefault();
    controladorPausaActual.abort();
  }
});

elForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const texto = elInputTexto.value.trim();
  if (!texto && !imagenesSeleccionadas.length) return;

  const urlsLocales = imagenesSeleccionadas.map((f) => URL.createObjectURL(f));
  pintarMensajeCompleto('user', texto || '[Imagen enviada]', urlsLocales);

  elInputTexto.value = '';
  elIndicador.classList.remove('oculto');

  const _esGeneracionImagen = (() => {
    if (modeloActual !== 'NewserAdvanced' && modeloActual !== 'NewserAdvanced1.5') return false;
    const re = /^\s*(generame|generáme|genera|generá|generar|dibujame|dibújame|dibuja|dibujá|haceme|hacéme|hacer|hacé)\s+/i;
    return re.test(texto);
  })();
  if (_esGeneracionImagen) {
    const re = /^\s*(?:generame|generáme|genera|generá|generar|dibujame|dibújame|dibuja|dibujá|haceme|hacéme|hacer|hacé)\s+(?:una\s+imagen\s+(?:de|del|de la|de un|de una)\s*|una\s+foto\s+(?:de|del|de la|de un|de una)\s*|un\s+dibujo\s+(?:de|del|de la|de un|de una)\s*|imagen\s+(?:de|del|de la|de un|de una)\s*|foto\s+(?:de|del|de la|de un|de una)\s*)?(.+)$/i;
    const m = texto.match(re);
    const prompt = m ? m[1].trim() : texto;
    mostrarOverlayGenerandoImagen(prompt);
  }

  const formData = new FormData();
  formData.append('mensaje', texto);
  if (chatIdActual) formData.append('chatId', chatIdActual);
  formData.append('modo', modoActual);
  formData.append('modelo', modeloActual);
  imagenesSeleccionadas.forEach((f) => formData.append('imagenes', f));
  imagenesSeleccionadas = [];
  elInputImagen.value = '';
  actualizarPreviewImagenes();

  let burbujaIA = null;
  let textoAcumulado = '';
  let cursor = null;
  let escritor = null;
  let frameInvestigando = null;

  const controladorPausa = new AbortController();
  mostrarBotonPausar(controladorPausa);

  try {
    const res = await fetch('/api/chat', { method: 'POST', body: formData, signal: controladorPausa.signal });

    if (!res.ok || !res.body) {
      let msj = 'Ocurrio un error.';
      try { const data = await res.json(); msj = data.error || msj; } catch (e) { /* sin json */ }
      pintarMensajeCompleto('assistant', msj, null, true);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const asegurarBurbuja = () => {
      if (!burbujaIA) {
        elIndicador.classList.add('oculto');
        burbujaIA = crearBurbuja('assistant');
        cursor = document.createElement('span');
        cursor.className = 'cursor-escribiendo';
        burbujaIA.appendChild(cursor);
        escritor = crearEscritorTexto(burbujaIA, cursor);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lineas = buffer.split('\n');
      buffer = lineas.pop();

      for (const linea of lineas) {
        if (!linea.trim()) continue;
        let evt;
        try { evt = JSON.parse(linea); } catch (e) { continue; }

        if (evt.type === 'retry') {
          mostrarReintento(evt.intento, evt.maxIntentos, evt.espera);
        } else if (evt.type === 'ping') {
        } else if (evt.type === 'chunk') {
          ocultarReintento();
          asegurarBurbuja();
          textoAcumulado += evt.text;
          escritor.agregar(evt.text);
        } else if (evt.type === 'notebook') {
          mostrarCuaderno(evt.referencia, evt.texto);
        } else if (evt.type === 'investigando') {
          // Limpiar frame anterior si quedó sin cerrar
          if (frameInvestigando) { frameInvestigando.finalizar(); frameInvestigando = null; }
          frameInvestigando = crearFrameInvestigando(evt.query);
        } else if (evt.type === 'investigando_sitio') {
          if (frameInvestigando) frameInvestigando.actualizarSitio(evt.sitio);
        } else if (evt.type === 'investigando_fin') {
          if (frameInvestigando) { frameInvestigando.finalizar(); frameInvestigando = null; }
        } else if (evt.type === 'fuentes') {
          mostrarFuentes(evt.items);
        } else if (evt.type === 'images') {
          pintarGaleria(evt.query, evt.items);
          mostrarImagenesEnCuaderno(evt.query, evt.items);
        } else if (evt.type === 'descargas') {
          ocultarReintento();
          asegurarBurbuja();
          if (escritor) {
            escritor.detener();
          }
          if (burbujaIA) {
            const cursorViejo = burbujaIA.querySelector('.cursor-escribiendo');
            if (cursorViejo) cursorViejo.remove();
            const hijos = Array.from(burbujaIA.childNodes).filter((n) => n.nodeType !== 8);
            if (burbujaIA.children.length === 0 && hijos.length === 1 && hijos[0].nodeType === 3) {
              const texto = hijos[0].textContent || '';
              if (/^Generando imagen:/i.test(texto.trim())) {
                burbujaIA.textContent = '';
              }
            }
          }
          const items = Array.isArray(evt.items) ? evt.items : [];
          if (items.length) {
            const grid = document.createElement('div');
            grid.className = 'adjuntas-grid';
            items.forEach((item) => {
              if (!item.url) return;
              const img = document.createElement('img');
              img.src = item.url;
              img.className = 'adjunta';
              img.alt = item.nombre || 'imagen';
              img.title = item.nombre ? `${item.nombre}${item.tamanoKB ? ' (' + item.tamanoKB + ' KB)' : ''}` : '';
              img.addEventListener('click', () => abrirLightbox(item.url, item.nombre || ''));
              grid.appendChild(img);
            });
            if (grid.children.length && burbujaIA) {
              burbujaIA.appendChild(grid);
              void burbujaIA.offsetHeight;
              elMensajes.scrollTop = elMensajes.scrollHeight;
            }
          }
        } else if (evt.type === 'error') {
          ocultarReintento();
          ocultarOverlayGenerandoImagen();
          if (escritor) escritor.detener();
          if (burbujaIA) {
            burbujaIA.remove();
            burbujaIA = null;
          }
          if (frameInvestigando) { frameInvestigando.finalizar(); frameInvestigando = null; }
          pintarMensajeCompleto('assistant', evt.message || 'Ocurrio un error.', null, true);
        } else if (evt.type === 'done') {
          ocultarOverlayGenerandoImagen();
          await new Promise((resolve) => {
            const finalizar = () => {
              if (escritor) escritor.detener();
              if (burbujaIA) actualizarBurbujaPreservandoImagenes(burbujaIA, textoAcumulado.trim());
              resolve();
            };
            if (escritor && escritor.pendiente()) {
              const esperar = setInterval(() => {
                if (!escritor.pendiente()) { clearInterval(esperar); finalizar(); }
              }, 30);
            } else {
              finalizar();
            }
          });
          if (evt.chatId && evt.chatId !== chatIdActual) {
            fijarChatActual(evt.chatId);
          }
          cargarListaChats();
        }
      }
    }

    if (burbujaIA && cursor && cursor.parentNode) cursor.remove();
  } catch (e) {
    if (e.name === 'AbortError') {
      ocultarOverlayGenerandoImagen();
      if (escritor) escritor.detener();
      if (burbujaIA) actualizarBurbujaPreservandoImagenes(burbujaIA, textoAcumulado.trim());
    } else {
      ocultarOverlayGenerandoImagen();
      if (escritor) escritor.detener();
      if (burbujaIA) burbujaIA.remove();
      pintarMensajeCompleto('assistant', 'Error de conexion con el servidor.', null, true);
    }
  } finally {
    ocultarReintento();
    elIndicador.classList.add('oculto');
    ocultarBotonPausar();
  }
});

btnNuevoChat.addEventListener('click', () => {
  iniciarNuevoChat();
});

btnBorrarMemoria.addEventListener('click', async () => {
  if (!chatIdActual) return;
  if (!confirm('Esto borrara los mensajes de esta conversacion. ¿Continuar?')) return;
  await fetch(`/api/memoria?chatId=${encodeURIComponent(chatIdActual)}`, { method: 'DELETE' });
  elMensajes.innerHTML = '';
  limpiarCuaderno();
  cargarListaChats();
});

const perfilUsuario = document.getElementById('perfilUsuario');
const perfilMenu = document.getElementById('perfilMenu');
perfilUsuario.addEventListener('click', (ev) => {
  ev.stopPropagation();
  perfilMenu.classList.toggle('oculto');
});
document.addEventListener('click', (ev) => {
  if (!perfilUsuario.contains(ev.target)) perfilMenu.classList.add('oculto');
});

document.getElementById('btnCerrarSesion').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesion?')) return;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch (e) { /* seguimos igual, la cookie puede haber quedado vencida */ }
  window.location.href = '/login';
});

(async function iniciar() {
  cargarProgresoBiblia();

  fetch('/api/whoami')
    .then((r) => r.json())
    .then((d) => {
      if (!d.usuario) return;
      const nombre = d.nombre || d.usuario;
      const elNombre = document.getElementById('perfilNombreTexto');
      const elAvatar = document.getElementById('perfilAvatar');
      if (elNombre) elNombre.textContent = nombre;
      if (elAvatar) elAvatar.textContent = nombre.trim().charAt(0) || '?';
      esUsuarioAdmin = !!d.esAdmin;
      window.esUsuarioAdmin = esUsuarioAdmin;
      // Guardar en localStorage para que Verbo Code y otras páginas lo detecten
      try { localStorage.setItem('verboAiEsAdmin', esUsuarioAdmin ? 'true' : 'false'); } catch (e) {}
      const codesAdmin = document.getElementById('codesAdmin');
      if (codesAdmin) codesAdmin.classList.toggle('oculto', !esUsuarioAdmin);
    })
    .catch(() => {});

  verificarAccesoClaveApi();

  cargarModelosDisponibles();

  let chats = [];
  try {
    const res = await fetch('/api/chats');
    chats = await res.json();
  } catch (e) { /* sin conexion aun */ }

  const idDesdeUrl = idChatDesdeUrl();
  if (idDesdeUrl && chats.some((c) => c.id === idDesdeUrl)) {
    fijarChatActual(idDesdeUrl, { sinUrl: true });
    await cargarMemoria(idDesdeUrl);
  } else if (chatIdActual && chats.some((c) => c.id === chatIdActual)) {
    fijarChatActual(chatIdActual);
    await cargarMemoria(chatIdActual);
  } else if (chats.length) {
    fijarChatActual(chats[0].id);
    await cargarMemoria(chats[0].id);
  } else {
    await iniciarNuevoChat(false);
  }
  pintarListaChats(chats.length ? chats : await cargarListaChats());
})();
