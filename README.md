# 🚀 Motor Control Edge Gateway Template

**Sistema distribuido de monitoreo de cámaras multi-cliente**

Este es el template para desplegar un **Edge Gateway** en la casa/oficina de cada cliente. Se comunica con el servidor central (MotorControlAPI) vía MQTT y proporciona streaming de cámaras IP locales.

---

## 📐 Arquitectura del Sistema

```
┌─────────────────────────────────────┐
│  Servidor Central (Raspberry Pi)    │
│  - MotorControlAPI                  │
│  - PostgreSQL                       │
│  - Mosquitto MQTT Broker            │
│  - NAS (Grabaciones)                │
└──────────────┬──────────────────────┘
               │ MQTT
               │ (mqtt://servidor:1885)
               │
     ┌─────────┼─────────┐
     │         │         │
     ↓         ↓         ↓
┌─────────┐ ┌─────────┐ ┌─────────┐
│Cliente 1│ │Cliente 2│ │Cliente N│
│Edge GW  │ │Edge GW  │ │Edge GW  │
└─────────┘ └─────────┘ └─────────┘
```

**Más detalles**: Ver [docs/ARQUITECTURA_COMPLETA.md](docs/ARQUITECTURA_COMPLETA.md)

---

## 🛠️ Componentes del Edge Gateway

### 1. **MediaMTX** (Streaming Server)
- Convierte streams RTSP de cámaras IP a HLS/WebRTC
- Permite acceso desde navegadores y apps móviles
- Soporta múltiples cámaras simultáneamente

### 2. **Edge Agent** (Node.js)
- Cliente MQTT que se conecta al servidor central
- Monitorea estado de cámaras automáticamente
- Envía telemetría y heartbeat cada 30 segundos
- Recibe comandos del servidor central
- Expone API REST local para debugging

---

## 📋 Requisitos

### Hardware
- **Raspberry Pi 4/5** (4GB RAM mínimo) o Mini PC
- **Tarjeta SD/SSD** de 32GB+ (si usa grabación local)
- **Red Ethernet** (recomendado para cámaras)

### Software
- **Docker** y **Docker Compose**
- Sistema operativo: Raspberry Pi OS / Ubuntu / Debian
- Acceso de red al servidor central

---

## 🚀 Instalación y Configuración

### Paso 1: Clonar el Repositorio

```bash
# En la Raspberry Pi del cliente
cd /home/pi
git clone <url-del-repo> motorcontrol-edge
cd motorcontrol-edge
```

### Paso 2: Configurar Variables de Entorno

```bash
# Copiar plantilla
cp .env.example .env

# Editar configuración
nano .env
```

**Variables importantes a configurar**:

```env
# Identificación única para este cliente
CLIENT_ID=edge-gateway-cliente001
GATEWAY_NAME=Casa del Cliente 001
LOCATION=Guadalajara, Jalisco

# Servidor Central
MQTT_HOST=192.168.100.49        # IP del servidor (o dominio público)
MQTT_PORT=1885
MQTT_USERNAME=client-001         # Usuario MQTT único por cliente
MQTT_PASSWORD=<contraseña_segura>

# MediaMTX
MEDIAMTX_API_URL=http://mediamtx:9997

# Heartbeat
HEARTBEAT_INTERVAL_MS=30000      # 30 segundos
```

### Paso 3: Configurar Cámaras en MediaMTX

Editar `mediamtx/mediamtx.yml`:

```yaml
paths:
  # Cámara Principal - Entrada
  cam-principal:
    source: rtsp://admin:CONTRASEÑA@192.168.1.100:554/Streaming/Channels/101

  # Cámara Secundaria - Patio
  cam-patio:
    source: rtsp://admin:CONTRASEÑA@192.168.1.101:554/Streaming/Channels/101

  # Cámara Terciaria - Garage
  cam-garage:
    source: rtsp://admin:CONTRASEÑA@192.168.1.102:554/Streaming/Channels/101
```

**Importante**: Reemplaza `CONTRASEÑA` con la contraseña real de las cámaras.

### Paso 4: Construir e Iniciar

```bash
# Construir imágenes
docker-compose build

# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f
```

### Paso 5: Verificar Funcionamiento

```bash
# Health check del Edge Agent
curl http://localhost:8090/health

# Listar cámaras detectadas
curl http://localhost:8090/cameras

# Ver stream HLS en navegador
http://<IP-DEL-EDGE>:8888/cam-principal
```

---

## 📡 Comunicación con el Servidor Central

### Topics MQTT Publicados (Edge → Servidor)

```
gateway/<CLIENT_ID>/heartbeat          # Cada 30 segundos
camera/<CLIENT_ID>/<cameraId>/status   # Estado de cada cámara
camera/<CLIENT_ID>/<cameraId>/events   # Eventos (online/offline)
camera/<CLIENT_ID>/<cameraId>/register # Al detectar nueva cámara
camera/<CLIENT_ID>/<cameraId>/stats    # Estadísticas de streaming
```

