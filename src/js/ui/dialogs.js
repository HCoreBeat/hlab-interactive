'use strict';

/**
 * Modal pickers built with plain DOM (no innerHTML with external data):
 * switch session, pick a model, pick an agent and read the server logs.
 */

import { el } from '../util/dom.js';
import { state, set, activeSession, patchSession, primaryAgents, subagentAgents } from '../store.js';
import { pinModel, variantOf, variantsOf, variantLabel } from '../model-prefs.js';
import { request } from '../api.js';
import { toast } from './toast.js';
import { openModal } from './modal.js';
import { uiIcon } from '../util/ui-icons.js';

function openList({ title, items, onPick }) {
  const modal = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal' }, [
      el('div', { class: 'modal-header' }, [el('h3', { text: title })]),
      el('div', { class: 'modal-body' }, items.map((item) => el('button', {
        class: item.className || 'session-switch-btn',
        type: 'button',
        title: item.title || item.label,
        text: item.label,
        disabled: Boolean(item.disabled),
        onClick: () => {
          modal.remove();
          onPick(item);
        },
      }))),
    ]),
  ]);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });
  document.getElementById('modal-root').appendChild(modal);
  return modal;
}

export function openSessionSwitch(onSelect) {
  const sessions = state.sessions.filter((item) => item.id !== state.activeSessionId);
  if (sessions.length === 0) {
    toast('No hay otras sesiones', 'warn');
    return;
  }
  openList({
    title: 'Cambiar sesión',
    items: sessions.map((session) => ({ label: session.title || session.id, value: session.id })),
    onPick: (item) => onSelect(item.value),
  });
}

export function openModelPicker() {
  const session = activeSession();
  if (!session) return;
  const enabled = state.models.filter((model) => model.enabled !== false);
  if (enabled.length === 0) {
    toast('No hay modelos disponibles', 'warn');
    return;
  }
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Buscar por modelo o proveedor…',
    'aria-label': 'Buscar modelos por nombre o proveedor',
  });
  const search = el('label', { class: 'model-picker-search' }, [
    uiIcon('search', 17),
    searchInput,
  ]);
  const list = el('div', { class: 'model-picker-list', role: 'listbox' });
  let selectedModel = enabled.find((model) => model.providerID === session.model?.providerID
    && (model.id === session.model?.id || model.modelID === session.model?.id)) || enabled[0];
  const expandedProviders = new Set([selectedModel.providerID || 'opencode']);

  function contextLabel(model) {
    const limit = Number(model.limit?.context || model.limit?.input || 0);
    return limit ? `${new Intl.NumberFormat('es').format(limit)} tokens de contexto` : 'Contexto no indicado';
  }

  function costLabel(model) {
    const cost = model.cost?.[0] || model.cost;
    if (!cost || (!Number.isFinite(cost.input) && !Number.isFinite(cost.output))) return 'Costo no indicado';
    return `Entrada ${cost.input ?? 0} · salida ${cost.output ?? 0} USD / millón de tokens`;
  }

  async function choose(model, variant) {
    // sin `variant` se conserva el esfuerzo guardado si es el mismo modelo, si no, Auto
    const same = session.model?.providerID === model.providerID && (session.model?.id === model.id || session.model?.id === model.modelID);
    const effort = variant !== undefined ? variant : (same ? variantOf(session.id) : '');
    const base = { id: model.id, providerID: model.providerID };
    let result = await request('POST', `/api/session/${session.id}/model`, {
      body: { model: effort ? { ...base, variant: effort } : base },
    });
    let applied = Boolean(effort);
    if (!result.ok && effort) {
      // el servidor no acepta `variant`: se cambia solo el modelo y el esfuerzo queda guardado en la app
      result = await request('POST', `/api/session/${session.id}/model`, { body: { model: base } });
      applied = false;
    }
    if (!result.ok) {
      toast(`No se pudo cambiar el modelo: ${result.error}`, 'error');
      return;
    }
    pinModel(session.id, { providerID: model.providerID, modelID: model.modelID, variant: effort });
    patchSession(session.id, { model: { ...base, ...(effort ? { variant: effort } : {}) } });
    set({ selection: { ...state.selection, modelID: model.modelID, providerID: model.providerID } });
    toast(effort ? `Modelo cambiado · esfuerzo ${variantLabel(effort).toLowerCase()}${applied ? '' : ' (guardado en la app)'}` : 'Modelo cambiado', 'success');
    modal.close();
  }

  function renderModels() {
    const term = searchInput.value.trim().toLocaleLowerCase();
    const matches = enabled.filter((model) => [model.name, model.modelID, model.id, model.providerID, model.family]
      .some((value) => String(value || '').toLocaleLowerCase().includes(term)));
    list.replaceChildren();
    if (matches.length === 0) {
      list.appendChild(el('div', { class: 'empty-state', text: 'No hay modelos que coincidan con la búsqueda.' }));
      return;
    }
    const providers = new Map();
    matches.forEach((model) => {
      const provider = model.providerID || 'opencode';
      if (!providers.has(provider)) providers.set(provider, []);
      providers.get(provider).push(model);
    });

    for (const [provider, models] of providers) {
      const group = el('details', {
        class: 'model-provider-group',
        open: Boolean(term) || expandedProviders.has(provider),
      });
      const heading = el('summary', { class: 'model-provider-heading' }, [
        el('span', { class: 'model-provider-chevron', 'aria-hidden': 'true' }, [uiIcon('chevron', 14)]),
        el('strong', { text: provider }),
        el('span', { class: 'model-provider-count', text: String(models.length) }),
      ]);
      group.addEventListener('toggle', () => {
        if (searchInput.value.trim()) return;
        if (group.open) expandedProviders.add(provider);
        else expandedProviders.delete(provider);
      });
      group.appendChild(heading);

      const rows = el('div', { class: 'model-provider-models', role: 'listbox', 'aria-label': `Modelos de ${provider}` });
      models.forEach((model) => {
        const capabilities = model.capabilities || {};
        const modalities = [...(capabilities.input || []), ...(capabilities.output || [])];
        const metadata = [
          contextLabel(model),
          costLabel(model),
          capabilities.tools ? 'Herramientas' : '',
          ...modalities,
        ].filter(Boolean);
        const effort = variantsOf(model);
        const isCurrentModel = session.model?.providerID === model.providerID
          && (session.model?.id === model.id || session.model?.id === model.modelID);
        const currentEffort = isCurrentModel ? variantOf(session.id) : '';
        const row = el('div', { class: 'model-picker-row' });
        row.appendChild(el('button', {
          class: `model-picker-item ${selectedModel === model ? 'is-current' : ''}`,
          type: 'button',
          role: 'option',
          'aria-selected': String(selectedModel === model),
          onClick: () => { selectedModel = model; choose(model); },
        }, [
          el('span', { class: 'model-picker-icon' }, [uiIcon('spark', 17)]),
          el('span', { class: 'model-picker-copy' }, [
            el('strong', { text: model.name || model.modelID }),
            el('span', { class: 'model-picker-id', text: model.modelID }),
            el('span', { class: 'model-picker-meta', text: metadata.join(' · ') }),
          ]),
          selectedModel === model ? uiIcon('check', 16) : null,
        ]));
        if (effort.names.length > 0) {
          // esfuerzo de razonamiento: solo en los modelos que lo permiten
          row.appendChild(el('div', {
            class: 'model-effort', role: 'group', 'aria-label': `Esfuerzo de razonamiento de ${model.name || model.modelID}`,
            title: effort.declared ? 'Esfuerzo de razonamiento' : 'Esfuerzo de razonamiento (el modelo razona; si el servidor no lo acepta se guarda solo en la app)',
          }, [
            el('span', { class: 'model-effort-label', text: 'Esfuerzo' }),
            ...['', ...effort.names].map((name) => el('button', {
              class: `model-effort-chip${isCurrentModel && currentEffort === name ? ' is-on' : ''}`,
              type: 'button',
              text: variantLabel(name),
              onClick: () => { selectedModel = model; choose(model, name); },
            })),
          ]));
        }
        rows.appendChild(row);
      });
      group.appendChild(rows);
      list.appendChild(group);
    }
  }

  searchInput.addEventListener('input', renderModels);
  const modal = openModal({
    title: 'Seleccionar modelo',
    body: [search, list],
    width: 'min(720px, 100%)',
    className: 'model-picker-modal',
  });
  renderModels();
  searchInput.focus();
}

