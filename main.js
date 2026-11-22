'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const workspaceFile = require('./electron/workspace-file');
const { SettingsStore } = require('./electron/settings-store');
const { Backend } = require('./electron/backend');
const { registerIpc } = require('./electron/ipc');

const DEMO_FLAG = process.argv.includes('--demo');
const UI_CHECK = process.argv.includes('--ui-check');
const DIAGNOSE = process.argv.includes('--diagnose');
const VERBOSE = process.argv.includes('--verbose') || process.env.OC_DEBUG === '1' || UI_CHECK || DIAGNOSE;
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 650;

let mainWindow = null;
let settings = null;
let backend = null;
// Workspace pedido al arrancar con un archivo .hl (doble clic); el renderer lo recoge al estar listo.
let pendingWorkspace = workspaceFile.workspaceFromArgv(process.argv)?.dir || null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'HLab Interactive',
    backgroundColor: '#0f1115',
    // Barra 100% propia: los controles los dibuja la UI, así no se superponen
    // a los botones de la aplicación ni dependen del escalado de Windows.
    titleBarStyle: 'hidden',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  const notifyMaximized = () => {
    if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('oc:window:maximized', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', notifyMaximized);
  mainWindow.on('unmaximize', notifyMaximized);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (VERBOSE) {
    mainWindow.webContents.on('console-message', (...args) => {
      const detail = args.length === 1
        ? args[0]
        : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
      console.log(`[renderer:${detail.level}] ${detail.message} (${detail.sourceId || ''}:${detail.lineNumber || ''})`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[main] did-fail-load ${code} ${description} ${url}`);
    });
    mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      console.error(`[main] preload-error ${preloadPath}:`, error);
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[main] render-process-gone:', details);
    });
  }

  // Hardening: no navigation, no new windows, no webviews.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        shell.openExternal(parsed.toString());
      }
    } catch { /* enlace no válido: se ignora */ }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir proyecto…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('oc:menu', 'project:open'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Documentación de opencode',
          click: () => shell.openExternal('https://opencode.ai/docs'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // otro doble clic en un .hl con la app ya abierta: abre ese workspace
    const opened = workspaceFile.workspaceFromArgv(argv);
    if (opened) mainWindow.webContents.send('oc:menu', `workspace:${opened.dir}`);
  });

  // Controles de ventana propios (la barra de título del SO está desactivada).
  ipcMain.handle('oc:window:minimize', () => { mainWindow?.minimize(); });
  ipcMain.handle('oc:window:toggle-maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('oc:window:close', () => mainWindow?.close());
  ipcMain.handle('oc:window:is-maximized', () => Boolean(mainWindow?.isMaximized()));

  ipcMain.handle('oc:workspace:pending', () => {
    const dir = pendingWorkspace;
    pendingWorkspace = null;
    return dir;
  });
  ipcMain.handle('oc:workspace:create-file', (_event, directory) => workspaceFile.createWorkspaceFile(String(directory || '')));
  ipcMain.handle('oc:workspace:register', () => workspaceFile.registerFileType(mainWindow));
  ipcMain.handle('oc:workspace:unregister', () => workspaceFile.unregisterFileType(mainWindow));

  app.whenReady().then(async () => {
    settings = new SettingsStore(app.getPath('userData'));
    backend = new Backend(settings);

    registerIpc({ backend, settings, getWindow: () => mainWindow, uiCheck: UI_CHECK });
    buildMenu();
    createWindow();

    // Wait for renderer to signal it's ready before enabling demo
    if (DEMO_FLAG) {
      await backend.waitForRendererReady();
      // Small delay to ensure renderer's event loop is ready
      await new Promise(r => setTimeout(r, 100));
      backend.enableDemo();
    } else {
      await backend.init();
    }

    if (UI_CHECK) {
      const { runUiCheck } = require('./electron/ui-check');
      runUiCheck(mainWindow, { app }).catch((error) => {
        console.error('[main] ui-check falló:', error);
        app.quit();
      });
    }

    if (DIAGNOSE) {
      const { runDiagnostic } = require('./electron/diagnose');
      runDiagnostic(mainWindow, { app }).catch((error) => {
        console.error('[main] diagnose falló:', error);
        app.quit();
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    const terminal = require('./electron/terminal');
    try { terminal.killAll(); } catch { /* ignore */ }
    try { backend?.dispose(); } catch { /* ignore */ }
    try { settings?.flush(); } catch { /* ignore */ }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[main] unhandledRejection:', reason);
    mainWindow?.webContents.send('oc:toast', {
      type: 'error',
      message: `Error interno: ${reason instanceof Error ? reason.message : String(reason)}`,
    });
  });
}
