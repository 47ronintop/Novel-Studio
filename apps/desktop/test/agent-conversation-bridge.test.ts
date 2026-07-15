import { describe, expect, test } from "vitest";

import type { AgentRunEvent, AgentRunSnapshot } from "@novel-studio/agent-engine";
import type {
  AgentConversationReadResult,
  AgentConversationSummary,
  NovelStudioApi
} from "@novel-studio/application";
import type { AgentRunPanelProps } from "@novel-studio/ui";

import {
  createAgentConversationBridge,
  toAgentConversationWorkspaceProps
} from "../src/renderer/agent-conversation-bridge.js";

describe("AgentConversationBridge", () => {
  test("maps a loaded conversation to the navigator and main view contracts", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    const bridge = createAgentConversationBridge(fixture.api);
    const state = await bridge.load("project_01");
    const composer = {
      request: "",
      operationMode: "execution" as const,
      contextMode: "writing" as const,
      writePolicy: "write_before_confirmation" as const,
      writePolicyAcknowledged: false,
      active: false,
      onRequestChange: () => undefined,
      onOperationModeChange: () => undefined,
      onContextModeChange: () => undefined,
      onWritePolicyChange: () => undefined,
      onWritePolicyAcknowledgedChange: () => undefined,
      onSend: () => undefined,
      onStop: () => undefined
    };
    const workspace = toAgentConversationWorkspaceProps(state, undefined, composer, undefined, {
      onCreate: () => undefined,
      onSelect: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onSearchQueryChange: () => undefined,
      onFilterChange: () => undefined,
      onReturnToActive: () => undefined
    });

    expect(workspace.navigator.conversations[0]).toMatchObject({
      conversationId: "conv_01",
      title: "First conversation",
      status: "active",
      runCount: 1
    });
    expect(workspace.navigator.selectedConversationId).toBe("conv_01");
    expect(workspace.view.composer).toBe(composer);
    expect(workspace.view.conversation?.turns).toEqual([
      expect.objectContaining({ runId: "run_01", userRequest: "Request for conv_01" })
    ]);
  });

  test.each([
    ["planning_model", {}, true],
    ["completed", {}, false],
    ["completed", { canUndoRun: true }, true],
    ["completed", { rollbackReview: rollbackReviewProps() }, true],
    ["completed", { rollbackReview: rollbackReviewProps(false) }, true],
    ["completed", { changeSetReview: changeSetReviewProps(false) }, true],
    ["failed", { events: [failedToolEvent()] }, true],
    ["completed", { rollbackReview: completedRollbackReviewProps() }, false]
  ] as const)(
    "projects a %s run with review state %o exactly once",
    async (status, overrides, expectsLiveProjection) => {
      const fixture = createApiFixture([
        conversation("conv_01", "run_01", status, "2026-07-14T00:00:00.000Z")
      ]);
      const state = await createAgentConversationBridge(fixture.api).load("project_01");
      const agentRun = agentRunProps(status, overrides);
      const workspace = toAgentConversationWorkspaceProps(
        state,
        agentRun,
        undefined,
        undefined,
        workspaceActions()
      );

      expect(workspace.view.agentRun === agentRun).toBe(expectsLiveProjection);
      expect(workspace.view.conversation?.turns.map((turn) => turn.runId)).toEqual(
        expectsLiveProjection ? [] : ["run_01"]
      );
    }
  );

  test("uses rollback, change set, and plan review priority for the central projection", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    const state = await createAgentConversationBridge(fixture.api).load("project_01");
    const agentRun = agentRunProps("completed", {
      canUndoRun: true,
      changeSetReview: changeSetReviewProps(),
      rollbackReview: rollbackReviewProps()
    });
    const planReview = {
      contextMode: "writing" as const,
      plan: readyPlanArtifact(),
      onDecision: () => undefined
    };

    const workspace = toAgentConversationWorkspaceProps(
      state,
      agentRun,
      undefined,
      planReview,
      workspaceActions()
    );

    expect(workspace.mainReview).toEqual({
      kind: "rollback",
      props: agentRun.rollbackReview
    });
  });

  test.each([
    ["ready", true],
    ["approved", false],
    ["rejected", false]
  ] as const)("projects a %s plan review only while it is open", async (status, expectsLive) => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    const state = await createAgentConversationBridge(fixture.api).load("project_01");
    const planReview = {
      contextMode: "writing" as const,
      plan: { ...readyPlanArtifact(), sourceRunId: "run_01", status },
      onDecision: () => undefined
    };
    const workspace = toAgentConversationWorkspaceProps(
      state,
      agentRunProps("completed"),
      undefined,
      planReview,
      workspaceActions()
    );

    expect(workspace.view.agentRun !== undefined).toBe(expectsLive);
    expect(workspace.mainReview?.kind === "plan").toBe(expectsLive);
    expect(workspace.view.conversation?.turns.map((turn) => turn.runId)).toEqual(
      expectsLive ? [] : ["run_01"]
    );
  });

  test("does not project a run owned by another selected conversation", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    const state = await createAgentConversationBridge(fixture.api).load("project_01");
    const workspace = toAgentConversationWorkspaceProps(
      state,
      agentRunProps("planning_model", { runId: "run_other" }),
      undefined,
      {
        contextMode: "writing",
        plan: { ...readyPlanArtifact(), sourceRunId: "run_other" },
        onDecision: () => undefined
      },
      workspaceActions()
    );

    expect(workspace.view.agentRun).toBeUndefined();
    expect(workspace.mainReview).toBeUndefined();
    expect(workspace.view.conversation?.turns.map((turn) => turn.runId)).toEqual(["run_01"]);
  });

  test("projects a preflight error without a run id into the selected conversation", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", undefined, undefined, "2026-07-14T00:00:00.000Z")
    ]);
    const state = await createAgentConversationBridge(fixture.api).load("project_01");
    const preflightFailure = agentRunProps("idle", {
      runId: undefined,
      errorMessage: "The selected model cannot start an Agent run."
    });

    const workspace = toAgentConversationWorkspaceProps(
      state,
      preflightFailure,
      undefined,
      undefined,
      workspaceActions()
    );

    expect(workspace.view.agentRun).toBe(preflightFailure);
    expect(workspace.view.conversation?.turns).toEqual([]);
  });

  test("keeps a newly started run exactly once when it becomes a terminal turn", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", undefined, undefined, "2026-07-14T00:00:00.000Z")
    ]);
    const bridge = createAgentConversationBridge(fixture.api);
    await bridge.load("project_01");
    fixture.setProjectConversations("project_01", [
      conversation("conv_01", "run_new", "planning_model", "2026-07-14T01:00:00.000Z")
    ]);

    fixture.emit(runEvent("run_new", "run_started", 1));
    await flushAsyncRouting();
    fixture.emit(
      runEvent("run_new", "assistant_text_completed", 2, { text: "Completed response" })
    );
    await flushAsyncRouting();
    fixture.emit(
      runEvent("run_new", "tool_started", 3, {
        toolCallId: "read-01",
        toolName: "read_chapter",
        summary: "正在读取第一章"
      })
    );
    await flushAsyncRouting();
    fixture.emit(
      runEvent("run_new", "tool_completed", 4, {
        toolCallId: "read-01",
        toolName: "read_chapter",
        summary: "已读取第一章"
      })
    );
    await flushAsyncRouting();
    fixture.emit(runEvent("run_new", "run_completed", 5));
    await flushAsyncRouting();

    const state = bridge.getProps();
    if (state === undefined) throw new Error("Expected loaded conversation state");
    const workspace = toAgentConversationWorkspaceProps(
      state,
      agentRunProps("completed", { runId: "run_new", assistantText: "Completed response" }),
      undefined,
      undefined,
      workspaceActions()
    );

    expect(workspace.view.agentRun).toBeUndefined();
    expect(workspace.view.conversation?.turns).toEqual([
      expect.objectContaining({
        runId: "run_new",
        assistantText: "Completed response",
        statusLabel: "completed",
        events: [
          expect.objectContaining({ sequence: 3, type: "tool_started" }),
          expect.objectContaining({ sequence: 4, type: "tool_completed" })
        ]
      })
    ]);
  });

  test("lists conversations and hydrates the active conversation on load", async () => {
    const fixture = createApiFixture([
      conversation("conv_old", "run_old", "completed", "2026-07-14T00:00:00.000Z"),
      conversation("conv_active", "run_active", "planning_model", "2026-07-14T01:00:00.000Z")
    ]);
    const bridge = createAgentConversationBridge(fixture.api);

    const state = await bridge.load("project_01");

    expect(fixture.listQueries).toEqual([
      { projectId: "project_01", includeArchived: false, limit: 30 }
    ]);
    expect(fixture.readQueries).toEqual([
      { projectId: "project_01", conversationId: "conv_active" }
    ]);
    expect(state).toMatchObject({
      projectId: "project_01",
      selectedConversationId: "conv_active",
      activeConversationId: "conv_active",
      selectedConversation: { conversationId: "conv_active" },
      loading: false
    });
  });

  test("creates and selects a conversation, then resets run write authorization on switches", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    let resets = 0;
    const bridge = createAgentConversationBridge(fixture.api, {
      createCommandId: (action) => `cmd_${action}`,
      resetRunWriteAuthorization: () => {
        resets += 1;
      }
    });
    await bridge.load("project_01");
    const resetsAfterLoad = resets;

    const created = await bridge.create();
    expect(fixture.createCommands).toEqual([{ projectId: "project_01", commandId: "cmd_create" }]);
    expect(created.selectedConversationId).toBe("conv_created");
    expect(created.selectedConversation?.conversationId).toBe("conv_created");
    expect(resets).toBe(resetsAfterLoad + 1);

    await bridge.select("conv_01");
    expect(bridge.getProps()?.selectedConversationId).toBe("conv_01");
    expect(resets).toBe(resetsAfterLoad + 2);

    await bridge.select("conv_01");
    expect(resets).toBe(resetsAfterLoad + 2);
  });

  test("archives, restores, and searches without losing the selected detail", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T01:00:00.000Z"),
      conversation("conv_02", "run_02", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    const bridge = createAgentConversationBridge(fixture.api, {
      createCommandId: (action) => `cmd_${action}`
    });
    await bridge.load("project_01");

    const archived = await bridge.archive("conv_01");
    expect(fixture.archiveCommands).toEqual([
      {
        projectId: "project_01",
        conversationId: "conv_01",
        commandId: "cmd_archive",
        expectedConversationRevision: 1
      }
    ]);
    expect(archived.selectedConversationId).toBe("conv_02");

    const restored = await bridge.restore("conv_01");
    expect(fixture.restoreCommands).toEqual([
      {
        projectId: "project_01",
        conversationId: "conv_01",
        commandId: "cmd_restore",
        expectedConversationRevision: 2
      }
    ]);
    expect(restored.selectedConversationId).toBe("conv_01");

    const searched = await bridge.search("first", true);
    expect(fixture.searchQueries).toEqual([
      { projectId: "project_01", query: "first", includeArchived: true, limit: 30 }
    ]);
    expect(searched.searchQuery).toBe("first");
    expect(searched.includeArchived).toBe(true);
    expect(searched.selectedConversationId).toBe("conv_01");
    expect(searched.selectedConversation?.conversationId).toBe("conv_01");
  });

  test("resets the current selection when the project changes", async () => {
    const fixture = createApiFixture([
      conversation("conv_01", "run_01", "completed", "2026-07-14T00:00:00.000Z")
    ]);
    let resets = 0;
    const bridge = createAgentConversationBridge(fixture.api, {
      resetRunWriteAuthorization: () => {
        resets += 1;
      }
    });
    await bridge.load("project_01");

    fixture.setProjectConversations("project_02", []);
    const state = await bridge.load("project_02");

    expect(state).toEqual({
      projectId: "project_02",
      conversations: [],
      searchQuery: "",
      includeArchived: false,
      loading: false,
      diagnostics: []
    });
    expect(resets).toBeGreaterThanOrEqual(2);
  });

  test("routes run events to their conversation without overwriting another selection", async () => {
    const fixture = createApiFixture([
      conversation("conv_a", "run_a", "completed", "2026-07-14T00:00:00.000Z"),
      conversation("conv_b", "run_b", "planning_model", "2026-07-14T01:00:00.000Z")
    ]);
    const bridge = createAgentConversationBridge(fixture.api);
    await bridge.load("project_01");
    await bridge.select("conv_a");
    const selectedBefore = bridge.getProps()?.selectedConversation;

    fixture.emit(runEvent("run_b", "tool_started", 2));
    await flushAsyncRouting();

    const state = bridge.getProps();
    expect(state?.selectedConversationId).toBe("conv_a");
    expect(state?.selectedConversation).toBe(selectedBefore);
    expect(state?.activeConversationId).toBe("conv_b");
    expect(state?.conversations.find((entry) => entry.conversationId === "conv_b")).toMatchObject({
      lastRunId: "run_b",
      lastRunStatus: "executing_read_tool"
    });
  });
});

