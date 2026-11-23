import {
  state, set, subscribe, setUI, activeSession, sessionById, isSubagentLive, upsertSession, patchSession,
  rememberProject, applyTerminalEvent,
} from './store.js';
import {
  api as request, refreshSessions, loadHistory, createSession, loadMcpServers,
  loadSubagents, setSessionArchived,
} from './api.js';
import { handleEvent, normalizeHistory, setHistory } from './event-router.js';
import { createSessionController } from './session-controller.js';
import { basename } from './util/format.js';
import { setLocale, startDomObserver, t } from './i18n.js';
import { speechChunks, pickVoice } from './ui/speech.js';
import { closeTopEscape } from './ui/escape-stack.js';
import { mountTopbar } from './ui/topbar.js';
import { mountOfficePixelArt } from './ui/office-pixelart.js';
import { mountChat } from './ui/chat.js';
import { mountPermissions } from './ui/permissions.js';
import { mountQuestions } from './ui/questions.js';
import { mountActivityBar } from './ui/activity-bar.js';
import { openSettings } from './ui/settings.js';
import { showWelcome, hideWelcome } from './ui/welcome.js';
import { toast, toastError } from './ui/toast.js';
import { mountCommandPalette } from './ui/command-palette.js';
import { openSessionSwitch, openModelPicker, openAgentPicker, openLogsWindow } from './ui/dialogs.js';
import { showTab, applyPanelState, initPanelRouter, activePanelInstance, PANEL_KEYS } from './ui/panel-tabs.js';
import { mountSplitters } from './ui/splitters.js';
import { openSetupDialog, checkEnvironmentOnStart } from './ui/setup-dialog.js';
import { mountQuota, openUsage, detectLimit } from './ui/quota.js';
import { mountContextMeter, requestCompaction, maybeAutoCompact } from './ui/context-meter.js';
import { openOpenCodeConfig, showCliOutput, openCliTerminal } from './ui/opencode-config.js';

let chat = null;
let office = null;
let readyInFlight = false;
let sessionsTimer = null;
let mcpRefreshTimer = null;
let mcpRefreshInFlight = false;
let selectToken = 0;
let commandPalette = null;
let splitters = null;
let subagentTimer = null;
let envChecked = false;
// workspace pedido por un .hl (doble clic); se abre en cuanto el servidor esté listo
// y tiene prioridad sobre `lastProject`.
let requestedWorkspace = null;

const SUBAGENT_SWEEP_MS = 2000;
// The grace period (12 s) is handled by `isSubagentLive`; once retired, wait
// this long before archiving it so the user can still open it from the panel.
const SUBAGENT_ARCHIVE_DELAY_MS = 48000;
const SUBAGENT_KEEP_MS = 60000;
const discoveryAt = new Map();
const subagentLoads = new Map();
const DELEGATION_TOOL = /^(task|agent|subagent|dispatch|delegate)(?:[_-].*)?$/i;

// El modelo y el esfuerzo elegidos se recuerdan por sesión (ver model-prefs.js).
import { modelPins, pinModel, variantOf } from './model-prefs.js';

const LAYOUT_KEYS = {
  '--side-w': 'sideW',
  '--office-h': 'officeH',
};

