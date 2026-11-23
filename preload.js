'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const oc = {
  request(method, path, options = {}) {
    return ipcRenderer.invoke('oc:request', method, path, options);
  },
  server: {
    start(projectDir) {
      return ipcRenderer.invoke('oc:server:start', { projectDir });
    },
    stop() {
      return ipcRenderer.invoke('oc:server:stop');
    },
    restart() {
      return ipcRenderer.invoke('oc:server:restart');
    },
    status() {
      return ipcRenderer.invoke('oc:server:status');
    },
    onState(callback) {
      return subscribe('oc:server:state', callback);
    },
  },
  project: {
    pick() {
      return ipcRenderer.invoke('oc:project:pick');
    },
    open(directory) {
      return ipcRenderer.invoke('oc:project:open', directory);
    },
  },
  settings: {
    get() {
      return ipcRenderer.invoke('oc:settings:get');
    },
    set(partial) {
      return ipcRenderer.invoke('oc:settings:set', partial);
    },
    onChanged(callback) {
      return subscribe('oc:settings:changed', callback);
    },
  },
  onEvent(callback) {
    return subscribe('oc:event', callback);
  },
  onSseState(callback) {
    return subscribe('oc:sse:state', callback);
  },
  onMenu(callback) {
    return subscribe('oc:menu', callback);
  },
  onToast(callback) {
    return subscribe('oc:toast', callback);
  },
  openExternal(url) {
    return ipcRenderer.invoke('oc:open-external', url);
  },
  openOpenCodeConfig(path) {
    return ipcRenderer.invoke('oc:opencode:open-config', path);
  },
  demo: {
    isEnabled() {
      return ipcRenderer.invoke('oc:demo:is-enabled');
    },
    setEnabled(enabled) {
      return ipcRenderer.invoke('oc:demo:set', enabled);
    },
    getSessions() {
      return ipcRenderer.invoke('oc:demo:sessions');
    },
  },
  app: {
    info() {
      return ipcRenderer.invoke('oc:app:info');
    },
  },
  setup: {
    check() {
      return ipcRenderer.invoke('oc:setup:check');
    },
    install(id) {
      return ipcRenderer.invoke('oc:setup:install', id);
    },
    cancel() {
      return ipcRenderer.invoke('oc:setup:cancel');
    },
    onOutput(callback) {
      return subscribe('oc:setup:output', callback);
    },
    onDone(callback) {
      return subscribe('oc:setup:done', callback);
    },
  },
  workspace: {
    pending() {
      return ipcRenderer.invoke('oc:workspace:pending');
    },
    createFile(directory) {
      return ipcRenderer.invoke('oc:workspace:create-file', directory);
    },
    register() {
      return ipcRenderer.invoke('oc:workspace:register');
    },
    unregister() {
      return ipcRenderer.invoke('oc:workspace:unregister');
    },
  },
  git: {
    status(directory) {
      return ipcRenderer.invoke('oc:git:status', directory);
    },
    diff(directory, file, staged) {
      return ipcRenderer.invoke('oc:git:diff', directory, file, staged);
    },
    stage(directory, file) {
      return ipcRenderer.invoke('oc:git:stage', directory, file);
    },
    unstage(directory, file) {
      return ipcRenderer.invoke('oc:git:unstage', directory, file);
    },
    commit(directory, message) {
      return ipcRenderer.invoke('oc:git:commit', directory, message);
    },
    push(directory) {
      return ipcRenderer.invoke('oc:git:push', directory);
    },
    pull(directory) {
      return ipcRenderer.invoke('oc:git:pull', directory);
    },
    branch(directory) {
      return ipcRenderer.invoke('oc:git:branch', directory);
    },
    log(directory) {
      return ipcRenderer.invoke('oc:git:log', directory);
    },
  },
  windowControls: {
    minimize() {
      return ipcRenderer.invoke('oc:window:minimize');
    },
    toggleMaximize() {
      return ipcRenderer.invoke('oc:window:toggle-maximize');
    },
    close() {
      return ipcRenderer.invoke('oc:window:close');
    },
    isMaximized() {
      return ipcRenderer.invoke('oc:window:is-maximized');
    },
    onMaximized(callback) {
      return subscribe('oc:window:maximized', callback);
    },
  },
  terminal: {
    run(command, directory) {
      return ipcRenderer.invoke('oc:terminal:run', { command, directory });
    },
    stop(id) {
      return ipcRenderer.invoke('oc:terminal:stop', id);
    },
    scripts(directory) {
      return ipcRenderer.invoke('oc:terminal:scripts', directory);
    },
    runScript(script, directory) {
      return ipcRenderer.invoke('oc:terminal:script', { script, directory });
    },
    bumpVersion(type, directory) {
      return ipcRenderer.invoke('oc:terminal:version', { type, directory });
    },
    onEvent(callback) {
      return subscribe('oc:terminal:event', callback);
    },
  },
  config: {
    read(scope, directory) {
      return ipcRenderer.invoke('oc:config:read', scope, directory);
    },
    write(scope, directory, text) {
      return ipcRenderer.invoke('oc:config:write', scope, directory, text);
    },
    reveal(scope, directory) {
      return ipcRenderer.invoke('oc:config:reveal', scope, directory);
    },
  },
  cli: {
    capture(id) {
      return ipcRenderer.invoke('oc:cli:capture', id);
    },
    terminal(id) {
      return ipcRenderer.invoke('oc:cli:terminal', id);
    },
  },
  send(channel, payload) {
    const allowed = ['renderer-ready'];
    if (allowed.includes(channel)) {
      ipcRenderer.send(channel, payload);
    }
  },
};

contextBridge.exposeInMainWorld('oc', oc);
