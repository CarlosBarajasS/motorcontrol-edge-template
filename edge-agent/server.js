const express = require('express');
const axios = require('axios');
const MqttClientService = require('./services/MqttClientService');
const CameraMonitorService = require('./services/CameraMonitorService');
const SystemMonitorService = require('./services/SystemMonitorService');
const isapiClient = require('./services/IsapiClientService');
const mediamtxManager = require('./services/MediamtxManagerService');
const onvifDiscovery = require('./services/OnvifDiscoveryService');

// ========================================
// CONFIGURACIÓN
// ========================================

const PORT = process.env.PORT || 8090;
const CLIENT_ID = process.env.CLIENT_ID || 'edge-gateway-001';
const GATEWAY_NAME = process.env.GATEWAY_NAME || 'Edge Gateway';
const LOCATION = process.env.LOCATION || 'Unknown Location';

// Configuración MQTT
const MQTT_HOST = process.env.MQTT_HOST || 'localhost';
const MQTT_PORT = process.env.MQTT_PORT || 1883;
const MQTT_USERNAME = process.env.MQTT_USERNAME || '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || '';

// MediaMTX API
const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://mediamtx:9997';
const MEDIAMTX_USERNAME = process.env.MEDIAMTX_USERNAME || '';
const MEDIAMTX_PASSWORD = process.env.MEDIAMTX_PASSWORD || '';

// Central API (for ONVIF discovery reporting and REST heartbeat)
const CENTRAL_API_URL   = process.env.CENTRAL_API_URL   || 'http://177.247.175.4/api';
const CENTRAL_API_TOKEN = process.env.CENTRAL_API_TOKEN || '';

// Intervalos
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS) || 30000; // 30 segundos

// ========================================
// SERVICIOS
// ========================================

const mqttService = new MqttClientService({
  host: MQTT_HOST,
  port: MQTT_PORT,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: CLIENT_ID,
});

const cameraMonitor = new CameraMonitorService(
  mqttService,
  MEDIAMTX_API_URL,
  MEDIAMTX_USERNAME && MEDIAMTX_PASSWORD ? {
    username: MEDIAMTX_USERNAME,
    password: MEDIAMTX_PASSWORD,
  } : null
);
const systemMonitor = new SystemMonitorService();

// ========================================
// EXPRESS APP
// ========================================

const app = express();
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
  const systemHealth = await systemMonitor.checkHealth();
  const cameraStats = cameraMonitor.getStats();
  const mqttConnected = mqttService.isConnected();

  const body = {
    status: mqttConnected && systemHealth.healthy ? 'ok' : 'degraded',
    clientId: CLIENT_ID,
    gatewayName: GATEWAY_NAME,
    location: LOCATION,
    mqtt: {
      connected: mqttConnected,
    },
    cameras: cameraStats,
    system: systemHealth,
    timestamp: new Date().toISOString(),
  };

  // Devolver 503 si MQTT está desconectado para que Docker detecte el fallo y reinicie
  res.status(mqttConnected ? 200 : 503).json(body);
});

// Información general del gateway
app.get('/info', (req, res) => {
  res.json({
    clientId: CLIENT_ID,
    gatewayName: GATEWAY_NAME,
    location: LOCATION,
    version: '1.0.0',
    mediamtxApiUrl: MEDIAMTX_API_URL,
    mqttBroker: `${MQTT_HOST}:${MQTT_PORT}`,
  });
});

// Listar cámaras
app.get('/cameras', (req, res) => {
  const cameras = cameraMonitor.getAllCameras();
  res.json({
    total: cameras.length,
    cameras,
  });
});

// Obtener estadísticas del sistema
app.get('/stats', async (req, res) => {
  const stats = await systemMonitor.getSystemStats();
  res.json(stats);
});

// Forzar actualización de estado de cámaras
app.post('/cameras/refresh', async (req, res) => {
  await cameraMonitor.fetchCamerasStatus();
  res.json({ message: 'Camera status refreshed' });
});

// ========================================
// MQTT HANDLERS
// ========================================

