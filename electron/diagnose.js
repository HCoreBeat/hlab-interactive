'use strict';

/**
 * Interactive diagnostic: runs the real UI and reports what is on top of the
 * screen at several points, whether the composer accepts text, and whether
 * every panel tab mounts. Used to find "the app does not let me do anything".
 */

const path = require('node:path');
const fs = require('node:fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(win, target, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(target, name), image.toPNG());
  return path.join(target, name);
}

async function probe(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const describe = (node) => node ? (node.tagName + "." + (node.className || "").toString().split(" ").join(".")) : "null";
      const points = [[200, 400], [700, 150], [700, 400], [1300, 400], [700, 640], [400, 830]];
      const hits = points.map(([x, y]) => {
        const node = document.elementFromPoint(x, y);
        return { x, y, top: describe(node), id: node?.id || null };
      });
      const input = document.getElementById("prompt-input");
      const send = document.getElementById("send-btn");
      const rect = input ? input.getBoundingClientRect() : null;
      return {
        hits,
        input: input ? {
          exists: true,
          disabled: input.disabled,
          readOnly: input.readOnly,
          visible: rect.width > 0 && rect.height > 0,
          rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
          topAt: rect ? describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) : null,
        } : { exists: false },
        send: send ? { exists: true, disabled: send.disabled, rect: (() => { const r = send.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() } : { exists: false },
        welcome: Boolean(document.querySelector(".welcome, .welcome-screen, #welcome")),
        modals: document.querySelectorAll(".modal-backdrop").length,
        tabCount: document.querySelectorAll(".tab").length,
        appClass: document.getElementById("app")?.className,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    })()
  `);
}

async function tryType(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const input = document.getElementById("prompt-input");
      if (!input) return { ok: false, reason: "no input" };
      input.focus();
      const focused = document.activeElement === input;
      input.value = "diagnostico";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: input.value.length > 0, focused, value: input.value };
    })()
  `);
}

async function clickTabs(win) {
  const results = {};
  const tabs = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll(".tab")].map(b => b.dataset.tab)`,
  );
  for (const tab of tabs) {
    const mounted = await win.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('.tab[data-tab="${tab}"]');
        if (!button) return false;
        button.click();
        return true;
      })()
    `);
    await sleep(600);
    const info = await win.webContents.executeJavaScript(`
      (() => ({
        active: document.querySelector(".tab.is-active")?.dataset.tab || null,
        children: document.getElementById("panel-body")?.childElementCount || 0,
        html: (document.getElementById("panel-body")?.textContent || "").slice(0, 60),
      }))()
    `);
    results[tab] = { clicked: mounted, ...info };
  }
  return results;
}

/**
 * Drags every splitter in the direction that must make its panel bigger and
 * checks that it actually grew. This catches inverted drag directions.
 */
async function dragSplitters(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const app = document.getElementById("app");
      const read = (name) => parseFloat(getComputedStyle(app).getPropertyValue(name)) || 0;
      const drag = (grip, dx, dy) => {
        if (!grip) return false;
        const rect = grip.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const options = { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0 };
        grip.dispatchEvent(new PointerEvent("pointerdown", { ...options, clientX: x, clientY: y }));
        grip.dispatchEvent(new PointerEvent("pointermove", { ...options, clientX: x + dx, clientY: y + dy }));
        grip.dispatchEvent(new PointerEvent("pointerup", { ...options, clientX: x + dx, clientY: y + dy }));
        return true;
      };

      // Each entry drags the grip towards the direction that must enlarge it.
      const cases = [
        { name: "side", grip: "#side-grip", var: "--side-w", dx: 70, dy: 0 },
        { name: "office", grip: "#office-grip", var: "--office-h", dx: 0, dy: -70 },
      ];

      const results = {};
      for (const item of cases) {
        const before = read(item.var);
        const node = document.querySelector(item.grip);
        drag(node, item.dx, item.dy);
        const after = read(item.var);
        // Dragging back must shrink it again.
        drag(node, -item.dx, -item.dy);
        const back = read(item.var);
        results[item.name] = {
          before: Math.round(before),
          after: Math.round(after),
          back: Math.round(back),
          grew: after > before,
          shrank: back < after,
          ok: after > before && back < after,
        };
      }
      return results;
    })()
  `);
}

async function setTheme(win, theme) {
  return win.webContents.executeJavaScript(`
    (async () => {
      await window.oc.settings.set({ theme: ${JSON.stringify(theme)} });
      return document.documentElement.dataset.theme;
    })()
  `);
}

/**
 * Checks that the project button really opens the folder picker. The native
 * dialog is replaced by a stub in the main process so the test never blocks.
 */
/** Measures how much of the window the chat uses and how the office scales. */
async function measureLayout(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const app = document.getElementById("app");
      const chat = document.getElementById("chat")?.getBoundingClientRect();
      const office = document.getElementById("office-room")?.getBoundingClientRect();
      const canvas = document.querySelector(".office-canvas");
      const scale = window.__office ? window.__office.getScale() : null;
      return {
        window: { w: window.innerWidth, h: window.innerHeight },
        chat: chat ? { w: Math.round(chat.width), h: Math.round(chat.height) } : null,
        chatShare: chat ? Math.round((chat.width * chat.height) / (window.innerWidth * window.innerHeight) * 100) : null,
        officeOpen: !app.classList.contains("office-collapsed"),
        office: office ? { w: Math.round(office.width), h: Math.round(office.height) } : null,
        officeScale: scale ? Math.round(scale * 100) / 100 : null,
        canvas: canvas ? { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) } : null,
        railOpen: !app.classList.contains("rail-closed"),
        sideWidth: Math.round(document.getElementById("side-panel")?.getBoundingClientRect().width || 0),
        firstPerson: Boolean(window.__office?.isFirstPerson?.()),
        fp: window.__office?.getFpState?.() || null,
      };
    })()
  `);
}

