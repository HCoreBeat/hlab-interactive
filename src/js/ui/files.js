import { el, clear } from '../util/dom.js';
import {
  subscribe, state, changedFilesOf, allChangedFiles, activeSession, sessionById,
} from '../store.js';
import { listDirectory, findFiles, readFile, readFileAsset } from '../api.js';
import { basename, truncate } from '../util/format.js';
import { renderDiff } from './diff.js';
import { toast } from './toast.js';
import { renderCodePreview, renderPlainPreview } from '../util/code-preview.js';
import { uiIcon } from '../util/ui-icons.js';
import { openLightbox } from './attachments.js';
import { openModal } from './modal.js';

const treeCache = new Map();
const expanded = new Set();
let selectedPath = null;
let previewText = '';
let previewImage = '';
let previewError = '';
let previewMode = 'file';
let searchResults = null;
let currentProject = null;
let filesScope = 'related';
let treeStamp = -1;
const collapsedGroups = new Set();

const BINARY_HINT = 'No es un archivo de texto (o es demasiado grande para previsualizarlo).';
const IMAGE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif',
};

function imageMime(path) {
  const extension = String(path || '').split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
  return IMAGE_TYPES[extension] || '';
}

function previewLanguage(path) {
  const extension = String(path || '').split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
  const labels = {
    png: 'Imagen PNG', jpg: 'Imagen JPEG', jpeg: 'Imagen JPEG', gif: 'Imagen GIF',
    webp: 'Imagen WEBP', bmp: 'Imagen BMP', avif: 'Imagen AVIF',
    js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JSX',
    ts: 'TypeScript', tsx: 'TSX', json: 'JSON', jsonc: 'JSONC',
    html: 'HTML', htm: 'HTML', xml: 'XML', svg: 'SVG', xaml: 'XAML',
    css: 'CSS', scss: 'SCSS', less: 'LESS', cs: 'C#', csx: 'C#',
    md: 'Markdown', mdx: 'MDX', ps1: 'PowerShell', sh: 'Shell',
    py: 'Python', sql: 'SQL', yml: 'YAML', yaml: 'YAML',
  };
  return labels[extension] || 'texto';
}

