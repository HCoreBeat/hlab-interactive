'use strict';

/**
 * Safety net: the app does not show emojis as icons. Any emoji that ends up in
 * the UI (static or dynamic) is swapped for the matching SVG icon, or removed
 * when there is no equivalent. Code, terminals and editable fields are skipped.
 */

import { uiIcon } from './ui-icons.js';

const MAP = {
  '☕': 'coffee', '💭': 'think', '💡': 'think', '⌨': 'code', '💻': 'terminal', '📖': 'read', '📚': 'read',
  '🔎': 'search', '🔍': 'search', '🔌': 'mcp', '✋': 'lock', '🔒': 'lock', '👥': 'agents', '👷': 'agents',
  '🤖': 'assistant', '👤': 'person', '❌': 'alert', '⚠': 'alert', '🌐': 'globe', '🗂': 'list', '📝': 'pencil',
  '✏': 'pencil', '✍': 'pencil', '🔧': 'wrench', '🛠': 'wrench', '⏳': 'clock', '⌛': 'clock', '✅': 'check',
  '✔': 'check', '🚫': 'ban', '⏹': 'stop', '📁': 'folder', '📂': 'folder', '🗑': 'trash', '⚡': 'spark', '⚙': 'settings',
};

const EMOJI = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
const SKIP = 'textarea,input,pre,code,script,style,[contenteditable],.xterm,[data-keep-emoji],.ui-ico,.chat-anchor';

function convert(textNode) {
  const parent = textNode.parentElement;
  const text = textNode.nodeValue;
  if (!parent || !text || parent.closest(SKIP)) return;
  EMOJI.lastIndex = 0;
  if (!EMOJI.test(text)) return;
  EMOJI.lastIndex = 0;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let match;
  while ((match = EMOJI.exec(text)) !== null) {
    if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    const name = MAP[match[0].replace(/\uFE0F/g, '')];
    if (name) {
      const holder = document.createElement('span');
      holder.className = 'ui-ico';
      holder.appendChild(uiIcon(name, 1.0 * 15));
      fragment.appendChild(holder);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
  parent.replaceChild(fragment, textNode);
}

function scan(root) {
  if (root.nodeType === Node.TEXT_NODE) { convert(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(convert);
}

function start() {
  scan(document.body);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') convert(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.body) start();
else document.addEventListener('DOMContentLoaded', start);
