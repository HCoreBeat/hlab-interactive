'use strict';

/**
 * Draggable splitters for the new layout: the width of the side panel and the
 * height of the office split. Every value is stored as a CSS custom property
 * on the `.app` element and persisted in the settings.
 */

import { el } from '../util/dom.js';

const LIMITS = {
  '--side-w': [200, 900],
  '--office-h': [120, 900],
};

const DEFAULTS = {
  '--side-w': 280,
  '--office-h': 300,
};

function limits(name) {
  const [min, max] = LIMITS[name] || [100, 900];
  if (name === '--office-h') {
    return [min, Math.min(max, Math.round((window.innerHeight || 900) * 0.7))];
  }
  if (name === '--side-w') {
    return [min, Math.min(max, Math.round((window.innerWidth || 1400) * 0.7))];
  }
  return [min, max];
}

function currentValue(app, name) {
  const raw = getComputedStyle(app).getPropertyValue(name).trim();
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) return DEFAULTS[name] || 200;
  return parsed;
}

function applyValue(app, name, value) {
  const [min, max] = limits(name);
  const limit = Math.min(max, Math.max(min, value));
  app.style.setProperty(name, `${Math.round(limit)}px`);
  return Math.round(limit);
}

/**
 * @param {object} options
 * @param {(name: string, value: number) => void} options.onChange
 */
export function mountSplitters({ onChange } = {}) {
  const app = document.getElementById('app');
  if (!app) return { destroy() {} };

  const grips = [
    { name: '--side-w', host: '#side-grip', axis: 'x', grow: 1 },
    { name: '--office-h', host: '#office-grip', axis: 'y', grow: -1 },
  ].map((config) => createGrip(config));

  function createGrip(config) {
    const host = document.querySelector(config.host);
    if (!host) return null;
    const grip = host.classList.contains('grip')
      ? host
      : el('div', { class: `grip grip-${config.axis}` });

    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try { grip.setPointerCapture(event.pointerId); } catch { /* synthetic event */ }
      grip.classList.add('is-active');
      document.body.classList.add('is-resizing');
      const start = config.axis === 'x' ? event.clientX : event.clientY;
      const origin = currentValue(app, config.name);

      const onMove = (moveEvent) => {
        const now = config.axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
        applyValue(app, config.name, origin + (now - start) * config.grow);
      };

      const onUp = () => {
        grip.classList.remove('is-active');
        document.body.classList.remove('is-resizing');
        grip.removeEventListener('pointermove', onMove);
        grip.removeEventListener('pointerup', onUp);
        grip.removeEventListener('pointercancel', onUp);
        onChange?.(config.name, currentValue(app, config.name));
      };

      grip.addEventListener('pointermove', onMove);
      grip.addEventListener('pointerup', onUp);
      grip.addEventListener('pointercancel', onUp);
    });

    grip.addEventListener('dblclick', () => {
      const fallback = DEFAULTS[config.name];
      applyValue(app, config.name, fallback);
      onChange?.(config.name, fallback);
    });

    return { grip, config };
  }

  return {
    destroy() {
      grips.forEach((item) => item?.grip.remove());
    },
    /** Applies a size right away (and remembers it). */
    set(name, value) {
      const applied = applyValue(app, name, value);
      onChange?.(name, applied);
      return applied;
    },
    apply(layout = {}) {
      const map = { sideW: '--side-w', officeH: '--office-h' };
      for (const [key, name] of Object.entries(map)) {
        if (typeof layout[key] === 'number') applyValue(app, name, layout[key]);
      }
    },
  };
}
