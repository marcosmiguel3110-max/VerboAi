import requests
import json

url = "https://verboai.duckdns.org/v1/chat/completions"
data = {
    "model": "kimi-k2.7-code",  # Modelo específico que quieres probar
    "messages": [
        {
            "role": "user",
            "content": "Hola, escribe una funcion simple en Python"
        }
    ]
}

try:
    print("Enviando request a https://verboai.duckdns.org con kimi-k2.7-code...")
    print("Esto puede tardar más por cold start de Render o el modelo...")
    response = requests.post(url, json=data, timeout=180)  # 3 minutos
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")
