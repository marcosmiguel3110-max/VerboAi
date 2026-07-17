# verboai - Cliente de terminal para Verbo AI

Cliente Python para usar Verbo AI desde la terminal, con servidor proxy local incluido.

## Requisitos

- Python 3.7 o superior
- No necesitas instalar nada (solo Python estándar)

## Instalación rápida

Copiá el archivo `verboai.py` a una carpeta donde lo tengas a mano. Opcionalmente podés crear un alias para usarlo como comando `verboai`:

```bash
# Linux/Mac (agregar a ~/.bashrc o ~/.zshrc)
alias verboai="python3 /ruta/al/archivo/verboai.py"

# Windows (PowerShell, ejecutar como admin)
function verboai { python C:\ruta\al\archivo\verboai.py @args }
```

## Uso

### 1. Generar un token en la web

1. Entrá a la web de Verbo AI
2. Andá a **Settings → Clave API**
3. Hacé clic en **Generar API token**
4. Copiá el token (empieza con `verboai-`)

### 2. Guardar el token en la terminal

```bash
python verboai.py login verboai-123456789012
```

Esto valida el token contra el servidor y lo guarda en `~/.verboai/token` (con permisos 600). Solo lo tenés que hacer una vez.

Atajo: también podés pasar el token directo sin la palabra `login`:

```bash
python verboai.py verboai-123456789012
```

### 3. Iniciar el chat

```bash
python verboai.py run
```

Esto:
1. Levanta un **servidor proxy local** en `http://127.0.0.1:7788` (no sale a internet, solo tu máquina)
2. Te pide **elegir modelo** (NewserLite o NewserAdvanced)
3. Entra en modo **REPL interactivo**

### 4. Escribir mensajes

Una vez dentro del REPL:

```
NewserLite> hola, quien eres?
...
NewserLite> Generame un león descansando al atardecer
[genera imagen y la abre en tu visor]
```

### Comandos del REPL

| Comando     | Acción                                                |
|-------------|-------------------------------------------------------|
| `/modelo`   | Cambiar de modelo en vivo (NewserLite ↔ NewserAdvanced)|
| `/creditos` | Ver cuántos créditos te quedan                        |
| `/info`     | Info completa del token + lista de modelos            |
| `/help`     | Mostrar ayuda                                         |
| `/salir`    | Cerrar y salir                                        |

## Generar imágenes

Si tu mensaje empieza con **"Generame"**, **"Genera"**, **"Dibujame"**, etc., se genera una imagen con IA (pollinations.ai) y se abre automáticamente en el visor de imágenes de tu sistema.

Solo funciona con **NewserAdvanced** seleccionado.

Ejemplos:
- `Generame un león descansando`
- `Genera una montaña con nieve`
- `Dibujame un perro volando`
- `hacé una imagen de un atardecer`

## Servidor proxy local

Cuando ejecutás `verboai:run`, se levanta un proxy en `http://127.0.0.1:7788` que cualquier otra app de tu máquina puede usar sin necesidad del token:

```bash
# Ver info del token
curl http://127.0.0.1:7788/info

# Enviar mensaje
curl -X POST http://127.0.0.1:7788/chat \
  -H "Content-Type: application/json" \
  -d '{"mensaje":"hola","modelo":"NewserLite"}'
```

El proxy inyecta el token desde `~/.verboai/token`, así que el token nunca aparece en la URL ni en los headers que mandás vos.

## Integrarlo en tu propia web/app

Si querés usar Verbo AI desde otra web o app (sin el CLI), seguí los pasos que están en la web:

**Settings → Clave API → "Como usar el token"**

Ahí te muestra los ejemplos de `curl` para llamar directamente a la API:

```bash
curl -X POST https://verboai.duckdns.org/api/v1/chat \
  -H "Authorization: Bearer verboai-XXXX" \
  -H "Content-Type: application/json" \
  -d '{"mensaje":"Hola","modelo":"NewserLite"}'
```

## Seguridad

- El token se guarda en `~/.verboai/token` con permisos `600` (solo tu usuario puede leerlo)
- El servidor proxy local escucha solo en `127.0.0.1` (no es accesible desde otras máquinas)
- El token nunca se imprime en pantalla después de guardarlo
- El proxy se cierra automáticamente cuando cerrás el REPL

## Cambiar la URL del servidor

Si estás hosteando Verbo AI en otro lado (no en `verboai.duckdns.org`), seteá la variable de entorno antes de ejecutar:

```bash
export VERBOAI_URL=https://tu-servidor.com
python verboai.py:run
```

## Cambiar el puerto del proxy

```bash
export VERBOAI_PORT=8888
python verboai.py:run
```
