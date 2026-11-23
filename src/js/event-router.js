/**
 * Translates opencode v2 events into store mutations.
 *
 * Unknown event types never break the app: they only land in the raw event log
 * used by the Inspector tab.
 */

import {
  state, set, patchRuntime, patchSession, putMessages, pushEvent,
  upsertSession, removeSession, sessionById,
  mapSessionDirectory, rememberForeignSession, sameDirectory,
} from './store.js';
import { recordStep, detectLimit } from './ui/quota.js';
import { noteAgentTraffic } from './ui/traffic.js';

const MAX_ACTIVITY = 400;
const DELEGATION_TOOL = /^(task|agent|subagent|dispatch|delegate)(?:[_-].*)?$/i;

// ------------------------------------------------------- normalisation ----

export function blocksFromContent(content) {
  const blocks = [];
  for (const part of content || []) {
    if (part.type === 'text') {
      blocks.push({ key: `text:${blocks.length}`, kind: 'text', text: part.text || '', streaming: false });
    } else if (part.type === 'reasoning') {
      blocks.push({ key: `reasoning:${blocks.length}`, kind: 'reasoning', text: part.text || '', streaming: false });
    } else if (part.type === 'tool') {
      blocks.push({
        key: `tool:${part.id}`,
        kind: 'tool',
        tool: {
          id: part.id,
          name: part.name,
          input: part.state?.input || null,
          status: part.state?.status || 'completed',
          output: textFromContent(part.state?.content),
          metadata: part.state?.metadata || null,
          error: part.state?.error ? String(part.state.error.message || part.state.error) : null,
          startedAt: part.time?.ran || part.time?.created || null,
          endedAt: part.time?.completed || null,
        },
      });
    }
  }
  return blocks;
}

function textFromContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part?.type === 'text' ? part.text : '')).filter(Boolean).join('\n');
  }
  return '';
}

export function normalizeHistory(items) {
  const messages = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'user') {
      messages.push({
        id: item.id, role: 'user', type: 'user', text: item.text || '', time: item.time?.created || null,
        files: item.files || item.attachments || item.payload?.files || undefined,
      });
    } else if (item.type === 'assistant') {
      messages.push({
        id: item.id,
        role: 'assistant',
        type: 'assistant',
        agent: item.agent || null,
        model: item.model || null,
        blocks: blocksFromContent(item.content),
        stats: {
          cost: item.cost || 0,
          tokens: item.tokens || null,
          finish: item.finish || null,
        },
        streaming: false,
        time: item.time?.created || null,
      });
    } else if (item.type === 'idle') {
      messages.push({ id: item.id, role: 'idle', type: 'idle', outcome: item.outcome || null, time: item.time?.created || null });
    } else if (item.type === 'shell' || item.type === 'synthetic' || item.type === 'system') {
      messages.push({
        id: item.id,
        role: 'system',
        type: item.type,
        text: item.text || item.payload?.text || '',
        time: item.time?.created || null,
      });
    }
  }
  return messages;
}

// ------------------------------------------------------------- helpers ----

function mutateMessage(sessionID, messageID, mutate) {
  const list = state.messages[sessionID];
  if (!list) return null;
  const index = list.findIndex((message) => message.id === messageID);
  if (index === -1) return null;
  const draft = { ...list[index], blocks: (list[index].blocks || []).slice() };
  mutate(draft);
  const next = list.slice();
  next[index] = draft;
  set({ messages: { ...state.messages, [sessionID]: next } });
  return draft;
}

function ensureAssistant(sessionID, messageID, extra = {}) {
  const list = state.messages[sessionID] || [];
  const existing = list.find((message) => message.id === messageID);
  if (existing) {
    const patch = {};
    if (extra.agent && !existing.agent) patch.agent = extra.agent;
    if (extra.model && !existing.model) patch.model = extra.model;
    if (Object.keys(patch).length > 0) {
      mutateMessage(sessionID, messageID, (draft) => Object.assign(draft, patch));
    }
    return;
  }
  const message = {
    id: messageID,
    role: 'assistant',
    type: 'assistant',
    agent: extra.agent || null,
    model: extra.model || null,
    blocks: [],
    stats: { cost: 0, tokens: null, finish: null },
    streaming: true,
    time: Date.now(),
  };
  set({ messages: { ...state.messages, [sessionID]: [...list, message] } });
}

function ensureBlock(message, key, factory) {
  const index = message.blocks.findIndex((block) => block.key === key);
  if (index !== -1) return index;
  message.blocks.push({ key, ...factory() });
  return message.blocks.length - 1;
}

