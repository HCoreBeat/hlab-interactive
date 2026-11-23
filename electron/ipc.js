'use strict';

const { ipcMain, dialog, shell, app } = require('electron');
const { DIRECTORY: DEMO_DIRECTORY } = require('./demo-source');
const setup = require('./setup');
const ocConfig = require('./opencode-config');
const terminal = require('./terminal');
const git = require('./git');
const traffic = require('./traffic');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Los adjuntos viajan como data URL base64 (×1,33): un mensaje con varias
// imágenes legítimas superaba el límite anterior de 5 MB y fallaba en seco.
const MAX_BODY = 12 * 1024 * 1024;
const MAX_SETTING = 1024 * 1024;

const ALLOWED_SETTINGS = new Set([
  'theme', 'locale', 'fontSize', 'speechRate', 'speechVoice',
  'autoCompact', 'autoCompactTokens',
  'lastUpdateCheck', 'latestKnownVersion',
  'animations', 'demo', 'archiveSubagents',
  'opencodePath', 'lastProject', 'connection', 'permissions', 'recentProjects',
  'preferredModel', 'preferredAgent', 'projectFolders', 'projectNotes',
  'modelByProject', 'agentByProject', 'sessionFolders', 'layout', 'panel', 'panelLayout',
]);

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value) return true;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function smallEnough(value) {
  return Buffer.byteLength(JSON.stringify(value) || '', 'utf8') <= MAX_SETTING;
}

