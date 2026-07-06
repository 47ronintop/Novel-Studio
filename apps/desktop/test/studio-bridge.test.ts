import { describe, expect, test } from "vitest";

import type {
  ConfigAssetSnapshot,
  ConfigVersionSummary,
  NovelStudioApi
} from "@novel-studio/application";
import { ok, type JsonObject } from "@novel-studio/shared";

import { createStudioBridge } from "../src/renderer/studio-bridge.js";

const promptContent = {
  schemaVersion: "1.0",
  id: "prompt_reviewer_default",
  type: "prompt.template",
  title: "默认审稿 Prompt",
  status: "active",
  promptRole: "reviewer",
  template: "请审稿 {{chapter}}。",
  variables: [{ name: "chapter", required: true, type: "string" }],
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z"
} satisfies JsonObject;

const workflowContent = {
  schemaVersion: "1.0",
  id: "wf_review_chapter",
  type: "workflow.definition",
  title: "Review current chapter",
  status: "active",
  entryStepId: "context",
  steps: [
    {
      id: "context",
      kind: "context",
      nextStepId: "save"
    },
    {
      id: "save",
      kind: "save"
    }
  ],
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z"
} satisfies JsonObject;

describe("M23 studio bridge", () => {
  test("loads the default prompt asset into editable Studio props", async () => {
    const calls: string[] = [];
    const bridge = createStudioBridge(createApi(calls));

    const props = await bridge.load();

    expect(calls).toEqual(["studio.loadConfigAsset:prompt:prompt_reviewer_default"]);
    expect(props.selectedAsset.title).toBe("默认审稿 Prompt");
    expect(props.selectedAsset.validationStatus).toBe("valid");
    expect(props.feedback).toEqual({
      kind: "info",
      message: "创作系统配置已加载。"
    });
  });

  test("marks invalid JSON drafts before save and does not call the preload save API", async () => {
    const calls: string[] = [];
    const bridge = createStudioBridge(createApi(calls));
    await bridge.load();

    const dirty = bridge.updateContent("{");
    const saved = await bridge.save();

    expect(dirty.selectedAsset.validationStatus).toBe("invalid");
    expect(saved.feedback).toEqual({
      kind: "error",
      message: "JSON 格式无效，修正后才能保存。"
    });
    expect(calls).not.toContain("studio.saveConfigAsset:prompt:prompt_reviewer_default");
  });

  test("saves and restores config assets through the preload API", async () => {
    const calls: string[] = [];
    const bridge = createStudioBridge(createApi(calls));
    await bridge.load();

    bridge.updateContent(JSON.stringify({ ...promptContent, title: "已更新 Prompt" }, null, 2));
    const saved = await bridge.save();
    const restored = await bridge.restoreVersion("ver_before_save");

    expect(calls).toContain("studio.saveConfigAsset:prompt:prompt_reviewer_default");
    expect(saved.versions[0]?.versionId).toBe("ver_before_save");
    expect(calls).toContain(
      "studio.restoreConfigAssetVersion:prompt:prompt_reviewer_default:ver_before_save"
    );
    expect(restored.selectedAsset.title).toBe("默认审稿 Prompt");
  });

  test("maps workflow graph snapshots into Studio UI props", async () => {
    const calls: string[] = [];
    const bridge = createStudioBridge(createApi(calls));

    const props = await bridge.selectAsset("workflow", "wf_review_chapter");

    expect(calls).toContain("studio.loadConfigAsset:workflow:wf_review_chapter");
    expect(props.selectedAsset.workflowGraph).toEqual({
      graph: {
        workflowId: "wf_review_chapter",
        title: "Review current chapter",
        entryNodeId: "context",
        nodes: [
          { id: "context", stepId: "context", kind: "context", label: "context", metadata: {} },
          { id: "save", stepId: "save", kind: "save", label: "save", metadata: {} }
        ],
        edges: [{ id: "context:next:save", fromNodeId: "context", toNodeId: "save", kind: "next" }]
      },
      validation: { status: "valid", issues: [] }
    });
  });

  test("applies workflow inspector edits to the JSON draft and refreshes graph validation", async () => {
    const calls: string[] = [];
    const bridge = createStudioBridge(createApi(calls));

    await bridge.selectAsset("workflow", "wf_review_chapter");
    const props = bridge.applyWorkflowNodeEdit({
      stepId: "save",
      nextStepId: "missing"
    });

    expect(props.selectedAsset.validationStatus).toBe("invalid");
    expect(props.selectedAsset.content).toContain('"nextStepId": "missing"');
    expect(props.selectedAsset.workflowGraph?.validation).toEqual({
      status: "invalid",
      issues: [
        {
          code: "WORKFLOW_GRAPH_EDGE_TARGET_MISSING",
          severity: "error",
          stepId: "save",
          message: "Workflow edge points to a missing step.",
          targetStepId: "missing"
        }
      ]
    });
    expect(calls).not.toContain("studio.saveConfigAsset:workflow:wf_review_chapter");
  });
});

