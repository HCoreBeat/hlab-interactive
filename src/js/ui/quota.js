'use strict';

/**
 * Uso de OpenCode en el plan gratuito.
 *
 * OpenCode no expone la cuota restante, así que la app la estima: cuenta los
 * mensajes y tokens de la ventana actual y aprende el límite real la primera
 * vez que el proveedor avisa ("Free limit reached"). También lee de ese aviso
 * la hora de reinicio y avisa con un cartel igual al de OpenCode.
 */

import { el, clear } from '../util/dom.js';
import { state } from '../store.js';
import { openModal } from './modal.js';

const KEY = 'ocv.usage';
const GO_URL = 'https://opencode.ai/go';
const LIMIT_RE = /used today'?s free messages|free limit reached|l[ií]mite gratuito alcanzado/i;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
let data = load();
let chip = null;
let limitModal = null;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sin almacenamiento */ }
}

function emptyWindow(windowStart) {
  data.window = windowStart;
  data.prompts = 0;
  data.steps = 0;
  data.tokens = { input: 0, output: 0, reasoning: 0 };
  data.models = {};
  data.limit = null;
}

/** Inicio de la ventana de uso actual: la última vez que fueron HH:MM. */
function boundary(now, clock) {
  const [h, m] = (clock || '00:00').split(':').map(Number);
  const d = new Date(now);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

function nextBoundary(now, clock) {
  const d = new Date(boundary(now, clock));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

function rollover() {
  const now = Date.now();
  const start = boundary(now, data.resetClock);
  if (data.window !== start) {
    emptyWindow(start);
    save();
  }
}

function hhmm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function remaining(ts) {
  const minutes = Math.max(0, Math.round((ts - Date.now()) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min`;
}

function modelKey(model) {
  if (!model) return 'desconocido';
  const provider = model.providerID || model.provider || 'opencode';
  return `${provider}/${model.modelID || model.id || '?'}`;
}

export function getStatus() {
  rollover();
  const now = Date.now();
  const limited = Boolean(data.limit && now < data.limit.resetAt);
  const resetAt = limited ? data.limit.resetAt : nextBoundary(now, data.resetClock);
  return {
    prompts: data.prompts || 0,
    steps: data.steps || 0,
    tokens: data.tokens || { input: 0, output: 0, reasoning: 0 },
    models: data.models || {},
    learned: data.learned || 0,
    limited,
    resetAt,
    knownReset: Boolean(data.resetClock),
  };
}

// ------------------------------------------------------------ registro ----

export function recordPrompt(model) {
  rollover();
  data.prompts = (data.prompts || 0) + 1;
  const key = modelKey(model);
  data.models[key] = { ...(data.models[key] || { prompts: 0, steps: 0 }), prompts: ((data.models[key]?.prompts) || 0) + 1 };
  save();
  refresh();
}

export function recordStep(sessionID, step) {
  rollover();
  const tokens = step?.tokens || {};
  data.steps = (data.steps || 0) + 1;
  data.tokens.input += Number(tokens.input || 0);
  data.tokens.output += Number(tokens.output || 0);
  data.tokens.reasoning += Number(tokens.reasoning || 0);
  const message = (state.messages[sessionID] || []).find((item) => item.id === step?.assistantMessageID);
  const key = modelKey(message?.model);
  const current = data.models[key] || { prompts: 0, steps: 0 };
  data.models[key] = { ...current, steps: (current.steps || 0) + 1 };
  save();
  refresh();
}

/** Devuelve true si el texto es el aviso de límite gratuito. */
export function detectLimit(text) {
  const value = String(text || '');
  if (value.length > 600 || !LIMIT_RE.test(value)) return false;
  if (!/free/i.test(value) && !/gratuito/i.test(value)) return false;
  rollover();
  const now = Date.now();
  const clock = /resets?\s+at\s+(\d{1,2}):(\d{2})/i.exec(value);
  const relative = /resets?\s+in\s+(?:(\d+)\s*h\w*)?\s*(?:(\d+)\s*m\w*)?/i.exec(value);
  let resetAt;
  if (clock) {
    data.resetClock = `${clock[1].padStart(2, '0')}:${clock[2]}`;
    resetAt = nextBoundary(now, data.resetClock);
    if (resetAt - now > 24 * 3600 * 1000) resetAt -= 24 * 3600 * 1000;
    data.window = boundary(now, data.resetClock);
  } else if (relative && (relative[1] || relative[2])) {
    resetAt = now + ((Number(relative[1] || 0) * 60) + Number(relative[2] || 0)) * 60000;
  } else {
    resetAt = nextBoundary(now, data.resetClock);
  }
  const already = data.limit && now - data.limit.hitAt < 60000;
  if (data.prompts > 0) data.learned = Math.max(data.learned || 0, data.prompts);
  data.limit = { hitAt: already ? data.limit.hitAt : now, resetAt };
  save();
  refresh();
  if (!already && !data.hideLimitModal) openLimitModal();
  return true;
}

// ---------------------------------------------------------------- UI ----

function openExternal(url) {
  window.oc.openExternal(url);
}

export function openLimitModal() {
  if (limitModal) return;
  const status = getStatus();
  const countdown = el('strong', { text: `${hhmm(status.resetAt)} (en ${remaining(status.resetAt)})` });
  limitModal = openModal({
    title: 'Límite gratuito alcanzado',
    className: 'quota-modal',
    width: 'min(520px, 94vw)',
    body: [
      el('p', { class: 'quota-lead' }, [
        'Has usado los mensajes gratuitos de hoy. La cuota se reinicia a las ',
        countdown,
        '.',
      ]),
      el('p', { class: 'muted quota-sub', text: 'OpenCode Go te da acceso fiable a los mejores modelos de código abierto por 10 $/mes. Mientras tanto puedes cambiar a otro modelo con Ctrl+P → Modelos.' }),
      el('div', { class: 'quota-go', 'aria-hidden': 'true' }, [el('span', { text: 'GO' })]),
      el('a', { class: 'quota-link', href: '#', text: GO_URL, onClick: (event) => { event.preventDefault(); openExternal(GO_URL); } }),
    ],
    footer: [
      el('button', {
        class: 'btn-small', type: 'button', text: 'No volver a mostrar',
        onClick: () => { data.hideLimitModal = true; save(); limitModal?.close(); },
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn-primary', type: 'button', text: 'Cerrar', onClick: () => limitModal?.close() }),
      el('button', { class: 'btn-small', type: 'button', text: 'Suscribirse', onClick: () => openExternal(GO_URL) }),
    ],
    onClose: () => { limitModal = null; },
  });
}

function tokensText(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function openUsage() {
  const status = getStatus();
  const percent = status.learned ? Math.min(100, Math.round((status.prompts / status.learned) * 100)) : null;
  const rows = Object.entries(status.models).sort((a, b) => (b[1].prompts || 0) - (a[1].prompts || 0));
  const handle = openModal({
    title: 'Uso de OpenCode (plan gratuito)',
    className: 'quota-modal',
    width: 'min(560px, 94vw)',
    body: [
      el('div', { class: `quota-card${status.limited ? ' is-limited' : ''}` }, [
        el('div', { class: 'quota-big', text: status.limited ? 'Límite alcanzado' : `${status.prompts} mensaje${status.prompts === 1 ? '' : 's'} hoy` }),
        percent === null
          ? el('div', { class: 'muted tiny', text: 'OpenCode no informa del límite gratuito. La app lo aprenderá la primera vez que llegues a él.' })
          : el('div', { class: 'quota-bar' }, [el('div', { class: 'quota-bar-fill', style: { width: `${percent}%` } })]),
        percent === null ? null : el('div', { class: 'muted tiny', text: `${status.prompts} de ~${status.learned} mensajes (${percent}%) · límite estimado de la última vez` }),
        el('div', { class: 'quota-reset', text: `${status.limited ? 'Se reinicia' : 'Próximo reinicio'}: ${hhmm(status.resetAt)} (en ${remaining(status.resetAt)})${status.knownReset ? '' : ' · hora estimada (medianoche)'}` }),
      ].filter(Boolean)),
      el('div', { class: 'quota-stats' }, [
        el('div', {}, [el('strong', { text: String(status.steps) }), el('span', { text: 'respuestas' })]),
        el('div', {}, [el('strong', { text: tokensText(status.tokens.input) }), el('span', { text: 'tokens entrada' })]),
        el('div', {}, [el('strong', { text: tokensText(status.tokens.output) }), el('span', { text: 'tokens salida' })]),
        el('div', {}, [el('strong', { text: tokensText(status.tokens.reasoning) }), el('span', { text: 'razonamiento' })]),
      ]),
      rows.length
        ? el('div', { class: 'quota-models' }, [
          el('div', { class: 'quota-models-head', text: 'Por modelo (ventana actual)' }),
          ...rows.map(([name, value]) => el('div', { class: 'quota-model-row' }, [
            el('span', { class: 'quota-model-name', text: name }),
            el('span', { class: 'muted', text: `${value.prompts || 0} mensajes · ${value.steps || 0} respuestas` }),
          ])),
        ])
        : el('div', { class: 'muted tiny', text: 'Aún no hay uso registrado en esta ventana.' }),
    ],
    footer: [
      el('button', {
        class: 'btn-small', type: 'button', text: 'Poner contador a cero',
        onClick: () => { emptyWindow(boundary(Date.now(), data.resetClock)); save(); refresh(); handle.close(); },
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn-small', type: 'button', text: 'Ver OpenCode Go', onClick: () => openExternal(GO_URL) }),
      el('button', { class: 'btn-primary', type: 'button', text: 'Cerrar', onClick: () => handle.close() }),
    ],
  });
  return handle;
}

function refresh() {
  if (!chip) return;
  const status = getStatus();
  chip.classList.toggle('is-limited', status.limited);
  chip.classList.toggle('is-warn', !status.limited && status.learned > 0 && status.prompts / status.learned >= 0.8);
  clear(chip);
  if (status.limited) {
    chip.append(el('span', { class: 'quota-dot' }), `Límite · reinicia ${hhmm(status.resetAt)} (${remaining(status.resetAt)})`);
  } else {
    chip.append(el('span', { class: 'quota-dot' }), `Uso hoy: ${status.prompts}${status.learned ? ` / ~${status.learned}` : ''}`);
  }
  chip.title = `Mensajes gratuitos de esta ventana. Próximo reinicio: ${hhmm(status.resetAt)} (en ${remaining(status.resetAt)}). Clic para ver el detalle.`;
}

export function mountQuota() {
  const anchor = document.getElementById('palette-btn');
  if (!anchor || chip) return;
  chip = el('button', { class: 'select-wrap quota-chip', id: 'quota-chip', type: 'button', onClick: () => openUsage() });
  anchor.parentNode.insertBefore(chip, anchor);
  refresh();
  setInterval(refresh, 30000);
}
