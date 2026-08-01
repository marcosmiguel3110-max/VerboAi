#!/usr/bin/env python3
"""
Wrapper para G4F con rotación de proveedores
Evita el límite de 24h usando múltiples proveedores
"""

import sys
import json
import asyncio
from g4f import ChatCompletion
from g4f.Provider import Copilot, PollinationsAI, OpenRouterFree
from g4f.models import gpt_4o, gpt_4o_mini, gpt_3_5_turbo

# Lista de proveedores con prioridad (según documentación de g4f)
PROVIDERS = [
    Copilot,
    PollinationsAI,
    OpenRouterFree,
]

# Mapeo de modelos
MODELOS = {
    "gpt-4o": gpt_4o,
    "gpt-4o-mini": gpt_4o_mini,
    "gpt-3.5-turbo": gpt_3_5_turbo,
}

async def llamar_g4f_con_rotacion(modelo_nombre, mensajes, max_intentos=3):
    """
    Llama a G4F rotando entre proveedores si uno falla
    """
    modelo = MODELOS.get(modelo_nombre, gpt_4o_mini)
    
    for intento in range(max_intentos):
        for provider in PROVIDERS:
            try:
                print(f"[G4F] Intentando proveedor: {provider.__name__} (intento {intento + 1})")
                
                response = await ChatCompletion.create_async(
                    model=modelo,
                    provider=provider,
                    messages=mensajes,
                    timeout=30,
                )
                
                print(f"[G4F] Éxito con proveedor: {provider.__name__}")
                return {
                    "ok": True,
                    "respuesta": response,
                    "proveedor": provider.__name__,
                }
                
            except Exception as e:
                print(f"[G4F] Proveedor {provider.__name__} falló: {str(e)}")
                continue
    
    return {
        "ok": False,
        "error": "Todos los proveedores fallaron después de múltiples intentos",
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
    
    # Ejecutar llamada asíncrona
    try:
        resultado = asyncio.run(llamar_g4f_con_rotacion(modelo, mensajes))
        print(json.dumps(resultado))
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Error interno: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
