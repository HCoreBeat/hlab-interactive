# HLab Interactive

HLab Interactive es una interfaz de escritorio para [OpenCode](https://opencode.ai): una **oficina pixel-art vista
desde arriba** con cinco salas donde cada sesión es un personaje que camina, trabaja y espera
permisos, más un chat con streaming y paneles de actividad, archivos, terminal, contexto y
MCP.

Electron + HTML/CSS/JS sin bundler, sin frameworks y sin dependencias de red. La única
dependencia npm es `electron` (devDependency).

---

## Requisitos

- Windows 10/11 (probado), Node.js 20+.
- `opencode` **v2** instalado y en `PATH`:

  ```bash
  npm i -g opencode-ai
  opencode --version    # v2.1.1 o superior
  ```

> La app usa la API v2 (`/api/...`, eventos delta). Con la v1 no funciona: la sección 0 de
> `docs/api-notes.md` explica las diferencias y por qué se implementó contra la especificación
> real (`GET /openapi.json`).

## Instalación y arranque

```bash
npm install
npm start            # abre la app y lanza `opencode serve` por su cuenta
npm run start:demo   # modo demo: sin servidor ni modelo, con datos simulados
```

En el primer arranque la app muestra una pantalla de bienvenida: elige una carpeta de
proyecto y crea una sesión.

## Desarrollo y publicación (GitHub)

```bash
npm install          # instala dependencias (package-lock.json incluido)
npm start            # regenera bundles y abre la app
npm run start:demo   # demo sin servidor
npm run smoke        # comprobación de arranque
npm run dist         # genera instalador y portable en dist/
```

Antes de subir cambios, comprueba que `.gitignore` excluye `node_modules/`, `dist/`, logs,
`*.pfx`/certificados y los bundles generados (`src/js/i18n/catalogs.js` y
`src/js/util/highlight-engine.bundle.js`).

- **Estructura**: `main.js` / `preload.js` / `electron/` (proceso principal, IPC y backend),
  `src/js/` (UI y estado), `src/css/` (temas, paneles y oficina), `src/i18n/` (JSON de
  traducción), `scripts/` (generadores y smoke) y `docs/` (notas técnicas y decisiones).
- **Idiomas**: edita `src/i18n/en.json` (la clave es el texto en español) y ejecuta
  `npm run build:i18n`. El selector está en Ajustes → Idioma.
- **Seguridad**: el renderer corre con `contextIsolation`, `sandbox` y sin `nodeIntegration`;
  todo IPC valida tipos y rutas, los comandos del terminal tienen lista blanca, la
  configuración se confina al proyecto activo y la contraseña del servidor se redacta de los
  logs. No subas certificados ni secretos.
- **Licencia**: `LICENSE.txt`.

## Qué hace

- **Oficina pixel-art**: planta fija de cinco salas (Oficina, Servidores, Zona MCP, Archivo y
  Reuniones) dibujada en canvas **con luz**: focos de techo que derraman luz sobre el suelo,
  haces de luz solar por las ventanas del muro, sombras bajo el mobiliario y una paleta
  distinta para el tema claro. Cada sesión es un personaje que **camina** a la sala donde le
  toca trabajar y vuelve a su escritorio cuando termina:

  | Estado del agente | Sala |
  |---|---|
  | pensando / editando / esperando permiso | su escritorio en la Oficina |
  | ejecutando un comando (shell) | Sala de Servidores |
  | leyendo o buscando archivos | Archivo |
  | usando una herramienta de un servidor MCP | Zona MCP |
  | acaba de terminar el turno | Sala de Reuniones |

  Se hace clic en un personaje para abrir su sesión; el tablero lateral resume la sesión
  activa (acciones, archivos, tiempo trabajando, MCP y carpetas de contexto).
  **Zona MCP**: un terminal por servidor MCP configurado, con su nombre y un piloto que se
  activa cuando el servidor está conectado. El panel **MCP** muestra el estado real
  (`conectado`, `iniciando`, `desactivado`, `error`, `necesita autenticación`), el comando de
  arranque y permite **conectar y desconectar** cada servidor.
- **Oficina en primera persona**: el botón **Entrar**, la tecla `F` o la paleta abren una vista
  interior pixel-art sobre la misma planta (Oficina, Servidores, Zona MCP, Archivo, Reuniones y
  Patio). Se camina con `WASD`/flechas y `Shift`, se mira con el ratón, `E` abre la **ficha del
  agente** al que apuntas (con su estado, sala, rol y botón **Abrir sesión**), `F` le da un
  **latigazo** (chasquido, marcas rojas y `¡AY!`), `M` muestra el minimapa y `H` la ayuda.
  `Esc` cierra la ficha y, si no hay ficha, sale al plano cenital sin tocar la vista superior: la
  simulación y las animaciones de los agentes siguen y al salir el canvas 2D queda exactamente
  como estaba. El patio tiene el techo abierto: cielo con degradado, Luna, estrellas, Vía Láctea
  y nubes que derivan, más colinas en el horizonte.
- **Paneles escalables**: los bordes de la barra lateral, de la oficina, del tablero lateral y
  del panel inferior se **arrastran** para cambiar su tamaño; el tamaño se guarda y se
  recupera al reiniciar. Doble clic en un borde lo restaura. Cada borde se arrastra hacia
  el lado que agranda su panel.
- **Agentes y modelo siempre visibles**: en la barra superior están el agente y el modelo
  activos, en cada mensaje del chat se indica quién lo escribió, en el panel de agentes cada
  fila muestra su agente y su modelo, y al pasar el ratón por un personaje de la oficina se
  ve su nombre, su estado, su herramienta y su modelo. El selector de la barra superior
  usa un **desplegable propio** (no el `<select>` del SO): muestra el agente activo,
  agrupa **Principales** y **Subagentes** (estos deshabilitados), tiene **búsqueda** y
  aplica el cambio al hacer clic. El panel de agentes agrupa cada principal con sus
  subagentes.
- **Contexto multi-carpeta**: cada sesión puede llevar la carpeta del proyecto **más las
  carpetas extra que quieras**. Las extra se registran como ubicaciones del servidor (se
  pueden explorar y leer archivos desde el panel) y se anuncian al agente en cada mensaje.
- **Archivos de proyecto `.hl`**: desde la paleta se crea `<nombre>.hl` en la carpeta abierta
  y se registra su asociación en Windows (solo HKCU). Al hacer doble clic, la app abre
  directamente **la carpeta del proyecto** (o la que indique el JSON del `.hl`), aunque
  hubiera otro proyecto recordado. Si la app ya está abierta, cambia al workspace del `.hl`
  sin detener los turnos en curso.
- **Chat**: streaming token a token, razonamiento plegable, tarjetas de herramientas con
  entrada/salida, Markdown seguro y bloques de código con botón de copiar. Las tarjetas de
  herramienta son **explícitas**: se ve el **diff** de lo que se edita, el **comando** que se
  ejecuta **con su salida completa**, el **contenido** que se escribe y el archivo que se lee
  (con un botón para abrirlo). Cada mensaje indica el **agente y el modelo** que lo han
  generado. Si un turno falla (por ejemplo, **límite de uso del modelo**: «Rate limit
  exceeded»), el chat lo dice con un aviso y un botón **Reintentar**, y el agente aparece en
  rojo en la oficina. El **último mensaje del usuario queda anclado arriba** del chat, así
  siempre se ve lo que pediste sin tener que subir por el historial.
- **Panel de agentes**: un «panel del jefe» con una fila por sesión: estado, **agente**,
  **modelo**, herramienta en curso, número de acciones, archivos tocados y el error si lo
  hubo. Al hacer clic se abre esa sesión.
- **Panel de sesiones**: tarjetas con el título en su propia línea, pill `AGENTE`, nombre
  del agente y estado (`trabajando · herramienta`, permisos, finalizado). Los subagentes no
  son tarjetas aparte: son **filas compactas dentro de la tarjeta del padre**, con el título
  a ancho completo y una segunda línea con agente y estado. El tirador `▾ N` los pliega; el
  riel de la tarjeta se pone ámbar si trabaja cualquiera de ellos. El riel y el punto pulsan
  suavemente solo mientras hay trabajo; se respeta «reducir movimiento».
- **Trabajo en varios proyectos a la vez**: cambiar de carpeta **no detiene** los turnos en
  curso. La app recuerda las sesiones de cada proyecto y muestra un **marcador ámbar** en el
  chip del proyecto, en el menú de proyectos recientes, en el botón **Sesiones** de la barra
  de actividad y en los accesos rápidos del panel. Al volver a esa carpeta, sus sesiones
  siguen donde estaban.
- **Paneles tipo VS Code**: el panel inferior admite **varias columnas** con sus propias
  pestañas. Las pestañas se **arrastran** para reordenarlas o llevarlas a otra columna, el
  separador entre columnas se arrastra para repartirlas y todo el arrangement (columnas,
  pestañas y anchos) **se guarda**. El botón **＋** abre un panel nuevo o añade una columna
  al lado.
- **Actividad**: línea de tiempo de herramientas con duración, estado y salida.
- **Archivos**: árbol perezoso del proyecto, búsqueda, vista previa y diffs de lo que tocó la
  sesión. La vista previa tiene un botón **⛶** para ver el archivo a **pantalla completa**
  (las imágenes usan el visor con zoom; el texto/código se abre en un modal amplio con `Esc`
  para cerrar).
- **Terminal**: consola directa de **PowerShell en la raíz del proyecto** (sin pasar por la
  sesión del agente). La caja de comandos es grande y acepta varias líneas (`Enter` ejecuta,
  `Mayús+Enter` añade línea); muestra la carpeta actual, salida en vivo, código de salida,
  duración y botones **Detener** y **Copiar**. El historial va de **más nuevo a más viejo**
  e incluye también los comandos `!comando` de las sesiones. Encima de la caja aparecen
  botones **▶ nombre** con cada script del `package.json` del proyecto (por ejemplo
  `▶ dist` ejecuta `npm run dist`). También hay botones **▲ patch / minor / major** que
  ejecutan `npm version <tipo> --no-git-tag-version` (sin crear commits ni tags).
- **Inspector**: los últimos 500 eventos SSE en crudo, con filtro, pausa y copia. Es la
  herramienta para detectar cambios de API.
- **Permisos**: tarjetas flotantes para aprobar/denegar ediciones y comandos (una vez,
  siempre o rechazar), con el diff del archivo.
- **Paleta de comandos** (`Ctrl+K` o `/`): todos los comandos de la app **más** los comandos
  slash del servidor (`/init`, `/review`, …), los agentes disponibles, las sesiones y los
  servidores MCP.
- **Sesiones**: crear, cambiar, borrar y seguir varias a la vez (la oficina muestra todas).
- **Ajustes**: conexión (lanzar o conectar a un servidor existente), ruta de opencode, tema
  claro/oscuro, **idioma** (Español / English), animaciones, tamaño de fuente, permisos por
  defecto y modo demo. El idioma se aplica a toda la interfaz al instante; las traducciones
  viven en `src/i18n/*.json` y se generan con `npm run build:i18n`. El tema claro usa capas
  y bordes con contraste real (texto oscuro sobre papel), incluida la oficina y la vista en
  primera persona.
- **Deshacer**: `revert/stage` + `revert/commit` sobre el último turno. La API v2 no tiene
  «rehacer»; se documenta como limitación (ver `docs/decisiones.md`).

## Atajos

| Atajo | Acción |
|---|---|
| `Enter` / `Shift+Enter` | Enviar / salto de línea |
| `Esc` | Detener la respuesta en curso |
| `Ctrl+O` | Abrir proyecto |
| `Ctrl+N` | Nueva sesión |
| `Ctrl+,` | Ajustes |
| `Ctrl+K` | Paleta de comandos (app + opencode) |
| `Ctrl+B` | Mostrar/ocultar el tablero de la oficina |
| `F` | Entrar/salir de la oficina en primera persona (fuera); latigazo al agente apuntado (dentro) |
| `WASD` / flechas | Caminar en primera persona |
| `Shift` | Correr en primera persona |
| Ratón (o arrastre) | Mirar en primera persona |
| `E` / clic | Ficha del agente apuntado; desde la ficha, **Abrir sesión** |
| `F` (en primera persona) | Latigazo al agente apuntado (con sonido y marcas) |
| `M` / `H` | Minimapa / ayuda en primera persona |
| `Esc` (en primera persona) | Cierra la ficha; si no hay ficha, vuelve al plano cenital sin abortar el turno |
| `Ctrl+L` | Ir al cuadro de mensaje |
| `Ctrl+J` | Contraer/expandir el panel inferior |
| `Ctrl+1…7` | Agentes · Actividad · Archivos · Terminal · Inspector · Contexto · MCP |
| `/` | Autocompletar comandos (`/nueva`, `/abortar`, `/deshacer`, `/limpiar-vista` y los del servidor) |
| `!` | Ejecutar un comando de shell en la sesión |

## Cómo funciona

```
┌─────────────── main (Node) ───────────────┐        ┌───────── opencode serve ─────────┐
│ ServerManager ── lanza/protege el proceso │        │  API v2 en 127.0.0.1:<puerto>    │
│ ApiClient ────── HTTP + Basic auth ───────┼───────▶│  /api/session, /api/fs, …        │
│ SseClient ────── GET /api/event ──────────┼───────▶│  eventos delta en vivo           │
│ Backend ──────── demo o servidor real     │        └──────────────────────────────────┘
└───────────────┬───────────────────────────┘
                │ IPC validado (preload + contextBridge)
┌───────────────▼────────── renderer ───────┐
│ store + event-router + módulos de UI      │
└───────────────────────────────────────────┘
```

- **Un solo servidor para todos los proyectos.** Cada petición lleva
  `location[directory]=<proyecto>`; abrir un proyecto registra la location con
  `GET /api/session?directory=…`. No se reinicia el servidor al cambiar de carpeta.
- **Autenticación**: la app genera una contraseña, la inyecta como
  `OPENCODE_SERVER_PASSWORD` en el proceso hijo y la usa en todas las peticiones (Basic auth,
  usuario `opencode`). En modo «conectar» se usa la que indique el usuario.
- **Streaming**: los eventos v2 son deltas (`session.text.delta`, `session.reasoning.delta`,
  `session.tool.*`). El renderer los traduce a mensajes con bloques y la UI se repinta por
  fotograma.
- **Seguridad**: `contextIsolation`, `sandbox`, sin `nodeIntegration`, CSP estricta, sin
  navegación ni ventanas nuevas, y todo el HTML generado se escapa antes de tocar el DOM.

## Estructura

```
main.js                  ventana, menú, ciclo de vida
preload.js               contrato window.oc (IPC)
electron/
  backend.js             servidor real o demo, eventos
  server-manager.js      arranque/parada de `opencode serve`
  api-client.js          HTTP + auth + query deepObject
  sse-client.js          SSE con reconexión y deduplicación
  settings-store.js      settings.json en userData
  demo-source.js         backend simulado (modo demo)
  ipc.js                 canales IPC y validación
src/
  index.html             esqueleto de la interfaz + CSP
  css/                   base, layout, chat, paneles, temas, pixel-art
  js/
    app.js               orquestación
    session-controller.js  acciones sobre la sesión (borrar, deshacer, permisos…)
    store.js             estado + pub/sub
    event-router.js      eventos v2 → estado
    api.js               wrapper con location (y carga de MCP)
    markdown.js          Markdown seguro
    ui/
      questions.js       tarjeta de preguntas del agente (herramienta `question`)
      office-pixelart.js la oficina (canvas + capa de etiquetas)
      office/            planta, sprites, iluminación, reglas de agente, tablero y
                         primera persona (fp-scene, fp-player, fp-sprites, fp-ui)
      panel-workspace.js panel inferior multi-columna (tipo VS Code)
      agents-panel.js    panel de agentes (qué hace cada uno)
      tool-card.js       tarjetas de herramienta con diff, comando y salida
      dialogs.js         selectores (sesión, modelo, agente) y logs
      panel-tabs.js      enrutado de los paneles inferiores
      splitters.js       tiradores para redimensionar paneles
      sidebar.js, topbar.js, chat.js, folder-manager.js, mcp-panel.js…
electron/
  diagnose.js            sonda interactiva de la interfaz (--diagnose)
docs/
  api-notes.md           API v2 verificada en vivo (fuente de verdad)
  decisiones.md          decisiones + checklist de aceptación
  openapi.json           especificación descargada del servidor instalado
scripts/smoke.js         prueba de humo contra un servidor real
```

## Prueba de humo

Arranca un servidor real en un puerto libre, crea una sesión en una carpeta temporal, envía
«Responde solo OK» y espera `session.execution.succeeded` (90 s de límite):

```bash
npm run smoke
npm run smoke -- "C:\ruta\a\un\proyecto"
```

## Sonda de interfaz

Para comprobar que nada tapa la interfaz y que los paneles responden:

```bash
npx electron . --diagnose          # con el servidor real
npx electron . --demo --diagnose   # sin servidor
```

Informa de qué elemento está en primer plano en varios puntos, si el compositor acepta
texto, si cada tab del panel monta, si los tiradores cambian el tamaño y si el botón de
proyecto abre el selector de carpetas.

También hay una verificación guiada con capturas:

```bash
npx electron . --demo --ui-check
```

Recorre la oficina (incluida la primera persona: entrar, caminar, el cielo del patio, la ficha
con `E`, el latigazo con `F` y la salida), el chat, el permiso, los paneles, la paleta, el error
simulado, el selector de modelos y la tarjeta de pregunta. Deja las capturas en
`%TEMP%\oc-ui-check` y un informe JSON en la consola; al terminar cierra la app.

## Limitaciones conocidas

- API v2 únicamente (no hay compatibilidad con la v1).
- No existe «rehacer»: solo «deshacer» y «descartar preparado».
- Una sesión de opencode tiene **una sola** ubicación (`location.directory`). Las carpetas
  extra del panel «Contexto» se guardan en la app: se registran como ubicaciones del
  servidor (para poder explorarlas) y se anuncian al agente en el preámbulo del mensaje,
  pero el agente sigue trabajando dentro de la carpeta del proyecto.
- El modo demo no ejecuta modelos ni toca archivos: simula eventos con la misma forma.
- El árbol de archivos lista lo que expone `/api/fs/list`; los binarios no se previsualizan.
- La oficina dibuja como mucho 10 agentes a la vez (el resto espera fuera de la planta).
- La primera persona es un raycaster 2.5D: no hay alturas ni plantas; la mirada vertical solo
  desplaza el horizonte. El agua del Patio es un patrón por casillas, no un reflejo.
- El modo primera persona usa un búfer interno de 220-460 px escalado con píxeles nítidos; en
  pantallas muy grandes el pixelado es intencionado.
