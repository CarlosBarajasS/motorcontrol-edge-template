# MotorControl Edge Template

Plantilla base para desplegar un gateway local (Raspberry/mini PC) por cliente.

## Servicios incluidos

- `mediamtx`: convierte RTSP a HLS/WebRTC para consumo web.
- `edge-agent`: servicio simple de estado/heartbeat hacia backend central.

## Estructura

- `docker-compose.yml`: orquestacion del edge.
- `mediamtx/mediamtx.yml`: rutas de camaras y streaming.
- `edge-agent/`: agente Node.js para health y heartbeat.

## Quickstart

1) Copiar variables de entorno:

```bash
cp .env.example .env
```

2) Ajustar valores en `.env`:

- `EDGE_SITE_ID`
- `EDGE_LOCATION`
- `CLOUD_API_URL`
- `EDGE_SHARED_TOKEN`

3) Ajustar ruta RTSP en `mediamtx/mediamtx.yml`:

```yaml
paths:
  cam-profesor:
    source: rtsp://admin:CAMERA_PASSWORD@192.168.1.80:554/Streaming/Channels/101
```

4) Levantar:

```bash
docker compose up -d --build
```

## URLs de prueba

- Health agente: `http://<EDGE_IP>:8090/health`
- HLS stream: `http://<EDGE_IP>:8888/cam-profesor/index.m3u8`
- RTSP republish: `rtsp://<EDGE_IP>:8554/cam-profesor`

## Notas

- Para produccion usa VPN (split tunnel) entre edge y backend.
- No expongas puertos de camara a internet.
- Si habilitas grabacion local en edge, configura sync/push al NAS o core.
