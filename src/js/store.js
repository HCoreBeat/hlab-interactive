/**
 * Central app state with a tiny pub/sub keyed by top-level slices.
 * Everything that changes is replaced (never mutated in place) so subscribers
 * can rely on reference comparison.
 */

export const state = {
  boot: { ready: false, error: null },
  server: { state: 'stopped', message: 'Servidor detenido', url: '', demo: false, version: '' },
  sse: { state: 'closed', message: 'Sin conexión', attempt: 0 },
  project: { dir: null, name: null },
  /**
   * Snapshot of every project we have visited, keyed by directory. Sessions of
   * other projects keep working on the server, so we remember them here instead
   * of dropping them when the user switches folders. Nothing here ever aborts a
   * turn or stops a session.
   */
  projects: {},
  /** sessionID -> directory, so global SSE events can be attributed to a project. */
  sessionDir: {},
  sessions: [],
  // Child sessions created by the `task` tool (Session.Info.parentID). They are
  // kept apart from the roots so the list, the badges and the office only show
  // the ones that are still alive.
  subagents: [],
  activeSessionId: null,
  messages: {},
  runtime: {},
  permissions: [],
  questions: [],
  changedFiles: [],
  shells: [],
  /** Comandos ejecutados directamente en la raíz del proyecto (PowerShell). */
  terminal: [],
  activity: [],
  models: [],
  agents: [],
  commands: [],
  selection: { providerID: null, modelID: null, agent: null },
  settings: {},
  appInfo: null,
  events: [],
  mcpServers: [],
  ui: {
    tab: 'activity',
    settingsOpen: false,
    railOpen: true,
    railView: 'agents',
    officeOpen: true,
    error: null,
    busy: {},
    connecting: false,
    cleared: {},
  },
};

const listeners = new Set();

export function getState() {
  return state;
}

export function subscribe(keys, fn) {
  const entry = { keys: keys === '*' ? null : new Set(Array.isArray(keys) ? keys : [keys]), fn };
  listeners.add(entry);
  return () => listeners.delete(entry);
}

function notify(changed) {
  for (const listener of [...listeners]) {
    if (!listener.keys) {
      listener.fn(changed);
      continue;
    }
    if (changed.some((key) => listener.keys.has(key))) listener.fn(changed);
  }
}

// Las claves de alta frecuencia (tokens en streaming, eventos, actividad) se agrupan
// y se notifican como mucho una vez por fotograma: el estado se actualiza al instante,
// pero los componentes no se repintan decenas de veces por segundo.
const HOT_KEYS = new Set(['messages', 'runtime', 'activity', 'events', 'changedFiles']);
const pendingHot = new Set();
let hotScheduled = false;
let lastFlush = 0;

function flushHot() {
  hotScheduled = false;
  lastFlush = performance.now();
  if (pendingHot.size === 0) return;
  const keys = [...pendingHot];
  pendingHot.clear();
  notify(keys);
}

export function set(patch) {
  const changed = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (state[key] !== value) {
      state[key] = value;
      changed.push(key);
    }
  }
  if (changed.length === 0) return changed;
  const cold = changed.filter((key) => !HOT_KEYS.has(key));
  changed.forEach((key) => { if (HOT_KEYS.has(key)) pendingHot.add(key); });
  if (cold.length > 0) notify(cold);
  if (pendingHot.size > 0 && !hotScheduled) {
    hotScheduled = true;
    // como mucho ~20 notificaciones por segundo para las claves de alta frecuencia
    const wait = Math.max(0, 50 - (performance.now() - lastFlush));
    setTimeout(() => {
      if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) {
        requestAnimationFrame(flushHot);
      } else {
        flushHot();
      }
    }, wait);
  }
  return changed;
}

export function update(key, updater) {
  const next = updater(state[key]);
  if (next !== state[key]) set({ [key]: next });
  return next;
}

export function setUI(partial) {
  set({ ui: { ...state.ui, ...partial } });
}

// ------------------------------------------------------------ selectors ----

export function activeSession() {
  return sessionById(state.activeSessionId);
}

