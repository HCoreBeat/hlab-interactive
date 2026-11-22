'use strict';

/**
 * Activity bar: one button per view, like VS Code. Each button opens its view
 * in the side panel; the badge shows live information (pending permissions,
 * errors, files changed…).
 */

import { el, clear } from '../util/dom.js';
import {
  subscribe, state, permissionsOf, changedFilesOf, activityOf, mcpServersOf, officeSessions,
  otherProjectWork,
} from '../store.js';
import { uiIcon } from '../util/ui-icons.js';

/**
 * @param {object} options
 * @param {(view: string) => void} options.onSelect
 * @param {() => void} options.onToggleOffice
 */
export function mountActivityBar({ onSelect, onToggleOffice }) {
  const root = document.getElementById('activity-bar');
  if (!root) return { destroy() {} };

  const VIEWS = [
    { id: 'sessions', icon: 'sessions', label: 'Sesiones', key: '1' },
    { id: 'agents', icon: 'agents', label: 'Agentes', key: '2' },
    { id: 'activity', icon: 'activity', label: 'Actividad', key: '3' },
    { id: 'files', icon: 'files', label: 'Archivos', key: '4' },
    { id: 'terminal', icon: 'terminal', label: 'Terminal', key: '5' },
    { id: 'context', icon: 'context', label: 'Contexto', key: '6' },
    { id: 'mcp', icon: 'mcp', label: 'MCP', key: '7' },
    { id: 'inspector', icon: 'inspector', label: 'Inspector', key: '8' },
    { id: 'notes', icon: 'notes', label: 'Notas', key: '9' },
  ];

  const buttons = new Map();

  function build() {
    clear(root);
    buttons.clear();
    for (const view of VIEWS) {
      const badge = el('span', { class: 'activity-badge', hidden: true });
      const otherWork = view.id === 'sessions'
        ? el('span', { class: 'sp-activity-mark', hidden: true })
        : null;
      const button = el('button', {
        class: 'activity-button',
        type: 'button',
        title: `${view.label} (Ctrl+${view.key})`,
        'aria-label': view.label,
        'data-view': view.id,
        onClick: () => onSelect(view.id),
      }, [
        uiIcon(view.icon),
        badge,
        otherWork,
      ]);
      buttons.set(view.id, { button, badge, otherWork, view });
      root.appendChild(button);
    }

    root.appendChild(el('div', { class: 'activity-separator' }));

    const officeBadge = el('span', { class: 'activity-badge', hidden: true });
    const officeButton = el('button', {
      class: 'activity-button',
      type: 'button',
      title: 'Oficina de agentes (Ctrl+Shift+O)',
      'aria-label': 'Oficina de agentes',
      'data-view': 'office',
      onClick: () => onToggleOffice(),
    }, [
      uiIcon('office'),
      officeBadge,
    ]);
    buttons.set('office', { button: officeButton, badge: officeBadge, view: { id: 'office', label: 'Oficina de agentes' } });
    root.appendChild(officeButton);
  }

  function setBadge(id, value, quiet, description = '', tone = '') {
    const entry = buttons.get(id);
    if (!entry) return;
    if (!value) {
      entry.badge.hidden = true;
      entry.badge.removeAttribute('title');
      entry.badge.removeAttribute('aria-label');
      return;
    }
    entry.badge.hidden = false;
    entry.badge.textContent = String(value);
    entry.badge.dataset.tone = tone || (quiet ? 'busy' : 'warn');
    entry.badge.title = description || `${value}`;
    entry.button.setAttribute('aria-label', description ? `${entry.view.label}: ${description}` : entry.view.label);
  }

  function render() {
    const session = state.activeSession;
    const active = state.activeSessionId;
    const permissions = active ? permissionsOf(active).length : 0;
    const live = officeSessions();
    const errors = live.filter((item) => runtimeFailed(item.id)).length;
    const files = active ? changedFilesOf(active).length : 0;
    const actions = active ? activityOf(active).length : 0;

    for (const [id, entry] of buttons) {
      entry.button.classList.toggle('is-active', id === 'office'
        ? state.ui.officeOpen
        : state.ui.railOpen && state.ui.railView === id);
    }

    setBadge('sessions', state.sessions.length || 0, true, `${state.sessions.length} sesiones`);
    const busyCount = live.filter((item) => isBusy(item.id)).length;
    setBadge('agents', busyCount, true, `${busyCount} agente(s) trabajando`);
    setBadge('activity', actions || 0, true, `${actions} eventos recientes`);
    setBadge('files', files || 0, true, `${files} archivos modificados`);
    setBadge('terminal', state.shells.length || 0, true, `${state.shells.length} terminal(es)`);
    setBadge('context', 0, true);
    setBadge('mcp', mcpServersOf().length || 0, true, `${mcpServersOf().length} servidores MCP`);
    setBadge('inspector', state.events.length || 0, true, `${state.events.length} eventos del servidor`);
    setBadge('office', busyCount, true, `${busyCount} agente(s) trabajando en la oficina`);
    for (const id of ['sessions', 'activity', 'files', 'terminal', 'context', 'mcp', 'inspector']) setBadge(id, 0);
    const pendingNotes = (state.settings?.projectNotes?.[state.project.dir] || []).filter((note) => !note.done).length;
    setBadge('notes', pendingNotes, true, `${pendingNotes} nota(s) pendiente(s)`);
    if (permissions > 0) setBadge('agents', permissions, false, `${permissions} permiso(s) pendiente(s)`, 'warn');
    if (errors > 0) setBadge('activity', errors, false, `${errors} error(es) reciente(s)`, 'error');

    // Punto ámbar en "Sesiones" cuando hay turnos vivos en OTRAS carpetas.
    const other = otherProjectWork();
    const sessionsButton = buttons.get('sessions');
    if (sessionsButton?.otherWork) {
      const total = other.busy + other.waiting;
      sessionsButton.otherWork.hidden = total === 0;
      sessionsButton.otherWork.title = total > 0
        ? `${total} sesión(es) trabajando en otros proyectos (no se detienen al cambiar de carpeta)`
        : '';
      if (total > 0) {
        sessionsButton.button.setAttribute(
          'aria-label',
          `Sesiones: ${total} sesiones trabajando en otros proyectos`,
        );
      }
    }
  }

  function runtimeFailed(sessionID) {
    const runtime = state.runtime[sessionID];
    return runtime && runtime.outcome === 'failed' && Date.now() - (runtime.errorAt || 0) < 120000;
  }

  function isBusy(sessionID) {
    const runtime = state.runtime[sessionID];
    return Boolean(runtime && runtime.busy);
  }

  build();
  const unsubscribe = subscribe(
    ['sessions', 'subagents', 'activeSessionId', 'runtime', 'permissions', 'questions', 'activity', 'changedFiles', 'shells', 'events', 'mcpServers', 'ui', 'settings', 'project', 'projects'],
    render,
  );
  render();

  return { destroy: unsubscribe, render };
}
