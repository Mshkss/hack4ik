const http = require('http');

const port = Number(process.env.PORT || 8081);
const tickMs = Number(process.env.TICK_MS || 500);
const speedMps = Number(process.env.SPEED_MPS || 8.5);

const routePoints = [
  [55.9579, 92.3811],
  [55.9630, 92.4300],
  [55.9735, 92.5000],
  [55.9860, 92.5750],
  [56.0000, 92.6500],
  [56.0120, 92.7300],
  [56.0167, 92.8050],
  [56.0106, 92.8526]
];

function toRad(value) {
  return (value * Math.PI) / 180;
}

function toDeg(value) {
  return (value * 180) / Math.PI;
}

function haversineMeters(a, b) {
  const radiusM = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.sqrt(h));
}

function bearingDeg(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function lerp(from, to, t) {
  return from + (to - from) * t;
}

const route = routePoints.map(([lat, lon]) => ({ lat, lon }));
const segments = route.slice(0, -1).map((from, index) => {
  const to = route[index + 1];
  return {
    from,
    to,
    meters: haversineMeters(from, to),
    bearing: bearingDeg(from, to)
  };
});
const routeLengthM = segments.reduce((sum, segment) => sum + segment.meters, 0);

let distanceM = 0;
let lastTickAt = Date.now();
let state = null;

function pointAtDistance(rawDistanceM) {
  let remaining = ((rawDistanceM % routeLengthM) + routeLengthM) % routeLengthM;
  for (const segment of segments) {
    if (remaining <= segment.meters) {
      const t = segment.meters > 0 ? remaining / segment.meters : 0;
      return {
        lat: lerp(segment.from.lat, segment.to.lat, t),
        lon: lerp(segment.from.lon, segment.to.lon, t),
        cogDeg: segment.bearing
      };
    }
    remaining -= segment.meters;
  }
  const last = segments[segments.length - 1];
  return { lat: last.to.lat, lon: last.to.lon, cogDeg: last.bearing };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildState(nowMs) {
  const position = pointAtDistance(distanceM);
  const phase = nowMs / 1000;
  const headingDeg = (position.cogDeg + Math.sin(phase / 4) * 2.5 + 360) % 360;
  const depthM = 5.9 + Math.sin(phase / 7) * 1.1 + Math.sin(phase / 2.7) * 0.35;
  const rpm = 2250 + Math.sin(phase / 3) * 110 + Math.cos(phase / 5) * 45;
  const fuelRateLph = 14.1 + Math.sin(phase / 4.5) * 0.9 + Math.cos(phase / 8) * 0.35;
  const updatedAt = new Date(nowMs).toISOString();

  return {
    nmea: {
      online: true,
      source: 'demo_simulator',
      last_frame_age_ms: 0,
      updated_at: updatedAt
    },
    position: {
      valid: true,
      lat: round(position.lat, 6),
      lon: round(position.lon, 6),
      age_ms: 0,
      updated_at: updatedAt
    },
    motion: {
      valid: true,
      sog_mps: round(speedMps, 2),
      sog_kmh: round(speedMps * 3.6, 1),
      cog_deg: round(position.cogDeg, 1),
      heading_deg: round(headingDeg, 1),
      updated_at: updatedAt
    },
    depth: {
      valid: true,
      depth_m: round(Math.max(0.4, depthM), 1),
      updated_at: updatedAt
    },
    engine: {
      rpm_valid: true,
      rpm: Math.round(rpm),
      fuel_rate_valid: true,
      fuel_rate_lph: round(Math.max(0, fuelRateLph), 1),
      updated_at: updatedAt
    }
  };
}

function tick() {
  const now = Date.now();
  const elapsedS = Math.max(0, (now - lastTickAt) / 1000);
  distanceM = (distanceM + speedMps * elapsedS) % routeLengthM;
  lastTickAt = now;
  state = buildState(now);
}

function currentState() {
  if (!state) tick();
  const now = Date.now();
  const ageMs = Math.max(0, now - Date.parse(state.position.updated_at));
  return {
    ...state,
    nmea: {
      ...state.nmea,
      last_frame_age_ms: ageMs
    },
    position: {
      ...state.position,
      age_ms: ageMs
    }
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/sensor-state') {
    sendJson(res, 200, currentState());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, source: 'demo_sensor_simulator' });
    return;
  }
  sendJson(res, 404, { ok: false, error: 'Not found' });
});

tick();
setInterval(tick, Math.max(100, tickMs));

server.listen(port, '127.0.0.1', () => {
  console.log(`Demo sensor simulator: http://127.0.0.1:${port}/api/v1/sensor-state`);
  console.log(`tickMs=${tickMs}, speedMps=${speedMps}, routeLengthM=${Math.round(routeLengthM)}`);
});
