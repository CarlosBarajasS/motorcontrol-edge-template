const express = require('express');
const MqttClientService = require('./services/MqttClientService');
const CameraMonitorService = require('./services/CameraMonitorService');
const SystemMonitorService = require('./services/SystemMonitorService');

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

const cameraMonitor = new CameraMonitorService(mqttService, MEDIAMTX_API_URL);
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

  res.json({
    status: systemHealth.healthy ? 'ok' : 'degraded',
    clientId: CLIENT_ID,
    gatewayName: GATEWAY_NAME,
    location: LOCATION,
    mqtt: {
      connected: mqttService.isConnected(),
    },
    cameras: cameraStats,
    system: systemHealth,
    timestamp: new Date().toISOString(),
  });
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

  const { action, params } = message;

  switch (action) {
    case 'restart':
      console.log(`[Camera ${cameraId}] Restart not implemented yet`);
      // TODO: Implementar restart de stream en MediaMTX
      break;

    case 'snapshot':
      console.log(`[Camera ${cameraId}] Snapshot not implemented yet`);
      // TODO: Generar snapshot con FFmpeg
      break;

    case 'start_recording':
      console.log(`[Camera ${cameraId}] Start recording not implemented yet`);
      // TODO: Habilitar recording en MediaMTX
      break;

    case 'stop_recording':
      console.log(`[Camera ${cameraId}] Stop recording not implemented yet`);
      break;

    default:
      console.log(`[Camera ${cameraId}] Unknown command: ${action}`);
  }
});

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
