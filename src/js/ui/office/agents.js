'use strict';

/**
 * Rules that decide where an agent stands and what it is doing.
 * Pure helpers: no DOM, no canvas.
 *
 * Key ideas:
 *  - Stations are assigned in ONE pass per tick with a fresh `claimed` set, in
 *    priority order (main agents first), so two agents never share a tile/desk.
 *  - Every agent owns a unique desk (assignDesks); other agents never use it.
 *  - Activity rooms are "sticky": tools last well under the walking time, so an
 *    agent keeps its room for DWELL_MS after the last tool instead of bouncing
 *    back to the desk every time `tool` becomes null between steps.
 *  - Only reachable tiles are ever chosen as stations.
 */

import { toolKind } from '../../util/icons.js';
import {
  TILE, map, CHAIR, BENCH, roomOf, COLS, ROWS,
  DESK_SPOTS, BREAK_SPOTS, SERVER_SPOTS, MCP_SPOTS, ARCHIVE_SPOTS, MEETING_SPOTS, PATIO_ACTIVITIES,
  WATER_SPOTS, BOARD_SPOTS, FACE_AT,
  PALETTE, SPEED, walkable, reachable, findPath,
} from './floor-plan.js';

const MCP_BOUNDARIES = ['_', '-', '.'];
const DONE_HOLD_MS = 12000;
const DWELL_MS = 6500;
const BRIEF_MS = 3500;
const TASK_TOOL = /^(task|agent|subagent|dispatch|delegate)$/i;
const BUILD_RE = /\b(build|compile|test|publish|dotnet|npm run|pnpm run|yarn run|cargo build|gradle)\b/i;

/** Rooms an idle agent prefers, by role (0 = main office desks). */
const ROLE_ROOMS = { explore: 3, plan: 4 };

const ROOM_SPOTS = {
  1: SERVER_SPOTS,
  2: MCP_SPOTS,
  3: ARCHIVE_SPOTS,
  4: MEETING_SPOTS,
  5: PATIO_ACTIVITIES.map((activity) => activity.spot),
};

let spawnCounter = 0;
const key = (s) => `${s.x},${s.y}`;

function roleRoom(agent) {
  const role = String(agent.role || agent.session?.agent || '').toLowerCase();
  return ROLE_ROOMS[role] ?? 0;
}

/** True when at least one MCP server is still connecting or needs auth. */
function mcpWaiting(ctx) {
  return ctx.servers().some((server) => ['pending', 'connecting', 'needs_auth', 'failed']
    .includes(String(server.status || '').toLowerCase()));
}

function mcpWork(runtime, ctx) {
  if (isMcpTool(runtime.tool, ctx.servers())) return true;
  if (!runtime.busy) return false;
  const tool = String(runtime.tool || '').toLowerCase();
  const input = JSON.stringify(runtime.toolInput || {}).toLowerCase();
  const aboutMcp = /mcp|opencode\.json|\.opencode|auth|connect/.test(tool)
    || /mcp|opencode\.json|\.opencode/.test(input);
  return aboutMcp && mcpWaiting(ctx);
}

/**
 * True when the running tool belongs to one of the configured MCP servers.
 * The comparison is strict on purpose: the server `rea` must not match the
 * tool `read`.
 */
export function isMcpTool(name, servers) {
  const tool = String(name || '').toLowerCase();
  if (!tool) return false;
  return servers.some((server) => {
    const key2 = String(server.name || server.id || '').toLowerCase();
    if (!key2) return false;
    if (tool === key2) return true;
    if (tool.startsWith(`mcp__${key2}__`)) return true;
    return MCP_BOUNDARIES.some((boundary) => tool.startsWith(key2 + boundary))
      || tool.startsWith(`${key2}.`);
  });
}

// ------------------------------------------------------------ activity ----

