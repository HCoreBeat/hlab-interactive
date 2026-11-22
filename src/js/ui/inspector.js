import { el, clear } from '../util/dom.js';
import { subscribe, state } from '../store.js';
import { formatTime } from '../util/format.js';
import { toast } from './toast.js';

/**
 * Raw event inspector: the last 500 events exactly as they arrived from
 * `GET /api/event`. Unknown event types are visible here, which makes the tab
 * the debugging tool for API changes.
 */
export function mountInspector(container) {
  const bar = el('div', { class: 'inspector-bar' }, [
    el('input', { type: 'text', placeholder: 'Filtrar por tipo o sesión (p. ej. permission)', 'aria-label': 'Filtrar eventos' }),
    el('button', { class: 'btn-small', type: 'button', text: 'Pausar' }),
    el('button', { class: 'btn-small', type: 'button', text: 'Copiar JSON' }),
    el('button', { class: 'btn-small', type: 'button', text: 'Limpiar' }),
  ]);
  const count = el('span', { class: 'muted tiny' });
  const list = el('div', { class: 'event-list' });
  container.append(bar, count, list);

  const filterInput = bar.querySelector('input');
  const [pauseButton, copyButton, clearButton] = bar.querySelectorAll('button');

  let paused = false;
  let snapshot = [];
  let hiddenBefore = 0;

  function events() {
    const all = paused ? snapshot : state.events;
    return hiddenBefore ? all.filter((event) => (event.created || 0) > hiddenBefore) : all;
  }

  function filtered() {
    const term = filterInput.value.trim().toLowerCase();
    const all = events();
    if (!term) return all;
    return all.filter((event) => {
      const haystack = `${event.type} ${event.data?.sessionID || ''} ${event.id || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  function render() {
    clear(list);
    const items = filtered();
    const total = events().length;
    count.textContent = `${items.length} de ${total} eventos${paused ? ' · congelado' : ''}`;

    if (total === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '🛰️' }),
        el('div', { text: 'Sin eventos todavía.' }),
        el('div', { text: 'Los eventos SSE aparecerán aquí en cuanto lleguen.' }),
      ]));
      return;
    }

    // Newest first: the interesting thing is almost always the last event.
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const event = items[index];
      const sessionID = event.data?.sessionID || '';
      const details = el('details', { class: 'event-row' }, [
        el('summary', {}, [
          el('span', { class: 'evt-time', text: formatTime(event.created) }),
          el('span', { class: 'evt-type', text: event.type || '(sin tipo)' }),
          el('span', { class: 'evt-session', text: sessionID }),
        ]),
        el('pre', { text: JSON.stringify(event, null, 2) }),
      ]);
      list.appendChild(details);
    }
  }

  pauseButton.addEventListener('click', () => {
    paused = !paused;
    if (paused) snapshot = state.events.slice();
    pauseButton.textContent = paused ? 'Reanudar' : 'Pausar';
    pauseButton.classList.toggle('is-active', paused);
    render();
  });

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filtered(), null, 2));
      toast('Eventos copiados al portapapeles.', 'ok', 1800);
    } catch {
      toast('No se pudo copiar al portapapeles.', 'warn');
    }
  });

  clearButton.addEventListener('click', () => {
    hiddenBefore = Date.now();
    if (paused) snapshot = snapshot.filter((event) => (event.created || 0) > hiddenBefore);
    render();
  });

  filterInput.addEventListener('input', render);

  const unsubscribe = subscribe(['events'], () => {
    if (!paused) render();
  });
  render();
  return { destroy: unsubscribe, focusFilter: () => filterInput.focus() };
}
