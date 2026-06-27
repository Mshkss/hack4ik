const sensorModeStorageKey = 'airboat.sensorMode';

const state = {
  scenario: null,
  result: null,
  sensorState: null,
  sensorMode: 'demo',
  sensorPollTimer: null,
  compare: [],
  pickMode: null,
  compareRunId: 0,
  calculateTimer: null,
  customPoints: {
    start: null,
    finish: null
  },
  didInitialFit: false,
  map: null,
  layers: {
    base: null,
    osm: null,
    graph: null,
    route: null,
    nodes: null,
    picks: null,
    vessel: null
  }
};

const els = {
  scenarioLine: document.querySelector('#scenarioLine'),
  startSelect: document.querySelector('#startSelect'),
  finishSelect: document.querySelector('#finishSelect'),
  startQueryInput: document.querySelector('#startQueryInput'),
  finishQueryInput: document.querySelector('#finishQueryInput'),
  cityHints: document.querySelector('#cityHints'),
  pickStartBtn: document.querySelector('#pickStartBtn'),
  pickFinishBtn: document.querySelector('#pickFinishBtn'),
  useGpsStartBtn: document.querySelector('#useGpsStartBtn'),
  snapStatus: document.querySelector('#snapStatus'),
  sensorModeSelect: document.querySelector('#sensorModeSelect'),
  sensorStatus: document.querySelector('#sensorStatus'),
  sensorDetails: document.querySelector('#sensorDetails'),
  configSelect: document.querySelector('#configSelect'),
  modeSelect: document.querySelector('#modeSelect'),
  dryMassKgInput: document.querySelector('#dryMassKgInput'),
  payloadKgInput: document.querySelector('#payloadKgInput'),
  tankLInput: document.querySelector('#tankLInput'),
  reservePctInput: document.querySelector('#reservePctInput'),
  hullLengthMInput: document.querySelector('#hullLengthMInput'),
  engineHpInput: document.querySelector('#engineHpInput'),
  propEffInput: document.querySelector('#propEffInput'),
  bsfcInput: document.querySelector('#bsfcInput'),
  planingFroudeOnInput: document.querySelector('#planingFroudeOnInput'),
  planingFroudeFullInput: document.querySelector('#planingFroudeFullInput'),
  minPlaningSpeedKmhInput: document.querySelector('#minPlaningSpeedKmhInput'),
  surfaceMuInput: document.querySelector('#surfaceMuInput'),
  calculateBtn: document.querySelector('#calculateBtn'),
  realMap: document.querySelector('#realMap'),
  routeBadge: document.querySelector('#routeBadge'),
  summaryCards: document.querySelector('#summaryCards'),
  calcInputs: document.querySelector('#calcInputs'),
  surfaceLegend: document.querySelector('#surfaceLegend'),
  surfaceTable: document.querySelector('#surfaceTable'),
  warningsList: document.querySelector('#warningsList'),
  segmentsBody: document.querySelector('#segmentsBody'),
  compareBody: document.querySelector('#compareBody')
};

