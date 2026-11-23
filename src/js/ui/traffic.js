'use strict';

/**
 * Marcador de tráfico de datos.
 *
 * El conteo real vive en el proceso principal (`electron/traffic.js`): bytes de
 * cada petición a la API, del flujo SSE y de las respuestas del modo demo. Aquí
 * solo se pinta el chip de la barra superior, se envía la estimación del modelo
 * (tokens × 4 B) y se abre el desglose.
 */

import { el, clear } from '../util/dom.js';
import { openModal } from './modal.js';

const BYTES_PER_TOKEN = 4;
const KIND_LABEL = {
  api: 'API de opencode',
  eventos: 'Eventos en vivo',
  modelo: 'Modelo (estimado)',
  demo: 'Modo demo',
};

let chip = null;
let data = null;
let sheet = null;

export function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return mb < 10 ? `${mb.toFixed(2)} MB` : `${Math.round(mb)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function hhmm(timestamp) {
  const d = new Date(Number(timestamp) || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(key) {
  const today = new Date();
  const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (key === stamp) return 'Hoy';
  const [, month, day] = key.split('-');
  return `${day}/${month}`;
}

function pair(down, up, className) {
  const suffix = className ? ` ${className}` : '';
  return [
    el('span', { class: `traffic-cell${suffix}` }, [
      el('span', { class: 'traffic-cell-arrow', text: '↓' }),
      el('span', { text: formatBytes(down) }),
    ]),
    el('span', { class: `traffic-cell${suffix}` }, [
      el('span', { class: 'traffic-cell-arrow', text: '↑' }),
      el('span', { text: formatBytes(up) }),
    ]),
  ];
}

function gridRow(label, down, up, { className = '', hint = '' } = {}) {
  return [
    el('span', { class: `traffic-name${className ? ` ${className}` : ''}`, title: hint, text: label }),
    ...pair(down, up, className),
  ];
}

function renderChip() {
  if (!chip || !data) return;
  const today = data.today;
  const net = today.netUp + today.netDown;
  clear(chip);
  chip.classList.toggle('is-net', net > 0);
  chip.classList.toggle('is-idle', today.up + today.down === 0);
  chip.append(
    el('span', { class: 'traffic-dot', 'aria-hidden': 'true' }),
    el('span', { class: 'traffic-pair' }, [
      el('span', { class: 'traffic-arrow', text: '↓' }),
      el('span', { class: 'traffic-value', text: formatBytes(today.down) }),
    ]),
    el('span', { class: 'traffic-pair' }, [
      el('span', { class: 'traffic-arrow', text: '↑' }),
      el('span', { class: 'traffic-value', text: formatBytes(today.up) }),
    ]),
  );
  chip.dataset.down = String(Math.round(today.down));
  chip.dataset.up = String(Math.round(today.up));
  chip.dataset.net = String(Math.round(net));
  chip.dataset.requests = String(today.requests);
  chip.dataset.steps = String(today.steps);
  chip.title = [
    `Tráfico de hoy: ↓ ${formatBytes(today.down)} · ↑ ${formatBytes(today.up)}`,
    `Internet (tu plan): ↓ ${formatBytes(today.netDown)} · ↑ ${formatBytes(today.netUp)}`,
    `Local (127.0.0.1, no gasta plan): ↓ ${formatBytes(today.localDown)} · ↑ ${formatBytes(today.localUp)}`,
    'Clic para ver el desglose.',
  ].join('\n');
}

function renderSheet() {
  if (!sheet || !data) return;
  const today = data.today;
  const appNet = {
    down: Math.max(0, today.netDown - today.modelDown),
    up: Math.max(0, today.netUp - today.modelUp),
  };
  const nodes = [
    el('p', { class: 'traffic-lead' }, [
      el('strong', { text: `Hoy ↓ ${formatBytes(today.down)} · ↑ ${formatBytes(today.up)}` }),
    ]),
    el('p', { class: 'muted tiny traffic-sub', text:
      `Sesión desde las ${hhmm(data.startedAt)} · ${today.requests} peticiones · ${today.steps} pasos del agente` }),
    el('div', { class: 'traffic-grid' }, [
      el('span', { class: 'traffic-head', text: 'Origen' }),
      el('span', { class: 'traffic-head', text: 'Bajada' }),
      el('span', { class: 'traffic-head', text: 'Subida' }),
      ...gridRow('Internet (tu plan)', today.netDown, today.netUp, { className: 'is-net' }),
      ...gridRow('Modelo (estimado)', today.modelDown, today.modelUp, { className: 'is-child' }),
      ...gridRow('App (API y eventos)', appNet.down, appNet.up, { className: 'is-child' }),
      ...gridRow('Local (no gasta plan)', today.localDown, today.localUp, { className: 'is-local' }),
      ...gridRow('Total', today.down, today.up, { className: 'is-total' }),
    ]),
    el('p', { class: 'muted tiny traffic-note', text:
      'El modelo se estima con los tokens de cada respuesta (4 B por token). Lo que la app habla con opencode en tu equipo es local; el plan de datos solo paga el tráfico de Internet.' }),
  ];

  const kinds = (data.kinds || []).filter((entry) => entry.up + entry.down > 0);
  if (kinds.length > 1) {
    nodes.push(el('div', { class: 'traffic-kinds' }, [
      el('div', { class: 'traffic-kinds-head', text: 'Por origen' }),
      ...kinds.map((entry) => el('div', { class: 'traffic-kind-row' }, [
        el('span', { class: 'traffic-kind-name', text: KIND_LABEL[entry.kind] || entry.kind }),
        el('span', { class: 'muted', text: `↓ ${formatBytes(entry.down)} · ↑ ${formatBytes(entry.up)}${entry.local ? ' · local' : ''}` }),
      ])),
    ]));
  }

  const days = (data.days || []).filter((entry) => entry.up + entry.down > 0);
  if (days.length > 1) {
    nodes.push(el('div', { class: 'traffic-kinds' }, [
      el('div', { class: 'traffic-kinds-head', text: 'Últimos días' }),
      ...days.slice(-5).map((entry) => el('div', { class: 'traffic-kind-row' }, [
        el('span', { class: 'traffic-kind-name', text: dayLabel(entry.day) }),
        el('span', { class: 'muted', text: `↓ ${formatBytes(entry.down)} · ↑ ${formatBytes(entry.up)} · Internet ↓ ${formatBytes(entry.netDown)} ↑ ${formatBytes(entry.netUp)}` }),
      ])),
    ]));
  }

  clear(sheet);
  sheet.append(...nodes);
}

async function openDetail() {
  if (!data) data = await window.oc.traffic.get().catch(() => null);
  sheet = el('div', { class: 'traffic-sheet' });
  const handle = openModal({
    title: 'Tráfico de datos',
    className: 'traffic-modal',
    width: '620px',
    body: sheet,
    footer: [
      el('button', {
        class: 'btn-small',
        type: 'button',
        text: 'Poner a cero',
        onClick: async () => {
          data = await window.oc.traffic.reset().catch(() => data);
          renderChip();
          renderSheet();
        },
      }),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn-primary', type: 'button', text: 'Cerrar', onClick: () => handle.close() }),
    ],
    onClose: () => { sheet = null; },
  });
  renderSheet();
}

/** Estimación del tráfico del modelo a partir de los tokens de un paso. */
export function noteAgentTraffic(step) {
  const tokens = step?.tokens || {};
  const cache = tokens.cache || {};
  const input = Number(tokens.input || 0) + Number(cache.read || 0) + Number(cache.write || 0);
  const output = Number(tokens.output || 0) + Number(tokens.reasoning || 0);
  const up = Math.round((Number.isFinite(input) ? input : 0) * BYTES_PER_TOKEN);
  const down = Math.round((Number.isFinite(output) ? output : 0) * BYTES_PER_TOKEN);
  if (up + down <= 0) return;
  window.oc.traffic.noteAgent(up, down).catch(() => {});
}

export function mountTraffic() {
  if (chip) return;
  const anchor = document.getElementById('palette-btn');
  if (!anchor) return;
  chip = el('button', {
    class: 'select-wrap traffic-chip',
    id: 'traffic-chip',
    type: 'button',
    'aria-label': 'Tráfico de datos de la app',
    onClick: () => { void openDetail(); },
  });
  anchor.parentNode.insertBefore(chip, anchor);
  window.oc.traffic.onUpdate((snapshot) => {
    if (!snapshot) return;
    data = snapshot;
    renderChip();
    if (sheet) renderSheet();
  });
  window.oc.traffic.get().then((snapshot) => {
    data = snapshot;
    renderChip();
  }).catch(() => {});
}
