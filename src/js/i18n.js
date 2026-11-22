'use strict';

/**
 * Traducciones de la interfaz. Los catálogos se generan desde los JSON de
 * `src/i18n/` con `npm run build:i18n`, así que el runtime solo importa un JS.
 * Las claves son los textos originales en español; con `es` se devuelve el
 * texto tal cual y con cualquier otro idioma se usa el catálogo correspondiente.
 */
import { catalogs } from './i18n/catalogs.js';

export const SUPPORTED_LOCALES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

const listeners = new Set();
let locale = 'es';
let applying = false;
// Guardamos el original para poder volver al español sin perder el texto.
const originalTexts = new Map();
const originalAttrs = new Map();
const phraseCache = new Map();

// Frases ordenadas por longitud: permite traducir textos compuestos («Sesiones
// (Ctrl+1)», «2 trabajando», «agente build») sin enumerar cada combinación.
const phraseSets = Object.fromEntries(Object.entries(catalogs).map(([code, table]) => [
  code,
  Object.entries(table)
    .filter(([key, value]) => key.length >= 5 && value && value !== key)
    .sort((a, b) => b[0].length - a[0].length),
]));

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function translatePhrase(value) {
  const key = `${locale}:${value}`;
  if (phraseCache.has(key)) return phraseCache.get(key);
  let result = value;
  for (const [source, target] of phraseSets[locale] || []) {
    const pattern = new RegExp(`(^|[^\\p{L}])(${escapeRegExp(source)})(?=$|[^\\p{L}])`, 'giu');
    result = result.replace(pattern, (_all, before, match) => (
      `${before}${match[0] === match[0].toUpperCase() ? capitalize(target) : target}`
    ));
  }
  phraseCache.set(key, result);
  return result;
}

export function currentLocale() {
  return locale;
}

export function t(value) {
  if (typeof value !== 'string') return value;
  if (locale === 'es') return value;
  const exact = catalogs[locale]?.[value];
  if (exact !== undefined) return exact;
  return translatePhrase(value);
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Nodos cuyo contenido es dato del usuario o código: nunca se traducen. */
function isExcluded(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.closest('[data-i18n-skip], pre, code, textarea, input, .msg, .shell-output, .code-preview, .plain-preview, .diff-view, .tool-output, .terminal-input')) return true;
  return Boolean(node.isContentEditable);
}

function isAttributeExcluded(node) {
  return Boolean(node.closest('[data-i18n-skip], script, style, pre, code')) || Boolean(node.isContentEditable);
}

function translateAttributes(node) {
  if (isAttributeExcluded(node)) return;
  for (const name of ['title', 'placeholder', 'aria-label', 'alt']) {
    const current = node.getAttribute(name);
    if (!current) continue;
    let stored = originalAttrs.get(node);
    if (!stored) {
      stored = {};
      originalAttrs.set(node, stored);
    }
    const value = stored[name] ?? current;
    stored[name] = value;
    const next = t(value);
    if (next !== current) node.setAttribute(name, next);
  }
}

function translateTextNode(node) {
  if (originalTexts.has(node)) return;
  const value = node.nodeValue?.trim();
  if (!value) return;
  const next = t(value);
  if (next === value) return;
  originalTexts.set(node, node.nodeValue);
  node.nodeValue = node.nodeValue.replace(value, next);
}

function restoreOriginals() {
  for (const [node, text] of originalTexts) {
    if (node.isConnected) node.nodeValue = text;
  }
  originalTexts.clear();
  for (const [node, attrs] of originalAttrs) {
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  }
  originalAttrs.clear();
}

/** Traduce texto y atributos ya presentes en el documento. */
export function applyDocument(root = document, internal = false) {
  if (applying && !internal) return;
  applying = true;
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (originalTexts.has(node)) return NodeFilter.FILTER_REJECT;
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (SCRIPT_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          translateAttributes(node);
          if (isExcluded(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      translateTextNode(node);
      node = walker.nextNode();
    }
  } finally {
    applying = false;
  }
}

const SCRIPT_TAGS = new Set(['SCRIPT', 'STYLE']);

/** Los textos nuevos se traducen al insertarse, sin parchear cada vista. */
export function startDomObserver(root = document) {
  const observer = new MutationObserver((mutations) => {
    if (applying) return;
    applying = true;
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) applyDocument(node, true);
            else if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          }
        } else if (mutation.type === 'characterData') {
          translateTextNode(mutation.target);
        } else if (mutation.type === 'attributes') {
          translateAttributes(mutation.target);
        }
      }
    } finally {
      applying = false;
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'placeholder', 'aria-label', 'alt'],
  });
  return () => observer.disconnect();
}

export function setLocale(next, { apply = true } = {}) {
  const code = SUPPORTED_LOCALES.some((item) => item.code === next) ? next : 'es';
  if (code === locale) return locale;
  restoreOriginals();
  locale = code;
  phraseCache.clear();
  document.documentElement.lang = code;
  if (apply) applyDocument(document);
  for (const listener of [...listeners]) listener(code);
  return locale;
}
