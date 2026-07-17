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
      startPreflight: echoStartPreflight(),
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
      "assistant_text_completed",
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
      startPreflight: echoStartPreflight(),
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

  test("binds the preflight-resolved context budget id onto the started run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const withBudget = create({
      coordinatorOptions: { createRunId: () => "run_budget" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: budgetStartPreflight("budget_start_01"),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    const started = await withBudget.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: { runId: "run_budget", contextBudgetSnapshotId: "budget_start_01" }
    });

    const withoutBudget = create({
      coordinatorOptions: { createRunId: () => "run_no_budget" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    const plain = await withoutBudget.startAgentRun({ ...startCommand(), commandId: "start-02" });
    expect(plain).toMatchObject({
      ok: true,
      value: { runId: "run_no_budget", contextBudgetSnapshotId: null }
    });
  });

  test("binds a server-verified permission summary onto the started run and persists it under the run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };

    const writtenSummaries: Record<string, unknown>[] = [];
    const session = create({
      coordinatorOptions: { createRunId: () => "run_permission_01" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      permission: fakePermissionPort({
        permissionSummaryId: "permission_summary_01",
        checksum: "checksum_01",
        toolRegistryRevision: "registry_revision_01",
        onBind: (summary) => writtenSummaries.push(summary)
      })
    });
    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: {
        runId: "run_permission_01",
        permissionSummaryId: "permission_summary_01",
        permissionSummaryChecksum: "checksum_01"
      }
    });
    expect(writtenSummaries).toHaveLength(1);
    expect(writtenSummaries[0]).toMatchObject({
      runId: "run_permission_01",
      permissionSummaryId: "permission_summary_01"
    });
  });

  test("blocks run creation when the permission port reports drift, and never creates a run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const session = create({
      coordinatorOptions: { createRunId: () => "run_permission_blocked" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      permission: {
        async verifyForStart() {
          return {
            ok: false,
            error: {
              code: "AGENT_PERMISSION_SUMMARY_STALE",
              category: "AgentError",
              message: "stale",
              recoverability: "user-action",
              suggestedAction: "retry",
              traceId: "test"
            }
          };
        },
        async bindToRun() {
          throw new Error("bindToRun must not be called when verification fails");
        }
      }
    });
    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({ ok: false, error: { code: "AGENT_PERMISSION_SUMMARY_STALE" } });
    const read = await session.readAgentRun("run_permission_blocked");
    expect(read).toMatchObject({ ok: false });
  });

  test("starts a run without a permission port unaffected (permissionSummaryId stays null)", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const session = create({
      coordinatorOptions: { createRunId: () => "run_no_permission" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: {
        runId: "run_no_permission",
        permissionSummaryId: null,
        permissionSummaryChecksum: null
      }
    });
  });

  test("evaluateContextBudgetPressure classifies the 70% warn and 85% compact bands", () => {
    const evaluate = (applicationExports as unknown as Record<string, unknown>)[
      "evaluateContextBudgetPressure"
    ];
    expect(typeof evaluate).toBe("function");
    if (typeof evaluate !== "function") return;
    const call = evaluate as (input: { usedTokens: number; safeInputBudget: number }) => string;
    expect(call({ usedTokens: 6000, safeInputBudget: 10000 })).toBe("ok");
    expect(call({ usedTokens: 7000, safeInputBudget: 10000 })).toBe("warn");
    expect(call({ usedTokens: 8499, safeInputBudget: 10000 })).toBe("warn");
    expect(call({ usedTokens: 8500, safeInputBudget: 10000 })).toBe("compact");
    // A non-positive budget is immediate compaction pressure, never silently "ok".
    expect(call({ usedTokens: 0, safeInputBudget: 0 })).toBe("compact");
  });

  test("compactContext delegates to the context compactor and is unavailable without one", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      compactContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    let delegatedTo: string | undefined;
    const withCompactor = create({
      coordinatorOptions: { createRunId: () => "run_compact" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      contextCompactor: {
        async compactContext(command: { runId: string }) {
          delegatedTo = command.runId;
          return { ok: true, value: { compactionId: "compaction_1", runSnapshot: {} } };
        }
      }
    });
    await withCompactor.startAgentRun(startCommand());
    const current = await withCompactor.readAgentRun("run_compact");
    const revision = (current as { value: { snapshot: { runRevision: number } } }).value.snapshot
      .runRevision;
    const compacted = await withCompactor.compactContext({
      projectId: "project-01",
      runId: "run_compact",
      commandId: "compact-01",
      expectedRunRevision: revision,
      contextBudgetSnapshotId: "budget_current",
      trigger: "manual"
    });
    expect(compacted).toMatchObject({ ok: true });
    expect(delegatedTo).toBe("run_compact");

    const withoutCompactor = create({
      coordinatorOptions: { createRunId: () => "run_no_compact" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    await withoutCompactor.startAgentRun({ ...startCommand(), commandId: "start-nc" });
    const ncCurrent = await withoutCompactor.readAgentRun("run_no_compact");
    const ncRevision = (ncCurrent as { value: { snapshot: { runRevision: number } } }).value
      .snapshot.runRevision;
    const unavailable = await withoutCompactor.compactContext({
      projectId: "project-01",
      runId: "run_no_compact",
      commandId: "compact-02",
      expectedRunRevision: ncRevision,
      contextBudgetSnapshotId: "budget_current",
      trigger: "manual"
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_COMPACTION_UNAVAILABLE" }
    });
  });

  test("returns the persisted stop receipt after application reload", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const repository = durableMemoryRepository();
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const firstSession = create({
      coordinatorOptions: { createRunId: () => "run_stop_reload" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    await firstSession.startAgentRun(startCommand());
    const running = (await firstSession.readAgentRun("run_stop_reload")) as {
      value: { snapshot: { runRevision: number } };
    };
    const command = {
      projectId: "project-01",
      runId: "run_stop_reload",
      commandId: "stop-reload-01",
      expectedRunRevision: running.value.snapshot.runRevision
    };
    const first = await firstSession.stopAgentRun(command);
    const reloadedSession = create({
      repository,
      modelDriver: { streamRound: () => unexpectedModelRound("Stopped run must not resume.") },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });

    expect(await reloadedSession.stopAgentRun(command)).toEqual(first);
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
      repository: durableMemoryRepository(),
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
      startPreflight: echoStartPreflight(),
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
            contextSnapshotId: "context_run_context_stale_01",
            activeErrorId: expect.any(String),
            recoveryState: "awaiting_context_refresh"
          },
          events: [
            expect.objectContaining({ type: "run_started" }),
            expect.objectContaining({ type: "tool_started" }),
            expect.objectContaining({ type: "tool_completed" }),
            expect.objectContaining({ type: "context_stale" }),
            expect.objectContaining({ type: "error_recorded" })
          ],
          diagnostic: expect.objectContaining({
            code: "AGENT_CONTEXT_STALE",
            recoveryState: "awaiting_context_refresh"
          })
        }
      });
    });
    expect(rounds).toBe(1);
  });

  test("persists a retryable provider disconnect and stops the active stream", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const repository = durableMemoryRepository();
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_provider_disconnect" },
      repository,
      modelDriver: {
        async *streamRound() {
          const error = Object.assign(new Error("socket closed"), {
            code: "AGENT_PROVIDER_DISCONNECTED",
            recoverability: "retryable",
            requestId: "request_disconnect_01"
          });
          error.stack = "provider stack must not persist";
          throw error;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("No tool should run after provider disconnect.");
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_provider_disconnect")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "executing_model",
            activeErrorId: expect.any(String),
            recoveryState: "retryable"
          },
          diagnostic: {
            code: "AGENT_PROVIDER_DISCONNECTED",
            provider: "demo",
            model: "scripted-agent",
            retryTargets: expect.arrayContaining([
              expect.objectContaining({ kind: "model_round" }),
              expect.objectContaining({ kind: "checkpoint" })
            ])
          }
        }
      });
    });
    const read = await session.readAgentRun("run_provider_disconnect");
    expect(JSON.stringify(read)).not.toContain("provider stack must not persist");
  });

  test("falls back to a terminal run when retryable provider diagnostics are unavailable", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_provider_without_diagnostics" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          throw Object.assign(new Error("socket closed"), {
            code: "AGENT_PROVIDER_DISCONNECTED",
            recoverability: "retryable"
          });
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("unused");
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_provider_without_diagnostics")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "failed", activeErrorId: null, recoveryState: "terminal" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "run_failed",
              detail: expect.objectContaining({
                code: "AGENT_PROVIDER_DISCONNECTED",
                diagnosticPersistenceFailed: true
              })
            })
          ])
        }
      });
    });
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
      startPreflight: echoStartPreflight(),
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
      startPreflight: echoStartPreflight(),
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
      startPreflight: echoStartPreflight(),
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

  test("returns the persisted start receipt after reload without creating a second run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const repository = durableMemoryRepository();
    const command = startCommand();
    const firstSession = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_start_reload" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
    const first = await firstSession.startAgentRun(command);
    let secondModelStarts = 0;
    const reloadedSession = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_start_duplicate" },
      repository,
      modelDriver: {
        async *streamRound() {
          secondModelStarts += 1;
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      listAgentRuns(projectId: string): Promise<Record<string, unknown>>;
    };

    expect(await reloadedSession.startAgentRun(command)).toEqual(first);
    expect(secondModelStarts).toBe(0);
    expect(await reloadedSession.listAgentRuns("project-01")).toMatchObject({
      value: [expect.objectContaining({ runId: "run_start_reload" })]
    });
  });

  test("blocks a different start command when an active run was persisted before reload", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const repository = durableMemoryRepository();
    const firstSession = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_active_reload" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    }) as { startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>> };
    await firstSession.startAgentRun(startCommand());

    let secondModelStarts = 0;
    const reloadedSession = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_must_not_start" },
      repository,
      modelDriver: {
        async *streamRound() {
          secondModelStarts += 1;
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    }) as { startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>> };

    expect(
      await reloadedSession.startAgentRun({ ...startCommand(), commandId: "start-after-reload" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ALREADY_ACTIVE" } });
    expect(secondModelStarts).toBe(0);
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
      startPreflight: echoStartPreflight(),
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
      startPreflight: echoStartPreflight(),
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
    const answerCommand = {
      projectId: "project-01",
      runId: "run_durable_pause",
      commandId: "durable-answer",
      expectedRunRevision: revision,
      questionId: "question_durable",
      answer: "保留揭示时机。"
    };
    const firstAnswer = await restoredSession.answerUserInput(answerCommand);
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
    const duplicateSession = create({
      repository,
      modelDriver: { streamRound: () => unexpectedModelRound("Duplicate answer must not resume.") },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });
    expect(await duplicateSession.answerUserInput(answerCommand)).toEqual(firstAnswer);
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
      startPreflight: echoStartPreflight(),
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

  test("requires explicit acknowledgement before a per-run automatic write policy", async () => {
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
      startPreflight: echoStartPreflight(),
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
      error: { code: "AGENT_WRITE_POLICY_ACK_REQUIRED" }
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
      startPreflight: echoStartPreflight(),
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
      startPreflight: echoStartPreflight(),
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

  test("resumes a persisted active run after application reload", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const snapshot = {
      schemaVersion: "1.0",
      runId: "run_reload_resume",
      projectId: "project-01",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "恢复运行",
      status: "executing_model",
      runRevision: 1,
      lastSequence: 1,
      startedAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
      providerCapabilitySnapshot: startCommand().providerCapabilitySnapshot,
      pendingUserInputId: null,
      contextSnapshotId: null,
      sourcePlanId: null,
      sourcePlanRevision: null
    };
    const events = [
      {
        schemaVersion: "1.0",
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        sequence: 1,
        runRevision: 1,
        type: "run_started",
        createdAt: snapshot.startedAt
      }
    ];
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      repository: {
        ...memoryRepository(),
        async readSnapshot() {
          return { ok: true, value: snapshot };
        },
        async readEvents() {
          return { ok: true, value: events };
        }
      },
      modelDriver: {
        async *streamRound() {
          yield toolCall("resume_finish", "finish", { summary: "恢复完成" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      resumeAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const resumed = await session.resumeAgentRun({
      projectId: snapshot.projectId,
      runId: snapshot.runId,
      commandId: "resume-01",
      expectedRunRevision: snapshot.runRevision
    });
    expect(resumed).toMatchObject({ ok: true, value: { runId: snapshot.runId } });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(snapshot.runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
  });

  test("approves a ready plan by creating a linked execution run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let runs = 0;
    const notedRunIds: string[] = [];
    const planExecutionRecords: Record<string, unknown>[] = [];
    const planExecutionReads: unknown[][] = [];
    const planRevisionRequests = new Map<string, Record<string, unknown>>();
    const permissionBindings: Record<string, unknown>[] = [];
    const permissionSummary = (
      permissionSummaryId: string,
      runDraftId: string,
      contextMode: string,
      writePolicy: string
    ) => ({
      schemaVersion: "1.0",
      permissionSummaryId,
      projectId: "project-01",
      runDraftId,
      contextMode,
      writePolicy,
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter"],
      proposalCapabilities: writePolicy === "user_preapproved_run" ? ["propose_chapter_write"] : [],
      forbiddenCapabilities: ["shell", "git", "network"],
      checksum: permissionSummaryId.padEnd(64, "0").slice(0, 64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    });
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => `run_plan_${++runs}` },
      repository: {
        ...memoryRepository(),
        async writePlanExecutionRecord(record: Record<string, unknown>) {
          planExecutionRecords.push(structuredClone(record));
          return { ok: true, value: record };
        },
        async readPlanExecutionRecord(...args: unknown[]) {
          planExecutionReads.push(args);
          return { ok: true, value: planExecutionRecords.at(-1) };
        },
        async writePlanRevisionRequest(request: Record<string, unknown>) {
          planRevisionRequests.set(String(request["requestId"]), structuredClone(request));
          return { ok: true, value: request };
        },
        async readPlanRevisionRequest(_runId: string, requestId: string) {
          return { ok: true, value: planRevisionRequests.get(requestId) };
        }
      },
      conversationLifecycle: {
        async assertRunMayStart() {
          return { ok: true, value: {} };
        },
        async loadContext() {
          return { ok: true, value: [] };
        },
        async noteRunStarted(snapshot: Record<string, unknown>) {
          notedRunIds.push(String(snapshot["runId"]));
          return { ok: true, value: undefined };
        },
        async noteRunTerminal() {
          return { ok: true, value: undefined };
        }
      },
      permission: {
        async verifyForStart(facts: Record<string, unknown>) {
          return {
            ok: true,
            value: permissionSummary(
              "permission-planning",
              String(facts["runDraftId"]),
              String(facts["contextMode"]),
              String(facts["writePolicy"])
            )
          };
        },
        async prepareForPlanHandoff(facts: Record<string, unknown>) {
          return {
            ok: true,
            value: permissionSummary(
              "permission-execution",
              String(facts["runDraftId"]),
              String(facts["contextMode"]),
              String(facts["writePolicy"])
            )
          };
        },
        async readForRun(input: Record<string, unknown>) {
          const bound = permissionBindings.find(
            (summary) =>
              summary["runId"] === input["runId"] &&
              summary["permissionSummaryId"] === input["permissionSummaryId"]
          );
          return { ok: true, value: bound };
        },
        async bindToRun(input: { runId: string; summary: Record<string, unknown> }) {
          const bound = { ...input.summary, runId: input.runId };
          permissionBindings.push(bound);
          return { ok: true, value: bound };
        }
      },
      modelDriver: {
        async *streamRound(input: { readonly snapshot: Record<string, unknown> }) {
          if (input.snapshot["sourcePlanId"] === "plan-01") {
            yield toolCall("execution_finish", "finish", { summary: "执行完成" });
          } else {
            yield toolCall("finish_plan", "finish_plan", {
              planId: "plan-01",
              goal: "生成计划",
              successCriteria: ["完成"],
              nonGoals: ["不写文件"],
              facts: ["已读取"],
              assumptions: [],
              openQuestions: [],
              targetRefs: [{ refId: "chapter:chapter-03", intent: "检查" }],
              steps: [{ stepId: "step-01", title: "检查", verification: "重新读取" }],
              risks: [],
              verification: ["读取章节"],
              sourceRefs: ["chapter:chapter-03"]
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const started = await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    const planningRunId = String((started as { value: { runId: string } }).value.runId);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(planningRunId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    const planning = (await session.readAgentRun(planningRunId)) as {
      value: { snapshot: Record<string, unknown> };
    };
    const rejectedContext = await session.decidePlan({
      projectId: "project-01",
      runId: planningRunId,
      commandId: "plan-invalid-context-01",
      expectedRunRevision: planning.value.snapshot["runRevision"],
      planId: "plan-01",
      planRevision: 1,
      decision: "approve",
      executionContextMode: "unsupported"
    });
    expect(rejectedContext).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_MODE_INVALID" }
    });
    const rejectedPolicy = await session.decidePlan({
      projectId: "project-01",
      runId: planningRunId,
      commandId: "plan-auto-policy-01",
      expectedRunRevision: planning.value.snapshot["runRevision"],
      planId: "plan-01",
      planRevision: 1,
      decision: "approve",
      executionWritePolicy: "user_preapproved_run"
    });
    expect(rejectedPolicy).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_POLICY_ACK_REQUIRED" }
    });
    expect(await session.readAgentRun(planningRunId)).toMatchObject({
      value: { snapshot: { status: "plan_ready" } }
    });
    const decided = await session.decidePlan({
      projectId: "project-01",
      runId: planningRunId,
      commandId: "plan-approve-01",
      expectedRunRevision: planning.value.snapshot["runRevision"],
      planId: "plan-01",
      planRevision: 1,
      decision: "approve",
      executionContextMode: "general_file",
      executionWritePolicy: "user_preapproved_run",
      executionWritePolicyAcknowledged: true
    });
    expect(decided).toMatchObject({
      ok: true,
      value: {
        conversationId: "conv-01",
        sourcePlanId: "plan-01",
        sourcePlanRevision: 1,
        planExecutionId: "plan_execution_plan-approve-01",
        planExecutionRevision: 1,
        permissionSummaryId: "permission-execution",
        permissionSummaryChecksum: "permission-execution".padEnd(64, "0").slice(0, 64),
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "user_preapproved_run"
      }
    });
    expect(planExecutionRecords).toHaveLength(1);
    expect(planExecutionRecords[0]).toMatchObject({
      planExecutionId: "plan_execution_plan-approve-01",
      runId: "run_plan_2",
      planId: "plan-01",
      planRevision: 1,
      revision: 1,
      steps: [{ stepId: "step-01", status: "pending", deviationKind: "none" }]
    });
    await session.readAgentRun("run_plan_2");
    expect(planExecutionReads.at(-1)).toEqual(["run_plan_2", "plan_execution_plan-approve-01", 1]);
    expect(notedRunIds).toEqual(["run_plan_1", "run_plan_2"]);
    expect(permissionBindings).toEqual([
      expect.objectContaining({
        runId: "run_plan_1",
        permissionSummaryId: "permission-planning"
      }),
      expect.objectContaining({
        runId: "run_plan_2",
        permissionSummaryId: "permission-execution",
        runDraftId: "draft_start-01",
        contextMode: "general_file",
        writePolicy: "user_preapproved_run"
      })
    ]);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(planningRunId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
  });

  test("pauses a material plan deviation, releases the provider, and resumes an approved revision idempotently", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let runs = 0;
    let executionSignal: AbortSignal | undefined;
    const snapshots = new Map<string, Record<string, unknown>>();
    const events = new Map<string, Record<string, unknown>[]>();
    const executionRecords = new Map<string, Record<string, unknown>>();
    const revisionRequests = new Map<string, Record<string, unknown>>();
    const receipts = new Map<string, Record<string, unknown>>();
    const repository = {
      async writeSnapshot(snapshot: Record<string, unknown>) {
        snapshots.set(String(snapshot["runId"]), structuredClone(snapshot));
        return { ok: true, value: snapshot };
      },
      async appendEvent(event: Record<string, unknown>) {
        const runId = String(event["runId"]);
        events.set(runId, [...(events.get(runId) ?? []), structuredClone(event)]);
        return { ok: true, value: event };
      },
      async writeCommandReceipt(
        runId: string,
        commandId: string,
        receipt: Record<string, unknown>
      ) {
        receipts.set(`${runId}:${commandId}`, structuredClone(receipt));
        return { ok: true, value: receipt };
      },
      async readCommandReceipt(runId: string, commandId: string) {
        return { ok: true, value: receipts.get(`${runId}:${commandId}`) };
      },
      async readSnapshot(runId: string) {
        return { ok: true, value: snapshots.get(runId) };
      },
      async readEvents(runId: string) {
        return { ok: true, value: events.get(runId) ?? [] };
      },
      async writePlanExecutionRecord(record: Record<string, unknown>) {
        executionRecords.set(
          `${String(record["planExecutionId"])}:${String(record["revision"])}`,
          structuredClone(record)
        );
        return { ok: true, value: record };
      },
      async readPlanExecutionRecord(runId: string, planExecutionId: string, revision?: number) {
        const matches = [...executionRecords.values()].filter(
          (record) => record["runId"] === runId && record["planExecutionId"] === planExecutionId
        );
        const selected =
          revision === undefined
            ? matches.sort((left, right) => Number(right["revision"]) - Number(left["revision"]))[0]
            : matches.find((record) => record["revision"] === revision);
        return { ok: true, value: selected };
      },
      async writePlanRevisionRequest(request: Record<string, unknown>) {
        revisionRequests.set(String(request["requestId"]), structuredClone(request));
        return { ok: true, value: request };
      },
      async readPlanRevisionRequest(_runId: string, requestId: string) {
        return { ok: true, value: revisionRequests.get(requestId) };
      },
      async writePlanArtifact(plan: Record<string, unknown>) {
        return { ok: true, value: plan };
      }
    };
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => `run_revision_${++runs}` },
      repository,
      modelDriver: {
        async *streamRound(input: {
          readonly snapshot: Record<string, unknown>;
          readonly signal: AbortSignal;
        }) {
          if (input.snapshot["operationMode"] === "planning") {
            yield toolCall("finish_plan_revision", "finish_plan", {
              planId: "plan-revision",
              goal: "Fix continuity",
              successCriteria: ["Continuity fixed"],
              nonGoals: ["Do not edit chapter 4"],
              facts: ["Chapter 3 is inconsistent"],
              assumptions: [],
              openQuestions: [],
              targetRefs: [{ refId: "chapter:chapter-03", intent: "Fix" }],
              steps: [{ stepId: "step-01", title: "Fix chapter 3", verification: "Re-read" }],
              risks: [],
              verification: ["Re-read chapter 3"],
              sourceRefs: ["chapter:chapter-03"]
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          executionSignal = input.signal;
          await new Promise<void>((resolve) => {
            if (input.signal.aborted) resolve();
            else input.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      recordPlanDeviation(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decidePlanRevision(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
      stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };

    const planningStarted = await session.startAgentRun({
      ...startCommand(),
      operationMode: "planning"
    });
    const planningRunId = String((planningStarted as { value: { runId: string } }).value.runId);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(planningRunId)).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    const planning = (await session.readAgentRun(planningRunId)) as {
      value: { snapshot: Record<string, unknown> };
    };
    const approvedPlan = await session.decidePlan({
      projectId: "project-01",
      runId: planningRunId,
      commandId: "plan-revision-approve",
      expectedRunRevision: planning.value.snapshot["runRevision"],
      planId: "plan-revision",
      planRevision: 1,
      decision: "approve"
    });
    const executionRunId = String((approvedPlan as { value: { runId: string } }).value.runId);
    await vi.waitFor(() => {
      expect(executionSignal).toBeDefined();
    });
    const execution = (await session.readAgentRun(executionRunId)) as {
      value: { snapshot: Record<string, unknown> };
    };
    const deviated = await session.recordPlanDeviation({
      projectId: "project-01",
      runId: executionRunId,
      commandId: "deviation-material",
      expectedRunRevision: execution.value.snapshot["runRevision"],
      requestId: "revision-request-01",
      planRevision: 2,
      stepId: "step-01",
      change: "new_target",
      summary: "Chapter 4 also needs a change.",
      discovery: "The contradiction continues in chapter 4.",
      proposal: "Add chapter 4 to plan revision 2."
    });
    expect(deviated).toMatchObject({
      ok: true,
      value: {
        status: "awaiting_plan_revision",
        planExecutionRevision: 2
      }
    });
    expect(executionSignal?.aborted).toBe(true);
    expect((events.get(executionRunId) ?? []).map((event) => event["type"])).toEqual(
      expect.arrayContaining(["plan_deviation_recorded", "plan_revision_requested"])
    );

    const paused = (deviated as { value: Record<string, unknown> }).value;
    const decided = await session.decidePlanRevision({
      projectId: "project-01",
      runId: executionRunId,
      commandId: "revision-decide-01",
      expectedRunRevision: paused["runRevision"],
      requestId: "revision-request-01",
      planId: "plan-revision",
      planRevision: 2,
      decision: "approve"
    });
    expect(decided).toMatchObject({
      ok: true,
      value: {
        status: "executing_model",
        sourcePlanRevision: 2,
        planExecutionRevision: 3
      }
    });
    expect(
      await session.decidePlanRevision({
        projectId: "project-01",
        runId: executionRunId,
        commandId: "revision-decide-01",
        expectedRunRevision: paused["runRevision"],
        requestId: "revision-request-01",
        planId: "plan-revision",
        planRevision: 2,
        decision: "approve"
      })
    ).toEqual(decided);

    const resumed = (decided as { value: Record<string, unknown> }).value;
    await session.stopAgentRun({
      projectId: "project-01",
      runId: executionRunId,
      commandId: "stop-revision-test",
      expectedRunRevision: resumed["runRevision"]
    });
  });

  test("retries one failed tool step and deduplicates the retry command", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let rounds = 0;
    let executions = 0;
    const never = new Promise<void>(() => undefined);
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_retry_step" },
      repository: durableMemoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("retry_read", "read_project_text", { path: "notes/retry.md" });
          } else if (rounds === 2) {
            await never;
            return;
          } else {
            yield toolCall(`retry_finish_${rounds}`, "finish", { summary: "重试完成" });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          executions += 1;
          return executions === 1
            ? {
                ok: false,
                error: {
                  errorId: "retry-error",
                  code: "AGENT_READ_FAILED",
                  category: "StorageError",
                  message: "read failed",
                  recoverability: "retryable",
                  suggestedAction: "retry",
                  traceId: "test",
                  timestamp: "2026-07-13T00:00:00.000Z"
                }
              }
            : { ok: true, value: { summary: "read succeeded", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      retryStep(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_retry_step")).toMatchObject({
        value: {
          events: expect.arrayContaining([expect.objectContaining({ type: "tool_failed" })])
        }
      });
    });
    const failed = (await session.readAgentRun("run_retry_step")) as {
      value: { snapshot: { runRevision: number } };
    };
    const command = {
      projectId: "project-01",
      runId: "run_retry_step",
      commandId: "retry-command-01",
      expectedRunRevision: failed.value.snapshot.runRevision
    };
    const [first, duplicate] = await Promise.all([
      session.retryStep(command),
      session.retryStep(command)
    ]);

    expect(first).toEqual(duplicate);
    expect(executions).toBe(2);
    const read = await session.readAgentRun("run_retry_step");
    expect(read).toMatchObject({
      value: {
        events: expect.arrayContaining([
          expect.objectContaining({ type: "tool_retry_requested" }),
          expect.objectContaining({ type: "tool_completed" })
        ])
      }
    });
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.filter(
        (event) => event.type === "tool_retry_requested"
      )
    ).toHaveLength(1);
  });

  test("records a normalized tool error and retries only its explicit current target", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const repository = durableMemoryRepository();
    let executions = 0;
    let rounds = 0;
    const never = new Promise<void>(() => undefined);
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_explicit_retry" },
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("tool_explicit", "read_project_text", { path: "notes/retry.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          executions += 1;
          return executions === 1
            ? {
                ok: false,
                error: {
                  schemaVersion: "1.0",
                  errorId: "err_explicit_retry",
                  code: "AGENT_READ_FAILED",
                  category: "StorageError",
                  message: "read failed",
                  recoverability: "retryable",
                  suggestedAction: "Retry this tool call.",
                  traceId: "test",
                  createdAt: "2026-07-17T12:00:00.000Z",
                  redactedDetail: { stack: "must not persist", path: "notes/retry.md" }
                }
              }
            : { ok: true, value: { summary: "read succeeded", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      retryRunTarget(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_explicit_retry")).toMatchObject({
        value: {
          snapshot: { activeErrorId: "err_explicit_retry", recoveryState: "retryable" },
          diagnostic: {
            errorId: "err_explicit_retry",
            toolCallId: "tool_explicit",
            retryTargets: [{ kind: "tool_call", id: "tool_explicit" }]
          }
        }
      });
    });
    const failed = (await session.readAgentRun("run_explicit_retry")) as {
      value: { snapshot: { runRevision: number }; events: Array<{ type: string }> };
    };
    expect(failed.value.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["tool_failed", "error_recorded"])
    );
    expect(failed.value.events.findIndex((event) => event.type === "tool_failed")).toBeLessThan(
      failed.value.events.findIndex((event) => event.type === "error_recorded")
    );
    const command = {
      projectId: "project-01",
      runId: "run_explicit_retry",
      commandId: "retry-explicit-01",
      expectedRunRevision: failed.value.snapshot.runRevision,
      errorId: "err_explicit_retry",
      target: { kind: "tool_call", id: "tool_explicit" }
    };
    const [first, duplicate] = await Promise.all([
      session.retryRunTarget(command),
      session.retryRunTarget(command)
    ]);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      ok: true,
      value: { activeErrorId: null, recoveryState: "none" }
    });
    expect(executions).toBe(2);
  });

  test("normalizes a thrown executor error during explicit tool retry", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    let executions = 0;
    let rounds = 0;
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_retry_executor_throw" },
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("tool_retry_throw", "read_project_text", { path: "notes/retry.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          executions += 1;
          if (executions === 1) {
            return {
              ok: false,
              error: {
                errorId: "err_retry_initial",
                code: "AGENT_READ_FAILED",
                category: "StorageError",
                message: "initial read failed",
                recoverability: "retryable",
                suggestedAction: "Retry.",
                traceId: "test",
                createdAt: "2026-07-17T12:00:00.000Z"
              }
            };
          }
          throw Object.assign(new Error("retry transport failed"), {
            errorId: "err_retry_executor_throw",
            code: "AGENT_READ_TRANSPORT_FAILED",
            category: "StorageError",
            recoverability: "retryable",
            suggestedAction: "Retry again."
          });
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      retryRunTarget(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_retry_executor_throw")).toMatchObject({
        value: { snapshot: { activeErrorId: "err_retry_initial" } }
      });
    });
    const failed = (await session.readAgentRun("run_retry_executor_throw")) as {
      value: { snapshot: { runRevision: number } };
    };
    await expect(
      session.retryRunTarget({
        projectId: "project-01",
        runId: "run_retry_executor_throw",
        commandId: "retry-executor-throw-01",
        expectedRunRevision: failed.value.snapshot.runRevision,
        errorId: "err_retry_initial",
        target: { kind: "tool_call", id: "tool_retry_throw" }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { activeErrorId: "err_retry_executor_throw", recoveryState: "retryable" }
    });
    expect(await session.readAgentRun("run_retry_executor_throw")).toMatchObject({
      ok: true,
      value: {
        snapshot: { activeErrorId: "err_retry_executor_throw", recoveryState: "retryable" },
        diagnostic: {
          errorId: "err_retry_executor_throw",
          code: "AGENT_READ_TRANSPORT_FAILED",
          retryTargets: [expect.objectContaining({ kind: "tool_call" })]
        }
      }
    });
  });

  test("rejects stale, mismatched, and ambiguous retry targets without side effects", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const repository = durableMemoryRepository();
    let executions = 0;
    let rounds = 0;
    const never = new Promise<void>(() => undefined);
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_retry_rejections" },
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("tool_reject", "read_project_text", { path: "notes/reject.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          executions += 1;
          return {
            ok: false,
            error: {
              schemaVersion: "1.0",
              errorId: "err_retry_rejections",
              code: "AGENT_READ_FAILED",
              category: "StorageError",
              message: "read failed",
              recoverability: "retryable",
              suggestedAction: "Retry this tool call.",
              traceId: "test",
              createdAt: "2026-07-17T12:00:00.000Z"
            }
          };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      retryRunTarget(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      retryStep(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_retry_rejections")).toMatchObject({
        value: { snapshot: { activeErrorId: "err_retry_rejections" } }
      });
    });
    const read = (await session.readAgentRun("run_retry_rejections")) as {
      value: { snapshot: { runRevision: number } };
    };
    const base = {
      projectId: "project-01",
      runId: "run_retry_rejections",
      expectedRunRevision: read.value.snapshot.runRevision,
      errorId: "err_retry_rejections",
      target: { kind: "tool_call", id: "tool_reject" }
    };
    expect(
      await session.retryRunTarget({ ...base, commandId: "retry-stale", expectedRunRevision: 0 })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_REVISION_CONFLICT" } });
    expect(
      await session.retryRunTarget({
        ...base,
        commandId: "retry-error-mismatch",
        errorId: "err_old"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RETRY_ERROR_STALE" } });
    expect(
      await session.retryRunTarget({
        ...base,
        commandId: "retry-target-mismatch",
        target: { kind: "checkpoint", id: "checkpoint_old" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RETRY_TARGET_STALE" } });
    await repository.writeRunError("run_retry_rejections", {
      ...(await repository.readRunError("run_retry_rejections", "err_retry_rejections")).value,
      retryTargets: [
        { kind: "tool_call", id: "tool_reject" },
        { kind: "checkpoint", id: "checkpoint_other" }
      ]
    });
    expect(
      await session.retryStep({
        projectId: "project-01",
        runId: "run_retry_rejections",
        commandId: "legacy-ambiguous",
        expectedRunRevision: read.value.snapshot.runRevision
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RETRY_TARGET_AMBIGUOUS" } });
    expect(executions).toBe(1);
  });

  test("restores the failed tool checkpoint so retry remains available after reload", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    let firstRounds = 0;
    const firstSession = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_retry_reload" },
      repository,
      modelDriver: {
        async *streamRound() {
          firstRounds += 1;
          if (firstRounds === 1) {
            yield toolCall("reload_read", "read_project_text", { path: "notes/reload.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return {
            ok: false,
            error: {
              errorId: "reload-error",
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
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    await firstSession.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await firstSession.readAgentRun("run_retry_reload")).toMatchObject({
        value: {
          events: expect.arrayContaining([expect.objectContaining({ type: "tool_failed" })])
        }
      });
    });

    let executions = 0;
    const reloadedSession = (createSession as (options: Record<string, unknown>) => unknown)({
      repository,
      modelDriver: {
        async *streamRound() {
          yield toolCall("reload_finish", "finish", { summary: "完成" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          executions += 1;
          return { ok: true, value: { summary: "read succeeded", data: {} } };
        }
      }
    }) as {
      retryStep(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const reloaded = (await reloadedSession.readAgentRun("run_retry_reload")) as {
      value: {
        snapshot: { runRevision: number; activeErrorId: string; recoveryState: string };
        diagnostic: { errorId: string; recoveryState: string };
      };
    };
    expect(reloaded.value).toMatchObject({
      snapshot: { activeErrorId: "reload-error", recoveryState: "retryable" },
      diagnostic: { errorId: "reload-error", recoveryState: "retryable" }
    });
    const retried = await reloadedSession.retryStep({
      projectId: "project-01",
      runId: "run_retry_reload",
      commandId: "retry-after-reload",
      expectedRunRevision: reloaded.value.snapshot.runRevision
    });

    expect(retried).toMatchObject({ ok: true });
    expect(executions).toBe(1);
  });

  test("persists an apply-time base conflict and waits for context refresh", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runId = "run_base_conflict";
    const changeSet = diagnosticChangeSet(runId);
    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    let rounds = 0;
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("proposal_base_conflict", "propose_file_write", {
              path: "notes/partial.md",
              baseHash: "a".repeat(64),
              range: { unit: "character", start: 0, end: 6 },
              replacement: "after"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("A proposal must not use the read executor.");
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: changeSet };
        },
        async proposeChapterWrite() {
          throw new Error("unused");
        },
        async selectRevision() {
          throw new Error("unused");
        },
        async readChangeSet() {
          return { ok: true, value: changeSet };
        },
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "apply_selected",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-17T12:00:00.000Z",
              binding: {
                changeSetId: "changes_partial",
                revision: 1,
                checksum: "checksum_partial_1",
                approvalToken: "approval_partial_1"
              }
            }
          };
        }
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: false,
            error: {
              schemaVersion: "1.0",
              errorId: "err_base_conflict",
              code: "AGENT_WRITE_BASE_CONFLICT",
              category: "ValidationError",
              message: "Agent write base content has changed.",
              recoverability: "user-action",
              suggestedAction: "Review the latest file content before retrying.",
              traceId: "test",
              createdAt: "2026-07-17T12:00:00.000Z",
              redactedDetail: {
                relativePath: "notes/partial.md",
                stack: "must not be persisted"
              }
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
    });
    const pending = (await session.readAgentRun(runId)) as {
      value: { snapshot: { runRevision: number } };
    };
    expect(
      await session.decideChangeSet({
        projectId: "project-01",
        runId,
        commandId: "apply-base-conflict-01",
        expectedRunRevision: pending.value.snapshot.runRevision,
        changeSetId: "changes_partial",
        revision: 1,
        checksum: "checksum_partial_1",
        decision: "apply_selected"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_BASE_CONFLICT" },
      latestSnapshot: {
        status: "awaiting_context_refresh",
        activeErrorId: "err_base_conflict",
        recoveryState: "awaiting_context_refresh"
      }
    });

    const read = (await session.readAgentRun(runId)) as {
      value: {
        events: Array<{ type: string }>;
        diagnostic: Record<string, unknown>;
      };
    };
    expect(read.value.diagnostic).toMatchObject({
      errorId: "err_base_conflict",
      code: "AGENT_WRITE_BASE_CONFLICT",
      recoveryState: "awaiting_context_refresh",
      redactedDetail: { relativePath: "notes/partial.md" }
    });
    expect(JSON.stringify(read.value.diagnostic)).not.toContain("must not be persisted");
    expect(
      read.value.events
        .map((event) => event.type)
        .filter(
          (type) => type === "write_failed" || type === "error_recorded" || type === "run_failed"
        )
    ).toEqual(["write_failed", "error_recorded"]);
  });

  test("records a recovery-journal reference for partial writes without announcing write_applied", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runId = "run_partial_failure";
    const changeSet = diagnosticChangeSet(runId);
    const repository = durableMemoryRepository();
    let rounds = 0;
    const never = new Promise<void>(() => undefined);
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("proposal_partial", "propose_file_write", {
              path: "notes/partial.md",
              baseHash: "a".repeat(64),
              range: { unit: "character", start: 0, end: 6 },
              replacement: "after"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("A proposal must not use the read executor.");
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: changeSet };
        },
        async proposeChapterWrite() {
          throw new Error("unused");
        },
        async selectRevision() {
          throw new Error("unused");
        },
        async readChangeSet() {
          return { ok: true, value: changeSet };
        },
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "apply_selected",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-17T12:00:00.000Z",
              binding: {
                changeSetId: "changes_partial",
                revision: 1,
                checksum: "checksum_partial_1",
                approvalToken: "approval_partial_1"
              }
            }
          };
        }
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "version_group_partial_01",
              runId,
              transactionStatus: "partial_failure",
              writes: []
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
    });
    const pending = (await session.readAgentRun(runId)) as {
      value: { snapshot: { runRevision: number } };
    };
    expect(
      await session.decideChangeSet({
        projectId: "project-01",
        runId,
        commandId: "apply-partial-01",
        expectedRunRevision: pending.value.snapshot.runRevision,
        changeSetId: "changes_partial",
        revision: 1,
        checksum: "checksum_partial_1",
        decision: "apply_selected"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_PARTIAL_FAILURE" },
      latestSnapshot: { status: "failed", recoveryState: "recovery_review" }
    });

    const read = (await session.readAgentRun(runId)) as {
      value: {
        events: Array<{ type: string }>;
        diagnostic: Record<string, unknown>;
      };
    };
    expect(read.value.diagnostic).toMatchObject({
      code: "AGENT_WRITE_PARTIAL_FAILURE",
      recoveryState: "recovery_review",
      redactedDetail: {
        recoveryJournal: { versionGroupId: "version_group_partial_01" }
      }
    });
    const eventTypes = read.value.events.map((event) => event.type);
    expect(
      eventTypes.filter(
        (type) => type === "write_failed" || type === "error_recorded" || type === "run_failed"
      )
    ).toEqual(["write_failed", "error_recorded", "run_failed"]);
    expect(eventTypes).not.toContain("write_applied");
  });

  test("records and reloads the same diagnostic when startup recovery finds a partial write", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runId = "run_startup_partial_failure";
    const changeSet = diagnosticChangeSet(runId);
    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    let rounds = 0;
    const sessionOptions = {
      repository,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("proposal_startup_partial", "propose_file_write", {
              path: "notes/partial.md",
              baseHash: "a".repeat(64),
              range: { unit: "character", start: 0, end: 6 },
              replacement: "after"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("A proposal must not use the read executor.");
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: changeSet };
        },
        async proposeChapterWrite() {
          throw new Error("unused");
        },
        async selectRevision() {
          throw new Error("unused");
        },
        async readChangeSet() {
          return { ok: true, value: changeSet };
        },
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "apply_selected",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-17T12:00:00.000Z",
              binding: {
                changeSetId: "changes_partial",
                revision: 1,
                checksum: "checksum_partial_1",
                approvalToken: "approval_partial_1"
              }
            }
          };
        }
      }
    };
    const interrupted = (createSession as (options: Record<string, unknown>) => unknown)({
      ...sessionOptions,
      coordinatorOptions: { createRunId: () => runId },
      versionGroupExecutor: {
        async apply() {
          return new Promise(() => undefined);
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await interrupted.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await interrupted.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
    });
    const pending = (await interrupted.readAgentRun(runId)) as {
      value: { snapshot: { runRevision: number } };
    };
    void interrupted.decideChangeSet({
      projectId: "project-01",
      runId,
      commandId: "apply-startup-partial-01",
      expectedRunRevision: pending.value.snapshot.runRevision,
      changeSetId: "changes_partial",
      revision: 1,
      checksum: "checksum_partial_1",
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await interrupted.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "applying_changes" } }
      });
    });

    const recovered = (createSession as (options: Record<string, unknown>) => unknown)({
      ...sessionOptions,
      versionGroupExecutor: {
        async apply() {
          throw new Error("unused");
        },
        async undoRun() {
          throw new Error("unused");
        },
        async recoverRun() {
          return {
            ok: true,
            value: {
              status: "partial_failure",
              versionGroup: {
                versionGroupId: "version_group_startup_partial_01",
                transactionStatus: "partial_failure"
              }
            }
          };
        }
      }
    }) as {
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const recoveredRead = (await recovered.readAgentRun(runId)) as {
      value: {
        snapshot: { activeErrorId: string; recoveryState: string; status: string };
        diagnostic: Record<string, unknown>;
        events: Array<{ type: string }>;
      };
    };
    expect(recoveredRead.value.snapshot).toMatchObject({
      status: "failed",
      recoveryState: "recovery_review"
    });
    expect(recoveredRead.value.diagnostic).toMatchObject({
      errorId: recoveredRead.value.snapshot.activeErrorId,
      code: "AGENT_WRITE_PARTIAL_FAILURE",
      recoveryState: "recovery_review",
      redactedDetail: {
        recoveryJournal: { versionGroupId: "version_group_startup_partial_01" }
      }
    });
    expect(
      recoveredRead.value.events
        .map((event) => event.type)
        .filter(
          (type) => type === "write_failed" || type === "error_recorded" || type === "run_failed"
        )
    ).toEqual(["write_failed", "error_recorded", "run_failed"]);

    const reloaded = (createSession as (options: Record<string, unknown>) => unknown)(
      sessionOptions
    ) as {
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    expect(await reloaded.readAgentRun(runId)).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          activeErrorId: recoveredRead.value.snapshot.activeErrorId,
          recoveryState: "recovery_review"
        },
        diagnostic: {
          errorId: recoveredRead.value.snapshot.activeErrorId,
          recoveryState: "recovery_review"
        }
      }
    });
  });

  test("finishes startup partial recovery when diagnostic persistence fails", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runId = "run_startup_diagnostic_failure";
    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    const seed = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      modelDriver: {
        async *streamRound() {
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as { startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>> };
    const started = (await seed.startAgentRun(startCommand())) as {
      value: Record<string, unknown>;
    };
    const applying = {
      ...started.value,
      status: "applying_changes",
      runRevision: Number(started.value["runRevision"]) + 1,
      lastSequence: Number(started.value["lastSequence"]) + 1
    };
    await repository.appendEvent({
      schemaVersion: "1.1",
      runId,
      projectId: "project-01",
      sequence: applying.lastSequence,
      runRevision: applying.runRevision,
      type: "write_started",
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    await repository.writeSnapshot(applying);

    const recovered = (createSession as (options: Record<string, unknown>) => unknown)({
      repository: {
        ...repository,
        async writeRunError() {
          return {
            ok: false,
            error: {
              code: "AGENT_DIAGNOSTIC_WRITE_FAILED",
              category: "StorageError",
              message: "diagnostic write failed",
              recoverability: "retryable",
              suggestedAction: "Retry.",
              traceId: "test",
              errorId: "err_diagnostic_write",
              createdAt: "2026-07-17T12:00:00.000Z"
            }
          };
        }
      },
      modelDriver: {
        async *streamRound() {
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      },
      versionGroupExecutor: {
        async apply() {
          throw new Error("unused");
        },
        async undoRun() {
          throw new Error("unused");
        },
        async recoverRun() {
          return {
            ok: true,
            value: {
              status: "partial_failure",
              versionGroup: {
                versionGroupId: "version_group_diagnostic_failure",
                transactionStatus: "partial_failure"
              }
            }
          };
        }
      }
    }) as { readAgentRun(runId: string): Promise<Record<string, unknown>> };

    expect(await recovered.readAgentRun(runId)).toMatchObject({
      ok: true,
      value: {
        snapshot: { status: "failed", activeErrorId: null, recoveryState: "terminal" },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "write_failed" }),
          expect.objectContaining({
            type: "run_failed",
            detail: expect.objectContaining({ diagnosticPersistenceFailed: true })
          })
        ])
      }
    });
  });

  test("single-flights concurrent startup recovery reads", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runId = "run_concurrent_startup_recovery";
    const repository = durableMemoryRepository();
    const never = new Promise<void>(() => undefined);
    const seed = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      modelDriver: {
        async *streamRound() {
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as { startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>> };
    const started = (await seed.startAgentRun(startCommand())) as {
      value: Record<string, unknown>;
    };
    const applying = {
      ...started.value,
      status: "applying_changes",
      runRevision: Number(started.value["runRevision"]) + 1,
      lastSequence: Number(started.value["lastSequence"]) + 1
    };
    await repository.appendEvent({
      schemaVersion: "1.1",
      runId,
      projectId: "project-01",
      sequence: applying.lastSequence,
      runRevision: applying.runRevision,
      type: "write_started",
      createdAt: "2026-07-17T12:00:00.000Z"
    });
    await repository.writeSnapshot(applying);

    let recoverCalls = 0;
    let releaseRecovery: () => void = () => undefined;
    const recoveryGate = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const recovered = (createSession as (options: Record<string, unknown>) => unknown)({
      repository,
      modelDriver: {
        async *streamRound() {
          await never;
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      },
      versionGroupExecutor: {
        async apply() {
          throw new Error("unused");
        },
        async undoRun() {
          throw new Error("unused");
        },
        async recoverRun() {
          recoverCalls += 1;
          await recoveryGate;
          return {
            ok: true,
            value: {
              status: "partial_failure",
              versionGroup: {
                versionGroupId: "version_group_concurrent_recovery",
                transactionStatus: "partial_failure"
              }
            }
          };
        }
      }
    }) as { readAgentRun(runId: string): Promise<Record<string, unknown>> };

    const firstRead = recovered.readAgentRun(runId);
    const secondRead = recovered.readAgentRun(runId);
    await vi.waitFor(() => expect(recoverCalls).toBeGreaterThan(0));
    releaseRecovery();
    const [first, second] = await Promise.all([firstRead, secondRead]);
    expect(recoverCalls).toBe(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: { snapshot: { status: "failed", recoveryState: "recovery_review" } }
    });
    const eventTypes = (first as { value: { events: Array<{ type: string }> } }).value.events
      .map((event) => event.type)
      .filter(
        (type) => type === "write_failed" || type === "error_recorded" || type === "run_failed"
      );
    expect(eventTypes).toEqual(["write_failed", "error_recorded", "run_failed"]);
  });

  test("refreshes stale context through an explicit command", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const sourceContent = "before";
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_context_command" },
      repository: durableMemoryRepository(),
      contextSourceReader: {
        async readCurrentSources() {
          return { ok: true, value: [{ refId: "file:notes.txt", content: "after" }] };
        }
      },
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          if (input.messages.some((message) => message["role"] === "tool")) {
            yield toolCall("context_finish", "finish", { summary: "刷新后完成" });
          } else {
            yield toolCall("context_read", "read_project_text", { path: "notes.txt" });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          const content = sourceContent;
          return {
            ok: true,
            value: {
              summary: "已读取 notes.txt",
              data: { content },
              source: {
                refId: "file:notes.txt",
                sourceKind: "disk_file",
                relativePath: "notes.txt",
                content,
                dirty: false
              }
            }
          };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const started = await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    const runId = String((started as { value: { runId: string } }).value.runId);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_context_refresh" } }
      });
    });
    const stale = (await session.readAgentRun(runId)) as {
      value: { snapshot: Record<string, unknown> };
    };
    const refreshed = await session.refreshContext({
      projectId: "project-01",
      runId,
      commandId: "context-refresh-01",
      expectedRunRevision: stale.value.snapshot["runRevision"],
      decision: "refresh"
    });
    expect(refreshed).toMatchObject({
      ok: true,
      value: { runId, activeErrorId: null, recoveryState: "none" }
    });
    expect(await session.readAgentRun(runId)).toMatchObject({
      ok: true,
      value: { snapshot: { activeErrorId: null, recoveryState: "none" } }
    });
  });

  test("excludes persisted stale refs when the renderer submits a mismatched target", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let rounds = 0;
    let sawExclusion = false;
    const persistedContexts: Record<string, unknown>[] = [];
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_context_exclude" },
      repository: {
        ...memoryRepository(),
        async writeContextSnapshot(snapshot: Record<string, unknown>) {
          persistedContexts.push(snapshot);
          return { ok: true, value: snapshot };
        }
      },
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("exclude_read", "read_project_text", { path: "notes/outline.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          sawExclusion = input.messages.some(
            (message) =>
              message["role"] === "system" &&
              typeof message["content"] === "string" &&
              message["content"].includes('"kind":"context_excluded"')
          );
          yield toolCall("exclude_finish", "finish_plan", {
            planId: "plan-exclude",
            goal: "排除过期上下文后完成只读规划。",
            successCriteria: ["模型收到排除决定"],
            nonGoals: ["不写入文件"],
            facts: ["notes/outline.md 已被排除"],
            assumptions: [],
            openQuestions: [],
            targetRefs: [],
            steps: [
              {
                stepId: "step-exclude",
                title: "完成只读规划",
                verification: "确认排除决定已记录"
              }
            ],
            risks: [],
            verification: ["检查 Context Snapshot"],
            sourceRefs: []
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
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
        async readCurrentSources(input: { readonly sources: readonly Record<string, unknown>[] }) {
          return {
            ok: true,
            value:
              input.sources.length === 0
                ? []
                : [{ refId: "file:notes/outline.md", content: "changed" }]
          };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_exclude")).toMatchObject({
        value: { snapshot: { status: "awaiting_context_refresh" } }
      });
    });
    const stale = (await session.readAgentRun("run_context_exclude")) as {
      value: { snapshot: { runRevision: number } };
    };
    const command = {
      projectId: "project-01",
      runId: "run_context_exclude",
      commandId: "context-exclude-01",
      expectedRunRevision: stale.value.snapshot.runRevision,
      decision: "exclude" as const,
      sourceRefs: ["chapter:unrelated"]
    };
    const first = await session.refreshContext(command);
    const duplicate = await session.refreshContext(command);

    expect(duplicate).toEqual(first);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_exclude")).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    expect(sawExclusion).toBe(true);
    expect(
      persistedContexts.some((snapshot) =>
        (JSON.stringify(snapshot["excludedSources"]) ?? "").includes("file:notes/outline.md")
      )
    ).toBe(true);
  });

  test("cancels from stale context and does not resume after a duplicate command", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let rounds = 0;
    const publishedTypes: string[] = [];
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_context_cancel" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("cancel_read", "read_project_text", { path: "notes/outline.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("cancel_finish", "finish", { summary: "不应恢复" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
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
          return { ok: true, value: [{ refId: "file:notes/outline.md", content: "changed" }] };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
      subscribe(listener: (event: Record<string, unknown>) => void): () => void;
    };
    session.subscribe((event) => publishedTypes.push(String(event["type"])));

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_cancel")).toMatchObject({
        value: { snapshot: { status: "awaiting_context_refresh" } }
      });
    });
    const stale = (await session.readAgentRun("run_context_cancel")) as {
      value: { snapshot: { runRevision: number } };
    };
    const command = {
      projectId: "project-01",
      runId: "run_context_cancel",
      commandId: "context-cancel-01",
      expectedRunRevision: stale.value.snapshot.runRevision,
      decision: "cancel" as const,
      sourceRefs: ["file:notes/outline.md"]
    };
    const first = await session.refreshContext(command);
    const duplicate = await session.refreshContext(command);

    expect(duplicate).toEqual(first);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_cancel")).toMatchObject({
        value: { snapshot: { status: "cancelled" } }
      });
    });
    expect(rounds).toBe(1);
    expect(publishedTypes.filter((type) => type === "run_cancelled")).toHaveLength(1);
    expect(publishedTypes).not.toContain("context_refresh_cancelled");
  });

  test("refreshes an existing dirty editor source from renderer content without expanding refs", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    let currentBody = "dirty before";
    let rounds = 0;
    const observedSources: Record<string, unknown>[][] = [];
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_dirty_refresh" },
      repository: memoryRepository(),
      contextSourceReader: {
        async readCurrentSources(input: { readonly sources: Record<string, unknown>[] }) {
          observedSources.push(input.sources);
          return {
            ok: true,
            value: input.sources.map((source) => ({
              refId: String(source["refId"]),
              content: currentBody
            }))
          };
        }
      },
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("dirty_read", "read_project_text", { path: "notes/context.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("dirty_finish", "finish", { summary: "完成" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          currentBody = "dirty after";
          return { ok: true, value: { summary: "read", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun({
      ...startCommand(),
      operationMode: "planning",
      initialContextSources: [
        {
          refId: "chapter:chapter-01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/chapter-01.md",
          content: "dirty before",
          dirty: true
        }
      ]
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_dirty_refresh")).toMatchObject({
        value: { snapshot: { status: "awaiting_context_refresh" } }
      });
    });
    const stale = (await session.readAgentRun("run_dirty_refresh")) as {
      value: { snapshot: { runRevision: number } };
    };
    const refreshed = await session.refreshContext({
      projectId: "project-01",
      runId: "run_dirty_refresh",
      commandId: "dirty-refresh-01",
      expectedRunRevision: stale.value.snapshot.runRevision,
      decision: "refresh",
      sourceRefs: ["chapter:chapter-01", "file:outside-scope.md"],
      currentSources: [
        {
          refId: "chapter:chapter-01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/chapter-01.md",
          content: "dirty after",
          dirty: true
        },
        {
          refId: "file:outside-scope.md",
          sourceKind: "disk_file",
          relativePath: "outside-scope.md",
          content: "must not be added",
          dirty: false
        }
      ]
    });

    expect(refreshed).toMatchObject({ ok: true });
    expect(observedSources.at(-1)).toEqual([
      expect.objectContaining({
        refId: "chapter:chapter-01",
        sourceKind: "editor_buffer",
        content: "dirty after",
        dirty: true
      })
    ]);
  });

  test("validates a conversation before persisting a new run", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    let snapshotWrites = 0;
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      repository: {
        ...memoryRepository(),
        async writeSnapshot(snapshot: Record<string, unknown>) {
          snapshotWrites += 1;
          return { ok: true, value: snapshot };
        }
      },
      conversationLifecycle: {
        async assertRunMayStart() {
          return { ok: false, error: { code: "AGENT_CONVERSATION_ARCHIVED" } };
        },
        async loadContext() {
          throw new Error("Context must not load after validation fails.");
        },
        async noteRunStarted() {
          throw new Error("A rejected run must not be noted.");
        },
        async noteRunTerminal() {
          throw new Error("A rejected run cannot terminate.");
        }
      },
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };

    expect(await session.startAgentRun(startCommand())).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_ARCHIVED" }
    });
    expect(snapshotWrites).toBe(0);
  });

  test("releases the conversation start reservation when context loading fails", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    let cancellations = 0;
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      repository: memoryRepository(),
      conversationLifecycle: {
        async assertRunMayStart() {
          return { ok: true, value: {} };
        },
        async cancelRunStart() {
          cancellations += 1;
          return { ok: true, value: undefined };
        },
        async loadContext() {
          return { ok: false, error: { code: "AGENT_CONVERSATION_SUMMARY_UNAVAILABLE" } };
        },
        async noteRunStarted() {
          throw new Error("A failed start must not be noted.");
        },
        async noteRunTerminal() {
          throw new Error("A failed start cannot terminate.");
        }
      },
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };

    expect(await session.startAgentRun(startCommand())).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_SUMMARY_UNAVAILABLE" }
    });
    expect(cancellations).toBe(1);
  });

  test("injects conversation data before the request and preserves a run when metadata repair fails", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const order: string[] = [];
    let observedMessages: readonly Record<string, unknown>[] = [];
    const repository = durableMemoryRepository();
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_conversation_context" },
      repository: {
        ...repository,
        async writeSnapshot(snapshot: Record<string, unknown>) {
          order.push("persist-run");
          return repository.writeSnapshot(snapshot);
        }
      },
      conversationLifecycle: {
        async assertRunMayStart() {
          order.push("validate-conversation");
          return { ok: true, value: {} };
        },
        async loadContext() {
          order.push("load-context");
          return {
            ok: true,
            value: [
              { role: "user", content: "Earlier request" },
              { role: "assistant", content: "Earlier answer" }
            ]
          };
        },
        async noteRunStarted() {
          order.push("note-started");
          return { ok: false, error: { code: "AGENT_CONVERSATION_METADATA_REPAIR_REQUIRED" } };
        },
        async noteRunTerminal() {
          order.push("note-terminal");
          return { ok: true, value: undefined };
        }
      },
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          observedMessages = input.messages;
          yield { type: "assistant_text_delta", delta: "Current answer" };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: { runId: "run_conversation_context", conversationId: "conv-01" }
    });
    expect(order.indexOf("validate-conversation")).toBeLessThan(order.indexOf("persist-run"));
    expect(order.indexOf("persist-run")).toBeLessThan(order.indexOf("note-started"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_conversation_context")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(observedMessages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Untrusted conversation context")
    });
    expect(String(observedMessages[0]?.["content"])).toContain("Earlier request");
    expect(observedMessages.at(-1)).toMatchObject({
      role: "user",
      content: "核对第 3 章的人物动机。"
    });
    expect(order).toContain("note-terminal");
  });

  test("normalizes legacy conversation ownership in public run lists", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const legacySnapshot = {
      schemaVersion: "1.0",
      runId: "run_legacy_list",
      projectId: "project-01",
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Legacy request",
      status: "completed",
      runRevision: 2,
      lastSequence: 2,
      startedAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:01.000Z",
      limits: { maxModelRounds: 20, maxToolCalls: 50, maxConsecutiveToolFailures: 3 },
      providerCapabilitySnapshot: startCommand()["providerCapabilitySnapshot"],
      pendingUserInputId: null,
      contextSnapshotId: null,
      sourcePlanId: null,
      sourcePlanRevision: null
    };
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      repository: {
        ...memoryRepository(),
        async listSnapshots() {
          return { ok: true, value: [legacySnapshot] };
        }
      },
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as {
      listAgentRuns(projectId: string): Promise<Record<string, unknown>>;
    };

    expect(await session.listAgentRuns("project-01")).toMatchObject({
      ok: true,
      value: [{ runId: "run_legacy_list", conversationId: null }]
    });
  });
});

