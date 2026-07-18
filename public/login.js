
const formLogin = document.getElementById('formLogin');
const formRegistro = document.getElementById('formRegistro');
const formCodigo = document.getElementById('formCodigo');
const formNombre = document.getElementById('formNombre');

const btnIngresar = document.getElementById('btnIngresar');
const elError = document.getElementById('mensajeError');

const btnPedirCodigo = document.getElementById('btnPedirCodigo');
const elErrorRegistro = document.getElementById('mensajeErrorRegistro');

const btnConfirmarCodigo = document.getElementById('btnConfirmarCodigo');
const elErrorCodigo = document.getElementById('mensajeErrorCodigo');
const elInfoCodigo = document.getElementById('mensajeInfoCodigo');
const correoCodigoTexto = document.getElementById('correoCodigoTexto');
const lineaReenviar = document.getElementById('lineaReenviar');
const reenviarCodigo = document.getElementById('reenviarCodigo');

const btnConfirmarNombre = document.getElementById('btnConfirmarNombre');
const elErrorNombre = document.getElementById('mensajeErrorNombre');

let emailPendienteVerificacion = '';
let origenCodigo = 'registro';
const parametrosURL = new URLSearchParams(window.location.search);

function mostrarVista(vista) {
  [formLogin, formRegistro, formCodigo, formNombre].forEach((f) => f.classList.add('oculto'));
  vista.classList.remove('oculto');
}

document.getElementById('irARegistro').addEventListener('click', (ev) => {
  ev.preventDefault();
  mostrarVista(formRegistro);
});
document.getElementById('irALogin').addEventListener('click', (ev) => {
  ev.preventDefault();
  mostrarVista(formLogin);
});
document.getElementById('volverDeRegistro').addEventListener('click', (ev) => {
  ev.preventDefault();
  mostrarVista(origenCodigo === 'google' ? formLogin : formRegistro);
});
reenviarCodigo.addEventListener('click', async (ev) => {
  ev.preventDefault();
  elErrorCodigo.classList.add('oculto');
  elInfoCodigo.classList.add('oculto');
  reenviarCodigo.textContent = 'Enviando...';
  try {
    const res = await fetch('/api/google/reenviar', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.ok) {
      elInfoCodigo.textContent = 'Te mandamos un codigo nuevo.';
      elInfoCodigo.classList.remove('oculto');
    } else {
      elErrorCodigo.textContent = data.error || 'No se pudo reenviar el codigo.';
      elErrorCodigo.classList.remove('oculto');
    }
  } catch (e) {
    elErrorCodigo.textContent = 'Error de conexion con el servidor.';
    elErrorCodigo.classList.remove('oculto');
  } finally {
    reenviarCodigo.textContent = 'Reenviar codigo';
  }
});

if (parametrosURL.get('paso') === 'google_codigo') {
  origenCodigo = 'google';
  correoCodigoTexto.textContent = parametrosURL.get('correo') || 'tu correo de Google';
  lineaReenviar.style.display = '';
  mostrarVista(formCodigo);
}

if (parametrosURL.get('error')) {
  const mensajes = {
    google_denegado: 'Cancelaste el inicio de sesion con Google.',
    google_estado_invalido: 'La sesion de login expiro, intenta de nuevo.',
    google_sin_codigo: 'Google no devolvio los datos esperados, intenta de nuevo.',
    google_token: 'No se pudo confirmar tu cuenta de Google, intenta de nuevo.',
    google_userinfo: 'No se pudo leer tu perfil de Google, intenta de nuevo.',
    google_sin_email: 'Tu cuenta de Google no tiene un correo disponible.',
    google_correo_codigo: 'No se pudo mandar el codigo de verificacion a tu correo. Intenta de nuevo.',
    google_interno: 'Ocurrio un error inesperado con el login de Google.',
  };
  elError.textContent = mensajes[parametrosURL.get('error')] || 'No se pudo iniciar sesion con Google.';
  elError.classList.remove('oculto');
}

