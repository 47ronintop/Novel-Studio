import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createBootstrappedDefaultDesktopApplication } from "./application-composition.js";
import { createApplicationIpcHandlers } from "./ipc-handlers.js";
import { createApplicationMenuTemplate } from "./menu.js";
import { createDesktopModelRuntime, createEncryptedFileModelSecretStore } from "./model-runtime.js";
import { createSecureWebPreferences } from "./security.js";
import type { DesktopApplication } from "@novel-studio/application";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let activeDesktopApplication: DesktopApplication | undefined;
let shutdownInProgress = false;

export async function registerApplicationIpcHandlers(): Promise<void> {
  const projectRoot =
    process.env["NOVEL_STUDIO_PROJECT_ROOT"] ??
    join(app.getPath("userData"), "projects", "minimal-chapter");
  const userDataRoot = process.env["NOVEL_STUDIO_USER_DATA_ROOT"] ?? app.getPath("userData");
  const modelSecretStore = createEncryptedFileModelSecretStore({
    userDataRoot,
    cipher: safeStorage
  });
  const modelRuntime = createDesktopModelRuntime({
    userDataRoot,
    secretStore: modelSecretStore
  });
  activeDesktopApplication = await createBootstrappedDefaultDesktopApplication({
    projectRoot,
    userDataRoot,
    modelConnectionTester: modelRuntime.modelConnectionTester,
    modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
    createAiProvider: modelRuntime.createAiProvider
  });
  const handlers = createApplicationIpcHandlers(activeDesktopApplication, {
    chooseOpenProjectDirectory: () => chooseProjectDirectory("Open Novel Studio project"),
    chooseCreateProjectDirectory: () => chooseProjectDirectory("Create Novel Studio project"),
    modelSecretStore
  });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: readonly unknown[]) => handler(...args));
  }
}

export async function shutdownDesktopApplication(): Promise<void> {
  const application = activeDesktopApplication;
  activeDesktopApplication = undefined;
  if (application !== undefined) {
    await application.shutdown();
  }
}

async function chooseProjectDirectory(title: string): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openDirectory", "createDirectory"]
  });

  return result.canceled ? undefined : result.filePaths[0];
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = join(currentDirectory, "..", "preload", "index.cjs");
  const rendererPath = join(currentDirectory, "..", "renderer", "index.html");

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 720,
    minHeight: 640,
    title: "Novel Studio",
    webPreferences: createSecureWebPreferences(preloadPath)
  });

  void window.loadFile(rendererPath);

  return window;
}

export function setApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate()));
}

if (process.env["VITEST"] !== "true") {
  void app.whenReady().then(async () => {
    await registerApplicationIpcHandlers();
    setApplicationMenu();
    createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    if (shutdownInProgress || activeDesktopApplication === undefined) {
      return;
    }

    event.preventDefault();
    shutdownInProgress = true;
    void shutdownDesktopApplication().finally(() => {
      app.quit();
    });
  });
}