describe("AgentRunSession server-authoritative start", () => {
  function createStartSession(
    startPreflight: unknown,
    createRunId = "run_authority",
    repository = durableMemoryRepository()
  ): {
    startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    readAgentRun(runId: string): Promise<Record<string, unknown>>;
  } {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => unknown;
    return createSession({
      coordinatorOptions: { createRunId: () => createRunId },
      repository,
      startPreflight,
      modelDriver: {
        async *streamRound() {
          yield { type: "assistant_text_delta", delta: "ok" };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      }
    }) as ReturnType<typeof createStartSession>;
  }

  // The public start command carries only a draft reference; the resolved facts (mode, model,
  // capabilities, reasoning, sources) are what the server preflight produces.
  const draftOnlyCommand: Record<string, unknown> = {
    projectId: "project-01",
    conversationId: "conv-authority",
    commandId: "start-authority",
    expectedRunRevision: 0,
    runDraftId: "draft_authority",
    runDraftRevision: 3,
    runDraftChecksum: "checksum_authority"
  };

  function facts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      userRequest: "续写第 4 章",
      model: {
        profileId: "profile-authority",
        provider: "openai",
        modelName: "gpt-5",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: {
          status: "available",
          providerParamName: "reasoning_effort",
          allowedValues: ["minimal", "low", "medium", "high"],
          defaultValue: "medium"
        }
      },
      initialContextSources: [],
      ...overrides
    };
  }

  test("rejects a stale run draft surfaced by the preflight and never starts a run", async () => {
    let coordinatorReached = false;
    const session = createStartSession({
      async resolveStart() {
        return {
          ok: false,
          error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT", message: "stale" }
        };
      }
    });
    const started = await session.startAgentRun({
      ...draftOnlyCommand,
      // A resolveStart error must short-circuit before the coordinator; prove no run is persisted.
      __coordinatorReached: () => (coordinatorReached = true)
    });
    expect(started).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT" }
    });
    expect(coordinatorReached).toBe(false);
    expect(await session.readAgentRun("run_authority")).toMatchObject({ ok: false });
  });

  test("persists a normalized preflight diagnostic under the run draft", async () => {
    const repository = durableMemoryRepository();
    const session = createStartSession(
      {
        async resolveStart() {
          return {
            ok: false,
            error: {
              schemaVersion: "1.0",
              errorId: "err_start_preflight",
              code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
              category: "ValidationError",
              message: "The selected model cannot run the Agent workflow.",
              recoverability: "user-action",
              suggestedAction: "Choose a compatible model.",
              traceId: "test",
              createdAt: "2026-07-17T12:00:00.000Z",
              redactedDetail: { stack: "must not persist", missingCapabilities: ["toolCalling"] }
            }
          };
        }
      },
      "run_preflight_diagnostic",
      repository
    );

    expect(await session.startAgentRun(draftOnlyCommand)).toMatchObject({
      ok: false,
      error: { errorId: "err_start_preflight", code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED" }
    });
    const persisted = await repository.readPreflightError("err_start_preflight");
    expect(persisted).toMatchObject({
      ok: true,
      value: {
        errorId: "err_start_preflight",
        runDraftId: "draft_authority",
        recoveryState: "terminal"
      }
    });
    expect(JSON.stringify(persisted)).not.toContain("must not persist");
  });

  test("rejects an unknown profile whose capabilities cannot support a run", async () => {
    const session = createStartSession({
      async resolveStart() {
        return {
          ok: true,
          value: facts({
            model: {
              profileId: "profile-unknown",
              provider: "openai",
              modelName: "text-only",
              capabilities: {
                streaming: true,
                toolCalling: false,
                structuredArguments: false,
                contextWindow: 128000
              },
              requiredContextTokens: 8000,
              reasoningStrength: { status: "hidden", reason: "not a reasoning model" }
            }
          })
        };
      }
    });
    expect(await session.startAgentRun(draftOnlyCommand)).toMatchObject({
      ok: false,
      error: { code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED" }
    });
  });

  test("rejects a context window below the required floor", async () => {
    const session = createStartSession({
      async resolveStart() {
        return {
          ok: true,
          value: facts({
            model: {
              profileId: "profile-small",
              provider: "openai",
              modelName: "gpt-5",
              capabilities: {
                streaming: true,
                toolCalling: true,
                structuredArguments: true,
                contextWindow: 4000
              },
              requiredContextTokens: 8000,
              reasoningStrength: { status: "hidden", reason: "n/a" }
            }
          })
        };
      }
    });
    expect(await session.startAgentRun(draftOnlyCommand)).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_MODEL_CAPABILITY_UNSUPPORTED",
        redactedDetail: { missingCapabilities: ["contextWindow"] }
      }
    });
  });

  test("rejects a requested reasoning effort the model hides", async () => {
    const session = createStartSession({
      async resolveStart() {
        return {
          ok: true,
          value: facts({
            requestedReasoningEffort: "high",
            model: {
              profileId: "profile-hidden",
              provider: "openai-compatible",
              modelName: "custom-model",
              capabilities: {
                streaming: true,
                toolCalling: true,
                structuredArguments: true,
                contextWindow: 128000
              },
              requiredContextTokens: 8000,
              reasoningStrength: { status: "hidden", reason: "custom endpoint" }
            }
          })
        };
      }
    });
    expect(await session.startAgentRun(draftOnlyCommand)).toMatchObject({
      ok: false,
      error: { code: "AGENT_REASONING_EFFORT_UNSUPPORTED" }
    });
  });

  test("rejects a reasoning effort outside the model's allowed values", async () => {
    const session = createStartSession({
      async resolveStart() {
        return { ok: true, value: facts({ requestedReasoningEffort: "xhigh" }) };
      }
    });
    expect(await session.startAgentRun(draftOnlyCommand)).toMatchObject({
      ok: false,
      error: { code: "AGENT_REASONING_EFFORT_UNSUPPORTED" }
    });
  });

  test("binds the validated model profile and reasoning into the started run snapshot", async () => {
    const session = createStartSession({
      async resolveStart() {
        return { ok: true, value: facts({ requestedReasoningEffort: "high" }) };
      }
    });
    const started = await session.startAgentRun(draftOnlyCommand);
    expect(started).toMatchObject({
      ok: true,
      value: {
        modelProfileId: "profile-authority",
        reasoningEffort: "high",
        providerCapabilitySnapshot: { profileId: "profile-authority", modelName: "gpt-5" }
      }
    });
  });

  test("uses the model's default reasoning effort when the draft requests none", async () => {
    const session = createStartSession({
      async resolveStart() {
        return { ok: true, value: facts() };
      }
    });
    const started = await session.startAgentRun(draftOnlyCommand);
    expect(started).toMatchObject({ ok: true, value: { reasoningEffort: "medium" } });
  });
});

