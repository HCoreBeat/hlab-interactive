'use strict';

/**
 * Contador de tráfico de datos de la app.
 *
 * Mide los bytes que el proceso mueve por HTTP (peticiones a la API, flujo SSE
 * y respuestas del modo demo) y suma, aparte, una estimación del tráfico del
 * modelo calculada con los tokens de cada paso (4 B/token).
 *
 * Todo se separa en tres cubos, porque no pesan igual en la tarifa de datos:
 *   - `net`   Internet (tu plan): lo que sale del equipo.
 *   - `local` 127.0.0.1 / localhost: gratis, aunque sean muchos MB.
 *   - `model` el proveedor del modelo (se deduce de los tokens, no se mide).
 *
 * Se guarda un agregado por día en `traffic.json` (14 días) y se puede poner a
 * cero desde la interfaz.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_DAYS = 14;
const MAX_HOSTS = 12;
const NOTIFY_MS = 700;
const SAVE_MS = 2000;

const LOCAL_HOST = /^(127(?:\.\d+){3}|localhost|\[?::1\]?|0\.0\.0\.0)$/i;

function emptyBucket() {
  return {
    up: 0, down: 0,
    netUp: 0, netDown: 0,
    localUp: 0, localDown: 0,
    modelUp: 0, modelDown: 0,
    requests: 0, steps: 0,
  };
}

function dayKey(now = Date.now()) {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const state = {
  startedAt: Date.now(),
  days: {},
  today: dayKey(),
  session: emptyBucket(),
  kinds: {},
  hosts: {},
};

let file = '';
let saveTimer = null;
let notifyTimer = null;
let listener = null;

/** Acepta cualquier número y lo deja en un entero de bytes razonable. */
function size(value, max = 2 * 1024 * 1024 * 1024) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.round(number), max);
}

function day() {
  const key = dayKey();
  if (key !== state.today) {
    state.today = key;
    prune();
  }
  if (!state.days[key]) state.days[key] = emptyBucket();
  return state.days[key];
}

function prune() {
  const keys = Object.keys(state.days).sort();
  while (keys.length > MAX_DAYS) {
    const old = keys.shift();
    delete state.days[old];
  }
}

function bump(target, { up, down, local, count }) {
  target.up += up;
  target.down += down;
  if (count) target.requests += 1;
  if (local) {
    target.localUp += up;
    target.localDown += down;
  } else {
    target.netUp += up;
    target.netDown += down;
  }
}

function bumpKind(kind, values) {
  const key = String(kind || 'api').slice(0, 24);
  if (!state.kinds[key]) {
    state.kinds[key] = { up: 0, down: 0, count: 0, local: false };
  }
  const entry = state.kinds[key];
  entry.up += values.up;
  entry.down += values.down;
  if (values.count) entry.count += 1;
  entry.local = values.local;
}

function bumpHost(host, values) {
  const key = String(host || (values.local ? 'local' : 'internet')).slice(0, 80);
  if (!state.hosts[key]) {
    const count = Object.keys(state.hosts).length;
    if (count >= MAX_HOSTS) {
      // Fuera el huésped con menos tráfico: el detalle es informativo.
      let smallest = null;
      for (const [name, entry] of Object.entries(state.hosts)) {
        if (!smallest || entry.up + entry.down < smallest.total) {
          smallest = { name, total: entry.up + entry.down };
        }
      }
      if (smallest) delete state.hosts[smallest.name];
    }
    state.hosts[key] = { up: 0, down: 0, count: 0, local: values.local };
  }
  const entry = state.hosts[key];
  entry.up += values.up;
  entry.down += values.down;
  if (values.count) entry.count += 1;
  entry.local = values.local;
}

function scheduleNotify() {
  if (!listener || notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    try {
      listener(snapshot());
    } catch { /* el renderer puede haberse cerrado */ }
  }, NOTIFY_MS);
  if (notifyTimer.unref) notifyTimer.unref();
}

function scheduleSave() {
  if (!file || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_MS);
  if (saveTimer.unref) saveTimer.unref();
}

/** Registra tráfico HTTP real (o simulado por el modo demo). */
function note({ kind = 'api', host = '', up = 0, down = 0, local, count = true } = {}) {
  const values = {
    up: size(up),
    down: size(down),
    local: typeof local === 'boolean' ? local : LOCAL_HOST.test(String(host || '')),
    count: count !== false,
  };
  bump(day(), values);
  bump(state.session, values);
  bumpKind(kind, values);
  bumpHost(host, values);
  scheduleSave();
  scheduleNotify();
  return values;
}

/**
 * Estimación del tráfico con el proveedor a partir de los tokens del turno.
 * 4 bytes por token es la media habitual en texto y JSON en inglés/código.
 */
function noteAgent({ up = 0, down = 0 } = {}) {
  const bytesUp = size(up);
  const bytesDown = size(down);
  const values = { up: bytesUp, down: bytesDown, local: false, count: true };
  const bucket = day();
  bump(bucket, values);
  bucket.modelUp += bytesUp;
  bucket.modelDown += bytesDown;
  bucket.steps += 1;
  bump(state.session, values);
  state.session.modelUp += bytesUp;
  state.session.modelDown += bytesDown;
  state.session.steps += 1;
  bumpKind('modelo', values);
  bumpHost('proveedor del modelo', values);
  scheduleSave();
  scheduleNotify();
  return values;
}

function clone(bucket) {
  return { ...bucket };
}

function snapshot() {
  const today = day();
  const days = Object.keys(state.days).sort().slice(-7).map((key) => ({
    day: key,
    ...clone(state.days[key]),
  }));
  const kinds = Object.entries(state.kinds)
    .map(([kind, entry]) => ({ kind, ...entry }))
    .sort((a, b) => (b.up + b.down) - (a.up + a.down));
  const hosts = Object.entries(state.hosts)
    .map(([host, entry]) => ({ host, ...entry }))
    .sort((a, b) => (b.up + b.down) - (a.up + a.down));
  return {
    startedAt: state.startedAt,
    today: clone(today),
    session: clone(state.session),
    kinds,
    hosts,
    days,
    dayKey: state.today,
  };
}

function reset() {
  state.startedAt = Date.now();
  state.session = emptyBucket();
  state.kinds = {};
  state.hosts = {};
  const key = dayKey();
  state.today = key;
  state.days[key] = emptyBucket();
  prune();
  flush();
  scheduleNotify();
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
      for (const [key, bucket] of Object.entries(raw.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !bucket || typeof bucket !== 'object') continue;
        state.days[key] = { ...emptyBucket(), ...bucket };
      }
    }
  } catch { /* primer arranque o archivo corrupto: se empieza de cero */ }
  prune();
}

function flush() {
  if (!file) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, days: state.days }), 'utf8');
  } catch { /* sin permiso de escritura: el contador sigue en memoria */ }
}

function init({ file: target } = {}) {
  file = target || '';
  if (file) load();
  state.startedAt = Date.now();
  day();
}

function onChange(callback) {
  listener = typeof callback === 'function' ? callback : null;
}

module.exports = {
  init, note, noteAgent, snapshot, reset, flush, onChange,
};
