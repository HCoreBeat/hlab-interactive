import { el, clear, raf, isAtBottom, scrollToBottom } from '../util/dom.js';
import {
  subscribe, state, messagesOf, runtimeOf, activeSession, setUI,
} from '../store.js';
import { renderMarkdown } from '../markdown.js';
import { formatDuration, formatTime, basename, truncate } from '../util/format.js';
import { STATUS_ICONS } from '../util/icons.js';
import { uiIcon } from '../util/ui-icons.js';
import { renderToolCard } from './tool-card.js';
import { toast } from './toast.js';
import { agentAvatar, userAvatar, typingIndicator } from './chat-avatars.js';
import { speakText } from './speech.js';
import {
  mountAttachments, openLightbox, stageAttachments, imagesOfMessage, attachmentsOfMessage,
} from './attachments.js';
import { mountChatSearch } from './chat-search.js';
import { pushEscape } from './escape-stack.js';

const INTERNAL_COMMANDS = [
  { name: 'nueva', description: 'Crear una sesión nueva' },
  { name: 'abortar', description: 'Detener la respuesta en curso' },
  { name: 'deshacer', description: 'Deshacer el último cambio de archivos' },
  { name: 'limpiar-vista', description: 'Ocultar el historial de esta vista' },
];

// Los textos ya cerrados no cambian: se parsean una sola vez (caché acotada).
const mdCache = new Map();
function cachedMarkdown(text) {
  if (text.length < 40) return renderMarkdown(text);
  const hit = mdCache.get(text);
  if (hit !== undefined) return hit;
  const html = renderMarkdown(text);
  mdCache.set(text, html);
  if (mdCache.size > 400) mdCache.delete(mdCache.keys().next().value);
  return html;
}

function renderBlocks(message, options) {
  const container = el('div', { class: 'msg-body' });
  for (const block of message.blocks || []) {
    if (block.kind === 'text') {
      const bubble = el('div', { class: `bubble block-text${block.streaming ? ' streaming-caret' : ''}` });
      bubble.innerHTML = block.streaming ? renderMarkdown(block.text || '') : cachedMarkdown(block.text || '');
      container.appendChild(bubble);
    } else if (block.kind === 'reasoning') {
      const details = el('details', {
        class: 'block-reasoning',
        open: Boolean(block.streaming),
        'data-block-key': block.key,
      }, [
        el('summary', { text: block.streaming ? 'Razonamiento en curso…' : 'Razonamiento' }),
        el('pre', { text: block.text || '' }),
      ]);
      container.appendChild(details);
    } else if (block.kind === 'tool') {
      container.appendChild(renderToolCard(block.tool || {}, {
        ...options,
        toolKey: `${message.id}:${message.blocks.indexOf(block)}`,
      }));
    }
  }
  return container;
}

/** Miniaturas de las imágenes enviadas en un mensaje (clic = visor). */
function imagesGallery(message) {
  const images = imagesOfMessage(message, state.activeSessionId);
  if (images.length === 0) return null;
  return el('div', { class: `msg-images n${Math.min(images.length, 4)}` }, images.map((image, index) => el('button', {
    class: 'msg-image', type: 'button', title: `${image.name} · clic para ampliar`, 'data-index': String(index),
  }, [el('img', { src: image.src, alt: image.name, loading: 'lazy', decoding: 'async' })])));
}

function textAttachmentList(message) {
  const files = attachmentsOfMessage(message, state.activeSessionId).filter((file) => file.kind !== 'image');
  if (files.length === 0) return null;
  return el('div', { class: 'msg-file-attachments' }, files.map((file) => el('span', {
    class: 'msg-file-attachment',
    title: file.name,
  }, [uiIcon('files', 14), el('span', { text: file.name })])));
}

