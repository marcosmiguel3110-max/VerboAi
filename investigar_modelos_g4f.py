"""
Investigar modelos g4f disponibles y sus capacidades
"""
import g4f
from g4f import Provider

print("="*60)
print("PROVEEDORES DISPONIBLES EN G4F")
print("="*60)

# Listar todos los providers disponibles
providers = [attr for attr in dir(Provider) if not attr.startswith('_')]
print(f"Total providers: {len(providers)}")
print("\nProviders principales:")
for p in providers[:30]:
    print(f"  - {p}")

print("\n" + "="*60)
print("MODELOS CONOCIDOS PARA DISEÑO/CÓDIGO")
print("="*60)

# Modelos que suelen ser buenos para tareas visuales y código
modelos_diseno = [
    # Claude (bueno para diseño y código)
    "claude-3-5-sonnet",
    "claude-3-opus",
    "claude-3-haiku",
    
    # GPT (bueno para código general)
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-4",
    
    # Modelos de código específicos
    "deepseek-coder",
    "qwen-coder",
    
    # Modelos multimodales (visuales)
    "gemini-pro-vision",
    "gpt-4-vision-preview",
    
    # Modelos rápidos para prototipado
    "gpt-3.5-turbo",
    "claude-3-haiku",
]

print("\nModelos recomendados para diseño/canvas/juegos:")
for modelo in modelos_diseno:
    print(f"  - {modelo}")

print("\n" + "="*60)
print("PROVIDERS QUE SOPORTAN SCRAPING")
print("="*60)

# Providers que usan scraping web en lugar de API
providers_scraping = [
    "DeepSeek",
    "Poe",
    "You",
    "Perplexity",
    "Phind",
    "Blackbox",
    "Cohere",
    "HuggingFace",
]

print("\nProviders que usan scraping:")
for p in providers_scraping:
    print(f"  - {p}")
