'use strict';

/**
 * Avatares animados del chat: un robot con visor para el agente y una persona
 * para el usuario. Son SVG estáticos (sin datos del usuario) estilizados y
 * animados por CSS (chat-v3.css).
 *
 * Los mensajes se vuelven a pintar muchas veces durante el streaming; para que
 * las animaciones infinitas no "salten" al recrear el nodo, cada avatar recibe
 * una fase global (--av-phase) y todas las duraciones dividen 6 s.
 */

import { el } from '../util/dom.js';

const AGENT_SVG = `
<svg viewBox="0 0 40 40" class="av-svg" aria-hidden="true">
  <circle class="av-orbit" cx="20" cy="20" r="18.2" fill="none" stroke-width="1.4" stroke-dasharray="3 7" stroke-linecap="round"/>
  <g class="av-bot">
    <line class="av-ant" x1="20" y1="10" x2="20" y2="6" stroke-width="1.7" stroke-linecap="round"/>
    <circle class="av-bulb" cx="20" cy="4.8" r="2.1"/>
    <rect class="av-ear" x="5.6" y="16.5" width="3.2" height="6.4" rx="1.6"/>
    <rect class="av-ear" x="31.2" y="16.5" width="3.2" height="6.4" rx="1.6"/>
    <rect class="av-head" x="8.6" y="10" width="22.8" height="19" rx="6.4"/>
    <rect class="av-visor" x="12" y="14" width="16" height="9.6" rx="3.8"/>
    <g class="av-eyes">
      <rect class="av-eye" x="15.2" y="16.6" width="3.2" height="4.4" rx="1.3"/>
      <rect class="av-eye" x="21.6" y="16.6" width="3.2" height="4.4" rx="1.3"/>
    </g>
    <g class="av-mouth">
      <rect class="av-bar b1" x="14.3" y="25.4" width="2.8" height="2.4" rx="1"/>
      <rect class="av-bar b2" x="18.6" y="25.4" width="2.8" height="2.4" rx="1"/>
      <rect class="av-bar b3" x="22.9" y="25.4" width="2.8" height="2.4" rx="1"/>
    </g>
    <rect class="av-neck" x="16" y="29" width="8" height="3" rx="1.2"/>
  </g>
</svg>`;

const USER_SVG = `
<svg viewBox="0 0 40 40" class="av-svg" aria-hidden="true">
  <circle class="us-halo" cx="20" cy="20" r="18.2" fill="none" stroke-width="1.4"/>
  <g class="us-person">
    <path class="us-body" d="M8.2 34c.9-6.4 5.6-9.8 11.8-9.8S30.9 27.6 31.8 34z"/>
    <circle class="us-head" cx="20" cy="15.2" r="6.4"/>
    <path class="us-hair" d="M13.4 14.4c-.2-4.4 2.8-7 6.6-7 3.9 0 6.8 2.6 6.6 7-1.5-1.9-3.7-2.9-6.6-2.9s-5.1 1-6.6 2.9z"/>
    <g class="us-eyes">
      <circle class="us-eye" cx="17.5" cy="15.6" r="0.95"/>
      <circle class="us-eye" cx="22.5" cy="15.6" r="0.95"/>
    </g>
    <path class="us-smile" d="M17.6 18.4q2.4 2 4.8 0" fill="none" stroke-width="1.1" stroke-linecap="round"/>
  </g>
  <circle class="us-dot-ring" cx="31.2" cy="9.2" r="3.4"/>
  <circle class="us-dot" cx="31.2" cy="9.2" r="2.6"/>
</svg>`;

function phase() {
  return `${-(Date.now() % 6000)}ms`;
}

/** @param {'idle'|'thinking'|'working'} mode */
export function agentAvatar(mode = 'idle') {
  const node = el('div', {
    class: `msg-avatar msg-avatar-agent av-agent is-${mode}`,
    title: mode === 'idle' ? 'HLab Agent' : mode === 'thinking' ? 'HLab Agent \u00b7 pensando' : 'HLab Agent \u00b7 trabajando',
  });
  node.innerHTML = AGENT_SVG;
  node.style.setProperty('--av-phase', phase());
  return node;
}

export function userAvatar() {
  const node = el('div', { class: 'msg-avatar msg-avatar-user av-user', title: 'T\u00fa' });
  node.innerHTML = USER_SVG;
  node.style.setProperty('--av-phase', phase());
  return node;
}

/** Burbuja "escribiendo": avatar trabajando + tres puntos que ondulan. */
export function typingIndicator(label = 'pensando\u2026') {
  return el('article', { class: 'msg msg-assistant chat-typing' }, [
    agentAvatar('thinking'),
    el('div', { class: 'msg-body' }, [
      el('div', { class: 'bubble typing-bubble' }, [
        el('span', { class: 'typing-dots' }, [el('i'), el('i'), el('i')]),
        el('span', { class: 'typing-label', text: label }),
      ]),
    ]),
  ]);
}