const handlers = {
  onOpenProject: (directory) => openProject(directory),
  onSelectSession: (sessionID) => selectSession(sessionID),
  onNewSession: () => newSession(),
  onDeleteSession: (session) => controller.deleteSession(session),
  onCleanSubagents: (session) => controller.cleanSubagents(session),
  onSend: (text) => controller.submitPrompt(text),
  onRetryLast: () => controller.retryLast(),
  onAbort: () => controller.abort(),
  onUndo: () => controller.undoLastChange(),
  onDiscard: () => controller.discardStaged(),
  onClearView: () => controller.clearView(),
  onToggleOffice: () => toggleOffice(),
  onEnterOfficeFp: () => office?.enterFirstPerson?.(),
  onRestartServer: () => restartServer(),
  onOpenSettings: () => openSettingsModal(),
  onToggleTheme: () => toggleTheme(),
  onSelectAgent: (agentID) => applyAgent(agentID),
  onSelectModel: (reference) => selectModel(reference),
  onSwitchSession: () => switchSession(),
  onKillSession: () => controller.killSession(),
  onShell: () => controller.shellCommand(),
  onModelSelect: () => selectModel(),
  onAgentSelect: (agentID) => (agentID ? applyAgent(agentID) : selectAgent()),
  onPermissionAllow: () => controller.permissionReply('allow'),
  onPermissionOnce: () => controller.permissionReply('once'),
  onPermissionDeny: () => controller.permissionReply('deny'),
  onMCPList: () => { showTab('mcp'); },
  onMCPConnect: () => { showTab('mcp'); },
  onMCPDisconnect: () => { showTab('mcp'); },
  onFSList: () => { showTab('files'); },
  onFSFind: () => { showTab('files'); },
  onFSRead: (path) => {
    showTab('files');
    const panel = activePanelInstance();
    if (path && panel?.select) panel.select(path);
  },
  onFSWrite: () => { showTab('files'); },
  onVCSDiff: () => { showTab('files'); },
  onVCSStatus: () => { showTab('files'); },
  onSessionHistory: () => { showTab('activity'); },
  onSessionExport: () => exportSession(),
  onSettings: () => openSettingsModal(),
  onToggleRail: () => setUI({ railOpen: !state.ui.railOpen }),
  onToggleTerminal: () => showTab('terminal'),
  onFocusChat: () => chat?.focus(),
  onDemoMode: () => toggleDemoMode(),
  onViewLogs: () => viewLogs(),
  onFoldersChanged: (sessionID, folders) => handleFoldersChanged(sessionID, folders),
  onExploreFolder: (folder) => exploreFolder(folder),
  onRunCommand: (name) => controller.submitPrompt(`/${name}`),
  onCompact: () => requestCompaction('manual'),
  onUseAgent: (agentID) => applyAgent(agentID),
  onOpenPalette: () => commandPalette?.open(),
  onToggleThinking: () => toggleThinking(),
  onToggleAnimations: () => window.oc.settings.set({ animations: state.settings.animations === false }),
  onToggleDetails: () => toggleDetails(),
  onCheckUpdates: () => checkEnvironmentOnStart({ onRestartServer: restartServer, force: true }),
  onOpenSetup: () => openSetupDialog({ onRestartServer: restartServer }),
  onOpenUsage: () => openUsage(),
  onOpenConfig: () => openOpenCodeConfig({ onRestartServer: restartServer }),
  onCli: (id, title) => showCliOutput(id, title),
  onTerminal: (id) => openCliTerminal(id),
  onCreateWorkspaceFile: async () => {
    if (!state.project.dir) { toast('Abre un proyecto primero.', 'warn'); return; }
    const result = await window.oc.workspace.createFile(state.project.dir);
    if (result.ok) toast(result.existed ? `Ya existe: ${result.file}` : `Archivo creado: ${result.file}`, 'success', 4500);
    else toastError(result.error, 'No se pudo crear el archivo .hl');
  },
  onRegisterHl: async () => {
    const result = await window.oc.workspace.register();
    if (result.ok) toast('Archivos .hl registrados. Si no ves "Proyecto de HLab Interactive" en Nuevo, reinicia el Explorador.', 'success', 6000);
    else if (!result.cancelled) toastError(result.error, 'No se pudo registrar .hl');
  },
  onUnregisterHl: async () => {
    const result = await window.oc.workspace.unregister();
    if (result.ok) toast('Registro de .hl eliminado.', 'success', 3000);
  },
};

const controller = createSessionController({
  selectSession: (sessionID) => selectSession(sessionID),
  showTab: (tab) => showTab(tab),
  reloadSessions: () => reloadSessions(),
  syncSelection: (session) => syncSelection(session),
});

function applyViewFlags() {
  const app = document.getElementById('app');
  try {
    app.dataset.hideThinking = localStorage.getItem('ocv.hideThinking') === '1' ? 'on' : 'off';
    app.dataset.hideTools = localStorage.getItem('ocv.hideTools') === '1' ? 'on' : 'off';
  } catch { /* sin almacenamiento */ }
}

function toggleFlag(key, label) {
  let next = true;
  try {
    next = localStorage.getItem(key) !== '1';
    localStorage.setItem(key, next ? '1' : '0');
  } catch { /* sin almacenamiento */ }
  applyViewFlags();
  toast(`${label}: ${next ? 'ocultos' : 'visibles'}`, 'info', 1800);
}

function toggleThinking() { toggleFlag('ocv.hideThinking', 'Razonamiento'); }
function toggleDetails() { toggleFlag('ocv.hideTools', 'Detalles de herramientas'); }

function applyAppearance(settings) {
  setLocale(settings.locale || 'es');
  const theme = settings.theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--font-size', `${settings.fontSize || 14}px`);
  const app = document.getElementById('app');
  app.dataset.theme = theme;
  app.dataset.animations = settings.animations === false ? 'off' : 'on';
  applyViewFlags();
}

async function restartServer() {
  set({ server: { ...state.server, state: 'starting', message: 'Reiniciando servidor…' } });
  const status = await window.oc.server.restart();
  set({ server: status });
  if (status.state === 'ready') await onServerReady();
}

