# 📋 Log de Setup - Edge Gateway + Backend Central

**Fecha**: 2026-02-07
**Sistema**: MotorControlAPI (Backend Central) + Edge Gateway Template
**Ubicación**: Raspberry Pi 4 (192.168.100.49 / 177.247.175.4:2222)

---

## ✅ **LO QUE FUNCIONA HOY (100%)**

### 1. **MQTT Bidireccional**
- ✅ Edge Gateway conectado al broker Mosquitto del servidor central
- ✅ Puerto: 1885 (mapeado desde 1883 del contenedor)
- ✅ Autenticación: Deshabilitada (`allow_anonymous true`)
- ✅ Heartbeats cada 30 segundos funcionando
- ✅ Topics funcionando:
  - `gateway/{clientId}/heartbeat` → Telemetría del edge
  - `camera/{clientId}/{cameraId}/register` → Auto-registro de cámaras
  - `camera/{clientId}/{cameraId}/status` → Estado de cámaras

### 2. **Auto-detección de Cámaras**
- ✅ Edge agent detecta automáticamente cámaras en MediaMTX
- ✅ **2/2 cámaras detectadas**:
  - `cam-principal` (1920x1080 @ 30fps H264)
  - `cam-principal-low` (stream de baja calidad)
- ✅ Polling cada 10 segundos a MediaMTX API

### 3. **Registro Automático en Base de Datos**
- ✅ CameraMqttService en el backend escucha MQTT
- ✅ Cámaras se registran automáticamente en PostgreSQL
- ✅ Base de datos: `motorcontroldb` (no `motor_control`)
- ✅ Tabla: `cameras` con columnas en camelCase (`createdAt`, no `created_at`)

### 4. **MediaMTX Streaming**
- ✅ MediaMTX v1.16.0 funcionando
- ✅ Conexión exitosa a cámaras Hikvision por RTSP
- ✅ Streams disponibles:
  - RTSP: `rtsp://localhost:8554/cam-principal`
  - HLS: `http://localhost:8888/cam-principal/index.m3u8` (requiere auth)
  - WebRTC: `http://localhost:8889/cam-principal`
- ✅ **HLS funciona con credenciales**: `edge:edge123`

### 5. **Autenticación MediaMTX**
- ✅ API protegida con Basic Auth
- ✅ Usuario configurado: `edge` / `edge123`
- ✅ Permisos: `api`, `read`
- ✅ Edge agent usa credenciales correctamente para API
- ✅ HLS también requiere credenciales (confirmado)

---

## ⚠️ **PENDIENTE PARA MAÑANA**

### 1. **Actualizar StreamController en Backend**
**Archivo**: `C:\Users\carlo\Desktop\MotorControlAPI\src\controllers\StreamController.js`

**Cambio necesario**: Agregar credenciales al hacer proxy de HLS desde MediaMTX

```javascript
// ANTES (sin auth, da 401)
const response = await axios.get(hlsUrl, {
  responseType: 'stream',
  timeout: 10000
});

// DESPUÉS (con auth)
const response = await axios.get(hlsUrl, {
  auth: {
    username: 'edge',  // TODO: leer de .env o configuración
    password: 'edge123'
  },
  responseType: 'stream',
  timeout: 10000
});
```

**Archivos a modificar**:
1. `StreamController.js` - Agregar auth a axios.get para HLS
2. Backend `.env` - Agregar variables `MEDIAMTX_USERNAME` y `MEDIAMTX_PASSWORD`
3. Verificar que el frontend pueda reproducir los streams

### 2. **Probar Reproducción en Frontend**
- Acceder a `http://177.247.175.4/admin/cameras.html`
- Verificar que HLS.js pueda reproducir con el proxy
- Probar con VLC: `http://177.247.175.4/api/stream/hls/1/cam-principal/index.m3u8`

### 3. **Opcional: Abrir Puerto 8888 Públicamente**
Si quieres acceso directo sin proxy:
- Configurar port forwarding en router: `8888 → 192.168.100.49:8888`
- Acceder directamente: `http://177.247.175.4:8888/cam-principal/index.m3u8`
- **Nota**: No recomendado por seguridad, mejor usar el proxy del backend

---

## 🔧 **PROBLEMAS RESUELTOS HOY**

### 1. **Docker Build Failures**
❌ **Error**: `npm ci` fallaba por falta de `package-lock.json`
✅ **Solución**: Cambiar a `npm install --omit=dev` en Dockerfile

