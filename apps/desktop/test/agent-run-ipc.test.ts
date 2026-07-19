import { describe, expect, test } from "vitest";

import type { DesktopApplication } from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

describe("Agent Run IPC", () => {
  test("forwards clone-safe commands and publishes the persisted AgentRunEvent stream", async () => {
    const calls: string[] = [];
    let subscriber: ((event: Record<string, unknown>) => void) | undefined;
    const published: Record<string, unknown>[] = [];
    const session = {
      async startAgentRun(command: Record<string, unknown>) {
        calls.push(`start:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 1, 1) };
      },
      async stopAgentRun(command: Record<string, unknown>) {
        calls.push(`stop:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("cancelled", 2, 2) };
      },
      async answerUserInput(command: Record<string, unknown>) {
        calls.push(`answer:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 3, 3) };
      },
      async resumeAgentRun(command: Record<string, unknown>) {
        calls.push(`resume:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 4, 4) };
      },
      async retryStep(command: Record<string, unknown>) {
        calls.push(`retry:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 5, 5) };
      },
      async retryRunTarget(command: Record<string, unknown>) {
        const target = command["target"] as Record<string, unknown>;
        calls.push(
          `retry-target:${String(command["commandId"])}:${String(command["errorId"])}:${String(
            target["kind"]
          )}:${String(target["id"])}`
        );
        return { ok: true, value: snapshot("planning_model", 5, 5) };
      },
      async decidePlan(command: Record<string, unknown>) {
        calls.push(`plan:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("executing_model", 6, 6) };
      },
      async refreshContext(command: Record<string, unknown>) {
        calls.push(`context:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("planning_model", 7, 7) };
      },
      async decideChangeSet(command: Record<string, unknown>) {
        calls.push(
          `change-set:${String(command["commandId"])}:${String(command["revision"])}:${String(
            command["checksum"]
          )}`
        );
        return { ok: true, value: snapshot("applying_changes", 8, 8) };
      },
      async undoRun(command: Record<string, unknown>) {
        calls.push(`undo:${String(command["commandId"])}`);
        return { ok: true, value: snapshot("completed", 9, 9) };
      },
      async readAgentRun(runId: string) {
        calls.push(`read:${runId}`);
        return { ok: true, value: { snapshot: snapshot("planning_model", 3, 3), events: [] } };
      },
      async listAgentRuns(projectId: string) {
        calls.push(`list:${projectId}`);
        return { ok: true, value: [snapshot("planning_model", 3, 3)] };
      },
      subscribe(listener: (event: Record<string, unknown>) => void) {
        subscriber = listener;
        return () => {
          subscriber = undefined;
        };
      }
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: session,
        publishAgentRunEvent: (event: Record<string, unknown>) => published.push(event)
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const startCommand = {
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "start-01",
      expectedRunRevision: 0,
      runDraftId: "draft-01",
      runDraftRevision: 1,
      runDraftChecksum: "checksum-01"
    };
    expect(typeof handlers["application:agent-run:start"]).toBe("function");
    expect(typeof handlers["application:agent-run:stop"]).toBe("function");
    expect(typeof handlers["application:agent-run:answer-user-input"]).toBe("function");
    expect(typeof handlers["application:agent-run:resume"]).toBe("function");
    expect(typeof handlers["application:agent-run:retry-step"]).toBe("function");
    expect(typeof handlers["application:agent-run:retry-target"]).toBe("function");
    expect(typeof handlers["application:agent-run:decide-plan"]).toBe("function");
    expect(typeof handlers["application:agent-run:refresh-context"]).toBe("function");
    expect(typeof handlers["application:agent-run:decide-change-set"]).toBe("function");
    expect(typeof handlers["application:agent-run:undo"]).toBe("function");
    expect(typeof handlers["application:agent-run:read"]).toBe("function");
    expect(typeof handlers["application:agent-run:list"]).toBe("function");
    if (
      handlers["application:agent-run:start"] === undefined ||
      handlers["application:agent-run:stop"] === undefined ||
      handlers["application:agent-run:answer-user-input"] === undefined ||
      handlers["application:agent-run:resume"] === undefined ||
      handlers["application:agent-run:retry-step"] === undefined ||
      handlers["application:agent-run:retry-target"] === undefined ||
      handlers["application:agent-run:decide-plan"] === undefined ||
      handlers["application:agent-run:refresh-context"] === undefined ||
      handlers["application:agent-run:decide-change-set"] === undefined ||
      handlers["application:agent-run:undo"] === undefined ||
      handlers["application:agent-run:read"] === undefined ||
      handlers["application:agent-run:list"] === undefined
    )
      return;

    expect(await handlers["application:agent-run:start"](startCommand)).toMatchObject({ ok: true });
    await handlers["application:agent-run:answer-user-input"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "answer-01",
      expectedRunRevision: 2,
      questionId: "question-01",
      answer: "保留"
    });
    await handlers["application:agent-run:resume"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "resume-01",
      expectedRunRevision: 3
    });
    await handlers["application:agent-run:retry-step"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "retry-01",
      expectedRunRevision: 4
    });
    await handlers["application:agent-run:retry-target"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "retry-target-01",
      expectedRunRevision: 4,
      errorId: "err-ipc-01",
      target: { kind: "tool_call", id: "call:read/1" }
    });
    const callsAfterExplicitRetry = calls.length;
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-invalid",
        expectedRunRevision: 4,
        errorId: "err-ipc-01",
        target: { kind: "shell", id: "tool-ipc-01" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-missing-error",
        expectedRunRevision: 4,
        target: { kind: "tool_call", id: "tool-ipc-01" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(
      await handlers["application:agent-run:retry-target"]({
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "retry-target-too-long",
        expectedRunRevision: 4,
        errorId: "err-ipc-01",
        target: { kind: "tool_call", id: "x".repeat(513) }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_IPC_INVALID_COMMAND" } });
    expect(calls).toHaveLength(callsAfterExplicitRetry);
    await handlers["application:agent-run:decide-plan"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "plan-01",
      expectedRunRevision: 5,
      planId: "plan-01",
      planRevision: 1,
      decision: "approve"
    });
    await handlers["application:agent-run:refresh-context"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "context-01",
      expectedRunRevision: 6,
      decision: "refresh"
    });
    const decideCommand = {
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "change-set-01",
      expectedRunRevision: 7,
      changeSetId: "cs-01",
      revision: 4,
      checksum: "checksum-r4",
      decision: "apply_selected"
    };
    const firstDecision = await handlers["application:agent-run:decide-change-set"](
      structuredClone(decideCommand)
    );
    const duplicateDecision = await handlers["application:agent-run:decide-change-set"](
      structuredClone(decideCommand)
    );
    expect(() => structuredClone(firstDecision)).not.toThrow();
    expect(duplicateDecision).toEqual(firstDecision);
    await handlers["application:agent-run:undo"]({
      action: "request",
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-01",
      expectedRunRevision: 9
    });
    await handlers["application:agent-run:read"]("run-ipc");
    await handlers["application:agent-run:list"]("project-01");
    await handlers["application:agent-run:stop"]({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "stop-01",
      expectedRunRevision: 3
    });

    const event = {
      schemaVersion: "1.0",
      runId: "run-ipc",
      projectId: "project-01",
      sequence: 2,
      runRevision: 2,
      type: "user_input_requested",
      createdAt: "2026-07-13T00:00:00.000Z",
      detail: { questionId: "question-01", prompt: "保留？" }
    };
    subscriber?.(event);
    expect(() => structuredClone(published[0])).not.toThrow();
    expect(published).toEqual([event]);
    expect(calls).toEqual([
      "start:start-01",
      "answer:answer-01",
      "resume:resume-01",
      "retry:retry-01",
      "retry-target:retry-target-01:err-ipc-01:tool_call:call:read/1",
      "plan:plan-01",
      "context:context-01",
      "change-set:change-set-01:4:checksum-r4",
      "change-set:change-set-01:4:checksum-r4",
      "undo:undo-01",
      "read:run-ipc",
      "list:project-01",
      "stop:stop-01"
    ]);
  });

  test("preload exposes typed Agent Run commands and filters event payloads", async () => {
    const invoked: string[] = [];
    let eventListener: ((payload: unknown) => void) | undefined;
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on(channel, listener) {
        expect(channel).toBe("application:agent-run:event");
        eventListener = listener;
        return () => {
          eventListener = undefined;
        };
      }
    }) as unknown as Record<string, unknown>;
    const agentRuns = api["agentRuns"] as
      Record<string, (...args: unknown[]) => unknown> | undefined;
    expect(agentRuns).toBeDefined();
    if (agentRuns === undefined) return;
    expect(typeof agentRuns["start"]).toBe("function");
    expect(typeof agentRuns["stop"]).toBe("function");
    expect(typeof agentRuns["answerUserInput"]).toBe("function");
    expect(typeof agentRuns["resume"]).toBe("function");
    expect(typeof agentRuns["retryStep"]).toBe("function");
    expect(typeof agentRuns["retryTarget"]).toBe("function");
    expect(typeof agentRuns["decidePlan"]).toBe("function");
    expect(typeof agentRuns["refreshContext"]).toBe("function");
    expect(typeof agentRuns["decideChangeSet"]).toBe("function");
    expect(typeof agentRuns["undoRun"]).toBe("function");
    expect(typeof agentRuns["read"]).toBe("function");
    expect(typeof agentRuns["list"]).toBe("function");
    expect(typeof agentRuns["onEvent"]).toBe("function");

    const received: unknown[] = [];
    const unsubscribe = agentRuns["onEvent"]?.((event: unknown) => received.push(event));
    eventListener?.({ nope: true });
    const validEvent = {
      schemaVersion: "1.0",
      runId: "run-ipc",
      projectId: "project-01",
      sequence: 1,
      runRevision: 1,
      type: "run_started",
      createdAt: "2026-07-13T00:00:00.000Z"
    };
    eventListener?.(validEvent);
    expect(received).toEqual([validEvent]);
    if (typeof unsubscribe === "function") unsubscribe();

    await agentRuns["start"]?.({});
    await agentRuns["stop"]?.({});
    await agentRuns["answerUserInput"]?.({});
    await agentRuns["resume"]?.({});
    await agentRuns["retryStep"]?.({});
    await agentRuns["retryTarget"]?.({});
    await agentRuns["decidePlan"]?.({});
    await agentRuns["refreshContext"]?.({});
    await agentRuns["decideChangeSet"]?.({});
    await agentRuns["undoRun"]?.({});
    await agentRuns["read"]?.("run-ipc");
    await agentRuns["list"]?.("project-01");
    expect(invoked).toEqual([
      "application:agent-run:start",
      "application:agent-run:stop",
      "application:agent-run:answer-user-input",
      "application:agent-run:resume",
      "application:agent-run:retry-step",
      "application:agent-run:retry-target",
      "application:agent-run:decide-plan",
      "application:agent-run:refresh-context",
      "application:agent-run:decide-change-set",
      "application:agent-run:undo",
      "application:agent-run:read",
      "application:agent-run:list"
    ]);
  });

  test("reads permission summaries from persisted draft facts or a bound run and decides plan revisions", async () => {
    const calls: Array<{ readonly name: string; readonly value: unknown }> = [];
    const summary = {
      schemaVersion: "1.0",
      permissionSummaryId: "permission-summary-01",
      projectId: "project-01",
      runDraftId: "draft-01",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter"],
      proposalCapabilities: ["propose_chapter_write"],
      forbiddenCapabilities: ["shell", "git", "network"],
      checksum: "c".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    };
    const runtime = {
      workspaceId: "project-01",
      projectId: "project-01",
      projectRoot: "C:/project",
      agentRunDraftSession: {
        async resolveStartDraft(command: Record<string, unknown>) {
          calls.push({ name: "resolve-draft", value: structuredClone(command) });
          return {
            ok: true,
            value: {
              runDraft: {
                runDraftId: "draft-01",
                revision: 3,
                checksum: "draft-checksum-03",
                operationMode: "execution",
                contextMode: "writing",
                writePolicy: "write_before_confirmation"
              },
              contextDraft: { contextDraftId: "context-01", revision: 2 }
            }
          };
        }
      },
      agentPermissionSession: {
        async prepareForDraft(input: Record<string, unknown>) {
          calls.push({ name: "prepare-permission", value: structuredClone(input) });
          return { ok: true, value: summary };
        },
        async readForRun(input: Record<string, unknown>) {
          calls.push({ name: "read-permission", value: structuredClone(input) });
          return { ok: true, value: { ...summary, runId: "run-01" } };
        }
      },
      agentRunSession: {
        async decidePlanRevision(command: Record<string, unknown>) {
          calls.push({ name: "decide-plan-revision", value: structuredClone(command) });
          return { ok: true, value: snapshot("executing_model", 8, 8) };
        },
        subscribe: () => () => undefined
      },
      agentConversationSession: {}
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => runtime,
          currentWorkspace: () => ({
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.projectRoot,
            stateRoot: runtime.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const draftResult = await handlers["application:agent-run:read-permission-summary"]?.({
      kind: "draft",
      projectId: "project-01",
      conversationId: "conversation-01",
      runDraftId: "draft-01",
      runDraftRevision: 3,
      runDraftChecksum: "draft-checksum-03"
    });
    const runResult = await handlers["application:agent-run:read-permission-summary"]?.({
      kind: "run",
      projectId: "project-01",
      runId: "run-01",
      permissionSummaryId: "permission-summary-01"
    });
    const decision = {
      projectId: "project-01",
      runId: "run-01",
      commandId: "plan-revision-decision-01",
      expectedRunRevision: 7,
      requestId: "request-01",
      planId: "plan-01",
      planRevision: 2,
      decision: "approve"
    };
    const decisionResult = await handlers["application:agent-run:decide-plan-revision"]?.(
      structuredClone(decision)
    );

    expect(draftResult).toMatchObject({ ok: true, value: summary });
    expect(runResult).toMatchObject({ ok: true, value: { runId: "run-01" } });
    expect(decisionResult).toMatchObject({ ok: true });
    expect(calls).toEqual([
      {
        name: "resolve-draft",
        value: {
          projectId: "project-01",
          conversationId: "conversation-01",
          runDraftId: "draft-01",
          runDraftRevision: 3,
          runDraftChecksum: "draft-checksum-03"
        }
      },
      {
        name: "prepare-permission",
        value: {
          projectId: "project-01",
          runDraftId: "draft-01",
          runDraftRevision: 3,
          operationMode: "execution",
          contextMode: "writing",
          writePolicy: "write_before_confirmation"
        }
      },
      {
        name: "read-permission",
        value: { runId: "run-01", permissionSummaryId: "permission-summary-01" }
      },
      { name: "decide-plan-revision", value: decision }
    ]);
  });

  test("preload exposes the permission summary and plan revision channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      }
    });

    await api.agentRuns.readPermissionSummary({
      kind: "run",
      projectId: "project-01",
      runId: "run-01",
      permissionSummaryId: "permission-summary-01"
    });
    await api.agentRuns.decidePlanRevision({
      projectId: "project-01",
      runId: "run-01",
      commandId: "decision-01",
      expectedRunRevision: 7,
      requestId: "request-01",
      planId: "plan-01",
      planRevision: 2,
      decision: "reject"
    });

    expect(invoked).toEqual([
      "application:agent-run:read-permission-summary",
      "application:agent-run:decide-plan-revision"
    ]);
  });

  test("rejects malformed Change Set decisions before the session boundary", async () => {
    let called = false;
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: {
          decideChangeSet: async () => {
            called = true;
            return { ok: true, value: snapshot("applying_changes", 8, 8) };
          },
          subscribe: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const result = await handlers["application:agent-run:decide-change-set"]?.({
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "change-set-invalid",
      expectedRunRevision: 7,
      changeSetId: "cs-01",
      revision: 4,
      checksum: "checksum-r4",
      decision: "write_candidate_body",
      candidateText: "must never cross IPC"
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false });
  });

  test("validates discriminated rollback review commands before the session boundary", async () => {
    const received: Record<string, unknown>[] = [];
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRunSession: {
          async undoRun(command: Record<string, unknown>) {
            received.push(command);
            return { ok: true, value: snapshot("completed", 10, 10) };
          },
          subscribe: () => () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const resolved = await handlers["application:agent-run:undo"]?.({
      action: "resolve",
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-resolve-01",
      expectedRunRevision: 9,
      reviewId: "rollback-review-01",
      decisions: [{ relativePath: "notes/outline.md", decision: "restore_baseline" }]
    });
    const invalid = await handlers["application:agent-run:undo"]?.({
      action: "resolve",
      projectId: "project-01",
      runId: "run-ipc",
      commandId: "undo-resolve-invalid",
      expectedRunRevision: 9,
      reviewId: "rollback-review-01",
      decisions: [{ relativePath: "notes/outline.md", decision: "overwrite_current" }],
      candidateText: "must never cross IPC"
    });

    expect(resolved).toMatchObject({ ok: true });
    expect(invalid).toMatchObject({ ok: false });
    expect(received).toEqual([
      {
        action: "resolve",
        projectId: "project-01",
        runId: "run-ipc",
        commandId: "undo-resolve-01",
        expectedRunRevision: 9,
        reviewId: "rollback-review-01",
        decisions: [{ relativePath: "notes/outline.md", decision: "restore_baseline" }]
      }
    ]);
  });

  test("routes strict Conversation commands through the currently bound runtime", async () => {
    const calls: string[] = [];
    const createRuntime = (projectId: string) => ({
      workspaceId: projectId,
      projectId,
      projectRoot: `C:/${projectId}`,
      agentRunSession: {},
      agentConversationSession: {
        async createConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:create:${String(command["commandId"])}`);
          return { ok: true, value: conversationSummary(projectId) };
        },
        async listConversations(query: Record<string, unknown>) {
          calls.push(`${projectId}:list:${String(query["limit"])}`);
          return { ok: true, value: { items: [conversationSummary(projectId)], diagnostics: [] } };
        },
        async readConversation(query: Record<string, unknown>) {
          calls.push(`${projectId}:read:${String(query["conversationId"])}`);
          return {
            ok: true,
            value: { ...conversationSummary(projectId), runs: [], diagnostics: [] }
          };
        },
        async archiveConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:archive:${String(command["expectedConversationRevision"])}`);
          return { ok: true, value: { ...conversationSummary(projectId), status: "archived" } };
        },
        async restoreConversation(command: Record<string, unknown>) {
          calls.push(`${projectId}:restore:${String(command["expectedConversationRevision"])}`);
          return { ok: true, value: conversationSummary(projectId) };
        },
        async searchConversations(query: Record<string, unknown>) {
          calls.push(`${projectId}:search:${String(query["query"])}`);
          return {
            ok: true,
            value: {
              items: [{ ...conversationSummary(projectId), snippet: "Opening scene" }],
              diagnostics: []
            }
          };
        }
      }
    });
    const first = createRuntime("project-01");
    const second = createRuntime("project-02");
    let current = first;
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => current,
          currentWorkspace: () => ({
            workspaceId: current.workspaceId,
            contentRoot: current.projectRoot,
            stateRoot: current.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const created = await handlers["application:agent-conversation:create"]?.({
      projectId: "project-01",
      commandId: "create-01"
    });
    await handlers["application:agent-conversation:list"]?.({
      projectId: "project-01",
      includeArchived: true,
      limit: 30
    });
    await handlers["application:agent-conversation:read"]?.({
      projectId: "project-01",
      conversationId: "conversation-01"
    });
    await handlers["application:agent-conversation:archive"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "archive-01",
      expectedConversationRevision: 1
    });
    await handlers["application:agent-conversation:restore"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "restore-01",
      expectedConversationRevision: 2
    });
    await handlers["application:agent-conversation:search"]?.({
      projectId: "project-01",
      query: "Opening",
      cursor: "next_page",
      limit: 10
    });
    expect(() => structuredClone(created)).not.toThrow();

    current = second;
    await handlers["application:agent-conversation:list"]?.({
      projectId: "project-02",
      limit: 5
    });
    const callCount = calls.length;
    const invalidResults = await Promise.all([
      handlers["application:agent-conversation:create"]?.({
        projectId: "project-02",
        commandId: "create-invalid",
        extra: true
      }),
      handlers["application:agent-conversation:list"]?.({
        projectId: "project-02",
        cursor: "bad cursor"
      }),
      handlers["application:agent-conversation:list"]?.({
        projectId: "project-02",
        limit: 101
      }),
      handlers["application:agent-conversation:archive"]?.({
        projectId: "project-02",
        conversationId: "conversation-01",
        commandId: "archive-invalid",
        expectedConversationRevision: -1
      })
    ]);

    expect(invalidResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ ok: false })])
    );
    expect(invalidResults.every((result) => (result as { ok?: boolean }).ok === false)).toBe(true);
    expect(calls).toHaveLength(callCount);
    expect(calls).toEqual([
      "project-01:create:create-01",
      "project-01:list:30",
      "project-01:read:conversation-01",
      "project-01:archive:1",
      "project-01:restore:2",
      "project-01:search:Opening",
      "project-02:list:5"
    ]);
  });

  test("rebinds the Agent runtime after project open and blocks switching during an active run", async () => {
    const calls: string[] = [];
    let active = false;
    const application = {
      async openProject(projectRoot: string) {
        calls.push(`open:${projectRoot}`);
        return {
          ok: true,
          value: {
            projectRoot,
            project: { projectId: "project-02" },
            chapters: [{ id: "chapter-02" }]
          }
        };
      }
    } as unknown as DesktopApplication;
    const handlers = createApplicationIpcHandlers(application, {
      agentRuntimeManager: {
        current: () => undefined,
        currentWorkspace: () => undefined,
        hasActiveRun: async () => ({ ok: true, value: active }),
        async bindWorkspace(binding: Record<string, unknown>) {
          calls.push(
            `bind:${String(binding["workspaceId"])}:${String(binding["activeChapterId"])}`
          );
          return { ok: true, value: undefined };
        },
        subscribeAgentRunEvents: () => () => undefined,
        dispose: () => undefined
      }
    } as never) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    expect(await handlers["application:project:open"]?.("C:/Project-Two")).toMatchObject({
      ok: true
    });
    active = true;
    expect(await handlers["application:project:open"]?.("C:/Project-Three")).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUNTIME_PROJECT_SWITCH_BLOCKED" }
    });
    expect(calls).toEqual(["open:C:/Project-Two", "bind:project-02:chapter-02"]);
  });

  test("preload exposes all Conversation commands on allowlisted channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on: () => () => undefined
    }) as unknown as Record<string, unknown>;
    const conversations = api["agentConversations"] as
      Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    expect(conversations).toBeDefined();
    if (conversations === undefined) return;

    await conversations["create"]?.({});
    await conversations["list"]?.({});
    await conversations["read"]?.({});
    await conversations["archive"]?.({});
    await conversations["restore"]?.({});
    await conversations["search"]?.({});

    expect(invoked).toEqual([
      "application:agent-conversation:create",
      "application:agent-conversation:list",
      "application:agent-conversation:read",
      "application:agent-conversation:archive",
      "application:agent-conversation:restore",
      "application:agent-conversation:search"
    ]);
  });

  test("routes draft/context-budget commands through the bound runtime and rejects malformed ones", async () => {
    const calls: string[] = [];
    const draftView = { ok: true, value: { runDraft: {}, contextDraft: {} } };
    const runtime = {
      workspaceId: "project-01",
      projectId: "project-01",
      projectRoot: "C:/project-01",
      agentRunSession: {},
      agentRunDraftSession: {
        async readAgentRunDraft(command: Record<string, unknown>) {
          calls.push(`read-run-draft:${String(command["conversationId"])}`);
          return draftView;
        },
        async updateAgentRunDraft(command: Record<string, unknown>) {
          calls.push(
            `update-run-draft:${String((command["mutation"] as Record<string, unknown>)["kind"])}`
          );
          return draftView;
        },
        async updateContextDraft(command: Record<string, unknown>) {
          calls.push(
            `update-context-draft:${String(
              (command["mutation"] as Record<string, unknown>)["kind"]
            )}`
          );
          return draftView;
        },
        async refreshContextDraft(command: Record<string, unknown>) {
          calls.push(`refresh-context-draft:${String(command["contextDraftId"])}`);
          return draftView;
        }
      },
      agentContextSession: {
        async previewContextBudget(command: Record<string, unknown>) {
          calls.push(`preview-budget:${String(command["commandId"])}`);
          return { ok: true, value: { contextBudgetSnapshotId: "budget-01" } };
        },
        async compactContext(command: Record<string, unknown>) {
          calls.push(`compact:${String(command["trigger"])}`);
          return { ok: true, value: { compactionId: "compaction-01" } };
        }
      }
    };
    const handlers = createApplicationIpcHandlers(
      {} as DesktopApplication,
      {
        agentRuntimeManager: {
          current: () => runtime,
          currentWorkspace: () => ({
            workspaceId: runtime.workspaceId,
            contentRoot: runtime.projectRoot,
            stateRoot: runtime.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindWorkspace: async () => ({ ok: true, value: undefined }),
          subscribeAgentRunEvents: () => () => undefined,
          dispose: () => undefined
        }
      } as never
    ) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    const readDraft = await handlers["application:agent-run:read-run-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      initialize: {
        modelProfileId: "profile-01",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation"
      }
    });
    expect(() => structuredClone(readDraft)).not.toThrow();
    await handlers["application:agent-run:update-run-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-01",
      expectedDraftRevision: 1,
      mutation: { kind: "set_model", modelProfileId: "profile-02" }
    });
    await handlers["application:agent-run:update-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-02",
      contextDraftId: "context-01",
      expectedDraftRevision: 1,
      mutation: { kind: "remove_ref", refId: "chapter:ch-01" }
    });
    await handlers["application:agent-run:refresh-context-draft"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-03",
      contextDraftId: "context-01",
      expectedDraftRevision: 2
    });
    await handlers["application:agent-run:preview-context-budget"]?.({
      projectId: "project-01",
      conversationId: "conversation-01",
      commandId: "cmd-04",
      runDraftId: "draft-01",
      expectedDraftRevision: 3,
      runDraftChecksum: "checksum-01"
    });
    await handlers["application:agent-run:compact-context"]?.({
      projectId: "project-01",
      runId: "run-01",
      commandId: "cmd-05",
      expectedRunRevision: 4,
      contextBudgetSnapshotId: "budget-01",
      trigger: "manual"
    });

    const before = calls.length;
    const rejected = await Promise.all([
      handlers["application:agent-run:update-run-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad",
        expectedDraftRevision: 1,
        mutation: { kind: "set_model" }
      }),
      handlers["application:agent-run:update-context-draft"]?.({
        projectId: "project-01",
        conversationId: "conversation-01",
        commandId: "cmd-bad",
        contextDraftId: "context-01",
        expectedDraftRevision: 1,
        mutation: { kind: "unknown_mutation" }
      }),
      handlers["application:agent-run:compact-context"]?.({
        projectId: "project-01",
        runId: "run-01",
        commandId: "cmd-bad",
        expectedRunRevision: 4,
        contextBudgetSnapshotId: "budget-01",
        trigger: "sideways"
      })
    ]);
    expect(rejected.every((result) => (result as { ok?: boolean }).ok === false)).toBe(true);
    expect(calls).toHaveLength(before);
    expect(calls).toEqual([
      "read-run-draft:conversation-01",
      "update-run-draft:set_model",
      "update-context-draft:remove_ref",
      "refresh-context-draft:context-01",
      "preview-budget:cmd-04",
      "compact:manual"
    ]);
  });

  test("preload exposes the Stage 5 context controls on allowlisted channels", async () => {
    const invoked: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel) {
        invoked.push(channel);
        return { ok: true, value: {} };
      },
      on: () => () => undefined
    }) as unknown as Record<string, unknown>;
    const agentRuns = api["agentRuns"] as
      Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
    expect(agentRuns).toBeDefined();
    if (agentRuns === undefined) return;

    await agentRuns["readRunDraft"]?.({});
    await agentRuns["updateRunDraft"]?.({});
    await agentRuns["updateContextDraft"]?.({});
    await agentRuns["refreshContextDraft"]?.({});
    await agentRuns["previewContextBudget"]?.({});
    await agentRuns["compactContext"]?.({});

    expect(invoked).toEqual([
      "application:agent-run:read-run-draft",
      "application:agent-run:update-run-draft",
      "application:agent-run:update-context-draft",
      "application:agent-run:refresh-context-draft",
      "application:agent-run:preview-context-budget",
      "application:agent-run:compact-context"
    ]);
  });
});

function conversationSummary(projectId: string) {
  return {
    schemaVersion: "1.0",
    conversationId: "conversation-01",
    projectId,
    revision: 1,
    title: "Opening scene",
    status: "active",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    runCount: 0,
    summaryFreshness: "fresh"
  };
}

function snapshot(status: string, runRevision: number, lastSequence: number) {
  return {
    schemaVersion: "1.0",
    runId: "run-ipc",
    projectId: "project-01",
    conversationId: "conversation-01",
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "制定计划",
    status,
    runRevision,
    lastSequence,
    startedAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
    providerCapabilitySnapshot: {
      profileId: "profile-01",
      provider: "demo",
      modelName: "agent-demo",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000,
      requiredContextTokens: 8000
    },
    pendingUserInputId: null,
    contextSnapshotId: null,
    sourcePlanId: null,
    sourcePlanRevision: null
  };
}