async function onServerReady() {
  if (readyInFlight) return;
  readyInFlight = true;
  try {
    hideWelcome();
    if (!state.server.demo && !envChecked) {
      envChecked = true;
      void checkEnvironmentOnStart({ onRestartServer: restartServer });
    }
    await refreshMeta();
    // Un .hl abierto desde el Explorador manda: se consume una sola vez y gana
    // aunque hubiera un `lastProject` guardado de la sesión anterior.
    const directory = requestedWorkspace
      || state.project.dir
      || state.settings.lastProject
      || (state.server.demo ? state.appInfo?.demoDirectory : null);
    requestedWorkspace = null;
    if (directory) await openProject(directory, { silent: true });
    else showWelcomeScreen();
  } catch (error) {
    showWelcomeScreen(error.message);
  } finally {
    readyInFlight = false;
  }
}

function showWelcomeScreen(message) {
  if (state.project.dir && !message) return;
  if (/opencode/i.test(message || '') && /No se encontr|PATH|ENOENT/i.test(message || '')) {
    openSetupDialog({ onRestartServer: restartServer, autoInstall: true });
  }
  showWelcome({
    message,
    demo: Boolean(state.server.demo),
    onOpenProject: () => openProject(),
    onRetry: () => restartServer(),
    onSettings: () => openSettingsModal(),
    onDemo: async () => {
      const status = await window.oc.demo.setEnabled(true);
      set({ server: status });
      if (status.state === 'ready') await onServerReady();
    },
  });
}

async function refreshMeta() {
  const [agents, models, commands, mcpServers] = await Promise.all([
    request('GET', '/api/agent'),
    request('GET', '/api/model'),
    request('GET', '/api/command'),
    loadMcpServers(),
  ]);
  if (agents.ok) set({ agents: agents.data?.data || [] });
  if (models.ok) set({ models: models.data?.data || [] });
  if (commands.ok) set({ commands: commands.data?.data || [] });
  set({ mcpServers });
}

async function refreshMcpStatus() {
  if (mcpRefreshInFlight || state.server.state !== 'ready') return;
  mcpRefreshInFlight = true;
  try {
    const servers = await loadMcpServers();
    set({ mcpServers: servers });
  } catch (error) {
    console.warn('[mcp] No se pudo actualizar el estado:', error.message);
  } finally {
    mcpRefreshInFlight = false;
  }
}

function syncMcpPolling(ready) {
  if (ready && !mcpRefreshTimer) {
    refreshMcpStatus();
    mcpRefreshTimer = setInterval(refreshMcpStatus, 5000);
  } else if (!ready && mcpRefreshTimer) {
    clearInterval(mcpRefreshTimer);
    mcpRefreshTimer = null;
  }
}

/**
 * Opens a project. Without a directory it asks the user for one first, so the
 * project button, the menu and Ctrl+O always work.
 */
async function openProject(directory, options = {}) {
  if (state.server.state !== 'ready') {
    if (!options.silent) toast('El servidor no está listo', 'warn');
    return;
  }

  let target = directory;
  if (!target) {
    try {
      target = await window.oc.project.pick();
    } catch (error) {
      toastError(error.message, 'No se pudo abrir el selector de carpetas');
      return;
    }
    if (!target) return; // the user cancelled
  }

  const result = await window.oc.project.open(target);
  if (!result.ok) {
    toastError(result.error, 'No se pudo abrir el proyecto');
    showWelcomeScreen(result.error);
    return;
  }
  const changedProject = state.project.dir !== target;
  // Cambiar de carpeta NO detiene nada: el servidor mantiene los turnos de todos
  // los proyectos. Solo guardamos el inventario del proyecto saliente para poder
  // seguir mostrando (y marcando) su trabajo mientras vemos otro.
  if (state.project.dir) rememberProject(state.project.dir);
  rememberProject(target);
  set({
    project: { dir: target, name: basename(target) },
    ...(changedProject ? {
      activeSessionId: null,
      selection: { providerID: null, modelID: null, agent: null },
    } : {}),
  });
  if (!options.silent) toast(`Proyecto abierto: ${basename(target)}`, 'success');
  await refreshMeta();
  await reloadSessions();
  const list = state.sessions;
  if (!state.activeSessionId && list.length > 0) await selectSession(list[0].id);
}

async function reloadSessions() {
  const result = await refreshSessions();
  if (!result.ok) {
    toastError(result.error, 'No se pudieron cargar las sesiones');
    return state.sessions;
  }
  // Be defensive: if the server ignores `parentID=null`, split the payload here
  // instead of letting subagents leak into the root list.
  const sessions = result.sessions.filter((session) => !session.parentID);
  const fetchedChildren = result.sessions.filter((session) => session.parentID);
  const roots = new Set(sessions.map((session) => session.id));
  const known = new Map(state.subagents.map((child) => [child.id, child]));
  for (const child of fetchedChildren) {
    const previous = known.get(child.id);
    const merged = { ...(previous || {}), ...child };
    const parent = child.parentID ? sessionById(child.parentID) || sessions.find((item) => item.id === child.parentID) : null;
    if (previous?.agent && (!child.agent || child.agent === parent?.agent)) merged.agent = previous.agent;
    known.set(child.id, merged);
  }
  const subagents = [...known.values()].filter((child) => roots.has(child.parentID));
  const activeStillExists = Boolean(sessionById(state.activeSessionId));
  const activeSessionId = activeStillExists ? state.activeSessionId : null;
  set({ sessions, subagents, activeSessionId });
  // El inventario por proyecto permite detectar trabajo en segundo plano cuando
  // el usuario salta a otra carpeta, sin tocar los turnos en curso.
  rememberProject(state.project.dir, { sessions, subagents, activeSessionId });
  return sessions;
}

