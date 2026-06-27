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

let routeDataCache = null;

function haversineKm(a, b) {
  const radiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function parsePoint(searchParams, prefix) {
  const lat = Number(searchParams.get(`${prefix}Lat`));
  const lon = Number(searchParams.get(`${prefix}Lon`));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat,
    lon,
    label: searchParams.get(`${prefix}Label`) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  };
}

function loadRouteData() {
  const stat = fs.statSync(routeDataPath);
  if (routeDataCache?.mtimeMs === stat.mtimeMs) return routeDataCache.value;

  const value = {
    configs: new Map(),
    surfaces: new Map(),
    edges: []
  };
  const lines = fs.readFileSync(routeDataPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|');
    if (parts[0] === 'CONFIG') {
      value.configs.set(parts[1], { allowHard: parts[3] === '1' || parts[3] === 'true' });
    } else if (parts[0] === 'SURFACE') {
      value.surfaces.set(parts[1], { hard: parts[7] === '1' || parts[7] === 'true' });
    } else if (parts[0] === 'EDGE') {
      value.edges.push({ from: parts[1], to: parts[2], surface: parts[4] });
    }
  }
  routeDataCache = { mtimeMs: stat.mtimeMs, value };
  return value;
}

function reachableNodes(start, configName) {
  const data = loadRouteData();
  const config = data.configs.get(configName) || { allowHard: false };
  const graph = new Map();
  const add = (from, to) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  };
  for (const edge of data.edges) {
    const surface = data.surfaces.get(edge.surface) || { hard: false };
    if (surface.hard && !config.allowHard) continue;
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }

  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of graph.get(node) || []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

function nearestReachableNode(meta, nodes, point) {
  let best = null;
  for (const node of nodes) {
    const coord = meta.nodeCoordinates?.[node];
    if (!coord) continue;
    const distanceKm = haversineKm(point, coord);
    if (!best || distanceKm < best.distanceKm) best = { node, coord, distanceKm };
  }
  return best;
}

function engineArgsFrom(url, start, finish) {
  const args = [
    '--data', routeDataPath,
    '--start', start,
    '--finish', finish,
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
  return args;
}

function runEngine(url, start, finish) {
  return new Promise((resolve) => {
    execFile(enginePath, engineArgsFrom(url, start, finish), engineOptions, (error, stdout, stderr) => {
      if (error && !stdout) {
        const timedOut = error.killed || error.signal === 'SIGTERM';
        resolve({
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
        resolve(error && !payload.ok ? { ...payload, route_available: false } : payload);
      } catch (parseError) {
        resolve({ ok: false, error: parseError.message, raw: stdout });
      }
    });
  });
}

function accessLeg(kind, from, to, fromLabel, toLabel, node) {
  const distanceKm = haversineKm(from, to);
  return {
    kind,
    label: kind === 'start_walk' ? 'Пешком до воды' : 'Пешком от воды до точки',
    from,
    to,
    from_label: fromLabel,
    to_label: toLabel,
    from_node: kind === 'finish_walk' ? node : undefined,
    to_node: kind === 'start_walk' ? node : undefined,
    distance_km: distanceKm,
    time_min: (distanceKm / 5) * 60
  };
}

function decorateRoute(payload, context) {
  if (!payload?.ok) return payload;
  const meta = context.meta;
  const nodes = payload.route?.nodes || [];
  const firstNode = nodes[0];
  const lastNode = nodes[nodes.length - 1];
  const accessLegs = [];

  if (context.startPoint && firstNode && meta.nodeCoordinates?.[firstNode]) {
    const water = meta.nodeCoordinates[firstNode];
    const leg = accessLeg(
      'start_walk',
      { lat: context.startPoint.lat, lon: context.startPoint.lon },
      { lat: water.lat, lon: water.lon },
      context.startPoint.label || 'старт',
      `вода: ${firstNode}`,
      firstNode
    );
    if (leg.distance_km >= 0.03) accessLegs.push(leg);
  }

  if (context.finishPoint && lastNode && meta.nodeCoordinates?.[lastNode]) {
    const water = meta.nodeCoordinates[lastNode];
    const leg = accessLeg(
      'finish_walk',
      { lat: water.lat, lon: water.lon },
      { lat: context.finishPoint.lat, lon: context.finishPoint.lon },
      `вода: ${lastNode}`,
      context.finishPoint.label || 'финиш',
      lastNode
    );
    if (leg.distance_km >= 0.03) accessLegs.push(leg);
  }

  payload.access_legs = accessLegs;
  const walkDistanceKm = accessLegs.reduce((sum, leg) => sum + leg.distance_km, 0);
  const walkTimeMin = accessLegs.reduce((sum, leg) => sum + leg.time_min, 0);
  payload.totals.walk_distance_km = walkDistanceKm;
  payload.totals.walk_time_min = walkTimeMin;
  payload.totals.total_distance_with_walk_km = payload.totals.distance_km + walkDistanceKm;
  payload.totals.total_time_with_walk_min = payload.totals.time_min + walkTimeMin;
  if (accessLegs.length) {
    payload.route_advice = payload.route_advice || [];
    payload.route_advice.unshift('Часть маршрута проходит вне водного графа: она показана пешим пунктиром.');
  }
  return payload;
}

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
    (async () => {
      try {
        const meta = readJson(metaPath);
        const start = url.searchParams.get('start') || '';
        const finish = url.searchParams.get('finish') || '';
        const config = url.searchParams.get('config') || 'без поддува';
        const startPoint = parsePoint(url.searchParams, 'start');
        const finishPoint = parsePoint(url.searchParams, 'finish');
        const context = { meta, startPoint, finishPoint };

        const direct = await runEngine(url, start, finish);
        if (direct.ok) {
          sendJson(res, 200, decorateRoute(direct, context));
          return;
        }

        const targetPoint = finishPoint || meta.nodeCoordinates?.[finish];
        const canFallback = targetPoint && direct.error && direct.error.startsWith('Route is not available');
        if (!canFallback) {
          sendJson(res, 200, direct);
          return;
        }

        const reachable = reachableNodes(start, config);
        const nearest = nearestReachableNode(meta, reachable, targetPoint);
        if (!nearest || nearest.node === finish) {
          sendJson(res, 200, direct);
          return;
        }

        const partial = await runEngine(url, start, nearest.node);
        if (!partial.ok) {
          sendJson(res, 200, direct);
          return;
        }

        partial.partial_route = true;
        partial.route_available = true;
        partial.requested_finish = finish;
        partial.water_finish = nearest.node;
        partial.warnings = partial.warnings || [];
        partial.warnings.unshift(`До выбранного финиша нет полного водного пути. Маршрут построен до ближайшей достижимой воды: ${nearest.node}.`);
        sendJson(res, 200, decorateRoute(partial, { ...context, finishPoint: targetPoint }));
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error.message });
      }
    })();
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
