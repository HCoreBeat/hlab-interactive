# Notas reales de la API de opencode (v2.1.1)

> Fuente de verdad: `docs/openapi.json` obtenido con `GET /openapi.json` del servidor de la
> versión instalada, más eventos y respuestas observados en vivo el 2026-10-20.
>
> **La tabla de endpoints de `PROMPT.md` es de la API v1 y NO existe en esta versión.**
> Todo lo que implementa la app se basa en este documento.
>
> **Ampliación v2.2.7 (2026-11):** la sección 12 documenta las rutas de la herramienta
> `question`, que no aparecen en `openapi.json`. El resto se verificó contra v2.1.1.

```
opencode --version  ->  opencode v2.1.1
node --version      ->  v24.20.0
```

Las rutas de la v1 (`/session`, `/session/:id/message`, `/doc`, `/event`, …) **no existen**:
el servidor las resuelve con el HTML de la SPA. La API real vive bajo el prefijo `/api/...`
y la especificación en `/openapi.json`.

---

## 1. Arranque y autenticación

```bash
opencode serve --port <N> --hostname 127.0.0.1
```

- `--print-logs` imprime logs en stderr; `--standalone` **no** es un flag de `serve`.
- El servidor escucha en `http://127.0.0.1:<puerto>` e imprime en **stdout**:

  ```
  server listening on http://127.0.0.1:4123
  server password <password aleatorio de 43 caracteres>
  ```

- **La autenticación es obligatoria siempre.** Es HTTP Basic con:
  - usuario: `opencode` (literal; cualquier otro usuario devuelve 401),
  - password: el de `OPENCODE_SERVER_PASSWORD` si la variable existe en el entorno del
    proceso, o el aleatorio impreso en stdout si no existe.

  Verificado: con `OPENCODE_SERVER_PASSWORD=mipass123` el servidor **no imprime** password y
  acepta `opencode:mipass123`.

- Sin credenciales: `401 Unauthorized`.
- La SPA del servidor (`/`) y las rutas desconocidas devuelven HTML con `200`; hay que
  comprobar el `content-type` al depurar.

### Estrategia de la app

`server-manager` genera su propio password aleatorio, lo inyecta en el entorno del proceso
hijo como `OPENCODE_SERVER_PASSWORD` y lo usa para todas las peticiones. Así no depende de
parsear stdout (aunque también se parsea como respaldo).

---

## 2. Selección de proyecto: `location`

La v1 usaba `?directory=` o la cabecera `x-opencode-directory`. La v2 usa un objeto
`location` serializado como **deepObject**:

```
?location[directory]=C%3A%5C_WORK%5COpenCode%20Visual
```

Notas verificadas:

- Los corchetes **deben ir percent-encoded** (`%5B` / `%5D`). Con corchetes literales el
  servidor ignora el parámetro y responde con la location por defecto (probado: devolvía
  listas vacías en lugar de error).
- Si se omite `location`, se usa el `cwd` del proceso servidor.
- **Una location debe estar "cargada" antes de usarse.** Si no, cualquier endpoint que la
  reciba responde `404 {"_tag":"LocationNotFoundError"}`.
- **Cómo cargarla:** `GET /api/session?directory=<ruta absoluta>` la registra. Verificado en
  una carpeta nueva: `fs/list` daba 404 y, tras ese `GET`, `fs/list` y `location` respondieron
  200. Crear una sesión con `location` también la carga.
- `GET /api/debug/location` lista las locations cargadas (útil para depurar).
- `GET /api/session` usa el parámetro **plano** `directory=`, no `location[...]`.

### Estrategia de la app

Un único servidor para todos los proyectos: al abrir un proyecto se llama
`GET /api/session?directory=<dir>` para registrarlo y desde ese momento todas las peticiones
llevan `location[directory]=<dir>`. **No hace falta reiniciar el servidor al cambiar de
proyecto.**

---

## 3. Endpoints usados por la app

Todos devuelven JSON salvo donde se indica. Errores: `4xx/5xx` con
`{_tag|type, message, kind}`; nunca lanzan HTML.

