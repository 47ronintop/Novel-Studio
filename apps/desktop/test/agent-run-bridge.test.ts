import { describe, expect, test, vi } from "vitest";

import type {
  AgentRunEvent,
  AgentRunSnapshot,
  ChangeSet,
  ContextBudgetSnapshot
} from "@novel-studio/agent-engine";
import {
  createAgentRunDraftSession,
  type AgentRunDraftSessionRepository,
  type NovelStudioApi
} from "@novel-studio/application";
import { createUnifiedError, err, ok, type JsonObject } from "@novel-studio/shared";
import type { ChapterEditorProps, ModelSettingsPanelProps } from "@novel-studio/ui";

import { createAgentRunBridge } from "../src/renderer/agent-run-bridge.js";

const snapshot: AgentRunSnapshot = {
  schemaVersion: "1.0",
  runId: "run-bridge",
  projectId: "project-01",
  conversationId: "conversation-01",
  operationMode: "planning",
  contextMode: "writing",
  writePolicy: "write_before_confirmation",
  userRequest: "检查当前章节",
  status: "planning_model",
  runRevision: 1,
  lastSequence: 1,
  startedAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
  providerCapabilitySnapshot: {
    profileId: "profile-01",
    provider: "openai-compatible",
    modelName: "local-model",
    streaming: true,
    toolCalling: true,
    structuredArguments: true,
    contextWindow: 128000,
    requiredContextTokens: 8000
  },
  pendingUserInputId: null,
  contextSnapshotId: "context-run-bridge-1",
  sourcePlanId: null,
  sourcePlanRevision: null
};

const editor: ChapterEditorProps = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "chapter-01",
      type: "chapter",
      title: "第一章",
      order: 1,
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z"
    },
    body: "dirty editor body"
  },
  dirty: true,
  saveStatus: "Unsaved",
  versionHistory: []
};

const settings = {
  defaultProfileId: "profile-01",
  selectedProfileId: "profile-01",
  profiles: [
    {
      id: "profile-01",
      provider: "openai-compatible",
      displayName: "Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      modelName: "local-model",
      apiKeyRef: "secret://local/key",
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 60000
    }
  ],
  draft: {
    id: "profile-01",
    provider: "openai-compatible",
    displayName: "Local",
    baseUrl: "http://127.0.0.1:1234/v1",
    modelName: "local-model",
    apiKeyRefInput: "",
    temperature: "0.2",
    maxTokens: "4096",
    topP: "1",
    reasoningEffortEnabled: false,
    timeoutMs: "60000"
  },
  saveStatus: "idle" as const,
  modelDiscovery: {
    profileId: "profile-01",
    provider: "openai-compatible",
    status: "loaded" as const,
    models: [
      {
        id: "local-model",
        displayName: "local-model",
        provider: "openai-compatible",
        contextWindow: 128000
      }
    ],
    reasoningStrength: { status: "hidden" as const, reason: "not needed" }
  }
} as ModelSettingsPanelProps;

