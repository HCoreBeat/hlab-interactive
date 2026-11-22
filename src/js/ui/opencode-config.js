'use strict';

/**
 * Herramientas de OpenCode dentro de la app:
 *  - editor de la configuración (opencode.json) del proyecto o global, con
 *    ajustes rápidos y editor JSON validado;
 *  - salida de subcomandos del CLI (stats, models, auth list);
 *  - lanzar en una terminal los comandos interactivos (auth login, upgrade).
 */

import { el, clear } from '../util/dom.js';
import { state } from '../store.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';

function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') { out += next ?? ''; i += 1; } else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let cursor = object;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  });
  const last = keys[keys.length - 1];
  if (value === '' || value === undefined) delete cursor[last];
  else cursor[last] = value;
  // limpia objetos vacíos (permission: {})
  if (keys.length > 1 && Object.keys(object[keys[0]] || {}).length === 0) delete object[keys[0]];
}

const FIELDS = [
  { path: 'model', label: 'Modelo por defecto', type: 'model', hint: 'proveedor/modelo' },
  { path: 'small_model', label: 'Modelo pequeño', type: 'model', hint: 'Para tareas ligeras (títulos, resúmenes)' },
  { path: 'share', label: 'Compartir sesiones', type: 'select', options: [['', 'Por defecto'], ['manual', 'Manual'], ['auto', 'Automático'], ['disabled', 'Desactivado']] },
  { path: 'autoupdate', label: 'Actualizaciones automáticas', type: 'select', options: [['', 'Por defecto'], ['true', 'Activadas'], ['notify', 'Solo avisar'], ['false', 'Desactivadas']] },
  { path: 'permission.edit', label: 'Permiso: editar archivos', type: 'select', options: [['', 'Por defecto'], ['ask', 'Preguntar'], ['allow', 'Permitir'], ['deny', 'Denegar']] },
  { path: 'permission.bash', label: 'Permiso: ejecutar shell', type: 'select', options: [['', 'Por defecto'], ['ask', 'Preguntar'], ['allow', 'Permitir'], ['deny', 'Denegar']] },
  { path: 'permission.webfetch', label: 'Permiso: acceso web', type: 'select', options: [['', 'Por defecto'], ['ask', 'Preguntar'], ['allow', 'Permitir'], ['deny', 'Denegar']] },
];

