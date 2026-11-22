'use strict';

/**
 * Asistente de instalación: comprueba Node, npm, git y opencode, instala lo que
 * falta (pidiendo permiso antes de cada comando) mostrando la salida como una
 * terminal, y avisa cuando hay una versión nueva de opencode.
 */

import { el, clear } from '../util/dom.js';
import { openModal, confirmDialog } from './modal.js';
import { toast } from './toast.js';

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DISMISS_KEY = 'ocv.updateDismissed';
let active = null;

function statusIcon(item) {
  if (item.found) return '✓';
  return item.required ? '✕' : '–';
}

export function openSetupDialog({ onRestartServer, autoInstall = null } = {}) {
  if (active) return active;
  let report = null;
  let busy = false;

  const list = el('div', { class: 'setup-list' });
  const term = el('pre', { class: 'setup-terminal', 'aria-live': 'polite', text: 'Comprobando el entorno…\n' });
  const summary = el('div', { class: 'setup-summary' });
  const installAllBtn = el('button', { class: 'btn-primary', type: 'button', text: 'Instalar lo que falta' });
  const recheckBtn = el('button', { class: 'btn-small', type: 'button', text: 'Verificar de nuevo' });
  const restartBtn = el('button', { class: 'btn-small', type: 'button', text: 'Reiniciar servidor', hidden: 'true' });
  const cancelBtn = el('button', { class: 'btn-small', type: 'button', text: 'Cancelar instalación', hidden: 'true' });

  function write(text) {
    term.textContent += String(text).replace(ANSI, '');
    term.scrollTop = term.scrollHeight;
  }

  const offOutput = window.oc.setup.onOutput((payload) => write(payload.text));

  function setBusy(value) {
    busy = value;
    installAllBtn.disabled = value;
    recheckBtn.disabled = value;
    cancelBtn.hidden = !value;
    list.querySelectorAll('button').forEach((button) => { button.disabled = value; });
  }

  async function installOne(id) {
    setBusy(true);
    const result = await window.oc.setup.install(id);
    setBusy(false);
    if (result.cancelled) write('\nInstalación cancelada: no se concedió permiso.\n');
    else if (result.error && !result.code) write(`\n${result.error}\n`);
    return result;
  }

  async function installMissing() {
    if (!report) return;
    const queue = [];
    const byId = Object.fromEntries(report.items.map((item) => [item.id, item]));
    if (!byId.node.found && byId.node.canInstall) queue.push('node');
    if (!byId.opencode.found) queue.push('opencode');
    if (queue.length === 0) {
      write('\nNo hay nada obligatorio que instalar.\n');
      return;
    }
    for (const id of queue) {
      const result = await installOne(id);
      if (!result.ok) break;
      if (result.needsRestart) {
        write('\nSe instaló una dependencia que cambia el PATH. Reinicia la app y vuelve a abrir este asistente.\n');
        break;
      }
    }
    await refresh();
  }

  function render() {
    clear(list);
    if (!report) return;
    for (const item of report.items) {
      const needsUpdate = item.id === 'opencode' && report.opencode.updateAvailable;
      const state = item.found ? 'ok' : item.required ? 'missing' : 'optional';
      let action = null;
      if (!item.found && item.canInstall) {
        action = el('button', { class: 'btn-small', type: 'button', text: 'Instalar', onClick: async () => { await installOne(item.id); await refresh(); } });
      } else if (needsUpdate) {
        action = el('button', { class: 'btn-primary', type: 'button', text: 'Actualizar', onClick: async () => { await installOne('opencode-update'); await refresh(); } });
      } else if (!item.found && !item.canInstall && item.id !== 'npm') {
        action = el('span', { class: 'muted tiny', text: 'Instálalo manualmente' });
      }
      list.appendChild(el('div', { class: `setup-row is-${state}` }, [
        el('span', { class: 'setup-status', text: statusIcon(item) }),
        el('div', { class: 'setup-info' }, [
          el('strong', { text: item.label }),
          el('span', { class: 'muted tiny', text: item.why }),
          item.command && !item.found ? el('code', { class: 'setup-cmd', text: item.command }) : null,
        ].filter(Boolean)),
        el('div', { class: 'setup-version' }, [
          el('span', { text: item.found ? `v${item.version || '?'}` : item.required ? 'No instalado' : 'No encontrado' }),
          needsUpdate ? el('span', { class: 'setup-update', text: `Nueva: v${report.opencode.latest}` }) : null,
        ].filter(Boolean)),
        el('div', { class: 'setup-action' }, action ? [action] : []),
      ]));
    }
    const missingRequired = report.items.filter((item) => item.required && !item.found);
    summary.textContent = report.ready
      ? (report.opencode.updateAvailable
        ? `Todo instalado. Hay una actualización de opencode (v${report.opencode.version} → v${report.opencode.latest}).`
        : 'Todo listo: las dependencias necesarias están instaladas y opencode está al día.')
      : `Falta${missingRequired.length > 1 ? 'n' : ''}: ${missingRequired.map((item) => item.label).join(', ')}.`;
    summary.className = `setup-summary ${report.ready ? 'is-ok' : 'is-warn'}`;
    restartBtn.hidden = !(report.ready);
    installAllBtn.hidden = report.ready;
  }

  async function refresh() {
    write('\nVerificando dependencias y versiones…\n');
    setBusy(true);
    try {
      report = await window.oc.setup.check();
      write(report.ready ? 'Verificación completada.\n' : 'Faltan componentes obligatorios.\n');
    } catch (error) {
      write(`No se pudo verificar: ${error.message}\n`);
    }
    setBusy(false);
    render();
    return report;
  }

  installAllBtn.addEventListener('click', installMissing);
  recheckBtn.addEventListener('click', refresh);
  cancelBtn.addEventListener('click', () => { window.oc.setup.cancel(); write('\nCancelando…\n'); });
  restartBtn.addEventListener('click', async () => {
    handle.close();
    await onRestartServer?.();
  });

  const handle = openModal({
    title: 'Instalación y actualizaciones',
    className: 'setup-modal',
    width: 'min(760px, 94vw)',
    body: [
      el('p', { class: 'muted tiny setup-intro', text: 'HLab Interactive necesita opencode para funcionar. Cada instalación te pedirá permiso antes de ejecutarse y verás su salida aquí.' }),
      summary,
      list,
      term,
    ],
    footer: [cancelBtn, recheckBtn, restartBtn, installAllBtn],
    onClose: () => { offOutput(); active = null; },
  });

  active = handle;
  refresh().then(() => { if (autoInstall && report && !report.ready) write('\nPulsa “Instalar lo que falta” para empezar.\n'); });
  return handle;
}

