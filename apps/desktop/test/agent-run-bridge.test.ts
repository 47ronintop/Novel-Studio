import { describe, expect, test } from "vitest";

import type { AgentRunEvent, AgentRunSnapshot, ChangeSet } from "@novel-studio/agent-engine";
import type { NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";
import type { ChapterEditorProps, ModelSettingsPanelProps } from "@novel-studio/ui";

import { createAgentRunBridge } from "../src/renderer/agent-run-bridge.js";

const snapshot: AgentRunSnapshot = {
  schemaVersion: "1.0",
  runId: "run-bridge",
  projectId: "project-01",
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
  test("starts with the dirty editor buffer as an explicit context source", async () => {
    let received: unknown;
    const api = createApi({
      start: async (command) => {
        received = command;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });

    await bridge.send("检查当前章节");

    expect(received).toMatchObject({
      projectId: "project-01",
      operationMode: "planning",
      initialContextSources: [
        {
          refId: "chapter:chapter-01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/chapter-01.md",
          content: "dirty editor body",
          dirty: true
        }
      ]
    });
  });

  test("rejects capability preflight before calling start", async () => {
    let called = false;
    const api = createApi({
      start: async () => {
        called = true;
        return ok(snapshot);
      }
    });
    const bridge = createAgentRunBridge(api);
    bridge.syncContext({
      projectId: "project-01",
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings: { ...settings, modelDiscovery: undefined }
    });

    const props = await bridge.send("检查当前章节");

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
      activeChapterId: "chapter-01",
      chapterEditor: editor,
      settings
    });
    await bridge.send("检查当前章节");
    bridge.syncContext({
      projectId: "project-01",
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
      runId: "run-bridge",
      projectId: "project-01",
      expectedRunRevision: 20
    });
  });
});

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
  refreshContext?: (command: {
    readonly decision: "refresh" | "exclude" | "cancel";
    readonly sourceRefs?: readonly string[];
    readonly currentSources?: readonly { readonly content: string }[];
  }) => Promise<ReturnType<typeof ok<AgentRunSnapshot>>>;
}): NovelStudioApi {
  const eventListeners = new Set<(event: AgentRunEvent) => void>();
  return {
    agentRuns: {
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
