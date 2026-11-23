'use strict';

/** Source Control estilo VS Code: cambios, diff, staging y commit. */
import { el, clear } from '../util/dom.js';
import { subscribe, state } from '../store.js';
import { renderDiff } from './diff.js';
import { toast, toastError } from './toast.js';
import { pushEscape } from './escape-stack.js';

const STATUS_LABEL = {
  M: 'Modificado', A: 'Añadido', D: 'Eliminado', R: 'Renombrado',
  '?': 'Sin seguimiento', C: 'Copiado', U: 'Conflicto',
};

const FILE_ICONS = {
  js: ['JS', 'js'], jsx: ['JS', 'js'], mjs: ['JS', 'js'], cjs: ['JS', 'js'],
  ts: ['TS', 'ts'], tsx: ['TS', 'ts'], json: ['{}', 'json'], jsonc: ['{}', 'json'],
  css: ['#', 'css'], scss: ['#', 'css'], less: ['#', 'css'],
  html: ['<>', 'html'], htm: ['<>', 'html'], svg: ['<>', 'svg'],
  md: ['M↓', 'md'], txt: ['≡', 'txt'], log: ['≡', 'txt'],
  png: ['▣', 'img'], jpg: ['▣', 'img'], jpeg: ['▣', 'img'], gif: ['▣', 'img'], webp: ['▣', 'img'],
  ico: ['▣', 'img'], pdf: ['▤', 'doc'],
  yml: ['≡', 'yaml'], yaml: ['≡', 'yaml'],
  ps1: ['PS', 'shell'], sh: ['$_', 'shell'], bat: ['$_', 'shell'], cmd: ['$_', 'shell'],
};

function fileIcon(filePath) {
  const name = String(filePath || '').split(/[\\/]/).pop();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const [label, kind] = FILE_ICONS[ext] || ['•', 'default'];
  return el('span', { class: `git-file-icon is-${kind}`, text: label, 'aria-hidden': 'true' });
}

