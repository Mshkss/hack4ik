const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const enginePath = path.join(root, 'build', 'route_engine');
const routeDataPath = path.join(root, 'app_data', 'scenario.route');
const rawScenarioPath = path.join(root, 'app_data', 'pipisa_scenario.json');
const metaPath = path.join(root, 'app_data', 'scenario_meta.json');
const georefPath = path.join(root, 'app_data', 'route_graph_georef.geojson');
const surfaceZonesPath = path.join(root, 'app_data', 'surface_zones.geojson');
const webDir = path.join(root, 'web');
const engineOptions = {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  timeout: 20000,
  killSignal: 'SIGTERM'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function route(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === '/api/scenario') {
    try {
      sendJson(res, 200, {
        raw: readJson(rawScenarioPath),
        meta: readJson(metaPath),
        routeGraph: readJson(georefPath),
        surfaceZones: readJson(surfaceZonesPath)
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (url.pathname === '/api/route') {
    const args = [
      '--data', routeDataPath,
      '--start', url.searchParams.get('start') || '',
      '--finish', url.searchParams.get('finish') || '',
      '--mode', url.searchParams.get('mode') || 'быстрый',
      '--config', url.searchParams.get('config') || 'без поддува'
    ];
    const numericParams = {
      tankL: 'tank-l',
      reserveFrac: 'reserve-frac',
      baseLPerKm: 'base-l-per-km',
      dryMassKg: 'dry-mass-kg',
      payloadKg: 'payload-kg',
      hullLengthM: 'hull-length-m',
      engineHp: 'engine-hp',
      propEff: 'prop-eff',
      bsfc: 'bsfc',
      fuelDensity: 'fuel-density',
      resistanceArea: 'resistance-area',
      airDragArea: 'air-drag-area',
      displacementCd: 'displacement-cd',
      planingCd: 'planing-cd',
      surfaceMu: 'surface-mu',
      planingFroudeOn: 'planing-froude-on',
      planingFroudeFull: 'planing-froude-full',
      minPlaningSpeedKmh: 'min-planing-speed-kmh'
    };
    for (const [queryKey, engineKey] of Object.entries(numericParams)) {
      const value = url.searchParams.get(queryKey);
      if (value !== null && value !== '') args.push(`--${engineKey}`, value);
    }
    execFile(enginePath, args, engineOptions, (error, stdout, stderr) => {
      if (error && !stdout) {
        const timedOut = error.killed || error.signal === 'SIGTERM';
        sendJson(res, 200, {
          ok: false,
          route_available: false,
          error: timedOut
            ? 'Расчет маршрута занял слишком много времени. Попробуйте ближайшие точки или другой режим.'
            : `Route engine failed: ${error.message}`,
          stderr: stderr || undefined
        });
        return;
      }
      try {
        const payload = JSON.parse(stdout || '{}');
        sendJson(res, 200, error && !payload.ok ? { ...payload, route_available: false } : payload);
      } catch (parseError) {
        sendJson(res, 500, { ok: false, error: parseError.message, raw: stdout });
      }
    });
    return;
  }

  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(webDir, requested));
  if (!filePath.startsWith(webDir)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

if (!fs.existsSync(enginePath)) {
  console.error('C++ engine is missing. Run: npm run build');
  process.exit(1);
}

http.createServer(route).listen(port, host, () => {
  console.log(`Airboat navigator MVP: http://${host}:${port}`);
});