/** What the agent is doing right now: { room, state, sticky, generic, fixed }. */
function activityOf(agent, ctx, now) {
  const runtime = ctx.runtimeOf(agent.id);
  const tool = String(runtime.tool || '');
  const kind = toolKind(tool);
  const command = String(runtime.toolInput?.command || runtime.toolInput?.cmd || '');
  const perms = ctx.permissionsOf(agent.id).length > 0;

  const classify = () => {
    if (mcpWork(runtime, ctx)) return [2, 'mcp'];
    if (TASK_TOOL.test(tool)) return [4, 'meet'];
    if (kind === 'running' || BUILD_RE.test(command)) return [1, 'terminal'];
    if (kind === 'reading') return [3, 'read'];
    if (kind === 'searching') return [3, 'search'];
    if (kind === 'editing') return [0, 'code'];
    return [0, 'think'];
  };

  if (agent.leaving) return { room: 4, state: 'idle', fixed: true };
  if (perms) {
    const [room] = classify();
    return { room, state: 'wait', sticky: room !== 0 };
  }
  if (agent.briefUntil > now) return { room: 4, state: 'meet', fixed: true };
  if (runtime.busy) {
    if (!tool) return { room: 0, state: 'think', generic: true };
    const [room, state] = classify();
    return { room, state, sticky: room !== 0 };
  }
  if (runtime.doneAt && now - runtime.doneAt < DONE_HOLD_MS) return { room: 4, state: 'meet', fixed: true };
  const failed = runtime.errorAt && now - runtime.errorAt < 60000;
  if (failed) return { room: roleRoom(agent), state: 'error' };
  const room = roleRoom(agent);
  // Ciclo de inactividad (60 s por agente, desfasado): una pequeña rutina en su sitio,
  // café/agua/impresora, regar las plantas o escribir en la pizarra, y el resto en el patio.
  // Los agentes se emparejan (0-1, 2-3…): comparten fase con 1,2 s de diferencia, así
  // coinciden en el café, la pizarra o el patio y pueden conversar.
  const group = Math.floor(agent.order / 2);
  const slot = now + group * 7919 + (agent.order % 2) * 1200;
  const phase = slot % 60000;
  const cycle = Math.floor(slot / 60000) + group;
  if (phase < 7000) {
    const habit = ['idle', 'phone', 'stretch', 'idle', 'nap', 'phone'][cycle % 6];
    return { room, state: habit };
  }
  if (phase < 15000 && room === 0) {
    const start = (cycle % 3) * 2;
    const spots = BREAK_SPOTS.map((_, i) => BREAK_SPOTS[(start + i) % BREAK_SPOTS.length]);
    return { room: 0, state: 'break', spot: spots[0], alts: spots.slice(1) };
  }
  if (phase < 24000 && room === 0) {
    if (cycle % 2 === 0) {
      const spots = WATER_SPOTS.map((_, i) => WATER_SPOTS[(cycle + i) % WATER_SPOTS.length]);
      return { room: 0, state: 'garden', spot: spots[0], alts: spots.slice(1) };
    }
    const spots = cycle % 4 === 1 ? BOARD_SPOTS : BOARD_SPOTS.slice().reverse();
    return { room: 4, state: 'write', spot: spots[0], alts: spots.slice(1) };
  }
  const pick = PATIO_ACTIVITIES[(Math.floor(slot / 20000) + group * 5) % PATIO_ACTIVITIES.length];
  const alts = PATIO_ACTIVITIES
    .filter((item) => item.state === pick.state && item !== pick)
    .map((item) => item.spot)
    .sort((a, b) => (Math.abs(a.x - pick.spot.x) + Math.abs(a.y - pick.spot.y)) - (Math.abs(b.x - pick.spot.x) + Math.abs(b.y - pick.spot.y)));
  return { room: 5, state: pick.state, spot: pick.spot, alts };
}

/** Applies the sticky-room rule on top of the instantaneous activity. */
function resolve(agent, ctx, now) {
  const act = activityOf(agent, ctx, now);
  if (act.sticky) {
    agent.focus = { room: act.room, state: act.state, until: now + DWELL_MS };
    return act;
  }
  const focus = agent.focus;
  if (act.generic && focus) {
    // the dwell timer only starts once the agent has arrived
    if (agent.path.length) focus.until = Math.max(focus.until, now + DWELL_MS);
    if (now < focus.until) return { room: focus.room, state: focus.state };
  }
  agent.focus = null;
  return act;
}

/** The animation/state shown in the label of the agent. */
export function agentState(agent, ctx) {
  const now = Date.now();
  const focus = agent.focus;
  const act = activityOf(agent, ctx, now);
  if (act.generic && focus && now < focus.until) return focus.state;
  return act.state;
}

// ------------------------------------------------------------ stations ----

const tileCache = new Map();

/** Reachable floor tiles of a room, nearest to the room centre first. */
function roomTiles(room) {
  if (tileCache.has(room)) return tileCache.get(room);
  const list = [];
  for (let x = 0; x < COLS; x += 1) {
    for (let y = 0; y < ROWS; y += 1) {
      if (roomOf[x][y] === room && walkable(x, y) && reachable(x, y)) list.push({ x, y });
    }
  }
  const cx = list.reduce((sum, t) => sum + t.x, 0) / (list.length || 1);
  const cy = list.reduce((sum, t) => sum + t.y, 0) / (list.length || 1);
  list.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  tileCache.set(room, list);
  return list;
}

function stationList(room, agent, owned) {
  const out = [];
  const seen = new Set();
  const add = (spot) => {
    if (!spot) return;
    const id = key(spot);
    if (seen.has(id) || !walkable(spot.x, spot.y) || !reachable(spot.x, spot.y)) return;
    seen.add(id);
    out.push(spot);
  };
  if (room === 0) {
    add(agent.desk);
    const mine = agent.desk ? key(agent.desk) : '';
    roomTiles(0).forEach((tile) => {
      const id = key(tile);
      if (owned.has(id) && id !== mine) return; // desks of other agents are theirs
      add(tile);
    });
  } else {
    (ROOM_SPOTS[room] || []).forEach(add);
    roomTiles(room).forEach(add);
  }
  return out;
}

