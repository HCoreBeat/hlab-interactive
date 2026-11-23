'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  theme: 'dark',
  locale: 'es',
  animations: true,
  fontSize: 14,
  speechRate: 1.02,
  speechVoice: '',
  // Compactación automática del contexto: es lo que evita que una sesión larga
  // acabe subiendo varios MB en cada mensaje. El umbral se mide en tokens de
  // contexto (entrada + caché leída) y se puede ajustar desde Ajustes.
  autoCompact: true,
  autoCompactTokens: 60000,
  lastUpdateCheck: 0,
  latestKnownVersion: '',
  recentProjects: [],
  lastProject: null,
  connection: { mode: 'spawn', url: '', password: '' },
  opencodePath: '',
  preferredModel: null,
  preferredAgent: null,
  projectFolders: {},
  projectNotes: {},
  modelByProject: {},
  agentByProject: {},
  demo: false,
  permissions: { askEdit: true, askBash: true },
  // Finished subagent sessions are archived on the server so they stop piling
  // up in the lists and in the office.
  archiveSubagents: true,
  panel: { tab: 'activity' },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      output[key] = merge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

/** Small JSON store living in `app.getPath('userData')`. */
class SettingsStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'settings.json');
    this.data = clone(DEFAULTS);
    this.saveTimer = null;
    this.load();
  }

  load() {
    try {
      const text = fs.readFileSync(this.file, 'utf8');
      this.data = merge(clone(DEFAULTS), JSON.parse(text));
    } catch {
      this.data = clone(DEFAULTS);
    }
    return this.data;
  }

  get() {
    return clone(this.data);
  }

  set(partial) {
    this.data = merge(this.data, partial || {});
    this.persist();
    return this.get();
  }

  persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        fs.mkdirSync(this.directory, { recursive: true });
        const temp = `${this.file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(temp, this.file);
      } catch (error) {
        console.error('[settings] no se pudo guardar:', error.message);
      }
    }, 150);
  }

  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* ignore on shutdown */
    }
  }
}

module.exports = { SettingsStore, DEFAULTS };
