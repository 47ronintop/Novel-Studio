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
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "制定计划",
      providerCapabilitySnapshot: {
        profileId: "profile-01",
        provider: "demo",
        modelName: "agent-demo",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128000,
        requiredContextTokens: 8000
      }
    };
    expect(typeof handlers["application:agent-run:start"]).toBe("function");
    expect(typeof handlers["application:agent-run:stop"]).toBe("function");
    expect(typeof handlers["application:agent-run:answer-user-input"]).toBe("function");
    expect(typeof handlers["application:agent-run:resume"]).toBe("function");
    expect(typeof handlers["application:agent-run:retry-step"]).toBe("function");
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
      "application:agent-run:decide-plan",
      "application:agent-run:refresh-context",
      "application:agent-run:decide-change-set",
      "application:agent-run:undo",
      "application:agent-run:read",
      "application:agent-run:list"
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
          currentProject: () => ({
            projectId: current.projectId,
            projectRoot: current.projectRoot
          }),
          hasActiveRun: async () => ({ ok: true, value: false }),
          bindProject: async () => ({ ok: true, value: undefined }),
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
        currentProject: () => undefined,
        hasActiveRun: async () => ({ ok: true, value: active }),
        async bindProject(binding: Record<string, unknown>) {
          calls.push(`bind:${String(binding["projectId"])}:${String(binding["activeChapterId"])}`);
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
