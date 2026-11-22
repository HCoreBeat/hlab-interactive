'use strict';

/**
 * Objetos y detalles que acompañan las acciones de los agentes: taza de café,
 * vaso de agua, hoja de la impresora, "zzz", luces de las máquinas, etc.
 * Se dibujan encima del agente, en coordenadas del plano.
 */

import { TILE } from './floor-plan.js';

/** Tipo de descanso según la casilla: café, agua o impresora. */
export function breakKind(agent) {
  const t = agent.target;
  if (!t) return 'coffee';
  if (t.x <= 2) return 'print';
  if (t.x === 9 && t.y >= 5) return 'water';
  return 'coffee';
}

/** Texto del estado de descanso según lo que hace. */
export const BREAK_LABEL = { coffee: 'tomando café', water: 'bebiendo agua', print: 'imprimiendo' };

/** Globo de diálogo junto a la cabeza del que habla. */
function speech(ctx, time, agent, f) {
  const x = Math.round(agent.x) + f * 22;
  const y = Math.round(agent.y) - 26;
  const icon = agent.bubble || 'dots';
  ctx.fillStyle = 'rgba(245, 247, 252, 0.96)';
  ctx.fillRect(x - 11, y - 8, 22, 15);
  ctx.fillRect(x - f * 9 - 1, y + 5, 3, 3);
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = icon === 'heart' ? '#e0506a' : icon === 'bang' ? '#d9822b' : '#2b3240';
  const glyph = {
    dots: '.'.repeat(1 + (Math.floor(time * 3) % 3)),
    heart: '\u2665',
    laugh: 'ja',
    question: '?',
    bang: '!',
    note: '\u266a',
  }[icon] || '...';
  ctx.fillText(glyph, x, y + 3);
  ctx.textAlign = 'left';
}

function steam(ctx, time, x, y, seed) {
  for (let i = 0; i < 3; i += 1) {
    const p = (time * 0.9 + i / 3 + seed) % 1;
    ctx.globalAlpha = (1 - p) * 0.7;
    ctx.fillStyle = '#f2f5fa';
    ctx.fillRect(Math.round(x + Math.sin(p * 8 + i) * 2), Math.round(y - p * 12), 2, 3);
  }
  ctx.globalAlpha = 1;
}

export function drawAgentProps(ctx, time, agent) {
  if (agent.leaving || agent.path.length) return;
  const f = agent.face < 0 ? -1 : 1;
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const a = agent.anim;
  if (agent.talking && a !== 'meet') speech(ctx, time, agent, f);

  if (a === 'break') {
    const kind = breakKind(agent);
    const sip = Math.max(0, Math.sin(time * 1.1 + agent.seed));
    const cx = x + f * 11;
    const cy = y - 8 - sip * 8;
    if (kind === 'coffee') {
      ctx.fillStyle = '#f4f7fb';
      ctx.fillRect(cx - 3, cy, 6, 6);
      ctx.fillStyle = '#6b4a35';
      ctx.fillRect(cx - 2, cy + 1, 4, 2);
      ctx.fillStyle = '#f4f7fb';
      ctx.fillRect(cx + (f > 0 ? 3 : -5), cy + 1, 2, 3);
      steam(ctx, time, cx, cy, agent.seed);
      // la m\u00e1quina parpadea mientras sirve
      ctx.fillStyle = Math.sin(time * 6) > 0 ? '#9be7ff' : '#3d6a7c';
      ctx.fillRect(10 * TILE + 14, 2 * TILE + 16, 3, 3);
    } else if (kind === 'water') {
      // vaso alto y transparente (sin vapor) y burbujas subiendo en el botellón
      ctx.fillStyle = 'rgba(205, 238, 255, 0.85)';
      ctx.fillRect(cx - 3, cy - 2, 6, 10);
      ctx.fillStyle = '#4f9fe0';
      ctx.fillRect(cx - 2, cy + 2, 4, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 3, cy - 2, 6, 1);
      for (let i = 0; i < 3; i += 1) {
        const p = (time * 0.9 + i / 3) % 1;
        ctx.fillStyle = `rgba(255, 255, 255, ${0.9 - p * 0.7})`;
        ctx.fillRect(10 * TILE + 16 + i * 4, 6 * TILE + 16 - p * 11, 2, 2);
      }
      ctx.fillStyle = Math.sin(time * 5) > 0 ? '#4f9fe0' : '#9be7ff';
      ctx.fillRect(10 * TILE + 15, 6 * TILE + 22, 3, 3);
    } else {
      // la impresora saca una hoja que el agente recoge
      const p = (time * 0.5) % 1;
      ctx.fillStyle = '#f7f9fc';
      ctx.fillRect(1 * TILE + 12, 4 * TILE + 8 + p * 10, 14, 7);
      ctx.fillStyle = 'rgba(80, 90, 110, 0.7)';
      ctx.fillRect(1 * TILE + 14, 4 * TILE + 10 + p * 10, 9, 1);
      ctx.fillStyle = Math.sin(time * 8) > 0 ? '#6ff0b8' : '#2f6d58';
      ctx.fillRect(1 * TILE + 28, 4 * TILE + 20, 3, 3);
      ctx.fillStyle = '#f7f9fc';
      ctx.fillRect(cx - 4, cy + 2, 8, 6);
    }
  } else if (a === 'nap') {
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i += 1) {
      const p = (time * 0.45 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(p * Math.PI);
      ctx.fillStyle = '#b6c2ff';
      ctx.fillText('z', x + f * (8 + p * 12), y - 24 - p * 18);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  } else if (a === 'dance') {
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i += 1) {
      const p = (time * 0.7 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(p * Math.PI);
      ctx.fillStyle = ['#ffd98a', '#9be7ff', '#f5b6d6'][i];
      ctx.fillText('\u266a', x + (i - 1) * 14 + Math.sin(p * 6 + i) * 3, y - 30 - p * 16);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  } else if (a === 'book') {
    ctx.fillStyle = '#4a6fa8';
    ctx.fillRect(x - 7, y - 9, 14, 9);
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(x - 6, y - 8, 5, 7);
    ctx.fillRect(x + 1, y - 8, 5, 7);
    ctx.fillStyle = 'rgba(60, 70, 90, 0.5)';
    ctx.fillRect(x - 5, y - 6, 3, 1);
    ctx.fillRect(x + 2, y - 6, 3, 1);
    if (Math.sin(time * 0.8 + agent.seed) > 0.96) ctx.fillRect(x + 1, y - 8, 5, 7);
  } else if (a === 'phone') {
    // ondas de la llamada
    const p = (time * 1.4) % 1;
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = '#9be7ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + f * 12, y - 22, 4 + p * 7, -0.9, 0.9);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (a === 'write') {
    ctx.fillStyle = '#3b6fd8';
    ctx.fillRect(x + f * (9 + Math.sin(time * 9) * 2) - 1, y - 20, 2, 4);
  } else if (a === 'stretch') {
    const up = Math.abs(Math.sin(time * 1.5 + agent.seed));
    if (up > 0.85) {
      ctx.fillStyle = '#d8ecff';
      ctx.fillRect(x - 14, y - 12, 2, 4);
      ctx.fillRect(x + 12, y - 12, 2, 4);
    }
  } else if (a === 'error') {
    ctx.globalAlpha = 0.7 + Math.sin(time * 10) * 0.3;
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(x + f * 15, y - 40, 3, 8);
    ctx.fillRect(x + f * 15, y - 30, 3, 3);
    ctx.globalAlpha = 1;
  }
}
