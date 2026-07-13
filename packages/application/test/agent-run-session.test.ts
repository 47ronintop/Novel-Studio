import { describe, expect, test, vi } from "vitest";

import * as applicationExports from "../src/index.js";

describe("AgentRunSession", () => {
  test("streams three reads, pauses for user input, and resumes the same run to completion", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const persistenceOrder: string[] = [];
    const publishedTypes: string[] = [];
    const toolCalls: string[] = [];
    let round = 0;

    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
        subscribe(listener: (event: Record<string, unknown>) => void): () => void;
      }
    )({
      coordinatorOptions: {
        createRunId: () => "run_read_pause",
        now: createSequence([
          "2026-07-13T00:00:00.000Z",
          "2026-07-13T00:00:01.000Z",
          "2026-07-13T00:00:02.000Z",
          "2026-07-13T00:00:03.000Z",
          "2026-07-13T00:00:04.000Z",
          "2026-07-13T00:00:05.000Z",
          "2026-07-13T00:00:06.000Z",
          "2026-07-13T00:00:07.000Z",
          "2026-07-13T00:00:08.000Z",
          "2026-07-13T00:00:09.000Z",
          "2026-07-13T00:00:10.000Z",
          "2026-07-13T00:00:11.000Z"
        ])
      },
      repository: {
        async writeSnapshot(snapshot: Record<string, unknown>) {
          persistenceOrder.push(`snapshot:${snapshot["lastSequence"]}`);
          return { ok: true, value: snapshot };
        },
        async appendEvent(event: Record<string, unknown>) {
          persistenceOrder.push(`event:${event["sequence"]}`);
          return { ok: true, value: event };
        },
        async writeCommandReceipt() {
          return { ok: true, value: {} };
        },
        async readSnapshot() {
          return { ok: true, value: undefined };
        },
        async readEvents() {
          return { ok: true, value: [] };
        }
      },
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          round += 1;
          if (round === 1) {
            yield { type: "assistant_text_delta", delta: "我会先核对三个来源。" };
            yield toolCall("call_entries", "list_project_entries", { path: "chapters" });
            yield toolCall("call_chapter", "read_chapter", { chapterId: "chapter-03" });
            yield toolCall("call_bible", "read_story_bible", { assetId: "character-linxia" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          if (round === 2) {
            yield toolCall("call_question", "request_user_input", {
              questionId: "question_timing",
              prompt: "是否保留现有揭示时机？",
              reason: "这会影响第 3 章的改写范围。",
              options: [
                { id: "keep", label: "保留" },
                { id: "move", label: "提前" }
              ]
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          expect(input.messages).toContainEqual(
            expect.objectContaining({ role: "user", content: "保留现有揭示时机。" })
          );
          yield toolCall("call_finish", "finish", { summary: "只读核对完成。" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute(input: { readonly name: string }) {
          toolCalls.push(input.name);
          return {
            ok: true,
            value: {
              summary: `已读取 ${input.name}`,
              data: { content: `untrusted content for ${input.name}` }
            }
          };
        }
      }
    });

    session.subscribe((event) => {
      persistenceOrder.push(`publish:${event["sequence"]}`);
      publishedTypes.push(String(event["type"]));
    });

    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({ ok: true, value: { runId: "run_read_pause" } });

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_read_pause")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_user_input" } }
      });
    });

    const paused = await session.readAgentRun("run_read_pause");
    const pausedSnapshot = (paused as { value: { snapshot: Record<string, unknown> } }).value
      .snapshot;
    const answered = await session.answerUserInput({
      projectId: "project-01",
      runId: "run_read_pause",
      commandId: "answer-01",
      expectedRunRevision: pausedSnapshot["runRevision"],
      questionId: "question_timing",
      answer: "保留现有揭示时机。"
    });
    expect(answered).toMatchObject({ ok: true });

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_read_pause")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    expect(toolCalls).toEqual(["list_project_entries", "read_chapter", "read_story_bible"]);
    expect(publishedTypes).toEqual([
      "run_started",
      "assistant_text_delta",
      "tool_started",
      "tool_completed",
      "tool_started",
      "tool_completed",
      "tool_started",
      "tool_completed",
      "user_input_requested",
      "user_input_resolved",
      "run_completed"
    ]);
    for (const published of persistenceOrder.filter((entry) => entry.startsWith("publish:"))) {
      const sequence = published.slice("publish:".length);
      expect(persistenceOrder.indexOf(`event:${sequence}`)).toBeLessThan(
        persistenceOrder.indexOf(published)
      );
      expect(persistenceOrder.indexOf(`snapshot:${sequence}`)).toBeLessThan(
        persistenceOrder.indexOf(published)
      );
    }
    expect(JSON.stringify(await session.readAgentRun("run_read_pause"))).not.toContain(
      "untrusted content"
    );
  });

  test("deduplicates stop commands and isolates provider events that arrive after cancellation", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const publishedTypes: string[] = [];
    let observedAbort = false;
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
        subscribe(listener: (event: Record<string, unknown>) => void): () => void;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_stop_late" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound(input: { readonly signal: AbortSignal }) {
          input.signal.addEventListener("abort", () => {
            observedAbort = true;
          });
          await providerGate;
          yield toolCall("late_finish", "finish", { summary: "late" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    session.subscribe((event) => publishedTypes.push(String(event["type"])));

    await session.startAgentRun(startCommand());
    const current = await session.readAgentRun("run_stop_late");
    const revision = (current as { value: { snapshot: { runRevision: number } } }).value.snapshot
      .runRevision;
    const stopCommand = {
      projectId: "project-01",
      runId: "run_stop_late",
      commandId: "stop-01",
      expectedRunRevision: revision
    };
    const first = await session.stopAgentRun(stopCommand);
    const duplicate = await session.stopAgentRun(stopCommand);
    releaseProvider();

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_stop_late")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "cancelled" } }
      });
    });
    expect(duplicate).toEqual(first);
    expect(observedAbort).toBe(true);
    expect(publishedTypes.filter((type) => type === "run_cancelled")).toHaveLength(1);
    expect(publishedTypes).not.toContain("run_completed");
  });

  test("pauses before the next model round when a critical context source becomes stale", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let rounds = 0;
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_context_stale" },
      createContextSnapshotId: () => "context_run_context_stale_01",
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("read_notes", "read_project_text", { path: "notes/outline.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      readToolExecutor: {
        async execute() {
          return {
            ok: true,
            value: {
              summary: "已读取 notes/outline.md",
              data: { content: "original" },
              source: {
                refId: "file:notes/outline.md",
                sourceKind: "disk_file",
                relativePath: "notes/outline.md",
                content: "original",
                dirty: false
              }
            }
          };
        }
      },
      contextSourceReader: {
        async readCurrentSources() {
          return {
            ok: true,
            value: [{ refId: "file:notes/outline.md", content: "changed" }]
          };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_stale")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "awaiting_context_refresh",
            contextSnapshotId: "context_run_context_stale_01"
          },
          events: [
            expect.objectContaining({ type: "run_started" }),
            expect.objectContaining({ type: "tool_started" }),
            expect.objectContaining({ type: "tool_completed" }),
            expect.objectContaining({ type: "context_stale" })
          ]
        }
      });
    });
    expect(rounds).toBe(1);
  });

  test("planning exposes no proposal tools and persists a complete immutable Plan Artifact", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const persistedPlans: Record<string, unknown>[] = [];
    const repository = {
      ...memoryRepository(),
      async writePlanArtifact(plan: Record<string, unknown>) {
        persistedPlans.push(plan);
        return { ok: true, value: plan };
      }
    };
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_plan" },
      repository,
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          expect(input.tools.map((tool) => tool.name)).toEqual([
            "list_project_entries",
            "read_chapter",
            "read_story_bible",
            "read_project_text",
            "finish_plan",
            "request_user_input"
          ]);
          yield toolCall("finish_plan_01", "finish_plan", {
            planId: "plan-01",
            goal: "统一第 3 至 5 章的人物动机。",
            successCriteria: ["动机与 Story Bible 一致"],
            nonGoals: ["不改结局"],
            facts: ["第 3 章存在冲突"],
            assumptions: ["保留现有揭示节奏"],
            openQuestions: [
              {
                questionId: "plan-question-01",
                prompt: "是否保留揭示时机？",
                blocking: true
              }
            ],
            targetRefs: [{ refId: "chapter-03", intent: "修正冲突触发点" }],
            steps: [
              {
                stepId: "step-01",
                title: "校正第 3 章动机",
                verification: "重新核对 Story Bible"
              }
            ],
            risks: ["连续性漂移"],
            verification: ["运行一致性检查"],
            sourceRefs: ["chapter-03", "story-bible:linxia"]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          throw new Error("No read should be needed.");
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_plan")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "plan_ready" },
          planArtifact: {
            planId: "plan-01",
            revision: 1,
            openQuestions: [
              expect.objectContaining({ questionId: "plan-question-01", blocking: true })
            ],
            targetRefs: [expect.objectContaining({ refId: "chapter-03" })],
            steps: [expect.objectContaining({ stepId: "step-01" })]
          }
        }
      });
    });
    expect(persistedPlans).toHaveLength(1);
    expect(Object.isFrozen(persistedPlans[0])).toBe(true);
  });

  test("terminates with limit_reached before starting a model round beyond the configured budget", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let rounds = 0;
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_round_limit" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds > 1) {
            yield { type: "round_completed", finishReason: "stop" };
            return;
          }
          yield toolCall(`read-${rounds}`, "read_project_text", { path: "notes/outline.md" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "read", data: {} } };
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 1, maxToolCalls: 4, maxConsecutiveToolFailures: 2 }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_round_limit")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "limit_reached" },
          events: [
            expect.objectContaining({ type: "run_started" }),
            expect.objectContaining({ type: "tool_started" }),
            expect.objectContaining({ type: "tool_completed" }),
            expect.objectContaining({ type: "run_limit_reached" })
          ]
        }
      });
    });
    expect(rounds).toBe(1);
  });

  test("returns the original start receipt without republishing or restarting the model", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let modelStarts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const published: string[] = [];
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        subscribe(listener: (event: Record<string, unknown>) => void): () => void;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_start_idempotent" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          modelStarts += 1;
          await gate;
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    session.subscribe((event) => published.push(String(event["type"])));

    const command = startCommand();
    const first = await session.startAgentRun(command);
    const duplicate = await session.startAgentRun(command);
    expect(duplicate).toEqual(first);
    expect(published.filter((type) => type === "run_started")).toHaveLength(1);
    expect(modelStarts).toBe(1);
    release();
  });

  test("restores a durable question in a new session and resumes the same run after an answer", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const repository = durableMemoryRepository();
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const firstSession = create({
      coordinatorOptions: { createRunId: () => "run_durable_pause" },
      repository,
      modelDriver: {
        async *streamRound() {
          yield toolCall("durable_question", "request_user_input", {
            questionId: "question_durable",
            prompt: "保留揭示时机？",
            reason: "需要确定范围。",
            options: [
              { id: "yes", label: "保留" },
              { id: "no", label: "调整" }
            ]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    await firstSession.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await firstSession.readAgentRun("run_durable_pause")).toMatchObject({
        value: { snapshot: { status: "awaiting_user_input" } }
      });
    });

    let resumedMessages: readonly Record<string, unknown>[] = [];
    const restoredSession = create({
      repository,
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          resumedMessages = input.messages;
          yield toolCall("durable_finish", "finish", { summary: "resumed" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    const restored = await restoredSession.readAgentRun("run_durable_pause");
    expect(restored).toMatchObject({
      ok: true,
      value: {
        snapshot: { runId: "run_durable_pause", status: "awaiting_user_input" },
        pendingUserInput: { questionId: "question_durable" }
      }
    });
    const revision = (restored as { value: { snapshot: { runRevision: number } } }).value.snapshot
      .runRevision;
    await restoredSession.answerUserInput({
      projectId: "project-01",
      runId: "run_durable_pause",
      commandId: "durable-answer",
      expectedRunRevision: revision,
      questionId: "question_durable",
      answer: "保留揭示时机。"
    });
    await vi.waitFor(async () => {
      expect(await restoredSession.readAgentRun("run_durable_pause")).toMatchObject({
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(resumedMessages).toContainEqual(
      expect.objectContaining({ role: "user", content: "核对第 3 章的人物动机。" })
    );
    expect(resumedMessages).toContainEqual(
      expect.objectContaining({ role: "user", content: "保留揭示时机。" })
    );
  });

  test("lists durable run snapshots for the selected project", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const repository = durableMemoryRepository();
    const session = (
      createSession as (
        options: Record<string, unknown>
      ) => Record<string, (...args: unknown[]) => Promise<unknown>>
    )({
      coordinatorOptions: { createRunId: () => "run_listed" },
      repository,
      modelDriver: {
        async *streamRound() {
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    expect(typeof session["listAgentRuns"]).toBe("function");
    if (typeof session["listAgentRuns"] !== "function") return;
    await session["startAgentRun"]?.(startCommand());
    expect(await session["listAgentRuns"]("project-01")).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ runId: "run_listed", projectId: "project-01" })]
    });
  });

  test("rejects per-run autonomous writes while Stage 1 is read-only", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    let modelStarted = false;
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_forbidden_policy" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          modelStarted = true;
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    expect(
      await session.startAgentRun({
        ...startCommand(),
        writePolicy: "user_preapproved_run"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_POLICY_NOT_AVAILABLE" }
    });
    expect(modelStarted).toBe(false);
  });

  test("does not execute a read tool after the total tool-call budget is exhausted", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const executed: string[] = [];
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_tool_limit" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("tool-one", "read_project_text", { path: "notes/one.md" });
          yield toolCall("tool-two", "read_project_text", { path: "notes/two.md" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute(input: { readonly arguments: Record<string, unknown> }) {
          executed.push(String(input.arguments["path"]));
          return { ok: true, value: { summary: "read", data: {} } };
        }
      }
    });
    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 2, maxToolCalls: 1, maxConsecutiveToolFailures: 2 }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_tool_limit")).toMatchObject({
        value: {
          snapshot: { status: "limit_reached" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "run_limit_reached",
              detail: expect.objectContaining({ limit: "maxToolCalls" })
            })
          ])
        }
      });
    });
    expect(executed).toEqual(["notes/one.md"]);
  });

  test("stops retrying read tools after the consecutive failure limit", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    let rounds = 0;
    let executions = 0;
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_failure_limit" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds > 3) {
            yield { type: "round_completed", finishReason: "stop" };
            return;
          }
          yield toolCall(`failed-read-${rounds}`, "read_project_text", {
            path: `notes/${rounds}.md`
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: {
        async execute() {
          executions += 1;
          return {
            ok: false,
            error: {
              errorId: `error-${executions}`,
              code: "AGENT_READ_FAILED",
              category: "StorageError",
              message: "read failed",
              recoverability: "retryable",
              suggestedAction: "retry",
              traceId: "test",
              timestamp: "2026-07-13T00:00:00.000Z"
            }
          };
        }
      }
    });
    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 4, maxToolCalls: 10, maxConsecutiveToolFailures: 2 }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_failure_limit")).toMatchObject({
        value: {
          snapshot: { status: "limit_reached" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "run_limit_reached",
              detail: expect.objectContaining({ limit: "maxConsecutiveToolFailures" })
            })
          ])
        }
      });
    });
    expect(executions).toBe(2);
  });
});