| Función | Endpoint |
|---|---|
| Info / salud | `GET /api/info` → `{version, pid, urls, paths, capabilities}` |
| Location | `GET /api/location?location[directory]` → `{directory, project:{id,directory,canonical}}` |
| Proyectos | `GET /api/project` → `[{id, canonical, time, sandboxes}]` |
| Listar sesiones | `GET /api/session?directory=<dir>&limit=&order=&search=&archived=` |
| Crear sesión | `POST /api/session` |
| Obtener / editar / borrar | `GET|PATCH|DELETE /api/session/:id` |
| Mensajes | `GET /api/session/:id/message?limit=&order=&type=` |
| Enviar prompt | `POST /api/session/:id/prompt` |
| Interrumpir | `POST /api/session/:id/interrupt[?resume=true]` → `{interrupted: bool}` |
| Shell | `POST /api/session/:id/shell` (204) |
| Comando / slash | `POST /api/session/:id/command` (204) |
| Modelo / agente | `POST /api/session/:id/model`, `POST /api/session/:id/agent` (204) |
| Permisos pendientes | `GET /api/permission/request?location[directory]` |
| Leer permiso | `GET /api/session/:sid/permission/:rid` |
| Responder permiso | `POST /api/session/:sid/permission/:rid/reply` (204) |
| Permisos guardados | `GET /api/permission/saved?projectID=` |
| Diff por turno | `GET /api/session/:id/diff?from=&to=&context=` |
| Diff del repo | `GET /api/vcs/diff?location[...]&mode=working\|branch\|committed&base=` |
| Estado del repo | `GET /api/vcs/status?location[...]` |
| Árbol / fichero / búsqueda | `GET /api/fs/list?location[...]&path=`, `GET /api/fs/read/<ruta>?location[...]`, `GET /api/fs/find?location[...]&query=&type=&limit=` |
| Revert | `POST /api/session/:id/revert/stage`, `POST /api/session/:id/revert/commit`, `DELETE /api/session/:id/revert` |
| Agentes | `GET /api/agent?location[...]`, `GET /api/agent/:id` |
| Modelos | `GET /api/model?location[...]` |
| Proveedores | `GET /api/provider?location[...]` |
| Comandos | `GET /api/command?location[...]` |
| Configuración (incluye MCP) | `GET /api/config` → `[{type:"document", path, info:{mcp:{servers:{...}}}}]` |
| Estado vivo de MCP | `GET /api/mcp?location[...]` → `{data:[{name, status, tools}]}` (puede venir vacío) |
| Eventos | `GET /api/event` (SSE) |
| Shell en curso | `GET /api/shell?location[...]`, `GET /api/shell/:id/output?cursor=&limit=` |

> **Verificado en vivo (v2.1.1).** `GET /api/config` devuelve un array de documentos de
> configuración; los servidores MCP del usuario están en `info.mcp.servers` con
> `{type, command[], disabled}`. `GET /api/mcp` devuelve `{data: []}` mientras el servidor no
> ha iniciado esos MCP, por lo que la app fusiona ambos: la configuración da la lista y el
> endpoint vivo da el estado.
>
> **`location[directory]` funciona en `/api/fs/*`**: con
> `GET /api/fs/list?location[directory]=<otra-carpeta>&path=` el servidor lista esa carpeta
> (verificado con `C:\Users\alede\.config`). Es lo que permite explorar las carpetas extra
> de contexto. Las rutas absolutas (`path=C:\...`) no funcionan; hay que pasar la carpeta en
> `location` y rutas relativas dentro de ella.
>
> `GET /api/fs/read/<ruta>` responde `application/octet-stream`, incluso al leer texto. El
> cliente debe conservar los bytes: decodificar como UTF-8 para la vista de código y como
> `data:` URL para previsualizar imágenes.

### Cuerpos

```jsonc
// POST /api/session
{ "title": "Nueva sesión",
  "location": { "directory": "C:\\proyecto" },
  "agent": "build",                                  // opcional
  "model": { "id": "deepseek-v4.1-flash-free",       // opcional
             "providerID": "opencode",
             "variant": "..." },                     // opcional
  "permissions": [ { "action": "*",     "resource": "*",   "effect": "allow" },
                   { "action": "edit",  "resource": "*",   "effect": "ask"   } ] }

// POST /api/session/:id/prompt   (asíncrono: responde en ~30 ms con el mensaje de usuario)
{ "text": "hola",
  "id": "msg_...",                       // opcional, idempotencia
  "files": [ /* PromptInput.FileAttachment */ ],
  "agents": [ /* Prompt.AgentAttachment */ ],
  "skills": [ /* PromptInput.SkillAttachment */ ],
  "delivery": "steer" | "queue",         // opcional
  "resume": true }                       // opcional

// POST /api/session/:id/shell
{ "command": "npm test", "id": "msg_..." }

// POST /api/session/:id/command
{ "name": "init", "text": "", "files": [] }

// POST /api/session/:id/permission/:rid/reply
{ "decision": "once" | "always" | "reject", "message": "opcional" }

// POST /api/session/:id/revert/stage
{ "messageID": "msg_...", "files": true }

// POST /api/session/:id/model      -> { "model": { "id": "<modelID>", "providerID": "opencode" } }
// POST /api/session/:id/agent      -> { "agent": "build" }
```

