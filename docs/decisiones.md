# Decisiones

Registro de decisiones técnicas y de alcance. Una línea por decisión, con fecha de fase.

## Reconocimiento (Fase 0)

- **La API instalada es opencode v2.1.1, no la v1 de `PROMPT.md`.** La especificación real está
  en `GET /openapi.json` (guardada en `docs/openapi.json`), las rutas bajo `/api/...` y los
  eventos son de tipo delta. Se implementa contra `docs/api-notes.md`, como exige la Fase 0.
- **Autenticación obligatoria** en la v2: Basic auth con usuario literal `opencode` y password de
  `OPENCODE_SERVER_PASSWORD`. La app genera su propio password y lo inyecta en el entorno del
  proceso hijo (con parseo de stdout como respaldo).
- **Un solo servidor para todos los proyectos**, usando `location[directory]` en cada petición.
  Abrir un proyecto = `GET /api/session?directory=<dir>` para registrar la location. Se descarta
  reiniciar el servidor al cambiar de proyecto (mucho más lento y frágil).
- **Permisos por defecto `ask` para `edit` y `bash`** al crear sesiones, para que el flujo de
  aprobación sea real y verificable. Configurable en Ajustes.
- **"Rehacer" no existe en v2**: se implementa "Deshacer último cambio" (`revert/stage` +
  `revert/commit`) y "Descartar cambio preparado" (`DELETE /revert`).
- **Diffs**: el visor se alimenta de los `patch` de `permission.asked`, de las partes `tool` de
  edición y de `/api/vcs/diff`; `/api/session/:id/diff` queda como complemento (puede venir vacío).
- Proyecto construido **en la raíz del workspace** `C:\_WORK\OpenCode Visual` (decisión del usuario).
- Única dependencia: `electron` (devDependency). Sin bundler, sin frameworks, sin CDN.

## Rediseño: oficina pixel-art (Fase 10)

- **La vista principal es una planta pixel-art vista desde arriba**, no una rejilla de
  escritorios. Un único canvas (1360×360 lógicos, tiles de 40 px) dibuja cinco salas en fila:
  Oficina (8 escritorios), Servidores (bancos de racks), Zona MCP (terminales), Archivo
  (estanterías) y Reuniones (mesa). Puertas en los muros compartidos (columnas 11, 17, 24 y
  28) para que los personajes circulen entre salas.
- **Cada sesión es un personaje** con paleta propia, sombra, glow de presencia y animación de
  marcha. Se dibuja con `fillRect` sobre el canvas: sin sprites ni ficheros de imagen, todo
  generado por código y sin dependencias externas.
- **La estación de un agente depende del runtime**: shell -> Servidores, lectura/búsqueda ->
  Archivo, herramienta de un servidor MCP -> Zona MCP, fin de turno (<7 s) -> Reuniones, resto ->
  su escritorio. Los nombres de las herramientas MCP se comparan con frontera estricta
  (`servidor` o `servidor_...`) para no confundir, por ejemplo, `read` con el servidor `rea`.
- **Movimiento con BFS** sobre una rejilla global de walkability (suelo, puertas y sillas),
  a 92 px lógicos por segundo; se recalcula la ruta solo cuando cambia el destino.
- **Los textos van en una capa HTML superpuesta**, no en el canvas: el canvas se escala
  (0,6-0,7 según el ancho), así que el texto dibujado dentro quedaría ilegible. Las capas se
  posicionan en píxeles de pantalla con `transform`, actualizadas por fotograma.
- **`ResizeObserver`** calcula la escala del escenario y el tamaño del canvas (con
  `devicePixelRatio`); el plan completo siempre cabe en pantalla, sin scroll.
- **MCP visible de verdad**: la lista de servidores sale de `GET /api/config`
  (`info.mcp.servers`) fusionada con el estado vivo de `GET /api/mcp`.
- **Contexto multi-carpeta**: una sesión de opencode tiene una sola `location.directory`, así
  que las carpetas extra se guardan en la app (`settings.sessionFolders[sessionID]`), se
  registran como ubicaciones (`GET /api/session?directory=...`) para poder explorarlas con
  `/api/fs/list?location[directory]=...` y se anuncian al agente en el preámbulo del mensaje.
  Limitación documentada: el agente sigue trabajando en la carpeta del proyecto.
- **Paleta de comandos dinámica**: además de los comandos de la app, se listan en vivo los
  comandos slash del servidor (`GET /api/command`), los agentes (`GET /api/agent`), las
  sesiones y los servidores MCP.
- Se eliminaron la oficina de escritorios (`ui/office.js`), su CSS (`css/office.css`) y el
  panel MCP duplicado dentro del gestor de carpetas.