// Manejar comandos al gateway
mqttService.onMessage(`gateway/${CLIENT_ID}/command`, async (topic, message) => {
  console.log('[Gateway] Received command:', message);

  const { action, params } = message;

  switch (action) {
    case 'restart':
      console.log('[Gateway] ⚠️  Restart command received. Restarting in 5 seconds...');
      setTimeout(() => {
        process.exit(0); // Docker restart policy se encargará del reinicio
      }, 5000);
      break;

    case 'refresh_cameras':
      console.log('[Gateway] Refreshing camera status...');
      await cameraMonitor.fetchCamerasStatus();
      break;

    case 'get_stats':
      const stats = await systemMonitor.getSystemStats();
      mqttService.publish(`gateway/${CLIENT_ID}/stats`, stats);
      break;

    default:
      console.log(`[Gateway] Unknown command: ${action}`);
  }
});

// Manejar comandos a cámaras específicas
mqttService.onMessage(`camera/${CLIENT_ID}/+/command`, (topic, message) => {
  const cameraId = topic.split('/')[2];
  console.log(`[Camera ${cameraId}] Received command:`, message);

  const { action } = message;

  switch (action) {
    case 'restart':
      console.log(`[Camera ${cameraId}] Restart not implemented yet`);
      break;
    case 'snapshot':
      console.log(`[Camera ${cameraId}] Snapshot not implemented yet`);
      break;
    case 'start_recording':
      console.log(`[Camera ${cameraId}] Start recording not implemented yet`);
      break;
    case 'stop_recording':
      console.log(`[Camera ${cameraId}] Stop recording not implemented yet`);
      break;
    default:
      console.log(`[Camera ${cameraId}] Unknown command: ${action}`);
  }
});

// ── ISAPI commands (SD card listing, proxied to camera via HTTP) ──────────────
mqttService.onMessage(`cmd/${CLIENT_ID}/isapi`, async (topic, message) => {
  const { requestId, action, params } = message;
  if (!requestId) return;

  const responseTopic = `response/${CLIENT_ID}/${requestId}`;

  try {
    let data;
    switch (action) {
      case 'listSdRecordings': {
        const { cameraId, start, end } = params;
        data = await isapiClient.listSdRecordings(cameraId, start, end);
        break;
      }
      case 'startPlayback': {
        const { cameraId, playbackUri } = params;
        const pathName = `sdplay-${cameraId}-${Date.now()}`;
        await mediamtxManager.addPath(pathName, playbackUri);
        data = { mediamtxPath: pathName };
        break;
      }
      default:
        throw new Error(`Unknown ISAPI action: ${action}`);
    }
    mqttService.publish(responseTopic, { success: true, data });
  } catch (err) {
    console.error(`[ISAPI] Error handling "${action}":`, err.message);
    mqttService.publish(responseTopic, { success: false, error: err.message });
  }
});

// ── PTZ commands (pan/tilt/zoom via ISAPI, proxied to camera via HTTP) ────────
mqttService.onMessage(`cmd/${CLIENT_ID}/ptz`, async (topic, message) => {
  const { requestId, action, params } = message;
  if (!requestId) return;

  const responseTopic = `response/${CLIENT_ID}/${requestId}`;

  try {
    let data;
    switch (action) {
      case 'move': {
        const { cameraId, pan, tilt, zoom } = params;
        await isapiClient.ptzMove(cameraId, pan, tilt, zoom);
        data = { ok: true };
        break;
      }
      case 'stop': {
        const { cameraId } = params;
        await isapiClient.ptzStop(cameraId);
        data = { ok: true };
        break;
      }
      case 'listPresets': {
        const { cameraId } = params;
        data = { presets: await isapiClient.listPresets(cameraId) };
        break;
      }
      case 'gotoPreset': {
        const { cameraId, presetId } = params;
        await isapiClient.gotoPreset(cameraId, presetId);
        data = { ok: true };
        break;
      }
      default:
        throw new Error(`Unknown PTZ action: ${action}`);
    }
    mqttService.publish(responseTopic, { success: true, data });
  } catch (err) {
    console.error(`[PTZ] Error handling "${action}":`, err.message);
    mqttService.publish(responseTopic, { success: false, error: err.message });
  }
});


// ── Local recordings commands (list files, start playback via mediamtx) ───────
const fs = require('fs');
const path = require('path');
const RECORDINGS_BASE = '/recordings';

