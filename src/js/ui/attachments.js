'use strict';

/**
 * Imágenes y archivos de texto en el chat: arrastrar y soltar, pegar o elegir
 * archivos. Las imágenes se reducen si son enormes y se abren en un visor.
 */

import { el, clear } from '../util/dom.js';
import { state } from '../store.js';
import { toast } from './toast.js';
import { uiIcon } from '../util/ui-icons.js';

const MAX_ATTACHMENTS = 8;
// Las imágenes se reenvían al proveedor en CADA turno posterior, así que pesan
// varias veces. Se reducen a un tamaño razonable para visión (1280 px) y se
// comprimen hasta un objetivo de ~600 KB antes de entrar al contexto.
const MAX_DIMENSION = 1280;
const TARGET_BYTES = 600 * 1024;
const MAX_BYTES = 1024 * 1024;
// Presupuesto binario total por mensaje: en base64 crece un 33 % y debe caber
// en el límite de cuerpo del IPC (12 MB) sin fallar al enviar.
const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_TEXT_TOTAL_BYTES = 1024 * 1024;
const ACCEPT = [
  'image/png,image/jpeg,image/webp,image/gif',
  '.txt,.md,.markdown,.mdx,.js,.mjs,.cjs,.jsx,.ts,.tsx,.html,.htm,.css,.scss,.less',
  '.json,.jsonc,.xml,.svg,.yml,.yaml,.toml,.ini,.csv,.log,.py,.cs,.java,.go,.rs',
  '.sh,.ps1,.sql,.php,.rb,.vue,.svelte,.astro,.env,.gitignore,.dockerfile',
].join(',');
const TEXT_EXTENSIONS = new Set(ACCEPT.split(',').filter((item) => item.startsWith('.')).map((item) => item.slice(1)));
const IMAGE_MIME_BY_EXTENSION = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const TEXT_MIME_BY_EXTENSION = {
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/jsx',
  ts: 'text/typescript', tsx: 'text/typescript', html: 'text/html', htm: 'text/html',
  md: 'text/markdown', markdown: 'text/markdown', mdx: 'text/markdown',
  json: 'application/json', jsonc: 'application/json', xml: 'application/xml', svg: 'image/svg+xml',
};

// ------------------------------------------------------- envío (puente) ----
// El chat deja los archivos "preparados" justo antes de llamar a onSend y el
// controlador de sesiones las recoge al montar la petición.
let staged = [];
export function stageAttachments(list) { staged = list || []; }
export function consumeStagedAttachments() { const list = staged; staged = []; return list; }

// Los archivos enviados se recuerdan para poder mostrarlos aunque el historial
// recargado del servidor no las devuelva en el mismo formato.
const sent = [];
export function rememberSent(sessionID, text, files) {
  if (!files?.length) return;
  sent.push({
    sessionID,
    text: String(text).trim(),
    at: Date.now(),
    files: files.map((file) => ({
      src: file.dataUrl,
      name: file.name,
      mime: file.mime,
      kind: file.kind || (/^image\//i.test(String(file.mime || '')) || /^data:image\//i.test(String(file.dataUrl || '')) ? 'image' : 'text'),
    })),
  });
  if (sent.length > 30) sent.shift();
}

/** Busca los archivos enviados con un mensaje (el servidor puede devolver el texto con prefijos). */
function findSent(message, sessionID) {
  const text = String(message.text || '').trim();
  for (let index = sent.length - 1; index >= 0; index -= 1) {
    const entry = sent[index];
    if (entry.sessionID !== sessionID) continue;
    const close = !message.time || Math.abs(message.time - entry.at) < 120000;
    if (!close) continue;
    if (text === entry.text || text.endsWith(entry.text) || (entry.text && entry.text.endsWith(text) && text.length > 3)) return entry.files;
  }
  return null;
}

/** Adjuntos de un mensaje de usuario, sea cual sea el formato en que lleguen. */
export function attachmentsOfMessage(message, sessionID) {
  const local = findSent(message, sessionID || state.activeSessionId);
  if (local) return local;
  const result = [];
  const candidates = [message.files, message.attachments, message.images, message.parts].filter(Array.isArray).flat();
  for (const item of candidates) {
    if (!item) continue;
    const src = item.uri || item.url || item.src || item.source?.url || item.data;
    const mime = item.mime || item.mediaType || item.type || '';
    if (!src || typeof src !== 'string') continue;
    if (/^data:(?:image|text|application)\//i.test(src)) {
      const dataMime = /^data:([^;,]+)/i.exec(src)?.[1] || '';
      result.push({
        src,
        name: item.name || item.filename || 'archivo',
        mime: String(mime).startsWith('data:') || !String(mime).includes('/') ? (dataMime || mime) : mime,
        kind: /^data:image\//i.test(src) ? 'image' : 'text',
      });
    }
  }
  return result;
}

/** Imágenes de un mensaje de usuario, sea cual sea el formato en que lleguen. */
export function imagesOfMessage(message, sessionID) {
  return attachmentsOfMessage(message, sessionID).filter((file) => file.kind === 'image');
}

// ---------------------------------------------------- normalización de archivos ----

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Imagen no válida'));
    image.src = src;
  });
}

function humanSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

let counter = 0;

function extensionOf(file) {
  return String(file.name || '').split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
}

function isImageFile(file) {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(file.type)
    || Object.hasOwn(IMAGE_MIME_BY_EXTENSION, extensionOf(file));
}

function isTextFile(file) {
  return TEXT_EXTENSIONS.has(extensionOf(file));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Reduce la imagen hasta el objetivo de peso. Cada adjunto se reenvía en todos
 * los turnos siguientes, así que comprimir aquí ahorra datos muchas veces.
 * Se prueba primero JPEG/WebP (mucho más pequeño que PNG) y, si aún pesa, se
 * reduce la resolución por pasos en vez de degradar la calidad hasta el ruido.
 */
async function fileToImage(file) {
  const mime = /^image\/(png|jpe?g|webp|gif)$/i.test(file.type)
    ? file.type
    : IMAGE_MIME_BY_EXTENSION[extensionOf(file)];
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(mime)) throw new Error(`${file.name || 'Archivo'}: formato de imagen no admitido`);
  const dataUrl = await readAsDataURL(file);
  const image = await loadImage(dataUrl);
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  counter += 1;

  // Una imagen ya pequeña y del tamaño adecuado se envía tal cual: recomprimirla
  // solo gastaría CPU y podría empeorar la legibilidad del texto.
  if (Math.max(naturalWidth, naturalHeight) <= MAX_DIMENSION && file.size <= TARGET_BYTES) {
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    return { id: nextImageId(), kind: 'image', name: imageName(file, ext), mime, dataUrl, width: naturalWidth, height: naturalHeight, bytes: file.size };
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
  let width = Math.max(1, Math.round(naturalWidth * scale));
  let height = Math.max(1, Math.round(naturalHeight * scale));
  // JPEG comprime mucho mejor que PNG las capturas de pantalla, que son el caso
  // habitual aquí. Se baja calidad primero y resolución después.
  let quality = 0.85;
  let current = encodeImage(image, width, height, 'image/jpeg', quality);
  for (let attempt = 0; attempt < 8 && current.bytes > TARGET_BYTES; attempt += 1) {
    if (quality > 0.6) {
      quality = Math.max(0.6, quality - 0.08);
    } else {
      width = Math.max(320, Math.round(width * 0.8));
      height = Math.max(320, Math.round(height * 0.8));
    }
    current = encodeImage(image, width, height, 'image/jpeg', quality);
  }
  if (current.bytes > MAX_BYTES) {
    throw new Error(`${file.name || 'Imagen'}: no se pudo reducir por debajo de ${humanSize(MAX_BYTES)}`);
  }
  return { id: nextImageId(), kind: 'image', name: imageName(file, 'jpg'), mime: current.mime, dataUrl: current.dataUrl, width, height, bytes: current.bytes };
}

function encodeImage(image, width, height, mime, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, width, height);
  const dataUrl = canvas.toDataURL(mime, quality);
  return { dataUrl, mime, bytes: Math.max(0, Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4)) };
}

function nextImageId() {
  return `img${Date.now().toString(36)}${counter}`;
}

