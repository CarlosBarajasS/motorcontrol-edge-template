'use strict';

const net   = require('net');
const fs    = require('fs');
const axios = require('axios');

const CHECK_INTERVAL_MS  = 60_000;   // cada 60s
const FAIL_THRESHOLD     = 3;        // ciclos consecutivos para activar scan
const COOLDOWN_MS        = 10 * 60 * 1000; // 10 min tras scan exitoso
const TCP_TIMEOUT_MS     = 2_000;    // timeout TCP por host en scan
const RTSP_TIMEOUT_MS    = 3_000;    // timeout validación RTSP
const SCAN_CONCURRENCY   = 20;       // hosts en paralelo

class DvrWatchdogService {
  /**
   * @param {object} opts
   * @param {string}   opts.nvrIp          - IP actual del DVR (del .env)
   * @param {number}   opts.nvrPort        - Puerto ONVIF (no usado aquí, solo para contexto)
   * @param {string}   opts.nvrUser        - Usuario DVR
   * @param {string}   opts.nvrPassword    - Contraseña DVR
   * @param {string}   opts.mediamtxApiUrl - e.g. "http://mediamtx:9997"
   * @param {object|null} opts.mediamtxAuth - { username, password } o null
   * @param {Function} opts.mqttPublish    - (topic, payload) => void
   * @param {string}   opts.configFilePath - ruta al mediamtx.yml montado en el contenedor
   */
  constructor({ nvrIp, nvrPort, nvrUser, nvrPassword, mediamtxApiUrl, mediamtxAuth, mqttPublish, configFilePath }) {
    this.currentDvrIp   = nvrIp || '';
    this.nvrPort        = nvrPort || 80;
    this.nvrUser        = nvrUser || 'admin';
    this.nvrPassword    = nvrPassword || '';
    this.mediamtxApiUrl = mediamtxApiUrl || 'http://mediamtx:9997';
    this.mediamtxAuth   = mediamtxAuth || null;
    this.mqttPublish    = mqttPublish || (() => {});
    this.configFilePath = configFilePath || '/config/mediamtx.yml';

    this.failCycles  = 0;
    this.lastScanAt  = null;
    this.scanning    = false;
    this._timer      = null;
  }