Respuesta de `POST /api/session` (`{data: Session.Info}`):

```json
{ "id": "ses_...", "projectID": "...", "cost": 0,
  "tokens": {"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},
  "time": {"created":1792544560091,"updated":1792544560091},
  "title": "Nueva sesión",
  "location": {"directory": "C:\\proyecto"} }
```

`Session.Info` completo incluye además `agent`, `model`, `outcome` (`succeeded|failed|interrupted`),
`time.idle`, `revert`, `permissions`, `subpath`, `metadata`.

---

## 4. Mensajes

`GET /api/session/:id/message` → `{ data: [...], cursor: {previous, next} }`, ordenados del
más nuevo al más antiguo. Tipos (`?type=` acepta estos valores):
`user`, `assistant`, `idle`, `synthetic`, `system`, `shell`, `compaction`, `skill`,
`location-switched`, `agent-switched`, `model-switched`.

```jsonc
// usuario
{ "id": "msg_...", "type": "user", "text": "Responde solo OK", "time": {"created": 1792544655018} }

// asistente
{ "id": "msg_...", "type": "assistant", "agent": "build",
  "model": {"id": "big-pickle", "providerID": "opencode"},
  "content": [
    { "type": "reasoning", "text": "...", "native": {"reasoningField": "reasoning_content"},
      "time": {"created": 0, "completed": 0} },
    { "type": "text", "text": "OK" },
    { "type": "tool", "id": "call_...", "name": "read", "executed": false,
      "state": { "status": "completed",
                 "input": {"path": "C:\\x\\hello.txt"},
                 "content": [{"type": "text", "text": "Read file ...\n1: hola"}],
                 "metadata": {"truncated": false} },
      "time": {"created": 0, "ran": 0, "completed": 0} }
  ],
  "finish": "stop", "cost": 0, "tokens": {"input":149,"output":55,"reasoning":39,"cache":{"read":9216,"write":0}},
  "time": {"created": 0, "streamed": 0, "completed": 0} }

// fin de turno
{ "id": "msg_...", "type": "idle", "outcome": "succeeded", "time": {"created": 1792544671127} }
```

Estados de `state.status` en una parte `tool`: `streaming`, `running`, `completed`, `error`.

---

## 5. Eventos SSE (`GET /api/event`)

Formato: líneas `data: {json}` separadas por línea vacía. El heartbeat es un **comentario**
(`: heartbeat`), no un evento. `Content-Type: text/event-stream`.

Cada evento:

```jsonc
{ "id": "evt_...",              // id global, sirve para deduplicar
  "created": 1792544604292,     // ms epoch
  "type": "session.text.delta",
  "location": {"directory": "C:\\proyecto"},   // no siempre presente
  "data": { ... },
  "durable": {"aggregateID": "ses_...", "seq": 7, "version": 1} }  // no siempre
```

### Tipos observados en vivo

| Evento | `data` |
|---|---|
| `server.connected` | `{}` |
| `project.updated` | `{id, canonical, time, sandboxes}` |
| `session.inbox.enqueued` | `{inboxID, sessionID, item:{type, payload, delivery}}` |
| `session.inbox.delivered` | `{sessionID, inboxID}` |
| `session.execution.started` | `{sessionID}` |
| `session.execution.succeeded` | `{sessionID}` |
| `session.instructions.updated` | `{sessionID, delta:{...hashes}}` |
| `session.step.started` | `{sessionID, agent, model:{id,providerID}, assistantMessageID, started}` |
| `session.step.streamed` | `{sessionID, assistantMessageID}` |
| `session.step.ended` | `{sessionID, assistantMessageID, finish, rawFinish, cost, tokens}` |
| `session.usage.updated` | `{sessionID, cost, tokens}` |
| `session.reasoning.started` | `{sessionID, assistantMessageID, ordinal, native}` |
| `session.reasoning.delta` | `{sessionID, assistantMessageID, ordinal, delta}` |
| `session.reasoning.ended` | `{sessionID, assistantMessageID, ordinal, text, native}` |
| `session.text.started` | `{sessionID, assistantMessageID, ordinal}` |
| `session.text.delta` | `{sessionID, assistantMessageID, ordinal, delta}` |
| `session.text.ended` | `{sessionID, assistantMessageID, ordinal, text}` |
| `session.tool.input.started` | `{sessionID, assistantMessageID, id, name}` |
| `session.tool.input.ended` | `{sessionID, assistantMessageID, id, text}` (JSON en crudo) |
| `session.tool.called` | `{sessionID, assistantMessageID, id, input, executed}` |
| `session.tool.success` | `{sessionID, assistantMessageID, id, content:[{type:"text",text}], metadata, executed}` |
| `permission.asked` | ver sección 6 |
| `permission.replied` | `{sessionID, requestID, reply}` |
| `shell.created` | `{info:{id, status, command, cwd, shell, file, metadata, time}}` |
| `session.shell.started` | `{sessionID, shell:{...}, pid}` |
| `shell.exited` | `{id, exit, status}` |
| `session.shell.ended` | `{sessionID, shell:{...}, output:{output, cursor, size, truncated}}` |

