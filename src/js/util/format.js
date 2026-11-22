/** Formatting helpers used across the UI. */

export function basename(filePath) {
  if (!filePath) return '';
  const parts = String(filePath).split(/[\\/]/);
  return parts[parts.length - 1] || String(filePath);
}

export function dirname(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

export function relativePath(filePath, base) {
  if (!filePath) return '';
  let value = String(filePath);
  if (base) {
    const normalizedBase = String(base).replace(/\\/g, '/').replace(/\/+$/, '');
    const normalized = value.replace(/\\/g, '/');
    if (normalized.toLowerCase().startsWith(normalizedBase.toLowerCase())) {
      value = normalized.slice(normalizedBase.length).replace(/^\/+/, '');
    }
  }
  return value.replace(/\\/g, '/');
}

export function truncate(text, max = 80) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatRelative(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  if (diff < 45000) return 'ahora';
  if (diff < 3600000) return `hace ${Math.round(diff / 60000)} min`;
  if (diff < 86400000) return `hace ${Math.round(diff / 3600000)} h`;
  return `hace ${Math.round(diff / 86400000)} d`;
}

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0 s';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} min ${seconds} s`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count, singular, pluralForm) {
  return count === 1 ? singular : pluralForm;
}

/** "Editando src/app.js" style sentence for the office speech bubble. */
export function describeTool(name, input) {
  const tool = String(name || '').toLowerCase();
  const file = input?.path || input?.filePath || input?.file || input?.filename;
  const command = input?.command || input?.cmd;
  const pattern = input?.pattern || input?.query || input?.search;
  const shortFile = file ? basename(file) : '';
  switch (tool) {
    case 'read': return shortFile ? `Leyendo ${shortFile}` : 'Leyendo un archivo';
    case 'edit':
    case 'write':
    case 'patch':
    case 'multiedit':
      return shortFile ? `Editando ${shortFile}` : 'Editando archivos';
    case 'bash':
    case 'shell':
      return command ? `Ejecutando ${truncate(command, 40)}` : 'Ejecutando un comando';
    case 'glob':
    case 'grep':
      return pattern ? `Buscando “${truncate(pattern, 30)}”` : 'Buscando en el proyecto';
    case 'webfetch':
    case 'websearch':
      return 'Consultando la web';
    case 'todo':
    case 'todowrite':
      return 'Organizando el plan';
    case 'task':
      return 'Delegando en un subagente';
    default:
      return name ? `Usando ${name}` : 'Trabajando';
  }
}
