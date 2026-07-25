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
      if (!r.ok) throw new Error('No se pudieron cargar las opciones.');
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
    } catch (e) {
      mostrarToast('No se pudieron cargar las opciones de Verbo Design.', 'error');
    }
  }

  // Antes esto usaba `new Function(...)`, que el navegador trata igual que
  // eval() — y el Content-Security-Policy del sitio, a propósito, NO tiene
  // 'unsafe-eval' habilitado (habilitarlo bajaría la seguridad de todo el
  // sitio, no solo de esto). Por eso tiraba el error de CSP. La forma
  // correcta de correr código generado sin eval es inyectar un <script>
  // real en el DOM: sí está permitido (scriptSrcElem tiene 'unsafe-inline')
  // y el navegador lo ejecuta como un script normal, no como eval.
  function ejecutarCodigoSonido(codigo) {
    const id = '__verboSonido_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    script.textContent = `window.${id} = function(){\n${codigo}\nreturn (typeof reproducirSonido === 'function') ? reproducirSonido() : undefined;\n};`;
    document.head.appendChild(script);
    try {
      if (typeof window[id] !== 'function') throw new Error('El código generado no definió reproducirSonido().');
      window[id]();
    } finally {
      document.head.removeChild(script);
      delete window[id];
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

  // ============================================================
  // Tabs
  // ============================================================
  function initTabs() {
    const tabs = document.querySelectorAll('.vd-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const destino = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle('activo', t === tab));
        document.querySelectorAll('.vd-panel').forEach((p) => p.classList.add('oculto'));
        $('vdFooterImagenes').style.display = destino === 'imagenes' ? '' : 'none';
        if (destino === 'imagenes') $('vdPanelImagenes').classList.remove('oculto');
        if (destino === 'plantillas') {
          $('vdPanelPlantillas').classList.remove('oculto');
          cargarPlantillas();
        }
        if (destino === 'sonidos') $('vdPanelSonidos').classList.remove('oculto');
      });
    });
  }

  // ============================================================
  // Plantillas HTML
  // ============================================================
  let plantillasCargadas = false;
  let plantillasData = [];
  let categoriaActiva = 'Todas';

  async function cargarPlantillas() {
    if (plantillasCargadas) return;
    const grid = $('vdPlantillasGrid');
    grid.innerHTML = '<div class="vd-loading-inline"><div class="vc-spinner"></div> Cargando plantillas...</div>';
    try {
      const r = await fetch('/api/verbodesign/templates');
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error('No se pudieron cargar las plantillas.');
      plantillasCargadas = true;
      plantillasData = data.plantillas || [];
      renderChipsCategorias();
      renderGridPlantillas();
    } catch (e) {
      grid.innerHTML = `<p class="vd-error-inline">${e.message}</p>`;
    }
  }

  function renderChipsCategorias() {
    const cont = $('vdPlantillasCategorias');
    const categorias = ['Todas', ...new Set(plantillasData.map((p) => p.categoria))];
    cont.innerHTML = '';
    categorias.forEach((cat) => {
      const chip = document.createElement('button');
      chip.className = 'vd-chip' + (cat === categoriaActiva ? ' activo' : '');
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        categoriaActiva = cat;
        cont.querySelectorAll('.vd-chip').forEach((c) => c.classList.toggle('activo', c.textContent === cat));
        renderGridPlantillas();
      });
      cont.appendChild(chip);
    });
  }

  // Colorcito por categoría, solo para que las tarjetas no se vean todas
  // iguales y sea más fácil escanear el grid de un vistazo.
  const COLOR_CATEGORIA = {
    Landing: '#6d5efc',
    Portfolio: '#e8664a',
    Dashboard: '#3fb950',
    Formulario: '#4f46e5',
    'Autenticación': '#5b8cff',
    'E-commerce': '#f59e0b',
    Blog: '#ec4899',
    Estado: '#8b5cf6',
    Componentes: '#14b8a6',
  };

  function escaparParaAtributo(html) {
    return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function renderGridPlantillas() {
    const grid = $('vdPlantillasGrid');
    const filtradas = categoriaActiva === 'Todas' ? plantillasData : plantillasData.filter((p) => p.categoria === categoriaActiva);
    grid.innerHTML = '';
    filtradas.forEach((p) => {
      const color = COLOR_CATEGORIA[p.categoria] || 'var(--vc-accent)';
      const card = document.createElement('div');
      card.className = 'vd-plantilla-card';
      card.style.setProperty('--cat-color', color);
      card.innerHTML = `
        <div class="vd-plantilla-preview" data-id="${p.id}" title="Click para ver completa">
          <iframe class="vd-plantilla-iframe" srcdoc="${escaparParaAtributo(p.html)}" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock" tabindex="-1" loading="lazy"></iframe>
          <div class="vd-plantilla-preview-overlay"><span>Ver completa</span></div>
        </div>
        <div class="vd-plantilla-body">
          <span class="vd-plantilla-tag" style="color:${color};background:${color}1a;border-color:${color}40">${p.categoria}</span>
          <h3>${p.nombre}</h3>
          <p>${p.descripcion}</p>
          <div class="vd-plantilla-actions">
            <button class="vd-btn-ver" data-id="${p.id}">Ver código</button>
            <button class="vd-btn-copiar" data-id="${p.id}">Copiar</button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
    grid.querySelectorAll('.vd-plantilla-preview').forEach((prev) => {
      prev.addEventListener('click', () => verPlantilla(prev.dataset.id));
    });
    grid.querySelectorAll('.vd-btn-copiar').forEach((btn) => {
      btn.addEventListener('click', () => copiarPlantilla(btn.dataset.id));
    });
    grid.querySelectorAll('.vd-btn-ver').forEach((btn) => {
      btn.addEventListener('click', () => verPlantilla(btn.dataset.id));
    });
  }

  async function obtenerPlantilla(id) {
    const enCache = plantillasData.find((p) => p.id === id);
    if (enCache && enCache.html) return enCache;
    const r = await fetch(`/api/verbodesign/templates/${id}`);
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error('No se pudo cargar la plantilla.');
    return data.plantilla;
  }

  async function copiarPlantilla(id) {
    try {
      const plantilla = await obtenerPlantilla(id);
      await navigator.clipboard.writeText(plantilla.html);
      mostrarToast('Código copiado al portapapeles', 'success');
    } catch (e) {
      mostrarToast(e.message || 'No se pudo copiar.', 'error');
    }
  }

  async function verPlantilla(id) {
    try {
      const plantilla = await obtenerPlantilla(id);
      // Antes esto abría una pestaña en blanco (about:blank) y recién after
      // eso le hacía document.write() — en varios navegadores eso se ve
      // exactamente igual a como abren las páginas de phishing/adware, así
      // que aunque era inofensivo (era el código de la propia plantilla)
      // generaba desconfianza. Ahora se arma un Blob real con la URL
      // "blob:https://..." (mismo mecanismo que usa "Probar" en Verbo Code),
      // que se ve como una página normal y no como una pestaña vacía.
      const blob = new Blob([plantilla.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      mostrarToast(e.message || 'No se pudo abrir la plantilla.', 'error');
    }
  }

  // ============================================================
  // Sonidos
  // ============================================================
  let generandoSonido = false;
  async function generarSonido() {
    if (generandoSonido) return;
    const input = $('vdSonidoInput');
    const descripcion = input.value.trim();
    if (!descripcion) return;

    generandoSonido = true;
    const btn = $('vdBtnSonido');
    btn.disabled = true;
    input.value = '';

    const lista = $('vdSonidosLista');
    const item = document.createElement('div');
    item.className = 'vd-sonido-item vd-loading';
    item.innerHTML = '<div class="vc-spinner"></div><span>Generando...</span>';
    lista.prepend(item);

    try {
      const r = await fetch('/api/verbodesign/sound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el sonido.');

      item.className = 'vd-sonido-item';
      const codigoId = 'snd_' + Math.random().toString(36).slice(2);
      item.innerHTML = `
        <div class="vd-sonido-header">
          <strong>${descripcion}</strong>
          <div class="vd-sonido-actions">
            <button class="vd-btn-play">▶ Probar</button>
            <button class="vd-btn-copiar-sonido">Copiar código</button>
          </div>
        </div>
        <pre class="vd-sonido-codigo" id="${codigoId}">${data.codigo.replace(/</g, '&lt;')}</pre>
      `;
      item.querySelector('.vd-btn-play').addEventListener('click', () => {
        try {
          ejecutarCodigoSonido(data.codigo);
        } catch (e) {
          mostrarToast('Error ejecutando el sonido: ' + e.message, 'error');
        }
      });
      item.querySelector('.vd-btn-copiar-sonido').addEventListener('click', async () => {
        await navigator.clipboard.writeText(data.codigo);
        mostrarToast('Código copiado al portapapeles', 'success');
      });
    } catch (e) {
      item.remove();
      mostrarToast(e.message || 'Error generando el sonido.', 'error');
    } finally {
      generandoSonido = false;
      btn.disabled = false;
      input.focus();
    }
  }

  function initSonidos() {
    $('vdBtnSonido').addEventListener('click', generarSonido);
    $('vdSonidoInput').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') generarSonido();
    });
  }

  function init() {
    aplicarTema();
    cargarUsuario();
    cargarModelos();
    initInputAutoResize();
    initTabs();
    initSonidos();
    $('vdBtnGenerar').addEventListener('click', generar);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