/** Loads the child sessions of a root so the panel can show its subagents. */
async function ensureSubagents(parentID) {
  if (!parentID) return;
  const pending = subagentLoads.get(parentID);
  if (pending) return pending;

  const loading = loadSubagents(parentID).then((result) => {
    if (!result.ok) {
      console.warn('[sessions] No se pudieron cargar los subagentes:', result.error);
      return;
    }

    const known = new Map(state.subagents.map((session) => [session.id, session]));
    let changed = false;
    for (const child of result.sessions) {
      if (child.parentID !== parentID) continue;
      const previous = known.get(child.id);
      const previousIsNewer = previous?.time?.updated
        && child.time?.updated
        && previous.time.updated > child.time.updated;
      const merged = previousIsNewer
        ? { ...child, ...previous }
        : { ...previous, ...child };
      // El `agent` del step es la identidad real del subagente. Si el servidor
      // no lo trae (o trae el del padre), conservamos el que ya derivamos del
      // evento para que la fila no vuelva a mostrar "build".
      const parent = sessionById(parentID);
      if (previous?.agent && (!child.agent || child.agent === parent?.agent)) {
        merged.agent = previous.agent;
      }
      if (!previous || JSON.stringify(merged) !== JSON.stringify(previous)) {
        known.set(child.id, merged);
        changed = true;
      }
    }
    if (changed) set({ subagents: [...known.values()] });
  }).finally(() => {
    if (subagentLoads.get(parentID) === loading) subagentLoads.delete(parentID);
  });
  subagentLoads.set(parentID, loading);
  return loading;
}

/**
 * El subagente se crea unos instantes después de que el agente principal lanza la tarea:
 * se consulta varias veces (cada vez más espaciado) hasta que aparece, sin tener que
 * volver a pulsar el agente principal.
 */
const watching = new Map();
const WATCH_DELAYS = [500, 1200, 2200, 3600, 5500, 8000, 12000, 18000];
function watchSubagents(sessionID) {
  if (!sessionID) return;
  const now = Date.now();
  if (now - (watching.get(sessionID) || 0) < 900) return;
  watching.set(sessionID, now);
  for (const delay of WATCH_DELAYS) setTimeout(() => { void ensureSubagents(sessionID); }, delay);
}

/**
 * Red de seguridad: si se pierde algún evento (carrera al abrir la sesión, reconexión, ventana
 * en segundo plano), el chat quedaba desactualizado hasta volver a pulsar el agente. Mientras
 * la sesión activa trabaja (o sus subagentes) se compara con el servidor y solo se aplica si
 * el servidor tiene más contenido que lo que se ve.
 */
function historyWeight(list) {
  let weight = list.length * 1e6;
  for (const message of list) {
    weight += (message.text?.length || 0);
    for (const block of message.blocks || []) {
      weight += (block.text?.length || 0) + (block.tool ? (block.tool.output?.length || 0) + (block.tool.status === 'completed' ? 2 : 1) : 0);
    }
  }
  return weight;
}

let reconciling = false;
async function reconcileActiveSession(force = false) {
  const session = activeSession();
  if (!session || reconciling || state.server.state !== 'ready' || document.hidden) return;
  const working = state.runtime[session.id]?.busy
    || state.subagents.some((child) => child.parentID === session.id && state.runtime[child.id]?.busy)
    || state.sse?.state === 'error' || state.sse?.state === 'reconnecting';
  if (!working && !force) return;
  reconciling = true;
  try {
    const history = await loadHistory(session.id);
    if (!history.ok || session.id !== state.activeSessionId) return;
    const server = normalizeHistory(history.messages);
    if (historyWeight(server) > historyWeight(state.messages[session.id] || [])) setHistory(session.id, server);
  } finally {
    reconciling = false;
  }
}

/** Archives one subagent and removes it from the view (never touches roots). */
async function archiveSubagent(sessionID) {
  await setSessionArchived(sessionID, true).catch(() => null);
  set({ subagents: state.subagents.filter((session) => session.id !== sessionID) });
}

