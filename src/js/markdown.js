/**
 * Minimal, safe Markdown renderer.
 *
 * Safety model: every piece of raw model text is HTML-escaped before it is put
 * in a tag, and every tag emitted is produced by this module. No raw model text
 * ever reaches innerHTML unescaped. Links are restricted to http(s) and opened
 * externally.
 *
 * Robustez con modelos distintos: además de Markdown normal entiende tablas,
 * listas anidadas, tareas, bloques <think>, vallas ``` o ~~~ de cualquier largo
 * y las "llamadas a herramientas" que algunos modelos escriben como texto
 * ([Assistant tool call]: nombre + <parameter=...>) y que se muestran como una
 * tarjeta ordenada en vez de ensuciar el chat.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function codeBlock(language, escapedCode, open = false) {
  const lang = /^[\w+#.-]{0,20}$/.test(language || '') ? language : '';
  const header = `<div class="code-head"><span class="code-lang">${escapeHtml(lang || 'código')}</span>` +
    '<button type="button" class="copy-code" aria-label="Copiar código">Copiar</button></div>';
  return `<pre class="code-block${open ? ' is-open' : ''}">${header}<code>${escapedCode.replace(/\n$/, '')}</code></pre>`;
}

// ------------------------------------------------- texto "raro" de modelos ----

const THINK_RE = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/gi;
const PARAM_RE = /<parameter(?:=|\s+name=["']?)([^>"'\s]+)["']?\s*>\s*([\s\S]*?)\s*<\/parameter>/gi;
const CALL_RE = new RegExp(
  '(?:\\[(?:Assistant\\s+)?tool\\s+call\\]:?[ \\t]*([\\w.:-]+)?|<function=([\\w.:-]+)>|<invoke\\s+name=["\']([^"\']+)["\']\\s*>)'
  + '\\s*((?:<parameter(?:=|\\s+name=["\']?)[^>]*>[\\s\\S]*?<\\/parameter>\\s*)*)'
  + '(?:<\\/function>|<\\/invoke>|<\\/function_calls>|<\\/tool_call>)?',
  'gi',
);
const JSON_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi;
const STRAY_TAG_RE = /^[ \t]*<\/?(?:function|function_calls|tool_call|invoke|parameter)[^>]*>[ \t]*$/gim;

function callCard(name, params) {
  const rows = params.map(([key, value]) => {
    const text = String(value).trim();
    const long = text.length > 260 || text.split('\n').length > 6;
    const body = long
      ? `<details class="pc-long"><summary>${escapeHtml(text.slice(0, 110).replace(/\s+/g, ' '))}\u2026</summary><pre>${escapeHtml(text)}</pre></details>`
      : `<span class="pc-text">${escapeHtml(text)}</span>`;
    return `<div class="pc-row"><dt>${escapeHtml(key)}</dt><dd>${body}</dd></div>`;
  }).join('');
  return '<div class="pseudo-call">'
    + `<div class="pc-head"><span class="pc-icon">\u2699</span><strong>${escapeHtml(name || 'herramienta')}</strong><em>llamada escrita como texto</em></div>`
    + (rows ? `<dl class="pc-params">${rows}</dl>` : '')
    + '</div>';
}

function thinkCard(text, closed) {
  return `<details class="md-think"${closed ? '' : ' open'}><summary>Razonamiento</summary><div>${escapeHtml(text.trim())}</div></details>`;
}

// ------------------------------------------------------------------ inline ----

function inlineFormat(text, tokens) {
  let output = text;

  // Inline code first so its content is untouched by the other rules.
  output = output.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = tokens.push(`<code class="inline-code">${code}</code>`) - 1;
    return `\u0001${index}\u0001`;
  });

  // Links: only http/https survive; anything else degrades to plain text.
  output = output.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    if (!/^https?:\/\//i.test(href)) return label;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" data-external="1">${label}</a>`;
  });
  output = output.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;:!?])/g,
    '$1<a href="$2" target="_blank" rel="noopener noreferrer" data-external="1">$2</a>',
  );

  output = output.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/(^|[\s(])__([^_\n]+)__(?=[\s).,;:!?]|$)/g, '$1<strong>$2</strong>');
  output = output.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  output = output.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  output = output.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  output = output.replace(/\u0001(\d+)\u0001/g, (_match, index) => tokens[Number(index)] ?? '');
  return output;
}

// ------------------------------------------------------------------ blocks ----

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderTable(rows, tokens) {
  const head = splitRow(rows[0]);
  const aligns = splitRow(rows[1]).map((cell) => {
    if (/^:-+:$/.test(cell)) return 'center';
    if (/^-+:$/.test(cell)) return 'right';
    return 'left';
  });
  const cell = (tag, value, index) => `<${tag} style="text-align:${aligns[index] || 'left'}">${inlineFormat(value, tokens)}</${tag}>`;
  const body = rows.slice(2).map((row) => `<tr>${splitRow(row).map((value, index) => cell('td', value, index)).join('')}</tr>`).join('');
  return `<div class="md-table-wrap"><table><thead><tr>${head.map((value, index) => cell('th', value, index)).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function listItem(item, tokens) {
  let text = item.text;
  let prefix = '';
  const task = /^\[( |x|X)\]\s+(.*)$/.exec(text);
  if (task) {
    const done = task[1] !== ' ';
    prefix = `<span class="md-task${done ? ' is-done' : ''}">${done ? '\u2611' : '\u2610'}</span> `;
    text = task[2];
  }
  return `<li class="d${Math.min(item.depth, 4)}">${prefix}${inlineFormat(text, tokens)}</li>`;
}

function renderBlocks(lines, tokens) {
  const html = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineFormat(paragraph.join('<br>'), tokens)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => listItem(item, tokens)).join('')}</${list.type}>`);
    list = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const codeMatch = /^\u0000(\d+)\u0000$/.exec(line);
    if (codeMatch) {
      flushAll();
      html.push(tokens[Number(codeMatch[1])] ?? '');
      continue;
    }
    if (/^\s*$/.test(line)) {
      flushAll();
      continue;
    }
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushAll();
      const rows = [line, lines[i + 1]];
      let j = i + 2;
      while (j < lines.length && TABLE_ROW.test(lines[j])) { rows.push(lines[j]); j += 1; }
      html.push(renderTable(rows, tokens));
      i = j - 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineFormat(heading[2], tokens)}</h${level}>`);
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushAll();
      html.push('<hr>');
      continue;
    }
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) {
      flushAll();
      html.push(`<blockquote>${inlineFormat(quote[1], tokens)}</blockquote>`);
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const ordered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      const match = bullet || ordered;
      list.items.push({ text: match[2], depth: Math.floor(match[1].replace(/\t/g, '  ').length / 2) });
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushAll();
  return html.join('\n');
}

// ------------------------------------------------------------------ entrada ----

export function renderMarkdown(text) {
  const tokens = [];
  const stash = (htmlPiece) => `\n\u0000${tokens.push(htmlPiece) - 1}\u0000\n`;
  let raw = String(text ?? '').replace(/\r\n?/g, '\n');

  // Fenced code blocks (``` o ~~~, de 3 o más), antes de tocar nada más.
  raw = raw.replace(/^[ \t]*(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)^[ \t]*\1[`~]*[ \t]*$/gm, (_m, _fence, language, code) => (
    stash(codeBlock(language.trim(), escapeHtml(code)))
  ));
  // Valla sin cerrar mientras llega el streaming: se muestra como bloque abierto.
  const openFence = /^[ \t]*(`{3,}|~{3,})([^\n`]*)\n([\s\S]*)$/m.exec(raw);
  if (openFence) {
    raw = raw.slice(0, openFence.index) + stash(codeBlock(openFence[2].trim(), escapeHtml(openFence[3]), true));
  }

  // Bloques <think> escritos en el texto.
  raw = raw.replace(THINK_RE, (match, _tag, inner) => stash(thinkCard(inner, /<\/(?:think|thinking|reasoning)>\s*$/i.test(match))));

  // Llamadas a herramientas escritas como texto. Si llega a medias (streaming)
  // se cierra el último parámetro para que ya se vea como tarjeta.
  const opens = (raw.match(/<parameter[=\s]/gi) || []).length;
  const closes = (raw.match(/<\/parameter>/gi) || []).length;
  if (opens > closes) raw += '\n</parameter>';
  raw = raw.replace(JSON_CALL_RE, (_m, body) => {
    try {
      const data = JSON.parse(body);
      const args = data.arguments ?? data.parameters ?? {};
      const entries = Object.entries(typeof args === 'object' && args ? args : { valor: args })
        .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value, null, 2)]);
      return stash(callCard(data.name, entries));
    } catch {
      return stash(callCard('herramienta', [['contenido', body]]));
    }
  });
  raw = raw.replace(CALL_RE, (match, name1, name2, name3, params) => {
    const entries = [];
    String(params || '').replace(PARAM_RE, (_p, key, value) => { entries.push([key, value]); return ''; });
    const name = name1 || name2 || name3 || '';
    if (!name && entries.length === 0) return match;
    return stash(callCard(name, entries));
  });
  raw = raw.replace(STRAY_TAG_RE, '');

  const body = escapeHtml(raw);
  return renderBlocks(body.split('\n'), tokens);
}
