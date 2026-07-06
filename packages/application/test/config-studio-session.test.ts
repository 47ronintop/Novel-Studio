import { describe, expect, test } from "vitest";

import {
  isErr,
  isOk,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createConfigStudioSession,
  type ConfigAssetPort,
  type ConfigAssetType
} from "../src/index.js";

const prompt = {
  schemaVersion: "1.0",
  id: "prompt_reviewer_default",
  type: "prompt.template",
  title: "Reviewer Prompt",
  status: "active",
  promptRole: "reviewer",
  template: "Review {{chapter}}.",
  variables: [{ name: "chapter", required: true, type: "string" }],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
} satisfies JsonObject;

const workflow = {
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
      nextStepId: "review"
    },
    {
      id: "review",
      kind: "agent",
      agentId: "agent_reviewer_default",
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

describe("config studio session", () => {
  test("loads and saves Prompt assets through an injected config asset port", async () => {
    const writes: JsonObject[] = [];
    const port: ConfigAssetPort = {
      async readConfigAsset(assetType, assetId) {
        expect(assetType).toBe("prompt");
        expect(assetId).toBe("prompt_reviewer_default");
        return ok(prompt);
      },
      async writeConfigAsset(input) {
        writes.push(input.content);
        return ok({ versionId: "ver_before_save" });
      },
      async restoreConfigAssetVersion() {
        return ok(prompt);
      }
    };
    const session = createConfigStudioSession({ configAssetPort: port });

    const loaded = await session.loadConfigAsset("prompt", "prompt_reviewer_default");
    const saved = await session.saveConfigAsset({
      assetType: "prompt",
      assetId: "prompt_reviewer_default",
      content: { ...prompt, title: "Updated Prompt" },
      createdBy: "user"
    });

    expect(isOk(loaded)).toBe(true);
    expect(isOk(saved)).toBe(true);
    if (!loaded.ok || !saved.ok) {
      return;
    }
    expect(loaded.value.content.title).toBe("Reviewer Prompt");
    expect(saved.value.versionId).toBe("ver_before_save");
    expect(writes[0]?.title).toBe("Updated Prompt");
  });

  test("restores Agent and Workflow config assets through the same structured path", async () => {
    const restored: Array<{ assetType: ConfigAssetType; assetId: string; versionId: string }> = [];
    const port: ConfigAssetPort = {
      async readConfigAsset() {
        return ok(prompt);
      },
      async writeConfigAsset() {
        return ok({ versionId: "ver_before_save" });
      },
      async restoreConfigAssetVersion(input) {
        restored.push(input);
        return ok({ ...prompt, id: input.assetId });
      }
    };
    const session = createConfigStudioSession({ configAssetPort: port });

    const agentRestore = await session.restoreConfigAssetVersion({
      assetType: "agent",
      assetId: "agent_reviewer_default",
      versionId: "ver_agent_01",
      createdBy: "user"
    });
    const workflowRestore = await session.restoreConfigAssetVersion({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      versionId: "ver_workflow_01",
      createdBy: "user"
    });

    expect(isOk(agentRestore)).toBe(true);
    expect(isOk(workflowRestore)).toBe(true);
    expect(restored).toEqual([
      {
        assetType: "agent",
        assetId: "agent_reviewer_default",
        versionId: "ver_agent_01",
        createdBy: "user"
      },
      {
        assetType: "workflow",
        assetId: "wf_review_chapter",
        versionId: "ver_workflow_01",
        createdBy: "user"
      }
    ]);
  });

  test("returns validation errors from the config asset port without rewriting them", async () => {
    const port: ConfigAssetPort = {
      async readConfigAsset() {
        return ok(prompt);
      },
      async writeConfigAsset(): Promise<Result<never, UnifiedError>> {
        return {
          ok: false,
          error: {
            schemaVersion: "1.0",
            errorId: "err_config_invalid",
            code: "CONFIG_ASSET_INVALID",
            category: "ValidationError",
            message: "Config asset failed schema validation.",
            recoverability: "user-action",
            suggestedAction: "Fix the config asset before making it active.",
            traceId: "trace_config_studio",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        };
      },
      async restoreConfigAssetVersion() {
        return ok(prompt);
      }
    };
    const session = createConfigStudioSession({ configAssetPort: port });

    const saved = await session.saveConfigAsset({
      assetType: "workflow",
      assetId: "wf_review_chapter",
      content: { invalid: true },
      createdBy: "user"
    });

    expect(isErr(saved)).toBe(true);
    if (saved.ok) {
      return;
    }
    expect(saved.error.code).toBe("CONFIG_ASSET_INVALID");
  });

  test("attaches workflow graph projection to workflow config snapshots", async () => {
    const port: ConfigAssetPort = {
      async readConfigAsset() {
        return ok(workflow);
      },
      async writeConfigAsset() {
        return ok({ versionId: "ver_before_save" });
      },
      async restoreConfigAssetVersion() {
        return ok(workflow);
      }
    };
    const session = createConfigStudioSession({ configAssetPort: port });

    const loaded = await session.loadConfigAsset("workflow", "wf_review_chapter");

    expect(isOk(loaded)).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.workflowGraph).toEqual({
      graph: {
        workflowId: "wf_review_chapter",
        title: "Review current chapter",
        entryNodeId: "context",
        nodes: [
          { id: "context", stepId: "context", kind: "context", label: "context", metadata: {} },
          {
            id: "review",
            stepId: "review",
            kind: "agent",
            label: "review",
            metadata: { agentId: "agent_reviewer_default" }
          },
          { id: "save", stepId: "save", kind: "save", label: "save", metadata: {} }
        ],
        edges: [
          { id: "context:next:review", fromNodeId: "context", toNodeId: "review", kind: "next" },
          { id: "review:next:save", fromNodeId: "review", toNodeId: "save", kind: "next" }
        ]
      },
      validation: {
        status: "valid",
        issues: []
      }
    });
  });
});
