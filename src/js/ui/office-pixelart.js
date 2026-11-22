'use strict';

/**
 * Top-down pixel-art office.
 *
 * A fixed floor plan (five rooms inside a 34x9 tile grid) rendered on a canvas.
 * Every session becomes an agent that walks between rooms depending on what the
 * runtime is doing: desk (thinking/editing), server room (shell), archive
 * (reading/searching), MCP room (mcp tools) and meeting room (just finished).
 *
 * The static scene (floor, walls, furniture, light) is painted once into an
 * offscreen canvas and blitted every frame, so only the agents are redrawn.
 *
 * The plan lives in `office/floor-plan.js` and the sprites in `office/sprites.js`.
 */

import { el, clear } from '../util/dom.js';
import {
  subscribe, runtimeOf, permissionsOf, activeSession, officeSessions, mcpServersOf,
} from '../store.js';
import {
  TILE, COLS, ROWS, VIEW_W, VIEW_H,
  FLOOR, WALL, DOOR, DESK, CHAIR, RACK, SHELF, TABLE, PLANT, TERMINAL, COFFEE, COOLER, PRINTER,
  ROOMS, STATUS, themePalette,
  map, roomOf, DESK_SPOTS, SERVER_SPOTS, MCP_SPOTS, ARCHIVE_SPOTS, MEETING_SPOTS,
  shade, rgba,
} from './office/floor-plan.js';
import {
  drawDesk, drawChair, drawRack, drawShelf, drawTable, drawPlant, drawTerminal, drawAgent,
  drawCoffee, drawCooler, drawPrinter, drawBoard, drawClock,
} from './office/sprites.js';
import { uiIcon } from '../util/ui-icons.js';
import { sfx as rawSfx, unlock, isMuted, setMuted } from './office/sound.js';
import { drawLamps, drawDaylight, drawAmbience } from './office/lighting.js';
import { planStations, createAgent, moveAgent } from './office/agents.js';
import { drawAgentProps, breakKind, BREAK_LABEL } from './office/props.js';
import {
  PATIO_TILES, PATIO_SHADOWS, drawPatioFloor, drawPatioTile, drawPatioLive, drawPatioProps,
} from './office/patio.js';
import { createFpUi } from './office/fp-ui.js';

// Los sonidos de agentes que están en la otra zona (patio u oficina) llegan amortiguados.
let hearing = 1;
function sfx(name, options = {}) {
  rawSfx(name, options.pan === undefined ? options : { ...options, vol: (options.vol ?? 1) * hearing });
}

const VIEW_KEY = 'ocv.officeView';
const ZOOM_KEY = 'ocv.officeZoom';
function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function remember(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* sin almacenamiento */ }
}

const MAX_AGENTS = 10;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.6;

/** Offset + size of the shadow cast by every piece of furniture. */
const SHADOWS = {
  [DESK]: [4, 8, TILE - 8, TILE - 16],
  [CHAIR]: [12, 12, 16, 12],
  [RACK]: [4, 2, TILE - 8, TILE - 4],
  [SHELF]: [5, 1, TILE - 10, TILE - 2],
  [TABLE]: [1, 8, TILE - 2, TILE - 14],
  [PLANT]: [14, 25, 12, 9],
  [TERMINAL]: [5, 4, TILE - 10, TILE - 12],
  [COFFEE]: [8, 6, 24, 28],
  [COOLER]: [11, 3, 18, 31],
  [PRINTER]: [6, 8, 28, 22],
};

