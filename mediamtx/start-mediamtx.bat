@echo off
title MediaMTX - Camera Streaming Server
color 0A

echo ================================================
echo   MediaMTX - Servidor de Streaming de Camaras
echo ================================================
echo.

cd /d %~dp0

if not exist "mediamtx.exe" (
    echo [ERROR] No se encuentra mediamtx.exe
    echo.
    echo Por favor descarga MediaMTX desde:
    echo https://github.com/bluenviron/mediamtx/releases/latest
    echo.
    echo O ejecuta: download-mediamtx.ps1
    echo.
    pause
    exit /b 1
)

echo [INFO] Iniciando MediaMTX...
echo [INFO] Config: mediamtx.yml
echo [INFO] Camera: cam-principal (192.168.1.100)
echo.
echo ================================================
echo   URLs de Acceso:
echo ================================================
echo   RTSP:    rtsp://localhost:8554/cam-principal
echo   HLS:     http://localhost:8888/cam-principal
echo   WebRTC:  http://localhost:8889/cam-principal
echo   API:     http://localhost:9997
echo ================================================
echo.
echo Presiona Ctrl+C para detener el servidor
echo.

mediamtx.exe mediamtx.yml

pause
