'use strict';

/**
 * Patio exterior de la oficina: césped, árboles, bancos, mesa de picnic,
 * canasta, jardín, estanque y fogata. El suelo y los muebles se pintan una vez
 * en la escena estática; lo animado (fuego, agua, mariposas, hojas, pelota)
 * se dibuja cada frame con `drawPatioLive` y `drawPatioProps`.
 */

import {
  TILE, TREE, BENCH, PICNIC, HOOP, FLOWERS, POND, FIREPIT, rgba, shade,
} from './floor-plan.js';

const hash = (x, y, i) => (((x * 73856093) ^ (y * 19349663) ^ (i * 83492791)) >>> 0);

export const PATIO_TILES = new Set([TREE, BENCH, PICNIC, HOOP, FLOWERS, POND, FIREPIT]);

/** Césped con motas, sendero de piedra, cancha y tierra de la fogata. */
export function drawPatioFloor(g, room, colors) {
  for (let x = room.x + 1; x < room.x + room.w - 1; x += 1) {
    for (let y = 1; y < 8; y += 1) {
      const px = x * TILE;
      const py = y * TILE;
      g.fillStyle = (x + y) % 2 === 0 ? colors.color : colors.alt;
      g.fillRect(px, py, TILE, TILE);
      for (let i = 0; i < 7; i += 1) {
        const h = hash(x, y, i);
        g.fillStyle = h % 3 === 0 ? shade(colors.alt, 16) : shade(colors.color, -14);
        g.fillRect(px + (h % 34) + 2, py + ((h >> 5) % 32) + 3, 2, 3);
      }
    }
  }
  // sendero desde la puerta
  [[34, 3], [34, 4], [34, 2], [35, 2]].forEach(([x, y]) => {
    g.fillStyle = '#9d9580';
    g.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
    g.fillStyle = '#b3ab94';
    g.fillRect(x * TILE + 5, y * TILE + 5, TILE - 14, TILE - 14);
  });
  // tierra bajo la fogata
  g.fillStyle = '#5e4d36';
  g.fillRect(35 * TILE + 3, 4 * TILE + 3, TILE - 6, TILE - 6);
  // cancha de baloncesto
  for (let y = 2; y <= 5; y += 1) {
    g.fillStyle = '#4b505b';
    g.fillRect(39 * TILE, y * TILE, TILE, TILE);
    g.fillStyle = 'rgba(255, 255, 255, 0.22)';
    g.fillRect(39 * TILE + 2, y * TILE + 2, 2, TILE - 4);
  }
  g.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(39.5 * TILE, 4 * TILE, TILE * 0.9, Math.PI * 1.5, Math.PI * 0.5, true);
  g.stroke();
}

function tree(g, px, py) {
  g.fillStyle = '#5a3d24';
  g.fillRect(px + 17, py + 22, 7, 15);
  g.fillStyle = '#1f4a2a';
  g.fillRect(px + 7, py + 1, 26, 8);
  g.fillRect(px + 3, py + 7, 34, 17);
  g.fillRect(px + 8, py + 23, 24, 4);
  g.fillStyle = '#2f7a3d';
  g.fillRect(px + 9, py + 3, 20, 7);
  g.fillRect(px + 6, py + 9, 26, 12);
  g.fillStyle = '#4fa75a';
  g.fillRect(px + 12, py + 5, 10, 4);
  g.fillRect(px + 9, py + 11, 10, 4);
}

function bench(g, px, py) {
  g.fillStyle = '#4a3220';
  g.fillRect(px + 5, py + 24, 4, 8);
  g.fillRect(px + 31, py + 24, 4, 8);
  g.fillStyle = '#8a5f36';
  g.fillRect(px + 3, py + 12, 34, 5);
  g.fillStyle = '#b07d48';
  g.fillRect(px + 3, py + 18, 34, 6);
  g.fillStyle = '#c99660';
  g.fillRect(px + 3, py + 18, 34, 2);
}

function picnic(g, px, py) {
  g.fillStyle = '#6b4a2b';
  g.fillRect(px, py + 8, TILE, 26);
  g.fillStyle = '#a77a47';
  g.fillRect(px, py + 8, TILE, 22);
  g.fillStyle = '#c29a63';
  for (let i = 0; i < 4; i += 1) g.fillRect(px, py + 9 + i * 6, TILE, 2);
}