/**
 * Retires finished subagents: they stay visible for the grace period, then the
 * office drops their avatar and, after a while, they are archived on the server
 * (so the next reload does not bring them back).
 */
function sweepSubagents() {
  if (state.subagents.length === 0 && state.sessions.every((session) => !state.runtime[session.id]?.busy)) return;
  const now = Date.now();
  const archive = state.settings.archiveSubagents !== false;
  const roots = new Set(state.sessions.map((session) => session.id));
  const next = [];
  let changed = false;

  for (const child of state.subagents) {
    if (!roots.has(child.parentID)) { changed = true; continue; }
    if (isSubagentLive(child)) {
      if (child.retired) { changed = true; next.push({ ...child, retired: false, retiredAt: 0 }); }
      else next.push(child);
      continue;
    }
    if (!child.retired) {
      changed = true;
      next.push({ ...child, retired: true, retiredAt: now });
      continue;
    }
    const retiredFor = now - (child.retiredAt || now);
    if (archive && retiredFor >= SUBAGENT_ARCHIVE_DELAY_MS) {
      changed = true;
      void archiveSubagent(child.id);
      continue;
    }
    if (!archive && retiredFor >= SUBAGENT_KEEP_MS) { changed = true; continue; }
    next.push(child);
  }

  if (changed) set({ subagents: next });

  // Discovery: a working root may be delegating and we missed the event (for
  // example when the app was opened mid-turn). Ask for its children now and
  // then; the ones that already finished end up archived.
  for (const root of state.sessions) {
    const runtime = state.runtime[root.id];
    if (!runtime?.busy) continue;
    // Only while it is delegating (or before the first tool arrives).
    if (runtime.tool && !DELEGATION_TOOL.test(String(runtime.tool))) continue;
    const hasLive = state.subagents.some((child) => child.parentID === root.id && isSubagentLive(child));
    if (hasLive) continue;
    const last = discoveryAt.get(root.id) || 0;
    if (now - last < 8000) continue;
    discoveryAt.set(root.id, now);
    void ensureSubagents(root.id);
  }
}

function scheduleSessionsRefresh() {
  if (sessionsTimer) return;
  sessionsTimer = setTimeout(async () => {
    sessionsTimer = null;
    await reloadSessions();
  }, 700);
}

async function selectSession(sessionID) {
  const session = sessionById(sessionID);
  if (!session) return;
  const token = (selectToken += 1);
  set({ activeSessionId: sessionID, selection: selectionFromSession(session) });
  if (!session.parentID) ensureSubagents(sessionID);

  const history = await loadHistory(sessionID);
  if (token !== selectToken) return;
  if (!history.ok) {
    toastError(history.error, 'No se pudo cargar el historial');
    return;
  }
  const server = normalizeHistory(history.messages);
  // los eventos que llegaron mientras se descargaba el historial no se pisan con una foto más vieja
  if (historyWeight(server) >= historyWeight(state.messages[sessionID] || [])) setHistory(sessionID, server);
}

async function newSession({ silent = false } = {}) {
  if (!state.project.dir) {
    if (!silent) toast('Abre un proyecto primero.', 'warn');
    return;
  }
  const agent = state.selection.agent || 'build';
  const selectedModel = state.models.find((item) => item.providerID === state.selection.providerID
    && (item.modelID === state.selection.modelID || item.id === state.selection.modelID));
  const model = selectedModel ? { id: selectedModel.id, providerID: selectedModel.providerID } : null;
  const result = await createSession({ title: `Sesión ${state.sessions.length + 1}`, agent, model });
  if (!result.ok) {
    toastError(result.error, 'No se pudo crear la sesión');
    return;
  }
  const session = result.data?.data;
  await reloadSessions();
  await selectSession(session.id);
  if (!silent) toast('Nueva sesión creada', 'success');
}

function selectionFromSession(session) {
  const fallback = state.models.find((m) => m.enabled !== false) || state.models[0] || null;
  const pinned = modelPins[session?.id];
  const model = pinned ? { providerID: pinned.providerID, id: pinned.modelID } : (session?.model || {});
  const modelInfo = state.models.find((item) => item.providerID === model.providerID
    && (item.id === model.id || item.modelID === model.id)) || fallback;
  return {
    providerID: model.providerID || modelInfo?.providerID || null,
    modelID: modelInfo?.modelID || model.id || model.modelID || null,
    agent: session?.agent || state.selection.agent || 'build',
  };
}

async function switchSession() {
  openSessionSwitch((sessionID) => selectSession(sessionID));
}

