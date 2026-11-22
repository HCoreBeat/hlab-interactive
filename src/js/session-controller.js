'use strict';

/**
 * Actions on the active session: delete, kill, undo, discard, abort, shell,
 * export and permission replies. Kept apart from the app orchestration.
 */

import {
  state, set, setUI, appendMessage, activeSession, contextFoldersOf, messagesOf,
  isSubagentLive,
} from './store.js';
import {
  api as request, loadHistory, sendPrompt as sendPromptApi, interruptSession,
  setSessionArchived,
} from './api.js';
import { confirmDialog } from './ui/modal.js';
import { forgetSession } from './event-router.js';
import { toast, toastError } from './ui/toast.js';
import { recordPrompt } from './ui/quota.js';
import {
  consumeStagedAttachments, stageAttachments, rememberSent, attachmentsOfMessage,
} from './ui/attachments.js';

export function createSessionController({ selectSession, showTab, reloadSessions, syncSelection }) {
  async function deleteSession(session) {
    const confirmed = await confirmDialog({
      title: 'Eliminar sesión',
      message: `¿Eliminar la sesión "${session.title}"?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!confirmed) return;
    const result = await request('DELETE', `/api/session/${session.id}`);
    if (!result.ok) {
      toastError(result.error, 'No se pudo eliminar la sesión');
      return;
    }
    forgetSession(session.id);
    await reloadSessions();
    if (state.activeSessionId === session.id) {
      const sessions = state.sessions;
      if (sessions.length > 0) await selectSession(sessions[0].id);
      else set({ activeSessionId: null });
    }
    toast('Sesión eliminada', 'success');
  }

  async function killSession() {
    const session = activeSession();
    if (!session) return;
    const confirmed = await confirmDialog({
      title: 'Matar sesión',
      message: `¿Matar la sesión "${session.title}"?`,
      confirmLabel: 'Matar',
      danger: true,
    });
    if (!confirmed) return;
    const result = await request('POST', `/api/session/${session.id}/kill`);
    if (!result.ok) {
      toastError(result.error, 'No se pudo matar la sesión');
      return;
    }
    await reloadSessions();
    toast('Sesión terminada', 'success');
  }

  /**
   * Extra context folders are not part of the opencode session (a session owns
   * a single location), so they are announced in the prompt preamble.
   */
  function contextPreamble(session) {
    const folders = contextFoldersOf(session.id);
    if (folders.length === 0) return '';
    return `[carpetas de contexto adicionales: ${folders.join(' | ')}]\n`;
  }

  async function submitPrompt(text) {
    const attachments = consumeStagedAttachments();
    const images = attachments.filter((file) => file.kind === 'image');
    const session = activeSession();
    if (!session) {
      toast('No hay una sesión activa.', 'warn');
      return false;
    }
    if (text.startsWith('/')) {
      const [name, ...rest] = text.slice(1).split(/\s+/);
      if (!state.commands.some((command) => command.name === name)) {
        toast(`Comando desconocido: /${name}`, 'warn');
        return false;
      }
      const result = await request('POST', `/api/session/${session.id}/command`, {
        body: { name, text: rest.join(' '), files: [] },
      });
      if (!result.ok) {
        toastError(result.error, `No se pudo ejecutar /${name}`);
        return false;
      }
      return true;
    }
    if (text.startsWith('!')) {
      const command = text.slice(1).trim();
      if (!command) return false;
      const result = await request('POST', `/api/session/${session.id}/shell`, { body: { command } });
      if (!result.ok) toast(`No se pudo ejecutar el comando: ${result.error}`, 'error');
      return true;
    }
    if (syncSelection) await syncSelection(session);
    const promptText = text || (images.length > 0 ? 'Revisa la imagen adjunta.' : 'Revisa los archivos adjuntos.');
    // se registran ANTES de enviar: el evento del servidor puede pintar el mensaje antes de que responda la API
    rememberSent(session.id, promptText, attachments);
    const result = await sendPromptApi(session.id, contextPreamble(session) + promptText, attachments);
    if (!result.ok) {
      toastError(result.error, attachments.length > 0
        ? 'No se pudieron enviar los archivos adjuntos'
        : 'No se pudo enviar el mensaje');
      return false;
    }
    const message = result.data?.data;
    recordPrompt({ providerID: state.selection.providerID, modelID: state.selection.modelID });
    if (message?.id) {
      appendMessage(session.id, {
        id: message.id,
        role: 'user',
        type: 'user',
        text: promptText,
        files: attachments.map((file) => ({ uri: file.dataUrl, mime: file.mime, name: file.name })),
        time: message.time?.created || Date.now(),
      });
    }
    return true;
  }

  /** Sends again the last message of the active session. */
  async function retryLast() {
    const session = activeSession();
    if (!session) return;
    const list = messagesOf(session.id).filter((message) => message.type === 'user');
    const last = list[list.length - 1];
    if (!last) {
      toast('No hay ningún mensaje que reintentar.', 'warn');
      return;
    }
    const attachments = attachmentsOfMessage(last, session.id).map((file) => ({
      dataUrl: file.src,
      mime: file.mime || (file.kind === 'image' ? 'image/png' : 'text/plain'),
      name: file.name,
      kind: file.kind,
    })).filter((image) => image.dataUrl.startsWith('data:'));
    if (attachments.length > 0) stageAttachments(attachments);
    await submitPrompt(last.text || '');
  }

  async function abort() {
    const session = activeSession();
    if (!session) return;
    const result = await interruptSession(session.id);
    if (!result.ok) toastError(result.error, 'No se pudo abortar');
  }

  async function undoLastChange() {
    const session = activeSession();
    if (!session) return;
    const result = await request('POST', `/api/session/${session.id}/revert/stage`);
    if (!result.ok) {
      toastError(result.error, 'No se pudo preparar deshacer');
      return;
    }
    const commit = await request('POST', `/api/session/${session.id}/revert/commit`);
    if (!commit.ok) {
      toastError(commit.error, 'No se pudo confirmar deshacer');
      return;
    }
    toast('Último cambio deshecho', 'success');
  }

  async function discardStaged() {
    const session = activeSession();
    if (!session) return;
    const confirmed = await confirmDialog({
      title: 'Descartar cambio',
      message: '¿Descartar el cambio preparado?',
      confirmLabel: 'Descartar',
      danger: true,
    });
    if (!confirmed) return;
    const result = await request('DELETE', `/api/session/${session.id}/revert`);
    if (!result.ok) {
      toastError(result.error, 'No se pudo descartar');
      return;
    }
    toast('Cambio preparado descartado', 'success');
  }

  function clearView() {
    const session = activeSession();
    if (!session) return;
    setUI({ cleared: { ...state.ui.cleared, [session.id]: Date.now() } });
    toast('Vista limpiada', 'success');
  }

  async function shellCommand() {
    const session = activeSession();
    if (!session) return;
    const command = prompt('Comando a ejecutar:');
    if (!command) return;
    const result = await request('POST', `/api/session/${session.id}/shell`, { body: { command } });
    if (!result.ok) toast(`No se pudo ejecutar: ${result.error}`, 'error');
    else showTab('terminal');
  }

  async function exportSession() {
    const session = activeSession();
    if (!session) return;
    const history = await loadHistory(session.id);
    if (!history.ok) {
      toastError(history.error, 'No se pudo exportar');
      return;
    }
    const data = JSON.stringify({ session, messages: history.messages }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${session.id}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Sesión exportada', 'success');
  }

  async function permissionReply(decision) {
    const session = activeSession();
    if (!session) return;
    const permission = state.permissions.find((item) => item.sessionID === session.id);
    if (!permission) return;
    const apiDecision = decision === 'allow' ? 'always' : decision === 'deny' ? 'reject' : 'once';
    const path = `/api/session/${encodeURIComponent(session.id)}/permission/${encodeURIComponent(permission.id)}/reply`;
    const result = await request('POST', path, { body: { decision: apiDecision } });
    if (!result.ok) toastError(result.error, 'No se pudo responder al permiso');
  }

  /**
   * Archives every finished subagent of one root session. It never touches a
   * root, the active session, a busy child or one waiting for a permission.
   */
  async function cleanSubagents(parent) {
    const finished = state.subagents.filter((child) => child.parentID === parent?.id
      && !isSubagentLive(child));
    if (finished.length === 0) {
      toast('No hay subagentes finalizados que limpiar', 'ok', 2500);
      return;
    }
    const confirmed = await confirmDialog({
      title: 'Limpiar subagentes',
      message: `¿Archivar ${finished.length} subagente(s) finalizado(s) de "${parent.title}"? Dejarán de aparecer en la lista y en la oficina, pero podrás recuperarlos desde opencode.`,
      confirmLabel: 'Archivar',
    });
    if (!confirmed) return;
    const ids = new Set(finished.map((child) => child.id));
    let archived = 0;
    for (const child of finished) {
      const result = await setSessionArchived(child.id, true);
      if (result.ok) archived += 1;
    }
    set({ subagents: state.subagents.filter((child) => !ids.has(child.id)) });
    toast(`${archived} subagente(s) archivado(s)`, 'success');
    await reloadSessions();
  }

  return {
    deleteSession,
    cleanSubagents,
    killSession,
    submitPrompt,
    retryLast,
    abort,
    undoLastChange,
    discardStaged,
    clearView,
    shellCommand,
    exportSession,
    permissionReply,
  };
}
