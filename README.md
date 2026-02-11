# MotorControl Edge Gateway

Template para desplegar el edge gateway en la red local de cada cliente.
Se conecta a sus cámaras IP y re-empuja los streams al servidor central — sin necesidad de IP pública ni abrir puertos en el router del cliente.

## Cómo funciona

```
Red local del cliente              Servidor central (177.247.175.4)
────────────────────────           ──────────────────────────────────
Cámara IP 192.168.x.x
       │ RTSP (LAN)
       ▼
 edge-mediamtx
  runOnReady ──────────────────→  central-mediamtx:8556  (RTSP push saliente)

 edge-agent  ──────────────────→  mosquitto:1885         (MQTT saliente)
  heartbeat / estado de cámaras
```

El Pi solo necesita acceso a internet saliente. No requiere IP pública ni redirección de puertos.

## Requisitos

- Docker + Docker Compose
- Raspberry Pi 4/5 (recomendado 4 GB RAM) o cualquier PC/VM con Linux
- Acceso a internet desde la red del cliente

## Instalación (vía wizard del panel admin)

La forma recomendada es usar el wizard en `/admin/wizard.html` del panel de administración:

1. Completar el wizard con datos del cliente y cámaras
2. Descargar los 3 archivos generados: `.env`, `mediamtx.yml`, `docker-compose.yml`
3. En la Raspberry Pi del cliente:

```bash
# Instalar Docker (si no está instalado)
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
# (cerrar sesión y volver a entrar para aplicar grupo)

# Clonar este repositorio
git clone https://github.com/CarlosBarajasS/motorcontrol-edge-template.git
cd motorcontrol-edge-template

# Reemplazar con los archivos descargados del wizard
cp /ruta/descarga/.env .
cp /ruta/descarga/docker-compose.yml .
cp /ruta/descarga/mediamtx.yml mediamtx/mediamtx.yml

# Iniciar
docker compose up -d

# Verificar
docker compose logs -f edge-agent
```

En 1-2 minutos las cámaras aparecen como "en línea" en el dashboard.

## Instalación manual

Si no usas el wizard, configura los archivos a mano:

### .env

```env
CLIENT_ID=edge-gateway-cliente001
GATEWAY_NAME=Nombre del Cliente
LOCATION=Ciudad, Estado

MQTT_HOST=177.247.175.4
MQTT_PORT=1885
MQTT_USERNAME=
MQTT_PASSWORD=
HEARTBEAT_INTERVAL_MS=30000

MEDIAMTX_API_URL=http://mediamtx:9997
MEDIAMTX_USERNAME=edge
MEDIAMTX_PASSWORD=edge123

CENTRAL_RTSP_HOST=177.247.175.4
CENTRAL_RTSP_PORT=8556
MEDIAMTX_PUSH_USER=edge-relay
MEDIAMTX_PUSH_PASS=relay-secret-2026

GATEWAY_PUBLIC_IP=0.0.0.0
PORT=8090
TZ=America/Mexico_City
```

### mediamtx/mediamtx.yml — agregar cámaras

```yaml
paths:
  cam-entrada:
    source: rtsp://admin:PASSWORD@192.168.1.100:554/Streaming/Channels/101

  cam-patio:
    source: rtsp://admin:PASSWORD@192.168.1.101:554/Streaming/Channels/101
```

## Estructura

```
motorcontrol-edge-template/
├── docker-compose.yml      # Servicios: mediamtx + edge-agent (bridge network)
├── .env                    # Variables de entorno (no en git)
├── mediamtx/
│   └── mediamtx.yml        # Configuración de cámaras y relay
└── edge-agent/
    ├── server.js
    ├── Dockerfile
    └── services/
        ├── MqttClientService.js
        ├── CameraMonitorService.js
        └── SystemMonitorService.js
```

## Comandos útiles

```bash
# Estado
docker compose ps

# Logs en tiempo real
docker compose logs -f edge-agent
docker compose logs -f mediamtx

# Health check del agente
curl http://localhost:8090/health

# Reiniciar tras cambiar .env o mediamtx.yml
docker compose up -d

# Detener
docker compose down
```

## Topics MQTT (referencia)

| Topic | Dirección | Descripción |
|---|---|---|
| `gateway/<CLIENT_ID>/heartbeat` | Pi → central | Estado cada 30 s |
| `camera/<CLIENT_ID>/<camId>/status` | Pi → central | Estado de cada cámara |
| `camera/<CLIENT_ID>/<camId>/register` | Pi → central | Al detectar nueva cámara |
| `gateway/<CLIENT_ID>/command` | central → Pi | Comandos generales |
| `camera/<CLIENT_ID>/<camId>/command` | central → Pi | Comandos por cámara |

## Troubleshooting

**Edge agent no conecta a MQTT**
- Verificar `MQTT_HOST` y `MQTT_PORT=1885` en `.env`
- `curl http://localhost:8090/health` — revisar campo `mqtt.connected`

**Cámara aparece offline**
- Verificar que la IP de la cámara es alcanzable desde el Pi: `ping 192.168.x.x`
- Revisar usuario/contraseña RTSP en `mediamtx.yml`
- `docker compose logs mediamtx --tail=30`

**Stream no llega al servidor central**
- Verificar `CENTRAL_RTSP_HOST=177.247.175.4` y `CENTRAL_RTSP_PORT=8556`
- El push se activa automáticamente cuando la cámara está online (runOnReady)