async function syncSelection(session) {
  const selection = selectionFromSession(session);
  const model = state.models.find((item) => item.providerID === selection.providerID
    && (item.modelID === selection.modelID || item.id === selection.modelID));
  const serverModel = session.model || {};
  const wantedVariant = variantOf(session.id);
  const inSync = model && serverModel.providerID === model.providerID
    && (serverModel.id === model.id || serverModel.id === model.modelID)
    && (serverModel.variant || '') === wantedVariant;
  if (model && !inSync) {
    const reference = { id: model.id, providerID: model.providerID, ...(wantedVariant ? { variant: wantedVariant } : {}) };
    let result = await request('POST', `/api/session/${session.id}/model`, { body: { model: reference } });
    if (!result.ok && wantedVariant) {
      // el servidor no conoce `variant`: se sincroniza solo el modelo
      result = await request('POST', `/api/session/${session.id}/model`, { body: { model: { id: model.id, providerID: model.providerID } } });
    }
    if (result.ok) {
      patchSession(session.id, { model: { id: model.id, providerID: model.providerID, ...(wantedVariant ? { variant: wantedVariant } : {}) } });
      set({ selection: { ...state.selection, modelID: selection.modelID, providerID: selection.providerID } });
    }
  }
  if (selection.agent && state.selection.agent !== selection.agent) {
    await request('POST', `/api/session/${session.id}/agent`, { body: { agent: selection.agent } });
    set({ selection: { ...state.selection, agent: selection.agent } });
  }
}

async function selectModel(reference) {
  if (!reference) {
    openModelPicker();
    return;
  }
  const session = activeSession();
  const model = state.models.find((item) => item.providerID === reference.providerID
    && (item.modelID === reference.modelID || item.id === reference.modelID));
  if (!model) return;
  if (!session) {
    set({ selection: { ...state.selection, modelID: model.modelID, providerID: model.providerID } });
    toast('Modelo elegido para la próxima sesión', 'success');
    return;
  }

  const result = await request('POST', `/api/session/${session.id}/model`, {
    body: { model: { id: model.id, providerID: model.providerID } },
  });
  if (!result.ok) {
    toastError(result.error, 'No se pudo cambiar el modelo');
    return;
  }
  pinModel(session.id, model);
  patchSession(session.id, { model: { id: model.id, providerID: model.providerID } });
  set({ selection: { ...state.selection, modelID: model.modelID, providerID: model.providerID } });
  toast('Modelo cambiado', 'success');
}

function selectAgent(agentID) {
  if (agentID) return applyAgent(agentID);
  openAgentPicker();
}

async function exportSession() {
  controller.exportSession();
}

async function handleFoldersChanged(sessionID, folders) {
  const session = sessionById(sessionID);
  const directory = session?.location?.directory || state.project.dir;
  if (!directory) return;
  const previous = state.settings || {};
  const projectFolders = { ...(previous.projectFolders || {}), [directory]: folders };
  set({ settings: { ...previous, projectFolders } });
  try {
    const settings = await window.oc.settings.set({ projectFolders });
    set({ settings });
    return true;
  } catch (error) {
    set({ settings: previous });
    toastError(error, 'No se pudo guardar el contexto del proyecto');
    return false;
  }
}

async function applyAgent(agentID) {
  if (!agentID) return;
  const session = activeSession();
  if (!session) {
    set({ selection: { ...state.selection, agent: agentID } });
    toast(`Agente para la próxima sesión: ${agentID}`, 'success');
    return;
  }
  const result = await request('POST', `/api/session/${session.id}/agent`, { body: { agent: agentID } });
  if (!result.ok) {
    toastError(result.error, 'No se pudo cambiar el agente');
    return;
  }
  patchSession(session.id, { agent: agentID });
  set({ selection: { ...state.selection, agent: agentID } });
  toast(`Agente: ${agentID}`, 'success');
}

function exploreFolder(folder) {
  showTab('folders');
  toast(`Explorando ${basename(folder || '')} en el panel de contexto.`, 'info', 2500);
}

async function toggleDemoMode() {
  const enabled = !state.server.demo;
  await window.oc.demo.setEnabled(enabled);
}

async function viewLogs() {
  openLogsWindow();
}

function openSettingsModal() {
  openSettings({
    onRestart: restartServer,
    onDemoChange: () => {},
  });
}

function toggleTheme() {
  const next = state.settings.theme === 'light' ? 'dark' : 'light';
  window.oc.settings.set({ theme: next });
}

/**
 * The layout changed shape: the old keys described a fixed sidebar, a fixed
 * board column and a bottom panel. They are migrated once to the new model
 * (width of the side panel and height of the office split).
 */
function migratedLayout() {
  const layout = { ...(state.settings.layout || {}) };
  if (typeof layout.sideW !== 'number' && typeof layout.sidebarW === 'number') {
    layout.sideW = layout.sidebarW;
  }
  if (typeof layout.officeH !== 'number' && typeof layout.panelH === 'number') {
    layout.officeH = layout.panelH;
  }
  delete layout.sidebarW;
  delete layout.boardW;
  delete layout.panelH;
  return layout;
}