describe("Agent Run renderer bridge", () => {
  test("coalesces duplicate explicit retries and sends only the persisted target", async () => {
    const retryableSnapshot = {
      ...snapshot,
      runRevision: 8,
      lastSequence: 8,
      activeErrorId: "err_bridge_retry",
      recoveryState: "retryable"
    } as AgentRunSnapshot;
    const clearedSnapshot = {
      ...retryableSnapshot,
      runRevision: 9,
      lastSequence: 9,
      activeErrorId: null,
      recoveryState: "none"
    } as AgentRunSnapshot;
    const diagnostic = {
      schemaVersion: "1.0" as const,
      errorId: "err_bridge_retry",
      projectId: "project-01",
      runId: "run-bridge",
      sequence: 8,
      checkpointId: "checkpoint_bridge_01",
      category: "ModelProviderError",
      code: "AGENT_PROVIDER_DISCONNECTED",
      message: "The provider connection was interrupted.",
      recoverability: "retryable" as const,
      suggestedActions: ["Retry the model round or resume from the checkpoint."],
      provider: "openai-compatible",
      model: "local-model",
      redactedDetail: { requestId: "request_bridge_01" },
      recoveryState: "retryable" as const,
      retryTargets: [
        { kind: "model_round" as const, id: "model_round_bridge_01" },
        { kind: "checkpoint" as const, id: "checkpoint_bridge_01" }
      ],
      createdAt: "2026-07-17T12:00:00.000Z"
    };
    const commands: Record<string, unknown>[] = [];
    let legacyCalls = 0;
    let active = true;
    let finishRetry: (() => void) | undefined;
    const retryPending = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([active ? retryableSnapshot : clearedSnapshot]),
        read: async () =>
          ok({
            snapshot: active ? retryableSnapshot : clearedSnapshot,
            events: [],
            ...(active ? { diagnostic } : {})
          }),
        retryTarget: async (command: Record<string, unknown>) => {
          commands.push(structuredClone(command));
          await retryPending;
          active = false;
          return ok(clearedSnapshot);
        },
        retryStep: async () => {
          legacyCalls += 1;
          return ok(clearedSnapshot);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const loaded = await bridge.load("project-01");
    expect(loaded.diagnostic).toEqual(diagnostic);
    const first = bridge.retryTarget({ kind: "checkpoint", id: "checkpoint_bridge_01" });
    const duplicate = bridge.retryTarget({ kind: "checkpoint", id: "checkpoint_bridge_01" });

    await vi.waitFor(() => expect(commands).toHaveLength(1));
    finishRetry?.();
    const [retried, duplicateResult] = await Promise.all([first, duplicate]);

    expect(commands).toEqual([
      expect.objectContaining({
        runId: "run-bridge",
        projectId: "project-01",
        expectedRunRevision: 8,
        errorId: "err_bridge_retry",
        target: { kind: "checkpoint", id: "checkpoint_bridge_01" }
      })
    ]);
    expect(legacyCalls).toBe(0);
    expect(retried).not.toHaveProperty("diagnostic");
    expect(duplicateResult).toEqual(retried);
  });

  test("does not project raw failure event messages before the persisted diagnostic DTO", async () => {
    const failedSnapshot = {
      ...snapshot,
      runRevision: 3,
      lastSequence: 3,
      activeErrorId: "err_live_tool",
      recoveryState: "retryable"
    } as AgentRunSnapshot;
    const diagnostic = {
      schemaVersion: "1.0" as const,
      errorId: "err_live_tool",
      projectId: "project-01",
      runId: "run-bridge",
      sequence: 3,
      toolCallId: "call:read/1",
      category: "StorageError",
      code: "AGENT_READ_FAILED",
      message: "The safe persisted message.",
      recoverability: "retryable" as const,
      suggestedActions: ["Retry this tool call."],
      redactedDetail: {},
      recoveryState: "retryable" as const,
      retryTargets: [{ kind: "tool_call" as const, id: "call:read/1" }],
      createdAt: "2026-07-17T12:00:00.000Z"
    };
    let listener: ((event: AgentRunEvent) => void) | undefined;
    let diagnosticReady = false;
    const api = {
      agentRuns: {
        onEvent: (next: (event: AgentRunEvent) => void) => {
          listener = next;
          return () => undefined;
        },
        list: async () => ok([snapshot]),
        read: async () =>
          ok({
            snapshot: diagnosticReady ? failedSnapshot : snapshot,
            events: [],
            ...(diagnosticReady ? { diagnostic } : {})
          })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    listener?.(event(2, "tool_failed", { message: "raw event fallback" }));
    expect(bridge.getProps()?.errorMessage).toBeUndefined();
    listener?.(event(3, "run_failed", { message: "late raw event message" }));
    expect(bridge.getProps()?.errorMessage).toBeUndefined();

    diagnosticReady = true;
    listener?.(event(4, "error_recorded", { errorId: diagnostic.errorId }));
    await vi.waitFor(() => expect(bridge.getProps()?.diagnostic).toEqual(diagnostic));
    expect(bridge.getProps()?.errorMessage).toBeUndefined();
  });

  test("uses a controlled fallback when terminal diagnostic persistence fails", async () => {
    let listener: ((event: AgentRunEvent) => void) | undefined;
    const api = {
      agentRuns: {
        onEvent: (next: (event: AgentRunEvent) => void) => {
          listener = next;
          return () => undefined;
        },
        list: async () => ok([snapshot]),
        read: async () => ok({ snapshot, events: [] })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    listener?.(
      event(2, "run_failed", {
        message: "raw provider message must not render",
        diagnosticPersistenceFailed: true
      })
    );

    expect(bridge.getProps()?.errorMessage).toBe(
      "Agent run failed, and diagnostic details could not be saved."
    );
    expect(bridge.getProps()?.errorMessage).not.toContain("raw provider message");
  });

  test("clears run state and write acknowledgement when the selected conversation changes", async () => {
    const api = createApi({
      start: async () =>
        ok({
          ...snapshot,
          operationMode: "execution" as const,
          writePolicy: "user_preapproved_run" as const,
          status: "executing_read_tool" as const
        })
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", conversationId: "conversation-01", settings });
    await bridge.send("run in the first conversation");
    expect(bridge.getProps()).toMatchObject({
      runId: "run-bridge",
    });
    expect(bridge.getComposerProps()).toMatchObject({
      writePolicy: "write_before_confirmation"
    });

    const next = bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-02",
      settings
    });
    expect(next).toMatchObject({ status: "idle" });
    expect(bridge.getComposerProps()).toMatchObject({
      request: "",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false
    });
    expect(next.runId).toBeUndefined();
  });

  test("persists the active chapter as an explicit context draft ref on prepare", async () => {
    // The renderer submits only refs + intent; the server reads the chapter's content at start.
    let preparedCommand: Record<string, unknown> | undefined;
    let startCommand: Record<string, unknown> | undefined;
    const api = createApi({
      prepareStart: async (command) => {
        preparedCommand = command as Record<string, unknown>;
        return ok({
          runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
          contextDraft: { contextDraftId: "context-01", revision: 1 }
        });
      },
      start: async (command) => {
        startCommand = command as unknown as Record<string, unknown>;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });

    await bridge.send("检查当前章节");

    expect(preparedCommand).toMatchObject({
      projectId: "project-01",
      operationMode: "planning",
      userRequest: "检查当前章节",
      modelProfileId: "profile-01",
      contextRefs: [{ kind: "chapter", refId: "chapter:chapter-01", chapterId: "chapter-01" }]
    });
    // The start command carries only the draft reference — never resolved content.
    expect(startCommand).toMatchObject({
      projectId: "project-01",
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "checksum-01"
    });
    expect(startCommand).not.toHaveProperty("initialContextSources");
    expect(startCommand).not.toHaveProperty("providerCapabilitySnapshot");
  });

  test("binds execution auto-write policy to an explicit per-run acknowledgement", async () => {
    let received: Record<string, unknown> | undefined;
    const executionSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      writePolicy: "user_preapproved_run" as const
    };
    const api = createApi({
      prepareStart: async (command) => {
        received = command as Record<string, unknown>;
        return ok({
          runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
          contextDraft: { contextDraftId: "context-01", revision: 1 }
        });
      },
      start: async () => ok(executionSnapshot)
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });
    let composer = bridge.getComposerProps();
    composer?.onOperationModeChange("execution");
    composer = bridge.getComposerProps();
    composer?.onWritePolicyChange("user_preapproved_run");
    bridge.getComposerProps()?.onWritePolicyAcknowledgedChange(true);

    await bridge.send("自动修订当前章节");

    expect(received).toMatchObject({
      operationMode: "execution",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
  });

  test("defaults the second run to manual writes after a terminal auto-write command", async () => {
    const commands: Record<string, unknown>[] = [];
    const automaticCompleted = {
      ...snapshot,
      runId: "run-auto-01",
      operationMode: "execution" as const,
      writePolicy: "user_preapproved_run" as const,
      status: "completed" as const,
      runRevision: 8,
      lastSequence: 8,
      versionGroupId: "version-group-auto-01"
    };
    const manualStarted = {
      ...automaticCompleted,
      runId: "run-manual-02",
      writePolicy: "write_before_confirmation" as const,
      status: "executing_model" as const,
      runRevision: 1,
      lastSequence: 1,
      versionGroupId: undefined
    };
    let current = automaticCompleted;
    const historicalEvents = [
      {
        ...event(7, "change_set_auto_approved", {
          changeSetId: "change-set-auto-01",
          revision: 1
        }),
        runId: "run-auto-01"
      },
      {
        ...event(8, "write_applied", { versionGroupId: "version-group-auto-01" }),
        runId: "run-auto-01"
      }
    ];
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        prepareStart: async (command: Record<string, unknown>) => {
          // Intent (mode + write policy) now lives on the prepare command; record it for assertions.
          commands.push(structuredClone(command));
          return ok({
            runDraft: { runDraftId: `draft-0${commands.length}`, revision: 1, checksum: "cs" },
            contextDraft: { contextDraftId: "context-01", revision: 1 }
          });
        },
        start: async () => {
          current = commands.length === 1 ? automaticCompleted : manualStarted;
          return ok(current);
        },
        read: async () =>
          ok({
            snapshot: current,
            events: current.runId === automaticCompleted.runId ? historicalEvents : []
          })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });
    let composer = bridge.getComposerProps();
    composer?.onOperationModeChange("execution");
    composer = bridge.getComposerProps();
    composer?.onWritePolicyChange("user_preapproved_run");
    bridge.getComposerProps()?.onWritePolicyAcknowledgedChange(true);

    const props = await bridge.send("自动修订当前章节");

    expect(bridge.getComposerProps()?.writePolicy).toBe("write_before_confirmation");
    expect(bridge.getComposerProps()?.writePolicyAcknowledged).toBe(false);
    expect(props.events.map((entry) => entry.type)).toEqual([
      "change_set_auto_approved",
      "write_applied"
    ]);

    await bridge.send("继续检查下一章");

    expect(commands[1]).toMatchObject({
      operationMode: "execution",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false
    });
  });

  test("resets next-run auto-write authorization when a terminal event arrives", async () => {
    let listener: ((event: AgentRunEvent) => void) | undefined;
    const activeAutomatic = {
      ...snapshot,
      operationMode: "execution" as const,
      writePolicy: "user_preapproved_run" as const,
      status: "executing_model" as const
    };
    const api = {
      agentRuns: {
        onEvent: (nextListener: (event: AgentRunEvent) => void) => {
          listener = nextListener;
          return () => undefined;
        },
        prepareStart: async () =>
          ok({
            runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
            contextDraft: { contextDraftId: "context-01", revision: 1 }
          }),
        start: async () => ok(activeAutomatic),
        read: async () => ok({ snapshot: activeAutomatic, events: [] })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });
    let composer = bridge.getComposerProps();
    composer?.onOperationModeChange("execution");
    composer = bridge.getComposerProps();
    composer?.onWritePolicyChange("user_preapproved_run");
    bridge.getComposerProps()?.onWritePolicyAcknowledgedChange(true);
    await bridge.send("自动修订当前章节");

    listener?.({
      ...event(2, "run_completed", {}),
      runRevision: 2
    });

    expect(bridge.getComposerProps()?.writePolicy).toBe("write_before_confirmation");
    expect(bridge.getComposerProps()?.writePolicyAcknowledged).toBe(false);
    expect(bridge.getProps()?.events.at(-1)?.type).toBe("run_completed");
  });

  test("restores an active preapproved run as already acknowledged", async () => {
    const activeAutomatic = {
      ...snapshot,
      operationMode: "execution" as const,
      writePolicy: "user_preapproved_run" as const,
      status: "executing_model" as const
    };
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([activeAutomatic]),
        read: async () => ok({ snapshot: activeAutomatic, events: [] })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    await bridge.load("project-01");

    expect(bridge.getComposerProps()?.writePolicy).toBe("user_preapproved_run");
    expect(bridge.getComposerProps()?.writePolicyAcknowledged).toBe(true);
  });

  test("only passes execution policy for an acknowledged automatic plan approval", async () => {
    const commands: Record<string, unknown>[] = [];
    const planReadySnapshot = {
      ...snapshot,
      status: "plan_ready" as const,
      runRevision: 4,
      lastSequence: 4
    };
    const artifact = readyPlanArtifact();
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([planReadySnapshot]),
        read: async () => ok({ snapshot: planReadySnapshot, events: [], planArtifact: artifact }),
        decidePlan: async (command: Record<string, unknown>) => {
          commands.push(structuredClone(command));
          return ok(planReadySnapshot);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    expect(bridge.getProps()).not.toHaveProperty("onDecidePlan");
    expect(bridge.getPlanReviewProps()?.plan).toEqual(artifact);

    await bridge.decidePlan("approve", {
      executionContextMode: "writing",
      executionWritePolicy: "write_before_confirmation"
    });
    await bridge.decidePlan("approve", {
      executionContextMode: "general_file",
      executionWritePolicy: "user_preapproved_run",
      executionWritePolicyAcknowledged: true
    });

    expect(commands[0]).toMatchObject({
      decision: "approve",
      executionContextMode: "writing"
    });
    expect(commands[0]).not.toHaveProperty("executionWritePolicy");
    expect(commands[0]).not.toHaveProperty("executionWritePolicyAcknowledged");
    expect(commands[1]).toMatchObject({
      decision: "approve",
      executionContextMode: "general_file",
      executionWritePolicy: "user_preapproved_run",
      executionWritePolicyAcknowledged: true
    });
  });

  test("projects the bound permission summary and persisted plan execution IDs, then decides a material deviation", async () => {
    const commands: Record<string, unknown>[] = [];
    const executionSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_plan_revision" as const,
      runRevision: 9,
      lastSequence: 9,
      permissionSummaryId: "permission-summary-01",
      permissionSummaryChecksum: "p".repeat(64),
      planExecutionId: "plan-execution-01",
      planExecutionRevision: 3,
      sourcePlanId: "plan-01",
      sourcePlanRevision: 1
    };
    const plan = {
      ...readyPlanArtifact(),
      sourceRunId: executionSnapshot.runId,
      status: "executing" as const
    };
    const planExecution = {
      schemaVersion: "1.0" as const,
      planExecutionId: "plan-execution-01",
      runId: executionSnapshot.runId,
      planId: "plan-01",
      planRevision: 1,
      handoffContextMode: "writing" as const,
      handoffWritePolicy: "write_before_confirmation" as const,
      revision: 3,
      steps: [
        {
          stepId: "step-01",
          title: "修订正文",
          status: "running" as const,
          startedAt: "2026-07-17T00:00:00.000Z",
          completedAt: null,
          verification: [],
          deviationKind: "material" as const,
          blockedReason: null,
          checkpointId: "checkpoint-01",
          eventSequence: 8
        }
      ]
    };
    const permissionSummary = {
      schemaVersion: "1.0" as const,
      permissionSummaryId: "permission-summary-01",
      projectId: "project-01",
      runDraftId: "draft-01",
      runId: executionSnapshot.runId,
      contextMode: "writing" as const,
      writePolicy: "write_before_confirmation" as const,
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter"],
      proposalCapabilities: ["propose_chapter_write"],
      forbiddenCapabilities: ["shell", "git", "network"],
      checksum: "p".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    };
    const revisionRequested = {
      ...event(9, "plan_revision_requested", {
        requestId: "request-01",
        planId: "plan-01",
        planRevision: 2,
        affectedStepIds: ["step-01"],
        discovery: "发现目标还涉及第二章",
        proposal: "把第二章纳入计划并重新核对"
      }),
      schemaVersion: "1.1" as const,
      runRevision: 9
    };
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([executionSnapshot]),
        read: async () =>
          ok({
            snapshot: executionSnapshot,
            events: [revisionRequested],
            planArtifact: plan,
            planExecution
          }),
        readPermissionSummary: async (query: Record<string, unknown>) => {
          expect(query).toEqual({
            kind: "run",
            projectId: "project-01",
            runId: executionSnapshot.runId,
            permissionSummaryId: "permission-summary-01"
          });
          return ok(permissionSummary);
        },
        decidePlanRevision: async (command: Record<string, unknown>) => {
          commands.push(structuredClone(command));
          return ok({ ...executionSnapshot, status: "executing_model" as const, runRevision: 10 });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    await bridge.load("project-01");

    expect(bridge.getComposerProps()?.permission?.summary).toEqual(permissionSummary);
    expect(bridge.getProps()?.planExecution?.record).toEqual(planExecution);
    expect(bridge.getProps()?.planExecution?.revisionRequest).toMatchObject({
      requestId: "request-01",
      planExecutionId: "plan-execution-01",
      affectedStepIds: ["step-01"],
      originalPlan: "修订当前章节",
      discovery: "发现目标还涉及第二章",
      proposal: "把第二章纳入计划并重新核对"
    });

    bridge.getProps()?.planExecution?.onDecideRevision("approve");
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      runId: executionSnapshot.runId,
      expectedRunRevision: 9,
      requestId: "request-01",
      planId: "plan-01",
      planRevision: 2,
      decision: "approve"
    });
  });

  test("retries a missing bound permission summary from run facts when the menu opens", async () => {
    const executionSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "executing_model" as const,
      permissionSummaryId: "permission-summary-retry",
      permissionSummaryChecksum: "r".repeat(64)
    };
    const permissionSummary = {
      schemaVersion: "1.0" as const,
      permissionSummaryId: "permission-summary-retry",
      projectId: "project-01",
      runDraftId: "draft-01",
      runId: executionSnapshot.runId,
      contextMode: "writing" as const,
      writePolicy: "write_before_confirmation" as const,
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter"],
      proposalCapabilities: ["propose_chapter_write"],
      forbiddenCapabilities: ["shell", "git", "network"],
      checksum: "r".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    };
    const permissionQueries: Record<string, unknown>[] = [];
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([executionSnapshot]),
        read: async () => ok({ snapshot: executionSnapshot, events: [] }),
        readPermissionSummary: async (query: Record<string, unknown>) => {
          permissionQueries.push(structuredClone(query));
          return ok(permissionQueries.length === 1 ? undefined : permissionSummary);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");
    expect(permissionQueries).toHaveLength(1);
    expect(bridge.getComposerProps()?.permission?.summary).toBeUndefined();

    bridge.getComposerProps()?.permission?.onOpen();

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.permission?.summary).toEqual(permissionSummary)
    );
    expect(permissionQueries).toHaveLength(2);
    expect(permissionQueries[1]).toEqual({
      kind: "run",
      projectId: "project-01",
      runId: executionSnapshot.runId,
      permissionSummaryId: "permission-summary-retry"
    });
  });

  test("rejects a start with no selected model profile before calling prepare/start", async () => {
    // Capability + context-window validation is now server-authoritative; the only client-side
    // guard is that a model profile is actually selected. Without one, neither prepare nor start run.
    let prepared = false;
    let called = false;
    const api = createApi({
      prepareStart: async () => {
        prepared = true;
        return ok({
          runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
          contextDraft: { contextDraftId: "context-01", revision: 1 }
        });
      },
      start: async () => {
        called = true;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: { ...settings, profiles: [], selectedProfileId: undefined, defaultProfileId: "" }
    });

    const props = await bridge.send("检查当前章节");

    expect(prepared).toBe(false);
    expect(called).toBe(false);
    expect(props?.errorMessage).toContain("cannot start an Agent run");
  });

  test("uses the current editor buffer for context refresh without saving", async () => {
    const calls: string[] = [];
    const api = createApi({
      refreshContext: async (command) => {
        calls.push(
          `${command.decision}:${command.sourceRefs?.join(",") ?? ""}:${
            command.currentSources?.[0]?.content ?? ""
          }`
        );
        return ok({ ...snapshot, status: "planning_model", runRevision: 2 });
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });
    await bridge.send("检查当前章节");
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: { ...editor, chapter: { ...editor.chapter, body: "new dirty body" } },
      settings
    });

    await bridge.refreshContext("refresh");

    expect(calls).toEqual(["refresh:chapter:chapter-01:new dirty body"]);
  });

  test("re-reads an immutable selection revision before idempotent apply", async () => {
    let pending = changeSet(4, "change-set-checksum-r4", true);
    const decisions: Array<Record<string, unknown>> = [];
    const writeSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_write_approval" as const,
      runRevision: 12
    };
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([writeSnapshot]),
        read: async () => ok({ snapshot: writeSnapshot, events: [], changeSet: pending }),
        decideChangeSet: async (command: Record<string, unknown>) => {
          decisions.push(structuredClone(command));
          if (command["decision"] === "update_selection") {
            pending = changeSet(5, "change-set-checksum-r5", false);
          }
          return ok({ ...writeSnapshot, runRevision: writeSnapshot.runRevision + decisions.length });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api) as AgentRunBridgeWithWrites;
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    expect(typeof bridge.updateChangeSetSelection).toBe("function");
    expect(typeof bridge.applyChangeSet).toBe("function");
    if (bridge.updateChangeSetSelection === undefined || bridge.applyChangeSet === undefined) return;

    const selected = await bridge.updateChangeSetSelection({
      files: [
        {
          relativePath: "chapters/ch_03.md",
          selected: false,
          selectedHunkIds: []
        }
      ]
    });
    expect(decisions[0]).toMatchObject({
      decision: "update_selection",
      changeSetId: "change-set-01",
      revision: 4,
      checksum: "change-set-checksum-r4"
    });
    expect(selected.changeSetReview?.changeSet).toMatchObject({
      revision: 5,
      checksum: "change-set-checksum-r5"
    });

    await Promise.all([bridge.applyChangeSet(), bridge.applyChangeSet()]);
    expect(decisions.filter((command) => command["decision"] === "apply_selected")).toHaveLength(1);
    expect(decisions.at(-1)).toMatchObject({
      decision: "apply_selected",
      revision: 5,
      checksum: "change-set-checksum-r5"
    });
    expect(JSON.stringify(decisions)).not.toContain("candidateContent");
  });

  test("hydrates persisted hash-conflict events after a failed apply command", async () => {
    const awaitingSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_write_approval" as const,
      runRevision: 14,
      lastSequence: 14
    };
    const failedSnapshot = {
      ...awaitingSnapshot,
      status: "failed" as const,
      runRevision: 16,
      lastSequence: 16
    };
    let readCount = 0;
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([awaitingSnapshot]),
        read: async () => {
          readCount += 1;
          return ok({
            snapshot: readCount === 1 ? awaitingSnapshot : failedSnapshot,
            events:
              readCount === 1
                ? []
                : [event(15, "write_failed", { baseHashConflictPaths: ["chapters/ch_03.md"] })],
            changeSet: changeSet(4, "change-set-checksum-r4", true)
          });
        },
        decideChangeSet: async () => ({
          ok: false as const,
          error: {
            schemaVersion: "1.0" as const,
            errorId: "error-base-conflict",
            code: "AGENT_WRITE_BASE_CONFLICT",
            category: "ValidationError" as const,
            message: "The target changed.",
            recoverability: "user-action" as const,
            suggestedAction: "Refresh the Change Set.",
            traceId: "agent-run-bridge-test",
            createdAt: "2026-07-13T00:00:00.000Z"
          },
          latestSnapshot: failedSnapshot
        })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    const props = await bridge.applyChangeSet();

    expect(readCount).toBe(2);
    expect(props.changeSetReview?.baseHashConflictPaths).toEqual(["chapters/ch_03.md"]);
  });

  test("prefers a persisted diagnostic over duplicate command feedback after failed apply", async () => {
    const awaitingSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_write_approval" as const,
      runRevision: 14,
      lastSequence: 14
    };
    const failedSnapshot = {
      ...awaitingSnapshot,
      status: "failed" as const,
      runRevision: 16,
      lastSequence: 16,
      activeErrorId: "error-partial-failure",
      recoveryState: "recovery_review" as const
    };
    const diagnostic = {
      schemaVersion: "1.0" as const,
      errorId: "error-partial-failure",
      projectId: "project-01",
      runId: "run-bridge",
      sequence: 16,
      category: "StorageError",
      code: "AGENT_WRITE_PARTIAL_FAILURE",
      message: "Agent writing failed and applied files were rolled back.",
      recoverability: "user-action" as const,
      suggestedActions: ["Open recovery review."],
      redactedDetail: { recoveryJournal: { versionGroupId: "version-group-partial" } },
      recoveryState: "recovery_review" as const,
      retryTargets: [],
      createdAt: "2026-07-17T12:00:00.000Z"
    };
    let readCount = 0;
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([awaitingSnapshot]),
        read: async () => {
          readCount += 1;
          return ok({
            snapshot: readCount === 1 ? awaitingSnapshot : failedSnapshot,
            events: [],
            changeSet: changeSet(4, "change-set-checksum-r4", true),
            ...(readCount === 1 ? {} : { diagnostic })
          });
        },
        decideChangeSet: async () => ({
          ok: false as const,
          error: {
            schemaVersion: "1.0" as const,
            errorId: "error-partial-failure",
            code: "AGENT_WRITE_PARTIAL_FAILURE",
            category: "StorageError" as const,
            message: "Agent writing failed and applied files were rolled back.",
            recoverability: "user-action" as const,
            suggestedAction: "Open recovery review.",
            traceId: "agent-run-bridge-test",
            createdAt: "2026-07-17T12:00:00.000Z"
          },
          latestSnapshot: failedSnapshot
        })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    const props = await bridge.applyChangeSet();

    expect(props.diagnostic).toEqual(diagnostic);
    expect(props.errorMessage).toBeUndefined();
  });

  test.each([
    {
      label: "a write failure with only code and relativePath",
      persistedEvent: event(15, "write_failed", {
        code: "AGENT_WRITE_BASE_CONFLICT",
        relativePath: "chapters/ch_03.md"
      })
    },
    {
      label: "a stale chapter context source bound to the pending Change Set",
      persistedEvent: event(15, "context_stale", {
        staleRefs: ["chapter:ch_03"],
        changeSetId: "change-set-01",
        revision: 4,
        checksum: "change-set-checksum-r4"
      })
    }
  ])("surfaces base conflicts from $label", async ({ persistedEvent }) => {
    const failedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_context_refresh" as const,
      runRevision: 15,
      lastSequence: 15
    };
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([failedSnapshot]),
        read: async () =>
          ok({
            snapshot: failedSnapshot,
            events: [persistedEvent],
            changeSet: { ...changeSet(4, "change-set-checksum-r4", true), status: "stale" }
          })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const props = await bridge.load("project-01");

    expect(props.changeSetReview?.baseHashConflictPaths).toEqual(["chapters/ch_03.md"]);
  });

  test("clears an older hash conflict at the next Change Set revision boundary", async () => {
    const writeSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "awaiting_write_approval" as const,
      runRevision: 14
    };
    const events: AgentRunEvent[] = [
      event(12, "write_failed", { baseHashConflictPaths: ["chapters/ch_03.md"] }),
      event(14, "change_set_ready", {
        changeSetId: "change-set-01",
        revision: 5,
        checksum: "change-set-checksum-r5"
      })
    ];
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([writeSnapshot]),
        read: async () =>
          ok({
            snapshot: writeSnapshot,
            events,
            changeSet: changeSet(5, "change-set-checksum-r5", true)
          })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const props = await bridge.load("project-01");

    expect(props.changeSetReview?.baseHashConflictPaths).toEqual([]);
  });

  test("restores the latest completed applied run without selecting a newer terminal run that has no Change Set", async () => {
    const appliedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "completed" as const,
      versionGroupId: "version-group-01",
      updatedAt: "2026-07-13T00:00:01.000Z"
    };
    const terminalWithoutChangeSet = {
      ...snapshot,
      runId: "run-without-change-set",
      status: "completed" as const,
      versionGroupId: null,
      updatedAt: "2026-07-13T00:00:02.000Z"
    };
    const readRunIds: string[] = [];
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([terminalWithoutChangeSet, appliedSnapshot]),
        read: async (runId: string) => {
          readRunIds.push(runId);
          return ok({
            snapshot: appliedSnapshot,
            events: [event(20, "write_applied", { versionGroupId: "version-group-01" })],
            changeSet: { ...changeSet(4, "change-set-checksum-r4", true), status: "applied" }
          });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const props = await bridge.load("project-01");

    expect(readRunIds).toEqual(["run-bridge"]);
    expect(props.changeSetReview?.changeSet.status).toBe("applied");
    expect(props.changeSetReview?.canUndoRun).toBe(true);
  });

  test("coalesces double-click run undo into one command", async () => {
    const appliedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "completed" as const,
      versionGroupId: "version-group-01",
      runRevision: 20,
      lastSequence: 20
    };
    const undoCommands: Array<Record<string, unknown>> = [];
    let finishUndo: (() => void) | undefined;
    const undoPending = new Promise<void>((resolve) => {
      finishUndo = resolve;
    });
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([appliedSnapshot]),
        read: async () =>
          ok({
            snapshot: appliedSnapshot,
            events: [event(20, "write_applied", { versionGroupId: "version-group-01" })],
            changeSet: { ...changeSet(4, "change-set-checksum-r4", true), status: "applied" }
          }),
        undoRun: async (command: Record<string, unknown>) => {
          undoCommands.push(structuredClone(command));
          await undoPending;
          return ok({ ...appliedSnapshot, runRevision: 22, lastSequence: 22 });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    const first = bridge.undoRun();
    const duplicate = bridge.undoRun();
    await Promise.resolve();
    finishUndo?.();
    await Promise.all([first, duplicate]);

    expect(undoCommands).toHaveLength(1);
    expect(undoCommands[0]).toMatchObject({
      action: "request",
      runId: "run-bridge",
      projectId: "project-01",
      expectedRunRevision: 20
    });
  });

  test("ignores a stale second undo click after the completed undo is hydrated", async () => {
    const appliedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "completed" as const,
      versionGroupId: "version-group-01",
      runRevision: 20,
      lastSequence: 20
    };
    const undoneSnapshot = {
      ...appliedSnapshot,
      runRevision: 22,
      lastSequence: 22
    };
    const undoCommands: Array<Record<string, unknown>> = [];
    let undone = false;
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([undone ? undoneSnapshot : appliedSnapshot]),
        read: async () =>
          ok({
            snapshot: undone ? undoneSnapshot : appliedSnapshot,
            events: undone
              ? [
                  event(20, "write_applied", { versionGroupId: "version-group-01" }),
                  event(22, "run_undone", { versionGroupId: "version-group-01" })
                ]
              : [event(20, "write_applied", { versionGroupId: "version-group-01" })],
            changeSet: { ...changeSet(4, "change-set-checksum-r4", true), status: "applied" }
          }),
        undoRun: async (command: Record<string, unknown>) => {
          undoCommands.push(structuredClone(command));
          undone = true;
          return ok(undoneSnapshot);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    await bridge.undoRun();
    await bridge.undoRun();

    expect(undoCommands).toHaveLength(1);
    expect(bridge.getProps()?.canUndoRun).toBe(false);
  });

  test("binds rollback review decisions and failed-only retry to the durable review id", async () => {
    const appliedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "completed" as const,
      versionGroupId: "version-group-01",
      runRevision: 20,
      lastSequence: 20
    };
    const undoCommands: Record<string, unknown>[] = [];
    const rollbackReview = {
      schemaVersion: "1.0",
      reviewId: "rollback-review-01",
      runId: "run-bridge",
      status: "partial_failure",
      sourceVersionGroupIds: ["version-group-01"],
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:01:00.000Z",
      processedCommandIds: [],
      files: [
        {
          relativePath: "notes/conflict.md",
          assetType: "text",
          baselineContent: "before",
          baselineChecksum: "a".repeat(64),
          baselineVersionId: "ver-before",
          runLastWriteContent: "agent",
          runLastWriteChecksum: "b".repeat(64),
          reviewedCurrentContent: "user",
          reviewedCurrentChecksum: "c".repeat(64),
          diff: {
            currentToLastWrite: "current -> ai",
            currentToBaseline: "current -> baseline",
            lastWriteToBaseline: "ai -> baseline"
          },
          status: "conflict"
        },
        {
          relativePath: "notes/failed.md",
          assetType: "text",
          baselineContent: "before failed",
          baselineChecksum: "d".repeat(64),
          baselineVersionId: "ver-failed",
          runLastWriteContent: "agent failed",
          runLastWriteChecksum: "e".repeat(64),
          reviewedCurrentContent: "user failed",
          reviewedCurrentChecksum: "f".repeat(64),
          diff: {
            currentToLastWrite: "current -> ai",
            currentToBaseline: "current -> baseline",
            lastWriteToBaseline: "ai -> baseline"
          },
          decision: "restore_baseline",
          status: "failed"
        }
      ]
    };
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([appliedSnapshot]),
        read: async () =>
          ok({ snapshot: appliedSnapshot, events: [], rollbackReview }),
        undoRun: async (command: Record<string, unknown>) => {
          undoCommands.push(structuredClone(command));
          return ok({ ...appliedSnapshot, runRevision: appliedSnapshot.runRevision + 2 });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    let props = await bridge.load("project-01");

    props.rollbackReview?.onReturn();
    expect(bridge.getProps()?.rollbackReview?.open).toBe(false);
    bridge.getProps()?.rollbackReview?.onOpen?.();
    expect(bridge.getProps()?.rollbackReview?.open).toBe(true);

    props.rollbackReview?.onDecisionChange("notes/conflict.md", "keep_current");
    props = bridge.getProps() ?? props;
    props.rollbackReview?.onApply();
    await vi.waitFor(() => expect(undoCommands).toHaveLength(1));
    props.rollbackReview?.onRetryFailed();
    await vi.waitFor(() => expect(undoCommands).toHaveLength(2));

    expect(undoCommands).toMatchObject([
      {
        action: "resolve",
        reviewId: "rollback-review-01",
        decisions: [{ relativePath: "notes/conflict.md", decision: "keep_current" }]
      },
      {
        action: "resolve",
        reviewId: "rollback-review-01",
        retryFailedOnly: true
      }
    ]);
  });

  test("clears decisions when a durable rollback review refreshes in place", async () => {
    const appliedSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      status: "completed" as const,
      versionGroupId: "version-group-01",
      runRevision: 20,
      lastSequence: 20
    };
    const initialReview = rollbackReview("user edit", "2026-07-13T00:01:00.000Z");
    const refreshedReview = rollbackReview("newer edit", "2026-07-13T00:02:00.000Z");
    let currentSnapshot = appliedSnapshot;
    let currentReview = initialReview;
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([appliedSnapshot]),
        read: async () =>
          ok({ snapshot: currentSnapshot, events: [], rollbackReview: currentReview }),
        undoRun: async () => {
          currentSnapshot = { ...appliedSnapshot, runRevision: 22, lastSequence: 22 };
          currentReview = refreshedReview;
          return ok(currentSnapshot);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });
    let props = await bridge.load("project-01");
    props.rollbackReview?.onDecisionChange("notes/conflict.md", "restore_baseline");
    props = bridge.getProps() ?? props;
    expect(props.rollbackReview?.decisions).toEqual({
      "notes/conflict.md": "restore_baseline"
    });

    props.rollbackReview?.onApply();
    await vi.waitFor(() =>
      expect(bridge.getProps()?.rollbackReview?.review.updatedAt).toBe(
        "2026-07-13T00:02:00.000Z"
      )
    );

    expect(bridge.getProps()?.rollbackReview?.decisions).toEqual({});
  });
});

