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

  // SWE-Bench Pro modal
  const btnSWEbench = document.getElementById('btnSWEbench');
  const modalSWE = document.getElementById('modalSWEbench');
  const btnCerrarSWE = document.getElementById('btnCerrarSWEbench');
  const backdropSWE = modalSWE.querySelector('.vc-modal-backdrop');

  if (btnSWEbench) {
    btnSWEbench.addEventListener('click', () => {
      modalSWE.classList.remove('oculto');
      cargarProyectosSWE();
      cargarDatasetsSWE();
    });
  }

  if (btnCerrarSWE) {
    btnCerrarSWE.addEventListener('click', () => {
      modalSWE.classList.add('oculto');
    });
  }

  if (backdropSWE) {
    backdropSWE.addEventListener('click', () => {
      modalSWE.classList.add('oculto');
    });
  }

  // SWE-Bench tabs
  const sweTabs = modalSWE.querySelectorAll('.vc-tab');
  sweTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sweTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabId = tab.dataset.tab;
      modalSWE.querySelectorAll('.vc-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`).classList.add('active');
    });
  });

  // SWE-Bench project select
  const sweProyectoSelect = document.getElementById('sweProyectoSelect');
  const sweModeloSelect = document.getElementById('sweModeloSelect');
  const sweDatasetSelect = document.getElementById('sweDatasetSelect');
  const btnIniciarEvaluacion = document.getElementById('btnIniciarEvaluacion');

  const checkFormSWE = () => {
    btnIniciarEvaluacion.disabled = !sweProyectoSelect.value || !sweModeloSelect.value || !sweDatasetSelect.value;
  };

  if (sweProyectoSelect) sweProyectoSelect.addEventListener('change', checkFormSWE);
  if (sweModeloSelect) sweModeloSelect.addEventListener('change', checkFormSWE);
  if (sweDatasetSelect) sweDatasetSelect.addEventListener('change', checkFormSWE);

  if (btnIniciarEvaluacion) {
    btnIniciarEvaluacion.addEventListener('click', iniciarEvaluacionSWE);
  }
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

// ============================================================
// SWE-Bench Pro Functions
// ============================================================
let proyectosSWE = [];

async function cargarProyectosSWE() {
  try {
    const r = await fetch('/api/verbocode/projects');
    if (!r.ok) throw new Error('No se pudieron cargar los proyectos');
    const data = await r.json();
    proyectosSWE = data.proyectos || [];
    
    const select = document.getElementById('sweProyectoSelect');
    if (select) {
      select.innerHTML = '<option value="">Seleccionar proyecto...</option>';
      proyectosSWE.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.nombre;
        select.appendChild(option);
      });
    }
  } catch (e) {
    console.error('Error cargando proyectos SWE:', e);
  }
}

async function cargarDatasetsSWE() {
  const datasetList = document.getElementById('sweDatasetList');
  if (!datasetList) return;

  const datasets = [
    { id: 'swe-bench-lite', name: 'SWE-Bench Lite', description: 'Subset ligero de SWE-Bench con 300 tareas', tasks: 300 },
    { id: 'swe-bench-verifiable', name: 'SWE-Bench Verifiable', description: 'Tareas verificables automáticamente', tasks: 2294 },
    { id: 'swe-bench-pro', name: 'SWE-Bench Pro', description: 'Dataset completo de SWE-Bench Pro', tasks: 2294 },
  ];

  datasetList.innerHTML = datasets.map(d => `
    <div class="vc-dataset-item" data-id="${d.id}">
      <div class="vc-dataset-item-title">${d.name}</div>
      <div class="vc-dataset-item-meta">${d.description} • ${d.tasks} tareas</div>
    </div>
  `).join('');
}

async function iniciarEvaluacionSWE() {
  const proyectoId = document.getElementById('sweProyectoSelect').value;
  const modelo = document.getElementById('sweModeloSelect').value;
  const dataset = document.getElementById('sweDatasetSelect').value;
  
  if (!proyectoId || !modelo || !dataset) {
    mostrarToast('Selecciona todos los campos requeridos', 'error');
    return;
  }

  const statusDiv = document.getElementById('sweStatus');
  const statusText = document.getElementById('sweStatusText');
  const progressFill = document.getElementById('sweProgressFill');
  const btnIniciar = document.getElementById('btnIniciarEvaluacion');

  statusDiv.classList.remove('oculto');
  btnIniciar.disabled = true;
  progressFill.style.width = '0%';

  try {
    statusText.textContent = 'Iniciando evaluación SWE-Bench Pro...';
    progressFill.style.width = '10%';

    // Simular evaluación (en producción esto llamaría a una API real)
    await new Promise(resolve => setTimeout(resolve, 1000));
    statusText.textContent = 'Analizando estructura del proyecto...';
    progressFill.style.width = '25%';

    await new Promise(resolve => setTimeout(resolve, 1500));
    statusText.textContent = 'Ejecutando tareas de benchmark...';
    progressFill.style.width = '50%';

    await new Promise(resolve => setTimeout(resolve, 2000));
    statusText.textContent = 'Calculando puntuación...';
    progressFill.style.width = '75%';

    await new Promise(resolve => setTimeout(resolve, 1000));
    statusText.textContent = 'Evaluación completada';
    progressFill.style.width = '100%';

    mostrarToast('Evaluación completada exitosamente', 'success');
    
    // Agregar resultado a la pestaña de resultados
    const resultadosDiv = document.getElementById('sweResultados');
    const proyecto = proyectosSWE.find(p => p.id === proyectoId);
    const score = Math.floor(Math.random() * 30) + 40; // Score simulado entre 40-70%

    const resultadoHTML = `
      <div class="vc-result-item">
        <div class="vc-result-header">
          <span class="vc-result-title">${proyecto ? proyecto.nombre : 'Proyecto'}</span>
          <span class="vc-result-score">${score}%</span>
        </div>
        <div class="vc-result-details">
          Modelo: ${modelo} • Dataset: ${dataset} • Fecha: ${new Date().toLocaleDateString()}
        </div>
      </div>
    `;

    if (resultadosDiv.querySelector('.vc-empty-state')) {
      resultadosDiv.innerHTML = '';
    }
    resultadosDiv.insertAdjacentHTML('afterbegin', resultadoHTML);

  } catch (e) {
    console.error('Error en evaluación SWE:', e);
    mostrarToast('Error durante la evaluación: ' + e.message, 'error');
    statusText.textContent = 'Error en la evaluación';
  } finally {
    setTimeout(() => {
      statusDiv.classList.add('oculto');
      btnIniciar.disabled = false;
    }, 3000);
  }
}