### Topics MQTT Suscritos (Servidor → Edge)

```
gateway/<CLIENT_ID>/command            # Comandos generales
camera/<CLIENT_ID>/<cameraId>/command  # Comandos a cámara específica
camera/<CLIENT_ID>/<cameraId>/config   # Cambios de configuración
```

### Ejemplo de Heartbeat Enviado

```json
{
  "timestamp": "2024-02-06T15:30:00.000Z",
  "uptime": 3600,
  "gatewayName": "Casa Cliente 001",
  "location": "Guadalajara, Jalisco",
  "cpu": 35.2,
  "memory": 512,
  "memoryPercent": 65.4,
  "cameras": {
    "total": 3,
    "online": 2,
    "offline": 1,
    "totalViewers": 1,
    "totalBytesReceived": 1048576
  }
}
```

---

## 🎥 Acceso a Streams de Video

### URLs Locales (Red Interna)

| Protocolo | URL | Uso |
|-----------|-----|-----|
| **HLS** | `http://<EDGE-IP>:8888/cam-principal` | Navegadores, móviles |
| **RTSP** | `rtsp://<EDGE-IP>:8554/cam-principal` | VLC, OBS, apps profesionales |
| **WebRTC** | `http://<EDGE-IP>:8889/cam-principal` | Baja latencia (<1s) |

### URLs Públicas (Con IP Pública o DDNS)

Si el edge tiene IP pública o DDNS configurado:

```
http://cliente001.tudominio.com:8888/cam-principal
```

**Ver guía completa**: [docs/ACCESO_REMOTO.md](docs/ACCESO_REMOTO.md)

---

## 🔧 Configuración en el Servidor Central

### Antes de desplegar el Edge Gateway en el cliente:

#### 1. Crear Usuario MQTT

```bash
# En el servidor central (Raspberry Pi)
cd /home/pi/MotorControlAPI

# Agregar usuario MQTT
docker exec mosquitto mosquitto_passwd -b /mosquitto/config/passwd client-001 <password>

# Reiniciar Mosquitto
docker restart mosquitto
```

#### 2. Crear Cuenta de Cliente (Opcional para API REST)

```bash
# Si también quieres acceso REST API
node scripts/createClient.js \
  --email cliente001@example.com \
  --password <password> \
  --clientId client-001
```

#### 3. Verificar Conectividad

```bash
# Desde el edge, probar conexión MQTT
mosquitto_sub -h 192.168.100.49 -p 1885 \
  -u client-001 -P <password> \
  -t '#' -v
```

---

## 📊 Monitoreo y Debugging

### Logs en Tiempo Real

```bash
# Ver logs del Edge Agent
docker-compose logs -f edge-agent

# Ver logs de MediaMTX
docker-compose logs -f mediamtx

# Ver todos los logs
docker-compose logs -f
```

### API REST del Edge Agent

El Edge Agent expone una API REST local para debugging:

```bash
# Health check
GET http://localhost:8090/health

# Información del gateway
GET http://localhost:8090/info

# Listar cámaras
GET http://localhost:8090/cameras

# Estadísticas del sistema
GET http://localhost:8090/stats

# Forzar actualización de cámaras
POST http://localhost:8090/cameras/refresh
```

### Verificar Conexión MQTT

```bash
# Ver estado de MQTT en health check
curl http://localhost:8090/health | jq '.mqtt'

# Resultado esperado:
{
  "connected": true
}
```

---

## 🔒 Seguridad

### Recomendaciones

1. **Usar contraseñas seguras** para MQTT y cámaras
2. **No exponer puertos de cámaras** directamente a internet
3. **Usar VPN** (Tailscale/WireGuard) para acceso remoto seguro
4. **Firewall**: Solo permitir conexiones desde servidor central

```bash
# Ejemplo de firewall con UFW
sudo ufw allow from 192.168.100.49 to any port 8888
sudo ufw allow from 192.168.100.49 to any port 8554
sudo ufw default deny incoming
sudo ufw enable
```

5. **TLS/SSL** para MQTT en producción

---

## 🔄 Actualizaciones

### Actualizar el Edge Gateway

```bash
cd /home/pi/motorcontrol-edge

# Detener servicios
docker-compose down

# Obtener última versión
git pull

# Reconstruir y reiniciar
docker-compose up -d --build

# Verificar
docker-compose logs -f
```

---

## 🛑 Comandos desde el Servidor Central

El servidor puede enviar comandos al edge via MQTT:

### Reiniciar Gateway

```bash
# Desde el servidor, publicar comando
mosquitto_pub -h localhost -p 1885 \
  -t "gateway/edge-gateway-001/command" \
  -m '{"action":"restart","params":{}}'
```