function currentAssistantID(sessionID) {
  return state.runtime[sessionID]?.assistantMessageID || null;
}

function upsertActivity(entry) {
  const index = state.activity.findIndex((item) => item.id === entry.id && item.sessionID === entry.sessionID);
  let next;
  if (index === -1) {
    next = [...state.activity, entry];
  } else {
    next = state.activity.slice();
    next[index] = { ...next[index], ...entry };
  }
  if (next.length > MAX_ACTIVITY) next.splice(0, next.length - MAX_ACTIVITY);
  set({ activity: next });
}

function upsertChangedFile(file) {
  const key = `${file.sessionID}:${file.file}`;
  const index = state.changedFiles.findIndex((item) => `${item.sessionID}:${item.file}` === key);
  let next;
  if (index === -1) next = [...state.changedFiles, file];
  else {
    next = state.changedFiles.slice();
    next[index] = { ...next[index], ...file };
  }
  set({ changedFiles: next });
}

function upsertShell(sessionID, shellID, patch) {
  // La clave es (sesión, shell): un mismo shellID en dos sesiones no debe
  // sobrescribir la salida de la otra.
  const index = sessionID
    ? state.shells.findIndex((item) => item.id === shellID && item.sessionID === sessionID)
    : state.shells.findIndex((item) => item.id === shellID);
  let next;
  if (index === -1) {
    next = [...state.shells, { id: shellID, sessionID, status: 'running', output: '', startedAt: Date.now(), ...patch }];
  } else {
    next = state.shells.slice();
    next[index] = { ...next[index], ...patch, ...(sessionID ? { sessionID } : {}) };
  }
  set({ shells: next });
}

/** Resuelve la sesión de un evento de shell que no la trae (shell.exited). */
function shellSessionID(data, sessionID) {
  if (sessionID) return sessionID;
  const found = state.shells.find((item) => item.id === (data.id || data.shell?.id));
  return found?.sessionID || null;
}

/** Reads the error payload of a failed turn (string or object). */
function readError(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  return '';
}

function finalizeStreaming(sessionID, messageID) {
  if (!messageID) return;
  mutateMessage(sessionID, messageID, (draft) => {
    draft.streaming = false;
    draft.blocks = draft.blocks.map((block) => (block.streaming ? { ...block, streaming: false } : block));
  });
}

// --------------------------------------------------------------- main ----