- **Módulos divididos para mantener los ficheros por debajo de ~400 líneas**: `ui/office/`
  (planta, sprites, iluminación, reglas de agente y tablero), `ui/dialogs.js` (selectores y
  logs), `ui/panel-tabs.js` (enrutado de paneles) y `session-controller.js` (acciones de
  sesión). `app.js` queda como mero orquestador.

## Correcciones y mejoras (Fase 11)

Diagnóstico con `electron/diagnose.js` (`npx electron . --diagnose`): comprueba qué elemento
está encima del ratón en varios puntos, si el compositor acepta texto, si todos los tabs del
panel montan y si los tiradores redimensionan. Salió de ahí esta tanda de arreglos:

- **No se podía abrir ningún proyecto** (el síntoma «no me deja hacer nada»):
  `openProject()` sin argumento llamaba a la API con `undefined` y el IPC respondía «Carpeta no
  válida». Ahora, sin carpeta, se abre primero el selector nativo (`window.oc.project.pick`),
  y `Ctrl+O`, el botón de proyecto y el menú «Abrir proyecto...» funcionan.
- **Proyecto borrado**: el proceso main comprueba que la carpeta exista antes de registrarla y,
  si no existe, la borra de los ajustes y lo explica en vez de dejar la app rota.
- **Estado MCP**: `GET /api/mcp` devuelve `status` como **objeto**
  (`{status: 'connected'|'pending'|'disabled'|'failed'|'needs_auth', error?}`), no como
  cadena; la app pintaba `[OBJECT OBJECT]`. Ahora se normaliza y se usan los endpoints
  experimentales `POST /api/experimental/mcp/{servidor}/connect|disconnect` para conectar y
  desconectar servidores de verdad.
- **Tablero cortado**: el redibujado del tablero borraba su propio contenido; ahora usa un
  contenedor `.board-body` y el tablero no se recorta (el chip de estado se veía cortado).
- **Oficina oscura**: nueva paleta con **iluminación** (focos de techo con halo cálido, haces
  de luz por las ventanas, sombras proyectadas por el mobiliario, luz de ambiente) y una
  paleta propia para el tema claro. Los sprites también se aclararon.
- **Paneles escalables**: `ui/splitters.js` añade tiradores arrastrables para la barra
  lateral, la altura de la oficina, el ancho del tablero y la altura del panel inferior. Los
  tamaños se guardan en `settings.layout` (en píxeles) y se ajustan a la ventana al arrancar.
- **Chat sin sesión**: el estado vacío ofrece «Abrir proyecto» y «Nueva sesión» en lugar de
  una frase sin acción.
- **Los fallos del proveedor ya no son silenciosos**: el turno puede fallar por cuota del
  modelo (`provider.quota`, HTTP 429) o por un error del proveedor. Antes la app sólo
  marcaba la sesión como fallida y no decía por qué, lo que parece «la app no funciona».
  Ahora el evento guarda el mensaje, el chat muestra un aviso con **Reintentar**, salta un
  toast y el agente se dibuja en rojo en la oficina.
- Se limpió el estado que dejaban las pruebas en `settings.json` (proyectos de prueba y
  tamaños de panel).
- **Dirección del arrastre corregida**: los tiradores de la barra lateral y de la oficina
  tenían el signo invertido (arrastrar a la derecha encogía la barra lateral). Ahora cada
  tirador tiene su signo explícito y el diagnóstico comprueba las dos direcciones (crecer y
  encoger) de los cuatro, de modo que una inversión futura falla la prueba.
- **El instalador despliega ya el binario firmado**: la firma automática de electron-builder
  falla en esta máquina, así que se firma a mano. Firmar sólo el `.exe` del instalador no
  bastaba, porque el instalador copiaba dentro un binario sin firmar. El flujo correcto es
  `electron-builder --dir` -> firmar `dist/win-unpacked/Oficina opencode.exe` ->
  `electron-builder --win --x64 --prepackaged dist/win-unpacked` -> firmar el instalador y
  el portable. Así lo instalado sale con la firma de `hlabinteractive` y su sello de tiempo.

## Verlo todo explícito y paneles reorganizables (Fase 12)

- **Tarjetas de herramienta explícitas** (`ui/tool-card.js`): antes las herramientas salían
  como una línea con el nombre y el resultado escondido tras un desplegable con el JSON en
  crudo. Ahora cada tarjeta enseña lo que está pasando de verdad: el **diff** de los archivos
  editados (con `+`/`−`), el **comando** ejecutado **y su salida completa**, el **contenido**
  escrito, el archivo leído (con botón para abrirlo) y los parámetros sueltos.
- **Agente y modelo explícitos**: cada mensaje del chat muestra `agente` y `modelo`; el
  tooltip de cada personaje de la oficina dice su sesión, su estado, su herramienta, su
  agente y su modelo; y el nuevo **panel de agentes** (`ui/agents-panel.js`) lista una fila
  por sesión con estado, agente, modelo, herramienta en curso, acciones, archivos tocados y
  el error si lo hubo.
