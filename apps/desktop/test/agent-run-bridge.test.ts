import { describe, expect, test, vi } from "vitest";

import type {
  AgentRunEvent,
  AgentRunSnapshot,
  ChangeSet,
  ContextBudgetSnapshot,
  ContextDraftRef
} from "@novel-studio/agent-engine";
import { STANDALONE_AGENT_CONTEXT_SCOPE } from "@novel-studio/agent-engine";
import {
  createAgentRunDraftSession,
  type AgentRunDraftSessionRepository,
  type NovelStudioApi,
  type PackedAgentContextPreview,
  type StoryBibleSnapshot
} from "@novel-studio/application";
import { createUnifiedError, err, ok, type JsonObject } from "@novel-studio/shared";
import type { ChapterEditorProps, ModelSettingsPanelProps } from "@novel-studio/ui";

import { createAgentRunBridge } from "../src/renderer/agent-run-bridge.js";

function workspaceScope(projectId: string) {
  return {
    kind: "workspace" as const,
    workspaceKind: "creativeProject" as const,
    workspaceId: projectId
  };
}

function engineeringScope(workspaceId: string) {
  return {
    kind: "workspace" as const,
    workspaceKind: "engineeringWorkspace" as const,
    workspaceId
  };
}

function engineeringRunSnapshot(): AgentRunSnapshot {
  return {
    ...snapshot,
    schemaVersion: "1.2",
    scope: engineeringScope("project-01"),
    contextMode: "general_file",
    contextProfileId: "engineering",
    profileVersion: "1.0",
    guidanceTemplateChecksum: "g".repeat(64),
    conventionsArtifactId: null,
    promptCachePolicyVersion: "1.0",
    cachePrefixChecksum: "c".repeat(64)
  } as unknown as AgentRunSnapshot;
}

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
  test("starts a standalone text conversation without a project identity or project controls", async () => {
    const { projectId: _projectId, ...legacySnapshot } = snapshot as unknown as Record<
      string,
      unknown
    >;
    void _projectId;
    const standaloneSnapshot = {
      ...legacySnapshot,
      schemaVersion: "1.2",
      scope: STANDALONE_AGENT_CONTEXT_SCOPE,
      operationMode: "conversation",
      contextMode: "standalone_chat",
      contextProfileId: "standalone",
      profileVersion: "1.0",
      guidanceTemplateChecksum: "g".repeat(64),
      conventionsArtifactId: null,
      promptCachePolicyVersion: "1.0",
      cachePrefixChecksum: "c".repeat(64),
      status: "conversation_model"
    } as unknown as AgentRunSnapshot;
    let listener: ((event: AgentRunEvent) => void) | undefined;
    const prepared: Record<string, unknown>[] = [];
    const starts: Record<string, unknown>[] = [];
    const api = {
      agentRuns: {
        onEvent: (next: (event: AgentRunEvent) => void) => {
          listener = next;
          return () => undefined;
        },
        list: async (scope: unknown) => {
          expect(scope).toEqual(STANDALONE_AGENT_CONTEXT_SCOPE);
          return ok([]);
        },
        prepareStart: async (command: Record<string, unknown>) => {
          prepared.push(structuredClone(command));
          return ok(
            preparedDraftView(command, {
              runDraftId: "standalone-draft",
              contextDraftId: "standalone-context",
              runDraftChecksum: "d".repeat(64)
            })
          );
        },
        previewPackedContext: async () => ok(packedContextPreview({ refs: [] })),
        start: async (command: Record<string, unknown>) => {
          starts.push(structuredClone(command));
          return ok(standaloneSnapshot);
        },
        read: async () => ok({ snapshot: standaloneSnapshot, events: [] })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      scope: STANDALONE_AGENT_CONTEXT_SCOPE,
      conversationId: "standalone-conversation",
      settings
    });

    await bridge.load(STANDALONE_AGENT_CONTEXT_SCOPE);
    await bridge.send("请帮我整理这个想法");

    expect(prepared).toEqual([
      expect.objectContaining({
        scope: STANDALONE_AGENT_CONTEXT_SCOPE,
        conversationId: "standalone-conversation",
        operationMode: "conversation",
        contextMode: "standalone_chat",
        contextRefs: []
      })
    ]);
    expect(starts).toEqual([
      expect.objectContaining({
        scope: STANDALONE_AGENT_CONTEXT_SCOPE,
        conversationId: "standalone-conversation"
      })
    ]);
    for (const command of [...prepared, ...starts]) {
      expect(command).not.toHaveProperty("projectId");
    }
    expect(bridge.getComposerProps()).toMatchObject({
      operationMode: "conversation",
      contextMode: "standalone_chat",
      availableContextModes: ["standalone_chat"]
    });
    expect(bridge.getComposerProps()?.references).toBeUndefined();
    expect(bridge.getComposerProps()?.permission).toBeUndefined();
    expect(bridge.getPlanReviewProps()).toBeUndefined();

    listener?.({
      schemaVersion: "1.0",
      runId: standaloneSnapshot.runId,
      projectId: "another-project",
      sequence: 2,
      runRevision: 2,
      type: "assistant_text_delta",
      createdAt: "2026-07-27T00:00:00.000Z",
      detail: { delta: "wrong scope" }
    });
    expect(bridge.getProps()?.assistantText).toBe("");
    listener?.({
      schemaVersion: "1.3",
      scope: STANDALONE_AGENT_CONTEXT_SCOPE,
      runId: standaloneSnapshot.runId,
      sequence: 2,
      runRevision: 2,
      type: "assistant_text_delta",
      createdAt: "2026-07-27T00:00:00.000Z",
      detail: { delta: "standalone response" }
    } as AgentRunEvent);
    expect(bridge.getProps()?.assistantText).toBe("standalone response");
  });

  test("projects pending tool approval and sends its durable binding decision", async () => {
    const pendingSnapshot = {
      ...snapshot,
      status: "awaiting_tool_approval" as const,
      runRevision: 12,
      lastSequence: 12,
      pendingToolApproval: {
        canonicalToolId: "mcp:trusted/send_message",
        providerToolName: "mcp__trusted__send_message",
        argumentsText: '{"message":"hello"}',
        requestedAt: "2026-07-25T00:00:00.000Z",
        binding: {
          kind: "external" as const,
          bindingId: "tool_approval_bridge_01",
          runId: "run-bridge",
          runRevision: 11,
          toolCallId: "tool-call-01",
          sourceId: "trusted",
          descriptorDigest: "a".repeat(64),
          argumentDigest: "b".repeat(64),
          idempotencyKey: "agent:run-bridge:tool-call-01",
          effectiveCapabilityRevision: 1,
          expiresAt: "2026-07-25T00:05:00.000Z"
        }
      }
    } as AgentRunSnapshot;
    const resolvedSnapshot = {
      ...pendingSnapshot,
      status: "executing_model" as const,
      runRevision: 13,
      lastSequence: 13,
      pendingToolApproval: null
    } as AgentRunSnapshot;
    let current = pendingSnapshot;
    const decisions: Record<string, unknown>[] = [];
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([current]),
        read: async () => ok({ snapshot: current, events: [] }),
        decideToolApproval: async (command: Record<string, unknown>) => {
          decisions.push(structuredClone(command));
          current = resolvedSnapshot;
          return ok(resolvedSnapshot);
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const loaded = await bridge.load("project-01");
    expect(loaded.pendingToolApproval).toMatchObject({
      bindingId: "tool_approval_bridge_01",
      canonicalToolId: "mcp:trusted/send_message",
      kind: "external",
      argumentsText: '{"message":"hello"}'
    });
    await bridge.decideToolApproval("approve");

    expect(decisions).toEqual([
      expect.objectContaining({
        runId: "run-bridge",
        projectId: "project-01",
        expectedRunRevision: 12,
        bindingId: "tool_approval_bridge_01",
        decision: "approve"
      })
    ]);
    expect(bridge.getProps()?.pendingToolApproval).toBeUndefined();
  });

  test("projects network approval destination alongside its persisted arguments", async () => {
    const pendingSnapshot = {
      ...snapshot,
      status: "awaiting_tool_approval" as const,
      pendingToolApproval: {
        canonicalToolId: "network:fetch",
        providerToolName: "network_fetch",
        argumentsText: '{"method":"GET"}',
        requestedAt: "2026-07-25T00:00:00.000Z",
        binding: {
          kind: "network" as const,
          bindingId: "tool_approval_network_01",
          runId: "run-bridge",
          runRevision: 1,
          toolCallId: "tool-call-network-01",
          destination: "https://api.example.test/v1/chapters",
          requestDigest: "a".repeat(64),
          egressClass: "public",
          effectiveCapabilityRevision: 1,
          expiresAt: "2026-07-25T00:05:00.000Z"
        }
      }
    } as AgentRunSnapshot;
    const api = {
      agentRuns: {
        onEvent: () => () => undefined,
        list: async () => ok([pendingSnapshot]),
        read: async () => ok({ snapshot: pendingSnapshot, events: [] })
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({ projectId: "project-01", settings });

    const loaded = await bridge.load("project-01");

    expect(loaded.pendingToolApproval).toMatchObject({
      kind: "network",
      destination: "https://api.example.test/v1/chapters",
      argumentsText: '{"method":"GET"}'
    });
  });

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
      runId: "run-bridge"
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
        return ok(preparedDraftView(command));
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

  test("treats selecting execution auto-write as the per-run acknowledgement", async () => {
    let received: Record<string, unknown> | undefined;
    const executionSnapshot = {
      ...snapshot,
      operationMode: "execution" as const,
      writePolicy: "user_preapproved_run" as const
    };
    const api = createApi({
      prepareStart: async (command) => {
        received = command as Record<string, unknown>;
        return ok(preparedDraftView(command));
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
          return ok(preparedDraftView(command, { runDraftId: `draft-0${commands.length}` }));
        },
        previewPackedContext: async () => ok(packedContextPreview({ refs: [] })),
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
        prepareStart: async (command: unknown) => ok(preparedDraftView(command)),
        previewPackedContext: async () => ok(packedContextPreview({ refs: [] })),
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

  test.each([
    {
      history: {
        status: "available" as const,
        packedContext: {
          packedContextId: "packed_context_available",
          payloadChecksum: "a".repeat(64)
        }
      },
      expected: {
        status: "available",
        packedContext: { packedContextId: "packed_context_available" }
      }
    },
    {
      history: { status: "stale" as const, reason: "block_content_mismatch" as const },
      expected: { status: "stale", reason: "block_content_mismatch" }
    },
    {
      history: { status: "unavailable" as const, reason: "legacy_manifest" as const },
      expected: { status: "unavailable", reason: "legacy_manifest" }
    },
    {
      history: { status: "unavailable" as const, reason: "prompt_artifact_missing" as const },
      expected: { status: "unavailable", reason: "prompt_artifact_missing" }
    }
  ])(
    "preserves historical Packed Context $history.status state during hydrate",
    async ({ history, expected }) => {
      const api = {
        agentRuns: {
          onEvent: () => () => undefined,
          list: async () => ok([snapshot]),
          read: async () => ok({ snapshot, events: [], packedContextHistory: history })
        }
      } as unknown as NovelStudioApi;
      const bridge = createAgentRunBridge(api);
      bridge.syncContext({ projectId: "project-01", settings });

      await bridge.load("project-01");

      expect(bridge.getProps()?.packedContextHistory).toMatchObject(expected);
    }
  );

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
            scope: workspaceScope("project-01"),
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
      scope: workspaceScope("project-01"),
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
    expect(props?.errorMessage).toContain("未选择可用的模型配置");
    expect(props?.errorMessage).toContain("设置");
  });

  test("surfaces the exact missing model fact and its Settings action", async () => {
    let started = false;
    const api = createApi({
      prepareStart: async () =>
        err(
          createUnifiedError({
            code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
            category: "UserError",
            message: "The selected provider/model cannot start an Agent run.",
            recoverability: "user-action",
            suggestedAction: "Enter the verified context window in Settings.",
            traceId: "agent-run-bridge-capability",
            redactedDetail: {
              profileId: "profile-01",
              provider: "openai-compatible",
              modelName: "custom-model",
              missingCapabilities: ["contextWindow"],
              contextWindowStatus: "missing"
            }
          })
        ),
      start: async () => {
        started = true;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });

    const props = await bridge.send("检查当前章节");

    expect(started).toBe(false);
    expect(props.errorMessage).toContain("custom-model");
    expect(props.errorMessage).toContain("上下文窗口信息未验证");
    expect(props.errorMessage).toContain("Max Tokens");
  });

  test("surfaces an unsupported reasoning effort with the model's allowed values", async () => {
    const api = createApi({
      prepareStart: async () =>
        err(
          createUnifiedError({
            code: "AGENT_REASONING_EFFORT_UNSUPPORTED",
            category: "UserError",
            message: "The selected model cannot use the requested reasoning strength.",
            recoverability: "user-action",
            suggestedAction: "Choose a supported value.",
            traceId: "agent-run-bridge-reasoning",
            redactedDetail: {
              modelName: "gpt-5.6-luna",
              requestedEffort: "ultra",
              allowedValues: ["low", "medium", "high"]
            }
          })
        )
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });

    const props = await bridge.send("检查当前章节");

    expect(props.errorMessage).toContain("gpt-5.6-luna");
    expect(props.errorMessage).toContain("ultra");
    expect(props.errorMessage).toContain("low、medium、high");
  });

  test("keeps the request visible when an Agent start call rejects", async () => {
    const bridge = createAgentRunBridge(
      createApi({
        prepareStart: async () => {
          throw new Error("模型端点拒绝了当前请求。");
        }
      })
    );
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });

    bridge.getComposerProps()?.onSend("这条消息不能静默消失");

    await vi.waitFor(() =>
      expect(bridge.getProps()).toMatchObject({
        userRequest: "这条消息不能静默消失",
        errorMessage: "模型端点拒绝了当前请求。"
      })
    );
  });

  test("publishes a pending request immediately while start preflight is waiting", async () => {
    let finishPrepare: ((value: unknown) => void) | undefined;
    const preparePending = new Promise<unknown>((resolve) => {
      finishPrepare = resolve;
    });
    const bridge = createAgentRunBridge(
      createApi({
        prepareStart: async () => preparePending
      })
    );
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });
    const listener = vi.fn();
    bridge.subscribe(listener);

    bridge.getComposerProps()?.onSend("等待预检的消息");

    expect(listener).toHaveBeenCalled();
    expect(bridge.getProps()).toMatchObject({
      conversationId: "conversation-01",
      userRequest: "等待预检的消息",
      status: "created"
    });
    expect(bridge.getProps()?.runId).toBeUndefined();
    expect(bridge.getComposerProps()).toMatchObject({
      disabled: true,
      disabledReason: "正在启动 Agent…"
    });

    finishPrepare?.(
      err(
        createUnifiedError({
          code: "AGENT_REASONING_EFFORT_UNSUPPORTED",
          category: "UserError",
          message: "Unsupported reasoning effort.",
          recoverability: "user-action",
          suggestedAction: "Choose a supported value.",
          traceId: "agent-run-pending-test",
          redactedDetail: {
            modelName: "gpt-5.6-luna",
            requestedEffort: "ultra",
            allowedValues: ["low", "medium", "high"]
          }
        })
      )
    );

    await vi.waitFor(() => expect(bridge.getProps()?.errorMessage).toContain("gpt-5.6-luna"));
    expect(bridge.getComposerProps()?.disabled).toBe(false);
  });

  test("restores the Act preapproval choice without a second acknowledgement", () => {
    const bridge = createAgentRunBridge(createApi());
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      settings
    });
    bridge.getComposerProps()?.onOperationModeChange("execution");
    bridge.getComposerProps()?.onWritePolicyChange("user_preapproved_run");

    bridge.getComposerProps()?.onOperationModeChange("planning");
    expect(bridge.getComposerProps()).toMatchObject({
      operationMode: "planning",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: false
    });

    bridge.getComposerProps()?.onOperationModeChange("execution");
    expect(bridge.getComposerProps()).toMatchObject({
      operationMode: "execution",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
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
          return ok({
            ...writeSnapshot,
            runRevision: writeSnapshot.runRevision + decisions.length
          });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api) as AgentRunBridgeWithWrites;
    bridge.syncContext({ projectId: "project-01", settings });
    await bridge.load("project-01");

    expect(typeof bridge.updateChangeSetSelection).toBe("function");
    expect(typeof bridge.applyChangeSet).toBe("function");
    if (bridge.updateChangeSetSelection === undefined || bridge.applyChangeSet === undefined)
      return;

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

  test("maps v1.1 lifecycle operations and sends operation selections through Change Set IPC", async () => {
    const pending: ChangeSet = {
      ...changeSet(4, "change-set-checksum-r4", true),
      schemaVersion: "1.1",
      operationsSchemaVersion: "1.1",
      operations: [
        {
          operationId: "mkdir-drafts",
          kind: "create_directory",
          relativePath: "notes/drafts",
          toolCallIdempotencyKey: "tool-mkdir",
          selected: true
        },
        {
          operationId: "move-outline",
          kind: "move_file",
          sourcePath: "notes/outline.md",
          targetPath: "notes/drafts/outline.md",
          sourceChecksum: "outline-checksum",
          toolCallIdempotencyKey: "tool-move",
          dependsOn: ["mkdir-drafts"],
          selected: true
        },
        {
          operationId: "delete-old",
          kind: "delete_file",
          relativePath: "chapters/ch_01.md",
          baseChecksum: "chapter-checksum",
          toolCallIdempotencyKey: "tool-delete",
          selected: false
        },
        {
          operationId: "modify-character",
          kind: "modify",
          relativePath: "story-bible/character/alice.json",
          toolCallIdempotencyKey: "tool-modify-character",
          selected: true
        }
      ]
    };
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
          return ok({ ...writeSnapshot, runRevision: 13 });
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createAgentRunBridge(api) as AgentRunBridgeWithWrites;
    bridge.syncContext({ projectId: "project-01", settings });

    const props = await bridge.load("project-01");

    expect(props.changeSetReview?.changeSet.operations).toEqual([
      {
        operationId: "mkdir-drafts",
        kind: "create_directory",
        selected: true,
        dependsOn: [],
        resourceKind: "project_directory",
        relativePath: "notes/drafts",
        impact: "创建项目目录 notes/drafts"
      },
      {
        operationId: "move-outline",
        kind: "move_file",
        selected: true,
        dependsOn: ["mkdir-drafts"],
        resourceKind: "project_file",
        sourcePath: "notes/outline.md",
        targetPath: "notes/drafts/outline.md",
        impact: "移动项目文件：notes/outline.md → notes/drafts/outline.md"
      },
      {
        operationId: "delete-old",
        kind: "delete_file",
        selected: false,
        dependsOn: [],
        resourceKind: "chapter",
        relativePath: "chapters/ch_01.md",
        impact: "删除章节 chapters/ch_01.md"
      },
      {
        operationId: "modify-character",
        kind: "modify",
        selected: true,
        dependsOn: [],
        resourceKind: "story_bible",
        relativePath: "story-bible/character/alice.json",
        impact: "修改故事圣经 story-bible/character/alice.json"
      }
    ]);

    await bridge.updateChangeSetSelection?.({
      files: [
        {
          relativePath: "chapters/ch_03.md",
          selected: true,
          selectedHunkIds: ["hunk-ch03-p5"]
        }
      ],
      operations: [
        { operationId: "mkdir-drafts", selected: true },
        { operationId: "move-outline", selected: false },
        { operationId: "delete-old", selected: false },
        { operationId: "modify-character", selected: true }
      ]
    });

    expect(decisions[0]).toMatchObject({
      decision: "update_selection",
      files: [{ relativePath: "chapters/ch_03.md", selected: true }],
      operations: [
        { operationId: "mkdir-drafts", selected: true },
        { operationId: "move-outline", selected: false },
        { operationId: "delete-old", selected: false },
        { operationId: "modify-character", selected: true }
      ]
    });
    expect(JSON.stringify(decisions[0])).not.toContain("sourceChecksum");
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
        read: async () => ok({ snapshot: appliedSnapshot, events: [], rollbackReview }),
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
      expect(bridge.getProps()?.rollbackReview?.review.updatedAt).toBe("2026-07-13T00:02:00.000Z")
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
        {
          id: "local-model",
          displayName: "local-model",
          provider: "openai-compatible",
          contextWindow: 128000
        }
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

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()).toMatchObject({
        disabled: false,
        reasoning: { visible: true }
      })
    );
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

  test("replaces a stale unsupported reasoning effort before preparing a run", async () => {
    let preparedCommand: Record<string, unknown> | undefined;
    const { api } = createDraftApi();
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };
    const lunaSettings = {
      ...draftSettings,
      profiles: draftSettings.profiles.map((profile) =>
        profile.id === "profile-01" ? { ...profile, modelName: "gpt-5.6-luna" } : profile
      ),
      modelDiscovery: {
        ...draftSettings.modelDiscovery,
        models: [
          {
            id: "gpt-5.6-luna",
            displayName: "gpt-5.6-luna",
            provider: "openai-compatible"
          }
        ],
        reasoningStrength: {
          status: "available" as const,
          providerParamName: "reasoning_effort" as const,
          allowedValues: ["low", "medium", "high"],
          defaultValue: "medium"
        }
      }
    } as ModelSettingsPanelProps;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: lunaSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.reasoning?.visible).toBe(true));

    // Simulate an older persisted draft created while this endpoint incorrectly exposed `ultra`.
    bridge.getComposerProps()?.reasoning?.onSelect("ultra");
    expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(true);
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false));

    expect(bridge.getComposerProps()?.reasoning).toMatchObject({
      values: ["low", "medium", "high"],
      current: "medium"
    });
    await bridge.send("继续检查当前章节");
    expect(preparedCommand).toMatchObject({
      modelName: "gpt-5.6-luna",
      reasoningEffort: "medium"
    });
  });

  test("exposes discovered sibling models and persists the selected model name", async () => {
    let preparedCommand: Record<string, unknown> | undefined;
    const { api } = createDraftApi();
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };
    const settingsWithModels = {
      ...draftSettings,
      modelDiscovery: {
        ...draftSettings.modelDiscovery,
        models: [
          ...(draftSettings.modelDiscovery?.models ?? []),
          {
            id: "gpt-5.6",
            displayName: "GPT-5.6",
            provider: "openai-compatible",
            reasoningStrength: {
              status: "available" as const,
              providerParamName: "reasoning_effort" as const,
              allowedValues: ["high", "max", "ultra"],
              defaultValue: "high"
            }
          }
        ]
      }
    } as ModelSettingsPanelProps;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: settingsWithModels
    });

    await vi.waitFor(() => {
      expect(bridge.getComposerProps()?.model?.profiles).toHaveLength(3);
      expect(bridge.getComposerProps()?.reasoning?.visible).toBe(true);
    });
    const composer = bridge.getComposerProps();
    const discovered = composer?.model?.profiles.find((profile) => profile.label === "GPT-5.6");
    expect(discovered).toBeDefined();
    composer?.model?.onSelect(discovered?.id ?? "");

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.model?.selectedProfileId).toBe(discovered?.id)
    );
    expect(bridge.getComposerProps()?.reasoning).toMatchObject({
      visible: true,
      values: ["high", "max", "ultra"],
      current: "high"
    });

    await bridge.send("使用新模型检查这一段");
    expect(preparedCommand).toMatchObject({ modelName: "gpt-5.6" });
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

  test("syncs the persisted draft when a profile's configured model changes", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    const bridgeContext = {
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor
    } as const;
    bridge.syncContext({ ...bridgeContext, settings: draftSettings });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.disabled).toBe(false));

    const renamedSettings = {
      ...draftSettings,
      profiles: draftSettings.profiles.map((profile) =>
        profile.id === "profile-01" ? { ...profile, modelName: "gpt-5" } : profile
      ),
      draft: { ...draftSettings.draft, modelName: "gpt-5" },
      modelDiscovery: {
        profileId: "profile-01",
        provider: "openai-compatible",
        status: "loaded" as const,
        models: [
          {
            id: "gpt-5",
            displayName: "gpt-5",
            provider: "openai-compatible",
            contextWindow: 128000
          }
        ],
        reasoningStrength: draftSettings.modelDiscovery?.reasoningStrength ?? {
          status: "hidden" as const,
          reason: "not needed"
        }
      }
    } as ModelSettingsPanelProps;

    bridge.syncContext({ ...bridgeContext, settings: renamedSettings });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.disabled).toBe(false));

    const persisted = await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        modelName: "gpt-5",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        contextRefs: []
      }
    } as never);
    expect(persisted).toMatchObject({
      ok: true,
      value: { runDraft: { modelProfileId: "profile-01", modelName: "gpt-5" } }
    });
  });

  test("normalizes a persisted writing draft before sending from an engineering workspace", async () => {
    const { api } = createDraftApi({ activeRun: engineeringRunSnapshot() });
    await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      scope: engineeringScope("project-01"),
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
      scope: engineeringScope("project-01"),
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
    const { api } = createDraftApi({ activeRun: engineeringRunSnapshot() });
    await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      scope: engineeringScope("project-01"),
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
      scope: engineeringScope("project-01"),
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

  test("binds a creative active file separately from manual refs and normalizes the surface", async () => {
    const { api } = createDraftApi();
    const seeded = await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      scope: workspaceScope("project-01"),
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        contextRefs: [
          {
            kind: "project_file",
            refId: "file:notes/reference.md",
            relativePath: "notes/reference.md",
            label: "reference.md"
          }
        ],
        activeResourceRef: null
      }
    } as never);
    expect(seeded).toMatchObject({
      ok: true,
      value: {
        contextDraft: {
          refs: [expect.objectContaining({ refId: "file:notes/reference.md" })]
        }
      }
    });
    let preparedCommand: Record<string, unknown> | undefined;
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };
    const activeResourceRef = {
      kind: "project_file" as const,
      refId: "file:notes/current.md",
      relativePath: "notes/current.md",
      label: "current.md"
    };
    const bridge = createAgentRunBridge(api);

    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "general_file",
      activeResourceRef,
      fileEditor: {
        path: "notes/current.md",
        fileName: "current.md",
        content: "saved body",
        dirty: false,
        saveStatus: "Saved"
      },
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    await vi.waitFor(async () => {
      const current = await api.agentRuns.readRunDraft?.({
        projectId: "project-01",
        scope: workspaceScope("project-01"),
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
      expect(current).toMatchObject({
        ok: true,
        value: {
          runDraft: { contextMode: "general_file" },
          contextDraft: {
            refs: [expect.objectContaining({ refId: "file:notes/reference.md" })],
            activeResourceRef
          }
        }
      });
    });
    await bridge.send("检查当前项目文件");

    expect(preparedCommand).toMatchObject({
      contextMode: "general_file",
      contextRefs: [expect.objectContaining({ refId: "file:notes/reference.md" })],
      activeResourceRef
    });
    expect((preparedCommand?.["contextRefs"] as readonly JsonObject[]) ?? []).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ refId: activeResourceRef.refId })])
    );
    const persisted = await api.agentRuns.readRunDraft?.({
      projectId: "project-01",
      scope: workspaceScope("project-01"),
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
      value: {
        runDraft: { contextMode: "general_file" },
        contextDraft: {
          refs: [expect.objectContaining({ refId: "file:notes/reference.md" })],
          activeResourceRef
        }
      }
    });
  });

  test("binds a Story Bible detail as the writing active resource while retaining the chapter ref", async () => {
    const { api } = createDraftApi();
    let preparedCommand: Record<string, unknown> | undefined;
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };
    const bridge = createAgentRunBridge(api);
    const activeResourceRef = {
      kind: "story_bible" as const,
      refId: "story_bible:chr_hero",
      assetId: "chr_hero",
      label: "主角"
    };

    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "writing",
      activeResourceRef,
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.references).toBeDefined());
    await vi.waitFor(async () => {
      const current = await api.agentRuns.readRunDraft?.({
        projectId: "project-01",
        scope: workspaceScope("project-01"),
        conversationId: "conversation-01",
        initialize: {
          modelProfileId: "profile-01",
          operationMode: "planning",
          contextMode: "writing",
          writePolicy: "write_before_confirmation",
          contextRefs: []
        }
      } as never);
      expect(current).toMatchObject({
        ok: true,
        value: {
          contextDraft: {
            refs: [expect.objectContaining({ refId: "chapter:chapter-01" })],
            activeResourceRef
          }
        }
      });
    });

    await bridge.send("补充主角设定");

    expect(preparedCommand).toMatchObject({
      contextMode: "writing",
      contextRefs: [expect.objectContaining({ refId: "chapter:chapter-01" })],
      activeResourceRef
    });

    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "writing",
      activeResourceRef: null,
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(async () => {
      const current = await api.agentRuns.readRunDraft?.({
        projectId: "project-01",
        scope: workspaceScope("project-01"),
        conversationId: "conversation-01",
        initialize: {
          modelProfileId: "profile-01",
          operationMode: "planning",
          contextMode: "writing",
          writePolicy: "write_before_confirmation",
          contextRefs: []
        }
      } as never);
      expect(current).toMatchObject({
        ok: true,
        value: {
          contextDraft: {
            refs: [expect.objectContaining({ refId: "chapter:chapter-01" })],
            activeResourceRef: null
          }
        }
      });
    });
  });

  test("drops a Story Bible active resource outside the writing surface", async () => {
    const { api } = createDraftApi();
    let preparedCommand: Record<string, unknown> | undefined;
    const originalPrepareStart = api.agentRuns.prepareStart;
    api.agentRuns.prepareStart = async (command) => {
      preparedCommand = command as Record<string, unknown>;
      return originalPrepareStart(command);
    };
    const bridge = createAgentRunBridge(api);

    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "general_file",
      activeResourceRef: {
        kind: "story_bible",
        refId: "story_bible:chr_hero",
        assetId: "chr_hero",
        label: "主角"
      },
      settings: draftSettings
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());
    await bridge.send("检查项目文件界面");

    expect(preparedCommand).toMatchObject({
      contextMode: "general_file",
      activeResourceRef: null
    });
  });

  test("publishes only committed apply and undo file changes to renderer consumers", () => {
    const { api, emitEvent } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "writing",
      settings: draftSettings
    });
    const changes: Parameters<Parameters<typeof bridge.subscribeProjectFilesChanged>[0]>[0][] = [];
    bridge.subscribeProjectFilesChanged((change) => changes.push(change));

    emitEvent(
      event(2, "write_applied", {
        versionGroupId: "vg_apply",
        relativePaths: ["foreshadows/fsh_01.json", "foreshadows/fsh_01.json"]
      })
    );
    emitEvent(
      event(3, "run_undo_review_required", {
        versionGroupId: "vg_review",
        relativePaths: ["foreshadows/fsh_01.json"]
      })
    );
    emitEvent(
      event(4, "run_undone", {
        versionGroupId: "vg_undo",
        relativePaths: ["foreshadows/fsh_01.json"]
      })
    );

    expect(changes).toEqual([
      {
        projectId: "project-01",
        reason: "agent-change-set-apply",
        versionGroupId: "vg_apply",
        relativePaths: ["foreshadows/fsh_01.json"]
      },
      {
        projectId: "project-01",
        reason: "agent-run-undo",
        versionGroupId: "vg_undo",
        relativePaths: ["foreshadows/fsh_01.json"]
      }
    ]);
  });

  test("does not prepare a run when the dirty creative-file guard cancels", async () => {
    const { api } = createDraftApi();
    const beforeStart = vi.fn(async () => false);
    const prepareStart = vi.fn(api.agentRuns.prepareStart);
    api.agentRuns.prepareStart = prepareStart;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      surfaceContextMode: "general_file",
      activeResourceRef: {
        kind: "project_file",
        refId: "file:notes/current.md",
        relativePath: "notes/current.md",
        label: "current.md"
      },
      beforeStart,
      fileEditor: {
        path: "notes/current.md",
        fileName: "current.md",
        content: "dirty body",
        dirty: true,
        saveStatus: "Unsaved"
      },
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());

    await bridge.send("不要发送这次请求");

    expect(beforeStart).toHaveBeenCalledOnce();
    expect(prepareStart).not.toHaveBeenCalled();
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
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()).toMatchObject({
        disabled: false,
        reasoning: { visible: true }
      })
    );
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

    await vi.waitFor(() => expect(bridge.getComposerProps()?.reasoning?.current).toBe("high"));
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
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()).toMatchObject({
        disabled: false,
        reasoning: { visible: true }
      })
    );
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
    expect(Number(permissionCalls[1]?.["runDraftRevision"])).toBeGreaterThan(
      Number(permissionCalls[0]?.["runDraftRevision"])
    );
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
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()).toMatchObject({
        disabled: false,
        reasoning: { visible: true }
      })
    );
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
    expect(Number(permissionCalls[1]?.["runDraftRevision"])).toBeGreaterThan(
      Number(permissionCalls[0]?.["runDraftRevision"])
    );
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

  test("suggests mentioned Story Bible refs without adding them until the user clicks", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    const storyBibleSnapshot: StoryBibleSnapshot = {
      characters: [
        {
          schemaVersion: "1.0",
          id: "chr_mira",
          type: "character",
          title: "Mira",
          aliases: ["Captain Mira"],
          status: "active",
          summary: "Captain of the city watch.",
          createdAt: "2026-07-16T00:00:00.000Z",
          updatedAt: "2026-07-16T00:00:00.000Z"
        }
      ],
      worldAssets: [],
      foreshadows: [],
      memories: []
    };
    bridge.syncContext({
      scope: workspaceScope("project-01"),
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      storyBibleSnapshotBinding: {
        workspaceId: "project-01",
        snapshot: storyBibleSnapshot
      },
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.references).toBeDefined());

    bridge.getComposerProps()?.onRequestChange("Ask Captain Mira about the gate.");
    expect(bridge.getComposerProps()?.references?.suggested).toEqual([
      {
        refId: "story_bible:chr_mira",
        label: "Mira",
        kind: "story_bible"
      }
    ]);
    expect(bridge.getComposerProps()?.references?.chips.map((chip) => chip.refId)).toEqual([
      "chapter:chapter-01"
    ]);

    bridge.getComposerProps()?.references?.onAdd("story_bible:chr_mira");
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.references?.chips.map((chip) => chip.refId)).toEqual([
        "chapter:chapter-01",
        "story_bible:chr_mira"
      ])
    );
    expect(bridge.getComposerProps()?.references?.suggested).toEqual([]);
  });

  test("does not suggest Story Bible refs from a different workspace binding", async () => {
    const { api } = createDraftApi();
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      scope: workspaceScope("project-01"),
      projectId: "project-01",
      workspaceKind: "creativeProject",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      storyBibleSnapshotBinding: {
        workspaceId: "project-02",
        snapshot: {
          characters: [
            {
              schemaVersion: "1.0",
              id: "chr_mira",
              type: "character",
              title: "Mira",
              status: "active",
              summary: "Captain of the city watch.",
              createdAt: "2026-07-16T00:00:00.000Z",
              updatedAt: "2026-07-16T00:00:00.000Z"
            }
          ],
          worldAssets: [],
          foreshadows: [],
          memories: []
        }
      },
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.references).toBeDefined());

    bridge.getComposerProps()?.onRequestChange("Ask Mira about the gate.");

    expect(bridge.getComposerProps()?.references?.suggested).toEqual([]);
  });

  test("accepts only server-described automatic project context sources", async () => {
    const activeRun = { ...snapshot, status: "planning_model" as const };
    const { api, emitEvent } = createDraftApi({ activeRun, packedPreview: false });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await bridge.load("project-01");
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus).toBeDefined());

    emitEvent({
      schemaVersion: "1.0",
      runId: activeRun.runId,
      projectId: "project-01",
      sequence: 2,
      runRevision: 2,
      type: "context_refreshed",
      createdAt: "2026-07-16T00:00:01.000Z",
      detail: {
        sourceDescriptors: [
          {
            sourceKind: "project_conventions",
            refId: "project_conventions:AGENTS.md",
            label: "AGENTS.md",
            detail: "project_conventions · 42 tokens",
            relativePath: "AGENTS.md",
            tokenCount: 42,
            truncationRange: null,
            workspaceTrust: "trusted",
            instructionPolicy: "content_is_data_not_authority",
            sourceRevision: 3
          },
          {
            sourceKind: "workspace_outline",
            refId: "workspace_outline:engineering",
            label: "Workspace outline (engineering)",
            detail: "workspace_outline · 120 tokens · truncated",
            tokenCount: 120,
            truncationRange: {
              unit: "unicode_code_point",
              start: 0,
              end: 400,
              originalEnd: 900
            },
            workspaceTrust: "trusted",
            instructionPolicy: "content_is_data_not_authority",
            sourceRevision: 1
          },
          {
            sourceKind: "disk_file",
            refId: "file:secrets.txt",
            label: "secrets.txt",
            detail: "disk_file"
          }
        ]
      }
    });

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.sources).toEqual([
        {
          refId: "project_conventions:AGENTS.md",
          label: "AGENTS.md",
          detail: "project_conventions · 42 tokens",
          sourceKind: "project_conventions",
          relativePath: "AGENTS.md",
          layerLabel: "约定层",
          metadata: ["42 tokens", "完整", "受信任工作区", "内容仅作为数据", "修订 3"]
        },
        {
          refId: "workspace_outline:engineering",
          label: "Workspace outline (engineering)",
          detail: "workspace_outline · 120 tokens · truncated",
          sourceKind: "workspace_outline",
          layerLabel: "工作区定向块",
          metadata: ["120 tokens", "已截断", "受信任工作区", "内容仅作为数据", "修订 1"]
        },
        { refId: "chapter:chapter-01", label: "第一章", detail: "章节" }
      ])
    );
  });

  test("creates the fixed conventions file without sending a renderer path", async () => {
    const { api } = createDraftApi();
    const createProjectConventions = vi.fn(async () =>
      ok({ relativePath: "AGENTS.md" as const, status: "created" as const })
    );
    const updateContextPolicy = vi.fn(async () => ok(undefined));
    api.workspace = { createProjectConventions, updateContextPolicy } as never;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      scope: engineeringScope("project-01"),
      projectId: "project-01",
      workspaceKind: "engineeringWorkspace",
      conversationId: "conversation-01",
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus).toBeDefined());

    expect(bridge.getComposerProps()?.contextStatus?.conventions).toMatchObject({
      relativePath: "AGENTS.md",
      status: "unknown"
    });
    bridge.getComposerProps()?.contextStatus?.conventions?.onCreate?.();

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.conventions).toMatchObject({
        relativePath: "AGENTS.md",
        status: "created",
        busy: false
      })
    );
    expect(createProjectConventions).toHaveBeenCalledWith();
    expect(bridge.getComposerProps()?.contextStatus?.conventions?.onCreate).toBeUndefined();

    await bridge.send("Start a fresh run after the conventions file was deleted.");

    expect(bridge.getComposerProps()?.contextStatus?.conventions).toMatchObject({
      relativePath: "AGENTS.md",
      status: "unknown"
    });
    expect(bridge.getComposerProps()?.contextStatus?.conventions?.onCreate).toEqual(
      expect.any(Function)
    );

    bridge.getComposerProps()?.contextStatus?.conventions?.onCreate?.();
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.conventions?.onDisable).toEqual(
        expect.any(Function)
      )
    );
    bridge.getComposerProps()?.contextStatus?.conventions?.onDisable?.();
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.conventions).toMatchObject({
        status: "unknown",
        onCreate: expect.any(Function)
      })
    );
    expect(updateContextPolicy).toHaveBeenCalledWith("disable_conventions");

    bridge.getComposerProps()?.contextStatus?.conventions?.onCreate?.();
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.conventions?.onRevokeTrust).toEqual(
        expect.any(Function)
      )
    );
    bridge.getComposerProps()?.contextStatus?.conventions?.onRevokeTrust?.();
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.conventions).toMatchObject({
        status: "unknown",
        onCreate: expect.any(Function)
      })
    );
    expect(updateContextPolicy).toHaveBeenCalledWith("revoke_workspace_trust");
  });

  test("renders the packed author preview and binds the post-prepare preview to start", async () => {
    const preview = packedContextPreview({
      selectionPolicy: "automatic",
      preferenceScope: "automatic"
    });
    const { api, packedCalls, startCalls } = createDraftApi({ packedPreview: preview });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });

    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus).toMatchObject({
        previewPayloadChecksum: preview.payloadChecksum,
        fixedBudgetExceeded: false,
        previewBlocks: [
          {
            refId: "chapter:chapter-01",
            label: "第一章",
            content: "作者可见的第一章上下文。",
            checksum: "b".repeat(64)
          }
        ],
        sources: [
          {
            refId: "chapter:chapter-01",
            selectionReason: "当前章节",
            selectionPolicy: "automatic",
            preferenceScope: "automatic",
            priority: 60,
            sourceChecksum: "a".repeat(64),
            sourceRevision: 1
          }
        ]
      })
    );

    await bridge.send("检查当前章节");

    expect(packedCalls.length).toBeGreaterThanOrEqual(2);
    const startPreviewCall = packedCalls.at(-1);
    const startCall = startCalls.at(-1);
    expect(startPreviewCall).toMatchObject({
      runDraftId: startCall?.["runDraftId"],
      expectedDraftRevision: startCall?.["runDraftRevision"],
      runDraftChecksum: startCall?.["runDraftChecksum"]
    });
    expect(startCall).toMatchObject({
      packedContextId: preview.packedContextId,
      packedContextPayloadChecksum: preview.payloadChecksum
    });
  });

  test("routes run-only source actions through set_source_override", async () => {
    const { api, contextDraftCalls } = createDraftApi({
      packedPreview: packedContextPreview({ selectionPolicy: "pinned" })
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.sources[0]?.onPriorityChange).toEqual(
        expect.any(Function)
      )
    );

    const source = bridge.getComposerProps()?.contextStatus?.sources[0];
    source?.onPin?.();
    source?.onExclude?.();
    source?.onRestore?.();
    source?.onPriorityChange?.(82);

    await vi.waitFor(() =>
      expect(
        contextDraftCalls.filter(
          (call) =>
            (call["mutation"] as Record<string, unknown> | undefined)?.["kind"] ===
            "set_source_override"
        )
      ).toHaveLength(4)
    );
    expect(contextDraftCalls.slice(-4).map((call) => call["mutation"])).toEqual([
      {
        kind: "set_source_override",
        refId: "chapter:chapter-01",
        decision: "pinned",
        priority: 60
      },
      {
        kind: "set_source_override",
        refId: "chapter:chapter-01",
        decision: "excluded",
        priority: 60
      },
      {
        kind: "set_source_override",
        refId: "chapter:chapter-01",
        decision: null
      },
      {
        kind: "set_source_override",
        refId: "chapter:chapter-01",
        decision: "pinned",
        priority: 82
      }
    ]);
  });

  test.each(["excluded", "pinned"] as const)(
    "restores a project-%s preference with a run-only automatic override",
    async (projectDecision) => {
      const { api, contextDraftCalls } = createDraftApi({
        packedPreview: packedContextPreview({
          selectionPolicy: projectDecision === "pinned" ? "pinned" : "explicit",
          preferenceScope: "project",
          sourceState: projectDecision === "excluded" ? "excluded" : "active"
        })
      });
      const updateContextPolicy = vi.fn(async () => ok(undefined));
      api.workspace = { updateContextPolicy } as never;
      const bridge = createAgentRunBridge(api);
      bridge.syncContext({
        projectId: "project-01",
        conversationId: "conversation-01",
        activeChapterId: "chapter-01",
        chapterEditor: editor,
        settings: draftSettings
      });
      await vi.waitFor(() =>
        expect(bridge.getComposerProps()?.contextStatus?.sources[0]?.onRestore).toEqual(
          expect.any(Function)
        )
      );

      bridge.getComposerProps()?.contextStatus?.sources[0]?.onRestore?.();

      await vi.waitFor(() =>
        expect(contextDraftCalls.at(-1)?.["mutation"]).toEqual({
          kind: "set_source_override",
          refId: "chapter:chapter-01",
          decision: "automatic"
        })
      );
      expect(updateContextPolicy).not.toHaveBeenCalled();
    }
  );

  test("routes project-default source actions through set_source_preference", async () => {
    const { api } = createDraftApi({
      packedPreview: packedContextPreview({ selectionPolicy: "pinned" })
    });
    const updateContextPolicy = vi.fn(async () => ok(undefined));
    api.workspace = { updateContextPolicy } as never;
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.sources[0]?.onExclude).toEqual(
        expect.any(Function)
      )
    );

    bridge.getComposerProps()?.contextStatus?.onPreferenceScopeChange?.("project");
    bridge.getComposerProps()?.contextStatus?.sources[0]?.onExclude?.();
    await vi.waitFor(() => expect(updateContextPolicy).toHaveBeenCalledTimes(1));
    expect(updateContextPolicy).toHaveBeenLastCalledWith({
      action: "set_source_preference",
      preference: {
        refId: "chapter:chapter-01",
        decision: "excluded",
        priority: 60,
        ref: {
          kind: "chapter",
          refId: "chapter:chapter-01",
          chapterId: "chapter-01",
          label: "第一章"
        }
      }
    });

    await vi.waitFor(() => expect(bridge.getComposerProps()?.contextStatus?.busy).toBe(false));
    const restoredStatus = bridge.getComposerProps()?.contextStatus;
    expect(restoredStatus?.preferenceScope).toBe("project");
    expect(restoredStatus?.sources[0]?.onRestore).toEqual(expect.any(Function));
    restoredStatus?.sources[0]?.onRestore?.();
    await vi.waitFor(() => expect(updateContextPolicy).toHaveBeenCalledTimes(2));
    expect(updateContextPolicy).toHaveBeenLastCalledWith({
      action: "set_source_preference",
      preference: { refId: "chapter:chapter-01", decision: null }
    });
  });

  test("blocks start when the packed preview reports fixed-budget overflow", async () => {
    const preview = packedContextPreview({ fixedBudgetExceeded: true });
    const { api, startCalls } = createDraftApi({ packedPreview: preview });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() =>
      expect(bridge.getComposerProps()?.contextStatus?.fixedBudgetExceeded).toBe(true)
    );

    await bridge.send("检查当前章节");

    expect(startCalls).toHaveLength(0);
    expect(bridge.getProps()?.errorMessage).toContain("固定项超过安全输入预算");
  });

  test("blocks start when the host cannot create a packed preview", async () => {
    const { api, startCalls } = createDraftApi({ packedPreview: false });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      conversationId: "conversation-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: draftSettings
    });
    await vi.waitFor(() => expect(bridge.getComposerProps()?.model).toBeDefined());

    await bridge.send("检查当前章节");

    expect(startCalls).toHaveLength(0);
    expect(bridge.getProps()?.errorMessage).toContain("不支持实际发送预览");
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
    readonly packedPreview?:
      | false
      | PackedAgentContextPreview
      | ((call: number, command: Record<string, unknown>) => PackedAgentContextPreview);
  } = {}
): {
  api: NovelStudioApi;
  budgetCalls: unknown[];
  packedCalls: Record<string, unknown>[];
  startCalls: Record<string, unknown>[];
  contextDraftCalls: Record<string, unknown>[];
  compactCalls: Record<string, unknown>[];
  permissionCalls: Record<string, unknown>[];
  emitEvent: (event: AgentRunEvent) => void;
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
  const packedCalls: Record<string, unknown>[] = [];
  const startCalls: Record<string, unknown>[] = [];
  const contextDraftCalls: Record<string, unknown>[] = [];
  const compactCalls: Record<string, unknown>[] = [];
  const permissionCalls: Record<string, unknown>[] = [];
  const heavyRefThreshold = options.heavyRefThreshold ?? 2;
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  const activeRun = options.activeRun;
  return {
    budgetCalls,
    packedCalls,
    startCalls,
    contextDraftCalls,
    compactCalls,
    permissionCalls,
    emitEvent: (event) => {
      for (const listener of eventListeners) listener(event);
    },
    api: {
      agentRuns: {
        onEvent: (listener: (event: AgentRunEvent) => void) => {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
        readRunDraft: (command: unknown) => session.readAgentRunDraft(command as never),
        updateRunDraft: (command: unknown) => session.updateAgentRunDraft(command as never),
        updateContextDraft: (command: unknown) => {
          contextDraftCalls.push(structuredClone(command as Record<string, unknown>));
          return session.updateContextDraft(command as never);
        },
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
        ...(options.packedPreview === false
          ? {}
          : {
              previewPackedContext: async (command: Record<string, unknown>) => {
                budgetCalls.push(structuredClone(command));
                packedCalls.push(structuredClone(command));
                return ok(
                  typeof options.packedPreview === "function"
                    ? options.packedPreview(packedCalls.length, command)
                    : (options.packedPreview ??
                        packedContextPreview({
                          refs: contextDraftRefsForPreview(
                            contextDrafts.get(String(command["conversationId"]))
                          ),
                          safeInputBudget: 100000,
                          usedTokens:
                            contextDraftRefsForPreview(
                              contextDrafts.get(String(command["conversationId"]))
                            ).length >= heavyRefThreshold
                              ? 90000
                              : 20000
                        }))
                );
              }
            }),
        readPermissionSummary: async (command: Record<string, unknown>) => {
          permissionCalls.push(structuredClone(command));
          if (permissionCalls.length === 1 && options.firstPermissionRead !== undefined) {
            await options.firstPermissionRead;
          }
          const resolved = await session.resolveStartDraft(command as never);
          if (!resolved.ok) return err(resolved.error);
          const draft = resolved.value.runDraft;
          return ok({
            schemaVersion: "1.0",
            permissionSummaryId: `permission-${String(command["runDraftRevision"])}`,
            projectId: command["projectId"],
            runDraftId: command["runDraftId"],
            contextMode: draft.contextMode,
            writePolicy: draft.writePolicy,
            toolRegistryRevision: "registry-01",
            rootFingerprint: "f".repeat(64),
            readCapabilities: ["read_chapter"],
            proposalCapabilities:
              draft.operationMode === "execution" ? ["propose_chapter_write"] : [],
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
        prepareStart: (command: unknown) => session.syncStartDraft(command as never),
        start: async (command: Record<string, unknown>) => {
          startCalls.push(structuredClone(command));
          return ok(activeRun ?? snapshot);
        },
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

function contextDraftRefsForPreview(draft: JsonObject | undefined): readonly ContextDraftRef[] {
  return Array.isArray(draft?.["refs"])
    ? (draft["refs"] as unknown as readonly ContextDraftRef[])
    : [];
}

function packedContextPreview(
  options: {
    readonly refs?: readonly ContextDraftRef[];
    readonly safeInputBudget?: number;
    readonly usedTokens?: number;
    readonly selectionPolicy?: "automatic" | "explicit" | "pinned";
    readonly preferenceScope?: "automatic" | "run" | "project";
    readonly sourceState?: "active" | "excluded";
    readonly fixedBudgetExceeded?: boolean;
  } = {}
): PackedAgentContextPreview {
  const refs =
    options.refs ??
    ([
      {
        kind: "chapter",
        refId: "chapter:chapter-01",
        chapterId: "chapter-01",
        label: "第一章"
      }
    ] satisfies readonly ContextDraftRef[]);
  const safeInputBudget = options.safeInputBudget ?? 100000;
  const usedTokens = options.usedTokens ?? 20000;
  const selectionPolicy = options.selectionPolicy ?? "explicit";
  const tokenCount = refs.length === 0 ? 0 : Math.max(1, Math.floor(usedTokens / refs.length));
  const sources = refs.map((ref, index) => {
    const sourceKind =
      ref.kind === "story_bible"
        ? ("story_bible_asset" as const)
        : ref.kind === "project_file"
          ? ("disk_file" as const)
          : ("editor_buffer" as const);
    return {
      refId: ref.refId,
      sourceKind,
      ...(ref.kind === "project_file" ? { relativePath: ref.relativePath } : {}),
      ...(ref.kind === "story_bible" ? { assetId: ref.assetId } : {}),
      sourceRevision: index + 1,
      sourceChecksum: previewChecksum(index + 10),
      tokenCount,
      precision: "estimated" as const,
      state: options.sourceState ?? ("active" as const),
      selectionReason: ref.kind === "chapter" ? "当前章节" : "用户选择",
      selectionPolicy,
      preferenceScope: options.preferenceScope ?? ("run" as const),
      priority: 60,
      truncationRange: null
    };
  });
  return {
    budget: budgetSnapshot(safeInputBudget, usedTokens),
    packedContextId: `packed_context_${"c".repeat(32)}`,
    payloadChecksum: "d".repeat(64),
    tokenStats: {
      contextTokens: usedTokens,
      pinnedTokens: selectionPolicy === "pinned" ? usedTokens : 0,
      usedTokens,
      safeInputBudget,
      remainingTokens: Math.max(0, safeInputBudget - usedTokens),
      precision: "estimated"
    },
    sources,
    blocks: refs.map((ref, index) => ({
      blockId: `context-block-${String(index + 1)}`,
      refId: ref.refId,
      sourceKind: sources[index]?.sourceKind ?? "editor_buffer",
      order: index,
      content:
        ref.kind === "chapter" && ref.refId === "chapter:chapter-01"
          ? "作者可见的第一章上下文。"
          : `${ref.label} 的作者可见上下文。`,
      checksum: previewChecksum(index + 11),
      sourceChecksum: sources[index]?.sourceChecksum ?? previewChecksum(index + 10),
      tokenCount,
      precision: "estimated",
      truncationRange: null
    })),
    fixedBudgetExceeded: options.fixedBudgetExceeded ?? false
  };
}

function previewChecksum(seed: number): string {
  return seed.toString(16).repeat(64).slice(0, 64);
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
    readonly operations?: readonly {
      readonly operationId: string;
      readonly selected: boolean;
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

function createApi(
  overrides: {
    start?: (command: unknown) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
    prepareStart?: (command: unknown) => Promise<unknown>;
    refreshContext?: (command: {
      readonly decision: "refresh" | "exclude" | "cancel";
      readonly sourceRefs?: readonly string[];
      readonly currentSources?: readonly { readonly content: string }[];
    }) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
  } = {}
): NovelStudioApi {
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  return {
    agentRuns: {
      prepareStart: (command) =>
        overrides.prepareStart?.(command) ?? Promise.resolve(ok(preparedDraftView(command))),
      previewPackedContext: async () => ok(packedContextPreview()),
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

function preparedDraftView(
  command: unknown,
  options: {
    readonly runDraftId?: string;
    readonly contextDraftId?: string;
    readonly runDraftChecksum?: string;
  } = {}
) {
  const input = command as Record<string, unknown>;
  const conversationId = String(input["conversationId"] ?? "conversation-01");
  const scope = input["scope"] ?? workspaceScope(String(input["projectId"] ?? "project-01"));
  const contextDraftId = options.contextDraftId ?? "context-01";
  const contextDraftChecksum = "e".repeat(64);
  const contextMode = (input["contextMode"] ?? "writing") as "writing";
  return {
    runDraft: {
      schemaVersion: "1.1" as const,
      runDraftId: options.runDraftId ?? "draft-01",
      scope,
      conversationId,
      revision: 1,
      checksum: options.runDraftChecksum ?? "checksum-01",
      userRequest: String(input["userRequest"] ?? ""),
      operationMode: input["operationMode"] ?? "planning",
      contextMode,
      writePolicy: input["writePolicy"] ?? "write_before_confirmation",
      writePolicyAcknowledged: input["writePolicyAcknowledged"] === true,
      modelProfileId: String(input["modelProfileId"] ?? "profile-01"),
      ...(typeof input["modelName"] === "string" ? { modelName: input["modelName"] } : {}),
      ...(typeof input["reasoningEffort"] === "string"
        ? { reasoningEffort: input["reasoningEffort"] }
        : {}),
      contextDraftId,
      contextDraftRevision: 1,
      contextDraftChecksum,
      contextBudgetSnapshotId: null,
      updatedAt: "2026-07-16T00:00:00.000Z"
    },
    contextDraft: {
      schemaVersion: "1.2" as const,
      contextDraftId,
      conversationId,
      scope,
      contextMode,
      revision: 1,
      refs: Array.isArray(input["contextRefs"])
        ? (input["contextRefs"] as readonly ContextDraftRef[])
        : [],
      activeResourceRef: input["activeResourceRef"] ?? null,
      sourceOverrides: [],
      checksum: contextDraftChecksum,
      updatedAt: "2026-07-16T00:00:00.000Z"
    }
  };
}