export function handleEvent(event, deps = {}) {
  if (!event || typeof event.type !== 'string') return;
  pushEvent(event);

  const type = event.type;
  // La API v2 emite el payload en `data`; algunas versiones (2.2.x) lo hacen en
  // `properties`. Se aceptan las dos formas para no perder eventos de pregunta.
  const data = { ...(event.properties || {}), ...(event.data || {}) };
  const sessionID = data.sessionID || event.sessionID || null;
  // Los eventos v2 suelen traer `location.directory` (y a veces solo en el
  // objeto sesión). Con eso sabemos de qué proyecto es el turno aunque estemos
  // viendo otra carpeta: no paramos nada, solo lo marcamos en su sitio.
  const eventDir = event.location?.directory || data.location?.directory
    || data.directory || null;
  if (sessionID && eventDir) mapSessionDirectory(sessionID, eventDir);

  switch (type) {
    case 'server.connected':
      return;

    case 'mcp.updated':
    case 'mcp.connected':
    case 'mcp.disconnected':
    case 'mcp.status':
      deps.onMcpChanged?.();
      return;

    case 'session.created':
    case 'session.updated': {
      // las sesiones hijas (subagentes) llegan por aquí en cuanto se crean: aparecen al instante
      const session = data.session || data.info || data;
      if (session && session.id) {
        const dir = eventDir || session.location?.directory || session.directory || null;
        if (dir && !sameDirectory(dir, state.project.dir)) {
          // Sesión de otro proyecto: queda en su registro, nunca se cuela en la
          // lista de la carpeta que estamos viendo.
          rememberForeignSession(dir, session);
          return;
        }
        if (session.archived) removeSession(session.id);
        else upsertSession(session);
      }
      return;
    }

    case 'session.inbox.enqueued': {
      const item = data.item || {};
      if (item.type === 'user' && item.payload?.text) {
        const list = state.messages[sessionID] || [];
        const now = event.created || Date.now();
        // The prompt response also carries the user message; dedupe by id AND
        // by (text, recent timestamp) so the bubble never appears twice.
        const duplicate = list.some((message) => message.id === data.inboxID
          || (message.type === 'user'
            && message.text === item.payload.text
            && Math.abs((message.time || 0) - now) < 10000));
        if (!duplicate) {
          set({
            messages: {
              ...state.messages,
              [sessionID]: [...list, {
                id: data.inboxID,
                role: 'user',
                type: 'user',
                text: item.payload.text,
                files: item.payload.files || undefined,
                time: now,
              }],
            },
          });
        }
      }
      return;
    }

    case 'session.execution.started':
      patchRuntime(sessionID, {
        busy: true,
        outcome: null,
        startedAt: event.created || Date.now(),
        doneAt: 0,
        errorAt: 0,
        errorMessage: '',
        tool: null,
        toolInput: null,
        assistantMessageID: null,
      });
      return;

    case 'session.execution.succeeded':
    case 'session.execution.failed':
    case 'session.execution.interrupted':
    case 'session.idle': {
      const outcome = type === 'session.execution.succeeded'
        ? 'succeeded'
        : type === 'session.execution.failed'
          ? 'failed'
          : type === 'session.execution.interrupted'
            ? 'interrupted'
            : data.outcome || 'succeeded';
      const current = state.runtime[sessionID] || {};
      finalizeStreaming(sessionID, current.assistantMessageID);
      const errorMessage = outcome === 'failed' ? readError(data.error) : '';
      patchRuntime(sessionID, {
        busy: false,
        outcome,
        tool: null,
        doneAt: type === 'session.execution.succeeded' || type === 'session.idle' ? Date.now() : 0,
        errorAt: outcome === 'failed' ? Date.now() : 0,
        errorMessage,
      });
      patchSession(sessionID, { outcome });
      deps.onSessionsChanged?.();
      deps.onSessionSettled?.(sessionID);
      if (errorMessage) deps.onSessionError?.(sessionID, errorMessage);
      return;
    }

    case 'session.step.started': {
      ensureAssistant(sessionID, data.assistantMessageID, { agent: data.agent, model: data.model });
      // El `agent` del step es la identidad real de quien ejecuta el turno: en
      // los subagentes es la única fuente fiable (la sesión hija puede nacer con
      // el agente del padre). Lo guardamos en la sesión para que la UI lo pinte.
      if (data.agent) patchSession(sessionID, { agent: data.agent });
      patchRuntime(sessionID, { assistantMessageID: data.assistantMessageID, tool: null, errorMessage: '', errorAt: 0 });
      return;
    }

    case 'session.step.ended': {
      const messageID = data.assistantMessageID;
      mutateMessage(sessionID, messageID, (draft) => {
        draft.stats = { cost: data.cost || 0, tokens: data.tokens || null, finish: data.finish || null };
        draft.streaming = false;
      });
      recordStep(sessionID, { ...data, assistantMessageID: messageID });
      noteAgentTraffic(data);
      return;
    }

    case 'session.usage.updated':
      patchSession(sessionID, { cost: data.cost, tokens: data.tokens });
      return;

    case 'session.reasoning.started':
    case 'session.text.started': {
      const kind = type.includes('reasoning') ? 'reasoning' : 'text';
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      ensureAssistant(sessionID, messageID);
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `${kind}:${data.ordinal ?? 0}`, () => ({ kind, text: '', streaming: true }));
        draft.blocks[index] = { ...draft.blocks[index], streaming: true };
      });
      return;
    }

    case 'session.reasoning.delta':
    case 'session.text.delta': {
      const kind = type.includes('reasoning') ? 'reasoning' : 'text';
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      ensureAssistant(sessionID, messageID);
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `${kind}:${data.ordinal ?? 0}`, () => ({ kind, text: '', streaming: true }));
        const block = draft.blocks[index];
        draft.blocks[index] = { ...block, text: `${block.text || ''}${data.delta || ''}`, streaming: true };
      });
      return;
    }

    case 'session.reasoning.ended':
    case 'session.text.ended': {
      const kind = type.includes('reasoning') ? 'reasoning' : 'text';
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `${kind}:${data.ordinal ?? 0}`, () => ({ kind, text: '', streaming: false }));
        const block = draft.blocks[index];
        draft.blocks[index] = { ...block, text: data.text ?? block.text ?? '', streaming: false };
      });
      if (kind === 'text') detectLimit(data.text ?? '');
      return;
    }

    case 'session.tool.input.started': {
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      ensureAssistant(sessionID, messageID);
      patchRuntime(sessionID, { tool: data.name, toolInput: null, toolStartedAt: event.created || Date.now() });
      if (DELEGATION_TOOL.test(String(data.name || ''))) {
        deps.onSubagentSpawn?.(sessionID);
      }
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `tool:${data.id}`, () => ({
          kind: 'tool',
          tool: { id: data.id, name: data.name, input: null, status: 'streaming', startedAt: event.created || Date.now() },
        }));
        draft.blocks[index] = {
          ...draft.blocks[index],
          tool: { ...draft.blocks[index].tool, name: data.name, status: 'streaming' },
        };
      });
      upsertActivity({
        id: data.id,
        sessionID,
        name: data.name,
        input: null,
        status: 'streaming',
        startedAt: event.created || Date.now(),
        endedAt: null,
        output: '',
        error: null,
      });
      return;
    }

    case 'session.tool.input.ended': {
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `tool:${data.id}`, () => ({
          kind: 'tool',
          tool: { id: data.id, name: 'tool', status: 'streaming' },
        }));
        draft.blocks[index] = {
          ...draft.blocks[index],
          tool: { ...draft.blocks[index].tool, inputRaw: data.text || '' },
        };
      });
      return;
    }

    case 'session.tool.called': {
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      if (!messageID) return;
      mutateMessage(sessionID, messageID, (draft) => {
        const index = ensureBlock(draft, `tool:${data.id}`, () => ({
          kind: 'tool',
          tool: { id: data.id, name: 'tool', status: 'running' },
        }));
        draft.blocks[index] = {
          ...draft.blocks[index],
          tool: { ...draft.blocks[index].tool, input: data.input || null, status: 'running', startedAt: event.created || Date.now() },
        };
      });
      upsertActivity({
        id: data.id,
        sessionID,
        input: data.input || null,
        status: 'running',
      });
      patchRuntime(sessionID, { toolInput: data.input || null });
      // la tarea ya está en marcha: el subagente está a punto de existir (o ya existe)
      if (DELEGATION_TOOL.test(String(state.runtime[sessionID]?.tool || ''))) deps.onSubagentSpawn?.(sessionID);
      // red de seguridad: si el servidor no emitió `question.asked`, se muestra la pregunta a partir de la herramienta
      if (/^question$/i.test(String(state.runtime[sessionID]?.tool || '')) && Array.isArray(data.input?.questions)) {
        const callID = data.id || data.callID || String(Date.now());
        setTimeout(() => {
          if ((state.questions || []).some((entry) => entry.sessionID === sessionID)) return;
          if (state.runtime[sessionID]?.tool !== 'question') return;
          set({
            questions: [...(state.questions || []), { id: `tool:${callID}`, sessionID, questions: data.input.questions, synthetic: true }],
            permissions: [...state.permissions],
          });
        }, 1500);
      }
      return;
    }

    case 'session.tool.success':
    case 'session.tool.error': {
      const messageID = data.assistantMessageID || currentAssistantID(sessionID);
      const failed = type === 'session.tool.error';
      const output = failed ? '' : textFromContent(data.content);
      const error = failed ? String(data.error?.message || data.error || 'Error en la herramienta') : null;
      if (messageID) {
        mutateMessage(sessionID, messageID, (draft) => {
          const index = ensureBlock(draft, `tool:${data.id}`, () => ({
            kind: 'tool',
            tool: { id: data.id, name: 'tool', status: 'running' },
          }));
          draft.blocks[index] = {
            ...draft.blocks[index],
            tool: {
              ...draft.blocks[index].tool,
              status: failed ? 'error' : 'completed',
              output,
              metadata: data.metadata || null,
              error,
              endedAt: event.created || Date.now(),
            },
          };
        });
      }
      upsertActivity({
        id: data.id,
        sessionID,
        status: failed ? 'error' : 'completed',
        output,
        error,
        endedAt: event.created || Date.now(),
      });
      if (!failed && data.metadata?.files) {
        for (const file of data.metadata.files) {
          upsertChangedFile({ ...file, sessionID });
        }
      }
      return;
    }

    case 'question.asked':
    case 'question.v2.asked':
    case 'session.question.asked': {
      // preguntas del agente (herramienta `question`): hay que responderlas desde la app
      const questions = data.questions || data.input?.questions
        || (data.question ? [{ question: data.question, options: data.options || [] }] : []);
      const requestID = data.id || data.requestID || data.requestId || null;
      // sin identificador real la pregunta no se puede responder: la tarjeta
      // sintética de `session.tool.called` (o el sondeo de questions.js) la resuelve.
      if (!requestID || !Array.isArray(questions) || questions.length === 0) return;
      const item = {
        ...data,
        id: requestID,
        sessionID: data.sessionID || sessionID,
        questions,
        tool: data.tool || 'question',
      };
      set({
        // la pregunta real sustituye a cualquier tarjeta sintética de la sesión
        questions: [
          ...(state.questions || []).filter((entry) => entry.id !== item.id && !(entry.synthetic && entry.sessionID === item.sessionID)),
          item,
        ],
        permissions: [...state.permissions], // reactiva los indicadores de "esperando"
      });
      return;
    }

    case 'question.replied':
    case 'question.rejected':
    case 'question.v2.replied':
    case 'question.v2.rejected':
    case 'session.question.replied':
    case 'session.question.rejected': {
      const requestID = data.requestID || data.id || data.requestId || null;
      const sid = data.sessionID || sessionID;
      set({
        // Sin sesión conocida no tocamos las tarjetas sintéticas: borrar las de
        // todas las sesiones rompía el aislamiento entre ellas.
        questions: (state.questions || []).filter((entry) => (
          !(entry.id === requestID && (!sid || entry.sessionID === sid))
          && !(entry.synthetic && sid && entry.sessionID === sid && entry.id === requestID)
        )),
        permissions: [...state.permissions],
      });
      return;
    }

    case 'permission.asked': {
      const permission = { ...data, sessionID: data.sessionID || sessionID };
      set({ permissions: [...state.permissions.filter((item) => item.id !== permission.id), permission] });
      for (const file of permission.metadata?.files || []) {
        upsertChangedFile({ ...file, sessionID: permission.sessionID });
      }
      return;
    }

    case 'permission.replied': {
      const sid = data.sessionID || sessionID;
      set({
        permissions: state.permissions.filter((item) => (
          !(item.id === data.requestID && (!sid || item.sessionID === sid))
        )),
      });
      return;
    }

    case 'file.edited':
      if (data.file) {
        upsertChangedFile({ file: data.file, status: 'modified', additions: 0, deletions: 0, patch: '', sessionID });
      }
      return;

    case 'shell.created':
      if (data.info?.id) {
        upsertShell(data.info.metadata?.sessionID || sessionID, data.info.id, {
          command: data.info.command,
          status: data.info.status || 'running',
          startedAt: data.info.time?.started || Date.now(),
        });
      }
      return;

    case 'session.shell.started':
      if (data.shell?.id) {
        upsertShell(sessionID, data.shell.id, {
          command: data.shell.command,
          status: 'running',
          startedAt: event.created || Date.now(),
        });
      }
      return;

    case 'shell.exited':
      if (data.id) {
        // `shell.exited` no trae sessionID: lo resolvemos desde el shell ya
        // registrado para no crear un bucket huérfano ni mezclar sesiones.
        upsertShell(shellSessionID(data, sessionID), data.id, {
          status: data.status || 'exited',
          exit: data.exit,
        });
      }
      return;

    case 'session.shell.ended':
      if (data.shell?.id) {
        upsertShell(sessionID, data.shell.id, {
          command: data.shell.command,
          status: 'exited',
          exit: data.shell.exit ?? 0,
          output: data.output?.output || '',
          endedAt: event.created || Date.now(),
        });
      }
      return;

    case 'project.updated':
      deps.onProjectUpdated?.(data);
      return;

    default:
      if (type.startsWith('session.') && sessionID && !sessionById(sessionID)) {
        // Un evento de otro proyecto no debe recargar la lista de la carpeta
        // actual: ese turno sigue vivo y se marca en su propio proyecto.
        if (sessionID && eventDir && !sameDirectory(eventDir, state.project.dir)) return;
        deps.onSessionsChanged?.();
      }
      return;
  }
}

/** Replaces a session's message list (used after loading history). */
export function setHistory(sessionID, messages) {
  putMessages(sessionID, messages);
  const idle = [...messages].reverse().find((message) => message.type === 'idle');
  if (idle) patchRuntime(sessionID, { outcome: idle.outcome || null, busy: false });
}

/** Clears volatile per-session data (used when a session is deleted). */
export function forgetSession(sessionID) {
  const messages = { ...state.messages };
  delete messages[sessionID];
  const runtime = { ...state.runtime };
  delete runtime[sessionID];
  set({
    messages,
    runtime,
    permissions: state.permissions.filter((item) => item.sessionID !== sessionID),
    questions: (state.questions || []).filter((item) => item.sessionID !== sessionID),
    activity: state.activity.filter((item) => item.sessionID !== sessionID),
    shells: state.shells.filter((item) => item.sessionID !== sessionID),
    changedFiles: state.changedFiles.filter((item) => item.sessionID !== sessionID),
  });
  removeSession(sessionID);
}