describe("AgentRunSession context-engineering profiles", () => {
  test("a writing run gets narrative guidance plus the writing style pack, recorded as an audit source", async () => {
    const captured = await runGuidanceProbe({
      contextMode: "writing",
      initialContextSources: [
        {
          refId: "chapter:chapter-03",
          sourceKind: "editor_buffer",
          relativePath: "chapters/chapter-03.md",
          content: "当前章节正文",
          dirty: false
        }
      ]
    });

    // Writing guidance emphasizes narrative continuity, character consistency, and not inventing
    // settings the model has not read.
    expect(captured.systemPrompt).toContain("叙事连续性");
    expect(captured.systemPrompt).toContain("人物一致性");
    expect(captured.systemPrompt).toContain("不要臆造");
    // The writing style pack is injected as persistent guidance (the novel-project CLAUDE.md).
    expect(captured.systemPrompt).toContain("文风规则");
    expect(captured.systemPrompt).toContain("连续比喻");

    // Guidance travels through the trusted system-prompt seam, never the untrusted-data envelope.
    const envelope = JSON.stringify(captured.messages);
    expect(envelope).not.toContain("叙事连续性");
    expect(envelope).not.toContain("文风规则");

    // Neither mode eagerly preloads non-current chapter bodies: only the current chapter appears.
    expect(envelope).toContain("当前章节正文");

    // The Context Snapshot records the guidance layer as an auditable system source with a checksum.
    const guidance = captured.snapshotSources.find(
      (source) => source["sourceKind"] === "system_guidance"
    );
    expect(guidance).toBeDefined();
    expect(guidance?.["layer"]).toBe("system");
    expect(String(guidance?.["checksum"])).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a general-file run gets faithful-text guidance with no writing style pack or character bodies", async () => {
    const captured = await runGuidanceProbe({
      contextMode: "general_file",
      initialContextSources: [
        {
          refId: "file:notes/spec.md",
          sourceKind: "disk_file",
          relativePath: "notes/spec.md",
          content: "当前文件正文",
          dirty: false
        }
      ]
    });

    // General-file guidance emphasizes faithful text handling, format preservation, minimal edits.
    expect(captured.systemPrompt).toContain("忠实");
    expect(captured.systemPrompt).toContain("保留原有格式");
    expect(captured.systemPrompt).toContain("最小改动");

    // No writing style pack / Story Bible / character bodies belong in general-file guidance.
    expect(captured.systemPrompt).not.toContain("文风规则");
    expect(captured.systemPrompt).not.toContain("连续比喻");

    // The two profiles are genuinely different guidance, not the same string.
    expect(captured.systemPrompt).not.toContain("叙事连续性");

    // The guidance layer is still recorded as an auditable system source.
    const guidance = captured.snapshotSources.find(
      (source) => source["sourceKind"] === "system_guidance"
    );
    expect(guidance).toBeDefined();
    expect(guidance?.["layer"]).toBe("system");
  });

  test("exposes a versioned guidance builder and a system-reserve token estimate", () => {
    const exports = applicationExports as unknown as Record<string, unknown>;
    const build = exports["buildAgentSystemGuidance"];
    const estimate = exports["estimateAgentSystemReserveTokens"];
    const version = exports["AGENT_SYSTEM_GUIDANCE_VERSION"];
    expect(typeof build).toBe("function");
    expect(typeof estimate).toBe("function");
    expect(typeof version).toBe("string");
    if (typeof build !== "function" || typeof estimate !== "function") return;

    const writing = (build as (mode: string) => string)("writing");
    const general = (build as (mode: string) => string)("general_file");
    expect(writing).not.toEqual(general);
    expect(writing).toContain("文风规则");
    expect(general).not.toContain("文风规则");

    // The reserve estimate is a positive token count and larger for the style-pack-bearing mode.
    const writingReserve = (estimate as (mode: string) => number)("writing");
    const generalReserve = (estimate as (mode: string) => number)("general_file");
    expect(Number.isSafeInteger(writingReserve)).toBe(true);
    expect(writingReserve).toBeGreaterThan(0);
    expect(generalReserve).toBeGreaterThan(0);
    expect(writingReserve).toBeGreaterThan(generalReserve);
  });
});