function createApiFixture(initial: readonly AgentConversationSummary[]) {
  const byProject = new Map<string, AgentConversationSummary[]>([["project_01", [...initial]]]);
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  const listQueries: Record<string, unknown>[] = [];
  const readQueries: Record<string, unknown>[] = [];
  const createCommands: Record<string, unknown>[] = [];
  const archiveCommands: Record<string, unknown>[] = [];
  const restoreCommands: Record<string, unknown>[] = [];
  const searchQueries: Record<string, unknown>[] = [];

  const summaries = (projectId: string) => byProject.get(projectId) ?? [];
  const replace = (projectId: string, next: AgentConversationSummary) => {
    const values = summaries(projectId).filter(
      (entry) => entry.conversationId !== next.conversationId
    );
    byProject.set(projectId, [next, ...values]);
  };
  const detail = (projectId: string, conversationId: string): AgentConversationReadResult => {
    const summary = summaries(projectId).find((entry) => entry.conversationId === conversationId);
    if (summary === undefined) throw new Error(`Missing conversation ${conversationId}`);
    return {
      ...summary,
      runs:
        summary.lastRunId === undefined
          ? []
          : [runSnapshot(projectId, conversationId, summary.lastRunId, summary.lastRunStatus)],
      diagnostics: []
    };
  };

  const api = {
    agentConversations: {
      async create(command: Record<string, unknown>) {
        createCommands.push(command);
        const created = conversation(
          "conv_created",
          undefined,
          undefined,
          "2026-07-14T03:00:00.000Z"
        );
        replace(String(command["projectId"]), created);
        return { ok: true as const, value: created };
      },
      async list(query: Record<string, unknown>) {
        listQueries.push(query);
        const values = summaries(String(query["projectId"])).filter(
          (entry) => query["includeArchived"] === true || entry.status !== "archived"
        );
        return { ok: true as const, value: { items: values, diagnostics: [] } };
      },
      async read(query: Record<string, unknown>) {
        readQueries.push(query);
        return {
          ok: true as const,
          value: detail(String(query["projectId"]), String(query["conversationId"]))
        };
      },
      async archive(command: Record<string, unknown>) {
        archiveCommands.push(command);
        const projectId = String(command["projectId"]);
        const current = summaries(projectId).find(
          (entry) => entry.conversationId === command["conversationId"]
        );
        if (current === undefined) throw new Error("Missing archive target");
        const value = { ...current, status: "archived" as const, revision: current.revision + 1 };
        replace(projectId, value);
        return { ok: true as const, value };
      },
      async restore(command: Record<string, unknown>) {
        restoreCommands.push(command);
        const projectId = String(command["projectId"]);
        const current = summaries(projectId).find(
          (entry) => entry.conversationId === command["conversationId"]
        );
        if (current === undefined) throw new Error("Missing restore target");
        const value = { ...current, status: "active" as const, revision: current.revision + 1 };
        replace(projectId, value);
        return { ok: true as const, value };
      },
      async search(query: Record<string, unknown>) {
        searchQueries.push(query);
        const normalized = String(query["query"]).toLocaleLowerCase();
        const items = summaries(String(query["projectId"]))
          .filter((entry) => query["includeArchived"] === true || entry.status !== "archived")
          .filter((entry) => entry.title.toLocaleLowerCase().includes(normalized))
          .map((entry) => ({ ...entry, snippet: entry.title }));
        return { ok: true as const, value: { items, diagnostics: [] } };
      }
    },
    agentRuns: {
      async read(runId: string) {
        for (const [projectId, values] of byProject) {
          const owner = values.find((entry) => entry.lastRunId === runId);
          if (owner !== undefined) {
            return {
              ok: true as const,
              value: {
                snapshot: runSnapshot(projectId, owner.conversationId, runId, owner.lastRunStatus),
                events: []
              }
            };
          }
        }
        throw new Error(`Missing run ${runId}`);
      },
      onEvent(listener: (event: AgentRunEvent) => void) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      }
    }
  } as unknown as NovelStudioApi;

  return {
    api,
    listQueries,
    readQueries,
    createCommands,
    archiveCommands,
    restoreCommands,
    searchQueries,
    emit(event: AgentRunEvent) {
      for (const listener of eventListeners) listener(event);
    },
    setProjectConversations(projectId: string, conversations: AgentConversationSummary[]) {
      byProject.set(projectId, conversations);
    }
  };
}

