import { el, clear } from '../util/dom.js';
import { subscribe, state, activityOf, activeSession } from '../store.js';
import { toolIcon, STATUS_ICONS } from '../util/icons.js';
import { formatDuration, formatTime, truncate } from '../util/format.js';

function targetOf(input) {
  if (!input || typeof input !== 'object') return '';
  const value = input.path || input.filePath || input.file || input.command || input.pattern || input.query || input.url;
  if (value) return truncate(String(value), 80);
  const keys = Object.keys(input);
  return keys.length > 0 ? truncate(JSON.stringify(input), 80) : '';
}

export function mountActivity(container) {
  const list = el('div', { class: 'activity-list' });
  container.appendChild(list);

  function render() {
    clear(list);
    const session = activeSession();
    if (!session) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🛠️' }),
        el('div', { text: 'Sin sesión activa.' }),
      ]));
      return;
    }

    const items = activityOf(session.id).slice().reverse();
    if (items.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🛠️' }),
        el('div', { text: 'Todavía no hay actividad.' }),
        el('div', { text: 'Cuando el agente use herramientas, aparecerán aquí.' }),
      ]));
      return;
    }

    for (const item of items) {
      const duration = item.startedAt && item.endedAt ? formatDuration(item.endedAt - item.startedAt) : '';
      const details = el('details', { class: 'activity-output' });
      details.appendChild(el('summary', { text: 'Entrada y salida' }));
      if (item.input) details.appendChild(el('pre', { text: JSON.stringify(item.input, null, 1) }));
      if (item.error) details.appendChild(el('pre', { text: item.error }));
      else if (item.output) details.appendChild(el('pre', { text: item.output }));

      list.appendChild(el('div', { class: 'activity-item', 'data-status': item.status }, [
        el('span', { class: 'activity-icon', text: toolIcon(item.name) }),
        el('div', { class: 'activity-main' }, [
          el('div', { class: 'activity-title' }, [
            el('b', { text: item.name || 'tool' }),
            el('span', { class: 'activity-target', text: targetOf(item.input), title: targetOf(item.input) }),
          ]),
          el('div', { class: 'activity-sub' }, [
            el('span', { text: formatTime(item.startedAt) }),
            duration ? el('span', { text: ` · ${duration}` }) : null,
          ]),
          details,
        ]),
        el('span', { class: 'activity-side' }, [
          el('span', { title: item.status, text: STATUS_ICONS[item.status] || '•' }),
        ]),
      ]));
    }
  }

  const unsubscribe = subscribe(['activity', 'activeSessionId', 'sessions'], render);
  render();
  return { destroy: unsubscribe, render };
}
