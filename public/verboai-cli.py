#!/usr/bin/env python3
"""
verboai - Cliente de terminal para Verbo AI

Uso:
  python verboai.py login TUTOKEN    Guarda el token y valida que funcione
  python verboai.py run              Inicia el chat interactivo (REPL)
  python verboai.py info             Muestra info del token guardado (creditos, modelos)
  python verboai.py ayuda            Muestra esta ayuda

Tambien podes pasar el token directo:
  python verboai.py verboai-XXXX     (atajo de "login verboai-XXXX")

El flujo es:
  1. Generas un token en la web (Settings -> Clave API -> Generar API token)
  2. En la terminal:  python verboai.py login verboai-XXXX
     (lo valida contra el servidor y lo guarda en ~/.verboai/token)
  3. En la terminal:  python verboai.py run
     (levanta un servidor proxy local en http://localhost:7788 y arranca
      el REPL interactivo)
  4. Te pide elegir modelo (NewserLite o NewserAvanced)
  5. Escribis mensajes + Enter -> te responde
  6. Comandos especiales dentro del REPL:
       /modelo         Cambiar de modelo en vivo
       /creditos       Ver cuantos creditos te quedan
       /info           Info completa del token
       /salir          Cerrar y salir

  Si mandas "Generame [descripcion]" -> genera imagen y la abre en el visor.

Seguridad:
  - El token se guarda en ~/.verboai/token (permisos 600)
  - El servidor proxy local solo escucha en 127.0.0.1 (no sale a la red)
  - El token nunca se imprime en pantalla despues de guardarlo

Para integrarlo en tu propia web/app (sin el CLI), segui los ejemplos de curl
que estan en Settings -> Clave API -> "Como usar el token" de la web.
"""

import sys
import os
import json
import urllib.request
import urllib.error
import socketserver
import http.server
import threading
import subprocess
import platform
import webbrowser
from pathlib import Path

API_URL_BASE = os.environ.get("VERBOAI_URL", "https://verboai.duckdns.org")

PROXY_PORT = int(os.environ.get("VERBOAI_PORT", "7788"))

CONFIG_DIR = Path.home() / ".verboai"
TOKEN_FILE = CONFIG_DIR / "token"
CONFIG_FILE = CONFIG_DIR / "config.json"

def ensure_config_dir():
    """Crea ~/.verboai/ si no existe, con permisos seguros."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(CONFIG_DIR, 0o700)
    except OSError:
        pass

def guardar_token(token):
    """Guarda el token en ~/.verboai/token con permisos 600."""
    ensure_config_dir()
    TOKEN_FILE.write_text(token.strip(), encoding="utf-8")
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass

def leer_token():
    """Lee el token guardado. Devuelve None si no existe."""
    if not TOKEN_FILE.exists():
        return None
    try:
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None

def guardar_config(config):
    """Guarda el config.json (modelo preferido, etc)."""
    ensure_config_dir()
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass

def leer_config():
    """Lee el config.json. Devuelve {} si no existe."""
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

def http_get(url, token=None, timeout=15):
    """Hace un GET y devuelve (status, json_or_text, is_json)."""
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(data), True
            except json.JSONDecodeError:
                return resp.status, data, False
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
            return e.code, json.loads(body), True
        except (OSError, json.JSONDecodeError):
            return e.code, None, False
    except urllib.error.URLError as e:
        return 0, {"error": f"No se pudo conectar a {url}: {e.reason}"}, True

def http_post_json(url, body, token=None, timeout=120):
    """Hace un POST con JSON y devuelve (status, json_or_text, is_json)."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            rdata = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(rdata), True
            except json.JSONDecodeError:
                return resp.status, rdata, False
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8")
            return e.code, json.loads(body), True
        except (OSError, json.JSONDecodeError):
            return e.code, None, False
    except urllib.error.URLError as e:
        return 0, {"error": f"No se pudo conectar a {url}: {e.reason}"}, True

class C:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    GRAY = "\033[90m"