- **Panel inferior tipo VS Code** (`ui/panel-workspace.js`): el área de paneles es un
  espacio de trabajo con **columnas**; cada columna tiene su propia tira de pestañas y su
  contenido. Las pestañas se **arrastran** para reordenarlas o llevarlas a otra columna, el
  separador entre columnas se arrastra para repartir el ancho y el botón **＋** añade un panel
  o **una columna al lado**. El arrangement se guarda en `settings.panelLayout`.
- Los paneles ya no se montan sobre `#panel-body` por identificador: reciben su contenedor,
  de modo que varias columnas pueden convivir.

## Rediseño chat-first: barra lateral + oficina plegable (Fase 13)

- **La barra lateral (activity bar) es la navegación principal**: una columna de botones
  (`ui/activity-bar.js`) abre cada vista del panel lateral (Sesiones, Agentes, Actividad,
  Archivos, Terminal, Contexto, MCP, Inspector) y la oficina (`🏢`, `Ctrl+Shift+O`).
- **El panel lateral es un workspace de columnas**: como VS Code, cada columna muestra una vista
  y se puede añadir más. El botón **＋** abre el menú para añadir vistas o una columna nueva;
  el separador entre columnas se arrastra. Se guarda en `settings.panelLayout`.
- **El chat es la protagonista**: header sticky con el estado vivo (agente, modelo, herramienta,
  tiempo), tarjetas de herramienta con salida completa y botón **Copiar**, diff con contexto,
  botón **💻 Terminal** del encabezado del chat que abre el panel lateral.
- **La oficina es un split plegable bajo el chat** con tirador y zoom con `Ctrl+wheel`, y la escena
  estática (suelo, muros, muebles, luz) se pinta una sola vez en un canvas offscreen.
- **Ajustes migrados**: la antigua estructura (sidebar fijo + tablero + panel inferior) se mapea a
  `--side-w` y `--office-h`.

## Ciclo de vida de los subagentes (2026-10)

La herramienta `task` de opencode crea sesiones hijas (`Session.Info.parentID`). Antes esta app
las trataba como sesiones más y se acumulaban en la lista y en la oficina. Ahora cada subagente
tiene un ciclo de vida propio:

- **Vivo**: está trabajando (`runtime.busy`), tiene permisos pendientes, es la sesión activa o
  acaba de terminar hace menos de `SUBAGENT_GRACE_MS` (12 s). Solo los vivos se dibujan en la
  oficina y en el panel de agentes.
- **Retirada**: al dejar de estar vivo sale de la lista principal y su avatar camina hasta
  Reuniones antes de desaparecer (~2,4 s).
- **Archivado**: 48 s después de la retirada (≈60 s desde que terminó) se archiva en el servidor
  con `PATCH /api/session/{id} { archived: true }`. **Nunca se borra automáticamente**: se puede
  recuperar desde opencode. El ajuste `archiveSubagents` (Ajustes → Subagentes) desactiva el
  archivado automático; en ese caso el subagente se oculta y se puede limpiar a mano.

Reglas de datos:

- `state.sessions` solo contiene sesiones raíz (`GET /api/session?parentID=null&archived=false`);
  `state.subagents` contiene las hijas conocidas. `sessionById()` busca en las dos listas.
- `session.updated` enruta cada sesión a su lista según su `parentID`; una sesión archivada se
  elimina del estado.
- Las hijas se descubren por evento (`session.tool.input.started` con herramientas `task`, `agent`,
  `subagent`, `dispatch` o `delegate`), al seleccionar su sesión padre y, como red de seguridad,
  cada 8 s mientras un padre delega. Los sondeos simultáneos por padre se comparten y fusionan para
  evitar filas duplicadas o perder actualizaciones.
- El barrido (`sweepSubagents`, cada 2 s) retira, archiva y poda las hijas de padres que ya no
  existen.

En la lista de sesiones las hijas cuelgan de su padre: un interruptor `▸ N` despliega el grupo,
las vivas se muestran siempre y las finalizadas quedan agrupadas con un botón
**Archivar N finalizado(s)** que confirma y archiva solo esas (nunca una sesión raíz, la activa,
una ocupada o una esperando permiso).
Las etiquetas de agente y subagente usan colores semánticos del tema para mantener contraste en
modo claro y oscuro.

Movimiento en la oficina:

- Cada agente tiene su propio escritorio (la reserva se hace en dos pasadas, así que nadie se
  queda sin sitio aunque camine).
- Sala por estado: servidor (comandos), archivo (lectura/búsqueda), zona MCP (herramientas MCP o
  servidores `pending`/`needs_auth` mientras se configuran) y reuniones (recién terminado, 20 s,
  o esperando a un subagente).