function chooseStation(agent, room, claimed, owned, spot, alts = []) {
  for (const option of [spot, ...alts]) {
    if (option && !claimed.has(key(option)) && reachable(option.x, option.y)) return option;
  }
  const list = stationList(room, agent, owned);
  if (room === 0 && agent.desk && !claimed.has(key(agent.desk))) return agent.desk;
  if (agent.target) {
    const own = key(agent.target);
    if (!claimed.has(own) && list.some((spot) => key(spot) === own)) return agent.target;
  }
  for (const spot of list) {
    if (!claimed.has(key(spot))) return spot;
  }
  return list[0] || agent.desk || DESK_SPOTS[0];
}

/** Gives every living agent a unique desk; main agents are served first. */
function assignDesks(order) {
  const used = new Set();
  for (const agent of order) {
    if (agent.leaving) continue;
    if (agent.desk && !used.has(key(agent.desk))) {
      used.add(key(agent.desk));
      continue;
    }
    agent.desk = DESK_SPOTS.find((desk) => !used.has(key(desk))) || null;
    if (agent.desk) used.add(key(agent.desk));
  }
  return used;
}

const byPriority = (a, b) => (Number(a.leaving) - Number(b.leaving))
  || (Number(a.isSubagent) - Number(b.isSubagent))
  || (a.order - b.order);

/**
 * One station per agent, conflict free.
 * Returns Map<agentId, { station, state, room }>.
 */
export function planStations(agents, ctx) {
  const now = Date.now();
  const order = agents.slice().sort(byPriority);
  const owned = assignDesks(order);
  const claimed = new Set();
  const plan = new Map();
  for (const agent of order) {
    const act = resolve(agent, ctx, now);
    const station = chooseStation(agent, act.room, claimed, owned, act.spot, act.alts);
    claimed.add(key(station));
    plan.set(agent.id, { station, state: act.state, room: act.room });
  }
  return plan;
}

// -------------------------------------------------------------- agents ----

export function createAgent(session, index, existing = []) {
  const taken = new Set(existing.filter((a) => !a.leaving && a.desk).map((a) => key(a.desk)));
  const desk = DESK_SPOTS.find((spot) => !taken.has(key(spot))) || null;
  const isSubagent = Boolean(session.parentID);
  const created = Number(session.time?.created) || 0;
  const fresh = isSubagent && created > 0 && Date.now() - created < 20000;
  // fresh subagents walk out of the meeting room (briefing) before working
  const home = fresh ? MEETING_SPOTS[spawnCounter % MEETING_SPOTS.length] : (desk || DESK_SPOTS[0]);
  spawnCounter += 1;
  return {
    id: session.id,
    session,
    isSubagent,
    role: String(session.agent || '').toLowerCase(),
    palette: PALETTE[index % PALETTE.length],
    seed: index * 1.7,
    face: 1,
    speedMul: 0.88 + Math.random() * 0.26,
    hold: 0,
    desk,
    x: home.x * TILE + TILE / 2,
    y: home.y * TILE + TILE / 2,
    path: [],
    target: home,
    anim: 'idle',
    index,
    order: spawnCounter,
    leaving: false,
    leavingAt: 0,
    briefUntil: fresh ? Date.now() + BRIEF_MS : 0,
    focus: null,
    fade: 1,
    seated: false,
  };
}

/** Advances one agent towards its station; returns the animation to draw. */
export function moveAgent(agent, station, dt) {
  if (!agent.target || agent.target.x !== station.x || agent.target.y !== station.y) {
    const from = { x: Math.round(agent.x / TILE - 0.5), y: Math.round(agent.y / TILE - 0.5) };
    agent.path = findPath(from, station);
    agent.target = station;
    agent.hold = 0.12 + Math.random() * 0.45; // un momento antes de levantarse y echar a andar
  }
  if (!agent.path.length) {
    const tx = station.x * TILE + TILE / 2;
    const ty = station.y * TILE + TILE / 2;
    const dist = Math.hypot(tx - agent.x, ty - agent.y);
    if (dist < 6) {
      agent.x = tx;
      agent.y = ty;
    }
    agent.seated = dist < 6 && [CHAIR, BENCH].includes(map[station.x]?.[station.y]);
    const face = FACE_AT[key(station)];
    if (face && dist < 6) agent.face = face;
    return null;
  }
  if (agent.hold > 0) {
    agent.hold -= dt;
    return null;
  }
  agent.seated = false;

  const next = agent.path[0];
  const tx = next.x * TILE + TILE / 2;
  const ty = next.y * TILE + TILE / 2;
  const dx = tx - agent.x;
  const dy = ty - agent.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2) {
    agent.path.shift();
    agent.x = tx;
    agent.y = ty;
  } else {
    const step = Math.min(dist, SPEED * (agent.speedMul || 1) * dt);
    agent.x += (dx / dist) * step;
    agent.y += (dy / dist) * step;
    if (Math.abs(dx) > 1) agent.face = dx > 0 ? 1 : -1;
  }
  return 'walk';
}
