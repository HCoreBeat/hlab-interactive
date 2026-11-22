'use strict';

/**
 * First-person overlay for the office.
 *
 * Covers the chat + top-down office (the whole `#editor`) while the player
 * walks around the same floor plan in a raycaster view. The top bar and the
 * activity rail stay visible, so the app never feels "lost".
 *
 * Controls: WASD/arrows move, shift runs, mouse looks (pointer lock with drag
 * fallback), E opens the agent card (never leaves the mode), F cracks the whip,
 * M toggles the minimap, H shows the help and Esc exits. Esc is swallowed in
 * the capture phase so it never reaches the global "abort response" shortcut;
 * with the agent card open, Esc only closes the card.
 */

import { el } from '../../util/dom.js';
import { uiIcon } from '../../util/ui-icons.js';
import {
  COLS, ROWS, TILE, DOOR, ROOMS, STATUS, map, roomOf, themePalette,
} from './floor-plan.js';
import { createFpScene } from './fp-scene.js';
import { createFpPlayer } from './fp-player.js';

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);
const MAP_SCALE = 8; // px per tile in the minimap buffer

/**
 * @param {object} options
 * @param {() => Array} options.getAgents      live agents (positions in px)
 * @param {(agent) => void} options.onSelect   open the session of an agent
 * @param {(agent|null) => void} [options.onWhip]  lash an agent (null = air)
 * @param {() => void} options.onClose         overlay closed by the user
 * @param {() => void} [options.onOpen]
 * @param {(name: string, options?: object) => void} [options.onSound]
 */