function conversation(
  conversationId: string,
  lastRunId: string | undefined,
  lastRunStatus: string | undefined,
  updatedAt: string
): AgentConversationSummary {
  return {
    schemaVersion: "1.0",
    conversationId,
    projectId: "project_01",
    revision: 1,
    title: conversationId === "conv_01" ? "First conversation" : conversationId,
    status: "active",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt,
    runCount: lastRunId === undefined ? 0 : 1,
    summaryFreshness: "unavailable",
    ...(lastRunId === undefined ? {} : { lastRunId }),
    ...(lastRunStatus === undefined ? {} : { lastRunStatus })
  };
}

function runSnapshot(
  projectId: string,
  conversationId: string,
  runId: string,
  status: string | undefined
): AgentRunSnapshot {
  return {
    schemaVersion: "1.0",
    runId,
    conversationId,
    projectId,
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: `Request for ${conversationId}`,
    status: (status ?? "completed") as AgentRunSnapshot["status"],
    runRevision: 1,
    lastSequence: 1,
    startedAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    limits: {
      maxModelRounds: 20,
      maxToolCalls: 50,
      maxConsecutiveToolFailures: 3
    },
    providerCapabilitySnapshot: {
      profileId: "model_01",
      provider: "mock",
      modelName: "mock-model",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 32000,
      requiredContextTokens: 8000
    },
    pendingUserInputId: null,
    contextSnapshotId: null,
    sourcePlanId: null,
    sourcePlanRevision: null
  };
}