describe("Agent Run renderer bridge — draft-backed composer", () => {
  const [defaultProfile] = settings.profiles;
  if (defaultProfile === undefined) throw new Error("Expected a default model profile fixture");
  const draftSettings = {
    ...settings,
    profiles: [
      defaultProfile,
      {
        id: "profile-02",
        provider: "anthropic",
        displayName: "Claude Writer",
        baseUrl: "",
        modelName: "claude-writer",
        apiKeyRef: "secret://claude/key",
        temperature: 0.3,
        maxTokens: 8192,
        timeoutMs: 60000
      }
    ],
    modelDiscovery: {
      profileId: "profile-01",
      provider: "openai-compatible",
      status: "loaded" as const,
      models: [
        { id: "local-model", displayName: "local-model", provider: "openai-compatible", contextWindow: 128000 }
      ],
      reasoningStrength: {
        status: "available" as const,
        providerParamName: "reasoning_effort" as const,
        allowedValues: ["low", "medium", "high"] as const,
        defaultValue: "medium" as const
      }
    }
  } as ModelSettingsPanelProps;

  test("loads a draft-backed composer with model, reasoning, and chapter reference", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    const composer = bridge.getComposerProps();
    expect(composer?.model?.selectedProfileId).toBe("profile-01");
    expect(composer?.model?.profiles.map((profile) => profile.id)).toEqual([
      "profile-01",
      "profile-02"
    ]);
    expect(composer?.reasoning).toMatchObject({ visible: true, current: "medium" });
    expect(composer?.references?.chips.map((chip) => chip.refId)).toEqual(["chapter:chapter-01"]);
    expect(composer?.contextStatus?.state).toBe("normal");
  });

  test("loads the selected conversation draft when settings arrive after the conversation", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor
    });

    expect(bridge.getComposerProps()?.model).toBeUndefined();
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
  });

  test("normalizes a persisted writing draft before sending from an engineering workspace", async () => {
    const { api } = createDraftApi();
    await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        contextRefs: []
      }
    } as never);

    let preparedCommand: Record<string, unknown> | undefined;
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };

    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "engineeringWorkspace",
      conversationId: "conversation-01",
      fileEditor: {
        path: "src/index.ts",
        fileName: "index.ts",
        content: "export {};",
        dirty: false,
        saveStatus: "Saved"
      }
    });
    expect(bridge.getComposerProps()?.model).toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "engineeringWorkspace",
      conversationId: "conversation-01",
      fileEditor: {
        path: "src/index.ts",
        fileName: "index.ts",
        content: "export {};",
        dirty: false,
        saveStatus: "Saved"
      },
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    await bridge.send("检查工程文件");

    expect(preparedCommand).toMatchObject({ contextMode: "general_file" });
    const persisted = await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        contextRefs: []
      }
    } as never);
    expect(persisted).toMatchObject({
      ok: true,
      value: { runDraft: { contextMode: "general_file" } }
    });
  });

  test("loads and normalizes an engineering draft when settings are ready on first sync", async () => {
    const { api } = createDraftApi();
    await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        contextRefs: []
      }
    } as never);

    let preparedCommand: Record<string, unknown> | undefined;
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };

    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "engineeringWorkspace",
      conversationId: "conversation-01",
      fileEditor: {
        path: "src/index.ts",
        fileName: "index.ts",
        content: "export {};",
        dirty: false,
        saveStatus: "Saved"
      },
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    await bridge.send("检查工程文件");

    expect(preparedCommand).toMatchObject({ contextMode: "general_file" });
    const persisted = await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        contextRefs: []
      }
    } as never);
    expect(persisted).toMatchObject({
      ok: true,
      value: { runDraft: { contextMode: "general_file" } }
    });
  });

  test("reloads the selected conversation draft after clearing an empty run", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());

    await bridge.loadRun(undefined);

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
  });

  test("does not duplicate an in-flight draft initialization while clearing an empty run", async () => {
    let releaseFirstRead: (() => void) | undefined;
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    const { api } = createDraftApi();
    const readRunDraft = api.agentRuns.readRunDraft;
    let readCount = 0;
    api.agentRuns.readRunDraft = async (command) => {
      readCount += 1;
      if (readCount === 1) {
        await firstRead;
        return readRunDraft(command);
      }
      return err(
        createUnifiedError({
          code: "AGENT_RUN_DRAFT_CONFLICT",
          category: "ConflictError",
          message: "Draft initialization raced.",
          recoverability: "retryable",
          suggestedAction: "Retry after the first initialization completes.",
          traceId: "agent-run-bridge-test"
        })
      );
    };
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(readCount).toBe(1));

    await bridge.loadRun(undefined);
    releaseFirstRead?.();

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    expect(readCount).toBe(1);
  });

  test("writes a model selection to the draft and re-previews the budget", async () => {
    const { api, budgetCalls } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    const before = budgetCalls.length;

    bridge.getComposerProps()?.model?.onSelect("profile-02");

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.model?.selectedProfileId).toBe("profile-02")
    );
    expect(budgetCalls.length).toBeGreaterThan(before);
  });

  test("selects a reasoning effort and persists it to the draft", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.reasoning?.visible).toBe(true));

    bridge.getComposerProps()?.reasoning?.onSelect("high");

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.reasoning?.current).toBe("high")
    );
  });

  test("refreshes an opened server permission summary after the draft policy changes", async () => {
    const { api, permissionCalls } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    bridge.getComposerProps()?.onOperationModeChange("execution");
    await vi.waitFor(() => expect(bridge.getComposerProps()?.operationMode).toBe("execution"));
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false));

    bridge.getComposerProps()?.permission?.onOpen();
    await vi.waitFor(() => expect(permissionCalls).toHaveLength(1));
    expect(bridge.getComposerProps()?.permission?.summary?.writePolicy).toBe(
      "write_before_confirmation"
    );

    bridge.getComposerProps()?.onWritePolicyChange("user_preapproved_run");

    await vi.waitFor(() => expect(permissionCalls).toHaveLength(2));
    expect(permissionCalls[1]).toMatchObject({ runDraftRevision: 3 });
    expect(bridge.getComposerProps()?.permission?.summary?.writePolicy).toBe(
      "user_preapproved_run"
    );
    expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false);

    bridge.getComposerProps()?.onOperationModeChange("planning");

    await vi.waitFor(() => expect(bridge.getComposerProps()?.operationMode).toBe("planning"));
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false));
    expect(permissionCalls).toHaveLength(2);
    expect(bridge.getComposerProps()?.permission?.summary).toBeUndefined();
  });

  test("keeps the current permission revision when an earlier preview resolves late", async () => {
    let releaseFirstPermissionRead: (() => void) | undefined;
    const firstPermissionRead = new Promise<void>((resolve) => {
      releaseFirstPermissionRead = resolve;
    });
    const { api, permissionCalls } = createDraftApi({ firstPermissionRead });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    bridge.getComposerProps()?.onOperationModeChange("execution");
    await vi.waitFor(() => expect(bridge.getComposerProps()?.operationMode).toBe("execution"));

    bridge.getComposerProps()?.permission?.onOpen();
    await vi.waitFor(() => expect(permissionCalls).toHaveLength(1));
    bridge.getComposerProps()?.onWritePolicyChange("user_preapproved_run");
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.writePolicy).toBe("user_preapproved_run")
    );
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false));
    await vi.waitFor(() => expect(permissionCalls).toHaveLength(2));
    expect(permissionCalls[1]).toMatchObject({ runDraftRevision: 3 });
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.permission).toMatchObject({
        loading: false,
        summary: { writePolicy: "user_preapproved_run" }
      })
    );

    releaseFirstPermissionRead?.();

    await vi.waitFor(() => expect(permissionCalls).toHaveLength(2));
    expect(bridge.getComposerProps()?.permission).toMatchObject({
      loading: false,
      summary: { writePolicy: "user_preapproved_run" }
    });
  });

  test("adds and removes a context reference through the context draft", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      fileEditor: {
        path: "notes/outline.md",
        fileName: "outline.md",
        content: "outline",
        dirty: false,
        saveStatus: "Saved"
      },
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.references).toBeDefined());
    expect(bridge.getComposerProps()?.references?.available.map((ref) => ref.refId)).toEqual([
      "file:notes/outline.md"
    ]);

    bridge.getComposerProps()?.references?.onAdd("file:notes/outline.md");
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.references?.chips.map((chip) => chip.refId)).toEqual([
        "chapter:chapter-01",
        "file:notes/outline.md"
      ])
    );

    bridge.getComposerProps()?.references?.onRemove("file:notes/outline.md");
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.references?.chips.map((chip) => chip.refId)).toEqual([
        "chapter:chapter-01"
      ])
    );
  });

  test("surfaces a heavy context and compacts the live run", async () => {
    const activeRun: AgentRunSnapshot = {
      ...snapshot,
      status: "executing_model",
      contextBudgetSnapshotId: "budget-live-01",
      runRevision: 5
    };
    const { api, compactCalls } = createDraftApi({ activeRun, heavyRefThreshold: 1 });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await bridge.load("project-01");

    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.state).toBe("heavy"));
    const contextStatus = bridge.getComposerProps()?.contextStatus;
    expect(typeof contextStatus?.onCompact).toBe("function");
    contextStatus?.onCompact?.();

    await vi.waitFor(() => expect(compactCalls.length).toBe(1));
    expect(compactCalls[0]).toMatchObject({
      runId: "run-bridge",
      contextBudgetSnapshotId: "budget-live-01",
      trigger: "manual"
    });
  });
});