/**
 * Se llama al arrancar: si faltan componentes abre el asistente; si hay una
 * versión nueva de opencode lo propone (una vez por versión).
 */
export async function checkEnvironmentOnStart({ onRestartServer, force = false } = {}) {
  let report;
  try {
    report = await window.oc.setup.check();
  } catch {
    return null;
  }
  if (!report.ready) {
    openSetupDialog({ onRestartServer, autoInstall: true });
    return report;
  }
  const { updateAvailable, latest, version } = report.opencode;
  if (!updateAvailable) return report;
  let dismissed = '';
  try { dismissed = localStorage.getItem(DISMISS_KEY) || ''; } catch { /* sin almacenamiento */ }
  if (!force && dismissed === latest) return report;
  const accept = await confirmDialog({
    title: 'Actualización de opencode disponible',
    message: `Hay una versión nueva de opencode: v${latest} (instalada: v${version}).\n¿Quieres actualizar ahora? Se te pedirá permiso antes de ejecutar nada.`,
    confirmLabel: 'Actualizar',
    cancelLabel: 'Más tarde',
  });
  if (accept) {
    openSetupDialog({ onRestartServer });
  } else {
    try { localStorage.setItem(DISMISS_KEY, latest); } catch { /* sin almacenamiento */ }
    toast('Puedes actualizar luego desde Ctrl+P → Buscar actualizaciones.', 'info', 4000);
  }
  return report;
}