export function openAgentPicker() {
  const session = activeSession();
  const agents = primaryAgents().filter((agent) => agent.enabled !== false);
  const children = subagentAgents();
  if (agents.length === 0) {
    toast('No hay agentes principales disponibles', 'warn');
    return;
  }
  const items = [
    ...agents.map((agent) => ({
      label: `Principal · ${agent.name || agent.id}`,
      value: agent.id,
      title: agent.description || 'Agente principal',
    })),
    ...children.map((agent) => ({
      label: `Subagente · ${agent.name || agent.id}`,
      value: agent.id,
      title: `${agent.description || 'Subagente'} — solo se usa en sesiones hijas`,
      className: 'session-switch-btn is-subagent-pick',
      disabled: true,
    })),
  ];
  openList({
    title: 'Seleccionar agente',
    items,
    onPick: async (item) => {
      set({ selection: { ...state.selection, agent: item.value } });
      if (!session) {
        toast(`Agente para la próxima sesión: ${item.value}`, 'success');
        return;
      }
      const result = await request('POST', `/api/session/${session.id}/agent`, { body: { agent: item.value } });
      if (!result.ok) {
        toast(`No se pudo cambiar el agente: ${result.error}`, 'error');
        return;
      }
      patchSession(session.id, { agent: item.value });
      toast('Agente cambiado', 'success');
    },
  });
}

export function openLogsWindow() {
  const logs = state.server.logs || [];
  if (logs.length === 0) {
    toast('No hay logs disponibles', 'warn');
    return;
  }
  const body = el('div', {
    style: {
      maxHeight: '60vh', overflow: 'auto', fontFamily: 'monospace',
      fontSize: '12px', whiteSpace: 'pre-wrap',
    },
  }, logs.map((line) => el('div', { text: line })));
  const modal = el('div', { class: 'modal-backdrop' }, [
    el('div', { class: 'modal', style: { maxWidth: '800px', maxHeight: '80vh' } }, [
      el('div', { class: 'modal-header' }, [el('h3', { text: 'Logs del servidor' })]),
      el('div', { class: 'modal-body' }, [body]),
    ]),
  ]);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.remove();
  });
  document.getElementById('modal-root').appendChild(modal);
}
