'use strict';

/**
 * Explicit tool cards: they show, without hiding anything, what the agent is
 * really doing — the file it edits (with the diff), the command it runs (with
 * its output), the content it writes or the file it reads.
 */

import { el } from '../util/dom.js';
import { toolIcon, STATUS_ICONS } from '../util/icons.js';
import { basename, truncate } from '../util/format.js';
import { renderDiff } from './diff.js';

const EDIT_TOOLS = /^(edit|multiedit|patch|apply_patch|write|create|update)$/i;
const READ_TOOLS = /^(read|view|cat|open)$/i;
const SHELL_TOOLS = /^(bash|shell|exec|run)$/i;
const SEARCH_TOOLS = /^(glob|grep|search|find|list)$/i;

function valueOf(input, keys) {
  if (!input || typeof input !== 'object') return '';
  for (const key of keys) {
    const found = input[key];
    if (typeof found === 'string' && found) return found;
  }
  return '';
}

/** The most meaningful line for each kind of tool. */
function targetOf(tool) {
  const input = tool.input || {};
  const file = valueOf(input, ['filePath', 'path', 'file', 'target']);
  const command = valueOf(input, ['command', 'cmd']);
  const pattern = valueOf(input, ['pattern', 'query', 'glob']);
  const url = valueOf(input, ['url']);
  if (file) return file;
  if (command) return truncate(command.replace(/\s+/g, ' '), 120);
  if (pattern) return pattern;
  if (url) return url;
  try { return truncate(JSON.stringify(input), 120); } catch { return ''; }
}

function humanInput(tool) {
  const input = tool.input || {};
  const rows = [];
  const file = valueOf(input, ['filePath', 'path', 'file', 'target']);
  if (file) rows.push(['archivo', file]);
  const command = valueOf(input, ['command', 'cmd']);
  if (command) rows.push(['comando', command]);
  const pattern = valueOf(input, ['pattern', 'query', 'glob']);
  if (pattern) rows.push(['patrón', pattern]);
  const url = valueOf(input, ['url']);
  if (url) rows.push(['url', url]);
  const content = valueOf(input, ['content', 'newString', 'text', 'newContent']);
  if (content) rows.push(['contenido', content]);
  return rows;
}

/** Diff of the files touched by the tool, when the server sends the patch. */
function diffOf(tool) {
  const files = tool.metadata?.files || [];
  const patched = files.filter((file) => file.patch);
  if (patched.length === 0) return null;
  const box = el('div', { class: 'tool-diffs' });
  for (const file of patched) {
    const head = el('div', { class: 'tool-diff-head' }, [
      el('span', { class: 'tool-diff-name', text: file.file || basename(file.path || '') }),
      el('span', { class: 'tool-diff-count', text: `+${file.additions || 0} −${file.deletions || 0}` }),
    ]);
    box.appendChild(head);
    box.appendChild(renderDiff(file.patch, {}));
  }
  return box;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text || '');
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text || '';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** One labelled block of the tool body: title, copy button and full content. */
function addSection(body, { label, text, className = 'tool-output', tone = '' }) {
  if (text === undefined || text === null || text === '') return;
  const section = el('div', { class: 'tool-section' });
  const head = el('div', { class: 'tool-section-head' });
  head.appendChild(el('div', { class: 'tool-section-title', text: label }));
  const copy = el('button', {
    class: 'tool-copy',
    type: 'button',
    text: '⧉ Copiar',
    onClick: async (event) => {
      event.stopPropagation();
      const ok = await copyText(String(text));
      copy.textContent = ok ? '✓ Copiado' : 'Copiar';
      setTimeout(() => { copy.textContent = '⧉ Copiar'; }, 1400);
    },
  });
  head.appendChild(copy);
  section.appendChild(head);
  section.appendChild(el('pre', { class: `tool-text ${className}${tone}`, text: String(text) }));
  body.appendChild(section);
}

