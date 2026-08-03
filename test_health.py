import requests
import json

url = "https://verboai.duckdns.org/health"

try:
    print("Verificando health del bridge...")
    response = requests.get(url, timeout=30)
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
except Exception as e:
    print(f"Error: {e}")
