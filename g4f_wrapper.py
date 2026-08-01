#!/usr/bin/env python3
"""
Wrapper para G4F con rotación de proveedores
Evita el límite de 24h usando múltiples proveedores
"""

import sys
import json
from g4f.client import Client
from g4f.Provider import (
    Copilot,
    PollinationsAI,
    OpenRouterFree,
    OpenaiChat,
    Gemini,
    Groq,
    DeepSeek,
    Perplexity,
    Phind,
    FreeChatgpt,
    Liaobots,
    Blackbox,
    Bing,
    You,
    HuggingChat,
    MetaAI,
    GigaChat,
)
from g4f.Provider import RetryProvider

# Lista completa de proveedores para rotación automática
PROVIDERS_LIST = [
    Copilot,
    PollinationsAI,
    OpenRouterFree,
    OpenaiChat,
    Gemini,
    Groq,
    DeepSeek,
    Perplexity,
    Phind,
    FreeChatgpt,
    Liaobots,
    Blackbox,
    Bing,
    You,
    HuggingChat,
    MetaAI,
    GigaChat,
]

# Mapeo de modelos (usar strings en lugar de objetos para mayor compatibilidad)
MODELOS = {
    "gpt-4o": "gpt-4o",
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-3.5-turbo": "gpt-3.5-turbo",
}

def llamar_g4f_con_rotacion(modelo_nombre, mensajes, max_intentos=3):
    """
    Llama a G4F usando RetryProvider para rotación automática de proveedores
    """
    modelo = MODELOS.get(modelo_nombre, "gpt-4o-mini")
    
    try:
        # Usar RetryProvider para rotación automática
        client = Client(
            provider=RetryProvider(PROVIDERS_LIST, shuffle=False)
        )
        
        print(f"[G4F] Llamando con modelo: {modelo} usando RetryProvider con {len(PROVIDERS_LIST)} proveedores")
        
        response = client.chat.completions.create(
            model=modelo,
            messages=mensajes,
        )
        
        texto = response.choices[0].message.content
        print(f"[G4F] Éxito - respuesta de {len(texto)} caracteres")
        
        return {
            "ok": True,
            "respuesta": texto,
        }
        
    except Exception as e:
        print(f"[G4F] Error: {str(e)}")
        return {
            "ok": False,
            "error": str(e),
        }

def main():
    # Leer argumentos de stdin
    try:
        input_data = json.load(sys.stdin)
    except:
        print(json.dumps({"ok": False, "error": "Error leyendo input JSON"}))
        sys.exit(1)
    
    modelo = input_data.get("modelo", "gpt-4o-mini")
    mensajes = input_data.get("mensajes", [])
    
    if not mensajes:
        print(json.dumps({"ok": False, "error": "No se proporcionaron mensajes"}))
        sys.exit(1)
    
    # Ejecutar llamada
    try:
        resultado = llamar_g4f_con_rotacion(modelo, mensajes)
        print(json.dumps(resultado))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Error interno: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
