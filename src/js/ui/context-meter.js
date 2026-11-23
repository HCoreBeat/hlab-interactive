'use strict';

/**
 * Medidor de contexto y compactación.
 *
 * Cada mensaje que se envía a un modelo incluye TODA la conversación anterior:
 * el prompt completo viaja al proveedor en cada turno, y los tokens servidos
 * desde su caché también forman parte del cuerpo de la petición. Por eso una
 * sesión larga acaba subiendo varios megabytes por mensaje en un plan de datos.
 *
 * Este módulo hace visible ese coste (chip en la cabecera del chat) y permite
 * pedir un resumen del historial (`POST /api/session/:id/compact`), que es lo
 * que de verdad reduce los bytes de cada turno posterior.
 */

import { el } from '../util/dom.js';
import { state, subscribe, activeSession, sessionById, contextUsageOf, runtimeOf } from '../store.js';
import { compactSession } from '../api.js';
import { toast, toastError } from './toast.js';
import { confirmDialog } from './modal.js';

const DEFAULT_TOKENS = 60000;
const COOLDOWN_MS = 90000;
const BYTES_PER_TOKEN = 4;

/** Peticiones de compactación en curso y última compactación por sesión. */
const pending = new Set();
const compacted = new Map();
let lastAttempt = 0;

export function formatUpload(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `≈${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `≈${Math.round(value / 1024)} KB`;
  return `≈${Math.max(1, Math.round(value))} B`;
}

export function formatTokens(tokens) {
  const value = Number(tokens) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)} M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function thresholdTokens() {
  const value = Number(state.settings?.autoCompactTokens);
  return Number.isFinite(value) && value >= 5000 ? value : DEFAULT_TOKENS;
}

/**
 * Pide compactar el contexto de una sesión.
 * @param {'manual'|'auto'} mode
 */
export async function requestCompaction(mode = 'manual', session = activeSession()) {
  if (!session) {
    if (mode === 'manual') toast('No hay una sesión activa.', 'warn');
    return false;
  }
  if (pending.has(session.id)) return false;
  const usage = contextUsageOf(session.id);
  if (mode === 'manual') {
    const before = usage ? `${formatTokens(usage.tokens)} tokens · ${formatUpload(usage.bytes)} en cada mensaje` : 'contexto corto';
    const ok = await confirmDialog({
      title: 'Compactar contexto',
      message: `Se resumirá la conversación de esta sesión (${before}).\n\n`
        + 'A partir del siguiente turno se reenvía el resumen en vez del historial completo, '
        + 'así que cada mensaje gasta muchos menos datos. El resumen es lossy: se pierden '
        + 'detalles antiguos, pero se conservan objetivos, decisiones y trabajo pendiente.',
      confirmLabel: 'Compactar',
    });
    if (!ok) return false;
  }
  pending.add(session.id);
  try {
    const result = await compactSession(session.id);
    if (!result.ok) {
      if (mode === 'manual') toastError(result.error, 'No se pudo compactar el contexto');
      return false;
    }
    compacted.set(session.id, { messageID: usage?.messageID || '', tokens: usage?.tokens || 0 });
    lastAttempt = Date.now();
    toast(
      mode === 'auto'
        ? `Contexto compactado automáticamente (${usage ? formatUpload(usage.bytes) : '—'} por mensaje).`
        : 'Compactación solicitada: el contexto bajará en el siguiente turno.',
      'success',
      4500,
    );
    return true;
  } finally {
    pending.delete(session.id);
  }
}

/** Compacta sola cuando el contexto supera el umbral, sin interrumpir turnos. */
export function maybeAutoCompact(sessionID = state.activeSessionId) {
  if (state.settings?.autoCompact === false) return false;
  if (!sessionID) return false;
  const session = sessionById(sessionID);
  if (!session) return false;
  if (runtimeOf(sessionID).busy) return false;
  if (pending.has(sessionID)) return false;
  if (Date.now() - lastAttempt < COOLDOWN_MS) return false;
  const usage = contextUsageOf(sessionID);
  if (!usage) return false;
  if (usage.tokens < thresholdTokens()) return false;
  // Si ya se pidió para este mismo contexto, no se repite hasta que llegue un
  // turno nuevo (el resumen se aplica en el siguiente punto seguro).
  const done = compacted.get(sessionID);
  if (done && done.messageID === usage.messageID) return false;
  void requestCompaction('auto', session);
  return true;
}

export function mountContextMeter() {
  const root = document.getElementById('chat-context');
  const label = document.getElementById('chat-context-label');
  const fill = document.getElementById('chat-context-fill');
  if (!root || !label) return { render() {}, destroy() {} };

  function render() {
    const session = activeSession();
    const usage = session ? contextUsageOf(session.id) : null;
    if (!usage) {
      root.hidden = true;
      root.removeAttribute('data-tokens');
      return;
    }
    const threshold = thresholdTokens();
    const ratio = Math.min(1, usage.tokens / Math.max(threshold, 1000));
    root.hidden = false;
    root.dataset.tokens = String(usage.tokens);
    root.dataset.bytes = String(usage.bytes);
    root.classList.toggle('is-warn', usage.tokens >= threshold * 0.6);
    root.classList.toggle('is-danger', usage.tokens >= threshold);
    root.title = `${formatTokens(usage.tokens)} tokens de contexto (${formatUpload(usage.bytes)}).\n`
      + 'Esto es lo que se sube al proveedor en CADA mensaje de esta sesión.\n'
      + 'Compactar lo resume para gastar menos datos.';
    label.textContent = `${formatUpload(usage.bytes)}/msg`;
    if (fill) fill.style.width = `${Math.max(4, Math.round(ratio * 100))}%`;
    root.disabled = pending.has(session.id);
    root.setAttribute('aria-label', `Compactar contexto: ${formatTokens(usage.tokens)} tokens`);
  }

  root.addEventListener('click', () => { void requestCompaction('manual'); });
  const unsubscribe = subscribe(['messages', 'activeSessionId', 'settings', 'sessions', 'runtime'], render);
  render();

  return {
    render,
    destroy: unsubscribe,
  };
}
