'use strict';

import { el, clear } from '../util/dom.js';
import { subscribe, state, activeSession, primaryAgents, subagentAgents } from '../store.js';
import { request } from '../api.js';
import { toast } from './toast.js';

const OPENCE_COMMANDS = [
  { id: 'new-session', name: 'Nueva sesión', description: 'Crear una nueva sesión de trabajo', category: 'Sesión', shortcut: 'Ctrl+N', action: 'newSession' },
  { id: 'open-project', name: 'Abrir proyecto', description: 'Seleccionar carpeta de proyecto', category: 'Proyecto', shortcut: 'Ctrl+O', action: 'openProject' },
  { id: 'switch-session', name: 'Cambiar sesión', description: 'Seleccionar otra sesión activa', category: 'Sesión', shortcut: 'Ctrl+Tab', action: 'switchSession' },
  { id: 'kill-session', name: 'Matar sesión', description: 'Terminar sesión actual completamente', category: 'Sesión', shortcut: '', action: 'killSession' },
  { id: 'undo', name: 'Deshacer último cambio', description: 'Revertir el último turno (revert stage + commit)', category: 'Edición', shortcut: '/deshacer', action: 'undo' },
  { id: 'discard', name: 'Descartar preparado', description: 'Eliminar cambios preparados sin aplicar', category: 'Edición', shortcut: '', action: 'discard' },
  { id: 'abort', name: 'Abortar respuesta', description: 'Detener la generación actual del agente', category: 'Control', shortcut: 'Esc', action: 'abort' },
  { id: 'clear-view', name: 'Limpiar vista', description: 'Ocultar historial de la vista actual', category: 'Vista', shortcut: '/limpiar-vista', action: 'clearView' },
  { id: 'shell', name: 'Ejecutar shell', description: 'Ejecutar comando en la sesión (!comando)', category: 'Terminal', shortcut: '!', action: 'shell' },
  { id: 'model-select', name: 'Cambiar modelo', description: 'Seleccionar modelo LLM para la sesión', category: 'Configuración', shortcut: '', action: 'modelSelect' },
  { id: 'agent-select', name: 'Cambiar agente', description: 'Seleccionar agente (build, plan, etc.)', category: 'Configuración', shortcut: '', action: 'agentSelect' },
  { id: 'permission-allow', name: 'Permitir siempre', description: 'Permitir acción permanentemente para esta sesión', category: 'Permisos', shortcut: '', action: 'permissionAllow' },
  { id: 'permission-once', name: 'Permitir una vez', description: 'Permitir acción solo para esta ocasión', category: 'Permisos', shortcut: '', action: 'permissionOnce' },
  { id: 'permission-deny', name: 'Denegar', description: 'Rechazar la acción solicitada', category: 'Permisos', shortcut: '', action: 'permissionDeny' },
  { id: 'mcp-list', name: 'Listar servidores MCP', description: 'Ver todos los servidores MCP disponibles', category: 'MCP', shortcut: '', action: 'mcpList' },
  { id: 'mcp-connect', name: 'Conectar MCP', description: 'Conectar un servidor MCP', category: 'MCP', shortcut: '', action: 'mcpConnect' },
  { id: 'mcp-disconnect', name: 'Desconectar MCP', description: 'Desconectar un servidor MCP', category: 'MCP', shortcut: '', action: 'mcpDisconnect' },
  { id: 'fs-list', name: 'Listar archivos', description: 'Ver árbol de archivos del proyecto', category: 'Archivos', shortcut: '', action: 'fsList' },
  { id: 'fs-find', name: 'Buscar archivos', description: 'Buscar archivos por patrón', category: 'Archivos', shortcut: '', action: 'fsFind' },
  { id: 'fs-read', name: 'Leer archivo', description: 'Ver contenido de un archivo', category: 'Archivos', shortcut: '', action: 'fsRead' },
  { id: 'fs-write', name: 'Escribir archivo', description: 'Crear o modificar un archivo', category: 'Archivos', shortcut: '', action: 'fsWrite' },
  { id: 'vcs-diff', name: 'Ver diff Git', description: 'Ver cambios en control de versiones', category: 'Git', shortcut: '', action: 'vcsDiff' },
  { id: 'vcs-status', name: 'Estado Git', description: 'Ver estado del repositorio', category: 'Git', shortcut: '', action: 'vcsStatus' },
  { id: 'session-history', name: 'Historial de sesión', description: 'Ver mensajes anteriores de la sesión', category: 'Sesión', shortcut: '', action: 'sessionHistory' },
  { id: 'session-export', name: 'Exportar sesión', description: 'Exportar sesión a archivo', category: 'Sesión', shortcut: '', action: 'sessionExport' },
  { id: 'settings', name: 'Ajustes', description: 'Abrir configuración de la app', category: 'Sistema', shortcut: 'Ctrl+,', action: 'settings' },
  { id: 'toggle-rail', name: 'Abrir / cerrar barra lateral', description: 'Mostrar u ocultar el panel lateral de vistas', category: 'Vista', shortcut: 'Ctrl+B', action: 'toggleRail' },
  { id: 'toggle-terminal', name: 'Abrir terminal', description: 'Abrir la terminal del agente en el panel lateral', category: 'Vista', shortcut: 'Ctrl+J', action: 'toggleTerminal' },
  { id: 'focus-chat', name: 'Enfocar chat', description: 'Poner foco en el campo de mensaje', category: 'Navegación', shortcut: 'Ctrl+L', action: 'focusChat' },
  { id: 'demo-mode', name: 'Modo demo', description: 'Activar/desactivar modo demostración', category: 'Sistema', shortcut: '', action: 'demoMode' },
  { id: 'restart-server', name: 'Reiniciar servidor', description: 'Reiniciar opencode serve', category: 'Sistema', shortcut: '', action: 'restartServer' },
  { id: 'view-logs', name: 'Ver logs', description: 'Ver logs del servidor opencode', category: 'Sistema', shortcut: '', action: 'viewLogs' },
  { id: 'oc-models', name: 'Modelos', description: 'Listar y cambiar de modelo (/models)', category: 'OpenCode', shortcut: '/models', action: 'modelSelect' },
  { id: 'oc-agents', name: 'Agentes', description: 'Listar y cambiar de agente (/agents)', category: 'OpenCode', shortcut: '/agents', action: 'agentSelect' },
  { id: 'oc-sessions', name: 'Sesiones', description: 'Ver y cambiar de sesión (/sessions)', category: 'OpenCode', shortcut: '/sessions', action: 'switchSession' },
  { id: 'oc-new', name: 'Nueva sesión (/new)', description: 'Empezar una sesión nueva', category: 'OpenCode', shortcut: '/new', action: 'newSession' },
  { id: 'oc-compact', name: 'Compactar sesión', description: 'Resumir la conversación para liberar contexto (/compact)', category: 'OpenCode', shortcut: '/compact', action: 'runCommand', payload: 'compact' },
  { id: 'oc-redo', name: 'Rehacer', description: 'Volver a aplicar el cambio deshecho (/redo)', category: 'OpenCode', shortcut: '/redo', action: 'runCommand', payload: 'redo' },
  { id: 'oc-init', name: 'Inicializar AGENTS.md', description: 'Crear o actualizar AGENTS.md del proyecto (/init)', category: 'OpenCode', shortcut: '/init', action: 'runCommand', payload: 'init' },
  { id: 'oc-share', name: 'Compartir sesión', description: 'Generar enlace compartido (/share)', category: 'OpenCode', shortcut: '/share', action: 'runCommand', payload: 'share' },
  { id: 'oc-unshare', name: 'Dejar de compartir', description: 'Quitar el enlace compartido (/unshare)', category: 'OpenCode', shortcut: '/unshare', action: 'runCommand', payload: 'unshare' },
  { id: 'oc-help', name: 'Ayuda de OpenCode', description: 'Mostrar la ayuda (/help)', category: 'OpenCode', shortcut: '/help', action: 'runCommand', payload: 'help' },
  { id: 'oc-thinking', name: 'Mostrar / ocultar razonamiento', description: 'Alterna los bloques de pensamiento del agente', category: 'Vista', shortcut: '', action: 'toggleThinking' },
  { id: 'oc-details', name: 'Mostrar / ocultar detalles de herramientas', description: 'Alterna el detalle de cada herramienta ejecutada', category: 'Vista', shortcut: '', action: 'toggleDetails' },
  { id: 'oc-theme', name: 'Cambiar tema', description: 'Alterna entre tema claro y oscuro', category: 'Vista', shortcut: '', action: 'toggleTheme' },
  { id: 'oc-office', name: 'Mostrar / ocultar oficina', description: 'Abre o cierra la oficina bajo el chat', category: 'Vista', shortcut: 'Ctrl+Shift+O', action: 'toggleOffice' },
  { id: 'oc-office-fp', name: 'Entrar en la oficina (1ª persona)', description: 'Pasea por las salas con WASD y el ratón; Esc vuelve a la vista superior', category: 'Vista', shortcut: 'F', action: 'enterOfficeFp' },
  { id: 'oc-anim', name: 'Activar / desactivar animaciones', description: 'Alterna las animaciones de la interfaz', category: 'Vista', shortcut: '', action: 'toggleAnimations' },
  { id: 'oc-updates', name: 'Buscar actualizaciones de OpenCode', description: 'Comprueba si hay una versión nueva de opencode y ofrece instalarla', category: 'Sistema', shortcut: '', action: 'checkUpdates' },
  { id: 'oc-setup', name: 'Instalación y dependencias', description: 'Abre el asistente que verifica e instala Node, npm, git y opencode', category: 'Sistema', shortcut: '', action: 'openSetup' },
  { id: 'oc-usage', name: 'Uso de la cuota gratuita', description: 'Muestra cuántos mensajes llevas, tokens, uso por modelo y cuándo se reinicia la cuota', category: 'Sistema', shortcut: '', action: 'openUsage' },
  { id: 'oc-config', name: 'Configuración de OpenCode (opencode.json)', description: 'Edita modelo por defecto, permisos, compartir y actualizaciones del proyecto o globales, con editor JSON validado', category: 'OpenCode', shortcut: '', action: 'openConfig' },
  { id: 'oc-stats', name: 'Estadísticas de uso (opencode stats)', description: 'Muestra tokens, coste y sesiones que reporta el propio OpenCode', category: 'OpenCode', shortcut: '', action: 'cli', payload: 'stats', title: 'Estadísticas de uso de OpenCode' },
  { id: 'oc-models-list', name: 'Modelos disponibles (opencode models)', description: 'Lista todos los modelos de los proveedores conectados', category: 'OpenCode', shortcut: '', action: 'cli', payload: 'models', title: 'Modelos disponibles' },
  { id: 'oc-auth-list', name: 'Credenciales conectadas (opencode auth list)', description: 'Muestra qué proveedores tienes conectados', category: 'OpenCode', shortcut: '', action: 'cli', payload: 'auth-list', title: 'Proveedores conectados' },
  { id: 'oc-auth-login', name: 'Conectar proveedor (opencode auth login)', description: 'Abre una terminal para añadir un proveedor o clave de API', category: 'OpenCode', shortcut: '/connect', action: 'terminal', payload: 'auth-login' },
  { id: 'oc-upgrade-term', name: 'Actualizar OpenCode en una terminal', description: 'Ejecuta opencode upgrade en una terminal visible', category: 'Sistema', shortcut: '', action: 'terminal', payload: 'upgrade' },
  { id: 'hl-create', name: 'Crear archivo de proyecto (.hl)', description: 'Crea un archivo .hl en la carpeta del proyecto: al abrirlo con doble clic, la app abre ese workspace', category: 'Proyecto', shortcut: '', action: 'workspaceFile' },
  { id: 'hl-register', name: 'Registrar archivos .hl en Windows', description: 'Añade "Proyecto de HLab Interactive" al menú Nuevo del Explorador y asocia los .hl con esta app', category: 'Sistema', shortcut: '', action: 'registerHl' },
  { id: 'hl-unregister', name: 'Quitar el registro de .hl', description: 'Elimina la asociación y la entrada del menú Nuevo', category: 'Sistema', shortcut: '', action: 'unregisterHl' },
];