export function mountGitPanel(container) {
  const git = window.oc.git;
  const header = el('div', { class: 'git-head' });
  const message = el('textarea', {
    class: 'git-message',
    rows: '2',
    placeholder: 'Mensaje del commit…',
    'aria-label': 'Mensaje del commit',
  });
  const actions = el('div', { class: 'git-actions' });
  const list = el('div', { class: 'git-changes' });
  const detail = el('div', { class: 'git-detail', hidden: true });
  const body = el('div', { class: 'git-body' }, [list, detail]);
  container.append(header, message, actions, body);

  let snapshot = null;
  let selected = null;
  let busy = false;
  let unregisterEscape = null;

  const directory = () => state.project.dir;

  const notifyGitChanged = () => {
    document.dispatchEvent(new CustomEvent('oc:git-changed'));
  };

  function setBusy(value) {
    busy = value;
    for (const node of container.querySelectorAll('button, textarea')) node.disabled = value;
  }

  async function refresh() {
    if (!git) return;
    if (!directory()) {
      renderHeader(null);
      clear(list);
      list.appendChild(el('div', { class: 'empty-state', text: 'Abre un proyecto para ver su estado Git.' }));
      return;
    }
    const result = await git.status(directory()).catch(() => ({ ok: false, error: 'Git no disponible' }));
    if (!result.ok) {
      renderHeader(null, result.error);
      clear(list);
      list.appendChild(el('div', { class: 'empty-state', text: result.error || 'No es un repositorio Git.' }));
      return;
    }
    snapshot = result;
    renderHeader(result);
    renderList();
    notifyGitChanged();
  }

  function renderHeader(result, error = '') {
    clear(header);
    header.append(
      el('strong', { text: 'Control de versiones' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'git-branch', text: result?.branch || (error ? 'sin repo' : '—') }),
      el('button', {
        class: 'btn-icon tiny',
        type: 'button',
        text: '↻',
        title: 'Actualizar',
        'aria-label': 'Actualizar estado Git',
        onClick: () => void refresh(),
      }),
    );
    clear(actions);
    actions.append(
      el('button', {
        class: 'btn-small btn-primary',
        type: 'button',
        text: '✓ Confirmar',
        disabled: !result,
        onClick: () => void commit(),
      }),
      el('button', {
        class: 'btn-small git-action-push',
        type: 'button',
        text: '↑ Enviar',
        disabled: !result,
        onClick: () => void push(),
      }),
      el('button', {
        class: 'btn-small git-action-pull',
        type: 'button',
        text: '↓ Traer',
        disabled: !result,
        onClick: () => void pull(),
      }),
    );
  }

  function fileRow(entry, stagedGroup) {
    const label = STATUS_LABEL[entry.x !== ' ' ? entry.x : entry.y] || entry.x || entry.y;
    return el('div', {
      class: `git-file ${selected === entry.file ? 'is-selected' : ''}`,
      'data-file': entry.file,
      role: 'button',
      tabindex: '0',
      onClick: () => void openDiff(entry, stagedGroup),
      onKeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void openDiff(entry, stagedGroup);
        }
      },
    }, [
      fileIcon(entry.file),
      el('span', { class: 'git-file-name', text: entry.file, title: `${label}: ${entry.file}` }),
      el('span', {
        class: `git-status is-${entry.x === '?' ? 'untracked' : 'modified'}`,
        text: entry.x === '?' ? '?' : (entry.x !== ' ' ? entry.x : entry.y),
        title: label,
      }),
      el('button', {
        class: 'btn-icon tiny',
        type: 'button',
        text: stagedGroup ? '−' : '+',
        title: stagedGroup ? 'Quitar de preparados' : 'Preparar cambio',
        onClick: async (event) => {
          event.stopPropagation();
          if (!git || busy) return;
          setBusy(true);
          const result = stagedGroup
            ? await git.unstage(directory(), entry.file)
            : await git.stage(directory(), entry.file);
          setBusy(false);
          if (!result.ok) toastError(result.error, 'No se pudo actualizar el índice');
          await refresh();
        },
      }),
    ]);
  }

  function section(title, entries, staged) {
    const wrap = el('div', { class: 'git-section' }, [
      el('h3', { text: `${title} (${entries.length})` }),
    ]);
    for (const entry of entries) wrap.appendChild(fileRow(entry, staged));
    return wrap;
  }

  function renderList() {
    clear(list);
    if (!snapshot) return;
    const staged = snapshot.files.filter((item) => item.staged);
    const unstaged = snapshot.files.filter((item) => !item.staged);
    if (staged.length === 0 && unstaged.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '✓' }),
        el('div', { text: 'No hay cambios pendientes.' }),
      ]));
      return;
    }
    if (staged.length) list.appendChild(section('Cambios preparados', staged, true));
    if (unstaged.length) list.appendChild(section('Cambios', unstaged, false));
  }

  async function openDiff(entry, staged) {
    if (!git) return;
    selected = entry.file;
    detail.hidden = false;
    renderList();
    clear(detail);
    detail.appendChild(el('div', { class: 'muted tiny', text: `Cargando ${entry.file}…` }));
    const result = await git.diff(directory(), entry.file, staged).catch(() => ({ ok: false }));
    clear(detail);
    if (!result.ok) {
      detail.appendChild(el('div', { class: 'empty-state', text: result.error || 'No se pudo leer el diff.' }));
      return;
    }
    detail.append(
      el('div', { class: 'git-diff-head' }, [
        el('strong', { text: entry.file }),
        result.untracked ? el('span', { class: 'muted tiny', text: 'archivo nuevo' }) : null,
      ]),
      result.text
        ? renderDiff(result.text, { title: entry.file })
        : el('div', { class: 'empty-state', text: 'Sin diferencias de texto.' }),
    );
    unregisterEscape?.();
    unregisterEscape = pushEscape(() => {
      clear(detail);
      detail.hidden = true;
      selected = null;
      renderList();
      unregisterEscape = null;
      return true;
    });
  }

  async function commit() {
    if (!git || busy || !message.value.trim()) {
      if (!message.value.trim()) toast('Escribe un mensaje de commit.', 'warn');
      return;
    }
    setBusy(true);
    const result = await git.commit(directory(), message.value).catch(() => ({ ok: false }));
    setBusy(false);
    if (!result.ok) {
      toastError(result.error, 'No se pudo confirmar');
      return;
    }
    message.value = '';
    toast('Commit creado', 'success');
    await refresh();
  }

  async function push() {
    if (!git || busy) return;
    setBusy(true);
    const result = await git.push(directory()).catch(() => ({ ok: false }));
    setBusy(false);
    if (!result.ok) toastError(result.error, 'No se pudo enviar');
    else {
      toast('Cambios enviados', 'success');
      notifyGitChanged();
    }
  }

  async function pull() {
    if (!git || busy) return;
    setBusy(true);
    const result = await git.pull(directory()).catch(() => ({ ok: false }));
    setBusy(false);
    if (!result.ok) toastError(result.error, 'No se pudo actualizar');
    else {
      toast('Repositorio actualizado', 'success');
      await refresh();
    }
  }

  const unsubscribe = subscribe(['project', 'activeSessionId'], () => void refresh());
  void refresh();
  return {
    destroy: () => {
      unsubscribe();
      unregisterEscape?.();
    },
    render: refresh,
  };
}