function createApi(calls: string[]): NovelStudioApi {
  let content: JsonObject = promptContent;

  return {
    getShellState: async () => ({
      projectTitle: "M23",
      activeActivity: "studio",
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
          projectTitle: "M23",
          activeActivity: "studio",
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
      chooseOpenDirectory: async () => {
        throw new Error("not used");
      },
      chooseCreateDirectory: async () => {
        throw new Error("not used");
      },
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
    search: {
      rebuildIndex: async () => {
        throw new Error("not used");
      },
      query: async () => {
        throw new Error("not used");
      }
    },
    ai: {
      generateChapterSuggestion: async () => {
        throw new Error("not used");
      },
      applyChapterSuggestion: async () => {
        throw new Error("not used");
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
    storyBible: {
      load: async () => {
        throw new Error("not used");
      },
      saveAsset: async () => {
        throw new Error("not used");
      },
      saveMemory: async () => {
        throw new Error("not used");
      },
      buildContextCandidates: async () => {
        throw new Error("not used");
      }
    },
    studio: {
      loadConfigAsset: async (assetType, assetId) => {
        calls.push(`studio.loadConfigAsset:${assetType}:${assetId}`);
        content = assetType === "workflow" ? workflowContent : promptContent;
        const snapshot: ConfigAssetSnapshot = {
          assetType,
          assetId,
          content,
          ...(assetType === "workflow"
            ? {
                workflowGraph: {
                  graph: {
                    workflowId: "wf_review_chapter",
                    title: "Review current chapter",
                    entryNodeId: "context",
                    nodes: [
                      {
                        id: "context",
                        stepId: "context",
                        kind: "context",
                        label: "context",
                        metadata: {}
                      },
                      { id: "save", stepId: "save", kind: "save", label: "save", metadata: {} }
                    ],
                    edges: [
                      {
                        id: "context:next:save",
                        fromNodeId: "context",
                        toNodeId: "save",
                        kind: "next"
                      }
                    ]
                  },
                  validation: { status: "valid", issues: [] }
                }
              }
            : {})
        };
        return ok(snapshot);
      },
      saveConfigAsset: async (input) => {
        calls.push(`studio.saveConfigAsset:${input.assetType}:${input.assetId}`);
        content = input.content;
        const version: ConfigVersionSummary = { versionId: "ver_before_save" };
        return ok(version);
      },
      restoreConfigAssetVersion: async (input) => {
        calls.push(
          `studio.restoreConfigAssetVersion:${input.assetType}:${input.assetId}:${input.versionId}`
        );
        content = promptContent;
        const snapshot: ConfigAssetSnapshot = {
          assetType: input.assetType,
          assetId: input.assetId,
          content
        };
        return ok(snapshot);
      }
    }
  };
}