/**
 * Start a run that finishes on its first round, capturing the mode-specific system guidance the
 * session hands the driver, the untrusted-data envelope messages, and the sources written into the
 * initial Context Snapshot. Used to assert the two context-engineering profiles differ.
 */
async function runGuidanceProbe(overrides: {
  readonly contextMode: "writing" | "general_file";
  readonly initialContextSources: readonly Record<string, unknown>[];
}): Promise<{
  systemPrompt: string;
  messages: readonly Record<string, unknown>[];
  snapshotSources: readonly Record<string, unknown>[];
}> {
  const createSession = (applicationExports as unknown as Record<string, unknown>)[
    "createAgentRunSession"
  ] as (options: Record<string, unknown>) => {
    startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    readAgentRun(runId: string): Promise<Record<string, unknown>>;
  };

  let systemPrompt = "";
  let messages: readonly Record<string, unknown>[] = [];
  const contextSnapshots: Record<string, unknown>[] = [];
  const runId = `run_guidance_${overrides.contextMode}`;

  const session = createSession({
    coordinatorOptions: { createRunId: () => runId },
    repository: {
      ...memoryRepository(),
      async writeContextSnapshot(snapshot: Record<string, unknown>) {
        contextSnapshots.push(snapshot);
        return { ok: true, value: snapshot };
      }
    },
    modelDriver: {
      async *streamRound(input: {
        readonly systemPrompt?: string;
        readonly messages: readonly Record<string, unknown>[];
      }) {
        systemPrompt = input.systemPrompt ?? "";
        messages = input.messages;
        yield toolCall("guidance_finish", "finish", { summary: "完成" });
        yield { type: "round_completed", finishReason: "tool_calls" };
      }
    },
    startPreflight: echoStartPreflight(),
    readToolExecutor: {
      async execute() {
        return { ok: true, value: { summary: "ok", data: {} } };
      }
    }
  });

  await session.startAgentRun({
    ...startCommand(),
    contextMode: overrides.contextMode,
    initialContextSources: overrides.initialContextSources
  });
  await vi.waitFor(async () => {
    expect(await session.readAgentRun(runId)).toMatchObject({
      value: { snapshot: { status: "completed" } }
    });
  });

  const sources = contextSnapshots.flatMap((snapshot) =>
    Array.isArray(snapshot["sources"]) ? (snapshot["sources"] as Record<string, unknown>[]) : []
  );
  return { systemPrompt, messages, snapshotSources: sources };
}

