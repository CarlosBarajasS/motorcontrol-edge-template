const axios = require('axios');

class CameraMonitorService {
  constructor(mqttService, mediamtxApiUrl = 'http://mediamtx:9997', mediamtxAuth = null) {
    this.mqttService = mqttService;
    this.mediamtxApiUrl = mediamtxApiUrl;
    this.mediamtxAuth = mediamtxAuth; // { username, password }
    this.cameras = new Map();
    this.monitorInterval = null;
    this.pollIntervalMs = 10000; // 10 segundos
  }

  /**
   * Iniciar monitoreo de cámaras
   */
  startMonitoring() {
    console.log('[CameraMonitor] Starting camera monitoring...');

    // Obtener información inicial
    this.fetchCamerasStatus();

    // Polling periódico
    this.monitorInterval = setInterval(() => {
      this.fetchCamerasStatus();
    }, this.pollIntervalMs);
  }

  /**
   * Detener monitoreo
   */
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[CameraMonitor] Monitoring stopped');
    }
  }

  /**
   * Obtener estado de todas las cámaras desde MediaMTX API
   */
  async fetchCamerasStatus() {
    try {
      // MediaMTX API v3: GET /v3/paths/list
      const config = {
        timeout: 5000,
      };

      // Agregar autenticación Basic si está configurada
      if (this.mediamtxAuth && this.mediamtxAuth.username) {
        config.auth = {
          username: this.mediamtxAuth.username,
          password: this.mediamtxAuth.password || '',
        };
      }

      const response = await axios.get(`${this.mediamtxApiUrl}/v3/paths/list`, config);

      if (response.data && response.data.items) {
        this.processPaths(response.data.items);
      }
    } catch (error) {
      console.error('[CameraMonitor] Error fetching camera status:', error.message);
    }
  }

  /**
   * Procesar paths de MediaMTX
   */
  processPaths(paths) {
    for (const path of paths) {
      const { name, source, ready, tracks, bytesReceived, readers } = path;

      // Filtrar solo cámaras (ignorar "all_others" y otros paths especiales)
      if (!name || name === 'all_others') continue;

      const cameraId = this.sanitizeCameraId(name);
      const isOnline = ready && tracks && tracks.length > 0;

      // Extraer información de tracks
      let videoTrack = null;
      if (tracks && tracks.length > 0) {
        videoTrack = tracks.find(t => t.type === 'video') || tracks[0];
      }

      const cameraStatus = {
        cameraId,
        name,
        online: isOnline,
        source: source?.type || 'unknown',
        sourceUrl: source?.url || null,
        ready,
        tracks: tracks ? tracks.length : 0,
        bytesReceived: bytesReceived || 0,
        viewers: readers ? readers.length : 0,
        resolution: videoTrack ? `${videoTrack.width}x${videoTrack.height}` : null,
        codec: videoTrack ? videoTrack.codec : null,
      };

      this.updateCameraStatus(cameraId, cameraStatus);
    }
  }

  /**
   * Actualizar estado de una cámara y publicar via MQTT
   */
  updateCameraStatus(cameraId, newStatus) {
    const previousStatus = this.cameras.get(cameraId);

    // Detectar cambios de estado
    if (!previousStatus) {
      // Nueva cámara detectada
      console.log(`[CameraMonitor] ✨ New camera detected: ${cameraId}`);
      this.registerNewCamera(cameraId, newStatus);
    } else if (previousStatus.online !== newStatus.online) {
      // Cambio en estado online/offline
      if (newStatus.online) {
        console.log(`[CameraMonitor] ✅ Camera ${cameraId} is now online`);
        this.publishCameraEvent(cameraId, {
          type: 'camera_online',
          message: `Camera ${cameraId} connected`,
        });
      } else {
        console.log(`[CameraMonitor] ❌ Camera ${cameraId} went offline`);
        this.publishCameraEvent(cameraId, {
          type: 'camera_offline',
          message: `Camera ${cameraId} disconnected`,
        });
      }
    }

    // Guardar estado actualizado
    this.cameras.set(cameraId, newStatus);

    // Publicar estado via MQTT
    this.mqttService.publishCameraStatus(cameraId, newStatus);
  }

  /**
   * Registrar nueva cámara en el servidor
   */
  registerNewCamera(cameraId, status) {
    const cameraInfo = {
      name: status.name || cameraId,
      model: this.extractModelFromSource(status.sourceUrl),
      ip: this.extractIpFromSource(status.sourceUrl),
      rtspUrl: status.sourceUrl,
      capabilities: ['rtsp', 'hls', 'webrtc'],
      streams: {
        main: `rtsp://localhost:8554/${cameraId}`,
        hls: `http://localhost:8888/${cameraId}`,
        webrtc: `http://localhost:8889/${cameraId}`,
      },
    };

    this.mqttService.registerCamera(cameraId, cameraInfo);
  }

  /**
   * Publicar evento de cámara
   */
  publishCameraEvent(cameraId, event) {
    this.mqttService.publishCameraEvent(cameraId, event);
  }

  /**
   * Extraer modelo de cámara desde URL RTSP (si es posible)
   */
  extractModelFromSource(url) {
    if (!url) return 'Unknown';
    // Por ahora retorna genérico, se puede mejorar con detección
    return 'IP Camera';
  }

  /**
   * Extraer IP de cámara desde URL RTSP
   */
  extractIpFromSource(url) {
    if (!url) return null;

    try {
      const match = url.match(/rtsp:\/\/[^@]+@([^:\/]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Sanitizar nombre de cámara para usar como ID
   */
  sanitizeCameraId(name) {
    return name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  }

  /**
   * Obtener snapshot de una cámara (si MediaMTX lo soporta)
   */
  async getCameraSnapshot(cameraId) {
    // Nota: MediaMTX no genera snapshots por defecto
    // Esta funcionalidad requeriría FFmpeg o integración adicional
    console.log(`[CameraMonitor] Snapshot for ${cameraId} not yet implemented`);
    return null;
  }

  /**
   * Obtener todas las cámaras
   */
  getAllCameras() {
    return Array.from(this.cameras.values());
  }

  /**
   * Obtener estadísticas generales
   */
  getStats() {
    const cameras = this.getAllCameras();
    return {
      total: cameras.length,
      online: cameras.filter(c => c.online).length,
      offline: cameras.filter(c => !c.online).length,
      totalViewers: cameras.reduce((sum, c) => sum + (c.viewers || 0), 0),
      totalBytesReceived: cameras.reduce((sum, c) => sum + (c.bytesReceived || 0), 0),
    };
  }
}

module.exports = CameraMonitorService;
