'use strict';

/**
 * Archivos de proyecto `.hl`: un archivo pequeño que vive en la carpeta del
 * proyecto. Al abrirlo (doble clic en Windows) la app abre ese workspace.
 *
 * - Vac\u00edo (lo crea el men\u00fa "Nuevo" de Windows) \u2192 el workspace es la carpeta del archivo.
 * - JSON \u2192 { "version": 1, "name": "...", "folder": "." } (ruta relativa o absoluta).
 *
 * El registro del tipo de archivo (asociaci\u00f3n + entrada en "Nuevo") se hace en
 * HKCU, sin permisos de administrador, y solo tras confirmaci\u00f3n del usuario.
 */

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const { app, dialog } = require('electron');

const EXT = '.hl';
const PROG_ID = 'HLabInteractive.Project';

function parseWorkspaceFile(file) {
  const base = path.dirname(file);
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) return base;
    const data = JSON.parse(text);
    const folder = data.folder || data.path || data.dir;
    if (typeof folder === 'string' && folder && !path.isAbsolute(folder)) {
      const resolved = path.resolve(base, folder);
      // Un .hl no puede apuntar fuera de su propia carpeta (path traversal).
      const inside = resolved === base || resolved.startsWith(`${base}${path.sep}`);
      if (inside && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    }
  } catch { /* archivo vac\u00edo o con otro formato: se usa su carpeta */ }
  return base;
}

/** Busca un .hl entre los argumentos de arranque. */
function workspaceFromArgv(argv) {
  const file = (argv || []).find((arg) => typeof arg === 'string' && arg.toLowerCase().endsWith(EXT) && fs.existsSync(arg));
  return file ? { file, dir: parseWorkspaceFile(file) } : null;
}

/** Crea `<nombre>.hl` en la carpeta del proyecto (no pisa uno existente). */
function createWorkspaceFile(directory) {
  if (!directory || !fs.existsSync(directory)) return { ok: false, error: 'No hay un proyecto abierto.' };
  const name = path.basename(directory) || 'proyecto';
  let file = path.join(directory, `${name}${EXT}`);
  if (fs.existsSync(file)) return { ok: true, file, existed: true };
  const body = `${JSON.stringify({ version: 1, name, folder: '.', created: new Date().toISOString() }, null, 2)}\n`;
  try {
    fs.writeFileSync(file, body, 'utf8');
    return { ok: true, file };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function run(command) {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (error) => resolve(!error));
  });
}

function launcher() {
  // portable: el exe real es PORTABLE_EXECUTABLE_FILE; en desarrollo hay que pasar la ruta de la app
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const dev = process.defaultApp && !process.env.PORTABLE_EXECUTABLE_FILE;
  return { exe, command: dev ? `"${exe}" "${app.getAppPath()}" "%1"` : `"${exe}" "%1"` };
}

async function registerFileType(window) {
  if (process.platform !== 'win32') return { ok: false, error: 'Solo disponible en Windows.' };
  const { exe, command } = launcher();
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Registrar archivos .hl',
    message: '\u00bfRegistrar los archivos .hl en Windows?',
    detail: `Se a\u00f1adir\u00e1 "Proyecto de HLab Interactive" al men\u00fa Nuevo del explorador y los .hl se abrir\u00e1n con esta app.\n\nSolo se modifica el registro del usuario actual (HKCU):\n${exe}`,
    buttons: ['Registrar', 'Cancelar'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true };

  const key = 'HKCU\\Software\\Classes';
  const steps = [
    `reg add "${key}\\${EXT}" /ve /d "${PROG_ID}" /f`,
    `reg add "${key}\\${EXT}\\ShellNew" /v NullFile /t REG_SZ /d "" /f`,
    `reg add "${key}\\${PROG_ID}" /ve /d "Proyecto de HLab Interactive" /f`,
    `reg add "${key}\\${PROG_ID}\\DefaultIcon" /ve /d "\\"${exe}\\",0" /f`,
    `reg add "${key}\\${PROG_ID}\\shell\\open\\command" /ve /d "${command.replace(/"/g, '\\"')}" /f`,
  ];
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await run(step))) return { ok: false, error: 'No se pudo escribir en el registro de Windows.' };
  }
  // avisa al explorador para que refresque asociaciones e iconos
  await run('ie4uinit.exe -show');
  return { ok: true };
}

async function unregisterFileType(window) {
  if (process.platform !== 'win32') return { ok: false, error: 'Solo disponible en Windows.' };
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: 'Quitar registro de .hl',
    message: '\u00bfQuitar la asociaci\u00f3n de archivos .hl y la entrada del men\u00fa Nuevo?',
    buttons: ['Quitar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true };
  await run(`reg delete "HKCU\\Software\\Classes\\${EXT}" /f`);
  await run(`reg delete "HKCU\\Software\\Classes\\${PROG_ID}" /f`);
  return { ok: true };
}

module.exports = {
  parseWorkspaceFile, workspaceFromArgv, createWorkspaceFile, registerFileType, unregisterFileType,
};
