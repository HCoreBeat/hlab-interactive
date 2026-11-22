'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Terminal directo: PowerShell, scripts de package.json y bump de versión,
 * siempre con cwd en la raíz del proyecto. Los eventos incluyen el estado
 * completo para que un panel desmontado no pierda el final de una ejecución.
 */
const runs = new Map();
let seq = 0;

function powershellExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

function npmExe() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function commandArgs(command) {
  const prefix = process.platform === 'win32'
    ? '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
    : '';
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `${prefix}${command}`,
  ];
}

function validDirectory(directory) {
  const value = String(directory || '');
  if (!value || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) return null;
  return path.resolve(value);
}

function start({ exe, args, directory, shell = false, send, label, kind = 'terminal' }) {
  const id = `term_${Date.now()}_${seq += 1}`;
  const startedAt = Date.now();
  let child;
  try {
    child = spawn(exe, args, {
      cwd: directory,
      windowsHide: true,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const entry = { child, command: label, directory, startedAt, output: '', kind };
  runs.set(id, entry);
  const emit = (type, payload = {}) => send('oc:terminal:event', {
    id, type, kind, command: label, directory, startedAt, ...payload,
  });

  const collect = (stream) => (chunk) => {
    const text = chunk.toString('utf8');
    if (!text) return;
    entry.output += text;
    emit('output', { stream, chunk: text });
  };
  child.stdout.on('data', collect('stdout'));
  child.stderr.on('data', collect('stderr'));

  const finish = (exit, error = '') => {
    if (!runs.has(id)) return;
    runs.delete(id);
    emit('done', { exit, error, output: entry.output, endedAt: Date.now() });
  };
  child.on('error', (error) => finish(-1, error.message));
  child.on('close', (code) => finish(code === null ? -1 : code));
  // Un hijo nieto puede mantener los pipes abiertos y retrasar `close`
  // indefinidamente: `exit` + cierre forzado garantiza que la UI termine.
  child.on('exit', (code) => {
    setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      finish(code === null ? -1 : code);
    }, 100);
  });

  return { ok: true, id, command: label, directory, startedAt, kind };
}

function run(options = {}, send = () => {}) {
  const command = String(options.command || '').trim();
  if (!command || command.length > 2000 || /[\u0000\u0007]/.test(command)) {
    return { ok: false, error: 'Comando no válido.' };
  }
  const directory = validDirectory(options.directory);
  if (!directory) return { ok: false, error: 'La carpeta del proyecto no existe.' };
  return start({
    exe: powershellExe(), args: commandArgs(command), directory, send, label: command,
  });
}

function scriptsOf(directory, send = () => {}) {
  const dir = validDirectory(directory);
  if (!dir) return { ok: false, error: 'La carpeta del proyecto no existe.' };
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const scripts = Object.entries(data.scripts || {})
      .filter(([name, command]) => /^[A-Za-z0-9:_-]+$/.test(name) && typeof command === 'string')
      .map(([name, command]) => ({ name, command }));
    return { ok: true, name: data.name || '', version: data.version || '', scripts };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function runScript(options = {}, send = () => {}) {
  const script = String(options.script || '');
  const directory = validDirectory(options.directory);
  if (!directory) return { ok: false, error: 'La carpeta del proyecto no existe.' };
  if (!/^[A-Za-z0-9:_-]+$/.test(script) || !scriptsOf(directory).scripts.some((item) => item.name === script)) {
    return { ok: false, error: `El script «${script}» no existe en package.json.` };
  }
  return start({
    exe: npmExe(),
    args: ['run', script],
    directory,
    shell: process.platform === 'win32',
    send,
    label: `npm run ${script}`,
    kind: 'script',
  });
}

/** Bump de versión con lista blanca: nunca se interpola texto del renderer. */
function bumpVersion(options = {}, send = () => {}) {
  const type = String(options.type || '');
  if (!['major', 'minor', 'patch'].includes(type)) {
    return { ok: false, error: 'Tipo de versión no válido.' };
  }
  const directory = validDirectory(options.directory);
  if (!directory) return { ok: false, error: 'La carpeta del proyecto no existe.' };
  return start({
    exe: npmExe(),
    args: ['version', type, '--no-git-tag-version'],
    directory,
    shell: process.platform === 'win32',
    send,
    label: `npm version ${type}`,
    kind: 'version',
  });
}

function stop(id) {
  const entry = runs.get(String(id || ''));
  if (!entry) return false;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(entry.child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    entry.child.kill('SIGTERM');
  }
  return true;
}

function killAll() {
  for (const id of [...runs.keys()]) stop(id);
}

module.exports = { run, scriptsOf, runScript, bumpVersion, stop, killAll, pending: () => runs.size };
