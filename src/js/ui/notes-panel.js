'use strict';

/**
 * Notas del proyecto: pendientes por proyecto guardados en los ajustes
 * (`projectNotes[directorio]`). Se pueden enviar al agente activo para que
 * revise y arregle lo anotado.
 */

import { el, clear } from '../util/dom.js';
import { state, set, subscribe } from '../store.js';
import { toast, toastError } from './toast.js';
import { uiIcon } from '../util/ui-icons.js';

const PRIORITIES = { alta: 'Alta', normal: 'Normal', baja: 'Baja' };
const ORDER = { alta: 0, normal: 1, baja: 2 };
const FILTERS = [['pending', 'Pendientes'], ['done', 'Hechas'], ['all', 'Todas']];
const uid = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function notesOf(dir) {
  const list = state.settings?.projectNotes?.[dir];
  return Array.isArray(list) ? list : [];
}

async function saveNotes(dir, notes) {
  const previous = state.settings || {};
  const projectNotes = { ...(previous.projectNotes || {}), [dir]: notes };
  set({ settings: { ...previous, projectNotes } });
  try {
    const settings = await window.oc.settings.set({ projectNotes: { [dir]: notes } });
    set({ settings });
  } catch (error) {
    set({ settings: previous });
    toastError(error, 'No se pudieron guardar las notas');
  }
}

