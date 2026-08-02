// Chat de invitado (sin cuenta). Todo el historial vive en esta variable de
// JS nada mas: si el usuario recarga la pagina, arranca de cero (a proposito).
let historialDemo = [];
let enviando = false;

const elMensajes = document.getElementById('demoMensajes');
const elForm = document.getElementById('demoForm');
const elInput = document.getElementById('demoInput');
const elBtnEnviar = document.getElementById('demoBtnEnviar');

function crearBurbuja(rol, texto, extraClase) {
  const wrap = document.createElement('div');
  wrap.className = `demo-msg ${rol === 'user' ? 'demo-msg-usuario' : 'demo-msg-ia'}`;
  const burbuja = document.createElement('div');
  burbuja.className = `demo-burbuja${extraClase ? ' ' + extraClase : ''}`;
  burbuja.textContent = texto;
  wrap.appendChild(burbuja);
  elMensajes.appendChild(wrap);
  elMensajes.scrollTop = elMensajes.scrollHeight;
  return burbuja;
}

async function enviarMensajeDemo(texto) {
  historialDemo.push({ role: 'user', content: texto });
  crearBurbuja('user', texto);
  elInput.value = '';
  elInput.style.height = 'auto';

  const burbujaEspera = crearBurbuja('assistant', 'Escribiendo...', 'demo-pensando');
  enviando = true;
  elBtnEnviar.disabled = true;

  try {
    const res = await fetch('/api/demo/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensajes: historialDemo }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      burbujaEspera.textContent = data.error || 'Algo salio mal. Intenta de nuevo en un momento.';
      burbujaEspera.classList.remove('demo-pensando');
      burbujaEspera.classList.add('demo-error');
      return;
    }
    burbujaEspera.textContent = data.texto;
    burbujaEspera.classList.remove('demo-pensando');
    historialDemo.push({ role: 'assistant', content: data.texto });
  } catch (e) {
    burbujaEspera.textContent = 'No se pudo conectar con el servidor. Revisa tu conexion.';
    burbujaEspera.classList.remove('demo-pensando');
    burbujaEspera.classList.add('demo-error');
  } finally {
    enviando = false;
    elBtnEnviar.disabled = false;
  }
}

elForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const texto = elInput.value.trim();
  if (!texto || enviando) return;
  enviarMensajeDemo(texto);
});
elInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    elForm.requestSubmit();
  }
});
elInput.addEventListener('input', () => {
  elInput.style.height = 'auto';
  elInput.style.height = Math.min(elInput.scrollHeight, 140) + 'px';
});

document.getElementById('btnNuevaConversacion').addEventListener('click', () => {
  historialDemo = [];
  elMensajes.innerHTML = '';
  crearBurbuja('assistant', '¡Listo, arrancamos de nuevo! ¿En que te ayudo?');
});

// ---------- Sidebar movil ----------
const elSidebar = document.getElementById('demoSidebar');
document.getElementById('btnAbrirSidebarMovil').addEventListener('click', () => {
  elSidebar.classList.toggle('demo-sidebar-abierta');
});

// ---------- Modal de login / registro ----------
const elModalFondo = document.getElementById('demoModalFondo');
const elModalTitulo = document.getElementById('demoModalTitulo');
const elModalEmail = document.getElementById('demoModalEmail');
let pasoModalActual = 'registro';

function abrirModalAuth(paso) {
  pasoModalActual = paso;
  elModalTitulo.innerHTML = paso === 'login'
    ? 'Iniciar sesion'
    : 'Iniciar sesion<br />o registrate';
  document.getElementById('demoModalAlternar').textContent = paso === 'login'
    ? 'No tengo cuenta, quiero registrarme'
    : 'Ya tengo cuenta, quiero iniciar sesion';
  elModalFondo.classList.remove('oculto');
}
function cerrarModalAuth() { elModalFondo.classList.add('oculto'); }

document.getElementById('btnIniciarSesion').addEventListener('click', () => abrirModalAuth('login'));
document.getElementById('btnRegistrarse').addEventListener('click', () => abrirModalAuth('registro'));
document.getElementById('linkRegistrateAviso').addEventListener('click', (ev) => {
  ev.preventDefault();
  abrirModalAuth('registro');
});
document.getElementById('demoModalCerrar').addEventListener('click', cerrarModalAuth);
elModalFondo.addEventListener('click', (ev) => { if (ev.target === elModalFondo) cerrarModalAuth(); });

document.getElementById('demoModalAlternar').addEventListener('click', (ev) => {
  ev.preventDefault();
  abrirModalAuth(pasoModalActual === 'login' ? 'registro' : 'login');
});

