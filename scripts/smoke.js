'use strict';

/**
 * End-to-end smoke test against a real `opencode serve`.
 *
 *   npm run smoke            # uses a temporary project folder
 *   npm run smoke -- C:\path\to\project
 *
 * Steps: start server -> wait /api/info -> register location -> open SSE ->
 * create session -> send "Responde solo OK" -> wait for
 * session.execution.succeeded (90 s). Exit code 0 only if the turn succeeds.
 */

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 90000;
const START_TIMEOUT_MS = 30000;
const password = crypto.randomBytes(18).toString('base64url');
const auth = `Basic ${Buffer.from(`opencode:${password}`, 'utf8').toString('base64')}`;

let child = null;
let baseUrl = '';
const logs = [];

function log(message) {
  const line = `[smoke] ${message}`;
  console.log(line);
  logs.push(line);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function request(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`${method} ${route} -> ${response.status}: ${typeof data === 'string' ? data.slice(0, 200) : JSON.stringify(data)}`);
  }
  return data;
}

async function startServer() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  log(`lanzando opencode serve en ${baseUrl}`);

  const args = ['serve', '--port', String(port), '--hostname', '127.0.0.1'];
  const env = { ...process.env, OPENCODE_SERVER_PASSWORD: password };
  if (process.platform === 'win32') {
    child = spawn(`opencode ${args.join(' ')}`, { shell: true, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    child = spawn('opencode', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  child.stdout?.on('data', (chunk) => process.stdout.write(`  | ${chunk.toString().trim()}\n`));
  child.stderr?.on('data', (chunk) => process.stdout.write(`  ! ${chunk.toString().trim()}\n`));

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await request('GET', '/api/info');
      log('servidor listo');
      return;
    } catch {
      await sleep(400);
    }
  }
  throw new Error('el servidor no respondió a /api/info en 30 s');
}

/**
 * Minimal SSE reader: yields parsed opencode events until the predicate
 * matches or the timeout fires.
 */
async function waitForEvent(predicate, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/event`, {
      headers: { Authorization: auth, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`/api/event -> ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('el flujo de eventos se cerró antes de terminar el turno');
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index !== -1) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (data) {
          let event;
          try { event = JSON.parse(data); } catch { event = null; }
          if (event) {
            const match = predicate(event);
            if (match !== undefined && match !== false) {
              controller.abort();
              return match;
            }
          }
        }
        index = buffer.indexOf('\n\n');
      }
      if (controller.signal.aborted) throw new Error('timeout');
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`tiempo de espera agotado (${Math.round(timeoutMs / 1000)} s)`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'oc-smoke-'));
  fs.mkdirSync(target, { recursive: true });
  if (!fs.existsSync(path.join(target, 'hola.txt'))) {
    fs.writeFileSync(path.join(target, 'hola.txt'), 'hola\n', 'utf8');
  }
  log(`proyecto: ${target}`);

  await startServer();

  const listing = await request('GET', `/api/session?directory=${encodeURIComponent(target)}&limit=1`);
  log(`location registrada (${Array.isArray(listing?.data) ? listing.data.length : 0} sesiones previas)`);

  const created = await request('POST', '/api/session', {
    location: { directory: target },
    title: 'Smoke test',
    permissions: [{ action: '*', resource: '*', effect: 'allow' }],
  });
  const session = created?.data;
  if (!session?.id) throw new Error('POST /api/session no devolvió una sesión');
  log(`sesión ${session.id} creada`);

  // Subscribe BEFORE prompting so no event is missed.
  const turn = waitForEvent((event) => {
    if (!event.data || event.data.sessionID !== session.id) return false;
    if (event.type === 'session.text.delta') process.stdout.write(event.data.delta || '');
    if (event.type === 'session.execution.succeeded') return 'succeeded';
    if (event.type === 'session.execution.failed') return 'failed';
    if (event.type === 'session.execution.interrupted') return 'interrupted';
    return false;
  }, TIMEOUT_MS);

  await request('POST', `/api/session/${encodeURIComponent(session.id)}/prompt`, { text: 'Responde solo OK' });
  log('prompt enviado, esperando el turno…');

  const outcome = await turn;
  process.stdout.write('\n');
  log(`resultado: ${outcome}`);

  if (outcome !== 'succeeded') throw new Error(`el turno terminó como "${outcome}"`);
  log('SMOKE OK');
}

function cleanup() {
  if (!child) return;
  const pid = child.pid;
  child = null;
  if (process.platform === 'win32' && pid) {
    // Synchronous: an async taskkill would be abandoned when we exit.
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n[smoke] FALLO: ${error.message}`);
    cleanup();
    process.exit(1);
  });

process.on('SIGINT', () => { cleanup(); process.exit(130); });
