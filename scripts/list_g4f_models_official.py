"""Listar todos los modelos oficiales de g4f y probar Nemotron."""
import sys
sys.path.insert(0, '/home/z/.venv/lib/python3.12/site-packages')

import g4f

# Listar modelos oficiales
print("=" * 60)
print("MODELOS OFICIALES DE g4f (g4f.models.ModelUtils.convert)")
print("=" * 60)
try:
    modelos = list(g4f.models.ModelUtils.convert.keys())
    print(f"Total: {len(modelos)} modelos")
    print()
    # Filtrar nemotron, qwen3, glm, etc
    print("--- NEMOTRON ---")
    for m in modelos:
        if 'nemotron' in str(m).lower():
            print(f"  - {m}")
    print()
    print("--- QWEN3 (potentes) ---")
    for m in modelos:
        if 'qwen3' in str(m).lower() or 'qwen-3' in str(m).lower():
            print(f"  - {m}")
    print()
    print("--- GLM ---")
    for m in modelos:
        if 'glm' in str(m).lower():
            print(f"  - {m}")
    print()
    print("--- GPT-5 / GPT-4 ---")
    for m in modelos:
        if 'gpt-5' in str(m).lower() or 'gpt-4' in str(m).lower():
            print(f"  - {m}")
except Exception as e:
    print(f"Error listando: {e}")

# Probar Nemotron-550B
print()
print("=" * 60)
print("TEST: Nemotron-550B con Client()")
print("=" * 60)
try:
    from g4f.client import Client
    client = Client()
    
    modelos_a_probar = [
        'nemotron-550b',
        'nemotron-3-ultra-550b-a55b',
        'nvidia-nemotron-3-ultra-550b-a55b',
    ]
    
    for modelo in modelos_a_probar:
        print(f"\n--- {modelo} ---")
        try:
            response = client.chat.completions.create(
                model=modelo,
                messages=[
                    {"role": "system", "content": "Tu nombre es NewserPro, creado por VerboAITeams."},
                    {"role": "user", "content": "Hola, ¿quién eres? Una frase corta."}
                ],
                max_tokens=100,
            )
            content = response.choices[0].message.content
            print(f"✅ RESPUESTA: {content[:250]}")
        except Exception as e:
            print(f"❌ ERROR: {str(e)[:300]}")
except Exception as e:
    print(f"Error importando Client: {e}")
