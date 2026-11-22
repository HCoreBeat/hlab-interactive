'use strict';

import hljs from './highlight-engine.bundle.js';
import { el } from './dom.js';

const EXTENSIONS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', xaml: 'xml', csproj: 'xml', props: 'xml',
  css: 'css', scss: 'css', less: 'css',
  cs: 'csharp', csx: 'csharp',
  md: 'markdown', mdx: 'markdown',
  sh: 'bash', bash: 'bash', ps1: 'powershell',
  py: 'python', sql: 'sql', yml: 'yaml', yaml: 'yaml',
};

function languageForPath(path) {
  const name = String(path || '').split(/[\\/]/).pop() || '';
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (name === 'Dockerfile' || name === 'Makefile') return 'bash';
  return EXTENSIONS[extension] || null;
}

export function renderCodePreview(path, source) {
  const language = languageForPath(path);
  const wrapper = el('div', { class: `code-preview${language ? ` language-${language}` : ''}` });
  const gutter = el('ol', { class: 'code-gutter', 'aria-hidden': 'true' });
  const code = el('pre', { class: 'code-lines' });
  const raw = String(source);
  const charLimit = 180000;
  const lineLimit = 5000;
  const charClipped = raw.length > charLimit;
  const text = charClipped ? raw.slice(0, charLimit) : raw;
  const allLines = text.split('\n');
  const lineClipped = allLines.length > lineLimit;
  const visibleSource = lineClipped ? allLines.slice(0, lineLimit).join('\n') : text;
  const content = el('code');
  const lines = visibleSource.split('\n');
  lines.forEach((_, index) => gutter.appendChild(el('li', { text: String(index + 1) })));
  if (language && hljs.getLanguage(language)) {
    content.innerHTML = hljs.highlight(visibleSource, { language, ignoreIllegals: true }).value;
  } else {
    content.textContent = visibleSource;
  }
  code.appendChild(content);
  wrapper.append(gutter, code);
  wrapper.dataset.language = language || 'plain text';
  if (charClipped || lineClipped) {
    wrapper.appendChild(el('div', {
      class: 'code-preview-notice',
      text: `Vista limitada a ${lines.length.toLocaleString()} líneas para mantener la respuesta del panel. Copiar código conserva el archivo completo.`,
    }));
  }
  return wrapper;
}

export function renderPlainPreview(source) {
  const pre = el('pre', { class: 'plain-preview' });
  pre.textContent = String(source);
  return pre;
}
