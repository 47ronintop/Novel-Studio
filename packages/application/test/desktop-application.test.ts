import { describe, expect, test } from "vitest";

import { isErr, isOk, ok } from "@novel-studio/shared";
import type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterHistoryRepositoryPort
} from "@novel-studio/shared";

import { createChapterEditorSession } from "../src/chapter-editor-session.js";
import { createDesktopApplication } from "../src/desktop-application.js";
import { DEFAULT_APPLICATION_COMMANDS, isSafeCommand } from "../src/command-registry.js";
import { createPluginRuntimeSession } from "../src/plugin-runtime-session.js";

interface PluginSettingsSnapshot {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginSettingsEntry[];
}

interface PluginSettingsEntry {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly grantedPermissions: readonly {
    readonly permission: string;
    readonly scopes: readonly string[];
  }[];
  readonly manifestStatus: "valid" | "missing" | "invalid";
  readonly manifest?: {
    readonly displayName: string;
    readonly version: string;
    readonly entryKind: "local-process" | "webview" | "none";
    readonly compatibleAppVersion: {
      readonly min: string;
      readonly max?: string;
    };
    readonly capabilities: readonly {
      readonly type: "command" | "workflow-step" | "asset-view";
      readonly id: string;
      readonly title: string;
    }[];
    readonly requestedPermissions: readonly {
      readonly permission: string;
      readonly scopes: readonly string[];
    }[];
    readonly contributes: {
      readonly commands: readonly {
        readonly id: string;
        readonly title: string;
      }[];
      readonly workflowSteps: readonly {
        readonly id: string;
        readonly title: string;
      }[];
    };
  };
}

