'use strict';

/**
 * Billboard sprites for the first-person view.
 *
 * Every piece of low furniture is painted front-facing with plain rectangles,
 * using the same palette and light direction as `sprites.js`, and cached in a
 * canvas so the raycaster can scale it per distance without repainting.
 */

import {
  DESK, CHAIR, TABLE, PLANT, TERMINAL, COFFEE, COOLER, PRINTER,
  BENCH, PICNIC, HOOP, FLOWERS, FIREPIT,
} from './floor-plan.js';

const CACHE = new Map();

function paint(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g);
  return canvas;
}

function desk(g) {
  // monitor + stand
  g.fillStyle = '#2b3240';
  g.fillRect(13, 0, 14, 10);
  g.fillStyle = '#4fc3e8';
  g.fillRect(15, 2, 10, 6);
  g.fillStyle = 'rgba(226, 250, 255, 0.9)';
  g.fillRect(16, 3, 5, 1);
  g.fillRect(16, 5, 7, 1);
  g.fillStyle = '#39404f';
  g.fillRect(19, 10, 3, 2);
  // surface
  g.fillStyle = '#7a5a3a';
  g.fillRect(2, 12, 36, 3);
  g.fillStyle = '#8f6c47';
  g.fillRect(2, 12, 36, 1);
  // body
  g.fillStyle = '#5a4130';
  g.fillRect(2, 15, 36, 7);
  g.fillStyle = '#4a3628';
  g.fillRect(2, 20, 36, 2);
  // drawers
  g.fillStyle = '#6b4d36';
  g.fillRect(5, 16, 11, 2);
  g.fillRect(24, 16, 11, 2);
  // keyboard + mug
  g.fillStyle = '#3f4654';
  g.fillRect(9, 13, 16, 1);
  g.fillStyle = '#f0f3f8';
  g.fillRect(29, 10, 4, 3);
}

function chair(g) {
  g.fillStyle = '#3d4655';
  g.fillRect(2, 0, 18, 11);
  g.fillStyle = '#5a6478';
  g.fillRect(2, 0, 18, 3);
  g.fillStyle = '#333b48';
  g.fillRect(2, 11, 18, 3);
  g.fillStyle = '#2b323e';
  g.fillRect(4, 14, 2, 4);
  g.fillRect(16, 14, 2, 4);
}

function table(g) {
  g.fillStyle = '#946c42';
  g.fillRect(1, 2, 38, 4);
  g.fillStyle = '#7a5734';
  g.fillRect(1, 6, 38, 2);
  g.fillStyle = '#f2f5fa';
  g.fillRect(8, 0, 8, 3);
  g.fillStyle = '#a9824f';
  g.fillRect(22, 0, 7, 3);
  g.fillStyle = '#5c4026';
  g.fillRect(4, 8, 3, 10);
  g.fillRect(33, 8, 3, 10);
}