### 2. **Contenedor no encontraba servicios**
❌ **Error**: `Cannot find module './services/...'`
✅ **Solución**: Agregar `COPY services ./services` en Dockerfile

### 3. **MQTT Connection Timeout**
❌ **Error**: `connack timeout` desde contenedor edge-agent
✅ **Solución**: Usar `network_mode: host` en docker-compose

### 4. **Mosquitto Authentication Errors**
❌ **Error**: Duplicate `password_file` en configuración
✅ **Solución**: Remover duplicados y usar `allow_anonymous true`

### 5. **MediaMTX API 401 Authentication Error**
❌ **Error**: Edge-agent no podía acceder a MediaMTX API
✅ **Solución**: Configurar `authInternalUsers` con user `edge:edge123`

### 6. **HLS 404 Not Found**
❌ **Error**: Streams HLS no disponibles
✅ **Solución**: Confirmado que funciona con credenciales Basic Auth

---

## 📁 **ARCHIVOS MODIFICADOS**

### Edge Gateway Template
```
motorcontrol-edge-template/
├── edge-agent/
│   ├── Dockerfile                          ← npm install, COPY services
│   ├── server.js                           ← MEDIAMTX_USERNAME/PASSWORD
│   └── services/
│       └── CameraMonitorService.js         ← Soporte para auth
├── mediamtx/
│   └── mediamtx.yml                        ← authInternalUsers edge:edge123
├── docker-compose.yml                       ← network_mode: host
└── .env.example                             ← MEDIAMTX_USERNAME/PASSWORD
```

### Backend Central
```
MotorControlAPI/
├── package.json                             ← Agregado axios: ^1.7.9
├── src/
│   ├── middlewares/auth.js                  ← Cambio a named exports
│   ├── routes/                              ← Actualizado import { auth }
│   └── services/CameraMqttService.js        ← Auto-registro funcional
└── mosquitto/config/mosquitto.conf          ← allow_anonymous true
```

---

## 🔑 **CREDENCIALES Y PUERTOS**

### Servidor Central (Raspberry Pi)
```
IP Local:       192.168.100.49
IP Pública:     177.247.175.4
SSH:            ssh -p 2222 victormanuel@177.247.175.4
SSH Password:   motorcontrolapp

MQTT Broker:    localhost:1885 (puerto público mapeado)
MQTT User:      (sin autenticación actualmente)

Backend API:    http://177.247.175.4/api
Admin Panel:    http://177.247.175.4/admin

PostgreSQL:     motor-control-db:5432
DB Name:        motorcontroldb
DB User:        motor_api
DB Password:    motor_secure_password
```

### Edge Gateway (mismo Raspberry Pi por ahora)
```
CLIENT_ID:      edge-gateway-raspberry
GATEWAY_NAME:   Gateway Raspberry Pi Local
LOCATION:       Raspberry Pi OS

MediaMTX API:   http://localhost:9997
MediaMTX User:  edge
MediaMTX Pass:  edge123

HLS Endpoint:   http://localhost:8888/{cameraId}/index.m3u8
RTSP Endpoint:  rtsp://localhost:8554/{cameraId}
```

### Cámara Hikvision
```
Modelo:         DS-2CD2T23G0-I5
IP Local:       192.168.1.100
RTSP User:      admin
RTSP Pass:      Vyepez6320
ONVIF:          Habilitado

Main Stream:    rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/101
Sub Stream:     rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/102
```

---

## 🧪 **COMANDOS ÚTILES PARA DEBUGGING**

### Ver Estado de Cámaras
```bash
# En la Raspberry Pi
cd ~/MotorControlAPI

# Ver cámaras en base de datos
docker exec motor-control-db psql -U motor_api -d motorcontroldb \
  -c "SELECT id, camera_id, name, client_id, status FROM cameras;"

# Ver logs de registro de cámaras
docker compose logs api | grep "Registrando\|Nueva cámara"

# Ver heartbeats
docker compose logs api | grep "heartbeat"
```

### Verificar Edge Gateway
```bash
cd ~/motorcontrol-edge-template

# Estado de contenedores
docker compose ps

# Logs del edge agent
docker compose logs edge-agent --tail 30

# Ver cámaras detectadas
docker compose logs edge-agent | grep "detected\|online"

# Probar MediaMTX API con credenciales
curl -u edge:edge123 http://localhost:9997/v3/paths/list
```

