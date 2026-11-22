/** Tiny DOM helpers. No framework, no innerHTML with untrusted data. */

import { t } from '../i18n.js';

const TRANSLATED_PROPS = new Set(['text', 'title', 'placeholder', 'aria-label', 'alt']);

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    const localized = TRANSLATED_PROPS.has(key) ? t(value) : value;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = localized;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, TRANSLATED_PROPS.has(key) ? String(localized) : String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function on(node, event, handler, options) {
  node.addEventListener(event, handler, options);
  return () => node.removeEventListener(event, handler, options);
}

export function toggleClass(node, name, value) {
  node.classList.toggle(name, Boolean(value));
}

/** Frames a function to at most one call per animation frame. */
export function raf(fn) {
  let scheduled = false;
  let lastArgs = [];
  return (...args) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...lastArgs);
    });
  };
}

export function scrollToBottom(node) {
  node.scrollTop = node.scrollHeight;
}

export function isAtBottom(node, tolerance = 48) {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= tolerance;
}