- Por rol: los agentes `explore` se quedan en el Archivo y los `plan` en Reuniones cuando no
  hacen nada.

## Oficina en primera persona (2026-11)

- **Se entra con el botón «Entrar», la tecla `F` o la paleta** («Entrar en la oficina (1ª
  persona)»); se sale con `Esc`, con «Salir» o cerrando la oficina. La vista superior no se
  toca: al salir, el mismo canvas y las mismas animaciones siguen donde estaban.
- **Renderizador propio, sin dependencias**: un *raycaster* de columnas (estilo Doom) dibuja la
  misma planta de 42×9 de `office/floor-plan.js` en un búfer interno de ~340 px que se escala
  con `image-rendering: pixelated`. Reutiliza paletas por sala, `LAMPS` para la luz, las
  texturas procedurales y los sprites de agentes (`drawAgent`/`drawAgentProps`), así que el
  aspecto y las animaciones son los de la oficina 2D.
- **Alcance**: las cinco salas (Oficina, Servidores, Zona MCP, Archivo y Reuniones) y el Patio,
  con cielo/agua y sin techo en el Patio. Todo lo que no es suelo, puerta, silla o banco
  bloquea (muros, racks, estanterías, árboles, escritorios, mesas, plantas…); el mobiliario bajo
  se dibuja como *billboard* con z-buffer.
- **La cámara vive en coordenadas de tile** (`fp-player.js`), con colisión de radio 0.27 y
  deslizamiento por ejes, paso/bob y sonido de pisadas. La pose se guarda en
  `localStorage['office.fp.pos']` y se reutiliza al volver a entrar.
- **Escala humana**: la cámara está a `EYE = 0.86` tiles y el techo a `CEIL = 1.62`, así que una
  puerta, un escritorio y una ventana quedan a la altura correcta y la sala no parece un tubo.
  Los billboards usan el mismo horizonte y z-buffer que las paredes.
- **El patio tiene cielo de verdad**: los píxeles del techo del Patio se dejan transparentes y,
  después de `putImageData`, se compone un cielo aparte con `globalCompositeOperation =
  'destination-over'` (degradado, Luna con halo, estrellas con destellos, Vía Láctea, nubes a la
  deriva, resplandor de horizonte y colinas). Los árboles se dibujan como columnas con silueta de
  copa redondeada, con el fondo opaco por debajo de la línea de ojos para no abrir huecos contra
  la pared del patio. Las ventanas solo existen en el muro norte y las paredes del borde toman la
  paleta de la sala que tienen detrás.
- **Ficha con `E`, latigazo con `F`**: `E` alterna una tarjeta con el agente apuntado (nombre,
  estado, sala, agente y botones **Abrir sesión** / **Latigazo** / **Volver**) sin salir del
  modo; mientras la tarjeta está abierta se suelta el *pointer lock* y se ignoran las teclas de
  movimiento. `F` dentro de la primera persona **nunca** cierra la vista: da un latigazo al
  agente apuntado (temblor, retroceso, marcas rojas, chispas, `¡AY!`, sacudida de cámara y los
  efectos `whip`/`whipHit`). `Esc` se captura en `window` en fase de captura con
  `stopPropagation`: primero cierra la tarjeta y solo después sale al plano cenital; **nunca**
  dispara el atajo global que aborta el turno.
- **La simulación no se para**: `office-pixelart.js` sigue ejecutando `tick(dt)` (agentes,
  puertas, sonido) y solo omite el pintado superior mientras el overlay está abierto. El overlay
  (`fp-ui.js`) se monta dentro de `#editor`, así que la barra superior y el raíl quedan visibles.
- **Archivos nuevos**: `src/js/ui/office/fp-scene.js` (raycaster, texturas, luz, billboards),
  `fp-player.js` (movimiento y puntería), `fp-sprites.js` (mobiliario) y `fp-ui.js` (overlay,
  entrada, HUD, minimapa, ayuda); `src/css/office-fp.css`.
- **Preguntas del agente**: la tarjeta `question` usa las rutas v2 verificadas en opencode 2.2.7
  (`GET /api/session/{sid}/question`, `POST .../reply {answers}`, `POST .../reject`), normaliza
  eventos con `data` o `properties` y, si el evento se pierde, sondea el servidor cada 1,5 s.
  Si una tarjeta sintética no tiene `requestID`, lo resuelve contra el servidor antes de enviar;
  nunca se queda bloqueada.

## Panel de sesiones y proyectos simultáneos (2026-11-20)