function ago(time) {
  const minutes = Math.max(0, Math.round((Date.now() - (time || 0)) / 60000));
  if (!time) return '';
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

function promptFor(notes) {
  const lines = notes.map((note, i) => `${i + 1}. [${PRIORITIES[note.priority] || 'Normal'}] ${note.text}`);
  return [
    'Estas son las notas pendientes que dejé para este proyecto. Revísalas una por una, '
      + 'comprueba en el código si siguen siendo un problema y arréglalas empezando por las de prioridad alta. '
      + 'Al terminar, resume qué corregiste y qué no pudiste resolver.',
    '',
    ...lines,
  ].join('\n');
}

export function mountNotesPanel(container, handlers) {
  let filter = 'pending';
  let priority = 'normal';
  let editingId = null;
  let draft = '';
  clear(container);
  const root = el('div', { class: 'notes-panel' });
  container.appendChild(root);

  function send(notes) {
    if (!notes.length) return;
    if (!state.activeSessionId) {
      toast('Abre o crea una sesión para enviar las notas al agente.', 'warn');
      return;
    }
    handlers.onSend?.(promptFor(notes));
    const dir = state.project.dir;
    const ids = new Set(notes.map((note) => note.id));
    saveNotes(dir, notesOf(dir).map((note) => (ids.has(note.id) ? { ...note, review: true } : note)));
    toast(notes.length === 1 ? 'Nota enviada al agente' : `${notes.length} notas enviadas al agente`, 'success', 2500);
  }

  function renderItem(note, all, dir) {
    const update = (patch) => saveNotes(dir, all.map((item) => (item.id === note.id ? { ...item, ...patch } : item)));
    const check = el('input', { type: 'checkbox', class: 'notes-check', title: note.done ? 'Reabrir' : 'Marcar como hecha' });
    check.checked = Boolean(note.done);
    check.addEventListener('change', () => update({ done: check.checked, review: false, doneAt: check.checked ? Date.now() : 0 }));

    let body;
    if (editingId === note.id) {
      body = el('textarea', { class: 'notes-edit', rows: '2' });
      body.value = note.text;
      const finish = (commit) => {
        if (editingId !== note.id) return;
        editingId = null;
        const text = body.value.trim();
        if (commit && text && text !== note.text) update({ text });
        else render();
      };
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); }
        if (event.key === 'Escape') finish(false);
      });
      body.addEventListener('blur', () => finish(true));
      setTimeout(() => body.focus(), 0);
    } else {
      body = el('div', { class: 'notes-text', title: 'Doble clic para editar', text: note.text });
      body.addEventListener('dblclick', () => { editingId = note.id; render(); });
    }

    const meta = [
      el('span', { class: `notes-chip prio-${note.priority || 'normal'}`, text: PRIORITIES[note.priority] || 'Normal' }),
      note.review && !note.done ? el('span', { class: 'notes-chip is-review', text: 'En revisión' }) : null,
      el('span', { class: 'notes-time', text: note.done ? `hecha ${ago(note.doneAt || note.createdAt)}` : ago(note.createdAt) }),
    ].filter(Boolean);

    return el('div', { class: `notes-item prio-${note.priority || 'normal'}${note.done ? ' is-done' : ''}` }, [
      check,
      el('div', { class: 'notes-main' }, [body, el('div', { class: 'notes-meta' }, meta)]),
      el('div', { class: 'notes-actions' }, [
        note.done ? null : el('button', {
          class: 'notes-act', type: 'button', title: 'Pedir al agente que arregle esta nota', 'aria-label': 'Enviar al agente',
          onClick: () => send([note]),
        }, [uiIcon('spark', 14)]),
        el('button', {
          class: 'notes-act is-danger', type: 'button', title: 'Eliminar nota', 'aria-label': 'Eliminar nota',
          onClick: () => saveNotes(dir, all.filter((item) => item.id !== note.id)),
        }, [uiIcon('trash', 14)]),
      ]),
    ]);
  }

  function render() {
    clear(root);
    const dir = state.project.dir;
    if (!dir) {
      root.appendChild(el('div', { class: 'notes-empty' }, [uiIcon('notes', 28), el('span', { text: 'Abre un proyecto para anotar pendientes.' })]));
      return;
    }
    const all = notesOf(dir);
    const pending = all.filter((note) => !note.done);
    const done = all.filter((note) => note.done);
    const percent = all.length ? Math.round((done.length / all.length) * 100) : 0;

    // ---- cabecera: progreso
    root.appendChild(el('div', { class: 'notes-summary' }, [
      el('div', { class: 'notes-summary-top' }, [
        el('strong', { text: `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` }),
        el('span', { class: 'muted tiny', text: all.length ? `${done.length}/${all.length} hechas · ${percent}%` : 'Sin notas todavía' }),
      ]),
      el('div', { class: 'notes-progress' }, [el('div', { class: 'notes-progress-bar', style: { width: `${percent}%` } })]),
    ]));

    // ---- añadir
    const input = el('textarea', { class: 'notes-input', rows: '2', placeholder: 'Anota algo por arreglar…  (Enter añade, Shift+Enter salto)' });
    input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    const add = () => {
      const text = input.value.trim();
      if (!text) return;
      draft = '';
      saveNotes(dir, [{ id: uid(), text, priority, done: false, review: false, createdAt: Date.now() }, ...all]);
      filter = filter === 'done' ? 'pending' : filter;
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); add(); }
    });
    const seg = el('div', { class: 'notes-seg', role: 'group', 'aria-label': 'Prioridad' },
      Object.entries(PRIORITIES).map(([value, label]) => {
        const button = el('button', {
          class: `notes-seg-btn prio-${value}${priority === value ? ' is-on' : ''}`, type: 'button', text: label,
          onClick: () => { priority = value; seg.querySelectorAll('.notes-seg-btn').forEach((b) => b.classList.toggle('is-on', b === button)); },
        });
        return button;
      }));
    root.appendChild(el('div', { class: 'notes-add' }, [
      input,
      el('div', { class: 'notes-add-row' }, [seg, el('div', { class: 'spacer' }), el('button', { class: 'notes-add-btn', type: 'button', onClick: add }, [uiIcon('plus', 14), 'Añadir'])]),
    ]));

    // ---- filtros y acciones
    const counts = { pending: pending.length, done: done.length, all: all.length };
    root.appendChild(el('div', { class: 'notes-toolbar' }, [
      el('div', { class: 'notes-tabs', role: 'tablist' }, FILTERS.map(([id, label]) => el('button', {
        class: `notes-tab${filter === id ? ' is-on' : ''}`, type: 'button', role: 'tab',
        onClick: () => { filter = id; render(); },
      }, [label, el('span', { class: 'notes-count', text: String(counts[id]) })]))),
    ]));

    const listActions = [];
    if (pending.length) {
      listActions.push(el('button', {
        class: 'notes-send', type: 'button', title: 'Envía todas las notas pendientes al agente activo para que las revise y arregle',
        onClick: () => send(pending),
      }, [uiIcon('spark', 14), `Enviar ${pending.length} al agente`]));
    }
    if (done.length) {
      listActions.push(el('button', {
        class: 'notes-clear', type: 'button', title: 'Elimina las notas hechas',
        onClick: () => saveNotes(dir, pending),
      }, [uiIcon('trash', 13), 'Limpiar hechas']));
    }
    if (listActions.length) root.appendChild(el('div', { class: 'notes-bulk' }, listActions));

    // ---- lista
    const pool = filter === 'pending' ? pending : filter === 'done' ? done : all;
    const visible = pool.slice().sort((a, b) => (Number(a.done) - Number(b.done))
      || ((ORDER[a.priority] ?? 1) - (ORDER[b.priority] ?? 1))
      || ((b.createdAt || 0) - (a.createdAt || 0)));
    const list = el('div', { class: 'notes-list' });
    if (!visible.length) {
      list.appendChild(el('div', { class: 'notes-empty' }, [
        uiIcon(filter === 'done' ? 'check' : 'notes', 26),
        el('span', { text: filter === 'done' ? 'Aún no hay notas hechas.' : 'Todo al día. Anota lo que se te vaya ocurriendo.' }),
      ]));
    }
    visible.forEach((note) => list.appendChild(renderItem(note, all, dir)));
    root.appendChild(list);
  }

  render();
  const unsubscribe = subscribe(['settings', 'project'], () => {
    if (editingId) return;
    const typing = root.querySelector('.notes-input');
    const hadFocus = typing && document.activeElement === typing;
    render();
    if (hadFocus) root.querySelector('.notes-input')?.focus();
  });
  return { destroy: unsubscribe, render };
}