function toolCall(toolCallId: string, name: string, argumentsValue: Record<string, unknown>) {
  return {
    type: "tool_call_delta",
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(argumentsValue)
  };
}

async function* blockedModelRound() {
  await new Promise<void>(() => undefined);
  yield { type: "round_completed" as const, finishReason: "stop" as const };
}

async function* unexpectedModelRound(message: string) {
  if (message.length > 0) throw new Error(message);
  yield { type: "round_completed" as const, finishReason: "stop" as const };
}

function startCommand(): Record<string, unknown> {
  return {
    projectId: "project-01",
    conversationId: "conv-01",
    commandId: "start-01",
    expectedRunRevision: 0,
    runDraftId: "draft_start-01",
    runDraftRevision: 1,
    runDraftChecksum: "checksum_start-01",
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

/**
 * A test double for the server-authoritative start preflight. The public start command is now
 * draft-only, so these tests keep expressing intent (mode, sources, capability facts) on the wide
 * command object and this stub echoes them back as resolved facts — standing in for the real
 * reload-draft + resolve-model preflight the desktop runtime provides.
 */
function echoStartPreflight() {
  return {
    async resolveStart(command: Record<string, unknown>) {
      const snapshot = (command["providerCapabilitySnapshot"] ?? {}) as Record<string, unknown>;
      const reasoningStrength = command["reasoningStrength"] ?? {
        status: "hidden",
        reason: "demo scripted model"
      };
      return {
        ok: true,
        value: {
          operationMode: command["operationMode"] ?? "execution",
          contextMode: command["contextMode"] ?? "writing",
          writePolicy: command["writePolicy"] ?? "write_before_confirmation",
          writePolicyAcknowledged: command["writePolicyAcknowledged"] === true,
          userRequest: command["userRequest"] ?? "",
          ...(command["reasoningEffort"] === undefined
            ? {}
            : { requestedReasoningEffort: command["reasoningEffort"] }),
          model: {
            profileId: snapshot["profileId"] ?? "profile-01",
            provider: snapshot["provider"] ?? "demo",
            modelName: snapshot["modelName"] ?? "scripted-agent",
            capabilities: {
              streaming: snapshot["streaming"] ?? true,
              toolCalling: snapshot["toolCalling"] ?? true,
              structuredArguments: snapshot["structuredArguments"] ?? true,
              contextWindow: snapshot["contextWindow"] ?? 128000
            },
            requiredContextTokens: snapshot["requiredContextTokens"] ?? 8000,
            reasoningStrength
          },
          initialContextSources: command["initialContextSources"] ?? []
        }
      };
    }
  };
}

/** A test double standing in for `createAgentPermissionSession`'s verify/bind pair (Task 2.1). */
function fakePermissionPort(input: {
  readonly permissionSummaryId: string;
  readonly checksum: string;
  readonly toolRegistryRevision: string;
  readonly onBind?: (summary: Record<string, unknown>) => void;
}) {
  return {
    async verifyForStart(facts: Record<string, unknown>) {
      return {
        ok: true,
        value: {
          schemaVersion: "1.0",
          permissionSummaryId: input.permissionSummaryId,
          projectId: facts["projectId"],
          runDraftId: facts["runDraftId"],
          contextMode: facts["contextMode"],
          writePolicy: facts["writePolicy"],
          toolRegistryRevision: input.toolRegistryRevision,
          rootFingerprint: "f".repeat(64),
          readCapabilities: [],
          proposalCapabilities: [],
          forbiddenCapabilities: [],
          checksum: input.checksum,
          generatedAt: "2026-07-17T00:00:00.000Z"
        }
      };
    },
    async bindToRun(bind: { readonly runId: string; readonly summary: Record<string, unknown> }) {
      const bound = { ...bind.summary, runId: bind.runId };
      input.onBind?.(bound);
      return { ok: true, value: bound };
    }
  };
}

/** Echoes intent like `echoStartPreflight`, but also resolves a context budget id (Task 1.4). */
function budgetStartPreflight(contextBudgetSnapshotId: string) {
  const base = echoStartPreflight();
  return {
    async resolveStart(command: Record<string, unknown>) {
      const resolved = await base.resolveStart(command);
      if (!resolved.ok) return resolved;
      return { ok: true, value: { ...resolved.value, contextBudgetSnapshotId } };
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
  const retryCheckpoints = new Map<string, Record<string, unknown>>();
  const commandReceipts = new Map<string, Record<string, unknown>>();
  const runErrors = new Map<string, Record<string, unknown>>();
  const preflightErrors = new Map<string, Record<string, unknown>>();
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
    async writeCommandReceipt(runId: string, commandId: string, receipt: Record<string, unknown>) {
      commandReceipts.set(`${runId}:${commandId}`, structuredClone(receipt));
      return { ok: true, value: receipt };
    },
    async readCommandReceipt(runId: string, commandId: string) {
      return { ok: true, value: commandReceipts.get(`${runId}:${commandId}`) };
    },
    async readSnapshot(runId: string) {
      return { ok: true, value: snapshots.get(runId) };
    },
    async readEvents(runId: string) {
      return { ok: true, value: events.get(runId) ?? [] };
    },
    async writeRetryCheckpoint(runId: string, checkpoint: Record<string, unknown>) {
      retryCheckpoints.set(runId, structuredClone(checkpoint));
      return { ok: true, value: checkpoint };
    },
    async readRetryCheckpoint(runId: string) {
      return { ok: true, value: retryCheckpoints.get(runId) };
    },
    async listSnapshots(projectId: string) {
      return {
        ok: true,
        value: [...snapshots.values()].filter((snapshot) => snapshot["projectId"] === projectId)
      };
    },
    async writeRunError(runId: string, record: Record<string, unknown>) {
      runErrors.set(`${runId}:${String(record["errorId"])}`, structuredClone(record));
      return { ok: true, value: record };
    },
    async readRunError(runId: string, errorId: string) {
      return { ok: true, value: runErrors.get(`${runId}:${errorId}`) };
    },
    async writePreflightError(record: Record<string, unknown>) {
      preflightErrors.set(String(record["errorId"]), structuredClone(record));
      return { ok: true, value: record };
    },
    async readPreflightError(errorId: string) {
      return { ok: true, value: preflightErrors.get(errorId) };
    }
  };
}

function diagnosticChangeSet(runId: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_partial",
    revision: 1,
    runId,
    checkpointId: "checkpoint_partial",
    contextSnapshotId: "context_partial",
    status: "awaiting_approval",
    checksum: "checksum_partial_1",
    approvalToken: "approval_partial_1",
    files: [
      {
        relativePath: "notes/partial.md",
        assetType: "text",
        baseChecksum: "a".repeat(64),
        candidateChecksum: "b".repeat(64),
        baseContent: "before",
        candidateContent: "after",
        hunks: [],
        validation: { valid: true, issues: [] },
        selected: true
      }
    ]
  };
}