export function openOpenCodeConfig({ onRestartServer } = {}) {
  const directory = state.project.dir;
  let scope = directory ? 'project' : 'global';
  let tab = 'quick';
  let file = '';
  let exists = false;
  let original = '';
  let text = '';
  let busy = false;
  let handle = null;

  const body = el('div', { class: 'occfg' });
  const saveBtn = el('button', { class: 'btn-primary', type: 'button', text: 'Guardar' });
  const revertBtn = el('button', { class: 'btn-small', type: 'button', text: 'Descartar cambios' });
  const revealBtn = el('button', { class: 'btn-small', type: 'button', text: 'Abrir carpeta' });

  function parsed() {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, value: null };
    }
  }

  function validation() {
    try {
      JSON.parse(stripJsonc(text));
      return null;
    } catch (error) {
      return error.message;
    }
  }

  function refreshButtons() {
    const dirty = text !== original;
    saveBtn.disabled = busy || !dirty || Boolean(validation());
    revertBtn.disabled = busy || !dirty;
  }

  async function load() {
    busy = true;
    render();
    const result = await window.oc.config.read(scope, directory);
    busy = false;
    if (!result.ok) {
      file = '';
      text = '';
      original = '';
      toast(result.error || 'No se pudo leer la configuración', 'error');
    } else {
      file = result.file;
      exists = result.exists;
      text = result.text;
      original = result.text;
    }
    render();
  }

  function modelOptions() {
    return (state.models || []).map((model) => `${model.providerID}/${model.modelID || model.id}`);
  }

  function renderQuick() {
    const wrap = el('div', { class: 'occfg-quick' });
    const data = parsed();
    if (!data.ok || typeof data.value !== 'object' || data.value === null) {
      wrap.appendChild(el('div', { class: 'occfg-note', text: 'Este archivo tiene comentarios o formato JSONC. Los ajustes rápidos están desactivados para no perderlos: usa la pestaña "Editor JSON".' }));
      return wrap;
    }
    const list = el('datalist', { id: 'occfg-models' }, modelOptions().map((value) => el('option', { value })));
    wrap.appendChild(list);
    for (const field of FIELDS) {
      const current = getPath(data.value, field.path);
      const currentText = current === undefined ? '' : String(current);
      let control;
      if (field.type === 'select') {
        control = el('select', { class: 'occfg-input' }, field.options.map(([value, label]) => el('option', { value, text: label })));
        control.value = field.options.some(([value]) => value === currentText) ? currentText : '';
      } else {
        control = el('input', { class: 'occfg-input', type: 'text', list: 'occfg-models', placeholder: field.hint, spellcheck: 'false' });
        control.value = currentText;
      }
      control.addEventListener('change', () => {
        const next = parsed();
        if (!next.ok) return;
        let value = control.value.trim();
        if (field.path === 'autoupdate' && (value === 'true' || value === 'false')) value = value === 'true';
        setPath(next.value, field.path, value);
        text = `${JSON.stringify(next.value, null, 2)}\n`;
        refreshButtons();
      });
      wrap.appendChild(el('label', { class: 'occfg-field' }, [
        el('span', { class: 'occfg-label', text: field.label }),
        control,
        field.hint && field.type === 'select' ? el('span', { class: 'muted tiny', text: field.hint }) : null,
      ].filter(Boolean)));
    }
    wrap.appendChild(el('div', { class: 'occfg-note', text: 'Los cambios se guardan en el archivo de configuración. Reinicia el servidor de OpenCode para aplicarlos.' }));
    return wrap;
  }

  function renderJson() {
    const area = el('textarea', { class: 'occfg-editor', spellcheck: 'false', wrap: 'off' });
    area.value = text;
    const status = el('div', { class: 'occfg-status' });
    const check = () => {
      const error = validation();
      status.textContent = error ? `\u26a0 ${error}` : '\u2713 JSON v\u00e1lido';
      status.className = `occfg-status ${error ? 'is-bad' : 'is-ok'}`;
    };
    area.addEventListener('input', () => { text = area.value; check(); refreshButtons(); });
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const { selectionStart, selectionEnd } = area;
        area.value = `${area.value.slice(0, selectionStart)}  ${area.value.slice(selectionEnd)}`;
        area.selectionStart = selectionStart + 2;
        area.selectionEnd = selectionStart + 2;
        area.dispatchEvent(new Event('input'));
      }
    });
    check();
    return el('div', { class: 'occfg-json' }, [area, status]);
  }

  function render() {
    clear(body);
    const scopeTabs = el('div', { class: 'occfg-tabs' }, [
      ['project', 'Proyecto'], ['global', 'Global'],
    ].map(([id, label]) => el('button', {
      class: `occfg-tab${scope === id ? ' is-on' : ''}`, type: 'button', text: label,
      disabled: id === 'project' && !directory ? 'true' : null,
      onClick: () => { if (scope !== id && !busy) { scope = id; load(); } },
    })));
    const viewTabs = el('div', { class: 'occfg-tabs' }, [
      ['quick', 'Ajustes r\u00e1pidos'], ['json', 'Editor JSON'],
    ].map(([id, label]) => el('button', {
      class: `occfg-tab${tab === id ? ' is-on' : ''}`, type: 'button', text: label,
      onClick: () => { tab = id; render(); },
    })));
    body.append(
      el('div', { class: 'occfg-top' }, [scopeTabs, el('div', { class: 'spacer' }), viewTabs]),
      el('div', { class: 'occfg-file', text: file ? `${file}${exists ? '' : '  (se crear\u00e1 al guardar)'}` : (busy ? 'Leyendo\u2026' : 'Sin archivo') }),
    );
    if (file) body.appendChild(tab === 'quick' ? renderQuick() : renderJson());
    refreshButtons();
  }

  saveBtn.addEventListener('click', async () => {
    busy = true;
    refreshButtons();
    const result = await window.oc.config.write(scope, directory, text);
    busy = false;
    if (result.ok) {
      original = text;
      exists = true;
      toast('Configuraci\u00f3n guardada', 'success', 2500);
      render();
      const restart = await confirmDialog({
        title: 'Reiniciar OpenCode',
        message: 'Para aplicar los cambios hay que reiniciar el servidor de OpenCode. \u00bfReiniciarlo ahora?',
        confirmLabel: 'Reiniciar',
        cancelLabel: 'M\u00e1s tarde',
      });
      if (restart) { handle?.close(); await onRestartServer?.(); }
    } else if (!result.cancelled) {
      toast(result.error || 'No se pudo guardar', 'error');
    }
    refreshButtons();
  });
  revertBtn.addEventListener('click', () => { text = original; render(); });
  revealBtn.addEventListener('click', () => window.oc.config.reveal(scope, directory));

  handle = openModal({
    title: 'Configuraci\u00f3n de OpenCode',
    className: 'occfg-modal',
    width: 'min(760px, 94vw)',
    body: [body],
    footer: [revealBtn, el('span', { class: 'spacer' }), revertBtn, saveBtn],
  });
  load();
  return handle;
}

/** Muestra la salida de un subcomando del CLI (stats, models, auth list). */
export async function showCliOutput(id, title) {
  const out = el('pre', { class: 'setup-terminal', style: { height: '360px' }, text: 'Ejecutando\u2026' });
  const copy = el('button', { class: 'btn-small', type: 'button', text: 'Copiar' });
  const handle = openModal({
    title,
    className: 'setup-modal',
    width: 'min(760px, 94vw)',
    body: [out],
    footer: [copy, el('span', { class: 'spacer' }), el('button', { class: 'btn-primary', type: 'button', text: 'Cerrar', onClick: () => handle.close() })],
  });
  copy.addEventListener('click', () => { navigator.clipboard?.writeText(out.textContent); toast('Copiado', 'success', 1500); });
  const result = await window.oc.cli.capture(id);
  out.textContent = result.ok
    ? (result.output || '(sin salida)')
    : `No se pudo ejecutar:\n${result.error || 'error desconocido'}\n\n\u00bfEst\u00e1 OpenCode instalado? Abre Ctrl+P \u2192 Instalaci\u00f3n y dependencias.`;
  return handle;
}

/** Abre una terminal externa con un comando interactivo de OpenCode. */
export async function openCliTerminal(id) {
  const result = await window.oc.cli.terminal(id);
  if (result.ok) toast(`Terminal abierta: ${result.command}`, 'success', 3000);
  else if (!result.cancelled) toast(result.error || 'No se pudo abrir la terminal', 'error');
}
