'use strict';

/**
 * Office sound engine. Every sound is synthesised with WebAudio at runtime:
 * no audio files, so there is nothing to license and nothing to download.
 */

const KEY = 'office.sound';
const VOLUME_KEY = 'office.sound.volume';
let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;
let volume = 1;
try { muted = localStorage.getItem(KEY) === 'off'; } catch (error) { muted = false; }
try {
  const storedVolume = localStorage.getItem(VOLUME_KEY);
  if (storedVolume !== null && Number.isFinite(Number(storedVolume))) volume = Math.max(0, Math.min(1.5, Number(storedVolume)));
} catch (error) { /* storage unavailable */ }
const last = new Map();

export const isMuted = () => muted;
export const getVolume = () => volume;

export function setVolume(value) {
  volume = Math.max(0, Math.min(1.5, Number(value) || 0));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.025);
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch (error) { /* storage unavailable */ }
}

export function setMuted(value) {
  muted = Boolean(value);
  try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch (error) { /* storage unavailable */ }
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Call from a user gesture so the browser allows audio. */
export function unlock() { ensure(); }

function output(pan, vol) {
  const gain = ctx.createGain();
  gain.gain.value = vol;
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(master);
  } else {
    gain.connect(master);
  }
  return gain;
}

function envelope(t, dur, vol, attack) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return env;
}

