'use strict';

/**
 * Side panel workspace, VS Code style: one or more columns, each one showing a
 * view (Sesiones, Agentes, Archivos, Terminal…). Columns can be added, resized
 * and closed, and the arrangement is saved in the settings.
 */

import { el, clear } from '../util/dom.js';
import { subscribe, state } from '../store.js';
import { uiIcon } from '../util/ui-icons.js';
import { mountSessions } from './sessions-panel.js';
import { mountAgents } from './agents-panel.js';
import { mountActivity } from './activity.js';
import { mountFiles } from './files.js';
import { mountTerminal } from './terminal.js';
import { mountFolderManager } from './folder-manager.js';
import { mountMCPanel } from './mcp-panel.js';
import { mountInspector } from './inspector.js';
import { mountNotesPanel } from './notes-panel.js';
import { mountGitPanel } from './git-panel.js';

export const PANELS = {
  sessions: { label: 'Sesiones', icon: 'sessions', mount: mountSessions },
  agents: { label: 'Agentes', icon: 'agents', mount: mountAgents },
  activity: { label: 'Actividad', icon: 'activity', mount: mountActivity },
  files: { label: 'Archivos', icon: 'files', mount: mountFiles },
  terminal: { label: 'Terminal', icon: 'terminal', mount: mountTerminal },
  context: { label: 'Contexto', icon: 'context', mount: mountFolderManager },
  mcp: { label: 'MCP', icon: 'mcp', mount: mountMCPanel },
  inspector: { label: 'Inspector', icon: 'inspector', mount: mountInspector },
  notes: { label: 'Notas', icon: 'notes', mount: mountNotesPanel },
  git: { label: 'Source Control', icon: 'git', mount: mountGitPanel },
};

export const PANEL_KEYS = Object.keys(PANELS);

const DEFAULT_LAYOUT = {
  columns: [{ views: ['agents'], width: 100 }],
};

export function readLayout() {
  const saved = state.settings?.panelLayout;
  const columns = (saved?.columns || [])
    .slice(0, 3)
    .map((column) => {
      const views = (column.views || []).filter((view) => PANELS[view]);
      if (views.length === 0) return null;
      return { views, width: Number(column.width) || 50 };
    })
    .filter(Boolean);
  return { columns: columns.length ? columns : [{ views: ['agents'], width: 100 }] };
}

