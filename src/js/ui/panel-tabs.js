'use strict';

/**
 * Rail router: opens the views of the activity bar in the side panel and keeps
 * the side panel state (open/closed) in sync with the store.
 */

import { state, setUI, subscribe } from '../store.js';
import { mountPanelWorkspace, PANELS, PANEL_KEYS, openViewMenu } from './panel-workspace.js';

let workspace = null;

/** Opens a view of the activity bar in the side panel. */
export function showTab(view) {
  if (!workspace) return;
  setUI({ railOpen: true, railView: view });
  workspace.openView(view);
}

/** The mounted panel instance (files, terminal…). */
export function activePanelInstance() {
  return workspace?.activeInstance?.() || null;
}

export function applyPanelState() {
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.toggle('rail-closed', !state.ui.railOpen);
  app.classList.toggle('office-collapsed', !state.ui.officeOpen);
}

/**
 * @param {HTMLElement} body container of the side panel
 * @param {object} handlers shared UI handlers
 * @param {(layout: object) => void} onLayoutChange called when the user rearranges
 */
export function initPanelRouter(body, handlers, onLayoutChange) {
  workspace = mountPanelWorkspace(body, handlers, { onLayoutChange });

  document.getElementById('side-panel-add')?.addEventListener('click', (event) => {
    openViewMenu(event.currentTarget, (view) => {
      if (view === '__column__') {
        workspace.addColumn();
        return;
      }
      setUI({ railOpen: true, railView: view });
      workspace.addView(view, 0);
    });
  });

  document.getElementById('side-panel-close')?.addEventListener('click', () => {
    setUI({ railOpen: false });
  });

  const unsubscribe = subscribe(['ui'], () => {
    applyPanelState();
    if (state.ui.railOpen && state.ui.railView) {
      const column = workspace?.layout?.columns?.[0];
      if (column && !column.views.includes(state.ui.railView)) {
        workspace.openView(state.ui.railView);
      }
    }
  });

  applyPanelState();
  return () => {
    unsubscribe();
    workspace?.destroy();
    workspace = null;
  };
}

export { PANELS, PANEL_KEYS };
