import requests
import json

BRIDGE_URL = "https://glm-bridge.onrender.com"

def test_cascada_design():
    """Prueba la cascada de modelos para diseño/canvas/juegos"""
    print(f"\n{'='*60}")
    print("PRUEBA DE CASCADA PARA DISEÑO/CANVAS/JUEGOS")
    print(f"{'='*60}")
    
    # Request de diseño (debería activar cascada de diseño)
    payload = {
        "model": "auto",
        "messages": [
            {"role": "user", "content": "Necesito crear un juego tipo Minecraft con canvas y three.js, ayúdame con el código del game-loop"}
        ],
        "temperature": 0.7,
        "max_tokens": 500
    }
    
    try:
        print("Enviando request de diseño...")
        response = requests.post(
            f"{BRIDGE_URL}/v1/chat/completions",
            json=payload,
            timeout=120
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            modelo_usado = data.get('model', 'unknown')
            print(f"✅ ÉXITO - Modelo usado: {modelo_usado}")
            print(f"Longitud de respuesta: {len(content)} caracteres")
            print(f"Primeros 200 caracteres: {content[:200]}...")
            return True, modelo_usado
        else:
            print(f"❌ ERROR - {response.status_code}")
            print(f"Respuesta: {response.text[:500]}")
            return False, None
            
    except Exception as e:
        print(f"❌ EXCEPCIÓN: {str(e)}")
        return False, None

def test_cascada_general():
    """Prueba la cascada general (no diseño)"""
    print(f"\n{'='*60}")
    print("PRUEBA DE CASCADA GENERAL")
    print(f"{'='*60}")
    
    # Request general (no debería activar cascada de diseño)
    payload = {
        "model": "auto",
        "messages": [
            {"role": "user", "content": "¿Cuál es la capital de Francia y cuéntame sobre su historia?"}
        ],
        "temperature": 0.7,
        "max_tokens": 300
    }
    
    try:
        print("Enviando request general...")
        response = requests.post(
            f"{BRIDGE_URL}/v1/chat/completions",
            json=payload,
            timeout=120
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            modelo_usado = data.get('model', 'unknown')
            print(f"✅ ÉXITO - Modelo usado: {modelo_usado}")
            print(f"Longitud de respuesta: {len(content)} caracteres")
            print(f"Primeros 200 caracteres: {content[:200]}...")
            return True, modelo_usado
        else:
            print(f"❌ ERROR - {response.status_code}")
            print(f"Respuesta: {response.text[:500]}")
            return False, None
            
    except Exception as e:
        print(f"❌ EXCEPCIÓN: {str(e)}")
        return False, None

def test_modelo_especifico_design():
    """Prueba un modelo específico de diseño"""
    print(f"\n{'='*60}")
    print("PRUEBA DE MODELO ESPECÍFICO DE DISEÑO")
    print(f"{'='*60}")
    
    payload = {
        "model": "claude-3-5-sonnet",
        "messages": [
            {"role": "user", "content": "Hola, responde con 'OK' si funcionas correctamente."}
        ],
        "temperature": 0.7,
        "max_tokens": 100
    }
    
    try:
        print("Probando modelo claude-3-5-sonnet...")
        response = requests.post(
            f"{BRIDGE_URL}/v1/chat/completions",
            json=payload,
            timeout=120
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

if __name__ == "__main__":
    print(f"\n{'='*60}")
    print("SISTEMA DE PRUEBA DE CASCADA INTELIGENTE")
    print(f"{'='*60}")
    
    # Probar cascada de diseño
    exito_design, modelo_design = test_cascada_design()
    
    # Probar cascada general
    exito_general, modelo_general = test_cascada_general()
    
    # Probar modelo específico de diseño
    exito_especifico = test_modelo_especifico_design()
    
    print(f"\n{'='*60}")
    print("RESUMEN DE PRUEBAS")
    print(f"{'='*60}")
    print(f"Cascada diseño: {'✅ FUNCIONA' if exito_design else '❌ FALLÓ'} (modelo: {modelo_design})")
    print(f"Cascada general: {'✅ FUNCIONA' if exito_general else '❌ FALLÓ'} (modelo: {modelo_general})")
    print(f"Modelo específico design: {'✅ FUNCIONA' if exito_especifico else '❌ FALLÓ'}")