No observados (se manejan de forma defensiva, sin romper la app y visibles en el Inspector):
`session.execution.failed`, `session.execution.interrupted`, `session.tool.error`,
`session.compaction.*`, `session.error`.

### Implicaciones de diseño

- **El streaming es por deltas**: `session.text.delta` / `session.reasoning.delta` traen el
  trozo nuevo; no hay que reconstruir partes desde `message.part.updated` (eso era v1).
- `session.tool.*` llega por fases: `input.started` (empieza a generar los argumentos),
  `input.ended` (argumentos en crudo), `called` (argumentos ya parseados) y
  `success`/`error` (resultado).
- El estado "trabajando" de una sesión se deriva de
  `session.execution.started` → `succeeded|failed|interrupted`.
- `session.shell.ended` ya incluye la salida completa del comando.

---

## 6. Permisos (probado de punta a punta)

Con un ruleset `ask` en la sesión, al editar un archivo llega:

```json
{ "type": "permission.asked",
  "data": { "id": "per_...", "sessionID": "ses_...",
            "action": "edit",
            "resources": ["perm.txt"],
            "save": ["*"],
            "metadata": { "files": [ { "file": "perm.txt",
                                       "patch": "Index: perm.txt\n...",
                                       "status": "added",
                                       "additions": 1, "deletions": 0 } ] },
            "source": { "type": "tool", "messageID": "msg_...", "id": "call_..." } } }
```

Responder:

```
POST /api/session/:sid/permission/:rid/reply
{ "decision": "once" }     -> 204
```

y se emite `permission.replied {sessionID, requestID, reply:"once"}`.

`decision` acepta `once`, `always`, `reject`. `Permission.Request` también trae `action`
(`edit`, `bash`, …), `resources` y `message` opcional.

**Importante:** por defecto el agente `build` trae `{"action":"*","resource":"*","effect":"allow"}`
y por tanto no pide permisos. Para que la UI de aprobación funcione de verdad, la app crea las
sesiones con un ruleset que pone `edit` y `bash` en `ask` (configurable en Ajustes).

Los permisos pendientes también se pueden recuperar tras reconectar con
`GET /api/permission/request?location[directory]=...`.

---

## 7. Shell

```
POST /api/session/:id/shell   { "command": "echo hola" }   -> 204
```

No devuelve el id. La salida llega por eventos:

- `shell.created` trae el `sh_...`,
- `session.shell.started`,
- `shell.exited {exit}`,
- `session.shell.ended` con `output.output` completo (y `cursor`, `size`, `truncated`).

Para shell fuera de sesión: `POST /api/shell {command}` devuelve `{location, data: Shell.Info}` y
la salida se pagina con `GET /api/shell/:id/output?cursor=&limit=`.

El resultado del shell se inyecta además en la sesión como mensaje `synthetic`.

---

## 8. Revert / deshacer

No existe `POST /revert` ni `unrevert` (v1). En v2:

- `POST /api/session/:id/revert/stage  { "messageID": "msg_...", "files": true }`
- `POST /api/session/:id/revert/commit`  (aplica lo preparado)
- `DELETE /api/session/:id/revert`      (descarta lo preparado)

El estado vive en `Session.Info.revert = {messageID, partID, snapshot, files:[FileDiff.Info]}`.

La app expone "Deshacer último cambio" (stage + commit) y "Descartar cambio preparado"
(DELETE). No hay "Rehacer" equivalente: se documenta como limitación.

---

## 9. Diffs

- `GET /api/session/:id/diff?from=<msgID>&to=<msgID>&context=` → `{data: FileDiff.Info[]}`.
  Por defecto usa el turno del último mensaje de usuario. En una carpeta temporal sin
  snapshots devolvió `{data:[]}`.