function tone(freq, dur, o) {
  const t = ctx.currentTime + (o.delay || 0);
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const env = envelope(t, dur, o.vol ?? 0.15, o.attack ?? 0.008);
  osc.connect(env);
  env.connect(o.dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur, o) {
  const t = ctx.currentTime + (o.delay || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = o.type || 'highpass';
  filter.frequency.value = o.freq || 2000;
  const env = envelope(t, dur, o.vol ?? 0.2, o.attack ?? 0.004);
  src.connect(filter);
  filter.connect(env);
  env.connect(o.dest);
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

const SFX = {
  key: (d) => {
    noise(0.025, { dest: d, freq: 2800 + Math.random() * 1800, vol: 0.5 });
    tone(1100 + Math.random() * 500, 0.02, { dest: d, type: 'square', vol: 0.05 });
  },
  step: (d) => noise(0.05, { dest: d, type: 'lowpass', freq: 380 + Math.random() * 120, vol: 0.55 }),
  tick: (d) => {
    tone(1500, 0.03, { dest: d, type: 'square', vol: 0.06 });
    tone(1000, 0.03, { dest: d, type: 'square', vol: 0.05, delay: 0.05 });
  },
  beep: (d) => {
    tone(660, 0.07, { dest: d, type: 'square', vol: 0.07 });
    tone(990, 0.09, { dest: d, type: 'square', vol: 0.07, delay: 0.08 });
  },
  page: (d) => noise(0.16, { dest: d, type: 'bandpass', freq: 2400, vol: 0.35, attack: 0.05 }),
  search: (d) => tone(620, 0.16, { dest: d, to: 1250, vol: 0.1 }),
  think: (d) => {
    tone(440, 0.18, { dest: d, type: 'triangle', vol: 0.07 });
    tone(554, 0.22, { dest: d, type: 'triangle', vol: 0.06, delay: 0.12 });
  },
  coffee: (d) => {
    noise(0.22, { dest: d, type: 'lowpass', freq: 850, vol: 0.2, attack: 0.04 });
    tone(740, 0.12, { dest: d, type: 'sine', vol: 0.07, delay: 0.2 });
  },
  mcp: (d) => {
    tone(520, 0.09, { dest: d, type: 'triangle', vol: 0.12 });
    tone(780, 0.09, { dest: d, type: 'triangle', vol: 0.12, delay: 0.09 });
    tone(1170, 0.14, { dest: d, type: 'triangle', vol: 0.1, delay: 0.18 });
  },
  bell: (d) => {
    tone(880, 0.45, { dest: d, vol: 0.14 });
    tone(1320, 0.4, { dest: d, vol: 0.09, delay: 0.12 });
  },
  done: (d) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { dest: d, type: 'triangle', vol: 0.13, delay: i * 0.08 }));
  },
  chime: (d) => {
    tone(659, 0.3, { dest: d, vol: 0.1 });
    tone(880, 0.35, { dest: d, vol: 0.1, delay: 0.1 });
  },
  error: (d) => {
    tone(190, 0.3, { dest: d, to: 90, type: 'sawtooth', vol: 0.12 });
    tone(160, 0.3, { dest: d, to: 80, type: 'sawtooth', vol: 0.1, delay: 0.16 });
  },
  door: (d) => {
    noise(0.12, { dest: d, type: 'lowpass', freq: 700, vol: 0.5 });
    tone(140, 0.1, { dest: d, type: 'triangle', vol: 0.12 });
  },
  spawn: (d) => tone(280, 0.22, { dest: d, to: 760, type: 'triangle', vol: 0.12 }),
  leave: (d) => tone(520, 0.25, { dest: d, to: 220, type: 'triangle', vol: 0.1 }),
  select: (d) => {
    tone(700, 0.06, { dest: d, type: 'square', vol: 0.06 });
    tone(1050, 0.08, { dest: d, type: 'square', vol: 0.06, delay: 0.05 });
  },
  hover: (d) => tone(1300, 0.025, { dest: d, type: 'sine', vol: 0.04 }),
  zoom: (d) => tone(420 + Math.random() * 40, 0.05, { dest: d, to: 520, type: 'triangle', vol: 0.05 }),
  sit: (d) => {
    noise(0.09, { dest: d, type: 'lowpass', freq: 260, vol: 0.6, attack: 0.01 });
    tone(110, 0.1, { dest: d, to: 70, type: 'sine', vol: 0.12 });
  },
  stand: (d) => {
    noise(0.07, { dest: d, type: 'bandpass', freq: 500, vol: 0.3, attack: 0.02 });
    tone(180, 0.08, { dest: d, to: 240, type: 'sine', vol: 0.05 });
  },
  blip: (d) => tone(880 + Math.random() * 260, 0.07, { dest: d, type: 'sine', vol: 0.045 }),
  link: (d) => {
    tone(1200, 0.04, { dest: d, type: 'square', vol: 0.04 });
    tone(1600, 0.05, { dest: d, type: 'square', vol: 0.04, delay: 0.06 });
  },
  chat: (d) => {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i += 1) tone(300 + Math.random() * 280, 0.06, { dest: d, type: 'triangle', vol: 0.06, delay: i * 0.075 });
  },
  ping: (d) => {
    tone(1175, 0.18, { dest: d, vol: 0.07 });
    tone(1175, 0.18, { dest: d, vol: 0.05, delay: 0.2 });
  },
  ball: (d) => {
    tone(150, 0.07, { dest: d, to: 90, type: 'sine', vol: 0.16 });
    noise(0.04, { dest: d, type: 'lowpass', freq: 400, vol: 0.2, attack: 0.005 });
  },
  splash: (d) => {
    noise(0.18, { dest: d, type: 'bandpass', freq: 1800, vol: 0.14, attack: 0.04 });
    tone(900 + Math.random() * 300, 0.05, { dest: d, to: 500, type: 'sine', vol: 0.04, delay: 0.1 });
  },
  bird: (d) => {
    const base = 1900 + Math.random() * 700;
    tone(base, 0.06, { dest: d, to: base + 500, type: 'sine', vol: 0.045 });
    tone(base + 300, 0.07, { dest: d, to: base - 200, type: 'sine', vol: 0.04, delay: 0.09 });
  },
  crackle: (d) => noise(0.05, { dest: d, type: 'highpass', freq: 2400, vol: 0.1, attack: 0.002 }),
  whip: (d) => {
    // Latigazo: chasquido seco, pequeño golpe grave y aire cortado.
    noise(0.035, { dest: d, type: 'highpass', freq: 3800, vol: 0.85, attack: 0.001 });
    noise(0.12, { dest: d, type: 'bandpass', freq: 1500, vol: 0.28, attack: 0.004, delay: 0.006 });
    tone(2400, 0.04, { dest: d, to: 700, type: 'sawtooth', vol: 0.07 });
    tone(120, 0.09, { dest: d, to: 62, type: 'sine', vol: 0.16, delay: 0.02 });
  },
  whipHit: (d) => {
    // Impacto sobre el agente: golpe sordo + queja corta.
    tone(150, 0.1, { dest: d, to: 70, type: 'square', vol: 0.12 });
    noise(0.07, { dest: d, type: 'lowpass', freq: 460, vol: 0.4, attack: 0.002, delay: 0.005 });
    tone(560, 0.16, { dest: d, to: 300, type: 'triangle', vol: 0.09, delay: 0.05 });
  },
  dooropen: (d) => {
    noise(0.1, { dest: d, type: 'lowpass', freq: 320, vol: 0.25, attack: 0.01 });
    tone(170, 0.3, { dest: d, to: 250, type: 'triangle', vol: 0.05 });
    tone(760, 0.04, { dest: d, type: 'square', vol: 0.05, delay: 0.3 });
  },
  doorclose: (d) => {
    tone(130, 0.14, { dest: d, to: 55, type: 'sine', vol: 0.18 });
    noise(0.08, { dest: d, type: 'lowpass', freq: 260, vol: 0.32, attack: 0.005 });
    tone(620, 0.03, { dest: d, type: 'square', vol: 0.04, delay: 0.1 });
  },
  wind: (d) => noise(1.3, { dest: d, type: 'bandpass', freq: 520, vol: 0.07, attack: 0.65 }),
  rustle: (d) => noise(0.35, { dest: d, type: 'highpass', freq: 3200, vol: 0.06, attack: 0.12 }),
  hum: (d) => noise(0.9, { dest: d, type: 'lowpass', freq: 170, vol: 0.06, attack: 0.4 }),
  printer: (d) => {
    for (let i = 0; i < 6; i += 1) noise(0.06, { dest: d, type: 'bandpass', freq: 900 + i * 90, vol: 0.07, attack: 0.01, delay: i * 0.09 });
  },
  phone: (d) => {
    for (let i = 0; i < 4; i += 1) tone(i % 2 ? 1040 : 880, 0.07, { dest: d, type: 'sine', vol: 0.045, delay: i * 0.09 });
  },
  swish: (d) => {
    noise(0.13, { dest: d, type: 'bandpass', freq: 2300, vol: 0.12, attack: 0.03 });
    tone(880, 0.1, { dest: d, to: 1320, type: 'sine', vol: 0.04, delay: 0.1 });
  },
  cheer: (d) => {
    [523, 659, 784].forEach((f, i) => tone(f, 0.12, { dest: d, type: 'triangle', vol: 0.06, delay: i * 0.08 }));
  },
  yawn: (d) => {
    tone(420, 0.5, { dest: d, to: 190, type: 'triangle', vol: 0.06, attack: 0.15 });
    noise(0.4, { dest: d, type: 'bandpass', freq: 700, vol: 0.05, attack: 0.2 });
  },
  snore: (d) => {
    noise(0.55, { dest: d, type: 'lowpass', freq: 240, vol: 0.12, attack: 0.25 });
    tone(95, 0.5, { dest: d, to: 70, type: 'sawtooth', vol: 0.025, attack: 0.2 });
  },
  marker: (d) => noise(0.12, { dest: d, type: 'bandpass', freq: 2600 + Math.random() * 800, vol: 0.07, attack: 0.02 }),
  clink: (d) => {
    tone(2100, 0.07, { dest: d, type: 'sine', vol: 0.07 });
    tone(2800, 0.09, { dest: d, type: 'sine', vol: 0.05, delay: 0.04 });
  },
  paper: (d) => noise(0.22, { dest: d, type: 'highpass', freq: 1800, vol: 0.09, attack: 0.05 }),
  beat: (d) => {
    tone(130, 0.09, { dest: d, to: 55, type: 'sine', vol: 0.12 });
    noise(0.03, { dest: d, type: 'highpass', freq: 5000, vol: 0.05, attack: 0.002, delay: 0.21 });
  },
  bubble: (d) => {
    for (let i = 0; i < 4; i += 1) tone(480 + i * 150, 0.05, { dest: d, to: 760 + i * 120, type: 'sine', vol: 0.05, delay: i * 0.07 });
  },
  gulp: (d) => {
    tone(240, 0.07, { dest: d, to: 150, type: 'sine', vol: 0.09 });
    tone(220, 0.07, { dest: d, to: 140, type: 'sine', vol: 0.08, delay: 0.14 });
  },
  sip: (d) => {
    noise(0.14, { dest: d, type: 'bandpass', freq: 1200, vol: 0.18, attack: 0.05 });
    tone(300, 0.08, { dest: d, to: 200, type: 'sine', vol: 0.05, delay: 0.14 });
  },
};

/** Plays a named effect. `pan` goes from -1 (left) to 1 (right). */
export function sfx(name, o = {}) {
  if (muted || !SFX[name]) return;
  if (!ensure() || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (last.get(name) || 0) < (o.gap ?? 45)) return;
  last.set(name, now);
  SFX[name](output(o.pan || 0, o.vol ?? 1));
}
