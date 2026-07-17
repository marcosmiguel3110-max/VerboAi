"""Probar TODOS los providers de g4f sin autenticacion para ver cuales responden."""
import sys
sys.path.insert(0, '/home/z/.venv/lib/python3.12/site-packages')

from g4f.client import Client
from g4f import ProviderType
import g4f

# Importar todos los providers
try:
    from g4f.Provider import __providers__
except:
    import g4f.Provider
    __providers__ = [getattr(g4f.Provider, name) for name in dir(g4f.Provider) if not name.startswith('_')]

client = Client()

# Modelos Qwen3 a probar en cada provider
modelos_qwen = [
    "Qwen/Qwen3-235B-A22B-Thinking-2507",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "Qwen/Qwen-3-25B-A22B-Thinking-2507",
    "Qwen/Qwen-3-25B-A22B-Instruct-2507",
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3-coder-plus",
    # Otros modelos potentes
    "gpt-4o",
    "gpt-4o-mini",
    "deepseek-chat",
    "deepseek-r1",
    "claude-3.7-sonnet",
    "llama-3.3-70b",
]

# Providers que NO requieren auth (filtramos los que ya sabemos que fallan)
providers_sin_auth = [
    'Blackbox', 'BlackboxCreate', 'Airforce', 'ChatGptEs', 'Chatgpt4Online',
    'Chatxyz', 'DDG', 'DeepInfra', 'DeepSeek', 'EasyChat', 'Felo', 'FenayAI',
    'GLM', 'Gemini', 'GigaChat', 'GlhfChat', 'GoogleSearch', 'HailuoAI',
    'HuggingChat', 'HuggingFace', 'HuggingFaceAPI', 'HuggingFaceInference',
    'HuggingSpace', 'LMArena', 'MetaAI', 'MiniMax', 'Nvidia', 'Ollama',
    'OpenAIFM', 'OpenRouter', 'OpenaiAPI', 'OpenaiChat', 'OpenaiTemplate',
    'OperaAria', 'Perchance', 'Perplexity', 'PerplexityApi', 'PhindAi',
    'Pi', 'Pollinations', 'PollinationsAudio', 'PollinationsImage',
    'Puter', 'Qwen', 'QwenCode', 'Reka', 'Replicate', 'SearXNG',
    'StabilityAI_SD35Large', 'Surfsense', 'TeachAnything', 'ThebApi',
    'Together', 'WeWordle', 'WhiteRabbitNeo', 'You', 'YouTube',
    'Yqcloud', 'xAI', 'GradientNetwork', 'Miklium',
]

print(f"Probaré {len(modelos_qwen)} modelos × {len(providers_sin_auth)} providers")
print("=" * 70)

resultados_ok = []

for provider_name in providers_sin_auth:
    try:
        ProviderClass = getattr(g4f.Provider, provider_name, None)
        if not ProviderClass:
            continue
    except Exception as e:
        continue

    for modelo in modelos_qwen:
        try:
            r = client.chat.completions.create(
                model=modelo,
                provider=ProviderClass,
                messages=[{"role":"user","content":"Hola, ¿quién eres? Una frase corta."}],
                max_tokens=80,
            )
            content = r.choices[0].message.content
            if content and content.strip() and len(content) > 5:
                resultado = f"✅ {provider_name} | {modelo} → {content[:120]}"
                print(resultado)
                resultados_ok.append((provider_name, modelo, content[:200]))
                # Si funciona, no seguir probando otros modelos en este provider
                break
        except Exception as e:
            msg = str(e)
            # Solo reportar errores que NO sean los típicos de auth
            if 'api_key' in msg.lower() or 'auth' in msg.lower() or 'credential' in msg.lower() or 'cookie' in msg.lower():
                continue  # silencioso
            # Otros errores, breve
            if 'not found' in msg.lower() or 'not support' in msg.lower():
                continue
            # Si es un error de conexion o raro, lo mostramos pero breve
            pass

print("\n" + "=" * 70)
print(f"RESULTADOS EXITOSOS: {len(resultados_ok)}")
print("=" * 70)
for p, m, c in resultados_ok:
    print(f"\n  Provider: {p}")
    print(f"  Modelo:   {m}")
    print(f"  Respuesta: {c}")
