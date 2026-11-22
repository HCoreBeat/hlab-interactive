'use strict';

/**
 * Preguntas del agente (herramienta `question` de OpenCode): el agente ofrece
 * opciones y espera una respuesta. Se muestran como una tarjeta sobre el chat
 * con opciones seleccionables (una o varias), respuesta libre y rechazo.
 *
 * Rutas reales de la API v2 (verificadas en el binario de opencode 2.2.7):
 *   GET  /api/session/{sessionID}/question
 *   GET  /api/question/request?location[directory]=…
 *   POST /api/session/{sessionID}/question/{requestID}/reply   { answers: [[…]] }
 *   POST /api/session/{sessionID}/question/{requestID}/reject
 *
 * Los eventos llegan como `{ type, data }` en la API v2 y como
 * `{ type, properties }` en algunas versiones: `event-router.js` normaliza
 * ambas formas antes de guardar la pregunta en el estado.
 */

import { el, clear } from '../util/dom.js';
import { state, set, subscribe, sessionById, runtimeOf } from '../store.js';
import { api } from '../api.js';
import { toast } from './toast.js';

const sessionPath = (sessionID, suffix = '') => `/api/session/${encodeURIComponent(sessionID)}${suffix}`;

/** Extrae la lista de preguntas pendientes de cualquiera de las formas posibles. */
function listFrom(response) {
  if (!response || !response.ok) return [];
  const raw = response.data;
  for (const candidate of [raw, raw?.data, raw?.items, raw?.questions, raw?.requests]) {
    if (Array.isArray(candidate)) return candidate;
  }
  if (raw && typeof raw === 'object' && (raw.id || raw.requestID)) return [raw];
  return [];
}

/** Unifica el formato de la pregunta venga del evento o de la lista. */
function normalize(entry, fallbackSession = null) {
  const id = entry.id || entry.requestID || entry.requestId || null;
  const questions = entry.questions
    || entry.payload?.questions
    || (entry.question ? [{ question: entry.question, options: entry.options || [] }] : []);
  return {
    ...entry,
    id,
    sessionID: entry.sessionID || entry.sessionId || fallbackSession,
    questions: Array.isArray(questions) ? questions : [],
    tool: entry.tool || 'question',
    synthetic: false,
  };
}

