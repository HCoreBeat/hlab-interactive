'use strict';

/**
 * First-person walker.
 *
 * The camera lives in tile units (1 = one 40 px tile of the floor plan), so the
 * same coordinates feed the raycaster and the collision tests. Movement is
 * smoothed with a small acceleration and slides along walls (each axis is
 * tested on its own), which feels a lot better than stopping dead on a corner.
 *
 * Nothing here touches the DOM: `fp-ui.js` owns the input and the canvas.
 */

import { TILE, walkable, roomOf } from './floor-plan.js';

const POSITION_KEY = 'office.fp.pos';
const WALK_SPEED = 2.2; // tiles per second
const RUN_SPEED = 4.2;
const ACCEL = 14;
const RADIUS = 0.27;
const EYE_HEIGHT = 0.86; // for reference only (the renderer keeps a fixed eye level)
const SPAWN = { x: 5.5, y: 6.5, angle: -Math.PI / 2 };

/** Points around the player that must be walkable. */
const HALO = [
  [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS],
  [RADIUS * 0.72, RADIUS * 0.72], [-RADIUS * 0.72, RADIUS * 0.72],
  [RADIUS * 0.72, -RADIUS * 0.72], [-RADIUS * 0.72, -RADIUS * 0.72],
];

function storedPose() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
    if (!raw) return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const angle = Number(raw.angle);
    if (![x, y, angle].every(Number.isFinite)) return null;
    if (!walkable(Math.floor(x), Math.floor(y))) return null;
    return { x, y, angle };
  } catch (error) {
    return null;
  }
}

function rememberPose(camera) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({
      x: Math.round(camera.x * 1000) / 1000,
      y: Math.round(camera.y * 1000) / 1000,
      angle: Math.round(camera.angle * 1000) / 1000,
    }));
  } catch (error) { /* sin almacenamiento */ }
}

function free(x, y) {
  for (const [ox, oy] of HALO) {
    if (!walkable(Math.floor(x + ox), Math.floor(y + oy))) return false;
  }
  return true;
}

