import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDefaultDesktopApplication } from "./application-composition.js";
import { createApplicationIpcHandlers } from "./ipc-handlers.js";
import { createSecureWebPreferences } from "./security.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

export function registerApplicationIpcHandlers(): void {
  const handlers = createApplicationIpcHandlers(createDefaultDesktopApplication());

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: readonly unknown[]) => handler(...args));
  }
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  const rendererPath = join(currentDirectory, "..", "renderer", "index.html");

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: "Novel Studio",
    webPreferences: createSecureWebPreferences(preloadPath)
  });

  void window.loadFile(rendererPath);

  return window;
}

if (process.env["VITEST"] !== "true") {
  registerApplicationIpcHandlers();

  void app.whenReady().then(() => {
    createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
