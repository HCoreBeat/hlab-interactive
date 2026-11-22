'use strict';

/**
 * Lectura y escritura segura de la configuración de OpenCode
 * (opencode.json / opencode.jsonc del proyecto o del usuario) y ejecución de
 * subcomandos permitidos del CLI (stats, models, auth list...).
 *
 * El renderer solo puede pedir un ámbito ('project' | 'global') y un id de
 * comando de una lista fija; las rutas y los comandos se construyen aquí.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, spawn } = require('node:child_process');
const { dialog, shell } = require('electron');

const DEFAULT_TEXT = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Quita comentarios y comas finales (JSONC) respetando las cadenas. */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') { out += next ?? ''; i += 1; } else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function baseDir(scope, directory) {
  if (scope === 'global') return path.join(os.homedir(), '.config', 'opencode');
  if (!directory || !fs.existsSync(directory)) return null;
  return directory;
}

function configFile(scope, directory) {
  const base = baseDir(scope, directory);
  if (!base) return null;
  const jsonc = path.join(base, 'opencode.jsonc');
  const json = path.join(base, 'opencode.json');
  if (fs.existsSync(jsonc)) return jsonc;
  return json;
}

function readConfig(scope, directory) {
  const file = configFile(scope, directory);
  if (!file) return { ok: false, error: 'No hay un proyecto abierto.' };
  if (!fs.existsSync(file)) return { ok: true, file, exists: false, text: DEFAULT_TEXT };
  try {
    return { ok: true, file, exists: true, text: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function writeConfig(scope, directory, text, window) {
  const file = configFile(scope, directory);
  if (!file) return { ok: false, error: 'No hay un proyecto abierto.' };
  if (typeof text !== 'string' || text.length > 2_000_000) return { ok: false, error: 'Contenido no válido.' };
  try {
    JSON.parse(stripJsonc(text));
  } catch (error) {
    return { ok: false, error: `JSON no válido: ${error.message}` };
  }
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Guardar configuración de OpenCode',
    message: '¿Guardar los cambios en este archivo?',
    detail: `${file}\n\nSe guardará una copia de seguridad (.bak) del contenido anterior.`,
    buttons: ['Guardar', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return { ok: true, file };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function reveal(scope, directory) {
  const file = configFile(scope, directory);
  if (!file) return { ok: false };
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  else shell.openPath(path.dirname(file));
  return { ok: true };
}

// ------------------------------------------------------------- CLI ----------

const CAPTURE = {
  stats: 'stats',
  models: 'models',
  'auth-list': 'auth list',
  version: '--version',
};
const INTERACTIVE = {
  'auth-login': 'auth login',
  'auth-logout': 'auth logout',
  upgrade: 'upgrade',
};

function opencodeCommand(opencodePath) {
  const value = opencodePath && opencodePath.trim();
  if (!value) return 'opencode';
  return value.includes(' ') && !value.startsWith('"') ? `"${value}"` : value;
}

function capture(id, opencodePath) {
  const sub = CAPTURE[id];
  if (!sub) return Promise.resolve({ ok: false, error: 'Comando no permitido.' });
  const command = `${opencodeCommand(opencodePath)} ${sub}`;
  return new Promise((resolve) => {
    exec(command, {
      timeout: 45000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    }, (error, stdout, stderr) => {
      const output = String(stdout || stderr || '').replace(ANSI, '').trim();
      if (error && !output) resolve({ ok: false, error: error.message, command });
      else resolve({ ok: true, output, command });
    });
  });
}

async function terminal(id, opencodePath, window) {
  const sub = INTERACTIVE[id];
  if (!sub) return { ok: false, error: 'Comando no permitido.' };
  const command = `${opencodeCommand(opencodePath)} ${sub}`;
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Abrir terminal',
    message: '¿Abrir una terminal y ejecutar este comando?',
    detail: command,
    buttons: ['Abrir terminal', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true };
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', `start "OpenCode" cmd /k ${command}`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('x-terminal-emulator', ['-e', `sh -c '${command}; exec $SHELL'`], { detached: true, stdio: 'ignore' }).unref();
    }
    return { ok: true, command };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { readConfig, writeConfig, reveal, capture, terminal };