export function messagesOf(sessionID) {
  return state.messages[sessionID] || [];
}

export function runtimeOf(sessionID) {
  return state.runtime[sessionID] || { busy: false, outcome: null, tool: null, startedAt: 0, doneAt: 0, errorAt: 0 };
}

export function permissionsOf(sessionID) {
  // las preguntas pendientes del agente también cuentan como "esperando respuesta"
  return [...state.permissions, ...(state.questions || [])].filter((item) => item.sessionID === sessionID);
}

export function shellsOf(sessionID) {
  return state.shells.filter((shell) => shell.sessionID === sessionID);
}

/** Agentes que pueden asignarse a una sesión principal. */
export function isPrimaryAgent(agent) {
  return Boolean(agent) && agent.hidden !== true
    && (agent.mode === 'primary' || agent.mode === 'all' || !agent.mode);
}

export function primaryAgents() {
  return (state.agents || []).filter(isPrimaryAgent);
}

export function subagentAgents() {
  return (state.agents || []).filter((agent) => !isPrimaryAgent(agent) && agent.hidden !== true);
}

/** Historial del terminal directo, llaveado por id de ejecución. */
export function terminalRuns() {
  return state.terminal || [];
}

export function upsertTerminalRun(entry) {
  if (!entry || !entry.id) return;
  const list = state.terminal || [];
  const index = list.findIndex((item) => item.id === entry.id);
  const next = list.slice();
  if (index === -1) next.push(entry);
  else next[index] = { ...next[index], ...entry };
  set({ terminal: next });
}

/** Crea la entrada base sin sobrescribir un `done` que llegó antes del `invoke`. */
export function beginTerminalRun(info) {
  if (!info?.id) return;
  const existing = terminalRuns().find((item) => item.id === info.id);
  if (existing) return;
  upsertTerminalRun({ status: 'running', output: '', ...info });
}

/** Aplica un evento del proceso principal aunque el panel esté desmontado. */
export function applyTerminalEvent(event) {
  if (!event?.id) return;
  const list = state.terminal || [];
  const index = list.findIndex((item) => item.id === event.id);
  const current = index === -1
    ? { id: event.id, kind: event.kind || 'terminal', command: event.command || '', directory: event.directory || '', startedAt: event.startedAt || Date.now(), output: '', status: 'running' }
    : { ...list[index] };
  const finished = current.status === 'exited' || current.status === 'error';
  if (event.type === 'output') {
    if (!finished) current.output = `${current.output || ''}${event.chunk || ''}`;
  } else if (event.type === 'done' && !finished) {
    current.status = event.exit === 0 ? 'exited' : 'error';
    current.exit = event.exit;
    current.error = event.error || '';
    current.endedAt = event.endedAt || Date.now();
    if (typeof event.output === 'string') current.output = event.output;
  } else {
    return;
  }
  const next = list.slice();
  if (index === -1) next.push(current);
  else next[index] = current;
  set({ terminal: next });
}

export function activityOf(sessionID) {
  return state.activity.filter((item) => item.sessionID === sessionID);
}

export function changedFilesOf(sessionID) {
  return state.changedFiles.filter((file) => !sessionID || file.sessionID === sessionID);
}

export function sessionsOf() {
  return state.sessions || [];
}

// -------------------------------------------------- proyectos en paralelo ----

function dirLabel(dir) {
  const parts = String(dir || '').split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(dir || 'Proyecto');
}