async function inspectFilePreview(win) {
  return win.webContents.executeJavaScript(`
    (async () => {
      window.__showPanel?.('files');
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await pause(350);
      const root = document.querySelector('.tree-row[title="src"]');
      root?.click();
      await pause(350);
      const file = document.querySelector('.tree-row[title="src/app.js"]');
      file?.click();
      await pause(500);
      const layout = document.querySelector('.files-layout');
      const input = document.querySelector('.search-row input');
      const preview = document.querySelector('.code-preview');
      return {
        openedRoot: Boolean(root),
        openedFile: Boolean(file),
        language: document.querySelector('.preview-language')?.textContent || null,
        highlightedTokens: preview?.querySelectorAll('span[class^="hljs-"]').length || 0,
        lineNumbers: preview?.querySelectorAll('.code-gutter li').length || 0,
        searchInputWidth: Math.round(input?.getBoundingClientRect().width || 0),
        layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : null,
        layoutRows: layout ? getComputedStyle(layout).gridTemplateRows : null,
      };
    })()
  `);
}

async function checkProjectFlow(win, { pickDirectory }) {
  const { ipcMain } = require('electron');
  ipcMain.removeHandler('oc:project:pick');
  let calls = 0;
  ipcMain.handle('oc:project:pick', async () => {
    calls += 1;
    return pickDirectory || null;
  });

  await win.webContents.executeJavaScript(`
    (() => {
      const button = document.getElementById("project-chip") || document.getElementById("project-button");
      if (button) button.click();
      return true;
    })()
  `);
  await sleep(100);
  await win.webContents.executeJavaScript(`
    (() => {
      const openButton = document.querySelector('.project-menu-open');
      if (openButton) openButton.click();
      return Boolean(openButton);
    })()
  `);
  await sleep(1200);
  return { calls };
}

async function runDiagnostic(win, { app }) {
  const target = path.join(process.env.TEMP || '.', 'oc-ui-check');
  fs.mkdirSync(target, { recursive: true });
  const report = {};

  try {
    await sleep(6000);
    report.layout = await measureLayout(win);
    report.probe = await probe(win);
    report.type = await tryType(win);
    report.tabs = await clickTabs(win);
    report.splitters = await dragSplitters(win);
    report.filePreview = await inspectFilePreview(win);
    await capture(win, target, 'diag-files.png');
    report.projectFlow = await checkProjectFlow(win, { pickDirectory: process.env.OC_DIAG_PICK || null });
    await sleep(800);
    report.projectState = await win.webContents.executeJavaScript(`
      (() => ({
        chip: document.getElementById("project-chip")?.textContent || "",
        sessions: document.querySelectorAll(".session-list li").length,
        toast: [...document.querySelectorAll(".toast-text")].map(n => n.textContent),
      }))()
    `);
    // The office is a split: open it and measure how legible it gets.
    await win.webContents.executeJavaScript(`
      (() => {
        const button = document.querySelector('.activity-button[data-view="office"]');
        if (button) button.click();
        return true;
      })()
    `);
    await sleep(1200);
    report.layoutWithOffice = await measureLayout(win);
    await capture(win, target, 'diag-oficina.png');
    await setTheme(win, 'light');
    await sleep(700);
    await capture(win, target, 'diag-light.png');
    await setTheme(win, 'dark');
    await sleep(400);
    await capture(win, target, 'diag.png');
    report.screenshot = path.join(target, 'diag.png');
  } catch (error) {
    report.error = error.message;
    console.error('[diagnose] error:', error);
  }

  console.log('[diagnose] informe:', JSON.stringify(report, null, 2));
  app.quit();
}

module.exports = { runDiagnostic };
