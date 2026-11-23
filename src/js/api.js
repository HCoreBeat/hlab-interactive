import { getState } from './store.js';

/** Renderer-side wrapper that injects the active project as `location`. */
export async function api(method, path, options = {}) {
  const { project } = getState();
  const query = { ...(options.query || {}) };
  const isSessionRoot = path === '/api/session';
  if (project.dir && !query.location && !isSessionRoot) {
    query.location = { directory: project.dir };
  }
  return window.oc.request(method, path, {
    query,
    body: options.body,
    timeout: options.timeout,
    responseType: options.responseType,
  });
}

export function sessionPath(sessionID, suffix = '') {
  return `/api/session/${encodeURIComponent(sessionID)}${suffix}`;
}

export async function loadHistory(sessionID) {
  const result = await api('GET', sessionPath(sessionID, '/message'), { query: { limit: 200, order: 'desc' } });
  if (!result.ok) return { ok: false, error: result.error, messages: [] };
  const data = Array.isArray(result.data?.data) ? result.data.data : [];
  return { ok: true, messages: data.slice().reverse() };
}

export async function refreshSessions() {
  const dir = getState().project.dir;
  if (!dir) return { ok: false, sessions: [] };
  // Roots only: subagent sessions are fetched on demand and retired quickly.
  const result = await api('GET', '/api/session', {
    query: { directory: dir, limit: 200, order: 'desc', parentID: 'null', archived: 'false' },
  });
  if (!result.ok) return { ok: false, error: result.error, sessions: [] };
  return { ok: true, sessions: Array.isArray(result.data?.data) ? result.data.data : [] };
}

/** Children of one root session (the subagents spawned by the `task` tool). */
export async function loadSubagents(parentID) {
  if (!parentID) return { ok: true, sessions: [] };
  const dir = getState().project.dir;
  const result = await api('GET', '/api/session', {
    query: {
      parentID,
      directory: dir,
      limit: 50,
      order: 'desc',
      archived: 'false',
    },
  });
  if (!result.ok) return { ok: false, error: result.error, sessions: [] };
  return { ok: true, sessions: Array.isArray(result.data?.data) ? result.data.data : [] };
}

/** Archives (or restores) a session so it stops showing up in the lists. */
export async function setSessionArchived(sessionID, archived = true) {
  return api('PATCH', sessionPath(sessionID), { body: { archived: Boolean(archived) } });
}

export async function createSession({ title, agent, model, permissions } = {}) {
  const { project } = getState();
  const body = { location: { directory: project.dir } };
  if (title) body.title = title;
  if (agent) body.agent = agent;
  if (model) body.model = model;
  if (permissions) body.permissions = permissions;
  return api('POST', '/api/session', { body });
}

// Formato de adjuntos que acepta el servidor; se aprende al primer envío correcto.
// El primero es el que documenta la API v2 (Prompt.FileAttachment): base64 sin
// prefijo `data:` y origen `inline`.
function base64Payload(dataUrl) {
  const comma = String(dataUrl || '').indexOf(',');
  return comma >= 0 ? String(dataUrl).slice(comma + 1) : String(dataUrl || '');
}
const FILE_SHAPES = [
  (file) => ({ data: base64Payload(file.dataUrl), mime: file.mime, source: { type: 'inline' }, name: file.name }),
  // el esquema de OpenCode (PromptInput.FileAttachment) solo admite uri, name y description
  (file) => ({ uri: file.dataUrl, name: file.name }),
  (file) => ({ uri: file.dataUrl, mime: file.mime, name: file.name }),
  (file) => ({ url: file.dataUrl, mime: file.mime, filename: file.name }),
  (file) => ({ type: 'file', uri: file.dataUrl, mime: file.mime, name: file.name }),
];
// El sufijo de versión invalida un formato aprendido con la lista anterior.
const FILE_SHAPE_KEY = 'oc.fileShape.v2';
function readFileShape() {
  try {
    const value = Number(localStorage.getItem(FILE_SHAPE_KEY));
    return Number.isInteger(value) && value >= 0 && value < FILE_SHAPES.length ? value : -1;
  } catch {
    return -1;
  }
}
function writeFileShape(index) {
  try { localStorage.setItem(FILE_SHAPE_KEY, String(index)); } catch { /* sin almacenamiento */ }
}
let fileShape = readFileShape();

/**
 * Envía un mensaje. Con archivos (`files`: {dataUrl, mime, name}) prueba los formatos de
 * adjunto conocidos hasta que el servidor acepta uno.
 */
