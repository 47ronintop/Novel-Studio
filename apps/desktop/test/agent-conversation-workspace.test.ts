import { describe, expect, test } from "vitest";

import type {
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps
} from "@novel-studio/ui";

import { resolveAgentConversationWorkspacePresentation } from "../src/renderer/agent-conversation-workspace.js";

describe("agent conversation workspace presentation", () => {
  const liveWorkspace = {} as AgentConversationWorkspaceShellProps;
  const pendingReview = { kind: "plan", props: {} } as AgentConversationMainReview;

  test("shows a pending central review until the live projection catches up", () => {
    const result = resolveAgentConversationWorkspacePresentation(liveWorkspace, "project_1", {
      projectId: "project_1",
      review: pendingReview
    });

    expect(result.workspace).toEqual({ ...liveWorkspace, mainReview: pendingReview });
    expect(result.shouldClearPendingMainReview).toBe(false);
  });

  test("prefers the live review and clears the pending override once projected", () => {
    const liveReview = { kind: "rollback", props: {} } as AgentConversationMainReview;
    const workspace = { ...liveWorkspace, mainReview: liveReview };

    const result = resolveAgentConversationWorkspacePresentation(workspace, "project_1", {
      projectId: "project_1",
      review: pendingReview
    });

    expect(result.workspace).toBe(workspace);
    expect(result.shouldClearPendingMainReview).toBe(true);
  });

  test("does not leak a pending review into a different project", () => {
    const result = resolveAgentConversationWorkspacePresentation(liveWorkspace, "project_2", {
      projectId: "project_1",
      review: pendingReview
    });

    expect(result.workspace).toBe(liveWorkspace);
    expect(result.shouldClearPendingMainReview).toBe(true);
  });
});
