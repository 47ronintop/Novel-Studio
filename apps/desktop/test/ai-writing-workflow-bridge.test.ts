import { describe, expect, test } from "vitest";

import type {
  AiWritingSuggestion,
  ChapterEditorSnapshot,
  NovelStudioApi
} from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createAiWritingWorkflowBridge } from "../src/renderer/ai-writing-workflow-bridge.js";

const appliedSnapshot: ChapterEditorSnapshot = {
  state: {
    chapter: {
      frontmatter: {
        schemaVersion: "1.0",
        id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        type: "chapter",
        title: "第一章",
        order: 1,
        status: "draft",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      body: "Opening line.\nAI continuation draft.\n"
    },
    dirty: true,
    saveStatus: "Unsaved"
  },
  versions: []
};

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation draft.\n",
  summary: "Generated a local mock continuation for review.",
  diffPreview: {
    title: "AI suggestion",
    changes: [
      {
        kind: "replace",
        value: "Opening line.\nAI continuation draft.\n"
      }
    ]
  },
  contextTrace: {
    selectionReason: "priority_then_budget",
    includedRefs: [
      {
        refType: "chapter",
        refId: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
        tokenEstimate: 4
      }
    ],
    excludedRefs: []
  }
};

describe("AI writing workflow bridge", () => {
  test("generates a preview-only suggestion and applies it through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createAiWritingWorkflowBridge(createApi(calls));

    const initial = bridge.getProps();
    const generating = bridge.beginGenerate("续写当前场景");
    const generated = await bridge.generateSuggestion("续写当前场景");
    const applied = await bridge.applySuggestion();

    expect(initial.status).toBe("idle");
    expect(generating.status).toBe("generating");
    expect(generated.status).toBe("suggestion-ready");
    expect(generated.summary).toBe("Generated a local mock continuation for review.");
    expect(generated.diffPreview?.changes[0]?.value).toContain("AI continuation draft.");
    expect(generated.contextTraceLabel).toBe("1 source / 4 tokens");
    expect(applied.chapter.body).toContain("AI continuation draft.");
    expect(applied.dirty).toBe(true);
    expect(applied.saveStatus).toBe("Unsaved");
    expect(calls).toEqual(["ai.generate:续写当前场景", "ai.apply:sug_m14"]);
  });
});

function createApi(calls: string[]): NovelStudioApi {
  return {
    getShellState: async () => ({
      projectTitle: "M14",
      activeActivity: "workspace",
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      commandPaletteOpen: false,
      saveStatus: "Saved",
      navigatorSections: [],
      bottomPanelTabs: []
    }),
    commands: {
      list: async () => [],
      execute: async () =>
        ok({
          projectTitle: "M14",
          activeActivity: "workspace",
          navigatorCollapsed: false,
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          commandPaletteOpen: false,
          saveStatus: "Saved",
          navigatorSections: [],
          bottomPanelTabs: []
        })
    },
    project: {
      open: async () => {
        throw new Error("not used");
      },
      create: async () => {
        throw new Error("not used");
      },
      listChapters: async () => {
        throw new Error("not used");
      },
      createChapter: async () => {
        throw new Error("not used");
      },
      selectChapter: async () => {
        throw new Error("not used");
      }
    },
    ai: {
      generateChapterSuggestion: async (request) => {
        calls.push(`ai.generate:${request.instruction}`);
        return ok(suggestion);
      },
      applyChapterSuggestion: async (suggestionId) => {
        calls.push(`ai.apply:${suggestionId}`);
        return ok(appliedSnapshot);
      }
    },
    chapter: {
      load: async () => {
        throw new Error("not used");
      },
      edit: async () => {
        throw new Error("not used");
      },
      save: async () => {
        throw new Error("not used");
      },
      listVersions: async () => {
        throw new Error("not used");
      },
      previewVersion: async () => {
        throw new Error("not used");
      },
      restoreVersion: async () => {
        throw new Error("not used");
      },
      previewSuggestionDiff: async () => {
        throw new Error("not used");
      }
    },
    settings: {
      listModelProfiles: async () => {
        throw new Error("not used");
      },
      saveModelProfile: async () => {
        throw new Error("not used");
      },
      testModelProfileConnection: async () => {
        throw new Error("not used");
      }
    },
    studio: {
      loadConfigAsset: async () => {
        throw new Error("not used");
      },
      saveConfigAsset: async () => {
        throw new Error("not used");
      },
      restoreConfigAssetVersion: async () => {
        throw new Error("not used");
      }
    }
  };
}
