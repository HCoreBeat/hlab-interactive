import { el, clear } from '../util/dom.js';

let root = null;

/** Full-center onboarding / error screen. */
export function showWelcome({ message, onOpenProject, onRetry, onSettings, onDemo, demo = false } = {}) {
  hideWelcome();
  const app = document.getElementById('app');

  const actions = el('div', { class: 'actions' });
  if (message) {
    actions.appendChild(el('button', { class: 'btn-small', type: 'button', text: 'Reintentar conexión', onClick: () => onRetry?.() }));
  }
  actions.appendChild(el('button', { class: 'btn-primary', type: 'button', text: '📂 Abrir carpeta de proyecto', onClick: () => onOpenProject?.() }));
  if (!demo) {
    actions.appendChild(el('button', { class: 'btn-small', type: 'button', text: 'Probar el modo demo', onClick: () => onDemo?.() }));
  }
  actions.appendChild(el('button', { class: 'btn-small', type: 'button', text: '⚙ Ajustes', onClick: () => onSettings?.() }));

  root = el('div', { class: 'welcome' }, [
    el('div', { class: 'welcome-card' }, [
      el('div', { class: 'logo', text: '🏢' }),
      el('h1', { text: 'HLab Interactive' }),
      el('p', { text: 'Tu equipo de agentes, en una oficina pixel-art que puedes mirar. Abre una carpeta y cada sesión tendrá su personaje, su actividad y sus archivos.' }),
      message ? el('div', { class: 'error-box', text: message }) : null,
      actions,
      el('div', { class: 'hint-list' }, [
        el('div', { text: '1. Necesitas opencode instalado: `npm i -g opencode-ai`.' }),
        el('div', { text: '2. La app lanza `opencode serve` y habla con su API v2 local.' }),
        el('div', { text: '3. Si ya tienes un servidor, conéctalo desde Ajustes → Conexión.' }),
        el('div', { text: '4. Sin opencode puedes explorar la interfaz con el modo demo.' }),
      ]),
    ]),
  ]);

  app.appendChild(root);
  return root;
}

export function hideWelcome() {
  if (root) {
    root.remove();
    root = null;
  }
  for (const node of document.querySelectorAll('.welcome')) node.remove();
}

export function welcomeVisible() {
  return Boolean(document.querySelector('.welcome'));
}

export function clearWelcomeNode() {
  if (root) clear(root);
}
