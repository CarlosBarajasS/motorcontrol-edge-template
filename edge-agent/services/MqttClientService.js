const mqtt = require('mqtt');

class MqttClientService {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.messageHandlers = new Map();
  }

  /**
   * Conectar al broker MQTT del servidor central
   */
  async connect() {
    if (this.client) {
      console.log('[MQTT] Already connected or connecting');
      return;
    }

    const { host, port, username, password, clientId } = this.config;

    if (!host || !clientId) {
      console.error('[MQTT] Missing required config: host or clientId');
      return;
    }

    const brokerUrl = `mqtt://${host}:${port}`;
    console.log(`[MQTT] Connecting to ${brokerUrl} as ${clientId}...`);

    const options = {
      clientId,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
      keepalive: 60,
    };

    if (username && password) {
      options.username = username;
      options.password = password;
    }

    this.client = mqtt.connect(brokerUrl, options);

    this.client.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('[MQTT] ✅ Connected successfully');
      this.subscribeToCommands();
    });

    this.client.on('error', (error) => {
      console.error('[MQTT] ❌ Connection error:', error.message);
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT] 🔄 Reconnecting... (attempt ${this.reconnectAttempts})`);

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('[MQTT] Max reconnect attempts reached. Giving up.');
        this.client.end(true);
      }
    });

    this.client.on('offline', () => {
      this.connected = false;
      console.log('[MQTT] ⚠️  Client offline');
    });

    this.client.on('close', () => {
      this.connected = false;
      console.log('[MQTT] Connection closed');
    });

    this.client.on('message', (topic, payload) => {
      this.handleMessage(topic, payload);
    });
  }

  /**
   * Suscribirse a topics de comandos del servidor
   */
  subscribeToCommands() {
    const { clientId } = this.config;

    const topics = [
      `gateway/${clientId}/command`,        // Comandos generales al gateway
      `camera/${clientId}/+/command`,       // Comandos a cámaras específicas
      `camera/${clientId}/+/config`,        // Configuración de cámaras
    ];

    topics.forEach(topic => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to subscribe to ${topic}:`, err.message);
        } else {
          console.log(`[MQTT] 📥 Subscribed to: ${topic}`);
        }
      });
    });
  }

  /**
   * Manejar mensajes entrantes
   */
  handleMessage(topic, payload) {
    try {
      const message = JSON.parse(payload.toString());
      console.log(`[MQTT] 📩 Received on ${topic}:`, message);

      // Ejecutar handlers registrados
      for (const [pattern, handler] of this.messageHandlers) {
        if (this.topicMatches(topic, pattern)) {
          handler(topic, message);
        }
      }
    } catch (error) {
      console.error(`[MQTT] Error parsing message from ${topic}:`, error.message);
    }
  }

  /**
   * Verificar si un topic coincide con un patrón
   */
  topicMatches(topic, pattern) {
    const topicParts = topic.split('/');
    const patternParts = pattern.split('/');

    if (topicParts.length !== patternParts.length) return false;

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '+') continue;
      if (patternParts[i] === '#') return true;
      if (patternParts[i] !== topicParts[i]) return false;
    }

    return true;
  }

  /**
   * Registrar handler para un patrón de topic
   */
  onMessage(topicPattern, handler) {
    this.messageHandlers.set(topicPattern, handler);
  }

  /**
   * Publicar mensaje en un topic
   */
  publish(topic, payload, options = {}) {
    if (!this.connected) {
      console.warn(`[MQTT] ⚠️  Not connected. Cannot publish to ${topic}`);
      return false;
    }

    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const publishOptions = { qos: 1, retain: false, ...options };

    this.client.publish(topic, message, publishOptions, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to publish to ${topic}:`, err.message);
      }
    });

    return true;
  }

  /**
   * Publicar heartbeat del gateway
   */
  publishHeartbeat(stats) {
    const { clientId } = this.config;
    const topic = `gateway/${clientId}/heartbeat`;

    const payload = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...stats,
    };

    this.publish(topic, payload);
  }

  /**
   * Publicar estado de una cámara
   */
  publishCameraStatus(cameraId, status) {
    const { clientId } = this.config;
    const topic = `camera/${clientId}/${cameraId}/status`;

    const payload = {
      ...status,
      timestamp: new Date().toISOString(),
    };

    this.publish(topic, payload);
  }

  /**
   * Publicar evento de una cámara
   */
  publishCameraEvent(cameraId, event) {
    const { clientId } = this.config;
    const topic = `camera/${clientId}/${cameraId}/events`;

    const payload = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.publish(topic, payload);
  }

  /**
   * Registrar una cámara en el servidor
   */
  registerCamera(cameraId, cameraInfo) {
    const { clientId } = this.config;
    const topic = `camera/${clientId}/${cameraId}/register`;

    const payload = {
      ...cameraInfo,
      registeredAt: new Date().toISOString(),
    };

    this.publish(topic, payload, { retain: true });
  }

  /**
   * Publicar estadísticas de streaming
   */
  publishStreamStats(cameraId, stats) {
    const { clientId } = this.config;
    const topic = `camera/${clientId}/${cameraId}/stats`;

    this.publish(topic, {
      ...stats,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Desconectar del broker
   */
  disconnect() {
    if (this.client) {
      console.log('[MQTT] Disconnecting...');
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  /**
   * Estado de la conexión
   */
  isConnected() {
    return this.connected;
  }
}

module.exports = MqttClientService;