const CATEGORY_ORDER = ['OpenCode', 'Sesión', 'Sesiones', 'Configuración', 'Agentes', 'Subagentes', 'Comandos opencode', 'Vista', 'Navegación', 'Proyecto', 'Archivos', 'Git', 'Edición', 'Control', 'Terminal', 'Permisos', 'MCP', 'Sistema'];
const CATEGORY_HINT = {
  OpenCode: 'Los comandos propios de opencode (/models, /compact, /init…).',
  'Sesión': 'Crear, cambiar, exportar y cerrar sesiones.',
  Sesiones: 'Tus sesiones abiertas en este proyecto.',
  'Configuración': 'Modelo y agente de la sesión.',
  Agentes: 'Agentes principales: se aplican a la sesión activa.',
  Subagentes: 'Subagentes del catálogo: solo se usan en sesiones hijas.',
  'Comandos opencode': 'Comandos personalizados que expone tu servidor opencode.',
  Vista: 'Qué se muestra y cómo: paneles, tema, oficina, animaciones.',
  'Navegación': 'Moverte por la interfaz.',
  Proyecto: 'Abrir y cambiar de proyecto.',
  Archivos: 'Explorar, buscar y leer archivos del proyecto.',
  Git: 'Cambios y estado del repositorio.',
  'Edición': 'Deshacer o descartar cambios del agente.',
  Control: 'Controlar la respuesta en curso.',
  Terminal: 'Ejecutar comandos de shell.',
  Permisos: 'Responder a las peticiones de permiso del agente.',
  MCP: 'Servidores MCP conectados.',
  Sistema: 'Ajustes, servidor, logs, actualizaciones e instalación.',
};
let activeCategory = 'Todos';
let paletteQuery = '';