  /** Arranca el loop de monitoreo. No-op si NVR_IP no está definido. */
  start() {
    if (!this.currentDvrIp) {
      console.warn('[Watchdog] ⚠️  NVR_IP no definido — watchdog deshabilitado');
      return;
    }
    console.log(`[Watchdog] 🐕 Iniciado — monitoreando DVR en ${this.currentDvrIp} (check cada ${CHECK_INTERVAL_MS / 1000}s)`);
    this._timer = setInterval(() => this._checkPaths(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  // ── Monitoreo ──────────────────────────────────────────────────────────────

  async _checkPaths() {
    try {
      const headers = this._authHeaders();
      const res = await axios.get(`${this.mediamtxApiUrl}/v3/paths/list`, {
        headers,
        timeout: 5000,
      });

      const items = res.data?.items ?? [];

      // Solo paths con source RTSP (los del DVR)
      const rtspPaths = items.filter(p => p.source?.type === 'rtspSource');

      if (rtspPaths.length === 0) {
        // DVR aún no configurado o paths no registrados — no es fallo
        this.failCycles = 0;
        return;
      }

      const downCount = rtspPaths.filter(p => p.ready === false).length;
      const downRatio = downCount / rtspPaths.length;

      if (downRatio >= 0.5) {
        this.failCycles++;
        console.log(`[Watchdog] ⚠️  ${downCount}/${rtspPaths.length} paths caídos — ciclo de fallo #${this.failCycles}`);
      } else {
        if (this.failCycles > 0) {
          console.log(`[Watchdog] ✅ Streams recuperados — reseteando contador`);
        }
        this.failCycles = 0;
        return;
      }

      if (this.failCycles >= FAIL_THRESHOLD && !this.scanning && this._cooldownOk()) {
        console.log(`[Watchdog] 🔍 ${FAIL_THRESHOLD} ciclos de fallo detectados — iniciando scan de LAN`);
        await this._scanLan();
      }
    } catch (err) {
      // Error al consultar MediaMTX (puede estar reiniciando) — no contar como fallo
      console.warn('[Watchdog] No se pudo consultar MediaMTX paths:', err.message);
    }
  }

  _cooldownOk() {
    if (!this.lastScanAt) return true;
    return (Date.now() - this.lastScanAt.getTime()) >= COOLDOWN_MS;
  }

  // ── Scan de LAN ────────────────────────────────────────────────────────────

  async _scanLan() {
    this.scanning = true;
    try {
      const subnet = this._deriveSubnet(this.currentDvrIp);
      if (!subnet) return; // CA7: log ya hecho en _deriveSubnet

      console.log(`[Watchdog] 📡 Escaneando ${subnet}.1-254 puerto 554...`);

      // Generar todas las IPs candidatas excepto la actual (ya falló)
      const candidates = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (ip !== this.currentDvrIp) candidates.push(ip);
      }

      // Escanear en batches de SCAN_CONCURRENCY
      for (let i = 0; i < candidates.length; i += SCAN_CONCURRENCY) {
        const batch = candidates.slice(i, i + SCAN_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(ip => this._tcpProbe(ip, 554))
        );

        for (let j = 0; j < batch.length; j++) {
          const ip = batch[j];
          const open = results[j].status === 'fulfilled' && results[j].value === true;
          if (!open) continue;

          console.log(`[Watchdog] 🎯 Puerto 554 abierto en ${ip} — validando RTSP...`);
          const valid = await this._validateRtsp(ip);
          if (valid) {
            console.log(`[Watchdog] ✅ DVR encontrado en ${ip} (antes: ${this.currentDvrIp})`);
            await this._applyNewIp(ip);
            return; // éxito — salir del scan
          }
        }
      }

      // CA4: no encontrado — solo log
      console.warn(`[Watchdog] ❌ DVR no encontrado en la subred ${subnet}.0/24 — sin cambios`);
      this.lastScanAt = new Date(); // cooldown igual para no re-escanear en loop
    } catch (err) {
      console.error('[Watchdog] Error inesperado en _scanLan:', err.message);
    } finally {
      this.scanning = false;
    }
  }

  /** Deriva los 3 primeros octetos de una IP. Retorna null si no es válida. (CA7) */
  _deriveSubnet(ip) {
    if (!ip) return null;
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some(p => isNaN(parseInt(p)))) {
      console.warn(`[Watchdog] ⚠️  NVR_IP "${ip}" no es una IPv4 válida — scan cancelado`);
      return null;
    }
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }

  // ── Probes ─────────────────────────────────────────────────────────────────

  /** Intento TCP al puerto indicado. Resuelve true si conecta, false si falla. */
  _tcpProbe(ip, port) {
    return new Promise(resolve => {
      const socket = new net.Socket();
      let settled = false;

      const done = (result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };

      socket.setTimeout(TCP_TIMEOUT_MS);
      socket.on('connect', () => done(true));
      socket.on('timeout', () => done(false));
      socket.on('error',   () => done(false));
      socket.connect(port, ip);
    });
  }

  /**
   * Valida que el host es un servidor RTSP con las credenciales del DVR.
   * Acepta respuesta 200 o 401 (ambas = servidor RTSP genuino).
   */
  _validateRtsp(ip) {
    return new Promise(resolve => {
      const socket = new net.Socket();
      let settled = false;
      let responseData = '';

      const done = (result) => {
        if (settled) return;
        settled = true;
        try { socket.destroy(); } catch {}
        resolve(result);
      };

      const creds = Buffer.from(`${this.nvrUser}:${this.nvrPassword}`).toString('base64');
      const request = [
        `OPTIONS rtsp://${ip}:554/ RTSP/1.0`,
        `CSeq: 1`,
        `Authorization: Basic ${creds}`,
        '',
        '',
      ].join('\r\n');

      socket.setTimeout(RTSP_TIMEOUT_MS);
      socket.on('timeout', () => done(false));
      socket.on('error',   () => done(false));

      socket.on('data', (chunk) => {
        responseData += chunk.toString();
        // Tenemos suficiente para determinar si es RTSP
        if (responseData.startsWith('RTSP/1.0 200') || responseData.startsWith('RTSP/1.0 401')) {
          done(true);
        } else if (responseData.length > 20) {
          // No es RTSP
          done(false);
        }
      });

      socket.on('connect', () => {
        socket.write(request);
      });

      socket.connect(554, ip);
    });
  }

  // ── Aplicar nueva IP ───────────────────────────────────────────────────────

  async _applyNewIp(newIp) {
    const oldIp = this.currentDvrIp;

    // 1. Reescribir mediamtx.yml (CA5)
    try {
      if (fs.existsSync(this.configFilePath)) {
        const content = fs.readFileSync(this.configFilePath, 'utf8');
        const updated = content.split(oldIp).join(newIp); // replace all occurrences
        fs.writeFileSync(this.configFilePath, updated, 'utf8');
        console.log(`[Watchdog] 📝 ${this.configFilePath} actualizado: ${oldIp} → ${newIp}`);
      } else {
        console.warn(`[Watchdog] ⚠️  Config no encontrado en ${this.configFilePath} — solo actualizando MediaMTX API`);
      }
    } catch (err) {
      console.error('[Watchdog] Error al reescribir mediamtx.yml:', err.message);
      // Continuar igual — la API de MediaMTX sí se actualizará
    }

    // 2. PATCH paths en MediaMTX que contengan la IP antigua
    try {
      const headers = this._authHeaders();
      const listRes = await axios.get(`${this.mediamtxApiUrl}/v3/paths/list`, {
        headers,
        timeout: 5000,
      });

      const paths = listRes.data?.items ?? [];
      let patchedCount = 0;

      for (const p of paths) {
        const sourceUrl = p.conf?.source;
        if (!sourceUrl || !sourceUrl.includes(oldIp)) continue;

        const newSource = sourceUrl.split(oldIp).join(newIp);
        try {
          await axios.patch(
            `${this.mediamtxApiUrl}/v3/config/paths/patch/${encodeURIComponent(p.name)}`,
            { source: newSource },
            { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: 5000 }
          );
          patchedCount++;
        } catch (patchErr) {
          console.warn(`[Watchdog] No se pudo actualizar path "${p.name}":`, patchErr.message);
        }
      }

      console.log(`[Watchdog] 🔧 ${patchedCount} paths actualizados en MediaMTX API`);
    } catch (err) {
      console.error('[Watchdog] Error al actualizar paths en MediaMTX:', err.message);
    }

    // 3. Publicar MQTT (CA6)
    try {
      this.mqttPublish(`gateway/${this._gatewayId()}/evt/dvr-ip-changed`, {
        gatewayId:    this._gatewayId(),
        oldIp,
        newIp,
        pathsUpdated: -1, // ya logueado arriba
        detectedAt:   new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[Watchdog] Error al publicar MQTT:', err.message);
    }

    // 4. Actualizar estado interno
    this.currentDvrIp = newIp;
    this.lastScanAt   = new Date();
    this.failCycles   = 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _authHeaders() {
    if (this.mediamtxAuth?.username && this.mediamtxAuth?.password) {
      const token = Buffer.from(`${this.mediamtxAuth.username}:${this.mediamtxAuth.password}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }
    return {};
  }

  /** Lee CLIENT_ID desde env para el topic MQTT. */
  _gatewayId() {
    return process.env.CLIENT_ID || 'edge-gateway';
  }
}

module.exports = DvrWatchdogService;