/**
 * A high-fidelity draft-backed fake API: the real draft session over an in-memory repo (so revisions,
 * checksums, and mutations behave exactly as in production), plus a synthetic budget preview whose
 * usage scales with the reference count, and a compaction sink that records its commands.
 */
function createDraftApi(
  options: {
    readonly activeRun?: AgentRunSnapshot;
    readonly heavyRefThreshold?: number;
    readonly firstPermissionRead?: Promise<void>;
  } = {}
): {
  api: NovelStudioApi;
  budgetCalls: unknown[];
  compactCalls: Record<string, unknown>[];
  permissionCalls: Record<string, unknown>[];
} {
  const runDrafts = new Map<string, JsonObject>();
  const contextDrafts = new Map<string, JsonObject>();
  const repository: AgentRunDraftSessionRepository = {
    async writeRunDraft(draft) {
      runDrafts.set(draft["conversationId"] as string, draft);
      return ok(draft);
    },
    async readLatestRunDraft(conversationId) {
      return ok(runDrafts.get(conversationId));
    },
    async writeContextDraft(draft) {
      contextDrafts.set(draft["conversationId"] as string, draft);
      return ok(draft);
    },
    async readLatestContextDraft(conversationId) {
      return ok(contextDrafts.get(conversationId));
    }
  };
  let idSequence = 0;
  const session = createAgentRunDraftSession({
    repository,
    now: () => "2026-07-16T00:00:00.000Z",
    createId: () => `draft_${(idSequence += 1)}`
  });
  const budgetCalls: unknown[] = [];
  const compactCalls: Record<string, unknown>[] = [];
  const permissionCalls: Record<string, unknown>[] = [];
  const heavyRefThreshold = options.heavyRefThreshold ?? 2;
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  const activeRun = options.activeRun;
  return {
    budgetCalls,
    compactCalls,
    permissionCalls,
    api: {
      agentRuns: {
        onEvent: (listener: (event: AgentRunEvent) => void) => {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
        readRunDraft: (command: unknown) => session.readAgentRunDraft(command as never),
        updateRunDraft: (command: unknown) => session.updateAgentRunDraft(command as never),
        updateContextDraft: (command: unknown) => session.updateContextDraft(command as never),
        refreshContextDraft: (command: unknown) => session.refreshContextDraft(command as never),
        previewContextBudget: async (command: unknown) => {
          budgetCalls.push(command);
          const conversationId = (command as { conversationId: string }).conversationId;
          const contextDraft = contextDrafts.get(conversationId);
          const refCount = Array.isArray(contextDraft?.["refs"])
            ? (contextDraft["refs"] as unknown[]).length
            : 0;
          const safeInputBudget = 100000;
          const usedTokens = refCount >= heavyRefThreshold ? 90000 : 20000;
          return ok(budgetSnapshot(safeInputBudget, usedTokens));
        },
        readPermissionSummary: async (command: Record<string, unknown>) => {
          permissionCalls.push(structuredClone(command));
          if (permissionCalls.length === 1 && options.firstPermissionRead !== undefined) {
            await options.firstPermissionRead;
          }
          const draft = runDrafts.get(String(command["conversationId"]));
          return ok({
            schemaVersion: "1.0",
            permissionSummaryId: `permission-${String(command["runDraftRevision"])}`,
            projectId: command["projectId"],
            runDraftId: command["runDraftId"],
            contextMode: draft?.["contextMode"] ?? "writing",
            writePolicy: draft?.["writePolicy"] ?? "write_before_confirmation",
            toolRegistryRevision: "registry-01",
            rootFingerprint: "f".repeat(64),
            readCapabilities: ["read_chapter"],
            proposalCapabilities:
              draft?.["operationMode"] === "execution" ? ["propose_chapter_write"] : [],
            forbiddenCapabilities: ["shell", "git", "network"],
            checksum: String(command["runDraftRevision"]).padStart(64, "0"),
            generatedAt: "2026-07-17T00:00:00.000Z"
          });
        },
        compactContext: async (command: Record<string, unknown>) => {
          compactCalls.push(command);
          return ok({
            compactionId: "compaction-01",
            revision: {
              schemaVersion: "1.0",
              compactionId: "compaction-01",
              runId: command["runId"],
              revision: 1
            },
            runSnapshot: { ...(activeRun ?? snapshot) } as unknown as JsonObject
          });
        },
        prepareStart: async () =>
          ok({
            runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
            contextDraft: { contextDraftId: "context-01", revision: 1 }
          }),
        start: async () => ok(activeRun ?? snapshot),
        read: async () => ok({ snapshot: activeRun ?? snapshot, events: [] }),
        list: async () => ok(activeRun === undefined ? [] : [activeRun])
      }
    } as unknown as NovelStudioApi
  };
}

function budgetSnapshot(safeInputBudget: number, usedTokens: number): ContextBudgetSnapshot {
  return {
    schemaVersion: "1.0",
    contextBudgetSnapshotId: "budget-preview-01",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    contextWindowSemantics: "shared_input_output_window",
    safeInputBudget,
    requiredContextTokens: usedTokens,
    outputReserve: 16384,
    toolReserve: 0,
    systemReserve: 0,
    usedTokens,
    remainingTokens: Math.max(0, safeInputBudget - usedTokens),
    precision: "estimated",
    provider: "openai-compatible",
    model: "local-model",
    calculatedAt: "2026-07-16T00:00:00.000Z"
  };
}

function rollbackReview(reviewedCurrentContent: string, updatedAt: string) {
  return {
    schemaVersion: "1.0" as const,
    reviewId: "rollback-review-01",
    runId: "run-bridge",
    status: "pending" as const,
    sourceVersionGroupIds: ["version-group-01"],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt,
    processedCommandIds: [],
    files: [
      {
        relativePath: "notes/conflict.md",
        assetType: "text",
        baselineContent: "before",
        baselineChecksum: "a".repeat(64),
        baselineVersionId: "ver-before",
        runLastWriteContent: "agent",
        runLastWriteChecksum: "b".repeat(64),
        reviewedCurrentContent,
        reviewedCurrentChecksum: "c".repeat(64),
        diff: {
          currentToLastWrite: "current -> ai",
          currentToBaseline: "current -> baseline",
          lastWriteToBaseline: "ai -> baseline"
        },
        status: "stale" as const
      }
    ]
  };
}

function readyPlanArtifact() {
  return {
    schemaVersion: "1.0" as const,
    planId: "plan-01",
    revision: 1,
    sourceRunId: "run-bridge",
    status: "ready" as const,
    operationMode: "planning" as const,
    contextMode: "writing" as const,
    goal: "修订当前章节",
    successCriteria: ["章节通过复核"],
    nonGoals: [],
    facts: [],
    assumptions: [],
    openQuestions: [],
    targetRefs: [],
    steps: [{ stepId: "step-01", title: "修订正文", verification: "检查版本差异" }],
    risks: [],
    verification: ["运行测试"],
    sourceRefs: ["chapter:chapter-01"],
    createdAt: "2026-07-13T00:00:00.000Z"
  };
}

function event(
  sequence: number,
  type: AgentRunEvent["type"],
  detail: AgentRunEvent["detail"]
): AgentRunEvent {
  return {
    schemaVersion: "1.0",
    runId: "run-bridge",
    projectId: "project-01",
    sequence,
    runRevision: sequence,
    type,
    createdAt: "2026-07-13T00:00:00.000Z",
    ...(detail === undefined ? {} : { detail })
  };
}

interface AgentRunBridgeWithWrites {
  readonly syncContext: ReturnType<typeof createAgentRunBridge>["syncContext"];
  readonly load: ReturnType<typeof createAgentRunBridge>["load"];
  readonly updateChangeSetSelection?: (selection: {
    readonly files: readonly {
      readonly relativePath: string;
      readonly selected: boolean;
      readonly selectedHunkIds?: readonly string[];
    }[];
  }) => Promise<NonNullable<ReturnType<typeof createAgentRunBridge>["getProps"]>>;
  readonly applyChangeSet?: () => Promise<
    NonNullable<ReturnType<typeof createAgentRunBridge>["getProps"]>
  >;
}

function changeSet(revision: number, checksum: string, selected: boolean): ChangeSet {
  return {
    schemaVersion: "1.0",
    changeSetId: "change-set-01",
    revision,
    runId: "run-bridge",
    projectId: "project-01",
    checkpointId: "checkpoint-01",
    contextSnapshotId: "context-run-bridge-1",
    status: "awaiting_approval",
    checksum,
    approvalToken: `approval-${revision}`,
    createdAt: "2026-07-13T00:00:00.000Z",
    files: [
      {
        relativePath: "chapters/ch_03.md",
        assetType: "chapter",
        assetId: "ch_03",
        baseChecksum: "base-ch03",
        candidateChecksum: `candidate-${revision}`,
        baseContent: "她停在门外。",
        candidateContent: selected ? "她在门外停住。" : "她停在门外。",
        selected,
        validation: {
          valid: true,
          utf8: { status: "valid" },
          syntax: { status: "valid" },
          schema: { status: "valid" },
          asset: { status: "valid" }
        },
        hunks: [
          {
            hunkId: "hunk-ch03-p5",
            range: { unit: "paragraph", start: 5, end: 5 },
            characterRange: { start: 0, end: 7 },
            baseContent: "她停在门外。",
            replacement: "她在门外停住。",
            selected
          }
        ]
      }
    ]
  };
}

function createApi(overrides: {
  start?: (command: unknown) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
  prepareStart?: (command: unknown) => Promise<unknown>;
  refreshContext?: (command: {
    readonly decision: "refresh" | "exclude" | "cancel";
    readonly sourceRefs?: readonly string[];
    readonly currentSources?: readonly { readonly content: string }[];
  }) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
}): NovelStudioApi {
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  return {
    agentRuns: {
      prepareStart: (command) =>
        overrides.prepareStart?.(command) ??
        Promise.resolve(
          ok({
            runDraft: { runDraftId: "draft-01", revision: 1, checksum: "checksum-01" },
            contextDraft: { contextDraftId: "context-01", revision: 1 }
          })
        ),
      start: (command) => overrides.start?.(command) ?? Promise.resolve(ok(snapshot)),
      stop: async () => ok(snapshot),
      answerUserInput: async () => ok(snapshot),
      resume: async () => ok(snapshot),
      retryStep: async () => ok(snapshot),
      decidePlan: async () => ok(snapshot),
      refreshContext: (command) =>
        overrides.refreshContext?.(command) ?? Promise.resolve(ok(snapshot)),
      read: async () => ok({ snapshot, events: [] }),
      list: async () => ok([]),
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      }
    }
  } as unknown as NovelStudioApi;
}
