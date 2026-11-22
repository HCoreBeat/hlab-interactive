'use strict';

/**
 * Buscador del chat (Ctrl+F): resalta las coincidencias sin tocar el DOM
 * (CSS Custom Highlight API), navega entre ellas y permite buscar solo en tus
 * propios mensajes. Sigue funcionando mientras el chat se actualiza.
 */

import { el } from '../util/dom.js';
import { uiIcon } from '../util/ui-icons.js';

const MAX_MATCHES = 800;

export function mountChatSearch({ chat, scroll, headerButtonAnchor }) {
  const supportsHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  let ranges = [];
  let current = -1;
  let observer = null;
  let timer = null;

  const input = el('input', {
    class: 'chat-search-input', type: 'search', placeholder: 'Buscar en el chat\u2026', spellcheck: 'false', 'aria-label': 'Buscar en el chat',
  });
  const mine = el('input', { type: 'checkbox', id: 'chat-search-mine' });
  const count = el('span', { class: 'chat-search-count', text: '' });
  const prev = el('button', { class: 'chat-search-btn', type: 'button', title: 'Coincidencia anterior (Enter)', text: '\u2191' });
  const next = el('button', { class: 'chat-search-btn', type: 'button', title: 'Coincidencia siguiente (Shift+Enter)', text: '\u2193' });
  const close = el('button', { class: 'chat-search-btn', type: 'button', title: 'Cerrar (Esc)', text: '\u2715' });
  const bar = el('div', { class: 'chat-search', hidden: true, role: 'search' }, [
    uiIcon('search', 15),
    input,
    count,
    prev,
    next,
    el('label', { class: 'chat-search-mine', title: 'Buscar solo en lo que he escrito yo' }, [mine, el('span', { text: 'Solo mis mensajes' })]),
    close,
  ]);
  chat.appendChild(bar);

  if (headerButtonAnchor) {
    const button = el('button', {
      class: 'btn-icon tiny chat-search-open', type: 'button', title: 'Buscar en el chat (Ctrl+F)', 'aria-label': 'Buscar en el chat',
      onClick: () => open(),
    }, [uiIcon('search', 15)]);
    headerButtonAnchor.parentNode.insertBefore(button, headerButtonAnchor);
  }

  function clearHighlights() {
    if (!supportsHighlight) return;
    CSS.highlights.delete('chat-hit');
    CSS.highlights.delete('chat-hit-current');
  }

  function collect() {
    ranges = [];
    const query = input.value.trim().toLowerCase();
    clearHighlights();
    if (query.length < 2) {
      count.textContent = '';
      current = -1;
      return;
    }
    const selector = mine.checked
      ? '.msg-user .bubble'
      : '.msg-user .bubble, .msg-assistant .bubble, .msg-assistant .block-reasoning pre, .msg-assistant .tool-card, .msg-system .bubble';
    const seen = new Set();
    for (const root of scroll.querySelectorAll(selector)) {
      if (seen.has(root)) continue;
      seen.add(root);
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && ranges.length < MAX_MATCHES) {
        const text = node.nodeValue.toLowerCase();
        let from = text.indexOf(query);
        while (from !== -1 && ranges.length < MAX_MATCHES) {
          const range = new Range();
          range.setStart(node, from);
          range.setEnd(node, from + query.length);
          ranges.push(range);
          from = text.indexOf(query, from + query.length);
        }
        node = walker.nextNode();
      }
    }
    if (ranges.length === 0) {
      current = -1;
      count.textContent = 'Sin resultados';
      return;
    }
    if (current < 0 || current >= ranges.length) current = ranges.length - 1;
    paint();
  }

  function paint() {
    count.textContent = `${current + 1} / ${ranges.length}`;
    if (!supportsHighlight) return;
    CSS.highlights.set('chat-hit', new Highlight(...ranges));
    if (ranges[current]) CSS.highlights.set('chat-hit-current', new Highlight(ranges[current]));
  }

  function go(index, scrollTo = true) {
    if (ranges.length === 0) return;
    current = (index + ranges.length) % ranges.length;
    paint();
    if (scrollTo) {
      const target = ranges[current].startContainer.parentElement;
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function open() {
    bar.hidden = false;
    input.focus();
    input.select();
    if (!observer) {
      // al llegar mensajes nuevos o repintarse, se recalculan las coincidencias sin saltar
      observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (!bar.hidden) { const keep = current; collect(); if (ranges.length) { current = Math.min(keep, ranges.length - 1); paint(); } } }, 250);
      });
    }
    observer.observe(scroll, { childList: true, subtree: true, characterData: true });
    if (input.value.trim().length >= 2) { collect(); go(current); }
  }

  function hide() {
    bar.hidden = true;
    observer?.disconnect();
    clearHighlights();
    ranges = [];
    current = -1;
  }

  input.addEventListener('input', () => { current = -1; collect(); if (ranges.length) go(current); });
  mine.addEventListener('change', () => { current = -1; collect(); if (ranges.length) go(current); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); go(event.shiftKey ? current + 1 : current - 1); }
    else if (event.key === 'Escape') { event.preventDefault(); hide(); }
  });
  prev.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () => go(current + 1));
  close.addEventListener('click', hide);

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      if (document.querySelector('.modal-backdrop, .lightbox')) return;
      event.preventDefault();
      open();
    }
  });

  return { open, hide };
}
