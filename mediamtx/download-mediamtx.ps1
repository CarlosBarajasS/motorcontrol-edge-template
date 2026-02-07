# Script para descargar MediaMTX automáticamente
# PowerShell Script

Write-Host "Descargando MediaMTX..." -ForegroundColor Green

# Última versión conocida (verifica en https://github.com/bluenviron/mediamtx/releases)
$version = "v1.9.3"
$url = "https://github.com/bluenviron/mediamtx/releases/download/$version/mediamtx_$($version)_windows_amd64.zip"
$zipFile = "mediamtx.zip"

try {
    # Descargar
    Write-Host "Descargando desde: $url" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $url -OutFile $zipFile -UseBasicParsing

    # Extraer
    Write-Host "Extrayendo archivos..." -ForegroundColor Yellow
    Expand-Archive -Path $zipFile -DestinationPath "." -Force

    # Limpiar
    Remove-Item $zipFile

    Write-Host "MediaMTX descargado exitosamente!" -ForegroundColor Green
    Write-Host "Ejecuta: .\mediamtx.exe mediamtx.yml" -ForegroundColor Cyan

} catch {
    Write-Host "Error al descargar: $_" -ForegroundColor Red
    Write-Host "Descarga manualmente desde: https://github.com/bluenviron/mediamtx/releases/latest" -ForegroundColor Yellow
}

pause
