import path from "node:path";
import { app, BrowserWindow, session } from "electron";
import { IPC_CHANNELS } from "@maestro/contracts";
import { ApplicationService } from "./services/application.js";
import { registerIpc } from "./ipc.js";

let mainWindow: BrowserWindow | null = null;
let application: ApplicationService | null = null;
let unregisterIpc: (() => void) | null = null;
let disposing = false;

app.setName("Maestro");

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#0b0d12",
    title: "Maestro",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  });
  window.on("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  return window;
}

async function loadWindow(window: BrowserWindow): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"));
  }
}

async function dispose(): Promise<void> {
  if (disposing) return;
  disposing = true;
  unregisterIpc?.();
  unregisterIpc = null;
  await application?.dispose();
  application = null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId("dev.maestro.desktop");
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      mainWindow = createWindow();
      application = new ApplicationService();
      application.setEventHandlers({
        run: (event) => mainWindow?.webContents.send(IPC_CHANNELS.eventRun, event),
        terminal: (event) => mainWindow?.webContents.send(IPC_CHANNELS.eventTerminal, event),
        update: (state) => mainWindow?.webContents.send(IPC_CHANNELS.eventUpdate, state),
      });
      unregisterIpc = registerIpc(application, mainWindow);
      await application.initialize();
      await loadWindow(mainWindow);

      app.on("activate", () => mainWindow?.show());
    })
    .catch((error: unknown) => {
      console.error("Failed to start Maestro", error);
      app.quit();
    });

  app.on("before-quit", (event) => {
    if (!disposing) {
      event.preventDefault();
      void dispose().finally(() => app.quit());
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