function imageName(file, ext) {
  const base = file.name && file.name !== 'image.png' ? file.name.replace(/\.[^.]+$/, '') : `captura-${Date.now().toString(36)}-${counter}`;
  return `${base}.${ext}`;
}

async function fileToText(file) {
  if (file.size > MAX_TEXT_FILE_BYTES) throw new Error(`${file.name}: máximo ${humanSize(MAX_TEXT_FILE_BYTES)} por archivo de texto`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  if (text.includes('\u0000')) throw new Error(`${file.name}: el archivo parece binario`);
  const mime = file.type && /^(text\/|application\/(json|xml))/i.test(file.type)
    ? file.type
    : (TEXT_MIME_BY_EXTENSION[extensionOf(file)] || 'text/plain');
  return {
    id: `file${Date.now().toString(36)}${++counter}`,
    kind: 'text',
    name: file.name || 'archivo.txt',
    mime,
    dataUrl: `data:${mime};charset=utf-8;base64,${bytesToBase64(bytes)}`,
    bytes: file.size,
  };
}

// ---------------------------------------------------------------- visor ----

export function openLightbox(items, startIndex = 0) {
  if (!items?.length || document.querySelector('.lightbox')) return;
  let index = Math.min(Math.max(startIndex, 0), items.length - 1);
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let drag = null;

  const img = el('img', { class: 'lightbox-img', draggable: 'false', alt: '' });
  const stage = el('div', { class: 'lightbox-stage' }, [img]);
  const label = el('span', { class: 'lightbox-name' });
  const count = el('span', { class: 'lightbox-count' });
  const zoomLabel = el('span', { class: 'lightbox-zoom', text: '100%' });
  const info = el('span', { class: 'lightbox-info' });

  const apply = () => {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    stage.classList.toggle('is-zoomed', scale > 1);
  };
  const reset = () => { scale = 1; tx = 0; ty = 0; apply(); };
  const zoomBy = (factor, cx = 0, cy = 0) => {
    const next = Math.min(12, Math.max(0.2, scale * factor));
    const ratio = next / scale;
    tx = cx - (cx - tx) * ratio;
    ty = cy - (cy - ty) * ratio;
    scale = next;
    apply();
  };
  const show = (next) => {
    index = (next + items.length) % items.length;
    const item = items[index];
    img.src = item.src;
    label.textContent = item.name || 'imagen';
    count.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : '';
    info.textContent = '';
    img.onload = () => { info.textContent = `${img.naturalWidth}\u00d7${img.naturalHeight}`; };
    reset();
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    root.remove();
  };
  const download = () => {
    const link = document.createElement('a');
    link.href = items[index].src;
    link.download = items[index].name || 'imagen.png';
    link.click();
  };
  const onKey = (event) => {
    const handled = ['Escape', 'ArrowLeft', 'ArrowRight', '+', '=', '-', '0'].includes(event.key);
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowLeft') show(index - 1);
    else if (event.key === 'ArrowRight') show(index + 1);
    else if (event.key === '0') reset();
    else zoomBy(event.key === '-' ? 1 / 1.25 : 1.25);
  };

  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false });
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, tx, ty };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('is-dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag) return;
    tx = drag.tx + event.clientX - drag.x;
    ty = drag.ty + event.clientY - drag.y;
    apply();
  });
  const endDrag = () => { drag = null; stage.classList.remove('is-dragging'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', () => { if (scale === 1) zoomBy(2.5); else reset(); });
  stage.addEventListener('click', (event) => { if (event.target === stage && scale === 1 && !drag) close(); });

  const button = (text, title, handler) => el('button', { class: 'lightbox-btn', type: 'button', title, 'aria-label': title, text, onClick: handler });
  const root = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visor de imágenes' }, [
    el('div', { class: 'lightbox-bar' }, [
      el('div', { class: 'lightbox-title' }, [label, info]),
      el('div', { class: 'spacer' }),
      count,
      button('\u2212', 'Alejar (-)', () => zoomBy(1 / 1.25)),
      zoomLabel,
      button('+', 'Acercar (+)', () => zoomBy(1.25)),
      button('Ajustar', 'Ajustar a la ventana (0)', reset),
      button('Descargar', 'Descargar imagen', download),
      button('\u2715', 'Cerrar (Esc)', close),
    ]),
    stage,
    items.length > 1 ? button('\u2039', 'Anterior (\u2190)', () => show(index - 1)) : null,
    items.length > 1 ? button('\u203a', 'Siguiente (\u2192)', () => show(index + 1)) : null,
  ].filter(Boolean));
  const [prev, next] = [...root.querySelectorAll(':scope > .lightbox-btn')];
  prev?.classList.add('lightbox-nav', 'is-prev');
  next?.classList.add('lightbox-nav', 'is-next');

  document.body.appendChild(root);
  document.addEventListener('keydown', onKey, true);
  show(index);
}