- **Tarjetas reescritas con namespace propio**: `sessions-panel.js` genera clases `sp-*` y
  `css/sessions-panel.css` se carga **después** de `design.css`. Así se evita la pelea entre
  `.session-item` de `layout.css`, `office-v2.css` y `design.css` (grid vs flex, bordes
  naranjas…). Título en su línea y meta (rol + agente + estado) en la segunda. Los subagentes
  **ya no son tarjetas aparte**: son filas de dos líneas dentro del grupo del padre
  (`li.sp-group > ul.sp-children`), con el título a ancho completo y agente/estado debajo y
  una sangría + separador que marcan la jerarquía. Se elimina el pill `SUBAGENTE`, el `de …`
  repetido y los conectores extra que duplicaban el riel. El grupo se pliega con `▾ N` y su
  riel se pone ámbar si trabaja cualquier hijo.
- **Animaciones discretas**: solo el punto de estado y los marcadores de trabajo pulsan
  (`sp-pulse`), sin cambios de layout ni bordes gruesos; `@media (prefers-reduced-motion)`
  las desactiva. El riel izquierdo es el que indica el estado de la sesión.
- **Cambiar de proyecto NO aborta nada**: `openProject()` sigue sin llamar a `interrupt` ni
  a `sse.stop()`. Antes de cambiar se guarda el inventario saliente en `state.projects[dir]`
  y se asocia `sessionID -> directorio`. El stream SSE es global y sigue entregando eventos
  de todos los proyectos.
- **Registro por directorio** (`store.js`): `rememberProject`, `mapSessionDirectory`,
  `rememberForeignSession`, `isSessionWorking`, `workingProjects` y `otherProjectWork`.
  Los eventos con `location.directory` se enrutan a su proyecto; una sesión ajena **ya no se
  resucita** en la lista actual (`upsertSession` y el `default` de `event-router.js`).
- **Marcadores**: chip superior con contador ámbar, badges en el menú de proyectos, punto en
  el botón **Sesiones** de la barra de actividad y pill en los accesos rápidos del panel.
  Todos derivan de `workingProjects()`, así que desaparecen en cuanto el turno termina.
- **Evidencia**: `--demo --ui-check` (2026-11-20), capturas `09-sesiones.png`,
  `09b-subagentes.png` y `16-proyectos-en-paralelo.png`. El árbol de subagentes pasa
  `subagentLayoutOk: true` con `nestedChildren: 4`, `siblingLeaks: 0`, `parentLines: 0`,
  `overflowX: 0`, `busyChildren: 1` y el plegado `4 → 0 → 4`. El trabajo entre proyectos
  pasa `foreignWorkOk: true` con
  `{ busy, inCurrentList: false, inRegistry: true, topbar, chipWork, activity, sidebar,
  leakedInList: false }`. Ida y vuelta a otra carpeta (`foreignSwitch`) mantiene
  `busy: true` y `outcome: null` antes, durante y después: **ningún turno se detiene**.

## Apertura de archivos `.hl` (2026-11-21)

- `electron/workspace-file.js` resuelve el workspace: un `.hl` vacío abre **la carpeta donde
  vive el archivo**; si contiene JSON, respeta `folder` / `path` / `dir` (relativo a esa
  carpeta) y, si la ruta no existe, cae a la carpeta del archivo.
- **La petición del `.hl` manda**: antes se recogía con un `setTimeout(600)` desde el
  renderer, que podía dispararse antes de que el servidor estuviera listo (y entonces
  `openProject` descartaba la petición) o después de que `onServerReady` hubiera abierto
  `lastProject`. Ahora `boot()` awaits `oc:workspace:pending()` **antes** de registrar
  `onState`, y `onServerReady()` reserva el primer hueco para `requestedWorkspace` antes
  que `state.project.dir` y `settings.lastProject`. Se consume una sola vez.
- Segundo doble clic con la app abierta: `second-instance` envía `oc:menu workspace:<dir>`;
  si el servidor aún no está listo se encola en `requestedWorkspace` en lugar de perderlo.
- **Evidencia**: `--demo --ui-check <archivo.hl>` con `lastProject` apuntando a otra carpeta
  da `workspaceArg.dir = <carpeta del .hl>`, `startupProject = <esa misma carpeta>` y
  `workspaceOpened: true`. Sin `.hl`, se sigue abriendo `lastProject`
  (`startupProject = <otra carpeta>`). El resto de comprobaciones (`fp*`,
  `subagentLayoutOk`, `foreignWorkOk`) siguen en `true`.

## Terminal directo (2026-11-21)

