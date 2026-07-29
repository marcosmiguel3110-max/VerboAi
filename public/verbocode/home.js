/* ============================================================
   Verbo Code — Home page logic
   ============================================================ */

// Estado global
let usuarioActual = null;

// ============================================================
// Inicialización
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  aplicarTema();
  await cargarUsuario();
  await cargarProyectos();
  configurarEventos();
});

// ============================================================
// Tema (hereda de Verbo AI — usa los mismos fondos y variables CSS)
// ============================================================
function aplicarTema() {
  // Cargar el style.css de Verbo AI para tener los mismos fondos
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/style.css';
  document.head.appendChild(link);

  // Aplicar tema guardado
  const tema = localStorage.getItem('verboAiTema') || 'default';
  if (tema === 'df-night') {
    document.documentElement.classList.add('tema-night');
  }
}

// ============================================================
// Usuario (con doble check: API + localStorage)
// ============================================================
async function cargarUsuario() {
  try {
    const r = await fetch('/api/creditos');
    if (!r.ok) {
      window.location.href = '/login';
      return;
    }
    const d = await r.json();
    usuarioActual = d;

    // Guardar esAdmin en localStorage para que el botón Verbo Code del
    // sidebar principal lo detecte correctamente la próxima vez.
    localStorage.setItem('verboAiEsAdmin', d.esAdmin ? 'true' : 'false');
    localStorage.setItem('verboAiEsAdminVerboCode', d.esAdmin ? 'true' : 'false');
    // También guardarlo en window para que script.js lo lea al instante
    window.esUsuarioAdmin = !!d.esAdmin;
    window.esUsuarioAdminVerboCode = !!d.esAdmin;

    const nombre = d.usuario || 'Usuario';
    document.getElementById('vcPerfilNombre').textContent = nombre;
    document.getElementById('vcPerfilAvatar').textContent = nombre.charAt(0).toUpperCase();

    // Si no es admin, mostrar mensaje y redirigir
    if (!d.esAdmin) {
      mostrarToast('Solo las cuentas administrador pueden usar Verbo Code', 'error');
      setTimeout(() => { window.location.href = '/'; }, 2500);
      return;
    }
  } catch (e) {
    console.error('Error cargando usuario:', e);
    window.location.href = '/login';
  }
}

// ============================================================
// Proyectos
// ============================================================
async function cargarProyectos() {
  try {
    const r = await fetch('/api/verbocode/projects');
    if (!r.ok) throw new Error('No se pudieron cargar los proyectos');
    const data = await r.json();
    renderProyectos(data.proyectos || []);
  } catch (e) {
    console.error('Error:', e);
    mostrarToast(e.message, 'error');
    renderProyectos([]);
  }
}

function renderProyectos(proyectos) {
  const cont = document.getElementById('vcProyectos');
  const vacio = document.getElementById('vcVacio');

  if (proyectos.length === 0) {
    cont.innerHTML = '';
    cont.classList.add('oculto');
    vacio.classList.remove('oculto');
    return;
  }

  vacio.classList.add('oculto');
  cont.classList.remove('oculto');

  cont.innerHTML = proyectos.map(p => {
    const fecha = new Date(p.actualizadoEn || p.creadoEn).toLocaleDateString('es-AR', {
      day: 'numeric', month: 'short'
    });
    const numArchivos = p.archivos ? Object.keys(p.archivos).length : 0;
    return `
      <div class="vc-proyecto-card" data-id="${p.id}">
        <button class="vc-proyecto-delete" data-delete="${p.id}" title="Eliminar proyecto">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="vc-proyecto-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7M3 7l9-4 9 4M3 7l9 4 9-4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="vc-proyecto-nombre">${escapeHtml(p.nombre)}</div>
        <div class="vc-proyecto-archivos">${numArchivos} archivo${numArchivos !== 1 ? 's' : ''}</div>
        <div class="vc-proyecto-meta">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2" stroke-linecap="round"/></svg>
          ${fecha}
        </div>
      </div>
    `;
  }).join('');

  // Eventos click
  cont.querySelectorAll('.vc-proyecto-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.vc-proyecto-delete')) return;
      const id = card.dataset.id;
      window.location.href = `/verbocode/editor/${id}/`;
    });
  });

  // Eventos delete
  cont.querySelectorAll('.vc-proyecto-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.delete;
      if (!confirm('¿Eliminar este proyecto? Esta acción no se puede deshacer.')) return;
      await eliminarProyecto(id);
    });
  });
}

async function eliminarProyecto(id) {
  try {
    const r = await fetch(`/api/verbocode/projects/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('No se pudo eliminar');
    mostrarToast('Proyecto eliminado', 'success');
    await cargarProyectos();
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ============================================================
// Modal crear proyecto
// ============================================================
function configurarEventos() {
  const btnNuevo = document.getElementById('btnNuevoProyecto');
  const modal = document.getElementById('modalNuevoProyecto');
  const btnCancel = document.getElementById('btnCancelarProyecto');
  const btnCrear = document.getElementById('btnCrearProyecto');
  const input = document.getElementById('inputNombreProyecto');
  const backdrop = modal.querySelector('.vc-modal-backdrop');

  btnNuevo.addEventListener('click', () => {
    modal.classList.remove('oculto');
    input.value = '';
    btnCrear.disabled = true;
    setTimeout(() => input.focus(), 100);
  });

  btnCancel.addEventListener('click', cerrarModal);
  backdrop.addEventListener('click', cerrarModal);

  input.addEventListener('input', () => {
    btnCrear.disabled = input.value.trim().length < 3;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnCrear.disabled) crearProyecto();
    if (e.key === 'Escape') cerrarModal();
  });

  btnCrear.addEventListener('click', crearProyecto);
}

function cerrarModal() {
  document.getElementById('modalNuevoProyecto').classList.add('oculto');
}

async function crearProyecto() {
  const input = document.getElementById('inputNombreProyecto');
  const nombre = input.value.trim();
  if (nombre.length < 3) return;

  try {
    const r = await fetch('/api/verbocode/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre }),
    });
    if (!r.ok) throw new Error('No se pudo crear el proyecto');
    const data = await r.json();
    mostrarToast('Proyecto creado', 'success');
    // Redirigir al editor con el nuevo proyecto
    setTimeout(() => {
      window.location.href = `/verbocode/editor/${data.proyecto.id}/`;
    }, 600);
  } catch (e) {
    mostrarToast(e.message, 'error');
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

function mostrarToast(msg, tipo = '') {
  const toast = document.getElementById('vcToast');
  toast.textContent = msg;
  toast.className = 'vc-toast ' + tipo;
  setTimeout(() => toast.classList.add('oculto'), 3000);
}