function hoop(g, px, py) {
  g.fillStyle = '#6a7080';
  g.fillRect(px + 34, py + 4, 4, 32);
  g.fillStyle = '#f2f4f8';
  g.fillRect(px + 29, py + 8, 6, 24);
  g.strokeStyle = '#d96a3a';
  g.lineWidth = 2;
  g.strokeRect(px + 18, py + 17, 11, 7);
}

function flowers(g, px, py) {
  g.fillStyle = '#4a3422';
  g.fillRect(px + 2, py + 8, TILE - 4, TILE - 14);
  const colors = ['#e06c75', '#e5c07b', '#c678dd', '#61afef', '#f2f4f8'];
  for (let i = 0; i < 8; i += 1) {
    const h = hash(px / TILE, py / TILE, i + 3);
    const fx = px + 5 + (h % 26);
    const fy = py + 10 + ((h >> 4) % 15);
    g.fillStyle = '#3f9650';
    g.fillRect(fx + 1, fy + 3, 2, 5);
    g.fillStyle = colors[h % colors.length];
    g.fillRect(fx - 1, fy, 5, 4);
    g.fillStyle = '#ffe9a8';
    g.fillRect(fx + 1, fy + 1, 1, 2);
  }
}

function pond(g, px, py, x) {
  g.fillStyle = '#7d8591';
  g.fillRect(px, py + 2, TILE, TILE - 4);
  g.fillStyle = '#2f78b8';
  g.fillRect(px + 3, py + 5, TILE - 6, TILE - 10);
  g.fillStyle = '#4aa0e0';
  g.fillRect(px + 5, py + 7, TILE - 10, 6);
  if (x % 2 === 1) {
    g.fillStyle = '#3f9650';
    g.beginPath();
    g.arc(px + 22, py + 22, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f5b6d6';
    g.fillRect(px + 20, py + 19, 4, 4);
  }
}

function firepit(g, px, py) {
  g.fillStyle = '#8d939e';
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    g.fillRect(px + 20 + Math.cos(a) * 13 - 3, py + 22 + Math.sin(a) * 11 - 3, 6, 6);
  }
  g.fillStyle = '#3a2a1b';
  g.fillRect(px + 12, py + 20, 16, 5);
  g.fillRect(px + 17, py + 15, 5, 14);
}

export function drawPatioTile(g, tile, px, py, x) {
  switch (tile) {
    case TREE: tree(g, px, py); break;
    case BENCH: bench(g, px, py); break;
    case PICNIC: picnic(g, px, py); break;
    case HOOP: hoop(g, px, py); break;
    case FLOWERS: flowers(g, px, py); break;
    case POND: pond(g, px, py, x); break;
    case FIREPIT: firepit(g, px, py); break;
    default: break;
  }
}

/** Sombras de los objetos del patio: [dx, dy, ancho, alto]. */
export const PATIO_SHADOWS = {
  [TREE]: [4, 18, 34, 20],
  [BENCH]: [4, 22, 32, 10],
  [PICNIC]: [0, 14, TILE, 22],
  [HOOP]: [30, 10, 8, 26],
  [FLOWERS]: [3, 14, TILE - 6, 18],
};