export function mountPanelWorkspace(root, handlers, { onLayoutChange } = {}) {
  let layout = readLayout();
  const mounted = new Map();
  let dragged = null;

  function save() {
    onLayoutChange?.(layout);
  }

  function destroyAll() {
    for (const instance of mounted.values()) instance?.destroy?.();
    mounted.clear();
  }

  function mountView(view, container) {
    const previous = mounted.get(view);
    previous?.destroy?.();
    const instance = PANELS[view].mount(container, handlers);
    mounted.set(view, instance);
    return instance;
  }

  function render() {
    destroyAll();
    clear(root);
    root.classList.add('panel-workspace');
    root.style.gridTemplateColumns = layout.columns
      .map((column) => `${Math.max(18, column.width || 100)}fr`)
      .join(' ');

    const title = document.getElementById('side-panel-title');
    const firstView = layout.columns[0]?.views?.[0];
    if (title) title.textContent = firstView ? PANELS[firstView].label : '';

    layout.columns.forEach((column, columnIndex) => {
      const columnNode = el('div', { class: 'panel-column' });
      const header = el('div', { class: 'panel-column-tabs' });

      for (const view of column.views) {
        const meta = PANELS[view];
        if (column.views.length < 2) break; // with a single view the header is enough
        const button = el('button', {
          class: 'panel-column-tab is-active',
          type: 'button',
          draggable: 'true',
          title: meta.label,
        }, [
          el('span', { class: 'panel-tab-icon' }, [uiIcon(meta.icon, 15)]),
          el('span', { class: 'panel-tab-label', text: meta.label }),
        ]);
        button.addEventListener('click', () => {
          if (column.views.length > 1) {
            column.views = column.views.filter((item) => item !== view);
            if (column.views.length === 0) column.views = ['agents'];
            save();
            render();
          }
        });
        button.addEventListener('dragstart', (event) => {
          dragged = { view, from: columnIndex };
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', view);
        });
        button.addEventListener('dragover', (event) => event.preventDefault());
        button.addEventListener('drop', (event) => {
          event.preventDefault();
          if (!dragged) return;
          moveView(dragged.view, dragged.from, columnIndex);
          dragged = null;
        });
        header.appendChild(button);
      }

      const body = el('div', { class: 'panel-column-body' });
      columnNode.append(header, body);
      root.appendChild(columnNode);

      mountView(column.views[0], body);
    });

    // Splitter between columns: drag to change their ratio.
    for (let index = 1; index < layout.columns.length; index += 1) {
      const grip = el('div', { class: 'panel-column-grip', title: 'Arrastra para redimensionar' });
      grip.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        grip.setPointerCapture(event.pointerId);
        const startX = event.clientX;
        const total = root.getBoundingClientRect().width || 1;
        const origin = layout.columns.map((column) => column.width || 50);
        const onMove = (moveEvent) => {
          const delta = ((moveEvent.clientX - startX) / total) * 100;
          const left = origin[index - 1] + delta;
          const right = origin[index] - delta;
          if (left < 18 || right < 18) return;
          layout.columns[index - 1].width = Math.round(left);
          layout.columns[index].width = Math.round(right);
          root.style.gridTemplateColumns = layout.columns
            .map((column) => `${Math.max(18, column.width || 100)}fr`)
            .join(' ');
        };
        const onUp = () => {
          grip.removeEventListener('pointermove', onMove);
          grip.removeEventListener('pointerup', onUp);
          save();
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', onUp);
      });
      root.appendChild(grip);
    }
  }

  function moveView(view, fromIndex, toIndex) {
    const from = layout.columns[fromIndex];
    const to = layout.columns[toIndex];
    if (!from || !to) return;
    from.views = from.views.filter((item) => item !== view);
    if (from.views.length === 0) from.views = ['agents'];
    if (!to.views.includes(view)) to.views.push(view);
    save();
    render();
  }

  /**
   * Shows a view in the first column (it replaces the current one). The user
   * can add more columns or more views per column from the "+" menu.
   */
  function openView(view) {
    if (!PANELS[view]) return;
    if (!layout.columns.length) layout.columns.push({ views: [view], width: 100 });
    layout.columns[0].views = [view];
    save();
    render();
  }

  function addView(view, columnIndex = 0) {
    if (!PANELS[view]) return;
    const column = layout.columns[columnIndex] || layout.columns[0];
    if (!column.views.includes(view)) column.views.push(view);
    save();
    render();
  }

  function addColumn() {
    layout.columns.push({ views: ['activity'], width: 50 });
    save();
    render();
  }

  render();

  const unsubscribe = subscribe(['settings'], () => {
    const next = readLayout();
    if (JSON.stringify(next) !== JSON.stringify(layout)) {
      layout = next;
      render();
    }
  });

  return {
    destroy() {
      unsubscribe();
      destroyAll();
    },
    render,
    addView,
    addColumn,
    openView,
    get layout() { return layout; },
    activeInstance() {
      const column = layout.columns[0];
      return column ? mounted.get(column.views[0]) || null : null;
    },
  };
}

/** Small menu with the available views. */
export function openViewMenu(anchor, onPick) {
  document.querySelector('.view-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'panel-add-menu view-menu';
  for (const key of PANEL_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-add-item';
    button.textContent = `${PANELS[key].icon}  ${PANELS[key].label}`;
    button.addEventListener('click', () => {
      menu.remove();
      onPick(key);
    });
    menu.appendChild(button);
  }
  const split = document.createElement('button');
  split.type = 'button';
  split.className = 'panel-add-item is-split';
  split.textContent = '▥  Abrir en otra columna';
  split.addEventListener('click', () => {
    menu.remove();
    onPick('__column__');
  });
  menu.appendChild(split);
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 200))}px`;
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 240)}px`;
  const close = (event) => {
    if (!menu.contains(event.target)) {
      menu.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
  return menu;
}
