import requests
import json

BRIDGE_URL = "https://verboai.duckdns.org"

def test_model(model_name):
    """Prueba un modelo específico con más detalles"""
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
        print("Enviando solicitud...")
        response = requests.post(
            f"{BRIDGE_URL}/v1/chat/completions",
            json=payload,
            timeout=120  # Aumentado a 120 segundos
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
            
    except requests.exceptions.Timeout:
        print(f"❌ TIMEOUT - El servidor tardó demasiado en responder")
        return False
    except Exception as e:
        print(f"❌ EXCEPCIÓN: {str(e)}")
        return False

def check_health():
    """Verifica el estado del bridge"""
    print(f"\n{'='*60}")
    print("Verificando salud del bridge")
    print(f"{'='*60}")
    
    try:
        response = requests.get(f"{BRIDGE_URL}/health", timeout=30)
        print(f"Status Code: {response.status_code}")
        if response.status_code == 200:
            print(f"Respuesta: {json.dumps(response.json(), indent=2)}")
            return True
        else:
            print(f"Error: {response.text}")
            return False
    except Exception as e:
        print(f"Excepción: {str(e)}")
        return False

if __name__ == "__main__":
    # Primero verificar salud del bridge
    health_ok = check_health()
    
    if not health_ok:
        print("\n⚠️ El bridge no responde correctamente")
    
    # Probar modelos que deberían funcionar
    print(f"\n{'='*60}")
    print("Probando modelos conocidos")
    print(f"{'='*60}")
    
    modelos_conocidos = ["deepseek-v3", "gpt-4o-mini"]
    for modelo in modelos_conocidos:
        test_model(modelo)
    
    # Probar nuevos modelos
    print(f"\n{'='*60}")
    print("Probando nuevos modelos")
    print(f"{'='*60}")
    
    nuevos_modelos = ["gpt-4o", "gemini-1.5-flash", "gemini-1.5-pro"]
    for modelo in nuevos_modelos:
        test_model(modelo)
