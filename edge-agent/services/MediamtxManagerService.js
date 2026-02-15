/**
 * MediaMTX dynamic path manager.
 * Adds and removes RTSP source paths in the local mediamtx instance via its REST API.
 * Used for SD card playback: a temporary path is created that re-streams the
 * camera's RTSP playback URI, so the central server can relay it as HLS.
 */
const axios = require('axios');

const MEDIAMTX_API_URL = process.env.MEDIAMTX_API_URL || 'http://mediamtx:9997';
const MEDIAMTX_USERNAME = process.env.MEDIAMTX_USERNAME || '';
const MEDIAMTX_PASSWORD = process.env.MEDIAMTX_PASSWORD || '';

// Auto-remove temporary paths after this duration (ms)
const PATH_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const activeTimers = new Map(); // pathName → timer handle

function authHeaders() {
  if (MEDIAMTX_USERNAME && MEDIAMTX_PASSWORD) {
    const token = Buffer.from(`${MEDIAMTX_USERNAME}:${MEDIAMTX_PASSWORD}`).toString('base64');
    return { Authorization: 'Basic ' + token };
  }
  return {};
}

class MediamtxManagerService {
  /**
   * Add a dynamic path to mediamtx sourced from an RTSP URI.
   * @param {string} pathName  - e.g. "sdplay-cam01-1708000000"
   * @param {string} rtspSource - e.g. "rtsp://admin:pass@192.168.1.10/..."
   */
  async addPath(pathName, rtspSource) {
    const url = `${MEDIAMTX_API_URL}/v3/config/paths/add/${pathName}`;
    try {
      await axios.post(url, {
        source: rtspSource,
        sourceOnDemand: false,
        record: false,
      }, {
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        timeout: 5000,
      });
      console.log(`[MediamtxMgr] ✅ Path added: ${pathName} → ${rtspSource}`);

      // Auto-remove after TTL
      const timer = setTimeout(() => this.removePath(pathName), PATH_TTL_MS);
      activeTimers.set(pathName, timer);
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Failed to add mediamtx path "${pathName}": ${msg}`);
    }
  }

  /**
   * Remove a dynamic path from mediamtx.
   * @param {string} pathName
   */
  async removePath(pathName) {
    // Clear auto-remove timer if still pending
    const timer = activeTimers.get(pathName);
    if (timer) {
      clearTimeout(timer);
      activeTimers.delete(pathName);
    }

    const url = `${MEDIAMTX_API_URL}/v3/config/paths/delete/${pathName}`;
    try {
      await axios.delete(url, {
        headers: authHeaders(),
        timeout: 5000,
      });
      console.log(`[MediamtxMgr] 🗑️  Path removed: ${pathName}`);
    } catch (err) {
      // Ignore 404 (path may have already been removed)
      if (err.response && err.response.status === 404) return;
      console.warn(`[MediamtxMgr] Failed to remove path "${pathName}":`, err.message);
    }
  }
}

module.exports = new MediamtxManagerService();
