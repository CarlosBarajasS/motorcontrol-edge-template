# Arquitectura Completa del Sistema de Monitoreo Distribuido

## 📐 Visión General

Este es un sistema de **monitoreo de cámaras distribuido y escalable** para múltiples clientes, compuesto por:

1. **Servidor Central** (MotorControlAPI) - Raspberry Pi 5
2. **Edge Gateways** (motorcontrol-edge-template) - Raspberry Pi 5 / Mini PC en casa de cada cliente
3. **NAS** - Almacenamiento centralizado para grabaciones
4. **Cámaras IP** - Hikvision y otras marcas con RTSP/ONVIF

---

## 🏗️ Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERNET / IP PÚBLICA                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                    ┌───────┴────────┐
                    │  Port Forward  │
                    │  Router/VPN    │
                    └───────┬────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        │                   ↓                   │
        │      ┌────────────────────────┐      │
        │      │  SERVIDOR CENTRAL      │      │
        │      │  (MotorControlAPI)     │      │
        │      │  Raspberry Pi 5        │      │
        │      │                        │      │
        │      │  ┌──────────────────┐ │      │
        │      │  │ Node.js + Express│ │      │
        │      │  │ PostgreSQL       │ │      │
        │      │  │ MQTT Mosquitto   │ │◄─────┼────┐
        │      │  │ Nginx Proxy      │ │      │    │
        │      │  └──────────────────┘ │      │    │
        │      └──────────┬─────────────┘      │    │
        │                 │                    │    │
        │                 ↓                    │    │
        │      ┌────────────────────────┐     │    │
        │      │         NAS            │     │    │
        │      │  (Almacenamiento)      │     │    │
        │      │  /mnt/nas/raspberry_   │     │    │
        │      │  ├─ videos/            │     │    │
        │      │  ├─ logs/              │     │    │
        │      │  └─ backups/           │     │    │
        │      └────────────────────────┘     │    │
        │                                     │    │
        └─────────────────────────────────────┘    │
                                                   │
                MQTT Topics:                       │
                camera/<clientId>/*                │
                gateway/<clientId>/*               │
                                                   │
┌──────────────────────────────────────────────────┼────┐
│ CLIENTE 1 - Casa/Oficina                         │    │
│                                                   │    │
│  ┌────────────────────────────────┐              │    │
│  │   EDGE GATEWAY                 │              │    │
│  │   Raspberry Pi 5 / Mini PC     │──────────────┘    │
│  │   (motorcontrol-edge-template) │                   │
│  │                                │                   │
│  │   ┌─────────────────────────┐ │                   │
│  │   │ MediaMTX Streaming      │ │                   │
│  │   │ MQTT Client             │ │                   │
│  │   │ Video Processing        │ │                   │
│  │   │ Local Recording (opt)   │ │                   │
│  │   └─────────────────────────┘ │                   │
│  └────────────┬───────────────────┘                   │
│               │ RTSP/ONVIF                            │
│               ↓                                       │
│  ┌────────────────────────────────┐                  │
│  │  Cámaras IP (Hikvision, etc)   │                  │
│  │  - cam-principal: 192.168.1.100│                  │
│  │  - cam-entrada: 192.168.1.101  │                  │
│  │  - cam-patio: 192.168.1.102    │                  │
│  └────────────────────────────────┘                  │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ CLIENTE 2 - Casa/Oficina                             │
│  (Misma estructura que Cliente 1)                    │
│  Edge Gateway con deviceId único                     │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ CLIENTE N - Casa/Oficina                             │
│  (Escalable a múltiples clientes)                    │
└──────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Datos

### 1. Flujo de Video (Cámara → Edge → Cliente Final)

```
Cámara IP (192.168.1.100)
    ↓ RTSP Stream
Edge Gateway (MediaMTX)
    ├─ RTSP:   rtsp://edge-ip:8554/cam-principal
    ├─ HLS:    http://edge-ip:8888/cam-principal
    └─ WebRTC: http://edge-ip:8889/cam-principal
    ↓
Servidor Central (Proxy/Dashboard)
    ↓
Cliente Final (Browser/App)
```

### 2. Flujo de Telemetría (Edge → Servidor Central)

```
Edge Gateway (MQTT Client)
    ↓ Publica cada 5-10 segundos
Topics MQTT:
    - camera/<clientId>/<cameraId>/status
    - camera/<clientId>/<cameraId>/events
    - gateway/<clientId>/heartbeat
    - gateway/<clientId>/stats
    ↓
Mosquitto Broker (Servidor Central)
    ↓ Suscripción con wildcards
Backend Node.js (MqttService)
    ↓ Procesamiento y almacenamiento
PostgreSQL
    ↓
Dashboard Admin (Visualización)
```

### 3. Flujo de Comandos (Servidor Central → Edge)

```
Dashboard Admin
    ↓ POST /api/camera/command
Backend API (Express)
    ↓ JWT Auth + Validación
MQTT Broker
    ↓ Publica en topic específico
Topic: camera/<clientId>/<cameraId>/command
    ↓
Edge Gateway (MQTT Client)
    ↓ Recibe y ejecuta
Acción: Reiniciar cámara, cambiar configuración, etc.
```

---

## 📡 Protocolo MQTT para Cámaras

### Topics Estructurados

#### De Edge → Servidor (Telemetría)

```
# Heartbeat del gateway (cada 30 segundos)
gateway/<clientId>/heartbeat
Payload: {
  "timestamp": "2024-02-06T10:30:00Z",
  "uptime": 86400,
  "cpu": 35.2,
  "memory": 512,
  "diskUsage": 45.8
}

# Estado de cámara individual
camera/<clientId>/<cameraId>/status
Payload: {
  "online": true,
  "fps": 30,
  "bitrate": 4096,
  "resolution": "1920x1080",
  "recording": false,
  "timestamp": "2024-02-06T10:30:00Z"
}

# Eventos de cámara (motion detection, alerts)
camera/<clientId>/<cameraId>/events
Payload: {
  "type": "motion_detected",
  "confidence": 0.95,
  "region": "entrance",
  "timestamp": "2024-02-06T10:30:15Z",
  "snapshot_url": "http://edge-ip:8888/snapshots/cam1_20240206.jpg"
}

# Estadísticas de streaming
camera/<clientId>/<cameraId>/stats
Payload: {
  "viewers": 2,
  "bytesTransferred": 1048576,
  "packetsLost": 0,
  "avgLatency": 120
}

# Registro de cámara (al inicio)
camera/<clientId>/<cameraId>/register
Payload: {
  "name": "Cámara Principal",
  "model": "DS-2CD2T23G0-I5",
  "ip": "192.168.1.100",
  "rtspUrl": "rtsp://192.168.1.100:554/Streaming/Channels/101",
  "capabilities": ["onvif", "motion", "audio", "ptz"]
}
```

#### De Servidor → Edge (Comandos)

```
# Comandos generales al gateway
gateway/<clientId>/command
Payload: {
  "action": "restart|update|config",
  "params": {}
}

# Comandos a cámara específica
camera/<clientId>/<cameraId>/command
Payload: {
  "action": "restart|snapshot|start_recording|stop_recording",
  "params": {
    "duration": 300  // para recording
  }
}

# Actualización de configuración
camera/<clientId>/<cameraId>/config
Payload: {
  "fps": 30,
  "bitrate": 4096,
  "resolution": "1920x1080",
  "motionDetection": true
}
```

---

## 🔐 Seguridad y Autenticación

### 1. Conexión MQTT Segura

**Opción A: Autenticación MQTT (Recomendado)**
```yaml
# mosquitto.conf
allow_anonymous false
password_file /mosquitto/config/passwd

# Crear usuarios por cliente
mosquitto_passwd -b /mosquitto/config/passwd client-001 <password>
mosquitto_passwd -b /mosquitto/config/passwd client-002 <password>
```

**Credenciales del Edge:**
```env
MQTT_USERNAME=client-001
MQTT_PASSWORD=<secure_password>
CLIENT_ID=edge-gateway-client-001
```

**Opción B: TLS/SSL (Máxima Seguridad)**
```yaml
# mosquitto.conf
listener 8883
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
cafile /mosquitto/certs/ca.crt
require_certificate true
```

### 2. API REST del Servidor

**Autenticación JWT** (ya implementada):
```javascript
// Login del cliente
POST /api/auth/login
Body: { email, password }
Response: { token }

// Acceso a recursos
GET /api/cameras
Headers: { Authorization: "Bearer <token>" }
```

### 3. Acceso a Streams de Video

**Opción A: Sin Autenticación (Red Local)**
```
http://192.168.1.100:8888/cam-principal
```

**Opción B: Con Autenticación (Recomendado para IP Pública)**

Agregar autenticación en MediaMTX:
```yaml
# mediamtx.yml
paths:
  cam-principal:
    source: rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/101
    readUser: cliente001
    readPass: <secure_password>
```

Acceso:
```
http://cliente001:password@edge-ip:8888/cam-principal
```

**Opción C: Proxy Autenticado (Más Seguro)**

El servidor central actúa como proxy:
```
Cliente → Servidor Central (Auth JWT) → Edge Gateway
```

---

## 🌐 Configuración con IP Pública

### Escenario: Servidor Central con IP Pública

**Configuración del Router:**

```
Puerto Externo → Puerto Interno → Servicio
──────────────────────────────────────────
80            → 80              → Nginx (HTTP)
443           → 443             → Nginx (HTTPS)
1883          → 1885            → MQTT Broker
8883          → 8883            → MQTT TLS (opcional)
```

**Acceso desde Edge Gateways:**
```env
# En cada edge gateway
MQTT_BROKER=mqtt://tu-ip-publica.com:1883
MQTT_BROKER_TLS=mqtts://tu-ip-publica.com:8883
CENTRAL_API=https://tu-ip-publica.com/api
```

### Escenario: Edge Gateway con IP Pública (Opcional)

Si cada cliente tiene IP pública estática o DDNS:

```env
# Configurar DDNS en router del cliente
DDNS_HOSTNAME=cliente001.tudominio.com

# Port forwarding en router del cliente
8888 → 8888  # HLS Streaming
8889 → 8889  # WebRTC
```

**Acceso al stream:**
```
http://cliente001.tudominio.com:8888/cam-principal
```

### Seguridad Adicional con IP Pública

**1. Firewall en Edge Gateway**
```bash
# Solo permitir conexiones desde servidor central
sudo ufw allow from <ip-servidor-central> to any port 8888
sudo ufw allow from <ip-servidor-central> to any port 1883
sudo ufw deny 8888  # Denegar todo lo demás
```

**2. VPN (Tailscale/WireGuard) - Recomendado**
```
- Crear red privada virtual
- Edge gateways se conectan vía VPN
- Servidor central accesible en 100.x.x.x
- No exponer puertos públicamente
```

**3. HTTPS con Let's Encrypt**
```bash
# Instalar certbot
sudo apt install certbot

# Generar certificado
sudo certbot certonly --standalone -d tu-ip-publica.com

# Configurar Nginx con SSL
```

---

## 💾 Sistema de Grabación

### Grabación Local (Edge Gateway)

```yaml
# mediamtx.yml
pathDefaults:
  record: yes
  recordPath: /mnt/storage/recordings/%path/%Y-%m-%d_%H-%M-%S
  recordFormat: fmp4
  recordSegmentDuration: 1h
```

**Limpieza automática:**
```bash
# Cron job para limpiar grabaciones antiguas (>7 días)
0 2 * * * find /mnt/storage/recordings -type f -mtime +7 -delete
```

### Grabación Centralizada (NAS)

**Opción A: Edge envía grabaciones al NAS vía MQTT**
```javascript
// Edge publica metadata de grabación
mqtt.publish('camera/client-001/cam-principal/recording', {
  "started_at": "2024-02-06T10:00:00Z",
  "ended_at": "2024-02-06T11:00:00Z",
  "file_size_mb": 512,
  "file_path": "recordings/client-001/2024-02-06_10-00-00.mp4"
});

// Backend guarda en PostgreSQL
// Script de carga sube al NAS
```

**Opción B: NAS monta directamente desde Edge**
```bash
# En servidor central, montar storage del edge
sudo mount -t nfs edge-gateway-ip:/mnt/storage /mnt/nas/client-001

# Copiar grabaciones periódicamente
rsync -avz /mnt/nas/client-001/recordings/ /mnt/nas/raspberry_data/videos/
```

**Opción C: Edge Stream directo a NAS**
```yaml
# mediamtx.yml - Grabar y transmitir a NAS vía RTMP
paths:
  cam-principal:
    source: rtsp://admin:Vyepez6320@192.168.1.100:554/Streaming/Channels/101

    # Transmitir al servidor de grabación central
    runOnReady: >
      ffmpeg -i rtsp://localhost:8554/cam-principal
      -c copy
      -f segment
      -segment_time 3600
      -strftime 1
      "nfs://nas-ip/videos/client-001/%Y-%m-%d_%H-%M-%S.mp4"
```

---

## 📊 Monitoreo y Dashboard

### Información Disponible en Dashboard Central

**Vista General:**
```
┌─────────────────────────────────────┐
│  Dashboard - Todos los Clientes     │
├─────────────────────────────────────┤
│  Cliente 001 - Online               │
│    ├─ cam-principal: ✅ Streaming  │
│    ├─ cam-entrada:   ✅ Streaming  │
│    └─ cam-patio:     ❌ Offline    │
│                                     │
│  Cliente 002 - Online               │
│    ├─ cam-garage:    ✅ Streaming  │
│    └─ cam-jardín:    ✅ Streaming  │
│                                     │
│  Cliente 003 - ⚠️ Offline          │
└─────────────────────────────────────┘
```

**Métricas en Tiempo Real:**
- Cámaras online/offline por cliente
- Ancho de banda consumido
- Eventos de movimiento últimas 24h
- Estado del edge gateway (CPU, RAM, Disk)
- Grabaciones activas

**Endpoints API:**
```
GET /api/admin/cameras/all           # Todas las cámaras de todos los clientes
GET /api/admin/cameras/client/:id    # Cámaras de un cliente específico
GET /api/admin/events/live           # Eventos en tiempo real
GET /api/admin/gateways/status       # Estado de todos los gateways
GET /api/admin/recordings/list       # Listar grabaciones en NAS
```

---

## 🚀 Despliegue y Configuración

### 1. Servidor Central (Ya Configurado)

```bash
# En Raspberry Pi del servidor
cd /home/pi/MotorControlAPI
docker-compose up -d

# Verificar servicios
docker-compose ps
docker-compose logs -f
```

### 2. Edge Gateway (Nuevo Cliente)

**Preparación:**
```bash
# En Raspberry Pi del cliente
sudo apt update && sudo apt upgrade -y
sudo apt install docker.io docker-compose git -y

# Clonar template
git clone <repo> /home/pi/motorcontrol-edge
cd /home/pi/motorcontrol-edge
```

**Configuración:**
```bash
# Crear archivo .env
cp .env.example .env
nano .env
```

```env
# Identificación única del cliente
CLIENT_ID=client-001
GATEWAY_NAME="Casa Cliente 001"

# Servidor Central
MQTT_BROKER=mqtt://192.168.100.49:1885
MQTT_USERNAME=client-001
MQTT_PASSWORD=<secure_password>
CENTRAL_API=http://192.168.100.49/api

# Cámaras locales (separadas por coma)
CAMERA_IPS=192.168.1.100,192.168.1.101,192.168.1.102
CAMERA_USER=admin
CAMERA_PASS=Vyepez6320

# Storage
RECORDING_ENABLED=true
RECORDING_PATH=/mnt/storage/recordings
RETENTION_DAYS=7
```

**Iniciar:**
```bash
docker-compose up -d
```

### 3. Agregar Cliente al Servidor Central

**Crear cuenta:**
```bash
# En servidor central
cd /home/pi/MotorControlAPI
node scripts/createClient.js --email cliente001@example.com --password <secure> --clientId client-001
```

**Crear credenciales MQTT:**
```bash
docker exec mosquitto mosquitto_passwd -b /mosquitto/config/passwd client-001 <password>
docker restart mosquitto
```

---

## 📈 Escalabilidad

### Capacidad del Sistema

**Servidor Central (Raspberry Pi 5 - 8GB RAM):**
- Máximo recomendado: 20-30 edge gateways
- Máximo de cámaras totales: 100-150
- Tráfico MQTT: ~1000 msg/seg
- PostgreSQL: ~50GB datos/año (telemetría)

**Edge Gateway (Raspberry Pi 5 - 4GB RAM):**
- Máximo recomendado: 8-10 cámaras
- Streams simultáneos: 4-6
- Resolución máxima: 1080p por stream

### Optimizaciones

**1. Reducir Tráfico MQTT**
```javascript
// Publicar solo cuando hay cambios significativos
if (Math.abs(newValue - lastValue) > threshold) {
  mqtt.publish(topic, newValue);
}
```

**2. Compresión de Payloads**
```javascript
// Usar protobuf o msgpack en vez de JSON
const payload = msgpack.encode(data);
mqtt.publish(topic, payload);
```

**3. Clustering del Servidor**
```
Load Balancer
    ├─ Servidor 1 (API + MQTT)
    ├─ Servidor 2 (API + MQTT)
    └─ PostgreSQL (Shared)
```

---

## 🔧 Mantenimiento

### Backups Automáticos

**Base de Datos:**
```bash
# Cron diario a las 2 AM
0 2 * * * docker exec postgres pg_dump -U postgres motorcontroldb > /mnt/nas/backups/db_$(date +\%Y\%m\%d).sql
```

**Configuraciones:**
```bash
# Backup de configs del edge
tar -czf /mnt/nas/backups/edge-config-$(date +%Y%m%d).tar.gz /home/pi/motorcontrol-edge
```

### Actualizaciones

**Servidor Central:**
```bash
cd /home/pi/MotorControlAPI
git pull
docker-compose down
docker-compose build
docker-compose up -d
```

**Edge Gateway:**
```bash
cd /home/pi/motorcontrol-edge
git pull
docker-compose down
docker-compose pull
docker-compose up -d
```

---

## 📞 Soporte y Troubleshooting

### Logs Centralizados

**Servidor:**
```bash
# Ver logs de todos los servicios
docker-compose logs -f

# Ver logs específicos
docker-compose logs -f api
docker-compose logs -f mosquitto
```

**Edge:**
```bash
# Ver logs de MediaMTX
docker-compose logs -f mediamtx

# Ver logs de MQTT client
docker-compose logs -f mqtt-client
```

### Problemas Comunes

**Edge no se conecta a MQTT:**
1. Verificar conectividad: `ping 192.168.100.49`
2. Verificar puerto: `telnet 192.168.100.49 1885`
3. Verificar credenciales en .env
4. Revisar logs: `docker-compose logs mosquitto`

**Cámara no aparece en dashboard:**
1. Verificar que edge esté online
2. Verificar topic MQTT: `camera/<clientId>/<cameraId>/register`
3. Revisar payload JSON
4. Verificar que backend esté suscrito al topic

**Stream no se ve:**
1. Verificar MediaMTX: `http://edge-ip:8888/cam-principal`
2. Verificar RTSP source: `ffprobe rtsp://...`
3. Verificar puertos abiertos
4. Revisar logs de MediaMTX

---

## 🎯 Próximos Pasos

1. ✅ Configurar cámara con ONVIF
2. ✅ Configurar MediaMTX local
3. ⏳ Crear cliente MQTT para comunicación con servidor
4. ⏳ Implementar registro automático de cámaras
5. ⏳ Desarrollar dashboard de cliente
6. ⏳ Implementar sistema de grabación distribuido
7. ⏳ Configurar acceso remoto seguro
8. ⏳ Pruebas de carga y optimización