let modal = null;
let selectedIndex = 0;
let filteredCommands = [];
let onCommandExecute = null;

/**
 * Palette entries = the app commands + everything the server exposes:
 * opencode slash commands, agents, sessions and MCP servers.
 */
function buildItems() {
  const items = [...OPENCE_COMMANDS];
  for (const command of state.commands || []) {
    items.push({
      id: `oc-command-${command.name}`,
      name: `/${command.name}`,
      description: command.description || `Comando de opencode`,
      category: 'Comandos opencode',
      shortcut: `/${command.name}`,
      action: 'runCommand',
      payload: command.name,
    });
  }
  for (const agent of primaryAgents()) {
    items.push({
      id: `oc-agent-${agent.id}`,
      name: `Agente: ${agent.name || agent.id}`,
      description: agent.description || `Agente ${agent.mode || 'primary'}`,
      category: 'Agentes',
      shortcut: '',
      action: 'useAgent',
      payload: agent.id,
    });
  }
  for (const agent of subagentAgents()) {
    items.push({
      id: `oc-subagent-${agent.id}`,
      name: `Subagente: ${agent.name || agent.id}`,
      description: `${agent.description || 'Subagente'} — informativo, no se asigna a la sesión principal`,
      category: 'Subagentes',
      shortcut: '',
      action: 'agentInfo',
      payload: agent.id,
    });
  }
  for (const session of state.sessions || []) {
    items.push({
      id: `oc-session-${session.id}`,
      name: `Sesión: ${session.title || session.id}`,
      description: session.location?.directory || 'Ir a esta sesión',
      category: 'Sesiones',
      shortcut: '',
      action: 'selectSession',
      payload: session.id,
    });
  }
  for (const server of state.mcpServers || []) {
    items.push({
      id: `oc-mcp-${server.id}`,
      name: `MCP: ${server.name || server.id}`,
      description: server.command || server.type || 'Servidor MCP',
      category: 'MCP',
      shortcut: '',
      action: 'openMcp',
      payload: server.id,
    });
  }
  const rank = (name) => { const i = CATEGORY_ORDER.indexOf(name); return i < 0 ? 99 : i; };
  return items.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name));
}