- El panel **Terminal** ya no depende de una sesión activa: `electron/terminal.js` lanza
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass` con `cwd` en la
  carpeta del proyecto (`state.project.dir`) y transmite `stdout`/`stderr` en vivo mediante
  `oc:terminal:event`. Se valida la carpeta en el proceso principal antes de `spawn`.
- `preload.js` expone `terminal.run/stop/onEvent`; la UI usa un `textarea` amplio
  (monoespacio, redimensionable) y el historial vive en `state.terminal`, así sobrevive a
  cambios de columnas/pestañas del panel.
- El historial se ordena por `startedAt` descendente (**más nuevo primero**) y fusiona los
  comandos directos con los `shell` de las sesiones. La cabecera de cada tarjeta se reparte
  en dos líneas para que el comando se lea en paneles estrechos (antes se quedaba en 1 px).
- **Evidencia**: `--demo --ui-check` da `terminalOk: true`: caja `TEXTAREA` de 64 px de alto,
  dos comandos reales ejecutados (`Write-Output 'primera'` / `'segunda'`), salida correcta,
  `exit 0`, orden `segunda → primera`, `kind: terminal` y ancho del comando 283 px.
  Captura `17-terminal.png`. El resto de comprobaciones siguen en `true`.

## Notas pendientes de prioridad alta (2026-11-21)

- **Scripts de `package.json` en la UI**: `electron/terminal.js` lee los `scripts` del
  `package.json` del proyecto y expone `oc:terminal:scripts` / `oc:terminal:script`. Solo se
  permiten nombres existentes y `spawn('npm', ['run', name])` (sin shell interpolado), con
  la misma salida en vivo que el terminal directo. El panel dibuja un botón `▶ nombre` por
  script (`▶ dist` → `npm run dist`); la ejecución se registra en `state.terminal` con
  `kind: 'script'`.
- **Preview a pantalla completa**: `files.js` importa por fin `openLightbox` (antes el clic
  en la imagen del preview daba `ReferenceError`) y añade un botón **⛶**: imágenes →
  lightbox con zoom; texto/código/diff → `openModal` con `.preview-fullscreen`, 100vw/100vh
  y `Esc` para cerrar. El modal lleva `.modal-backdrop`, así que no choca con los atajos
  globales.
- **Selección de agente**: `app.js` enruta `onSelectAgent`/`onAgentSelect` a `applyAgent`,
  que además del POST hace `patchSession` y actualiza `selection`; `selectAgent(id)` ya
  aplica el id y solo abre el picker sin argumentos. `dialogs.js` filtra agentes principales,
  marca los subagentes como deshabilitados y sincroniza el estado. `command-palette.js`
  separa la categoría `Subagentes`. `topbar.js` agrupa el `<select>` en `Principales` /
  `Subagentes`, usa `primaryAgents()` y solo reconstruye las opciones cuando cambia el
  catálogo (antes lo hacía en cada token). `store.js` aporta los selectores comunes.
- **Último mensaje anclado**: `chat.js` crea `.chat-anchor` como hijo de `#chat` (fuera de
  `#chat-scroll`, que se limpia en cada render) y lo actualiza desde el último mensaje
  `type === 'user'` visible. No altera `scrollHeight`, así que `pinBottom` sigue intacto;
  `chat.css` lo coloca debajo de `.chat-head` y deja hueco al primer mensaje.
- **Modo claro**: `light-fixes.css` se carga al final y ajusta la paleta (capas más
  separadas, bordes y texto oscuro), corrige el texto oscuro sobre las tarjetas oscuras de
  primera persona, las marcas `+/-` del diff, la cuota, los chips de código/razonamiento,
  los bordes azules del tema oscuro, la bombilla del avatar y las etiquetas de la oficina.
- **Evidencia**: `--demo --ui-check` da `lightTheme.ok: true` (lum texto 0,07 / fondo 0,92),
  `userAnchor.visible: true` con el texto del último prompt, `agentPick.ok: true`
  (`build → plan` aplicado y conservado, grupo `Principales`), `previewFullOk: true`
  (modal >90% de la ventana y cierra con `Esc`), `scriptsOk: true`
  (`npm run build:highlight`, `exit 0`) y `terminalOk: true`. Capturas `02a-oficina-clara.png`,
  `05-terminado.png`, `12-archivos.png` y `17-terminal.png`.

## Internacionalización (2026-11-21)

- Los textos fuente están en `src/i18n/es.json` y `src/i18n/en.json` (clave = frase en
  español, **747 entradas**). `scripts/build-i18n.js` genera `src/js/i18n/catalogs.js`,
  que es lo que importa
  el renderer (los `import` de JSON desde `file://` no son fiables en Electron). El script
  se encadena en `start`, `start:demo`, `build`, `dist` y `pack`.
- `src/js/i18n.js` expone `t`, `setLocale`, `applyDocument` y `startDomObserver`. `el()`
  traduce `text`, `title`, `placeholder`, `aria-label` y `alt` al crear nodos; un
  `MutationObserver` cubre los textos que se insertan por otras vías. Se guarda el valor
  original de cada nodo/atributo para poder volver al español sin perderlo.
