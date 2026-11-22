'use strict';

/**
 * First-person renderer: a classic column raycaster (DDA) over the same 42x9
 * floor plan used by the top-down office.
 *
 *  - Walls, racks, shelves and trees are solid columns with procedural textures.
 *  - Floor and ceilings are projected per pixel into an ImageData buffer using
 *    the room palettes and a static light map built from `LAMPS`.
 *  - The patio is open air: its "ceiling" pixels stay transparent and reveal a
 *    painted sky behind the buffer (gradient, sun/moon, pixel clouds and a
 *    distant tree line), so looking up outside actually shows the sky.
 *  - Low furniture and agents are billboards, depth-sorted and clipped against
 *    the per-column z-buffer, so walls hide them correctly.
 *
 * Everything is drawn into a small internal buffer (~340 px wide) that is
 * scaled up with `image-rendering: pixelated`: crisp pixel art and cheap frames.
 */

import {
  TILE, COLS, ROWS,
  WALL, DOOR, DESK, CHAIR, RACK, SHELF, TABLE, PLANT, TERMINAL, COFFEE, COOLER, PRINTER,
  TREE, BENCH, PICNIC, HOOP, FLOWERS, FIREPIT, POND,
  WINDOWS, map, roomOf, LAMPS, ROOMS, themePalette, shade,
} from './floor-plan.js';
import { propSprite } from './fp-sprites.js';
import { drawAgent } from './sprites.js';
import { drawAgentProps } from './props.js';

const OCCLUDERS = new Set([WALL, RACK, SHELF, TREE]);
const FURNITURE = new Set([DESK, CHAIR, TABLE, PLANT, TERMINAL, COFFEE, COOLER, PRINTER, BENCH, PICNIC, HOOP, FLOWERS, FIREPIT]);

const TEX_W = 32;
const TEX_H = 64;
const FOV = (66 * Math.PI) / 180;
const FACTORS = [0.6, 0.75, 0.88, 1, 1.1];

/**
 * Interior scale, in tiles: the player's eyes sit near a tile high and the
 * ceiling is ~1.6 tiles up. With agents ~0.9 tiles tall this reads as a real
 * room (door height, desk height and windows line up) instead of a crawlspace.
 */
const EYE = 0.86;
const CEIL = 1.62;
const DOOR_H = 1.28; // altura del hueco de las puertas (el dintel ocupa el resto)

const PATIO_ROOM = Math.max(0, ROOMS.findIndex((room) => room.id === 'patio'));
const SUN_AZ = 0.95;
const MOON_AZ = -2.35;
const TRANSPARENT = 0;

// ------------------------------------------------------------- statics ----

const roomFlat = new Int8Array(COLS * ROWS);
const lightFlat = new Uint8Array(COLS * ROWS);

for (let x = 0; x < COLS; x += 1) {
  for (let y = 0; y < ROWS; y += 1) {
    // Las puertas no pertenecen a ninguna sala (`roomOf` es -1): se asigna la
    // sala de al lado para que el suelo y la luz no queden negros al cruzarlas.
    let roomIndex = roomOf[x][y];
    if (roomIndex < 0 && map[x][y] === DOOR) {
      roomIndex = roomOf[x - 1]?.[y] ?? roomOf[x + 1]?.[y] ?? -1;
    }
    roomFlat[y * COLS + x] = roomIndex;
  }
}

// Static light: one bucket per cell from the ceiling lamps of its room.
for (let x = 0; x < COLS; x += 1) {
  for (let y = 0; y < ROWS; y += 1) {
    const roomIndex = roomFlat[y * COLS + x];
    if (roomIndex < 0) { lightFlat[y * COLS + x] = 1; continue; }
    const room = ROOMS[roomIndex];
    if (room.id === 'patio') { lightFlat[y * COLS + x] = 4; continue; }
    let value = 0.42;
    for (const [lx, ly] of LAMPS[room.id] || []) {
      const dist = Math.hypot(x + 0.5 - lx, y + 0.5 - ly);
      value += 1.05 / (1 + dist * dist * 0.42);
    }
    // Ninguna sala queda a oscuras: el mínimo es un escalón de luz ambiental.
    lightFlat[y * COLS + x] = Math.max(1, Math.min(4, Math.round(((value - 0.42) / 0.68) * 4)));
  }
}

/** Cells that hold (or are right under) a ceiling lamp, to paint light panels. */
const lampFlat = new Uint8Array(COLS * ROWS);
for (const room of ROOMS) {
  if (room.id === 'patio') continue;
  for (const [lx, ly] of LAMPS[room.id] || []) {
    for (let x = Math.floor(lx - 0.55); x <= Math.floor(lx + 0.55); x += 1) {
      for (let y = Math.floor(ly - 0.55); y <= Math.floor(ly + 0.55); y += 1) {
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        lampFlat[y * COLS + x] = 1;
      }
    }
  }
}

// ------------------------------------------------------------- helpers ----

