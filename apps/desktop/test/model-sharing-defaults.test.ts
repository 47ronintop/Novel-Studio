import { describe, expect, test, vi } from "vitest";

import { createUnifiedError, err, ok } from "@novel-studio/shared";
import {
  AGENT_MODEL_SHARING_DEFAULTS_REQUIRED_MESSAGE,
  loadWorkspaceModelSharingDefaults,
  saveWorkspaceModelSharingDefaults,
  shouldRequestWorkspaceModelSharingDefaults
} from "../src/renderer/model-sharing-defaults.js";

describe("workspace model sharing defaults", () => {
  test("opens only for a workspace blocked on first-use sharing selection", () => {
    expect(
      shouldRequestWorkspaceModelSharingDefaults({
        workspaceKind: "creativeProject",
        errorMessage: AGENT_MODEL_SHARING_DEFAULTS_REQUIRED_MESSAGE
      })
    ).toBe(true);
    expect(
      shouldRequestWorkspaceModelSharingDefaults({
        workspaceKind: "none",
        errorMessage: "当前项目尚未完成模型共享范围选择。"
      })
    ).toBe(false);
    expect(
      shouldRequestWorkspaceModelSharingDefaults({
        workspaceKind: "engineeringWorkspace",
        errorMessage: "上下文预览已过期。"
      })
    ).toBe(false);
  });

  test("persists only through the Main-owned context-policy action", async () => {
    const updateContextPolicy = vi.fn(async () => ok(undefined));
    const defaults = {
      outlineMetadata: "automatic" as const,
      activeResource: "off" as const,
      conversationSummary: "ask" as const,
      toolReadResults: "deny" as const
    };

    await expect(
      saveWorkspaceModelSharingDefaults({ workspace: { updateContextPolicy } } as never, defaults)
    ).resolves.toBeUndefined();
    expect(updateContextPolicy).toHaveBeenCalledWith({
      action: "set_sharing_defaults",
      defaults
    });
  });

  test("loads the current project selection through the Main-owned read API", async () => {
    const defaults = {
      outlineMetadata: "off" as const,
      activeResource: "automatic" as const,
      conversationSummary: "deny" as const,
      toolReadResults: "allow" as const
    };
    const readModelSharingDefaults = vi.fn(async () => ok(defaults));

    await expect(
      loadWorkspaceModelSharingDefaults({ workspace: { readModelSharingDefaults } } as never)
    ).resolves.toEqual({ ok: true, value: defaults });
    expect(readModelSharingDefaults).toHaveBeenCalledOnce();
  });

  test("returns actionable Chinese feedback without treating failure as saved", async () => {
    const updateContextPolicy = vi.fn(async () =>
      err(
        createUnifiedError({
          code: "WORKSPACE_CONTEXT_POLICY_UNAVAILABLE",
          category: "UserError",
          message: "unavailable",
          recoverability: "user-action",
          suggestedAction: "open workspace",
          traceId: "sharing-test"
        })
      )
    );

    await expect(
      saveWorkspaceModelSharingDefaults({ workspace: { updateContextPolicy } } as never, {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "ask",
        toolReadResults: "ask"
      })
    ).resolves.toBe(
      "保存共享范围失败（WORKSPACE_CONTEXT_POLICY_UNAVAILABLE）。请确认当前项目仍已打开后重试。"
    );
  });
});