export function mountFiles(container) {
  container.scrollTop = 0;
  container.classList.add('files-panel-body');
  const layout = el('div', { class: 'files-layout' });
  const left = el('div', { class: 'file-tree-pane' });
  const modifiedPane = el('section', { class: 'modified-files', hidden: true });
  const modifiedTitle = el('div', { class: 'modified-list-title muted tiny' });
  const modifiedBox = el('div', { class: 'modified-list' });
  const searchRow = el('div', { class: 'search-row' }, [
    el('span', { class: 'file-search-icon' }, [uiIcon('inspector', 16)]),
    el('input', { type: 'text', placeholder: 'Buscar archivos por nombre o ruta', 'aria-label': 'Buscar archivo' }),
    el('button', { class: 'file-search-clear', type: 'button', text: 'Limpiar', title: 'Limpiar búsqueda' }),
  ]);
  const tree = el('div', { class: 'tree' });
  const preview = el('div', { class: 'file-preview' });
  const previewHead = el('div', { class: 'file-preview-head' });
  const previewBody = el('div', { class: 'file-preview-body' });

  modifiedPane.append(modifiedTitle, modifiedBox);
  left.append(modifiedPane, searchRow, tree);
  preview.append(previewHead, previewBody);
  layout.append(left, preview);
  container.appendChild(layout);

  const searchInput = searchRow.querySelector('input');
  const searchClear = searchRow.querySelector('button');
  let searchTimer = null;
  let searchRequest = 0;
  let openRequest = 0;
  let renderedProject = state.project.dir;

  if (currentProject !== state.project.dir) {
    currentProject = state.project.dir;
    treeCache.clear();
    expanded.clear();
    selectedPath = null;
    previewText = '';
    previewImage = '';
    previewError = '';
    searchResults = null;
  }

  async function loadDirectory(path) {
    if (treeCache.has(path)) return treeCache.get(path);
    const projectAtRequest = state.project.dir;
    const result = await listDirectory(path);
    const entries = result.ok && Array.isArray(result.data?.data) ? result.data.data : [];
    if (!result.ok) toast(`No se pudo listar la carpeta: ${result.error}`, 'warn', 4000);
    if (projectAtRequest !== state.project.dir) return [];
    treeCache.set(path, entries);
    return entries;
  }

  function renderTree() {
    clear(tree);
    if (searchResults) {
      if (searchResults.length === 0) {
        tree.appendChild(el('div', { class: 'empty-state', text: 'Sin resultados.' }));
        return;
      }
      for (const entry of searchResults) {
        tree.appendChild(el('div', {
          class: `tree-row ${selectedPath === entry.path ? 'is-selected' : ''}`,
          title: entry.path,
          onClick: () => openFile(entry.path),
        }, [
          el('span', { class: 'twisty', text: entry.type === 'directory' ? '📁' : '📄' }),
          el('span', { class: 'tree-name', text: entry.path }),
        ]));
      }
      return;
    }

    const rootEntries = treeCache.get('');
    if (!rootEntries) {
      tree.appendChild(el('div', { class: 'empty-state', text: 'Cargando archivos…' }));
      loadDirectory('').then(renderTree);
      return;
    }
    if (rootEntries.length === 0) {
      tree.appendChild(el('div', { class: 'empty-state', text: 'Carpeta vacía.' }));
      return;
    }

    const fragment = document.createDocumentFragment();
    const walk = (dirPath, entries, depth) => {
      const sorted = entries.slice().sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.path.localeCompare(b.path);
      });
      for (const entry of sorted) {
        const isDir = entry.type === 'directory';
        const isOpen = expanded.has(entry.path);
        fragment.appendChild(el('div', {
          class: `tree-row ${selectedPath === entry.path ? 'is-selected' : ''}`,
          style: { paddingLeft: `${6 + depth * 12}px` },
          title: entry.path,
          onClick: () => {
            if (isDir) {
              if (isOpen) expanded.delete(entry.path);
              else expanded.add(entry.path);
              loadDirectory(entry.path).then(renderTree);
              renderTree();
            } else {
              openFile(entry.path);
            }
          },
        }, [
          el('span', { class: 'twisty', text: isDir ? (isOpen ? '▾' : '▸') : '' }),
          el('span', { class: 'tree-name', text: isDir ? `📁 ${basename(entry.path)}` : basename(entry.path) }),
        ]));

        if (isDir && isOpen) {
          const children = treeCache.get(entry.path);
          if (children) walk(entry.path, children, depth + 1);
          else loadDirectory(entry.path).then(renderTree);
        }
      }
    };
    walk('', rootEntries, 0);
    tree.appendChild(fragment);
  }

  async function openFile(path) {
    const requestID = ++openRequest;
    selectedPath = path;
    previewMode = 'file';
    previewText = '';
    previewImage = '';
    previewError = '';
    renderTree();
    renderPreview();
    const mime = imageMime(path);
    const result = mime ? await readFileAsset(path) : await readFile(path);
    if (requestID !== openRequest || selectedPath !== path) return;
    if (!result.ok) {
      if (mime) previewError = `No se pudo abrir la imagen: ${result.error}`;
      else previewText = `No se pudo abrir el archivo: ${result.error}`;
    } else if (mime && typeof result.data?.base64 === 'string') {
      previewImage = `data:${mime};base64,${result.data.base64}`;
    } else if (mime) {
      previewError = 'El servidor no devolvió datos de imagen que se puedan previsualizar.';
    } else if (typeof result.data === 'string') {
      previewText = result.data.includes('\u0000') ? BINARY_HINT : result.data.slice(0, 400000);
    } else {
      previewText = BINARY_HINT;
    }
    renderTree();
    renderPreview();
  }

  function changedFileOf(path) {
    return changedFilesOf(activeSession()?.id).find((file) => (
      file.file === path || file.file.endsWith(path) || path.endsWith(file.file)
    ));
  }

  function renderPreview() {
    clear(previewHead);
    clear(previewBody);
    const changed = selectedPath ? changedFileOf(selectedPath) : null;

    if (!selectedPath) {
      previewHead.appendChild(el('span', { class: 'path muted', text: 'Vista previa' }));
      previewBody.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '📄' }),
        el('div', { text: 'Selecciona un archivo del árbol.' }),
      ]));
      return;
    }

    previewHead.append(
      el('span', { class: 'path', text: selectedPath, title: selectedPath }),
      el('span', { class: 'preview-language', text: previewLanguage(selectedPath) }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn-small file-preview-full',
        type: 'button',
        text: '⛶',
        title: 'Ver la vista previa a pantalla completa',
        'aria-label': 'Vista previa a pantalla completa',
        disabled: !previewImage && !previewText && !previewError,
        onClick: () => {
          if (previewImage) {
            openLightbox([{ src: previewImage, name: selectedPath }]);
            return;
          }
          const body = previewMode === 'diff' && changed && !imageMime(selectedPath)
            ? renderDiff(changed.patch || '', { title: changed.file })
            : (previewText && previewText !== BINARY_HINT
              ? (previewLanguage(selectedPath) === 'texto'
                ? renderPlainPreview(previewText)
                : renderCodePreview(selectedPath, previewText))
              : el('div', { class: 'preview-binary', text: previewError || '(sin contenido)' }));
          openModal({ title: selectedPath, className: 'preview-fullscreen', body });
        },
      }),
      changed && !imageMime(selectedPath)
        ? el('button', {
          class: `btn-small ${previewMode === 'diff' ? 'is-active' : ''}`,
          type: 'button',
          text: 'Diff',
          onClick: () => {
            previewMode = previewMode === 'diff' ? 'file' : 'diff';
            renderPreview();
          },
        })
        : null,
      el('button', {
        class: 'btn-small',
        type: 'button',
        text: 'Copiar código',
        disabled: Boolean(previewImage) || !previewText || previewText === BINARY_HINT,
        onClick: async () => {
          try { await navigator.clipboard.writeText(previewText || ''); toast('Código copiado', 'ok', 1500); } catch { /* ignore */ }
        },
      }),
    );

    if (previewMode === 'diff' && changed && !imageMime(selectedPath)) {
      previewBody.appendChild(renderDiff(changed.patch || '', { title: changed.file }));
      return;
    }

    if (previewImage) {
      previewBody.appendChild(el('div', { class: 'file-image-wrap' }, [
        el('img', {
          class: 'file-image-preview',
          src: previewImage,
          alt: selectedPath,
          title: 'Clic para ampliar',
          onClick: () => openLightbox([{ src: previewImage, name: selectedPath }]),
          onError: () => {
            previewImage = '';
            previewError = 'No se pudo decodificar la imagen.';
            renderPreview();
          },
        }),
      ]));
    } else if (previewError) {
      previewBody.appendChild(el('div', { class: 'preview-binary', text: previewError }));
    } else if (!previewText) {
      previewBody.appendChild(el('div', { class: 'preview-loading', text: 'Cargando archivo…' }));
    } else if (previewText === BINARY_HINT) {
      previewBody.appendChild(el('div', { class: 'preview-binary', text: BINARY_HINT }));
    } else {
      const rendered = previewLanguage(selectedPath) === 'texto'
        ? renderPlainPreview(previewText || '(vacío)')
        : renderCodePreview(selectedPath, previewText || '(vacío)');
      previewBody.appendChild(rendered);
    }
  }

  function rootOf(sessionID) {
    const session = sessionById(sessionID);
    return session?.parentID || sessionID;
  }

  function groupLabel(sessionID) {
    const session = sessionById(sessionID);
    const title = session?.title || session?.agent || `Tarea ${String(sessionID).slice(-6)}`;
    return { title: truncate(String(title), 48), isSub: Boolean(session?.parentID) };
  }

  function renderModified() {
    clear(modifiedBox);
    const active = activeSession();
    const rootID = active ? rootOf(active.id) : null;
    const everything = allChangedFiles();
    const files = filesScope === 'all' || !rootID
      ? everything
      : everything.filter((file) => rootOf(file.sessionID) === rootID);
    modifiedPane.hidden = everything.length === 0;
    if (everything.length === 0) return;

    modifiedTitle.textContent = '';
    modifiedTitle.append(
      el('span', { text: `Archivos modificados (${files.length})` }),
      el('button', {
        class: 'modified-scope', type: 'button',
        title: 'Alterna entre la sesión actual con sus subagentes y todas las sesiones',
        text: filesScope === 'all' ? 'Ver solo esta sesión' : `Ver todas (${everything.length})`,
        onClick: () => { filesScope = filesScope === 'all' ? 'related' : 'all'; renderModified(); },
      }),
    );
    if (files.length === 0) {
      modifiedBox.appendChild(el('div', { class: 'muted tiny', text: 'Esta sesión y sus subagentes no han modificado archivos todavía.' }));
      return;
    }

    const groups = new Map();
    for (const file of files) {
      if (!groups.has(file.sessionID)) groups.set(file.sessionID, []);
      groups.get(file.sessionID).push(file);
    }
    const rank = (id) => (id === active?.id ? 0 : id === rootID ? 1 : rootOf(id) === rootID ? 2 : 3);
    const ordered = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));

    for (const [sessionID, list] of ordered) {
      const label = groupLabel(sessionID);
      const closed = collapsedGroups.has(sessionID);
      modifiedBox.appendChild(el('div', {
        class: `modified-group${label.isSub ? ' is-sub' : ''}`,
        title: 'Mostrar u ocultar',
        onClick: () => {
          if (closed) collapsedGroups.delete(sessionID); else collapsedGroups.add(sessionID);
          renderModified();
        },
      }, [
        el('span', { class: 'modified-caret', text: closed ? '▸' : '▾' }),
        el('span', { class: 'modified-group-name', text: label.title }),
        el('span', { class: 'modified-group-tag', text: label.isSub ? 'subagente · task' : (sessionID === rootID ? 'sesión' : 'otra sesión') }),
        el('span', { class: 'modified-group-count', text: String(list.length) }),
      ]));
      if (closed) continue;
      for (const file of list) {
        modifiedBox.appendChild(el('div', {
          class: `modified-item ${selectedPath === file.file ? 'is-selected' : ''}`,
          title: file.file,
          onClick: () => {
            selectedPath = file.file;
            previewMode = file.patch ? 'diff' : 'file';
            if (file.patch) { renderTree(); renderPreview(); } else { openFile(file.file).then(() => { previewMode = 'diff'; renderPreview(); }); }
          },
        }, [
          el('span', { text: '📄' }),
          el('span', { class: 'file', text: file.file }),
          el('span', { class: 'add', text: file.additions ? `+${file.additions}` : '' }),
          el('span', { class: 'del', text: file.deletions ? `−${file.deletions}` : '' }),
        ]));
      }
    }
  }

  function render() {
    if (renderedProject !== state.project.dir) {
      renderedProject = state.project.dir;
      treeCache.clear();
      expanded.clear();
      selectedPath = null;
      previewText = '';
      previewImage = '';
      previewError = '';
      searchResults = null;
      searchInput.value = '';
      searchRequest += 1;
      openRequest += 1;
    }
    // los agentes y subagentes crean archivos: invalida el árbol para que aparezcan
    if (state.changedFiles.length !== treeStamp) {
      if (treeStamp !== -1) treeCache.clear();
      treeStamp = state.changedFiles.length;
    }
    renderModified();
    renderTree();
    renderPreview();
  }

  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const term = searchInput.value.trim();
    if (!term) {
      searchRequest += 1;
      searchResults = null;
      renderTree();
      return;
    }
    searchTimer = setTimeout(async () => {
      const requestID = ++searchRequest;
      const result = await findFiles(term);
      if (requestID !== searchRequest || searchInput.value.trim() !== term) return;
      searchResults = result.ok && Array.isArray(result.data?.data)
        ? result.data.data.map((entry) => (typeof entry === 'string' ? { path: entry, type: 'file' } : entry))
        : [];
      renderTree();
    }, 220);
  });

  searchClear.addEventListener('click', () => {
    searchRequest += 1;
    if (searchTimer) clearTimeout(searchTimer);
    searchInput.value = '';
    searchResults = null;
    searchInput.focus();
    renderTree();
  });

  if (!treeCache.has('')) loadDirectory('').then(renderTree);
  const unsubscribe = subscribe(['changedFiles', 'activeSessionId', 'project', 'sessions', 'subagents'], render);
  render();

  return {
    destroy() {
      unsubscribe();
      container.classList.remove('files-panel-body');
      container.scrollTop = 0;
    },
    focusSearch: () => searchInput.focus(),
    select: (path) => {
      const relative = String(path || '');
      if (!relative) return;
      selectedPath = relative;
      openFile(relative).then(() => {
        renderTree();
        renderPreview();
      });
    },
  };
}
