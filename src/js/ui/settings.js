import { el, clear } from '../util/dom.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { state, set as setState } from '../store.js';
import { getVolume, setVolume } from './office/sound.js';
import { request } from '../api.js';
import { speechVoices, speakText } from './speech.js';
import { SUPPORTED_LOCALES, setLocale, currentLocale } from '../i18n.js';

/**
 * Settings modal. Every control writes through `window.oc.settings.set`, so the
 * store in the main process is always the source of truth.
 */
export function openSettings({ onRestart, onDemoChange } = {}) {
  const current = { ...state.settings };
  const connection = { ...(current.connection || {}) };
  const permissions = { ...(current.permissions || {}) };

  const restartButton = el('button', { class: 'btn-small', type: 'button', text: 'Reiniciar servidor' });
  const statusLine = el('div', { class: 'muted tiny', text: 'Consultando estado…' });
  const logs = el('pre', { class: 'server-logs', text: '' });

  async function save(partial) {
    try {
      const next = await window.oc.settings.set(partial);
      Object.assign(current, next);
      setState({ settings: next });
      return next;
    } catch (error) {
      toast(`No se pudieron guardar los ajustes: ${error.message}`, 'error');
      return null;
    }
  }

  async function refreshStatus() {
    const status = await window.oc.server.status();
    statusLine.textContent = `${status.state}${status.demo ? ' · demo' : ''} · ${status.url || 'sin URL'}`;
    logs.textContent = (status.logs || []).slice(-14).join('\n') || '(sin registros)';
  }

  function select({ label, value, options, onChange, hint }) {
    const node = el('select', {
      onChange: (event) => onChange(event.target.value),
    });
    for (const option of options) node.appendChild(new Option(option.label, option.value, false, option.value === value));
    return el('label', { class: 'field' }, [el('span', { text: label }), node, hint ? el('small', { text: hint }) : null]);
  }

  function textField({ label, value, placeholder, type = 'text', onChange, hint }) {
    const input = el('input', { type, value: value || '', placeholder: placeholder || '' });
    input.addEventListener('change', () => onChange(input.value.trim()));
    return el('label', { class: 'field' }, [el('span', { text: label }), input, hint ? el('small', { text: hint }) : null]);
  }

  function toggleRow({ label, hint, checked, onChange }) {
    const input = el('input', { class: 'switch', type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    return el('div', { class: 'switch-row' }, [
      el('div', { class: 'label' }, [el('strong', { text: label }), hint ? el('small', { text: hint }) : null]),
      input,
    ]);
  }

  const openCodeConfigList = el('div', { class: 'opencode-config-list' }, [
    el('div', { class: 'muted tiny', text: 'Consultando proveedores y archivos de configuración…' }),
  ]);
  async function refreshOpenCodeConfig() {
    openCodeConfigList.replaceChildren();
    const [configResult, providerResult] = await Promise.all([
      request('GET', '/api/config'),
      request('GET', '/api/provider'),
    ]);
    if (!configResult.ok && !providerResult.ok) {
      openCodeConfigList.appendChild(el('div', { class: 'muted tiny', text: `No se pudo conectar con OpenCode: ${configResult.error || providerResult.error}` }));
      return;
    }
    const providers = Array.isArray(providerResult.data?.data) ? providerResult.data.data : [];
    openCodeConfigList.appendChild(el('div', { class: 'opencode-provider-list' }, providers.length
      ? providers.map((provider) => el('div', { class: 'opencode-provider-row' }, [
        el('strong', { text: provider.name || provider.id }),
        el('span', { class: 'muted tiny', text: `${provider.id} · ${provider.activation || 'disponible'}` }),
      ]))
      : [el('div', { class: 'muted tiny', text: 'No se encontraron proveedores activos.' })]));

    const documents = Array.isArray(configResult.data) ? configResult.data : (configResult.data?.data || []);
    const configs = documents.filter((document) => document?.type === 'document' && document.path);
    if (configs.length) {
      configs.forEach((document) => {
        openCodeConfigList.appendChild(el('button', {
          class: 'btn-small opencode-config-button',
          type: 'button',
          title: document.path,
          text: `Abrir ${document.path}`,
          onClick: async () => {
            const opened = await window.oc.openOpenCodeConfig(document.path);
            if (!opened?.ok) toast(`No se pudo abrir la configuración: ${opened?.error || 'error desconocido'}`, 'error');
          },
        }));
      });
    } else {
      openCodeConfigList.appendChild(el('div', { class: 'muted tiny', text: 'OpenCode no informó archivos de configuración.' }));
    }
  }

  const opencodeSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'OpenCode y proveedores' }),
    el('p', { class: 'muted tiny', text: 'Desde el archivo de configuración puedes agregar o quitar proveedores y definir sus modelos. Esta API permite consultar proveedores, pero no editar su configuración directamente.' }),
    openCodeConfigList,
    el('button', {
      class: 'btn-small',
      type: 'button',
      text: 'Documentación de proveedores',
      onClick: () => window.oc.openExternal('https://opencode.ai/docs/providers/'),
    }),
  ]);

  const connectionSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Conexión' }),
    select({
      label: 'Modo',
      value: connection.mode || 'spawn',
      options: [
        { value: 'spawn', label: 'Lanzar opencode serve (recomendado)' },
        { value: 'connect', label: 'Conectar a un servidor existente' },
      ],
      hint: 'El modo «lanzar» arranca el servidor y genera su propia contraseña.',
      onChange: (value) => {
        connection.mode = value;
        save({ connection: { mode: value } });
        updateConnectionFields();
      },
    }),
    el('div', { class: 'connection-remote' }, [
      textField({
        label: 'URL del servidor',
        value: connection.url,
        placeholder: 'http://127.0.0.1:4096',
        hint: 'Solo en modo «conectar».',
        onChange: (value) => { connection.url = value; save({ connection: { url: value } }); },
      }),
      textField({
        label: 'Contraseña del servidor',
        value: connection.password,
        type: 'password',
        hint: 'La que imprime `opencode serve` o la de OPENCODE_SERVER_PASSWORD.',
        onChange: (value) => { connection.password = value; save({ connection: { password: value } }); },
      }),
    ]),
    textField({
      label: 'Ruta de opencode (opcional)',
      value: current.opencodePath,
      placeholder: 'opencode   (o C:\\ruta\\a\\opencode.exe)',
      hint: 'Déjalo vacío para usar el que esté en PATH.',
      onChange: (value) => save({ opencodePath: value }),
    }),
    el('div', { class: 'settings-status-row' }, [restartButton, statusLine]),
    logs,
  ]);

  function updateConnectionFields() {
    const remote = connectionSection.querySelector('.connection-remote');
    if (remote) remote.hidden = connection.mode !== 'connect';
  }
  updateConnectionFields();

  restartButton.addEventListener('click', async () => {
    restartButton.disabled = true;
    restartButton.textContent = 'Reiniciando…';
    try {
      await onRestart?.();
    } finally {
      restartButton.disabled = false;
      restartButton.textContent = 'Reiniciar servidor';
      refreshStatus();
    }
  });

  const appearanceSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Apariencia' }),
    select({
      label: 'Idioma',
      value: currentLocale(),
      options: SUPPORTED_LOCALES.map((item) => ({ value: item.code, label: item.label })),
      hint: 'El cambio se aplica a toda la interfaz al momento.',
      onChange: async (value) => {
        const next = await save({ locale: value });
        if (!next) return;
        setLocale(value);
        toast(value === 'es' ? 'Idioma: Español' : 'Language: English', 'success', 2500);
      },
    }),
    select({
      label: 'Tema',
      value: current.theme || 'dark',
      options: [{ value: 'dark', label: 'Oscuro' }, { value: 'light', label: 'Claro' }],
      onChange: async (value) => {
            const next = await save({ theme: value });
            if (!next) return;
            document.documentElement.dataset.theme = value;
            const app = document.getElementById('app');
            if (app) app.dataset.theme = value;
          },
    }),
    el('label', { class: 'field' }, [
      el('span', { text: `Tamaño de fuente: ${current.fontSize || 14} px` }),
      (() => {
        const range = el('input', {
          type: 'range',
          min: '12',
          max: '18',
          step: '1',
          value: String(current.fontSize || 14),
          onInput: (event) => {
            const value = Number(event.target.value);
            event.target.closest('.field').querySelector('span').textContent = `Tamaño de fuente: ${value} px`;
            document.documentElement.style.setProperty('--font-size', `${value}px`);
          },
          onChange: (event) => save({ fontSize: Number(event.target.value) }),
        });
        return range;
      })(),
    ]),
    el('label', { class: 'field' }, [
      el('span', { text: `Velocidad de lectura: ${(current.speechRate || 1.02).toFixed(2)}x` }),
      (() => {
        const range = el('input', {
          type: 'range',
          min: '0.6',
          max: '1.6',
          step: '0.02',
          value: String(current.speechRate || 1.02),
          onInput: (event) => {
            const value = Number(event.target.value);
            event.target.closest('.field').querySelector('span').textContent = `Velocidad de lectura: ${value.toFixed(2)}x`;
          },
          onChange: (event) => save({ speechRate: Number(event.target.value) }),
        });
        return range;
      })(),
    ]),
    (() => {
      const field = el('label', { class: 'field' }, [
        el('span', { text: 'Voz para leer en voz alta' }),
      ]);
      const voiceSelect = el('select');
      const renderVoices = () => {
        const selected = current.speechVoice || '';
        clear(voiceSelect);
        voiceSelect.appendChild(new Option('Automática (mejor voz disponible)', '', false, !selected));
        for (const voice of speechVoices()) {
          voiceSelect.appendChild(new Option(
            `${voice.name} · ${voice.lang}`,
            voice.voiceURI,
            false,
            voice.voiceURI === selected,
          ));
        }
      };
      renderVoices();
      voiceSelect.addEventListener('change', () => save({ speechVoice: voiceSelect.value }));
      if (window.speechSynthesis) {
        window.speechSynthesis.addEventListener?.('voiceschanged', renderVoices);
      }
      field.appendChild(voiceSelect);
      field.appendChild(el('button', {
        class: 'btn-small',
        type: 'button',
        text: '▶ Probar voz',
        title: 'Escuchar una frase de ejemplo con la voz elegida',
        onClick: () => {
          speakText('Hola, así sonará la lectura en voz alta de tus respuestas.', {
            lang: document.documentElement.lang || navigator.language || 'es-ES',
            voiceURI: voiceSelect.value,
            rate: Number(current.speechRate) || 1.02,
          });
        },
      }));
      return field;
    })(),
    toggleRow({
      label: 'Animaciones',
      hint: 'Desactívalas si prefieres una interfaz estática o usas movimiento reducido.',
      checked: current.animations !== false,
      onChange: (value) => save({ animations: value }),
    }),
  ]);

  const chatSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Chat' }),
    toggleRow({
      label: 'Enviar con Enter',
      hint: 'Desactívalo para insertar saltos de línea con Enter; usa Ctrl+Enter para enviar.',
      checked: current.enterToSend !== false,
      onChange: (value) => save({ enterToSend: value }),
    }),
    toggleRow({
      label: 'Mostrar información del modelo',
      hint: 'Muestra agente, modelo, tokens y coste bajo las respuestas.',
      checked: current.showModelStats !== false,
      onChange: (value) => save({ showModelStats: value }),
    }),
  ]);

  // Gastar menos datos: cada mensaje reenvía todo el contexto al proveedor.
  const dataSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Datos y contexto' }),
    el('p', {
      class: 'muted tiny',
      text: 'Cada mensaje sube al proveedor toda la conversación anterior. La forma de gastar menos megas es compactar el contexto: el agente resume el historial y los envíos siguientes son mucho más pequeños.',
    }),
    toggleRow({
      label: 'Compactar el contexto automáticamente',
      hint: 'Resume la conversación al llegar al umbral. Se conserva un resumen con objetivos, decisiones y trabajo pendiente.',
      checked: current.autoCompact !== false,
      onChange: (value) => save({ autoCompact: value }),
    }),
    select({
      label: 'Umbral de compactación',
      hint: 'Cuánto contexto se acumula antes de resumir. Más bajo = menos datos por mensaje, pero menos detalle.',
      value: String(current.autoCompactTokens || 60000),
      options: [
        { value: '20000', label: '20.000 tokens (ahorro máximo)' },
        { value: '40000', label: '40.000 tokens' },
        { value: '60000', label: '60.000 tokens (recomendado)' },
        { value: '120000', label: '120.000 tokens' },
        { value: '200000', label: '200.000 tokens' },
      ],
      onChange: (value) => save({ autoCompactTokens: Number(value) || 60000 }),
    }),
  ]);

  const permissionsSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Permisos de las sesiones nuevas' }),
    toggleRow({
      label: 'Pedir permiso para editar archivos',
      hint: 'Se aplica al crear sesiones. Las sesiones existentes mantienen su ruleset.',
      checked: permissions.askEdit !== false,
      onChange: (value) => { permissions.askEdit = value; save({ permissions: { askEdit: value } }); },
    }),
    toggleRow({
      label: 'Pedir permiso para ejecutar comandos',
      hint: 'Añade una regla `ask` para bash.',
      checked: permissions.askBash !== false,
      onChange: (value) => { permissions.askBash = value; save({ permissions: { askBash: value } }); },
    }),
  ]);

  const subagentSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Subagentes' }),
    toggleRow({
      label: 'Archivar subagentes terminados',
      hint: 'A los 12 s de terminar salen de la lista y de la oficina; un minuto después se archivan en opencode. Nunca se borran.',
      checked: current.archiveSubagents !== false,
      onChange: (value) => save({ archiveSubagents: value }),
    }),
    el('p', { class: 'muted tiny', text: 'Si lo desactivas, los subagentes terminados se ocultan igualmente pero se quedan en el servidor. Puedes limpiarlos a mano desde la lista de sesiones.' }),
  ]);

  const volumeLabel = el('span', { text: `Volumen de sonidos: ${Math.round(getVolume() * 100)}%` });
  const volumeRange = el('input', {
    type: 'range',
    min: '0',
    max: '150',
    step: '5',
    value: String(Math.round(getVolume() * 100)),
    'aria-label': 'Volumen de sonidos de la oficina',
    onInput: (event) => {
      const value = Number(event.target.value);
      setVolume(value / 100);
      volumeLabel.textContent = `Volumen de sonidos: ${value}%`;
    },
  });
  const soundSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Sonido de la oficina' }),
    el('label', { class: 'field' }, [
      volumeLabel,
      volumeRange,
      el('small', { text: 'Ajusta el nivel de los pasos, teclas y avisos. El cambio se guarda automáticamente.' }),
    ]),
  ]);

  const demoSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Modo demo' }),
    toggleRow({
      label: 'Usar datos de demostración',
      hint: 'No arranca opencode: simula sesiones y eventos. Al cambiarlo se reinicia la conexión.',
      checked: Boolean(state.server.demo || current.demo),
      onChange: async (value) => {
        const next = await save({ demo: value });
        if (next) onDemoChange?.(value);
      },
    }),
  ]);

  const infoSection = el('section', { class: 'settings-section' }, [
    el('h3', { text: 'Información' }),
    el('p', { class: 'muted tiny', text: 'Desarrollado por Hugo Alejandro Martinez, HCoreBeat y HLab Interactive.' }),
    el('p', { class: 'muted tiny', text: 'Licencia MIT: puedes usar, copiar, modificar y distribuir este software, conservando el aviso de copyright y la licencia. Se ofrece sin garantía.' }),
    el('div', { class: 'muted tiny', text: `Versión de la app: ${state.appInfo?.version || '0.1.0'} · Electron ${(navigator.userAgent.split('Electron/')[1] || '').split(' ')[0]}` }),
    el('div', { class: 'muted tiny', text: `Datos: ${state.appInfo?.userData || ''}` }),
    el('div', { class: 'muted tiny', text: `Proyecto: ${state.project.dir || '(ninguno)'}` }),
  ]);

  let timer = null;
  const modal = openModal({
    title: 'Ajustes',
    body: el('div', { class: 'settings-grid' }, [connectionSection, opencodeSection, appearanceSection, soundSection, chatSection, dataSection, permissionsSection, subagentSection, demoSection, infoSection]),
    footer: el('button', { class: 'btn-primary', type: 'button', text: 'Cerrar', onClick: () => modal.close() }),
    width: 'min(720px, 100%)',
    onClose: () => clearInterval(timer),
  });

  refreshStatus();
  refreshOpenCodeConfig();
  timer = setInterval(refreshStatus, 2500);

  return modal;
}
