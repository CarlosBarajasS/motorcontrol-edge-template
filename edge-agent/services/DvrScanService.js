// edge-agent/services/DvrScanService.js
'use strict';

const { Cam } = require('onvif');

const ONVIF_TIMEOUT_MS = 15000;

class DvrScanService {
  /**
   * Connect to an NVR/DVR via ONVIF and enumerate all channels (profiles).
   *
   * @param {object} opts
   * @param {string} opts.nvrIp
   * @param {number} opts.nvrPort   - ONVIF port (default 80)
   * @param {string} opts.nvrUser
   * @param {string} opts.nvrPassword
   * @returns {Promise<{ status: string, channels: Array, errorMessage?: string }>}
   */
  async scan({ nvrIp, nvrPort = 80, nvrUser, nvrPassword }) {
    console.log(`[DVR] 🔍 Scanning NVR at ${nvrIp}:${nvrPort} user=${nvrUser}`);

    try {
      const cam = await this._connect(nvrIp, nvrPort, nvrUser, nvrPassword);
      const profiles = await this._getProfiles(cam);

      if (!profiles.length) {
        return { status: 'error', channels: [], errorMessage: 'No ONVIF profiles found on NVR' };
      }

      const channels = [];
      for (let i = 0; i < profiles.length; i++) {
        const profile = profiles[i];
        try {
          const rtspUrl = await this._getStreamUri(cam, profile.token);
          channels.push({
            channel:    i + 1,
            rtspUrl:    rtspUrl ?? null,
            resolution: this._resolution(profile),
            fps:        profile.videoEncoderConfiguration?.rateControl?.frameRateLimit ?? null,
            codec:      profile.videoEncoderConfiguration?.encoding ?? 'H264',
          });
        } catch (err) {
          console.warn(`[DVR] ⚠️  Channel ${i + 1} (token=${profile.token}): ${err.message}`);
          channels.push({
            channel:    i + 1,
            rtspUrl:    null,
            resolution: this._resolution(profile),
            fps:        null,
            codec:      profile.videoEncoderConfiguration?.encoding ?? null,
          });
        }
      }

      console.log(`[DVR] ✅ Scan complete — ${channels.length} channel(s) found`);
      return { status: 'completed', channels };

    } catch (err) {
      console.error(`[DVR] ❌ Scan failed for ${nvrIp}:`, err.message);
      return { status: 'error', channels: [], errorMessage: err.message };
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  _connect(ip, port, username, password) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout (${ONVIF_TIMEOUT_MS}ms) to ${ip}:${port}`));
      }, ONVIF_TIMEOUT_MS);

      const cam = new Cam({ hostname: ip, port, username, password }, (err) => {
        clearTimeout(timer);
        if (err) return reject(err);
        resolve(cam);
      });
    });
  }

  _getProfiles(cam) {
    return new Promise((resolve, reject) => {
      cam.getProfiles((err, profiles) => {
        if (err) return reject(err);
        resolve(profiles || []);
      });
    });
  }

  _getStreamUri(cam, profileToken) {
    return new Promise((resolve, reject) => {
      cam.getStreamUri({ protocol: 'RTSP', profileToken }, (err, stream) => {
        if (err) return reject(err);
        resolve(stream?.uri ?? null);
      });
    });
  }

  _resolution(profile) {
    const res = profile?.videoEncoderConfiguration?.resolution;
    if (!res) return null;
    return `${res.width}x${res.height}`;
  }
}

module.exports = new DvrScanService();
