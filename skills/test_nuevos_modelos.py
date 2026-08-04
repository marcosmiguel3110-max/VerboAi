import requests
import json

BRIDGE_URL = "https://verboai.duckdns.org"

def test_model(model_name):
    """Prueba un modelo específico"""
    print(f"\n{'='*60}")
    print(f"Probando modelo: {model_name}")
    print(f"{'='*60}")
    
    payload = {
        "model": model_name,
        "messages": [
            {"role": "user", "content": "Hola, responde con 'OK' si funcionas correctamente."}
        ],
        "temperature": 0.7,
        "max_tokens": 100
    }
    
    try:
        response = requests.post(
            f"{BRIDGE_URL}/v1/chat/completions",
            json=payload,
            timeout=60
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            modelo_usado = data.get('model', 'unknown')
            print(f"✅ ÉXITO - Modelo usado: {modelo_usado}")
            print(f"Respuesta: {content[:200]}...")
            return True
        else:
            print(f"❌ ERROR - {response.status_code}")
            print(f"Respuesta: {response.text[:500]}")
            return False
            
    except Exception as e:
        print(f"❌ EXCEPCIÓN: {str(e)}")
        return False

def list_available_models():
    """Lista los modelos disponibles en el bridge"""
    print(f"\n{'='*60}")
    print("Listando modelos disponibles en el bridge")
    print(f"{'='*60}")
    
    try:
        response = requests.get(f"{BRIDGE_URL}/v1/models", timeout=30)
        if response.status_code == 200:
            data = response.json()
            models = [m['id'] for m in data.get('data', [])]
            print("Modelos disponibles:")
            for model in models:
                print(f"  - {model}")
            return models
        else:
            print(f"Error obteniendo modelos: {response.status_code}")
            return []
    except Exception as e:
        print(f"Excepción: {str(e)}")
        return []

if __name__ == "__main__":
    # Primero listar modelos disponibles
    available_models = list_available_models()
    
    # Modelos nuevos a probar
    nuevos_modelos = ["gpt-4o", "gemini-1.5-flash", "gemini-1.5-pro"]
    
    print(f"\n{'='*60}")
    print("Probando nuevos modelos agregados")
    print(f"{'='*60}")
    
    resultados = {}
    for modelo in nuevos_modelos:
        resultados[modelo] = test_model(modelo)
    
    print(f"\n{'='*60}")
    print("RESUMEN DE PRUEBAS")
    print(f"{'='*60}")
    for modelo, exito in resultados.items():
        status = "✅ FUNCIONA" if exito else "❌ FALLÓ"
        print(f"{modelo}: {status}")
