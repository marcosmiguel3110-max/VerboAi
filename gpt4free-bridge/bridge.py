"""
Puente GPT4Free para GLM-4
==========================
Mini-servicio que expone POST /v1/chat/completions (formato OpenAI)
y por debajo usa la libreria g4f para llamar a GLM-4 gratis, sin API key.

Deploy en Render:
  1. Crear nuevo Web Service en Render, conectar este repo/carpeta.
  2. Runtime: Python 3.
  3. Build: pip install -r requirements.txt
  4. Start: python bridge.py
  5. Una vez deployado, copiar la URL (https://tu-bridge.onrender.com).
  6. En tu .env de VerboAI poner:
       GPT4FREE_ENABLED_PRO=true
       GPT4FREE_URL=https://tu-bridge.onrender.com
       GPT4FREE_MODEL=glm-4

Tambien soporta Zhipu AI oficial (mas confiable que g4f):
  - Registrarse en https://open.bigmodel.cn/ y obtener API key gratuita.
  - Setear USE_ZHIPU=true y ZHIPU_API_KEY=tu_key en las env vars de Render.
"""

import os
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

# Configurar logging para ver en los logs de Render
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Detectar modo: Zhipu oficial (recomendado) o g4f (gratis, sin registro)
USE_ZHIPU = os.environ.get('USE_ZHIPU', 'false').lower() == 'true'
ZHIPU_API_KEY = os.environ.get('ZHIPU_API_KEY', '')
ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

# Inicializar cliente g4f solo si no usamos Zhipu
g4f_client = None
if not USE_ZHIPU:
    try:
        from g4f.client import Client
        g4f_client = Client()
        log.info('g4f inicializado correctamente (modo gratis sin registro)')
    except ImportError:
        log.error('g4f no instalado. Ejecuta: pip install -r requirements.txt')
    except Exception as e:
        log.error(f'Error inicializando g4f: {e}')

if USE_ZHIPU and not ZHIPU_API_KEY:
    log.warning('USE_ZHIPU=true pero ZHIPU_API_KEY no esta seteada. Va a fallar.')


def llamar_zhipu(messages, model, temperature, max_tokens):
    """Llama a la API oficial de Zhipu AI (GLM-4). Requiere API key gratuita."""
    import urllib.request
    import json

    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {ZHIPU_API_KEY}',
    }
    body = json.dumps({
        'model': model,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'stream': False,
    }).encode('utf-8')

    req = urllib.request.Request(ZHIPU_URL, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data


def llamar_g4f(messages, model):
    """Llama a GLM-4 via g4f (gratis, sin API key, pero menos confiable)."""
    if not g4f_client:
        raise RuntimeError('g4f no esta disponible. Verifica que este instalado.')

    response = g4f_client.chat.completions.create(
        model=model,
        messages=messages,
    )
    content = response.choices[0].message.content
    return content


@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    try:
        data = request.get_json(force=True)
        messages = data.get('messages', [])
        model = data.get('model', 'glm-4')
        temperature = data.get('temperature', 0.7)
        max_tokens = data.get('max_tokens', 3072)

        log.info(f'POST /v1/chat/completions | model={model} | messages={len(messages)} | modo={"zhipu" if USE_ZHIPU else "g4f"}')

        if USE_ZHIPU:
            # Zhipu ya devuelve formato OpenAI
            resultado = llamar_zhipu(messages, model, temperature, max_tokens)
            return jsonify(resultado)
        else:
            # g4f devuelve solo el texto, hay que envolverlo en formato OpenAI
            content = llamar_g4f(messages, model)
            return jsonify({
                'id': 'chatcmpl-bridge-g4f',
                'object': 'chat.completion',
                'model': model,
                'choices': [{
                    'index': 0,
                    'message': {'role': 'assistant', 'content': content},
                    'finish_reason': 'stop'
                }],
                'usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0}
            })

    except Exception as e:
        log.error(f'Error en chat_completions: {e}', exc_info=True)
        return jsonify({
            'error': {
                'message': str(e),
                'type': 'bridge_error'
            }
        }), 502


@app.route('/', methods=['GET'])
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'gpt4free-bridge',
        'mode': 'zhipu' if USE_ZHIPU else 'g4f',
        'model': 'glm-4',
        'zhipu_configured': bool(ZHIPU_API_KEY) if USE_ZHIPU else None,
        'g4f_available': g4f_client is not None if not USE_ZHIPU else None,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    log.info(f'Puente GPT4Free iniciando en puerto {port} | modo={"zhipu" if USE_ZHIPU else "g4f"}')
    app.run(host='0.0.0.0', port=port, debug=False)