export async function sendPrompt(sessionID, text, files = []) {
  if (!files || files.length === 0) {
    return api('POST', sessionPath(sessionID, '/prompt'), { body: { text } });
  }
  const FORMAT_ERROR = /invalid|schema|parse|expected|unknown|required|unrecognized|400|422|validation/i;
  const attempt = (index) => api('POST', sessionPath(sessionID, '/prompt'), {
    body: { text, files: files.map(FILE_SHAPES[index]) },
  });

  const first = fileShape >= 0 ? fileShape : 0;
  let result = await attempt(first);
  if (result.ok) {
    fileShape = first;
    writeFileShape(first);
    return result;
  }

  // Un fallo de red, de modelo o de tamaño no se arregla cambiando el formato:
  // reenviar el cuerpo (con sus data URL) solo gastaría ancho de banda.
  if (!FORMAT_ERROR.test(String(result.error || ''))) return result;

  // El formato guardado dejó de valer: se olvida y se prueban los demás una vez.
  if (fileShape >= 0) { fileShape = -1; writeFileShape(-1); }
  for (let index = 0; index < FILE_SHAPES.length; index += 1) {
    if (index === first) continue;
    result = await attempt(index);
    if (result.ok) {
      fileShape = index;
      writeFileShape(index);
      return result;
    }
  }
  return result;
}

export async function interruptSession(sessionID) {
  return api('POST', sessionPath(sessionID, '/interrupt'));
}

/**
 * Pide un resumen del historial. El servidor lo aplica en el siguiente punto
 * seguro, así que la respuesta solo confirma la petición. Menos contexto =
 * menos datos subidos en cada mensaje posterior.
 */
export async function compactSession(sessionID) {
  return api('POST', sessionPath(sessionID, '/compact'), { body: {} });
}

/**
 * MCP servers come from two places:
 *  - `GET /api/config` lists every configured server (name, type, command).
 *  - `GET /api/mcp` reports the live status when opencode already started them.
 *
 * The live status is an object (`{status: 'connected'|'pending'|'disabled'|
 * 'failed'|'needs_auth', error?}`), not a plain string, so it is normalised here.
 * The merged list is what the office and the MCP panel render.
 */
export async function loadMcpServers() {
  const [config, live] = await Promise.all([
    api('GET', '/api/config'),
    api('GET', '/api/mcp'),
  ]);
  const servers = new Map();

  const documents = Array.isArray(config.data) ? config.data : (config.data?.data || []);
  for (const document of documents) {
    const defined = document?.info?.mcp?.servers;
    if (!defined || typeof defined !== 'object') continue;
    for (const [name, definition] of Object.entries(defined)) {
      servers.set(name, {
        id: name,
        name,
        type: definition.type || 'local',
        command: Array.isArray(definition.command)
          ? definition.command.join(' ')
          : (definition.command || definition.url || ''),
        disabled: Boolean(definition.disabled),
        status: definition.disabled ? 'disabled' : 'configured',
        error: null,
      });
    }
  }

  const liveList = Array.isArray(live.data?.data)
    ? live.data.data
    : Array.isArray(live.data) ? live.data : [];
  for (const entry of liveList) {
    const key = entry.name || entry.id;
    if (!key) continue;
    const current = servers.get(key) || {
      id: key, name: key, type: 'local', command: '', disabled: false,
    };
    const status = typeof entry.status === 'object' && entry.status
      ? entry.status.status
      : entry.status;
    servers.set(key, {
      ...current,
      status: status || (current.disabled ? 'disabled' : current.status || 'unknown'),
      error: (typeof entry.status === 'object' && entry.status?.error) || entry.error || null,
    });
  }

  return [...servers.values()];
}

/** Connects or disconnects one MCP server (experimental API of opencode v2). */
export async function setMcpConnection(serverName, connected) {
  const action = connected ? 'connect' : 'disconnect';
  return api('POST', `/api/experimental/mcp/${encodeURIComponent(serverName)}/${action}`);
}

export async function listDirectory(relativePath = '', directory = null) {
  const query = { path: relativePath };
  if (directory) query.location = { directory };
  return api('GET', '/api/fs/list', { query });
}

export async function findFiles(term) {
  return api('GET', '/api/fs/find', { query: { query: term, limit: 50 } });
}

export async function readFile(relativePath, directory = null) {
  const result = await readFileAsset(relativePath, directory);
  if (!result.ok || typeof result.data === 'string') return result;
  const encoded = result.data?.base64;
  if (typeof encoded !== 'string') {
    return { ...result, ok: false, data: null, error: 'El servidor no devolvió datos de archivo.' };
  }
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { ...result, data: new TextDecoder().decode(bytes) };
}

export async function readFileAsset(relativePath, directory = null) {
  const encoded = String(relativePath).split(/[\\/]/).map(encodeURIComponent).join('/');
  const query = directory ? { location: { directory } } : {};
  return api('GET', `/api/fs/read/${encoded}`, { query, responseType: 'base64' });
}

/** Registers an extra folder so the server knows about that location. */
export async function registerDirectory(directory) {
  return api('GET', '/api/session', { query: { directory, limit: 1 } });
}

export { api as request };
