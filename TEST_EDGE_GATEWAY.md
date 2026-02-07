# ✅ Verificación Edge Gateway - Lista de Chequeo

## 🔍 Problema Encontrado y Corregido

**✅ SOLUCIONADO**: El `Dockerfile` no copiaba la carpeta `services/`, causando que el contenedor falle al iniciar. Ya está corregido.

---

## 📋 Archivos Verificados

### ✅ Archivos Core
- [x] `edge-agent/server.js` - Entry point completo
- [x] `edge-agent/package.json` - Dependencias correctas (mqtt, axios, express, systeminformation)
- [x] `edge-agent/Dockerfile` - ✅ **CORREGIDO** (ahora copia `services/`)
- [x] `.env` - ✅ **CREADO** con tu configuración

### ✅ Servicios
- [x] `edge-agent/services/MqttClientService.js` - Cliente MQTT completo
- [x] `edge-agent/services/CameraMonitorService.js` - Monitor de MediaMTX
- [x] `edge-agent/services/SystemMonitorService.js` - Stats del sistema

### ✅ Configuración
- [x] `docker-compose.yml` - Orquestación de mediamtx + edge-agent
- [x] `mediamtx/mediamtx.yml` - Config con tu cámara Hikvision @ 192.168.1.100
- [x] `.env.example` - Template de configuración

---

## 🧪 PRUEBAS LOCALES (Windows)

### Test 1: Verificar que Docker Desktop esté corriendo

```powershell
docker --version
docker ps
```

**Resultado esperado**: Docker version 20.x o superior

---

### Test 2: Construir Imagen (Probar que Dockerfile funciona)

```powershell
cd C:\Users\carlo\Desktop\motorcontrol-edge-template

# Construir solo edge-agent para verificar
docker-compose build edge-agent
```

**Resultado esperado**:
```
Successfully built XXXXXXXX
Successfully tagged motorcontrol-edge-template_edge-agent:latest
```

**Si falla**: Revisa que el Dockerfile tenga la línea `COPY services ./services`

---

### Test 3: Levantar Servicios

```powershell
docker-compose up -d
```

**Resultado esperado**:
```
Creating network "motorcontrol-edge-template_default" ...
Creating edge-mediamtx ... done
Creating edge-agent    ... done
```

---

### Test 4: Verificar Logs

```powershell
# Ver logs del edge-agent
docker-compose logs -f edge-agent
```

**Deberías ver**:
```
═══════════════════════════════════════════════════
🚀 Edge Gateway Starting...
═══════════════════════════════════════════════════
   Client ID:     edge-gateway-001
   Gateway Name:  Casa Cliente 001
   Location:      Guadalajara, Jalisco
   MQTT Broker:   192.168.100.49:1885
   MediaMTX API:  http://mediamtx:9997
═══════════════════════════════════════════════════

[MQTT] Connecting to mqtt://192.168.100.49:1885 as edge-gateway-001...
```

**IMPORTANTE**: Si no se puede conectar al MQTT, es NORMAL si aún no has configurado el usuario `client-001` en Mosquitto. Lo veremos después.

---

### Test 5: Verificar MediaMTX

```powershell
# Ver logs de MediaMTX
docker-compose logs -f mediamtx
```

**Deberías ver**:
```
INF [RTSP] [conn 192.168.1.100:xxxxx] opened
INF [RTSP] [session cam-principal] created by 192.168.1.100:xxxxx
INF [RTSP] [session cam-principal] is publishing to path 'cam-principal'
```

**Si NO ves esto**:
- Verifica que la cámara esté encendida y en la red
- Verifica IP: `ping 192.168.1.100`
- Verifica credenciales en `mediamtx/mediamtx.yml`

---

### Test 6: Probar API de MediaMTX

```powershell
curl http://localhost:9997/v3/paths/list
```

**Resultado esperado**:
```json
{
  "items": [
    {
      "name": "cam-principal",
      "confName": "cam-principal",
      "source": {
        "type": "rtspSource"
      },
      "ready": true,
      "tracks": [...]
    }
  ]
}
```

**Si `ready: false`**: La cámara no está conectándose a MediaMTX. Revisa contraseña RTSP.

---

### Test 7: Probar Health Check del Edge Agent

```powershell
curl http://localhost:8090/health
```

