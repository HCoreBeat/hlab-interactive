'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

/** Source Control: comandos git acotados al proyecto abierto, sin shell. */
function validRepo(directory) {
  const value = String(directory || '');
  if (!value || value.length > 2048 || !fs.existsSync(value) || !fs.statSync(value).isDirectory()) return null;
  if (!fs.existsSync(path.join(value, '.git'))) return null;
  return path.resolve(value);
}

function validFile(file) {
  const value = String(file || '');
  if (!value || value.length > 2048 || path.isAbsolute(value)) return null;
  if (value.split(/[\\/]/).includes('..')) return null;
  return value;
}

function run(directory, args, maxBuffer = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd: directory,
      windowsHide: true,
      maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? error.message : '',
      });
    });
  });
}

async function status(directory) {
  const repo = validRepo(directory);
  if (!repo) return { ok: false, error: 'La carpeta no es un repositorio Git.' };
  const result = await run(repo, ['status', '--porcelain=v1', '-u', '--branch']);
  if (!result.ok) return { ok: false, error: result.stderr || result.error };
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith('## ')) || '';
  const branch = branchLine.slice(3).split('...')[0].trim();
  const files = [];
  for (const line of lines) {
    if (line.startsWith('## ')) continue;
    const x = line[0] || ' ';
    const y = line[1] || ' ';
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ').pop();
    files.push({ file, x, y, staged: x !== ' ' && x !== '?', untracked: x === '?' && y === '?' });
  }
  return { ok: true, branch, files };
}

async function diff(directory, file, staged = false) {
  const repo = validRepo(directory);
  const safeFile = validFile(file);
  if (!repo) return { ok: false, error: 'La carpeta no es un repositorio Git.' };
  if (!safeFile) return { ok: false, error: 'Archivo no válido.' };
  const args = ['diff', '--no-color', '--no-ext-diff'];
  if (staged) args.push('--cached');
  args.push('--', safeFile);
  const result = await run(repo, args);
  if (result.ok && result.stdout.trim()) return { ok: true, text: result.stdout };
  if (result.ok && !staged) {
    const absolute = path.resolve(repo, safeFile);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      const text = fs.readFileSync(absolute, 'utf8').slice(0, 300000);
      return { ok: true, text, untracked: true };
    }
  }
  return result.ok ? { ok: true, text: '' } : { ok: false, error: result.stderr || result.error };
}

async function simple(directory, args) {
  const repo = validRepo(directory);
  if (!repo) return { ok: false, error: 'La carpeta no es un repositorio Git.' };
  const result = await run(repo, args);
  return result.ok
    ? { ok: true, text: result.stdout, stderr: result.stderr }
    : { ok: false, error: result.stderr || result.error };
}

const stage = (dir, file) => {
  const safe = validFile(file);
  return safe ? simple(dir, ['add', '--', safe]) : Promise.resolve({ ok: false, error: 'Archivo no válido.' });
};
const unstage = (dir, file) => {
  const safe = validFile(file);
  return safe ? simple(dir, ['restore', '--staged', '--', safe]) : Promise.resolve({ ok: false, error: 'Archivo no válido.' });
};
const commit = (dir, message) => {
  const value = String(message || '').trim();
  if (!value || value.length > 500 || /[\r\n\u0000]/.test(value)) {
    return Promise.resolve({ ok: false, error: 'Mensaje de commit no válido.' });
  }
  return simple(dir, ['commit', '-m', value]);
};
const push = (dir) => simple(dir, ['push']);
const pull = (dir) => simple(dir, ['pull', '--ff-only']);
const branch = (dir) => simple(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
const log = (dir) => simple(dir, ['log', '--oneline', '-20']);

module.exports = {
  status, diff, stage, unstage, commit, push, pull, branch, log,
};