export function createFpUi(options) {
  const scene = createFpScene();
  const player = createFpPlayer({
    onStep: () => options.onSound?.('step', { pan: 0, vol: 0.32, gap: 110 }),
    onRoom: () => options.onSound?.('door', { pan: 0, vol: 0.45, gap: 120 }),
  });

  const canvas = scene.canvas;
  canvas.setAttribute('aria-label', 'Vista en primera persona de la oficina');
  canvas.tabIndex = -1;

  // ------------------------------------------------------------- HUD ------

  const roomName = el('span', { class: 'fp-room-name', text: 'Oficina' });
  const roomCount = el('span', { class: 'fp-room-count' });
  const aimName = el('span', { class: 'fp-aim-name' });
  const aimChip = el('div', { class: 'fp-aim', hidden: 'true' }, [
    aimName,
    el('span', { class: 'fp-aim-key' }, [el('kbd', { text: 'E' }), el('span', { text: 'ficha' })]),
    el('span', { class: 'fp-aim-key' }, [el('kbd', { text: 'F' }), el('span', { text: 'latigazo' })]),
  ]);
  const lockHint = el('div', { class: 'fp-lockhint', hidden: 'true', text: 'Haz clic para mirar con el ratón' });

  const helpPanel = el('div', { class: 'fp-help', hidden: 'true' }, [
    el('h3', { text: 'Cómo moverse' }),
    el('ul', {}, [
      el('li', {}, [el('kbd', { text: 'W A S D' }), el('span', { text: 'o flechas para caminar' })]),
      el('li', {}, [el('kbd', { text: 'Shift' }), el('span', { text: 'para correr' })]),
      el('li', {}, [el('kbd', { text: 'Ratón' }), el('span', { text: 'para mirar; arrastra si no se captura' })]),
      el('li', {}, [el('kbd', { text: 'E' }), el('span', { text: 'abre la ficha del agente al que apuntas' })]),
      el('li', {}, [el('kbd', { text: 'F' }), el('span', { text: 'latigazo al agente apuntado' })]),
      el('li', {}, [el('kbd', { text: 'M' }), el('span', { text: 'muestra u oculta el minimapa' })]),
      el('li', {}, [el('kbd', { text: 'H' }), el('span', { text: 'abre esta ayuda' })]),
      el('li', {}, [el('kbd', { text: 'Esc' }), el('span', { text: 'cierra la ficha o vuelve a la vista superior' })]),
    ]),
    el('p', { class: 'muted tiny', text: 'Los sonidos de los agentes llegan del lado en el que están: gírate para escucharlos mejor.' }),
    el('button', {
      class: 'btn-small fp-help-close', type: 'button', text: 'Cerrar ayuda', onClick: () => toggleHelp(false),
    }),
  ]);

  const minimap = el('canvas', { class: 'fp-minimap', width: String(COLS * MAP_SCALE), height: String(ROWS * MAP_SCALE) });
  minimap.setAttribute('aria-label', 'Minimapa de la oficina');
  const mapRoom = el('span', { class: 'fp-map-room' });
  const mapWrap = el('div', { class: 'fp-mapwrap' }, [
    el('div', { class: 'fp-map-head' }, [
      el('span', { class: 'fp-map-title', text: 'Plano' }),
      mapRoom,
    ]),
    minimap,
  ]);

  const btnMap = el('button', {
    class: 'fp-btn', type: 'button', title: 'Minimapa (M)', 'aria-pressed': 'true',
    onClick: () => toggleMap(),
  }, [uiIcon('map', 16)]);
  const btnHelp = el('button', {
    class: 'fp-btn', type: 'button', title: 'Ayuda (H)',
    onClick: () => toggleHelp(),
  }, [uiIcon('help', 16)]);
  const btnExit = el('button', {
    class: 'fp-exit', type: 'button', title: 'Volver a la oficina (Esc)',
    onClick: () => close('button'),
  }, [uiIcon('eye', 15), el('span', { text: 'Salir' })]);

  // ------------------------------------------------------- agent card -----

  const cardRole = el('span', { class: 'fp-card-role', text: 'Agente' });
  const cardTitle = el('h3', { class: 'fp-card-title', text: 'Sesión' });
  const cardState = el('span', { class: 'fp-card-state', text: 'en espera' });
  const cardPlace = el('span', { class: 'fp-card-place', text: 'Oficina' });
  const cardNote = el('p', { class: 'fp-card-note' });
  const cardX = el('button', {
    class: 'fp-card-x', type: 'button', title: 'Cerrar ficha (E)', 'aria-label': 'Cerrar ficha',
    onClick: () => closeInspect(),
  }, [el('span', { text: '×' })]);
  const cardOpen = el('button', {
    class: 'fp-card-btn is-primary', type: 'button', onClick: () => openSession(),
  }, [uiIcon('eye', 14), el('span', { text: 'Abrir sesión' })]);
  const cardWhip = el('button', {
    class: 'fp-card-btn is-danger', type: 'button', onClick: () => whip(),
  }, [uiIcon('spark', 14), el('span', { text: 'Latigazo' }), el('kbd', { text: 'F' })]);
  const cardBack = el('button', {
    class: 'fp-card-btn is-ghost', type: 'button', onClick: () => closeInspect(),
  }, [el('span', { text: 'Volver' }), el('kbd', { text: 'E' })]);

  const inspectCard = el('div', {
    class: 'fp-card', hidden: 'true', role: 'dialog', 'aria-label': 'Ficha del agente apuntado',
  }, [
    el('div', { class: 'fp-card-head' }, [cardRole, cardX]),
    cardTitle,
    el('div', { class: 'fp-card-meta' }, [
      el('span', { class: 'fp-card-status' }, [el('span', { class: 'fp-card-dot' }), cardState]),
      cardPlace,
    ]),
    cardNote,
    el('div', { class: 'fp-card-actions' }, [cardOpen, cardWhip, cardBack]),
  ]);

  const whipFx = el('div', { class: 'fp-whip', 'aria-hidden': 'true' });
  const whipFlash = el('div', { class: 'fp-flash', 'aria-hidden': 'true' });

  const hud = el('div', { class: 'fp-hud' }, [
    el('div', { class: 'fp-scrim fp-scrim-top', 'aria-hidden': 'true' }),
    el('div', { class: 'fp-scrim fp-scrim-bottom', 'aria-hidden': 'true' }),
    el('div', { class: 'fp-top' }, [
      el('div', { class: 'fp-room' }, [
        el('span', { class: 'fp-room-kicker', text: 'Sala' }),
        roomName,
        roomCount,
      ]),
      el('span', { class: 'fp-spacer' }),
      el('div', { class: 'fp-actions' }, [btnMap, btnHelp, btnExit]),
    ]),
    el('div', { class: 'fp-crosshair', 'aria-hidden': 'true' }, [
      el('span', { class: 'fp-cross-h' }),
      el('span', { class: 'fp-cross-v' }),
      el('span', { class: 'fp-cross-dot' }),
    ]),
    aimChip,
    lockHint,
    el('div', { class: 'fp-hints' }, [
      el('span', { class: 'fp-hint' }, [el('kbd', { text: 'WASD' }), el('span', { text: 'mover' })]),
      el('span', { class: 'fp-hint' }, [el('kbd', { text: 'Ratón' }), el('span', { text: 'mirar' })]),
      el('span', { class: 'fp-hint' }, [el('kbd', { text: 'E' }), el('span', { text: 'ficha' })]),
      el('span', { class: 'fp-hint' }, [el('kbd', { text: 'F' }), el('span', { text: 'latigazo' })]),
      el('span', { class: 'fp-hint' }, [el('kbd', { text: 'Esc' }), el('span', { text: 'salir' })]),
    ]),
    mapWrap,
    helpPanel,
    inspectCard,
    whipFx,
    whipFlash,
  ]);

  const root = el('div', {
    class: 'fp-root', hidden: 'true', tabindex: '-1', role: 'application', 'aria-label': 'Oficina en primera persona',
  }, [canvas, hud]);

  document.getElementById('editor')?.appendChild(root);

  let open = false;
  let raf = null;
  let last = performance.now();
  let time = 0;
  let hudClock = 0;
  let mapClock = 0;
  let aimed = null;
  let inspectAgent = null;
  let mapVisible = true;
  let helpVisible = false;
  let dragging = false;
  let locked = false;
  let unlockTimer = null;
  let observer = null;
  let whipTimer = 0;
  let whips = 0;

  // ------------------------------------------------------------- layout ----

  function resize() {
    const host = root.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    scene.resize(rect.width, rect.height);
  }

  // ------------------------------------------------------------- input -----

  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function toggleMap(force) {
    mapVisible = force === undefined ? !mapVisible : Boolean(force);
    minimap.hidden = !mapVisible;
    mapWrap.classList.toggle('is-off', !mapVisible);
    btnMap.setAttribute('aria-pressed', String(mapVisible));
    btnMap.classList.toggle('is-off', !mapVisible);
  }

  function toggleHelp(force) {
    helpVisible = force === undefined ? !helpVisible : Boolean(force);
    helpPanel.hidden = !helpVisible;
    btnHelp.classList.toggle('is-on', helpVisible);
    if (helpVisible) {
      closeInspect();
      helpPanel.querySelector('.fp-help-close')?.focus();
    }
  }

  function whip() {
    if (whipTimer > 0) return;
    whipTimer = 0.28;
    whips += 1;
    const target = inspectAgent || aimed;
    player.kick(0.02);
    whipFx.classList.remove('is-active');
    void whipFx.offsetWidth;
    whipFx.classList.add('is-active');
    whipFlash.classList.remove('is-active');
    void whipFlash.offsetWidth;
    whipFlash.classList.add('is-active');
    options.onWhip?.(target || null);
  }

  function openInspect(agent) {
    if (!agent) return;
    inspectAgent = agent;
    inspectCard.hidden = false;
    player.clearKeys();
    lockHint.hidden = true;
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    options.onSound?.('select', { pan: 0, vol: 0.5, gap: 60 });
    renderInspect();
  }

  function closeInspect() {
    if (!inspectAgent) return;
    inspectAgent = null;
    inspectCard.hidden = true;
    if (open && !locked && !helpVisible) lockHint.hidden = false;
  }

  function openSession() {
    const agent = inspectAgent;
    closeInspect();
    if (!agent) return;
    options.onSelect?.(agent);
    close('select');
  }

  function interact() {
    if (inspectAgent) { closeInspect(); return; }
    if (!aimed) return;
    openInspect(aimed);
  }

  function onKeyDown(event) {
    if (!open) return;
    const code = event.code || event.key;
    if (event.key === 'Escape' || code === 'Escape') {
      // Nunca debe llegar al manejador global: allí Escape aborta la respuesta.
      event.preventDefault();
      event.stopPropagation();
      if (helpVisible) { toggleHelp(false); return; }
      if (inspectAgent) { closeInspect(); return; }
      close('escape');
      return;
    }
    if (isTyping(event.target)) return;
    if (MOVE_KEYS.has(code) || code === 'ShiftLeft' || code === 'ShiftRight') {
      event.preventDefault();
      if (!inspectAgent && !helpVisible) player.key('down', event);
      return;
    }
    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      event.stopPropagation();
      interact();
      return;
    }
    if (event.key === 'f' || event.key === 'F') {
      // Dentro de la primera persona F es el latigazo, nunca "salir".
      event.preventDefault();
      event.stopPropagation();
      whip();
      return;
    }
    if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      toggleMap();
      return;
    }
    if (event.key === 'h' || event.key === 'H' || event.key === 'F1') {
      event.preventDefault();
      toggleHelp();
    }
  }

  function onKeyUp(event) {
    if (!open) return;
    player.key('up', event);
  }

  function onBlur() {
    player.clearKeys();
  }

  function requestLock() {
    if (locked) return;
    try {
      const promise = canvas.requestPointerLock?.();
      if (promise && typeof promise.catch === 'function') promise.catch(() => {});
    } catch (error) {
      lockHint.hidden = false;
    }
  }

  function onPointerLockChange() {
    locked = document.pointerLockElement === canvas;
    if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
    if (!locked && open && !inspectAgent && !helpVisible) {
      // Tras salir del bloqueo (p. ej. con Esc) se recuerda el clic para volver.
      unlockTimer = setTimeout(() => {
        if (open && !locked && !inspectAgent) lockHint.hidden = false;
      }, 120);
    } else {
      lockHint.hidden = true;
    }
  }

  function onMouseMove(event) {
    if (!open || inspectAgent) return;
    if (locked) {
      player.look(event.movementX || 0, event.movementY || 0);
      return;
    }
    if (!dragging) return;
    player.look(event.movementX || 0, event.movementY || 0);
  }

  function onCanvasDown(event) {
    if (event.button !== 0) return;
    if (inspectAgent) {
      closeInspect();
      requestLock();
      return;
    }
    if (locked) return;
    dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    requestLock();
  }

  function onCanvasUp() {
    dragging = false;
  }

  function onCanvasClick(event) {
    if (event.button !== 0) return;
    if (locked) {
      // ya estamos mirando con el ratón: el clic interactúa
      interact();
    } else if (!inspectAgent && canvas.requestPointerLock) {
      requestLock();
    } else if (!inspectAgent) {
      interact();
    }
  }

  // ----------------------------------------------------------- minimapa ----

  function drawMinimap() {
    const g = minimap.getContext('2d');
    const palette = themePalette();
    g.clearRect(0, 0, minimap.width, minimap.height);
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        const tile = map[x][y];
        const room = roomOf[x][y];
        let color = '#080d14';
        if (room >= 0 && tile === 0) color = palette.rooms[room].color;
        else if (tile === DOOR) color = '#e0a45e';
        else if (room >= 0) color = palette.rooms[room].alt;
        g.fillStyle = color;
        g.fillRect(x * MAP_SCALE, y * MAP_SCALE, MAP_SCALE, MAP_SCALE);
      }
    }
    // agentes
    const agents = options.getAgents?.() || [];
    for (const agent of agents) {
      if (agent.leaving) continue;
      g.fillStyle = agent.isSubagent ? '#8ecbff' : '#f5b969';
      g.fillRect(Math.round((agent.x / TILE) * MAP_SCALE) - 2, Math.round((agent.y / TILE) * MAP_SCALE) - 2, 4, 4);
    }
    // jugador + cono de visión
    const camera = player.camera;
    const px = camera.x * MAP_SCALE;
    const py = camera.y * MAP_SCALE;
    g.save();
    g.translate(px, py);
    g.rotate(camera.angle);
    g.fillStyle = 'rgba(125, 255, 196, 0.18)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 27, -0.52, 0.52);
    g.closePath();
    g.fill();
    g.fillStyle = '#7dffc4';
    g.beginPath();
    g.moveTo(6, 0);
    g.lineTo(-4, 4);
    g.lineTo(-4, -4);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------- render ----

  function roomLabel() {
    const index = player.room();
    const room = ROOMS[index];
    const agents = options.getAgents?.() || [];
    let count = 0;
    if (room) {
      for (const agent of agents) {
        if (agent.leaving) continue;
        const ax = Math.floor(agent.x / TILE);
        const ay = Math.floor(agent.y / TILE);
        if (roomOf[ax]?.[ay] === index) count += 1;
      }
    }
    return { name: room?.name || 'Oficina', count, index };
  }

  function agentRoomName(agent) {
    const x = Math.floor(agent.x / TILE);
    const y = Math.floor(agent.y / TILE);
    const index = roomOf[x]?.[y] ?? -1;
    return index >= 0 ? (ROOMS[index]?.name || 'Pasillo') : 'Pasillo';
  }

  function renderInspect() {
    if (!inspectAgent) return;
    const agent = inspectAgent;
    const state = STATUS[agent.workState || agent.anim];
    cardRole.textContent = agent.isSubagent ? 'Subagente' : 'Agente';
    cardTitle.textContent = agent.session?.title || 'Sesión sin título';
    cardState.textContent = state?.label || agent.workState || agent.anim || 'en espera';
    cardPlace.textContent = agentRoomName(agent);
    cardNote.textContent = agent.isSubagent
      ? 'Sesión hija: trabaja a las órdenes de su agente principal.'
      : 'F para el latigazo. E cierra la ficha y sigues paseando.';
    inspectCard.classList.toggle('is-subagent', Boolean(agent.isSubagent));
  }

  function updateHud(dt, agents) {
    aimed = player.aim(agents, scene);
    if (aimed) {
      const status = STATUS[aimed.workState || aimed.anim];
      const title = aimed.session?.title || 'Sesión';
      aimName.textContent = `${title.length > 32 ? `${title.slice(0, 31)}…` : title}${status?.label ? ` · ${status.label}` : ''}`;
      aimChip.hidden = false;
    } else {
      aimChip.hidden = true;
    }
    if (inspectAgent && (!agents.includes(inspectAgent) || inspectAgent.leaving)) closeInspect();

    hudClock -= dt;
    if (hudClock > 0) return;
    hudClock = 0.2;
    const label = roomLabel();
    roomName.textContent = label.name;
    roomCount.textContent = label.count ? `· ${label.count}` : '';
    roomCount.classList.toggle('is-empty', label.count === 0);
    mapRoom.textContent = label.name;
    if (inspectAgent) renderInspect();
  }

  function frame(now) {
    if (!open) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(Math.max(0, (now - last) / 1000), 0.05);
    last = now;
    time += dt;
    if (whipTimer > 0) whipTimer = Math.max(0, whipTimer - dt);
    player.update(dt);
    const agents = options.getAgents?.() || [];
    scene.render(player.camera, agents, time);
    updateHud(dt, agents);
    mapClock -= dt;
    if (mapClock <= 0) {
      mapClock = 0.14;
      if (mapVisible) drawMinimap();
    }
  }

  // ------------------------------------------------------------- life -------

  function openView() {
    if (open) return;
    open = true;
    root.hidden = false;
    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    player.clearKeys();
    player.reset();
    closeInspect();
    toggleHelp(false);
    resize();
    if (!observer) {
      observer = new ResizeObserver(resize);
      const host = root.parentElement;
      if (host) observer.observe(host);
    }
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointerup', onCanvasUp);
    canvas.addEventListener('pointercancel', onCanvasUp);
    canvas.addEventListener('click', onCanvasClick);
    lockHint.hidden = false;
    toggleMap(mapVisible);
    drawMinimap();
    last = performance.now();
    raf = requestAnimationFrame(frame);
    root.focus?.();
    options.onOpen?.();
  }

  function close(reason) {
    if (!open) return;
    open = false;
    closeInspect();
    toggleHelp(false);
    player.save();
    player.clearKeys();
    cancelAnimationFrame(raf);
    raf = null;
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    locked = false;
    dragging = false;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointerdown', onCanvasDown);
    canvas.removeEventListener('pointerup', onCanvasUp);
    canvas.removeEventListener('pointercancel', onCanvasUp);
    canvas.removeEventListener('click', onCanvasClick);
    root.hidden = true;
    options.onClose?.(reason || 'close');
  }

  return {
    root,
    canvas,
    scene,
    player,
    open: openView,
    close,
    isOpen: () => open,
    isInspecting: () => Boolean(inspectAgent),
    whipCount: () => whips,
    camera: () => player.camera,
    setPose: (pose) => player.setPose(pose),
    resetPose: () => player.resetPose(),
    aimed: () => aimed,
    help: toggleHelp,
    minimap: toggleMap,
    whip,
    destroy() {
      close('destroy');
      observer?.disconnect();
      observer = null;
      root.remove();
    },
  };
}
