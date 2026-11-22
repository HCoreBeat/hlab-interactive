'use strict';

/**
 * Lighting of the office: ceiling lamps that pour light on the floor, daylight
 * coming through the windows of the top wall and soft shadows under the
 * furniture. Everything is drawn with gradients and translucent shapes.
 */

import { TILE, LAMPS, WINDOWS, VIEW_W, VIEW_H, COLS } from './floor-plan.js';

function radialPool(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.10)'));
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Warm pools of light under every ceiling lamp. */
export function drawLamps(ctx, palette) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (const room of Object.keys(LAMPS)) {
    for (const [tx, ty] of LAMPS[room]) {
      const x = tx * TILE;
      const y = ty * TILE;
      radialPool(ctx, x, y, TILE * 1.2, palette.lamp);
      ctx.fillStyle = palette.lampCore;
      ctx.beginPath();
      ctx.ellipse(x, y, TILE * 0.09, TILE * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Daylight: bright windows on the top wall and their beams on the floor. */
export function drawDaylight(ctx, palette) {
  ctx.save();
  for (const [wx, width] of WINDOWS) {
    const x = wx * TILE;
    const w = width * TILE;

    // beam falling to the right
    ctx.fillStyle = palette.beam;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + TILE * 0.75, TILE * 2.8);
    ctx.lineTo(x + TILE * 0.75, TILE * 2.8);
    ctx.closePath();
    ctx.fill();

    // window frame on the wall
    ctx.fillStyle = palette.sky;
    ctx.fillRect(x + 2, 2, w - 4, TILE - 8);
    ctx.fillStyle = palette.lampCore;
    ctx.fillRect(x + 2, 2, w - 4, 4);
  }
  ctx.restore();
}

/** Soft shadow cast by a piece of furniture. */
export function drawShadow(ctx, palette, x, y, w, h) {
  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x + 3, y + 5, w, h);
}

/** Global ambience: a soft daylight gradient over the whole plan. */
export function drawAmbience(ctx, palette) {
  const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  gradient.addColorStop(0, palette.sky);
  gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

export const OUTSIDE_TINT = COLS;
