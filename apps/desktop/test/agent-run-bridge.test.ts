import { describe, expect, test, vi } from "vitest";

import type { AgentRunEvent, AgentRunSnapshot, ChangeSet } from "@novel-studio/agent-engine";
import type { NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";
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
