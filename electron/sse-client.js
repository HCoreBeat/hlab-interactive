'use strict';

const { EventEmitter } = require('node:events');

const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 15000;
const SEEN_LIMIT = 400;

/**
 * Reads `GET /api/event` (Server-Sent Events) with automatic reconnection.
 *
 * Emits:
 *   - "event"  (payload)  -> one parsed opencode event
 *   - "state"  ({ state, attempt, message })
 *   - "open"   ()
 *   - "parse-error" (line)
 */
class SseClient extends EventEmitter {
  constructor() {
    super();
    this.baseUrl = '';
    this.password = '';
    this.controller = null;
    this.attempt = 0;
    this.timer = null;
    this.running = false;
    this.seen = new Set();
    this.seenOrder = [];
  }

  configure({ baseUrl, password }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.password = password || '';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.controller) this.controller.abort();
    this.controller = null;
    this.emit('state', { state: 'closed', attempt: 0, message: 'Desconectado' });
  }

  scheduleReconnect(message) {
    if (!this.running) return;
    this.attempt += 1;
    const delay = Math.min(BACKOFF_MIN * 2 ** (this.attempt - 1), BACKOFF_MAX);
    this.emit('state', {
      state: 'reconnecting',
      attempt: this.attempt,
      message: message || `Reconectando en ${Math.round(delay / 1000)} s…`,
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      this.loop();
    }, delay);
  }

  async loop() {
    if (!this.running || !this.baseUrl) return;
    this.controller = new AbortController();
    const token = Buffer.from(`opencode:${this.password}`, 'utf8').toString('base64');

    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/event`, {
        headers: { Authorization: `Basic ${token}`, Accept: 'text/event-stream' },
        signal: this.controller.signal,
      });
    } catch (error) {
      if (!this.running) return;
      this.scheduleReconnect(`No se pudo abrir el flujo de eventos: ${error.message}`);
      return;
    }

    if (!response.ok) {
      this.scheduleReconnect(
        response.status === 401
          ? 'El servidor rechazó las credenciales del flujo de eventos.'
          : `El flujo de eventos respondió ${response.status}.`,
      );
      return;
    }

    this.attempt = 0;
    this.emit('state', { state: 'open', attempt: 0, message: 'Eventos en vivo' });
    this.emit('open');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let index = buffer.indexOf('\n\n');
        while (index !== -1) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          this.parseBlock(raw);
          index = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (this.running && error.name !== 'AbortError') {
        this.scheduleReconnect(`El flujo de eventos se interrumpió: ${error.message}`);
        return;
      }
    }

    if (this.running) this.scheduleReconnect('El flujo de eventos se cerró.');
  }

  parseBlock(raw) {
    if (!raw || raw.startsWith(':') || raw.trim() === '') return;
    const dataLines = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      this.emit('parse-error', payload.slice(0, 200));
      return;
    }
    if (parsed && parsed.id) {
      if (this.seen.has(parsed.id)) return;
      this.seen.add(parsed.id);
      this.seenOrder.push(parsed.id);
      if (this.seenOrder.length > SEEN_LIMIT) {
        this.seen.delete(this.seenOrder.shift());
      }
    }
    this.emit('event', parsed);
  }
}

module.exports = { SseClient };
