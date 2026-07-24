(() => {
  const estado = {
    modelos: [],
    modeloSeleccionado: 'DesignLite',
    generando: false,
  };

  const $ = (id) => document.getElementById(id);

  function mostrarToast(texto, tipo = '') {
    const toast = $('vdToast');
    if (!toast) return;
    toast.textContent = texto;
    toast.className = 'vc-toast' + (tipo ? ' ' + tipo : '');
    toast.classList.remove('oculto');
    setTimeout(() => toast.classList.add('oculto'), 3500);
  }

  function aplicarTema() {
    const tema = localStorage.getItem('verboAiTema') || 'default';
    if (tema === 'df-night') {
      document.documentElement.classList.add('tema-night');
    }
  }

  async function cargarUsuario() {
    try {
      const r = await fetch('/api/creditos');
      if (!r.ok) {
        window.location.href = '/login';
        return;
      }
      const d = await r.json();

      localStorage.setItem('verboAiEsAdmin', d.esAdmin ? 'true' : 'false');
      window.esUsuarioAdmin = !!d.esAdmin;

      const nombre = d.usuario || 'Usuario';
      $('vcPerfilNombre').textContent = nombre;
      $('vcPerfilAvatar').textContent = nombre.charAt(0).toUpperCase();

      if (!d.esAdmin) {
        mostrarToast('Verbo Design es exclusivo para cuentas administrador.', 'error');
        setTimeout(() => { window.location.href = '/'; }, 1500);
      }
    } catch (e) {
      window.location.href = '/login';
    }
  }

  async function cargarModelos() {
    try {
      const r = await fetch('/api/verbodesign/models');
      if (!r.ok) throw new Error('No se pudieron cargar los modelos.');
      const data = await r.json();
      estado.modelos = data.modelos || [];

      const select = $('vdModeloSelect');
      select.innerHTML = '';
      estado.modelos.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.nombre;
        opt.textContent = m.nombre;
        select.appendChild(opt);
      });
      if (estado.modelos.length) estado.modeloSeleccionado = estado.modelos[0].nombre;
      select.value = estado.modeloSeleccionado;
      select.addEventListener('change', () => { estado.modeloSeleccionado = select.value; });

      const info = $('vdModelosInfo');
      info.innerHTML = '';
      estado.modelos.forEach((m) => {
        const card = document.createElement('div');
        card.className = 'vd-modelo-card';
        card.innerHTML = `<strong>${m.nombre}</strong>${m.badge ? `<span class="vd-badge">${m.badge}</span>` : ''} — ${m.descripcion}`;
        info.appendChild(card);
      });
    } catch (e) {
      mostrarToast('No se pudieron cargar los modelos de Verbo Design.', 'error');
    }
  }

  function crearCardLoading() {
    const card = document.createElement('div');
    card.className = 'vd-card vd-loading';
    card.innerHTML = '<div class="vc-spinner"></div><span>Generando...</span>';
    return card;
  }

  function renderResultado(card, imagen, prompt, modelo) {
    card.className = 'vd-card';
    card.innerHTML = `
      <img src="${imagen.url}" alt="${prompt.replace(/"/g, '&quot;')}">
      <div class="vd-card-body">
        <div class="vd-card-prompt" title="${prompt.replace(/"/g, '&quot;')}">${prompt}</div>
        <div class="vd-card-actions">
          <span>${modelo}${imagen.tamanoKB ? ' · ' + imagen.tamanoKB + ' KB' : ''}</span>
          <a href="${imagen.url}" download target="_blank" rel="noopener">Descargar</a>
        </div>
      </div>
    `;
  }

  async function generar() {
    if (estado.generando) return;
    const input = $('vdPrompt');
    const prompt = input.value.trim();
    if (!prompt) return;

    estado.generando = true;
    const btn = $('vdBtnGenerar');
    btn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    $('vdBienvenida').style.display = 'none';
    const galeria = $('vdGaleria');
    const card = crearCardLoading();
    galeria.prepend(card);

    try {
      const r = await fetch('/api/verbodesign/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, modelo: estado.modeloSeleccionado }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo generar el diseño.');
      }
      renderResultado(card, data.imagen, prompt, data.modelo || estado.modeloSeleccionado);
    } catch (e) {
      card.remove();
      mostrarToast(e.message || 'Error generando el diseño.', 'error');
    } finally {
      estado.generando = false;
      btn.disabled = false;
      input.focus();
    }
  }

  function initInputAutoResize() {
    const input = $('vdPrompt');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        generar();
      }
    });
  }

  function init() {
    aplicarTema();
    cargarUsuario();
    cargarModelos();
    initInputAutoResize();
    $('vdBtnGenerar').addEventListener('click', generar);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