export function createFpPlayer({ onStep, onRoom } = {}) {
  const pose = storedPose();
  const camera = {
    x: pose?.x ?? SPAWN.x,
    y: pose?.y ?? SPAWN.y,
    angle: pose?.angle ?? SPAWN.angle,
    pitch: 0,
    bob: 0,
    jolt: 0,
    eye: EYE_HEIGHT,
  };
  const velocity = { x: 0, y: 0 };
  const keys = new Set();
  let phase = 0;
  let lastRoom = -1;
  let stepClock = 0;

  function roomNow() {
    const x = Math.floor(camera.x);
    const y = Math.floor(camera.y);
    if (x < 0 || y < 0) return -1;
    return roomOf[x]?.[y] ?? -1;
  }

  lastRoom = roomNow();

  function look(dx, dy) {
    camera.angle += dx * 0.0026;
    if (camera.angle > Math.PI) camera.angle -= Math.PI * 2;
    if (camera.angle < -Math.PI) camera.angle += Math.PI * 2;
    if (dy) {
      camera.pitch = Math.max(-0.26, Math.min(0.26, camera.pitch - dy * 0.0016));
    }
  }

  function keysOf(event) {
    return event.code || event.key;
  }

  function key(type, event) {
    const code = keysOf(event);
    if (type === 'down') keys.add(code);
    else keys.delete(code);
  }

  function clearKeys() {
    keys.clear();
    velocity.x = 0;
    velocity.y = 0;
    camera.bob = 0;
  }

  /** Small camera punch, used by the whip (and any future impact). */
  function kick(amount = 0.02) {
    camera.jolt = (Math.random() < 0.5 ? -1 : 1) * amount;
  }

  function reset(poseOverride = null) {
    const target = poseOverride || storedPose() || SPAWN;
    camera.x = target.x;
    camera.y = target.y;
    camera.angle = target.angle ?? SPAWN.angle;
    camera.pitch = 0;
    camera.bob = 0;
    camera.jolt = 0;
    velocity.x = 0;
    velocity.y = 0;
    clearKeys();
    lastRoom = roomNow();
    rememberPose(camera);
  }

  /** Teleports the camera (used by tests and the patio screenshot pass). */
  function setPose(next) {
    if (!next) return;
    if (Number.isFinite(next.x)) camera.x = next.x;
    if (Number.isFinite(next.y)) camera.y = next.y;
    if (Number.isFinite(next.angle)) camera.angle = next.angle;
    camera.pitch = Number.isFinite(next.pitch)
      ? Math.max(-0.26, Math.min(0.26, next.pitch))
      : 0;
    camera.bob = 0;
    camera.jolt = 0;
    velocity.x = 0;
    velocity.y = 0;
    clearKeys();
    lastRoom = roomNow();
  }

  /** Moves the camera for `dt` seconds using the pressed keys. */
  function update(dt) {
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = running ? RUN_SPEED : WALK_SPEED;

    // desired velocity in world space (strafe is perpendicular to the view)
    const cos = Math.cos(camera.angle);
    const sin = Math.sin(camera.angle);
    let targetX = forward * cos + strafe * -sin;
    let targetY = forward * sin + strafe * cos;
    const length = Math.hypot(targetX, targetY);
    if (length > 0) {
      targetX = (targetX / length) * speed;
      targetY = (targetY / length) * speed;
    }

    const smooth = Math.min(1, dt * ACCEL);
    velocity.x += (targetX - velocity.x) * smooth;
    velocity.y += (targetY - velocity.y) * smooth;
    if (Math.abs(velocity.x) < 0.005) velocity.x = 0;
    if (Math.abs(velocity.y) < 0.005) velocity.y = 0;

    const stepX = velocity.x * dt;
    const stepY = velocity.y * dt;
    // axis-by-axis: sliding along walls instead of sticking to them
    if (stepX && free(camera.x + stepX, camera.y)) camera.x += stepX;
    else velocity.x = 0;
    if (stepY && free(camera.x, camera.y + stepY)) camera.y += stepY;
    else velocity.y = 0;

    // el golpe de cámara se apaga en unas pocas décimas
    camera.jolt *= Math.max(0, 1 - dt * 9);
    if (Math.abs(camera.jolt) < 0.0002) camera.jolt = 0;

    // head bob + footsteps
    const moving = Math.hypot(velocity.x, velocity.y);
    if (moving > 0.12) {
      phase += dt * (running ? 11 : 7.4);
      camera.bob = Math.sin(phase * 2) * (running ? 0.011 : 0.0075);
      stepClock -= dt * (running ? 1.7 : 1);
      if (stepClock <= 0) {
        stepClock = 0.52;
        onStep?.(running ? 'run' : 'walk');
      }
    } else {
      camera.bob += (0 - camera.bob) * Math.min(1, dt * 8);
      stepClock = 0.1;
    }

    const room = roomNow();
    if (room !== lastRoom) {
      if (room >= 0) onRoom?.(room, lastRoom);
      lastRoom = room;
    }
  }

  /**
   * Nearest agent under the crosshair: inside a 34° cone, closer than `reach`
   * tiles and with a clear line of sight (the raycaster's `ray` gives the wall
   * distance; furniture is low and does not block the view).
   */
  function aim(agents, scene, reach = 4.6) {
    let best = null;
    let bestScore = -Infinity;
    for (const agent of agents) {
      if (agent.leaving) continue;
      if (agent.fade !== undefined && agent.fade < 0.35) continue;
      const ax = agent.x / TILE;
      const ay = agent.y / TILE;
      const dx = ax - camera.x;
      const dy = ay - camera.y;
      const distance = Math.hypot(dx, dy);
      if (distance > reach || distance < 0.2) continue;
      let rel = Math.atan2(dy, dx) - camera.angle;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const cone = Math.abs(rel);
      if (cone > 0.34) continue;
      if (scene && scene.ray(camera.x, camera.y, Math.atan2(dy, dx), distance) < distance - 0.15) continue;
      const score = (1 - cone) * 3 - distance;
      if (score > bestScore) {
        bestScore = score;
        best = agent;
      }
    }
    return best;
  }

  return {
    camera,
    update,
    look,
    key,
    clearKeys,
    reset,
    setPose,
    kick,
    aim,
    room: roomNow,
    save: () => rememberPose(camera),
    resetPose() {
      try { localStorage.removeItem(POSITION_KEY); } catch (error) { /* sin almacenamiento */ }
      reset(SPAWN);
    },
  };
}