### Probar Streams
```bash
# HLS con credenciales
curl -u edge:edge123 http://localhost:8888/cam-principal/index.m3u8

# Ver manifest HLS
curl -u edge:edge123 http://localhost:8888/cam-principal/index.m3u8 | head -20

# RTSP con ffprobe
ffprobe rtsp://localhost:8554/cam-principal
```

### MQTT Debugging
```bash
# Suscribirse a todos los topics
docker exec motor-control-mosquitto mosquitto_sub -h localhost -p 1883 -t "#" -v

# Suscribirse solo a cámaras
docker exec motor-control-mosquitto mosquitto_sub -h localhost -p 1883 -t "camera/#" -v

# Ver heartbeats
docker exec motor-control-mosquitto mosquitto_sub -h localhost -p 1883 -t "gateway/+/heartbeat" -v
```

---

## 📊 **ESTADO ACTUAL DEL SISTEMA**

```
┌─────────────────────────────────────────────────────────────┐
│                    ARQUITECTURA ACTUAL                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Cámara Hikvision│ 192.168.1.100
│  DS-2CD2T23G0-I5 │
└────────┬─────────┘
         │ RTSP
         ▼
┌──────────────────────────────────────────────────────────┐
│            Raspberry Pi 4 (192.168.100.49)               │
│                                                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Edge Gateway (Docker)                            │  │
│  │  ┌──────────────┐      ┌────────────────────┐    │  │
│  │  │  MediaMTX    │◄────►│  Edge Agent        │    │  │
│  │  │  (Streaming) │      │  (Monitor + MQTT)  │    │  │
│  │  │  :8888 HLS   │      │  :8090 HTTP        │    │  │
│  │  └──────┬───────┘      └─────────┬──────────┘    │  │
│  └─────────┼──────────────────────┼─────────────────┘  │
│            │                       │                     │
│            │                       │ MQTT :1885          │
│            │                       ▼                     │
│  ┌─────────┴───────────────────────────────────────┐   │
│  │  Backend Central (Docker)                       │   │
│  │  ┌──────────────┐  ┌─────────────────────────┐ │   │
│  │  │  API Node.js │  │  PostgreSQL             │ │   │
│  │  │  :3000       │◄►│  motorcontroldb         │ │   │
│  │  └──────┬───────┘  └─────────────────────────┘ │   │
│  │         │                                        │   │
│  │  ┌──────┴────────┐  ┌─────────────────────────┐ │   │
│  │  │  Mosquitto    │  │  Nginx Reverse Proxy    │ │   │
│  │  │  MQTT Broker  │  │  :80, :443              │ │   │
│  │  └───────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘

ESTADO:
✅ RTSP → MediaMTX: OK (2 cámaras conectadas)
✅ MediaMTX → Edge Agent: OK (detección automática)
✅ Edge Agent → MQTT: OK (heartbeats + registro)
✅ MQTT → Backend: OK (CameraMqttService procesando)
✅ Backend → PostgreSQL: OK (cámaras registradas)
⚠️  MediaMTX → Backend: Pendiente (agregar auth en proxy)
```

---

## 🚀 **PRÓXIMOS PASOS MAÑANA**

1. ✏️ **Actualizar StreamController** (5 minutos)
   - Agregar auth a axios en proxy HLS
   - Agregar variables de entorno al backend

2. 🧪 **Probar reproducción** (10 minutos)
   - Acceder al admin panel
   - Verificar que HLS.js reproduce correctamente
   - Probar en diferentes navegadores

3. 📝 **Opcional: Documentación**
   - Actualizar README del edge template
   - Documentar arquitectura completa
   - Crear guía de deployment para nuevos edges

4. 🔮 **Mejoras futuras**
   - Implementar ONVIF para auto-discovery de cámaras en red
   - Agregar soporte para PTZ control
   - Implementar grabación en NAS
   - Dashboard con mapas de ubicación de cámaras

---

## 📚 **REFERENCIAS**

- [MediaMTX Documentation](https://mediamtx.org/docs/)
- [HLS.js GitHub](https://github.com/video-dev/hls.js)
- [MQTT.js](https://github.com/mqttjs/MQTT.js)
- [Sequelize Docs](https://sequelize.org/)

---

**Última actualización**: 2026-02-07 05:10 AM
**Próxima sesión**: Implementar autenticación en proxy de streams