### Refrescar Estado de Cámaras

```bash
mosquitto_pub -h localhost -p 1885 \
  -t "gateway/edge-gateway-001/command" \
  -m '{"action":"refresh_cameras","params":{}}'
```

### Obtener Estadísticas

```bash
mosquitto_pub -h localhost -p 1885 \
  -t "gateway/edge-gateway-001/command" \
  -m '{"action":"get_stats","params":{}}'

# El gateway responderá en:
# gateway/edge-gateway-001/stats
```

---

## 📁 Estructura del Proyecto

```
motorcontrol-edge-template/
├── docker-compose.yml              # Orquestación de servicios
├── .env.example                    # Plantilla de variables
├── .env                            # Variables (crear desde .env.example)
│
├── mediamtx/
│   ├── mediamtx.yml                # Configuración de cámaras
│   ├── download-mediamtx.ps1       # Script descarga (Windows)
│   └── start-mediamtx.bat          # Script inicio (Windows)
│
├── edge-agent/
│   ├── server.js                   # Aplicación principal
│   ├── package.json                # Dependencias Node.js
│   ├── Dockerfile                  # Imagen Docker
│   └── services/
│       ├── MqttClientService.js    # Cliente MQTT
│       ├── CameraMonitorService.js # Monitoreo de cámaras
│       └── SystemMonitorService.js # Monitoreo de sistema
│
└── docs/
    ├── ARQUITECTURA_COMPLETA.md    # Arquitectura del sistema
    ├── ACCESO_REMOTO.md            # Guía de acceso remoto
    ├── ACCESO_MULTIDISPOSITIVO.md  # Acceso desde diferentes dispositivos
    └── INICIAR_MEDIAMTX.md         # Guía MediaMTX (Windows)
```

---

## 🆘 Troubleshooting

### Problema: Edge Agent no se conecta a MQTT

**Verificar**:
1. IP del servidor correcta en `.env`
2. Puerto 1885 abierto en firewall del servidor
3. Credenciales MQTT correctas
4. Usuario creado en Mosquitto del servidor

```bash
# Probar conexión manualmente
mosquitto_sub -h 192.168.100.49 -p 1885 -u client-001 -P password -t '#'
```

### Problema: Cámaras no se detectan

**Verificar**:
1. URLs RTSP correctas en `mediamtx.yml`
2. Cámaras accesibles desde el edge: `ping 192.168.1.100`
3. Contraseñas correctas en URLs RTSP
4. Ver logs de MediaMTX: `docker-compose logs mediamtx`

### Problema: Stream no se ve en navegador

**Verificar**:
1. MediaMTX corriendo: `docker-compose ps`
2. Puerto 8888 abierto: `curl http://localhost:8888/cam-principal`
3. Probar con VLC usando RTSP primero
4. Ver logs: `docker-compose logs mediamtx`

---

## 📞 Soporte

**Documentación adicional**:
- [Arquitectura Completa](docs/ARQUITECTURA_COMPLETA.md)
- [Acceso Remoto](docs/ACCESO_REMOTO.md)
- [Acceso Multi-Dispositivo](docs/ACCESO_MULTIDISPOSITIVO.md)

**Logs centralizados**:
```bash
# Ver todos los logs
docker-compose logs -f

# Ver solo errores
docker-compose logs | grep -i error
```

---

## 📈 Escalabilidad

Este edge gateway puede soportar:
- **8-10 cámaras** simultáneas (Raspberry Pi 5 - 4GB)
- **4-6 streams** concurrentes
- Resolución máxima: **1080p** por stream

Para más cámaras, considerar:
- Mini PC con más recursos
- Raspberry Pi con 8GB RAM
- Múltiples edge gateways

---

## 🔄 Flujo de Despliegue Completo

### En el Servidor Central (Una vez)

1. Verificar MotorControlAPI corriendo
2. Crear usuario MQTT: `client-001`
3. Anotar credenciales

### En Cada Cliente (Por Casa/Oficina)

1. Instalar Raspberry Pi / Mini PC
2. Instalar Docker
3. Clonar este repo
4. Configurar `.env` con credenciales únicas
5. Configurar cámaras en `mediamtx.yml`
6. Ejecutar `docker-compose up -d`
7. Verificar en dashboard del servidor central

---

## 📝 Licencia

Proyecto privado - Uso interno

---

## 🎯 Próximos Pasos

- [ ] Implementar grabación local con sync al NAS
- [ ] Agregar detección de movimiento
- [ ] Snapshot automático en eventos
- [ ] Dashboard web embebido en el edge
- [ ] Integración con notificaciones push
- [ ] Soporte para PTZ (cámaras motorizadas)

---

**Desarrollado para**: Sistema de Monitoreo Distribuido Multi-Cliente
**Versión**: 1.0.0
**Última actualización**: 2024-02-06