function speechText(message) {
  const markdown = (message.blocks || [])
    .filter((block) => block.kind === 'text')
    .map((block) => block.text || '')
    .join('\n')
    .trim();
  if (!markdown) return '';
  const parsed = new DOMParser().parseFromString(renderMarkdown(markdown), 'text/html');
  return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function renderMessage(message, options = {}) {
  if (message.type === 'idle') return null;

  if (message.type === 'user') {
    return el('article', { class: `msg msg-user${options.entering ? ' is-entering' : ''}`, 'data-id': message.id }, [
      userAvatar(),
      el('div', { class: 'msg-body' }, [
        imagesGallery(message),
        textAttachmentList(message),
        el('div', { class: 'bubble', text: message.text || '' }),
        el('div', { class: 'msg-stats' }, [el('span', { text: formatTime(message.time) })]),
      ].filter(Boolean)),
    ]);
  }

  if (message.type === 'assistant') {
    const body = renderBlocks(message, options);
    const stats = [];
    if (message.agent) stats.push(`agente ${message.agent}`);
    if (message.model) {
      const provider = message.model.providerID ? `${message.model.providerID}/` : '';
      stats.push(`${provider}${message.model.id || message.model.modelID || ''}`);
    }
    if (message.stats?.tokens?.output) stats.push(`${message.stats.tokens.output} tok salida`);
    if (message.stats?.cost) stats.push(`$${Number(message.stats.cost).toFixed(4)}`);
    const readText = message.streaming ? '' : speechText(message);
    const footer = stats.length > 0 && state.settings.showModelStats !== false
      ? stats.map((text) => el('span', { text }))
      : [];
    if (readText && options.onSpeak) {
      const speaking = Boolean(options.isSpeaking?.(message.id));
      footer.push(el('button', {
        class: `read-aloud ${speaking ? 'is-speaking' : ''}`,
        type: 'button',
        title: speaking ? 'Detener lectura' : 'Leer respuesta en voz alta',
        'aria-label': speaking ? 'Detener lectura en voz alta' : 'Leer respuesta en voz alta',
        'data-message-id': message.id,
        onClick: () => options.onSpeak(message.id, readText),
      }, [uiIcon('volume', 14), el('span', { text: speaking ? 'Detener' : 'Leer en voz alta' })]));
    }
    if (footer.length > 0) body.appendChild(el('div', { class: 'msg-stats msg-stats-agent' }, footer));

    const streamingBlock = (message.blocks || []).filter((block) => block.streaming).pop();
    const avatarMode = !streamingBlock ? 'idle' : streamingBlock.kind === 'reasoning' ? 'thinking' : 'working';
    return el('article', { class: `msg msg-assistant${options.entering ? ' is-entering' : ''}`, 'data-id': message.id }, [
      agentAvatar(avatarMode),
      body,
    ]);
  }

  return el('article', { class: `msg msg-system${options.entering ? ' is-entering' : ''}`, 'data-id': message.id }, [
    el('div', { class: 'msg-avatar msg-avatar-system', title: 'Sistema' }, [uiIcon('activity', 16)]),
    el('div', { class: 'msg-body' }, [el('div', { class: 'bubble', text: message.text || '' })]),
  ]);
}

function messageMarkdown(message) {
  if (message.type === 'assistant') {
    return (message.blocks || [])
      .filter((block) => block.kind === 'text')
      .map((block) => block.text || '')
      .join('\n\n')
      .trim();
  }
  return String(message.text || message.payload?.text || '').trim();
}

function visibleMessageText(node) {
  return [...node.querySelectorAll('.msg-user .bubble, .msg-system .bubble, .block-text')]
    .map((block) => {
      const copy = block.cloneNode(true);
      copy.querySelectorAll('.code-head, .md-think').forEach((item) => item.remove());
      return copy.innerText || copy.textContent || '';
    })
    .filter((text) => text.trim())
    .join('\n\n')
    .trim();
}

export function mountChat(handlers) {
  const scroll = document.getElementById('chat-scroll');
  const input = document.getElementById('prompt-input');
  const sendButton = document.getElementById('send-btn');
  const title = document.getElementById('chat-title');
  const subtitle = document.getElementById('chat-subtitle');
  const hint = document.getElementById('composer-hint');
  const autocomplete = document.getElementById('autocomplete');
  const jumpButton = el('button', {
    class: 'chat-jump',
    type: 'button',
    hidden: true,
    text: '↓ Ir al final',
    onClick: () => pinBottom(true),
  });
  document.getElementById('chat').appendChild(jumpButton);
  // Recordatorio del último mensaje del usuario, fuera de #chat-scroll para
  // sobrevivir a los repintados y no alterar el scroll/auto-scroll.
  const userAnchor = el('aside', { class: 'chat-anchor', hidden: true, 'aria-hidden': 'true', 'data-i18n-skip': '' }, [
    el('span', { class: 'chat-anchor-label', text: 'Dijiste' }),
    el('div', { class: 'chat-anchor-text' }),
  ]);
  document.getElementById('chat').appendChild(userAnchor);

  let rendered = new Map(); // id -> { ref, node }
  let renderedSession = null;
  let autoScroll = true;
  let acSelection = 0;
  let acItems = [];
  let speakingMessageId = null;
  let speechController = null;
  const contextMenu = el('div', {
    class: 'chat-context-menu',
    role: 'menu',
    'aria-label': 'Opciones del mensaje',
    hidden: true,
  });
  document.body.appendChild(contextMenu);
  let contextMenuReturnFocus = null;
  let unregisterContextMenuEscape = null;

  function closeMessageContextMenu(restoreFocus = false) {
    if (contextMenu.hidden) return false;
    contextMenu.hidden = true;
    unregisterContextMenuEscape?.();
    unregisterContextMenuEscape = null;
    if (restoreFocus && contextMenuReturnFocus?.isConnected) contextMenuReturnFocus.focus();
    contextMenuReturnFocus = null;
    return true;
  }

  async function copyFromContextMenu(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage, 'ok', 1800);
    } catch {
      toast('No se pudo copiar al portapapeles.', 'warn');
    } finally {
      closeMessageContextMenu(true);
    }
  }

  function addContextMenuItem(action, label, text, successMessage) {
    contextMenu.appendChild(el('button', {
      class: 'chat-context-item',
      type: 'button',
      role: 'menuitem',
      text: label,
      'data-action': action,
      onClick: () => { void copyFromContextMenu(text, successMessage); },
    }));
  }

  function openMessageContextMenu(event) {
    closeMessageContextMenu();
    const target = event.target instanceof Element ? event.target : null;
    const messageNode = target?.closest('.msg[data-id]');
    if (!messageNode || !scroll.contains(messageNode)) return;
    const message = rendered.get(messageNode.dataset.id)?.ref;
    if (!message) return;

    const markdown = messageMarkdown(message);
    const visibleText = visibleMessageText(messageNode);
    const selection = window.getSelection();
    const selectedText = selection?.toString() || '';
    const selectionIsInMessage = Boolean(
      selectedText.trim()
      && selection?.anchorNode
      && selection?.focusNode
      && messageNode.contains(selection.anchorNode)
      && messageNode.contains(selection.focusNode),
    );
    const code = target.closest('.code-block')?.querySelector('code')?.textContent || '';
    if (!visibleText && !markdown && !selectionIsInMessage && !code.trim()) return;

    event.preventDefault();
    clear(contextMenu);
    if (selectionIsInMessage) {
      addContextMenuItem('copy-selection', 'Copiar selección', selectedText, 'Selección copiada al portapapeles.');
    }
    const hasMarkdown = markdown && markdown !== visibleText;
    const hasCode = Boolean(code.trim());
    if (selectionIsInMessage && (visibleText || hasMarkdown || hasCode)) {
      contextMenu.appendChild(el('div', { class: 'chat-context-separator', role: 'separator' }));
    }
    if (visibleText) {
      addContextMenuItem('copy-message', 'Copiar texto del mensaje', visibleText, 'Texto del mensaje copiado al portapapeles.');
    }
    if (hasMarkdown) {
      addContextMenuItem('copy-markdown', 'Copiar mensaje como Markdown', markdown, 'Mensaje copiado como Markdown.');
    }
    if (hasCode) {
      if (visibleText || hasMarkdown) contextMenu.appendChild(el('div', { class: 'chat-context-separator', role: 'separator' }));
      addContextMenuItem('copy-code', 'Copiar bloque de código', code, 'Código copiado al portapapeles.');
    }

    contextMenuReturnFocus = document.activeElement;
    contextMenu.hidden = false;
    const bounds = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8))}px`;
    contextMenu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8))}px`;
    unregisterContextMenuEscape = pushEscape(() => closeMessageContextMenu(true));
    contextMenu.querySelector('button')?.focus();
  }

  contextMenu.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...contextMenu.querySelectorAll('button:not(:disabled)')];
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!contextMenu.hidden && !contextMenu.contains(event.target)) closeMessageContextMenu();
  });
  document.addEventListener('contextmenu', openMessageContextMenu);
  window.addEventListener('resize', () => closeMessageContextMenu());
  window.addEventListener('blur', () => closeMessageContextMenu());

  // "Abrir archivo" from a tool card jumps to the Archivos panel.
  const toolOptions = {
    onOpenFile: (path) => {
      handlers.onFSRead?.(path);
    },
    onSpeak: (messageID, text) => speakMessage(messageID, text),
    isSpeaking: (messageID) => speakingMessageId === messageID,
  };

  // ------------------------------------------------------------ render ----

  /**
   * Baja hasta el final de verdad: los mensajes fuera de pantalla cambian de altura al
   * pintarse (content-visibility), así que se repite durante unos fotogramas hasta que
   * la altura se estabiliza. Con `force` también reactiva el seguimiento automático.
   */
  let pinToken = 0;
  function pinBottom(force = false) {
    if (force) {
      autoScroll = true;
      jumpButton.hidden = true;
    }
    const token = ++pinToken;
    let stable = 0;
    let lastHeight = -1;
    const step = () => {
      if (token !== pinToken) return;
      scroll.scrollTop = scroll.scrollHeight;
      if (scroll.scrollHeight === lastHeight) stable += 1; else stable = 0;
      lastHeight = scroll.scrollHeight;
      if (stable < 3) requestAnimationFrame(step);
      else autoScroll = true;
    };
    step();
  }

  // Durante el streaming los tokens llegan muy deprisa: el chat se repinta como mucho
  // cada ~70 ms (y siempre dentro de un fotograma), no en cada evento.
  let lastRenderAt = 0;
  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    const wait = Math.max(0, 70 - (performance.now() - lastRenderAt));
    renderTimer = setTimeout(() => {
      renderTimer = null;
      const paint = () => {
        lastRenderAt = performance.now();
        render();
      };
      // Con la ventana en segundo plano rAF no dispara: nunca dejamos el chat
      // a medias esperando un frame que puede no llegar.
      if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(paint);
      else paint();
    }, wait);
  }

  function updateSpeechButton(messageID) {
    if (!messageID) return;
    const button = [...scroll.querySelectorAll('.read-aloud')]
      .find((item) => item.dataset.messageId === messageID);
    if (!button) return;
    const speaking = speakingMessageId === messageID;
    button.classList.toggle('is-speaking', speaking);
    button.title = speaking ? 'Detener lectura' : 'Leer respuesta en voz alta';
    button.setAttribute('aria-label', speaking ? 'Detener lectura en voz alta' : 'Leer respuesta en voz alta');
    button.querySelector('span').textContent = speaking ? 'Detener' : 'Leer en voz alta';
  }

  function stopSpeech() {
    const previousMessageID = speakingMessageId;
    speechController?.cancel();
    speechController = null;
    speakingMessageId = null;
    updateSpeechButton(previousMessageID);
  }

  function speakMessage(messageID, text) {
    if (speakingMessageId === messageID && speechController) {
      stopSpeech();
      return;
    }
    const previousMessageID = speakingMessageId;
    speechController?.cancel();
    speechController = null;

    const settings = state.settings || {};
    const controller = speakText(text, {
      lang: document.documentElement.lang || navigator.language || 'es-ES',
      voiceURI: settings.speechVoice || '',
      rate: Number(settings.speechRate) || 1.02,
      onStart: () => {
        speakingMessageId = messageID;
        updateSpeechButton(messageID);
      },
      onProgress: (index, total) => {
        const button = [...scroll.querySelectorAll('.read-aloud')]
          .find((item) => item.dataset.messageId === messageID);
        if (button) button.title = `Leyendo ${index}/${total} · detener`;
      },
      onEnd: () => finishSpeech(controller),
      onError: () => finishSpeech(controller),
    });
    if (!controller) {
      toast('La lectura en voz alta no está disponible en este sistema.', 'warn');
      return;
    }
    speechController = controller;
    speakingMessageId = messageID;
    updateSpeechButton(previousMessageID);
    updateSpeechButton(messageID);
  }

  function finishSpeech(controller) {
    if (speechController !== controller) return;
    const messageID = speakingMessageId;
    speechController = null;
    speakingMessageId = null;
    updateSpeechButton(messageID);
  }

  /** Sticky header: what is happening right now (agent, model, tool, time). */
  function renderLiveStatus(session) {
    const live = document.getElementById('chat-live');
    if (!live) return;
    if (!session) {
      live.hidden = true;
      return;
    }
    const runtime = runtimeOf(session.id);
    const agentName = session.agent || state.selection?.agent || 'build';
    const model = session.model
      ? `${session.model.providerID ? `${session.model.providerID}/` : ''}${session.model.id || session.model.modelID || ''}`
      : (state.selection?.modelID
        ? `${state.selection.providerID ? `${state.selection.providerID}/` : ''}${state.selection.modelID}`
        : 'modelo —');

    if (!runtime.busy) {
      live.hidden = true;
      return;
    }
    const elapsed = runtime.startedAt ? `${Math.max(1, Math.round((Date.now() - runtime.startedAt) / 1000))}s` : '';
    const tool = runtime.tool ? ` · ${runtime.tool}` : '';
    live.hidden = false;
    live.classList.toggle('is-error', Boolean(runtime.errorMessage));
    live.textContent = `${agentName} · ${model} · ${elapsed}${tool}`;
  }

  /** El último mensaje del usuario se mantiene visible aunque se repinte el chat. */
  function updateAnchor() {
    if (!userAnchor.isConnected) return;
    const session = activeSession();
    if (!session) {
      userAnchor.hidden = true;
      return;
    }
    const clearedAt = state.ui.cleared?.[session.id] || 0;
    const messages = messagesOf(session.id).filter((message) => message.type !== 'idle'
      && (!clearedAt || !message.time || message.time >= clearedAt - 2000));
    const lastUser = [...messages].reverse().find((message) => message.type === 'user');
    const text = lastUser ? (lastUser.text || lastUser.payload?.text || '') : '';
    if (!text) {
      // Limpiamos también el texto: un banner oculto con el mensaje de otra
      // sesión es confuso al inspeccionar el DOM y al volver a mostrarlo.
      userAnchor.querySelector('.chat-anchor-text').textContent = '';
      userAnchor.hidden = true;
      return;
    }
    const label = userAnchor.querySelector('.chat-anchor-text');
    if (label.textContent !== text) label.textContent = text;
    userAnchor.hidden = false;
  }

  function render() {
    const session = activeSession();
    const sessionID = session?.id || null;
    updateAnchor();

    title.textContent = session ? session.title || 'Sesión sin título' : 'Chat';
    subtitle.textContent = session?.time?.updated ? `actualizada ${formatTime(session.time.updated)}` : '';
    sendButton.textContent = runtimeOf(sessionID).busy ? 'Detener' : 'Enviar';
    sendButton.classList.toggle('is-stop', Boolean(sessionID && runtimeOf(sessionID).busy));
    sendButton.disabled = !sessionID;
    renderLiveStatus(session);

    if (!session) {
      closeMessageContextMenu();
      stopSpeech();
      clear(scroll);
      rendered = new Map();
      renderedSession = null;
      scroll.appendChild(el('div', { class: 'chat-empty' }, [
        el('p', { text: state.project.dir
          ? 'Crea una sesión para empezar a trabajar.'
          : 'Elige una carpeta de proyecto para empezar.' }),
        el('div', { class: 'chat-empty-actions' }, [
          el('button', {
            class: 'btn-primary',
            type: 'button',
            text: '📂 Abrir proyecto',
            onClick: () => handlers.onOpenProject(),
          }),
          el('button', {
            class: 'btn-small',
            type: 'button',
            text: '＋ Nueva sesión',
            onClick: () => handlers.onNewSession(),
          }),
        ]),
      ]));
      return;
    }
    const clearedAt = state.ui.cleared?.[sessionID] || 0;
    const messages = messagesOf(sessionID).filter((message) => !clearedAt || !message.time || message.time > clearedAt);
    const visible = messages.filter((message) => message.type !== 'idle');

    if (sessionID !== renderedSession) {
      closeMessageContextMenu();
      stopSpeech();
      clear(scroll);
      rendered = new Map();
      renderedSession = sessionID;
      autoScroll = true;
    }

    if (visible.length === 0) {
      if (!scroll.querySelector('.chat-empty')) {
        clear(scroll);
        scroll.appendChild(el('div', { class: 'chat-empty', text: 'Sin mensajes todavía. Escribe abajo para empezar.' }));
      }
      rendered = new Map();
      return;
    }

    const empty = scroll.querySelector('.chat-empty');
    if (empty) empty.remove();

    const ids = visible.map((message) => message.id);
    const knownIds = [...rendered.keys()];
    const sameSet = ids.length === knownIds.length && ids.every((id, index) => id === knownIds[index]);

    // Rebuilding the list resets scrollTop, so remember how far the reader was
    // from the bottom to restore it when they had scrolled up.
    const viewportTop = autoScroll ? 0 : scroll.getBoundingClientRect().top;
    let anchor = null;
    if (!autoScroll) {
      const anchorNode = [...scroll.querySelectorAll('.msg[data-id]')]
        .find((node) => node.getBoundingClientRect().bottom > viewportTop);
      anchor = anchorNode ? {
        id: anchorNode.dataset.id,
        offset: anchorNode.getBoundingClientRect().top - viewportTop,
      } : null;
    }

    if (!sameSet) {
      // Se reutilizan los nodos que no cambiaron (no se vuelve a parsear Markdown de todo
      // el historial) y solo los mensajes realmente nuevos entran con animación.
      const previous = rendered;
      const append = ids.length >= knownIds.length && knownIds.every((id, index) => id === ids[index]);
      rendered = new Map();
      const nodes = [];
      if (append) {
        scroll.querySelector('.chat-typing')?.remove();
        scroll.querySelector('.chat-error-banner')?.remove();
      }
      for (const message of visible) {
        const old = previous.get(message.id);
        let node;
        if (old && old.ref === message) {
          node = old.node;
        } else if (old && patchReasoningUpdate(old, message)) {
          node = old.node;
        } else {
          node = renderMessage(message, { ...toolOptions, entering: previous.size > 0 && !old });
          if (node && old) {
            preserveToolExpansion(old.node, node);
            if (append) old.node.replaceWith(node);
          } else if (node && append) {
            scroll.appendChild(node);
          }
        }
        if (!node) continue;
        rendered.set(message.id, { ref: message, node });
        nodes.push(node);
      }
      if (!append) scroll.replaceChildren(...nodes);
    } else {
      for (const message of visible) {
        const entry = rendered.get(message.id);
        if (!entry || entry.ref === message) continue;
        if (patchReasoningUpdate(entry, message)) continue;
        const node = renderMessage(message, toolOptions);
        preserveToolExpansion(entry.node, node);
        entry.node.replaceWith(node);
        entry.ref = message;
        entry.node = node;
      }
    }

    if (autoScroll) pinBottom();
    else if (anchor) {
      const nextAnchor = rendered.get(anchor.id)?.node;
      if (nextAnchor) scroll.scrollTop += nextAnchor.getBoundingClientRect().top - viewportTop - anchor.offset;
    }
    jumpButton.hidden = autoScroll || scroll.scrollHeight <= scroll.clientHeight + 8;
    renderTyping(sessionID, visible);
    renderErrorBanner(sessionID);
  }

  /** Indicador "pensando…" mientras el agente trabaja y aún no ha empezado a responder. */
  function renderTyping(sessionID, visible) {
    let node = scroll.querySelector('.chat-typing');
    const runtime = runtimeOf(sessionID);
    const last = visible[visible.length - 1];
    const waiting = runtime.busy && (!last || last.type === 'user' || (last.type === 'assistant' && (last.blocks || []).length === 0));
    if (!waiting) {
      node?.remove();
      return;
    }
    if (!node) node = typingIndicator(runtime.tool ? `usando ${runtime.tool}…` : 'pensando…');
    else node.querySelector('.typing-label').textContent = runtime.tool ? `usando ${runtime.tool}…` : 'pensando…';
    scroll.appendChild(node);
    if (autoScroll) pinBottom();
  }

  /**
   * El razonamiento se repinta varias veces por segundo: sin esto el cuadro volvía siempre arriba
   * y no se podía bajar a leer. Se conserva si estaba abierto y su posición; si estaba al final,
   * sigue el texto nuevo.
   */
  function preserveReasoning(previousNode, nextNode) {
    const before = previousNode.querySelectorAll('.block-reasoning');
    const after = nextNode.querySelectorAll('.block-reasoning');
    before.forEach((old, index) => {
      const current = after[index];
      if (!current) return;
      const body = old.lastElementChild;
      const saved = body ? body.scrollTop : 0;
      const atBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 28 : true;
      current.open = old.open && current.open;
      requestAnimationFrame(() => {
        const next = current.lastElementChild;
        if (!next || next === current.firstElementChild) return;
        next.scrollTop = atBottom ? next.scrollHeight : saved;
      });
    });
  }

  function patchReasoningUpdate(entry, message) {
    const previous = entry.ref;
    const before = previous.blocks || [];
    const after = message.blocks || [];
    if (before.length !== after.length
      || previous.agent !== message.agent
      || previous.model !== message.model
      || previous.stats !== message.stats
      || previous.streaming !== message.streaming) return false;

    const updates = [];
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] === after[index]) continue;
      if (before[index].kind !== 'reasoning'
        || after[index].kind !== 'reasoning'
        || before[index].key !== after[index].key) return false;
      updates.push(after[index]);
    }
    if (updates.length === 0) return false;

    const details = new Map([...entry.node.querySelectorAll('.block-reasoning')]
      .map((node) => [node.dataset.blockKey, node]));
    if (updates.some((block) => !details.has(block.key))) return false;

    for (const block of updates) {
      const node = details.get(block.key);
      const pre = node.querySelector('pre');
      const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 28;
      const savedScrollTop = pre.scrollTop;
      if (!block.streaming) node.open = false;
      node.querySelector('summary').textContent = block.streaming ? 'Razonamiento en curso…' : 'Razonamiento';
      pre.textContent = block.text || '';
      pre.scrollTop = atBottom ? pre.scrollHeight : savedScrollTop;
    }
    entry.ref = message;
    return true;
  }

  function preserveToolExpansion(previousNode, nextNode) {
    preserveReasoning(previousNode, nextNode);
    const previous = new Map([...previousNode.querySelectorAll('.tool-card[data-tool-key]')].map((card) => {
      const body = card.querySelector('.tool-body');
      return [card.dataset.toolKey, Boolean(body && !body.hidden)];
    }));
    for (const card of nextNode.querySelectorAll('.tool-card[data-tool-key]')) {
      if (!previous.has(card.dataset.toolKey)) continue;
      const expanded = previous.get(card.dataset.toolKey);
      const body = card.querySelector('.tool-body');
      const toggle = card.querySelector('.tool-toggle');
      if (body) body.hidden = !expanded;
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Ocultar detalle de la herramienta' : 'Ver detalle de la herramienta');
        toggle.textContent = expanded ? '▴' : '▾';
      }
    }
  }

  /** Shows why the last turn failed (quota, provider error, …). */
  function renderErrorBanner(sessionID) {
    const runtime = runtimeOf(sessionID);
    const message = runtime?.errorMessage || '';
    let node = scroll.querySelector('.chat-error-banner');
    if (!message) {
      node?.remove();
      return;
    }
    if (!node) {
      node = el('div', { class: 'chat-error-banner' }, [
        el('span', { class: 'chat-error-icon', text: '⚠️' }),
        el('div', { class: 'chat-error-text' }),
        el('button', {
          class: 'btn-small',
          type: 'button',
          text: 'Reintentar',
          onClick: () => handlers.onRetryLast?.(),
        }),
      ]);
      scroll.appendChild(node);
    }
    const text = node.querySelector('.chat-error-text');
    if (text) text.textContent = message;
    node.classList.toggle('is-quota', /quota|rate limit|límite/i.test(message));
    if (autoScroll) pinBottom();
  }

  scroll.addEventListener('scroll', () => {
    closeMessageContextMenu();
    autoScroll = isAtBottom(scroll);
    jumpButton.hidden = autoScroll;
  });

  // Copy buttons + external links + visor de imágenes (event delegation).
  scroll.addEventListener('click', async (event) => {
    const thumb = event.target.closest('.msg-image');
    if (thumb) {
      const gallery = thumb.closest('.msg-images');
      const items = [...gallery.querySelectorAll('.msg-image img')].map((image) => ({ src: image.src, name: image.alt }));
      openLightbox(items, Number(thumb.dataset.index) || 0);
      return;
    }
    const copy = event.target.closest('.copy-code');
    if (copy) {
      const code = copy.closest('.code-block')?.querySelector('code');
      if (code) {
        try {
          await navigator.clipboard.writeText(code.textContent || '');
          copy.textContent = 'Copiado';
          setTimeout(() => { copy.textContent = 'Copiar'; }, 1200);
        } catch {
          toast('No se pudo copiar al portapapeles.', 'warn');
        }
      }
      return;
    }
    const link = event.target.closest('a[data-external]');
    if (link) {
      event.preventDefault();
      window.oc.openExternal(link.getAttribute('href'));
    }
  });

  // -------------------------------------------------------- autocomplete ----

  function hideAutocomplete() {
    autocomplete.hidden = true;
    autocomplete.innerHTML = '';
    acItems = [];
    acSelection = 0;
  }

  function commandList() {
    const fromServer = state.commands.map((command) => ({ name: command.name, description: command.description || '' }));
    return [...INTERNAL_COMMANDS, ...fromServer.filter((command) => !INTERNAL_COMMANDS.some((item) => item.name === command.name))];
  }

  function renderAutocomplete(query) {
    const term = query.toLowerCase();
    const items = commandList().filter((command) => command.name.toLowerCase().startsWith(term));
    if (items.length === 0) {
      hideAutocomplete();
      return;
    }
    acItems = items;
    acSelection = Math.min(acSelection, items.length - 1);
    clear(autocomplete);
    items.forEach((item, index) => {
      autocomplete.appendChild(el('div', {
        class: `ac-item ${index === acSelection ? 'is-selected' : ''}`,
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => { void runAutocomplete(item); },
      }, [
        el('span', { class: 'ac-name', text: `/${item.name}` }),
        el('span', { class: 'ac-desc', text: item.description }),
      ]));
    });
    autocomplete.hidden = false;
  }

  function pickAutocomplete(item) {
    if (!item) return;
    input.value = `/${item.name} `;
    input.focus();
    resizeInput();
    hideAutocomplete();
    updateHint();
  }

  async function runAutocomplete(item) {
    if (!item) return;
    input.value = `/${item.name}`;
    resizeInput();
    hideAutocomplete();
    updateHint();
    await submit();
  }

  function handleAutocompleteKey(event) {
    if (autocomplete.hidden) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      acSelection = (acSelection + 1) % acItems.length;
      renderAutocomplete(input.value.slice(1).split(/\s/)[0]);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      acSelection = (acSelection - 1 + acItems.length) % acItems.length;
      renderAutocomplete(input.value.slice(1).split(/\s/)[0]);
      return true;
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && acItems.length > 0 && !input.value.includes('\n'))) {
      const isCommandOnly = /^\/\S*$/.test(input.value.trim());
      if (isCommandOnly) {
        event.preventDefault();
        pickAutocomplete(acItems[acSelection]);
        return true;
      }
    }
    if (event.key === 'Escape') {
      hideAutocomplete();
      return true;
    }
    return false;
  }

  // ----------------------------------------------------------- adjuntos ----
  const attachments = mountAttachments({
    chat: document.getElementById('chat'),
    composer: input.closest('.composer') || input.parentElement,
    input,
    actions: sendButton.parentElement,
    onChange: () => updateHint(),
  });

  // ------------------------------------------------------------ búsqueda ----
  mountChatSearch({
    chat: document.getElementById('chat'),
    scroll,
    headerButtonAnchor: document.getElementById('chat-clear'),
  });

  // ------------------------------------------------------------ composer ----

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 190)}px`;
  }

  function updateHint() {
    const value = input.value.trim();
    if (!value) {
      hint.textContent = '';
      return;
    }
    if (value.startsWith('!')) hint.textContent = 'Se ejecutará como comando de shell en la sesión';
    else if (value.startsWith('/')) hint.textContent = 'Comando';
    else hint.textContent = '';
  }

  input.addEventListener('input', () => {
    resizeInput();
    const value = input.value;
    if (/^\/\S*$/.test(value)) renderAutocomplete(value.slice(1));
    else hideAutocomplete();
    updateHint();
  });

  input.addEventListener('keydown', async (event) => {
    if (handleAutocompleteKey(event)) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || (state.settings.enterToSend !== false && !event.shiftKey))) {
      event.preventDefault();
      await submit();
    }
  });

  async function submit() {
    const text = input.value.trim();
    const files = attachments.peek();
    if (!text && files.length === 0) return;
    if (attachments.isBusy()) {
      toast('Espera a que terminen de cargarse los archivos.', 'warn');
      return;
    }
    if (files.length > 0 && (text.startsWith('!') || text.startsWith('/'))) {
      toast('Los comandos no admiten archivos adjuntos: quítalos o envía un mensaje normal.', 'warn');
      return;
    }
    const session = activeSession();
    if (!session) {
      toast('Abre un proyecto y crea una sesión primero.', 'warn');
      return;
    }
    if (runtimeOf(session.id).busy) {
      toast('El agente todavía está trabajando. Detén la respuesta para enviar otra cosa.', 'warn');
      return;
    }

    if (text.startsWith('!')) {
      const command = text.slice(1).trim();
      if (!command) return;
      input.value = '';
      resizeInput();
      updateHint();
      hideAutocomplete();
      setUI({ tab: 'terminal' });
      const result = await window.oc.request('POST', `/api/session/${session.id}/shell`, { body: { command } });
      if (!result.ok) toast(`No se pudo ejecutar el comando: ${result.error}`, 'error');
      return;
    }

    if (text.startsWith('/')) {
      const [name, ...rest] = text.slice(1).split(/\s+/);
      const restText = rest.join(' ');
      if (name === 'nueva') { handlers.onNewSession(); input.value = ''; return; }
      if (name === 'abortar') { await handlers.onAbort(); input.value = ''; return; }
      if (name === 'deshacer') { handlers.onUndo(); input.value = ''; return; }
      if (name === 'limpiar-vista') { handlers.onClearView(); input.value = ''; return; }
      if (INTERNAL_COMMANDS.some((command) => command.name === name)) return;
    }

    const previous = input.value;
    input.value = '';
    resizeInput();
    updateHint();
    hideAutocomplete();

    // lo que acabas de escribir debe verse siempre: se vuelve al final y se sigue el chat
    pinBottom(true);
    stageAttachments(files);
    const ok = await handlers.onSend(text);
    stageAttachments([]);
    if (ok) {
      attachments.clear();
      pinBottom(true);
    } else {
      input.value = previous;
      resizeInput();
    }
  }

  sendButton.addEventListener('click', async () => {
    const session = activeSession();
    if (!session) return;
    if (runtimeOf(session.id).busy) {
      await handlers.onAbort();
      return;
    }
    await submit();
  });

  document.getElementById('chat-clear').addEventListener('click', () => handlers.onClearView());
  document.getElementById('chat-discard').addEventListener('click', () => handlers.onDiscard());
  document.getElementById('chat-terminal')?.addEventListener('click', () => {
    window.__showPanel?.('terminal');
  });

  subscribe(['messages', 'activeSessionId', 'sessions', 'runtime', 'ui', 'commands', 'selection', 'settings'], scheduleRender);
  // Camino directo: el anclaje no depende del throttle ni de requestAnimationFrame.
  subscribe(['messages', 'activeSessionId', 'ui'], updateAnchor);
  render();
  return { render, focus: () => input.focus(), setText: (text) => { input.value = text; input.focus(); resizeInput(); } };
}