- `t()` primero busca la frase exacta y, si no está, traduce los fragmentos conocidos
  dentro de textos compuestos (`Sesiones (Ctrl+1)`, `2 trabajando`, `agente build`), con
  caché por idioma. Se excluyen deliberadamente `pre/code`, campos de texto, salidas de
  herramientas y mensajes del chat (contenido del usuario/agente).
- Ajustes añade un selector **Idioma** que escribe `settings.locale` y llama a `setLocale`;
  `applyAppearance()` aplica el idioma guardado al arrancar.
- **Limitación deliberada**: no se traduce el contenido del chat (mensajes del usuario o
  del agente), ni código/salidas de herramientas, porque son datos, no interfaz. En modo
  demo el mensaje de bienvenida y el pie `agente build …` vienen del propio servidor demo,
  por eso siguen en español al cambiar de idioma.
- **Evidencia**: `--demo --ui-check` da `i18nOk: true`: `lang` pasa `es → en → es`,
  `Sesiones (Ctrl+1) → Sessions (Ctrl+1)`, `Enviar → Send`, el placeholder del composers
  pasa a `Type a message…`, los textos dinámicos (`Proyecto abierto: Demo` →
  `Project opened: Demo`) y los títulos vuelven al español al restaurar. Captura
  `02c-ingles.png`.

## Correcciones finales (2026-11-21)

- **Anclaje del usuario**: `chat.js` extrae `updateAnchor()` y se suscribe directamente a
  `messages`/`activeSessionId`/`ui`, sin pasar por el throttle ni por `requestAnimationFrame`.
  El nodo lleva `data-i18n-skip` y `no-emoji.js` lo excluye, para que el texto del usuario
  nunca sea reescrito por observadores. `store.js` y `chat.js` ejecutan el flush aunque la
  ventana esté oculta (rAF no dispara en segundo plano). La marca de `cleared` tolera 2 s de
  desfase de reloj. Evidencia: `anchorUpdate.ok: true` al enviar un mensaje nuevo.
- **Terminal que se quedaba en `running`**: los eventos `oc:terminal:event` ahora se
  procesan en `app.js` con `applyTerminalEvent()` (store global), no en el componente, que se
  desmonta al cambiar de pestaña. `beginTerminalRun()` no sobrescribe un `done` adelantado.
  `electron/terminal.js` escucha `exit` además de `close`, destruye los pipes, incluye la
  salida completa en `done`, y `stop()`/`killAll()` matan el árbol de procesos (`taskkill /T
  /F` en Windows). Evidencia: `terminalResilienceOk: true` (cambiar de pestaña a mitad de un
  comando y seguir hasta `exited`).
- **Botones de versión**: `oc:terminal:version` solo acepta `major|minor|patch` (lista
  blanca) y ejecuta `npm version <tipo> --no-git-tag-version`. Evidencia: `versionOk: true`.
- **Traducciones**: catálogo ampliado a **739 entradas**, incluyendo textos dinámicos con
  valores interpolados (`Proyecto abierto: X` → `Project opened: X`).
- **Preparación para GitHub**: `.gitignore` excluye `node_modules/`, `dist/`, logs,
  certificados (`*.pfx`, `build/cert.pfx`), secretos y los bundles generados; `README.md`
  incorpora sección de desarrollo/publicación, estructura, idiomas y seguridad.
- **Seguridad**: allowlist estricta en `oc:settings:set` (rechaza claves desconocidas,
  metacaracteres de shell en `opencodePath` y URLs con credenciales); `assertPath` exige
  `/api/` y rechaza `..`/`//`; `oc:open-external` valida `URL` y esquema http(s); la ruta de
  configuración la decide el proceso principal (project scope confinado a `lastProject`);
  la contraseña del servidor se redacta en `pushLog`; los `.hl` no pueden apuntar fuera de su
  carpeta; `before-quit` mata los procesos del terminal. Evidencia: `securityIpc.ok: true`.

## Barra de título y selector de agentes (2026-11-22)

- **Controles de ventana propios**: se quitó `titleBarOverlay` de `BrowserWindow` y ahora
  `main.js` expone `oc:window:minimize|toggle-maximize|close|is-maximized`; `index.html`
  dibuja los botones `− □ ×` dentro del flex del topbar y `titlebar.css` les da 46 px de
  ancho, con hover rojo en cerrar y soporte de `Esc`/doble clic. El viejo
  `padding-right: 150px` desaparece, así los botones de la app ya no quedan tapados.
  Evidencia: `windowControls.ok: true` (separación de 10 px, dentro de la ventana,
  maximizar/restaurar funciona).
- **Selector de agente propio**: se sustituyó el `<select>` nativo por `.agent-picker` con
  botón, menú `role=listbox`, campo de búsqueda y secciones **Principales** /
  **Subagentes** (estos deshabilitados). `topbar.js` mantiene el signature guard para no
  reconstruirlo en cada token y sincroniza el estado al elegir. `agent-picker.css` fija
  ancho, `z-index` y breakpoints para que el nombre del agente no se corte a 1400 px.
  Evidencia: `agentPick.ok: true` (`build → plan` aplicado, menú cerrado, grupo
  `Principales`, búsqueda presente) y captura `08b-selector-agente.png`.

