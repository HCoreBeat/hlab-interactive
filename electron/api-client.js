'use strict';

/**
 * Thin HTTP client for the opencode v2 API.
 *
 * All requests happen in the main process (the renderer runs from file:// and
 * would hit CORS otherwise). The client never throws to the caller: it always
 * resolves with { ok, status, data, error }.
 */

const DEFAULT_TIMEOUT = 30000;

function appendParam(params, key, value) {
  if (value === undefined || value === null) return;
  if (typeof value === 'object' && !Array.isArray(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendParam(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) params.append(key, String(item));
    return;
  }
  params.set(key, String(value));
}

function buildQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) appendParam(params, key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}

class ApiClient {
  constructor() {
    this.baseUrl = '';
    this.password = '';
  }

  configure({ baseUrl, password }) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.password = password || '';
  }

  get isConfigured() {
    return Boolean(this.baseUrl);
  }

  authHeader() {
    if (!this.password) return {};
    const token = Buffer.from(`opencode:${this.password}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async request(method, path, options = {}) {
    if (!this.baseUrl) {
      return { ok: false, status: 0, data: null, error: 'El servidor de opencode no está configurado.' };
    }

    const { query, body, timeout, responseType } = options;
    const url = `${this.baseUrl}${path}${buildQuery(query)}`;
    const headers = { Accept: 'application/json', ...this.authHeader() };
    const init = { method: method || 'GET', headers };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (timeout !== 0) init.signal = AbortSignal.timeout(timeout || DEFAULT_TIMEOUT);

    let response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const message = error.name === 'TimeoutError'
        ? `La petición ${method} ${path} agotó el tiempo de espera.`
        : `No se pudo conectar con el servidor: ${error.message}`;
      return { ok: false, status: 0, data: null, error: message };
    }

    let data = null;
    if (responseType === 'base64' && response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      data = {
        base64: bytes.toString('base64'),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
      };
    } else {
      const text = await response.text();
      const type = response.headers.get('content-type') || '';
      if (text && type.includes('json')) {
        try { data = JSON.parse(text); } catch { data = text; }
      } else if (text) {
        data = text;
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        error: this.describeError(response.status, data),
      };
    }

    return { ok: true, status: response.status, data };
  }

  describeError(status, data) {
    if (status === 401) return 'No autorizado: revisa la contraseña del servidor.';
    if (status === 404) {
      const tag = data && (data._tag || data.type);
      if (tag === 'LocationNotFoundError') return 'El proyecto no está cargado en el servidor.';
      return 'Recurso no encontrado (404).';
    }
    if (data && typeof data === 'object') {
      const message = data.message || data.error || data._tag;
      if (message) return `${message}`;
    }
    if (typeof data === 'string' && data.trim().startsWith('<')) {
      return `Respuesta inesperada del servidor (${status}). ¿La ruta pertenece a la API v1?`;
    }
    return `Error ${status} del servidor.`;
  }

  get(path, query, options = {}) {
    return this.request('GET', path, { ...options, query });
  }

  post(path, body, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  del(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  patch(path, body, options = {}) {
    return this.request('PATCH', path, { ...options, body });
  }
}

module.exports = { ApiClient, buildQuery };
