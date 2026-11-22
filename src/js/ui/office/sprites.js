'use strict';

/**
 * Pixel-art sprites for the office. Everything is drawn with plain rectangles
 * on the canvas: no image assets, no dependencies, crisp at any scale.
 * Colours are lit as if the light comes from the top-left of the screen.
 */

import { TILE, shade, rgba } from './floor-plan.js';

export function drawDesk(ctx, x, y, time) {
  // top of the desk (lit)
  ctx.fillStyle = '#7a5a3a';
  ctx.fillRect(x + 4, y + 8, TILE - 8, 6);
  // front of the desk (shadowed)
  ctx.fillStyle = '#5a4130';
  ctx.fillRect(x + 4, y + 14, TILE - 8, TILE - 22);
  // monitor
  ctx.fillStyle = '#2b3240';
  ctx.fillRect(x + 11, y + 5, 18, 15);
  ctx.fillStyle = '#4fc3e8';
  ctx.fillRect(x + 13, y + 7, 14, 11);
  ctx.fillStyle = 'rgba(220, 250, 255, 0.85)';
  const glow = 4 + Math.round((Math.sin(time * 3 + x) + 1) * 2);
  ctx.fillRect(x + 14, y + 9, glow, 2);
  ctx.fillRect(x + 14, y + 12, 9, 1);
  ctx.fillStyle = '#2b3240';
  ctx.fillRect(x + 18, y + 20, 4, 3);
  // keyboard + mug
  ctx.fillStyle = '#4a5262';
  ctx.fillRect(x + 11, y + 25, 18, 4);
  ctx.fillStyle = '#f0f3f8';
  ctx.fillRect(x + 7, y + 23, 4, 5);
}

export function drawChair(ctx, x, y, occupied) {
  ctx.fillStyle = '#3d4655';
  ctx.fillRect(x + 12, y + 12, 16, 12);
  ctx.fillStyle = '#5a6478';
  ctx.fillRect(x + 12, y + 12, 16, 5);
  ctx.fillStyle = '#2b323e';
  ctx.fillRect(x + 12, y + 24, 16, 3);
  if (occupied) {
    ctx.fillStyle = 'rgba(240, 180, 94, 0.22)';
    ctx.fillRect(x + 12, y + 12, 16, 15);
  }
}

export function drawRack(ctx, x, y, time, seed) {
  ctx.fillStyle = '#2a3240';
  ctx.fillRect(x + 4, y + 2, TILE - 8, TILE - 4);
  ctx.fillStyle = '#414c60';
  ctx.fillRect(x + 4, y + 2, TILE - 8, 4);
  for (let row = 0; row < 4; row += 1) {
    ctx.fillStyle = '#141922';
    ctx.fillRect(x + 7, y + 8 + row * 7, TILE - 14, 5);
    const on = Math.sin(time * 2.4 + seed + row) > -0.2;
    ctx.fillStyle = on ? '#6ff0b8' : '#3d6a5c';
    ctx.fillRect(x + 9, y + 9 + row * 7, 3, 3);
    ctx.fillStyle = row % 2 ? '#ffd98a' : '#8ecbff';
    ctx.fillRect(x + 14, y + 10 + row * 7, 6, 1);
  }
}

export function drawShelf(ctx, x, y) {
  ctx.fillStyle = '#6b5334';
  ctx.fillRect(x + 5, y + 1, TILE - 10, TILE - 2);
  ctx.fillStyle = '#8a6c46';
  ctx.fillRect(x + 5, y + 1, TILE - 10, 3);
  for (let row = 0; row < 4; row += 1) {
    ctx.fillStyle = '#46321f';
    ctx.fillRect(x + 7, y + 6 + row * 8, TILE - 14, 2);
    ctx.fillStyle = ['#d79bf0', '#7cc0ff', '#ffd98a', '#a9dd8f'][row % 4];
    ctx.fillRect(x + 8, y + 2 + row * 8, 4, 4);
    ctx.fillStyle = ['#a9dd8f', '#f08a8a', '#7fd8de'][row % 3];
    ctx.fillRect(x + 13, y + 2 + row * 8, 4, 4);
  }
}

