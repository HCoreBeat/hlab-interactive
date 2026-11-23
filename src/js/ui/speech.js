'use strict';

/**
 * Lectura en voz alta con una voz lo más natural posible.
 * Markdown y código se convierten a texto legible, se parte en frases cortas
 * (Chrome corta utterances largas) y se encadena la reproducción.
 */

const NATURAL_HINTS = [
  'natural', 'neural', 'premium', 'enhanced', 'google', 'online',
  'microsoft aria', 'microsoft jenny', 'microsoft ana', 'samantha',
  'daniel', 'hazel', 'eva', 'pablo', 'helena', 'monica', 'lucia', 'jorge',
];
const BAD_HINTS = [
  'espeak', 'robot', 'compact', 'festival', 'pico', 'brain',
  'microsoft david', 'microsoft zira', 'microsoft mark',
];

export function speechVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices() || [];
}

function voiceScore(voice, lang) {
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const wanted = String(lang || '').toLowerCase().split(/[-_]/)[0];
  const actual = String(voice.lang || '').toLowerCase().split(/[-_]/)[0];
  let score = actual === wanted ? 100 : (actual && !wanted ? 40 : 0);
  for (const hint of NATURAL_HINTS) if (name.includes(hint)) score += 25;
  for (const hint of BAD_HINTS) if (name.includes(hint)) score -= 80;
  if (voice.localService) score += 5;
  return score;
}

export function pickVoice(lang, voiceURI) {
  const voices = speechVoices();
  if (voiceURI) {
    const chosen = voices.find((voice) => voice.voiceURI === voiceURI || voice.name === voiceURI);
    if (chosen) return chosen;
  }
  return voices.slice().sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))[0] || null;
}

/** Convierte Markdown/código en texto que suene bien al leerse. */
export function cleanSpeechText(text) {
  let value = String(text || '');
  value = value.replace(/```[\s\S]*?```/g, ' [fragmento de código] ');
  value = value.replace(/`([^`]+)`/g, '$1');
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  value = value.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  value = value.replace(/^\s{0,3}[-*+]\s+/gm, '');
  value = value.replace(/^\s{0,3}>\s+/gm, '');
  value = value.replace(/(\*\*|__|\*|_|~~)/g, '');
  value = value.replace(/\|/g, ' ');
  value = value.replace(/\b(https?:\/\/\S+)/g, ' enlace ');
  value = value.replace(/[<>/{}[\]]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  return value;
}

/** Parte el texto en frases de tamaño seguro para el motor de voz. */
export function speechChunks(text, maxLength = 180) {
  const clean = cleanSpeechText(text);
  if (!clean) return [];
  const pieces = clean.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [clean];
  const chunks = [];
  let current = '';
  const push = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };
  for (const piece of pieces) {
    let sentence = piece.trim();
    while (sentence.length > maxLength) {
      const cut = sentence.lastIndexOf(',', maxLength);
      const point = cut > maxLength / 2 ? cut : sentence.lastIndexOf(' ', maxLength);
      if (point <= 0) break;
      current += `${sentence.slice(0, point + 1).trim()} `;
      push();
      sentence = sentence.slice(point + 1).trim();
    }
    if ((`${current} ${sentence}`).trim().length > maxLength) push();
    current += `${sentence} `;
  }
  push();
  return chunks;
}

/**
 * Reproduce el texto y devuelve un controlador con cancel().
 * `onProgress(index, total)` permite pintar avance en el botón.
 */
export function speakText(text, options = {}) {
  const {
    lang = 'es-ES', voiceURI = '', rate = 1.02, pitch = 1,
    onStart, onEnd, onError, onProgress,
  } = options;
  const synthesis = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synthesis || typeof Utterance !== 'function') return null;

  const chunks = speechChunks(text);
  if (chunks.length === 0) return null;
  const voice = pickVoice(lang, voiceURI);
  let token = 0;
  let index = 0;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    token += 1;
    synthesis.cancel();
  };

  const speakNext = () => {
    if (cancelled || index >= chunks.length) {
      if (!cancelled) onEnd?.();
      return;
    }
    const myToken = token;
    const utterance = new Utterance(chunks[index]);
    utterance.lang = voice?.lang || lang;
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    onProgress?.(index + 1, chunks.length);
    if (index === 0) onStart?.();
    index += 1;
    utterance.onend = () => {
      if (cancelled || token !== myToken) return;
      // Chrome a veces deja de avanzar tras un utterance largo: un pequeño
      // reset mantiene la cola viva sin cortar la frase anterior.
      synthesis.pause();
      synthesis.resume();
      // Pausa breve entre frases: encadenarlas sin ningún hueco suena robótico.
      setTimeout(() => {
        if (!cancelled && token === myToken) speakNext();
      }, 110);
    };
    utterance.onerror = (event) => {
      if (cancelled || token !== myToken) return;
      onError?.(event);
      onEnd?.();
    };
    synthesis.speak(utterance);
  };

  speakNext();
  return { cancel, chunks: chunks.length };
}
