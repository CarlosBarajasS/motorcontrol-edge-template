/**
 * Hikvision ISAPI client
 * Handles SD card recording listing and PTZ control via HTTP Digest auth.
 *
 * Requires CAMERA_{ID}_IP, CAMERA_{ID}_USER, CAMERA_{ID}_PASS env vars.
 */
const axios = require('axios');

/**
 * Build Basic auth header (Hikvision also supports Basic auth in addition to Digest).
 * For real deployments, Digest auth may be required depending on camera firmware.
 * We use Basic for simplicity; cameras can be set to allow Basic auth in their web UI.
 */
function makeAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

/**
 * Extract text content of an XML tag (simple regex, works for flat Hikvision XML).
 */
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function extractAllTags(xml, tag) {
  const results = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

/**
 * Look up camera credentials from env vars by cameraId.
 * cameraId should match what was used in the .env template:
 *   CAMERA_{ID_UPPERCASE_DASHES_TO_UNDERSCORES}_IP / _USER / _PASS
 */
function getCameraCredentials(cameraId) {
  const key = cameraId.toUpperCase().replace(/-/g, '_');
  const ip   = process.env[`CAMERA_${key}_IP`];
  const user = process.env[`CAMERA_${key}_USER`] || 'admin';
  const pass = process.env[`CAMERA_${key}_PASS`] || '';
  return { ip, user, pass };
}

class IsapiClientService {
  /**
   * List recordings on the camera SD card for a given time range.
   * @param {string} cameraId  - camera ID as stored in env (e.g. "cam-01")
   * @param {string} startTime - ISO 8601 (e.g. "2026-01-15T00:00:00Z")
   * @param {string} endTime   - ISO 8601
   * @returns {Promise<Array<{startTime, endTime, playbackUri, sizeMb}>>}
   */
  async listSdRecordings(cameraId, startTime, endTime) {
    const { ip, user, pass } = getCameraCredentials(cameraId);
    if (!ip) throw new Error(`No IP configured for camera ${cameraId}`);

    const searchId = `search-${Date.now()}`;
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>${searchId}</searchID>
  <trackIDList>
    <TrackID>
      <id>101</id>
    </TrackID>
  </trackIDList>
  <timeSpanList>
    <timeSpan>
      <startTime>${startTime}</startTime>
      <endTime>${endTime}</endTime>
    </timeSpan>
  </timeSpanList>
  <maxResults>200</maxResults>
  <searchResultPostion>0</searchResultPostion>
  <metadataList>
    <metadata>
      <Value>Metadata/Video</Value>
    </metadata>
  </metadataList>
</CMSearchDescription>`;

    const url = `http://${ip}/ISAPI/ContentMgmt/search`;
    const response = await axios.post(url, xmlBody, {
      headers: {
        'Content-Type': 'application/xml',
        Authorization: makeAuth(user, pass),
      },
      timeout: 10000,
    });

    const xml = response.data;
    const tracks = extractAllTags(xml, 'searchMatchItem');
    const results = [];

    for (const track of tracks) {
      const tStart = extractTag(track, 'startTime');
      const tEnd   = extractTag(track, 'endTime');
      const uri    = extractTag(track, 'playbackURI');
      if (tStart && tEnd && uri) {
        results.push({ startTime: tStart, endTime: tEnd, playbackUri: uri });
      }
    }

    return results;
  }

  /**
   * Send PTZ continuous move command.
   * @param {string} cameraId
   * @param {number} pan   - -100..100 (negative = left, positive = right)
   * @param {number} tilt  - -100..100 (negative = down, positive = up)
   * @param {number} zoom  - -100..100 (negative = out, positive = in)
   */
  async ptzMove(cameraId, pan, tilt, zoom) {
    const { ip, user, pass } = getCameraCredentials(cameraId);
    if (!ip) throw new Error(`No IP configured for camera ${cameraId}`);

    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
<PTZData>
  <pan>${pan}</pan>
  <tilt>${tilt}</tilt>
  <zoom>${zoom}</zoom>
</PTZData>`;

    const url = `http://${ip}/ISAPI/PTZCtrl/channels/1/continuous`;
    await axios.put(url, xmlBody, {
      headers: {
        'Content-Type': 'application/xml',
        Authorization: makeAuth(user, pass),
      },
      timeout: 5000,
    });
  }

  /**
   * Stop PTZ movement.
   */
  async ptzStop(cameraId) {
    return this.ptzMove(cameraId, 0, 0, 0);
  }

  /**
   * List PTZ presets.
   * @returns {Promise<Array<{id, name}>>}
   */
  async listPresets(cameraId) {
    const { ip, user, pass } = getCameraCredentials(cameraId);
    if (!ip) throw new Error(`No IP configured for camera ${cameraId}`);

    const url = `http://${ip}/ISAPI/PTZCtrl/channels/1/presets`;
    const response = await axios.get(url, {
      headers: { Authorization: makeAuth(user, pass) },
      timeout: 5000,
    });

    const xml = response.data;
    const presetBlocks = extractAllTags(xml, 'PTZPreset');
    return presetBlocks.map(block => ({
      id:   extractTag(block, 'id'),
      name: extractTag(block, 'presetName') || `Preset ${extractTag(block, 'id')}`,
    })).filter(p => p.id);
  }

  /**
   * Go to a PTZ preset.
   */
  async gotoPreset(cameraId, presetId) {
    const { ip, user, pass } = getCameraCredentials(cameraId);
    if (!ip) throw new Error(`No IP configured for camera ${cameraId}`);

    const url = `http://${ip}/ISAPI/PTZCtrl/channels/1/presets/${presetId}/goto`;
    await axios.put(url, '', {
      headers: { Authorization: makeAuth(user, pass) },
      timeout: 5000,
    });
  }
}

module.exports = new IsapiClientService();
