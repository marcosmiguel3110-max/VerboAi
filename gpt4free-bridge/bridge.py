"""
Puente GPT4Free — Modelo: Qwen3-235B-Thinking via Modelscope (SIN API KEY)
==========================================================================
Mini-servicio Python/Flask que expone POST /v1/chat/completions (formato OpenAI)
y usa la libreria g4f para llamar a modelos GRATIS, sin token ni registro.

Modelo por defecto: Qwen/Qwen3-235B-A22B-Thinking-2507 (vía Modelscope AI)
  - 235 billones de parametros, con razonamiento Thinking
  - El mas potente disponible gratis en g4f hoy
  - Provider: Modelscope (sin API key)

Deploy en Render:
  1. Crear nuevo Web Service en Render.
  2. Conectar este repo/carpeta.
  3. Runtime: Python 3
  4. Build: pip install -r requirements.txt
  5. Start: python bridge.py
  6. NO hace falta ninguna Environment Variable. Sin token, sin config.
  7. Una vez deployado, copiar la URL (https://tu-bridge.onrender.com).
  8. En tu .env de VerboAI poner:
       GPT4FREE_ENABLED_PRO=true
       GPT4FREE_URL=https://tu-bridge.onrender.com
       GPT4FREE_MODEL=Qwen/Qwen3-235B-A22B-Thinking-2507

Variables opcionales (en el servicio del PUENTE, no en VerboAI):
  G4F_MODEL_OVERRIDE  - cambia el modelo por defecto del puente
  G4F_PROVIDER        - fuerza un provider especifico (ej: Modelscope, Puter)
"""

import os
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Modelo por defecto: Qwen3-235B-Thinking via Modelscope (sí funciona gratis en g4f hoy)
# 235B parametros, el mas potente disponible gratis en g4f.
DEFAULT_MODEL = os.environ.get('G4F_MODEL_OVERRIDE', 'Qwen/Qwen3-235B-A22B-Thinking-2507')
DEFAULT_PROVIDER = os.environ.get('G4F_PROVIDER', '')  # vacío = g4f elige automáticamente

# Inicializar cliente g4f
g4f_client = None
try:
    from g4f.client import Client
    g4f_client = Client()
    log.info(f'g4f inicializado | modelo por defecto: {DEFAULT_MODEL}')
except ImportError:
    log.error('g4f no instalado. Ejecuta: pip install -r requirements.txt')
except Exception as e:
    log.error(f'Error inicializando g4f: {e}')


def llamar_g4f(messages, model, temperature, max_tokens):
    """Llama al modelo via g4f, probando varios modelos automaticamente si el primero falla."""
    if not g4f_client:
        raise RuntimeError('g4f no esta disponible')

    # Lista de modelos a probar en orden: el pedido primero, luego fallbacks
    # que sabemos que funcionan gratis en g4f via Modelscope.
    modelos_disponibles = [
        model,
        'Qwen/Qwen3-235B-A22B-Thinking-2507',  # 235B Thinking (mas potente)
        'Qwen/Qwen-3-25B-A22B-Thinking-2507',  # 25B Thinking (fallback mas liviano)
        'gpt-4o-mini',                          # fallback clasico
    ]
    # Sin duplicados, manteniendo el orden
    vistos = set()
    modelos_a_probar = []
    for m in modelos_disponibles:
        if m and m not in vistos:
            modelos_a_probar.append(m)
            vistos.add(m)

    ultimo_error = None
    for modelo_actual in modelos_a_probar:
        try:
            log.info(f'Intentando modelo: {modelo_actual}')
            kwargs = {
                'model': modelo_actual,
                'messages': messages,
                'temperature': temperature,
                'max_tokens': max_tokens,
            }
            if DEFAULT_PROVIDER:
                kwargs['provider'] = DEFAULT_PROVIDER

            response = g4f_client.chat.completions.create(**kwargs)
            content = response.choices[0].message.content

            if content and content.strip():
                log.info(f'OK con modelo: {modelo_actual} | {len(content)} chars')
                return content, modelo_actual
            else:
                ultimo_error = f'{modelo_actual}: respuesta vacia'
                log.warning(ultimo_error)
        except Exception as e:
            ultimo_error = f'{modelo_actual}: {e}'
            log.warning(f'Fallo modelo {modelo_actual}: {e}')
            continue

    raise RuntimeError(f'Todos los modelos fallaron. Ultimo error: {ultimo_error}')


@app.route('/v1/chat/completions', methods=['POST'])
def chat_completions():
    try:
        data = request.get_json(force=True)
        messages = data.get('messages', [])
        model = data.get('model', DEFAULT_MODEL)
        temperature = data.get('temperature', 0.7)
        max_tokens = data.get('max_tokens', 3072)

        log.info(f'POST /v1/chat/completions | model pedido={model} | messages={len(messages)}')

        content, modelo_usado = llamar_g4f(messages, model, temperature, max_tokens)

        return jsonify({
            'id': 'chatcmpl-g4f-bridge',
            'object': 'chat.completion',
            'model': modelo_usado,
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
        'service': 'glm-bridge',
        'mode': 'g4f-free',
        'model_default': DEFAULT_MODEL,
        'provider': DEFAULT_PROVIDER or 'auto',
        'api_key_required': False,
        'g4f_available': g4f_client is not None,
        'note': 'Modelo por defecto: Qwen3-235B-Thinking (235B) via Modelscope. En VerboAI poner GPT4FREE_MODEL=Qwen/Qwen3-235B-A22B-Thinking-2507',
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    log.info(f'Puente g4f iniciando en puerto {port} | modelo: {DEFAULT_MODEL}')
    app.run(host='0.0.0.0', port=port, debug=False)

