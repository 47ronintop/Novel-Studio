import { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage } from "electron";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBootstrappedDefaultDesktopApplicationWithSnapshot,
  createProjectLockOwnerId,
  DEFAULT_FIXTURE_CHAPTER_ID
} from "./application-composition.js";
import { createDesktopAgentRuntime } from "./agent-run-runtime.js";
import { createDesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import type { DesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import { createAgentWriteSaveCoordinator, createApplicationIpcHandlers } from "./ipc-handlers.js";
import { createApplicationMenuTemplate } from "./menu.js";
import { createDesktopModelRuntime, createEncryptedFileModelSecretStore } from "./model-runtime.js";
import { createSecureWebPreferences } from "./security.js";
import { reasoningStrengthForModel } from "@novel-studio/application";
import type { DesktopApplication } from "@novel-studio/application";
import type { LlmModelProfile, LlmProviderId } from "@novel-studio/llm-adapter";
import { createUnifiedError } from "@novel-studio/shared";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
let activeDesktopApplication: DesktopApplication | undefined;
let activeAgentRuntimeManager: DesktopAgentRuntimeManager | undefined;
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
  const projectLockOwnerId = createProjectLockOwnerId();
  const agentWriteSaveCoordinator = createAgentWriteSaveCoordinator();
  const bootstrapped = await createBootstrappedDefaultDesktopApplicationWithSnapshot({
    projectRoot,
    userDataRoot,
    projectLockOwnerId,
    modelConnectionTester: modelRuntime.modelConnectionTester,
    modelDiscoveryPort: modelRuntime.modelDiscoveryPort,
    createAiProvider: modelRuntime.createAiProvider
  });
  activeDesktopApplication = bootstrapped.application;
  const failAgentWriteAt = readPositiveInteger(
    process.env["NOVEL_STUDIO_TEST_AGENT_WRITE_FAIL_AT"]
  );
  const agentRuntimeManager = createDesktopAgentRuntimeManager({
    createRuntime: (binding) =>
      createDesktopAgentRuntime({
        projectRoot: binding.projectRoot,
        projectId: binding.projectId,
        activeChapterId: binding.activeChapterId,
        projectLockOwnerId,
        pauseAutosave: agentWriteSaveCoordinator.pauseAutosave,
        resumeAutosave: agentWriteSaveCoordinator.resumeAutosave,
        ...(failAgentWriteAt === undefined ? {} : { failAgentWriteAt }),
        createAgentModelDriver: modelRuntime.createAgentModelDriver,
        readEditorBuffer: async (refId) => {
          const chapterId = refId.startsWith("chapter:")
            ? refId.slice("chapter:".length)
            : undefined;
          if (chapterId === undefined || activeDesktopApplication === undefined) return undefined;
          const activeChapter = await activeDesktopApplication.readActiveChapterState();
          return activeChapter.ok && activeChapter.value.state.chapter.frontmatter.id === chapterId
            ? activeChapter.value.state.chapter.body
            : undefined;
        },
        readEditorState: async (relativePath) => {
          const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
          if (match?.[1] === undefined || activeDesktopApplication === undefined) return undefined;
          const activeChapter = await activeDesktopApplication.readActiveChapterState();
          if (!activeChapter.ok || activeChapter.value.state.chapter.frontmatter.id !== match[1]) {
            return undefined;
          }
          return {
            dirty: activeChapter.value.state.dirty,
            content: activeChapter.value.state.chapter.body
          };
        },
        syncSavedEditor: async (relativePath, options) => {
          await syncSavedEditorForPath(activeDesktopApplication, relativePath, options);
        },
        resolveModelProfile: async (profileId) => {
          const profiles = await activeDesktopApplication?.listModelProfiles();
          if (profiles === undefined || !profiles.ok) return undefined;
          const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
          if (profile === undefined) return undefined;
          const modelProfile: LlmModelProfile = {
            id: profile.id,
            provider: profile.provider as LlmProviderId,
            displayName: profile.displayName,
            modelName: profile.modelName,
            ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
            ...(profile.apiKeyRef.length === 0 ? {} : { apiKeyRef: profile.apiKeyRef }),
            timeoutMs: profile.timeoutMs
          };
          return {
            modelProfile,
            parameters: {
              temperature: profile.temperature,
              maxTokens: profile.maxTokens,
              ...(profile.topP === undefined ? {} : { topP: profile.topP })
            }
          };
        },
        resolveModelStartFacts: async (profileId) => {
          // Server-authoritative model facts: provider/model come from the stored profile, context
          // window + reasoning strength from discovery. The renderer never authors these.
          const profiles = await activeDesktopApplication?.listModelProfiles();
          if (profiles === undefined || !profiles.ok) return undefined;
          const profile = profiles.value.profiles.find((entry) => entry.id === profileId);
          if (profile === undefined) return undefined;
          const discovery = await activeDesktopApplication?.discoverModelOptions(profileId);
          const discovered =
            discovery !== undefined && discovery.ok
              ? discovery.value.models.find((model) => model.id === profile.modelName)
              : undefined;
          const contextWindow =
            discovered?.contextWindow ?? (profile.provider === "demo" ? 128_000 : 0);
          const reasoningStrength =
            discovery !== undefined && discovery.ok
              ? discovery.value.reasoningStrength
              : reasoningStrengthForModel(
                  profile.provider,
                  profile.modelName,
                  profile.baseUrl,
                  profile.reasoningEffortEnabled
                );
          return {
            profileId: profile.id,
            provider: profile.provider,
            modelName: profile.modelName,
            capabilities: {
              streaming: true,
              toolCalling: true,
              structuredArguments: true,
              contextWindow
            },
            requiredContextTokens: 8_000,
            reasoningStrength
          };
        }
      })
  });
  const initialBinding = await agentRuntimeManager.bindProject({
    projectId: bootstrapped.workspace.project.projectId,
    projectRoot: bootstrapped.workspace.projectRoot,
    activeChapterId:
      bootstrapped.workspace.activeChapterId ??
      bootstrapped.workspace.chapters[0]?.id ??
      DEFAULT_FIXTURE_CHAPTER_ID
  });
  if (!initialBinding.ok) {
    agentRuntimeManager.dispose();
    await activeDesktopApplication.shutdown();
    activeDesktopApplication = undefined;
    throw new Error(initialBinding.error.message);
  }
  activeAgentRuntimeManager = agentRuntimeManager;
  const handlers = createApplicationIpcHandlers(activeDesktopApplication, {
    chooseOpenProjectDirectory: () => chooseProjectDirectory("Open Novel Studio project"),
    chooseCreateProjectDirectory: () => chooseProjectDirectory("Create Novel Studio project"),
    modelSecretStore,
    publishAiSuggestionStreamEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:ai:chapter-suggestion-push-event", event);
        }
      }
    },
    agentRuntimeManager,
    agentWriteSaveCoordinator,
    publishAgentRunEvent: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("application:agent-run:event", event);
        }
      }
    }
  });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: readonly unknown[]) => handler(...args));
  }
}

function readPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export async function syncSavedEditorForPath(
  application: Pick<DesktopApplication, "readActiveChapterState" | "loadActiveChapter"> | undefined,
  relativePath: string,
  options: { readonly expectedDirtyChecksum?: string } = {}
): Promise<void> {
  const match = /^chapters\/([A-Za-z0-9_-]+)\.md$/.exec(relativePath);
  if (application === undefined || match?.[1] === undefined) return;

  const activeChapter = await application.readActiveChapterState();
  if (activeChapter.ok && activeChapter.value.state.chapter.frontmatter.id === match[1]) {
    if (activeChapter.value.state.dirty) {
      if (options.expectedDirtyChecksum === undefined) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_DIRTY",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
      const actualDirtyChecksum = createHash("sha256")
        .update(activeChapter.value.state.chapter.body, "utf8")
        .digest("hex");
      if (actualDirtyChecksum !== options.expectedDirtyChecksum) {
        throw createUnifiedError({
          code: "AGENT_WRITE_EDITOR_SYNC_STALE",
          category: "UserError",
          message: "The active editor changed while Agent changes were being applied.",
          recoverability: "user-action",
          suggestedAction: "Review the preserved editor buffer and transaction recovery status.",
          traceId: "desktop-agent-editor-sync"
        });
      }
    }
    await application.loadActiveChapter();
  }
}

export async function shutdownDesktopApplication(): Promise<void> {
  activeAgentRuntimeManager?.dispose();
  activeAgentRuntimeManager = undefined;
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
