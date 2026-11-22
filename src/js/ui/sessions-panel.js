'use strict';

/**
 * Sessions view: the list of sessions of the current project with their live
 * state. It lives in the side panel (activity bar -> Sesiones).
 *
 * The markup uses the `sp-*` namespace on purpose: several older stylesheets
 * (layout.css, office-v2.css, design.css) still fight over `.session-*`, so the
 * cards get their own classes and a single stylesheet loaded last.
 *
 * A root session and its subagents form one group: the subagents are compact
 * rows nested inside the parent card, not full cards of their own.
 */

import { el, clear } from '../util/dom.js';
import {
  subscribe, state, runtimeOf, permissionsOf, sessionById, isSubagentLive,
  workingProjects,
} from '../store.js';
import { basename, formatRelative } from '../util/format.js';
import { uiIcon } from '../util/ui-icons.js';

export function mountSessions(container, handlers) {
  const projectName = el('span', { class: 'project-name', text: 'Sin proyecto' });
  const recentRoot = el('div', { class: 'recent-projects' });
  const list = el('ul', { class: 'session-list sp-list' });
  // Which roots have their subagents expanded (default: open while one works).
  const openState = new Map();

  const projectButton = el('button', { class: 'project-button', type: 'button' }, [
    uiIcon('folder', 17),
    projectName,
  ]);
  projectButton.addEventListener('click', () => handlers.onOpenProject());

  container.append(
    el('div', { class: 'sidebar-project' }, [projectButton, recentRoot]),
    el('div', { class: 'sidebar-head' }, [
      el('h2', { text: 'Sesiones' }),
      el('button', { class: 'btn-small btn-icon', type: 'button', title: 'Nueva sesión (Ctrl+N)', onClick: () => handlers.onNewSession() }, [uiIcon('plus', 14), el('span', { text: 'Nueva' })]),
    ]),
    list,
  );

  function renderProject() {
    const { project, settings } = state;
    projectName.textContent = project.dir ? basename(project.dir) : 'Sin proyecto';
    projectName.title = project.dir || 'Elige una carpeta de proyecto';

    clear(recentRoot);
    const working = new Map(workingProjects().map((item) => [item.dir, item]));
    const recents = (settings.recentProjects || [])
      .filter((item) => item.directory !== project.dir)
      .slice(0, 3);
    for (const item of recents) {
      const activeWork = working.get(item.directory);
      recentRoot.appendChild(el('button', {
        class: `recent-item ${activeWork ? 'has-work' : ''}`,
        type: 'button',
        title: activeWork
          ? `${item.directory}\nTrabajando en otro proyecto (${activeWork.busy} sesión(es))`
          : item.directory,
        onClick: () => handlers.onOpenProject(item.directory),
      }, [
        uiIcon('external', 13),
        el('span', { class: 'sp-recent-name', text: basename(item.directory) }),
        activeWork
          ? el('span', {
            class: 'sp-work-mark',
            title: `${activeWork.busy} sesión(es) trabajando`,
            'aria-label': `${activeWork.busy} sesiones trabajando en ${basename(item.directory)}`,
          }, [el('span', { class: 'sp-work-dot' }), el('span', { class: 'sp-work-count', text: String(activeWork.busy) })])
          : null,
      ]));
    }
  }

  function statusClass(session) {
    const runtime = runtimeOf(session.id);
    if (permissionsOf(session.id).length > 0) return 'is-permission';
    if (runtime.busy) return 'is-busy';
    if (runtime.outcome === 'failed') return 'is-error';
    if (runtime.outcome === 'succeeded') return 'is-done';
    return '';
  }

  function statusLabel(session, isChild) {
    const runtime = runtimeOf(session.id);
    const pending = permissionsOf(session.id).length;
    if (runtime.busy) return runtime.tool ? `trabajando · ${runtime.tool}` : 'trabajando…';
    if (pending > 0) return `${pending} permiso${pending === 1 ? '' : 's'}`;
    if (isChild) {
      // En una fila compacta, «ahora» no aporta nada y roba sitio al título.
      return runtime.doneAt ? 'finalizado' : '';
    }
    return session.time?.updated ? formatRelative(session.time.updated) : '';
  }

  function statusNode(session, isChild) {
    const label = statusLabel(session, isChild);
    if (!label && isChild) return null;
    const stateClass = statusClass(session);
    return el('span', {
      class: `sp-status ${stateClass}`.trim(),
      title: label,
    }, [
      el('span', { class: 'sp-dot' }),
      el('span', { class: 'sp-status-text', text: label || 'en espera' }),
    ]);
  }

  function deleteButton(session, size) {
    return el('button', {
      class: 'sp-delete',
      type: 'button',
      'aria-label': 'Eliminar sesión',
      title: 'Eliminar sesión',
      onClick: (event) => {
        event.stopPropagation();
        handlers.onDeleteSession(session);
      },
    }, [uiIcon('trash', size)]);
  }

  function rowOf(session, options = {}) {
    const { child = false, count = 0, open = false, working = 0, onToggle = null } = options;
    const active = session.id === state.activeSessionId;
    const agentName = String(session.agent || '');
    const title = session.title || 'Sesión sin título';
    const stateClass = statusClass(session);
    const select = () => handlers.onSelectSession(session.id);
    const onKeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    };

    if (child) {
      const meta = el('div', { class: 'sp-child-meta' });
      if (agentName) meta.appendChild(el('span', { class: 'sp-agent', text: agentName, title: agentName }));
      const childStatus = statusNode(session, true);
      if (childStatus) meta.appendChild(childStatus);

      return el('li', {
        class: `session-item sp-item is-child ${active ? 'is-active' : ''} ${stateClass}`.trim(),
        'data-session': session.id,
        'data-role': 'subagent',
        role: 'button',
        tabindex: '0',
        title: `${title}${agentName ? ` · ${agentName}` : ''}`,
        onClick: select,
        onKeydown,
      }, [
        el('div', { class: 'sp-child-row' }, [
          el('span', { class: 'sp-title sp-child-title', text: title, title }),
          meta.children.length > 0 ? meta : null,
        ]),
      ]);
    }

    const head = el('div', { class: 'sp-head' });
    if (count > 0) {
      head.appendChild(el('button', {
        class: `sp-toggle ${working > 0 ? 'has-work' : ''}`.trim(),
        type: 'button',
        title: `${open ? 'Ocultar' : 'Mostrar'} ${count} subagente${count === 1 ? '' : 's'}${working > 0 ? ` · ${working} trabajando` : ''}`,
        'aria-expanded': String(open),
        text: `${open ? '▾' : '▸'} ${count}`,
        onClick: (event) => {
          event.stopPropagation();
          onToggle?.();
        },
      }));
    }
    head.appendChild(el('span', { class: 'sp-title', text: title, title }));
    head.appendChild(deleteButton(session, 15));

    const sub = el('div', { class: 'sp-sub' });
    sub.appendChild(el('span', {
      class: 'sp-role is-primary',
      text: 'AGENTE',
      title: `Agente principal: ${agentName || 'sin asignar'}`,
    }));
    if (agentName) {
      sub.appendChild(el('span', { class: 'sp-agent', text: agentName, title: agentName }));
    }
    sub.appendChild(statusNode(session, false));

    return el('div', {
      class: `session-item sp-item ${active ? 'is-active' : ''} ${stateClass}`.trim(),
      'data-session': session.id,
      'data-role': 'primary',
      role: 'button',
      tabindex: '0',
      title,
      onClick: select,
      onKeydown,
    }, [head, sub]);
  }

  const rowCache = new Map();
  const groupCache = new Map();

  function rowSig(session, options = {}) {
    const parent = session.parentID ? sessionById(session.parentID) : null;
    const runtime = runtimeOf(session.id);
    return [
      session.id, session.title, session.agent, session.id === state.activeSessionId,
      statusClass(session), statusLabel(session, options.child), runtime.tool || '',
      options.count, options.open, options.working, options.child, parent?.title,
    ].join('|');
  }

  /** Reuses a row node when nothing that it paints changed. */
  function cachedRow(session, options = {}) {
    const key = `${session.id}:${options.child ? 'c' : 'r'}`;
    const sig = rowSig(session, options);
    const hit = rowCache.get(key);
    if (hit && hit.sig === sig) return hit;
    const entry = { sig, node: rowOf(session, options) };
    rowCache.set(key, entry);
    return entry;
  }

  function cleanRow(root, finishedCount) {
    const text = `Archivar ${finishedCount} finalizado${finishedCount === 1 ? '' : 's'}`;
    const key = `clean:${root.id}`;
    const hit = rowCache.get(key);
    if (hit && hit.sig === text) return hit.node;
    const node = el('li', { class: 'session-clean-row' }, [el('button', {
      class: 'session-clean',
      type: 'button',
      title: 'Archiva los subagentes que ya terminaron',
      text,
      onClick: (event) => {
        event.stopPropagation();
        handlers.onCleanSubagents?.(root);
      },
    })]);
    rowCache.set(key, { sig: text, node });
    return node;
  }

  function renderSessions() {
    const sessions = state.sessions;
    if (sessions.length === 0) {
      rowCache.clear();
      groupCache.clear();
      list.replaceChildren(el('li', { class: 'empty-state sp-empty' }, [
        uiIcon('sessions', 24),
        el('div', { text: 'Todavía no hay sesiones.' }),
      ]));
      return;
    }

    const groups = [];
    const usedRows = new Set();
    const usedGroups = new Set();

    for (const root of sessions) {
      const children = state.subagents.filter((item) => item.parentID === root.id);
      const live = children.filter(isSubagentLive);
      const finished = children.filter((item) => !isSubagentLive(item));
      const open = openState.has(root.id) ? openState.get(root.id) : live.length > 0;
      const toggle = () => { openState.set(root.id, !open); renderSessions(); };
      const working = live.filter((child) => runtimeOf(child.id).busy
        || permissionsOf(child.id).length > 0).length;

      const parent = cachedRow(root, { count: children.length, open, working, onToggle: toggle });
      const childRows = open
        ? [...live, ...finished].map((child) => cachedRow(child, { child: true }))
        : [];
      // El riel del grupo también avisa cuando el trabajo está en un subagente.
      const groupState = live.some((child) => permissionsOf(child.id).length > 0)
        ? 'is-permission'
        : live.some((child) => runtimeOf(child.id).busy)
          ? 'is-busy'
          : statusClass(root);
      const groupSig = [
        parent.sig, open, working, groupState, live.length, finished.length,
        childRows.map((entry) => entry.sig).join('~'),
      ].join('|');

      let group = groupCache.get(root.id);
      if (!group || group.sig !== groupSig) {
        const active = root.id === state.activeSessionId;
        const node = el('li', {
          class: `sp-group ${groupState} ${active ? 'is-active' : ''}`.trim(),
          'data-root': root.id,
        }, [parent.node]);
        if (open && (childRows.length > 0 || finished.length > 0)) {
          const kids = el('ul', { class: 'sp-children' }, childRows.map((entry) => entry.node));
          if (finished.length > 0) kids.appendChild(cleanRow(root, finished.length));
          node.appendChild(kids);
        }
        group = { sig: groupSig, node };
        groupCache.set(root.id, group);
      }

      usedRows.add(parent.node);
      for (const entry of childRows) usedRows.add(entry.node);
      // The clean row lives inside the group too, so keep it in the cache.
      if (open && finished.length > 0) {
        const clean = rowCache.get(`clean:${root.id}`);
        if (clean) usedRows.add(clean.node);
      }
      usedGroups.add(group.node);
      groups.push(group.node);
    }

    for (const [key, entry] of rowCache) {
      if (!usedRows.has(entry.node)) rowCache.delete(key);
    }
    for (const [key, entry] of groupCache) {
      if (!usedGroups.has(entry.node)) groupCache.delete(key);
    }

    const current = [...list.children];
    if (current.length === groups.length && current.every((node, index) => node === groups[index])) return;
    list.replaceChildren(...groups);
  }

  function render() {
    renderProject();
    renderSessions();
  }

  const unsubscribe = subscribe(
    ['sessions', 'subagents', 'activeSessionId', 'project', 'settings', 'runtime', 'permissions', 'questions', 'projects'],
    render,
  );
  render();
  return { destroy: unsubscribe, render };
}
