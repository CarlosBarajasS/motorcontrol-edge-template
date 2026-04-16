// edge-agent/services/OnvifDiscoveryService.js
'use strict';

const { Cam } = require('onvif');

// Ports to try when ONVIF port is unknown or fails
const FALLBACK_PORTS = [80, 8000, 8080, 2020];

class OnvifDiscoveryService {
  /**
   * Discover a single camera via ONVIF.
   * @param {string} ip
   * @param {number} port  - configured ONVIF port (tried first)
   * @param {string} user
   * @param {string} pass
   * @returns {Promise<object>} discovery result
   */
  async scan(ip, port, user, pass) {
    const portsToTry = [port, ...FALLBACK_PORTS.filter(p => p !== port)];

    for (const tryPort of portsToTry) {
      try {
        const result = await this._tryPort(ip, tryPort, user, pass);
        console.log(`[ONVIF] ✅ ${ip}:${tryPort} — ${result.brand} ${result.model}`);
        return result;
      } catch (err) {
        console.log(`[ONVIF] ⚠️  ${ip}:${tryPort} failed: ${err.message}`);
      }
    }

    console.log(`[ONVIF] ❌ ${ip} — all ports failed: ${portsToTry.join(', ')}`);
    return { status: 'onvif_failed', ip, triedPorts: portsToTry };
  }

  /**
   * Discover all cameras in a list.
   * @param {Array<{id, ip, onvifPort, onvifUser, onvifPass}>} cameras
   * @returns {Promise<Array>}
   */
  async discoverAll(cameras) {
    const results = [];
    for (const cam of cameras) {
      const result = await this.scan(
        cam.ip || cam.onvifIp,
        cam.onvifPort || 8000,
        cam.onvifUser || 'admin',
        cam.onvifPass || ''
      );
      results.push({ cameraId: cam.id, ...result });
    }
    return results;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _tryPort(ip, port, user, pass) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout on ${ip}:${port}`));
      }, 8000);

      const cam = new Cam({ hostname: ip, port, username: user, password: pass }, async (err) => {
        clearTimeout(timeout);
        if (err) return reject(err);

        try {
          const info    = await this._getDeviceInfo(cam);
          const profiles = await this._getProfiles(cam);

          // Get stream URI for each profile
          const profilesWithUri = [];
          for (const profile of profiles) {
            try {
              const uri = await this._getStreamUri(cam, profile.token);
              profilesWithUri.push({
                token:      profile.token,
                name:       profile.name,
                rtspUrl:    uri,
                resolution: profile.videoEncoderConfiguration
                  ? `${profile.videoEncoderConfiguration.resolution?.width}x${profile.videoEncoderConfiguration.resolution?.height}`
                  : null,
                fps:        profile.videoEncoderConfiguration?.rateControl?.frameRateLimit ?? null,
                codec:      profile.videoEncoderConfiguration?.encoding ?? 'H264',
              });
            } catch (e) {
              console.warn(`[ONVIF] Could not get stream URI for profile ${profile.token}:`, e.message);
            }
          }

          if (profilesWithUri.length === 0) {
            return reject(new Error('No stream URIs found in any profile'));
          }

          // Determine main stream (highest resolution) and sub stream (lowest)
          const sorted    = [...profilesWithUri].sort((a, b) => this._pixels(b) - this._pixels(a));
          const _injectCreds = (url) => {
            if (!url || !user) return url;
            try {
              const u = new URL(url);
              u.username = encodeURIComponent(user);
              u.password = encodeURIComponent(pass || '');
              return u.toString();
            } catch { return url; }
          };
          const mainStream = _injectCreds(sorted[0]?.rtspUrl ?? null);
          const subStream  = sorted.length > 1 ? _injectCreds(sorted[sorted.length - 1]?.rtspUrl) : null;
          const mainProfile = sorted[0];

          resolve({
            status:     'discovered',
            brand:      info.manufacturer ?? 'Unknown',
            model:      info.model ?? 'Unknown',
            firmware:   info.firmwareVersion ?? null,
            resolution: mainProfile?.resolution ?? null,
            fps:        mainProfile?.fps ?? null,
            profiles:   profilesWithUri,
            mainStream,
            subStream,
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  _getDeviceInfo(cam) {
    return new Promise((resolve, reject) => {
      cam.getDeviceInformation((err, info) => err ? reject(err) : resolve(info));
    });
  }

  _getProfiles(cam) {
    return new Promise((resolve, reject) => {
      cam.getProfiles((err, profiles) => err ? reject(err) : resolve(profiles || []));
    });
  }

  _getStreamUri(cam, profileToken) {
    return new Promise((resolve, reject) => {
      cam.getStreamUri(
        { protocol: 'RTSP', profileToken },
        (err, stream) => {
          if (err) return reject(err);
          resolve(stream?.uri ?? null);
        }
      );
    });
  }

  _pixels(profile) {
    if (!profile?.resolution) return 0;
    const [w, h] = profile.resolution.split('x').map(Number);
    return (w || 0) * (h || 0);
  }
}

module.exports = new OnvifDiscoveryService();
