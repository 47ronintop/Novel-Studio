import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createBootstrappedDefaultDesktopApplication } from "./application-composition.js";
import { createApplicationIpcHandlers } from "./ipc-handlers.js";
import { createSecureWebPreferences } from "./security.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

export async function registerApplicationIpcHandlers(): Promise<void> {
  const projectRoot =
    process.env["NOVEL_STUDIO_PROJECT_ROOT"] ??
    join(app.getPath("userData"), "projects", "minimal-chapter");
  const handlers = createApplicationIpcHandlers(
    await createBootstrappedDefaultDesktopApplication({ projectRoot })
  );

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
  void app.whenReady().then(async () => {
    await registerApplicationIpcHandlers();
    createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
