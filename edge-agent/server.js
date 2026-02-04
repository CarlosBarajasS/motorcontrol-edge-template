const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8090;
const SITE_ID = process.env.EDGE_SITE_ID || 'unknown-site';
const LOCATION = process.env.EDGE_LOCATION || 'unknown-location';
const CLOUD_API_URL = process.env.CLOUD_API_URL || '';
const EDGE_SHARED_TOKEN = process.env.EDGE_SHARED_TOKEN || '';
const HEARTBEAT_INTERVAL_SECONDS = Number(process.env.HEARTBEAT_INTERVAL_SECONDS || 60);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    siteId: SITE_ID,
    location: LOCATION,
    timestamp: new Date().toISOString()
  });
});

async function sendHeartbeat() {
  if (!CLOUD_API_URL || !EDGE_SHARED_TOKEN) return;

  const payload = {
    siteId: SITE_ID,
    location: LOCATION,
    source: 'edge-agent',
    timestamp: new Date().toISOString()
  };

  try {
    const response = await fetch(`${CLOUD_API_URL}/edge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-edge-token': EDGE_SHARED_TOKEN
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.error('[edge-agent] heartbeat failed:', response.status);
    }
  } catch (error) {
    console.error('[edge-agent] heartbeat error:', error.message);
  }
}

setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_SECONDS * 1000);
sendHeartbeat();

app.listen(PORT, () => {
  console.log(`[edge-agent] running on port ${PORT} | site=${SITE_ID}`);
});
