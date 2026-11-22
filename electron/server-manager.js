'use strict';

const { EventEmitter } = require('node:events');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');

const START_PORT = 4096;
const MAX_PORT_TRIES = 40;
const START_TIMEOUT = 20000;
const LOG_LIMIT = 40;

function isFreePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let port = START_PORT; port < START_PORT + MAX_PORT_TRIES; port += 1) {
    if (await isFreePort(port)) return port;
  }
  throw new Error('No hay puertos libres entre 4096 y 4135.');
}

function makePassword() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Launches and supervises `opencode serve`.
 *
 * Emits "state" with { state, message, url, logs } where state is one of
 * starting | ready | error | stopped.
 */
class ServerManager extends EventEmitter {
  constructor(apiClient) {
    super();
    this.api = apiClient;
    this.child = null;
    this.port = null;
    this.password = null;
    this.url = '';
    this.logs = [];
    this.state = { state: 'stopped', message: 'Servidor detenido', url: '', logs: [] };
    this.stopping = false;
  }

  snapshot() {
    return { ...this.state };
  }

  setState(state, message) {
    this.state = {
      state,
      message: message || '',
      url: this.url,
      version: this.version || '',
      logs: this.logs.slice(-LOG_LIMIT),
    };
    this.emit('state', this.snapshot());
  }

  pushLog(line) {
    // La contraseña del servidor local nunca debe llegar a la UI ni a logs.
    const text = String(line)
      .replace(/\s+$/, '')
      .replace(/(server password\s*[:=]?\s*)\S+/gi, '$1[REDACTED]')
      .replace(/(Authorization:\s*)Basic\s+\S+/gi, '$1[REDACTED]');
    if (!text) return;
    this.logs.push(text);
    if (this.logs.length > 200) this.logs.shift();
  }

  /** Connects to an already running server (no child process is created). */
  async connect({ url, password }) {
    this.stopChild();
    this.url = (url || '').replace(/\/+$/, '');
    this.password = password || '';
    this.setState('starting', `Conectando con ${this.url}…`);
    const ok = await this.waitForReady(this.url, this.password, START_TIMEOUT);
    if (!ok) {
      this.setState('error', `No se pudo conectar con ${this.url}. Revisa la URL y la contraseña.`);
      return this.snapshot();
    }
    this.api.configure({ baseUrl: this.url, password: this.password });
    this.setState('ready', `Conectado a ${this.url}`);
    return this.snapshot();
  }

  async start({ projectDir, opencodePath } = {}) {
    if (this.child) this.stopChild();
    this.stopping = false;
    this.logs = [];
    this.setState('starting', 'Iniciando servidor de opencode…');

    let port;
    try {
      port = await findFreePort();
    } catch (error) {
      this.setState('error', error.message);
      return this.snapshot();
    }

    this.port = port;
    this.password = makePassword();
    this.url = `http://127.0.0.1:${port}`;

    const command = opencodePath && opencodePath.trim() ? opencodePath.trim() : 'opencode';
    const args = ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
    const env = { ...process.env, OPENCODE_SERVER_PASSWORD: this.password };
    const cwd = projectDir || process.cwd();

    let child;
    try {
      if (process.platform === 'win32') {
        const quoted = command.includes(' ') ? `"${command}"` : command;
        child = spawn(`${quoted} ${args.join(' ')}`, {
          shell: true,
          windowsHide: true,
          cwd,
          env,
        });
      } else {
        child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      }
    } catch (error) {
      this.setState('error', `No se pudo lanzar opencode: ${error.message}`);
      return this.snapshot();
    }

    this.child = child;
    this.bindChild(child);

    const ready = await this.waitForReady(this.url, this.password, START_TIMEOUT);
    if (!ready) {
      const tail = this.logs.slice(-8).join('\n');
      const missing = /ENOENT|no se reconoce|not recognized|not found/i.test(tail);
      this.stopChild();
      this.setState(
        'error',
        missing
          ? 'No se encontró `opencode` en PATH. Instálalo con `npm i -g opencode-ai` o indica la ruta en Ajustes.'
          : `El servidor no respondió en 20 s.\n${tail || 'Sin salida del proceso.'}`,
      );
      return this.snapshot();
    }

    this.api.configure({ baseUrl: this.url, password: this.password });
    this.setState('ready', `Servidor listo en ${this.url}`);
    return this.snapshot();
  }

  bindChild(child) {
    const onData = (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        this.pushLog(line);
        const match = /server password (\S+)/i.exec(line);
        // Safety net: if the env var was not honoured we pick the printed password.
        if (match && this.password !== match[1]) {
          this.password = match[1];
          this.api.configure({ baseUrl: this.url, password: this.password });
        }
      }
      this.emit('log', text);
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (error) => {
      this.pushLog(`spawn error: ${error.message}`);
      this.setState('error', `No se pudo lanzar opencode: ${error.message}`);
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.stopping) {
        this.setState('stopped', 'Servidor detenido');
        return;
      }
      const tail = this.logs.slice(-6).join('\n');
      this.setState('error', `El servidor terminó inesperadamente (código ${code ?? signal}).\n${tail}`);
    });
  }

  async waitForReady(url, password, timeoutMs) {
    const token = Buffer.from(`opencode:${password}`, 'utf8').toString('base64');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.stopping) return false;
      try {
        const response = await fetch(`${url}/api/info`, {
          headers: { Authorization: `Basic ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          const body = await response.json().catch(() => ({}));
          this.version = body.version || '';
          this.port = Number(new URL(url).port) || this.port;
          return true;
        }
        if (response.status === 401) {
          // Password mismatch: wait for the printed password to show up in stdout.
          this.pushLog('El servidor rechazó la contraseña; esperando la impresa en stdout…');
        }
      } catch {
        // Server not up yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return false;
  }

  stopChild() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.child = null;
    if (process.platform === 'win32' && child.pid) {
      // Synchronous on purpose: the app may be quitting and an asynchronous
      // taskkill would be killed with us, leaving `opencode` orphaned.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  }

  stop() {
    this.stopChild();
    this.url = '';
    this.password = '';
    this.api.configure({ baseUrl: '', password: '' });
    this.setState('stopped', 'Servidor detenido');
    return this.snapshot();
  }

  restart(options) {
    this.stopChild();
    return this.start(options);
  }
}

module.exports = { ServerManager, findFreePort, makePassword };
