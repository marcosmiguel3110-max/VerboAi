import requests
import json

url = "https://glm-bridge.onrender.com/v1/models"

try:
    print("Listando modelos disponibles en el bridge...")
    response = requests.get(url, timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")
