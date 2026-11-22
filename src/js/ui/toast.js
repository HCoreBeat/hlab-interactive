import { el } from '../util/dom.js';

export function toast(message, type = 'info', timeout = 6000) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const node = el('div', { class: `toast ${type}` }, [
    el('span', { class: 'toast-text', text: message }),
    el('button', { type: 'button', 'aria-label': 'Cerrar aviso', onClick: () => node.remove(), text: '✕' }),
  ]);
  root.appendChild(node);
  if (timeout > 0) setTimeout(() => node.remove(), timeout);
  return node;
}

export function toastError(error, prefix = '') {
  const message = typeof error === 'string' ? error : error?.message || 'Error desconocido';
  return toast(prefix ? `${prefix}: ${message}` : message, 'error', 9000);
}
