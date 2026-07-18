@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Verbo AI - Cliente PC
color 0A

:inicio
cls
echo ================================================================
echo   Verbo AI - Cliente PC (Windows)
echo   Desarrollado por VerboAITeams
echo ================================================================
echo.
echo   Este programa te permite usar Verbo AI desde
echo   la terminal de Windows con tu token de API.
echo.
echo   Si no tenes un token, entra a:
echo   https://verboai.duckdns.org
echo   Settings ^> Clave API ^> Generar API token
echo.
echo ================================================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python no esta instalado.
    echo Descargalo de: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

if not exist "%USERPROFILE%\.verboai" mkdir "%USERPROFILE%\.verboai"

if not exist "%USERPROFILE%\.verboai\verboai.py" (
    echo Descargando cliente de Verbo AI...
    powershell -Command "try { Invoke-WebRequest -Uri 'https://verboai.duckdns.org/verboai-cli.py' -OutFile '%USERPROFILE%\.verboai\verboai.py' } catch { Write-Host 'Error al descargar'; exit 1 }"
    if errorlevel 1 (
        echo [ERROR] No se pudo descargar el cliente.
        echo Verifica tu conexion a internet.
        pause
        exit /b 1
    )
)

if not exist "%USERPROFILE%\.verboai\token" (
    echo.
    set /p "TOKEN=Pega tu token (verboai-XXXX): "
    echo !TOKEN!> "%USERPROFILE%\.verboai\token"
    echo.
    echo Token guardado!
    echo.
)

:menu
cls
echo ================================================================
echo   Que queres hacer?
echo ================================================================
echo   1. Iniciar chat interactivo
echo   2. Ver info de mi token (creditos, modelos)
echo   3. Cambiar token
echo   4. Salir
echo.
set /p "OPCION=Opcion [1-4]: "

if "%OPCION%"=="1" goto chat
if "%OPCION%"=="2" goto info
if "%OPCION%"=="3" goto cambiar
if "%OPCION%"=="4" exit
goto menu

:chat
cls
echo.
echo Iniciando chat... (escribe /salir para salir)
echo.
python "%USERPROFILE%\.verboai\verboai.py" run
echo.
pause
goto menu

:info
cls
echo.
python "%USERPROFILE%\.verboai\verboai.py" info
echo.
pause
goto menu

:cambiar
cls
echo.
set /p "NEWTOKEN=Pega tu nuevo token: "
echo !NEWTOKEN!> "%USERPROFILE%\.verboai\token"
echo.
echo Token actualizado!
echo.
pause
goto menu
