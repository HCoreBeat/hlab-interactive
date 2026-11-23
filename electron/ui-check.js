'use strict';

const fs = require('node:fs');
const path = require('node:path');
const workspaceFile = require('./workspace-file');

/**
 * Scripted UI verification used during development (`--ui-check`).
 *
 * It drives the demo backend through the real UI: select a desk, send a
 * prompt, wait for the permission card, approve it, and capture screenshots at
 * each step. It always quits the app at the end.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(directory, name);
  fs.writeFileSync(file, image.toPNG());
  console.log(`[ui-check] captura: ${file}`);
}

async function clickFirstDesk(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      const canvas = document.querySelector(".office-canvas");
      if (!office || typeof office.getAgents !== "function" || !canvas) return false;
      const agents = office.getAgents();
      if (agents.length === 0) return false;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return false;
      const agent = agents[0];
      canvas.dispatchEvent(new MouseEvent("click", {
        clientX: rect.left + agent.x,
        clientY: rect.top + agent.y,
        bubbles: true,
      }));
      return true;
    })()
  `);
}

/** Opens the office (the split under the chat) if it is collapsed. */
async function openOffice(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const room = document.getElementById("office-room");
      const button = document.querySelector('.activity-button[data-view="office"]');
      if (!button) return false;
      // The office starts open, so only click when it is collapsed.
      if (room && room.getBoundingClientRect().height > 40) return true;
      button.click();
      return true;
    })()
  `);
}

/** Closes the office only when it is actually visible. */
async function closeOffice(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const room = document.getElementById("office-room");
      const button = document.getElementById("office-close");
      if (!button) return false;
      if (room && room.getBoundingClientRect().height < 40) return true;
      button.click();
      return true;
    })()
  `);
}

async function sendPrompt(win, text) {
  return win.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById("prompt-input");
      if (!input) return false;
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      return true;
    })()
  `);
}

async function approve(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector(".permission-card button.allow");
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
}

async function clickTab(win, tab) {
  return win.webContents.executeJavaScript(`
    (() => {
      if (typeof window.__showPanel !== "function") return false;
      window.__showPanel(${JSON.stringify(tab)});
      return true;
    })()
  `);
}

async function openPalette(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      return Boolean(document.querySelector('.command-palette'));
    })()
  `);
}

async function closePalette(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return !document.querySelector('.command-palette');
    })()
  `);
}

async function summary(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      let desks = 0;
      let states = [];
      if (office && typeof office.getAgents === "function") {
        const agents = office.getAgents();
        desks = agents.length;
        states = agents.map(a => a.state || "idle");
      } else {
        desks = document.querySelectorAll(".desk").length;
        states = [...document.querySelectorAll(".desk")].map((desk) => desk.dataset.state);
      }
      return {
        desks,
        states,
        rooms: document.querySelectorAll(".office-room-tag").length,
        mcpTags: [...document.querySelectorAll(".office-mcp-name")].map((node) => node.textContent),
        agentTags: [...document.querySelectorAll(".office-agent-tag")].map((node) => node.textContent),
        officeSummary: document.getElementById("office-summary")?.textContent || "",
        canvas: (() => {
          const node = document.querySelector(".office-canvas");
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        })(),
        messages: document.querySelectorAll(".msg").length,
        messageList: [...document.querySelectorAll(".msg")].map((node) => ({
          role: node.className.replace("msg ", ""),
          text: (node.innerText || "").replace(/\\s+/g, " ").slice(0, 70),
        })),
        tools: document.querySelectorAll(".tool-card").length,
        diffs: document.querySelectorAll(".tool-diffs").length,
        toolOutputs: document.querySelectorAll(".tool-output").length,
        toolCommands: document.querySelectorAll(".tool-command").length,
        agentRows: document.querySelectorAll(".agent-row").length,
        columns: document.querySelectorAll(".panel-column").length,
        columnTabs: [...document.querySelectorAll(".panel-column-tab")].map(n => n.textContent.trim()),
        activityButtons: [...document.querySelectorAll(".activity-button")].map(n => n.dataset.view),
        railOpen: !document.getElementById("app")?.classList.contains("rail-closed"),
        officeOpen: !document.getElementById("app")?.classList.contains("office-collapsed"),
        chatShare: (() => {
          const chat = document.getElementById("chat")?.getBoundingClientRect();
          if (!chat) return null;
          return Math.round((chat.width * chat.height) / (window.innerWidth * window.innerHeight) * 100);
        })(),
        permissionCards: document.querySelectorAll(".permission-card").length,
        shells: document.querySelectorAll(".shell-item").length,
        activeTab: document.querySelector(".tab.is-active")?.dataset.tab || null,
        streaming: document.getElementById("chat-scroll")?.innerText.includes("He leído") || false,
        streamingCaret: Boolean(document.querySelector(".streaming-caret")),
        chatLength: (document.getElementById("chat-scroll")?.innerText || "").length,
        atBottom: (() => {
          const scroll = document.getElementById("chat-scroll");
          if (!scroll) return null;
          return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 50;
        })(),
        chip: document.querySelector(".board .chip")?.textContent?.trim() || null,
        toasts: [...document.querySelectorAll(".toast-text")].map((node) => node.textContent),
      };
    })()
  `);
}

async function enterFirstPerson(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      if (!office || typeof office.enterFirstPerson !== "function") return false;
      return office.enterFirstPerson();
    })()
  `);
}

async function fpSnapshot(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      const root = document.querySelector(".fp-root");
      const canvas = document.querySelector(".fp-canvas");
      const rect = canvas?.getBoundingClientRect();
      const topdown = document.querySelector(".office-canvas")?.getBoundingClientRect();
      const card = document.querySelector(".fp-card");
      return {
        open: Boolean(office?.isFirstPerson?.()),
        hidden: root ? root.hidden : null,
        buffer: canvas ? { width: canvas.width, height: canvas.height } : null,
        css: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        topdown: topdown ? { width: Math.round(topdown.width), height: Math.round(topdown.height) } : null,
        state: office?.getFpState?.() || null,
        room: document.querySelector(".fp-room-name")?.textContent || null,
        minimap: Boolean(document.querySelector(".fp-minimap")),
        crosshair: Boolean(document.querySelector(".fp-crosshair")),
        cardOpen: Boolean(card && !card.hidden),
        cardTitle: card?.querySelector(".fp-card-title")?.textContent || null,
        cardRoom: card?.querySelector(".fp-card-place")?.textContent || null,
        whipFx: Boolean(document.querySelector(".fp-whip.is-active")),
      };
    })()
  `);
}

async function fpWalk(win, code = 'KeyW', holdMs = 650) {
  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: ${JSON.stringify(code)}, bubbles: true }));
  `);
  await sleep(holdMs);
  await win.webContents.executeJavaScript(`
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: ${JSON.stringify(code)}, bubbles: true }));
  `);
}

async function pressEscape(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return true;
    })()
  `);
}

async function pressKey(win, key, code) {
  return win.webContents.executeJavaScript(`
    (() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, bubbles: true }));
      return true;
    })()
  `);
}

async function fpSetPose(win, pose) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      if (!office || typeof office.setFpPose !== "function") return false;
      office.setFpPose(${JSON.stringify(pose)});
      return true;
    })()
  `);
}

/**
 * Places the camera 1.25 tiles in front of a main agent and looks at it, so the
 * E/F checks are deterministic even while the agent walks around.
 */
async function fpAimAtAgent(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const office = window.__office;
      if (!office || typeof office.setFpPose !== "function") return null;
      const agents = office.getAgents().filter((agent) => !agent.parentID);
      const scale = office.getScale() || 1;
      const TILE = 40;
      for (const agent of agents) {
        const ax = agent.x / (scale * TILE);
        const ay = agent.y / (scale * TILE);
        for (let step = 0; step < 8; step += 1) {
          const angle = (step * Math.PI) / 4;
          const x = ax - Math.cos(angle) * 1.25;
          const y = ay - Math.sin(angle) * 1.25;
          office.setFpPose({ x, y, angle });
          const state = office.getFpState();
          if (state && state.room >= 0) return { id: agent.id, x, y, angle };
        }
      }
      return null;
    })()
  `);
}