function toolCall(toolCallId: string, name: string, argumentsValue: Record<string, unknown>) {
  return {
    type: "tool_call_delta",
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(argumentsValue)
  };
}

function startCommand(): Record<string, unknown> {
  return {
    projectId: "project-01",
    commandId: "start-01",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "核对第 3 章的人物动机。",
    providerCapabilitySnapshot: {
      profileId: "profile-01",
      provider: "demo",
      modelName: "scripted-agent",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000,
      requiredContextTokens: 8000
    }
  };
}

function createSequence(values: readonly string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? values[values.length - 1] ?? "";
}

function memoryRepository() {
  return {
    async writeSnapshot(snapshot: Record<string, unknown>) {
      return { ok: true, value: snapshot };
    },
    async appendEvent(event: Record<string, unknown>) {
      return { ok: true, value: event };
    },
    async writeCommandReceipt() {
      return { ok: true, value: {} };
    },
    async readSnapshot() {
      return { ok: true, value: undefined };
    },
    async readEvents() {
      return { ok: true, value: [] };
    }
  };
}

function durableMemoryRepository() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>[]>();
  return {
    async writeSnapshot(snapshot: Record<string, unknown>) {
      snapshots.set(String(snapshot["runId"]), structuredClone(snapshot));
      return { ok: true, value: snapshot };
    },
    async appendEvent(event: Record<string, unknown>) {
      const runId = String(event["runId"]);
      events.set(runId, [...(events.get(runId) ?? []), structuredClone(event)]);
      return { ok: true, value: event };
    },
    async writeCommandReceipt() {
      return { ok: true, value: {} };
    },
    async readSnapshot(runId: string) {
      return { ok: true, value: snapshots.get(runId) };
    },
    async readEvents(runId: string) {
      return { ok: true, value: events.get(runId) ?? [] };
    },
    async listSnapshots(projectId: string) {
      return {
        ok: true,
        value: [...snapshots.values()].filter((snapshot) => snapshot["projectId"] === projectId)
      };
    }
  };
}