/** Comparación de rutas tolerante a mayúsculas y barras finales (Windows). */
export function sameDirectory(a, b) {
  if (!a || !b) return false;
  const norm = (value) => String(value).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

/** Guarda (o refresca) el inventario de sesiones de un proyecto. */
export function rememberProject(dir, { sessions, subagents, activeSessionId } = {}) {
  if (!dir) return;
  const prev = state.projects[dir] || {
    dir, name: dirLabel(dir), sessions: [], subagents: [], activeSessionId: null,
  };
  const entry = {
    ...prev,
    dir,
    name: prev.name || dirLabel(dir),
    sessions: sessions === undefined ? prev.sessions : sessions,
    subagents: subagents === undefined ? prev.subagents : subagents,
    activeSessionId: activeSessionId === undefined ? prev.activeSessionId : activeSessionId,
  };
  const sessionDir = { ...state.sessionDir };
  for (const item of [...entry.sessions, ...entry.subagents]) {
    if (item?.id) sessionDir[item.id] = dir;
  }
  set({ projects: { ...state.projects, [dir]: entry }, sessionDir });
}

/** Asocia una sesión con su proyecto (los eventos SSE solo traen el id). */
export function mapSessionDirectory(sessionID, dir) {
  if (!sessionID || !dir || state.sessionDir[sessionID] === dir) return;
  set({ sessionDir: { ...state.sessionDir, [sessionID]: dir } });
}

export function directoryOfSession(sessionID) {
  if (!sessionID) return null;
  if (state.sessionDir[sessionID]) return state.sessionDir[sessionID];
  return sessionById(sessionID) ? state.project.dir : null;
}

/** Mantiene una sesión ajena en el registro, sin mezclarla en la lista actual. */
export function rememberForeignSession(dir, session) {
  if (!dir || !session?.id) return;
  mapSessionDirectory(session.id, dir);
  if (sameDirectory(dir, state.project.dir)) return;
  const prev = state.projects[dir] || {
    dir, name: dirLabel(dir), sessions: [], subagents: [], activeSessionId: null,
  };
  const key = session.parentID ? 'subagents' : 'sessions';
  const list = prev[key] || [];
  const index = list.findIndex((item) => item.id === session.id);
  const next = index === -1
    ? [...list, session]
    : list.map((item, i) => (i === index ? session : item));
  set({ projects: { ...state.projects, [dir]: { ...prev, [key]: next } } });
}

/** ¿Está trabajando la sesión (turno en curso o esperando una respuesta)? */
export function isSessionWorking(sessionID) {
  return Boolean(runtimeOf(sessionID).busy || permissionsOf(sessionID).length > 0);
}

/**
 * Proyectos distintos del actual que tienen sesiones trabajando. Cada entrada
 * trae el número de sesiones en curso y las que esperan permiso/pregunta.
 */
export function workingProjects({ includeCurrent = false } = {}) {
  const result = [];
  for (const entry of Object.values(state.projects || {})) {
    if (!entry) continue;
    if (!includeCurrent && sameDirectory(entry.dir, state.project.dir)) continue;
    let busy = 0;
    let waiting = 0;
    const sessions = [];
    for (const session of [...(entry.sessions || []), ...(entry.subagents || [])]) {
      if (!isSessionWorking(session.id)) continue;
      sessions.push(session);
      if (runtimeOf(session.id).busy) busy += 1;
      else waiting += 1;
    }
    if (busy + waiting > 0) {
      result.push({ dir: entry.dir, name: entry.name || dirLabel(entry.dir), busy, waiting, sessions });
    }
  }
  return result.sort((a, b) => (b.busy + b.waiting) - (a.busy + a.waiting));
}

export function otherProjectWork() {
  const projects = workingProjects();
  return {
    projects,
    busy: projects.reduce((sum, item) => sum + item.busy, 0),
    waiting: projects.reduce((sum, item) => sum + item.waiting, 0),
  };
}

/** How long a finished subagent stays visible before it is retired. */
export const SUBAGENT_GRACE_MS = 12000;

/** Looks a session up in the roots and in the subagents. */
export function sessionById(sessionID) {
  if (!sessionID) return null;
  return state.sessions.find((session) => session.id === sessionID)
    || state.subagents.find((session) => session.id === sessionID)
    || null;
}

/**
 * A subagent is alive while it is working, waiting for a permission or focused
 * in the chat, and for a short grace period after it finishes (so the user can
 * see the hand-off in the office).
 */
export function isSubagentLive(session) {
  if (!session || !session.parentID) return false;
  const runtime = runtimeOf(session.id);
  if (runtime.busy) return true;
  if (permissionsOf(session.id).length > 0) return true;
  if (session.id === state.activeSessionId) return true;
  const stamp = runtime.doneAt || session.time?.updated || 0;
  return Boolean(stamp) && Date.now() - stamp < SUBAGENT_GRACE_MS;
}

/** Live subagents, optionally only the ones of one parent. */
export function liveSubagents(parentID = null) {
  return state.subagents.filter((session) => (!parentID || session.parentID === parentID)
    && isSubagentLive(session));
}

/**
 * Sessions the office and the agents dashboard draw: every root plus the live
 * subagents. When there are more than the office can hold, the busy ones win.
 */
export function officeSessions(limit = Infinity) {
  const all = [...state.sessions, ...liveSubagents()];
  if (all.length <= limit) return all;
  const priority = (session) => {
    const runtime = runtimeOf(session.id);
    if (runtime.busy) return 0;
    if (permissionsOf(session.id).length > 0) return 1;
    if (runtime.doneAt && Date.now() - runtime.doneAt < SUBAGENT_GRACE_MS) return 2;
    return 3;
  };
  return all.slice().sort((a, b) => priority(a) - priority(b)).slice(0, limit);
}

/** Adds or replaces a session in the list it belongs to, keeping its position. */
export function upsertSession(session) {
  if (!session || !session.id) return;
  // Un evento de otro proyecto no debe "resucitar" su sesión en la lista actual:
  // se registra en su proyecto y punto. Los turnos siguen corriendo en el server.
  const dir = session.location?.directory || session.directory || null;
  if (dir && !sameDirectory(dir, state.project.dir)) {
    rememberForeignSession(dir, session);
    return;
  }
  const key = session.parentID ? 'subagents' : 'sessions';
  const list = state[key] || [];
  const index = list.findIndex((item) => item.id === session.id);
  let next;
  if (index === -1) next = [...list, session];
  else {
    next = list.slice();
    next[index] = session;
  }
  set({ [key]: next });
}

/** Removes a session (root or child) from the state. */
export function removeSession(sessionID) {
  set({
    sessions: state.sessions.filter((session) => session.id !== sessionID),
    subagents: state.subagents.filter((session) => session.id !== sessionID),
  });
}

export function mcpServers() {
  return state.mcpServers || [];
}

export const mcpServersOf = mcpServers;

/** Extra context folders registered by the user for a given session. */
export function contextFoldersOf(sessionID) {
  const settings = state.settings || {};
  const session = sessionById(sessionID);
  const directory = session?.location?.directory || state.project.dir;
  const projectFolders = settings.projectFolders || {};
  if (directory && Array.isArray(projectFolders[directory])) return projectFolders[directory];
  const legacyFolders = settings.sessionFolders || {};
  return Array.isArray(legacyFolders[sessionID]) ? legacyFolders[sessionID] : [];
}

// -------------------------------------------------------------- patches ----

export function patchRuntime(sessionID, patch) {
  const current = state.runtime[sessionID] || {};
  set({ runtime: { ...state.runtime, [sessionID]: { ...current, ...patch } } });
}

export function patchSession(sessionID, patch) {
  const apply = (list) => list.map((session) => (session.id === sessionID ? { ...session, ...patch } : session));
  set({
    sessions: apply(state.sessions),
    subagents: apply(state.subagents),
  });
}

export function putMessages(sessionID, messages) {
  set({ messages: { ...state.messages, [sessionID]: messages } });
}

export function patchMessage(sessionID, messageID, updater) {
  const list = state.messages[sessionID];
  if (!list) return null;
  let changed = null;
  const next = list.map((message) => {
    if (message.id !== messageID) return message;
    changed = updater(message);
    return changed || message;
  });
  if (changed) set({ messages: { ...state.messages, [sessionID]: next } });
  return changed;
}

export function appendMessage(sessionID, message) {
  const list = state.messages[sessionID] || [];
  if (list.some((item) => item.id === message.id)) return;
  set({ messages: { ...state.messages, [sessionID]: [...list, message] } });
}

export function pushEvent(event) {
  const events = [...state.events, event];
  if (events.length > 500) events.splice(0, events.length - 500);
  set({ events });
}