function pack(hex) {
  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

function packRgb(r, g, b) {
  return (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

function lerpPack(a, b, t) {
  const ar = a & 255; const ag = (a >> 8) & 255; const ab = (a >> 16) & 255;
  const br = b & 255; const bg = (b >> 8) & 255; const bb = (b >> 16) & 255;
  return packRgb(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  );
}

function hash2(x, y) {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0);
}

// ------------------------------------------------------------ palettes ----

const paletteCache = new Map();

function palettes(themeKey, theme) {
  if (paletteCache.has(themeKey)) return paletteCache.get(themeKey);
  const floors = theme.rooms.map((room) => {
    const rows = [];
    for (let b = 0; b < FACTORS.length; b += 1) {
      const amount = Math.round((FACTORS[b] - 1) * 70);
      rows.push({
        a: pack(shade(room.color, amount)),
        b: pack(shade(room.alt, amount)),
        line: pack(shade(room.color, amount - 12)),
        speck: pack(shade(room.color, amount - 26)),
      });
    }
    return rows;
  });
  const ceilings = theme.rooms.map((room) => {
    const rows = [];
    for (let b = 0; b < FACTORS.length; b += 1) {
      const amount = Math.round(-26 + FACTORS[b] * 12);
      rows.push({
        base: pack(shade(room.wallTop, amount)),
        line: pack(shade(room.wallTop, amount - 16)),
        lamp: pack(shade(room.wallTop, amount + 22)),
      });
    }
    return rows;
  });
  const grassA = pack(theme.rooms[PATIO_ROOM]?.color || '#2f5a3a');
  const grassB = pack(theme.rooms[PATIO_ROOM]?.alt || '#37663f');
  const result = {
    floors,
    ceilings,
    outside: pack(themeKey === 'light' ? '#8d8676' : '#130c09'),
    roof: pack(themeKey === 'light' ? '#2a3040' : '#0a0e16'),
    grassA,
    grassB,
    grassSpeck: pack(shade(theme.rooms[PATIO_ROOM]?.color || '#2f5a3a', -18)),
    water: pack(themeKey === 'light' ? '#4f9fc0' : '#25536b'),
    waterAlt: pack(themeKey === 'light' ? '#63b6d6' : '#2f6885'),
  };
  paletteCache.set(themeKey, result);
  return result;
}

// ----------------------------------------------------------- textures ----

const textureCache = new Map();

function isWindow(tileX) {
  return WINDOWS.some(([x, w]) => tileX >= x && tileX < x + w);
}

function makeTexture(type, roomIndex, light, side, themeKey, win) {
  const theme = themePalette();
  const colors = theme.rooms[roomIndex] || theme.rooms[0];
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;

  if (type === RACK) {
    g.fillStyle = '#232b38';
    g.fillRect(0, 0, TEX_W, TEX_H);
    for (let row = 0; row < 8; row += 1) {
      g.fillStyle = '#101720';
      g.fillRect(2, 3 + row * 8, TEX_W - 4, 6);
      g.fillStyle = row % 2 ? '#0c1219' : '#0f1620';
      g.fillRect(3, 4 + row * 8, TEX_W - 6, 4);
      for (let i = 0; i < 3; i += 1) {
        const on = (row + i * 2) % 3 !== 0;
        g.fillStyle = on ? (i === 0 ? '#6ff0b8' : i === 1 ? '#8ecbff' : '#ffd98a') : '#2c3a46';
        g.fillRect(5 + i * 7, 5 + row * 8, 2, 2);
      }
      g.fillStyle = '#39465a';
      g.fillRect(TEX_W - 8, 5 + row * 8, 4, 1);
    }
  } else if (type === SHELF) {
    g.fillStyle = '#6b5334';
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = '#8a6c46';
    g.fillRect(0, 0, 3, TEX_H);
    g.fillRect(TEX_W - 3, 0, 3, TEX_H);
    for (let row = 0; row < 8; row += 1) {
      g.fillStyle = '#46321f';
      g.fillRect(2, 7 + row * 7, TEX_W - 4, 2);
      for (let i = 0; i < 6; i += 1) {
        g.fillStyle = ['#d79bf0', '#7cc0ff', '#ffd98a', '#a9dd8f', '#f08a8a'][(row + i) % 5];
        g.fillRect(3 + i * 4, 3 + row * 7, 3, 4);
      }
    }
  } else if (type === TREE) {
    // Árbol: silueta redondeada arriba (deja ver el cielo), copa con volumen y
    // tronco. La base queda opaca para que no se abran huecos a la altura de
    // los ojos cuando el árbol está pegado a la pared del patio.
    const trunkTop = 42;
    g.fillStyle = '#22391f';
    g.fillRect(0, 0, TEX_W, TEX_H);

    // sombra en la base y tronco ancho (se lee como árbol, no como poste)
    g.fillStyle = '#1a2c18';
    g.fillRect(4, TEX_H - 6, TEX_W - 8, 6);
    g.fillStyle = '#5a3b22';
    g.fillRect(12, trunkTop, 9, TEX_H - trunkTop);
    g.fillStyle = '#42301c';
    g.fillRect(12, trunkTop, 3, TEX_H - trunkTop);
    g.fillStyle = '#6b4a2b';
    g.fillRect(19, trunkTop, 2, TEX_H - trunkTop);
    g.fillStyle = '#3a2a19';
    for (let i = 0; i < 3; i += 1) g.fillRect(14 + i * 2, trunkTop + 5 + i * 6, 5, 1);

    g.save();
    g.beginPath();
    g.ellipse(16, 27, 14, 18, 0, 0, Math.PI * 2);
    g.ellipse(7, 32, 6, 10, 0, 0, Math.PI * 2);
    g.ellipse(25, 32, 6, 10, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#2f5233';
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = '#3f6b40';
    for (let i = 0; i < 34; i += 1) {
      const hx = (i * 37) % (TEX_W - 4);
      const hy = (i * 53) % 46;
      g.fillRect(hx, hy, 5, 5);
    }
    g.fillStyle = '#4f7d4a';
    for (let i = 0; i < 18; i += 1) {
      g.fillRect((i * 29) % (TEX_W - 3), 2 + ((i * 41) % 38), 3, 3);
    }
    g.fillStyle = '#5f9160';
    for (let i = 0; i < 12; i += 1) {
      g.fillRect(3 + ((i * 23) % 18), 6 + ((i * 31) % 26), 2, 2);
    }
    g.fillStyle = '#233c27';
    for (let i = 0; i < 10; i += 1) {
      g.fillRect(4 + ((i * 19) % 24), 30 + ((i * 17) % 16), 4, 3);
    }
    g.restore();

    // recorte superior: fuera de la copa (solo por encima de la línea de ojos)
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.rect(0, 0, TEX_W, 36);
    g.ellipse(16, 27, 14, 18, 0, 0, Math.PI * 2);
    g.ellipse(7, 32, 6, 10, 0, 0, Math.PI * 2);
    g.ellipse(25, 32, 6, 10, 0, 0, Math.PI * 2);
    g.fill('evenodd');
    g.restore();

    // borde oscuro de la copa para que recorte contra el cielo
    g.save();
    g.beginPath();
    g.ellipse(16, 27, 14, 18, 0, 0, Math.PI * 2);
    g.ellipse(7, 32, 6, 10, 0, 0, Math.PI * 2);
    g.ellipse(25, 32, 6, 10, 0, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = '#28462c';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(16, 27, 14, 18, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  } else {
    // WALL: panelled wall with crown moulding, a baseboard and (on the top
    // wall) a real window instead of the old "window on every wall" pattern.
    g.fillStyle = colors.wall;
    g.fillRect(0, 0, TEX_W, TEX_H);
    g.fillStyle = shade(colors.wall, 8);
    g.fillRect(0, 0, TEX_W, 3);
    g.fillStyle = shade(colors.wall, 14);
    g.fillRect(0, 3, TEX_W, 2);
    g.fillStyle = shade(colors.wall, -12);
    g.fillRect(0, 5, TEX_W, 1);
    // vertical panelling
    g.fillStyle = shade(colors.wall, -7);
    for (let i = 1; i < 4; i += 1) g.fillRect(i * 8, 8, 1, TEX_H - 18);
    g.fillStyle = shade(colors.wall, 5);
    for (let i = 0; i < 4; i += 1) g.fillRect(i * 8 + 4, 8, 1, TEX_H - 18);
    // baseboard
    g.fillStyle = shade(colors.wall, -18);
    g.fillRect(0, TEX_H - 8, TEX_W, 8);
    g.fillStyle = shade(colors.wall, -6);
    g.fillRect(0, TEX_H - 8, TEX_W, 2);

    if (win) {
      // window: frame, sky-blue glass, mullions and a lit sill
      g.fillStyle = shade(colors.wall, -22);
      g.fillRect(4, 13, 24, 30);
      g.fillStyle = themeKey === 'light' ? '#cbe9ff' : '#7fa8dd';
      g.fillRect(6, 15, 20, 26);
      g.fillStyle = themeKey === 'light' ? '#eef9ff' : '#a8c8f0';
      g.fillRect(6, 15, 20, 9);
      g.fillStyle = themeKey === 'light' ? '#9dcdf2' : '#5c86bd';
      g.fillRect(6, 33, 20, 8);
      // clouds seen through the glass
      g.fillStyle = themeKey === 'light' ? '#ffffff' : '#c2d6f0';
      g.fillRect(9, 20, 6, 2);
      g.fillRect(11, 18, 4, 2);
      g.fillRect(19, 25, 5, 2);
      g.fillStyle = shade(colors.wall, -26);
      g.fillRect(15, 15, 2, 26);
      g.fillRect(6, 27, 20, 2);
      g.fillStyle = themeKey === 'light' ? '#e8f4ff' : '#8fb2e0';
      g.fillRect(7, 16, 3, 8);
      // sill
      g.fillStyle = shade(colors.wall, 18);
      g.fillRect(3, 43, 26, 3);
      g.fillStyle = shade(colors.wall, -4);
      g.fillRect(3, 46, 26, 1);
    }
  }

  // side + lamp shading (source-atop: con texturas recortadas no pinta fuera)
  const factor = FACTORS[light] * (side ? 0.84 : 1);
  g.globalCompositeOperation = 'source-atop';
  if (factor < 1) {
    g.fillStyle = `rgba(0, 0, 0, ${Math.min(0.6, (1 - factor) * 0.9)})`;
    g.fillRect(0, 0, TEX_W, TEX_H);
  } else if (factor > 1) {
    g.fillStyle = `rgba(255, 236, 198, ${(factor - 1) * 0.5})`;
    g.fillRect(0, 0, TEX_W, TEX_H);
  }
  g.globalCompositeOperation = 'source-over';
  return canvas;
}

function texture(type, roomIndex, light, side, themeKey, win) {
  const key = `${themeKey}|${type}|${roomIndex}|${light}|${side}|${win ? 1 : 0}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const canvas = makeTexture(type, roomIndex, light, side, themeKey, win);
  textureCache.set(key, canvas);
  return canvas;
}

// ---------------------------------------------------------------- sky ----

const skyStripCache = new Map();
const orbCache = new Map();
const cloudCache = new Map();

function skyStrip(themeKey) {
  if (skyStripCache.has(themeKey)) return skyStripCache.get(themeKey);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const grad = g.createLinearGradient(0, 256, 0, 0);
  if (themeKey === 'light') {
    grad.addColorStop(0, '#eaf6ff');
    grad.addColorStop(0.16, '#c9e6ff');
    grad.addColorStop(0.45, '#8ec3ee');
    grad.addColorStop(0.75, '#5a9ad9');
    grad.addColorStop(1, '#2f6cb4');
  } else {
    grad.addColorStop(0, '#46527a');
    grad.addColorStop(0.18, '#2f3d63');
    grad.addColorStop(0.5, '#1b2848');
    grad.addColorStop(1, '#070d1d');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 256);
  skyStripCache.set(themeKey, canvas);
  return canvas;
}

function orbSprite(themeKey) {
  if (orbCache.has(themeKey)) return orbCache.get(themeKey);
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const light = themeKey === 'light';
  const grad = g.createRadialGradient(size / 2, size / 2, 3, size / 2, size / 2, size / 2);
  grad.addColorStop(0, light ? 'rgba(255, 252, 226, 1)' : 'rgba(236, 243, 255, 1)');
  grad.addColorStop(0.16, light ? 'rgba(255, 242, 176, 0.96)' : 'rgba(198, 214, 246, 0.9)');
  grad.addColorStop(0.4, light ? 'rgba(255, 221, 140, 0.32)' : 'rgba(140, 166, 220, 0.2)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.fillStyle = light ? '#fffbe4' : '#eef4ff';
  g.beginPath();
  g.arc(size / 2, size / 2, light ? 11 : 8, 0, Math.PI * 2);
  g.fill();
  if (!light) {
    g.fillStyle = 'rgba(178, 194, 228, 0.75)';
    g.beginPath();
    g.arc(size / 2 - 3, size / 2 - 2, 2, 0, Math.PI * 2);
    g.arc(size / 2 + 3, size / 2 + 2, 1.5, 0, Math.PI * 2);
    g.fill();
  }
  orbCache.set(themeKey, canvas);
  return canvas;
}

function cloudSprite(themeKey, variant) {
  const key = `${themeKey}|${variant}`;
  if (cloudCache.has(key)) return cloudCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 40;
  const g = canvas.getContext('2d');
  const light = themeKey === 'light';
  const main = light ? 'rgba(255, 255, 255, 0.94)' : 'rgba(116, 134, 176, 0.42)';
  const soft = light ? 'rgba(226, 240, 255, 0.9)' : 'rgba(92, 110, 154, 0.34)';
  const shadeCol = light ? 'rgba(176, 204, 234, 0.9)' : 'rgba(70, 88, 132, 0.3)';
  const blocks = [
    [6, 22, 30, 9],
    [14, 14, 26, 12],
    [26, 8, 22, 12],
    [42, 14, 30, 10],
    [56, 20, 28, 9],
    [20, 30, 56, 5],
  ];
  const mirror = variant === 1;
  blocks.forEach(([bx, by, bw, bh], index) => {
    g.fillStyle = index === 2 ? soft : main;
    const x = mirror ? 96 - bx - bw : bx;
    g.fillRect(x, by, bw, bh);
  });
  g.fillStyle = shadeCol;
  const base = mirror ? 96 - 20 - 56 : 20;
  g.fillRect(base, 31, 56, 4);
  if (variant === 2) {
    g.fillStyle = soft;
    g.fillRect(mirror ? 8 : 70, 12, 16, 7);
  }
  cloudCache.set(key, canvas);
  return canvas;
}

const STARS = (() => {
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 118 }, () => ({
    az: rand() * Math.PI * 2,
    el: 0.24 + rand() * 0.72,
    size: rand() < 0.14 ? 3 : (rand() < 0.3 ? 2 : 1),
    phase: rand() * Math.PI * 2,
  }));
})();

/** Polvo estelar de la Vía Láctea: muchos puntos tenues siguiendo una banda. */
const DUST = (() => {
  let seed = 9241;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 220 }, () => ({
    az: rand() * Math.PI * 2,
    spread: rand() + rand() + rand() - 1.5,
    bright: rand(),
  }));
})();

/** Altura de la banda de la Vía Láctea para una dirección concreta. */
function milkyEl(az, spread) {
  return 0.52 + 0.13 * Math.sin(az * 1.35 + 0.6) + spread * 0.1;
}

const CLOUDS = [
  { az: 0.2, el: 0.62, scale: 1.3, variant: 0 },
  { az: 0.9, el: 0.78, scale: 0.9, variant: 1 },
  { az: 1.7, el: 0.55, scale: 1.5, variant: 2 },
  { az: 2.4, el: 0.72, scale: 1.05, variant: 0 },
  { az: 3.3, el: 0.6, scale: 1.35, variant: 1 },
  { az: 4.1, el: 0.83, scale: 0.8, variant: 2 },
  { az: 4.9, el: 0.58, scale: 1.2, variant: 0 },
  { az: 5.7, el: 0.74, scale: 1.0, variant: 1 },
];

function normAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

/** Paints the sky used behind transparent (outdoor) buffer pixels. */
function drawSky(g, camera, themeKey, horizon, time, width, height, tanHalf, azim) {
  if (horizon <= 1) return;
  const skyH = Math.max(1, Math.min(horizon, height));
  g.imageSmoothingEnabled = false;
  g.drawImage(skyStrip(themeKey), 0, 0, 1, 256, 0, 0, width, skyH);

  const light = themeKey === 'light';

  // Resplandor lejano pegado al horizonte: ciudad / último sol.
  const glowH = Math.max(2, skyH * (light ? 0.26 : 0.2));
  const glow = g.createLinearGradient(0, horizon, 0, horizon - glowH);
  if (light) {
    glow.addColorStop(0, 'rgba(255, 246, 214, 0.42)');
    glow.addColorStop(1, 'rgba(255, 246, 214, 0)');
  } else {
    glow.addColorStop(0, 'rgba(126, 154, 214, 0.22)');
    glow.addColorStop(1, 'rgba(126, 154, 214, 0)');
  }
  g.fillStyle = glow;
  g.fillRect(0, horizon - glowH, width, glowH);

  if (!light) {
    // Vía Láctea: banda difusa de polvo estelar antes de las estrellas.
    for (const dust of DUST) {
      const rel = normAngle(dust.az - camera.angle);
      if (Math.abs(rel) > 0.8) continue;
      const x = Math.round(width / 2 + (Math.tan(rel) / tanHalf) * (width / 2));
      if (x < 0 || x >= width) continue;
      const y = Math.round(horizon - skyH * milkyEl(dust.az, dust.spread));
      g.fillStyle = `rgba(198, 214, 255, ${(0.08 + dust.bright * 0.14).toFixed(3)})`;
      g.fillRect(x, y, 1, 1);
    }

    // estrellas (las más grandes con un pequeño destello en cruz)
    for (const star of STARS) {
      const rel = normAngle(star.az - camera.angle);
      if (Math.abs(rel) > 0.72) continue;
      const x = Math.round(width / 2 + (Math.tan(rel) / tanHalf) * (width / 2));
      if (x < 0 || x >= width) continue;
      const y = Math.round(horizon - skyH * star.el);
      const alpha = 0.45 + Math.sin(time * 1.7 + star.phase) * 0.3;
      g.fillStyle = `rgba(226, 238, 255, ${alpha.toFixed(3)})`;
      g.fillRect(x, y, star.size, star.size);
      if (star.size === 3) {
        g.fillStyle = `rgba(214, 232, 255, ${(alpha * 0.35).toFixed(3)})`;
        g.fillRect(x - 1, y + 1, star.size + 2, 1);
        g.fillRect(x + 1, y - 1, 1, star.size + 2);
      }
    }
  }

  // sol / luna
  const orbAz = light ? SUN_AZ : MOON_AZ;
  const relSun = normAngle(orbAz - camera.angle);
  if (Math.abs(relSun) < 1.25) {
    const x = width / 2 + (Math.tan(relSun) / tanHalf) * (width / 2);
    const y = horizon - skyH * (light ? 0.8 : 0.72);
    const size = height * (light ? 0.42 : 0.3);
    const drifts = light ? 1 : 1.12;
    g.globalAlpha = 0.92;
    g.drawImage(orbSprite(themeKey), x - (size * drifts) / 2, y - (size * drifts) / 2, size * drifts, size * drifts);
    g.globalAlpha = 1;
  }

  // nubes con deriva lenta
  for (const cloud of CLOUDS) {
    const rel = normAngle(cloud.az + time * 0.0035 - camera.angle);
    if (Math.abs(rel) > 0.86) continue;
    const x = width / 2 + (Math.tan(rel) / tanHalf) * (width / 2);
    const w = height * 0.34 * cloud.scale;
    const h = (w * 40) / 96;
    if (x + w < 0 || x - w > width) continue;
    const y = horizon - skyH * cloud.el;
    g.globalAlpha = light ? 0.92 : 0.6;
    g.drawImage(cloudSprite(themeKey, cloud.variant), x - w / 2, y - h / 2, w, h);
    g.globalAlpha = 1;
  }

  // horizonte: colinas lejanas + línea de árboles cercana
  const far = light ? '#82a98d' : '#273849';
  const near = light ? '#5f8a6d' : '#1a2835';
  g.fillStyle = far;
  for (let x = 0; x < width; x += 2) {
    const az = azim[x];
    const hill = (0.052 + 0.03 * Math.sin(az * 2.1 + 0.8) + 0.017 * Math.sin(az * 5.3 - 1.1)) * height;
    g.fillRect(x, horizon - hill, 2, hill + 2);
  }
  g.fillStyle = near;
  for (let x = 0; x < width; x += 3) {
    const az = azim[x];
    const trees = (0.024 + 0.016 * Math.sin(az * 7.3 + 2.1) + 0.009 * Math.sin(az * 13.7)) * height;
    if (trees > 1) g.fillRect(x, horizon - trees, 3, trees + 2);
  }
}

// -------------------------------------------------------------- agents ----

const agentSprites = new Map();
const AGENT_W = 64;
const AGENT_H = 80;

function agentSprite(agent, time) {
  let slot = agentSprites.get(agent.id);
  if (!slot) {
    const canvas = document.createElement('canvas');
    canvas.width = AGENT_W;
    canvas.height = AGENT_H;
    const ctx2 = canvas.getContext('2d');
    slot = {
      canvas,
      ctx: ctx2,
      proxy: {
        x: AGENT_W / 2,
        y: AGENT_H - 18,
        anim: 'idle',
        face: 1,
        seated: false,
        palette: agent.palette,
        seed: agent.seed,
        fade: 1,
        talking: false,
        bubble: null,
        partner: null,
        isSubagent: false,
        leaving: false,
        path: [],
        workState: 'idle',
        target: null,
        lash: 0,
        _pa: undefined,
        _hop: undefined,
      },
    };
    agentSprites.set(agent.id, slot);
  }
  const proxy = slot.proxy;
  proxy.anim = agent.anim;
  proxy.face = agent.face;
  proxy.seated = agent.seated;
  proxy.palette = agent.palette;
  proxy.seed = agent.seed;
  proxy.fade = agent.fade ?? 1;
  proxy.talking = agent.talking;
  proxy.bubble = agent.bubble;
  proxy.partner = agent.partner;
  proxy.isSubagent = agent.isSubagent;
  proxy.leaving = agent.leaving;
  proxy.path = agent.path || [];
  proxy.workState = agent.workState;
  proxy.target = agent.target;
  proxy.lash = agent.lash || 0;
  slot.ctx.clearRect(0, 0, AGENT_W, AGENT_H);
  drawAgent(slot.ctx, proxy, time);
  drawAgentProps(slot.ctx, time, proxy);

  // Los agentes se funden con la sala: sin esto brillan igual en un pasillo
  // oscuro que bajo un foco, y la escena parecía recortada.
  const cx = Math.floor(agent.x / TILE);
  const cy = Math.floor(agent.y / TILE);
  const light = (cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS) ? lightFlat[cy * COLS + cx] : 3;
  const darken = [0.38, 0.28, 0.16, 0.06, 0][light] ?? 0;
  if (darken > 0) {
    slot.ctx.globalCompositeOperation = 'source-atop';
    slot.ctx.fillStyle = `rgba(6, 10, 18, ${darken})`;
    slot.ctx.fillRect(0, 0, AGENT_W, AGENT_H);
    slot.ctx.globalCompositeOperation = 'source-over';
  }
  return { canvas: slot.canvas, w: AGENT_W / TILE, h: AGENT_H / TILE };
}

function pruneAgents(agents) {
  const alive = new Set(agents.map((agent) => agent.id));
  for (const id of agentSprites.keys()) if (!alive.has(id)) agentSprites.delete(id);
}

// --------------------------------------------------------------- scene ----

export function createFpScene() {
  const canvas = document.createElement('canvas');
  canvas.className = 'fp-canvas';
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let width = 340;
  let height = 190;
  let quality = 1;
  let imageData = null;
  let pixels = null;
  let zBuffer = new Uint16Array(width);
  const sprites = [];
  const skyCanvas = document.createElement('canvas');
  const skyCtx = skyCanvas.getContext('2d');
  skyCanvas.width = width;
  skyCanvas.height = height;

  function resize(cssWidth, cssHeight) {
    const aspect = cssHeight / Math.max(1, cssWidth || 1);
    const target = Math.round(340 * quality);
    const nextW = Math.max(220, Math.min(460, target));
    const nextH = Math.max(120, Math.min(320, Math.round(nextW * aspect)));
    if (nextW === width && nextH === height && imageData) return;
    width = nextW;
    height = nextH;
    canvas.width = width;
    canvas.height = height;
    skyCanvas.width = width;
    skyCanvas.height = height;
    ctx.imageSmoothingEnabled = false;
    skyCtx.imageSmoothingEnabled = false;
    imageData = ctx.createImageData(width, height);
    pixels = new Uint32Array(imageData.data.buffer);
    zBuffer = new Uint16Array(width);
    azimResize();
  }

  let azimBuf = new Float32Array(width);
  function azimResize() { azimBuf = new Float32Array(width); }

  function roomAt(px, py) {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return -1;
    return roomFlat[y * COLS + x];
  }

  /** Distance to the first solid column towards `angle` (also used for aiming). */
  function ray(px, py, angle, maxDist = 24) {
    const rayX = Math.cos(angle);
    const rayY = Math.sin(angle);
    let mapX = Math.floor(px);
    let mapY = Math.floor(py);
    const deltaX = Math.abs(1 / (rayX || 1e-6));
    const deltaY = Math.abs(1 / (rayY || 1e-6));
    let stepX; let stepY; let sideX; let sideY;
    if (rayX < 0) { stepX = -1; sideX = (px - mapX) * deltaX; } else { stepX = 1; sideX = (mapX + 1 - px) * deltaX; }
    if (rayY < 0) { stepY = -1; sideY = (py - mapY) * deltaY; } else { stepY = 1; sideY = (mapY + 1 - py) * deltaY; }
    for (let steps = 0; steps < 160; steps += 1) {
      let side;
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; } else { sideY += deltaY; mapY += stepY; side = 1; }
      const dist = side === 0 ? sideX - deltaX : sideY - deltaY;
      if (dist > maxDist) return maxDist;
      if (mapX < 0 || mapY < 0 || mapX >= COLS || mapY >= ROWS) return dist;
      if (OCCLUDERS.has(map[mapX][mapY])) return dist;
    }
    return maxDist;
  }

  function drawFloor(camera, dirX, dirY, planeX, planeY, themeKey, theme, outdoors, horizon) {
    const pal = palettes(themeKey, theme);
    const cameraX = camera.x;
    const cameraY = camera.y;
    const rayDirX0 = dirX - planeX;
    const rayDirY0 = dirY - planeY;
    const rayDirX1 = dirX + planeX;
    const rayDirY1 = dirY + planeY;
    const ceilScale = Math.max(0.4, CEIL - EYE);
    let needsSky = false;

    for (let y = 0; y < height; y += 1) {
      const below = y >= horizon;
      const distance = below
        ? (EYE * height) / Math.max(0.5, y - horizon + 0.001)
        : (ceilScale * height) / Math.max(0.5, horizon - y + 0.001);
      let index = y * width;
      const stepX = (distance * (rayDirX1 - rayDirX0)) / width;
      const stepY = (distance * (rayDirY1 - rayDirY0)) / width;
      let worldX = cameraX + distance * rayDirX0;
      let worldY = cameraY + distance * rayDirY0;
      for (let x = 0; x < width; x += 1) {
        const cellX = Math.floor(worldX);
        const cellY = Math.floor(worldY);
        if (cellX < 0 || cellY < 0 || cellX >= COLS || cellY >= ROWS) {
          if (below) pixels[index] = worldY > ROWS || worldX > COLS ? pal.outside : pal.grassB;
          else if (outdoors) { pixels[index] = TRANSPARENT; needsSky = true; } else pixels[index] = pal.roof;
        } else {
          const flat = cellY * COLS + cellX;
          const room = roomFlat[flat];
          const light = lightFlat[flat];
          if (room < 0) {
            if (below) pixels[index] = pal.outside;
            else if (outdoors) { pixels[index] = TRANSPARENT; needsSky = true; } else pixels[index] = pal.roof;
          } else if (!below) {
            if (room === PATIO_ROOM) {
              pixels[index] = TRANSPARENT;
              needsSky = true;
            } else {
              const row = pal.ceilings[room][light];
              const u = worldX - cellX;
              const v = worldY - cellY;
              const seam = u < 0.045 || v < 0.045;
              pixels[index] = seam ? row.line : (lampFlat[flat] ? row.lamp : row.base);
            }
          } else if (room === PATIO_ROOM) {
            const tile = map[cellX][cellY];
            if (tile === POND) {
              pixels[index] = ((cellX + cellY) & 1) ? pal.waterAlt : pal.water;
            } else {
              const row = pal.floors[room][light];
              const h = hash2(cellX, cellY);
              const speck = (h % 11) === 0;
              pixels[index] = speck ? row.speck : ((cellX + cellY) & 1 ? row.b : row.a);
            }
          } else {
            const row = pal.floors[room][light];
            const seam = worldX - cellX < 0.045 || worldY - cellY < 0.045;
            pixels[index] = seam ? row.line : ((cellX + cellY) & 1 ? row.b : row.a);
          }
        }
        index += 1;
        worldX += stepX;
        worldY += stepY;
      }
    }
    return needsSky;
  }

  function drawWalls(camera, dirX, dirY, planeX, planeY, themeKey, horizon) {
    const startX = Math.floor(camera.x);
    const startY = Math.floor(camera.y);
    for (let x = 0; x < width; x += 1) {
      const cameraX = (2 * x) / width - 1;
      const rayX = dirX + planeX * cameraX;
      const rayY = dirY + planeY * cameraX;
      let mapX = startX;
      let mapY = startY;
      const deltaX = Math.abs(1 / (rayX || 1e-6));
      const deltaY = Math.abs(1 / (rayY || 1e-6));
      let stepX; let stepY; let sideX; let sideY;
      if (rayX < 0) { stepX = -1; sideX = (camera.x - mapX) * deltaX; } else { stepX = 1; sideX = (mapX + 1 - camera.x) * deltaX; }
      if (rayY < 0) { stepY = -1; sideY = (camera.y - mapY) * deltaY; } else { stepY = 1; sideY = (mapY + 1 - camera.y) * deltaY; }
      let side = 0;
      let type = WALL;
      let roomIndex = 0;
      let light = 3;
      let win = false;
      let hit = false;
      let door = null;
      for (let steps = 0; steps < 160; steps += 1) {
        if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; } else { sideY += deltaY; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= COLS || mapY >= ROWS) { hit = true; type = WALL; break; }
        const tile = map[mapX][mapY];
        if (tile === DOOR && !door) {
          // la primera puerta que atraviesa el rayo: se dibuja su marco encima de la pared del fondo
          door = {
            side, rayX, rayY, mapX, mapY,
            distance: side === 0 ? sideX - deltaX : sideY - deltaY,
            light: lightFlat[mapY * COLS + mapX],
          };
        }
        if (OCCLUDERS.has(tile)) {
          hit = true;
          type = tile;
          const flat = mapY * COLS + mapX;
          roomIndex = roomFlat[flat];
          if (roomIndex < 0) {
            const ax = side === 0 ? mapX - stepX : mapX;
            const ay = side === 1 ? mapY - stepY : mapY;
            roomIndex = ax >= 0 && ay >= 0 && ax < COLS && ay < ROWS ? roomFlat[ay * COLS + ax] : -1;
          }
          if (roomIndex < 0) roomIndex = 0;
          light = lightFlat[flat];
          win = tile === WALL && side === 1 && mapY === 0 && rayY < 0 && isWindow(mapX);
          break;
        }
      }
      let distance = side === 0 ? sideX - deltaX : sideY - deltaY;
      if (!Number.isFinite(distance) || distance < 0.03) distance = 0.03;
      zBuffer[x] = Math.min(65535, Math.round(distance * 64));
      if (!hit) continue;
      // Niebla barata: las paredes lejanas usan un escalón de luz más oscuro.
      const fog = Math.min(3, Math.floor(distance / 4.5));
      const wallLight = Math.max(0, Math.min(4, light - fog));
      const bottom = horizon + (EYE * height) / distance;
      const top = horizon - ((CEIL - EYE) * height) / distance;
      const lineHeight = bottom - top;
      const tex = texture(type, roomIndex, wallLight, side, themeKey, win);
      let wallX = side === 0 ? camera.y + distance * rayY : camera.x + distance * rayX;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * TEX_W);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = TEX_W - 1 - texX;
      ctx.drawImage(tex, Math.max(0, Math.min(TEX_W - 1, texX)), 0, 1, TEX_H, x, top, 1, lineHeight);
      if (door) drawDoorFrame(x, door, camera, horizon);
    }
  }

  /** Marco de madera de una puerta: dintel con cartel y jambas laterales. */
  function drawDoorFrame(x, door, camera, horizon) {
    const d = Math.max(0.05, door.distance);
    const along = door.side === 0 ? camera.y + d * door.rayY : camera.x + d * door.rayX;
    const frac = along - Math.floor(along);
    const top = horizon - ((CEIL - EYE) * height) / d;
    const doorTop = horizon - ((DOOR_H - EYE) * height) / d;
    const bottom = horizon + (EYE * height) / d;
    const fog = Math.min(3, Math.floor(d / 4.5));
    const k = 0.5 + 0.12 * Math.max(0, Math.min(4, door.light - fog));
    const wood = `rgb(${Math.round(150 * k)}, ${Math.round(110 * k)}, ${Math.round(66 * k)})`;
    const dark = `rgb(${Math.round(84 * k)}, ${Math.round(58 * k)}, ${Math.round(32 * k)})`;
    if (frac < 0.09 || frac > 0.91) {
      ctx.fillStyle = wood;
      ctx.fillRect(x, top, 1, bottom - top);
      ctx.fillStyle = dark;
      ctx.fillRect(x, top, 1, bottom - top > 3 ? 1 : 0);
      zBuffer[x] = Math.min(zBuffer[x], Math.round(d * 64));
      return;
    }
    ctx.fillStyle = wood;
    ctx.fillRect(x, top, 1, Math.max(0, doorTop - top));
    ctx.fillStyle = dark;
    ctx.fillRect(x, doorTop - 2, 1, 2);
    if (door.mapX >= 33 && frac > 0.2 && frac < 0.8) {
      // cartel verde de la salida al patio sobre el dintel
      const h = Math.max(0, doorTop - top);
      ctx.fillStyle = `rgb(${Math.round(31 * k + 20)}, ${Math.round(110 * k + 30)}, ${Math.round(70 * k + 20)})`;
      ctx.fillRect(x, top + h * 0.2, 1, h * 0.55);
    }
  }

  function drawSprites(camera, dirX, dirY, planeX, planeY, agents, time, fireFrame, horizon) {
    sprites.length = 0;
    for (let x = 0; x < COLS; x += 1) {
      for (let y = 0; y < ROWS; y += 1) {
        const tile = map[x][y];
        if (!FURNITURE.has(tile)) continue;
        const sprite = propSprite(tile, fireFrame);
        if (!sprite) continue;
        sprites.push({ x: x + 0.5, y: y + 0.5, w: sprite.w, h: sprite.h, canvas: sprite.canvas });
      }
    }
    for (const agent of agents) {
      if (agent.fade !== undefined && agent.fade <= 0.02) continue;
      const sprite = agentSprite(agent, time);
      sprites.push({ x: agent.x / TILE, y: agent.y / TILE, w: sprite.w, h: sprite.h, canvas: sprite.canvas });
    }

    const invDet = 1 / (planeX * dirY - dirX * planeY || 1e-6);
    for (const sprite of sprites) {
      const dx = sprite.x - camera.x;
      const dy = sprite.y - camera.y;
      const transformX = invDet * (dirY * dx - dirX * dy);
      const depth = invDet * (-planeY * dx + planeX * dy);
      sprite.depth = depth;
      sprite.screenX = (width / 2) * (1 + transformX / (depth || 1e-6));
    }
    sprites.sort((a, b) => b.depth - a.depth);

    for (const sprite of sprites) {
      const depth = sprite.depth;
      if (depth <= 0.18) continue;
      const scale = height / depth;
      const spriteH = sprite.h * scale;
      const spriteW = sprite.w * scale;
      const bottom = horizon + (EYE * height) / depth;
      const top = bottom - spriteH;
      const left = sprite.screenX - spriteW / 2;
      if (left > width || left + spriteW < 0 || top > height || bottom < 0) continue;
      const from = Math.max(0, Math.floor(left));
      const to = Math.min(width - 1, Math.ceil(left + spriteW));
      const canvasW = sprite.canvas.width;
      const canvasH = sprite.canvas.height;
      let runStart = -1;
      for (let x = from; x <= to + 1; x += 1) {
        const visible = x <= to && zBuffer[x] > depth * 64;
        if (visible && runStart < 0) runStart = x;
        if (!visible && runStart >= 0) {
          const u0 = (runStart - left) / spriteW;
          const u1 = (x - left) / spriteW;
          const sx = Math.max(0, Math.min(canvasW, u0 * canvasW));
          const sw = Math.max(0.5, Math.min(canvasW - sx, (u1 - u0) * canvasW));
          ctx.drawImage(sprite.canvas, sx, 0, sw, canvasH, runStart, top, x - runStart, spriteH);
          runStart = -1;
        }
      }
    }
  }

  function render(camera, agents, time, options = {}) {
    const theme = themePalette();
    const themeKey = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const room = roomAt(camera.x, camera.y);
    const outdoors = room === PATIO_ROOM;
    const dirX = Math.cos(camera.angle);
    const dirY = Math.sin(camera.angle);
    const planeScale = Math.tan(FOV / 2);
    const planeX = -dirY * planeScale;
    const planeY = dirX * planeScale;
    const fireFrame = Math.floor(time * 7) % 4;

    // El horizonte se desplaza con la mirada (ratón), el balanceo al andar y
    // el latigazo; el resto de la escena se proyecta desde ahí.
    const jolt = camera.jolt ? (Math.random() - 0.5) * camera.jolt * height * 2.4 : 0;
    const horizon = height / 2 + ((camera.pitch || 0) + (camera.bob || 0)) * height + jolt;

    for (let x = 0; x < width; x += 1) {
      azimBuf[x] = camera.angle + Math.atan(((2 * x) / width - 1) * planeScale);
    }
    const needsSky = drawFloor(camera, dirX, dirY, planeX, planeY, themeKey, theme, outdoors, horizon);
    ctx.putImageData(imageData, 0, 0);
    if (needsSky) {
      // El cielo se pinta aparte y se compone por detrás del buffer: solo
      // rellena los píxeles que el raycaster dejó transparentes (el techo
      // descubierto del patio).
      skyCtx.clearRect(0, 0, width, height);
      drawSky(skyCtx, camera, themeKey, horizon, time, width, height, planeScale, azimBuf);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(skyCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawWalls(camera, dirX, dirY, planeX, planeY, themeKey, horizon);
    drawSprites(camera, dirX, dirY, planeX, planeY, agents, time, fireFrame, horizon);
    pruneAgents(agents);

    // viñeta barata (una sola pasada de gradiente por frame)
    if (!render._vignette || render._vw !== width || render._vh !== height) {
      const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.32, width / 2, height / 2, height * 0.82);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
      render._vignette = grad;
      render._vw = width;
      render._vh = height;
    }
    ctx.fillStyle = render._vignette;
    ctx.fillRect(0, 0, width, height);

    return { room, inside: !outdoors, ...options };
  }

  return {
    canvas,
    resize,
    render,
    ray,
    roomAt,
    getBuffer: () => ({ width, height }),
    setQuality(value) {
      const next = Math.max(0.72, Math.min(1, Number(value) || 1));
      if (next === quality) return;
      quality = next;
      imageData = null;
      width = 0;
      height = 0;
    },
  };
}