export function drawTable(ctx, x, y) {
  ctx.fillStyle = '#7a5734';
  ctx.fillRect(x + 1, y + 8, TILE - 2, TILE - 14);
  ctx.fillStyle = '#946c42';
  ctx.fillRect(x + 1, y + 8, TILE - 2, 5);
  ctx.fillStyle = '#f2f5fa';
  ctx.fillRect(x + 8, y + 16, 9, 6);
  ctx.fillStyle = '#a9824f';
  ctx.fillRect(x + 22, y + 17, 7, 5);
}

export function drawPlant(ctx, x, y) {
  ctx.fillStyle = '#3f6b40';
  ctx.beginPath();
  ctx.ellipse(x + 20, y + 18, 11, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c9159';
  ctx.beginPath();
  ctx.ellipse(x + 17, y + 13, 6, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 25, y + 15, 5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#a9714a';
  ctx.fillRect(x + 14, y + 25, 12, 9);
  ctx.fillStyle = '#c08a5d';
  ctx.fillRect(x + 14, y + 25, 12, 3);
}

export function drawTerminal(ctx, x, y, time, online) {
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(x + 5, y + 4, TILE - 10, TILE - 12);
  ctx.fillStyle = online ? '#2a7f63' : '#414c60';
  ctx.fillRect(x + 8, y + 7, TILE - 16, TILE - 20);
  ctx.fillStyle = online ? '#7dffc4' : '#7b8798';
  const pulse = 3 + Math.round((Math.sin(time * 4 + x) + 1) * 1.5);
  ctx.fillRect(x + 11, y + 11, TILE - 22, pulse);
  ctx.fillRect(x + 11, y + 16, TILE - 26, 1);
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(x + 15, y + TILE - 10, 10, 4);
  // antenna with link LED
  ctx.fillStyle = '#4d5a70';
  ctx.fillRect(x + 19, y, 2, 5);
  ctx.fillStyle = online ? '#8dffc9' : '#8a94a6';
  ctx.fillRect(x + 18, y - 1, 4, 3);
}

export function drawCoffee(ctx, x, y) {
  ctx.fillStyle = '#3a3f4b'; ctx.fillRect(x + 8, y + 6, 24, 28);
  ctx.fillStyle = '#e06c4a'; ctx.fillRect(x + 8, y + 6, 24, 5);
  ctx.fillStyle = '#1b2029'; ctx.fillRect(x + 12, y + 14, 16, 10);
  ctx.fillStyle = '#9be7ff'; ctx.fillRect(x + 14, y + 16, 3, 3);
  ctx.fillStyle = '#f0f3f8'; ctx.fillRect(x + 17, y + 25, 7, 6);
  ctx.fillStyle = '#6b4a35'; ctx.fillRect(x + 18, y + 26, 5, 2);
}

export function drawCooler(ctx, x, y) {
  ctx.fillStyle = '#8fd4f2'; ctx.fillRect(x + 12, y + 3, 16, 14);
  ctx.fillStyle = '#c9eefc'; ctx.fillRect(x + 14, y + 5, 4, 8);
  ctx.fillStyle = '#d7dde8'; ctx.fillRect(x + 11, y + 17, 18, 17);
  ctx.fillStyle = '#9aa6b8'; ctx.fillRect(x + 11, y + 17, 18, 3);
  ctx.fillStyle = '#4f9fe0'; ctx.fillRect(x + 15, y + 22, 3, 3);
  ctx.fillStyle = '#e0605c'; ctx.fillRect(x + 22, y + 22, 3, 3);
}

export function drawPrinter(ctx, x, y) {
  ctx.fillStyle = '#d8dde6'; ctx.fillRect(x + 6, y + 14, 28, 16);
  ctx.fillStyle = '#aab3c2'; ctx.fillRect(x + 6, y + 14, 28, 4);
  ctx.fillStyle = '#f7f9fc'; ctx.fillRect(x + 11, y + 8, 18, 8);
  ctx.fillStyle = '#2b3240'; ctx.fillRect(x + 10, y + 24, 20, 3);
  ctx.fillStyle = '#6ff0b8'; ctx.fillRect(x + 28, y + 20, 3, 3);
}

export function drawBoard(ctx, x, y, w) {
  ctx.fillStyle = '#6b5334'; ctx.fillRect(x - 2, y - 2, w + 4, 30);
  ctx.fillStyle = '#f4f7fb'; ctx.fillRect(x, y, w, 26);
  ctx.fillStyle = '#c9d3e2'; ctx.fillRect(x, y + 22, w, 4);
}

/** Wall clock showing the real local time. */
export function drawClock(ctx, x, y) {
  const d = new Date();
  const hour = (((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  const min = (d.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
  ctx.fillStyle = '#2b3240';
  ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f4f7fb';
  ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2b3240'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(hour) * 6, y + Math.sin(hour) * 6);
  ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(min) * 9, y + Math.sin(min) * 9);
  ctx.stroke();
}

/** A chunky little humanoid, 20x34 logical pixels. */
function drawAgentBody(ctx, agent, time) {
  const { shirt, hair, skin } = agent.palette;
  const a = agent.anim;
  const bob = a === 'walk' ? Math.abs(Math.sin(time * 11)) * -2.2
    : a === 'dance' ? -Math.abs(Math.sin(time * 7 + agent.seed)) * 3
    : (a === 'code' || a === 'terminal') ? Math.sin(time * 9 + agent.seed) * 0.5
      : a === 'error' ? 0 : Math.sin(time * 1.6 + agent.seed) * 0.8;
  const hop = agent.hop ? -Math.sin(agent.hop * Math.PI) * 4 : 0;
  // Latigazo: el agente tiembla y encoge la cabeza unos instantes.
  const lash = Math.max(0, Math.min(1, agent.lash || 0));
  const shiver = lash > 0.02 ? Math.sin(time * 52 + agent.seed * 9) * 1.9 * lash : 0;
  const recoil = lash > 0.02 ? -Math.sin(lash * Math.PI) * 2.6 : 0;
  const x = Math.round(agent.x + shiver + (a === 'error' ? Math.sin(time * 40) * 1.2 : a === 'dance' ? Math.sin(time * 3.5 + agent.seed) * 2 : 0));
  const y = Math.round(agent.y + bob + hop + recoil);
  const blink = a === 'nap' || (time * 0.9 + agent.seed * 3) % 4.2 < 0.13;
  const look = (a === 'idle' || a === 'think' || a === 'meet' || a === 'chill' || a === 'chat') && !agent.partner ? Math.round(Math.sin(time * 0.7 + agent.seed * 2) * 1.3) : 0;
  const nod = (a === 'code' || a === 'terminal' || a === 'book') ? 1 : a === 'nap' ? 3 : a === 'phone' ? -1
    : (agent.partner && !agent.talking) ? Math.round(Math.max(0, Math.sin(time * 3.2 + agent.seed)) * 1) : 0;
  const talk = (a === 'meet' || a === 'chat' || agent.talking) && Math.sin(time * 14 + agent.seed) > 0;

  // presence glow so the agents read clearly at office scale
  ctx.fillStyle = rgba(shirt, 0.2);
  ctx.beginPath();
  ctx.ellipse(x, y + 13, 15, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.beginPath();
  ctx.ellipse(x, y + 15, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const px = (dx, dy, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, y + dy, w, h);
  };

  const swing = agent.anim === 'walk' ? Math.sin(time * 12) * 2.2 : 0;
  px(-6 + swing, 5, 5, 8, '#333a49');
  px(2 - swing, 5, 5, 8, '#333a49');
  px(-6 + swing, 13, 5, 3, '#1c2029');
  px(2 - swing, 13, 5, 3, '#1c2029');

  px(-8, -6, 16, 12, shirt);
  px(-8, -6, 16, 4, shade(shirt, 26));
  const hand = a === 'walk' ? -Math.sin(time * 12) * 2.4
    : (a === 'code' || a === 'terminal') ? Math.sin(time * 9) * 1.6
      : (a === 'meet' || a === 'chat' || agent.talking) ? Math.max(0, Math.sin(time * 3 + agent.seed)) * -3
        : a === 'play' ? Math.sin(time * 6.5 + agent.seed) * -3.2
          : a === 'garden' ? Math.sin(time * 2.2 + agent.seed) * -2
            : a === 'dance' ? Math.sin(time * 7 + agent.seed) * -5 : 0;
  if (agent.anim === 'wait') {
    const wave = Math.round(Math.sin(time * 8) * 2);
    px(7 + wave, -11, 3, 10, skin);
    px(6 + wave, -13, 5, 4, skin);
    px(-10, -5, 3, 9, skin);
  } else if (a === 'stretch') {
    const up = Math.abs(Math.sin(time * 1.5 + agent.seed)) * 11;
    px(-10, -5 - up, 3, 9, skin);
    px(7, -5 - up, 3, 9, skin);
  } else if (a === 'phone') {
    px(-10, -5, 3, 9, skin);
    px(6, -15, 3, 10, skin);
    px(8, -19, 4, 7, '#1b2230');
    px(9, -18, 2, 5, '#9be7ff');
  } else if (a === 'write') {
    px(-10, -5, 3, 9, skin);
    const scribble = Math.round(Math.sin(time * 9) * 2);
    px(7 + scribble, -16, 3, 11, skin);
    px(9 + scribble, -19, 2, 5, '#3b6fd8');
  } else if (a === 'book') {
    px(-9, -9, 3, 8, skin);
    px(6, -9, 3, 8, skin);
  } else if (a === 'break') {
    px(-10, -5, 3, 9, skin);
    const sip = Math.max(0, Math.sin(time * 1.1 + agent.seed));
    px(7, -5 - sip * 8, 3, 9, skin);
  } else {
    px(-10, -5 + hand, 3, 9, skin);
    px(7, -5 - hand, 3, 9, skin);
  }

  px(-7 + look, -19 + nod, 14, 13, skin);
  px(-7 + look, -19 + nod, 14, 4, shade(skin, 16));
  px(-8 + look, -21 + nod, 16, 6, hair);
  px(-8 + look, -21 + nod, 16, 3, shade(hair, 26));
  px(-8 + look, -16 + nod, 3, 5, hair);
  px(5 + look, -16 + nod, 3, 5, hair);
  if (blink) {
    px(-4 + look, -12 + nod, 2, 1, '#20242e');
    px(2 + look, -12 + nod, 2, 1, '#20242e');
  } else {
    px(-4 + look, -13 + nod, 2, 3, '#20242e');
    px(2 + look, -13 + nod, 2, 3, '#20242e');
  }

  if (a === 'think' || a === 'error') {
    px(-2 + look, -9 + nod, 4, 1, shade(skin, -35));
  } else if (talk) {
    px(-2 + look, -10 + nod, 4, 3, '#7a2f35');
  } else {
    px(-2 + look, -9 + nod, 4, 1, '#b45a5a');
  }

  if (agent.anim === 'read') {
    px(-7, -2, 6, 7, '#f0c878');
    px(-1, -2, 6, 7, '#d99d57');
    px(-1, -2, 1, 7, '#8a603b');
  } else if (agent.anim === 'mcp') {
    ctx.fillStyle = 'rgba(75, 235, 180, 0.18)';
    ctx.fillRect(x + 9, y - 28, 14, 12);
    ctx.fillStyle = '#8dffc9';
    ctx.fillRect(x + 12, y - 25, 3, 3);
    ctx.fillRect(x + 17, y - 25, 3, 3);
    ctx.fillRect(x + 12, y - 20, 8, 1);
  } else if (agent.anim === 'search') {
    ctx.strokeStyle = '#8ecbff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + 12, y - 23, 5, 0, Math.PI * 2);
    ctx.moveTo(x + 16, y - 19);
    ctx.lineTo(x + 21, y - 14);
    ctx.stroke();
  } else if (agent.anim === 'think') {
    ctx.fillStyle = 'rgba(224, 235, 250, 0.85)';
    ctx.fillRect(x + 9, y - 30, 8, 6);
    ctx.fillRect(x + 7, y - 23, 3, 3);
    ctx.fillRect(x + 4, y - 19, 2, 2);
  } else if (agent.anim === 'terminal') {
    px(-10, 3 + hand, 3, 3, '#8ecbff');
    px(7, 3 - hand, 3, 3, '#8ecbff');
  }

  if (agent.anim === 'wait') {
    ctx.fillStyle = '#f0b45e';
    ctx.fillRect(x - 9, y - 30, 18, 3);
  }

  if (lash > 0.02) {
    // marcas rojas del latigazo sobre el torso + chispas de impacto
    ctx.save();
    ctx.globalAlpha = Math.min(1, lash * 1.8);
    ctx.strokeStyle = '#ff8f8f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y - 6);
    ctx.lineTo(x + 8, y + 1);
    ctx.moveTo(x - 9, y + 1);
    ctx.lineTo(x + 7, y + 7);
    ctx.stroke();
    ctx.fillStyle = '#ffe9c2';
    ctx.fillRect(x + 6, y - 12, 2, 2);
    ctx.fillRect(x - 9, y - 11, 2, 2);
    ctx.restore();
  }
}

function diamond(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

/** Agent + role badge (gold = main, cyan = subagent) + mood bubbles. */
export function drawAgent(ctx, agent, time) {
  const seated = Boolean(agent.seated) && agent.anim !== 'walk';
  const scale = agent.isSubagent ? 0.9 : 1;
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const alpha = agent.fade ?? 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y + (seated ? 5 : 0));
  ctx.scale(scale, scale);
  if (agent.face < 0) ctx.scale(-1, 1);
  if (seated) {
    ctx.beginPath();
    ctx.rect(-40, -80, 80, 86); // hide the legs behind the desk/chair
    ctx.clip();
  }
  if (agent._pa !== agent.anim) {
    if (agent._pa === 'walk') agent._hop = time;
    agent._pa = agent.anim;
  }
  const hopT = agent._hop !== undefined ? (time - agent._hop) / 0.28 : 1;
  drawAgentBody(ctx, { ...agent, x: 0, y: 0, hop: hopT >= 0 && hopT < 1 ? hopT : 0 }, time);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  if (agent.isSubagent) diamond(ctx, x - 14, y - 30, 4, '#6fd3ff');
  else diamond(ctx, x - 14, y - 30, 5, '#f0b45e');

  if (agent.anim === 'meet') {
    ctx.fillStyle = 'rgba(245, 247, 252, 0.92)';
    ctx.fillRect(x + 8, y - 38, 18, 10);
    ctx.fillRect(x + 10, y - 28, 3, 3);
    ctx.fillStyle = '#4a5470';
    for (let i = 0; i < 3; i += 1) {
      const up = Math.sin(time * 5 + i) > 0 ? 1 : 0;
      ctx.fillRect(x + 11 + i * 5, y - 34 - up, 2, 2);
    }
  } else if (agent.anim === 'error') {
    ctx.fillStyle = '#e06c75';
    ctx.fillRect(x + 9, y - 38, 10, 10);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 13, y - 36, 2, 4);
    ctx.fillRect(x + 13, y - 31, 2, 2);
  } else if (agent.anim === 'break') {
    ctx.fillStyle = '#f0f3f8';
    ctx.fillRect(x + 9, y - 4, 6, 7);
    ctx.fillRect(x + 15, y - 2, 2, 3);
    ctx.fillStyle = 'rgba(240, 244, 250, 0.6)';
    ctx.fillRect(x + 11, y - 9 - (Math.floor(time * 3) % 3) * 2, 2, 3);
  } else if (agent.anim === 'idle') {
    ctx.fillStyle = 'rgba(224, 235, 250, 0.8)';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('z', x + 9, y - 26 - (Math.floor(time * 0.8) % 3) * 4);
  }
  ctx.restore();
}
