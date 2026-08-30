import { describe, expect, test } from "vitest";

import { STANDALONE_AGENT_CONTEXT_SCOPE } from "@novel-studio/agent-engine";

import type {
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AiWritingWorkflowProps
} from "@novel-studio/ui";

import {
  decorateAgentConversationWorkspace,
  resolveAgentConversationWorkspacePresentation
} from "../src/renderer/agent-conversation-workspace.js";

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

  test("clears a stale workspace immediately when no project is active", () => {
    const result = resolveAgentConversationWorkspacePresentation(
      liveWorkspace,
      undefined,
      undefined
    );

    expect(result.workspace).toBeUndefined();
    expect(result.shouldClearPendingMainReview).toBe(false);
  });

  test("keeps the standalone conversation visible while Shell none is active", () => {
    const result = resolveAgentConversationWorkspacePresentation(
      liveWorkspace,
      undefined,
      undefined,
      STANDALONE_AGENT_CONTEXT_SCOPE
    );

    expect(result.workspace).toBe(liveWorkspace);
    expect(result.shouldClearPendingMainReview).toBe(false);
  });

  test("strips workspace-only composer controls from standalone presentation", () => {
    const workspace = {
      ...liveWorkspace,
      view: {
        loading: false,
        onCreate: () => undefined,
        onArchive: () => undefined,
        onRestore: () => undefined,
        onReturnToActive: () => undefined,
        composer: {
          request: "hello",
          operationMode: "execution" as const,
          contextMode: "general_file" as const,
          writePolicy: "user_preapproved_run" as const,
          writePolicyAcknowledged: true,
          active: false,
          references: {
            chips: [],
            available: [],
            suggested: [],
            onAdd: () => undefined,
            onRemove: () => undefined
          },
          contextStatus: {
            state: "normal" as const,
            usageLabel: "0 / 1",
            precision: "unknown" as const,
            sources: []
          },
          permission: {
            loading: false,
            approvalSource: "not_approved" as const,
            onOpen: () => undefined
          },
          onRequestChange: () => undefined,
          onOperationModeChange: () => undefined,
          onContextModeChange: () => undefined,
          onWritePolicyChange: () => undefined,
          onSend: () => undefined,
          onStop: () => undefined
        }
      }
    } as AgentConversationWorkspaceShellProps;

    const decorated = decorateAgentConversationWorkspace({
      workspace,
      workspaceKind: "none",
      chapterEditor: undefined,
      chapterSelection: undefined,
      aiWritingWorkflow: undefined,
      onRewriteSelection: () => undefined,
      onReviewSelectionStyle: () => undefined,
      onApplySelection: () => undefined,
      onRejectSelection: () => undefined,
      onUndoSelection: () => undefined
    });

    expect(decorated?.view.composer).toMatchObject({
      operationMode: "conversation",
      contextMode: "standalone_chat",
      availableContextModes: ["standalone_chat"]
    });
    expect(decorated?.view.composer?.references).toBeUndefined();
    expect(decorated?.view.composer?.contextStatus).toBeUndefined();
    expect(decorated?.view.composer?.permission).toBeUndefined();
  });

  test("prefers a 2.0 style evaluation over the legacy review in selection handoff", () => {
    const styleEvaluation = {
      schemaVersion: "1.0" as const,
      ruleVersion: "2.0",
      enforcement: "advisory" as const,
      status: "attention" as const,
      hitCount: 1,
      hits: []
    };
    const workflow = {
      selectionReview: {
        status: "pending",
        originalText: "原文",
        proposedText: "建议",
        rangeLabel: "0-2",
        compareLabel: "原文 -> 建议",
        canUndo: false
      },
      styleEvaluation,
      styleReview: { status: "attention", hitCount: 9, hits: [] }
    } as AiWritingWorkflowProps;

    const decorated = decorateAgentConversationWorkspace({
      workspace: { view: {} } as AgentConversationWorkspaceShellProps,
      workspaceKind: "creativeProject",
      chapterEditor: undefined,
      chapterSelection: undefined,
      aiWritingWorkflow: workflow,
      onRewriteSelection: () => undefined,
      onReviewSelectionStyle: () => undefined,
      onApplySelection: () => undefined,
      onRejectSelection: () => undefined,
      onUndoSelection: () => undefined
    });

    expect(decorated?.mainReview).toMatchObject({
      kind: "selection",
      props: { styleEvaluation }
    });
    expect(
      (decorated?.mainReview as AgentConversationMainReview & { props: object }).props
    ).not.toHaveProperty("styleReview");
  });

  test("keeps writing context available on a Story Bible surface without an active chapter", () => {
    const decorated = decorateAgentConversationWorkspace({
      workspace: {
        view: {
          composer: { contextMode: "writing" }
        }
      } as AgentConversationWorkspaceShellProps,
      workspaceKind: "creativeProject",
      activeActivity: "storyBible",
      activeChapterId: undefined,
      chapterEditor: undefined,
      chapterSelection: undefined,
      aiWritingWorkflow: undefined,
      onRewriteSelection: () => undefined,
      onReviewSelectionStyle: () => undefined,
      onApplySelection: () => undefined,
      onRejectSelection: () => undefined,
      onUndoSelection: () => undefined
    });

    expect(decorated?.view.composer).toMatchObject({
      contextMode: "writing",
      availableContextModes: ["writing", "general_file"]
    });
  });
});
