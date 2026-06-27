const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const defaultSensorMode = process.env.SENSOR_STATE_MODE || 'demo';
const demoSensorStateUrl = process.env.DEMO_SENSOR_STATE_URL
  || process.env.SENSOR_STATE_URL
  || 'http://127.0.0.1:8081/api/v1/sensor-state';
const realSensorStateUrl = process.env.REAL_SENSOR_STATE_URL
  || process.env.SENSOR_STATE_URL
  || 'http://127.0.0.1:8082/api/v1/sensor-state';
const sensorStateTimeoutMs = Number(process.env.SENSOR_STATE_TIMEOUT_MS || 900);
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
  const rawLat = searchParams.get(`${prefix}Lat`);
  const rawLon = searchParams.get(`${prefix}Lon`);
  if (rawLat === null || rawLon === null || rawLat === '' || rawLon === '') return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
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

function nearestGraphNode(meta, point) {
  let best = null;
  for (const [node, coord] of Object.entries(meta.nodeCoordinates || {})) {
    if (!coord) continue;
    const distanceKm = haversineKm(point, coord);
    if (!best || distanceKm < best.distanceKm) best = { node, coord, distanceKm };
  }
  return best;
}

function resolveRouteNode(meta, requestedNode, point) {
  if (point) {
    const nearest = nearestGraphNode(meta, point);
    if (nearest) {
      return {
        node: nearest.node,
        snapped: nearest.node !== requestedNode,
        distanceKm: nearest.distanceKm,
        coord: nearest.coord
      };
    }
  }
  if (meta.nodeCoordinates?.[requestedNode]) {
    return {
      node: requestedNode,
      snapped: false,
      distanceKm: 0,
      coord: meta.nodeCoordinates[requestedNode]
    };
  }
  return {
    node: requestedNode,
    snapped: false,
    distanceKm: 0,
    coord: null
  };
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
  if (context.blockedLegs?.length) {
    payload.blocked_legs = context.blockedLegs;
    payload.route_advice = payload.route_advice || [];
    payload.route_advice.unshift('Красный пунктир показывает направление, куда водный граф не дал проезд; дальше выбран ближайший доступный выход на берег.');
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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value, null, 2));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeSensorMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (['off', 'disabled', 'none', 'manual'].includes(mode)) return 'off';
  if (['real', 'can', 'nmea', 'nmea2000'].includes(mode)) return 'real';
  if (['demo', 'mock', 'simulator'].includes(mode)) return 'demo';
  return 'demo';
}

function sensorStateUrlForMode(mode) {
  return mode === 'real' ? realSensorStateUrl : demoSensorStateUrl;
}

function unavailableSensorState(reason, source = 'unavailable') {
  const updatedAt = new Date().toISOString();
  return {
    nmea: {
      online: false,
      source,
      last_frame_age_ms: 0,
      updated_at: updatedAt,
      error: reason || 'sensor source unavailable'
    },
    position: {
      valid: false,
      lat: null,
      lon: null,
      age_ms: 0,
      updated_at: updatedAt
    },
    motion: {
      valid: false,
      sog_mps: null,
      sog_kmh: null,
      cog_deg: null,
      heading_deg: null,
      updated_at: updatedAt
    },
    depth: {
      valid: false,
      depth_m: null,
      updated_at: updatedAt
    },
    engine: {
      rpm_valid: false,
      rpm: null,
      fuel_rate_valid: false,
      fuel_rate_lph: null,
      updated_at: updatedAt
    }
  };
}

async function fetchSensorState(modeValue) {
  const mode = normalizeSensorMode(modeValue || defaultSensorMode);
  if (mode === 'off') return unavailableSensorState('sensor mode is disabled', 'disabled');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), sensorStateTimeoutMs);
  try {
    const response = await fetch(sensorStateUrlForMode(mode), {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || `Sensor source returned HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    return unavailableSensorState(error.name === 'AbortError' ? 'sensor source timeout' : error.message, `${mode}_unavailable`);
  } finally {
    clearTimeout(timeout);
  }
}

function route(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname === '/api/v1/sensor-state') {
    (async () => {
      sendJson(res, 200, await fetchSensorState(url.searchParams.get('mode')));
    })();
    return;
  }

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
        const resolvedStart = resolveRouteNode(meta, start, startPoint);
        const resolvedFinish = resolveRouteNode(meta, finish, finishPoint);
        const context = { meta, startPoint, finishPoint };

        if (!meta.nodeCoordinates?.[resolvedStart.node]) {
          sendJson(res, 200, {
            ok: false,
            route_available: false,
            error: `Unknown start node: ${start}`,
            warnings: ['Не удалось привязать старт к текущему графу. Поставь старт на карте ближе к рабочей области.']
          });
          return;
        }
        if (!meta.nodeCoordinates?.[resolvedFinish.node]) {
          sendJson(res, 200, {
            ok: false,
            route_available: false,
            error: `Unknown finish node: ${finish}`,
            warnings: ['Не удалось привязать финиш к текущему графу. Поставь финиш на карте ближе к рабочей области.']
          });
          return;
        }

        const direct = await runEngine(url, resolvedStart.node, resolvedFinish.node);
        if (direct.ok) {
          direct.requested_start = start;
          direct.requested_finish = finish;
          direct.water_start = resolvedStart.node;
          direct.water_finish = resolvedFinish.node;
          if (resolvedStart.snapped || resolvedFinish.snapped) {
            direct.route_advice = direct.route_advice || [];
            direct.route_advice.unshift('Старт/финиш привязаны к ближайшим актуальным узлам водного графа.');
          }
          sendJson(res, 200, decorateRoute(direct, context));
          return;
        }

        const targetPoint = finishPoint || meta.nodeCoordinates?.[resolvedFinish.node];
        const canFallback = targetPoint && direct.error && direct.error.startsWith('Route is not available');
        if (!canFallback) {
          sendJson(res, 200, direct);
          return;
        }

        const reachable = reachableNodes(resolvedStart.node, config);
        const nearest = nearestReachableNode(meta, reachable, targetPoint);
        if (!nearest || nearest.node === resolvedFinish.node) {
          sendJson(res, 200, direct);
          return;
        }

        const partial = await runEngine(url, resolvedStart.node, nearest.node);
        if (!partial.ok) {
          sendJson(res, 200, direct);
          return;
        }

        partial.partial_route = true;
        partial.route_available = true;
        partial.requested_start = start;
        partial.requested_finish = finish;
        partial.water_start = resolvedStart.node;
        partial.water_finish = nearest.node;
        partial.warnings = partial.warnings || [];
        partial.warnings.unshift(`До выбранного финиша нет полного водного пути. Маршрут построен до ближайшей достижимой воды: ${nearest.node}.`);
        const requestedFinishCoord = meta.nodeCoordinates?.[resolvedFinish.node];
        const blockedLegs = requestedFinishCoord ? [{
          kind: 'blocked_water',
          label: 'Водный проезд не найден',
          from: { lat: nearest.coord.lat, lon: nearest.coord.lon },
          to: { lat: requestedFinishCoord.lat, lon: requestedFinishCoord.lon },
          from_node: nearest.node,
          to_node: resolvedFinish.node,
          distance_km: haversineKm(nearest.coord, requestedFinishCoord)
        }] : [];
        sendJson(res, 200, decorateRoute(partial, { ...context, finishPoint: targetPoint, blockedLegs }));
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
