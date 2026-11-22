'use strict';

/**
 * Context panel for a session.
 *
 * opencode sessions own a single `location.directory`, so extra folders are
 * kept by the app (settings.sessionFolders) and used in two ways:
 *  - the folder is registered as a location so the server can browse it,
 *  - the folder list is injected in the prompt preamble so the agent knows
 *    the extra context exists.
 */

import { el, clear } from '../util/dom.js';
import { subscribe, state, activeSession, contextFoldersOf } from '../store.js';
import { listDirectory, readFile, registerDirectory } from '../api.js';
import { basename } from '../util/format.js';
import { toast } from './toast.js';

export function mountFolderManager(container, handlers) {
  if (!container) container = document.getElementById('panel-body');
  let mode = 'list';
  let browseRoot = null;
  let browsePath = '';
  let browseCache = new Map();
  let previewText = '';
  let previewName = '';

  function foldersOf(session) {
    const extra = contextFoldersOf(session.id);
    const base = session.location?.directory || state.project.dir;
    return { base, extra };
  }

  function render() {
    clear(container);
    const session = activeSession();
    if (!session) {
      container.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { text: '📁' }),
        el('div', { text: 'Selecciona una sesión para gestionar su contexto' }),
      ]));
      return;
    }

    const { base, extra } = foldersOf(session);
    container.appendChild(el('div', { class: 'context-head' }, [
      el('h3', { text: 'Contexto de la sesión' }),
      el('p', { class: 'muted tiny', text: 'La carpeta del proyecto y las carpetas extra compartidas por sus sesiones. Se anuncian al agente en cada mensaje.' }),
    ]));

    const list = el('div', { class: 'folder-list' });
    list.appendChild(folderRow(base, true, session));
    for (const folder of extra) list.appendChild(folderRow(folder, false, session));
    container.appendChild(list);

    container.appendChild(el('div', { class: 'folder-actions-row' }, [
      el('button', {
        class: 'btn-primary',
        type: 'button',
        text: mode === 'add' ? 'Cancelar' : '+ Añadir carpeta',
        onClick: () => { mode = mode === 'add' ? 'list' : 'add'; render(); },
      }),
      el('button', {
        class: 'btn-small',
        type: 'button',
        text: 'Actualizar',
        onClick: () => { browseCache = new Map(); refreshBrowse(); },
      }),
    ]));

    if (mode === 'add') container.appendChild(renderAddForm(session));

    if (browseRoot) {
      container.appendChild(el('div', { class: 'context-browser' }, [
        el('div', { class: 'context-browser-head' }, [
          el('span', { class: 'muted tiny', text: `Explorando: ${browseRoot}` }),
          el('button', { class: 'btn-small', type: 'button', text: '✕', title: 'Cerrar', onClick: () => { browseRoot = null; render(); } }),
        ]),
        el('div', { class: 'context-browser-body' }, [
          el('div', { class: 'context-tree', id: 'context-tree' }),
          el('pre', { class: 'context-preview', id: 'context-preview' }),
        ]),
      ]));
      refreshBrowse();
    }
  }

  function folderRow(folder, isPrimary, session) {
    const extra = contextFoldersOf(session.id);
    return el('div', { class: `folder-item ${isPrimary ? 'primary' : ''}` }, [
      el('div', { class: 'folder-info' }, [
        el('span', { class: 'folder-icon', text: isPrimary ? '🏠' : '📂' }),
        el('div', { class: 'folder-details' }, [
          el('span', { class: 'folder-path', text: folder, title: folder }),
          el('span', { class: 'folder-badge', text: isPrimary ? 'Proyecto' : 'Contexto extra' }),
        ]),
      ]),
      el('div', { class: 'folder-actions' }, [
        el('button', {
          class: 'btn-small',
          type: 'button',
          title: 'Explorar esta carpeta',
          text: 'Explorar',
          'aria-label': 'Explorar esta carpeta',
          onClick: () => openFolder(folder),
        }),
        !isPrimary && el('button', {
          class: 'btn-small danger',
          type: 'button',
          title: 'Quitar del contexto',
          text: 'Quitar',
          'aria-label': 'Quitar del contexto',
          onClick: () => removeFolder(session, folder),
        }),
        !isPrimary && el('span', { class: 'muted tiny', text: extra.includes(folder) ? '' : '' }),
      ]),
    ]);
  }

  function renderAddForm(session) {
    const input = el('input', {
      id: 'new-folder-path',
      type: 'text',
      placeholder: 'C:\\ruta\\a\\carpeta',
    });
    const form = el('div', { class: 'add-folder-form' }, [
      el('div', { class: 'form-group' }, [
        el('label', { for: 'new-folder-path', text: 'Ruta de la carpeta' }),
        el('div', { class: 'input-with-btn' }, [
          input,
          el('button', { class: 'btn-small', type: 'button', text: 'Examinar…', onClick: () => browseForFolder(input) }),
        ]),
      ]),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn-primary', type: 'button', text: 'Guardar carpeta', onClick: () => addFolder(session, input.value) }),
        el('button', { class: 'btn-small', type: 'button', text: 'Cancelar', onClick: () => { mode = 'list'; render(); } }),
      ]),
    ]);
    return form;
  }

  async function browseForFolder(input) {
    try {
      const path = await window.oc.project.pick();
      if (path) input.value = path;
    } catch (error) {
      toast(`No se pudo abrir el selector: ${error.message}`, 'error');
    }
  }

  async function addFolder(session, rawPath) {
    const path = String(rawPath || '').trim();
    if (!path) {
      toast('Escribe o elige una carpeta.', 'warn');
      return;
    }
    const current = contextFoldersOf(session.id);
    if (current.includes(path)) {
      toast('Esa carpeta ya está en el contexto.', 'warn');
      return;
    }
    const result = await registerDirectory(path);
    if (!result.ok) {
      toast(`El servidor no aceptó la carpeta: ${result.error}`, 'warn');
      return;
    }
    const saved = await handlers.onFoldersChanged?.(session.id, [...current, path]);
    if (saved === false) return;
    mode = 'list';
    toast(`Carpeta añadida al contexto: ${basename(path)}`, 'success');
  }

  async function removeFolder(session, folder) {
    const current = contextFoldersOf(session.id).filter((item) => item !== folder);
    const saved = await handlers.onFoldersChanged?.(session.id, current);
    if (saved === false) return;
    toast(`Carpeta quitada: ${basename(folder)}`, 'success');
  }

  function openFolder(folder) {
    browseRoot = folder;
    browsePath = '';
    browseCache = new Map();
    previewText = '';
    previewName = '';
    render();
  }

  async function refreshBrowse() {
    if (!browseRoot) return;
    const tree = document.getElementById('context-tree');
    if (!tree) return;
    const key = browsePath;
    let entries = browseCache.get(key);
    if (!entries) {
      const result = await listDirectory(key, browseRoot);
      entries = result.ok && Array.isArray(result.data?.data) ? result.data.data : [];
      browseCache.set(key, entries);
    }
    clear(tree);
    if (browsePath) {
      tree.appendChild(el('div', {
        class: 'tree-row',
        text: '↩ Arriba',
        onClick: () => {
          browsePath = browsePath.includes('\\')
            ? browsePath.slice(0, browsePath.lastIndexOf('\\'))
            : browsePath.includes('/')
              ? browsePath.slice(0, browsePath.lastIndexOf('/'))
              : '';
          refreshBrowse();
        },
      }));
    }
    if (entries.length === 0) {
      tree.appendChild(el('div', { class: 'muted tiny', text: 'Sin archivos.' }));
    }
    for (const entry of entries) {
      const name = basename(entry.path);
      tree.appendChild(el('div', {
        class: 'tree-row',
        title: entry.path,
        text: `${entry.type === 'directory' ? '📁' : '📄'} ${name}`,
        onClick: () => {
          if (entry.type === 'directory') {
            browsePath = entry.path;
            refreshBrowse();
          } else {
            openPreview(entry.path);
          }
        },
      }));
    }
  }

  async function openPreview(path) {
    const preview = document.getElementById('context-preview');
    if (!preview) return;
    preview.textContent = 'Cargando…';
    const result = await readFile(path, browseRoot);
    if (!result.ok) {
      preview.textContent = `No se pudo leer el archivo: ${result.error}`;
      return;
    }
    previewName = path;
    previewText = typeof result.data === 'string' ? result.data : '(binario)';
    preview.textContent = previewText.slice(0, 200000);
  }

  const unsubscribe = subscribe(['activeSessionId', 'sessions', 'settings', 'project'], render);
  render();

  return {
    destroy: unsubscribe,
    getPreview: () => ({ name: previewName, text: previewText }),
  };
}