document.getElementById('demoModalContinuar').addEventListener('click', () => {
  const correo = elModalEmail.value.trim();
  const params = new URLSearchParams();
  params.set('paso', pasoModalActual);
  if (correo) params.set('correo', correo);
  window.location.href = `/login?${params.toString()}`;
});

// Botones bloqueados de la sidebar (Settings, Codes, historial de chats):
// cualquier click ahi pide registrarse, no hacen nada por su cuenta.
document.querySelectorAll('[data-bloqueado="true"]').forEach((el) => {
  el.addEventListener('click', () => abrirModalAuth('registro'));
});

// ---------- Modal "La Biblia completa" (solo lectura, sin marcadores) ----------
const elBibliaFondo = document.getElementById('demoBibliaFondo');
const elBibliaLibro = document.getElementById('demoBibliaLibro');
const elBibliaCapitulo = document.getElementById('demoBibliaCapitulo');
const elBibliaCuerpo = document.getElementById('demoBibliaCuerpo');
let librosBibliaDemo = [];

function nombreLibroDemo(l) {
  const n = l.names || l.name;
  if (Array.isArray(n)) return n[0] || 'Libro';
  return n || l.nombre || l.book || l.title || 'Libro';
}
function abrevLibroDemo(l) { return String(l.abrev || l.abbrev || l.short || l.id || nombreLibroDemo(l)); }
function numCapitulosDemo(l) {
  if (Array.isArray(l.chapters)) return l.chapters.length;
  if (typeof l.chapters === 'number') return l.chapters;
  return 1;
}
function extraerVersosDemo(data) {
  const arr = data.vers || data.verses || data.versiculos || (Array.isArray(data) ? data : []);
  return arr.map((v, i) => ({
    numero: Number(v.number != null ? v.number : v.numero != null ? v.numero : i + 1),
    texto: v.verse || v.text || v.texto || v.content || '',
  }));
}

async function cargarLibrosDemo() {
  if (librosBibliaDemo.length) return;
  elBibliaLibro.innerHTML = '<option>Cargando...</option>';
  try {
    const res = await fetch('/api/biblia/libros');
    const data = await res.json();
    librosBibliaDemo = Array.isArray(data) ? data : data.books || data.data || [];
    elBibliaLibro.innerHTML = librosBibliaDemo
      .map((l, i) => `<option value="${i}">${nombreLibroDemo(l)}</option>`)
      .join('');
    if (librosBibliaDemo.length) cargarCapitulosDemo(0);
  } catch (e) {
    elBibliaLibro.innerHTML = '<option>Error al cargar</option>';
    elBibliaCuerpo.innerHTML = '<p class="demo-biblia-error">No se pudo cargar la lista de libros ahora mismo.</p>';
  }
}

function cargarCapitulosDemo(indiceLibro) {
  const libro = librosBibliaDemo[indiceLibro];
  if (!libro) return;
  const n = numCapitulosDemo(libro);
  elBibliaCapitulo.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">Capitulo ${i + 1}</option>`).join('');
  cargarCapituloTextoDemo(libro, 1);
}

async function cargarCapituloTextoDemo(libro, capitulo) {
  elBibliaCuerpo.innerHTML = '<p class="demo-biblia-cargando">Cargando...</p>';
  const abrev = abrevLibroDemo(libro);
  try {
    const res = await fetch(`/api/biblia/capitulo/${encodeURIComponent(abrev.toLowerCase())}/${encodeURIComponent(capitulo)}`);
    const data = await res.json();
    const versos = extraerVersosDemo(data);
    if (!versos.length) throw new Error('sin versos');
    elBibliaCuerpo.innerHTML = versos
      .map((v) => `<p><span class="demo-biblia-verso">${v.numero}</span>${v.texto}</p>`)
      .join('');
  } catch (e) {
    elBibliaCuerpo.innerHTML = '<p class="demo-biblia-error">No se pudo cargar ese capitulo ahora mismo.</p>';
  }
}

elBibliaLibro.addEventListener('change', () => cargarCapitulosDemo(Number(elBibliaLibro.value)));
elBibliaCapitulo.addEventListener('change', () => {
  const libro = librosBibliaDemo[Number(elBibliaLibro.value)];
  if (libro) cargarCapituloTextoDemo(libro, Number(elBibliaCapitulo.value));
});

document.getElementById('btnBibliaCompleta').addEventListener('click', () => {
  elBibliaFondo.classList.remove('oculto');
  cargarLibrosDemo();
});
document.getElementById('demoBibliaCerrar').addEventListener('click', () => elBibliaFondo.classList.add('oculto'));
elBibliaFondo.addEventListener('click', (ev) => { if (ev.target === elBibliaFondo) elBibliaFondo.classList.add('oculto'); });