/** Saves the size of a panel after the user dragged its splitter. */
function persistLayout(name, value) {
  const key = LAYOUT_KEYS[name];
  if (!key) return;
  const layout = { ...(state.settings.layout || {}), [key]: value };
  window.oc.settings.set({ layout }).then((settings) => set({ settings }));
}

/** Saves the arrangement of the side panel (columns and views). */
function persistPanelLayout(layout) {
  window.oc.settings.set({ panelLayout: layout }).then((settings) => set({ settings }));
}

/** Opens or closes the office (the split under the chat). */
function toggleOffice(force) {
  const open = force === undefined ? !state.ui.officeOpen : Boolean(force);
  if (!open) office?.exitFirstPerson?.('office');
  setUI({ officeOpen: open });
  if (!open) return;
  const current = Number(state.settings.layout?.officeH);
  const height = Number.isFinite(current) && current > 40 ? current : 300;
  splitters?.set('--office-h', height);
}

let eventDeps = null;

function wireWindowControls() {
  const controls = window.oc.windowControls;
  if (!controls) return;
  document.getElementById('win-min')?.addEventListener('click', () => void controls.minimize());
  document.getElementById('win-close')?.addEventListener('click', () => void controls.close());
  const maxButton = document.getElementById('win-max');
  const setMaxIcon = (maximized) => {
    if (!maxButton) return;
    maxButton.textContent = maximized ? '❐' : '□';
    maxButton.title = t(maximized ? 'Restaurar' : 'Maximizar');
    maxButton.setAttribute('aria-label', maxButton.title);
  };
  maxButton?.addEventListener('click', async () => setMaxIcon(await controls.toggleMaximize()));
  controls.onMaximized(setMaxIcon);
  void controls.isMaximized().then(setMaxIcon).catch(() => {});
  document.querySelector('.topbar')?.addEventListener('dblclick', (event) => {
    if (event.target.closest('button, select, input, textarea, label')) return;
    void controls.toggleMaximize();
  });
}

function wireIpc() {
  eventDeps = {
    onSessionsChanged: scheduleSessionsRefresh,
    onSessionSettled: () => { setTimeout(() => { maybeAutoCompact(); }, 1200); },
    onSubagentSpawn: (sessionID) => watchSubagents(sessionID),
    onProjectUpdated: () => {},
    onMcpChanged: refreshMcpStatus,
    onSessionError: (sessionID, message) => {
      if (detectLimit(message)) return;
      const quota = /quota|rate limit|límite/i.test(message);
      toast(
        quota
          ? `El proveedor no responde: ${message}`
          : `El turno falló: ${message}`,
        'error',
        8000,
      );
    },
  };
  window.oc.onEvent((event) => handleEvent(event, eventDeps));

  window.oc.server.onState((status) => {
    const previous = state.server.state;
    set({ server: status });
    if (status.state === 'ready' && previous !== 'ready') onServerReady();
    syncMcpPolling(status.state === 'ready');
    if (status.state === 'error' && previous !== 'error') showWelcomeScreen(status.message || 'El servidor no está disponible.');
  });

  window.oc.onSseState((sse) => set({ sse }));
  window.oc.onMenu((command) => {
    if (typeof command === 'string' && command.startsWith('workspace:')) {
      const dir = command.slice('workspace:'.length);
      // Segundo doble clic con la app ya abierta: si el servidor aún arranca,
      // se guarda y se abre en onServerReady en vez de perder la petición.
      if (state.server.state === 'ready') void openProject(dir);
      else requestedWorkspace = dir;
      return;
    }
    if (command === 'project:open') openProject();
  });
  window.oc.onToast((payload) => toast(payload.message, payload.type || 'error', 8000));
  // El terminal vive en el store global: el evento debe procesarse aunque el
  // panel esté desmontado, si no las ejecuciones se quedan en "running".
  window.oc.terminal.onEvent(applyTerminalEvent);
  window.oc.settings.onChanged((settings) => {
    set({ settings });
    applyAppearance(settings);
  });

  document.addEventListener('keydown', (event) => {
    const modalOpen = Boolean(document.querySelector(
      '.modal-backdrop, .lightbox, .command-palette-backdrop, .chat-search:not([hidden])',
    ));
    if (event.key === 'Escape' && !modalOpen) {
      // La primera persona captura Escape antes (window, fase de captura) para
      // salir del modo sin abortar la respuesta del agente.
      if (office?.isFirstPerson?.()) return;
      // Los paneles abiertos encima (p. ej. el diff de Source Control) se cierran
      // primero. El lateral solo se cierra cuando no hay nada por encima.
      if (closeTopEscape()) return;
      if (state.ui.railOpen) {
        setUI({ railOpen: false });
        return;
      }
      const session = activeSession();
      if (session && (state.runtime[session.id]?.busy)) abort();
      return;
    }
    if (modalOpen || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey && key === 'o') { event.preventDefault(); toggleOffice(); }
    else if (key === 'o') { event.preventDefault(); openProject(); }
    else if (key === 'n') { event.preventDefault(); newSession(); }
    else if (key === ',') { event.preventDefault(); openSettingsModal(); }
    else if (key === 'b') { event.preventDefault(); setUI({ railOpen: !state.ui.railOpen }); }
    else if (key === 'l') { event.preventDefault(); chat?.focus(); }
    else if (key === 'j') { event.preventDefault(); showTab('terminal'); }
    else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key)) {
      event.preventDefault();
      // El 0 abre el décimo panel (Source Control).
      const index = event.key === '0' ? PANEL_KEYS.length - 1 : Number(event.key) - 1;
      if (PANEL_KEYS[index]) showTab(PANEL_KEYS[index]);
    }
  });

  commandPalette = mountCommandPalette(handlers);

  // Signal renderer is ready for demo events
  window.oc.send('renderer-ready');
}