const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const chapter = {
  frontmatter: {
    schemaVersion: "1.0",
    id: chapterId,
    type: "chapter",
    title: "第一章",
    order: 1,
    status: "draft",
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "原始章节正文。\n"
} satisfies ChapterDocument;

describe("desktop application command bridge", () => {
  test("exposes a shell state DTO for the desktop workspace", () => {
    const application = createDesktopApplication();

    expect(application.getShellState()).toMatchObject({
      projectTitle: "未打开项目",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: true,
      bottomPanelVisible: false,
      activeBottomPanelTab: "工作流运行",
      focusMode: false,
      workspaceLayout: {
        splitView: false,
        navigatorWidth: 260,
        inspectorWidth: 320,
        bottomPanelHeight: 180
      },
      saveStatus: "Saved"
    });
  });

  test("registers only safe M4 commands with risk levels", () => {
    expect(DEFAULT_APPLICATION_COMMANDS).toEqual([
      {
        id: "workspace.open-command-palette",
        title: "打开命令面板",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+K"
      },
      {
        id: "workspace.toggle-navigator",
        title: "切换项目导航",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+B"
      },
      {
        id: "workspace.toggle-inspector",
        title: "切换检查器",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Shift+I"
      },
      {
        id: "workspace.toggle-bottom-panel",
        title: "切换底部面板",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+J"
      },
      {
        id: "workspace.toggle-split-view",
        title: "切换拆分视图",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+\\"
      },
      {
        id: "workspace.toggle-focus-mode",
        title: "切换专注模式",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Shift+F"
      },
      {
        id: "workspace.narrow-navigator",
        title: "收窄项目导航",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Alt+["
      },
      {
        id: "workspace.widen-navigator",
        title: "加宽项目导航",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Alt+]"
      },
      {
        id: "workspace.narrow-inspector",
        title: "收窄检查器",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Alt+Shift+["
      },
      {
        id: "workspace.widen-inspector",
        title: "加宽检查器",
        scope: "workspace",
        riskLevel: "safe",
        defaultShortcut: "Ctrl/Cmd+Alt+Shift+]"
      }
    ]);
    expect(DEFAULT_APPLICATION_COMMANDS.every(isSafeCommand)).toBe(true);
  });

  test("executes safe workspace commands without filesystem access", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("workspace.toggle-navigator");

    expect(result.ok).toBe(true);
    expect(application.getShellState().navigatorCollapsed).toBe(true);
  });

  test("toggles focus mode as a safe workspace command", () => {
    const application = createDesktopApplication();

    const enabled = application.executeCommand("workspace.toggle-focus-mode");
    const disabled = application.executeCommand("workspace.toggle-focus-mode");

    expect(enabled.ok).toBe(true);
    expect(disabled.ok).toBe(true);
    expect(enabled).toMatchObject({
      ok: true,
      value: {
        focusMode: true
      }
    });
    expect(application.getShellState().focusMode).toBe(false);
  });

  test("toggles bottom panel visibility without changing the active bottom tab", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("workspace.toggle-bottom-panel");

    expect(result.ok).toBe(true);
    expect(application.getShellState()).toMatchObject({
      bottomPanelVisible: true,
      activeBottomPanelTab: "工作流运行"
    });
  });

  test("executes safe workspace layout commands without filesystem access", () => {
    const application = createDesktopApplication();

    const split = application.executeCommand("workspace.toggle-split-view");
    const widerNavigator = application.executeCommand("workspace.widen-navigator");
    const narrowInspector = application.executeCommand("workspace.narrow-inspector");

    expect(split.ok).toBe(true);
    expect(widerNavigator.ok).toBe(true);
    expect(narrowInspector.ok).toBe(true);
    expect(application.getShellState().workspaceLayout).toEqual({
      splitView: true,
      navigatorWidth: 300,
      inspectorWidth: 280,
      bottomPanelHeight: 180
    });
  });

  test("loads project plugin registry summaries through an injected Application session", async () => {
    const pluginRegistry: PluginSettingsSnapshot = {
      schemaVersion: "1.0",
      plugins: [
        {
          pluginId: "novel.timeline-tools",
          enabled: true,
          manifestPath: "plugins/novel.timeline-tools/plugin.json",
          grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
          manifestStatus: "valid",
          manifest: {
            displayName: "Timeline Tools",
            version: "1.2.3",
            entryKind: "none",
            compatibleAppVersion: { min: "0.1.0", max: "0.2.0" },
            capabilities: [{ type: "asset-view", id: "timeline.rail", title: "Timeline Rail" }],
            requestedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
            contributes: {
              commands: [{ id: "timeline.open-map", title: "Open timeline map" }],
              workflowSteps: []
            }
          }
        }
      ]
    };
    const application = createDesktopApplication({
      pluginSettingsSession: {
        load: async () => ok(pluginRegistry),
        setEnabled: async () => ok(pluginRegistry)
      }
    } as Parameters<typeof createDesktopApplication>[0] & {
      readonly pluginSettingsSession: {
        load(): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
        setEnabled(): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
      };
    });
    const pluginAwareApplication = application as typeof application & {
      loadPluginRegistry(): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
    };

    const loaded = await pluginAwareApplication.loadPluginRegistry();

    expect(loaded).toEqual(ok(pluginRegistry));
  });

  test("delegates project plugin enabled changes through an injected Application session", async () => {
    const calls: string[] = [];
    const disabledRegistry: PluginSettingsSnapshot = {
      schemaVersion: "1.0",
      plugins: [
        {
          pluginId: "novel.timeline-tools",
          enabled: false,
          manifestPath: "plugins/novel.timeline-tools/plugin.json",
          grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
          manifestStatus: "valid"
        }
      ]
    };
    const application = createDesktopApplication({
      pluginSettingsSession: {
        load: async () => ok(disabledRegistry),
        setEnabled: async (pluginId: string, enabled: boolean) => {
          calls.push(`${pluginId}:${enabled}`);
          return ok(disabledRegistry);
        }
      }
    } as Parameters<typeof createDesktopApplication>[0] & {
      readonly pluginSettingsSession: {
        load(): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
        setEnabled(
          pluginId: string,
          enabled: boolean
        ): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
      };
    });
    const pluginAwareApplication = application as typeof application & {
      setPluginEnabled(
        pluginId: string,
        enabled: boolean
      ): Promise<ReturnType<typeof ok<PluginSettingsSnapshot>>>;
    };

    const updated = await pluginAwareApplication.setPluginEnabled("novel.timeline-tools", false);

    expect(updated).toEqual(ok(disabledRegistry));
    expect(calls).toEqual(["novel.timeline-tools:false"]);
  });

  test("rejects unknown commands at the Application boundary", () => {
    const application = createDesktopApplication();

    const result = application.executeCommand("fs:read-file");

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "APPLICATION_COMMAND_NOT_ALLOWED",
        category: "UserError",
        recoverability: "user-action"
      }
    });
  });

  test("exposes and executes plugin runtime host commands through the Application boundary", () => {
    const application = createDesktopApplication({
      pluginRuntimeSession: createPluginRuntimeSession({
        snapshot: {
          schemaVersion: "1.0",
          plugins: [
            {
              pluginId: "novel.structure-tools",
              enabled: true,
              manifestPath: "plugins/novel.structure-tools/plugin.json",
              grantedPermissions: [{ permission: "project:read", scopes: ["project"] }],
              manifestStatus: "valid",
              manifest: {
                displayName: "Structure Tools",
                version: "1.0.0",
                entryKind: "none",
                compatibleAppVersion: { min: "0.1.0" },
                capabilities: [{ type: "command", id: "outline.audit", title: "Audit Outline" }],
                requestedPermissions: [{ permission: "project:read", scopes: ["project"] }],
                contributes: {
                  commands: [{ id: "outline.audit", title: "Audit Outline" }],
                  workflowSteps: []
                }
              }
            }
          ]
        },
        adapter: {
          executeHostCommand: () => ok({ output: { accepted: true } }),
          executeWorkflowStep: () => ok({ output: { accepted: true } })
        }
      })
    });

    expect(application.listCommands()).toContainEqual({
      id: "plugin:novel.structure-tools:outline.audit",
      title: "Audit Outline",
      scope: "plugin",
      riskLevel: "safe",
      defaultShortcut: "",
      source: {
        kind: "plugin",
        pluginId: "novel.structure-tools",
        contributionId: "outline.audit"
      }
    });

    const result = application.executeCommand("plugin:novel.structure-tools:outline.audit");

    expect(result.ok).toBe(true);
    expect(application.getShellState().commandPaletteOpen).toBe(false);
  });

  test("delegates active chapter editing through an injected Application session", async () => {
    const writes: ChapterDocument[] = [];
    const historyCalls: string[] = [];
    const repository: ChapterDraftRepositoryPort = {
      async readChapter(requestedChapterId) {
        expect(requestedChapterId).toBe(chapterId);
        return ok(chapter);
      },
      async writeChapter(nextChapter) {
        writes.push(nextChapter);
        return ok(nextChapter);
      }
    };
    const historyRepository: ChapterHistoryRepositoryPort = {
      async snapshotChapterVersion(input) {
        historyCalls.push(`snapshot:${input.reason}:${input.body}`);
        return ok({
          versionId: "ver_manual_save",
          reason: input.reason,
          createdBy: input.createdBy ?? "system",
          createdAt: "2026-07-04T00:00:00.000Z",
          parentVersionId: input.parentVersionId ?? null
        });
      },
      async listChapterVersions(requestedChapterId) {
        historyCalls.push(`list:${requestedChapterId}`);
        return ok([
          {
            versionId: "ver_manual_save",
            reason: "manual-save",
            createdBy: "user",
            createdAt: "2026-07-04T00:00:00.000Z",
            parentVersionId: null
          }
        ]);
      },
      async readChapterVersion(requestedChapterId, versionId) {
        historyCalls.push(`read:${requestedChapterId}:${versionId}`);
        return ok({ versionId, body: "保存后的章节正文。\n" });
      }
    };
    const application = createDesktopApplication({
      chapterEditorSession: createChapterEditorSession({
        chapterId,
        repository,
        historyRepository,
        now: () => "2026-07-04T00:00:00.000Z"
      }),
      projectTitle: "未命名长篇项目",
      navigatorSections: [{ id: "chapters", title: "Chapters", itemCount: 1 }]
    });

    const loaded = await application.loadActiveChapter();

    expect(isOk(loaded)).toBe(true);
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }
    expect(loaded.value.state.chapter.body).toBe("原始章节正文。\n");
    expect(application.getShellState()).toMatchObject({
      projectTitle: "未命名长篇项目",
      saveStatus: "Saved",
      navigatorSections: [{ id: "chapters", title: "Chapters", itemCount: 1 }]
    });

    const edited = await application.editActiveChapter("保存后的章节正文。\n");

    expect(isOk(edited)).toBe(true);
    if (isErr(edited)) {
      throw new Error(edited.error.message);
    }
    expect(edited.value.state.saveStatus).toBe("Unsaved");
    expect(application.getShellState().saveStatus).toBe("Unsaved");

    const saved = await application.saveActiveChapter();

    expect(isOk(saved)).toBe(true);
    if (isErr(saved)) {
      throw new Error(saved.error.message);
    }
    expect(saved.value.state.saveStatus).toBe("Saved");
    expect(writes.map((entry) => entry.body)).toEqual(["保存后的章节正文。\n"]);
    expect(historyCalls).toContain("snapshot:manual-save:保存后的章节正文。\n");

    const versions = await application.listActiveChapterVersions();

    expect(isOk(versions)).toBe(true);
    if (isErr(versions)) {
      throw new Error(versions.error.message);
    }
    expect(versions.value[0]?.reason).toBe("manual-save");

    const diff = application.previewActiveChapterSuggestionDiff("AI 建议正文。\n");

    expect(diff.ok).toBe(true);
    if (!diff.ok) {
      throw new Error(diff.error.message);
    }
    expect(diff.value.changes[0]?.kind).toBe("replace");
    expect(historyCalls).not.toContain("snapshot:before-ai-apply:AI 建议正文。\n");
  });
});