function plant(g) {
  g.fillStyle = '#3f6b40';
  g.beginPath();
  g.ellipse(14, 12, 11, 9, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5c9159';
  g.beginPath();
  g.ellipse(10, 8, 6, 6, 0, 0, Math.PI * 2);
  g.ellipse(19, 9, 5, 5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#a9714a';
  g.fillRect(8, 28, 12, 10);
  g.fillStyle = '#c08a5d';
  g.fillRect(8, 28, 12, 3);
  g.fillStyle = '#7d5233';
  g.fillRect(8, 37, 12, 1);
}

function terminal(g) {
  g.fillStyle = '#1b2430';
  g.fillRect(2, 2, 22, 18);
  g.fillStyle = '#2a7f63';
  g.fillRect(4, 4, 18, 13);
  g.fillStyle = '#7dffc4';
  g.fillRect(6, 6, 10, 2);
  g.fillRect(6, 10, 13, 1);
  g.fillRect(6, 12, 7, 1);
  g.fillStyle = '#1b2430';
  g.fillRect(10, 20, 6, 4);
  g.fillStyle = '#4d5a70';
  g.fillRect(13, 0, 2, 4);
  g.fillStyle = '#8dffc9';
  g.fillRect(12, 0, 4, 2);
}

function coffee(g) {
  g.fillStyle = '#3a3f4b';
  g.fillRect(3, 10, 20, 28);
  g.fillStyle = '#4a5060';
  g.fillRect(3, 10, 20, 3);
  g.fillStyle = '#e06c4a';
  g.fillRect(3, 5, 20, 5);
  g.fillStyle = '#1b2029';
  g.fillRect(6, 16, 14, 10);
  g.fillStyle = '#9be7ff';
  g.fillRect(8, 18, 3, 3);
  g.fillStyle = '#f0f3f8';
  g.fillRect(10, 28, 7, 6);
  g.fillStyle = '#6b4a35';
  g.fillRect(11, 29, 5, 2);
  g.fillStyle = '#2b3240';
  g.fillRect(3, 35, 20, 3);
}

function cooler(g) {
  g.fillStyle = '#8fd4f2';
  g.fillRect(6, 0, 12, 13);
  g.fillStyle = '#c9eefc';
  g.fillRect(8, 2, 3, 8);
  g.fillStyle = '#d7dde8';
  g.fillRect(5, 13, 14, 27);
  g.fillStyle = '#9aa6b8';
  g.fillRect(5, 13, 14, 3);
  g.fillStyle = '#4f9fe0';
  g.fillRect(8, 19, 3, 3);
  g.fillStyle = '#e0605c';
  g.fillRect(14, 19, 3, 3);
  g.fillStyle = '#2b3240';
  g.fillRect(5, 37, 14, 3);
}

function printer(g) {
  g.fillStyle = '#d8dde6';
  g.fillRect(2, 8, 28, 12);
  g.fillStyle = '#aab3c2';
  g.fillRect(2, 8, 28, 3);
  g.fillStyle = '#f7f9fc';
  g.fillRect(7, 2, 16, 6);
  g.fillStyle = '#2b3240';
  g.fillRect(6, 17, 20, 2);
  g.fillStyle = '#6ff0b8';
  g.fillRect(25, 13, 3, 3);
}

function bench(g) {
  g.fillStyle = '#8a6a46';
  g.fillRect(0, 2, 40, 4);
  g.fillStyle = '#6b5334';
  g.fillRect(0, 6, 40, 2);
  g.fillStyle = '#5a4228';
  g.fillRect(3, 8, 3, 8);
  g.fillRect(34, 8, 3, 8);
}

function picnic(g) {
  g.fillStyle = '#a8763f';
  g.fillRect(2, 4, 36, 4);
  g.fillStyle = '#8a5f33';
  g.fillRect(2, 8, 36, 2);
  g.fillStyle = '#6b4a28';
  g.fillRect(6, 10, 3, 10);
  g.fillRect(31, 10, 3, 10);
  g.fillStyle = '#f2f5fa';
  g.fillRect(16, 1, 8, 3);
  g.fillStyle = '#e06c4a';
  g.fillRect(18, 0, 4, 2);
}

function hoop(g) {
  g.fillStyle = '#4d5a70';
  g.fillRect(10, 10, 3, 52);
  g.fillStyle = '#2b3240';
  g.fillRect(3, 0, 18, 12);
  g.fillStyle = '#f4f7fb';
  g.fillRect(5, 2, 14, 8);
  g.fillStyle = '#e06c4a';
  g.fillRect(10, 10, 6, 2);
  g.fillRect(12, 12, 2, 4);
}

function flowers(g) {
  g.fillStyle = '#3f6b40';
  g.fillRect(2, 8, 20, 4);
  const petals = ['#e06c75', '#e5c07b', '#c678dd', '#8ecbff'];
  for (let i = 0; i < 5; i += 1) {
    g.fillStyle = petals[i % petals.length];
    g.fillRect(3 + i * 4, 2 + (i % 2) * 2, 3, 3);
    g.fillStyle = '#5c9159';
    g.fillRect(4 + i * 4, 5 + (i % 2) * 2, 1, 4);
  }
}

function firepit(g, frame) {
  g.fillStyle = '#5b5348';
  g.fillRect(0, 10, 30, 6);
  g.fillStyle = '#3b3630';
  g.fillRect(2, 8, 26, 3);
  // logs
  g.fillStyle = '#5a3b22';
  g.fillRect(7, 6, 16, 3);
  g.fillStyle = '#7a4f2b';
  g.fillRect(9, 4, 12, 2);
  // flame, four frames
  const tall = [7, 10, 8, 10][frame % 4];
  g.fillStyle = '#e8663c';
  g.fillRect(13, 4 - tall, 5, tall);
  g.fillStyle = '#f0b45e';
  g.fillRect(14, 5 - tall, 3, Math.max(2, tall - 2));
  g.fillStyle = '#ffe6a6';
  g.fillRect(15, 6 - tall, 1, 3);
}

const BUILDERS = {
  [DESK]: { w: 40, h: 22, draw: desk },
  [CHAIR]: { w: 22, h: 18, draw: chair },
  [TABLE]: { w: 40, h: 18, draw: table },
  [PLANT]: { w: 28, h: 38, draw: plant },
  [TERMINAL]: { w: 26, h: 26, draw: terminal },
  [COFFEE]: { w: 26, h: 38, draw: coffee },
  [COOLER]: { w: 24, h: 40, draw: cooler },
  [PRINTER]: { w: 32, h: 20, draw: printer },
  [BENCH]: { w: 40, h: 16, draw: bench },
  [PICNIC]: { w: 40, h: 20, draw: picnic },
  [HOOP]: { w: 24, h: 64, draw: hoop },
  [FLOWERS]: { w: 24, h: 12, draw: flowers },
  [FIREPIT]: { w: 30, h: 16, draw: (g) => firepit(g, 0) },
};

/** Sprite (canvas + world size) for one tile type; `frame` animates the fire. */
export function propSprite(type, frame = 0) {
  const builder = BUILDERS[type];
  if (!builder) return null;
  const animated = type === FIREPIT;
  const key = animated ? `${type}:${frame % 4}` : String(type);
  const hit = CACHE.get(key);
  if (hit) return hit;
  const canvas = animated
    ? paint(builder.w, builder.h, (g) => firepit(g, frame))
    : paint(builder.w, builder.h, builder.draw);
  const sprite = { canvas, w: builder.w / 40, h: builder.h / 40 };
  CACHE.set(key, sprite);
  return sprite;
}