def out(text, color=None, end="\n"):
    if color:
        print(f"{color}{text}{C.RESET}", end=end, flush=True)
    else:
        print(text, end=end, flush=True)

def banner():
    out("=" * 56, C.DIM)
    out(f"  {C.BOLD}{C.CYAN}Verbo AI{C.RESET} - Cliente de terminal", C.BOLD)
    out(f"  Servidor: {API_URL_BASE}", C.DIM)
    out("=" * 56, C.DIM)

def cmd_guardar_token(token):
    banner()
    if not token or not token.startswith("verboai-"):
        out("Token invalido. Debe empezar con 'verboai-'.", C.RED)
        sys.exit(1)

    out(f"Validando token contra {API_URL_BASE}...", C.DIM)
    status, data, is_json = http_get(f"{API_URL_BASE}/api/v1/info", token=token)

    if status == 0:
        out(f"No se pudo conectar: {data.get('error', 'error desconocido')}", C.RED)
        sys.exit(1)
    if status != 200:
        msg = data.get("error", f"HTTP {status}") if is_json else f"HTTP {status}"
        out(f"Token invalido: {msg}", C.RED)
        sys.exit(1)

    guardar_token(token)
    out("Token valido y guardado.", C.GREEN)
    out(f"  Nombre:    {data.get('nombre', '-')}", C.DIM)
    if data.get("creditos") == -1:
        out("  Creditos:  infinito (admin)", C.DIM)
    else:
        out(f"  Creditos:  {data.get('creditos', '?')} / {data.get('creditosIniciales', '?')}", C.DIM)
    out(f"  Modelos disponibles:", C.DIM)
    for m in data.get("modelos", []):
        costo = m.get("costoCreditos", 1)
        out(f"    - {m['nombre']:15s}  ({costo} credito/pedido, {m.get('rateLimitMax', '?')}/min)", C.DIM)
    out("")
    out(f"Ahora podes correr:  {C.BOLD}python verboai.py run{C.RESET}", C.GREEN)
    out("")

class ProxyHandler(http.server.BaseHTTPRequestHandler):
    """
    Proxy muy simple: recibe POST /chat en localhost y lo reenvia a la API
    real con el token inyectado desde el archivo. Asi el usuario (y cualquier
    otra app en la misma maquina) puede llamar a http://localhost:7788/chat
    sin necesidad de conocer el token.
    """

    def log_message(self, format, *args):
        
        pass

    def _enviar_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        token = leer_token()
        if not token:
            self._enviar_json(401, {"ok": False, "error": "No hay token guardado. Corre: verboai:TUTOKEN"})
            return
        if self.path == "/info":
            status, data, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
            self._enviar_json(status if status else 500, data if data else {"ok": False, "error": "sin respuesta"})
            return
        self._enviar_json(404, {"ok": False, "error": "Ruta no encontrada. Usa POST /chat o GET /info."})

    def do_POST(self):
        token = leer_token()
        if not token:
            self._enviar_json(401, {"ok": False, "error": "No hay token guardado. Corre: verboai:TUTOKEN"})
            return
        if self.path != "/chat":
            self._enviar_json(404, {"ok": False, "error": "Ruta no encontrada. Usa POST /chat."})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(body)
        except (OSError, json.JSONDecodeError) as e:
            self._enviar_json(400, {"ok": False, "error": f"JSON invalido: {e}"})
            return

        status, data, _ = http_post_json(
            f"{API_URL_BASE}/api/v1/chat",
            payload,
            token=token,
            timeout=180,
        )
        self._enviar_json(status if status else 500, data if data else {"ok": False, "error": "sin respuesta"})

