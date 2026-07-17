"""
Puente GPT4Free para GLM-4 (SIN API KEY, SIN REGISTRO)
======================================================
Mini-servicio Python/Flask que expone POST /v1/chat/completions (formato OpenAI)
y usa la libreria g4f para llamar a GLM-4 GRATIS, sin necesidad de token ni registro.

Deploy en Render:
  1. Crear nuevo Web Service en Render.
  2. Conectar este repo/carpeta.
  3. Runtime: Python 3
  4. Build Command: pip install -r requirements.txt
  5. Start Command: python bridge.py
  6. NO hace falta ninguna Environment Variable. Sin token, sin config.
  7. Una vez deployado, copiar la URL (https://tu-bridge.onrender.com).
  8. En tu .env de VerboAI poner:
       GPT4FREE_ENABLED_PRO=true
       GPT4FREE_URL=https://tu-bridge.onrender.com
       GPT4FREE_MODEL=glm-4
"""

import os
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Inicializar cliente g4f (gratis, sin API key)
g4f_client = None
try:
    from g4f.client import Client
    g4f_client = Client()
    log.info('g4f inicializado correctamente - GLM-4 gratis sin API key')
except ImportError:
    log.error('g4f no instalado. Ejecuta: pip install -r requirements.txt')
except Exception as e:
    log.error(f'Error inicializando g4f: {e}')


@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    try:
        data = request.get_json(force=True)
        messages = data.get('messages', [])
        model = data.get('model', 'glm-4')
        temperature = data.get('temperature', 0.7)
        max_tokens = data.get('max_tokens', 3072)

        log.info(f'POST /v1/chat/completions | model={model} | messages={len(messages)}')

        if not g4f_client:
            return jsonify({
                'error': {'message': 'g4f no disponible', 'type': 'bridge_error'}
            }), 502

        # Llamar a GLM-4 via g4f (gratis, sin token)
        response = g4f_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        content = response.choices[0].message.content

        # Devolver en formato OpenAI compatible
        return jsonify({
            'id': 'chatcmpl-g4f-bridge',
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
            'error': {'message': str(e), 'type': 'bridge_error'}
        }), 502


@app.route('/', methods=['GET'])
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'glm-bridge',
        'mode': 'g4f-free',
        'model': 'glm-4',
        'api_key_required': False,
        'g4f_available': g4f_client is not None,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    log.info(f'Puente GLM-4 (g4f gratis) iniciando en puerto {port}')
    app.run(host='0.0.0.0', port=port, debug=False)