**Resultado esperado**:
```json
{
  "status": "ok",
  "clientId": "edge-gateway-001",
  "gatewayName": "Casa Cliente 001",
  "mqtt": {
    "connected": false  // Normal si no configuraste MQTT aún
  },
  "cameras": {
    "total": 2,
    "online": 2
  },
  "system": {
    "healthy": true,
    "cpu": 15.2,
    "memory": 512
  }
}
```

---

### Test 8: Ver Stream HLS en Navegador

Abre en tu navegador:
```
http://localhost:8888/cam-principal
```

**Deberías ver**: Página HTML con reproductor de video

**Para ver el playlist M3U8**:
```
http://localhost:8888/cam-principal/index.m3u8
```

---

## 🚨 Errores Comunes

### Error: "Cannot find module './services/MqttClientService'"

**Causa**: El Dockerfile viejo no copiaba la carpeta `services/`

**Solución**: ✅ Ya está corregido. Reconstruye la imagen:
```powershell
docker-compose build --no-cache edge-agent
docker-compose up -d
```

---

### Error: "MQTT Connection refused"

**Causa**: El servidor MQTT en 192.168.100.49:1885 no tiene el usuario `client-001` configurado.

**Solución en el servidor central**:
```bash
# En la Raspberry Pi
docker exec -it mosquitto mosquitto_passwd -b /mosquitto/config/passwd client-001 tu_password_segura

# Reiniciar Mosquitto
docker restart mosquitto
```

---

### Error: "MediaMTX ready: false"

**Causa**: Cámara no se puede conectar a MediaMTX

**Verificar**:
1. IP correcta: `ping 192.168.1.100`
2. Contraseña correcta en `mediamtx/mediamtx.yml`
3. Puerto RTSP: `telnet 192.168.1.100 554`

**Probar con VLC**:
```
rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/101
```

---

### Error: "Docker: invalid reference format"

**Causa**: Espacios en rutas de Docker Compose en Windows

**Solución**: Usar comillas en comandos
```powershell
docker-compose -f "docker-compose.yml" up -d
```

---

## 📦 Preparar para Raspberry Pi

Si todo funciona en Windows, para moverlo a Raspberry Pi:

### Opción 1: Git Clone (Recomendado)

```bash
# En la Raspberry
git clone https://github.com/tu-usuario/motorcontrol-edge-template.git
cd motorcontrol-edge-template
cp .env.example .env
nano .env  # Configurar credenciales

docker-compose up -d
```

### Opción 2: Transferir Archivos

```powershell
# Comprimir proyecto (excluir node_modules)
cd C:\Users\carlo\Desktop
tar -czf edge-template.tar.gz motorcontrol-edge-template \
  --exclude=node_modules \
  --exclude=.git

# Transferir a Raspberry
scp edge-template.tar.gz pi@192.168.100.49:/home/pi/

# En la Raspberry
ssh pi@192.168.100.49
cd ~
tar -xzf edge-template.tar.gz
cd motorcontrol-edge-template
docker-compose up -d
```

---

## 🎯 Siguiente Paso

Una vez que TODO funcione en Windows:

1. **Configurar Usuario MQTT** en el servidor central (Raspberry Pi):
   ```bash
   # En la Raspberry
   docker exec -it mosquitto mosquitto_passwd -b /mosquitto/config/passwd client-001 Password123!
   docker restart mosquitto
   ```

2. **Actualizar .env** con la password real:
   ```env
   MQTT_PASSWORD=Password123!
   ```

3. **Reiniciar Edge Agent**:
   ```powershell
   docker-compose restart edge-agent
   ```

4. **Verificar en logs**:
   ```powershell
   docker-compose logs -f edge-agent
   ```

   Deberías ver:
   ```
   [MQTT] ✅ Connected successfully
   📥 Subscribed to: gateway/edge-gateway-001/command
   📥 Subscribed to: camera/edge-gateway-001/+/command
   📹 New camera detected: cam-principal
   💓 Heartbeat sent (Cameras: 2/2 online)
   ```

---

## ✅ Checklist Final

- [ ] Docker Desktop corriendo en Windows
- [ ] Imagen `edge-agent` construida sin errores
- [ ] Contenedores `mediamtx` y `edge-agent` corriendo
- [ ] MediaMTX detecta cámaras (ready: true)
- [ ] Health check responde en http://localhost:8090/health
- [ ] Stream HLS accesible en http://localhost:8888/cam-principal
- [ ] Logs de edge-agent sin errores críticos
- [ ] (Opcional) MQTT conectado al servidor central

Una vez todo OK aquí, estás listo para desplegarlo en producción. 🚀
