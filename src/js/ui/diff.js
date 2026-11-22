import { el } from '../util/dom.js';
import { basename } from '../util/format.js';

/**
 * Very small unified-diff renderer (no libraries).
 * Accepts the `patch` strings returned by opencode and builds green/red lines
 * with line numbers.
 */
export function parsePatch(patch) {
  const lines = String(patch || '').split('\n');
  const output = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      output.push({ type: 'hunk', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (/^(diff --git|Index:|---|\+\+\+|\\ No newline)/.test(line)) {
      output.push({ type: 'meta', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('+')) {
      output.push({ type: 'add', text: line.slice(1), oldLine: '', newLine: newLine || '' });
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      output.push({ type: 'del', text: line.slice(1), oldLine: oldLine || '', newLine: '' });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      output.push({ type: 'ctx', text: line.slice(1), oldLine: oldLine || '', newLine: newLine || '' });
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (line === '') continue;
    output.push({ type: 'meta', text: line, oldLine: null, newLine: null });
  }
  return output;
}

export function renderDiff(patch, { title } = {}) {
  const container = el('div', { class: 'diff-view' });
  if (title) container.appendChild(el('div', { class: 'diff-head', text: title }));
  const lines = parsePatch(patch);
  if (lines.length === 0) {
    container.appendChild(el('div', { class: 'diff-head', text: 'Sin cambios que mostrar' }));
    return container;
  }
  for (const line of lines) {
    if (line.type === 'hunk' || line.type === 'meta') {
      container.appendChild(el('div', { class: `diff-line ${line.type}` }, [
        el('span', { class: 'ln', text: '' }),
        el('span', { class: 'mark', text: '' }),
        el('span', { class: 'code', text: line.text }),
      ]));
      continue;
    }
    container.appendChild(el('div', { class: `diff-line ${line.type === 'ctx' ? '' : line.type}` }, [
      el('span', { class: 'ln', text: `${line.oldLine || ''}` }),
      el('span', { class: 'mark', text: line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }),
      el('span', { class: 'code', text: line.text }),
    ]));
  }
  return container;
}

export function diffTitle(file) {
  return basename(file || 'archivo');
}
