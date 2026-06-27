# CLAUDE.md — Edge Template (motorcontrol-edge-template)

> Template para el gateway edge (Raspberry Pi) de MotorControlEnterprise.
> Proyecto independiente — no modificar desde el repo central.
> Repo central: `c:\dev\MotorControlEnterprise`

---

## Identidad de este repo

Este es el **template** que se despliega en cada gateway Raspberry Pi de un cliente.
El wizard del servidor central genera los archivos de configuración a partir de este template
(`.env`, `docker-compose.yml`, `mediamtx/mediamtx.yml`) con los datos del cliente.

---

## Estructura

```
motorcontrol-edge-template/
├── docker-compose.yml          ← servicios: edge-agent + mediamtx (edge local)
├── mediamtx/
│   └── mediamtx.yml            ← configuración MediaMTX edge
│       ├── Puerto 8554: RTSP (recibe cámaras IP)
│       ├── Puerto 8888: HLS (disponible pero no usado en frontend)
│       ├── Puerto 8889: WebRTC HTTP / WHEP signaling
│       └── Puerto 8189/UDP: WebRTC ICE/media
└── edge-agent/
    ├── index.js                ← entrada del servicio Node.js
    └── services/
        ├── OnvifDiscoveryService.js   ← descubrimiento ONVIF con fallback multi-puerto
        ├── CameraMonitorService.js    ← monitoreo de estado de streams
        └── MqttService.js            ← conexión al broker central (puerto 1885)
```

---

## Variables de entorno (generadas por el wizard)

```env
GATEWAY_ID=edge-gateway-{nombre-cliente}   # identificador único del gateway
CENTRAL_API_URL=http://{ip-servidor}:8080  # API del servidor central
CENTRAL_API_TOKEN={jwt-token}              # token de autenticación con el servidor
MEDIAMTX_API=http://mediamtx:9997          # API interna de MediaMTX
MQTT_BROKER=tcp://{ip-servidor}:1885       # broker MQTT central
```

---

## Streaming

El edge actúa como **relay RTSP → central MediaMTX**:

1. Las cámaras IP envían RTSP al MediaMTX local (puerto 8554)
2. MediaMTX local re-publica el stream al MediaMTX central via RTSP push
3. El frontend consume WebRTC/WHEP desde el MediaMTX central

**Puertos que deben estar abiertos en el router del cliente:**
- `8554/TCP` — RTSP entrante de cámaras IP
- El edge-agent usa salida hacia el servidor central (no necesita puertos abiertos de entrada adicionales)

**streamPath format:** `${GATEWAY_ID}/${cameraKey}` — ej: `edge-gateway-casa-carlos/cuarto`

---

## ONVIF Discovery

Al iniciar, `OnvifDiscoveryService.js` descubre automáticamente las cámaras en la red local:
1. Envía WS-Discovery multicast
2. Para cada cámara encontrada, prueba puertos ONVIF: 8000, 80, 8080, 554
3. Obtiene perfiles RTSP y los registra en el MediaMTX local
4. Reporta el resultado al servidor central via MQTT

El servidor central puede solicitar re-scan via MQTT topic: `gateway/{GATEWAY_ID}/discover`

---

## Reglas absolutas

❌ Nunca modificar desde el repo central — este es un template independiente
❌ Nunca hardcodear IPs o credenciales — siempre via `.env`
❌ El edge es **relay-only** — no graba localmente (grabación en servidor central)
❌ No agregar dependencias npm sin evaluar impacto en Raspberry Pi (recursos limitados)

---

## Deploy en el cliente

El wizard genera un `.zip` con los archivos configurados. El técnico:
1. Descomprime en el Pi
2. Ejecuta `docker compose up -d`
3. El edge-agent inicia ONVIF discovery automáticamente
4. El servidor central recibe el registro del gateway y actualiza el estado de las cámaras

## Memory
Vault: `C:\Users\carlo\Documents\ClaudeBrain\01-projects\motorcontrol-edge-template\`
Briefing: `briefing_motorcontrol-edge.md` — leer al iniciar sesión en este proyecto.
Nodos de detalle en `memory\` — leer solo si el usuario los pide por nombre.