mqttService.onMessage(`cmd/${CLIENT_ID}/recordings`, async (topic, message) => {
  const { requestId, action, params } = message;
  if (!requestId) return;

  const responseTopic = `response/${CLIENT_ID}/${requestId}`;

  try {
    let data;
    switch (action) {
      case 'list': {
        const { cameraId, date } = params;
        if (!cameraId || !date) throw new Error('cameraId and date required');
        const dateDir = path.join(RECORDINGS_BASE, cameraId, date);
        if (!fs.existsSync(dateDir)) {
          data = { files: [] };
          break;
        }
        const entries = fs.readdirSync(dateDir)
          .filter(f => f.endsWith('.mp4'))
          .sort();
        const files = entries.map(f => {
          const fullPath = path.join(dateDir, f);
          const stat = fs.statSync(fullPath);
          // fileName format: HH-MM-SS.mp4
          const timePart = f.replace('.mp4', '').split('-').slice(0,3).join(':');
          const startTime = new Date(`${date}T${timePart}`);
          return {
            name: f,
            path: path.join(cameraId, date, f),
            sizeMb: parseFloat((stat.size / (1024 * 1024)).toFixed(2)),
            startTime: startTime.toISOString(),
          };
        });
        data = { files };
        break;
      }
      case 'startPlayback': {
        const { cameraId, filePath } = params;
        if (!cameraId || !filePath) throw new Error('cameraId and filePath required');
        throw new Error('Local file playback via relay not yet implemented');
      }
      default:
        throw new Error(`Unknown recordings action: ${action}`);
    }
    mqttService.publish(responseTopic, { success: true, data });
  } catch (err) {
    console.error(`[Recordings] Error handling ${action}:`, err.message);
    mqttService.publish(responseTopic, { success: false, error: err.message });
  }
});

// ── ONVIF discovery command (from wizard or admin) ──────────────────────────
mqttService.onMessage(`gateway/${CLIENT_ID}/cmd/discover-onvif`, async (topic, message) => {
  const { requestId, cameras: camerasToDiscover } = message;
  console.log(`[Discovery] 📡 MQTT discover-onvif command received (${camerasToDiscover?.length} cameras)`);

  if (!camerasToDiscover?.length) return;

  for (const cam of camerasToDiscover) {
    if (!cam.ip) continue;

    console.log(`[Discovery] Scanning camera ${cam.id} at ${cam.ip}:${cam.onvifPort}...`);
    const result = await onvifDiscovery.scan(cam.ip, cam.onvifPort, cam.user, cam.pass);

    if (result.status === 'discovered' && result.mainStream) {
      const cameraKey = cam.cameraKey || `camera-${cam.id}`;
      try {
        await mediamtxManager.addPermanentPath(cameraKey, result.mainStream);
        if (result.subStream) {
          await mediamtxManager.addPermanentPath(`${cameraKey}-low`, result.subStream);
        }
      } catch (err) {
        console.warn(`[Discovery] MediaMTX path update failed for camera ${cam.id}:`, err.message);
      }
    }

    if (CENTRAL_API_TOKEN) {
      try {
        await axios.post(
          `${CENTRAL_API_URL}/edge/${CLIENT_ID}/cameras/${cam.id}/streams`,
          {
            rtsp:       result.mainStream ?? null,
            status:     result.status,
            brand:      result.brand    ?? null,
            model:      result.model    ?? null,
            resolution: result.resolution ?? null,
            fps:        result.fps      ?? null,
          },
          { headers: { 'X-Edge-Token': CENTRAL_API_TOKEN }, timeout: 10000 }
        );
      } catch (err) {
        console.warn(`[Discovery] Failed to report camera ${cam.id}:`, err.message);
      }
    }
  }

  console.log(`[Discovery] ✅ MQTT discovery complete (requestId: ${requestId})`);
});

// ========================================
// ONVIF STARTUP DISCOVERY
// ========================================