export function mountQuestions() {
  const root = el('div', { id: 'question-root', hidden: true, role: 'alertdialog', 'aria-label': 'Pregunta del agente' });
  document.body.appendChild(root);

  const choices = new Map(); // id -> Array<Set<label>>
  const custom = new Map(); // id -> Array<string>
  const busy = new Set();
  const failed = new Map();

  const pending = () => (state.questions || []).filter((item) => (
    !item.synthetic
    || (runtimeOf(item.sessionID).busy && /^question$/i.test(String(runtimeOf(item.sessionID).tool || '')))
  ));

  function remove(id) {
    set({ questions: (state.questions || []).filter((item) => item.id !== id), permissions: [...state.permissions] });
  }

  // --------------------------------------------------------- peticiones ----

  /** Preguntas pendientes en el servidor (aunque el evento se haya perdido). */
  async function fetchPending(sessionID) {
    const paths = [];
    if (sessionID) paths.push(sessionPath(sessionID, '/question'));
    paths.push('/api/question/request');
    for (const path of paths) {
      // eslint-disable-next-line no-await-in-loop
      const list = listFrom(await api('GET', path));
      if (!list.length) continue;
      return list
        .map((entry) => normalize(entry, sessionID))
        .filter((item) => Boolean(item.id));
    }
    return [];
  }

  async function postReply(sessionID, requestID, answers) {
    const path = sessionPath(sessionID, `/question/${encodeURIComponent(requestID)}/reply`);
    const primary = await api('POST', path, { body: { answers } });
    if (primary.ok) return primary;
    // Respaldo para servidores antiguos con la ruta raíz (v1.x).
    const directory = state.project?.dir;
    const legacy = await window.oc.request('POST', `/question/${encodeURIComponent(requestID)}/reply`, {
      query: directory ? { directory } : {},
      body: { answers },
    });
    return legacy.ok ? legacy : primary;
  }

  async function postReject(sessionID, requestID) {
    const path = sessionPath(sessionID, `/question/${encodeURIComponent(requestID)}/reject`);
    const primary = await api('POST', path, { body: {} });
    if (primary.ok) return primary;
    const directory = state.project?.dir;
    const legacy = await window.oc.request('POST', `/question/${encodeURIComponent(requestID)}/reject`, {
      query: directory ? { directory } : {},
      body: {},
    });
    return legacy.ok ? legacy : primary;
  }

  function upsert(item) {
    // una pregunta real sustituye a la tarjeta sintética de esa misma sesión
    const others = (state.questions || []).filter((entry) => (
      entry.id !== item.id && !(entry.synthetic && entry.sessionID === item.sessionID)
    ));
    set({ questions: [...others, item], permissions: [...state.permissions] });
  }

  async function findPending(sessionID) {
    const list = (await fetchPending(sessionID)).filter((item) => (
      item.sessionID === sessionID || !item.sessionID
    ));
    return list.length ? list[list.length - 1] : null;
  }

  async function sendAsMessage(item, answers) {
    const text = (item.questions || [])
      .map((question, index) => `${question.question || question.text || 'Pregunta'}\n\u2192 ${(answers[index] || []).join(', ') || '(sin respuesta)'}`)
      .join('\n\n');
    return api('POST', sessionPath(item.sessionID, '/prompt'), {
      body: { text: `Respuesta a tu pregunta:\n\n${text}` },
    });
  }

  // -------------------------------------------------------- responder ----

  async function reply(item, answers, asMessage = false) {
    busy.add(item.id);
    failed.delete(item.id);
    render();

    // cuerpo: un array de etiquetas por pregunta, en el mismo orden
    const count = Math.max(1, (item.questions || []).length);
    const body = Array.from({ length: count }, (_, index) => [...(answers[index] || [])]);

    let result;
    if (asMessage) {
      result = await sendAsMessage(item, body);
    } else {
      let target = item;
      // la tarjeta sintética no tiene el requestID real: se busca en el servidor
      if (target.synthetic || !target.id) {
        const real = await findPending(target.sessionID);
        if (real) { upsert(real); target = real; }
      }
      if (!target.id || target.synthetic) {
        busy.delete(item.id);
        failed.set(item.id, 'El servidor aún no ha publicado el identificador de esta pregunta. Espera un instante (se reintenta solo) o envíala como mensaje normal.');
        render();
        return;
      }
      result = await postReply(target.sessionID, target.id, body);
    }

    busy.delete(item.id);
    if (!result || !result.ok) {
      const status = result?.status ? ` (${result.status})` : '';
      failed.set(item.id, `${result?.error || 'No se pudo enviar la respuesta.'}${status}`);
      toast(`Respuesta no enviada: ${result?.error || 'error del servidor'}`, 'error');
      render();
      return;
    }
    remove(item.id);
  }

  async function reject(item) {
    busy.add(item.id);
    render();
    let target = item;
    if (target.synthetic || !target.id) {
      const real = await findPending(target.sessionID);
      if (real) { upsert(real); target = real; }
    }
    if (target.id && !target.synthetic) {
      const result = await postReject(target.sessionID, target.id);
      if (!result?.ok) toast(`No se pudo omitir: ${result?.error || 'error del servidor'}`, 'error');
    }
    busy.delete(item.id);
    remove(item.id);
    toast('Pregunta omitida.', 'warn', 2500);
  }

  // ------------------------------------------------------------ vista ----

  function answersOf(item) {
    const picked = choices.get(item.id) || [];
    const typed = custom.get(item.id) || [];
    return (item.questions || []).map((_, index) => {
      const list = [...(picked[index] || [])];
      const text = (typed[index] || '').trim();
      if (text) list.push(text);
      return list;
    });
  }

  function card(item) {
    const session = sessionById(item.sessionID);
    const isBusy = busy.has(item.id);
    const picked = choices.get(item.id) || (choices.set(item.id, []), choices.get(item.id));
    const typed = custom.get(item.id) || (custom.set(item.id, []), custom.get(item.id));
    const answers = answersOf(item);
    const complete = answers.length > 0 && answers.every((list) => list.length > 0);

    const blocks = (item.questions || []).map((question, index) => {
      const multiple = Boolean(question.multiple);
      const selected = picked[index] || (picked[index] = new Set());
      const options = (question.options || []).map((option) => {
        const label = typeof option === 'string' ? option : option.label;
        const description = typeof option === 'string' ? '' : option.description;
        const on = selected.has(label);
        return el('button', {
          class: `q-option${on ? ' is-on' : ''}`,
          type: 'button',
          role: multiple ? 'checkbox' : 'radio',
          'aria-checked': String(on),
          disabled: isBusy ? 'true' : null,
          onClick: () => {
            if (multiple) {
              if (on) selected.delete(label); else selected.add(label);
            } else {
              selected.clear();
              selected.add(label);
              typed[index] = '';
            }
            render();
          },
        }, [
          el('span', { class: `q-mark${multiple ? ' is-check' : ''}`, text: on ? (multiple ? '\u2713' : '\u25cf') : '' }),
          el('span', { class: 'q-copy' }, [
            el('strong', { text: label }),
            description ? el('span', { class: 'muted tiny', text: description }) : null,
          ].filter(Boolean)),
        ]);
      });
      const other = question.custom === false ? null : el('input', {
        class: 'q-custom', type: 'text', placeholder: 'Otra respuesta\u2026', value: typed[index] || '', spellcheck: 'false',
        disabled: isBusy ? 'true' : null,
      });
      if (other) {
        other.addEventListener('input', () => {
          typed[index] = other.value;
          if (!multiple && other.value.trim()) selected.clear();
          const send = root.querySelector(`[data-send="${CSS.escape(item.id)}"]`);
          if (send) send.disabled = isBusy || !answersOf(item).every((list) => list.length > 0);
        });
        other.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey && answersOf(item).every((list) => list.length > 0)) {
            event.preventDefault();
            reply(item, answersOf(item));
          }
        });
        if (!multiple) other.addEventListener('focus', () => { if (selected.size) { selected.clear(); render(); } });
      }
      return el('div', { class: 'q-block' }, [
        question.header ? el('span', { class: 'q-chip', text: question.header }) : null,
        el('div', { class: 'q-text', text: question.question || question.text || '' }),
        multiple ? el('span', { class: 'muted tiny', text: 'Puedes elegir varias' }) : null,
        el('div', { class: 'q-options', role: multiple ? 'group' : 'radiogroup' }, options),
        other,
      ].filter(Boolean));
    });

    const error = failed.get(item.id);
    return el('section', { class: 'permission-card question-card', 'data-id': item.id }, [
      el('header', {}, [
        el('span', { text: '\u2753' }),
        el('strong', { text: 'El agente necesita tu respuesta' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted tiny', text: session?.title ? String(session.title).slice(0, 36) : 'Sesi\u00f3n' }),
      ]),
      el('div', { class: 'body' }, [
        ...blocks,
        error ? el('div', { class: 'chip err', style: { whiteSpace: 'normal', overflowWrap: 'anywhere' }, text: error }) : null,
      ].filter(Boolean)),
      el('footer', {}, [
        el('button', {
          class: 'allow', type: 'button', 'data-send': item.id,
          disabled: isBusy || !complete ? 'true' : null,
          text: isBusy ? 'Enviando\u2026' : 'Enviar respuesta',
          onClick: () => reply(item, answersOf(item)),
        }),
        error ? el('button', {
          class: 'reject', type: 'button', disabled: isBusy || !complete ? 'true' : null,
          title: 'Si el servidor no acepta la respuesta directa, se env\u00eda como un mensaje normal',
          text: 'Enviar como mensaje',
          onClick: () => reply(item, answersOf(item), true),
        }) : null,
        el('button', {
          class: 'reject', type: 'button', disabled: isBusy ? 'true' : null, text: 'Omitir',
          onClick: () => reject(item),
        }),
      ].filter(Boolean)),
    ]);
  }

  function render() {
    const list = pending();
    // no se destruye el campo de texto si el usuario está escribiendo
    const active = document.activeElement;
    const typing = active && active.classList?.contains('q-custom') && root.contains(active);
    root.hidden = list.length === 0;
    if (typing && list.length > 0) return;
    clear(root);
    for (const item of list) root.appendChild(card(item));
  }

  const unsubscribe = subscribe(['questions', 'runtime', 'sessions'], render);
  // Mientras un agente usa la herramienta `question` se busca su solicitud real
  // cada 1,5 s: así la tarjeta aparece aunque el evento SSE se pierda.
  const poller = setInterval(async () => {
    if (document.hidden) return;
    const waiting = Object.entries(state.runtime || {})
      .filter(([, runtime]) => runtime.busy && /^question$/i.test(String(runtime.tool || '')));
    const synthetic = (state.questions || []).filter((item) => item.synthetic);
    const sessions = new Set([
      ...waiting.map(([sessionID]) => sessionID),
      ...synthetic.map((item) => item.sessionID),
    ]);
    for (const sessionID of sessions) {
      // eslint-disable-next-line no-await-in-loop
      for (const item of await fetchPending(sessionID)) {
        if (item.sessionID !== sessionID) continue;
        const known = (state.questions || []).some((entry) => entry.id === item.id);
        if (!known) upsert(item);
      }
    }
  }, 1500);
  render();
  return { destroy: () => { unsubscribe(); clearInterval(poller); }, render };
}
