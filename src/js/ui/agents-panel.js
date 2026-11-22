'use strict';

/**
 * Agents dashboard: main agents with their subagents nested below, each row
 * showing state, agent, model, current tool, files touched and elapsed time.
 * Clicking a row selects the session.
 */

import { el, clear } from '../util/dom.js';
import {
  subscribe, state, activeSession, officeSessions, runtimeOf, permissionsOf,
  activityOf, changedFilesOf, mcpServersOf,
} from '../store.js';
import { uiIcon } from '../util/ui-icons.js';

const STATE_LABEL = {
  idle: { icon: 'coffee', text: 'en espera' },
  think: { icon: 'think', text: 'pensando' },
  code: { icon: 'code', text: 'editando' },
  terminal: { icon: 'terminal', text: 'ejecutando' },
  read: { icon: 'read', text: 'leyendo' },
  search: { icon: 'search', text: 'buscando' },
  mcp: { icon: 'mcp', text: 'usando MCP' },
  wait: { icon: 'lock', text: 'esperando permiso' },
  meet: { icon: 'agents', text: 'terminado' },
  error: { icon: 'alert', text: 'error' },
};

function stateOf(runtime, permissions) {
  if (permissions > 0) return 'wait';
  if (runtime.busy) {
    const name = String(runtime.tool || '').toLowerCase();
    if (/^(bash|shell|exec|run)/.test(name)) return 'terminal';
    if (/^(read|view|cat)/.test(name)) return 'read';
    if (/^(glob|grep|search|find|list|webfetch|websearch)/.test(name)) return 'search';
    if (/^(edit|multiedit|patch|apply_patch|write|create)/.test(name)) return 'code';
    return 'think';
  }
  if (runtime.errorAt && Date.now() - runtime.errorAt < 60000) return 'error';
  if (runtime.doneAt && Date.now() - runtime.doneAt < 7000) return 'meet';
  return 'idle';
}

/** Main sessions first, each followed by its own subagents. */
function ordered(sessions) {
  const ids = new Set(sessions.map((session) => session.id));
  const roots = sessions.filter((session) => !session.parentID || !ids.has(session.parentID));
  const out = [];
  for (const root of roots) {
    out.push({ session: root, child: false });
    sessions.filter((item) => item.parentID === root.id).forEach((item) => out.push({ session: item, child: true }));
  }
  return out;
}

export function mountAgents(container, handlers) {
  if (!container) container = document.getElementById('panel-body');
  if (!container) return { destroy() {} };

  function render() {
    clear(container);
    const sessions = officeSessions();
    const active = activeSession();
    const rows = ordered(sessions);
    const working = sessions.filter((session) => runtimeOf(session.id).busy).length;
    const subs = rows.filter((row) => row.child).length;

    container.appendChild(el('div', { class: 'context-head' }, [
      el('h3', { text: 'Agentes y subagentes' }),
      el('p', { class: 'muted tiny', text: 'Cada agente principal con sus subagentes debajo. Haz clic en una fila para abrir esa sesión.' }),
    ]));

    if (sessions.length === 0) {
      container.appendChild(el('div', { class: 'empty-state' }, [
        uiIcon('agents', 28),
        el('div', { text: 'No hay sesiones' }),
      ]));
      return;
    }

    container.appendChild(el('div', { class: 'agents-summary' }, [
      el('span', { class: 'agent-chip', text: `${rows.length - subs} principal(es)` }),
      el('span', { class: 'agent-chip is-tool', text: `${subs} subagente(s)` }),
      el('span', { class: `agent-chip ${working ? 'is-warn' : ''}`, text: `${working} trabajando` }),
    ]));

    const list = el('div', { class: 'agent-list' });
    for (const { session, child } of rows) {
      const runtime = runtimeOf(session.id);
      const permissions = permissionsOf(session.id).length;
      const activity = activityOf(session.id);
      const files = changedFilesOf(session.id);
      const key = stateOf(runtime, permissions);
      const label = STATE_LABEL[key] || STATE_LABEL.idle;
      const elapsed = runtime.busy && runtime.startedAt
        ? `${Math.round((Date.now() - runtime.startedAt) / 1000)}s`
        : '';
      const model = session.model
        ? `${session.model.providerID ? `${session.model.providerID}/` : ''}${session.model.id || session.model.modelID || ''}`
        : (state.selection?.modelID
          ? `${state.selection.providerID ? `${state.selection.providerID}/` : ''}${state.selection.modelID}`
          : '—');
      const agentName = session.agent || (child ? 'subagente' : state.selection?.agent || 'build');

      list.appendChild(el('div', {
        class: `agent-row ${child ? 'is-child' : ''} ${active && active.id === session.id ? 'is-active' : ''} is-${key}`,
        role: 'button',
        tabindex: '0',
        'data-role': child ? 'subagent' : 'primary',
        onClick: () => handlers.onSelectSession?.(session.id),
        onKeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handlers.onSelectSession?.(session.id);
          }
        },
      }, [
        el('div', { class: 'agent-row-head' }, [
          el('span', { class: 'agent-state-icon' }, [uiIcon(label.icon, 16)]),
          el('span', { class: 'agent-row-title', text: session.title || session.id, title: session.title }),
          el('span', { class: 'agent-state-text', text: label.text }),
          elapsed ? el('span', { class: 'agent-elapsed', text: elapsed }) : null,
        ]),
        el('div', { class: 'agent-row-meta' }, [
          el('span', { class: 'agent-chip', title: 'Agente', text: `agente ${agentName}` }),
          el('span', {
            class: `agent-chip ${child ? 'is-subagent' : 'is-primary'}`,
            title: child ? 'Subagente creado con la herramienta task' : 'Sesión principal',
            text: child ? 'subagente' : 'principal',
          }),
          el('span', { class: 'agent-chip', title: 'Modelo', text: `modelo ${model}` }),
          runtime.tool
            ? el('span', { class: 'agent-chip is-tool', title: 'Herramienta en curso' }, [
              uiIcon('wrench', 12),
              el('span', { text: runtime.tool }),
            ])
            : null,
          el('span', { class: 'agent-chip', text: `${activity.length} acciones` }),
          el('span', { class: 'agent-chip', text: `${files.length} archivos` }),
          permissions ? el('span', { class: 'agent-chip is-warn', text: `${permissions} permiso(s)` }) : null,
        ]),
        files.length
          ? el('div', { class: 'agent-row-files' }, files.slice(-4).map((file) => el('span', {
            class: 'agent-file',
            title: file.file,
            text: file.file,
          })))
          : null,
        runtime.errorMessage ? el('div', { class: 'agent-row-error', text: runtime.errorMessage }) : null,
      ]));
    }
    container.appendChild(list);

    container.appendChild(el('div', { class: 'agents-footer' }, [
      el('span', { class: 'muted tiny', text: `${sessions.length} sesión(es) · ${mcpServersOf().length} MCP` }),
    ]));
  }

  const unsubscribe = subscribe(
    ['sessions', 'subagents', 'activeSessionId', 'runtime', 'permissions', 'activity', 'changedFiles', 'mcpServers'],
    render,
  );
  render();
  return { destroy: unsubscribe, render };
}