async function boot() {
  try {
    const [settings, info] = await Promise.all([
      window.oc.settings.get(),
      window.oc.app.info(),
    ]);
    set({ settings, appInfo: info });
    applyAppearance(settings);
    startDomObserver();

    mountTopbar(handlers);
    mountQuota();
    office = mountOfficePixelArt(handlers);
    window.__office = office;
    chat = mountChat(handlers);
    mountContextMeter();
    mountPermissions();
    mountQuestions();
    mountActivityBar({
      onSelect: (view) => showTab(view),
      onToggleOffice: () => toggleOffice(),
    });
    splitters = mountSplitters({ onChange: persistLayout });
    splitters.apply(migratedLayout());
    initPanelRouter(document.getElementById('panel-body'), handlers, persistPanelLayout);
    applyPanelState();
    window.__showPanel = showTab;

    const versionLabel = document.getElementById('app-version');
    if (versionLabel) versionLabel.textContent = `v${info.version}`;

    // Recoge el .hl del arranque ANTES de registrar onState: así no hay carrera
    // entre abrir el workspace pedido y abrir el último proyecto guardado.
    requestedWorkspace = await window.oc.workspace.pending().catch(() => null);
    wireIpc();
    wireWindowControls();
    if (!subagentTimer) subagentTimer = setInterval(sweepSubagents, SUBAGENT_SWEEP_MS);
    // Antes se descargaban 200 mensajes cada 3 s mientras el agente trabajaba:
    // Espaciamos y desbloqueamos el repintado por foco con un pequeño debounce.
    setInterval(() => { void reconcileActiveSession(); }, 8000);
    let focusTimer = null;
    window.addEventListener('focus', () => {
      clearTimeout(focusTimer);
      focusTimer = setTimeout(() => { void reconcileActiveSession(true); }, 400);
    });

    const status = await window.oc.server.status();
    // `uiCheck` viaja en app:info (no en server:status): sin esto el modo
    // verificación no exponía sus hooks y el informe se quedaba a medias.
    const isUiCheck = Boolean(status.uiCheck || state.appInfo?.uiCheck);
    window.__UI_CHECK__ = isUiCheck;
    if (isUiCheck) {
      // Solo en la verificación guiada: alimenta el mismo router de eventos que
      // usa el SSE real, para comprobar el marcador de trabajo en otros proyectos.
      window.__ocTestEvent = (event) => handleEvent(event, eventDeps);
      window.__ocState = () => state;
      window.__ocTranslate = (text) => t(text);
      window.__ocSpeech = {
        chunks: (text) => speechChunks(text),
        voice: (lang) => pickVoice(lang)?.name || null,
      };
      window.__ocSelectSession = (id) => selectSession(id);
      window.__ocOpenProject = (dir) => openProject(dir, { silent: true });
      window.__ocSelectFile = (filePath) => {
        showTab('files');
        activePanelInstance()?.select?.(filePath);
      };
    }

    // Signal renderer is ready for demo events (and UI check mode)
    window.oc.send('renderer-ready', { uiCheck: isUiCheck });
    set({ server: status });
    syncMcpPolling(status.state === 'ready');

    // In demo mode, fetch initial sessions from demo source
    if (status.demo || state.appInfo?.demo) {
      try {
        const result = await window.oc.demo.getSessions();
        if (result.ok && result.sessions) {
          for (const session of result.sessions) upsertSession(session);
        }
      } catch (error) {
        console.error('[app] No se pudieron cargar las sesiones demo:', error);
      }
    }

    if (status.state === 'ready') onServerReady();
    else if (status.state === 'error') showWelcomeScreen(status.message);
  } catch (error) {
    console.error('[app] boot error:', error);
    showWelcomeScreen(error.message);
  }
}

boot();