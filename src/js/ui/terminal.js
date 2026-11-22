import { el, clear } from '../util/dom.js';
import {
  state, set, subscribe, terminalRuns, beginTerminalRun,
} from '../store.js';
import { basename, formatDuration, formatTime } from '../util/format.js';
import { toast } from './toast.js';

/**
 * Terminal directo: los comandos se ejecutan con PowerShell en la raíz del
 * proyecto (IPC al proceso principal), no dentro de la sesión del agente.
 * El historial se ordena de más nuevo a más viejo.
 */
export function mountTerminal(container, handlers) {
  const cwdLabel = el('span', { class: 'terminal-cwd', text: 'sin proyecto' });
  const input = el('textarea', {
    class: 'terminal-input',
    rows: '2',
    spellcheck: 'false',
    placeholder: 'Get-ChildItem · npm test · git status…',
    'aria-label': 'Comando de PowerShell',
  });
  const runButton = el('button', {
    class: 'btn-small btn-primary terminal-run',
    type: 'button',
    text: '↵ Ejecutar',
  });
  const scriptsRow = el('div', { class: 'terminal-scripts' });
  const list = el('div', { class: 'terminal-list activity-list' });

  const bar = el('div', { class: 'terminal-bar' }, [
    el('div', { class: 'terminal-bar-head' }, [
      el('span', { class: 'terminal-prompt', text: 'PS>' }),
      cwdLabel,
      el('span', { class: 'terminal-hint', text: 'PowerShell en la raíz del proyecto' }),
    ]),
    input,
    el('div', { class: 'terminal-actions' }, [
      runButton,
      el('button', {
        class: 'btn-small terminal-clear',
        type: 'button',
        text: 'Limpiar historial',
        onClick: () => set({ terminal: [] }),
      }),
    ]),
  ]);
  container.append(bar, scriptsRow, list);

  async function run() {
    const command = input.value.trim();
    if (!command) return;
    if (!state.project.dir) {
      toast('Abre una carpeta de proyecto para ejecutar comandos.', 'warn');
      return;
    }
    runButton.disabled = true;
    runButton.textContent = 'Ejecutando…';
    try {
      const result = await window.oc.terminal.run(command, state.project.dir);
      if (!result.ok) {
        toast(`No se pudo ejecutar: ${result.error}`, 'error');
        return;
      }
      beginTerminalRun({
        id: result.id,
        kind: 'terminal',
        command,
        directory: result.directory,
        startedAt: result.startedAt,
      });
      input.value = '';
    } catch (error) {
      toast(`No se pudo ejecutar: ${error.message}`, 'error');
    } finally {
      runButton.disabled = false;
      runButton.textContent = '↵ Ejecutar';
      input.focus();
    }
  }

  async function runScript(name) {
    if (!state.project.dir) {
      toast('Abre una carpeta de proyecto para ejecutar scripts.', 'warn');
      return;
    }
    try {
      const result = await window.oc.terminal.runScript(name, state.project.dir);
      if (!result.ok) {
        toast(`No se pudo ejecutar: ${result.error}`, 'error');
        return;
      }
      beginTerminalRun({
        id: result.id,
        kind: 'script',
        script: name,
        command: result.command,
        directory: result.directory,
        startedAt: result.startedAt,
      });
      toast(`Ejecutando npm run ${name}`, 'info', 2000);
    } catch (error) {
      toast(`No se pudo ejecutar: ${error.message}`, 'error');
    }
  }

  async function bumpVersion(type) {
    if (!state.project.dir) {
      toast('Abre una carpeta de proyecto para cambiar la versión.', 'warn');
      return;
    }
    try {
      const result = await window.oc.terminal.bumpVersion(type, state.project.dir);
      if (!result.ok) {
        toast(`No se pudo cambiar la versión: ${result.error}`, 'error');
        return;
      }
      beginTerminalRun({
        id: result.id,
        kind: 'version',
        command: result.command,
        directory: result.directory,
        startedAt: result.startedAt,
      });
      toast(`Ejecutando ${result.command}`, 'info', 2000);
    } catch (error) {
      toast(`No se pudo cambiar la versión: ${error.message}`, 'error');
    }
  }

  let scriptsSig = '';
  async function loadScripts() {
    const dir = state.project.dir;
    const sig = String(dir || '');
    if (sig === scriptsSig) return;
    scriptsSig = sig;
    clear(scriptsRow);
    if (!dir) return;
    const result = await window.oc.terminal.scripts(dir).catch(() => ({ ok: false }));
    if (!result.ok || state.project.dir !== dir) return;
    if (sig !== scriptsSig) return;
    scriptsRow.appendChild(el('span', { class: 'terminal-scripts-label', text: 'Scripts' }));
    for (const script of result.scripts || []) {
      scriptsRow.appendChild(el('button', {
        class: 'btn-small terminal-script-btn',
        type: 'button',
        text: `▶ ${script.name}`,
        title: `npm run ${script.name} — ${script.command}`,
        onClick: () => void runScript(script.name),
      }));
    }
    scriptsRow.appendChild(el('span', { class: 'terminal-scripts-label', text: 'Versión' }));
    for (const type of ['patch', 'minor', 'major']) {
      scriptsRow.appendChild(el('button', {
        class: 'btn-small terminal-script-btn is-version',
        type: 'button',
        text: `▲ ${type}`,
        title: `npm version ${type} --no-git-tag-version`,
        onClick: () => void bumpVersion(type),
      }));
    }
  }

  runButton.addEventListener('click', run);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void run();
    }
  });

  function rowFor(entry) {
    const script = entry.kind === 'script';
    const version = entry.kind === 'version';
    const direct = entry.kind !== 'session';
    const duration = entry.startedAt && entry.endedAt
      ? formatDuration(entry.endedAt - entry.startedAt)
      : '';
    const running = entry.status === 'running';
    const head = el('div', { class: 'shell-head' }, [
      el('span', { class: 'prompt', text: script || version ? 'npm' : (direct ? 'PS>' : '❯') }),
      el('span', { class: 'command', text: entry.command || '', title: entry.command || '' }),
      direct && entry.directory
        ? el('span', { class: 'terminal-cwd-tag', text: basename(entry.directory), title: entry.directory })
        : null,
      el('span', { class: 'muted tiny', text: formatTime(entry.startedAt) }),
      entry.exit !== undefined && entry.exit !== null
        ? el('span', { class: `chip ${entry.exit === 0 ? 'ok' : 'err'}`, text: `exit ${entry.exit}` })
        : null,
      duration ? el('span', { class: 'muted tiny', text: duration }) : null,
      running && direct
        ? el('button', {
          class: 'btn-small shell-stop',
          type: 'button',
          text: 'Detener',
          onClick: async (event) => {
            event.stopPropagation();
            await window.oc.terminal.stop(entry.id);
          },
        })
        : null,
      el('button', {
        class: 'btn-small',
        type: 'button',
        text: 'Copiar',
        onClick: async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(entry.output || '');
            toast('Salida copiada', 'ok', 1500);
          } catch { /* ignore */ }
        },
      }),
    ]);
    return el('div', {
      class: 'shell-item',
      'data-status': entry.status,
      'data-kind': script ? 'script' : (version ? 'version' : (direct ? 'terminal' : 'session')),
    }, [
      head,
      el('pre', {
        class: 'shell-output',
        text: entry.output || (running ? '' : '(sin salida)'),
      }),
    ]);
  }

  function render() {
    void loadScripts();
    cwdLabel.textContent = state.project.dir ? basename(state.project.dir) : 'sin proyecto';
    cwdLabel.title = state.project.dir || 'Sin carpeta de proyecto';

    clear(list);
    const direct = terminalRuns().map((entry) => ({ kind: 'terminal', ...entry }));
    const fromSession = state.shells.map((shell) => ({ ...shell, kind: 'session' }));
    const entries = [...direct, ...fromSession]
      .filter((entry) => entry.startedAt)
      .sort((a, b) => Number(b.startedAt) - Number(a.startedAt));

    if (entries.length === 0) {
      list.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'big', text: '💻' }),
        el('div', { text: 'Todavía no se ha ejecutado ningún comando.' }),
        el('div', { text: 'Escribe arriba un comando de PowerShell: se ejecuta en la raíz del proyecto.' }),
      ]));
      return;
    }
    for (const entry of entries) list.appendChild(rowFor(entry));
  }

  const unsubscribe = subscribe(['terminal', 'shells', 'activeSessionId', 'sessions', 'project'], render);
  render();
  return {
    destroy: () => unsubscribe(),
    render,
    focusInput: () => input.focus(),
  };
}