// -------------------------------------------------------------- bandeja ----

export function mountAttachments({ chat, composer, input, actions, onChange }) {
  let pending = [];
  let busy = false;

  const tray = el('div', { class: 'composer-attachments', hidden: true });
  composer.insertBefore(tray, composer.firstChild);

  const picker = el('input', { type: 'file', accept: ACCEPT, multiple: 'true', class: 'att-file-input', hidden: true });
  const attachButton = el('button', {
    class: 'btn-icon att-btn', id: 'attach-btn', type: 'button',
    title: 'Adjuntar imágenes o archivos de texto/código',
    'aria-label': 'Adjuntar imágenes o archivos de texto/código',
    onClick: () => picker.click(),
  }, [uiIcon('clip', 16)]);
  (actions || composer).insertBefore(attachButton, (actions || composer).firstChild);
  composer.appendChild(picker);

  const overlay = el('div', { class: 'chat-drop', hidden: true }, [
    el('div', { class: 'chat-drop-card' }, [
      uiIcon('clip', 28),
      el('strong', { text: 'Suelta imágenes o archivos de texto aquí' }),
      el('span', { text: 'Se a\u00f1adir\u00e1n al contexto del siguiente mensaje' }),
    ]),
  ]);
  chat.appendChild(overlay);

  function modelWarning() {
    const model = (state.models || []).find((item) => item.providerID === state.selection?.providerID
      && (item.modelID === state.selection?.modelID || item.id === state.selection?.modelID));
    if (!model) return '';
    if (!pending.some((file) => file.kind === 'image')) return '';
    const input = model.modalities?.input ?? model.capabilities?.input;
    const supports = Array.isArray(input) ? input.includes('image') : (input && typeof input === 'object' ? input.image : undefined);
    if (supports === false || (model.attachment === false && supports === undefined)) {
      return 'El modelo actual no declara soporte de im\u00e1genes: cambia de modelo o OpenCode las ignorar\u00e1.';
    }
    return '';
  }

  function render() {
    clear(tray);
    tray.hidden = pending.length === 0;
    attachButton.classList.toggle('has-items', pending.length > 0);
    if (pending.length === 0) { onChange?.(0); return; }
    const list = el('div', { class: 'att-list' });
    pending.forEach((file, position) => {
      const meta = file.kind === 'image'
        ? `${file.width}\u00d7${file.height} \u00b7 ${humanSize(file.bytes)}`
        : humanSize(file.bytes);
      list.appendChild(el('div', {
        class: `att-item ${file.kind === 'text' ? 'att-text-item' : ''}`,
        title: `${file.name} \u00b7 ${meta}`,
      }, [
        file.kind === 'image'
          ? el('img', {
            src: file.dataUrl, alt: file.name,
            onClick: () => openLightbox(pending.filter((item) => item.kind === 'image').map((item) => ({ src: item.dataUrl, name: item.name })), pending.filter((item) => item.kind === 'image').indexOf(file)),
          })
          : el('div', { class: 'att-text-content' }, [uiIcon('files', 24), el('span', { text: file.name })]),
        el('button', { class: 'att-remove', type: 'button', 'aria-label': 'Quitar archivo', text: '\u2715', onClick: () => remove(file.id) }),
        el('span', { class: 'att-meta', text: meta }),
      ]));
    });
    const warning = modelWarning();
    const totalBytes = pending.reduce((total, file) => total + (file.bytes || 0), 0);
    // base64 añade ~33 %: es lo que de verdad se sube con el mensaje.
    const uploadBytes = Math.round(totalBytes * 4 / 3);
    tray.append(
      list,
      el('div', { class: 'att-foot' }, [
        el('span', {
          class: 'att-count',
          text: `${pending.length} archivo${pending.length === 1 ? '' : 's'} · ${humanSize(uploadBytes)} a subir · clic en imágenes para ampliar`,
          title: 'Peso del mensaje con los adjuntos (base64). Los adjuntos se reenvían en cada turno posterior: compactar el contexto también los reduce.',
        }),
        warning ? el('span', { class: 'att-warn', text: `\u26a0 ${warning}` }) : null,
        el('button', { class: 'att-clear', type: 'button', text: 'Quitar todas', onClick: () => clearAll() }),
      ].filter(Boolean)),
    );
    onChange?.(pending.length);
  }

  function remove(id) {
    pending = pending.filter((image) => image.id !== id);
    render();
  }

  function clearAll() {
    pending = [];
    render();
  }

  async function addFiles(files) {
    const selected = [...files].filter(Boolean);
    const accepted = selected.filter((file) => isImageFile(file) || isTextFile(file));
    const skipped = selected.length - accepted.length;
    if (skipped > 0) toast(`${skipped} archivo(s) omitido(s): formato no admitido.`, 'warn');
    if (accepted.length === 0) return;
    if (pending.length + accepted.length > MAX_ATTACHMENTS) toast(`M\u00e1ximo ${MAX_ATTACHMENTS} archivos por mensaje.`, 'warn');
    const available = Math.max(0, MAX_ATTACHMENTS - pending.length);
    let textBytes = pending.filter((file) => file.kind === 'text').reduce((total, file) => total + file.bytes, 0);
    let totalBytes = pending.reduce((total, file) => total + file.bytes, 0);
    busy = true;
    tray.classList.add('is-loading');
    for (const file of accepted.slice(0, available)) {
      try {
        let attachment;
        if (isImageFile(file)) {
          attachment = await fileToImage(file);
        } else {
          if (file.size > MAX_TEXT_FILE_BYTES) throw new Error(`${file.name}: máximo ${humanSize(MAX_TEXT_FILE_BYTES)} por archivo`);
          if (textBytes + file.size > MAX_TEXT_TOTAL_BYTES) throw new Error(`Los archivos de texto superan el límite conjunto de ${humanSize(MAX_TEXT_TOTAL_BYTES)}`);
          attachment = await fileToText(file);
        }
        // El mensaje viaja como base64 (+33 %): sin este tope, varios adjuntos
        // grandes hacen fallar el envío entero.
        if (totalBytes + attachment.bytes > MAX_TOTAL_BYTES) {
          throw new Error(`Los adjuntos superan el límite conjunto de ${humanSize(MAX_TOTAL_BYTES)} por mensaje`);
        }
        if (attachment.kind === 'text') textBytes += attachment.bytes;
        totalBytes += attachment.bytes;
        pending.push(attachment);
        render();
      } catch (error) {
        toast(error.message || 'No se pudo cargar el archivo', 'error');
      }
    }
    busy = false;
    tray.classList.remove('is-loading');
    render();
    input.focus();
  }

  picker.addEventListener('change', () => { addFiles(picker.files); picker.value = ''; });

  // pegar im\u00e1genes desde el portapapeles
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file' && /^image\//i.test(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  });

  // arrastrar y soltar sobre todo el chat
  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  chat.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.hidden = false;
  });
  chat.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  chat.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  chat.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.hidden = true;
    addFiles(event.dataTransfer.files);
  });
  // si se suelta fuera del chat, el navegador no debe abrir la imagen
  window.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  window.addEventListener('drop', (event) => { if (hasFiles(event)) event.preventDefault(); });

  return {
    peek: () => pending.slice(),
    count: () => pending.length,
    isBusy: () => busy,
    clear: clearAll,
    restore: (list) => { pending = list.slice(); render(); },
    add: addFiles,
  };
}
