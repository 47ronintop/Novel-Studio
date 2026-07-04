import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { APPLICATION_IPC_CHANNELS, isApplicationIpcChannel } from "@novel-studio/application";
import { createSecureWebPreferences } from "../src/main/security";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers";
import { createNovelStudioApi } from "../src/preload/api";

const rendererRoot = join(process.cwd(), "apps", "desktop", "src", "renderer");

function readRendererFiles(): string[] {
  if (!existsSync(rendererRoot)) {
    return [];
  }

  return ["App.tsx", "index.tsx"]
    .map((fileName) => join(rendererRoot, fileName))
    .filter((filePath) => existsSync(filePath))
    .map((filePath) => readFileSync(filePath, "utf8"));
}

describe("Electron security baseline", () => {
  test("creates BrowserWindow preferences with renderer Node access disabled", () => {
    const preferences = createSecureWebPreferences("preload.js");

    expect(preferences).toMatchObject({
      preload: "preload.js",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    });
  });

  test("keeps IPC channels restricted to Application Layer commands", () => {
    expect(APPLICATION_IPC_CHANNELS).toEqual([
      "application:get-shell-state",
      "application:list-commands",
      "application:execute-command"
    ]);
    expect(isApplicationIpcChannel("application:list-commands")).toBe(true);
    expect(isApplicationIpcChannel("fs:read-file")).toBe(false);
    expect(isApplicationIpcChannel("shell:open-path")).toBe(false);
  });

  test("preload API invokes only allowlisted Application channels", async () => {
    const invokedChannels: string[] = [];
    const api = createNovelStudioApi({
      invoke: (channel: string) => {
        invokedChannels.push(channel);
        return Promise.resolve(undefined);
      }
    });

    await api.getShellState();
    await api.commands.list();
    await api.commands.execute("workspace.toggle-navigator");

    expect(invokedChannels.every(isApplicationIpcChannel)).toBe(true);
    expect(invokedChannels).toEqual([
      "application:get-shell-state",
      "application:list-commands",
      "application:execute-command"
    ]);
  });

  test("main process binds every allowlisted IPC channel to Application handlers", async () => {
    const handlers = createApplicationIpcHandlers();

    expect(Object.keys(handlers)).toEqual(APPLICATION_IPC_CHANNELS);
    await expect(handlers["application:get-shell-state"]()).resolves.toMatchObject({
      projectTitle: "No project open"
    });
    await expect(handlers["application:list-commands"]()).resolves.toHaveLength(4);
    await expect(
      handlers["application:execute-command"]("workspace.toggle-inspector")
    ).resolves.toMatchObject({
      ok: true
    });
  });

  test("renderer source does not import Node filesystem modules", () => {
    const rendererSources = readRendererFiles();

    expect(rendererSources.length).toBeGreaterThan(0);
    expect(rendererSources.join("\n")).not.toMatch(/from\s+["'](?:node:)?fs(?:\/promises)?["']/);
    expect(rendererSources.join("\n")).not.toMatch(
      /require\(["'](?:node:)?fs(?:\/promises)?["']\)/
    );
  });
});
