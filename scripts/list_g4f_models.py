"""Listar todos los modelos disponibles en g4f, especialmente los Qwen3 Thinking."""
import sys
sys.path.insert(0, '/home/z/.venv/lib/python3.12/site-packages')

try:
    from g4f import models as g4f_models
    from g4f import ProviderType
    from g4f.providers.base_provider import BaseProvider
    from g4f.providers.retry_provider import RetryProvider
    import g4f
    print("=" * 60)
    print("g4f version:", getattr(g4f, 'version', '?'))
    print("=" * 60)
    
    # Listar todos los modelos
    if hasattr(g4f_models, '_all_models'):
        print("\n[MODELOS REGISTRADOS EN g4f]")
        all_models = g4f_models._all_models
        print(f"Total: {len(all_models)}")
        # Filtrar Qwen
        qwen_models = [m for m in all_models if 'qwen' in str(m).lower() or 'Qwen' in str(m)]
        print(f"\nQwen encontrados: {len(qwen_models)}")
        for m in qwen_models[:30]:
            print(f"  - {m}")
        
        # Filtrar thinking / instruct
        thinking = [m for m in all_models if 'think' in str(m).lower()]
        print(f"\nThinking: {len(thinking)}")
        for m in thinking[:20]:
            print(f"  - {m}")
    else:
        print("\n[NO HAY _all_models]")
        print("Atributos disponibles:", [a for a in dir(g4f_models) if not a.startswith('_')][:30])

    # Listar todos los providers
    print("\n" + "=" * 60)
    print("[PROVIDERS REGISTRADOS]")
    try:
        from g4f.Provider import __providers__
        print(f"Total providers: {len(__providers__)}")
        for p in __providers__:
            nombre = p.__name__ if hasattr(p, '__name__') else str(p)
            # Ver si el provider tiene modelos soportados
            soporta = getattr(p, 'supported_models', None) or getattr(p, 'models', None)
            label = f"  - {nombre}"
            if soporta:
                if isinstance(soporta, (list, set, tuple)):
                    qwen_en_provider = [m for m in soporta if 'qwen' in str(m).lower()]
                    if qwen_en_provider:
                        label += f" | Qwen: {qwen_en_provider[:3]}"
                else:
                    label += f" | models: {str(soporta)[:60]}"
            print(label)
    except ImportError as e:
        print("No se pudo importar __providers__:", e)

    # Probar directamente con Modelscope
    print("\n" + "=" * 60)
    print("[TEST DIRECTO: Modelscope + Qwen3-235B]")
    try:
        from g4f.client import Client
        client = Client()
        response = client.chat.completions.create(
            model="Qwen/Qwen3-235B-A22B-Thinking-2507",
            provider="Modelscope",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=10,
        )
        print("OK! Response:", response.choices[0].message.content[:100])
    except Exception as e:
        print(f"FAIL: {e}")

    # Probar con modelo sin prefijo
    print("\n[TEST: Modelscope + qwen3-235b-a22b (sin prefijo)]")
    try:
        response = client.chat.completions.create(
            model="qwen3-235b-a22b",
            provider="Modelscope",
            messages=[{"role": "user", "content": "test"}],
            max_tokens=10,
        )
        print("OK! Response:", response.choices[0].message.content[:100])
    except Exception as e:
        print(f"FAIL: {e}")

except Exception as e:
    print(f"ERROR GENERAL: {e}")
    import traceback
    traceback.print_exc()