formLogin.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  elError.classList.add('oculto');
  btnIngresar.disabled = true;
  btnIngresar.textContent = 'Ingresando...';

  const usuario = document.getElementById('usuario').value.trim();
  const clave = document.getElementById('clave').value;
  const recordar = document.getElementById('recordar').checked;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, clave, recordar }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      window.location.href = '/';
      return;
    }
    elError.textContent = data.error || 'No se pudo iniciar sesion.';
    elError.classList.remove('oculto');
  } catch (e) {
    elError.textContent = 'Error de conexion con el servidor.';
    elError.classList.remove('oculto');
  } finally {
    btnIngresar.disabled = false;
    btnIngresar.textContent = 'Iniciar sesion';
  }
});

formRegistro.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  elErrorRegistro.classList.add('oculto');

  const email = document.getElementById('regEmail').value.trim();
  const clave = document.getElementById('regClave').value;
  const clave2 = document.getElementById('regClave2').value;

  if (clave !== clave2) {
    elErrorRegistro.textContent = 'Las contrasenas no coinciden.';
    elErrorRegistro.classList.remove('oculto');
    return;
  }

  btnPedirCodigo.disabled = true;
  btnPedirCodigo.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/registro/solicitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, clave }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      origenCodigo = 'registro';
      lineaReenviar.style.display = 'none';
      emailPendienteVerificacion = email;
      correoCodigoTexto.textContent = email;
      document.getElementById('codigoInput').value = '';
      mostrarVista(formCodigo);
      return;
    }
    elErrorRegistro.textContent = data.error || 'No se pudo enviar el codigo.';
    elErrorRegistro.classList.remove('oculto');
  } catch (e) {
    elErrorRegistro.textContent = 'Error de conexion con el servidor.';
    elErrorRegistro.classList.remove('oculto');
  } finally {
    btnPedirCodigo.disabled = false;
    btnPedirCodigo.textContent = 'Enviarme un codigo';
  }
});

formCodigo.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  elErrorCodigo.classList.add('oculto');
  btnConfirmarCodigo.disabled = true;
  btnConfirmarCodigo.textContent = 'Confirmando...';

  const codigo = document.getElementById('codigoInput').value.trim();

  const esGoogle = origenCodigo === 'google';
  const url = esGoogle ? '/api/google/confirmar' : '/api/registro/confirmar';
  const cuerpo = esGoogle ? { codigo } : { email: emailPendienteVerificacion, codigo };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      if (data.necesitaNombre) {
        mostrarVista(formNombre);
        document.getElementById('nombreInput').focus();
        return;
      }
      window.location.href = '/';
      return;
    }
    elErrorCodigo.textContent = data.error || 'El codigo no es correcto.';
    elErrorCodigo.classList.remove('oculto');
  } catch (e) {
    elErrorCodigo.textContent = 'Error de conexion con el servidor.';
    elErrorCodigo.classList.remove('oculto');
  } finally {
    btnConfirmarCodigo.disabled = false;
    btnConfirmarCodigo.textContent = 'Confirmar';
  }
});

formNombre.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  elErrorNombre.classList.add('oculto');
  btnConfirmarNombre.disabled = true;
  btnConfirmarNombre.textContent = 'Guardando...';

  const nombre = document.getElementById('nombreInput').value.trim();
  const aceptaTerminos = document.getElementById('aceptaTerminos').checked;

  try {
    const res = await fetch('/api/perfil/nombre', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, aceptaTerminos }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      window.location.href = '/';
      return;
    }
    elErrorNombre.textContent = data.error || 'No se pudo guardar tu nombre.';
    elErrorNombre.classList.remove('oculto');
  } catch (e) {
    elErrorNombre.textContent = 'Error de conexion con el servidor.';
    elErrorNombre.classList.remove('oculto');
  } finally {
    btnConfirmarNombre.disabled = false;
    btnConfirmarNombre.textContent = 'Aceptar y continuar';
  }
});
