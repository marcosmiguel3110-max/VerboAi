"""Probar modelos Qwen avanzados en diferentes providers."""
import sys
sys.path.insert(0, '/home/z/.venv/lib/python3.12/site-packages')

from g4f.client import Client
import g4f

client = Client()

# Lista de (modelo, provider) a probar
pruebas = [
    # Provider oficial de Qwen — Qwen3.7 max/plus (LO MÁS NUEVO DE QWEN)
    ("qwen3.7-max", "Qwen"),
    ("qwen3.7-plus", "Qwen"),
    ("qwen3.6-plus", "Qwen"),
    # GradientNetwork — Qwen3 235B
    ("Qwen3 235B", "GradientNetwork"),
    # GlhfChat — modelos hf:
    ("hf:Qwen/QwQ-32B-Preview", "GlhfChat"),
    ("hf:Qwen/Qwen2.5-72B-Instruct", "GlhfChat"),
    # QwenCode
    ("qwen3-coder-plus", "QwenCode"),
    # Modelscope con nombre correcto (a ver si existe)
    ("Qwen/Qwen3-235B-A22B-Thinking-2507", "Modelscope"),
    # HuggingChat
    ("Qwen/Qwen3-235B-A22B-Thinking-2507", "HuggingChat"),
    # Sin provider forzado (auto)
    ("Qwen/Qwen3-235B-A22B-Thinking-2507", None),
    ("qwen3.7-max", None),
    # Pollinations provider (no el modelo pollinations, sino el provider)
    ("openai-fast", "Pollinations"),
    # Nvidia provider (no nvidia.com:)
    ("qwen3.5-397b-a17b", "Nvidia"),
    # OpenRouter (a veces tiene Qwen3 grande)
    ("qwen/qwen3-235b-a22b-thinking-2507", "OpenRouter"),
    # Together
    ("Qwen/Qwen2.5-72B-Instruct", "Together"),
    # DeepInfra
    ("Qwen/Qwen2.5-72B-Instruct", "DeepInfra"),
    # Puter (a ver si tiene Qwen)
    ("Qwen/Qwen3-235B-A22B-Thinking-2507", "Puter"),
]

for modelo, provider in pruebas:
    print(f"\n--- Probando: {modelo} | provider: {provider or 'auto'} ---")
    try:
        kwargs = {
            'model': modelo,
            'messages': [{"role": "user", "content": "Hola, ¿quién eres? Respondé en una frase corta."}],
            'max_tokens': 80,
            'temperature': 0.7,
        }
        if provider:
            kwargs['provider'] = provider
        response = client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content
        if content and content.strip():
            print(f"✅ OK: {content[:200]}")
        else:
            print(f"⚠️ Respuesta vacía")
    except Exception as e:
        msg = str(e)[:200]
        print(f"❌ FAIL: {msg}")
