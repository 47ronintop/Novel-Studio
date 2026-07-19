import { describe, expect, test } from "vitest";

import { createDefaultUserPreferences } from "@novel-studio/application";
import {
  DEFAULT_USER_SHELL_PREFERENCES,
  EMPTY_WORKSPACE_CONTEXT,
  createUnifiedError,
  err,
  ok
} from "@novel-studio/shared";
import type { ChapterEditorProps } from "@novel-studio/ui";

import {
  createChapterEditorRuntime,
  createChapterEditorSelectionCommand,
  applyShellPreferences,
  persistAppearancePreferences,
  rendererShellState,
  resolveActivityTransition,
  shellPreferencesFromState
} from "../src/renderer/app-shell-support.js";

const chapterEditor = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_runtime",
      type: "chapter",
      title: "Runtime Chapter",
      order: 1,
      status: "draft",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    },
    body: "Alpha sentence.\nBeta sentence."
  },
  saveStatus: "Saved",
  dirty: false,
  versionHistory: []
} satisfies ChapterEditorProps;

describe("renderer app shell editor runtime support", () => {
  test("uses the shared shell preference defaults", () => {
    expect(rendererShellState).toMatchObject({
      workspaceContext: EMPTY_WORKSPACE_CONTEXT,
      ...DEFAULT_USER_SHELL_PREFERENCES
    });
    expect(shellPreferencesFromState(rendererShellState)).toEqual(DEFAULT_USER_SHELL_PREFERENCES);
  });

  test("round-trips explicit empty engineering expansion state", () => {
    const applied = applyShellPreferences(
      {
        ...rendererShellState,
        engineeringExpandedPathIds: ["src"]
      },
      {
        engineeringExpandedPathIds: [],
        navigatorExpandedSectionIds: []
      }
    );

    expect(applied.engineeringExpandedPathIds).toEqual([]);
    expect(applied.navigatorExpandedSectionIds).toEqual([]);
    expect(shellPreferencesFromState(applied)).not.toHaveProperty("workspaceContext");
  });

  test("does not restore a creative preference into an engineering workspace", () => {
    const applied = applyShellPreferences(
      {
        ...rendererShellState,
        workspaceContext: {
          kind: "engineeringWorkspace",
          workspaceId: "ws_source",
          displayName: "Source",
          capabilities: ["engineeringWorkbench", "generalFileContext"]
        },
        workbenchMode: "engineering"
      },
      {
        ...DEFAULT_USER_SHELL_PREFERENCES,
        workbenchMode: "creative"
      }
    );

    expect(applied.workbenchMode).toBe("engineering");
  });

  test("restores the last non-settings activity after settings closes", () => {
    expect(resolveActivityTransition("search", "workspace", "settings")).toEqual({
      activeActivity: "settings",
      lastNonSettingsActivity: "search"
    });
    expect(resolveActivityTransition("settings", "search", "settings")).toEqual({
      activeActivity: "settings",
      lastNonSettingsActivity: "search"
    });
    expect(resolveActivityTransition("settings", "search", "timeline")).toEqual({
      activeActivity: "timeline",
      lastNonSettingsActivity: "timeline"
    });
  });

  test("returns no feedback when appearance preferences persist", async () => {
    const feedback = await persistAppearancePreferences(
      {
        load: async () => ok(createDefaultUserPreferences()),
        save: async () => ok(createDefaultUserPreferences())
      },
      { theme: "light", accentColor: "blue" }
    );

    expect(feedback).toBeUndefined();
  });

  test("returns explicit feedback when appearance preferences cannot be persisted", async () => {
    const storageError = createUnifiedError({
      code: "PREFERENCES_WRITE_FAILED",
      category: "StorageError",
      message: "write failed",
      recoverability: "retryable",
      suggestedAction: "Retry saving preferences.",
      traceId: "trace_preferences_write"
    });
    await expect(
      persistAppearancePreferences(
        {
          load: async () => ok(createDefaultUserPreferences()),
          save: async () => err(storageError)
        },
        { theme: "system", accentColor: "amber" }
      )
    ).resolves.toEqual({
      kind: "error",
      message: "外观已在本次会话生效，但未能保存到本地。"
    });
    await expect(
      persistAppearancePreferences(
        {
          load: async () => ok(createDefaultUserPreferences()),
          save: async () => {
            throw new Error("ipc unavailable");
          }
        },
        { theme: "dark", accentColor: "teal" }
      )
    ).resolves.toEqual({
      kind: "error",
      message: "外观已在本次会话生效，但未能保存到本地。"
    });
    await expect(
      persistAppearancePreferences(undefined, { theme: "dark", accentColor: "teal" })
    ).resolves.toEqual({
      kind: "error",
      message: "外观已在本次会话生效，但无法写入用户偏好。"
    });
  });

  test("defaults the interactive chapter runtime to CodeMirror", () => {
    expect(
      createChapterEditorRuntime(chapterEditor, {
        anchor: 0,
        head: 15
      })
    ).toMatchObject({
      adapterLabel: "CodeMirror 6 Runtime",
      activeRangeLabel: "Selection 0-15",
      selectionSummaryLabel: "Selection 15 chars, lines 1-1"
    });
  });

  test("keeps an explicit textarea fallback for recovery and feature flag rollback", () => {
    expect(
      createChapterEditorRuntime(
        chapterEditor,
        {
          anchor: 0,
          head: 15
        },
        {
          preferredRuntimeId: "textarea",
          codeMirrorEnabled: false
        }
      )
    ).toMatchObject({
      adapterLabel: "Textarea Runtime",
      activeRangeLabel: "Selection 0-15"
    });
  });

  test("creates selection preview commands from the default CodeMirror runtime", () => {
    expect(
      createChapterEditorSelectionCommand(chapterEditor, {
        commandId: "editor.ai.preview-selection",
        selection: {
          anchor: 0,
          head: 15
        }
      })
    ).toMatchObject({
      commandId: "editor.ai.preview-selection",
      runtimeId: "codemirror",
      selection: {
        startOffset: 0,
        endOffset: 15,
        selectedTextPreview: "Alpha sentence.",
        collapsed: false
      }
    });
  });
});