/** Average brightness and colour variety of the upper part of the FP buffer. */
async function fpSkyStats(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const canvas = document.querySelector(".fp-canvas");
      if (!canvas || !canvas.width) return null;
      const g = canvas.getContext("2d");
      const h = Math.max(8, Math.round(canvas.height * 0.16));
      const data = g.getImageData(0, 0, canvas.width, h).data;
      let sum = 0;
      let min = 255;
      let max = 0;
      let count = 0;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += lum;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
        count += 1;
        if (i % 64 === 0) colors.add(data[i] + "," + data[i + 1] + "," + data[i + 2]);
      }
      return {
        avg: Math.round(sum / Math.max(1, count)),
        min: Math.round(min),
        max: Math.round(max),
        colors: colors.size,
      };
    })()
  `);
}

async function answerQuestion(win) {
  const picked = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.question-card');
      const option = card?.querySelector('.q-option');
      if (!option) return false;
      option.click();
      return true;
    })()
  `);
  await sleep(300);
  const sent = await win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.question-card');
      const button = card?.querySelector('button.allow[data-send]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()
  `);
  return { picked, sent };
}

async function questionSnapshot(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const card = document.querySelector('.question-card');
      const labels = card ? [...card.querySelectorAll('.q-option strong')].map((node) => node.textContent) : [];
      return {
        cards: document.querySelectorAll('.question-card').length,
        labels,
        text: card?.querySelector('.q-text')?.textContent || null,
        error: card?.querySelector('.chip.err')?.textContent || null,
        replied: (document.getElementById('chat-scroll')?.innerText || '').includes('Respuesta recibida'),
      };
    })()
  `);
}

