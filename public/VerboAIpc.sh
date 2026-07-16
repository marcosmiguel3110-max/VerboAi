#!/bin/bash
# Verbo AI - Cliente PC (Mac/Linux)
# Desarrollado por VerboAITeams

echo "════════════════════════════════════════════════"
echo "  Verbo AI - Cliente PC (Mac/Linux)"
echo "  Desarrollado por VerboAITeams"
echo "════════════════════════════════════════════════"
echo ""
echo "  Este programa te permite usar Verbo AI desde"
echo "  la terminal con tu token de API."
echo ""
echo "  Si no tenes un token, entra a:"
echo "  https://verboai.duckdns.org"
echo "  Settings > Clave API > Generar API token"
echo ""
echo "════════════════════════════════════════════════"
echo ""

# Verificar Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 no esta instalado."
    echo "Instalalo con: brew install python3 (Mac) o sudo apt install python3 (Linux)"
    exit 1
fi

# Crear directorio
mkdir -p ~/.verboai

# Descargar CLI si no existe
if [ ! -f ~/.verboai/verboai.py ]; then
    echo "Descargando cliente de Verbo AI..."
    curl -sL "https://verboai.duckdns.org/verboai-cli.py" -o ~/.verboai/verboai.py
    if [ $? -ne 0 ]; then
        echo "[ERROR] No se pudo descargar el cliente."
        exit 1
    fi
    chmod +x ~/.verboai/verboai.py
fi

# Pedir token si no esta guardado
if [ ! -f ~/.verboai/token ]; then
    echo ""
    read -p "Pega tu token (verboai-XXXX): " TOKEN
    echo "$TOKEN" > ~/.verboai/token
    echo ""
    echo "Token guardado!"
    echo ""
fi

# Menu
while true; do
    echo "════════════════════════════════════════════════"
    echo "  ¿Que queres hacer?"
    echo "════════════════════════════════════════════════"
    echo "  1. Iniciar chat interactivo"
    echo "  2. Ver info de mi token"
    echo "  3. Cambiar token"
    echo "  4. Salir"
    echo ""
    read -p "Opcion [1-4]: " OPCION
    echo ""
    case $OPCION in
        1) echo "Iniciando chat... (escribe /salir para salir)"; echo ""; python3 ~/.verboai/verboai.py run; echo "";;
        2) python3 ~/.verboai/verboai.py info; echo "";;
        3) read -p "Pega tu nuevo token: " NEWTOKEN; echo "$NEWTOKEN" > ~/.verboai/token; echo "Token actualizado!"; echo "";;
        4) exit 0;;
        *) echo "Opcion invalida"; echo "";;
    esac
done
