import { el } from '../util/dom.js';

/**
 * Minimal modal helper: backdrop + card + Escape/backdrop close.
 * Returns a handle so callers can close it programmatically.
 */
export function openModal({ title, body, footer, width, onClose, className } = {}) {
  const root = document.getElementById('modal-root');
  const card = el('div', { class: `modal ${className || ''}`.trim(), style: width ? { width } : undefined }, [
    el('header', {}, [
      el('h2', { text: title || '' }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn-icon',
        type: 'button',
        'aria-label': 'Cerrar',
        text: '✕',
        onClick: () => close(),
      }),
    ]),
    el('div', { class: 'modal-body' }, body ? (Array.isArray(body) ? body : [body]) : []),
    footer ? el('footer', {}, Array.isArray(footer) ? footer : [footer]) : null,
  ]);

  const backdrop = el('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' }, [card]);

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  function close() {
    if (!backdrop.isConnected) return;
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    onClose?.();
  }

  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);

  root.appendChild(backdrop);
  requestAnimationFrame(() => {
    const focusable = card.querySelector('input, select, textarea, button');
    focusable?.focus();
  });

  return { close, card, root: backdrop };
}

export function confirmDialog({ title = 'Confirmar', message, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      handle.close();
      resolve(value);
    };
    const handle = openModal({
      title,
      body: el('div', { style: { whiteSpace: 'pre-wrap', fontSize: '0.86rem', lineHeight: '1.55' }, text: message || '' }),
      footer: [
        el('button', { class: 'btn-small', type: 'button', text: cancelLabel, onClick: () => finish(false) }),
        el('button', {
          class: danger ? 'btn-primary is-stop' : 'btn-primary',
          type: 'button',
          text: confirmLabel,
          onClick: () => finish(true),
        }),
      ],
      onClose: () => finish(false),
    });
  });
}