export function mountCommandPalette(handlers) {
  onCommandExecute = handlers;

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['k', 'p'].includes(String(e.key).toLowerCase())) {
      e.preventDefault();
      if (modal) closePalette();
      else openPalette();
    }
    if (e.key === '/' && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      openPalette();
    }
  });

  return { open: openPalette };
}

function openPalette() {
  if (modal) return;

  filteredCommands = buildItems();
  selectedIndex = 0;
  activeCategory = 'Todos';
  paletteQuery = '';

  modal = el('div', { class: 'command-palette-backdrop' }, [
    el('div', { class: 'command-palette' }, [
      el('div', { class: 'command-palette-header' }, [
        el('span', { class: 'command-palette-title', text: 'Comandos de OpenCode  ·  Ctrl+P' }),
        el('input', {
          class: 'command-palette-search',
          type: 'text',
          placeholder: 'Buscar comandos...',
          onInput: (e) => filterCommands(e.target.value),
        }),
      ]),
      el('div', { class: 'command-palette-body' }, [
        el('nav', { class: 'command-palette-cats', id: 'command-cats', 'aria-label': 'Categorías' }),
        el('div', { class: 'command-palette-main' }, [
          el('div', { class: 'command-palette-list', id: 'command-list' }),
          el('div', { class: 'command-palette-detail', id: 'command-detail' }),
        ]),
      ]),
      el('div', { class: 'command-palette-footer', text: '↑↓ Navegar  ·  Tab Categoría  ·  Enter Ejecutar  ·  Esc Cerrar  ·  Ctrl+P Abrir/cerrar' }),
    ]),
  ]);

  document.getElementById('modal-root').appendChild(modal);
  renderList();
  modal.querySelector('.command-palette-search').focus();

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filteredCommands.length - 1);
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderList();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      cycleCategory(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelected();
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  modal._handleKeyDown = handleKeyDown;
}