def iniciar_proxy_local():
    """Levanta el servidor proxy en un hilo daemon. Devuelve el puerto real."""
    try:
        server = socketserver.TCPServer(("127.0.0.1", PROXY_PORT), ProxyHandler)
    except OSError as e:
        
        if "Address already in use" in str(e):
            out(f"  Puerto {PROXY_PORT} en uso. Cerrando proceso viejo...", C.YELLOW)
            
            try:
                if platform.system() == "Windows":
                    subprocess.run(["netstat", "-ano"], capture_output=True)
                else:
                    subprocess.run(["fuser", "-k", f"{PROXY_PORT}/tcp"], capture_output=True)
            except OSError:
                pass
            try:
                server = socketserver.TCPServer(("127.0.0.1", PROXY_PORT), ProxyHandler)
            except OSError:
                out(f"No se pudo levantar el proxy en puerto {PROXY_PORT}.", C.RED)
                return None
        else:
            raise

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return PROXY_PORT

def elegir_modelo(config):
    token = leer_token()
    if not token:
        out("No hay token guardado. Corre primero: verboai:TUTOKEN", C.RED)
        sys.exit(1)

    out("Obteniendo lista de modelos...", C.DIM)
    status, data, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
    if status != 200 or not data or "modelos" not in data:
        out("No se pudo obtener la lista de modelos. Usando NewserLite por defecto.", C.YELLOW)
        return "NewserLite"

    modelos_disponibles = [m for m in data["modelos"] if m.get("disponible", True) != False]
    modelos_bloqueados = [m for m in data["modelos"] if m.get("disponible", True) == False]

    out("")
    out(f"{C.BOLD}Elegi un modelo:{C.RESET}", C.BOLD)
    for i, m in enumerate(modelos_disponibles, 1):
        costo = m.get("costoCreditos", 1)
        rl = m.get("rateLimitMax", "?")
        badge = f" [{m.get('badge','')}]" if m.get("badge") else ""
        out(f"  {C.CYAN}{i}{C.RESET}. {C.BOLD}{m['nombre']}{C.RESET}{badge}  -  {m.get('descripcion', '')}")
        out(f"     {C.GRAY}Costo: {costo} credito(s)/pedido  |  Rate limit: {rl}/min{C.RESET}", C.DIM)

    for m in modelos_bloqueados:
        badge = m.get("badge", "pronto")
        out(f"  {C.GRAY}- {m['nombre']} [{badge}] (no disponible){C.RESET}", C.DIM)

    out("")

    while True:
        try:
            eleccion = input(f"{C.BOLD}Modelo [1-{len(modelos_disponibles)}] (default 1): {C.RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            out("\nCancelado.", C.YELLOW)
            sys.exit(0)
        if not eleccion:
            return modelos_disponibles[0]["nombre"]
        try:
            idx = int(eleccion) - 1
            if 0 <= idx < len(modelos_disponibles):
                return modelos_disponibles[idx]["nombre"]
        except ValueError:
            pass

        for m in modelos_disponibles:
            if eleccion.lower() == m["nombre"].lower():
                return m["nombre"]

        for m in modelos_bloqueados:
            if eleccion.lower() == m["nombre"].lower():
                out(f"El modelo {m['nombre']} no esta disponible aun. Elegi NewserLite o NewserAdvanced.", C.RED)
                break
        else:
            out(f"Opcion invalida. Probá 1-{len(modelos_disponibles)} o el nombre del modelo.", C.RED)

def abrir_imagen(url):
    """Descarga una imagen del servidor y la abre con el visor del sistema."""
    
    if url.startswith("/"):
        url_completa = f"{API_URL_BASE}{url}"
    else:
        url_completa = url

    import tempfile
    try:
        req = urllib.request.Request(url_completa)
        with urllib.request.urlopen(req, timeout=60) as resp:
            if resp.status != 200:
                out(f"  No se pudo descargar la imagen (HTTP {resp.status}).", C.RED)
                return
            mime = resp.headers.get("Content-Type", "image/jpeg")
            ext = ".jpg"
            if "png" in mime:
                ext = ".png"
            elif "webp" in mime:
                ext = ".webp"
            data = resp.read()
            if not data:
                out("  La imagen vino vacia.", C.RED)
                return
            tmp = Path(tempfile.gettempdir()) / f"verboai_img_{os.getpid()}{ext}"
            tmp.write_bytes(data)
    except Exception as e:
        out(f"  Error descargando imagen: {e}", C.RED)
        return

    out(f"  Imagen guardada en: {tmp}", C.DIM)
    
    try:
        sistema = platform.system()
        if sistema == "Darwin":  
            subprocess.Popen(["open", str(tmp)])
        elif sistema == "Windows":
            subprocess.Popen(["start", "", str(tmp)], shell=True)
        else:  
            subprocess.Popen(["xdg-open", str(tmp)])
        out(f"  {C.GREEN}Abriendo imagen...{C.RESET}", C.GREEN)
    except Exception as e:
        out(f"  No se pudo abrir el visor automaticamente: {e}", C.YELLOW)
        out(f"  Abrila manualmente: {tmp}", C.DIM)

def enviar_mensaje(mensaje, modelo):
    """Envia un mensaje a la API y devuelve la respuesta parseada."""
    token = leer_token()
    if not token:
        return {"ok": False, "error": "No hay token guardado"}

    body = {"mensaje": mensaje, "modelo": modelo}
    status, data, _ = http_post_json(
        f"{API_URL_BASE}/api/v1/chat",
        body,
        token=token,
        timeout=180,
    )
    if status == 0:
        return {"ok": False, "error": data.get("error", "sin conexion") if data else "sin conexion"}
    if status != 200:
        return data if data else {"ok": False, "error": f"HTTP {status}"}
    return data

def cmd_run():
    banner()
    token = leer_token()
    if not token:
        out("No hay token guardado. Primero corre:", C.RED)
        out(f"  python verboai.py:TUTOKEN", C.BOLD)
        out("")
        sys.exit(1)

    out("Validando token...", C.DIM)
    status, data, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
    if status != 200:
        msg = data.get("error", f"HTTP {status}") if data else f"HTTP {status}"
        out(f"Token invalido o expirado: {msg}", C.RED)
        out("Volve a guardarlo con: python verboai.py login TUTOKEN", C.YELLOW)
        sys.exit(1)

    if (data or {}).get("creditos") == -1:
        out(f"{C.GREEN}Token valido.{C.RESET}  Creditos: infinito (admin)", C.GREEN)
    else:
        out(f"{C.GREEN}Token valido.{C.RESET}  Creditos: {(data or {}).get('creditos', '?')}/{(data or {}).get('creditosIniciales', '?')}", C.GREEN)

    modelo = elegir_modelo(data if isinstance(data, dict) else {})
    out("")
    out(f"{C.BOLD}Modelo activo:{C.RESET} {C.CYAN}{modelo}{C.RESET}", C.BOLD)
    out("")

    out(f"Levantando servidor proxy local en http://127.0.0.1:{PROXY_PORT} ...", C.DIM)
    puerto = iniciar_proxy_local()
    if puerto is None:
        out("No se pudo levantar el proxy. Continuando sin proxy (modo directo).", C.YELLOW)
    else:
        out(f"{C.GREEN}Proxy activo.{C.RESET} Otras apps en esta maquina pueden usar:", C.GREEN)
        out(f"  POST http://127.0.0.1:{puerto}/chat   (sin necesidad del token)", C.DIM)
        out(f"  GET  http://127.0.0.1:{puerto}/info", C.DIM)
    out("")

    out(f"{C.BOLD}Escribi tu mensaje y presiona Enter.{C.RESET} Comandos: {C.CYAN}/modelo{C.RESET}, {C.CYAN}/creditos{C.RESET}, {C.CYAN}/info{C.RESET}, {C.CYAN}/salir{C.RESET}", C.DIM)
    out("")

    while True:
        try:
            
            prompt = f"{C.BOLD}{C.CYAN}{modelo}>{C.RESET} "
            mensaje = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            out("\nChau! :)", C.YELLOW)
            break

        if not mensaje:
            continue

        if mensaje.lower() in ("/salir", "/exit", "/quit", "/q"):
            out("Chau! :)", C.YELLOW)
            break

        if mensaje.lower() == "/modelo":
            modelo = elegir_modelo({})
            out(f"{C.BOLD}Modelo cambiado a:{C.RESET} {C.CYAN}{modelo}{C.RESET}", C.GREEN)
            continue

        if mensaje.lower() == "/creditos":
            status, info, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
            if status == 200 and info:
                if info.get("creditos") == -1:
                    out(f"  Creditos: {C.BOLD}infinito (admin){C.RESET}", C.BOLD)
                else:
                    out(f"  Creditos: {C.BOLD}{info.get('creditos', '?')}{C.RESET} / {info.get('creditosIniciales', '?')}", C.BOLD)
            else:
                out(f"  No se pudo obtener info: {info}", C.RED)
            out("")
            continue
        if mensaje.lower() == "/info":
            status, info, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
            if status == 200 and info:
                if info.get("creditos") == -1:
                    out(f"  {C.BOLD}Creditos:{C.RESET} infinito (admin)")
                else:
                    out(f"  {C.BOLD}Creditos:{C.RESET} {info.get('creditos', '?')} / {info.get('creditosIniciales', '?')}")
                out(f"  {C.BOLD}Creado:{C.RESET} {info.get('creadoEn', '-')}")
                out(f"  {C.BOLD}Ultimo uso:{C.RESET} {info.get('ultimoUso', '-')}")
                out(f"  {C.BOLD}Modelos disponibles:{C.RESET}")
                for m in info.get("modelos", []):
                    activo = " <==" if m["nombre"] == modelo else ""
                    out(f"    - {m['nombre']:15s}  ({m.get('costoCreditos', 1)} credito(s)){activo}")
            else:
                out(f"  No se pudo obtener info: {info}", C.RED)
            out("")
            continue
        if mensaje.lower() in ("/help", "/ayuda", "/?"):
            out(f"  {C.BOLD}Comandos:{C.RESET}")
            out(f"    /modelo    Cambiar de modelo (NewserLite / NewserAvanced)")
            out(f"    /creditos  Ver creditos restantes")
            out(f"    /info      Info completa del token")
            out(f"    /salir     Cerrar y salir")
            out(f"")
            out(f"  {C.BOLD}Tip:{C.RESET} si tu mensaje empieza con {C.CYAN}Generame{C.RESET} o {C.CYAN}Genera{C.RESET},")
            out(f"  se genera una imagen con IA y se abre en tu visor.")
            out("")
            continue

        out("...", C.DIM, end="\r")
        respuesta = enviar_mensaje(mensaje, modelo)

        out(" " * 60, C.DIM, end="\r")

        if not respuesta.get("ok"):
            err = respuesta.get("error", "Error desconocido")
            out(f"{C.RED}Error:{C.RESET} {err}")
            out("")
            continue

        texto = respuesta.get("respuesta", "")
        if texto:
            out(texto)
        else:
            out("(sin respuesta de texto)", C.DIM)

        if respuesta.get("imagen"):
            img = respuesta["imagen"]
            out(f"  {C.MAGENTA}[Imagen generada: {img.get('prompt', '')}]{C.RESET}", C.MAGENTA)
            abrir_imagen(img.get("url", ""))

        creditos = respuesta.get("creditosRestantes")
        if creditos is not None:
            if creditos == -1:
                out(f"  {C.GRAY}[creditos restantes: infinito]{C.RESET}", C.DIM)
            else:
                out(f"  {C.GRAY}[creditos restantes: {creditos}]{C.RESET}", C.DIM)

        herramientas = respuesta.get("herramientas", [])
        for h in herramientas:
            if h.get("herramienta") == "web":
                resultados = h.get("resultados", [])
                if resultados:
                    out(f"  {C.BOLD}Resultados web:{C.RESET}")
                    for i, r in enumerate(resultados, 1):
                        out(f"    {i}. {C.BOLD}{r.get('titulo', '')}{C.RESET}")
                        out(f"       {r.get('resumen', '')}", C.DIM)
                        out(f"       {C.CYAN}{r.get('link', '')}{C.RESET}", C.DIM)
            elif h.get("herramienta") == "clima" and not h.get("error"):
                out(f"  {C.BOLD}Clima en {h.get('lugar', '?')}:{C.RESET} "
                    f"{h.get('temperatura', '?')}°C (sensacion {h.get('sensacion', '?')}°C), "
                    f"{h.get('descripcion', '?')}, humedad {h.get('humedad', '?')}%, "
                    f"viento {h.get('viento', '?')} km/h")

        out("")

def cmd_info():
    banner()
    token = leer_token()
    if not token:
        out("No hay token guardado. Corre: verboai:TUTOKEN", C.RED)
        sys.exit(1)

    status, data, _ = http_get(f"{API_URL_BASE}/api/v1/info", token=token)
    if status != 200:
        msg = data.get("error", f"HTTP {status}") if data else f"HTTP {status}"
        out(f"Token invalido: {msg}", C.RED)
        sys.exit(1)

    out(f"{C.BOLD}Token:{C.RESET}     {data.get('nombre', '-')}")
    if data.get("creditos") == -1:
        out(f"{C.BOLD}Creditos:{C.RESET}  infinito (admin)")
    else:
        out(f"{C.BOLD}Creditos:{C.RESET}  {data.get('creditos', '?')} / {data.get('creditosIniciales', '?')}")
    out(f"{C.BOLD}Creado:{C.RESET}    {data.get('creadoEn', '-')}")
    out(f"{C.BOLD}Ultimo uso:{C.RESET} {data.get('ultimoUso', '-')}")
    out("")
    out(f"{C.BOLD}Modelos disponibles:{C.RESET}")
    for m in data.get("modelos", []):
        out(f"  - {m['nombre']:15s}  ({m.get('costoCreditos', 1)} credito(s)/pedido, "
            f"rate limit {m.get('rateLimitMax', '?')}/min)")
        out(f"      {m.get('descripcion', '')}", C.DIM)
    out("")

def mostrar_ayuda():
    banner()
    out(f"{C.BOLD}Uso:{C.RESET}")
    out(f"  python verboai.py login TUTOKEN   Guarda y valida el token")
    out(f"  python verboai.py verboai-XXXX   Atajo de 'login verboai-XXXX'")
    out(f"  python verboai.py run             Inicia el chat interactivo")
    out(f"  python verboai.py info            Muestra info del token guardado")
    out(f"  python verboai.py ayuda           Muestra esta ayuda")
    out("")
    out(f"{C.BOLD}Flujo tipico:{C.RESET}")
    out(f"  1. Genera un token en la web (Settings -> Clave API)")
    out(f"  2. {C.CYAN}python verboai.py login verboai-123456789012{C.RESET}")
    out(f"  3. {C.CYAN}python verboai.py run{C.RESET}")
    out(f"  4. Escribi mensajes, o proba: {C.CYAN}Generame un leon descansando{C.RESET}")
    out("")
    out(f"{C.BOLD}Comandos dentro del chat:{C.RESET}")
    out(f"  /modelo    Cambiar de modelo")
    out(f"  /creditos  Ver creditos restantes")
    out(f"  /info      Info completa del token")
    out(f"  /help      Mostrar ayuda")
    out(f"  /salir     Cerrar y salir")
    out("")

def main():
    args = sys.argv[1:]

    if not args:
        mostrar_ayuda()
        return

    primer_arg = args[0]

    if primer_arg == "login" and len(args) >= 2:
        cmd_guardar_token(args[1])
        return

    if primer_arg.startswith("verboai-"):
        cmd_guardar_token(primer_arg)
        return

    if primer_arg == "run":
        cmd_run()
        return

    if primer_arg in ("info", "--info", "-i"):
        cmd_info()
        return

    if primer_arg in ("ayuda", "help", "--help", "-h"):
        mostrar_ayuda()
        return

    out(f"Comando no reconocido: {primer_arg}", C.RED)
    out("")
    mostrar_ayuda()
    sys.exit(1)

if __name__ == "__main__":
    main()