## Checklist de aceptación (Sección 8 de PROMPT.md)

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | `npm install && npm start` abre la app sin errores en consola | OK | `node --check` pasa en todos los módulos; arranque verificado con `--verbose` y con `--diagnose` |
| 2 | `npm run start:demo` muestra oficina animada, chat streaming, actividad, permiso aprobable, error simulado | OK | Capturas 01-15 en `C:\Users\alede\AppData\Local\Temp\oc-ui-check\`; informe: `selectedDesk: true`, `permissionCards: 1`, `approved: true`, `subagentRows: 1` (árbol de subagentes), `errorBanner: "Rate limit exceeded. Please try again later."` |
| 3 | Con opencode real: elegir carpeta -> servidor -> sesión -> mensaje -> respuesta streaming + avatar | OK | UI-check real contra servidor v2.1.1: `session.execution.succeeded`, eventos `text.delta`/`reasoning.delta`, agente `idle`->`think`->`code`->`terminal`->`done` |
| 4 | Aprobar y rechazar un permiso funciona | OK | Demo: tarjeta de permiso aparece, botón "Permitir una vez" -> `permission.replied` -> eventos continúan; el escenario `error` cierra el turno con error visible |
| 5 | Detener (abort) interrumpe una respuesta en curso | OK | `Esc` / botón "Detener" -> `POST /api/session/:id/interrupt` -> `session.execution.interrupted` |
| 6 | Archivos modificados aparecen con su diff | OK | Demo `permission.asked` trae `metadata.files[].patch`; el visor renderiza añadidos/borrados |
| 7 | `!comando` muestra salida en Terminal | OK | Demo `!dir` / `!npm test` -> `session.shell.*` -> panel Terminal con salida y código de salida |
| 8 | Cerrar la app no deja procesos `opencode` huérfanos | OK | `taskkill /T /F` síncrono en `server-manager.js` y `scripts/smoke.js:cleanup`; verificación: antes/después `Get-Process opencode` sin nuevos PIDs |

Comprobaciones añadidas para la primera persona y las preguntas:

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 9 | La oficina en primera persona entra, se recorre y se sale sin romper la vista superior | OK | `--demo --ui-check` (2026-11-17): capturas `02b`-`02d`, `02b1` (patio), `02b1b` (cielo), `02b2` (ficha), `02b3` (latigazo); informe `fpMoved: true`, `fpPatioSkyOk: true` (cielo con cielo abierto en el patio), `fpAimOk: true`, `fpCardVisible: true` (`E` abre la ficha sin salir), `fpWhipOk: true` (`F` da el latigazo y sigue dentro), `fpCardCloseGuard: true` (`Esc` cierra la ficha y no el modo), `fpRestored: true` |
| 10 | La herramienta `question` muestra la tarjeta, acepta una opción y el turno continúa | OK | Capturas `14-pregunta.png` y `15-pregunta-respondida.png`; informe `questionPrompt: true`, `questionAsked.cards: 1` («Seguir con la demo» / «Parar aquí»), `questionAnswer.sent: true`, `questionDone { cards: 0, replied: true }` |

## Limitaciones conocidas

- Solo API v2 (`/api/...`); la v1 no es compatible.
- No existe "Rehacer" (la v2 no lo expone); solo "Deshacer" y "Descartar preparado".
- Una sesión solo tiene una ubicación en opencode: las carpetas extra de contexto viven en la
  app y se anuncian al agente por mensaje (no son una location nativa de la sesión).
- El modo demo no ejecuta modelo ni toca archivos: simula eventos con la misma forma.
- La primera persona es un raycaster 2.5D: no hay alturas ni plantas, y la mirada vertical solo
  desplaza el horizonte (±26 %), no gira la cámara. El agua del Patio es un patrón por casillas,
  no un reflejo.
- El modo primera persona renderiza en un búfer interno de 220-460 px y lo escala con píxeles
  nítidos; en pantallas muy grandes el pixelado es intencionado.
- El árbol de archivos lista lo que expone `/api/fs/list`; binarios no se previsualizan.
- El historial de una sesión real puede contener mensajes de turnos previos (se cargan al seleccionar).
- La oficina dibuja como mucho 10 agentes simultáneos.
- Si el proveedor da error por cuota (429) la app lo avisa, pero no puede evitarlo: hay que
  esperar al reinicio de la cuota o cambiar de modelo.
- Solo Windows probado; Linux/macOS requieren ajustes en `spawn`/`taskkill` (preparado en código).