function closePalette() {
  if (!modal) return;
  document.removeEventListener('keydown', modal._handleKeyDown);
  modal.remove();
  modal = null;
}

function filterCommands(query) {
  const q = query.toLowerCase().trim();
  paletteQuery = query;
  const items = buildItems().filter((cmd) => activeCategory === 'Todos' || cmd.category === activeCategory);
  if (!q) {
    filteredCommands = items;
  } else {
    filteredCommands = items.filter(cmd =>
      cmd.name.toLowerCase().includes(q) ||
      cmd.description.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      (cmd.shortcut && cmd.shortcut.toLowerCase().includes(q))
    );
  }
  selectedIndex = 0;
  renderList();
}

function renderList() {
  const list = document.getElementById('command-list');
  if (!list) return;
  renderCats();
  renderDetail();
  clear(list);

  let currentCategory = '';
  filteredCommands.forEach((cmd, index) => {
    if (cmd.category !== currentCategory) {
      currentCategory = cmd.category;
      list.appendChild(el('div', { class: 'command-category' }, [
        el('span', { text: currentCategory }),
      ]));
    }

    const isSelected = index === selectedIndex;
    list.appendChild(el('div', {
      class: `command-item ${isSelected ? 'selected' : ''}`,
      onClick: () => { selectedIndex = index; executeSelected(); },
      onMouseEnter: () => { selectedIndex = index; renderList(); },
    }, [
      el('span', { class: 'command-name', text: cmd.name }),
      el('span', { class: 'command-desc', text: cmd.description }),
      cmd.shortcut && el('span', { class: 'command-shortcut', text: cmd.shortcut }),
    ]));
  });

  const selectedEl = list.querySelector('.command-item.selected');
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function cycleCategory(step) {
  const names = ['Todos', ...categoryNames()];
  const next = (names.indexOf(activeCategory) + step + names.length) % names.length;
  activeCategory = names[next];
  filterCommands(paletteQuery);
}

function categoryNames() {
  const present = new Set(buildItems().map((cmd) => cmd.category));
  return [...present].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a); const ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function renderCats() {
  const nav = document.getElementById('command-cats');
  if (!nav) return;
  clear(nav);
  const all = buildItems();
  const counts = new Map();
  for (const cmd of all) counts.set(cmd.category, (counts.get(cmd.category) || 0) + 1);
  const entries = [['Todos', all.length], ...categoryNames().map((name) => [name, counts.get(name)])];
  for (const [name, count] of entries) {
    nav.appendChild(el('button', {
      class: `command-cat${name === activeCategory ? ' is-active' : ''}`,
      type: 'button',
      title: CATEGORY_HINT[name] || '',
      onClick: () => { activeCategory = name; filterCommands(paletteQuery); },
    }, [el('span', { text: name }), el('span', { class: 'command-cat-count', text: String(count) })]));
  }
}

function renderDetail() {
  const box = document.getElementById('command-detail');
  if (!box) return;
  clear(box);
  const cmd = filteredCommands[selectedIndex];
  if (!cmd) {
    box.appendChild(el('span', { class: 'muted', text: 'Sin resultados para esa búsqueda.' }));
    return;
  }
  box.appendChild(el('div', { class: 'command-detail-head' }, [
    el('strong', { text: cmd.name }),
    el('span', { class: 'command-detail-cat', text: cmd.category }),
    cmd.shortcut ? el('kbd', { class: 'command-shortcut', text: cmd.shortcut }) : null,
  ].filter(Boolean)));
  box.appendChild(el('div', { class: 'command-detail-desc', text: cmd.description }));
}

async function executeSelected() {
  const cmd = filteredCommands[selectedIndex];
  if (!cmd || !onCommandExecute) return;

  closePalette();

  try {
    switch (cmd.action) {
      case 'newSession':
        await onCommandExecute.onNewSession?.();
        break;
      case 'openProject':
        await onCommandExecute.onOpenProject?.();
        break;
      case 'switchSession':
        await onCommandExecute.onSwitchSession?.();
        break;
      case 'killSession':
        await onCommandExecute.onKillSession?.();
        break;
      case 'undo':
        await onCommandExecute.onUndo?.();
        break;
      case 'discard':
        await onCommandExecute.onDiscard?.();
        break;
      case 'abort':
        await onCommandExecute.onAbort?.();
        break;
      case 'clearView':
        await onCommandExecute.onClearView?.();
        break;
      case 'shell':
        onCommandExecute.onShell?.();
        break;
      case 'modelSelect':
        onCommandExecute.onModelSelect?.();
        break;
      case 'agentSelect':
        onCommandExecute.onAgentSelect?.();
        break;
      case 'permissionAllow':
        onCommandExecute.onPermissionAllow?.();
        break;
      case 'permissionOnce':
        onCommandExecute.onPermissionOnce?.();
        break;
      case 'permissionDeny':
        onCommandExecute.onPermissionDeny?.();
        break;
      case 'mcpList':
        onCommandExecute.onMCPList?.();
        break;
      case 'mcpConnect':
        onCommandExecute.onMCPConnect?.();
        break;
      case 'mcpDisconnect':
        onCommandExecute.onMCPDisconnect?.();
        break;
      case 'fsList':
        onCommandExecute.onFSList?.();
        break;
      case 'fsFind':
        onCommandExecute.onFSFind?.();
        break;
      case 'fsRead':
        onCommandExecute.onFSRead?.();
        break;
      case 'fsWrite':
        onCommandExecute.onFSWrite?.();
        break;
      case 'vcsDiff':
        onCommandExecute.onVCSDiff?.();
        break;
      case 'vcsStatus':
        onCommandExecute.onVCSStatus?.();
        break;
      case 'sessionHistory':
        onCommandExecute.onSessionHistory?.();
        break;
      case 'sessionExport':
        onCommandExecute.onSessionExport?.();
        break;
      case 'settings':
        onCommandExecute.onSettings?.();
        break;
      case 'toggleRail':
        onCommandExecute.onToggleRail?.();
        break;
      case 'toggleTerminal':
        onCommandExecute.onToggleTerminal?.();
        break;
      case 'focusChat':
        onCommandExecute.onFocusChat?.();
        break;
      case 'demoMode':
        onCommandExecute.onDemoMode?.();
        break;
      case 'restartServer':
        onCommandExecute.onRestartServer?.();
        break;
      case 'viewLogs':
        onCommandExecute.onViewLogs?.();
        break;
      case 'checkUpdates':
        onCommandExecute.onCheckUpdates?.();
        break;
      case 'workspaceFile':
        onCommandExecute.onCreateWorkspaceFile?.();
        break;
      case 'registerHl':
        onCommandExecute.onRegisterHl?.();
        break;
      case 'unregisterHl':
        onCommandExecute.onUnregisterHl?.();
        break;
      case 'openConfig':
        onCommandExecute.onOpenConfig?.();
        break;
      case 'cli':
        onCommandExecute.onCli?.(cmd.payload, cmd.title || cmd.name);
        break;
      case 'terminal':
        onCommandExecute.onTerminal?.(cmd.payload);
        break;
      case 'openUsage':
        onCommandExecute.onOpenUsage?.();
        break;
      case 'openSetup':
        onCommandExecute.onOpenSetup?.();
        break;
      case 'runCommand':
        if (cmd.payload === 'compact') { onCommandExecute.onCompact?.(); break; }
        await onCommandExecute.onRunCommand?.(cmd.payload);
        break;
      case 'toggleThinking':
        onCommandExecute.onToggleThinking?.();
        break;
      case 'toggleDetails':
        onCommandExecute.onToggleDetails?.();
        break;
      case 'toggleTheme':
        onCommandExecute.onToggleTheme?.();
        break;
      case 'toggleOffice':
        onCommandExecute.onToggleOffice?.();
        break;
      case 'enterOfficeFp':
        onCommandExecute.onEnterOfficeFp?.();
        break;
      case 'toggleAnimations':
        onCommandExecute.onToggleAnimations?.();
        break;
      case 'useAgent':
        await onCommandExecute.onUseAgent?.(cmd.payload);
        break;
      case 'agentInfo':
        toast(`${cmd.name}: ${cmd.description}`, 'info', 4000);
        break;
      case 'selectSession':
        await onCommandExecute.onSelectSession?.(cmd.payload);
        break;
      case 'openMcp':
        onCommandExecute.onMCPList?.();
        break;
    }
  } catch (error) {
    console.error('[CommandPalette] Error executing:', error);
  }
}