export function renderToolCard(tool, { onOpenFile, toolKey } = {}) {
  const status = tool.status || 'running';
  const name = tool.name || 'tool';
  const duration = tool.startedAt && tool.endedAt ? `${((tool.endedAt - tool.startedAt) / 1000).toFixed(1)}s` : '';
  const target = targetOf(tool);
  const rows = humanInput(tool);
  const isEdit = EDIT_TOOLS.test(name);
  const isShell = SHELL_TOOLS.test(name);
  const isRead = READ_TOOLS.test(name);
  const isSearch = SEARCH_TOOLS.test(name);

  const body = el('div', { class: 'tool-body' });

  // 1. The diff of what it edited: the most explicit thing there is.
  const diff = diffOf(tool);
  if (diff) body.appendChild(diff);

  // 2. The command it ran and everything it printed (in full).
  if (isShell) {
    const command = valueOf(tool.input, ['command', 'cmd']);
    if (command) addSection(body, { label: 'comando', text: command, className: 'tool-command', tone: '' });
    if (tool.output) addSection(body, { label: 'salida completa', text: tool.output });
  }

  // 3. The text it wrote.
  const written = valueOf(tool.input, ['content', 'newString', 'newContent']);
  if (isEdit && written && !diff) addSection(body, { label: 'contenido escrito', text: written });

  // 4. What it read or found.
  if ((isRead || isSearch) && tool.output) {
    addSection(body, { label: isRead ? 'archivo leído' : 'resultados', text: tool.output });
  }

  // 5. Generic fallback: the raw output and the raw input.
  if (!body.childElementCount) {
    if (tool.output) addSection(body, { label: 'salida', text: tool.output });
    else if (tool.error) addSection(body, { label: 'error', text: tool.error, className: 'tool-output', tone: ' is-error' });
    else if (rows.length === 0 && tool.input) addSection(body, { label: 'parámetros', text: JSON.stringify(tool.input, null, 2) });
  } else if (tool.output && !isShell && !isRead && !isSearch) {
    addSection(body, { label: 'salida', text: tool.output });
  }

  if (tool.error) addSection(body, { label: 'error', text: tool.error, className: 'tool-output', tone: ' is-error' });

  // Parameters that are not shown anywhere else.
  const extra = rows.filter(([label]) => !['archivo', 'comando', 'contenido', 'patrón', 'url'].includes(label));
  if (extra.length) {
    body.appendChild(el('div', { class: 'tool-params' }, extra.flatMap(([label, value]) => [
      el('span', { class: 'tool-param-key', text: `${label}:` }),
      el('span', { class: 'tool-param-value', text: truncate(String(value), 200) }),
    ])));
  }

  if (target && isRead && onOpenFile) {
    body.appendChild(el('button', {
      class: 'btn-small tool-open',
      type: 'button',
      text: `Abrir ${basename(target)}`,
      onClick: () => onOpenFile(target),
    }));
  }

  // Nothing to show yet: keep the card compact but still explicit.
  if (!body.childElementCount) {
    body.appendChild(el('div', { class: 'tool-section' }, [
      el('div', { class: 'tool-section-title', text: 'en curso…' }),
    ]));
  }

  const card = el('div', { class: 'tool-card', 'data-status': status, 'data-tool': name, 'data-tool-key': toolKey }, [
    el('div', { class: 'tool-head' }, [
      el('span', { class: 'tool-icon', text: toolIcon(name) }),
      el('span', { class: 'tool-name', text: name }),
      el('span', { class: 'tool-target', text: target, title: target }),
      duration ? el('span', { class: 'tool-time', text: duration }) : null,
      el('span', { class: 'tool-status', text: STATUS_ICONS[status] || '•', title: status }),
      el('button', {
        class: 'tool-toggle',
        type: 'button',
        'aria-label': 'Ver detalle de la herramienta',
        'aria-expanded': 'true',
        text: '▴',
        onClick: (event) => {
          event.stopPropagation();
          const block = event.currentTarget.closest('.tool-card').querySelector('.tool-body');
          block.hidden = !block.hidden;
          event.currentTarget.setAttribute('aria-expanded', String(!block.hidden));
          event.currentTarget.setAttribute('aria-label', block.hidden ? 'Ver detalle de la herramienta' : 'Ocultar detalle de la herramienta');
          event.currentTarget.textContent = block.hidden ? '▾' : '▴';
        },
      }),
    ]),
    body,
  ]);

  return card;
}
