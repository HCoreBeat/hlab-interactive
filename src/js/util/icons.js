/** Emoji iconography (no external assets, works offline). */

const TOOL_ICONS = [
  [/^(read|view|cat)$/i, '📖', 'lectura'],
  [/^(edit|multiedit|patch|apply_patch)$/i, '✏️', 'edición'],
  [/^(write|create)$/i, '📝', 'escritura'],
  [/^(bash|shell|exec|run)$/i, '💻', 'comando'],
  [/^(glob|grep|search|find|list)$/i, '🔎', 'búsqueda'],
  [/^(webfetch|websearch|fetch)$/i, '🌐', 'web'],
  [/^(todo|todowrite|task)$/i, '🗂️', 'plan'],
];

export function toolIcon(name) {
  for (const [pattern, icon] of TOOL_ICONS) {
    if (pattern.test(String(name || ''))) return icon;
  }
  return '🔧';
}

export function toolKind(name) {
  const value = String(name || '').toLowerCase();
  if (/^(read|view|cat|read_file|file[_-]?read)(?:$|[_:.-])/.test(value)) return 'reading';
  if (/^(edit|multiedit|patch|apply_patch|write|create)(?:$|[_:.-])/.test(value)) return 'editing';
  if (/^(bash|shell|exec|run|build|compile|test|command)(?:$|[_:.-])/.test(value)) return 'running';
  if (/^(glob|grep|search|find|list|webfetch|websearch|fetch|file[_-]?search|search_files)(?:$|[_:.-])/.test(value)) return 'searching';
  return 'thinking';
}

export const STATUS_ICONS = {
  pending: '⏳',
  streaming: '✍️',
  running: '⏳',
  completed: '✅',
  success: '✅',
  error: '❌',
  rejected: '🚫',
  interrupted: '⏹️',
};
