'use strict';

/**
 * MCP panel.
 *
 * The server exposes the configured servers through `GET /api/config` and the
 * live status through `GET /api/mcp`; `loadMcpServers()` merges both and the
 * result lives in `state.mcpServers`. Connecting and disconnecting uses the
 * experimental endpoints of opencode v2.
 */

import { el } from '../util/dom.js';
import { subscribe, set, mcpServers } from '../store.js';
import { loadMcpServers, setMcpConnection } from '../api.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { uiIcon } from '../util/ui-icons.js';

const STATUS_LABEL = {
  connected: 'conectado',
  ready: 'conectado',
  connecting: 'conectando',
  pending: 'iniciando',
  configured: 'configurado',
  disabled: 'desactivado',
  disconnected: 'desconectado',
  failed: 'error',
  needs_auth: 'necesita autenticación',
  unknown: 'desconocido',
};

const STATUS_CLASS = {
  connected: 'connected',
  ready: 'connected',
  connecting: 'connecting',
  pending: 'connecting',
  configured: 'configured',
  disabled: 'disabled',
  disconnected: 'disconnected',
  failed: 'error',
  needs_auth: 'error',
  unknown: 'unknown',
};

export function mountMCPanel(container, handlers) {
  if (!container) container = document.getElementById('panel-body');
  const busy = new Set();

  function render() {
    container.replaceChildren();
    const servers = mcpServers();

    container.appendChild(el('div', { class: 'context-head' }, [
      el('h3', { text: 'Servidores MCP' }),
      el('p', { class: 'muted tiny', text: 'Configurados en opencode. La zona MCP de la oficina muestra los que están activos.' }),
    ]));

    if (servers.length === 0) {
      container.appendChild(el('div', { class: 'empty-state' }, [
        uiIcon('mcp', 24),
        el('div', { text: 'No hay servidores MCP configurados' }),
        el('button', { class: 'btn-small', type: 'button', text: 'Abrir ajustes', onClick: () => handlers.onOpenSettings?.() }),
      ]));
      return;
    }

    const grid = el('div', { class: 'mcp-grid' });
    for (const server of servers) {
      grid.appendChild(serverCard(server));
    }
    container.appendChild(grid);

    container.appendChild(el('div', { class: 'mcp-footer' }, [
      el('button', { class: 'btn-small', type: 'button', text: 'Actualizar', onClick: () => refreshServers() }),
      el('button', { class: 'btn-small', type: 'button', text: '⚙ Configurar', onClick: () => handlers.onOpenSettings?.() }),
    ]));
  }

  function serverCard(server) {
    const status = server.status || 'unknown';
    const connected = status === 'connected' || status === 'ready';
    const isBusy = busy.has(server.id);
    return el('div', { class: `mcp-server-card ${STATUS_CLASS[status] || 'unknown'}` }, [
      el('div', { class: 'mcp-server-header' }, [
        el('span', { class: 'mcp-server-name', text: server.name || server.id }),
        el('span', { class: `mcp-status-badge ${STATUS_CLASS[status] || 'unknown'}`, text: STATUS_LABEL[status] || status }),
      ]),
      el('div', { class: 'mcp-server-meta' }, [
        el('span', { text: server.type || 'local' }),
        el('span', { text: server.disabled ? 'desactivado' : 'activo' }),
        el('span', { text: server.command ? 'configurado' : 'sin comando' }),
      ]),
      server.command
        ? el('div', { class: 'mcp-server-command', title: server.command, text: server.command })
        : null,
      server.error ? el('div', { class: 'mcp-error', text: server.error }) : null,
      el('div', { class: 'mcp-server-actions' }, [
        el('button', {
          class: 'btn-small',
          type: 'button',
          disabled: isBusy || server.disabled,
          text: isBusy ? '…' : connected ? 'Desconectar' : 'Conectar',
          onClick: () => toggle(server, !connected),
        }),
        el('button', { class: 'btn-small', type: 'button', text: 'Detalles', onClick: () => showDetails(server) }),
      ]),
    ]);
  }

  async function refreshServers() {
    try {
      const servers = await loadMcpServers();
      set({ mcpServers: servers });
    } catch (error) {
      toast(`No se pudieron leer los servidores MCP: ${error.message}`, 'error');
    }
  }

  async function toggle(server, connect) {
    if (busy.has(server.id)) return;
    busy.add(server.id);
    render();
    const result = await setMcpConnection(server.name || server.id, connect);
    busy.delete(server.id);
    if (!result.ok) {
      toast(`No se pudo ${connect ? 'conectar' : 'desconectar'}: ${result.error}`, 'error');
    } else {
      toast(`${server.name}: ${connect ? 'conectando' : 'desconectado'}`, 'success');
    }
    await refreshServers();
  }

  function showDetails(server) {
    const body = el('div', { class: 'detail-section' }, [
      el('p', { text: `Estado: ${STATUS_LABEL[server.status] || server.status || 'desconocido'}` }),
      el('p', { text: `Tipo: ${server.type || 'local'}` }),
      el('p', { text: `Desactivado: ${server.disabled ? 'sí' : 'no'}` }),
      server.command ? el('pre', { text: server.command }) : null,
      server.error ? el('div', { class: 'mcp-error', text: server.error }) : null,
    ]);
    openModal({ title: `MCP · ${server.name || server.id}`, body, width: '560px' });
  }

  const unsubscribe = subscribe(['mcpServers'], render);
  render();
  refreshServers();

  return {
    destroy() {
      unsubscribe();
    },
    refresh: refreshServers,
  };
}