/** Efectos animados del patio (fuego, agua, mariposas, hojas, red de la canasta). */
export function drawPatioLive(ctx, time, active) {
  // fogata
  const fx = 35.5 * TILE;
  const fy = 4 * TILE + 24;
  if (active) {
    const glow = ctx.createRadialGradient(fx, fy, 2, fx, fy, 60);
    glow.addColorStop(0, `rgba(255, 170, 70, ${0.28 + Math.sin(time * 9) * 0.05})`);
    glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(fx - 62, fy - 62, 124, 124);
  }
  for (let i = 0; i < 5; i += 1) {
    const flick = Math.sin(time * 11 + i * 2.1);
    const h = 8 + (i === 2 ? 9 : 4) + flick * 3;
    ctx.fillStyle = i % 2 ? '#ffd45e' : '#ff8a3a';
    ctx.fillRect(fx - 8 + i * 4, fy - h, 4, h);
  }
  ctx.fillStyle = 'rgba(255, 236, 190, 0.8)';
  for (let i = 0; i < 3; i += 1) {
    const p = (time * 0.8 + i / 3) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.fillRect(fx - 4 + Math.sin(p * 9 + i) * 8, fy - 12 - p * 34, 2, 2);
  }
  ctx.globalAlpha = 1;

  // brillo y ondas del estanque
  for (let x = 38; x <= 39; x += 1) {
    const px = x * TILE;
    const py = 7 * TILE;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    const sx = px + 8 + ((Math.sin(time * 1.6 + x) + 1) / 2) * 16;
    ctx.fillRect(sx, py + 10, 8, 2);
    ctx.fillRect(px + 30 - ((Math.sin(time * 1.2 + x * 2) + 1) / 2) * 18, py + 22, 6, 2);
  }

  // red de la canasta
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  const nx = 40 * TILE + 18;
  const ny = 3 * TILE + 24;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    ctx.moveTo(nx + i * 3, ny);
    ctx.lineTo(nx + 1 + i * 2.2 + Math.sin(time * 2 + i) * 0.8, ny + 9);
  }
  ctx.stroke();

  // mariposas
  for (let i = 0; i < 3; i += 1) {
    const bx = 36.5 * TILE + Math.sin(time * 0.7 + i * 2.3) * 2.2 * TILE + i * 22;
    const by = 6.1 * TILE + Math.cos(time * 0.9 + i * 1.7) * 0.7 * TILE;
    const flap = Math.abs(Math.sin(time * 14 + i)) * 3;
    ctx.fillStyle = ['#ffd45e', '#f5b6d6', '#9be7ff'][i];
    ctx.fillRect(bx - 3 - flap / 2, by, 3 + flap / 2, 3);
    ctx.fillRect(bx + 1, by, 3 + flap / 2, 3);
  }

  // hojas que caen de los árboles
  ctx.fillStyle = '#7fc66f';
  for (let i = 0; i < 6; i += 1) {
    const p = (time * 0.12 + i * 0.17) % 1;
    const lx = (34.4 + (i * 1.1) % 6.4) * TILE + Math.sin(time * 1.4 + i) * 10;
    ctx.globalAlpha = Math.sin(p * Math.PI);
    ctx.fillRect(lx, 1.1 * TILE + p * 6 * TILE, 3, 2);
  }
  ctx.globalAlpha = 1;
}

/** Objetos que llevan los agentes: pelota que bota y regadera con gotas. */
export function drawPatioProps(ctx, time, agent) {
  if (agent.leaving || agent.path.length) return;
  const f = agent.face < 0 ? -1 : 1;
  if (agent.anim === 'play') {
    const t = (time * 2.4 + agent.seed) % 1;
    const bounce = Math.abs(Math.sin(t * Math.PI));
    const bx = agent.x + f * (11 + Math.sin(time * 1.2 + agent.seed) * 3);
    const by = agent.y + 14 - bounce * 20;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(bx - 3, agent.y + 16, 7 - bounce * 2, 2);
    ctx.fillStyle = '#e8803a';
    ctx.fillRect(bx - 3, by - 3, 7, 7);
    ctx.fillStyle = '#7a3a14';
    ctx.fillRect(bx - 3, by, 7, 1);
    ctx.fillRect(bx, by - 3, 1, 7);
  } else if (agent.anim === 'garden') {
    const tilt = Math.sin(time * 2.2 + agent.seed) * 2;
    const cx = agent.x + f * 12;
    const cy = agent.y - 2 + tilt;
    ctx.fillStyle = '#6ea2d6';
    ctx.fillRect(cx - 4, cy - 3, 9, 7);
    ctx.fillStyle = '#9cc4ec';
    ctx.fillRect(cx - 4, cy - 3, 9, 2);
    ctx.fillRect(cx + f * 5 - (f < 0 ? 5 : 0), cy - 1, 5, 2);
    ctx.fillStyle = '#7dc8ff';
    for (let i = 0; i < 4; i += 1) {
      const p = (time * 1.8 + i / 4) % 1;
      ctx.globalAlpha = 1 - p;
      ctx.fillRect(cx + f * (10 + p * 4), cy + p * 16, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
}

export { rgba };
