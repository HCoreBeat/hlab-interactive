'use strict';

/**
 * Comprobación e instalación de las dependencias de la app (Node, npm, git y
 * opencode) y búsqueda de actualizaciones de opencode.
 *
 * Seguridad: el renderer solo puede pedir un `id` de una lista fija. Los
 * comandos viven aquí y antes de ejecutar cualquiera se pide permiso al
 * usuario con un diálogo nativo que muestra el comando exacto.
 */

const { dialog } = require('electron');
const { exec, spawn, spawnSync } = require('node:child_process');

const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const WINGET_FLAGS = '--accept-source-agreements --accept-package-agreements';

let current = null;

function run(command, timeout = 8000) {
  return new Promise((resolve) => {
    exec(command, { timeout, windowsHide: true, env: process.env }, (error, stdout) => {
      resolve(error ? null : String(stdout || '').trim().split(/\r?\n/)[0] || '');
    });
  });
}

function quoted(command) {
  return command.includes(' ') && !command.startsWith('"') ? `"${command}"` : command;
}

function cleanVersion(text) {
  const match = /(\d+\.\d+\.\d+(?:[-.\w]*)?)/.exec(text || '');
  return match ? match[1] : '';
}

function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  const pb = String(b).split(/[.-]/).map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** Comandos permitidos. `null` = no se puede automatizar en esta plataforma. */
function commandFor(id, opencodePath) {
  const opencode = opencodePath && opencodePath.trim() ? quoted(opencodePath.trim()) : 'opencode';
  switch (id) {
    case 'opencode':
      return 'npm install -g opencode-ai@latest';
    case 'opencode-update':
      return `${opencode} upgrade || npm install -g opencode-ai@latest`;
    case 'node':
      if (WIN) return `winget install -e --id OpenJS.NodeJS.LTS ${WINGET_FLAGS}`;
      if (MAC) return 'brew install node';
      return null;
    case 'git':
      if (WIN) return `winget install -e --id Git.Git ${WINGET_FLAGS}`;
      if (MAC) return 'brew install git';
      return null;
    default:
      return undefined;
  }
}

async function check(opencodePath, cachedLatest = '') {
  const opencodeCommand = opencodePath && opencodePath.trim() ? quoted(opencodePath.trim()) : 'opencode';
  const [node, npm, git, opencode] = await Promise.all([
    run('node --version'),
    run('npm --version'),
    run('git --version'),
    run(`${opencodeCommand} --version`),
  ]);
  // `npm view` consulta el registro público: solo se hace cuando no tenemos una
  // versión reciente cacheada (o cuando el usuario fuerza la comprobación).
  const latestRaw = !cachedLatest && npm !== null
    ? await run('npm view opencode-ai version', 20000)
    : null;

  const installedVersion = cleanVersion(opencode);
  const latest = cachedLatest || cleanVersion(latestRaw);
  const items = [
    {
      id: 'node', label: 'Node.js', required: true, found: node !== null, version: cleanVersion(node),
      why: 'Necesario para instalar y ejecutar opencode.', canInstall: commandFor('node') !== null,
      command: commandFor('node'),
    },
    {
      id: 'npm', label: 'npm', required: true, found: npm !== null, version: cleanVersion(npm),
      why: 'Gestor de paquetes que instala opencode (viene con Node.js).', canInstall: false, command: null,
    },
    {
      id: 'git', label: 'Git', required: false, found: git !== null, version: cleanVersion(git),
      why: 'Opcional: opencode lo usa para deshacer cambios y ver diffs.', canInstall: commandFor('git') !== null,
      command: commandFor('git'),
    },
    {
      id: 'opencode', label: 'opencode', required: true, found: opencode !== null, version: installedVersion,
      why: 'El agente de código que esta app muestra y controla.', canInstall: npm !== null,
      command: commandFor('opencode'),
    },
  ];

  return {
    platform: process.platform,
    items,
    opencode: {
      installed: opencode !== null,
      version: installedVersion,
      latest,
      updateAvailable: Boolean(installedVersion && latest && compareVersions(latest, installedVersion) > 0),
      updateCommand: commandFor('opencode-update', opencodePath),
    },
    ready: items.filter((item) => item.required).every((item) => item.found),
  };
}

function send(window, channel, payload) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

async function install(id, { window, opencodePath }) {
  if (current) return { ok: false, error: 'Ya hay una instalación en curso.' };
  const command = commandFor(id, opencodePath);
  if (command === undefined) return { ok: false, error: 'Componente desconocido.' };
  if (command === null) {
    return { ok: false, error: 'En este sistema hay que instalarlo manualmente con tu gestor de paquetes.' };
  }

  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Permiso para instalar',
    message: '¿Permitir que HLab Interactive ejecute este comando?',
    detail: `${command}\n\nSe ejecutará en tu equipo y puede descargar e instalar software.`,
    buttons: ['Instalar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true };

  send(window, 'oc:setup:output', { id, text: `$ ${command}\n` });
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, windowsHide: true, env: process.env });
    current = child;
    const onData = (chunk) => send(window, 'oc:setup:output', { id, text: chunk.toString() });
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      current = null;
      send(window, 'oc:setup:output', { id, text: `\nError: ${error.message}\n` });
      send(window, 'oc:setup:done', { id, ok: false, code: -1 });
      resolve({ ok: false, error: error.message });
    });
    child.on('close', (code) => {
      current = null;
      const ok = code === 0;
      const needsRestart = ok && (id === 'node' || id === 'git');
      send(window, 'oc:setup:output', {
        id,
        text: ok
          ? `\n[Listo] ${needsRestart ? 'Reinicia la app para que reconozca el nuevo PATH.' : 'Instalación completada.'}\n`
          : `\n[Falló] código de salida ${code}\n`,
      });
      send(window, 'oc:setup:done', { id, ok, code, needsRestart });
      resolve({ ok, code, needsRestart });
    });
  });
}

function cancel() {
  const child = current;
  if (!child) return { ok: true };
  current = null;
  if (WIN && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { child.kill('SIGTERM'); } catch { /* ya terminó */ }
  return { ok: true };
}

module.exports = { check, install, cancel };