/** Allowlist estricta: el renderer no puede inyectar claves ni comandos. */
function sanitizeSettings(partial) {
  const clean = {};
  for (const [key, value] of Object.entries(partial)) {
    if (!ALLOWED_SETTINGS.has(key)) throw new Error(`Ajuste no permitido: ${key}`);
    switch (key) {
      case 'theme':
        if (!['dark', 'light'].includes(value)) throw new Error('Tema no válido.');
        break;
      case 'locale':
        if (!['es', 'en'].includes(value)) throw new Error('Idioma no válido.');
        break;
      case 'fontSize':
        if (!Number.isFinite(value) || value < 10 || value > 24) throw new Error('Tamaño de fuente no válido.');
        break;
      case 'speechRate':
        if (!Number.isFinite(value) || value < 0.6 || value > 1.6) throw new Error('Velocidad de voz no válida.');
        break;
      case 'speechVoice':
        if (value !== null && (typeof value !== 'string' || value.length > 300)) throw new Error('Voz no válida.');
        break;
      case 'lastUpdateCheck':
        if (!Number.isFinite(value) || value < 0) throw new Error('Fecha de comprobación no válida.');
        break;
      case 'latestKnownVersion':
        if (value !== null && (typeof value !== 'string' || value.length > 60)) throw new Error('Versión no válida.');
        break;
      case 'animations':
      case 'demo':
      case 'archiveSubagents':
      case 'autoCompact':
        if (typeof value !== 'boolean') throw new Error(`Valor no válido para ${key}.`);
        break;
      case 'autoCompactTokens':
        if (!Number.isFinite(value) || value < 5000 || value > 2000000) throw new Error('Umbral de compactación no válido.');
        break;
      case 'opencodePath':
        if (value !== null && (typeof value !== 'string' || value.length > 1024 || /[&|<>^"`\r\n\u0000]/.test(value))) {
          throw new Error('Ruta de opencode no válida.');
        }
        break;
      case 'lastProject':
        if (value !== null && (typeof value !== 'string' || value.length > 2048 || /[\r\n\u0000]/.test(value))) {
          throw new Error('Proyecto no válido.');
        }
        break;
      case 'connection': {
        if (!plainObject(value) || !['spawn', 'connect'].includes(value.mode)) throw new Error('Conexión no válida.');
        if (!safeHttpUrl(value.url)) throw new Error('URL del servidor no válida.');
        if (value.password !== undefined && (typeof value.password !== 'string' || value.password.length > 512)) {
          throw new Error('Contraseña no válida.');
        }
        clean.connection = {
          mode: value.mode,
          url: typeof value.url === 'string' ? value.url : '',
          password: typeof value.password === 'string' ? value.password : '',
        };
        break;
      }
      case 'recentProjects':
        if (!Array.isArray(value) || value.length > 50) throw new Error('Proyectos recientes no válidos.');
        for (const item of value) {
          if (!plainObject(item) || typeof item.directory !== 'string' || item.directory.length > 2048) {
            throw new Error('Proyectos recientes no válidos.');
          }
        }
        break;
      case 'permissions':
        if (!plainObject(value)) throw new Error('Permisos no válidos.');
        break;
      case 'preferredModel':
      case 'preferredAgent':
        if (value !== null && (typeof value !== 'string' || value.length > 200)) throw new Error(`Valor no válido para ${key}.`);
        break;
      default:
        if (!plainObject(value) || !smallEnough(value)) throw new Error(`Valor no válido para ${key}.`);
    }
    clean[key] = value;
  }
  return clean;
}

function assertRequestOptions(options) {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('Opciones de petición no válidas.');
  }
  const { query, body, timeout, responseType } = options;
  if (query !== undefined && (typeof query !== 'object' || query === null || Array.isArray(query))) {
    throw new Error('`query` debe ser un objeto.');
  }
  if (responseType !== undefined && responseType !== 'base64') {
    throw new Error('Tipo de respuesta no válido.');
  }
  if (body !== undefined) {
    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (size > MAX_BODY) throw new Error('El cuerpo de la petición es demasiado grande.');
  }
  return { query, body, timeout, responseType };
}

function assertPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/api/') || path.length > 2048) {
    throw new Error('Ruta de API no válida.');
  }
  if (/[\s"'`<>]/.test(path)) throw new Error('Ruta de API no válida.');
  if (path.includes('//') || path.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Ruta de API no válida.');
  }
  return path;
}

/**
 * Registers every IPC channel. All arguments coming from the renderer are
 * validated here before touching the backend.
 */
function registerIpc({ backend, settings, getWindow, uiCheck }) {
  ipcMain.handle('oc:request', async (_event, method, path, options) => {
    try {
      const verb = String(method || 'GET').toUpperCase();
      if (!METHODS.has(verb)) throw new Error('Método HTTP no permitido.');
      return await backend.request(verb, assertPath(path), assertRequestOptions(options));
    } catch (error) {
      return { ok: false, status: 0, data: null, error: error.message };
    }
  });

  const sendTerminal = (channel, payload) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  // Terminal directo (PowerShell, scripts y versiones en la raíz del proyecto).
  ipcMain.handle('oc:terminal:run', async (_event, options = {}) => terminal.run(options, sendTerminal));
  ipcMain.handle('oc:terminal:stop', async (_event, id) => terminal.stop(id));
  ipcMain.handle('oc:terminal:scripts', async (_event, directory) => terminal.scriptsOf(directory));
  ipcMain.handle('oc:terminal:script', async (_event, options = {}) => terminal.runScript(options, sendTerminal));
  ipcMain.handle('oc:terminal:version', async (_event, options = {}) => terminal.bumpVersion(options, sendTerminal));
  ipcMain.handle('oc:terminal:dispose', async () => { terminal.killAll(); });

  // Source Control (Git): todas las rutas se validan en electron/git.js.
  ipcMain.handle('oc:git:status', async (_event, directory) => git.status(directory));
  ipcMain.handle('oc:git:diff', async (_event, directory, file, staged) => git.diff(directory, file, staged));
  ipcMain.handle('oc:git:stage', async (_event, directory, file) => git.stage(directory, file));
  ipcMain.handle('oc:git:unstage', async (_event, directory, file) => git.unstage(directory, file));
  ipcMain.handle('oc:git:commit', async (_event, directory, message) => git.commit(directory, message));
  ipcMain.handle('oc:git:push', async (_event, directory) => git.push(directory));
  ipcMain.handle('oc:git:pull', async (_event, directory) => git.pull(directory));
  ipcMain.handle('oc:git:branch', async (_event, directory) => git.branch(directory));
  ipcMain.handle('oc:git:log', async (_event, directory) => git.log(directory));

  ipcMain.handle('oc:server:start', async (_event, options = {}) => {
    const projectDir = typeof options.projectDir === 'string' ? options.projectDir : undefined;
    if (backend.demoEnabled) return backend.enableDemo();
    return backend.manager.start({
      projectDir,
      opencodePath: settings.get().opencodePath,
    });
  });

  ipcMain.handle('oc:server:stop', async () => backend.stopServer());
  ipcMain.handle('oc:server:restart', async () => backend.restartServer());
  ipcMain.handle('oc:server:status', async () => backend.status());

  ipcMain.handle('oc:project:pick', async () => {
    const window = getWindow();
    const result = await dialog.showOpenDialog(window, {
      title: 'Elegir carpeta de proyecto',
      properties: ['openDirectory'],
      buttonLabel: 'Abrir proyecto',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('oc:project:open', async (_event, directory) => {
    if (typeof directory !== 'string' || directory.length === 0) {
      return { ok: false, error: 'Carpeta no válida.' };
    }
    return backend.openProject(directory);
  });

  ipcMain.handle('oc:settings:get', async () => settings.get());

  ipcMain.handle('oc:settings:set', async (_event, partial) => {
    if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) {
      throw new Error('Ajustes no válidos.');
    }
    const next = settings.set(sanitizeSettings(partial));
    const window = getWindow();
    if (window) {
      window.webContents.send('oc:settings:changed', next);
    }
    return next;
  });

  ipcMain.handle('oc:open-external', async (_event, url) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      return { ok: false, error: 'Enlace no válido.' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { ok: false, error: 'Solo se pueden abrir enlaces http(s) seguros.' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true };
  });

  ipcMain.handle('oc:opencode:open-config', async (_event, configPath) => {
    if (typeof configPath !== 'string' || configPath.length > 2048) {
      return { ok: false, error: 'Ruta de configuración no válida.' };
    }
    const result = await backend.request('GET', '/api/config');
    if (!result.ok) return { ok: false, error: result.error };
    const documents = Array.isArray(result.data) ? result.data : (result.data?.data || []);
    const allowed = documents.some((document) => document?.type === 'document' && document.path === configPath);
    if (!allowed) return { ok: false, error: 'OpenCode no reconoce ese archivo de configuración.' };
    const error = await shell.openPath(configPath);
    return error ? { ok: false, error } : { ok: true };
  });

  ipcMain.handle('oc:setup:check', async (_event, force = false) => {
    const current = settings.get();
    const fresh = Date.now() - (current.lastUpdateCheck || 0) < 24 * 60 * 60 * 1000;
    const cachedLatest = !force && fresh ? (current.latestKnownVersion || '') : '';
    const report = await setup.check(current.opencodePath, cachedLatest);
    if (!cachedLatest) {
      await settings.set({
        lastUpdateCheck: Date.now(),
        latestKnownVersion: report.opencode.latest || current.latestKnownVersion || '',
      });
    }
    return report;
  });
  ipcMain.handle('oc:setup:install', async (_event, id) => {
    if (typeof id !== 'string') return { ok: false, error: 'Componente no válido.' };
    return setup.install(id, { window: getWindow(), opencodePath: settings.get().opencodePath });
  });
  ipcMain.handle('oc:setup:cancel', async () => setup.cancel());
  // El directorio del renderer nunca se usa: el proyecto abierto lo decide el
  // proceso principal, para no leer/escribir configuraciones de otras carpetas.
  const configDirectory = () => settings.get().lastProject || null;
  ipcMain.handle('oc:config:read', async (_event, scope) => ocConfig.readConfig(
    scope === 'global' ? 'global' : 'project',
    scope === 'global' ? null : configDirectory(),
  ));
  ipcMain.handle('oc:config:write', async (_event, scope, _directory, text) => (
    ocConfig.writeConfig(
      scope === 'global' ? 'global' : 'project',
      scope === 'global' ? null : configDirectory(),
      text,
      getWindow(),
    )
  ));
  ipcMain.handle('oc:config:reveal', async (_event, scope) => ocConfig.reveal(
    scope === 'global' ? 'global' : 'project',
    scope === 'global' ? null : configDirectory(),
  ));
  ipcMain.handle('oc:cli:capture', async (_event, id) => ocConfig.capture(String(id), settings.get().opencodePath));
  ipcMain.handle('oc:cli:terminal', async (_event, id) => ocConfig.terminal(String(id), settings.get().opencodePath, getWindow()));

  ipcMain.handle('oc:demo:is-enabled', async () => backend.demoEnabled);
  ipcMain.handle('oc:demo:set', async (_event, enabled) => backend.setDemo(Boolean(enabled)));

  ipcMain.handle('oc:app:info', async () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    demo: backend.demoEnabled,
    demoDirectory: DEMO_DIRECTORY,
    platform: process.platform,
    uiCheck: uiCheck,
  }));

  // Tráfico de datos: el renderer solo puede leer, poner a cero y anotar la
  // estimación del modelo (bytes). No hay forma de tocar el archivo.
  ipcMain.handle('oc:traffic:get', async () => traffic.snapshot());
  ipcMain.handle('oc:traffic:reset', async () => {
    traffic.reset();
    return traffic.snapshot();
  });
  ipcMain.handle('oc:traffic:agent', async (_event, payload = {}) => {
    const bytes = (value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0) return 0;
      return Math.min(Math.round(number), 1024 * 1024 * 1024);
    };
    traffic.noteAgent({ up: bytes(payload.up), down: bytes(payload.down) });
    return { ok: true };
  });

  ipcMain.on('renderer-ready', (_event, options) => {
    if (options?.uiCheck) {
      // UI check mode - handled in renderer
    }
    backend.markRendererReady();
  });

  ipcMain.handle('oc:demo:sessions', async () => {
    if (backend.demoEnabled && backend.demo) {
      const sessions = Array.from(backend.demo.sessions.values());
      return { ok: true, sessions };
    }
    return { ok: false, sessions: [] };
  });

  backend.on('event', (payload) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('oc:event', payload);
  });

  backend.on('server-state', (state) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('oc:server:state', state);
  });

  backend.on('sse-state', (state) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send('oc:sse:state', state);
  });
}

module.exports = { registerIpc };