async function runUiCheck(win, { app, directory }) {
  const target = directory || path.join(process.env.TEMP || '.', 'oc-ui-check');
  fs.mkdirSync(target, { recursive: true });
  const report = { directory: target, workspaceArg: workspaceFile.workspaceFromArgv(process.argv) };

  try {
    await sleep(4000);
    report.startupProject = await win.webContents.executeJavaScript(
      "window.__ocState?.()?.project?.dir || null",
    );
    if (report.workspaceArg) {
      const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      report.workspaceOpened = normalize(report.startupProject) === normalize(report.workspaceArg.dir);
    }
    await capture(win, target, '01-oficina.png');

    if (process.env.OC_UI_READONLY === '1') {
      report.readonly = true;
      report.summary = await summary(win);
      console.log('[ui-check] informe:', JSON.stringify(report, null, 2));
      app.quit();
      return;
    }

    // The office is a split under the chat: open it and pick an agent.
    report.openedOffice = await openOffice(win);
    await sleep(1200);
    await capture(win, target, '02-oficina-abierta.png');
    const originalTheme = await win.webContents.executeJavaScript(`
      (() => {
        const theme = document.documentElement.dataset.theme || 'dark';
        document.documentElement.dataset.theme = 'light';
        document.getElementById('app')?.setAttribute('data-theme', 'light');
        return theme;
      })()
    `);
    await sleep(350);
    await capture(win, target, '02a-oficina-clara.png');
    report.lightTheme = await win.webContents.executeJavaScript(`
      (() => {
        const lum = (color) => {
          const parts = String(color).match(/[\\d.]+/g)?.map(Number) || [];
          if (parts.length < 3) return null;
          return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
        };
        const style = getComputedStyle(document.body);
        const textLum = lum(style.color);
        const bgLum = lum(style.backgroundColor);
        return {
          theme: document.documentElement.dataset.theme,
          textLum,
          bgLum,
          ok: textLum !== null && bgLum !== null && textLum < 0.3 && bgLum > 0.6,
        };
      })()
    `);
    await win.webContents.executeJavaScript(`
      (() => {
        document.documentElement.dataset.theme = ${JSON.stringify(originalTheme)};
        document.getElementById('app')?.setAttribute('data-theme', ${JSON.stringify(originalTheme)});
      })()
    `);
    await sleep(250);

    // Idioma: cambiar a inglés desde ajustes debe traducir la interfaz completa.
    const i18nLabels = `
      (() => ({
        lang: document.documentElement.lang,
        sessions: document.querySelector('.activity-button[data-view="sessions"]')?.getAttribute('title') || '',
        files: document.querySelector('.activity-button[data-view="files"]')?.getAttribute('title') || '',
        send: document.getElementById('send-btn')?.textContent || '',
      }))()
    `;
    report.i18nBefore = await win.webContents.executeJavaScript(i18nLabels);
    report.i18nSaved = await win.webContents.executeJavaScript(
      "window.oc.settings.set({ locale: 'en' }).then((value) => value.locale === 'en')",
    );
    await sleep(500);
    report.i18nEnglish = await win.webContents.executeJavaScript(`
      (() => {
        const spanishLeft = [...new Set([...document.querySelectorAll('body *')]
          .filter((node) => node.children.length === 0)
          .map((node) => (node.textContent || '').trim())
          .filter((text) => text.length > 3 && /\\b(sesi[oó]n|sesiones|archivos|agente|modelo|proyecto|carpeta|terminal|enviar|guardar|buscar|ayuda|ajustes|claro|oscuro|idioma|permiso|trabajando|finalizado|esperando)\\b/i.test(text)))];
        return {
          labels: ${i18nLabels},
          dynamic: typeof window.__ocTranslate === 'function'
            ? window.__ocTranslate('Proyecto abierto: Demo') : null,
          spanishLeftCount: spanishLeft.length,
          spanishLeft: spanishLeft.slice(0, 25),
        };
      })()
    `);
    await capture(win, target, '02c-ingles.png');
    await win.webContents.executeJavaScript("window.oc.settings.set({ locale: 'es' })");
    await sleep(350);
    report.i18nRestored = await win.webContents.executeJavaScript(i18nLabels);
    report.i18nOk = Boolean(
      report.i18nSaved
      && report.i18nEnglish?.labels?.lang === 'en'
      && report.i18nEnglish.labels.sessions !== report.i18nBefore.sessions
      && report.i18nEnglish.labels.send !== report.i18nBefore.send
      && /Project opened/i.test(report.i18nEnglish.dynamic || '')
      && report.i18nRestored.lang === 'es'
      && report.i18nRestored.sessions === report.i18nBefore.sessions,
    );

    // Primera persona: entrar, caminar, salir con Esc y comprobar que la vista
    // superior sigue intacta (sin regresiones ni cambios de estilo).
    report.fpEntered = await enterFirstPerson(win);
    await sleep(700);
    report.fpBefore = await fpSnapshot(win);
    await capture(win, target, '02b-primera-persona.png');
    await fpWalk(win);
    report.fpAfter = await fpSnapshot(win);
    await capture(win, target, '02c-primera-persona-caminando.png');
    report.fpMoved = Boolean(
      report.fpBefore?.state && report.fpAfter?.state
      && Math.hypot(
        report.fpAfter.state.x - report.fpBefore.state.x,
        report.fpAfter.state.y - report.fpBefore.state.y,
      ) > 0.2,
    );

    // Patio: el techo debe ser cielo abierto (gradiente + nubes), no una losa.
    report.fpPatioPose = await fpSetPose(win, { x: 35.4, y: 2.6, angle: Math.PI / 2, pitch: 0.18 });
    await sleep(550);
    report.fpPatio = await fpSnapshot(win);
    report.fpPatioSky = await fpSkyStats(win);
    report.fpPatioSkyOk = Boolean(
      report.fpPatio?.state?.room === 5
      && report.fpPatioSky
      && report.fpPatioSky.avg > 18
      && report.fpPatioSky.max - report.fpPatioSky.min > 24
      && report.fpPatioSky.colors > 8,
    );
    await capture(win, target, '02b1-primera-persona-patio.png');

    // Cielo despejado: mirada alta sobre el patio, sin paredes de por medio.
    report.fpSkyPose = await fpSetPose(win, { x: 37.5, y: 5.5, angle: 0, pitch: 0.26 });
    await sleep(450);
    report.fpSky = await fpSnapshot(win);
    await capture(win, target, '02b1b-cielo-patio.png');

    // El mismo patio en tema claro: el cielo diurno usa la otra paleta.
    const patioTheme = await win.webContents.executeJavaScript(`
      (() => {
        const theme = document.documentElement.dataset.theme || 'dark';
        document.documentElement.dataset.theme = 'light';
        document.getElementById('app')?.setAttribute('data-theme', 'light');
        return theme;
      })()
    `);
    await sleep(450);
    report.fpPatioLightSky = await fpSkyStats(win);
    report.fpPatioLightSkyOk = Boolean(
      report.fpPatioLightSky
      && report.fpPatioLightSky.avg > 90
      && report.fpPatioLightSky.max > 150
      && report.fpPatioLightSky.colors > 40,
    );
    await capture(win, target, '02b1c-patio-claro.png');
    await win.webContents.executeJavaScript(`
      (() => {
        document.documentElement.dataset.theme = ${JSON.stringify(patioTheme)};
        document.getElementById('app')?.setAttribute('data-theme', ${JSON.stringify(patioTheme)});
      })()
    `);
    await sleep(300);

    // Apuntar a un agente y abrir su ficha con E: no debe salir del modo.
    report.fpAimPose = await fpAimAtAgent(win);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await sleep(200);
      report.fpAim = await fpSnapshot(win);
      if (report.fpAim?.state?.aimed) break;
      report.fpAimPose = await fpAimAtAgent(win);
    }
    report.fpAimOk = Boolean(report.fpAim?.state?.aimed);
    await pressKey(win, 'e', 'KeyE');
    await sleep(350);
    report.fpCard = await fpSnapshot(win);
    report.fpCardVisible = Boolean(
      report.fpCard?.open && report.fpCard?.cardOpen && report.fpCard?.state?.inspecting,
    );
    await capture(win, target, '02b2-ficha-agente.png');

    // F: latigazo al agente apuntado; el modo sigue abierto y el contador sube.
    await pressKey(win, 'f', 'KeyF');
    await sleep(140);
    report.fpWhip = await fpSnapshot(win);
    await capture(win, target, '02b3-latigazo.png');
    await sleep(240);
    report.fpWhipSettled = await fpSnapshot(win);
    report.fpWhipOk = Boolean(
      report.fpWhip?.open
      && report.fpWhip?.state?.whips === 1
      && report.fpWhip?.cardOpen
      && report.fpWhipSettled?.open,
    );

    // Esc con la ficha abierta: cierra la ficha y deja la primera persona.
    // El agente demo puede salirse de la oficina y la ficha se cierra sola
    // (fp-ui.js); si pasó, la reabrimos para que la comprobación sea estable.
    let guardCard = await fpSnapshot(win);
    if (!guardCard?.cardOpen) {
      for (let attempt = 0; attempt < 6 && !guardCard?.cardOpen; attempt += 1) {
        report.fpGuardPose = await fpAimAtAgent(win);
        await sleep(200);
        await pressKey(win, 'e', 'KeyE');
        await sleep(250);
        guardCard = await fpSnapshot(win);
      }
    }
    report.fpGuardCardReady = Boolean(guardCard?.open && guardCard?.cardOpen);
    await pressEscape(win);
    await sleep(350);
    report.fpCardClosed = await fpSnapshot(win);
    report.fpCardCloseGuard = Boolean(
      report.fpCardClosed?.open && !report.fpCardClosed?.cardOpen,
    );

    await pressEscape(win);
    await sleep(450);
    report.fpClosed = await fpSnapshot(win);
    report.fpRestored = Boolean(
      report.fpClosed
      && report.fpClosed.open === false
      && report.fpClosed.hidden !== false
      && report.fpClosed.topdown
      && report.fpClosed.topdown.width > 40,
    );
    await capture(win, target, '02d-oficina-restaurada.png');

    report.selectedDesk = false;
    for (let attempt = 0; attempt < 8 && !report.selectedDesk; attempt += 1) {
      report.selectedDesk = await clickFirstDesk(win);
      if (!report.selectedDesk) await sleep(250);
    }
    await sleep(900);
    await capture(win, target, '03-chat.png');
    report.closedOffice = await closeOffice(win);
    await sleep(400);

    report.sentPrompt = await sendPrompt(win, process.env.OC_UI_PROMPT || 'hola, haz la demo completa');
    await sleep(3200);
    await capture(win, target, '04-permiso.png');
    report.permissionCards = await win.webContents.executeJavaScript(
      "document.querySelectorAll('.permission-card').length",
    );

    // Esc en primera persona no debe llegar al atajo global que aborta el turno.
    report.fpTurnEntered = await enterFirstPerson(win);
    await sleep(300);
    await capture(win, target, '04a-fp-durante-turno.png');
    await pressEscape(win);
    await sleep(350);
    report.fpEscapeGuard = await win.webContents.executeJavaScript(`
      (() => ({
        stillOpen: Boolean(window.__office?.isFirstPerson?.()),
        permissionCards: document.querySelectorAll('.permission-card').length,
        errorBanner: Boolean(document.querySelector('.chat-error-banner')),
      }))()
    `);

    report.approved = await approve(win);
    await sleep(4500);
    report.userAnchor = await win.webContents.executeJavaScript(`
      (() => {
        const node = document.querySelector('.chat-anchor');
        const lastUser = [...(window.__ocState()?.messages?.[window.__ocState()?.activeSessionId] || [])]
          .reverse().find((message) => message.type === 'user');
        return {
          visible: Boolean(node && !node.hidden),
          text: node?.querySelector('.chat-anchor-text')?.textContent || '',
          matches: Boolean(lastUser && node?.querySelector('.chat-anchor-text')?.textContent === (lastUser.text || '')),
        };
      })()
    `);
    await capture(win, target, '05-terminado.png');

    report.contextoTab = await clickTab(win, 'context');
    await sleep(700);
    await capture(win, target, '06-contexto.png');

    report.mcpTab = await clickTab(win, 'mcp');
    await sleep(700);
    await capture(win, target, '07-mcp.png');

    report.agentsTab = await clickTab(win, 'agents');
    await sleep(700);
    await capture(win, target, '08-agentes.png');

    // El selector propio debe aplicar el agente y separar principales/subagentes.
    const pickAgent = async (id) => win.webContents.executeJavaScript(`
      (() => {
        const button = document.getElementById('agent-select');
        button.click();
        const item = [...document.querySelectorAll('.agent-menu-item:not(.is-disabled)')]
          .find((node) => node.dataset.agentId === ${JSON.stringify(id)});
        if (!item) return false;
        item.click();
        return true;
      })()
    `);
    report.agentPick = await win.webContents.executeJavaScript(`
      (() => {
        const st = window.__ocState();
        const primary = (st.agents || []).filter((agent) => !agent.hidden
          && (agent.mode === 'primary' || agent.mode === 'all' || !agent.mode));
        const session = st.sessions.find((item) => item.id === st.activeSessionId);
        return {
          before: st.selection.agent || session?.agent || primary[0]?.id,
          other: primary.find((agent) => agent.id !== (st.selection.agent || session?.agent))?.id || null,
          groups: [...document.querySelectorAll('.agent-menu-section h4')].map((node) => node.textContent.trim()),
          items: document.querySelectorAll('.agent-menu-item').length,
          disabledItems: document.querySelectorAll('.agent-menu-item.is-disabled').length,
          hasSearch: Boolean(document.getElementById('agent-menu-search')),
        };
      })()
    `);
    await win.webContents.executeJavaScript("document.getElementById('agent-select').click()");
    await sleep(250);
    await capture(win, target, '08b-selector-agente.png');
    report.agentPick.clicked = await pickAgent(report.agentPick.other);
    await sleep(600);
    report.agentPick.applied = await win.webContents.executeJavaScript(
      "window.__ocState().selection.agent",
    );
    report.agentPick.menuClosed = await win.webContents.executeJavaScript(
      "document.getElementById('agent-menu').hidden",
    );
    if (report.agentPick.before) {
      await pickAgent(report.agentPick.before);
      await sleep(400);
    }
    report.agentPick.restored = await win.webContents.executeJavaScript(
      "window.__ocState().selection.agent",
    );
    report.agentPick.ok = Boolean(
      report.agentPick.clicked
      && report.agentPick.applied === report.agentPick.other
      && report.agentPick.menuClosed
      && report.agentPick.groups.length >= 1
      && report.agentPick.hasSearch,
    );

    // Aislamiento: permisos, preguntas y mensajes de una sesión no deben
    // aparecer al abrir otra, y el subagente debe mostrar su propio agente.
    report.sessionIsolation = await win.webContents.executeJavaScript(`
      (async () => {
        const st = window.__ocState();
        const roots = st.sessions.filter((session) => !session.parentID);
        if (roots.length < 2) return { ok: false, reason: 'se necesitan dos sesiones' };
        const a = roots[0].id;
        const b = roots[1].id;
        const dir = st.project.dir;
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        await window.__ocSelectSession(a);
        await wait(250);
        window.__ocTestEvent({
          id: 'evt_perm_' + a, created: Date.now(), type: 'permission.asked',
          location: { directory: dir },
          data: { id: 'perm_a', sessionID: a, action: 'edit', metadata: {} },
        });
        window.__ocTestEvent({
          id: 'evt_user_' + a, created: Date.now(), type: 'session.inbox.enqueued',
          location: { directory: dir },
          data: { inboxID: 'msg_a', sessionID: a, item: { type: 'user', payload: { text: 'MENSAJE_SESION_A' } } },
        });
        await wait(300);
        const inA = {
          permission: Boolean(document.querySelector('.permission-card')),
          anchor: document.querySelector('.chat-anchor-text')?.textContent || '',
        };
        await window.__ocSelectSession(b);
        await wait(400);
        const stB = window.__ocState();
        const inB = {
          permission: Boolean(document.querySelector('.permission-card')),
          anchor: document.querySelector('.chat-anchor-text')?.textContent || '',
          active: stB.activeSessionId,
          expectedB: b,
          messagesA: (stB.messages[a] || []).filter((m) => m.type === 'user').map((m) => m.text),
          messagesB: (stB.messages[b] || []).filter((m) => m.type === 'user').map((m) => m.text),
          statePermission: stB.permissions.some((item) => item.sessionID === a),
        };
        await window.__ocSelectSession(a);
        await wait(300);
        const backInA = Boolean(document.querySelector('.permission-card'));

        const child = window.__ocState().subagents[0];
        let childAgent = null;
        if (child) {
          window.__ocTestEvent({
            id: 'evt_step_child', created: Date.now(), type: 'session.step.started',
            location: { directory: dir },
            data: { sessionID: child.id, assistantMessageID: 'msg_child', agent: 'general' },
          });
          await wait(300);
          childAgent = window.__ocState().subagents.find((item) => item.id === child.id)?.agent || null;
        }
        return {
          ok: inA.permission && inA.anchor.includes('MENSAJE_SESION_A')
            && !inB.permission && inB.active === b && !inB.anchor.includes('MENSAJE_SESION_A')
            && inB.statePermission && backInA && childAgent === 'general',
          inA, inB, backInA, childAgent,
        };
      })()
    `);

    report.sessionsTab = await clickTab(win, 'sessions');
    await sleep(700);
    report.subagentRows = await win.webContents.executeJavaScript(
      "document.querySelectorAll('.session-item.is-child').length",
    );
    await capture(win, target, '09-sesiones.png');

    // Varios subagentes: deben vivir dentro de la tarjeta del padre, compactos
    // y sin desbordar; el tirador los pliega y despliega.
    report.subagentInject = await win.webContents.executeJavaScript(`
      (() => {
        const st = window.__ocState();
        const root = st.sessions.find((item) => st.subagents.some((child) => child.parentID === item.id))
          || st.sessions[0];
        const dir = st.project.dir;
        if (!root || typeof window.__ocTestEvent !== 'function') {
          return { ok: false, reason: 'sin sesión raíz o sin hook' };
        }
        const now = Date.now();
        const add = (id, title, agent) => window.__ocTestEvent({
          id: 'evt_' + id, created: now, type: 'session.created',
          location: { directory: dir },
          data: { session: {
            id, title, agent, parentID: root.id,
            location: { directory: dir },
            time: { created: now, updated: now },
          } },
        });
        add('ses_test_sub_a', 'Revisar estilos de la barra', 'explore');
        add('ses_test_sub_b', 'Probar atajos de teclado', 'general');
        add('ses_test_sub_c', 'Escribir pruebas del panel', 'build');
        window.__ocTestEvent({
          id: 'evt_sub_a_start', created: now, type: 'session.execution.started',
          location: { directory: dir }, data: { sessionID: 'ses_test_sub_a' },
        });
        return { ok: true, root: root.id };
      })()
    `);
    // El render del panel puede ir un frame por detrás del evento inyectado:
    // esperamos a que el DOM refleje los cuatro hijos antes de medir.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(200);
      report.subagentLayout = await win.webContents.executeJavaScript(`
        (() => {
          const group = document.querySelector('.sp-group');
          const kids = group ? [...group.querySelectorAll('.sp-children .session-item.is-child')] : [];
          const list = document.querySelector('.session-list');
          return {
            groups: document.querySelectorAll('.sp-group').length,
            nestedChildren: kids.length,
            siblingLeaks: document.querySelectorAll('.session-list > .session-item.is-child').length,
            parentLines: document.querySelectorAll('.sp-parent').length,
            overflowX: list ? list.scrollWidth - list.clientWidth : null,
            titles: kids.map((node) => node.querySelector('.sp-title')?.textContent || ''),
            busyChildren: kids.filter((node) => node.classList.contains('is-busy')).length,
          };
        })()
      `);
      if (report.subagentLayout.nestedChildren >= 3 && report.subagentLayout.busyChildren >= 1) break;
    }
    await sleep(400);
    await capture(win, target, '09b-subagentes.png');
    report.subagentCollapse = await win.webContents.executeJavaScript(`
      (async () => {
        const toggle = () => document.querySelector('.sp-group .sp-toggle');
        const count = () => document.querySelectorAll('.sp-group .sp-children .session-item.is-child').length;
        if (!toggle()) return { ok: false, reason: 'sin tirador' };
        const before = count();
        toggle().click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const collapsed = toggle()?.getAttribute('aria-expanded') === 'false';
        const afterCollapse = count();
        toggle()?.click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const afterExpand = count();
        return {
          ok: before > 0 && collapsed && afterCollapse === 0 && afterExpand === before,
          before, collapsed, afterCollapse, afterExpand,
        };
      })()
    `);
    report.subagentLayoutOk = Boolean(
      report.subagentInject?.ok
      && report.subagentLayout?.nestedChildren >= 3
      && report.subagentLayout?.siblingLeaks === 0
      && report.subagentLayout?.parentLines === 0
      && report.subagentLayout?.overflowX <= 1
      && report.subagentLayout?.busyChildren >= 1
      && report.subagentCollapse?.ok,
    );

    report.palette = await openPalette(win);
    await sleep(500);
    await capture(win, target, '10-paleta.png');
    await closePalette(win);

    // A failed turn must show why it failed (quota, provider error, …).
    await sendPrompt(win, 'error');
    await sleep(2500);
    await approve(win);
    await sleep(3000);
    report.errorBanner = await win.webContents.executeJavaScript(
      "document.querySelector('.chat-error-banner .chat-error-text')?.textContent || null",
    );
    await capture(win, target, '11-error.png');

    await win.webContents.executeJavaScript(`
      (() => {
        const body = document.querySelector('.panel-column-body');
        if (body) body.scrollTop = 80;
      })()
    `);
    report.filesTab = await clickTab(win, 'files');
    await sleep(700);
    report.filesPanel = await win.webContents.executeJavaScript(`
      (() => {
        const pane = document.querySelector('.file-tree-pane');
        const modified = document.querySelector('.modified-files');
        const heading = document.querySelector('.modified-list-title');
        const search = document.querySelector('.file-tree-pane .search-row');
        if (!pane || !modified || !heading || !search) return { ok: false, reason: 'missing files panel elements' };
        const paneRect = pane.getBoundingClientRect();
        const modifiedRect = modified.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        const searchRect = search.getBoundingClientRect();
        const headingVisible = !modified.hidden && headingRect.height > 0
          && headingRect.top >= modifiedRect.top && headingRect.bottom <= modifiedRect.bottom;
        const searchVisible = searchRect.height > 0 && searchRect.top >= paneRect.top && searchRect.bottom <= paneRect.bottom;
        const outerScroll = document.querySelector('.panel-column-body')?.scrollTop || 0;
        return {
          ok: headingVisible && searchVisible && outerScroll === 0,
          headingVisible,
          searchVisible,
          outerScroll,
          heading: heading.textContent,
          headingTop: Math.round(headingRect.top),
          searchTop: Math.round(searchRect.top),
          paneBottom: Math.round(paneRect.bottom),
        };
      })()
    `);
    report.previewFull = await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocSelectFile !== 'function') return { ok: false, reason: 'sin hook de archivo' };
        window.__ocSelectFile('src/store.js');
        await new Promise((resolve) => setTimeout(resolve, 700));
        const button = document.querySelector('.file-preview-full');
        if (!button || button.disabled) return { ok: false, reason: 'sin botón de pantalla completa' };
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const modal = document.querySelector('.modal.preview-fullscreen');
        const rect = modal?.getBoundingClientRect();
        const result = {
          ok: Boolean(modal && rect && rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9),
          width: rect ? Math.round(rect.width) : 0,
          height: rect ? Math.round(rect.height) : 0,
          body: modal ? (modal.querySelector('.modal-body')?.textContent || '').slice(0, 80) : '',
        };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 250));
        result.closed = !document.querySelector('.modal.preview-fullscreen');
        return result;
      })()
    `);
    report.previewFullOk = Boolean(report.previewFull?.ok && report.previewFull?.closed);
    await capture(win, target, '12-archivos.png');

    await win.webContents.executeJavaScript("document.getElementById('model-select')?.click()");
    await sleep(350);
    report.modelPicker = await win.webContents.executeJavaScript(`
      (() => {
        const modal = document.querySelector('.modal');
        const groups = [...document.querySelectorAll('.model-provider-group')];
        const search = modal?.querySelector('.model-picker-search input[type="search"]');
        const icon = modal?.querySelector('.model-picker-search svg');
        const results = modal?.querySelector('.model-picker-list');
        if (!modal || groups.length < 2 || !search || !icon || !results) return { ok: false, reason: 'expected picker, two providers, SVG search icon and results region' };
        const initialOpen = groups.filter((group) => group.open).length;
        const heading = groups[0].querySelector('summary');
        heading.click();
        const collapsed = !groups[0].open;
        heading.click();
        const expanded = groups[0].open;
        groups.forEach((group) => { group.open = true; });
        for (const group of groups) {
          const rows = group.querySelector('.model-provider-models');
          const sample = rows?.querySelector('.model-picker-item');
          if (!rows || !sample) continue;
          for (let index = 0; index < 40; index += 1) rows.appendChild(sample.cloneNode(true));
        }
        const canScroll = results.scrollHeight > results.clientHeight;
        results.scrollTop = results.scrollHeight;
        const reachedEnd = results.scrollTop > 0
          && results.scrollTop + results.clientHeight >= results.scrollHeight - 1;
        search.value = 'reasoner';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        const filtered = [...document.querySelectorAll('.model-picker-item')].map((item) => item.innerText).join(' ').toLowerCase();
        const filteredGroups = [...document.querySelectorAll('.model-provider-group')];
        const searchHasResults = filtered.includes('reasoner') && filteredGroups.length === 1 && filteredGroups[0].open;
        return { ok: collapsed && expanded && searchHasResults && canScroll && reachedEnd, providerGroups: groups.length, initialOpen, collapsed, expanded, searchHasResults, canScroll, reachedEnd, resultsScrollHeight: results.scrollHeight, resultsClientHeight: results.clientHeight, searchIconIsSvg: icon.namespaceURI === 'http://www.w3.org/2000/svg', duplicateSearchButtonRemoved: !document.getElementById('model-search-btn') };
      })()
    `);
    await capture(win, target, '13-modelos.png');
    await win.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    // Herramienta `question`: la tarjeta debe aparecer, aceptar una opción y
    // dejar que el turno continúe (el agente no se queda bloqueado).
    report.questionPrompt = await sendPrompt(win, 'pregunta');
    await sleep(3400);
    await approve(win);
    await sleep(3400);
    report.questionAsked = await questionSnapshot(win);
    await capture(win, target, '14-pregunta.png');
    report.questionAnswer = await answerQuestion(win);
    await sleep(1900);
    report.questionDone = await questionSnapshot(win);
    await capture(win, target, '15-pregunta-respondida.png');

    // Proyectos en paralelo: un turno de OTRA carpeta debe seguir vivo, marcarse
    // en la UI y no colarse en la lista del proyecto que estamos viendo.
    const foreignDir = 'C:\\Demo\\otro-proyecto';
    report.foreignInject = await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocTestEvent !== 'function') return { ok: false, reason: 'sin hook de prueba' };
        const dir = ${JSON.stringify(foreignDir)};
        const id = 'ses_test_foreign';
        const st = window.__ocState();
        const recents = [{ directory: dir, openedAt: Date.now() }, ...(st.settings.recentProjects || []).filter((item) => item.directory !== dir)];
        await window.oc.settings.set({ recentProjects: recents });
        window.__ocTestEvent({
          id: 'evt_test_foreign_created', created: Date.now(), type: 'session.created',
          location: { directory: dir },
          data: { session: { id, title: 'Tarea en segundo plano', agent: 'build', location: { directory: dir } } },
        });
        window.__ocTestEvent({
          id: 'evt_test_foreign_start', created: Date.now(), type: 'session.execution.started',
          location: { directory: dir },
          data: { sessionID: id },
        });
        const after = window.__ocState();
        return {
          ok: true,
          busy: Boolean(after.runtime[id]?.busy),
          inCurrentList: after.sessions.some((session) => session.id === id),
          inRegistry: Boolean(after.projects[dir]?.sessions?.some((session) => session.id === id)),
        };
      })()
    `);
    await clickTab(win, 'sessions');
    await sleep(350);
    report.foreignMarkers = await win.webContents.executeJavaScript(`
      (() => ({
        topbar: Boolean(document.querySelector('.topbar .project-work-mark:not([hidden])')),
        chipWork: Boolean(document.querySelector('#project-chip.has-work')),
        activity: Boolean(document.querySelector('.activity-button[data-view="sessions"] .sp-activity-mark:not([hidden])')),
        sidebar: Boolean(document.querySelector('.recent-item.has-work .sp-work-mark')),
        leakedInList: Boolean(document.querySelector('.session-list [data-session="ses_test_foreign"]')),
      }))()
    `);
    await clickTab(win, 'sessions');
    await sleep(350);
    await capture(win, target, '16-proyectos-en-paralelo.png');
    report.foreignStillAlive = await win.webContents.executeJavaScript(`
      (() => {
        const runtime = window.__ocState()?.runtime?.['ses_test_foreign'] || {};
        return { busy: Boolean(runtime.busy), outcome: runtime.outcome || null };
      })()
    `);

    // Cambiar de carpeta (ida y vuelta) no debe interrumpir el turno ajeno.
    report.foreignSwitch = await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocOpenProject !== 'function') return { ok: false, reason: 'sin hook de cambio' };
        const before = window.__ocState().runtime['ses_test_foreign']?.busy;
        const target = 'C:\\\\_WORK\\\\OpenCode Visual';
        await window.__ocOpenProject(target);
        const away = window.__ocState();
        const during = {
          dir: away.project.dir,
          busy: Boolean(away.runtime['ses_test_foreign']?.busy),
          outcome: away.runtime['ses_test_foreign']?.outcome || null,
        };
        await window.__ocOpenProject(away.appInfo?.demoDirectory || 'C:\\\\Demo\\\\opencode-oficina');
        const back = window.__ocState();
        return {
          ok: true,
          before: Boolean(before),
          during,
          after: {
            dir: back.project.dir,
            busy: Boolean(back.runtime['ses_test_foreign']?.busy),
            outcome: back.runtime['ses_test_foreign']?.outcome || null,
          },
        };
      })()
    `);
    await sleep(300);
    report.foreignWorkOk = Boolean(
      report.foreignInject?.ok
      && report.foreignInject.busy
      && !report.foreignInject.inCurrentList
      && report.foreignInject.inRegistry
      && report.foreignMarkers?.topbar
      && report.foreignMarkers?.chipWork
      && report.foreignMarkers?.activity
      && report.foreignMarkers?.sidebar
      && !report.foreignMarkers?.leakedInList
      && report.foreignStillAlive?.busy
      && !report.foreignStillAlive?.outcome
      && report.foreignSwitch?.ok
      && report.foreignSwitch?.before
      && report.foreignSwitch?.during?.busy
      && !report.foreignSwitch?.during?.outcome
      && report.foreignSwitch?.after?.busy
      && !report.foreignSwitch?.after?.outcome,
    );

    // Terminal directo: PowerShell en la raíz de una carpeta real, caja grande
    // e historial ordenado de más nuevo a más viejo.
    await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocOpenProject === 'function') {
          await window.__ocOpenProject('C:\\\\_WORK\\\\OpenCode Visual');
        }
      })()
    `);
    await clickTab(win, 'terminal');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(200);
      if (await win.webContents.executeJavaScript("Boolean(document.querySelector('.terminal-input'))")) break;
    }
    report.terminalUi = await win.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('.terminal-input');
        const rect = input?.getBoundingClientRect();
        return {
          exists: Boolean(input),
          height: rect ? Math.round(rect.height) : 0,
          tag: input?.tagName || null,
          cwd: document.querySelector('.terminal-cwd')?.textContent || null,
        };
      })()
    `);
    // Botones de scripts leídos del package.json del proyecto.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await sleep(200);
      if (await win.webContents.executeJavaScript("document.querySelectorAll('.terminal-script-btn').length > 0")) break;
    }
    report.scriptsUi = await win.webContents.executeJavaScript(`
      (() => {
        const buttons = [...document.querySelectorAll('.terminal-script-btn')];
        return {
          count: buttons.length,
          names: buttons.map((button) => button.textContent.trim()),
          hasDist: buttons.some((button) => button.textContent.includes('build:highlight')),
        };
      })()
    `);
    await win.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll('.terminal-script-btn')]
          .find((item) => item.textContent.includes('build:highlight'));
        button?.click();
        return Boolean(button);
      })()
    `);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(400);
      if (await win.webContents.executeJavaScript(
        "document.querySelector('.terminal-list .shell-item[data-kind=\"script\"]')?.dataset.status === 'exited'",
      )) break;
    }
    report.scriptResult = await win.webContents.executeJavaScript(`
      (() => {
        const items = [...document.querySelectorAll('.terminal-list .shell-item[data-kind="script"]')];
        return {
          count: items.length,
          first: items[0] ? {
            command: items[0].querySelector('.command')?.textContent || '',
            output: (items[0].querySelector('.shell-output')?.textContent || '').trim(),
            status: items[0].dataset.status,
          } : null,
        };
      })()
    `);
    report.scriptsOk = Boolean(
      report.scriptsUi?.hasDist
      && report.scriptResult?.first?.command?.includes('build:highlight')
      && report.scriptResult?.first?.status === 'exited',
    );

    // Botones de versión: se prueban en una carpeta temporánea para no tocar
    // la versión real del proyecto durante la verificación.
    const versionDir = path.join(target, 'version-fixture');
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, 'package.json'), `${JSON.stringify({
      name: 'version-fixture', version: '0.0.0', scripts: { test: 'echo ok' },
    }, null, 2)}\n`, 'utf8');
    await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocOpenProject === 'function') {
          await window.__ocOpenProject(${JSON.stringify(versionDir)});
        }
      })()
    `);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(250);
      if (await win.webContents.executeJavaScript("document.querySelectorAll('.terminal-script-btn.is-version').length >= 3")) break;
    }
    report.versionUi = await win.webContents.executeJavaScript(`
      (async () => {
        const dir = window.__ocState()?.project?.dir;
        const scripts = dir ? await window.oc.terminal.scripts(dir) : null;
        return {
          dir,
          scripts: scripts?.scripts?.map((item) => item.name) || [],
          buttons: [...document.querySelectorAll('.terminal-script-btn.is-version')].map((b) => b.textContent.trim()),
        };
      })()
    `);
    await win.webContents.executeJavaScript(`
      (() => {
        const button = [...document.querySelectorAll('.terminal-script-btn.is-version')]
          .find((item) => item.textContent.includes('patch'));
        button?.click();
        return Boolean(button);
      })()
    `);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(300);
      if (await win.webContents.executeJavaScript(
        "document.querySelector('.terminal-list .shell-item[data-kind=\"version\"]')?.dataset.status === 'exited'",
      )) break;
    }
    report.versionResult = await win.webContents.executeJavaScript(`
      (() => {
        const node = document.querySelector('.terminal-list .shell-item[data-kind="version"]');
        return node ? {
          command: node.querySelector('.command')?.textContent || '',
          output: (node.querySelector('.shell-output')?.textContent || '').trim(),
          status: node.dataset.status,
        } : null;
      })()
    `);
    report.versionOk = Boolean(
      report.versionUi?.buttons?.length === 3
      && report.versionResult?.command?.includes('npm version patch')
      && report.versionResult?.status === 'exited',
    );

    await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocOpenProject === 'function') {
          await window.__ocOpenProject(${JSON.stringify(target)});
        }
      })()
    `);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(200);
      if (await win.webContents.executeJavaScript("Boolean(document.querySelector('.terminal-input'))")) break;
    }

    const runTerminal = async (command) => {
      await win.webContents.executeJavaScript(`
        (() => {
          const input = document.querySelector('.terminal-input');
          if (!input) return false;
          input.value = ${JSON.stringify(command)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.terminal-run')?.click();
          return true;
        })()
      `);
      await sleep(700);
    };
    await runTerminal("Write-Output 'primera'");
    await sleep(400);
    await runTerminal("Write-Output 'segunda'");
    await sleep(600);
    report.terminalResult = await win.webContents.executeJavaScript(`
      (() => {
        const items = [...document.querySelectorAll('.terminal-list .shell-item')];
        const entry = (node) => ({
          command: node.querySelector('.command')?.textContent || '',
          output: (node.querySelector('.shell-output')?.textContent || '').trim(),
          status: node.dataset.status,
          kind: node.dataset.kind,
        });
        const command = items[0]?.querySelector('.command');
        const style = command ? getComputedStyle(command) : null;
        return {
          count: items.length,
          head: command ? {
            text: command.textContent,
            width: Math.round(command.getBoundingClientRect().width),
            display: style.display,
            color: style.color,
            flex: style.flex,
            minWidth: style.minWidth,
          } : null,
          first: items[0] ? entry(items[0]) : null,
          second: items[1] ? entry(items[1]) : null,
          state: (window.__ocState()?.terminal || []).map((item) => ({
            command: item.command, status: item.status, exit: item.exit,
          })),
        };
      })()
    `);
    // Un comando en curso debe terminar aunque se cambie de pestaña a mitad.
    await win.webContents.executeJavaScript(`
      (() => {
        const input = document.querySelector('.terminal-input');
        if (!input) return false;
        input.value = "Start-Sleep -Milliseconds 1200; Write-Output 'resiliente'";
        document.querySelector('.terminal-run')?.click();
        return true;
      })()
    `);
    await sleep(250);
    await clickTab(win, 'agents');
    await sleep(350);
    await clickTab(win, 'terminal');
    await sleep(1800);
    report.terminalResilience = await win.webContents.executeJavaScript(`
      (() => {
        const entry = (window.__ocState()?.terminal || [])
          .find((item) => String(item.command || '').includes('resiliente'));
        return entry ? { status: entry.status, output: (entry.output || '').trim() } : null;
      })()
    `);
    report.terminalResilienceOk = Boolean(
      report.terminalResilience?.status === 'exited'
      && report.terminalResilience?.output?.includes('resiliente'),
    );

    await sleep(500); // deja que el compositor pinte el último estado antes de capturar
    await capture(win, target, '17-terminal.png');
    report.terminalOk = Boolean(
      report.scriptsOk
      && report.versionOk
      && report.terminalResilienceOk
      && report.terminalUi?.exists
      && report.terminalUi?.height >= 60
      && report.terminalUi?.tag === 'TEXTAREA'
      && report.terminalResult?.head?.width >= 120
      && report.terminalResult?.first?.command?.includes('segunda')
      && report.terminalResult?.first?.output?.includes('segunda')
      && report.terminalResult?.second?.command?.includes('primera')
      && report.terminalResult?.second?.output?.includes('primera')
      && report.terminalResult?.first?.status === 'exited'
      && report.terminalResult?.first?.kind === 'terminal',
    );

    // El anclaje del usuario se actualiza al enviar un mensaje nuevo.
    await sendPrompt(win, 'mensaje de anclaje');
    await sleep(900);
    report.anchorUpdate = await win.webContents.executeJavaScript(`
      (() => {
        const node = document.querySelector('.chat-anchor-text');
        return {
          visible: Boolean(node && !node.closest('.chat-anchor').hidden),
          text: node?.textContent || '',
          ok: Boolean(node && node.textContent.includes('mensaje de anclaje')),
        };
      })()
    `);
    report.securityIpc = await win.webContents.executeJavaScript(`
      (async () => {
        const shellRejected = await window.oc.settings.set({ opencodePath: 'calc&whoami' })
          .then(() => false).catch(() => true);
        const unknownRejected = await window.oc.settings.set({ evil: 1 })
          .then(() => false).catch(() => true);
        return { shellRejected, unknownRejected, ok: shellRejected && unknownRejected };
      })()
    `);

    // Controles de ventana propios: no deben solaparse con los botones del topbar.
    report.windowControls = await win.webContents.executeJavaScript(`
      (async () => {
        const min = document.getElementById('win-min');
        const max = document.getElementById('win-max');
        const close = document.getElementById('win-close');
        const settings = document.getElementById('settings-btn');
        if (!min || !max || !close || !settings) return { ok: false, reason: 'faltan botones' };
        const minRect = min.getBoundingClientRect();
        const closeRect = close.getBoundingClientRect();
        const settingsRect = settings.getBoundingClientRect();
        const gap = Math.round(minRect.left - settingsRect.right);
        const inside = closeRect.right <= window.innerWidth + 1;
        const before = await window.oc.windowControls.isMaximized();
        const toggled = await window.oc.windowControls.toggleMaximize();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const restored = await window.oc.windowControls.toggleMaximize();
        return {
          gap,
          inside,
          buttons: [minRect.width, max.getBoundingClientRect().width, closeRect.width].map(Math.round),
          before,
          toggled,
          restored,
          ok: gap >= 0 && inside && toggled !== before && restored === before,
        };
      })()
    `);

    // Source Control: el panel debe listar cambios y mostrar un diff real.
    await win.webContents.executeJavaScript(`
      (async () => {
        if (typeof window.__ocOpenProject === 'function') {
          await window.__ocOpenProject('C:\\\\_WORK\\\\OpenCode Visual');
        }
        window.__showPanel?.('git');
      })()
    `);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(250);
      if (await win.webContents.executeJavaScript("document.querySelectorAll('.git-file').length > 0")) break;
    }
    report.gitPanel = await win.webContents.executeJavaScript(`
      (() => ({
        branch: document.querySelector('.git-branch')?.textContent || '',
        changes: document.querySelectorAll('.git-file').length,
        hasMessage: Boolean(document.querySelector('.git-message')),
        hasActions: document.querySelectorAll('.git-actions button').length,
        fileIcons: document.querySelectorAll('.git-file-icon').length,
        detailHidden: Boolean(document.querySelector('.git-detail')?.hidden),
        badge: (() => {
          const badge = document.querySelector('.activity-button[data-view="git"] .activity-badge');
          return { hidden: badge?.hidden, text: badge?.textContent || '' };
        })(),
      }))()
    `);
    await win.webContents.executeJavaScript("document.querySelector('.git-file')?.click()");
    await sleep(500);
    report.gitDiff = await win.webContents.executeJavaScript(`
      (() => ({
        lines: document.querySelectorAll('.git-detail .diff-line').length,
        hasHead: Boolean(document.querySelector('.git-diff-head')),
      }))()
    `);
    await capture(win, target, '18-source-control.png');
    await win.webContents.executeJavaScript(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    `);
    await sleep(250);
    report.gitEscape = await win.webContents.executeJavaScript(`
      (() => ({
        detailClosed: !document.querySelector('.git-detail .diff-line'),
        railStillOpen: !document.getElementById('app').classList.contains('rail-closed'),
      }))()
    `);
    await win.webContents.executeJavaScript(`
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    `);
    await sleep(200);
    report.gitEscape.railClosedAfterSecond = await win.webContents.executeJavaScript(
      "document.getElementById('app').classList.contains('rail-closed')",
    );
    report.gitOk = Boolean(
      report.gitPanel?.changes > 0
      && report.gitPanel?.hasMessage
      && report.gitPanel?.hasActions >= 3
      && report.gitDiff?.hasHead
      && report.gitDiff?.lines > 0
      && report.gitPanel?.detailHidden
      && report.gitPanel?.fileIcons > 0
      && report.gitPanel?.badge?.hidden === false
      && Number(report.gitPanel?.badge?.text) > 0
      && report.gitEscape?.detailClosed
      && report.gitEscape?.railStillOpen
      && report.gitEscape?.railClosedAfterSecond,
    );
    await win.webContents.executeJavaScript(`
      (async () => {
        window.__showPanel?.('git');
        await window.oc.settings.set({ theme: 'light' });
      })()
    `);
    await sleep(300);
    await capture(win, target, '18b-source-control-claro.png');
    report.gitTheme = await win.webContents.executeJavaScript(`
      (() => {
        const check = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const style = getComputedStyle(node);
          return { color: style.color, background: style.backgroundColor };
        };
        const result = {
          commit: check('.git-actions .btn-primary'),
          push: check('.git-actions .git-action-push'),
          pull: check('.git-actions .git-action-pull'),
        };
        result.ok = [result.commit, result.push, result.pull]
          .every((item) => item && item.color && item.background && item.color !== item.background);
        return result;
      })()
    `);
    await win.webContents.executeJavaScript("window.oc.settings.set({ theme: 'dark' })");

    // Medidor de contexto y compactación: lo que de verdad reduce los MB que se
    // suben al proveedor en cada mensaje.
    report.contextMeter = await win.webContents.executeJavaScript(`
      (async () => {
        const st = window.__ocState?.();
        const sessionID = st?.activeSessionId;
        if (!sessionID || typeof window.__ocTestEvent !== 'function') return { ok: false, reason: 'sin sesión activa' };
        const assistantID = 'msg_test_context';
        window.__ocTestEvent({
          id: 'evt_test_context_start', created: Date.now(), type: 'session.step.started',
          data: { sessionID, assistantMessageID: assistantID, agent: 'build' },
        });
        window.__ocTestEvent({
          id: 'evt_test_context_end', created: Date.now(), type: 'session.step.ended',
          data: {
            sessionID, assistantMessageID: assistantID, finish: 'stop', cost: 0,
            tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 119000, write: 0 } },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const chip = document.getElementById('chat-context');
        const before = {
          hidden: chip?.hidden !== false,
          tokens: Number(chip?.dataset?.tokens || 0),
          bytes: Number(chip?.dataset?.bytes || 0),
          label: document.getElementById('chat-context-label')?.textContent || '',
          danger: chip?.classList.contains('is-danger') || false,
        };
        chip?.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const confirm = [...document.querySelectorAll('.modal footer button')]
          .find((button) => /Compactar/i.test(button.textContent || ''));
        const dialogShown = Boolean(confirm);
        confirm?.click();
        await new Promise((resolve) => setTimeout(resolve, 600));
        const after = {
          tokens: Number(document.getElementById('chat-context')?.dataset?.tokens || 0),
          toast: [...document.querySelectorAll('.toast')].map((node) => node.textContent || '').join(' | '),
        };
        return {
          ok: true,
          before,
          dialogShown,
          after,
          requested: /Compactaci[oó]n solicitada/i.test(after.toast),
        };
      })()
    `);
    await capture(win, target, '19-medidor-contexto.png');
    report.contextOk = Boolean(
      report.contextMeter?.ok
      && report.contextMeter.before?.hidden === false
      && report.contextMeter.before?.tokens >= 120000
      && report.contextMeter.before?.danger
      && /MB|KB/.test(report.contextMeter.before?.label || '')
      && report.contextMeter.dialogShown
      && report.contextMeter.requested,
    );

    // Marcador de tráfico: el paso anterior ya sumó la estimación del modelo y
    // aquí se pide una respuesta al backend para que también cuente la API.
    report.traffic = await win.webContents.executeJavaScript(`
      (async () => {
        const chip = document.getElementById('traffic-chip');
        if (!chip) return { ok: false, reason: 'sin marcador de tráfico' };
        await window.oc.request('GET', '/api/session', { query: { limit: 5 } }).catch(() => null);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const before = {
          down: Number(chip.dataset.down || 0),
          up: Number(chip.dataset.up || 0),
          net: Number(chip.dataset.net || 0),
          requests: Number(chip.dataset.requests || 0),
          steps: Number(chip.dataset.steps || 0),
          label: (chip.textContent || '').trim(),
          title: chip.title || '',
        };
        chip.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { ok: true, before, modalShown: Boolean(document.querySelector('.traffic-modal')) };
      })()
    `);
    await capture(win, target, '20-trafico-datos.png');
    report.traffic.reset = await win.webContents.executeJavaScript(`
      (async () => {
        const chip = document.getElementById('traffic-chip');
        const modal = document.querySelector('.traffic-modal');
        const rows = modal ? [...modal.querySelectorAll('.traffic-name')].map((node) => (node.textContent || '').trim()) : [];
        const reset = modal ? [...modal.querySelectorAll('footer button')].find((button) => /cero/i.test(button.textContent || '')) : null;
        reset?.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = { down: Number(chip?.dataset.down || 0), up: Number(chip?.dataset.up || 0) };
        modal?.querySelector('footer .btn-primary')?.click();
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { rows, hasReset: Boolean(reset), after, closed: !document.querySelector('.traffic-modal') };
      })()
    `);
    const trafficBefore = report.traffic?.before || {};
    report.trafficOk = Boolean(
      report.traffic?.ok
      && report.traffic.modalShown
      && trafficBefore.down + trafficBefore.up > 0
      && trafficBefore.net > 0
      && trafficBefore.steps >= 1
      && /↓/.test(trafficBefore.label)
      && /Internet/.test(trafficBefore.title)
      && /Internet \(tu plan\): ↓ (?!0 B)/.test(trafficBefore.title)
      && (report.traffic.reset?.rows || []).includes('Internet (tu plan)')
      && report.traffic.reset?.hasReset
      && report.traffic.reset?.closed
      && (report.traffic.reset?.after?.down || 0) + (report.traffic.reset?.after?.up || 0)
        < trafficBefore.down + trafficBefore.up,
    );

    report.speechEngine = await win.webContents.executeJavaScript(`
      (() => {
        const text = '# Título\\n\\nUse npm run dist y lea más.\\nSegunda frase.';
        const chunks = window.__ocSpeech?.chunks(text) || [];
        return {
          chunks,
          voice: window.__ocSpeech?.voice('es-ES') || null,
          ok: chunks.length >= 1 && chunks.every((item) => item.length <= 180)
            && !chunks.some((item) => item.includes('#'))
            && chunks.join(' ').includes('npm run dist'),
        };
      })()
    `);

    try {
      report.summary = await summary(win);
    } catch (e) {
      report.summaryError = e.message;
      console.warn('[ui-check] summary failed:', e.message);
    }
  } catch (error) {
    report.error = error.message;
    console.error('[ui-check] error:', error);
  }

  console.log('[ui-check] informe:', JSON.stringify(report, null, 2));
  app.quit();
}

module.exports = { runUiCheck };
