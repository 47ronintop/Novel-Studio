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
      "application:agent-run:read",
      "application:agent-run:list"
    ]);
  });
});

function snapshot(status: string, runRevision: number, lastSequence: number) {
  return {
    schemaVersion: "1.0",
    runId: "run-ipc",
    projectId: "project-01",
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
