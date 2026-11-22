'use strict';

/**
 * Demo back-end: fakes the opencode v2 API and event stream so the whole UI can
 * be exercised without a server or a model.
 *
 * It answers the same endpoints the renderer uses and emits events with the
 * exact shapes documented in docs/api-notes.md.
 */

const DIRECTORY = 'C:\\Demo\\opencode-oficina';
const TICK = 45;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let counter = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter += 1).toString(36)}`;

function fileEntry(path, type) {
  return { path, type };
}

const FS = {
  '': [fileEntry('src', 'directory'), fileEntry('docs', 'directory'), fileEntry('package.json', 'file'), fileEntry('README.md', 'file')],
  src: [fileEntry('src/app.js', 'file'), fileEntry('src/ui', 'directory'), fileEntry('src/store.js', 'file')],
  'src/ui': [fileEntry('src/ui/chat.js', 'file'), fileEntry('src/ui/office.js', 'file')],
  docs: [fileEntry('docs/decisiones.md', 'file')],
};

const FILE_CONTENT = {
  'package.json': '{\n  "name": "demo",\n  "version": "1.0.0"\n}\n',
  'README.md': '# Proyecto demo\n\nEste proyecto no existe: es el modo demo de HLab Interactive.\n',
  'src/app.js': "import { start } from './store.js';\n\nstart();\n",
  'src/store.js': 'export const state = { ready: false };\n',
  'src/ui/chat.js': '// chat\n',
  'src/ui/office.js': '// oficina\n',
  'docs/decisiones.md': '# Decisiones\n\n- Modo demo sin servidor.\n',
};

const MODELS = [
  { id: 'demo-flash', modelID: 'demo-flash', providerID: 'opencode', name: 'Demo Flash', variants: [], status: 'active', enabled: true, cost: [], limit: { context: 200000, input: 160000, output: 32000 } },
  { id: 'demo-reasoner', modelID: 'demo-reasoner', providerID: 'opencode', name: 'Demo Reasoner', variants: [], status: 'active', enabled: true, cost: [], limit: { context: 200000, input: 160000, output: 32000 } },
  { id: 'qwen3.5:4b', modelID: 'qwen3.5:4b', providerID: 'ollama', name: 'Qwen 3.5 4B', variants: [], status: 'active', enabled: true, cost: [], limit: { context: 32768, input: 24576, output: 8192 } },
];

const AGENTS = [
  { id: 'build', name: 'Build', mode: 'primary', hidden: false, description: 'Agente por defecto de la demo.', permissions: [] },
  { id: 'plan', name: 'Plan', mode: 'primary', hidden: false, description: 'Solo planifica, no edita.', permissions: [] },
];

const COMMANDS = [
  { name: 'init', description: 'Inicializa el proyecto' },
  { name: 'review', description: 'Revisa los cambios pendientes' },
];

const MCP_SERVERS = {
  unityMCP: {
    type: 'local',
    command: ['uvx', '--from', 'mcpforunityserver==10.3.0', 'mcp-for-unity', '--transport', 'stdio'],
    disabled: false,
  },
  rea: {
    type: 'local',
    command: ['rea-mcp', '--stdio'],
    disabled: false,
  },
};

const MCP_LIVE = [
  { name: 'unityMCP', status: { status: 'connected' }, integrationID: 'int_unity' },
  { name: 'rea', status: { status: 'pending' }, integrationID: 'int_rea' },
];

class DemoSource {
  constructor({ emit }) {
    this.emit = emit;
    this.timers = new Set();
    this.sessions = new Map();
    this.messages = new Map();
    this.permissions = new Map();
    this.pendingReplies = new Map();
    this.questions = new Map();
    this.pendingQuestions = new Map();
    this.shells = new Map();
    this.active = null;
    this.started = false;
  }

  event(type, data, extra = {}) {
    const payload = {
      id: nextId('evt'),
      created: Date.now(),
      type,
      location: { directory: DIRECTORY },
      data,
      ...extra,
    };
    this.emit(payload);
  }

  later(ms, fn) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.started) fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  stop() {
    this.started = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // ---------------------------------------------------------------- API ----

  async request(method, path, options = {}) {
    const { query = {}, body } = options;
    await sleep(60);
    if (path === '/api/info') {
      return this.ok({ version: 'demo', pid: 0, urls: [DIRECTORY], paths: { tmp: '' }, capabilities: { persistentPty: false } });
    }
    if (path === '/api/location') {
      return this.ok({ directory: query.location?.directory || DIRECTORY, project: { id: 'prj_demo', directory: DIRECTORY, canonical: DIRECTORY } });
    }
    if (path === '/api/project') {
      return this.ok([{ id: 'prj_demo', canonical: DIRECTORY, time: { created: Date.now(), updated: Date.now() } }]);
    }
    if (path === '/api/session' && method === 'GET') {
      let data = [...this.sessions.values()];
      if (query.archived !== undefined) {
        const wanted = query.archived === 'true' || query.archived === true;
        data = data.filter((session) => Boolean(session.archived) === wanted);
      }
      if (query.parentID !== undefined) {
        const parent = query.parentID === 'null' || query.parentID === null ? null : query.parentID;
        data = data.filter((session) => (session.parentID || null) === parent);
      }
      return this.ok({ data, cursor: { previous: null, next: null } });
    }
    if (path === '/api/session' && method === 'POST') {
      return this.ok({ data: this.createSession(body?.title) });
    }
    const sessionMatch = /^\/api\/session\/([^/]+)(\/.*)?$/.exec(path);
    if (sessionMatch) {
      const [, sessionID, rest = ''] = sessionMatch;
      const session = this.sessions.get(sessionID);
      if (!session) return this.fail(404, 'SessionNotFoundError', 'La sesión no existe.');
      if (!rest && method === 'PATCH') {
        Object.assign(session, body || {}, { time: { ...session.time, updated: Date.now() } });
        this.event('session.updated', { sessionID: session.id, session });
        return this.ok({ data: session });
      }
      if (!rest && method === 'DELETE') {
        this.sessions.delete(sessionID);
        return this.ok(null, 204);
      }
      if (rest === '/message' && method === 'GET') {
        return this.ok({ data: [...(this.messages.get(sessionID) || [])].reverse(), cursor: { previous: null, next: null } });
      }
      if (rest === '/prompt' && method === 'POST') {
        const text = body?.text || '';
        // Push the user message once and hand it to the scenario so the POST
        // response and the inbox event share the same id (like the real server).
        const userMessage = this.pushMessage(sessionID, {
          id: nextId('msg'),
          type: 'user',
          text,
          time: { created: Date.now() },
        });
        this.event('session.inbox.enqueued', {
          sessionID,
          inboxID: userMessage.id,
          item: { type: 'user', payload: { text }, delivery: 'steer' },
        });
        this.runScenario(sessionID, text, { userMessage });
        return this.ok({ data: userMessage });
      }
      if (rest === '/interrupt' && method === 'POST') {
        this.interrupt(sessionID);
        return this.ok({ interrupted: true });
      }
      if (rest === '/shell' && method === 'POST') {
        this.runShell(sessionID, body?.command || 'echo demo');
        return this.ok(null, 204);
      }
      if (rest === '/command' && method === 'POST') {
        this.runScenario(sessionID, `/${body?.name || 'init'}`, { asCommand: true });
        return this.ok(null, 204);
      }
      if (rest === '/model' || rest === '/agent') {
        return this.ok(null, 204);
      }
      if (/^\/permission\/[^/]+\/reply$/.test(rest) && method === 'POST') {
        const requestID = rest.split('/')[2];
        this.replyPermission(sessionID, requestID, body?.decision || 'once');
        return this.ok(null, 204);
      }
      if (rest === '/question' && method === 'GET') {
        const data = [...this.questions.values()].filter((item) => item.sessionID === sessionID);
        return this.ok({ data });
      }
      const questionReply = /^\/question\/([^/]+)\/(reply|reject)$/.exec(rest);
      if (questionReply && method === 'POST') {
        const [, requestID, action] = questionReply;
        this.replyQuestion(sessionID, requestID, action === 'reply' ? (body?.answers || []) : null);
        return this.ok(null, 204);
      }
      if (rest.startsWith('/diff')) {
        return this.ok({ data: [] });
      }
    }
    if (path === '/api/permission/request') {
      return this.ok({ location: { directory: DIRECTORY }, data: [...this.permissions.values()] });
    }
    if (path === '/api/question/request') {
      return this.ok({ location: { directory: DIRECTORY }, data: [...this.questions.values()] });
    }
    if (path === '/api/model') return this.ok({ location: { directory: DIRECTORY }, data: MODELS });
    if (path === '/api/provider') return this.ok({ location: { directory: DIRECTORY }, data: [{ id: 'opencode', name: 'OpenCode' }] });
    if (path === '/api/agent') return this.ok({ location: { directory: DIRECTORY }, data: AGENTS });
    if (path === '/api/command') return this.ok({ location: { directory: DIRECTORY }, data: COMMANDS });
    if (path === '/api/config') {
      return this.ok([{
        type: 'document',
        path: 'C:\\Demo\\opencode\\opencode.json',
        info: { mcp: { servers: MCP_SERVERS } },
      }]);
    }
    if (path === '/api/mcp') {
      return this.ok({ location: { directory: DIRECTORY }, data: MCP_LIVE });
    }
    if (path === '/api/fs/list') {
      const key = query.path || '';
      const entries = FS[key] || [];
      return this.ok({ location: { directory: DIRECTORY }, data: entries });
    }
    if (path === '/api/fs/find') {
      const term = (query.query || '').toLowerCase();
      const all = Object.values(FS).flat().filter((entry) => entry.type === 'file' && entry.path.toLowerCase().includes(term));
      return this.ok({ location: { directory: DIRECTORY }, data: all.slice(0, 50) });
    }
    if (path.startsWith('/api/fs/read/')) {
      const relative = decodeURIComponent(path.slice('/api/fs/read/'.length));
      return this.ok(FILE_CONTENT[relative] ?? '', 200, 'text/plain');
    }
    if (path === '/api/vcs/status') {
      return this.ok({ location: { directory: DIRECTORY }, data: [{ file: 'src/app.js', additions: 4, deletions: 1, status: 'modified' }] });
    }
    if (path === '/api/vcs/diff') return this.ok({ location: { directory: DIRECTORY }, data: [] });
    if (path === '/api/event') return this.fail(400, 'DemoStream', 'El modo demo no usa SSE.');
    return this.fail(404, 'NotFound', `Ruta de demo no implementada: ${method} ${path}`);
  }

  ok(data, status = 200) {
    return { ok: true, status, data };
  }

  fail(status, tag, message) {
    return { ok: false, status, data: { _tag: tag, message }, error: message };
  }

  // ------------------------------------------------------------ helpers ----

  createSession(title, options = {}) {
    const session = {
      id: nextId('ses'),
      projectID: 'prj_demo',
      parentID: options.parentID || null,
      agent: options.agent || null,
      title: title || `Sesión demo ${this.sessions.size + 1}`,
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now(), updated: Date.now() },
      location: { directory: DIRECTORY },
      folders: [DIRECTORY],
    };
    this.sessions.set(session.id, session);
    this.messages.set(session.id, []);
    this.event('session.updated', { sessionID: session.id, session });
    return session;
  }

  /**
   * Creates a child session and runs a short read-only turn on it, so the demo
   * shows the subagent tree and the hand-off in the office.
   */
  spawnSubagent(parentID, agent = 'explore') {
    const session = this.createSession(`Subagente ${this.sessions.size}`, { parentID, agent });
    const messageID = nextId('msg');
    const callID = nextId('call');

    (async () => {
      await sleep(500);
      if (!this.started) return;
      this.event('session.execution.started', { sessionID: session.id });
      await sleep(300);
      this.event('session.step.started', {
        sessionID: session.id,
        agent,
        model: { id: MODELS[0].modelID, providerID: MODELS[0].providerID },
        assistantMessageID: messageID,
        started: Date.now(),
      });
      this.event('session.text.started', { sessionID: session.id, assistantMessageID: messageID, ordinal: 0 });
      this.event('session.text.delta', {
        sessionID: session.id,
        assistantMessageID: messageID,
        ordinal: 0,
        delta: 'Revisando los archivos del proyecto…',
      });
      this.event('session.tool.input.started', {
        sessionID: session.id,
        assistantMessageID: messageID,
        id: callID,
        name: 'read',
      });
      await sleep(600);
      if (!this.started) return;
      this.event('session.tool.input.ended', {
        sessionID: session.id,
        assistantMessageID: messageID,
        id: callID,
        text: '{"path":"src/app.js"}',
      });
      this.event('session.tool.called', {
        sessionID: session.id,
        assistantMessageID: messageID,
        id: callID,
        input: { path: 'src/app.js' },
        executed: false,
      });
      await sleep(7000);
      if (!this.started) return;
      this.event('session.tool.success', {
        sessionID: session.id,
        assistantMessageID: messageID,
        id: callID,
        content: [{ type: 'text', text: 'Read file src/app.js, lines 1-3' }],
        metadata: { truncated: false },
        executed: false,
      });
      this.event('session.execution.succeeded', { sessionID: session.id });
      this.event('session.idle', { sessionID: session.id });
    })();

    return session;
  }

  pushMessage(sessionID, message) {
    const list = this.messages.get(sessionID) || [];
    list.push(message);
    this.messages.set(sessionID, list);
    return message;
  }

  replyPermission(sessionID, requestID, decision) {
    const resolver = this.pendingReplies.get(requestID);
    this.permissions.delete(requestID);
    this.event('permission.replied', { sessionID, requestID, reply: decision });
    if (resolver) resolver(decision);
  }

  /**
   * Respuesta a una pregunta del agente. `answers` es un array de etiquetas por
   * pregunta; `null` significa que el usuario la ha omitido.
   */
  replyQuestion(sessionID, requestID, answers) {
    const resolver = this.pendingQuestions.get(requestID);
    this.pendingQuestions.delete(requestID);
    const entry = this.questions.get(requestID);
    this.questions.delete(requestID);
    if (answers === null) this.event('question.rejected', { sessionID, requestID });
    else this.event('question.replied', { sessionID, requestID, answers, question: entry || null });
    if (resolver) resolver(answers);
  }

  /** Pregunta del agente: queda pendiente hasta que el usuario responde. */
  async askQuestion(sessionID, assistantMessageID, spec) {
    const callID = nextId('call');
    this.event('session.tool.input.started', { sessionID, assistantMessageID, id: callID, name: 'question' });
    await sleep(180);
    this.event('session.tool.input.ended', { sessionID, assistantMessageID, id: callID, text: JSON.stringify({ questions: spec }) });
    this.event('session.tool.called', {
      sessionID, assistantMessageID, id: callID, input: { questions: spec }, executed: false,
    });
    const requestID = nextId('qst');
    const entry = { id: requestID, sessionID, tool: 'question', questions: spec };
    this.questions.set(requestID, entry);
    // Igual que opencode 2.2.x: el payload viaja en `properties`, no en `data`.
    this.event('question.asked', undefined, { properties: entry });
    const answers = await new Promise((resolve) => {
      this.pendingQuestions.set(requestID, resolve);
    });
    this.event('session.tool.success', {
      sessionID,
      assistantMessageID,
      id: callID,
      content: [{ type: 'text', text: answers ? answers.flat().join(', ') : '(omitida)' }],
    });
    return answers;
  }

  interrupt(sessionID) {
    this.event('session.execution.interrupted', { sessionID });
    const session = this.sessions.get(sessionID);
    if (session) session.outcome = 'interrupted';
    if (this.active) this.active.cancelled = true;
    const resolver = this.active && this.active.interrupt;
    if (resolver) resolver();
  }

  // ----------------------------------------------------------- scenario ----

  async runScenario(sessionID, text, { asCommand = false, userMessage = null } = {}) {
    const session = this.sessions.get(sessionID);
    if (!session) return;
    // The demo prompt that shows the whole UI also delegates one task, so the
    // subagent tree, the office hand-off and the cleanup button are exercised.
    if (!asCommand && /demo completa|subagente/i.test(text)) {
      this.spawnSubagent(sessionID, 'explore');
    }
    this.active = { sessionID, cancelled: false, interrupt: null };
    const run = this.active;
    const model = MODELS[0];
    const msgID = nextId('msg');

    if (!asCommand && !userMessage) {
      const userMessageID = nextId('msg');
      this.pushMessage(sessionID, { id: userMessageID, type: 'user', text, time: { created: Date.now() } });
      this.event('session.inbox.enqueued', {
        sessionID,
        inboxID: userMessageID,
        item: { type: 'user', payload: { text }, delivery: 'steer' },
      });
    } else if (asCommand) {
      this.pushMessage(sessionID, { id: nextId('msg'), type: 'user', text, time: { created: Date.now() } });
    }

    this.event('session.execution.started', { sessionID });
    await sleep(120);
    this.event('session.step.started', { sessionID, agent: 'build', model: { id: model.modelID, providerID: model.providerID }, assistantMessageID: msgID, started: Date.now() });

    const reasoning = 'El usuario pide una demostración. Voy a leer un archivo, editar otro y ejecutar un comando para mostrar todos los estados del avatar.';
    this.event('session.reasoning.started', { sessionID, assistantMessageID: msgID, ordinal: 0, native: { reasoningField: 'reasoning_content' } });
    let accumulated = '';
    for (const word of reasoning.split(' ')) {
      if (run.cancelled) return;
      accumulated += `${word} `;
      this.event('session.reasoning.delta', { sessionID, assistantMessageID: msgID, ordinal: 0, delta: `${word} ` });
      await sleep(TICK);
    }
    this.event('session.reasoning.ended', { sessionID, assistantMessageID: msgID, ordinal: 0, text: accumulated.trim(), native: { reasoningField: 'reasoning_content' } });

    const callID = nextId('call');
    this.event('session.tool.input.started', { sessionID, assistantMessageID: msgID, id: callID, name: 'read' });
    await sleep(220);
    const readInput = '{"path": "src/app.js"}';
    this.event('session.tool.input.ended', { sessionID, assistantMessageID: msgID, id: callID, text: readInput });
    this.event('session.tool.called', { sessionID, assistantMessageID: msgID, id: callID, input: { path: 'src/app.js' }, executed: false });
    await sleep(400);
    this.event('session.tool.success', {
      sessionID,
      assistantMessageID: msgID,
      id: callID,
      content: [{ type: 'text', text: "Read file src/app.js, lines 1-3\n1: import { start } from './store.js';\n2: \n3: start();" }],
      metadata: { truncated: false },
      executed: false,
    });

    this.event('session.text.started', { sessionID, assistantMessageID: msgID, ordinal: 0 });
    let textAccum = '';
    const emitText = (delta) => {
      textAccum += delta;
      this.event('session.text.delta', { sessionID, assistantMessageID: msgID, ordinal: 0, delta });
    };
    emitText('He leído **src/app.js**. Ahora voy a editar `src/store.js`.\n\n');

    const editCall = nextId('call');
    this.event('session.tool.input.started', { sessionID, assistantMessageID: msgID, id: editCall, name: 'edit' });
    await sleep(260);
    this.event('session.tool.input.ended', { sessionID, assistantMessageID: msgID, id: editCall, text: '{"path":"src/store.js"}' });
    this.event('session.tool.called', { sessionID, assistantMessageID: msgID, id: editCall, input: { path: 'src/store.js' }, executed: false });

    const requestID = nextId('per');
    const permission = {
      id: requestID,
      sessionID,
      action: 'edit',
      resources: ['src/store.js'],
      save: ['*'],
      metadata: {
        files: [{
          file: 'src/store.js',
          status: 'modified',
          additions: 3,
          deletions: 1,
          patch: 'Index: src/store.js\n--- src/store.js\n+++ src/store.js\n@@ -1,1 +1,3 @@\n-export const state = { ready: false };\n+export const state = { ready: false, demo: true };\n+\n+export function start() { state.ready = true; }\n',
        }],
      },
      source: { type: 'tool', messageID: msgID, id: editCall },
    };
    this.permissions.set(requestID, permission);
    this.event('permission.asked', permission);

    const decision = await new Promise((resolve) => {
      this.pendingReplies.set(requestID, resolve);
      run.interrupt = () => resolve('reject');
    });
    this.pendingReplies.delete(requestID);
    run.interrupt = null;
    if (run.cancelled) return;

    if (decision === 'reject') {
      this.event('session.tool.error', {
        sessionID,
        assistantMessageID: msgID,
        id: editCall,
        error: { message: 'El usuario rechazó la edición.' },
      });
      emitText('\n\nEntendido: **no** he modificado el archivo.\n');
    } else {
      this.event('session.tool.success', {
        sessionID,
        assistantMessageID: msgID,
        id: editCall,
        content: [{ type: 'text', text: 'Edited src/store.js: 3 additions, 1 deletion.' }],
        metadata: { truncated: false, files: permission.metadata.files },
        executed: false,
      });
      this.event('file.edited', { sessionID, file: 'src/store.js' });
      emitText('\n\nArchivo editado. Ejecuto las pruebas:\n\n');
    }

    const shellCall = nextId('call');
    const shellID = nextId('sh');
    this.event('session.tool.input.started', { sessionID, assistantMessageID: msgID, id: shellCall, name: 'bash' });
    await sleep(200);
    this.event('session.tool.called', { sessionID, assistantMessageID: msgID, id: shellCall, input: { command: 'npm test' }, executed: false });
    this.event('shell.created', { info: { id: shellID, status: 'running', command: 'npm test', cwd: DIRECTORY, time: { started: Date.now() } } });
    this.event('session.shell.started', { sessionID, shell: { id: shellID, command: 'npm test', status: 'running' }, pid: 4242 });
    await sleep(900);
    const output = '> demo@1.0.0 test\n> node --test\n\nok 1 - store inicia\nok 2 - oficina responde\n\n# pass 2\n# fail 0\n';
    this.event('shell.exited', { id: shellID, exit: 0, status: 'exited' });
    this.event('session.shell.ended', {
      sessionID,
      shell: { id: shellID, command: 'npm test', status: 'exited', time: { started: Date.now(), completed: Date.now() } },
      output: { output, cursor: output.length, size: output.length, truncated: false },
    });
    this.event('session.tool.success', { sessionID, assistantMessageID: msgID, id: shellCall, content: [{ type: 'text', text: output }], metadata: { truncated: false }, executed: false });

    emitText('```\n# pass 2\n# fail 0\n```\n\nTodo en verde ✅.');

    // La herramienta `question` deja el turno esperando: la tarjeta del chat debe
    // poder responderla y el turno tiene que continuar después.
    if (!run.cancelled && /pregunta|question/i.test(text)) {
      const answers = await this.askQuestion(sessionID, msgID, [{
        header: 'Formato',
        question: '¿Cómo quieres que continúe la demostración?',
        options: [
          { label: 'Seguir con la demo', description: 'Continúa el recorrido normal' },
          { label: 'Parar aquí', description: 'Termina la demostración sin más pasos' },
        ],
        multiple: false,
        custom: true,
      }]);
      if (run.cancelled) return;
      emitText(`\n\nRespuesta recibida: **${answers ? answers.flat().join(', ') : 'omitida'}**.\n`);
    }

    if (run.cancelled) return;

    if (text.toLowerCase().includes('error')) {
      const failCall = nextId('call');
      this.event('session.tool.called', { sessionID, assistantMessageID: msgID, id: failCall, input: { command: 'npm run build' }, executed: false });
      this.event('session.tool.error', { sessionID, assistantMessageID: msgID, id: failCall, error: { message: 'Error simulado: no se pudo compilar.' } });
      this.event('session.execution.failed', {
        sessionID,
        error: { type: 'provider.quota', message: 'Rate limit exceeded. Please try again later.' },
      });
      session.outcome = 'failed';
    } else {
      this.event('session.execution.succeeded', { sessionID });
      session.outcome = 'succeeded';
    }

    this.event('session.text.ended', { sessionID, assistantMessageID: msgID, ordinal: 0, text: `${textAccum}\n\nDemostración completada.` });
    this.event('session.step.ended', { sessionID, assistantMessageID: msgID, finish: 'stop', rawFinish: 'stop', cost: 0, tokens: { input: 1200, output: 220, reasoning: 90, cache: { read: 0, write: 0 } } });
    session.cost = 0.0012;
    session.tokens = { input: 1200, output: 220, reasoning: 90, cache: { read: 0, write: 0 } };
    this.event('session.usage.updated', { sessionID, cost: 0.0012, tokens: session.tokens });
    session.time.updated = Date.now();
    this.active = null;
  }

  async runShell(sessionID, command) {
    const shellID = nextId('sh');
    this.event('shell.created', { info: { id: shellID, status: 'running', command, cwd: DIRECTORY, time: { started: Date.now() } } });
    this.event('session.shell.started', { sessionID, shell: { id: shellID, command, status: 'running' }, pid: 4243 });
    await sleep(600);
    const output = `Ejecutado en modo demo: ${command}\n`;
    this.event('shell.exited', { id: shellID, exit: 0, status: 'exited' });
    this.event('session.shell.ended', {
      sessionID,
      shell: { id: shellID, command, status: 'exited', time: { started: Date.now(), completed: Date.now() } },
      output: { output, cursor: output.length, size: output.length, truncated: false },
    });
  }

  // ---------------------------------------------------------- bootstrap ----

  async start() {
    this.started = true;
    const first = this.createSession('Bienvenida a la oficina');
    this.event('server.connected', {});

    const intro = {
      id: nextId('msg'),
      type: 'assistant',
      agent: 'build',
      model: { id: 'demo-flash', providerID: 'opencode' },
      content: [{
        type: 'text',
        text: 'Bienvenido a **HLab Interactive**.\n\nEste es el modo demo: no hay servidor ni modelo detrás, pero todos los eventos que ves son los mismos que emite `opencode serve` (v2).\n\n- Escribe cualquier cosa en el chat para lanzar la demostración.\n- Escribe `error` para ver el estado de error.\n- Usa `!dir` para ejecutar un comando de shell.\n\nCuando quieras la app real, abre Ajustes y desactiva el modo demo.',
      }],
      time: { created: Date.now(), completed: Date.now() },
    };
    this.pushMessage(first.id, intro);

    const second = this.createSession('Sesión en segundo plano');
    this.pushMessage(second.id, {
      id: nextId('msg'),
      type: 'assistant',
      agent: 'build',
      model: { id: 'demo-flash', providerID: 'opencode' },
      content: [{ type: 'text', text: 'Estoy esperando trabajo. Selecciona este escritorio y escríbeme algo.' }],
      time: { created: Date.now(), completed: Date.now() },
    });

    // Two extra agents start busy so the office shows activity in every room.
    const third = this.createSession('Compilando en el servidor');
    this.event('session.execution.started', { sessionID: third.id });
    this.event('session.tool.input.started', {
      sessionID: third.id,
      assistantMessageID: nextId('msg'),
      id: nextId('call'),
      name: 'bash',
    });
    this.event('session.tool.called', {
      sessionID: third.id,
      assistantMessageID: nextId('msg'),
      id: nextId('call'),
      name: 'bash',
      input: { command: 'npm run build' },
      executed: false,
    });

    const fourth = this.createSession('Leyendo la documentación');
    this.event('session.execution.started', { sessionID: fourth.id });
    this.event('session.tool.input.started', {
      sessionID: fourth.id,
      assistantMessageID: nextId('msg'),
      id: nextId('call'),
      name: 'read',
    });
    this.event('session.tool.called', {
      sessionID: fourth.id,
      assistantMessageID: nextId('msg'),
      id: nextId('call'),
      name: 'read',
      input: { path: 'docs/decisiones.md' },
      executed: false,
    });

    this.event('session.idle', { sessionID: first.id });
    return first.id;
  }
}

module.exports = { DemoSource, DIRECTORY };
