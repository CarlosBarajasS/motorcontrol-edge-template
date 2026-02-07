# Guía para Iniciar MediaMTX

## 📥 Paso 1: Descargar MediaMTX

### Opción A: Descarga Manual (Recomendado)

1. **Visita la página oficial de MediaMTX**:
   ```
   https://github.com/bluenviron/mediamtx/releases/latest
   ```

2. **Descarga la versión para Windows**:
   - Busca: `mediamtx_vX.X.X_windows_amd64.zip`
   - Click para descargar

3. **Extrae el archivo**:
   - Descomprime el `.zip`
   - Encontrarás: `mediamtx.exe`

4. **Mueve el ejecutable**:
   - Copia `mediamtx.exe` a la carpeta: `c:\Users\carlo\Desktop\motorcontrol-edge-template\mediamtx\`

### Opción B: PowerShell (Automático)

Ejecuta estos comandos en PowerShell:

```powershell
# Ir a la carpeta del proyecto
cd c:\Users\carlo\Desktop\motorcontrol-edge-template\mediamtx

# Descargar la última versión (reemplaza X.X.X con la versión actual)
$version = "v1.9.3"  # Verifica la última versión en GitHub
$url = "https://github.com/bluenviron/mediamtx/releases/download/$version/mediamtx_$($version)_windows_amd64.zip"
Invoke-WebRequest -Uri $url -OutFile "mediamtx.zip"

# Extraer
Expand-Archive -Path "mediamtx.zip" -DestinationPath "." -Force

# Limpiar
Remove-Item "mediamtx.zip"
```

---

## 🚀 Paso 2: Iniciar MediaMTX

### Método 1: Línea de Comandos

Abre **PowerShell** o **CMD** y ejecuta:

```bash
cd c:\Users\carlo\Desktop\motorcontrol-edge-template\mediamtx
.\mediamtx.exe mediamtx.yml
```

### Método 2: Script BAT (Más fácil)

Crea un archivo `start-mediamtx.bat` con este contenido:

```bat
@echo off
cd /d %~dp0
mediamtx.exe mediamtx.yml
pause
```

Luego haz doble click en `start-mediamtx.bat` para iniciar.

---

## ✅ Verificar que Funciona

Cuando MediaMTX inicie correctamente, verás algo como:

```
INF MediaMTX v1.9.3
INF [RTSP] listener opened on :8554 (TCP), :8000 (UDP/RTP), :8001 (UDP/RTCP)
INF [RTMP] listener opened on :1935
INF [HLS] listener opened on :8888
INF [WebRTC] listener opened on :8889
INF [SRT] listener opened on :8890
INF [API] listener opened on :9997
INF [path cam-principal] ready (static source)
INF [path cam-principal-low] ready (static source)
```

**Importante**: Deberías ver `[path cam-principal] ready` - eso significa que está conectado a tu cámara.

---

## 🎥 Paso 3: Ver el Stream

### Opción 1: VLC (Más fácil para probar)

1. Abre **VLC Media Player**
2. Media → Open Network Stream
3. Ingresa una de estas URLs:
   ```
   rtsp://localhost:8554/cam-principal
   ```
   o
   ```
   http://localhost:8888/cam-principal
   ```
4. Play

### Opción 2: Navegador Web (HLS)

Abre tu navegador y ve a:
```
http://localhost:8888/cam-principal
```

Deberías ver el stream de la cámara en vivo.

### Opción 3: WebRTC (Baja latencia)

```
http://localhost:8889/cam-principal
```

---

## 🔍 Troubleshooting

### Error: "No se puede conectar a la cámara"

**Verifica**:
1. La cámara está encendida y conectada a la red
2. Puedes hacer ping a la cámara:
   ```bash
   ping 192.168.1.100
   ```
3. La contraseña en `mediamtx.yml` es correcta
4. La URL RTSP es correcta:
   ```
   rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/101
   ```

### Error: "Puerto ya en uso"

Si ves un error como `bind: address already in use`:

1. Otro programa está usando el puerto
2. Cierra otros programas de streaming
3. O cambia los puertos en `mediamtx.yml`

### Error: "401 Unauthorized"

- La contraseña en `mediamtx.yml` es incorrecta
- Verifica que puedes acceder a la cámara desde el navegador: `http://192.168.1.100`

---

## 📊 URLs de Acceso

Una vez MediaMTX esté corriendo:

| Protocolo | URL | Uso |
|-----------|-----|-----|
| **RTSP** | `rtsp://localhost:8554/cam-principal` | VLC, OBS, Software profesional |
| **HLS** | `http://localhost:8888/cam-principal` | Navegadores web, móviles |
| **WebRTC** | `http://localhost:8889/cam-principal` | Web (baja latencia) |
| **API** | `http://localhost:9997` | Control y monitoreo |

### Stream de Baja Calidad:
- RTSP: `rtsp://localhost:8554/cam-principal-low`
- HLS: `http://localhost:8888/cam-principal-low`
- WebRTC: `http://localhost:8889/cam-principal-low`

---

## 🛑 Detener MediaMTX

- Presiona `Ctrl+C` en la ventana donde está corriendo
- O cierra la ventana del CMD/PowerShell

---

## 🔄 Ejecutar como Servicio (Opcional)

Para que MediaMTX inicie automáticamente con Windows:

1. Descarga **NSSM** (Non-Sucking Service Manager):
   ```
   https://nssm.cc/download
   ```

2. Instala como servicio:
   ```powershell
   nssm install MediaMTX "C:\Users\carlo\Desktop\motorcontrol-edge-template\mediamtx\mediamtx.exe" "C:\Users\carlo\Desktop\motorcontrol-edge-template\mediamtx\mediamtx.yml"
   ```

3. Inicia el servicio:
   ```powershell
   nssm start MediaMTX
   ```

---

## 🌐 Acceso Remoto

Para acceder desde Internet, configura un túnel (ver [ACCESO_REMOTO.md](ACCESO_REMOTO.md)):

- **Cloudflare Tunnel** (recomendado)
- **Ngrok**
- **Tailscale**
- **Port Forwarding**