function runEvent(
  runId: string,
  type: AgentRunEvent["type"],
  sequence: number,
  detail?: AgentRunEvent["detail"]
): AgentRunEvent {
  return {
    schemaVersion: "1.0",
    runId,
    projectId: "project_01",
    sequence,
    runRevision: sequence,
    type,
    createdAt: `2026-07-14T02:00:0${String(sequence)}.000Z`,
    ...(detail === undefined ? {} : { detail })
  };
}

async function flushAsyncRouting(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function workspaceActions() {
  return {
    onCreate: () => undefined,
    onSelect: () => undefined,
    onArchive: () => undefined,
    onRestore: () => undefined,
    onSearchQueryChange: () => undefined,
    onFilterChange: () => undefined,
    onReturnToActive: () => undefined
  };
}

function agentRunProps(
  status: string,
  overrides: Partial<AgentRunPanelProps> = {}
): AgentRunPanelProps {
  return {
    projectId: "project_01",
    runId: "run_01",
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    status: status as AgentRunPanelProps["status"],
    assistantText: "Assistant response",
    events: [],
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined,
    ...overrides
  };
}

function changeSetReviewProps(open = true) {
  return {
    changeSet: {
      changeSetId: "change-set-01",
      revision: 1,
      checksum: "checksum-01",
      status: "pending",
      files: []
    },
    runRevision: 2,
    applying: false,
    stale: false,
    selectionPending: false,
    baseHashConflictPaths: [],
    dirtyTargetPaths: [],
    open,
    onSelectionChange: () => undefined,
    onApply: () => undefined,
    onReject: () => undefined,
    onReturn: () => undefined
  };
}

function rollbackReviewProps(open = true) {
  return {
    review: {
      schemaVersion: "1.0" as const,
      reviewId: "rollback-01",
      runId: "run_01",
      status: "pending" as const,
      sourceVersionGroupIds: ["versions-01"],
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      processedCommandIds: [],
      files: []
    },
    applying: false,
    open,
    decisions: {},
    onDecisionChange: () => undefined,
    onApply: () => undefined,
    onRetryFailed: () => undefined,
    onReturn: () => undefined
  };
}

function completedRollbackReviewProps() {
  const props = rollbackReviewProps(false);
  return {
    ...props,
    review: { ...props.review, status: "completed" as const }
  };
}

function readyPlanArtifact() {
  return {
    schemaVersion: "1.0" as const,
    planId: "plan-01",
    revision: 1,
    sourceRunId: "run-01",
    status: "ready" as const,
    operationMode: "planning" as const,
    contextMode: "writing" as const,
    goal: "Revise the opening",
    successCriteria: ["Opening reviewed"],
    nonGoals: [],
    facts: [],
    assumptions: [],
    openQuestions: [],
    targetRefs: [],
    steps: [{ stepId: "step-01", title: "Revise prose", verification: "Review diff" }],
    risks: [],
    verification: ["Run tests"],
    sourceRefs: ["chapter:chapter-01"],
    createdAt: "2026-07-13T00:00:00.000Z"
  };
}

function failedToolEvent(): AgentRunEvent {
  return {
    schemaVersion: "1.0",
    runId: "run_01",
    projectId: "project_01",
    sequence: 2,
    runRevision: 2,
    type: "tool_failed",
    createdAt: "2026-07-14T02:00:02.000Z",
    detail: { toolCallId: "tool-01", message: "Read failed" }
  };
}
