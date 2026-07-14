import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { APPLICATION_IPC_CHANNELS, isApplicationIpcChannel } from "@novel-studio/application";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers";
import { createSecureWebPreferences } from "../src/main/security";
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
      "application:execute-command",
      "application:project:choose-open-directory",
      "application:project:choose-create-directory",
      "application:project:open",
      "application:project:read-directory",
      "application:file:read-text",
      "application:file:write-text",
      "application:project:create",
      "application:project:list-chapters",
      "application:project:create-chapter",
      "application:project:rename-chapter",
      "application:project:duplicate-chapter",
      "application:project:delete-chapter",
      "application:project:select-chapter",
      "application:project:preview-recovery-draft",
      "application:project:apply-recovery-draft",
      "application:project:discard-recovery-draft",
      "application:search:rebuild-index",
      "application:search:query",
      "application:ai:generate-chapter-suggestion",
      "application:ai:start-chapter-suggestion-stream",
      "application:ai:next-chapter-suggestion-stream",
      "application:ai:cancel-chapter-suggestion-stream",
      "application:ai:start-chapter-suggestion-push-stream",
      "application:ai:cancel-chapter-suggestion-push-stream",
      "application:ai:generate-selection-preview",
      "application:ai:apply-selection-preview",
      "application:ai:apply-chapter-suggestion",
      "application:ai:list-workflow-runs",
      "application:ai:read-workflow-run",
      "application:agent-run:start",
      "application:agent-run:stop",
      "application:agent-run:answer-user-input",
      "application:agent-run:resume",
      "application:agent-run:retry-step",
      "application:agent-run:decide-plan",
      "application:agent-run:refresh-context",
      "application:agent-run:decide-change-set",
      "application:agent-run:undo",
      "application:agent-run:read",
      "application:agent-run:list",
      "application:agent-conversation:create",
      "application:agent-conversation:list",
      "application:agent-conversation:read",
      "application:agent-conversation:archive",
      "application:agent-conversation:restore",
      "application:agent-conversation:search",
      "application:chapter:load",
      "application:chapter:edit",
      "application:chapter:save",
      "application:chapter:list-versions",
      "application:chapter:preview-version",
      "application:chapter:restore-version",
      "application:chapter:preview-suggestion-diff",
      "application:settings:list-model-profiles",
      "application:settings:discover-models",
      "application:settings:save-model-profile",
      "application:settings:save-model-secret",
      "application:settings:test-model-profile",
      "application:plugins:load-registry",
      "application:plugins:set-enabled",
      "application:story-bible:load",
      "application:story-bible:save-asset",
      "application:story-bible:save-memory",
      "application:story-bible:build-consistency-report",
      "application:story-bible:build-context-candidates",
      "application:studio:load-config-asset",
      "application:studio:save-config-asset",
      "application:studio:restore-config-version",
      "application:preferences:load",
      "application:preferences:save"
    ]);
    expect(isApplicationIpcChannel("application:list-commands")).toBe(true);
    expect(isApplicationIpcChannel("application:project:preview-recovery-draft")).toBe(true);
    expect(isApplicationIpcChannel("application:chapter:save")).toBe(true);
    expect(isApplicationIpcChannel("application:agent-run:decide-change-set")).toBe(true);
    expect(isApplicationIpcChannel("application:agent-run:undo")).toBe(true);
    expect(isApplicationIpcChannel("application:agent-conversation:search")).toBe(true);
    expect(isApplicationIpcChannel("application:settings:list-model-profiles")).toBe(true);
    expect(isApplicationIpcChannel("application:settings:discover-models")).toBe(true);
    expect(isApplicationIpcChannel("application:story-bible:load")).toBe(true);
    expect(isApplicationIpcChannel("application:studio:save-config-asset")).toBe(true);
    expect(isApplicationIpcChannel("application:preferences:load")).toBe(true);
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
    await api.project.chooseOpenDirectory();
    await api.project.chooseCreateDirectory();
    await api.project.renameChapter({ chapterId: "ch_opening", title: "Opening" });
    await api.project.duplicateChapter({
      sourceChapterId: "ch_opening",
      chapterId: "ch_opening_copy",
      title: "Opening Copy"
    });
    await api.project.deleteChapter({ chapterId: "ch_opening" });
    await api.project.previewRecoveryDraft("session_recovery");
    await api.project.applyRecoveryDraft("session_recovery");
    await api.project.discardRecoveryDraft("session_recovery");
    await api.chapter.load();
    await api.ai.generateChapterSuggestion({ instruction: "Continue." });
    await api.ai.startChapterSuggestionStream({
      streamId: "stream_security_01",
      instruction: "Continue."
    });
    await api.ai.cancelChapterSuggestionStream("stream_security_01");
    await api.ai.generateSelectionPreview({
      instruction: "Rewrite selection.",
      selection: {
        startOffset: 0,
        endOffset: 5,
        selectedText: "Hello"
      }
    });
    await api.ai.applySelectionPreview("sug_selection_01");
    await api.ai.applyChapterSuggestion("sug_01");
    await api.ai.listWorkflowRuns();
    await api.ai.readWorkflowRun("run_01");
    await api.chapter.edit("updated chapter body");
    await api.chapter.save();
    await api.chapter.listVersions();
    await api.chapter.previewVersion("ver_01");
    await api.chapter.restoreVersion("ver_01");
    await api.chapter.previewSuggestionDiff("AI suggestion body");
    await api.settings.listModelProfiles();
    await api.settings.discoverModelOptions("model_default");
    await api.settings.saveModelProfile({
      id: "model_default",
      provider: "openai-compatible",
      displayName: "Default Model",
      apiKeyRef: "secret://model_default/api_key",
      modelName: "example-model",
      temperature: 0.7,
      maxTokens: 4096,
      timeoutMs: 60000
    });
    await api.settings.testModelProfileConnection("model_default");
    await api.plugins.loadRegistry();
    await api.plugins.setEnabled("novel.timeline-tools", false);
    await api.storyBible.load();
    await api.storyBible.saveAsset({
      schemaVersion: "1.0",
      id: "chr_hero",
      type: "character",
      title: "Hero",
      status: "active",
      summary: "Hero summary.",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    });
    await api.storyBible.saveMemory({
      schemaVersion: "1.0",
      id: "mem_oath",
      type: "memory.long-term",
      title: "Oath",
      status: "active",
      origin: "user",
      confidence: "confirmed",
      content: "The oath stays hidden.",
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T00:00:00.000Z"
    });
    await api.storyBible.buildContextCandidates({ includeStatuses: ["active"] });
    await api.studio.loadConfigAsset("workflow", "wf_review_chapter");
    await api.studio.saveConfigAsset({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      content: { schemaVersion: "1.0" }
    });
    await api.studio.restoreConfigAssetVersion({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      versionId: "ver_01"
    });
    await api.preferences.load();
    await api.preferences.save({
      onboarding: { dismissed: true }
    });

    expect(invokedChannels.every(isApplicationIpcChannel)).toBe(true);
    expect(invokedChannels).toEqual([
      "application:get-shell-state",
      "application:list-commands",
      "application:execute-command",
      "application:project:choose-open-directory",
      "application:project:choose-create-directory",
      "application:project:rename-chapter",
      "application:project:duplicate-chapter",
      "application:project:delete-chapter",
      "application:project:preview-recovery-draft",
      "application:project:apply-recovery-draft",
      "application:project:discard-recovery-draft",
      "application:chapter:load",
      "application:ai:generate-chapter-suggestion",
      "application:ai:start-chapter-suggestion-push-stream",
      "application:ai:cancel-chapter-suggestion-push-stream",
      "application:ai:generate-selection-preview",
      "application:ai:apply-selection-preview",
      "application:ai:apply-chapter-suggestion",
      "application:ai:list-workflow-runs",
      "application:ai:read-workflow-run",
      "application:chapter:edit",
      "application:chapter:save",
      "application:chapter:list-versions",
      "application:chapter:preview-version",
      "application:chapter:restore-version",
      "application:chapter:preview-suggestion-diff",
      "application:settings:list-model-profiles",
      "application:settings:discover-models",
      "application:settings:save-model-profile",
      "application:settings:test-model-profile",
      "application:plugins:load-registry",
      "application:plugins:set-enabled",
      "application:story-bible:load",
      "application:story-bible:save-asset",
      "application:story-bible:save-memory",
      "application:story-bible:build-context-candidates",
      "application:studio:load-config-asset",
      "application:studio:save-config-asset",
      "application:studio:restore-config-version",
      "application:preferences:load",
      "application:preferences:save"
    ]);
  });

  test("main process binds every allowlisted IPC channel to Application handlers", async () => {
    const handlers = createApplicationIpcHandlers();

    expect(Object.keys(handlers)).toEqual(APPLICATION_IPC_CHANNELS);
    await expect(handlers["application:get-shell-state"]()).resolves.toMatchObject({
      projectTitle: "未打开项目"
    });
    await expect(handlers["application:list-commands"]()).resolves.toHaveLength(10);
    await expect(
      handlers["application:execute-command"]("workspace.toggle-inspector")
    ).resolves.toMatchObject({
      ok: true
    });
    await expect(
      handlers["application:execute-command"]("workspace.toggle-split-view")
    ).resolves.toMatchObject({
      ok: true,
      value: {
        workspaceLayout: {
          splitView: true
        }
      }
    });
    await expect(handlers["application:chapter:load"]()).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAPTER_EDITOR_UNAVAILABLE" }
    });
    await expect(handlers["application:settings:list-model-profiles"]()).resolves.toMatchObject({
      ok: false,
      error: { code: "MODEL_SETTINGS_UNAVAILABLE" }
    });
    await expect(
      handlers["application:settings:discover-models"]("model_default")
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MODEL_SETTINGS_UNAVAILABLE" }
    });
    await expect(handlers["application:plugins:load-registry"]()).resolves.toMatchObject({
      ok: false,
      error: { code: "PLUGIN_REGISTRY_UNAVAILABLE" }
    });
    await expect(
      handlers["application:plugins:set-enabled"]("novel.timeline-tools", false)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PLUGIN_REGISTRY_UNAVAILABLE" }
    });
    await expect(handlers["application:story-bible:load"]()).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_UNAVAILABLE" }
    });
    await expect(
      handlers["application:studio:load-config-asset"]("prompt", "prompt_01")
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CONFIG_STUDIO_UNAVAILABLE" }
    });
    await expect(handlers["application:preferences:load"]()).resolves.toMatchObject({
      ok: false,
      error: { code: "USER_PREFERENCES_UNAVAILABLE" }
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