function fmt(value, digits = 1) {
  return Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function validSensorPosition(sensorState = state.sensorState) {
  const position = sensorState?.position;
  return Boolean(position?.valid && isFiniteNumber(position.lat) && isFiniteNumber(position.lon));
}

function sensorHeading(sensorState = state.sensorState) {
  const motion = sensorState?.motion || {};
  if (isFiniteNumber(motion.heading_deg)) return Number(motion.heading_deg);
  if (isFiniteNumber(motion.cog_deg)) return Number(motion.cog_deg);
  return null;
}

function destinationPoint(point, bearingDegValue, distanceM) {
  const bearing = toRad(bearingDegValue);
  const latRad = toRad(point.lat);
  const dLat = Math.cos(bearing) * distanceM / 111320;
  const dLon = Math.sin(bearing) * distanceM / (111320 * Math.max(0.1, Math.cos(latRad)));
  return {
    lat: point.lat + dLat,
    lon: point.lon + dLon
  };
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function normalizeSensorMode(value) {
  return ['demo', 'real', 'off'].includes(value) ? value : 'demo';
}

function sensorModeLabel(mode = state.sensorMode) {
  if (mode === 'real') return 'Real CAN/NMEA';
  if (mode === 'off') return 'отключены';
  return 'Demo simulator';
}

function loadSensorMode() {
  try {
    state.sensorMode = normalizeSensorMode(window.localStorage.getItem(sensorModeStorageKey) || 'demo');
  } catch (_) {
    state.sensorMode = 'demo';
  }
  if (els.sensorModeSelect) els.sensorModeSelect.value = state.sensorMode;
}

function saveSensorMode(mode) {
  try {
    window.localStorage.setItem(sensorModeStorageKey, mode);
  } catch (_) {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

function disabledSensorState() {
  const updatedAt = new Date().toISOString();
  return {
    nmea: {
      online: false,
      source: 'disabled',
      last_frame_age_ms: 0,
      updated_at: updatedAt
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

function listItems(items = []) {
  return items.map((item) => `<li>${item}</li>`).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formulaList(formulas = {}) {
  const labels = {
    time_segment: 'Время участка',
    froude: 'Число Froude',
    planing_threshold: 'Порог глиссирования',
    resistance: 'Сопротивление',
    power: 'Мощность',
    fuel_segment: 'Топливо участка',
    fuel_fallback: 'Страховка топлива',
    risk_segment: 'Риск участка',
    reserve_l: 'Резерв топлива',
    edge_cost: 'Стоимость ребра'
  };
  return Object.entries(formulas).map(([key, value]) => `
    <div class="formula-row">
      <dt>${labels[key] || key}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join('');
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok && !payload.ok) throw new Error(payload.error || 'Ошибка запроса');
  return payload;
}

function option(select, value, label = value) {
  if ([...select.options].some((item) => item.value === value)) return;
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  select.appendChild(item);
}

function dataOption(datalist, value) {
  if (!datalist || !value || [...datalist.options].some((item) => item.value === value)) return;
  const item = document.createElement('option');
  item.value = value;
  datalist.appendChild(item);
}

function setInput(input, value) {
  if (!input) return;
  input.value = value;
}

function numberValue(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function boatParams() {
  return {
    dryMassKg: numberValue(els.dryMassKgInput, 1450),
    payloadKg: numberValue(els.payloadKgInput, 650),
    tankL: numberValue(els.tankLInput, 370),
    reserveFrac: numberValue(els.reservePctInput, 20) / 100,
    hullLengthM: numberValue(els.hullLengthMInput, 6.9),
    engineHp: numberValue(els.engineHpInput, 280),
    propEff: numberValue(els.propEffInput, 0.58),
    bsfc: numberValue(els.bsfcInput, 305),
    planingFroudeOn: numberValue(els.planingFroudeOnInput, 0.75),
    planingFroudeFull: numberValue(els.planingFroudeFullInput, 1),
    minPlaningSpeedKmh: numberValue(els.minPlaningSpeedKmhInput, 34),
    surfaceMu: numberValue(els.surfaceMuInput, 0.105)
  };
}

function appendBoatParams(params) {
  for (const [key, value] of Object.entries(boatParams())) {
    params.set(key, String(value));
  }
}

function runCalculation() {
  calculate().catch((error) => {
    state.result = { ok: false, error: error.message };
    renderSummary();
  });
}

function scheduleCalculation(delayMs = 600) {
  window.clearTimeout(state.calculateTimer);
  state.calculateTimer = window.setTimeout(runCalculation, delayMs);
}

function tuningControls() {
  return [
    els.dryMassKgInput,
    els.payloadKgInput,
    els.tankLInput,
    els.reservePctInput,
    els.hullLengthMInput,
    els.engineHpInput,
    els.propEffInput,
    els.bsfcInput,
    els.planingFroudeOnInput,
    els.planingFroudeFullInput,
    els.minPlaningSpeedKmhInput,
    els.surfaceMuInput
  ].filter(Boolean);
}

function fillControls() {
  const { raw, meta } = state.scenario;
  els.scenarioLine.textContent = `${raw.scenario.name}. ${meta.map?.area_label || raw.scenario.area}`;

  const locations = meta.locationCatalog?.length
    ? meta.locationCatalog.map((item) => item.name)
    : (meta.pickableNodes || meta.nodes);
  for (const node of locations) {
    option(els.startSelect, node);
    option(els.finishSelect, node);
    dataOption(els.cityHints, node);
  }
  els.startSelect.value = meta.start;
  els.finishSelect.value = meta.finish;

  for (const configName of Object.keys(raw.configs)) option(els.configSelect, configName);
  for (const modeName of Object.keys(raw.modes)) option(els.modeSelect, modeName, `${modeName} · ${raw.modes[modeName].desc}`);
  els.configSelect.value = 'без поддува';
  els.modeSelect.value = 'безопасный';

  setInput(els.dryMassKgInput, raw.boat?.dry_mass_kg ?? 1450);
  setInput(els.payloadKgInput, 650);
  setInput(els.tankLInput, raw.boat?.tank_l ?? 370);
  setInput(els.reservePctInput, Math.round((raw.boat?.reserve_frac_tank ?? 0.2) * 100));
  setInput(els.hullLengthMInput, raw.boat?.length_m ?? 6.9);
  setInput(els.engineHpInput, 280);
  setInput(els.propEffInput, 0.58);
  setInput(els.bsfcInput, 305);
  setInput(els.planingFroudeOnInput, 0.75);
  setInput(els.planingFroudeFullInput, 1);
  setInput(els.minPlaningSpeedKmhInput, 34);
  setInput(els.surfaceMuInput, 0.105);
}

function edgeId(from, to) {
  return [from, to].sort().join(' -> ');
}

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

function nearestNode(latlng) {
  const { meta } = state.scenario;
  const point = { lat: latlng.lat, lon: latlng.lng };
  let best = null;
  for (const node of meta.nodes) {
    const coord = meta.nodeCoordinates[node];
    if (!coord) continue;
    const distanceKm = haversineKm(point, coord);
    if (!best || distanceKm < best.distanceKm) best = { node, coord, distanceKm };
  }
  return best;
}

function normalizeLocation(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function parseCoordinateQuery(value) {
  const match = String(value || '').trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1].replace(',', '.'));
  const lon = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lng: lon };
}

function resolveLocationQuery(rawValue, target) {
  const { meta } = state.scenario;
  const value = String(rawValue || '').trim();
  if (!value) return null;

  const coordinate = parseCoordinateQuery(value);
  if (coordinate) {
    const nearest = nearestNode(coordinate);
    if (!nearest) throw new Error(`Не нашёл водный граф рядом с точкой ${value}`);
    return {
      node: nearest.node,
      point: { lat: coordinate.lat, lon: coordinate.lng },
      label: value,
      source: 'coordinates',
      distanceKm: nearest.distanceKm
    };
  }

  const normalized = normalizeLocation(value);
  const catalogItem = (meta.locationCatalog || []).find((item) => normalizeLocation(item.name) === normalized);
  if (catalogItem) {
    const nearest = nearestNode({ lat: catalogItem.lat, lng: catalogItem.lon });
    if (!nearest) throw new Error(`Не нашёл водный граф рядом с точкой ${catalogItem.name}`);
    return {
      node: nearest.node,
      point: { lat: catalogItem.lat, lon: catalogItem.lon },
      label: catalogItem.name,
      source: 'catalog',
      distanceKm: nearest.distanceKm
    };
  }

  const exactNode = meta.nodes.find((node) => normalizeLocation(node) === normalized);
  if (exactNode) {
    const coord = meta.nodeCoordinates[exactNode];
    return {
      node: exactNode,
      point: coord ? { lat: coord.lat, lon: coord.lon } : null,
      label: exactNode,
      source: 'node',
      distanceKm: 0
    };
  }

  const candidates = meta.nodes
    .map((node) => {
      const nodeText = normalizeLocation(node);
      const sourceText = normalizeLocation(meta.nodeCoordinates[node]?.source || '');
      const score = nodeText === normalized ? 0
        : nodeText.startsWith(normalized) ? 1
          : nodeText.includes(normalized) ? 2
            : sourceText.includes(normalized) ? 3
              : 99;
      return { node, score };
    })
    .filter((item) => item.score < 99)
    .sort((a, b) => a.score - b.score || a.node.localeCompare(b.node, 'ru'));

  if (!candidates.length) {
    throw new Error(`${target === 'start' ? 'Старт' : 'Финиш'} не найден. Напиши известную точку из списка или координаты: 55.99, 92.86`);
  }

  const node = candidates[0].node;
  const coord = meta.nodeCoordinates[node];
  return {
    node,
    point: coord ? { lat: coord.lat, lon: coord.lon } : null,
    label: node,
    source: 'name',
    distanceKm: 0
  };
}

function pointPayload(target, resolved) {
  if (!resolved?.point) return null;
  const coord = state.scenario.meta.nodeCoordinates[resolved.node];
  const distanceKm = coord ? haversineKm(resolved.point, coord) : resolved.distanceKm;
  return {
    lat: resolved.point.lat,
    lon: resolved.point.lon,
    label: resolved.label,
    source: resolved.source,
    snappedNode: resolved.node,
    snappedDistanceKm: distanceKm
  };
}

function resolveEndpoint(target) {
  const select = target === 'start' ? els.startSelect : els.finishSelect;
  const input = target === 'start' ? els.startQueryInput : els.finishQueryInput;
  const query = input?.value?.trim();
  if (query) {
    const resolved = resolveLocationQuery(query, target);
    option(select, resolved.node, resolved.source === 'coordinates' ? `ближайшая вода ${resolved.node}` : resolved.node);
    select.value = resolved.node;
    state.customPoints[target] = resolved.source === 'node' ? null : pointPayload(target, resolved);
    return { node: resolved.node, point: resolved.point, label: resolved.label, source: resolved.source };
  }

  const node = select.value;
  if (!state.customPoints[target] || state.customPoints[target].snappedNode !== node) {
    state.customPoints[target] = null;
  }
  return {
    node,
    point: state.customPoints[target] ? { lat: state.customPoints[target].lat, lon: state.customPoints[target].lon } : null,
    label: state.customPoints[target]?.label || node,
    source: state.customPoints[target]?.source || 'node'
  };
}

function buildRouteParams(config = els.configSelect.value, mode = els.modeSelect.value) {
  const start = resolveEndpoint('start');
  const finish = resolveEndpoint('finish');
  const params = new URLSearchParams({
    start: start.node,
    finish: finish.node,
    config,
    mode
  });
  if (start.point) {
    params.set('startLat', String(start.point.lat));
    params.set('startLon', String(start.point.lon));
    params.set('startLabel', start.label);
  }
  if (finish.point) {
    params.set('finishLat', String(finish.point.lat));
    params.set('finishLon', String(finish.point.lon));
    params.set('finishLabel', finish.label);
  }
  appendBoatParams(params);
  return params;
}

function setPickMode(mode) {
  state.pickMode = state.pickMode === mode ? null : mode;
  els.pickStartBtn.classList.toggle('active', state.pickMode === 'start');
  els.pickFinishBtn.classList.toggle('active', state.pickMode === 'finish');
  if (state.pickMode) {
    els.snapStatus.textContent = state.pickMode === 'start'
      ? 'Кликни по карте: поставим старт и привяжем к ближайшему узлу графа.'
      : 'Кликни по карте: поставим финиш и привяжем к ближайшему узлу графа.';
  } else {
    els.snapStatus.textContent = 'Клик по карте привязывает точку к ближайшему узлу графа.';
  }
}

async function applyMapPick(latlng) {
  const target = state.pickMode || (!state.customPoints.start ? 'start' : 'finish');
  const nearest = nearestNode(latlng);
  if (!nearest) return;
  state.customPoints[target] = {
    lat: latlng.lat,
    lon: latlng.lng,
    label: `${fmt(latlng.lat, 5)}, ${fmt(latlng.lng, 5)}`,
    source: 'map',
    snappedNode: nearest.node,
    snappedDistanceKm: nearest.distanceKm
  };
  const queryInput = target === 'start' ? els.startQueryInput : els.finishQueryInput;
  if (queryInput) queryInput.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  if (target === 'start') els.startSelect.value = nearest.node;
  if (target === 'finish') els.finishSelect.value = nearest.node;
  option(target === 'start' ? els.startSelect : els.finishSelect, nearest.node, `точка графа ${nearest.node}`);
  if (target === 'start') els.startSelect.value = nearest.node;
  if (target === 'finish') els.finishSelect.value = nearest.node;
  setPickMode(null);
  els.snapStatus.innerHTML = `
    <span class="snap-line">${target === 'start' ? 'Старт' : 'Финиш'}: поставлена точка ${fmt(latlng.lat, 5)}, ${fmt(latlng.lng, 5)}<br>
    Привязка к графу: ${nearest.node}, расстояние ${fmt(nearest.distanceKm, 2)} км.</span>
  `;
  drawMap();
  await calculate();
}

async function applySensorStart() {
  if (state.sensorMode === 'off') {
    els.snapStatus.textContent = 'Датчики отключены. Включи Demo simulator или Real CAN/NMEA, чтобы взять старт из GPS.';
    return;
  }
  if (!validSensorPosition()) {
    els.snapStatus.textContent = 'Нет актуальной позиции судна.';
    return;
  }
  const position = state.sensorState.position;
  const latlng = { lat: Number(position.lat), lng: Number(position.lon) };
  const nearest = nearestNode(latlng);
  if (!nearest) {
    els.snapStatus.textContent = 'Не нашёл водный граф рядом с текущей позицией судна.';
    return;
  }

  state.customPoints.start = {
    lat: latlng.lat,
    lon: latlng.lng,
    label: `GPS ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`,
    source: 'sensor',
    snappedNode: nearest.node,
    snappedDistanceKm: nearest.distanceKm
  };
  option(els.startSelect, nearest.node, `GPS: ближайшая вода ${nearest.node}`);
  els.startSelect.value = nearest.node;
  if (els.startQueryInput) els.startQueryInput.value = `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
  setPickMode(null);
  els.snapStatus.innerHTML = `
    <span class="snap-line">Старт взят из GPS: ${fmt(latlng.lat, 5)}, ${fmt(latlng.lng, 5)}<br>
    Привязка к графу: ${nearest.node}, расстояние ${fmt(nearest.distanceKm, 2)} км.</span>
  `;
  drawMap();
  await calculate();
}

function renderSensorState() {
  if (state.sensorMode === 'off') {
    if (els.sensorStatus) {
      els.sensorStatus.textContent = 'Датчики: отключены';
      els.sensorStatus.classList.remove('sensor-online', 'sensor-offline');
      els.sensorStatus.classList.add('sensor-disabled');
    }
    if (els.useGpsStartBtn) {
      els.useGpsStartBtn.disabled = true;
    }
    if (els.sensorDetails) {
      els.sensorDetails.textContent = 'Ручной режим: датчики не используются.';
    }
    return;
  }

  const sensor = state.sensorState;
  const online = Boolean(sensor?.nmea?.online);
  const hasPosition = validSensorPosition(sensor);
  const source = sensor?.nmea?.source || 'нет источника';
  const speed = sensor?.motion?.valid && isFiniteNumber(sensor.motion.sog_kmh)
    ? `${fmt(sensor.motion.sog_kmh, 1)} км/ч`
    : 'нет скорости';

  if (els.sensorStatus) {
    els.sensorStatus.textContent = online
      ? `Датчики ${sensorModeLabel()}: ${source}${hasPosition ? ` · ${speed}` : ''}`
      : `Датчики ${sensorModeLabel()}: нет данных`;
    els.sensorStatus.classList.remove('sensor-disabled');
    els.sensorStatus.classList.toggle('sensor-online', online && hasPosition);
    els.sensorStatus.classList.toggle('sensor-offline', !online || !hasPosition);
  }

  if (els.useGpsStartBtn) {
    els.useGpsStartBtn.disabled = !hasPosition;
  }

  if (!els.sensorDetails) return;
  if (!hasPosition) {
    els.sensorDetails.textContent = 'Нет актуальной позиции судна.';
    return;
  }

  const heading = sensorHeading(sensor);
  const depth = sensor.depth?.valid && isFiniteNumber(sensor.depth.depth_m)
    ? ` · глубина ${fmt(sensor.depth.depth_m, 1)} м`
    : '';
  const rpm = sensor.engine?.rpm_valid && isFiniteNumber(sensor.engine.rpm)
    ? ` · ${fmt(sensor.engine.rpm, 0)} об/мин`
    : '';
  els.sensorDetails.textContent = [
    `Позиция: ${fmt(sensor.position.lat, 5)}, ${fmt(sensor.position.lon, 5)}`,
    heading === null ? null : `курс ${fmt(heading, 0)}°`,
    speed
  ].filter(Boolean).join(' · ') + depth + rpm;
}

async function updateSensorState() {
  if (state.sensorMode === 'off') {
    state.sensorState = disabledSensorState();
    renderSensorState();
    drawVessel();
    return;
  }

  const requestMode = state.sensorMode;
  try {
    const params = new URLSearchParams({ mode: requestMode });
    const payload = await fetchJson(`/api/v1/sensor-state?${params}`);
    if (requestMode !== state.sensorMode) return;
    state.sensorState = payload;
  } catch (error) {
    if (requestMode !== state.sensorMode) return;
    const updatedAt = new Date().toISOString();
    state.sensorState = {
      nmea: { online: false, source: 'web_error', last_frame_age_ms: 0, updated_at: updatedAt, error: error.message },
      position: { valid: false, lat: null, lon: null, age_ms: 0, updated_at: updatedAt },
      motion: { valid: false, sog_mps: null, sog_kmh: null, cog_deg: null, heading_deg: null, updated_at: updatedAt },
      depth: { valid: false, depth_m: null, updated_at: updatedAt },
      engine: { rpm_valid: false, rpm: null, fuel_rate_valid: false, fuel_rate_lph: null, updated_at: updatedAt }
    };
  }
  renderSensorState();
  drawVessel();
}

function startSensorPolling() {
  if (state.sensorMode === 'off') {
    stopSensorPolling();
    updateSensorState();
    return;
  }
  if (state.sensorPollTimer) return;
  updateSensorState();
  state.sensorPollTimer = window.setInterval(updateSensorState, 750);
}

function stopSensorPolling() {
  if (!state.sensorPollTimer) return;
  window.clearInterval(state.sensorPollTimer);
  state.sensorPollTimer = null;
}

function setSensorMode(mode) {
  state.sensorMode = normalizeSensorMode(mode);
  if (els.sensorModeSelect) els.sensorModeSelect.value = state.sensorMode;
  saveSensorMode(state.sensorMode);
  stopSensorPolling();
  state.sensorState = state.sensorMode === 'off' ? disabledSensorState() : null;
  renderSensorState();
  drawVessel();
  startSensorPolling();
}

function surfaceColor(surface, active = false) {
  const palette = {
    water: '#168aad',
    ice: '#6ab7d6',
    shallow: '#d98c34',
    grass: '#6f9e3f',
    slush: '#6a8f9d',
    rocks: '#a44a3f',
    marsh: '#6b5f2a'
  };
  return active ? '#d6653b' : palette[surface] || '#66736f';
}

function renderSurfaceLegend() {
  const { raw, meta } = state.scenario;
  const stats = meta.surfaceStats || {};
  els.surfaceLegend.innerHTML = Object.entries(raw.surfaces).map(([id, surface]) => {
    const stat = stats[id] || { edge_count: 0 };
    return `
      <span class="legend-item">
        <span class="legend-dot" style="background:${surfaceColor(id)}"></span>
        ${surface.label} · ${stat.edge_count}
      </span>
    `;
  }).join('');
}

function renderSurfaceTable() {
  const { raw, meta } = state.scenario;
  const stats = meta.surfaceStats || {};
  els.surfaceTable.innerHTML = Object.entries(raw.surfaces).map(([id, surface]) => {
    const stat = stats[id] || { edge_count: 0, total_km: 0 };
    return `
      <div class="surface-row">
        <span class="legend-dot" style="background:${surfaceColor(id)}"></span>
        <div>
          <b>${surface.label}</b>
          <small>spd=${surface.spd} км/ч · k_surf=${fmt(surface.k_surf, 2)} · risk=${surface.risk} · ${surface.planing ? 'глиссирование' : 'без глиссирования'}${surface.hard ? ' · hard' : ''}</small>
        </div>
        <span>${stat.edge_count} реб. / ${fmt(stat.total_km)} км</span>
      </div>
    `;
  }).join('');
}

function humanError(error) {
  if (!error) return 'Маршрут не рассчитан';
  if (error.startsWith('Unknown start node')) {
    return 'Стартовая точка больше не входит в текущий граф. Обнови страницу или поставь старт заново на карте.';
  }
  if (error.startsWith('Unknown finish node')) {
    return 'Финишная точка больше не входит в текущий граф. Обнови страницу или поставь финиш заново на карте.';
  }
  if (error.startsWith('Route is not available')) {
    return 'Маршрут недоступен для выбранных точек и конфигурации. Вероятно, точки находятся в разных водных зонах или разделены непроходимым участком, например КрасГЭС.';
  }
  return error;
}

function initMap() {
  const { meta } = state.scenario;
  if (!window.L) {
    els.realMap.innerHTML = '<div class="map-error">Не удалось загрузить Leaflet. Проверь подключение к сети для картографической библиотеки.</div>';
    return;
  }
  if (state.map) return;

  state.map = L.map(els.realMap, {
    zoomControl: true,
    scrollWheelZoom: true,
    zoomSnap: 0.25,
    preferCanvas: true,
    attributionControl: false
  });

  state.layers.osm = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    subdomains: 'abcd',
    tileSize: 256,
    updateWhenIdle: true,
    keepBuffer: 4,
    opacity: 0.62
  }).addTo(state.map);

  state.layers.base = L.layerGroup().addTo(state.map);
  state.layers.graph = L.layerGroup().addTo(state.map);
  state.layers.route = L.layerGroup().addTo(state.map);
  state.layers.nodes = L.layerGroup().addTo(state.map);
  state.layers.picks = L.layerGroup().addTo(state.map);
  state.layers.vessel = L.layerGroup().addTo(state.map);
  state.map.on('click', (event) => {
    applyMapPick(event.latlng).catch((error) => {
      state.result = { ok: false, error: error.message };
      renderSummary();
    });
  });
  state.map.on('zoomend', () => drawMap());
  drawLocalBaseMap();
  state.map.fitBounds(meta.map.bounds, { padding: [24, 24], animate: false });
  state.didInitialFit = true;
  setTimeout(() => state.map.invalidateSize(), 80);
  setTimeout(() => state.map.invalidateSize(), 350);
}

function drawLocalBaseMap() {
  const { meta, surfaceZones } = state.scenario;
  state.layers.base.clearLayers();

  for (const zone of surfaceZones.features || []) {
    const surface = zone.properties.surface;
    const coords = zone.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
    L.polygon(coords, {
      color: surfaceColor(surface),
      fillColor: surfaceColor(surface),
      fillOpacity: surface === 'ice' ? 0.28 : 0.42,
      weight: 2,
      interactive: true
    })
      .bindTooltip(`${zone.properties.label}<br>surface=${surface}`, { sticky: true })
      .addTo(state.layers.base);
  }

  L.control.scale({ imperial: false }).addTo(state.map);
}

function drawMap() {
  const { raw, meta } = state.scenario;
  if (!state.map) initMap();
  if (!state.map) return;

  state.layers.graph.clearLayers();
  state.layers.route.clearLayers();
  state.layers.nodes.clearLayers();
  state.layers.picks.clearLayers();

  const activeEdges = new Set((state.result?.route?.segments || []).map((segment) => edgeId(segment.from, segment.to)));
  const activeNodes = new Set(state.result?.route?.nodes || []);

  for (const edge of meta.edges) {
    const from = meta.nodeCoordinates[edge.from];
    const to = meta.nodeCoordinates[edge.to];
    const surface = raw.surfaces[edge.surface];
    if (!from || !to || !surface) continue;
    const isActive = activeEdges.has(edgeId(edge.from, edge.to));
    const layer = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color: surfaceColor(edge.surface, isActive),
      weight: isActive ? 4.5 : 0.8,
      opacity: isActive ? 0.92 : 0.22,
      dashArray: surface.hard ? '10 8' : null
    });
    layer.bindTooltip(`${edge.from} → ${edge.to}<br>${edge.km} км · ${surface.label}<br>risk=${surface.risk}, k_surf=${surface.k_surf}`, {
      sticky: true
    });
    layer.addTo(isActive ? state.layers.route : state.layers.graph);
  }

  for (const node of meta.nodes) {
    const coord = meta.nodeCoordinates[node];
    if (!coord) continue;
    const isAnchor = (meta.pickableNodes || []).includes(node);
    const isActive = activeNodes.has(node);
    const showDenseNodes = state.map.getZoom() >= 12;
    if (!isAnchor && !isActive && !showDenseNodes) continue;
    const radius = isAnchor ? (isActive ? 4.4 : 3.8) : (isActive ? 1.15 : 0.45);
    const marker = L.circleMarker([coord.lat, coord.lon], {
      radius,
      color: isActive ? '#d6653b' : '#0d7772',
      fillColor: isActive ? '#f6d9c9' : (isAnchor ? '#ffffff' : '#0d7772'),
      fillOpacity: isAnchor || isActive ? 0.95 : 0.22,
      opacity: isAnchor || isActive ? 0.95 : 0.28,
      weight: isActive ? 1.6 : (isAnchor ? 2 : 0)
    });
    if (isAnchor || isActive) {
      marker.bindTooltip(`${node}<br>${coord.source}`, { permanent: false, sticky: true });
    }
    marker.addTo(state.layers.nodes);
  }

  drawPickMarkers();
  drawAccessLegs();
  drawBlockedLegs();
  drawVessel();

  if (state.result?.ok) {
    const bounds = state.result.route.nodes
      .map((node) => meta.nodeCoordinates[node])
      .filter(Boolean)
      .map((coord) => [coord.lat, coord.lon]);
    if (bounds.length > 1 && !state.didInitialFit) {
      state.map.fitBounds(bounds, { padding: [36, 36], animate: false });
      state.didInitialFit = true;
    }
  }
}

function drawAccessLegs() {
  const legs = state.result?.access_legs || [];
  for (const leg of legs) {
    if (!leg.from || !leg.to || leg.distance_km < 0.01) continue;
    const color = leg.kind === 'start_walk' ? '#0d7772' : '#d6653b';
    L.polyline([[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]], {
      color,
      weight: 3,
      opacity: 0.9,
      dashArray: '2 8'
    })
      .bindTooltip(`${leg.label}<br>${fmt(leg.distance_km, 2)} км пешком`)
      .addTo(state.layers.picks);
  }
}

function drawBlockedLegs() {
  const legs = state.result?.blocked_legs || [];
  for (const leg of legs) {
    if (!leg.from || !leg.to || leg.distance_km < 0.01) continue;
    L.polyline([[leg.from.lat, leg.from.lon], [leg.to.lat, leg.to.lon]], {
      color: '#bd4d35',
      weight: 3,
      opacity: 0.85,
      dashArray: '10 8'
    })
      .bindTooltip(`${leg.label}<br>${fmt(leg.distance_km, 2)} км: водный проезд не найден`)
      .addTo(state.layers.picks);
  }
}

function drawVessel() {
  if (!state.map || !state.layers.vessel) return;
  state.layers.vessel.clearLayers();
  if (!validSensorPosition()) return;

  const sensor = state.sensorState;
  const point = {
    lat: Number(sensor.position.lat),
    lon: Number(sensor.position.lon)
  };
  const heading = sensorHeading(sensor);
  const rotation = heading === null ? 0 : heading;
  const marker = L.marker([point.lat, point.lon], {
    icon: L.divIcon({
      className: 'vessel-marker',
      html: `<div class="vessel-icon" style="transform: rotate(${rotation}deg)"></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    }),
    zIndexOffset: 1000
  });

  const speed = sensor.motion?.valid && isFiniteNumber(sensor.motion.sog_kmh)
    ? `${fmt(sensor.motion.sog_kmh, 1)} км/ч`
    : 'скорость неизвестна';
  marker.bindTooltip(`Текущее положение судна<br>${fmt(point.lat, 5)}, ${fmt(point.lon, 5)}<br>${speed}`, {
    sticky: true
  });
  marker.addTo(state.layers.vessel);

  if (heading !== null) {
    const ahead = destinationPoint(point, heading, 220);
    L.polyline([[point.lat, point.lon], [ahead.lat, ahead.lon]], {
      color: '#0d7772',
      weight: 3,
      opacity: 0.86
    }).addTo(state.layers.vessel);
  }
}

function drawPickMarkers() {
  const { meta } = state.scenario;
  for (const [target, pick] of Object.entries(state.customPoints)) {
    if (!pick) continue;
    const snap = meta.nodeCoordinates[pick.snappedNode];
    const color = target === 'start' ? '#0d7772' : '#d6653b';
    L.circleMarker([pick.lat, pick.lon], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2
    })
      .bindTooltip(`${target === 'start' ? 'Пользовательский старт' : 'Пользовательский финиш'}<br>Привязано к: ${pick.snappedNode}`)
      .addTo(state.layers.picks);
    if (snap) {
      L.polyline([[pick.lat, pick.lon], [snap.lat, snap.lon]], {
        color,
        weight: 2,
        opacity: 0.75,
        dashArray: '4 6'
      }).addTo(state.layers.picks);
    }
  }
}

function renderSummary() {
  const result = state.result;
  if (!result?.ok) {
    const message = humanError(result?.error);
    els.routeBadge.textContent = message;
    els.summaryCards.innerHTML = '';
    els.calcInputs.innerHTML = '';
    els.segmentsBody.innerHTML = '';
    els.warningsList.innerHTML = `<li>${message}</li>`;
    return;
  }

  const totals = result.totals;
  const walkDistanceKm = (result.access_legs || []).reduce((sum, leg) => sum + (leg.distance_km || 0), 0);
  const routeNodes = result.route.nodes;
  const routeLabel = routeNodes.length > 6
    ? `${routeNodes[0]} → ${routeNodes[routeNodes.length - 1]} · ${result.route.segments.length} сегм.`
    : routeNodes.join(' → ');
  els.routeBadge.textContent = routeLabel;
  const metrics = [
    ['Длина', `${fmt(totals.distance_km)} км`],
    ['Пешком', `${fmt(walkDistanceKm)} км`],
    ['Время', `${fmt(totals.time_min, 0)} мин`],
    ['Топливо', `${fmt(totals.fuel_l)} л`],
    ['Остаток', `${fmt(totals.remainder_l)} л`],
    ['Риск', fmt(totals.risk_points)],
    ['Резерв', `${fmt(totals.reserve_l)} л`]
  ];
  els.summaryCards.innerHTML = metrics.map(([label, value]) => `
    <div class="metric"><span>${label}</span><strong>${value}</strong></div>
  `).join('');

  const routeAdvice = result.route_advice || [];
  const accessAdvice = (result.access_legs || []).map((leg) => `${leg.label}: ${fmt(leg.distance_km, 2)} км пешком.`);
  const blockedAdvice = (result.blocked_legs || []).map((leg) => `${leg.label}: ${fmt(leg.distance_km, 2)} км по воде не строится.`);
  els.warningsList.innerHTML = listItems([...result.warnings, ...blockedAdvice, ...accessAdvice, ...routeAdvice.slice(0, 5)]);
  renderCalculationInputs(result);
  els.segmentsBody.innerHTML = result.route.segments.map((segment) => `
    <tr>
      <td>${segment.from}</td>
      <td>${segment.to}</td>
      <td>${segment.surface_label}</td>
      <td>${fmt(segment.km)}</td>
      <td>${fmt(segment.time_h * 60, 0)}</td>
      <td>${fmt(segment.fuel_l)}</td>
      <td>${fmt(segment.risk_points)}</td>
      <td class="used-values">
        расчёт ${fmt(segment.speed_kmh, 0)} → рек. ${fmt(segment.recommended_speed_kmh || segment.speed_kmh, 0)} км/ч<br>
        темп: <b>${segment.pace_label || 'умеренно'}</b> · ${segment.motion_label || (segment.planing ? 'глиссирование' : 'водоизмещающий режим')}<br>
        Fn=${fmt(segment.froude, 2)} · P=${fmt(segment.power_kw, 0)} кВт · ${fmt(segment.fuel_l_h, 1)} л/ч<br>
        R=${fmt(segment.resistance_n, 0)} Н · ${fmt(segment.fuel_l_per_km, 2)} л/км<br>
        k_surf=${fmt(segment.k_surf, 2)} · risk=${fmt(segment.surface_risk, 0)}<br>
        ${segment.narrow_waterway ? '<span class="tag slow">узкая река</span>' : ''}
        ${segment.cavitation_risk && segment.cavitation_risk !== 'low' ? `<span class="tag warn">кавитация/срыв: ${segment.cavitation_label}</span>` : ''}
        ${segment.hard ? '<span class="tag warn">сложно</span>' : ''}
        <small>${(segment.speed_notes || []).slice(0, 2).join('; ')}</small>
      </td>
    </tr>
  `).join('') + (result.blocked_legs || []).map((leg) => `
    <tr class="blocked-row">
      <td>${escapeHtml(leg.from_node || 'доступная вода')}</td>
      <td>${escapeHtml(leg.to_node || 'выбранная точка')}</td>
      <td>водный проезд не найден</td>
      <td>${fmt(leg.distance_km)}</td>
      <td>-</td>
      <td>-</td>
      <td>-</td>
      <td class="used-values">Этот участок показан красным пунктиром: по текущему графу аэролодка туда не проходит.</td>
    </tr>
  `).join('') + (result.access_legs || []).map((leg) => `
    <tr class="walk-row">
      <td>${escapeHtml(leg.from_label || leg.from_node || 'точка')}</td>
      <td>${escapeHtml(leg.to_label || leg.to_node || 'точка')}</td>
      <td>пеший добор</td>
      <td>${fmt(leg.distance_km)}</td>
      <td>${fmt(leg.time_min, 0)}</td>
      <td>0,0</td>
      <td>0,0</td>
      <td class="used-values">Аэролодка идёт до ближайшей достижимой воды, дальше участок показан пунктиром.</td>
    </tr>
  `).join('');
}

function renderCalculationInputs(result) {
  const inputs = result.calculation_inputs;
  if (!inputs) {
    els.calcInputs.innerHTML = '<p class="subtle">Детали расчёта не пришли от движка.</p>';
    return;
  }
  els.calcInputs.innerHTML = `
    <div class="calc-box">
      <b>Лодка</b>
      <p>Raptor 650 · масса ${fmt(inputs.boat.total_mass_kg, 0)} кг · бак ${fmt(inputs.boat.tank_l, 0)} л · резерв ${fmt(inputs.boat.reserve_frac_tank * 100, 0)}%<br>
      корпус ${fmt(inputs.boat.hull_length_m, 1)} м · двигатель ${fmt(inputs.boat.max_engine_hp, 0)} л.с. · КПД ${fmt(inputs.boat.propulsive_efficiency, 2)} · BSFC ${fmt(inputs.boat.bsfc_g_per_kwh, 0)} г/кВт·ч</p>
    </div>
    <div class="calc-box">
      <b>Глиссирование</b>
      <p>Порог расчёта ${fmt(inputs.boat.planing_threshold_kmh, 0)} км/ч · Fn перехода ${fmt(inputs.boat.planing_froude_on, 2)} · Fn глиссирования ${fmt(inputs.boat.planing_froude_full, 2)}<br>
      Cd водоизм. ${fmt(inputs.boat.displacement_cd, 2)} · Cd глисс. ${fmt(inputs.boat.planing_cd, 2)} · μ поверхности ${fmt(inputs.boat.surface_mu, 3)}</p>
    </div>
    <div class="calc-box">
      <b>Конфигурация</b>
      <p>${inputs.config.name} · k_load=${fmt(inputs.config.k_load, 2)} · сложные участки ${inputs.config.allow_hard ? 'разрешены' : 'запрещены'}</p>
    </div>
    <div class="calc-box">
      <b>Режим</b>
      <p>${inputs.mode.name} · цель: ${inputs.mode.objective} · k_mode=${fmt(inputs.mode.k_mode, 2)}<br>${inputs.mode.desc}</p>
    </div>
    <div class="calc-box">
      <b>Формулы</b>
      <dl class="formula-list">${formulaList(inputs.formulas)}</dl>
    </div>
    <div class="calc-box">
      <b>Скорость и режим движения</b>
      <p>${inputs.speed_policy?.base || 'Скорость корректируется под выбранный режим.'}<br>
      ${inputs.speed_policy?.narrow_waterway || 'На узких участках скорость снижается.'}<br>
      ${inputs.speed_policy?.motion_states || 'Режим движения выбирается по поверхности и риску.'}</p>
    </div>
    ${(result.route_advice || []).length ? `
      <div class="calc-box">
        <b>Рекомендации по маршруту</b>
        <ul>${listItems((result.route_advice || []).slice(0, 4))}</ul>
      </div>
    ` : ''}
  `;
}

async function calculate() {
  els.calculateBtn.disabled = true;
  els.calculateBtn.textContent = 'Считаю маршрут...';
  try {
    const params = buildRouteParams();
    state.result = await fetchJson(`/api/route?${params}`);
    renderSummary();
    drawMap();
    compareAll().catch((error) => {
      els.compareBody.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
    });
  } finally {
    els.calculateBtn.disabled = false;
    els.calculateBtn.textContent = 'Рассчитать маршрут';
  }
}

async function compareAll() {
  const runId = ++state.compareRunId;
  const { raw } = state.scenario;
  const rows = [];
  els.compareBody.innerHTML = '<tr><td colspan="7">Сравниваю режимы...</td></tr>';
  for (const config of Object.keys(raw.configs)) {
    for (const mode of Object.keys(raw.modes)) {
      if (runId !== state.compareRunId) return;
      const params = buildRouteParams(config, mode);
      const result = await fetchJson(`/api/route?${params}`);
      rows.push({ config, mode, result });
    }
  }
  if (runId !== state.compareRunId) return;
  state.compare = rows;
  els.compareBody.innerHTML = rows.map(({ config, mode, result }) => {
    if (!result.ok) {
      return `<tr><td>${config}</td><td>${mode}</td><td colspan="5">${humanError(result.error)}</td></tr>`;
    }
    return `
      <tr>
        <td>${config}</td>
        <td>${mode}</td>
        <td class="route-path">${result.route.nodes.join(' → ')}</td>
        <td>${fmt(result.totals.distance_km)}</td>
        <td>${fmt(result.totals.time_min, 0)}</td>
        <td>${fmt(result.totals.fuel_l)}</td>
        <td>${fmt(result.totals.risk_points)}</td>
      </tr>
    `;
  }).join('');
}

async function init() {
  loadSensorMode();
  state.scenario = await fetchJson('/api/scenario');
  fillControls();
  renderSurfaceLegend();
  renderSurfaceTable();
  initMap();
  drawMap();
  startSensorPolling();
  await calculate();
}

els.calculateBtn.addEventListener('click', () => {
  runCalculation();
});

els.pickStartBtn.addEventListener('click', () => setPickMode('start'));
els.pickFinishBtn.addEventListener('click', () => setPickMode('finish'));
if (els.sensorModeSelect) {
  els.sensorModeSelect.addEventListener('change', () => {
    setSensorMode(els.sensorModeSelect.value);
  });
}
els.useGpsStartBtn.addEventListener('click', () => {
  applySensorStart().catch((error) => {
    state.result = { ok: false, error: error.message };
    renderSummary();
  });
});

for (const control of [
  els.configSelect,
  els.modeSelect,
  els.dryMassKgInput,
  els.payloadKgInput,
  els.tankLInput,
  els.reservePctInput,
  els.hullLengthMInput,
  els.engineHpInput,
  els.propEffInput,
  els.bsfcInput,
  els.planingFroudeOnInput,
  els.planingFroudeFullInput,
  els.minPlaningSpeedKmhInput,
  els.surfaceMuInput
]) {
  if (!control) continue;
  control.addEventListener('change', () => {
    runCalculation();
  });
}

els.startSelect.addEventListener('change', () => {
  if (els.startQueryInput) els.startQueryInput.value = '';
  state.customPoints.start = null;
  runCalculation();
});

els.finishSelect.addEventListener('change', () => {
  if (els.finishQueryInput) els.finishQueryInput.value = '';
  state.customPoints.finish = null;
  runCalculation();
});

for (const control of tuningControls()) {
  control.addEventListener('input', () => scheduleCalculation());
}

for (const control of [els.startQueryInput, els.finishQueryInput]) {
  if (!control) continue;
  control.addEventListener('input', () => scheduleCalculation(800));
  control.addEventListener('change', () => runCalculation());
}

init().catch((error) => {
  els.scenarioLine.textContent = error.message;
});