async function runStartupDiscovery() {
  if (!CENTRAL_API_TOKEN) {
    console.log('[Discovery] No CENTRAL_API_TOKEN — skipping ONVIF startup discovery');
    return;
  }

  console.log('[Discovery] 🔍 Starting ONVIF camera discovery...');

  let cameras;
  try {
    const res = await axios.get(
      `${CENTRAL_API_URL}/edge/${CLIENT_ID}/cameras`,
      { headers: { 'X-Edge-Token': CENTRAL_API_TOKEN }, timeout: 10000 }
    );
    cameras = res.data;
    console.log(`[Discovery] Found ${cameras.length} camera(s) to discover`);
  } catch (err) {
    console.warn('[Discovery] Could not fetch cameras from central API:', err.message);
    return;
  }

  for (const cam of cameras) {
    if (!cam.ip) {
      console.log(`[Discovery] ⚠️  Camera ${cam.name} has no IP — skipping`);
      continue;
    }

    console.log(`[Discovery] Scanning ${cam.name} at ${cam.ip}:${cam.onvifPort}...`);
    const result = await onvifDiscovery.scan(cam.ip, cam.onvifPort, cam.onvifUser, cam.onvifPass);

    if (result.status === 'discovered' && result.mainStream) {
      try {
        await mediamtxManager.addPermanentPath(cam.cameraKey, result.mainStream);
        console.log(`[Discovery] ✅ ${cam.name}: path ${cam.cameraKey} added to MediaMTX`);
      } catch (err) {
        console.warn(`[Discovery] Failed to add MediaMTX path for ${cam.name}:`, err.message);
      }

      if (result.subStream && cam.cameraKey) {
        const lowKey = `${cam.cameraKey}-low`;
        try {
          await mediamtxManager.addPermanentPath(lowKey, result.subStream);
          console.log(`[Discovery] ✅ ${cam.name}-low: path ${lowKey} added to MediaMTX`);
        } catch (err) {
          console.warn(`[Discovery] Failed to add sub-stream path:`, err.message);
        }
      }
    }

    try {
      await axios.post(
        `${CENTRAL_API_URL}/edge/${CLIENT_ID}/cameras/${cam.id}/streams`,
        {
          rtsp:       result.mainStream ?? null,
          status:     result.status,
          brand:      result.brand      ?? null,
          model:      result.model      ?? null,
          resolution: result.resolution ?? null,
          fps:        result.fps        ?? null,
        },
        { headers: { 'X-Edge-Token': CENTRAL_API_TOKEN }, timeout: 10000 }
      );
      console.log(`[Discovery] 📡 Reported ${cam.name} (${result.status}) to central`);
    } catch (err) {
      console.warn(`[Discovery] Failed to report ${cam.name} to central:`, err.message);
    }
  }

  console.log('[Discovery] ✅ Startup discovery complete');
}

// ========================================
// HEARTBEAT
// ========================================

async function sendHeartbeat() {
  if (!mqttService.isConnected()) {
    console.log('[Heartbeat] MQTT not connected, skipping...');
    return;
  }

  const systemStats = await systemMonitor.getLightStats();
  const cameraStats = cameraMonitor.getStats();

  mqttService.publishHeartbeat({
    gatewayName: GATEWAY_NAME,
    location: LOCATION,
    ...systemStats,
    cameras: cameraStats,
  });

  // Also notify central REST API so wizard can detect gateway online
  if (CENTRAL_API_TOKEN) {
    axios.post(
      `${CENTRAL_API_URL}/edge/${CLIENT_ID}/heartbeat`,
      {},
      { headers: { 'X-Edge-Token': CENTRAL_API_TOKEN }, timeout: 5000 }
    ).catch(() => {}); // Fire and forget
  }

  console.log(`[Heartbeat] 💓 Sent (Cameras: ${cameraStats.online}/${cameraStats.total} online)`);
}

// ========================================
// INICIALIZACIÓN
// ========================================

async function init() {
  console.log('═══════════════════════════════════════════════════');
  console.log('🚀 Edge Gateway Starting...');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   Client ID:     ${CLIENT_ID}`);
  console.log(`   Gateway Name:  ${GATEWAY_NAME}`);
  console.log(`   Location:      ${LOCATION}`);
  console.log(`   MQTT Broker:   ${MQTT_HOST}:${MQTT_PORT}`);
  console.log(`   MediaMTX API:  ${MEDIAMTX_API_URL}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Conectar a MQTT
  await mqttService.connect();

  // Esperar 2 segundos a que la conexión esté estable
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Run ONVIF discovery on startup (non-blocking — failures don't crash gateway)
  runStartupDiscovery().catch(err =>
    console.warn('[Discovery] Startup discovery error:', err.message)
  );

  // Iniciar monitoreo de cámaras
  cameraMonitor.startMonitoring();

  // Iniciar heartbeat
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  sendHeartbeat(); // Enviar inmediatamente

  // Iniciar servidor HTTP
  app.listen(PORT, () => {
    console.log(`\n✅ Edge Gateway running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health\n`);
  });
}

// Manejo de señales de cierre
process.on('SIGINT', () => {
  console.log('\n[Gateway] Shutting down gracefully...');
  cameraMonitor.stopMonitoring();
  mqttService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Gateway] SIGTERM received. Shutting down...');
  cameraMonitor.stopMonitoring();
  mqttService.disconnect();
  process.exit(0);
});

// Iniciar
init().catch(error => {
  console.error('❌ Fatal error during initialization:', error);
  process.exit(1);
});
