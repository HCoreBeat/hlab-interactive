import { el, clear } from '../util/dom.js';
import { subscribe, state, sessionById, permissionsOf, activeSession } from '../store.js';
import { renderDiff } from './diff.js';
import { toast } from './toast.js';

/**
 * Approval stack for `permission.asked`.
 *
 * Decisions map 1:1 with the API: once | always | reject. The stack lives
 * outside the panels so it is visible no matter which tab is open.
 */
export function mountPermissions() {
  const root = document.getElementById('permission-root');
  const busy = new Set();
  const failed = new Map();

  async function reply(permission, decision) {
    if (busy.has(permission.id)) return;
    busy.add(permission.id);
    failed.delete(permission.id);
    render();

    if (!/^per/i.test(String(permission.id || ''))) {
      busy.delete(permission.id);
      failed.set(permission.id, 'El servidor no proporcionó un identificador de permiso válido.');
      toast('Permiso no enviado: identificador no válido.', 'error');
      render();
      return;
    }

    const path = `/api/session/${encodeURIComponent(permission.sessionID)}/permission/${encodeURIComponent(permission.id)}/reply`;
    const result = await window.oc.request('POST', path, { body: { decision } });
    busy.delete(permission.id);

    if (!result.ok) {
      failed.set(permission.id, result.error || 'No se pudo responder al permiso.');
      toast(`Permiso no enviado: ${result.error}`, 'error');
      render();
      return;
    }

    if (decision === 'reject') toast('Permiso rechazado. El agente recibirá el aviso.', 'warn', 4000);
    // The `permission.replied` event removes the card; re-render in case it lags.
    render();
  }

  function card(permission) {
    const isBusy = busy.has(permission.id);
    const error = failed.get(permission.id);
    const files = permission.metadata?.files || [];
    const session = sessionById(permission.sessionID);
    const resources = permission.resources || [];

    const body = el('div', { class: 'body' }, [
      el('div', { class: 'muted tiny' }, [
        el('span', { text: session ? session.title || 'Sesión' : 'Sesión' }),
        permission.source?.type ? el('span', { text: ` · ${permission.source.type}` }) : null,
      ]),
      resources.length > 0
        ? el('div', { class: 'resource', text: resources.join('\n') })
        : null,
      permission.message ? el('div', { class: 'muted tiny', text: permission.message }) : null,
    ]);

    if (files.length > 0) {
      const details = el('details', {});
      details.appendChild(el('summary', {
        class: 'muted tiny',
        text: files.length === 1 ? `Ver diff de ${files[0].file}` : `Ver diffs (${files.length} archivos)`,
      }));
      for (const file of files.slice(0, 4)) {
        details.appendChild(el('div', { class: 'muted tiny', style: { marginTop: '6px' }, text: file.file }));
        details.appendChild(renderDiff(file.patch || '', {}));
      }
      body.appendChild(details);
    }

    if (error) body.appendChild(el('div', { class: 'chip err', text: error }));

    const footer = el('footer', {}, [
      el('button', {
        class: 'allow',
        type: 'button',
        disabled: isBusy,
        text: isBusy ? 'Enviando…' : 'Permitir una vez',
        onClick: () => reply(permission, 'once'),
      }),
      el('button', {
        class: 'always',
        type: 'button',
        disabled: isBusy,
        text: 'Permitir siempre',
        onClick: () => reply(permission, 'always'),
      }),
      el('button', {
        class: 'reject',
        type: 'button',
        disabled: isBusy,
        text: 'Rechazar',
        onClick: () => reply(permission, 'reject'),
      }),
    ]);

    return el('section', { class: 'permission-card', 'data-id': permission.id, role: 'alertdialog' }, [
      el('header', {}, [
        el('span', { text: '✋' }),
        el('strong', { text: `Permiso para ${permission.action || 'continuar'}` }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted tiny', text: permission.id.slice(-6) }),
      ]),
      body,
      footer,
    ]);
  }

  function render() {
    clear(root);
    const pending = permissionsOf(activeSession()?.id);
    root.hidden = pending.length === 0;
    for (const permission of pending) root.appendChild(card(permission));
  }

  const unsubscribe = subscribe(['permissions', 'questions', 'sessions', 'activeSessionId'], render);
  render();
  return { destroy: unsubscribe, render };
}
