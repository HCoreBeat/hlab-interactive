'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { ApiClient } = require('./api-client');
const { ServerManager } = require('./server-manager');
const { SseClient } = require('./sse-client');
const { DemoSource } = require('./demo-source');

/**
 * Owns the connection to opencode (or the demo source) and funnels everything
 * the renderer needs through a single, testable object.
 */
class Backend extends EventEmitter {
  constructor(settingsStore) {
    super();
    this.settings = settingsStore;
    this.api = new ApiClient();
    this.manager = new ServerManager(this.api);
    this.sse = new SseClient();
    this.demo = null;
    this.demoEnabled = false;
    this.sseState = { state: 'closed', message: 'Sin conexión', attempt: 0 };
    this._rendererReady = false;
    this._rendererReadyPromise = new Promise((resolve) => {
      this._rendererReadyResolve = resolve;
    });

    this.manager.on('state', (state) => this.emit('server-state', state));
    this.sse.on('event', (payload) => this.emit('event', payload));
    this.sse.on('state', (state) => {
      this.sseState = state;
      this.emit('sse-state', state);
    });
  }

  get rendererReady() {
    return this._rendererReady;
  }

  waitForRendererReady() {
    return this._rendererReadyPromise;
  }

  markRendererReady() {
    this._rendererReady = true;
    if (this._rendererReadyResolve) this._rendererReadyResolve();
  }

  async init() {
    const settings = this.settings.get();
    if (settings.demo) return this.enableDemo();

    if (settings.connection.mode === 'connect' && settings.connection.url) {
      return this.manager.connect({
        url: settings.connection.url,
        password: settings.connection.password,
      });
    }
    return this.startServer();
  }

  async startServer() {
    const settings = this.settings.get();
    this.disableDemo();
    const state = await this.manager.start({
      projectDir: settings.lastProject || undefined,
      opencodePath: settings.opencodePath,
    });
    if (state.state === 'ready') this.openStream();
    return state;
  }

  async stopServer() {
    if (this.demoEnabled) return this.status();
    this.sse.stop();
    return this.manager.stop();
  }

  async restartServer() {
    if (this.demoEnabled) return this.enableDemo();
    this.sse.stop();
    const state = await this.manager.restart({
      projectDir: this.settings.get().lastProject || undefined,
      opencodePath: this.settings.get().opencodePath,
    });
    if (state.state === 'ready') this.openStream();
    return state;
  }

  openStream() {
    this.sse.configure({ baseUrl: this.manager.url, password: this.manager.password });
    this.sse.start();
  }

  status() {
    if (this.demoEnabled) {
      return { state: 'ready', message: 'Modo demo (sin servidor)', url: '', logs: [], demo: true };
    }
    return { ...this.manager.snapshot(), demo: false, sse: this.sseState };
  }

  // ------------------------------------------------------------- demo ----

  enableDemo() {
    if (this.demoEnabled) return this.status();
    this.disableDemo();
    this.demoEnabled = true;
    this.demo = new DemoSource({ emit: (payload) => this.emit('event', payload) });
    this.demo.start();
    this.api.configure({ baseUrl: '', password: '' });
    this.sse.stop();
    const state = { state: 'ready', message: 'Modo demo (sin servidor)', url: '', logs: [], demo: true };
    this.emit('server-state', state);
    return state;
  }

  disableDemo() {
    if (!this.demoEnabled) return;
    this.demo?.stop();
    this.demo = null;
    this.demoEnabled = false;
  }

  async setDemo(enabled) {
    if (enabled) {
      this.settings.set({ demo: true });
      return this.enableDemo();
    }
    this.settings.set({ demo: false });
    this.disableDemo();
    return this.startServer();
  }

  // ---------------------------------------------------------- requests ----

  async request(method, path, options = {}) {
    if (this.demoEnabled) return this.demo.request(method, path, options);
    return this.api.request(method, path, options);
  }

  /** Registers the directory in the server and remembers the project. */
  async openProject(directory) {
    if (this.demoEnabled) return { ok: true, status: 200, data: { data: [] } };

    if (!fs.existsSync(directory)) {
      // The folder disappeared: forget it instead of leaving a broken project.
      const current = this.settings.get();
      this.settings.set({
        lastProject: null,
        recentProjects: current.recentProjects.filter((item) => item.directory !== directory),
      });
      return { ok: false, status: 0, data: null, error: 'Esa carpeta ya no existe.' };
    }

    const settings = this.settings.get();
    const recent = [
      { directory, openedAt: Date.now() },
      ...settings.recentProjects.filter((item) => item.directory !== directory),
    ].slice(0, 12);
    this.settings.set({ lastProject: directory, recentProjects: recent });

    return this.api.get('/api/session', { directory, limit: 200, order: 'desc' });
  }

  dispose() {
    this.sse.stop();
    this.disableDemo();
    this.manager.stop();
  }
}

module.exports = { Backend };