- `GET /api/vcs/diff?location[...]&mode=working|branch|committed&base=&context=` → `{location, data}`.
- `GET /api/vcs/status?location[...]` → `{location, data:[{file, additions, deletions, status}]}`.

`FileDiff.Info = {file, patch, additions, deletions, status: added|deleted|modified}`.

**Estrategia de la app:** los diffs se alimentan, por orden de fiabilidad, de
(a) `metadata.files[]` de `permission.asked`, (b) las partes `tool` de `edit`/`write` con su
`state`, y (c) `/api/vcs/diff`. Si el endpoint por turno viene vacío, la pestaña sigue
mostrando los archivos tocados por el agente.

---

## 10. Agentes, modelos y comandos

- `GET /api/agent?location[...]` → `{location, data:[{id, name, description, mode: "primary"|"subagent"|"all", hidden, model, permissions, ...}]}`.
  En una instalación limpia: `build` (mode `primary`) y `plan`.
- `GET /api/model?location[...]` → `{location, data:[{id, modelID, providerID, name, variants[], cost[], status, enabled, limit:{context,input,output}}]}`.
  En esta máquina, 10 modelos del proveedor `opencode` (`big-pickle`, `deepseek-v4.1-flash-free`, …).
- `GET /api/provider?location[...]` → `{location, data:[{id, name, ...}]}`.
- `GET /api/command?location[...]` → `{location, data:[{name, description}]}` (vacío sin comandos
  de usuario). Los comandos internos (`/nueva`, `/abortar`, …) los aporta la app.
- `POST /api/session/:id/command {name, text}` con un nombre inexistente → `404`.

---

## 11. Trampas encontradas

1. `/doc`, `/event`, `/session`, `/file`… devuelven **HTML 200**, no 404. Verificar siempre el
   `content-type` y usar `/api/...`.
2. Los corchetes de `location[directory]` deben ir percent-encoded.
3. Una location no cargada responde `404 LocationNotFoundError` en casi todo.
4. El usuario de Basic auth es literalmente `opencode`.
5. `POST /prompt` es asíncrono: no esperar la respuesta del modelo ahí.
6. `POST /session/:id/shell` devuelve 204 sin id: hay que leer `shell.created`.
7. `revert` es un flujo de staging, no un par revert/unrevert.
8. El binario en Windows es un `.cmd` de npm; hay que lanzarlo con `shell:true` o usar la ruta
   del `.exe` (`...\node_modules\@opencode\cli\bin\opencode.exe`).

---

## 12. Preguntas al usuario (`question`, verificado en v2.2.7)

La herramienta `question` no aparece en `docs/openapi.json` (descargado de v2.1.1); estas rutas
se verificaron contra el binario instalado de **opencode 2.2.7**. La solicitud tiene la forma:

```json
{ "id": "que_...", "sessionID": "ses_...", "tool": "question",
  "questions": [ { "header": "Formato",
                   "question": "¿Cómo quieres que continúe la demostración?",
                   "options": [ { "label": "Seguir con la demo", "description": "…" } ],
                   "multiple": false, "custom": true } ] }
```

| Método | Ruta | Cuerpo | Efecto |
|---|---|---|---|
| `GET` | `/api/session/{sessionID}/question` | — | preguntas pendientes de esa sesión |
| `GET` | `/api/question/request?location[directory]=…` | — | todas las pendientes de la location |
| `POST` | `/api/session/{sessionID}/question/{requestID}/reply` | `{ "answers": [["Etiqueta"], …] }` | responde; un array de etiquetas por pregunta, en orden |
| `POST` | `/api/session/{sessionID}/question/{requestID}/reject` | `{}` | omite la pregunta |

Eventos SSE: `question.asked { id, sessionID, questions, tool }` y
`question.replied` / `question.rejected { sessionID, requestID }`. En 2.2.7 el payload llega en
`properties` (no en `data`), así que `event-router.js` fusiona ambas formas antes de guardarlo.

Reglas de la app:

- La tarjeta no se muestra hasta tener un `id` real; si el evento llega sin él (o se pierde),
  `questions.js` consulta las rutas `GET` cada 1,5 s mientras el runtime de la sesión está en la
  herramienta `question`.
- Si el `POST` de respuesta falla, se ofrece «Enviar como mensaje» y el error se muestra en la
  tarjeta; nunca se responde en silencio ni se deja el turno bloqueado.
- Las respuestas se envían como un array de etiquetas por pregunta (`answers: [[…], […]]`), con
  la respuesta libre añadida al final de su grupo.
- `question.replied`/`rejected` retira la tarjeta por `requestID || id` y limpia las tarjetas
  sintéticas de esa sesión.