export function mountOfficePixelArt(handlers) {
  const container = document.getElementById('office-room');
  const summary = document.getElementById('office-summary');
  const zoomLabel = document.getElementById('office-zoom');

  const canvas = el('canvas', {
    class: 'office-canvas',
    tabindex: '0',
    role: 'img',
    'aria-label': 'Oficina interactiva. Usa las flechas para seleccionar un agente y Enter para abrir su sesión.',
  });
  const overlay = el('div', { class: 'office-overlay' });
  const stage = el('div', { class: 'office-stage' }, [canvas, overlay]);
  const frame = el('div', { class: 'office-frame' }, [stage]);
  clear(container);
  container.appendChild(frame);

  const soundButton = el('button', { class: 'office-sound-btn', type: 'button', title: 'Sonido de la oficina' });
  function paintSoundButton() {
    clear(soundButton);
    soundButton.appendChild(uiIcon(isMuted() ? 'mute' : 'volume', 16));
    soundButton.classList.toggle('is-muted', isMuted());
    soundButton.setAttribute('aria-pressed', String(!isMuted()));
  }
  soundButton.addEventListener('click', () => {
    unlock();
    setMuted(!isMuted());
    paintSoundButton();
    if (!isMuted()) setTimeout(() => sfx('chime', { gap: 0 }), 60);
  });
  paintSoundButton();
  stage.appendChild(soundButton);
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  // El botón «Entrar» se pinta desde JS para usar el mismo juego de iconos SVG
  // que el resto de la interfaz (nada de emojis).
  const enterButton = document.getElementById('office-fp-enter');
  if (enterButton) {
    clear(enterButton);
    enterButton.appendChild(uiIcon('eye', 14));
    enterButton.appendChild(document.createTextNode('Entrar'));
    enterButton.addEventListener('click', onEnterClick);
  }

  const ctx = canvas.getContext('2d');
  const scene = document.createElement('canvas');
  const sceneCtx = scene.getContext('2d');
  const agents = [];
  const agentTags = new Map();
  let selected = null;
  let hovered = null;
  let raf = null;
  let last = performance.now();
  let time = 0;
  let scale = 1;
  let zoom = Math.min(1.6, Math.max(0.5, Number(stored(ZOOM_KEY, '1')) || 1));
  let dpr = 1;
  let slowTimer = 0;
  let mcpTags = [];
  let mcpTagSignature = '';
  let sceneDirty = true;
  let lastTheme = '';
  let roomCounts = [];
  let ledTime = 0;
  let steamT = 0;
  let loopBudget = 0;
  let planTimer = 0;
  let lastPlan = null;
  let lowQuality = false;
  let workEma = 5;
  let tagClock = 0;
  let syncTimer = null;
  const glowCache = new Map();
  let view = stored(VIEW_KEY, 'office') === 'patio' ? 'patio' : 'office';
  let switching = false;
  let ambT = 2;
  let fireT = 1;
  let seatedNow = new Map();
  let fp = null;
  const fx = [];
  const floaties = [];
  const doors = [];
  for (let dx = 0; dx < COLS; dx += 1) {
    for (let dy = 0; dy < ROWS; dy += 1) if (map[dx][dy] === DOOR) doors.push({ x: dx, y: dy, open: 0 });
  }

  // ------------------------------------------------------------- sizing ----

  function resize() {
    const rect = frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const vw = viewCols() * TILE;
    const fit = Math.min(rect.width / vw, rect.height / VIEW_H);
    scale = Math.max(0.05, fit * zoom);
    stage.style.width = `${Math.floor(vw * scale)}px`;
    stage.style.height = `${Math.floor(VIEW_H * scale)}px`;
    dpr = Math.min(window.devicePixelRatio || 1, lowQuality ? 1 : 2);
    const pixelWidth = Math.floor(vw * dpr);
    const scenePixelWidth = Math.floor(VIEW_W * dpr);
    const pixelHeight = Math.floor(VIEW_H * dpr);
    let bufferChanged = false;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      bufferChanged = true;
    }
    if (scene.width !== scenePixelWidth || scene.height !== pixelHeight) {
      scene.width = scenePixelWidth;
      scene.height = pixelHeight;
      sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sceneCtx.imageSmoothingEnabled = false;
      bufferChanged = true;
    }
    if (bufferChanged) sceneDirty = true;
    updateZoomLabel();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(frame);

  function updateZoomLabel() {
    if (!zoomLabel) return;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(value) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    if (next !== zoom) sfx('zoom', { gap: 60 });
    zoom = next;
    remember(ZOOM_KEY, next);
    resize();
    handlers.onOfficeZoom?.(zoom);
  }

  // ------------------------------------------------------------ vistas ----
  // La oficina (columnas 0-33) y el patio (33-41) son dos vistas del mismo plano:
  // los agentes caminan de una a otra por la puerta de la sala de reuniones.

  function viewDef() {
    return view === 'office' ? { x0: 0, cols: 34 } : { x0: 33, cols: 9 };
  }
  function viewCols() { return viewDef().cols; }

  const doorBtn = el('button', { class: 'office-door-btn', type: 'button' }, [
    el('span', { class: 'door-frame', 'aria-hidden': 'true' }, [el('span', { class: 'door-leaf' })]),
    el('span', { class: 'door-label' }),
    el('span', { class: 'door-count' }),
  ]);
  doorBtn.addEventListener('click', () => setView(view === 'office' ? 'patio' : 'office'));
  stage.appendChild(doorBtn);

  function updateDoorButton() {
    const alive = agents.filter((agent) => !agent.leaving);
    const outside = alive.filter((agent) => roomOf[Math.round(agent.x / TILE - 0.5)]?.[Math.round(agent.y / TILE - 0.5)] === 5).length;
    const inOffice = view === 'office';
    const count = inOffice ? outside : alive.length - outside;
    doorBtn.querySelector('.door-label').textContent = inOffice ? 'Salir al patio' : 'Volver a la oficina';
    const badge = doorBtn.querySelector('.door-count');
    badge.textContent = String(count);
    badge.hidden = count === 0;
    doorBtn.classList.toggle('is-patio', !inOffice);
    doorBtn.title = inOffice ? `Salir al patio · tecla D (${outside} fuera)` : `Volver a la oficina · tecla D (${count} dentro)`;
  }

  function placeRoomTags() {
    const { x0, cols } = viewDef();
    ROOMS.forEach((room, index) => {
      const show = view === 'office' ? room.id !== 'patio' : room.id === 'patio';
      roomTags[index].hidden = !show;
      roomTags[index].style.left = `${((room.x + 0.5 - x0) / cols) * 100}%`;
    });
  }

  function applyView() {
    resize();
    placeRoomTags();
    mcpTagSignature = '';
    renderMcpTags();
    updateDoorButton();
    updateAgentTags();
  }

  function setView(next) {
    if (next === view || switching) return;
    switching = true;
    rawSfx('dooropen', { gap: 0 });
    stage.classList.add('is-leaving');
    setTimeout(() => {
      view = next;
      remember(VIEW_KEY, next);
      applyView();
      rawSfx('doorclose', { gap: 0, vol: 0.9 });
      stage.classList.remove('is-leaving');
      stage.classList.add('is-entering');
      setTimeout(() => { stage.classList.remove('is-entering'); switching = false; }, 320);
    }, 280);
  }

  // ------------------------------------------------------------- labels ----

  const roomTags = ROOMS.map((room) => {
    const tag = el('span', { class: 'office-room-tag', text: room.name });
    tag.style.left = `${((room.x + 0.5) / COLS) * 100}%`;
    tag.style.top = `${(0.55 / ROWS) * 100}%`;
    overlay.appendChild(tag);
    return tag;
  });
  let roomSignature = '';
  placeRoomTags();

  function renderMcpTags() {
    // los toggles de MCP solo existen en la sala de MCP (vista de oficina), nunca en el patio
    mcpTags.forEach((tag) => { tag.hidden = view !== 'office'; });
    const servers = mcpServersOf().slice(0, 4);
    const signature = servers.map((server) => `${server.name || server.id}:${server.status}`).join('|');
    if (signature === mcpTagSignature) return;
    mcpTagSignature = signature;
    mcpTags.forEach((tag) => tag.remove());
    mcpTags = [];
    servers.forEach((server, index) => {
      const online = server.status === 'connected' || server.status === 'ready';
      const tag = el('span', {
        class: `office-mcp-tag ${online ? 'is-online' : ''}`,
        title: [server.name, server.command || server.type || ''].filter(Boolean).join(' — '),
      }, [
        el('span', { class: 'office-mcp-dot' }),
        el('span', { class: 'office-mcp-name', text: server.name || server.id }),
      ]);
      tag.style.left = `${(18.2 / 34) * 100}%`;
      tag.hidden = view !== 'office';
      tag.style.top = `${((6.4 + index * 0.42) / ROWS) * 100}%`;
      overlay.appendChild(tag);
      mcpTags.push(tag);
    });
  }

  // ------------------------------------------------------------- agents ----

  const agentContext = {
    runtimeOf,
    permissionsOf,
    servers: mcpServersOf,
  };

  function syncAgents() {
    const sessions = officeSessions(MAX_AGENTS);
    const seen = new Set(sessions.map((session) => session.id));

    // Agents that are gone walk out through the meeting room instead of
    // vanishing on the spot (finished subagents, deleted sessions…).
    for (const agent of agents) {
      if (seen.has(agent.id)) {
        if (agent.leaving) { agent.leaving = false; agent.leavingAt = 0; agent.fade = 1; }
        continue;
      }
      if (!agent.leaving) {
        agent.leaving = true;
        agent.leavingAt = time;
        sfx('leave', { pan: panOf(agent) });
      }
    }

    sessions.forEach((session, index) => {
      const existing = agents.find((agent) => agent.id === session.id);
      if (existing) {
        existing.session = session;
        existing.isSubagent = Boolean(session.parentID);
        existing.role = String(session.agent || '').toLowerCase();
        return;
      }
      const created = createAgent(session, index, agents);
      agents.push(created);
      if (created.briefUntil) sfx('spawn', { pan: panOf(created) });
    });

    renderMcpTags();
    updateSummary();
  }

  function tick(dt) {
    time += dt;
    loopBudget = 4;
    stepFx(dt);
    // En primera persona la "zona" activa es la sala en la que está el jugador.
    const patioNow = fp?.isOpen() ? fp.player.room() === 5 : view === 'patio';
    ambT -= dt;
    if (ambT <= 0) {
      ambT = 3 + Math.random() * 5;
      if (patioNow) {
        const r = Math.random();
        rawSfx(r < 0.5 ? 'bird' : r < 0.8 ? 'rustle' : 'wind', { pan: rnd(-0.7, 0.7), vol: 0.7, gap: 300 });
      } else if (Math.random() < 0.55) {
        rawSfx(['hum', 'printer', 'phone'][Math.floor(Math.random() * 3)], { pan: rnd(-0.6, 0.6), vol: 0.6, gap: 800 });
      }
    }
    fireT -= dt;
    if (patioNow && fireT <= 0) {
      fireT = 0.5 + Math.random() * 1.2;
      rawSfx('crackle', { pan: -0.7, vol: 0.8, gap: 80 });
    }
    ledTime += dt * (1 + (roomCounts[1] ? 2.5 : 0));
    steamT -= dt;
    if (steamT <= 0) {
      steamT = 0.35;
      emit(10 * TILE + 20, 2 * TILE + 4, { vx: rnd(-3, 3), vy: -14, life: 1, color: 'rgba(240, 244, 250, 0.5)', size: 3 });
    }

    // Agents that are leaving fade out once they reach the meeting room.
    for (let i = agents.length - 1; i >= 0; i -= 1) {
      if (agents[i].leaving && (agents[i].fade <= 0 || time - agents[i].leavingAt > 16)) agents.splice(i, 1);
    }

    // One conflict-free plan (recomputed 5 times per second, not every frame).
    planTimer -= dt;
    if (planTimer <= 0 || !lastPlan) {
      lastPlan = planStations(agents, agentContext);
      planTimer = 0.2;
    }
    const plan = lastPlan;
    agents.forEach((agent) => {
      const step = plan.get(agent.id);
      if (!step) return;
      const walking = moveAgent(agent, step.station, dt);
      agent.workState = step.state;
      agent.anim = walking || step.state;
      if (agent.leaving && !agent.path.length) agent.fade = Math.max(0, agent.fade - dt / 1.2);
      animate(agent, dt);
    });
    // Conversaciones: los agentes libres que están cerca se emparejan, se miran,
    // hablan por turnos (globo + boca + murmullo) y el que escucha asiente.
    agents.forEach((agent) => { agent.talking = false; agent.partner = null; agent.bubble = null; });
    const sociable = agents.filter((agent) => !agent.path.length && !agent.leaving && SOCIAL.has(agent.anim));
    const paired = new Set();
    sociable.forEach((agent) => {
      if (paired.has(agent)) return;
      let best = null;
      let bestDist = TILE * 2.7;
      sociable.forEach((other) => {
        if (other === agent || paired.has(other)) return;
        const dist = Math.hypot(other.x - agent.x, other.y - agent.y);
        if (dist < bestDist) { bestDist = dist; best = other; }
      });
      if (!best) return;
      paired.add(agent);
      paired.add(best);
      agent.partner = best;
      best.partner = agent;
      if (Math.abs(best.x - agent.x) > 4) {
        agent.face = best.x > agent.x ? 1 : -1;
        best.face = -agent.face;
      }
      const turn = Math.floor(time / 2.6 + agent.seed + best.seed);
      const speaker = turn % 2 === 0 ? agent : best;
      speaker.talking = true;
      speaker.bubble = SPEECH[(turn * 3 + Math.floor(agent.seed * 2)) % SPEECH.length];
      if (agent.lastTurn !== turn) {
        agent.lastTurn = turn;
        if (speaker.bubble === 'heart') emit(speaker.x + speaker.face * 16, speaker.y - 34, { vy: -26, life: 1, color: '#e0506a', size: 3 });
      }
    });
    // Recuento por sala y asientos ocupados: se calcula en la simulación para
    // que la vista superior y la primera persona compartan los mismos datos.
    const counts = ROOMS.map(() => 0);
    seatedNow = new Map();
    agents.forEach((agent) => {
      if (agent.leaving || agent.path.length) return;
      const tx = Math.round(agent.x / TILE - 0.5);
      const ty = Math.round(agent.y / TILE - 0.5);
      const room = roomOf[tx]?.[ty];
      if (room >= 0) counts[room] += 1;
      if (agent.seated) seatedNow.set(`${tx},${ty - 1}`, agent.anim);
    });
    roomCounts = counts;
    stepDoors(dt);
    if (!isFirstPerson()) updateAgentTagsThrottled(dt);
    else tagClock = 0;
  }

  function updateAgentTagsThrottled(dt) {
    tagClock -= dt;
    if (tagClock > 0) return;
    tagClock = 0.12;
    updateAgentTagsFull();
  }

  // ---------------------------------------------------- effects & sound ----

  const WORK_COLOR = {
    code: '#9be7ff', terminal: '#6ff0b8', read: '#f5e6b8', search: '#8ecbff', mcp: '#8dffc9',
    wait: '#f0b45e', meet: '#d8b4ff', error: '#ff8a8a', think: '#e0ebfa', break: '#f0b45e', idle: '#aab3c2',
    chill: '#98c379', play: '#ffd98a', garden: '#7bd88f', chat: '#d8b4ff', write: '#ffd98a',
  };
  const CONFETTI = ['#e06c75', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2'];
  const SOCIAL = new Set(['idle', 'chill', 'chat', 'break', 'garden', 'play', 'write', 'stretch', 'meet']);
  const SPEECH = ['dots', 'laugh', 'question', 'dots', 'heart', 'bang', 'note', 'dots'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function panOf(agent) {
    // En primera persona el sonido se coloca respecto a la cámara: girarse
    // hacia un agente lo sube de volumen y lo centra.
    if (fp?.isOpen()) {
      const camera = fp.camera();
      const ax = agent.x / TILE;
      const ay = agent.y / TILE;
      const dx = ax - camera.x;
      const dy = ay - camera.y;
      const dist = Math.hypot(dx, dy);
      let rel = Math.atan2(dy, dx) - camera.angle;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      hearing = Math.max(0.12, Math.min(1, 1.1 - dist / 16));
      return Math.max(-1, Math.min(1, Math.sin(rel) * 1.2)) * 0.9;
    }
    const { x0, cols } = viewDef();
    const rel = (agent.x - x0 * TILE) / (cols * TILE);
    hearing = rel >= -0.02 && rel <= 1.02 ? 1 : 0.3;
    return Math.max(-1, Math.min(1, rel * 2 - 1)) * 0.85;
  }

  function emit(x, y, o = {}) {
    if (fx.length > 260) return;
    const life = o.life ?? 0.8;
    fx.push({
      x, y, vx: o.vx ?? 0, vy: o.vy ?? -20, g: o.g ?? 0, life, max: life, color: o.color ?? '#fff', size: o.size ?? 2,
    });
  }

  function confetti(agent) {
    for (let i = 0; i < 18; i += 1) {
      emit(agent.x, agent.y - 24, {
        vx: rnd(-50, 50), vy: rnd(-90, -30), g: 140, life: rnd(0.8, 1.4), size: 3, color: CONFETTI[i % CONFETTI.length],
      });
    }
  }

  function stepFx(dt) {
    for (let i = fx.length - 1; i >= 0; i -= 1) {
      const p = fx[i];
      p.life -= dt;
      if (p.life <= 0) { fx.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
    }
    for (let i = floaties.length - 1; i >= 0; i -= 1) {
      floaties[i].life -= dt;
      if (floaties[i].life <= 0) floaties.splice(i, 1);
    }
  }

  function drawFx() {
    for (const p of fx) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (const f of floaties) {
      ctx.globalAlpha = Math.min(1, f.life);
      const y = f.y - (1.6 - f.life) * 14;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 14, 22, 0.85)';
      ctx.strokeText(f.text, f.x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  /** Sound + particles + floating labels for one agent. */
  function animate(agent, dt) {
    // El latigazo se apaga solo: tiembla, echa chispas y vuelve a la normalidad.
    if (agent.lash) agent.lash = Math.max(0, agent.lash - dt * 1.2);
    const pan = panOf(agent);
    const state = agent.workState;
    if (state !== agent.lastState) {
      const prev = agent.lastState;
      agent.lastState = state;
      if (prev !== undefined) {
        if (state === 'wait') sfx('bell', { pan });
        else if (state === 'error') sfx('error', { pan });
        else if (state === 'meet' && !runtimeOf(agent.id).busy) { sfx('done', { pan }); confetti(agent); }
        else if (state === 'mcp') sfx('mcp', { pan });
        else if (state === 'search') sfx('search', { pan });
        else if (state === 'think') sfx('think', { pan, vol: 0.65 });
        else if (state === 'break') sfx(breakKind(agent) === 'print' ? 'printer' : breakKind(agent) === 'water' ? 'bubble' : 'coffee', { pan, vol: 0.7 });
        else if (state === 'play') sfx('cheer', { pan, vol: 0.6 });
        else if (state === 'dance') sfx('cheer', { pan, vol: 0.5 });
        else if (state === 'stretch') sfx('yawn', { pan, vol: 0.7 });
        else if (state === 'phone') sfx('phone', { pan, vol: 0.7 });
        else if (state === 'write') sfx('marker', { pan, vol: 0.7 });
        else if (state === 'garden') sfx('splash', { pan, vol: 0.6 });
        else if (state === 'terminal') sfx('beep', { pan });
        else if (state === 'read') sfx('page', { pan });
        const attention = state === 'wait' || state === 'error' || permissionsOf(agent.id).length > 0;
        if (!['idle', 'think', 'break', 'chill', 'play', 'garden', 'chat', 'stretch', 'phone', 'nap', 'write', 'dance', 'book'].includes(state) && (agent === selected || attention) && floaties.length < 12) {
          floaties.push({ x: agent.x, y: agent.y - 36, text: STATUS[state]?.label || state, color: WORK_COLOR[state] || '#fff', life: 1.6 });
        }
      }
    }

    const tx = Math.round(agent.x / TILE - 0.5);
    const ty = Math.round(agent.y / TILE - 0.5);
    const room = roomOf[tx]?.[ty];
    if (room >= 0 && room !== agent.roomIdx) {
      if (agent.roomIdx !== undefined) sfx('door', { pan, vol: 0.6, gap: 120 });
      agent.roomIdx = room;
    }

    if (agent.seated !== agent.wasSeated) {
      if (agent.wasSeated !== undefined) sfx(agent.seated ? 'sit' : 'stand', { pan, vol: 0.7, gap: 100 });
      agent.wasSeated = agent.seated;
    }

    agent.sfxT = (agent.sfxT ?? 0) - dt;
    if (agent.sfxT <= 0) {
      const a = agent.anim;
      const table = {
        walk: ['step', 0.27], code: ['key', 0.09 + Math.random() * 0.16], terminal: ['tick', 0.35 + Math.random() * 0.3], read: ['page', 1.6], search: ['search', 1.25 + Math.random() * 0.4],
        think: ['blip', 2.2 + Math.random() * 2.2], mcp: ['link', 0.9 + Math.random() * 0.6], meet: ['chat', 1.8 + Math.random() * 2.4], chat: ['chat', 2 + Math.random() * 2.6],
        wait: ['ping', 4.5],
        break: [breakKind(agent) === 'print' ? 'paper' : breakKind(agent) === 'water' ? 'gulp' : 'sip', 2.6 + Math.random() * 2],
        nap: ['snore', 3.4], phone: ['blip', 2.4 + Math.random() * 1.5], write: ['marker', 0.4 + Math.random() * 0.3],
        dance: ['beat', 0.43], book: ['paper', 5 + Math.random() * 3],
        play: [Math.random() < 0.12 ? 'swish' : 'ball', 0.42 + Math.random() * 0.1], garden: ['splash', 1.6 + Math.random()], chill: ['bird', 3 + Math.random() * 4],
      }[a];
      const entry = agent.talking && !['chat', 'meet', 'walk'].includes(a) ? ['chat', 2.2 + Math.random() * 1.8] : table;
      if (entry && loopBudget > 0) {
        loopBudget -= 1;
        sfx(entry[0], { pan, vol: a === 'walk' ? 0.5 : 0.8, gap: 20 });
        agent.sfxT = entry[1];
      } else {
        agent.sfxT = 0.15;
      }
    }

    agent.fxT = (agent.fxT ?? 0) - dt;
    if (agent.fxT <= 0) {
      const a = agent.anim;
      if (a === 'walk') {
        emit(agent.x + rnd(-6, 6), agent.y + 15, { vx: rnd(-6, 6), vy: -10, life: 0.4, color: 'rgba(225, 230, 240, 0.55)' });
        agent.fxT = 0.16;
      } else if (['code', 'terminal', 'mcp', 'read', 'search'].includes(a)) {
        emit(agent.x + rnd(-8, 10), agent.y - 26, { vx: rnd(-8, 8), vy: -26, life: 0.7, color: WORK_COLOR[a] });
        agent.fxT = 0.2;
      } else if (a === 'wait') {
        emit(agent.x + rnd(-8, 8), agent.y - 34, { vy: -14, life: 0.9, color: WORK_COLOR.wait, size: 3 });
        agent.fxT = 0.35;
      } else {
        agent.fxT = 0.3;
      }
    }
  }

  function drawDecor(g) {
    drawBoard(g, 29.3 * TILE, 6, 3.3 * TILE);
    // cuadros en la pared y cartel de la puerta del patio
    [[4.2, '#e5c07b', '#4a6fa8'], [4.9, '#c678dd', '#e06c75']].forEach(([fx, c1, c2]) => {
      g.fillStyle = '#4a3828';
      g.fillRect(fx * TILE, 8, 24, 20);
      g.fillStyle = c1;
      g.fillRect(fx * TILE + 3, 11, 18, 7);
      g.fillStyle = c2;
      g.fillRect(fx * TILE + 3, 18, 18, 7);
    });
    g.fillStyle = '#1f5a3a';
    g.fillRect(33 * TILE + 4, 2 * TILE + 24, 32, 12);
    g.fillStyle = '#c9ffd9';
    g.font = 'bold 8px monospace';
    g.textAlign = 'center';
    g.fillText('PATIO', 33 * TILE + 20, 2 * TILE + 33);
    g.textAlign = 'left';
    g.fillStyle = '#10151d';
    g.fillRect(13.2 * TILE, 8, 3.6 * TILE, 20);
    for (let i = 0; i < 8; i += 1) {
      g.fillStyle = ['#6ff0b8', '#ffd98a', '#8ecbff', '#6ff0b8'][i % 4];
      g.fillRect(13.2 * TILE + 8 + i * 16, 15, 8, 6);
    }
    g.fillStyle = '#101820';
    g.fillRect(20 * TILE, 8, 2.2 * TILE, 20);
    g.fillStyle = '#7dffc4';
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    g.fillText('MCP', 21.1 * TILE, 23);
    g.textAlign = 'left';
    [[9.2, '#e5c07b'], [0.9, '#98c379']].forEach(([tx, color]) => {
      g.fillStyle = '#4a3828';
      g.fillRect(tx * TILE, 8, TILE * 0.7, 22);
      g.fillStyle = color;
      g.fillRect(tx * TILE + 3, 11, TILE * 0.7 - 6, 16);
    });
  }

  /** Monitors: dark when nobody sits there, scrolling lines when somebody works. */
  function drawScreens(seated) {
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        const tile = map[x][y];
        if (tile !== DESK && tile !== TERMINAL) continue;
        const isDesk = tile === DESK;
        const px = x * TILE + (isDesk ? 13 : 8);
        const py = y * TILE + 7;
        const w = isDesk ? 14 : TILE - 16;
        const h = isDesk ? 11 : TILE - 20;
        const anim = seated.get(`${x},${y}`);
        ctx.fillStyle = anim ? 'rgba(14, 20, 30, 0.82)' : 'rgba(16, 22, 32, 0.62)';
        ctx.fillRect(px, py, w, h);
        if (!anim) continue;
        ctx.fillStyle = WORK_COLOR[anim] || '#9be7ff';
        for (let i = 0; i < 4; i += 1) {
          const lw = 3 + Math.round((Math.sin(time * 3 + i * 1.7 + x) + 1) * ((w - 6) / 2.2));
          ctx.fillRect(px + 2, py + 2 + i * Math.floor(h / 4), Math.min(lw, w - 4), 1);
        }
      }
    }
  }

  function drawLiveExtras() {
    drawClock(ctx, 5 * TILE, 21);
    if (roomCounts[4]) {
      ctx.strokeStyle = '#3b6fd8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const n = 3 + (Math.floor(time * 4) % 9);
      for (let i = 0; i < n; i += 1) {
        const bx = 29.3 * TILE + 8 + i * 9;
        ctx.moveTo(bx, 12 + (i % 3) * 5);
        ctx.lineTo(bx + 6, 16 + ((i + 1) % 3) * 5);
      }
      ctx.stroke();
    }
    if (agents.some((agent) => agent.anim === 'mcp')) {
      ctx.fillStyle = '#8dffc9';
      for (let i = 0; i < 4; i += 1) {
        const p = (time * 0.9 + i / 4) % 1;
        ctx.fillRect(18.4 * TILE + p * 5 * TILE, 4 * TILE + 18 + Math.sin(p * 12) * 3, 4, 4);
      }
    }
  }

  // ------------------------------------------------------------- render ----

  function drawFloor(g, room, roomIndex, palette) {
    const colors = palette.rooms[roomIndex];
    if (room.id === 'patio') {
      drawPatioFloor(g, room, colors);
      return;
    }
    for (let x = room.x + 1; x < room.x + room.w - 1; x += 1) {
      for (let y = 1; y < ROWS - 1; y += 1) {
        const px = x * TILE;
        const py = y * TILE;
        g.fillStyle = (x + y) % 2 === 0 ? colors.color : colors.alt;
        g.fillRect(px, py, TILE, TILE);
        g.fillStyle = rgba('#000000', 0.07);
        g.fillRect(px, py + TILE - 1, TILE, 1);
        g.fillRect(px + TILE - 1, py, 1, TILE);
      }
    }
    if (!colors.rug) return;
    g.fillStyle = rgba(colors.rug, 0.85);
    if (roomIndex === 0) {
      g.fillRect(1.4 * TILE, 1.4 * TILE, 8.2 * TILE, 6.2 * TILE);
      g.strokeStyle = rgba('#f0b45e', 0.22);
      g.lineWidth = 2;
      g.strokeRect(1.6 * TILE, 1.6 * TILE, 7.8 * TILE, 5.8 * TILE);
    } else if (room.id === 'meeting') {
      g.fillRect(29.2 * TILE, 1.4 * TILE, 3.6 * TILE, 6.2 * TILE);
    } else {
      g.fillRect((room.x + 1.2) * TILE, 1.4 * TILE, (room.w - 2.4) * TILE, 6.2 * TILE);
    }
  }

  function drawWalls(g, palette) {
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        if (map[x][y] !== WALL) continue;
        const px = x * TILE;
        const py = y * TILE;
        const index = roomOf[x][y] >= 0 ? roomOf[x][y] : (x > 33 ? 5 : 0);
        const colors = palette.rooms[index];
        const open = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && map[nx][ny] !== WALL;
        });
        g.fillStyle = colors.wall;
        g.fillRect(px, py, TILE, TILE);
        if (open) {
          g.fillStyle = colors.wallTop;
          g.fillRect(px, py, TILE, 7);
          g.fillStyle = shade(colors.wall, 14);
          g.fillRect(px, py, 4, TILE);
        } else {
          g.fillStyle = rgba('#000000', 0.18);
          g.fillRect(px + 4, py + 4, TILE - 8, TILE - 8);
        }
      }
    }
  }

  /** Paints the static scene once; it is blitted on every frame. */
  function buildScene() {
    const palette = themePalette();
    if (palette === lastTheme && !sceneDirty) return;
    lastTheme = palette;
    sceneDirty = false;
    const g = sceneCtx;
    g.clearRect(0, 0, VIEW_W, VIEW_H);

    ROOMS.forEach((room, index) => drawFloor(g, room, index, palette));
    drawDaylight(g, palette);

    const occupied = new Set(agents.filter((agent) => !agent.path.length).map((agent) => agent.target));
    const online = mcpServersOf().length > 0;
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        const tile = map[x][y];
        const px = x * TILE;
        const py = y * TILE;
        const shadow = SHADOWS[tile] || PATIO_SHADOWS[tile];
        if (shadow) {
          g.fillStyle = palette.shadow;
          g.fillRect(px + shadow[0] + 3, py + shadow[1] + 5, shadow[2], shadow[3]);
        }
        switch (tile) {
          case DOOR:
            g.fillStyle = '#8a6a42';
            g.fillRect(px + 8, py + 2, TILE - 16, TILE - 4);
            g.fillStyle = '#b08a56';
            g.fillRect(px + 10, py + 4, TILE - 20, TILE - 8);
            break;
          case DESK: drawDesk(g, px, py, 0); break;
          case CHAIR: drawChair(g, px, py, occupied.has({ x, y })); break;
          case RACK: drawRack(g, px, py, 0, x * 3 + y); break;
          case SHELF: drawShelf(g, px, py); break;
          case TABLE: drawTable(g, px, py); break;
          case PLANT: drawPlant(g, px, py); break;
          case TERMINAL: drawTerminal(g, px, py, 0, online); break;
          case COFFEE: drawCoffee(g, px, py); break;
          case COOLER: drawCooler(g, px, py); break;
          case PRINTER: drawPrinter(g, px, py); break;
          default:
            if (PATIO_TILES.has(tile)) drawPatioTile(g, tile, px, py, x);
            break;
        }
      }
    }

    drawWalls(g, palette);
    drawDecor(g);
    drawLamps(g, palette);
    drawAmbience(g, palette);
    // luz de relleno horneada en la escena estática (antes se pintaba entera en cada fotograma)
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgb(34, 32, 28)';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.globalCompositeOperation = 'source-over';
  }

  /** The blinking LEDs of the server racks, drawn on top of the static scene. */
  function drawLeds() {
    ctx.fillStyle = '#6ff0b8';
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        if (map[x][y] !== RACK) continue;
        for (let row = 0; row < 4; row += 1) {
          if (Math.sin(ledTime * 2.4 + x * 3 + y + row) < 0.6) continue;
          ctx.fillRect(x * TILE + 9, y * TILE + 9 + row * 7, 3, 3);
        }
      }
    }
  }

  /** Las puertas se abren cuando un agente se acerca (estado, no dibujo). */
  function stepDoors(dt) {
    const smooth = Math.min(1, dt * 12);
    for (const door of doors) {
      const cx = door.x * TILE + TILE / 2;
      const cy = door.y * TILE + TILE / 2;
      let near = 0;
      for (const agent of agents) {
        const dist = Math.hypot(agent.x - cx, agent.y - cy);
        if (dist < 58) near = Math.max(near, 1 - dist / 58);
      }
      door.open += (near - door.open) * smooth;
      if (door.open < 0.004) door.open = 0;
    }
  }

  function drawDoors() {
    for (const door of doors) {
      if (door.open < 0.04) continue;
      ctx.fillStyle = `rgba(10, 12, 18, ${0.78 * door.open})`;
      ctx.fillRect(door.x * TILE + 8, door.y * TILE + 2, TILE - 16, TILE - 4);
      ctx.fillStyle = '#b08a56';
      ctx.fillRect(door.x * TILE + 8, door.y * TILE + 2, Math.max(2, 7 * (1 - door.open) + 3), TILE - 4);
    }
  }

  /** Live effects: occupied rooms, lit monitors/chairs, room headcount. */
  function drawLive() {
    const counts = roomCounts;
    for (const key of seatedNow.keys()) {
      const [tx, ty] = key.split(',').map(Number);
      ctx.fillStyle = 'rgba(240, 180, 94, 0.22)';
      ctx.fillRect(tx * TILE + 12, (ty + 1) * TILE + 12, 16, 15);
    }
    ROOMS.forEach((room, i) => {
      if (!counts[i]) return;
      ctx.fillStyle = rgba('#f0b45e', 0.045 + Math.sin(time * 2 + i) * 0.015);
      ctx.fillRect((room.x + 1) * TILE, TILE, (room.w - 2) * TILE, (ROWS - 2) * TILE);
    });
    drawDoors();
    drawScreens(seatedNow);
    drawLiveExtras();
    const signature = counts.join(',');
    if (signature !== roomSignature) {
      roomSignature = signature;
      updateDoorButton();
      ROOMS.forEach((room, i) => {
        roomTags[i].textContent = counts[i] ? `${room.name} · ${counts[i]}` : room.name;
        roomTags[i].classList.toggle('is-active', counts[i] > 0);
      });
    }
  }

  /** Resplandor del suelo bajo cada agente: se pinta una vez por color y se reutiliza. */
  function glowSprite(color) {
    let sprite = glowCache.get(color);
    if (!sprite) {
      sprite = document.createElement('canvas');
      sprite.width = 60;
      sprite.height = 60;
      const g = sprite.getContext('2d');
      const gradient = g.createRadialGradient(30, 30, 2, 30, 30, 28);
      gradient.addColorStop(0, rgba(color, 1));
      gradient.addColorStop(1, rgba(color, 0));
      g.fillStyle = gradient;
      g.fillRect(0, 0, 60, 60);
      glowCache.set(color, sprite);
    }
    return sprite;
  }

  function render() {
    const palette = themePalette();
    buildScene();
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = palette.outside;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const { x0, cols } = viewDef();
    ctx.drawImage(scene, x0 * TILE * dpr, 0, cols * TILE * dpr, VIEW_H * dpr, 0, 0, cols * TILE, VIEW_H);
    ctx.save();
    ctx.translate(-x0 * TILE, 0);
    // motas de polvo en los haces de luz: dan profundidad y vida al ambiente
    ctx.fillStyle = 'rgb(255, 244, 222)';
    for (let i = 0; i < 32; i += 1) {
      const s = i * 37.7;
      const mx = (s * 13.1 + time * (3 + (i % 5))) % VIEW_W;
      const my = (s * 7.3 + Math.sin(time * 0.4 + i) * 14 + time * (1 + (i % 3) * 0.6)) % VIEW_H;
      ctx.globalAlpha = 0.1 + 0.16 * Math.abs(Math.sin(time * 0.8 + i));
      ctx.fillRect(mx, my, i % 4 === 0 ? 2 : 1, i % 4 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    drawLeds();
    if (view === 'patio') drawPatioLive(ctx, time, agents.some((agent) => roomOf[Math.round(agent.x / TILE - 0.5)]?.[Math.round(agent.y / TILE - 0.5)] === 5));
    drawLive();

    agents
      .slice()
      .sort((a, b) => a.y - b.y)
      .forEach((agent) => {
        const glow = WORK_COLOR[agent.workState || agent.anim];
        if (glow && agent.anim !== 'walk' && !agent.leaving && glow !== WORK_COLOR.idle) {
          ctx.globalAlpha = 0.3 + Math.sin(time * 3 + agent.seed) * 0.08;
          ctx.drawImage(glowSprite(glow), agent.x - 30, agent.y - 18);
          ctx.globalAlpha = 1;
        }
        drawAgent(ctx, agent, time);
        drawPatioProps(ctx, time, agent);
        drawAgentProps(ctx, time, agent);
        const dot = WORK_COLOR[agent.workState || agent.anim];
        if (dot && agent.anim !== 'walk' && !agent.leaving) {
          ctx.globalAlpha = 0.6 + Math.sin(time * 4 + agent.seed) * 0.3;
          ctx.fillStyle = '#0a0e16';
          ctx.fillRect(Math.round(agent.x) - 4, Math.round(agent.y) - 37, 8, 8);
          ctx.fillStyle = dot;
          ctx.fillRect(Math.round(agent.x) - 3, Math.round(agent.y) - 36, 6, 6);
          ctx.globalAlpha = 1;
        }
        if (agent === selected) {
          ctx.strokeStyle = 'rgba(240, 180, 94, 0.95)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.ellipse(agent.x, agent.y + 14, 14 + Math.sin(time * 5) * 1.3, 6, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    ctx.restore();
  }

  // ---------------------------------------------------------- overlays -----

  function updateAgentTagsFull() {
    const placed = [];
    agents.forEach((agent) => {
      const runtime = runtimeOf(agent.id);
      const perms = permissionsOf(agent.id);
      const rawStatus = STATUS[agent.workState || agent.anim] || STATUS.idle;
      const status = (agent.workState || agent.anim) === 'break'
        ? { ...rawStatus, label: BREAK_LABEL[breakKind(agent)] || rawStatus.label }
        : rawStatus;
      const name = agent.session.title || 'Sesión';
      const agentName = agent.session.agent || 'build';
      const role = agent.isSubagent ? `SUBAGENTE · ${agentName}` : `PRINCIPAL · ${agentName}`;
      const attention = perms.length > 0 || agent.workState === 'error';
      const expanded = agent === selected || agent === hovered || attention;
      const input = runtime.toolInput && typeof runtime.toolInput === 'object'
        ? Object.entries(runtime.toolInput).find(([, value]) => typeof value === 'string' && value.trim())?.[1]
        : runtime.toolInput;
      const preview = String(input || runtime.tool || status.label).replace(/\s+/g, ' ').slice(0, 72);
      const sessionModel = agent.session.model || {};
      const modelName = sessionModel.id || sessionModel.modelID
        ? `${sessionModel.providerID ? `${sessionModel.providerID}/` : ''}${sessionModel.id || sessionModel.modelID}`
        : '';
      const title = `${name} — ${status.label}${runtime.tool ? ` · ${runtime.tool}` : ''}`
        + ` — agente ${agentName}${modelName ? ` · modelo ${modelName}` : ''}`;
      const shortName = name.length > 22 ? `${name.slice(0, 21)}…` : name;
      const label = `${role}|${status.icon} ${shortName}|${preview}|${expanded}`;

      let tag = agentTags.get(agent.id);
      let measure = false;
      if (!tag) {
        tag = el('button', { class: 'office-agent-tag', type: 'button' }, [
          el('span', { class: 'office-agent-role' }),
          el('span', { class: 'office-agent-title' }),
          el('span', { class: 'office-agent-task' }),
        ]);
        tag.addEventListener('click', () => selectAgent(agent));
        agentTags.set(agent.id, tag);
        overlay.appendChild(tag);
      }
      if (tag.dataset.label !== label) {
        measure = true;
        tag.dataset.label = label;
        tag.querySelector('.office-agent-role').textContent = role;
        const titleNode = tag.querySelector('.office-agent-title');
        clear(titleNode);
        titleNode.append(uiIcon(status.icon, 13), document.createTextNode(shortName));
        tag.querySelector('.office-agent-task').textContent = preview;
      }
      tag.title = title;
      tag.classList.toggle('is-active', attention);
      tag.classList.toggle('is-error', agent.workState === 'error');
      tag.style.setProperty('--tag-accent', WORK_COLOR[agent.workState || agent.anim] || '#aab3c2');
      tag.classList.toggle('is-subagent', agent.isSubagent);
      tag.classList.toggle('is-selected', agent === selected);
      tag.classList.toggle('is-expanded', expanded);
      tag.setAttribute('aria-pressed', String(agent === selected));
      tag.setAttribute('aria-label', `${role}: ${shortName}, ${status.label}. Seleccionar sesión.`);
      const vd = viewDef();
      const inView = agent.x >= vd.x0 * TILE - 12 && agent.x <= (vd.x0 + vd.cols) * TILE + 12;
      tag.hidden = !inView;
      if (!inView) return;
      if (measure || !tag._w) {
        tag._w = tag.offsetWidth;
        tag._h = tag.offsetHeight;
      }

      // stagger the tags that would overlap each other
      const px = (agent.x - viewDef().x0 * TILE) * scale;
      const h = expanded ? 52 : 22;
      let py = (agent.y - (expanded ? 52 : 44)) * scale;
      for (let guard = 0; guard < 8; guard += 1) {
        const clash = placed.find((other) => Math.abs(other.x - px) < 110 && Math.abs(other.y - py) < (h + other.h) / 2 + 4);
        if (!clash) break;
        py -= h + 4;
      }
      const half = (tag._w || 100) / 2;
      const th = tag._h || h;
      const cx = Math.max(half + 2, Math.min(px, stage.clientWidth - half - 2));
      const flipped = py - th < 2;
      if (flipped) py = Math.min((agent.y + 26) * scale + th, stage.clientHeight - 2);
      tag.classList.toggle('is-below', flipped);
      placed.push({ x: cx, y: py, h });
      const transform = `translate(${cx}px, ${py}px) translate(-50%, -100%)`;
      if (tag._transform !== transform) {
        tag._transform = transform;
        tag.style.transform = transform;
        if (!tag._placed) {
          tag._placed = true;
          requestAnimationFrame(() => tag.classList.add('is-placed'));
        }
      }
    });
    agentTags.forEach((tag, id) => {
      if (!agents.some((agent) => agent.id === id)) {
        tag.remove();
        agentTags.delete(id);
      }
    });
  }

  /** Las etiquetas se recalculan a ~8 Hz; entre medias la transición CSS las desliza. */
  function updateAgentTags() {
    tagClock = 0;
    updateAgentTagsFull();
  }

  function updateSummary() {
    if (!summary) return;
    const busy = agents.filter((agent) => runtimeOf(agent.id).busy).length;
    const waiting = agents.filter((agent) => permissionsOf(agent.id).length > 0).length;
    const subagents = agents.filter((agent) => agent.isSubagent).length;
    const servers = mcpServersOf().length;
    const count = agents.length;
    summary.textContent = `${count - subagents} principal(es) · ${subagents} subagente(s) · ${busy} trabajando`
      + `${waiting ? ` · ${waiting} esperando permiso` : ''} · ${servers} MCP`;
  }

  // ------------------------------------------------------------ events -----

  function hitAgent(event) {
    if (!scale) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / scale + viewDef().x0 * TILE;
    const y = (event.clientY - rect.top) / scale;
    let best = null;
    let bestDist = 26;
    agents.forEach((agent) => {
      const dist = Math.hypot(agent.x - x, agent.y - 6 - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = agent;
      }
    });
    return best;
  }

  function onClick(event) {
    const agent = hitAgent(event);
    if (!agent) return;
    selectAgent(agent);
  }

  function selectAgent(agent) {
    if (!agent) return;
    selected = agent;
    hovered = null;
    sfx('select', { pan: panOf(agent), gap: 80 });
    handlers.onSelectSession(agent.id);
    updateAgentTags();
  }

  // ------------------------------------------------ primera persona ---------

  const isFirstPerson = () => Boolean(fp?.isOpen());

  /**
   * Latigazo (tecla F en primera persona).
   *
   * Primero suena el chasquido y ~95 ms después el golpe sobre el agente: el
   * retardo es lo que hace que se lea como "el látigo corta el aire y acierta".
   * El agente tiembla, se echa hacia atrás, suelta un «¡AY!» y chispas; todo eso
   * lo pinta `sprites.js` a partir de `agent.lash`.
   */
  function whipAgent(agent) {
    if (!agent) {
      // Al aire: solo el chasquido, sin objetivo.
      rawSfx('whip', { gap: 0, pan: 0, vol: 0.8 });
      return false;
    }
    const pan = panOf(agent);
    sfx('whip', { pan, gap: 0, vol: 1 });
    agent.lash = 1;
    setTimeout(() => {
      // `panOf` actualiza `hearing` para el golpe, que llega desde el agente.
      const hitPan = panOf(agent);
      sfx('whipHit', { pan: hitPan, gap: 0, vol: 1 });
      agent.lash = 1;
      if (floaties.length < 14) {
        floaties.push({
          x: agent.x, y: agent.y - 44, text: '¡AY!', color: '#ff9d9d', life: 1.3,
        });
      }
      for (let i = 0; i < 12; i += 1) {
        emit(agent.x + rnd(-10, 10), agent.y - rnd(16, 34), {
          vx: rnd(-48, 48),
          vy: rnd(-66, -14),
          g: 130,
          life: rnd(0.4, 0.8),
          size: rnd(2, 3),
          color: i % 3 === 0 ? '#ffe6b0' : '#ff7d7d',
        });
      }
    }, 95);
    return true;
  }

  function handleFpClose() {
    rawSfx('doorclose', { gap: 0, vol: 0.9 });
    stage.classList.remove('is-fp');
    roomSignature = '';
    updateAgentTags();
    updateSummary();
  }

  function enterFirstPerson() {
    if (isFirstPerson()) return true;
    if (!fp) {
      fp = createFpUi({
        getAgents: () => agents,
        onSelect: (agent) => selectAgent(agent),
        onWhip: (agent) => whipAgent(agent),
        onClose: handleFpClose,
        onOpen: () => {
          rawSfx('dooropen', { gap: 0 });
          stage.classList.add('is-fp');
        },
        onSound: (name, opts) => rawSfx(name, opts),
      });
    }
    fp.open();
    return true;
  }

  function exitFirstPerson(reason = 'api') {
    if (!fp?.isOpen()) return false;
    fp.close(reason);
    return true;
  }

  function onGlobalKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'f' && event.key !== 'F') return;
    if (document.querySelector('.modal-backdrop, .command-palette-backdrop')) return;
    const target = event.target;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    if (!document.getElementById('office')) return;
    event.preventDefault();
    if (isFirstPerson()) exitFirstPerson('key'); else enterFirstPerson();
  }

  function onEnterClick() {
    enterFirstPerson();
  }

  function onDoubleClick(event) {
    event.preventDefault();
    enterFirstPerson();
  }

  document.addEventListener('keydown', onGlobalKey);
  canvas.addEventListener('dblclick', onDoubleClick);

  function onMove(event) {
    const next = hitAgent(event);
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (next !== hovered) {
      hovered = next;
      if (next) sfx('hover', { pan: panOf(next), gap: 120 });
      updateAgentTags();
    }
    canvas.title = next
      ? `${next.session.title || 'Sesión'} · ${STATUS[next.workState || next.anim]?.label || 'en espera'} · clic para abrir`
      : '';
  }

  function onKeyDown(event) {
    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      setView(view === 'office' ? 'patio' : 'office');
      return;
    }
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Enter', ' '].includes(event.key)) return;
    const available = agents.filter((agent) => !agent.leaving);
    if (!available.length) return;
    event.preventDefault();
    const currentIndex = Math.max(0, available.findIndex((agent) => agent === selected));
    if (event.key === 'Enter' || event.key === ' ') {
      selectAgent(available[currentIndex]);
      return;
    }
    const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
    selected = available[(currentIndex + direction + available.length) % available.length];
    hovered = null;
    updateAgentTags();
  }

  function onWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  document.getElementById('office-zoom-in')?.addEventListener('click', () => setZoom(zoom * 1.15));
  document.getElementById('office-zoom-out')?.addEventListener('click', () => setZoom(zoom / 1.15));
  document.getElementById('office-zoom-fit')?.addEventListener('click', () => setZoom(1));
  document.getElementById('office-close')?.addEventListener('click', () => handlers.onToggleOffice?.());

  const unsubscribe = subscribe(
    ['sessions', 'subagents', 'activeSessionId', 'runtime', 'permissions', 'mcpServers', 'activity', 'changedFiles'],
    () => {
      if (syncTimer) return;
      syncTimer = setTimeout(() => { syncTimer = null; syncAgents(); }, 100);
    },
  );

  syncAgents();
  resize();

  function loop(now) {
    if (!frame.offsetParent || document.hidden) {
      last = now;
      raf = requestAnimationFrame(loop);
      return;
    }
    // Máximo ~60 fps normalmente y ~30 fps si el equipo va justo.
    if (now - last < (lowQuality ? 30 : 14)) {
      raf = requestAnimationFrame(loop);
      return;
    }
    const started = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tick(dt);
    // Con la primera persona abierta el overlay tapa la oficina: se sigue
    // simulando (los agentes no se congelan) pero no se pinta dos veces.
    const fpOpen = isFirstPerson();
    if (!fpOpen) {
      render();
      ctx.save();
      ctx.translate(-viewDef().x0 * TILE, 0);
      drawFx();
      ctx.restore();
      // Calidad adaptativa: si pintar cuesta demasiado, baja la resolución (sin quitar animaciones).
      workEma = workEma * 0.96 + (performance.now() - started) * 0.04;
      if (!lowQuality && workEma > 10) {
        lowQuality = true;
        resize();
      }
    }
    slowTimer += dt;
    if (slowTimer > 0.8) {
      slowTimer = 0;
      updateSummary();
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      fp?.destroy();
      fp = null;
      document.removeEventListener('keydown', onGlobalKey);
      enterButton?.removeEventListener('click', onEnterClick);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('wheel', onWheel);
      unsubscribe();
      clear(container);
    },
    enterFirstPerson,
    exitFirstPerson,
    isFirstPerson,
    setFpPose: (pose) => { if (fp?.isOpen()) fp.setPose(pose); },
    getFpState: () => (fp?.isOpen() ? {
      x: fp.camera().x,
      y: fp.camera().y,
      angle: fp.camera().angle,
      room: fp.player.room(),
      inspecting: fp.isInspecting(),
      whips: fp.whipCount(),
      aimed: fp.aimed()?.id || null,
    } : null),
    getAgents: () => agents.map((agent) => ({
      id: agent.id,
      x: agent.x * scale,
      y: agent.y * scale,
      state: agent.anim,
      title: agent.session.title,
      parentID: agent.session.parentID || null,
      isSubagent: agent.isSubagent,
      target: agent.target ? { ...agent.target } : null,
    })),
    getScale: () => scale,
    getZoom: () => zoom,
    setZoom,
  };
}
