import {
  subscribe, state, activeSession, otherProjectWork, primaryAgents, subagentAgents,
} from '../store.js';
import { clear, el } from '../util/dom.js';
import { basename, truncate } from '../util/format.js';
import { uiIcon } from '../util/ui-icons.js';
import { variantOf, variantLabel } from '../model-prefs.js';

export function mountTopbar(handlers) {
  const status = document.getElementById('server-status');
  const dot = status.querySelector('.dot');
  const text = status.querySelector('.server-text');
  const projectChip = document.getElementById('project-chip');
  const projectMenu = document.getElementById('project-menu');
  const projectSwitcher = document.getElementById('project-switcher');
  const workMark = el('span', { class: 'project-work-mark', hidden: true, title: '' }, [
    el('span', { class: 'project-work-dot' }),
    el('span', { class: 'project-work-count', text: '0' }),
  ]);
  projectChip.insertBefore(workMark, projectChip.querySelector('.project-chevron'));
  const agentPicker = document.getElementById('agent-picker');
  const agentButton = document.getElementById('agent-select');
  const agentValue = document.getElementById('agent-select-value');
  const agentMenu = document.getElementById('agent-menu');
  const agentSearch = document.getElementById('agent-menu-search');
  const agentMenuList = document.getElementById('agent-menu-list');
  const modelSelect = document.getElementById('model-select');

  document.getElementById('server-restart').addEventListener('click', () => handlers.onRestartServer());
  document.getElementById('settings-btn').addEventListener('click', () => handlers.onOpenSettings());
  document.getElementById('theme-btn').addEventListener('click', () => handlers.onToggleTheme());
  document.getElementById('undo-btn').addEventListener('click', () => handlers.onUndo());
  document.getElementById('palette-btn')?.addEventListener('click', () => handlers.onOpenPalette?.());
  projectChip.addEventListener('click', () => {
    const open = projectMenu.hidden;
    projectMenu.hidden = !open;
    projectChip.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', (event) => {
    if (!projectSwitcher.contains(event.target)) closeProjectMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !projectMenu.hidden) {
      closeProjectMenu();
      projectChip.focus();
    }
  });

  function closeProjectMenu() {
    projectMenu.hidden = true;
    projectChip.setAttribute('aria-expanded', 'false');
  }

  function closeAgentMenu() {
    agentMenu.hidden = true;
    agentButton.setAttribute('aria-expanded', 'false');
  }

  agentButton.addEventListener('click', () => {
    const open = agentMenu.hidden;
    agentMenu.hidden = !open;
    agentButton.setAttribute('aria-expanded', String(open));
    if (open) {
      agentSearch.value = '';
      filterAgentItems();
      agentSearch.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!agentPicker.contains(event.target)) closeAgentMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !agentMenu.hidden) {
      closeAgentMenu();
      agentButton.focus();
    }
  });
  agentSearch.addEventListener('input', filterAgentItems);
  agentSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const first = [...agentMenuList.querySelectorAll('.agent-menu-item:not(.is-disabled)')]
      .find((item) => !item.hidden);
    first?.click();
  });

  modelSelect.addEventListener('click', () => handlers.onModelSelect?.());

  function renderStatus() {
    const { server, sse, ui } = state;
    let cls = 'warn';
    let label = server.message || 'Sin conexión';

    if (server.state === 'ready') {
      if (server.demo) { cls = 'ok'; label = 'Modo demo'; }
      else if (sse.state === 'open') { cls = 'ok'; label = server.version ? `OpenCode ${server.version}` : 'OpenCode listo'; }
      else if (sse.state === 'reconnecting') { cls = 'warn'; label = `Reconectando… (${sse.attempt})`; }
      else { cls = 'warn'; label = 'Servidor listo · sin eventos'; }
    } else if (server.state === 'starting' || ui.connecting) {
      cls = 'busy';
      label = 'Iniciando servidor…';
    } else if (server.state === 'error') {
      cls = 'err';
      label = truncate(server.message || 'Error del servidor', 44);
    } else {
      cls = 'warn';
      label = 'Servidor detenido';
    }

    dot.className = `dot ${cls}`;
    text.textContent = label;
    status.title = `${server.url || ''}\n${server.message || ''}`.trim();
  }

  let projectSig = '';

  function renderProject() {
    const work = otherProjectWork();
    // `runtime` cambia con cada token: solo reconstruimos el menú cuando cambia
    // algo que realmente pinte (proyecto, recientes o trabajo en segundo plano).
    const sig = JSON.stringify([
      state.project.dir, state.settings.recentProjects,
      work.projects.map((item) => [item.dir, item.busy, item.waiting]),
    ]);
    if (sig === projectSig) return;
    projectSig = sig;

    const name = state.project.dir ? basename(state.project.dir) : 'Sin proyecto';
    document.getElementById('project-chip-name').textContent = name;

    const total = work.busy + work.waiting;
    workMark.hidden = total === 0;
    projectChip.classList.toggle('has-work', total > 0);
    if (total > 0) {
      workMark.querySelector('.project-work-count').textContent = String(work.busy || total);
      const detail = work.projects
        .map((item) => `${item.name}: ${item.busy} trabajando${item.waiting ? `, ${item.waiting} esperando` : ''}`)
        .join('\n');
      workMark.title = `Trabajo en otros proyectos (no se detiene al cambiar de carpeta)\n${detail}`;
      projectChip.title = `${state.project.dir || 'Elegir carpeta de proyecto'}\n${work.projects.length} proyecto(s) trabajando en segundo plano`;
    } else {
      projectChip.title = state.project.dir || 'Elegir carpeta de proyecto';
    }
    clear(projectMenu);

    projectMenu.appendChild(el('div', { class: 'project-menu-heading', text: 'Cambiar de proyecto' }));
    const recentProjects = (state.settings.recentProjects || []).slice(0, 8);
    if (recentProjects.length === 0) {
      projectMenu.appendChild(el('div', { class: 'project-menu-empty', text: 'Tus proyectos recientes aparecerán aquí.' }));
    }
    const working = new Map(work.projects.map((item) => [item.dir, item]));
    for (const project of recentProjects) {
      const current = project.directory === state.project.dir;
      const activeWork = working.get(project.directory);
      const button = el('button', {
        class: `project-menu-item ${current ? 'is-current' : ''} ${activeWork ? 'has-work' : ''}`,
        type: 'button',
        role: 'menuitem',
        title: activeWork
          ? `${project.directory}\n${activeWork.busy} sesión(es) trabajando, ${activeWork.waiting} esperando`
          : project.directory,
        onClick: () => {
          closeProjectMenu();
          if (!current) handlers.onOpenProject(project.directory);
        },
      }, [
        uiIcon('folder', 17),
        el('span', { class: 'project-menu-copy' }, [
          el('span', { class: 'project-menu-name', text: basename(project.directory) }),
          el('span', { class: 'project-menu-path', text: project.directory }),
        ]),
        activeWork
          ? el('span', { class: 'project-work-mark' }, [
            el('span', { class: 'project-work-dot' }),
            el('span', { class: 'project-work-count', text: String(activeWork.busy || activeWork.waiting) }),
          ])
          : null,
        current ? el('span', { class: 'project-current-mark', text: 'Actual' }) : null,
      ]);
      projectMenu.appendChild(button);
    }

    projectMenu.appendChild(el('div', { class: 'project-menu-divider' }));
    projectMenu.appendChild(el('button', {
      class: 'project-menu-open',
      type: 'button',
      role: 'menuitem',
      onClick: () => {
        closeProjectMenu();
        handlers.onOpenProject();
      },
    }, [uiIcon('folder', 16), el('span', { text: 'Abrir otro proyecto…' })]));
  }

  let agentSig = '';

  function filterAgentItems() {
    const query = agentSearch.value.trim().toLowerCase();
    for (const item of agentMenuList.querySelectorAll('.agent-menu-item')) {
      item.hidden = query ? !item.textContent.toLowerCase().includes(query) : false;
    }
    for (const section of agentMenuList.querySelectorAll('.agent-menu-section')) {
      const visible = [...section.querySelectorAll('.agent-menu-item')].some((item) => !item.hidden);
      section.hidden = !visible;
    }
  }

  function agentSection(label, agents, current, disabled = false) {
    const section = el('div', { class: 'agent-menu-section' }, [
      el('h4', { text: label }),
    ]);
    for (const agent of agents) {
      const selected = agent.id === current;
      const item = el('button', {
        class: `agent-menu-item ${disabled ? 'is-disabled' : ''} ${selected ? 'is-selected' : ''}`.trim(),
        type: 'button',
        role: 'option',
        'data-agent-id': agent.id,
        'aria-selected': String(selected),
        disabled: disabled || undefined,
        title: disabled
          ? `${agent.description || 'Subagente'} — solo para sesiones hijas`
          : (agent.description || ''),
      }, [
        el('span', { class: 'agent-menu-name', text: agent.name || agent.id }),
        agent.id ? el('span', { class: 'agent-menu-id', text: agent.id }) : null,
        selected ? el('span', { class: 'agent-menu-check', text: '✓' }) : null,
      ]);
      if (!disabled) {
        item.addEventListener('click', () => {
          closeAgentMenu();
          handlers.onSelectAgent?.(agent.id);
        });
      }
      section.appendChild(item);
    }
    return section;
  }

  function renderAgents() {
    const session = activeSession();
    const current = state.selection.agent || session?.agent || 'build';
    const agents = primaryAgents();
    const children = subagentAgents();
    const sig = JSON.stringify([
      current,
      agents.map((agent) => [agent.id, agent.name, agent.description]),
      children.map((agent) => [agent.id, agent.name]),
    ]);
    // `runtime` cambia en cada token: solo reconstruimos el menú si cambia el
    // catálogo o la selección, para no perder la búsqueda mientras está abierto.
    if (sig === agentSig) return;
    agentSig = sig;

    const all = [...agents, ...children];
    const currentAgent = all.find((agent) => agent.id === current);
    agentValue.textContent = currentAgent?.name || current;
    agentButton.title = currentAgent?.description || 'Agente';

    clear(agentMenuList);
    if (agents.length === 0) {
      agentMenuList.appendChild(el('div', { class: 'agent-menu-empty', text: 'No hay agentes disponibles.' }));
      agentButton.disabled = true;
      return;
    }
    agentButton.disabled = false;
    agentMenuList.appendChild(agentSection('Principales', agents, current));
    if (children.length > 0) {
      agentMenuList.appendChild(agentSection('Subagentes', children, current, true));
    }
    filterAgentItems();
    if (!agents.some((agent) => agent.id === current)) {
      handlers.onSelectAgent?.(agents[0].id);
    }
  }

  function renderModels() {
    const session = activeSession();
    const currentModel = state.selection.modelID
      ? { providerID: state.selection.providerID, modelID: state.selection.modelID }
      : session?.model
        ? { providerID: session.model.providerID, modelID: session.model.id }
        : null;

    clear(modelSelect);
    if (state.models.length === 0) {
      modelSelect.append(el('span', { text: 'Modelo' }), el('span', { class: 'model-select-value', text: 'Sin modelos' }), el('span', { class: 'model-select-chevron', text: '▾' }));
      modelSelect.disabled = true;
      return;
    }
    const models = state.models.filter((model) => model.enabled !== false);
    if (models.length === 0) {
      modelSelect.append(el('span', { text: 'Modelo' }), el('span', { class: 'model-select-value', text: 'Sin modelos activos' }), el('span', { class: 'model-select-chevron', text: '▾' }));
      modelSelect.disabled = true;
      return;
    }
    modelSelect.disabled = false;
    const selected = models.find((model) => currentModel
      && (model.providerID || 'opencode') === currentModel.providerID
      && (model.modelID === currentModel.modelID || model.id === currentModel.modelID)) || models[0];
    const provider = selected.providerID || 'opencode';
    modelSelect.title = `${provider} / ${selected.modelID}`;
    modelSelect.setAttribute('aria-label', `Modelo actual: ${selected.name || selected.modelID}. Abrir selector de modelos.`);
    const effortName = session ? variantOf(session.id) : '';
    const effortSuffix = effortName ? ` · ${variantLabel(effortName).toLowerCase()}` : '';
    modelSelect.append(
      el('span', { text: 'Modelo' }),
      el('span', { class: 'model-select-value', text: `${provider} · ${selected.name || selected.modelID}${effortSuffix}` }),
      el('span', { class: 'model-select-chevron', text: '▾' }),
    );
  }

  function render() {
    renderStatus();
    renderProject();
    renderModels();
    renderAgents();
  }

  subscribe([
    'server', 'sse', 'project', 'agents', 'models', 'selection', 'sessions',
    'activeSessionId', 'ui', 'runtime', 'subagents', 'permissions', 'questions', 'projects',
  ], render);
  render();
  return { render };
}
