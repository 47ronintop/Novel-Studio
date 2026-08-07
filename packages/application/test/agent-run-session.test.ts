import { describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createUnifiedError } from "@novel-studio/shared";
import {
  computeAgentToolDescriptorDigest,
  createAgentContextSnapshot,
  createChangeSetRevisionV2,
  createDeterministicTokenEstimator,
  createEffectiveCapabilityState,
  revokeCapability,
  type AgentRunEventV20,
  type AgentRunSnapshotV20,
  type AgentToolCapabilitySnapshot,
  type AgentToolDescriptor
} from "@novel-studio/agent-engine";

import * as applicationExports from "../src/index.js";
import { createAgentPromptCacheIdentityArtifactV2 } from "../src/agent-prompt-cache.js";
import {
  freezeRunModelSharingGrant,
  freezeWorkspaceModelSharingDefaults,
  type FrozenRunModelSharingGrant
} from "../src/agent-model-sharing.js";

describe("AgentRunSession", () => {
  test("publishes partial usage and persists one priced final record when the round completes", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;

    const written: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
        subscribe(listener: (event: Record<string, unknown>) => void): () => void;
      }
    )({
      coordinatorOptions: { createRunId: () => "run_usage_round" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          yield {
            type: "usage",
            usage: {
              inputTokens: 80,
              outputTokens: 10,
              totalTokens: 90,
              usageStatus: "estimated",
              cost: { amount: 0, currency: "", status: "unknown" }
            }
          };
          yield {
            type: "usage",
            usage: {
              inputTokens: 120,
              outputTokens: 30,
              cachedTokens: 40,
              reasoningTokens: 10,
              totalTokens: 150,
              usageStatus: "actual",
              cost: { amount: 0, currency: "", status: "unknown" }
            }
          };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      usageSink: {
        async writeFinal(record: Record<string, unknown>) {
          written.push(record);
          return { ok: true, value: record };
        }
      },
      pricingRegistry: {
        price() {
          return {
            pricingVersion: "pricing-2026-07",
            unitPrices: {
              inputPerMillion: 2,
              outputPerMillion: 8,
              cacheReadPerMillion: 1,
              reasoningPerMillion: 4,
              currency: "USD"
            },
            cost: { amount: 0.00056, currency: "USD", status: "estimated" }
          };
        }
      },
      usageTime: () => ({
        timestamp: "2026-11-01T05:30:00.000Z",
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -240
      }),
      usageBudgetResolver: async () => ({
        ok: true,
        value: { contextWindow: 128000, safeInputBudget: 100000 }
      })
    });
    session.subscribe((event) => events.push(event));

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_usage_round")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "completed",
            usageSummary: {
              inputTokens: 120,
              outputTokens: 30,
              cachedTokens: 40,
              reasoningTokens: 10,
              totalTokens: 150,
              usageStatus: "actual"
            }
          }
        }
      });
    });

    const usageEvents = events.filter((event) => event["type"] === "usage_updated");
    expect(usageEvents).toHaveLength(2);
    const finalSequence = usageEvents.at(-1)?.["sequence"];
    expect(written).toEqual([
      expect.objectContaining({
        schemaVersion: "1.2",
        scope: {
          kind: "workspace",
          workspaceKind: "creativeProject",
          workspaceId: "project-01"
        },
        usageId: `run_usage_round:model_round_run_usage_round_1:${String(finalSequence)}`,
        runId: "run_usage_round",
        conversationId: "conv-01",
        roundId: "model_round_run_usage_round_1",
        finalSequence,
        provider: "demo",
        model: "scripted-agent",
        inputTokens: 120,
        outputTokens: 30,
        cachedTokens: 40,
        cacheReadTokens: 40,
        cacheOutcome: "unknown",
        cacheUsageStatus: "unavailable",
        cacheInputTokenSemantics: "unavailable",
        cacheMode: "none",
        cachePrefixChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
        reasoningTokens: 10,
        totalTokens: 150,
        usageStatus: "actual",
        precision: "reported",
        pricingVersion: "pricing-2026-07",
        unitPrices: expect.objectContaining({ currency: "USD" }),
        cost: { amount: 0.00056, currency: "USD", status: "estimated" },
        contextWindow: 128000,
        safeInputBudget: 100000,
        terminationReason: "stop",
        timestamp: "2026-11-01T05:30:00.000Z",
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -240
      })
    ]);
    expect(JSON.stringify(usageEvents)).not.toMatch(
      /cost|pricing|authorization|prompt|body|frame/i
    );
  });

  test("does not persist partial usage when the provider fails before round completion", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const written: Record<string, unknown>[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_partial_usage" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          yield {
            type: "usage",
            usage: {
              inputTokens: 12,
              outputTokens: 3,
              totalTokens: 15,
              usageStatus: "actual",
              cost: { amount: 0.001, currency: "USD", status: "actual" }
            }
          };
          throw new Error("provider disconnected before round completion");
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      usageSink: {
        async writeFinal(record: Record<string, unknown>) {
          written.push(record);
          return { ok: true, value: record };
        }
      }
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_partial_usage")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            usageSummary: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              usageStatus: "missing"
            }
          },
          events: expect.arrayContaining([expect.objectContaining({ type: "usage_updated" })])
        }
      });
    });
    expect(written).toEqual([]);
  });

  test("persists missing usage for a completed round when the provider reports none", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const written: Record<string, unknown>[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_missing_usage" },
      repository: memoryRepository(),
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
      },
      usageSink: {
        async writeFinal(record: Record<string, unknown>) {
          written.push(record);
          return { ok: true, value: record };
        }
      },
      usageBudgetResolver: async () => ({
        ok: true,
        value: { contextWindow: 128000, safeInputBudget: 100000 }
      })
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_missing_usage")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed", usageSummary: { usageStatus: "missing" } },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "usage_updated",
              detail: expect.objectContaining({ usageStatus: "missing", totalTokens: 0 })
            })
          ])
        }
      });
    });
    expect(written).toEqual([
      expect.objectContaining({
        runId: "run_missing_usage",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        usageStatus: "missing",
        precision: "unknown",
        pricingVersion: null,
        unitPrices: null,
        cost: { amount: 0, currency: "", status: "unknown" }
      })
    ]);
  });

  test("retains a prior zero-token missing usage status after a later actual round", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const written: Record<string, unknown>[] = [];
    let rounds = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_missing_then_actual_usage" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("read_before_usage", "read_project_text", { path: "notes.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield {
            type: "usage",
            usage: {
              inputTokens: 12,
              outputTokens: 3,
              totalTokens: 15,
              usageStatus: "actual",
              cost: { amount: 0.001, currency: "USD", status: "actual" }
            }
          };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "read", data: {} } };
        }
      },
      usageSink: {
        async writeFinal(record: Record<string, unknown>) {
          written.push(record);
          return { ok: true, value: record };
        }
      },
      usageBudgetResolver: async () => ({
        ok: true,
        value: { contextWindow: 128000, safeInputBudget: 100000 }
      })
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_missing_then_actual_usage")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "completed",
            usageSummary: {
              inputTokens: 12,
              outputTokens: 3,
              totalTokens: 15,
              usageStatus: "missing"
            }
          }
        }
      });
    });
    expect(written).toHaveLength(2);
    expect(written.at(-1)).toMatchObject({ usageStatus: "actual", totalTokens: 15 });
  });

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
          expect(input.messages).toContainEqual(
            expect.objectContaining({
              role: "assistant",
              toolCalls: [expect.objectContaining({ id: "call_question" })]
            })
          );
          expect(input.messages).toContainEqual(
            expect.objectContaining({ role: "tool", toolCallId: "call_question" })
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
      "context_refreshed",
      "assistant_text_delta",
      "assistant_text_completed",
      "tool_started",
      "tool_completed",
      "tool_started",
      "tool_completed",
      "tool_started",
      "tool_completed",
      "assistant_text_completed",
      "user_input_requested",
      "user_input_resolved",
      "assistant_text_completed",
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

  test("binds a session-resolved context budget id onto every started run", async () => {
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
      value: {
        runId: "run_budget",
        contextBudgetSnapshotId: expect.stringMatching(/^budget_start_[a-f0-9]{32}$/u)
      }
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
      value: {
        runId: "run_no_budget",
        contextBudgetSnapshotId: expect.stringMatching(/^budget_start_[a-f0-9]{32}$/u)
      }
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

  test("records 70% context-budget pressure and still permits the provider round", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    let providerCalls = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_budget_warn" },
      repository: memoryRepository(),
      contextBudgetEstimator: {
        count() {
          return { tokens: 5000, precision: "estimated" as const };
        }
      },
      modelDriver: {
        async *streamRound() {
          providerCalls += 1;
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

    await session.startAgentRun({
      ...startCommand(),
      providerCapabilitySnapshot: {
        ...(startCommand()["providerCapabilitySnapshot"] as Record<string, unknown>),
        contextWindow: 20000,
        requiredContextTokens: 1000
      }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_budget_warn")).toMatchObject({
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "error_recorded",
              detail: expect.objectContaining({
                code: "AGENT_CONTEXT_BUDGET_WARNING",
                pressure: "warn"
              })
            })
          ])
        }
      });
    });
    expect(providerCalls).toBe(1);
  });

  test.each([
    { runId: "run_budget_compact", contextWindow: 19500, budgetExceeded: false },
    { runId: "run_budget_exceeded", contextWindow: 18000, budgetExceeded: true }
  ])(
    "requires manual compaction before provider input for $runId",
    async ({ runId, contextWindow, budgetExceeded }) => {
      const createSession = (applicationExports as unknown as Record<string, unknown>)[
        "createAgentRunSession"
      ] as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      };
      let providerCalls = 0;
      const session = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository: memoryRepository(),
        contextBudgetEstimator: {
          count() {
            return { tokens: 5000, precision: "estimated" as const };
          }
        },
        modelDriver: {
          async *streamRound() {
            providerCalls += 1;
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

      await session.startAgentRun({
        ...startCommand(),
        providerCapabilitySnapshot: {
          ...(startCommand()["providerCapabilitySnapshot"] as Record<string, unknown>),
          contextWindow,
          requiredContextTokens: 1000
        }
      });
      await vi.waitFor(async () => {
        expect(await session.readAgentRun(runId)).toMatchObject({
          value: {
            snapshot: {
              status: "executing_model",
              contextBudgetSnapshotId: expect.any(String)
            },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "context_compaction_failed",
                detail: expect.objectContaining({
                  code: "AGENT_CONTEXT_COMPACTION_REQUIRED",
                  pressure: "compact",
                  budgetExceeded
                })
              })
            ])
          }
        });
      });
      expect(providerCalls).toBe(0);
    }
  );

  test("resumes after required context compaction without consuming a model round", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      compactContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const repository = durableMemoryRepository();
    const runId = "run_budget_compaction_resume";
    let compactedContext = false;
    let providerCalls = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      contextBudgetEstimator: {
        count() {
          return { tokens: compactedContext ? 100 : 5000, precision: "estimated" as const };
        }
      },
      modelDriver: {
        async *streamRound() {
          providerCalls += 1;
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      contextCompactor: {
        async compactContext(command: { runId: string }) {
          compactedContext = true;
          const storedRun = await repository.readSnapshot(command.runId);
          if (!storedRun.ok || storedRun.value === undefined) {
            throw new Error("Expected the active run before context compaction.");
          }
          const run = storedRun.value;
          const contextSnapshotId = String(run["contextSnapshotId"]);
          const budgetSnapshotId = "budget_compaction_resume";
          return {
            ok: true,
            value: {
              compactionId: "compaction_budget_resume",
              revision: {
                schemaVersion: "1.0",
                compactionId: "compaction_budget_resume",
                runId: command.runId,
                sourceSnapshotId: contextSnapshotId,
                resultSnapshotId: contextSnapshotId,
                budgetSnapshotId,
                inputManifestId: "manifest_budget_resume",
                inputManifestChecksum: "a".repeat(64),
                revision: 1,
                throughSequence: Number(run["lastSequence"]),
                trigger: "manual",
                strategy: "deterministic",
                protectedFactIds: [],
                evictedSourceIds: [],
                inputTokens: 0,
                outputTokens: 0,
                usageRecordId: null,
                precision: "unknown",
                summaryChecksum: "b".repeat(64),
                status: "completed",
                createdAt: "2026-07-29T00:00:00.000Z"
              },
              runSnapshot: {
                ...run,
                activeCompactionId: "compaction_budget_resume",
                contextSnapshotId,
                contextBudgetSnapshotId: budgetSnapshotId
              }
            }
          };
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 1, maxToolCalls: 4, maxConsecutiveToolFailures: 2 },
      providerCapabilitySnapshot: {
        ...(startCommand()["providerCapabilitySnapshot"] as Record<string, unknown>),
        contextWindow: 19500,
        requiredContextTokens: 1000
      }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        value: {
          snapshot: { status: "executing_model" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "context_compaction_failed",
              detail: expect.objectContaining({ code: "AGENT_CONTEXT_COMPACTION_REQUIRED" })
            })
          ])
        }
      });
    });
    expect(providerCalls).toBe(0);

    const paused = (await session.readAgentRun(runId)) as {
      value: { snapshot: { runRevision: number; contextBudgetSnapshotId: string } };
    };
    expect(
      await session.compactContext({
        projectId: "project-01",
        runId,
        commandId: "compact-budget-resume",
        expectedRunRevision: paused.value.snapshot.runRevision,
        contextBudgetSnapshotId: paused.value.snapshot.contextBudgetSnapshotId,
        trigger: "manual"
      })
    ).toMatchObject({ ok: true });

    await vi.waitFor(async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(providerCalls).toBe(1);
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
    const compactRepository = durableMemoryRepository();
    const withCompactor = create({
      coordinatorOptions: { createRunId: () => "run_compact" },
      repository: compactRepository,
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
          const storedRun = await compactRepository.readSnapshot(command.runId);
          const run = storedRun.value as Record<string, unknown>;
          const sourceSnapshotId = String(run["contextSnapshotId"]);
          const storedContext = await compactRepository.readContextSnapshot(
            command.runId,
            sourceSnapshotId
          );
          const context = storedContext.value as Record<string, unknown>;
          const sourceArtifactId = String(
            ((context["sources"] as Record<string, unknown>[])[0] ?? {})["artifactId"]
          );
          const storedArtifact = await compactRepository.readPromptMaterialization(
            command.runId,
            sourceArtifactId
          );
          const rematerialize = applicationExports.rematerializeAgentPromptArtifact;
          const resultSnapshotId = `${sourceSnapshotId}_c1`;
          const promptArtifact = rematerialize(
            storedArtifact.value as unknown as Parameters<typeof rematerialize>[0],
            {
              contextSnapshotId: resultSnapshotId,
              contextSources: (
                storedArtifact.value as unknown as Parameters<typeof rematerialize>[0]
              ).contextSources
            }
          );
          await compactRepository.writePromptMaterialization(
            command.runId,
            promptArtifact as unknown as Record<string, unknown>
          );
          const resultContext = {
            ...context,
            contextSnapshotId: resultSnapshotId,
            compactionRevision: Number(context["compactionRevision"]) + 1,
            materialization: {
              ...(context["materialization"] as Record<string, unknown>),
              stablePrefixChecksum: promptArtifact.stablePrefixChecksum
            },
            sources: (context["sources"] as Record<string, unknown>[]).map((source) =>
              source["artifactId"] === sourceArtifactId
                ? { ...source, artifactId: promptArtifact.artifactId }
                : source
            )
          };
          await compactRepository.writeContextSnapshot(resultContext);
          const budgetSnapshotId = "budget_compacted";
          return {
            ok: true,
            value: {
              compactionId: "compaction_1",
              revision: {
                schemaVersion: "1.0",
                compactionId: "compaction_1",
                runId: command.runId,
                sourceSnapshotId,
                resultSnapshotId,
                budgetSnapshotId,
                inputManifestId: "manifest_compaction_1",
                inputManifestChecksum: "a".repeat(64),
                revision: 1,
                throughSequence: Number(run["lastSequence"]),
                trigger: "manual",
                strategy: "deterministic",
                protectedFactIds: [],
                evictedSourceIds: [],
                inputTokens: 0,
                outputTokens: 0,
                usageRecordId: null,
                precision: "unknown",
                summaryChecksum: "b".repeat(64),
                status: "completed",
                createdAt: "2026-07-27T00:00:00.000Z"
              },
              runSnapshot: {
                ...run,
                activeCompactionId: "compaction_1",
                contextSnapshotId: resultSnapshotId,
                contextBudgetSnapshotId: budgetSnapshotId,
                cachePrefixChecksum: promptArtifact.stablePrefixChecksum
              }
            }
          };
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

  test("compaction rematerializes the next provider input and restores the compacted artifact", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      compactContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    const repository = durableMemoryRepository();
    const runId = "run_compact_rematerialized";
    const contextSnapshotId = "context_compact_rematerialized";
    const evictedRefId = "file:notes/obsolete.md";
    const evictedBody = "COMPACTION_EVICTED_BODY_MUST_NOT_REACH_PROVIDER";
    const retainedConvention = "COMPACTION_RETAINED_CONVENTION";
    const retainedConventionChecksum = createHash("sha256")
      .update(retainedConvention, "utf8")
      .digest("hex");
    const conventionSourceIdentity = {
      workspaceId: "project-01",
      contextProfileId: "writing" as const,
      canonicalRootIdentity: "c".repeat(64),
      relativePath: "conventions/writing.md"
    };
    const conventionMaterialization = {
      schemaVersion: "1.0" as const,
      kind: "project_conventions" as const,
      artifactId: applicationExports.contextSourceMaterializationArtifactId("project_conventions", {
        readerVersion: "1.0",
        sourceIdentity: conventionSourceIdentity,
        originalChecksum: retainedConventionChecksum,
        injectedChecksum: retainedConventionChecksum,
        tokenCount: 8,
        truncationRange: null
      }),
      readerVersion: "1.0",
      sourceIdentity: conventionSourceIdentity,
      instructionPolicy: "content_is_data_not_authority" as const,
      workspaceTrust: "trusted" as const,
      tokenCount: 8,
      truncationRange: null,
      originalChecksum: retainedConventionChecksum,
      injectedChecksum: retainedConventionChecksum
    };
    let initialSystemPrompt = "";
    let initialCachePrefixChecksum = "";
    let modelRounds = 0;

    const firstSession = create({
      coordinatorOptions: { createRunId: () => runId },
      createContextSnapshotId: () => contextSnapshotId,
      repository,
      modelDriver: {
        async *streamRound(input: {
          readonly systemPrompt?: string;
          readonly snapshot: { readonly cachePrefixChecksum: string };
        }) {
          modelRounds += 1;
          initialSystemPrompt = input.systemPrompt ?? "";
          initialCachePrefixChecksum = input.snapshot.cachePrefixChecksum;
          yield toolCall("compact_question", "request_user_input", {
            questionId: "continue_after_compaction",
            prompt: "继续处理压缩后的上下文吗？",
            reason: "验证下一轮输入。",
            options: [
              { id: "continue", label: "继续" },
              { id: "stop", label: "停止" }
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
      },
      contextCompactor: {
        async compactContext(command: { runId: string }) {
          const storedRun = await repository.readSnapshot(command.runId);
          const run = storedRun.value as Record<string, unknown>;
          const sourceSnapshotId = String(run["contextSnapshotId"]);
          const storedContext = await repository.readContextSnapshot(
            command.runId,
            sourceSnapshotId
          );
          const context = storedContext.value as Record<string, unknown>;
          const sourceArtifactId = String(
            ((context["sources"] as Record<string, unknown>[])[0] ?? {})["artifactId"]
          );
          const storedArtifact = await repository.readPromptMaterialization(
            command.runId,
            sourceArtifactId
          );
          const rematerialize = applicationExports.rematerializeAgentPromptArtifact;
          const resultSnapshotId = `${sourceSnapshotId}_c1`;
          const priorArtifact = storedArtifact.value as unknown as Parameters<
            typeof rematerialize
          >[0];
          const promptArtifact = rematerialize(priorArtifact, {
            contextSnapshotId: resultSnapshotId,
            contextSources: priorArtifact.contextSources.filter(
              (source) => source.refId !== evictedRefId
            )
          });
          expect(promptArtifact.stablePrefixChecksum).toBe(initialCachePrefixChecksum);
          await repository.writePromptMaterialization(
            command.runId,
            promptArtifact as unknown as Record<string, unknown>
          );
          const resultContext = {
            ...context,
            contextSnapshotId: resultSnapshotId,
            compactionRevision: Number(context["compactionRevision"]) + 1,
            materialization: {
              ...(context["materialization"] as Record<string, unknown>),
              stablePrefixChecksum: promptArtifact.stablePrefixChecksum
            },
            sources: (context["sources"] as Record<string, unknown>[]).map((source) => {
              if (source["refId"] === evictedRefId) {
                return { ...source, state: "excluded", artifactId: null };
              }
              return source["artifactId"] === sourceArtifactId
                ? { ...source, artifactId: promptArtifact.artifactId }
                : source;
            }),
            excludedSources: [
              ...((context["excludedSources"] as readonly string[] | undefined) ?? []),
              evictedRefId
            ]
          };
          await repository.writeContextSnapshot(resultContext);
          const budgetSnapshotId = "budget_compacted_rematerialized";
          return {
            ok: true,
            value: {
              compactionId: "compaction_rematerialized",
              revision: {
                schemaVersion: "1.0",
                compactionId: "compaction_rematerialized",
                runId: command.runId,
                sourceSnapshotId,
                resultSnapshotId,
                budgetSnapshotId,
                inputManifestId: "manifest_compaction_rematerialized",
                inputManifestChecksum: "a".repeat(64),
                revision: 1,
                throughSequence: Number(run["lastSequence"]),
                trigger: "manual",
                strategy: "deterministic",
                protectedFactIds: [],
                evictedSourceIds: [evictedRefId],
                inputTokens: 0,
                outputTokens: 0,
                usageRecordId: null,
                precision: "unknown",
                summaryChecksum: "b".repeat(64),
                status: "completed",
                createdAt: "2026-07-27T00:00:00.000Z"
              },
              runSnapshot: {
                ...run,
                activeCompactionId: "compaction_rematerialized",
                contextSnapshotId: resultSnapshotId,
                contextBudgetSnapshotId: budgetSnapshotId,
                cachePrefixChecksum: promptArtifact.stablePrefixChecksum
              }
            }
          };
        }
      }
    });

    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "conventions:writing",
          sourceKind: "project_conventions",
          relativePath: "conventions/writing.md",
          content: retainedConvention,
          dirty: false,
          materialization: conventionMaterialization
        },
        {
          refId: evictedRefId,
          sourceKind: "disk_file",
          relativePath: "notes/obsolete.md",
          content: evictedBody,
          dirty: false
        }
      ]
    });
    await vi.waitFor(async () => {
      expect(await firstSession.readAgentRun(runId)).toMatchObject({
        value: { snapshot: { status: "awaiting_user_input" } }
      });
    });
    expect(initialSystemPrompt).not.toBe("");
    expect(initialSystemPrompt).toBe(applicationExports.buildAgentSystemPrompt("writing"));
    expect(initialCachePrefixChecksum).toMatch(/^[a-f0-9]{64}$/u);

    const beforeCompaction = (await firstSession.readAgentRun(runId)) as {
      value: { snapshot: { runRevision: number } };
    };
    const compacted = await firstSession.compactContext({
      projectId: "project-01",
      runId,
      commandId: "compact-rematerialized",
      expectedRunRevision: beforeCompaction.value.snapshot.runRevision,
      contextBudgetSnapshotId: "budget_before_compaction",
      trigger: "manual"
    });
    expect(compacted).toMatchObject({
      ok: true,
      value: {
        contextSnapshotId: `${contextSnapshotId}_c1`,
        cachePrefixChecksum: initialCachePrefixChecksum
      }
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(modelRounds).toBe(1);

    const compactedContext = await repository.readContextSnapshot(runId, `${contextSnapshotId}_c1`);
    expect(compactedContext.value).toMatchObject({
      materialization: { stablePrefixChecksum: initialCachePrefixChecksum },
      excludedSources: [evictedRefId],
      sources: expect.arrayContaining([
        expect.objectContaining({ refId: evictedRefId, state: "excluded", artifactId: null })
      ])
    });

    let resumedSystemPrompt = "";
    let resumedMessages: readonly Record<string, unknown>[] = [];
    const reloadedSession = create({
      repository,
      modelDriver: {
        async *streamRound(input: {
          readonly systemPrompt?: string;
          readonly messages: readonly Record<string, unknown>[];
        }) {
          resumedSystemPrompt = input.systemPrompt ?? "";
          resumedMessages = input.messages;
          yield { type: "assistant_text_delta", delta: "已继续。" };
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
    const restored = await reloadedSession.readAgentRun(runId);
    expect(restored).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          status: "awaiting_user_input",
          contextSnapshotId: `${contextSnapshotId}_c1`,
          cachePrefixChecksum: initialCachePrefixChecksum
        },
        pendingUserInput: { questionId: "continue_after_compaction" }
      }
    });
    const restoredRevision = (restored as { value: { snapshot: { runRevision: number } } }).value
      .snapshot.runRevision;
    await reloadedSession.answerUserInput({
      projectId: "project-01",
      runId,
      commandId: "answer-after-compaction",
      expectedRunRevision: restoredRevision,
      questionId: "continue_after_compaction",
      answer: "继续。"
    });
    await vi.waitFor(async () => {
      expect(await reloadedSession.readAgentRun(runId)).toMatchObject({
        value: { snapshot: { status: "completed" } }
      });
    });

    expect(resumedSystemPrompt).toBe(initialSystemPrompt);
    expect(resumedSystemPrompt).toBe(applicationExports.buildAgentSystemPrompt("writing"));
    expect(JSON.stringify(resumedMessages)).toContain(retainedConvention);
    expect(JSON.stringify(resumedMessages)).not.toContain(evictedBody);
  });

  test("hydrates the persisted summary artifact and fails closed when it is missing or altered", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const create = createSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const repository = durableMemoryRepository();
    const runId = "run_summary_hydrate";
    const first = create({
      coordinatorOptions: { createRunId: () => runId },
      createContextSnapshotId: () => "context_summary_source",
      repository,
      newRunToolFacadeVersion: "v2",
      modelDriver: {
        async *streamRound() {
          yield toolCall("summary_question", "request_user_input", {
            questionId: "summary_continue",
            prompt: "Continue?",
            reason: "Keep the run resumable.",
            options: [
              { id: "yes", label: "Yes" },
              { id: "no", label: "No" }
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
    expect(await first.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      const current = await first.readAgentRun(runId);
      expect(current, JSON.stringify(current)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_user_input" } }
      });
    });

    const storedRun = await repository.readSnapshot(runId);
    if (!storedRun.ok || storedRun.value === undefined) throw new Error("Expected stored run");
    const sourceSnapshotId = String(storedRun.value["contextSnapshotId"]);
    const storedContext = await repository.readContextSnapshot(runId, sourceSnapshotId);
    if (!storedContext.ok || storedContext.value === undefined) {
      throw new Error("Expected stored context");
    }
    const sourceArtifactId = String(
      ((storedContext.value["sources"] as Record<string, unknown>[])[0] ?? {})["artifactId"]
    );
    const storedPrompt = await repository.readPromptMaterialization(runId, sourceArtifactId);
    if (!storedPrompt.ok || storedPrompt.value === undefined) {
      throw new Error("Expected stored prompt");
    }
    const priorPrompt = applicationExports.parseAgentPromptMaterializationArtifact(
      storedPrompt.value as never
    );
    const body = JSON.stringify({
      plotFacts: ["The bridge collapsed"],
      characterStates: ["Mara is injured"],
      foreshadowing: ["The brass key remains unexplained"],
      userDecisions: ["Keep Mara alive"]
    });
    const count = createDeterministicTokenEstimator().count(body, "profile-01");
    const result = {
      body,
      provenance: {
        kind: "model_assisted" as const,
        provider: "demo",
        model: "scripted-agent",
        modelProfileId: "profile-01",
        templateVersion: "1.0" as const,
        inputChecksum: "a".repeat(64)
      },
      tokenCount: count.tokens,
      checksum: createHash("sha256").update(body, "utf8").digest("hex"),
      precision: count.precision
    };
    const summaryArtifact = applicationExports.createCompactionSummaryArtifact({
      artifactId: "summary_compaction_hydrate",
      runId,
      compactionId: "compaction_hydrate",
      contextProfileId: "writing",
      sourceSnapshotId,
      throughSequence: Number(storedRun.value["lastSequence"]),
      inputManifestChecksum: "b".repeat(64),
      result,
      createdAt: "2026-07-28T00:00:00.000Z"
    });
    const summarySource = {
      refId: "compaction_summary",
      sourceKind: "compaction_summary" as const,
      assetId: summaryArtifact.artifactId,
      content: body,
      dirty: false,
      sourceRevision: summaryArtifact.throughSequence
    };
    const resultSnapshotId = "context_summary_result";
    const nextPrompt = applicationExports.rematerializeAgentPromptArtifact(priorPrompt, {
      contextSnapshotId: resultSnapshotId,
      contextSources: [...priorPrompt.contextSources, summarySource]
    });
    const nextContext = createAgentContextSnapshot({
      contextSnapshotId: resultSnapshotId,
      runId,
      scope: storedRun.value["scope"] as never,
      contextProfileId: "writing",
      materialization: {
        schemaVersion: "1.0",
        profileVersion: priorPrompt.profileVersion,
        guidanceTemplateChecksum: priorPrompt.guidanceTemplateChecksum,
        stablePrefixChecksum: nextPrompt.stablePrefixChecksum,
        messageOrderVersion: "1.0"
      },
      createdAt: "2026-07-28T00:00:00.000Z",
      sources: [
        {
          refId: priorPrompt.systemGuidanceRefId,
          sourceKind: "system_guidance",
          content: priorPrompt.systemPrompt,
          dirty: false
        },
        summarySource
      ],
      materializationArtifactId: nextPrompt.artifactId
    });
    expect(
      await repository.writeCompactionSummaryArtifact(runId, summaryArtifact as never)
    ).toMatchObject({ ok: true });
    expect(await repository.writePromptMaterialization(runId, nextPrompt as never)).toMatchObject({
      ok: true
    });
    expect(
      await repository.writeContextSnapshot({
        ...(nextContext as unknown as Record<string, unknown>),
        compactionRevision: 1
      })
    ).toMatchObject({ ok: true });
    expect(
      await repository.writeSnapshot({
        ...storedRun.value,
        activeCompactionId: "compaction_hydrate",
        contextSnapshotId: resultSnapshotId,
        cachePrefixChecksum: nextPrompt.stablePrefixChecksum
      })
    ).toMatchObject({ ok: true });
    expect({
      runId: nextPrompt.runId === runId,
      contextSnapshotId: nextPrompt.contextSnapshotId === resultSnapshotId,
      profileId: nextPrompt.profileId === storedRun.value["contextProfileId"],
      profileVersion: nextPrompt.profileVersion === storedRun.value["profileVersion"],
      stablePrefix:
        nextPrompt.stablePrefixChecksum === nextContext.materialization.stablePrefixChecksum,
      guidance:
        createHash("sha256").update(nextPrompt.systemPrompt, "utf8").digest("hex") ===
        storedRun.value["guidanceTemplateChecksum"],
      sources: nextContext.sources.every((source) => {
        const content =
          source.refId === nextPrompt.systemGuidanceRefId
            ? nextPrompt.systemPrompt
            : nextPrompt.contextSources.find((candidate) => candidate.refId === source.refId)
                ?.content;
        return (
          source.artifactId === nextPrompt.artifactId &&
          typeof content === "string" &&
          createHash("sha256").update(content, "utf8").digest("hex") === source.checksum
        );
      })
    }).toEqual({
      runId: true,
      contextSnapshotId: true,
      profileId: true,
      profileVersion: true,
      stablePrefix: true,
      guidance: true,
      sources: true
    });

    const baseOptions = {
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    };
    const missing = create({
      ...baseOptions,
      repository: {
        ...repository,
        async readCompactionSummaryArtifact() {
          return { ok: true, value: undefined };
        }
      },
      modelDriver: { streamRound: blockedModelRound }
    });
    expect(await missing.readAgentRun(runId)).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_SUMMARY_ARTIFACT_MISSING" }
    });

    const altered = create({
      ...baseOptions,
      repository: {
        ...repository,
        async readCompactionSummaryArtifact() {
          return {
            ok: true,
            value: { ...summaryArtifact, body: `${summaryArtifact.body} ` }
          };
        }
      },
      modelDriver: { streamRound: blockedModelRound }
    });
    expect(await altered.readAgentRun(runId)).toMatchObject({
      ok: false,
      error: { code: "AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID" }
    });

    let resumedMessages: readonly Record<string, unknown>[] = [];
    const restored = create({
      ...baseOptions,
      repository,
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          resumedMessages = input.messages;
          yield { type: "assistant_text_delta", delta: "Done." };
          yield { type: "round_completed", finishReason: "stop" };
        }
      }
    });
    const hydrated = await restored.readAgentRun(runId);
    expect(hydrated, JSON.stringify(hydrated)).toMatchObject({
      ok: true,
      value: { snapshot: { contextSnapshotId: resultSnapshotId } }
    });
    const revision = (hydrated as { value: { snapshot: { runRevision: number } } }).value.snapshot
      .runRevision;
    await restored.answerUserInput({
      projectId: "project-01",
      runId,
      commandId: "answer-summary-hydrate",
      expectedRunRevision: revision,
      questionId: "summary_continue",
      answer: "Yes"
    });
    await vi.waitFor(async () => {
      expect(await restored.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const summaryMessage = resumedMessages.find(
      (message) =>
        typeof message["content"] === "string" &&
        message["content"].includes('"kind":"untrusted_conversation_data"')
    );
    expect(summaryMessage).toBeDefined();
    expect(JSON.parse(String(summaryMessage?.["content"]))).toMatchObject({
      kind: "untrusted_conversation_data",
      source: {
        sourceKind: "compaction"
      },
      data: body
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
            expect.objectContaining({ type: "context_refreshed" }),
            expect.objectContaining({ type: "assistant_text_completed" }),
            expect.objectContaining({ type: "tool_started" }),
            expect.objectContaining({ type: "tool_completed" }),
            expect.objectContaining({ type: "error_recorded" }),
            expect.objectContaining({ type: "context_stale" })
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
          yield* [];
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
          yield* [];
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

  test("planning rejects malformed plans at the schema boundary and persists a complete immutable Plan Artifact", async () => {
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
    const planArguments = {
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
    };
    let planningRounds = 0;
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
          planningRounds += 1;
          expect(input.tools.map((tool) => tool.name)).toEqual([
            "list_project_entries",
            "read_chapter",
            "read_story_bible",
            "read_project_text",
            "finish_plan",
            "request_user_input"
          ]);
          if (planningRounds === 1) {
            yield toolCall("finish_plan_bad_nested", "finish_plan", {
              ...planArguments,
              targetRefs: ["chapter-03"]
            });
          } else if (planningRounds === 2) {
            const { risks: _risks, ...missingRisks } = planArguments;
            void _risks;
            yield toolCall("finish_plan_missing_field", "finish_plan", missingRisks);
          } else {
            yield toolCall("finish_plan_01", "finish_plan", planArguments);
          }
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

    await session.startAgentRun({
      ...startCommand(),
      operationMode: "planning",
      limits: { maxModelRounds: 4, maxToolCalls: 4, maxConsecutiveToolFailures: 3 }
    });
    // Registered JSON Schema rejects malformed provider calls before the Application parser.
    // The valid third call crosses that boundary and exercises parsing plus persistence; the
    // parser's matching strict checks remain defense in depth for any future internal caller.
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_plan")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "plan_ready" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "finish_plan_bad_nested",
                toolName: "finish_plan",
                code: "AGENT_TOOL_ARGUMENTS_INVALID"
              })
            }),
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "finish_plan_missing_field",
                toolName: "finish_plan",
                code: "AGENT_TOOL_ARGUMENTS_INVALID"
              })
            })
          ]),
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
            expect.objectContaining({ type: "context_refreshed" }),
            expect.objectContaining({ type: "assistant_text_completed" }),
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

  test("isolates identical command ids across runs in the same scope", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ];
    expect(typeof createSession).toBe("function");
    if (typeof createSession !== "function") return;
    const runIds = ["run_receipt_a", "run_receipt_b"];
    const session = (
      createSession as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      coordinatorOptions: { createRunId: () => runIds.shift() ?? "unexpected_run" },
      repository: durableMemoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      }
    });

    const first = await session.startAgentRun({ ...startCommand(), commandId: "start-receipt-a" });
    expect(first).toMatchObject({ ok: true, value: { runId: "run_receipt_a" } });
    const firstLive = await session.readAgentRun("run_receipt_a");
    const firstRevision = (firstLive as { value: { snapshot: { runRevision: number } } }).value
      .snapshot.runRevision;
    const firstStopped = await session.stopAgentRun({
      projectId: "project-01",
      runId: "run_receipt_a",
      commandId: "shared-stop-command",
      expectedRunRevision: firstRevision
    });
    expect(firstStopped).toMatchObject({ ok: true, value: { runId: "run_receipt_a" } });

    const second = await session.startAgentRun({
      ...startCommand(),
      commandId: "start-receipt-b"
    });
    expect(second).toMatchObject({ ok: true, value: { runId: "run_receipt_b" } });
    const secondLive = await session.readAgentRun("run_receipt_b");
    const secondRevision = (secondLive as { value: { snapshot: { runRevision: number } } }).value
      .snapshot.runRevision;
    const secondStopped = await session.stopAgentRun({
      projectId: "project-01",
      runId: "run_receipt_b",
      commandId: "shared-stop-command",
      expectedRunRevision: secondRevision
    });
    expect(secondStopped).toMatchObject({ ok: true, value: { runId: "run_receipt_b" } });
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
    let initialSystemPrompt = "";
    const firstSession = create({
      coordinatorOptions: { createRunId: () => "run_durable_pause" },
      repository,
      modelDriver: {
        async *streamRound(input: { readonly systemPrompt?: string }) {
          initialSystemPrompt = input.systemPrompt ?? "";
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
    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/current.md",
          sourceKind: "disk_file",
          relativePath: "notes/current.md",
          content: "frozen current body",
          dirty: false
        }
      ]
    });
    await vi.waitFor(async () => {
      expect(await firstSession.readAgentRun("run_durable_pause")).toMatchObject({
        value: { snapshot: { status: "awaiting_user_input" } }
      });
    });

    let resumedMessages: readonly Record<string, unknown>[] = [];
    let resumedSystemPrompt = "";
    const restoredSession = create({
      repository,
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          resumedMessages = input.messages;
          resumedSystemPrompt = (input as { readonly systemPrompt?: string }).systemPrompt ?? "";
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
    expect(JSON.stringify(resumedMessages)).toContain("frozen current body");
    expect(resumedSystemPrompt).toBe(initialSystemPrompt);
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

  test("rejects per-run automatic write policy even when the caller supplies acknowledgement", async () => {
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
        writePolicy: "user_preapproved_run",
        writePolicyAcknowledged: true
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_POLICY_TRUST_REQUIRED" }
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

  test.each([
    "stop",
    "length",
    "content_filter",
    "aborted",
    "error",
    "unknown",
    undefined
  ] as const)(
    "does not execute assembled tool calls when the round ends with %s",
    async (finishReason) => {
      const createSession = (applicationExports as unknown as Record<string, unknown>)[
        "createAgentRunSession"
      ] as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      };
      const runId = `run_incomplete_${finishReason ?? "missing"}`;
      let rounds = 0;
      const execute = vi.fn(async () => ({ ok: true, value: { summary: "read", data: {} } }));
      const session = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository: memoryRepository(),
        modelDriver: {
          async *streamRound() {
            rounds += 1;
            if (rounds === 1) {
              yield toolCall("incomplete-call", "read_project_text", { path: "notes.md" });
              if (finishReason !== undefined) {
                yield { type: "round_completed", finishReason };
              }
              return;
            }
            yield { type: "round_completed", finishReason: "stop" };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: { execute }
      });

      await session.startAgentRun({
        ...startCommand(),
        limits: { maxModelRounds: 2, maxToolCalls: 2, maxConsecutiveToolFailures: 2 }
      });
      await vi.waitFor(async () => {
        expect(await session.readAgentRun(runId)).toMatchObject({
          value: {
            snapshot: { status: "completed" },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_failed",
                detail: expect.objectContaining({ toolCallId: "incomplete-call" })
              })
            ])
          }
        });
      });
      expect(execute).not.toHaveBeenCalled();
    }
  );

  test("rejects truncated tool JSON before invoking the read executor", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    let rounds = 0;
    const execute = vi.fn(async () => ({ ok: true, value: { summary: "read", data: {} } }));
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_truncated_tool_json" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield {
              type: "tool_call_delta",
              toolCallId: "truncated-json",
              name: "read_project_text",
              argumentsDelta: '{"path":'
            };
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: { execute }
    });

    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 2, maxToolCalls: 2, maxConsecutiveToolFailures: 2 }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_truncated_tool_json")).toMatchObject({
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({ code: "AGENT_TOOL_ARGUMENTS_INVALID" })
            })
          ])
        }
      });
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("executes a repeated tool-call ID only once", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    let rounds = 0;
    const execute = vi.fn(async () => ({ ok: true, value: { summary: "read", data: {} } }));
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_duplicate_tool_id" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds <= 2) {
            yield toolCall("repeated-call", "read_project_text", { path: "notes.md" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: { execute }
    });

    await session.startAgentRun({
      ...startCommand(),
      limits: { maxModelRounds: 3, maxToolCalls: 3, maxConsecutiveToolFailures: 2 }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_duplicate_tool_id")).toMatchObject({
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({ code: "AGENT_TOOL_CALL_DUPLICATE" })
            })
          ])
        }
      });
    });
    expect(execute).toHaveBeenCalledTimes(1);
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

  test("fails closed when a persisted active run lacks frozen budget operands", async () => {
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
        value: {
          snapshot: { status: "failed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "run_failed",
              detail: expect.objectContaining({ code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID" })
            })
          ])
        }
      });
    });
  });

  test("approves a ready plan with manual writes and rejects public preapproval fields", async () => {
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
      error: { code: "AGENT_WRITE_POLICY_TRUST_REQUIRED" }
    });
    const rejectedProfileTransition = await session.decidePlan({
      projectId: "project-01",
      runId: planningRunId,
      commandId: "plan-cross-profile-01",
      expectedRunRevision: planning.value.snapshot["runRevision"],
      planId: "plan-01",
      planRevision: 1,
      decision: "approve",
      executionContextMode: "general_file"
    });
    expect(rejectedProfileTransition).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_REPREFLIGHT_REQUIRED" }
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
      executionContextMode: "writing"
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
        contextMode: "writing",
        writePolicy: "write_before_confirmation"
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
        contextMode: "writing",
        writePolicy: "write_before_confirmation"
      })
    ]);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun(planningRunId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
  });

  test("rejects a cross-profile execution mode before resolving the planning decision", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const session = createSession({
      scope: {
        kind: "workspace",
        workspaceKind: "engineeringWorkspace",
        workspaceId: "project-01"
      },
      coordinatorOptions: {
        createRunId: (() => {
          let runSequence = 0;
          return () => `run_engineering_plan_profile_${++runSequence}`;
        })()
      },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound(input: { readonly snapshot: { readonly operationMode: string } }) {
          if (input.snapshot.operationMode === "planning") {
            yield toolCall("finish_engineering_plan", "finish_plan", {
              planId: "engineering-plan",
              goal: "Review the implementation",
              successCriteria: ["Review completed"],
              nonGoals: [],
              facts: [],
              assumptions: [],
              openQuestions: [],
              targetRefs: [],
              steps: [{ stepId: "step-01", title: "Review", verification: "Check results" }],
              risks: [],
              verification: ["Confirm the implementation was reviewed."],
              sourceRefs: []
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
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

    await session.startAgentRun({
      ...startCommand(),
      operationMode: "planning",
      contextMode: "general_file"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_engineering_plan_profile_1")).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    const planning = (await session.readAgentRun("run_engineering_plan_profile_1")) as {
      value: { snapshot: { runRevision: number } };
    };

    expect(
      await session.decidePlan({
        projectId: "project-01",
        runId: "run_engineering_plan_profile_1",
        commandId: "approve-invalid-engineering-profile",
        expectedRunRevision: planning.value.snapshot.runRevision,
        planId: "engineering-plan",
        planRevision: 1,
        decision: "approve",
        executionContextMode: "writing"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_REPREFLIGHT_REQUIRED" } });

    expect(await session.readAgentRun("run_engineering_plan_profile_1")).toMatchObject({
      value: {
        snapshot: { status: "plan_ready" },
        events: expect.not.arrayContaining([
          expect.objectContaining({ type: "plan_decision_resolved" }),
          expect.objectContaining({ type: "run_completed" })
        ])
      }
    });
    expect(
      await session.decidePlan({
        projectId: "project-01",
        runId: "run_engineering_plan_profile_1",
        commandId: "approve-valid-engineering-profile",
        expectedRunRevision: planning.value.snapshot.runRevision,
        planId: "engineering-plan",
        planRevision: 1,
        decision: "approve",
        executionContextMode: "general_file"
      })
    ).toMatchObject({ ok: true, value: { runId: "run_engineering_plan_profile_2" } });
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
          yield* [];
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
          yield* [];
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
          yield* [];
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
          yield* [];
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
    const repository = durableMemoryRepository();
    const session = (createSession as (options: Record<string, unknown>) => unknown)({
      coordinatorOptions: { createRunId: () => "run_context_command" },
      repository,
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
      value: {
        snapshot: { activeErrorId: null, recoveryState: "none" },
        packedContextHistory: { status: "available" }
      }
    });
    const reloaded = (createSession as (options: Record<string, unknown>) => unknown)({
      repository,
      contextSourceReader: {
        async readCurrentSources() {
          throw new Error("reload must use the frozen prompt artifact, not current files");
        }
      },
      modelDriver: {
        async *streamRound() {
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          throw new Error("unused while reading historical context");
        }
      }
    }) as { readAgentRun(runId: string): Promise<Record<string, unknown>> };
    expect(await reloaded.readAgentRun(runId)).toMatchObject({
      ok: true,
      value: { packedContextHistory: { status: "available" } }
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
              message["role"] === "user" &&
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
      role: "user",
      content: expect.stringContaining('"kind":"untrusted_conversation_data"')
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
    repository = durableMemoryRepository(),
    diagnostics?: Record<string, unknown>
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
      ...(diagnostics === undefined ? {} : { diagnostics }),
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

  test("preserves an unowned preflight error without recording a diagnostic", async () => {
    const recordPreflightError = vi.fn(async () => ({
      ok: false,
      error: {
        code: "AGENT_DIAGNOSTIC_OWNER_REQUIRED",
        message: "A diagnostic must be bound to a run draft."
      }
    }));
    const session = createStartSession(
      {
        async resolveStart() {
          return {
            ok: false,
            error: {
              code: "AGENT_PREFLIGHT_TEST_FAILURE",
              message: "The internal preflight failed."
            }
          };
        }
      },
      "run_unowned_preflight",
      durableMemoryRepository(),
      { recordPreflightError }
    );

    expect(
      await session.startAgentRun({
        projectId: "project-01",
        conversationId: "conv-unowned-preflight",
        commandId: "start-unowned-preflight",
        expectedRunRevision: 0
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_PREFLIGHT_TEST_FAILURE" } });
    expect(recordPreflightError).not.toHaveBeenCalled();
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
    expect(captured.systemPrompt).toContain("foreshadow v1.0");
    expect(captured.systemPrompt).toContain("fsh_");
    expect(captured.systemPrompt).toContain("trackingStatus");
    expect(captured.systemPrompt).toContain("actualPayoffChapterId");
    expect(captured.systemPrompt).toContain("Change Set");
    expect(captured.systemPrompt).toContain("应用成功");
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
    expect(guidance?.["refId"]).toBe("system_guidance:writing@2.1");
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
    expect(captured.systemPrompt).not.toContain("fsh_");
    expect(captured.systemPrompt).not.toContain("trackingStatus");

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
    expect(version).toBe("2.1");
    if (typeof build !== "function" || typeof estimate !== "function") return;

    const writing = (build as (mode: string) => string)("writing");
    const general = (build as (mode: string) => string)("general_file");
    const standalone = (build as (mode: string) => string)("standalone_chat");
    expect(writing).not.toEqual(general);
    expect(writing).toContain("文风规则");
    expect(general).not.toContain("文风规则");
    expect(standalone).toContain("未绑定");
    expect(standalone).not.toContain("fsh_");

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
describe("AgentRunSession JIT context sharing approvals", () => {
  function sharingHarness(input: {
    readonly runId: string;
    readonly policy: "ask" | "deny";
    readonly repository?: Record<string, unknown>;
  }) {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideContextShareApproval(
        command: Record<string, unknown>
      ): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const defaultsResult = freezeWorkspaceModelSharingDefaults({
      workspaceBindingId: "workspace_binding_1",
      defaults: {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "ask",
        toolReadResults: input.policy
      }
    });
    if (!defaultsResult.ok) throw defaultsResult.error;
    const defaults = defaultsResult.value;
    const grantResult = freezeRunModelSharingGrant({
      profileId: "writing",
      workspaceBindingId: defaults.workspaceBindingId,
      grant: {
        runDraftRevision: "1",
        defaultsRevision: defaults.defaultsRevision,
        includedRefIds: [],
        excludedRefIds: [],
        approvedResultKinds: []
      }
    });
    if (!grantResult.ok) throw grantResult.error;
    let grant: FrozenRunModelSharingGrant = grantResult.value;
    let boundary = {
      ...testCapabilityBoundary(),
      sharingDefaultsRevision: defaults.defaultsRevision,
      sharingGrantRevision: grant.grantRevision
    };
    let rounds = 0;
    let reads = 0;
    const repository = input.repository ?? durableMemoryRepository();
    const options = {
      coordinatorOptions: { createRunId: () => input.runId },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      getCurrentCapabilityBoundary: () => boundary,
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("sharing-read-1", "read_resource", {
              ref: "chapter:chapter-01"
            });
            yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
            return;
          }
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          reads += 1;
          return { ok: true as const, value: { summary: "read", data: { text: "body" } } };
        }
      },
      contextSharing: {
        async readForRun() {
          return { ok: true as const, value: { defaults, grant } };
        },
        async updateGrant(update: {
          readonly priorGrantRevision: string;
          readonly grant: FrozenRunModelSharingGrant;
        }) {
          if (update.priorGrantRevision !== grant.grantRevision) {
            return {
              ok: false as const,
              error: testRepositoryError("AGENT_MODEL_SHARING_GRANT_STALE")
            };
          }
          grant = update.grant;
          boundary = { ...boundary, sharingGrantRevision: grant.grantRevision };
          return { ok: true as const, value: grant };
        }
      }
    };
    return {
      createSession: () => createSession(options),
      repository,
      reads: () => reads,
      grant: () => grant
    };
  }

  test("persists ask before reading, hydrates it, approves the grant, and replays exactly once", async () => {
    const harness = sharingHarness({ runId: "run_context_share_approve", policy: "ask" });
    const original = harness.createSession();
    expect(await original.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await original.readAgentRun("run_context_share_approve")).toMatchObject({
        value: {
          snapshot: {
            schemaVersion: "2.0",
            status: "awaiting_context_share_approval",
            pending: { kind: "context_share_approval", requestId: expect.any(String) }
          },
          pendingContextShareApproval: {
            resultKind: "read_resource",
            toolCallId: "sharing-read-1"
          }
        }
      });
    });
    expect(harness.reads()).toBe(0);

    const restored = harness.createSession();
    const pending = (await restored.readAgentRun("run_context_share_approve"))["value"] as {
      readonly snapshot: {
        readonly runRevision: number;
        readonly pending: { readonly requestId: string };
      };
      readonly pendingContextShareApproval: { readonly approvalBinding: string };
    };
    expect(
      await restored.decideContextShareApproval({
        projectId: "project-01",
        runId: "run_context_share_approve",
        commandId: "approve-context-share-1",
        expectedRunRevision: pending.snapshot.runRevision,
        requestId: pending.snapshot.pending.requestId,
        approvalBinding: pending.pendingContextShareApproval.approvalBinding,
        decision: "approve"
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await restored.readAgentRun("run_context_share_approve")).toMatchObject({
        value: {
          snapshot: { status: "blocked" },
          events: expect.arrayContaining([
            expect.objectContaining({ type: "context_share_approval_requested" }),
            expect.objectContaining({ type: "context_share_approval_resolved" }),
            expect.objectContaining({ type: "tool_completed" })
          ])
        }
      });
    });
    expect(harness.reads()).toBe(1);
    expect(harness.grant().approvedResultKinds).toEqual(["read_resource"]);

    // The old prompt-cache artifact is auditable but safely bypassed after the grant revision moves.
    await expect(
      harness.createSession().readAgentRun("run_context_share_approve")
    ).resolves.toMatchObject({
      ok: true,
      value: { snapshot: { status: "blocked" } }
    });
  });

  test("turns a denied ask into a safe tool error without invoking the reader", async () => {
    const harness = sharingHarness({ runId: "run_context_share_reject", policy: "ask" });
    const session = harness.createSession();
    await session.startAgentRun(startCommand());
    let pending!: {
      snapshot: { runRevision: number; pending: { requestId: string } };
      pendingContextShareApproval: { approvalBinding: string };
    };
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run_context_share_reject");
      expect(read).toMatchObject({
        value: { snapshot: { status: "awaiting_context_share_approval" } }
      });
      pending = read["value"] as typeof pending;
    });
    await session.decideContextShareApproval({
      projectId: "project-01",
      runId: "run_context_share_reject",
      commandId: "deny-context-share-1",
      expectedRunRevision: pending.snapshot.runRevision,
      requestId: pending.snapshot.pending.requestId,
      approvalBinding: pending.pendingContextShareApproval.approvalBinding,
      decision: "deny"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_share_reject")).toMatchObject({
        value: {
          snapshot: { status: "blocked" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({ code: "AGENT_MODEL_SHARING_APPROVAL_DENIED" })
            })
          ])
        }
      });
    });
    expect(harness.reads()).toBe(0);
  });

  test("rolls back the widened grant when approval event persistence fails", async () => {
    const durable = durableMemoryRepository();
    let rejectedResolutionAttempts = 0;
    const repository = {
      ...durable,
      async commitRunStateV20(input: {
        readonly snapshot: AgentRunSnapshotV20;
        readonly event: AgentRunEventV20;
      }) {
        if (
          rejectedResolutionAttempts < 2 &&
          input.event.type === "context_share_approval_resolved"
        ) {
          rejectedResolutionAttempts += 1;
          return {
            ok: false as const,
            error: testRepositoryError("AGENT_RUN_STORE_UNAVAILABLE")
          };
        }
        return durable.commitRunStateV20(input);
      }
    };
    const harness = sharingHarness({
      runId: "run_context_share_persist_retry",
      policy: "ask",
      repository
    });
    const initialGrantRevision = harness.grant().grantRevision;
    const session = harness.createSession();
    await session.startAgentRun(startCommand());
    let pending!: {
      snapshot: { runRevision: number; pending: { requestId: string } };
      pendingContextShareApproval: { approvalBinding: string };
    };
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run_context_share_persist_retry");
      expect(read).toMatchObject({
        value: { snapshot: { status: "awaiting_context_share_approval" } }
      });
      pending = read["value"] as typeof pending;
    });
    await expect(
      session.decideContextShareApproval({
        projectId: "project-01",
        runId: "run_context_share_persist_retry",
        commandId: "approve-context-share-persist-fails",
        expectedRunRevision: pending.snapshot.runRevision,
        requestId: pending.snapshot.pending.requestId,
        approvalBinding: pending.pendingContextShareApproval.approvalBinding,
        decision: "approve"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_RUN_PERSIST_FAILED" } });
    expect(harness.grant().grantRevision).toBe(initialGrantRevision);
    expect(harness.reads()).toBe(0);

    // Durable state is still pending, so a fresh session can safely retry the same bound decision.
    const recovered = harness.createSession();
    const durablePending = (await recovered.readAgentRun("run_context_share_persist_retry"))[
      "value"
    ] as typeof pending;
    expect(
      await recovered.decideContextShareApproval({
        projectId: "project-01",
        runId: "run_context_share_persist_retry",
        commandId: "approve-context-share-persist-retry",
        expectedRunRevision: durablePending.snapshot.runRevision,
        requestId: durablePending.snapshot.pending.requestId,
        approvalBinding: durablePending.pendingContextShareApproval.approvalBinding,
        decision: "approve"
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(harness.reads()).toBe(1));
  });

  test("fails closed under deny without creating a JIT request or reading", async () => {
    const harness = sharingHarness({ runId: "run_context_share_policy_deny", policy: "deny" });
    const session = harness.createSession();
    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_context_share_policy_deny")).toMatchObject({
        value: {
          snapshot: { status: "blocked" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({ code: "AGENT_MODEL_SHARING_READ_DENIED" })
            })
          ])
        }
      });
    });
    expect(harness.reads()).toBe(0);
  });
});

describe("AgentRunSession effectful tool approvals", () => {
  test("holds a task launch until a durable approval and launches its binding only once", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideToolApproval(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    let rounds = 0;
    let launches = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_task_approval" },
      repository: memoryRepository(),
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: true,
        sandboxAttestationId: "attestation_01",
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "test-1"
      },
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("task-call-1", "run_project_task", {
              taskId: "task_lint",
              parameters: { fix: false }
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      taskApprovalResolver: {
        async prepare(input: Record<string, unknown>) {
          const digest = createHash("sha256")
            .update(JSON.stringify(input["parameters"]), "utf8")
            .digest("hex");
          return {
            ok: true,
            value: {
              kind: "task",
              bindingId: "task-binding-1",
              runId: input["runId"],
              runRevision: input["runRevision"],
              toolCallId: input["toolCallId"],
              taskId: input["taskId"],
              snapshotDigest: "snapshot-digest",
              parametersDigest: digest,
              catalogRevision: "catalog-1",
              attestationRef: "attestation_01",
              executionSnapshotId: "execution-snapshot-1",
              effectiveCapabilityRevision: input["effectiveCapabilityRevision"],
              expiresAt: "2030-01-01T00:00:00.000Z"
            }
          };
        },
        async validate() {
          return {
            ok: true,
            value: {
              attestationId: "attestation_01",
              executionSnapshotId: "execution-snapshot-1"
            }
          };
        }
      },
      taskSandboxPort: {
        async launch(input: Record<string, unknown>) {
          launches += 1;
          expect(input).toMatchObject({
            taskId: "task_lint",
            attestationId: "attestation_01",
            executionSnapshotId: "execution-snapshot-1"
          });
          return {
            ok: true,
            value: {
              exitCode: 0,
              stdoutSummary: "ok",
              stderrSummary: "",
              truncated: false,
              durationMs: 4,
              terminationReason: "completed"
            }
          };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_task_approval")).toMatchObject({
        value: {
          snapshot: {
            status: "awaiting_tool_approval",
            pendingToolApproval: { binding: { bindingId: "task-binding-1" } }
          }
        }
      });
    });
    expect(launches).toBe(0);
    const beforeApproval = await session.readAgentRun("run_task_approval");
    const revision = (beforeApproval["value"] as { snapshot: { runRevision: number } }).snapshot
      .runRevision;
    const decision = {
      projectId: "project-01",
      runId: "run_task_approval",
      commandId: "approve-task-1",
      expectedRunRevision: revision,
      bindingId: "task-binding-1",
      decision: "approve"
    };
    const first = await session.decideToolApproval(decision);
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_task_approval")).toMatchObject({
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(launches).toBe(1);
    expect(await session.decideToolApproval(decision)).toEqual(first);
    expect(launches).toBe(1);
  });

  test("uses provider names for external dispatch, requires approval, and pauses outcome_unknown", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideToolApproval(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      resumeAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const calls: Record<string, unknown>[] = [];
    const externalToolBase: Omit<AgentToolDescriptor, "descriptorDigest"> = {
      id: "plugin:acme/send",
      name: "plugin__acme__send",
      providerName: "plugin__acme__send",
      displayName: "Send",
      description: "Send a remote message.",
      kind: "external_tool" as const,
      effect: "external_action" as const,
      dataEgress: "remote_tool_arguments" as const,
      destructive: false,
      retrySemantics: "idempotency_key_required" as const,
      source: { kind: "plugin" as const, id: "acme" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: { message: { type: "string", minLength: 1, maxLength: 100 } }
      }
    };
    const externalTool = {
      ...externalToolBase,
      descriptorDigest: computeAgentToolDescriptorDigest(externalToolBase)
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_external_approval" },
      repository: memoryRepository(),
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: true,
        mcpToolsEnabled: false,
        featureFlagRevision: "test-1"
      },
      externalToolDescriptors: [externalTool],
      modelDriver: {
        async *streamRound() {
          yield toolCall("external-call-1", "plugin__acme__send", { message: "hello" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      externalToolExecutor: {
        async callTool(input: Record<string, unknown>) {
          calls.push(input);
          return { ok: true, value: { status: "outcome_unknown", reason: "connection reset" } };
        }
      }
    });

    // The caller's descriptor object is no longer authoritative after session construction.
    // A nested schema mutation would reject this short message if the session re-read it per round.
    (
      (externalTool.inputSchema["properties"] as Record<string, unknown>)["message"] as {
        minLength: number;
      }
    ).minLength = 99;

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_external_approval")).toMatchObject({
        value: { snapshot: { status: "awaiting_tool_approval" } }
      });
    });
    expect(calls).toEqual([]);
    const pendingRead = await session.readAgentRun("run_external_approval");
    const pendingSnapshot = (
      pendingRead["value"] as {
        snapshot: { runRevision: number; pendingToolApproval: { binding: { bindingId: string } } };
      }
    ).snapshot;
    expect(
      await session.resumeAgentRun({
        projectId: "project-01",
        runId: "run_external_approval",
        commandId: "resume-before-approval",
        expectedRunRevision: pendingSnapshot.runRevision
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_TOOL_APPROVAL_DECISION_REQUIRED" } });
    await session.decideToolApproval({
      projectId: "project-01",
      runId: "run_external_approval",
      commandId: "approve-external-1",
      expectedRunRevision: pendingSnapshot.runRevision,
      bindingId: pendingSnapshot.pendingToolApproval.binding.bindingId,
      decision: "approve"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_external_approval")).toMatchObject({
        value: { snapshot: { status: "awaiting_external_outcome_resolution" } }
      });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      canonicalToolId: "plugin:acme/send",
      idempotencyKey: expect.stringContaining("external-call-1")
    });
    const afterDispatch = await session.readAgentRun("run_external_approval");
    const started = (
      afterDispatch["value"] as {
        events: readonly { readonly type: string; readonly detail?: Record<string, unknown> }[];
      }
    ).events.find((event) => event.type === "tool_started");
    expect(started?.detail).toMatchObject({
      approvalBindingId: pendingSnapshot.pendingToolApproval.binding.bindingId,
      approvalBindingKind: "external",
      idempotencyKey: expect.stringContaining("external-call-1")
    });
  });

  test("auto-approves a structured web_search through the durable approval boundary", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const persistedEventTypes: string[] = [];
    const repository = {
      ...memoryRepository(),
      async appendEvent(event: Record<string, unknown>) {
        persistedEventTypes.push(String(event["type"]));
        return { ok: true, value: event };
      }
    };
    let rounds = 0;
    let searches = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_auto_search_approval" },
      repository,
      dataEgressPolicy: "auto_approve_search_queries",
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: true,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "test-1"
      },
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("auto-search-call-1", "web_search", { query: "agent runtime" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("auto-search-finish-1", "finish", { summary: "done" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      networkToolExecutor: {
        async webSearch() {
          searches += 1;
          expect(persistedEventTypes.at(-1)).toBe("tool_started");
          return { ok: true, value: networkReadResult() };
        },
        async fetchUrl() {
          throw new Error("fetch_url should not run");
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_auto_search_approval")).toMatchObject({
        value: { snapshot: { status: "completed", pendingToolApproval: null } }
      });
    });
    expect(searches).toBe(1);
    const read = await session.readAgentRun("run_auto_search_approval");
    const events = (
      read["value"] as {
        events: readonly { readonly type: string; readonly detail?: Record<string, unknown> }[];
      }
    ).events;
    const requested = events.find((event) => event.type === "tool_approval_requested");
    const resolved = events.find((event) => event.type === "tool_approval_resolved");
    const started = events.find(
      (event) =>
        event.type === "tool_started" && event.detail?.["toolCallId"] === "auto-search-call-1"
    );
    expect(requested?.detail).toMatchObject({
      canonicalToolId: "web_search",
      binding: { kind: "network", requestDigest: expect.any(String) }
    });
    expect(resolved?.detail).toMatchObject({
      canonicalToolId: "web_search",
      bindingId: (requested?.detail?.["binding"] as Record<string, unknown>)["bindingId"],
      decision: "approve"
    });
    expect(started?.detail).toMatchObject({
      approvalBindingId: (requested?.detail?.["binding"] as Record<string, unknown>)["bindingId"],
      approvalBindingKind: "network",
      requestDigest: expect.any(String)
    });
    const requestedIndex = events.findIndex((event) => event.type === "tool_approval_requested");
    const resolvedIndex = events.findIndex((event) => event.type === "tool_approval_resolved");
    const startedIndex = events.findIndex(
      (event) =>
        event.type === "tool_started" && event.detail?.["toolCallId"] === "auto-search-call-1"
    );
    expect(requestedIndex).toBeGreaterThanOrEqual(0);
    expect(resolvedIndex).toBeGreaterThan(requestedIndex);
    expect(startedIndex).toBeGreaterThan(resolvedIndex);
  });

  test("keeps fetch_url behind manual approval when search queries are auto-approved", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideToolApproval(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    let rounds = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_network_approval" },
      repository: memoryRepository(),
      dataEgressPolicy: "auto_approve_search_queries",
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: true,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "test-1"
      },
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("network-call-1", "fetch_url", {
              url: "https://example.test/article"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("network-finish-1", "finish", { summary: "done" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      networkToolExecutor: {
        async webSearch() {
          return {
            ok: true,
            value: {
              kind: "untrusted_remote_data" as const,
              url: "https://search.example.test/?q=agent",
              fetchedAt: "2026-07-25T00:00:00.000Z",
              contentDigest: "a".repeat(64),
              contentSummary: "empty",
              truncated: false,
              sourceLabel: "search"
            }
          };
        },
        async fetchUrl() {
          return {
            ok: true,
            value: {
              kind: "untrusted_remote_data" as const,
              url: "https://example.test/",
              fetchedAt: "2026-07-25T00:00:00.000Z",
              contentDigest: "b".repeat(64),
              contentSummary: "empty",
              truncated: false,
              sourceLabel: "url"
            }
          };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_network_approval")).toMatchObject({
        value: {
          snapshot: {
            status: "awaiting_tool_approval",
            pendingToolApproval: { binding: { kind: "network" } }
          }
        }
      });
    });
    const pending = await session.readAgentRun("run_network_approval");
    const pendingSnapshot = (
      pending["value"] as {
        snapshot: { runRevision: number; pendingToolApproval: { binding: { bindingId: string } } };
      }
    ).snapshot;
    await session.decideToolApproval({
      projectId: "project-01",
      runId: "run_network_approval",
      commandId: "approve-network-1",
      expectedRunRevision: pendingSnapshot.runRevision,
      bindingId: pendingSnapshot.pendingToolApproval.binding.bindingId,
      decision: "approve"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_network_approval")).toMatchObject({
        value: { snapshot: { status: "completed" } }
      });
    });
    const read = await session.readAgentRun("run_network_approval");
    const started = (
      read["value"] as {
        events: readonly { readonly type: string; readonly detail?: Record<string, unknown> }[];
      }
    ).events.find(
      (event) => event.type === "tool_started" && event.detail?.["toolCallId"] === "network-call-1"
    );
    expect(started?.detail).toMatchObject({
      approvalBindingId: pendingSnapshot.pendingToolApproval.binding.bindingId,
      approvalBindingKind: "network",
      requestDigest: expect.any(String)
    });
  });

  test.each([
    { kind: "network" as const, runId: "run_network_started_persist_failure" },
    { kind: "external" as const, runId: "run_external_started_persist_failure" }
  ])(
    "does not launch a $kind tool when its durable tool_started event cannot persist",
    async ({ kind, runId }) => {
      const createSession = (applicationExports as unknown as Record<string, unknown>)[
        "createAgentRunSession"
      ] as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        decideToolApproval(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      };
      let launches = 0;
      let rejectLaunchEvent = false;
      const externalToolBase: Omit<AgentToolDescriptor, "descriptorDigest"> = {
        id: "mcp:trusted/read_status",
        name: "mcp__trusted__read_status",
        providerName: "mcp__trusted__read_status",
        displayName: "Read status",
        description: "Read remote status.",
        kind: "external_tool",
        effect: "external_read",
        dataEgress: "remote_tool_arguments",
        destructive: false,
        retrySemantics: "never_automatic",
        source: { kind: "mcp", id: "trusted" },
        inputSchema: { type: "object", additionalProperties: false }
      };
      const externalTool = {
        ...externalToolBase,
        descriptorDigest: computeAgentToolDescriptorDigest(externalToolBase)
      };
      const repository = {
        ...memoryRepository(),
        async appendEvent(event: Record<string, unknown>) {
          if (rejectLaunchEvent && event["type"] === "tool_started") {
            return {
              ok: false,
              error: {
                code: "AGENT_RUN_STORE_UNAVAILABLE",
                message: "tool_started persistence failed"
              }
            };
          }
          return { ok: true, value: event };
        }
      };
      const session = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository,
        capabilitySnapshot: {
          workspaceKind: "engineeringWorkspace",
          searchEnabled: false,
          fileLifecycleEnabled: false,
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: kind === "network",
          pluginToolsEnabled: false,
          mcpToolsEnabled: kind === "external",
          featureFlagRevision: "test-1"
        },
        ...(kind === "external"
          ? {
              dataEgressPolicy: "auto_approve_search_queries",
              externalToolDescriptors: [externalTool]
            }
          : {}),
        modelDriver: {
          async *streamRound() {
            yield toolCall(
              "effectful-call-1",
              kind === "network" ? "web_search" : "mcp__trusted__read_status",
              kind === "network" ? { query: "status" } : {}
            );
            yield { type: "round_completed", finishReason: "tool_calls" };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: {
          async execute() {
            return { ok: true, value: { summary: "unused", data: {} } };
          }
        },
        ...(kind === "network"
          ? {
              networkToolExecutor: {
                async webSearch() {
                  launches += 1;
                  return { ok: true, value: networkReadResult() };
                },
                async fetchUrl() {
                  launches += 1;
                  return { ok: true, value: networkReadResult() };
                }
              }
            }
          : {
              externalToolExecutor: {
                async callTool() {
                  launches += 1;
                  return { ok: true, value: { status: "completed", result: {} } };
                }
              }
            })
      });

      await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
      await vi.waitFor(async () => {
        expect(await session.readAgentRun(runId)).toMatchObject({
          value: { snapshot: { status: "awaiting_tool_approval" } }
        });
      });
      const pending = await session.readAgentRun(runId);
      const snapshot = (
        pending["value"] as {
          snapshot: {
            runRevision: number;
            pendingToolApproval: { binding: { bindingId: string } };
          };
        }
      ).snapshot;
      rejectLaunchEvent = true;

      expect(
        await session.decideToolApproval({
          projectId: "project-01",
          runId,
          commandId: `approve-${kind}-persist-failure`,
          expectedRunRevision: snapshot.runRevision,
          bindingId: snapshot.pendingToolApproval.binding.bindingId,
          decision: "approve"
        })
      ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_PERSIST_FAILED" } });
      expect(launches).toBe(0);
    }
  );

  test("hydrates an interrupted effectful external launch as outcome_unknown", async () => {
    const createSession = (applicationExports as unknown as Record<string, unknown>)[
      "createAgentRunSession"
    ] as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideToolApproval(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };
    const descriptorBase: Omit<AgentToolDescriptor, "descriptorDigest"> = {
      id: "mcp:trusted/send_message",
      name: "mcp__trusted__send_message",
      providerName: "mcp__trusted__send_message",
      displayName: "Send message",
      description: "Send a message to the trusted remote MCP server.",
      kind: "external_tool" as const,
      effect: "external_action" as const,
      dataEgress: "remote_tool_arguments" as const,
      destructive: false,
      retrySemantics: "never_automatic" as const,
      source: { kind: "mcp" as const, id: "trusted" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: { message: { type: "string", minLength: 1, maxLength: 100 } }
      }
    };
    const descriptor = {
      ...descriptorBase,
      descriptorDigest: computeAgentToolDescriptorDigest(descriptorBase)
    };
    const repository = durableMemoryRepository();
    let externalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      externalStarted = resolve;
    });
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_external_recovery" },
      repository,
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: true,
        featureFlagRevision: "test-1"
      },
      externalToolDescriptors: [descriptor],
      modelDriver: {
        async *streamRound() {
          yield toolCall("recovery-call-1", "mcp__trusted__send_message", { message: "hello" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      externalToolExecutor: {
        async callTool() {
          externalStarted?.();
          return new Promise<never>(() => undefined);
        }
      }
    });
    await original.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      expect(await original.readAgentRun("run_external_recovery")).toMatchObject({
        value: { snapshot: { status: "awaiting_tool_approval" } }
      });
    });
    const pending = await original.readAgentRun("run_external_recovery");
    const pendingSnapshot = (
      pending["value"] as {
        snapshot: { runRevision: number; pendingToolApproval: { binding: { bindingId: string } } };
      }
    ).snapshot;
    void original.decideToolApproval({
      projectId: "project-01",
      runId: "run_external_recovery",
      commandId: "approve-recovery-1",
      expectedRunRevision: pendingSnapshot.runRevision,
      bindingId: pendingSnapshot.pendingToolApproval.binding.bindingId,
      decision: "approve"
    });
    await started;

    const recovered = createSession({
      coordinatorOptions: { createRunId: () => "unused-recovery-id" },
      repository,
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: true,
        featureFlagRevision: "test-1"
      },
      externalToolDescriptors: [descriptor],
      modelDriver: { async *streamRound() {} },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return { ok: true, value: { summary: "unused", data: {} } };
        }
      },
      externalToolExecutor: {
        async callTool() {
          throw new Error("recovered session must not replay an external action");
        }
      }
    });
    const hydrated = await recovered.readAgentRun("run_external_recovery");
    expect(hydrated).toMatchObject({
      ok: true,
      value: {
        snapshot: { status: "awaiting_external_outcome_resolution" },
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "external_outcome_unknown",
            detail: expect.objectContaining({
              approvalBindingId: pendingSnapshot.pendingToolApproval.binding.bindingId
            })
          })
        ])
      }
    });
  });
});

describe("AgentRunSession v2 tool facade", () => {
  const createSession = (applicationExports as unknown as Record<string, unknown>)[
    "createAgentRunSession"
  ] as (options: Record<string, unknown>) => {
    startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    invalidateAgentRunCapabilities(
      command: Record<string, unknown>
    ): Promise<Record<string, unknown>>;
    readAgentRun(runId: string): Promise<Record<string, unknown>>;
    resumeAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    retryRunTarget(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  };

  const readExecutor = {
    async execute() {
      return { ok: true, value: { summary: "ok", data: {} } };
    }
  };

  test("persists a strict completed finish report for a Guidance 3.0 run", async () => {
    const repository = durableMemoryRepository();
    let rounds = 0;
    let verificationRef: string | undefined;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_finish_completed" },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("finish-evidence-read", "read_resource", { ref: "chapter:chapter-01" });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          const toolMessage = [...input.messages]
            .reverse()
            .find(
              (message) =>
                message["role"] === "tool" && message["toolCallId"] === "finish-evidence-read"
            );
          const toolPayload = JSON.parse(String(toolMessage?.["content"] ?? "{}")) as {
            readonly evidenceRefs?: readonly string[];
          };
          verificationRef = toolPayload.evidenceRefs?.[0];
          if (verificationRef === undefined)
            throw new Error("missing app-authored finish evidence");
          yield toolCall("finish-completed", "finish", {
            outcome: "completed",
            report: {
              result: "The requested checks are complete.",
              appliedChanges: [],
              verification: [verificationRef],
              residualRisks: []
            },
            evidenceRefs: [verificationRef]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_finish_completed")).toMatchObject({
        value: {
          snapshot: {
            status: "completed",
            finishReport: {
              schemaVersion: "2.0",
              outcome: "completed",
              evidenceRefs: [verificationRef]
            }
          },
          events: expect.arrayContaining([expect.objectContaining({ type: "run_completed" })])
        }
      });
    });
    expect(verificationRef).toMatch(
      /^run-event\/[1-9][0-9]*\/tool_completed\/finish-evidence-read$/u
    );
  });

  test("persists a blocked finish report and keeps the run terminal", async () => {
    const repository = durableMemoryRepository();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_finish_blocked" },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_finish_blocked")).toMatchObject({
        value: {
          snapshot: {
            status: "blocked",
            finishReport: {
              schemaVersion: "2.0",
              outcome: "blocked",
              report: { nextStep: expect.any(String) }
            }
          },
          events: expect.arrayContaining([expect.objectContaining({ type: "run_blocked" })])
        }
      });
    });
  });

  test("allows a model to finish blocked with the canonical failed-tool evidence", async () => {
    const repository = durableMemoryRepository();
    let rounds = 0;
    let failureRef: string | undefined;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_finish_blocked_after_failure" },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly Record<string, unknown>[] }) {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("blocked-read-failure", "read_resource", {
              ref: "chapter:missing-chapter"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          const toolMessage = [...input.messages]
            .reverse()
            .find(
              (message) =>
                message["role"] === "tool" && message["toolCallId"] === "blocked-read-failure"
            );
          const toolPayload = JSON.parse(String(toolMessage?.["content"] ?? "{}")) as {
            readonly evidenceRefs?: readonly string[];
          };
          failureRef = toolPayload.evidenceRefs?.[0];
          if (failureRef === undefined) throw new Error("missing failed-tool evidence reference");
          yield toolCall("finish-blocked-after-failure", "finish", {
            outcome: "blocked",
            report: {
              result: "The required chapter could not be read.",
              appliedChanges: [],
              verification: ["not-run: the required source read failed"],
              residualRisks: ["The requested conclusion could not be verified."],
              nextStep: "Restore the missing chapter and resume in a new run."
            },
            evidenceRefs: [failureRef]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          return {
            ok: false as const,
            error: {
              errorId: "error_blocked_read_failure",
              code: "AGENT_READ_FAILED",
              category: "StorageError",
              message: "The chapter does not exist.",
              recoverability: "retryable",
              suggestedAction: "Restore the chapter.",
              traceId: "test",
              timestamp: "2026-08-04T00:00:00.000Z"
            }
          };
        }
      }
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_finish_blocked_after_failure")).toMatchObject({
        value: {
          snapshot: { status: "blocked", finishReport: { outcome: "blocked" } },
          events: expect.arrayContaining([
            expect.objectContaining({ type: "tool_failed" }),
            expect.objectContaining({ type: "run_blocked" })
          ])
        }
      });
    });
    expect(failureRef).toMatch(/^run-event\/[1-9][0-9]*\/tool_failed\/blocked-read-failure$/u);
  });

  test("authors blocked completion when a v2 model round stops without finish", async () => {
    const repository = durableMemoryRepository();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_finish_missing" },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield { type: "assistant_text_delta", delta: "Partial answer only." };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_finish_missing")).toMatchObject({
        value: {
          snapshot: {
            status: "blocked",
            finishReport: {
              schemaVersion: "2.0",
              outcome: "blocked",
              report: {
                result: "Partial answer only.",
                nextStep: expect.any(String)
              }
            }
          },
          events: expect.arrayContaining([expect.objectContaining({ type: "run_blocked" })])
        }
      });
    });
  });

  test("reconciles a transient strict state commit failure before a run is hydrated", async () => {
    const durable = durableMemoryRepository();
    let rejectedTerminalSnapshot = false;
    const repository = {
      ...durable,
      async commitRunStateV20(input: {
        readonly snapshot: AgentRunSnapshotV20;
        readonly event: AgentRunEventV20;
      }) {
        if (input.snapshot.status === "blocked" && !rejectedTerminalSnapshot) {
          rejectedTerminalSnapshot = true;
          return {
            ok: false as const,
            error: {
              ...testRepositoryError("TEST_TERMINAL_STATE_COMMIT_FAILED"),
              message: "transient terminal snapshot failure",
              recoverability: "retryable" as const
            }
          };
        }
        return durable.commitRunStateV20(input);
      }
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_finish_reconcile" },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_finish_reconcile")).toMatchObject({
        value: { snapshot: { status: "blocked" } }
      });
    });
    expect(rejectedTerminalSnapshot).toBe(true);

    const restored = createSession({
      repository: durable,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        streamRound: () => unexpectedModelRound("A terminal run must not restart the model.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    await expect(restored.readAgentRun("run_v2_finish_reconcile")).resolves.toMatchObject({
      ok: true,
      value: { snapshot: { status: "blocked", finishReport: { outcome: "blocked" } } }
    });
  });

  test.each([
    {
      name: "model-round",
      limits: { maxModelRounds: 1, maxToolCalls: 4, maxConsecutiveToolFailures: 2 },
      expectedLimit: "maxModelRounds",
      expectedRestoredProviderCalls: 0
    },
    {
      name: "tool-call",
      limits: { maxModelRounds: 2, maxToolCalls: 1, maxConsecutiveToolFailures: 2 },
      expectedLimit: "maxToolCalls",
      expectedRestoredProviderCalls: 1
    }
  ])(
    "restores strict V20 pending input and the $name counter before resuming",
    async ({ name, limits, expectedLimit, expectedRestoredProviderCalls }) => {
      const repository = durableMemoryRepository();
      const runId = `run_v2_counter_${name.replace("-", "_")}`;
      const original = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository,
        newRunToolFacadeVersion: "v2",
        agentGuidanceV3: true,
        capabilitySnapshot: creativeV2Capabilities(),
        modelDriver: {
          async *streamRound() {
            yield toolCall(`question-${name}`, "request_user_input", {
              questionId: `question_${name.replace("-", "_")}`,
              prompt: "Continue after restart?",
              reason: "The durable pending boundary is under test.",
              options: [
                { id: "continue", label: "Continue" },
                { id: "stop", label: "Stop" }
              ]
            });
            yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: readExecutor
      });
      expect(
        await original.startAgentRun({
          ...startCommand(),
          commandId: `start-v2-counter-${name}`,
          limits
        })
      ).toMatchObject({ ok: true, value: { schemaVersion: "2.0", runId } });
      await vi.waitFor(async () => {
        expect(await original.readAgentRun(runId)).toMatchObject({
          value: { snapshot: { status: "awaiting_user_input" } }
        });
      });

      let restoredProviderCalls = 0;
      let restoredReadCalls = 0;
      const restored = createSession({
        repository,
        newRunToolFacadeVersion: "v2",
        agentGuidanceV3: true,
        capabilitySnapshot: creativeV2Capabilities(),
        modelDriver: {
          async *streamRound() {
            restoredProviderCalls += 1;
            yield toolCall(`read-after-${name}`, "read_resource", {
              ref: "chapter:chapter-01"
            });
            yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: {
          async execute() {
            restoredReadCalls += 1;
            return { ok: true, value: { summary: "unexpected", data: {} } };
          }
        }
      });
      const hydrated = (await restored.readAgentRun(runId)) as {
        readonly value: {
          readonly snapshot: { readonly runRevision: number };
          readonly pendingUserInput: { readonly questionId: string };
        };
      };
      expect(hydrated).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_user_input" },
          pendingUserInput: { questionId: `question_${name.replace("-", "_")}` }
        }
      });
      expect(
        await restored.answerUserInput({
          projectId: "project-01",
          runId,
          commandId: `answer-v2-counter-${name}`,
          expectedRunRevision: hydrated.value.snapshot.runRevision,
          questionId: hydrated.value.pendingUserInput.questionId,
          answer: "Continue."
        })
      ).toMatchObject({ ok: true });
      await vi.waitFor(async () => {
        expect(await restored.readAgentRun(runId)).toMatchObject({
          value: {
            snapshot: { status: "limit_reached" },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "run_limit_reached",
                detail: expect.objectContaining({ limit: expectedLimit })
              })
            ])
          }
        });
      });
      expect(restoredProviderCalls).toBe(expectedRestoredProviderCalls);
      expect(restoredReadCalls).toBe(0);
    }
  );

  test("persists frozen prompt and context before publishing the initial active snapshot", async () => {
    const durable = durableMemoryRepository();
    const order: string[] = [];
    const repository = {
      ...durable,
      async writePromptMaterialization(runId: string, artifact: Record<string, unknown>) {
        const result = await durable.writePromptMaterialization(runId, artifact);
        order.push("prompt");
        return result;
      },
      async writeContextSnapshot(snapshot: Record<string, unknown>) {
        const result = await durable.writeContextSnapshot(snapshot);
        order.push("context");
        return result;
      },
      async writeBudgetSnapshot(runId: string, snapshot: Record<string, unknown>) {
        const result = await durable.writeBudgetSnapshot(runId, snapshot);
        order.push("budget");
        return result;
      },
      async appendEvent(event: Record<string, unknown>) {
        const result = await durable.appendEvent(event);
        order.push(`event:${String(event["type"])}`);
        return result;
      },
      async writeSnapshot(snapshot: Record<string, unknown>) {
        const result = await durable.writeSnapshot(snapshot);
        order.push("snapshot");
        return result;
      }
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_initial_order" },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    expect(order.slice(0, 6)).toEqual([
      "prompt",
      "context",
      "budget",
      "event:run_started",
      "event:context_refreshed",
      "snapshot"
    ]);
  });

  test("releases an unpersisted v2 run when prompt materialization fails", async () => {
    const durable = durableMemoryRepository();
    let failPrompt = true;
    let runSequence = 0;
    const repository = {
      ...durable,
      async writePromptMaterialization(runId: string, artifact: Record<string, unknown>) {
        if (failPrompt) {
          failPrompt = false;
          return {
            ok: false as const,
            error: {
              code: "TEST_PROMPT_WRITE_FAILED",
              category: "StorageError",
              message: "prompt write failed",
              recoverability: "retryable",
              suggestedAction: "Retry.",
              traceId: "test"
            }
          };
        }
        return durable.writePromptMaterialization(runId, artifact);
      }
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => `run_v2_prompt_failure_${++runSequence}` },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({
      ok: false,
      error: { code: "TEST_PROMPT_WRITE_FAILED" }
    });
    expect(await durable.readSnapshot("run_v2_prompt_failure_1")).toEqual({
      ok: true,
      value: undefined
    });
    expect(
      await session.startAgentRun({ ...startCommand(), commandId: "start-after-failure" })
    ).toMatchObject({ ok: true, value: { runId: "run_v2_prompt_failure_2" } });
  });

  test("persists one v2 catalog and sends only the merged tool facade to a new run", async () => {
    const repository = durableMemoryRepository();
    let providerToolNames: string[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_catalog" },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          providerToolNames = input.tools.map((tool) => tool.name);
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: {
        runId: "run_v2_catalog",
        toolFacadeVersion: "v2",
        toolCatalogSnapshotId: "tool_catalog_run_v2_catalog",
        toolCatalogRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    await vi.waitFor(() => {
      expect(providerToolNames).toEqual([
        "list_project_entries",
        "read_resource",
        "search_project",
        "finish",
        "request_user_input"
      ]);
    });
    expect(providerToolNames).not.toContain("read_chapter");
    expect(providerToolNames).not.toContain("propose_file_move");

    const catalog = await repository.readToolCatalog(
      "run_v2_catalog",
      "tool_catalog_run_v2_catalog"
    );
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        facadeVersion: "v2",
        descriptors: providerToolNames.map((name) => expect.objectContaining({ name }))
      }
    });
  });

  test("removes revoked v2 search and lifecycle tools from the active run catalog", async () => {
    const repository = durableMemoryRepository();
    const capabilitySnapshot = creativeV2Capabilities();
    const initialState = createEffectiveCapabilityState(capabilitySnapshot);
    const effectiveCapabilityState = revokeCapability(
      revokeCapability(initialState, "search", "feature_flag_disabled", "2026-07-26T00:00:00.000Z"),
      "file_lifecycle",
      "feature_flag_disabled",
      "2026-07-26T00:00:01.000Z"
    );
    let providerToolNames: string[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_revoked" },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot,
      effectiveCapabilityState,
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          providerToolNames = input.tools.map((tool) => tool.name);
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(() => expect(providerToolNames.length).toBeGreaterThan(0));
    expect(providerToolNames).not.toContain("edit_text");
    expect(providerToolNames).not.toContain("search_project");
    expect(providerToolNames).not.toContain("create_resource");
    expect(providerToolNames).not.toContain("manage_path");
  });

  test("persists a v2 execution catalog when an approved v2 plan starts its linked run", async () => {
    const repository = durableMemoryRepository();
    let runSequence = 0;
    let executionToolNames: string[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => `run_v2_plan_${++runSequence}` },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: {
          readonly snapshot: { readonly sourcePlanId?: string | null };
          readonly tools: readonly { readonly name: string }[];
        }) {
          if (input.snapshot.sourcePlanId === "plan_v2_handoff") {
            executionToolNames = input.tools.map((tool) => tool.name);
            yield { type: "round_completed", finishReason: "stop" };
            return;
          }
          yield toolCall("finish_v2_plan", "finish_plan", {
            planId: "plan_v2_handoff",
            goal: "Prepare the v2 handoff",
            successCriteria: ["Execution starts"],
            nonGoals: [],
            facts: [],
            assumptions: [],
            openQuestions: [],
            targetRefs: [],
            steps: [{ stepId: "step_v2_handoff", title: "Execute", verification: "Finish" }],
            risks: [],
            verification: ["Confirm the execution run starts from the approved plan."],
            sourceRefs: []
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    const planningStarted = await session.startAgentRun({
      ...startCommand(),
      operationMode: "planning"
    });
    expect(planningStarted).toMatchObject({
      ok: true,
      value: {
        runId: "run_v2_plan_1",
        toolFacadeVersion: "v2",
        toolCatalogSnapshotId: "tool_catalog_run_v2_plan_1"
      }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_v2_plan_1")).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    const planning = (await session.readAgentRun("run_v2_plan_1")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };

    const executionStarted = await session.decidePlan({
      projectId: "project-01",
      runId: "run_v2_plan_1",
      commandId: "approve-v2-plan",
      expectedRunRevision: planning.value.snapshot.runRevision,
      planId: "plan_v2_handoff",
      planRevision: 1,
      decision: "approve"
    });
    expect(executionStarted).toMatchObject({
      ok: true,
      value: {
        runId: "run_v2_plan_2",
        toolFacadeVersion: "v2",
        toolCatalogSnapshotId: "tool_catalog_run_v2_plan_2",
        toolCatalogRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    expect(await session.readAgentRun("run_v2_plan_2")).toMatchObject({
      value: {
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "context_refreshed",
            detail: expect.objectContaining({
              approvedPlanMessage: expect.stringContaining('"kind":"approved_plan"')
            })
          }),
          expect.objectContaining({
            type: "plan_execution_started",
            detail: expect.objectContaining({
              approvedPlanMessage: expect.stringContaining('"kind":"approved_plan"')
            })
          })
        ])
      }
    });

    const executionCatalog = await repository.readToolCatalog(
      "run_v2_plan_2",
      "tool_catalog_run_v2_plan_2"
    );
    expect(executionCatalog).toMatchObject({
      ok: true,
      value: {
        facadeVersion: "v2",
        descriptors: expect.not.arrayContaining([
          expect.objectContaining({ name: "edit_text" }),
          expect.objectContaining({ name: "create_resource" }),
          expect.objectContaining({ name: "manage_path" })
        ])
      }
    });
    await vi.waitFor(() => expect(executionToolNames).not.toEqual([]));
    expect(executionToolNames).not.toContain("edit_text");
    expect(executionToolNames).not.toContain("manage_path");
    expect(executionToolNames).not.toContain("propose_chapter_write");
    expect(executionToolNames).not.toContain("read_chapter");
  });

  test("fails closed when a historical v1 run lacks a reproducible frozen catalog", async () => {
    const repository = durableMemoryRepository();
    let originalNames: string[] = [];
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_legacy_v1" },
      repository,
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          originalNames = input.tools.map((tool) => tool.name);
          yield* blockedModelRound();
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    const started = await original.startAgentRun(startCommand());
    expect(started).toMatchObject({
      ok: true,
      value: {
        toolFacadeVersion: "v1",
        toolCatalogSnapshotId: null,
        toolCatalogRevision: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    await vi.waitFor(() => expect(originalNames.length).toBeGreaterThan(0));

    let restoredNames: string[] = [];
    const restored = createSession({
      coordinatorOptions: { createRunId: () => "unused_v2_run" },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          restoredNames = input.tools.map((tool) => tool.name);
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    const hydrated = await restored.readAgentRun("run_legacy_v1");
    expect(hydrated).toMatchObject({ ok: true });
    const hydratedSnapshot = (
      hydrated["value"] as { readonly snapshot: { readonly runRevision: number } }
    ).snapshot;
    expect(
      await restored.resumeAgentRun({
        projectId: "project-01",
        runId: "run_legacy_v1",
        commandId: "resume-legacy-v1",
        expectedRunRevision: hydratedSnapshot.runRevision
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await restored.readAgentRun("run_legacy_v1")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "failed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "run_failed",
              detail: expect.objectContaining({ code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID" })
            })
          ])
        }
      });
    });
    expect(restoredNames).toEqual([]);
  });

  test("fails closed when a persisted v2 run has no tool catalog", async () => {
    const repository = durableMemoryRepository();
    let roundStarted = false;
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_missing_catalog" },
      repository,
      newRunToolFacadeVersion: "v2",
      modelDriver: {
        async *streamRound() {
          roundStarted = true;
          yield* blockedModelRound();
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    await original.startAgentRun(startCommand());
    await vi.waitFor(() => expect(roundStarted).toBe(true));

    const restored = createSession({
      coordinatorOptions: { createRunId: () => "unused_missing_catalog" },
      repository: {
        ...repository,
        async readToolCatalog() {
          return { ok: true, value: undefined };
        }
      },
      newRunToolFacadeVersion: "v2",
      modelDriver: { async *streamRound() {} },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    expect(await restored.readAgentRun("run_v2_missing_catalog")).toMatchObject({
      ok: false,
      error: { code: "AGENT_TOOL_CATALOG_MISSING" }
    });
  });

  test("fails closed when a persisted v2 run has no frozen prompt artifact", async () => {
    const repository = durableMemoryRepository();
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_missing_prompt" },
      repository,
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    expect(await original.startAgentRun(startCommand())).toMatchObject({ ok: true });

    const restored = createSession({
      coordinatorOptions: { createRunId: () => "unused_missing_prompt" },
      repository: {
        ...repository,
        async readPromptMaterialization() {
          return { ok: true as const, value: undefined };
        }
      },
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    expect(await restored.readAgentRun("run_v2_missing_prompt")).toMatchObject({
      ok: false,
      error: { code: "AGENT_PROMPT_MATERIALIZATION_MISSING" }
    });
  });

  test("fails closed when a persisted v2 catalog descriptor is tampered", async () => {
    const repository = durableMemoryRepository();
    let roundStarted = false;
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_tampered_catalog" },
      repository,
      newRunToolFacadeVersion: "v2",
      modelDriver: {
        async *streamRound() {
          roundStarted = true;
          yield* blockedModelRound();
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    await original.startAgentRun(startCommand());
    await vi.waitFor(() => expect(roundStarted).toBe(true));

    const restored = createSession({
      coordinatorOptions: { createRunId: () => "unused_tampered_catalog" },
      repository: {
        ...repository,
        async readToolCatalog(runId: string, snapshotId: string) {
          const read = await repository.readToolCatalog(runId, snapshotId);
          if (!read.ok || read.value === undefined) return read;
          const descriptors = read.value["descriptors"] as Record<string, unknown>[];
          return {
            ok: true,
            value: {
              ...read.value,
              descriptors: [
                { ...descriptors[0], description: "tampered descriptor" },
                ...descriptors.slice(1)
              ]
            }
          };
        }
      },
      newRunToolFacadeVersion: "v2",
      modelDriver: { async *streamRound() {} },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    expect(await restored.readAgentRun("run_v2_tampered_catalog")).toMatchObject({
      ok: false,
      error: { code: "AGENT_TOOL_CATALOG_INVALID" }
    });
  });

  test("maps v2 read and search calls onto the existing domain executors", async () => {
    const readCalls: Record<string, unknown>[] = [];
    const searchCalls: Record<string, unknown>[] = [];
    let rounds = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_v2_read_search" },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          if (rounds === 1) {
            yield toolCall("v2-read", "read_resource", { ref: "story_bible:hero" });
            yield toolCall("v2-search", "search_project", {
              mode: "text",
              query: "moon",
              includeGlobs: ["chapters/**"],
              maxResults: 5
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute(input: Record<string, unknown>) {
          readCalls.push(input);
          return { ok: true, value: { summary: "read", data: {} } };
        }
      },
      searchToolExecutor: {
        async searchText(input: Record<string, unknown>) {
          searchCalls.push(input);
          return {
            ok: true,
            value: {
              kind: "untrusted_project_data",
              items: [],
              totalHits: 0,
              truncated: false,
              indexVersion: "test-v1"
            }
          };
        },
        async findReferences() {
          throw new Error("unexpected reference search");
        }
      }
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(() => {
      expect(readCalls).toHaveLength(1);
      expect(searchCalls).toHaveLength(1);
    });
    expect(readCalls[0]).toMatchObject({
      name: "read_story_bible",
      arguments: { assetId: "hero" }
    });
    expect(searchCalls[0]).toMatchObject({
      query: "moon",
      includeGlobs: ["chapters/**"],
      maxResults: 5
    });
  });

  test("rejects a schema 1 v2 Story Bible mutation alias at dispatch", async () => {
    const proposals: Record<string, unknown>[] = [];
    const runId = "run_v2_story_edit";
    const changeSet = diagnosticChangeSet(runId);
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("v2-story-edit", "edit_text", {
            ref: "story_bible:hero",
            baseHash: "a".repeat(64),
            range: { unit: "character", start: 0, end: 2 },
            replacement: "{}"
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      changeSetSession: {
        async proposeStoryBibleWrite(input: Record<string, unknown>) {
          proposals.push(input);
          return { ok: true, value: changeSet };
        },
        async proposeFileWrite() {
          throw new Error("unexpected file proposal");
        },
        async proposeChapterWrite() {
          throw new Error("unexpected chapter proposal");
        },
        async proposeOperation() {
          throw new Error("unexpected lifecycle proposal");
        }
      }
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      const read = await session.readAgentRun(runId);
      const events = (read["value"] as { readonly events?: readonly Record<string, unknown>[] })
        ?.events;
      expect(events?.find((event) => event["type"] === "tool_failed")?.["detail"]).toMatchObject({
        toolCallId: "v2-story-edit",
        code: "AGENT_TOOL_NOT_ALLOWED"
      });
    });
    expect(proposals).toEqual([]);
  });

  test("rejects a schema 1 v2 file-creation alias at dispatch", async () => {
    const fileProposals: Record<string, unknown>[] = [];
    const stagedOperations: Record<string, unknown>[] = [];
    const runId = "run_v2_create_file";
    const changeSet = diagnosticChangeSet(runId);
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("v2-create-file", "create_resource", {
            kind: "file",
            path: "notes/new.md",
            content: "new",
            dependsOn: ["op-parent"]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      fileOperationSession: {
        proposeFileCreate(input: Record<string, unknown>) {
          fileProposals.push(input);
          const operation = {
            kind: "create_file",
            operationId: "op-create",
            relativePath: input["relativePath"],
            content: input["content"],
            dependsOn: input["dependsOn"],
            toolCallIdempotencyKey: input["toolCallId"]
          };
          return { ok: true, value: { operation, operationId: "op-create" } };
        }
      },
      changeSetSession: {
        async proposeOperation(input: Record<string, unknown>) {
          stagedOperations.push(input);
          return { ok: true, value: changeSet };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), contextMode: "general_file" });
    await vi.waitFor(async () => {
      const read = await session.readAgentRun(runId);
      const events = (read["value"] as { readonly events?: readonly Record<string, unknown>[] })
        ?.events;
      expect(events?.find((event) => event["type"] === "tool_failed")?.["detail"]).toMatchObject({
        toolCallId: "v2-create-file",
        code: "AGENT_TOOL_NOT_ALLOWED"
      });
    });
    expect(fileProposals).toEqual([]);
    expect(stagedOperations).toEqual([]);
  });

  test("rejects a schema 1 v2 chapter-creation alias before backend dispatch", async () => {
    const runId = "run_v2_create_chapter_without_formal_session";
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("v2-create-chapter", "create_resource", {
            kind: "chapter",
            title: "第一章",
            content: "正文"
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      fileOperationSession: {
        proposeChapterCreate() {
          throw new Error("legacy chapter create must not be called");
        }
      },
      changeSetSession: {
        async proposeOperation() {
          throw new Error("chapter create must fail before staging");
        }
      }
    });

    await session.startAgentRun(startCommand());
    await vi.waitFor(async () => {
      const read = await session.readAgentRun(runId);
      const value = read["value"] as Record<string, unknown> | undefined;
      const events = value?.["events"] as Record<string, unknown>[] | undefined;
      const failed = events?.find((event) => event["type"] === "tool_failed");
      expect(failed?.["detail"]).toMatchObject({
        toolCallId: "v2-create-chapter",
        code: "AGENT_TOOL_NOT_ALLOWED"
      });
    });
  });

  test("rejects a schema 1 v2 move alias at dispatch", async () => {
    const moveProposals: Record<string, unknown>[] = [];
    const runId = "run_v2_move_file";
    let lifecycleOperation: Record<string, unknown> | undefined;
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("v2-move-file", "manage_path", {
            operation: "move_file",
            sourceRef: "file:notes/old.md",
            targetPath: "notes/new.md",
            baseHash: "b".repeat(64),
            dependsOn: ["op-directory"]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      fileOperationSession: {
        proposeFileMove(input: Record<string, unknown>) {
          moveProposals.push(input);
          const operation = {
            kind: "move_file",
            operationId: "op-move",
            sourcePath: input["sourcePath"],
            targetPath: input["targetPath"],
            sourceChecksum: input["sourceChecksum"],
            dependsOn: input["dependsOn"],
            toolCallIdempotencyKey: input["toolCallId"]
          };
          return { ok: true, value: { operation, operationId: "op-move" } };
        }
      },
      changeSetSession: {
        async proposeOperation(input: Record<string, unknown>) {
          lifecycleOperation = input["operation"] as Record<string, unknown>;
          return {
            ok: true,
            value: {
              ...diagnosticChangeSet(runId),
              schemaVersion: "1.1",
              writePolicy: "write_before_confirmation",
              files: [],
              operationsSchemaVersion: "1.1",
              operations: [lifecycleOperation]
            }
          };
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      contextMode: "general_file"
    });
    await vi.waitFor(async () => {
      const read = await session.readAgentRun(runId);
      const events = (read["value"] as { readonly events?: readonly Record<string, unknown>[] })
        ?.events;
      expect(events?.find((event) => event["type"] === "tool_failed")?.["detail"]).toMatchObject({
        toolCallId: "v2-move-file",
        code: "AGENT_TOOL_NOT_ALLOWED"
      });
    });
    expect(moveProposals).toEqual([]);
    expect(lifecycleOperation).toBeUndefined();
  });

  test("writes Guidance 3.0 and Prompt Artifact 2.0 only when the Main-owned gate is enabled", async () => {
    const repository = durableMemoryRepository();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true
    });

    const started = await session.startAgentRun({
      ...startCommand(),
      writingTaskIntent: {
        schemaVersion: "1.0",
        kind: "rewrite",
        bodyGeneration: true,
        source: "composer_action"
      },
      initialContextSources: [
        {
          refId: "chapter:chapter-01",
          sourceKind: "disk_file",
          relativePath: "chapters/chapter-01.md",
          content: "Chapter body",
          dirty: false
        },
        {
          refId: "story_bible:character-01",
          sourceKind: "disk_file",
          assetId: "character-01",
          content: '{"type":"character","title":"Hero"}',
          dirty: false
        }
      ]
    });
    expect(started).toMatchObject({ ok: true, value: { runId: "run_guidance_v3" } });

    const stored = await repository.readPromptMaterialization(
      "run_guidance_v3",
      "prompt_context_run_guidance_v3"
    );
    expect(stored).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        guidanceRegistryKey: "writing@3.0",
        writingTaskIntent: {
          kind: "rewrite",
          bodyGeneration: true,
          source: "composer_action"
        },
        runtimeFacts: { activeResourceKind: "story_bible" },
        writingGenerationGuidanceVersion: "not_applicable",
        providerSemanticVersionSet: {
          systemGuidanceVersion: "3.0",
          promptArtifactSchemaVersion: "2.0",
          writingTaskIntentSchemaVersion: "1.0"
        }
      }
    });
    const body = String((stored.value as Record<string, unknown>)["systemPrompt"]);
    expect(body).not.toContain("foreshadow v1.0");
    expect(body).not.toContain("actualPayoffChapterId");
  });

  test("binds Catalog 2.0 and Guidance 3.0 to the same operation rule set", async () => {
    const repository = durableMemoryRepository();
    const capabilitySnapshot: AgentToolCapabilitySnapshot = {
      ...creativeV2Capabilities(),
      writingOperations: ["chapter_replace"]
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_rules" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await expect(
      repository.readToolCatalog("run_guidance_v3_rules", "tool_catalog_run_guidance_v3_rules")
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        descriptors: expect.arrayContaining([
          expect.objectContaining({
            name: "edit_text",
            effect: "propose",
            writeOperation: "chapter_replace"
          })
        ]),
        approvalRules: [expect.objectContaining({ operation: "chapter_replace" })]
      }
    });
    const prompt = await repository.readPromptMaterialization(
      "run_guidance_v3_rules",
      "prompt_context_run_guidance_v3_rules"
    );
    expect(prompt).toMatchObject({
      ok: true,
      value: {
        runtimeFacts: {
          writingOperations: ["chapter_replace"],
          workspaceFileOperations: []
        }
      }
    });
    const promptValue = (prompt as { readonly value: Record<string, unknown> }).value;
    const runtimeFacts = promptValue["runtimeFacts"] as Record<string, unknown>;
    const semanticVersions = promptValue["providerSemanticVersionSet"] as Record<string, unknown>;
    expect(semanticVersions["approvalRuleSetVersion"]).toBe(runtimeFacts["approvalRuleSetVersion"]);
    expect(semanticVersions["approvalRuleSetChecksum"]).toBe(
      runtimeFacts["approvalRuleSetChecksum"]
    );
  });

  test("fails before another Provider call when a frozen Catalog 2.0 operation is revoked", async () => {
    const repository = durableMemoryRepository();
    const capabilitySnapshot: AgentToolCapabilitySnapshot = {
      ...creativeV2Capabilities(),
      writingOperations: ["chapter_replace"]
    };
    let effectiveCapabilityState = createEffectiveCapabilityState(capabilitySnapshot);
    const runIds = ["run_guidance_v3_operation_revoked", "run_guidance_v3_operation_replacement"];
    let providerCalls = 0;
    let markReadStarted: () => void = () => undefined;
    let releaseRead: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readReleased = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => runIds.shift() ?? "run_guidance_v3_unexpected" },
      repository,
      modelDriver: {
        async *streamRound(input: { readonly runId: string }) {
          providerCalls += 1;
          if (input.runId === "run_guidance_v3_operation_replacement") {
            yield { type: "round_completed" as const, finishReason: "stop" as const };
            return;
          }
          yield toolCall("read-before-operation-revocation", "read_resource", {
            ref: "chapter:chapter-01"
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: {
        async execute() {
          markReadStarted();
          await readReleased;
          return { ok: true, value: { summary: "ok", data: {} } };
        }
      },
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot,
      getEffectiveCapabilityState: () => effectiveCapabilityState
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await readStarted;
    effectiveCapabilityState = revokeCapability(
      effectiveCapabilityState,
      "writing_operation:chapter_replace",
      "user_revoked",
      "2026-08-03T00:00:00.000Z"
    );
    releaseRead();
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_guidance_v3_operation_revoked")).toMatchObject({
        value: {
          snapshot: {
            status: "capability_changed",
            capabilities: {
              revision: effectiveCapabilityState.revision,
              state: "capability_changed",
              changeReason: "frozen_catalog_operation_revoked"
            }
          },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "capability_changed",
              detail: {
                effectiveCapabilityRevision: effectiveCapabilityState.revision,
                reason: "frozen_catalog_operation_revoked"
              }
            })
          ])
        }
      });
    });
    expect(providerCalls).toBe(1);
    const changed = (await session.readAgentRun("run_guidance_v3_operation_revoked")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };
    await expect(
      session.resumeAgentRun({
        projectId: "project-01",
        runId: "run_guidance_v3_operation_revoked",
        commandId: "resume-after-operation-revocation",
        expectedRunRevision: changed.value.snapshot.runRevision
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ALREADY_TERMINAL" }
    });
    await expect(
      session.startAgentRun({
        ...startCommand(),
        commandId: "start-after-operation-revocation"
      })
    ).resolves.toMatchObject({
      ok: true,
      value: { runId: "run_guidance_v3_operation_replacement" }
    });
  });

  test("rechecks Catalog 2.0 authority after budget persistence and before the first Provider call", async () => {
    const durable = durableMemoryRepository();
    let markBudgetWriteStarted: () => void = () => undefined;
    let releaseBudgetWrite: () => void = () => undefined;
    const budgetWriteStarted = new Promise<void>((resolve) => {
      markBudgetWriteStarted = resolve;
    });
    const budgetWriteReleased = new Promise<void>((resolve) => {
      releaseBudgetWrite = resolve;
    });
    const repository = {
      ...durable,
      async writeBudgetSnapshot(runId: string, snapshot: Record<string, unknown>) {
        if (String(snapshot["contextBudgetSnapshotId"]).includes("_round_")) {
          markBudgetWriteStarted();
          await budgetWriteReleased;
        }
        return durable.writeBudgetSnapshot(runId, snapshot);
      }
    };
    const capabilitySnapshot: AgentToolCapabilitySnapshot = {
      ...creativeV2Capabilities(),
      writingOperations: ["chapter_replace"]
    };
    let effectiveCapabilityState = createEffectiveCapabilityState(capabilitySnapshot);
    let providerCalls = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_pre_provider_revoked" },
      repository,
      modelDriver: {
        async *streamRound() {
          providerCalls += 1;
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot,
      getEffectiveCapabilityState: () => effectiveCapabilityState
    });

    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await budgetWriteStarted;
    effectiveCapabilityState = revokeCapability(
      effectiveCapabilityState,
      "writing_operation:chapter_replace",
      "user_revoked",
      "2026-08-03T00:00:02.000Z"
    );
    releaseBudgetWrite();
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_guidance_v3_pre_provider_revoked")).toMatchObject({
        value: {
          snapshot: { status: "capability_changed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "capability_changed",
              detail: {
                effectiveCapabilityRevision: effectiveCapabilityState.revision,
                reason: "frozen_catalog_operation_revoked"
              }
            })
          ])
        }
      });
    });
    expect(providerCalls).toBe(0);
  });

  test("filters a Guidance 3.0 Plan-to-Act handoff through the current operation state", async () => {
    const repository = durableMemoryRepository();
    const capabilitySnapshot: AgentToolCapabilitySnapshot = {
      ...creativeV2Capabilities(),
      writingOperations: ["chapter_replace", "chapter_create"]
    };
    let effectiveCapabilityState = createEffectiveCapabilityState(capabilitySnapshot);
    let runSequence = 0;
    let executionToolNames: readonly string[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => `run_guidance_v3_filtered_${++runSequence}` },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot,
      getEffectiveCapabilityState: () => effectiveCapabilityState,
      modelDriver: {
        async *streamRound(input: {
          readonly snapshot: { readonly sourcePlanId?: string | null };
          readonly tools: readonly { readonly name: string }[];
        }) {
          if (input.snapshot.sourcePlanId === "plan_guidance_v3_filtered") {
            executionToolNames = input.tools.map((tool) => tool.name);
            yield { type: "round_completed" as const, finishReason: "stop" as const };
            return;
          }
          yield toolCall("finish_guidance_v3_filtered", "finish_plan", {
            planId: "plan_guidance_v3_filtered",
            goal: "Execute only currently qualified writing operations",
            successCriteria: ["The execution catalog is filtered"],
            nonGoals: [],
            facts: [],
            assumptions: [],
            openQuestions: [],
            targetRefs: [],
            steps: [
              {
                stepId: "step_guidance_v3_filtered",
                title: "Execute the approved change",
                verification: "Inspect the frozen directory"
              }
            ],
            risks: [],
            verification: ["Inspect the frozen execution catalog."],
            sourceRefs: []
          });
          yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    expect(
      await session.startAgentRun({ ...startCommand(), operationMode: "planning" })
    ).toMatchObject({ ok: true, value: { runId: "run_guidance_v3_filtered_1" } });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_guidance_v3_filtered_1")).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    await expect(
      repository.readPlanArtifact("plan_guidance_v3_filtered", 1)
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        executionWritePolicyDraft: "write_before_confirmation"
      }
    });
    effectiveCapabilityState = revokeCapability(
      effectiveCapabilityState,
      "writing_operation:chapter_create",
      "user_revoked",
      "2026-08-03T00:00:01.000Z"
    );
    const planning = (await session.readAgentRun("run_guidance_v3_filtered_1")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };
    expect(
      await session.decidePlan({
        projectId: "project-01",
        runId: "run_guidance_v3_filtered_1",
        commandId: "approve-guidance-v3-filtered",
        expectedRunRevision: planning.value.snapshot.runRevision,
        planId: "plan_guidance_v3_filtered",
        planRevision: 1,
        decision: "approve"
      })
    ).toMatchObject({ ok: true, value: { runId: "run_guidance_v3_filtered_2" } });
    await vi.waitFor(() => expect(executionToolNames.length).toBeGreaterThan(0));
    expect(executionToolNames).toContain("edit_text");
    expect(executionToolNames).not.toContain("create_resource");
    await expect(
      repository.readToolCatalog(
        "run_guidance_v3_filtered_2",
        "tool_catalog_run_guidance_v3_filtered_2"
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        descriptors: expect.not.arrayContaining([
          expect.objectContaining({ writeOperation: "chapter_create" })
        ])
      }
    });
    await expect(
      repository.readPromptMaterialization(
        "run_guidance_v3_filtered_2",
        "prompt_context_run_guidance_v3_filtered_2"
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        runtimeFacts: {
          writingOperations: ["chapter_replace"],
          workspaceFileOperations: []
        }
      }
    });
  });

  test("preserves the frozen writing intent across a Guidance 3.0 Plan-to-Act handoff", async () => {
    const repository = promptCacheMemoryRepository();
    let runSequence = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => `run_guidance_v3_plan_${++runSequence}` },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      modelDriver: {
        async *streamRound(input: {
          readonly snapshot: { readonly sourcePlanId?: string | null };
        }) {
          if (input.snapshot.sourcePlanId === "plan_guidance_v3_handoff") {
            yield { type: "round_completed" as const, finishReason: "stop" as const };
            return;
          }
          yield toolCall("finish_guidance_v3_plan", "finish_plan", {
            planId: "plan_guidance_v3_handoff",
            goal: "Analyze the existing chapter without generating prose",
            successCriteria: ["The analysis is complete"],
            nonGoals: [],
            facts: [],
            assumptions: [],
            openQuestions: [],
            targetRefs: [],
            steps: [
              {
                stepId: "step_guidance_v3_handoff",
                title: "Analyze the chapter",
                verification: "Review the analysis"
              }
            ],
            risks: [],
            verification: ["Review the preserved writing intent."],
            sourceRefs: []
          });
          yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    const start = startCommand();
    const providerCapabilitySnapshot = start["providerCapabilitySnapshot"] as Record<
      string,
      unknown
    >;
    const planningStarted = await session.startAgentRun({
      ...start,
      operationMode: "planning",
      userRequest: "Rewrite the ending of the current chapter.",
      providerCapabilitySnapshot: {
        ...providerCapabilitySnapshot,
        connectionIdentityChecksum: "a".repeat(64),
        accountIsolationChecksum: "b".repeat(64),
        promptCache: cacheablePromptCapability()
      },
      writingTaskIntent: {
        schemaVersion: "1.0",
        kind: "rewrite",
        bodyGeneration: true,
        source: "composer_action"
      }
    });
    expect(planningStarted).toMatchObject({
      ok: true,
      value: { runId: "run_guidance_v3_plan_1" }
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_guidance_v3_plan_1")).toMatchObject({
        value: { snapshot: { status: "plan_ready" } }
      });
    });
    const planning = (await session.readAgentRun("run_guidance_v3_plan_1")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };

    const executionStarted = await session.decidePlan({
      projectId: "project-01",
      runId: "run_guidance_v3_plan_1",
      commandId: "approve-guidance-v3-plan",
      expectedRunRevision: planning.value.snapshot.runRevision,
      planId: "plan_guidance_v3_handoff",
      planRevision: 1,
      decision: "approve"
    });
    expect(executionStarted).toMatchObject({
      ok: true,
      value: { runId: "run_guidance_v3_plan_2", promptCacheArtifactId: expect.any(String) }
    });
    const executionSnapshot = executionStarted["value"] as Record<string, unknown>;
    await expect(
      repository.readPromptCacheArtifact(
        "run_guidance_v3_plan_2",
        String(executionSnapshot["promptCacheArtifactId"])
      )
    ).resolves.toMatchObject({ ok: true, value: { schemaVersion: "2.0" } });

    await expect(
      repository.readPromptMaterialization(
        "run_guidance_v3_plan_2",
        "prompt_context_run_guidance_v3_plan_2"
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        writingTaskIntent: {
          schemaVersion: "1.0",
          kind: "rewrite",
          bodyGeneration: true,
          source: "composer_action"
        }
      }
    });
  });

  test("keeps the default-off start path on the frozen historical artifact", async () => {
    const repository = durableMemoryRepository();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_legacy" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2"
    });

    const started = await session.startAgentRun(startCommand());
    expect(started).toMatchObject({ ok: true, value: { runId: "run_guidance_legacy" } });
    await expect(
      repository.readPromptMaterialization(
        "run_guidance_legacy",
        "prompt_context_run_guidance_legacy"
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        systemGuidanceRefId: "system_guidance:writing@2.1"
      }
    });
  });

  test("fails closed when Guidance 3.0 is requested on the legacy start pipeline", async () => {
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_legacy_pipeline" },
      repository: memoryRepository(),
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      agentGuidanceV3: true
    });

    await expect(session.startAgentRun(startCommand())).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_GUIDANCE_V3_PIPELINE_UNAVAILABLE" }
    });
  });

  test("writes a strict prompt-cache v2 identity for Guidance 3.0", async () => {
    const repository = promptCacheMemoryRepository();
    const boundary = testCapabilityBoundary();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_cache" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      getCurrentCapabilityBoundary: () => boundary
    });
    const base = startCommand();
    const providerCapabilitySnapshot = base["providerCapabilitySnapshot"] as Record<
      string,
      unknown
    >;

    const started = await session.startAgentRun({
      ...base,
      providerCapabilitySnapshot: {
        ...providerCapabilitySnapshot,
        connectionIdentityChecksum: "a".repeat(64),
        accountIsolationChecksum: "b".repeat(64),
        promptCache: cacheablePromptCapability()
      }
    });
    expect(started).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        promptCacheArtifactId: expect.any(String),
        providerSemanticVersionSetChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
    const snapshot = started["value"] as Record<string, unknown>;
    const artifactId = String(snapshot["promptCacheArtifactId"]);
    await expect(
      repository.readPromptCacheArtifact("run_guidance_v3_cache", artifactId)
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        providerSemanticVersionSetChecksum: snapshot["providerSemanticVersionSetChecksum"],
        effectiveCapabilityStateChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sharingDefaultsRevision: boundary.sharingDefaultsRevision,
        sharingGrantRevision: boundary.sharingGrantRevision,
        providerToolProjectionChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
      }
    });
  });

  test("uses not_applicable sharing revisions for standalone prompt-cache v2 identities", async () => {
    const repository = promptCacheMemoryRepository();
    const standaloneScope = { kind: "standalone", scopeId: "standalone" } as const;
    const boundary = {
      ...testCapabilityBoundary(),
      canonicalRootIdentityChecksum: "not_applicable",
      sharingDefaultsRevision: "not_applicable",
      sharingGrantRevision: "not_applicable"
    };
    const session = createSession({
      scope: standaloneScope,
      coordinatorOptions: { createRunId: () => "run_guidance_v3_standalone_cache" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      getCurrentCapabilityBoundary: () => boundary
    });
    const base = startCommand();
    const providerCapabilitySnapshot = base["providerCapabilitySnapshot"] as Record<
      string,
      unknown
    >;
    const withoutProject = { ...base };
    delete withoutProject["projectId"];
    const started = await session.startAgentRun({
      ...withoutProject,
      scope: standaloneScope,
      operationMode: "conversation",
      contextMode: "standalone_chat",
      providerCapabilitySnapshot: {
        ...providerCapabilitySnapshot,
        connectionIdentityChecksum: "a".repeat(64),
        accountIsolationChecksum: "b".repeat(64),
        promptCache: cacheablePromptCapability()
      }
    });
    expect(started).toMatchObject({ ok: true });
    const snapshot = started["value"] as Record<string, unknown>;
    await expect(
      repository.readPromptCacheArtifact(
        "run_guidance_v3_standalone_cache",
        String(snapshot["promptCacheArtifactId"])
      )
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        canonicalRootIdentityChecksum: "not_applicable",
        sharingDefaultsRevision: "not_applicable",
        sharingGrantRevision: "not_applicable"
      }
    });
  });

  test.each([
    ["providerSemanticVersionSetChecksum", "6", "provider semantic version"],
    ["canonicalRootIdentityChecksum", "a", "canonical root"],
    ["effectiveCapabilityStateChecksum", "7", "effective capability"],
    ["sharingDefaultsRevision", "8", "sharing"],
    ["sharingGrantRevision", "b", "sharing grant"],
    ["policyRevision", "policy", "policy"],
    ["providerToolProjectionChecksum", "9", "tool projection"]
  ])("rejects a hydrated prompt cache with a mismatched %s", async (field, replacement) => {
    const repository = promptCacheMemoryRepository();
    const boundary = testCapabilityBoundary();
    const original = createSession({
      coordinatorOptions: { createRunId: () => `run_cache_hydrate_${field}` },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      getCurrentCapabilityBoundary: () => boundary
    });
    const base = startCommand();
    const providerCapabilitySnapshot = base["providerCapabilitySnapshot"] as Record<
      string,
      unknown
    >;
    const started = await original.startAgentRun({
      ...base,
      commandId: `start-cache-hydrate-${field}`,
      providerCapabilitySnapshot: {
        ...providerCapabilitySnapshot,
        connectionIdentityChecksum: "a".repeat(64),
        accountIsolationChecksum: "b".repeat(64),
        promptCache: cacheablePromptCapability()
      }
    });
    expect(started).toMatchObject({ ok: true });

    const restored = createSession({
      repository: {
        ...repository,
        async readPromptCacheArtifact(runId: string, artifactId: string) {
          const read = await repository.readPromptCacheArtifact(runId, artifactId);
          if (!read.ok || read.value === undefined) return read;
          const rebound = createAgentPromptCacheIdentityArtifactV2({
            ...read.value,
            [field]: replacement.repeat(64)
          } as unknown as Parameters<typeof createAgentPromptCacheIdentityArtifactV2>[0]);
          return { ok: true as const, value: rebound as unknown as Record<string, unknown> };
        }
      },
      modelDriver: {
        streamRound: () => unexpectedModelRound("An invalid cache must not call Provider.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      getCurrentCapabilityBoundary: () => boundary
    });
    await expect(restored.readAgentRun(`run_cache_hydrate_${field}`)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PROMPT_CACHE_ARTIFACT_INVALID" }
    });
  });

  test.each([
    ["canonicalRootIdentityChecksum", "a", "canonical_root_changed"],
    ["sharingGrantRevision", "b", "sharing_revision_changed"],
    ["policyRevision", "policy_02", "policy_revision_changed"],
    ["providerSemanticVersionSetChecksum", "c", "provider_semantic_version_set_changed"],
    ["providerToolProjectionChecksum", "d", "provider_tool_projection_changed"],
    ["effectiveCapabilityStateChecksum", "e", "effective_capability_state_changed"]
  ])(
    "stops before a second Provider call when the frozen %s drifts",
    async (field, replacement, expectedReason) => {
      const repository = durableMemoryRepository();
      let currentBoundary = testCapabilityBoundary();
      let providerCalls = 0;
      let markReadStarted: () => void = () => undefined;
      let releaseRead: () => void = () => undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const readReleased = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const runId = `run_boundary_drift_${field}`;
      const session = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository,
        modelDriver: {
          async *streamRound() {
            providerCalls += 1;
            if (providerCalls > 1)
              throw new Error("Boundary drift reached a second Provider call.");
            yield toolCall(`read-before-${field}`, "read_resource", {
              ref: "chapter:chapter-01"
            });
            yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
          }
        },
        startPreflight: echoStartPreflight(),
        readToolExecutor: {
          async execute() {
            markReadStarted();
            await readReleased;
            return { ok: true, value: { summary: "ok", data: {} } };
          }
        },
        newRunToolFacadeVersion: "v2",
        agentGuidanceV3: true,
        capabilitySnapshot: creativeV2Capabilities(),
        getCurrentCapabilityBoundary: () => currentBoundary
      });

      expect(
        await session.startAgentRun({
          ...startCommand(),
          commandId: `start-boundary-drift-${field}`
        })
      ).toMatchObject({ ok: true });
      await readStarted;
      currentBoundary = {
        ...currentBoundary,
        [field]: field === "policyRevision" ? replacement : replacement.repeat(64)
      };
      releaseRead();

      await vi.waitFor(async () => {
        expect(await session.readAgentRun(runId)).toMatchObject({
          value: {
            snapshot: { status: "capability_changed" },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "capability_changed",
                detail: expect.objectContaining({ reason: expectedReason })
              })
            ])
          }
        });
      });
      expect(providerCalls).toBe(1);
    }
  );

  test("explicitly invalidates V20 capability authority once and prevents resume", async () => {
    const repository = durableMemoryRepository();
    let providerCalls = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_explicit_capability_invalidation" },
      repository,
      modelDriver: {
        async *streamRound(input: { readonly signal: AbortSignal }) {
          providerCalls += 1;
          await new Promise<void>((resolve) => {
            if (input.signal.aborted) resolve();
            else input.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: creativeV2Capabilities()
    });
    expect(await session.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(providerCalls).toBe(1));
    const active = (await session.readAgentRun("run_explicit_capability_invalidation")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };
    const command = {
      projectId: "project-01",
      runId: "run_explicit_capability_invalidation",
      commandId: "invalidate-capabilities-01",
      expectedRunRevision: active.value.snapshot.runRevision,
      reason: "settings_capability_revoked"
    };

    const invalidated = await session.invalidateAgentRunCapabilities(command);
    expect(invalidated).toMatchObject({
      ok: true,
      value: {
        status: "capability_changed",
        capabilities: {
          state: "capability_changed",
          changeReason: "settings_capability_revoked"
        },
        pending: { kind: "none" },
        pendingUserInputId: null,
        pendingToolApproval: null
      }
    });
    const duplicate = await session.invalidateAgentRunCapabilities(command);
    expect(duplicate).toEqual(invalidated);
    const changed = invalidated["value"] as Record<string, unknown>;
    await expect(
      session.resumeAgentRun({
        projectId: "project-01",
        runId: "run_explicit_capability_invalidation",
        commandId: "resume-after-explicit-invalidation",
        expectedRunRevision: changed["runRevision"]
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ALREADY_TERMINAL" }
    });
    expect(providerCalls).toBe(1);
  });

  test("keeps legacy prompt-cache v1 hydrate behavior unchanged", async () => {
    const repository = promptCacheMemoryRepository();
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_legacy_cache_v1_hydrate" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2"
    });
    const base = startCommand();
    const providerCapabilitySnapshot = base["providerCapabilitySnapshot"] as Record<
      string,
      unknown
    >;
    const started = await original.startAgentRun({
      ...base,
      commandId: "start-legacy-cache-v1-hydrate",
      providerCapabilitySnapshot: {
        ...providerCapabilitySnapshot,
        connectionIdentityChecksum: "a".repeat(64),
        accountIsolationChecksum: "b".repeat(64),
        promptCache: cacheablePromptCapability()
      }
    });
    expect(started).toMatchObject({ ok: true, value: { schemaVersion: "1.3" } });
    const snapshot = started["value"] as Record<string, unknown>;
    await expect(
      repository.readPromptCacheArtifact(
        "run_legacy_cache_v1_hydrate",
        String(snapshot["promptCacheArtifactId"])
      )
    ).resolves.toMatchObject({ ok: true, value: { schemaVersion: "1.0" } });

    const restored = createSession({
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2"
    });
    await expect(restored.readAgentRun("run_legacy_cache_v1_hydrate")).resolves.toMatchObject({
      ok: true,
      value: { snapshot: { schemaVersion: "1.3" } }
    });
  });

  test("requires an explicit handoff when a hydrated run no longer matches the Guidance gate", async () => {
    const repository = durableMemoryRepository();
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_gate_mismatch" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true
    });
    expect(await original.startAgentRun(startCommand())).toMatchObject({ ok: true });

    const recovered = createSession({
      repository,
      modelDriver: {
        streamRound: () => unexpectedModelRound("A mismatched Guidance run must not call Provider.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2"
    });
    const hydrated = (await recovered.readAgentRun("run_guidance_v3_gate_mismatch")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };

    await expect(
      recovered.resumeAgentRun({
        projectId: "project-01",
        runId: "run_guidance_v3_gate_mismatch",
        commandId: "resume-guidance-gate-mismatch",
        expectedRunRevision: hydrated.value.snapshot.runRevision
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_GUIDANCE_HANDOFF_REQUIRED" }
    });
  });

  test("keeps legacy recovery actions fail-closed when the active Guidance gate requires a handoff", async () => {
    const retryRepository = durableMemoryRepository();
    const retryOriginal = createSession({
      coordinatorOptions: { createRunId: () => "run_legacy_retry_handoff" },
      repository: retryRepository,
      newRunToolFacadeVersion: "v2",
      modelDriver: {
        async *streamRound() {
          yield* [];
          throw createUnifiedError({
            code: "LLM_PROVIDER_DISCONNECTED",
            category: "ModelProviderError",
            message: "Provider disconnected.",
            recoverability: "retryable",
            suggestedAction: "Retry the model round.",
            traceId: "agent-run-session-test"
          });
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    expect(await retryOriginal.startAgentRun(startCommand())).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await retryOriginal.readAgentRun("run_legacy_retry_handoff")).toMatchObject({
        value: {
          snapshot: {
            status: "executing_model",
            recoveryState: "retryable",
            activeErrorId: expect.any(String)
          }
        }
      });
    });
    const retryRecovered = createSession({
      repository: retryRepository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      modelDriver: {
        streamRound: () => unexpectedModelRound("A legacy run must not call the Provider.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    const retryRead = (await retryRecovered.readAgentRun("run_legacy_retry_handoff")) as {
      readonly value: {
        readonly snapshot: {
          readonly runRevision: number;
          readonly activeErrorId: string;
        };
        readonly diagnostic: {
          readonly retryTargets: readonly { readonly kind: string; readonly id: string }[];
        };
      };
    };
    const retrySnapshot = retryRead.value.snapshot;
    const retryTarget = retryRead.value.diagnostic.retryTargets[0];
    expect(retryTarget).toMatchObject({ kind: "model_round" });
    await expect(
      retryRecovered.retryRunTarget({
        projectId: "project-01",
        runId: "run_legacy_retry_handoff",
        commandId: "retry-legacy-handoff",
        expectedRunRevision: retrySnapshot.runRevision,
        errorId: retrySnapshot.activeErrorId,
        target: retryTarget
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_GUIDANCE_HANDOFF_REQUIRED" } });
    await expect(retryRecovered.readAgentRun("run_legacy_retry_handoff")).resolves.toMatchObject({
      value: {
        snapshot: {
          status: "executing_model",
          runRevision: retrySnapshot.runRevision,
          activeErrorId: retrySnapshot.activeErrorId,
          recoveryState: "retryable"
        }
      }
    });

    const contextRepository = durableMemoryRepository();
    const contextOriginal = createSession({
      coordinatorOptions: { createRunId: () => "run_legacy_context_handoff" },
      repository: contextRepository,
      newRunToolFacadeVersion: "v2",
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      contextSourceReader: {
        async readCurrentSources() {
          return { ok: true, value: [{ refId: "file:stale.md", content: "after" }] };
        }
      }
    });
    expect(
      await contextOriginal.startAgentRun({
        ...startCommand(),
        initialContextSources: [
          {
            refId: "file:stale.md",
            sourceKind: "disk_file",
            relativePath: "stale.md",
            content: "before",
            dirty: false
          }
        ]
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await contextOriginal.readAgentRun("run_legacy_context_handoff")).toMatchObject({
        value: { snapshot: { status: "awaiting_context_refresh" } }
      });
    });
    const contextRecovered = createSession({
      repository: contextRepository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      modelDriver: {
        streamRound: () => unexpectedModelRound("A legacy run must not call the Provider.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });
    const contextRead = (await contextRecovered.readAgentRun("run_legacy_context_handoff")) as {
      readonly value: { readonly snapshot: { readonly runRevision: number } };
    };
    await expect(
      contextRecovered.refreshContext({
        projectId: "project-01",
        runId: "run_legacy_context_handoff",
        commandId: "refresh-legacy-handoff",
        expectedRunRevision: contextRead.value.snapshot.runRevision,
        decision: "exclude"
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_GUIDANCE_HANDOFF_REQUIRED" } });
    await expect(
      contextRecovered.readAgentRun("run_legacy_context_handoff")
    ).resolves.toMatchObject({
      value: {
        snapshot: {
          status: "awaiting_context_refresh",
          runRevision: contextRead.value.snapshot.runRevision
        },
        events: expect.arrayContaining([expect.objectContaining({ type: "context_stale" })])
      }
    });
  });

  test("rejects a valid Guidance 3.0 artifact bound to another tool catalog revision", async () => {
    const repository = durableMemoryRepository();
    const original = createSession({
      coordinatorOptions: { createRunId: () => "run_guidance_v3_catalog_mismatch" },
      repository,
      modelDriver: { streamRound: blockedModelRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true
    });
    expect(await original.startAgentRun(startCommand())).toMatchObject({ ok: true });

    const restored = createSession({
      repository: {
        ...repository,
        async readPromptMaterialization(runId: string, artifactId: string) {
          const read = await repository.readPromptMaterialization(runId, artifactId);
          if (!read.ok || read.value === undefined) return read;
          const artifact = read.value as Record<string, unknown>;
          const rebound = applicationExports.createAgentPromptMaterializationArtifact({
            runId: String(artifact["runId"]),
            contextSnapshotId: String(artifact["contextSnapshotId"]),
            profile: artifact["profile"],
            systemPrompt: String(artifact["systemPrompt"]),
            toolCatalogRevision: "different-catalog-revision",
            userRequest: String(artifact["userRequest"]),
            systemGuidanceRefId: String(artifact["systemGuidanceRefId"]),
            contextSources: artifact["contextSources"],
            conversationSummaryMessages: artifact["conversationSummaryMessages"],
            guidanceMaterialization: {
              normalizedInput: artifact["normalizedGuidanceInput"],
              materializedGuidance: artifact["systemPrompt"],
              proof: artifact["guidanceProof"]
            }
          } as never);
          return { ok: true, value: rebound as unknown as Record<string, unknown> };
        }
      },
      modelDriver: {
        streamRound: () => unexpectedModelRound("A mismatched artifact must not call Provider.")
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true
    });

    await expect(restored.readAgentRun("run_guidance_v3_catalog_mismatch")).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PROMPT_MATERIALIZATION_INVALID" }
    });
  });

  test("routes a v2 Change Set apply through the trusted Main approval bridge", async () => {
    const runId = "run_v2_trusted_apply";
    let providerSemanticVersionSetChecksum = "";
    let changeSet = await v2DiagnosticChangeSet(runId);
    const prepared: Record<string, unknown>[] = [];
    const proofWrites: Record<string, unknown>[] = [];
    const decided: Record<string, unknown>[] = [];
    const legacyDecisions: Record<string, unknown>[] = [];
    const applied: Record<string, unknown>[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: { ...creativeV2Capabilities(), writingOperations: ["chapter_replace"] },
      modelDriver: { streamRound: v2ChapterProposalRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      changeSetSession: {
        bindRunProviderSemanticVersionSet(_runId: string, checksum: string) {
          providerSemanticVersionSetChecksum = checksum;
          return { ok: true as const, value: undefined };
        },
        async proposeChapterWrite() {
          changeSet = await v2DiagnosticChangeSet(runId, providerSemanticVersionSetChecksum);
          return { ok: true, value: changeSet };
        },
        async persistApprovalDecisionProof(input: Record<string, unknown>) {
          proofWrites.push(input);
          const proof = input["proof"] as { readonly proofId: string };
          return { ok: true, value: { proofId: proof.proofId, proofChecksum: "c".repeat(64) } };
        },
        async decide(command: Record<string, unknown>) {
          legacyDecisions.push(command);
          throw new Error("a v2 Change Set must never use legacy decide");
        },
        async decideV2(input: Record<string, unknown>) {
          decided.push(input);
          return {
            ok: true,
            value: v2Approval(changeSet, "apply_selected")
          };
        },
        async rejectV2() {
          throw new Error("apply must not reject the Change Set");
        }
      },
      changeSetApprovalV2: {
        async prepare(input: Record<string, unknown>) {
          prepared.push(input);
          return {
            ok: true,
            value: {
              changeSet,
              decision: "apply_selected",
              displayBindingChecksum: changeSet.displayBindingChecksum,
              binding: { mainOnly: true },
              authorizationId: "auth_v2_apply",
              reservationTransactionId: "reservation_v2_apply",
              trustedConfirmationQualified: true,
              resolvedAt: "2026-08-06T00:00:00.000Z"
            }
          };
        }
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          applied.push(input);
          return { ok: true, value: { versionGroupId: "version_group_v2_apply" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const pending = await awaitPendingChangeSet(session, runId);
    await expect(
      session.decideChangeSet(
        changeSetCommand(
          runId,
          pending,
          changeSet as {
            readonly changeSetId: string;
            readonly revision: number;
            readonly checksum: string;
          },
          "apply_selected"
        )
      )
    ).resolves.toMatchObject({ ok: true });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      changeSet: { changeSetId: changeSet.changeSetId, checksum: changeSet.checksum },
      command: { decision: "apply_selected" },
      approvalContext: {
        workspaceBindingId: expect.any(String),
        operation: "chapter_replace",
        approvalBindingOperationKind: "chapter_replace",
        preview: {
          changeSetId: changeSet.changeSetId,
          revision: changeSet.revision,
          checksum: changeSet.checksum,
          displayBindingChecksum: changeSet.displayBindingChecksum,
          providerSemanticVersionSetChecksum: changeSet.providerSemanticVersionSetChecksum
        }
      }
    });
    expect(proofWrites).toHaveLength(1);
    expect(proofWrites[0]).toMatchObject({
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      proof: {
        operation: "chapter_replace",
        decision: "human_confirmation",
        binding: {
          changeSetId: changeSet.changeSetId,
          changeSetRevision: changeSet.revision,
          changeSetChecksum: changeSet.checksum,
          capabilityRevision: expect.any(String),
          policyRevision: expect.any(String)
        }
      }
    });
    const approvalContext = prepared[0]?.["approvalContext"] as {
      readonly workspaceBindingId: string;
      readonly proofRef: { readonly proofId: string };
    };
    const persistedProof = proofWrites[0]?.["proof"] as {
      readonly proofId: string;
      readonly binding: { readonly workspaceBindingId: string };
    };
    expect(approvalContext.workspaceBindingId).toBe(persistedProof.binding.workspaceBindingId);
    expect(approvalContext.proofRef.proofId).toBe(persistedProof.proofId);
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({
      authorizationId: "auth_v2_apply",
      reservationTransactionId: "reservation_v2_apply",
      changeSet: { changeSetId: changeSet.changeSetId }
    });
    expect(applied).toHaveLength(1);
    expect(legacyDecisions).toEqual([]);

    // A replayed command receipt may not mint another proof or invoke the confirmation surface.
    await expect(
      session.decideChangeSet(changeSetCommand(runId, pending, changeSet, "apply_selected"))
    ).resolves.toMatchObject({ ok: true });
    expect(proofWrites).toHaveLength(1);
    expect(prepared).toHaveLength(1);
  });

  test("rejects a v2 Change Set without a binding and clears its pending receipt state", async () => {
    const runId = "run_v2_reject";
    let providerSemanticVersionSetChecksum = "";
    let changeSet = await v2DiagnosticChangeSet(runId);
    const repository = durableMemoryRepository();
    const rejected: Record<string, unknown>[] = [];
    const legacyDecisions: Record<string, unknown>[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository,
      newRunToolFacadeVersion: "v2",
      agentGuidanceV3: true,
      capabilitySnapshot: { ...creativeV2Capabilities(), writingOperations: ["chapter_replace"] },
      modelDriver: { streamRound: v2ChapterProposalRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      changeSetSession: {
        bindRunProviderSemanticVersionSet(_runId: string, checksum: string) {
          providerSemanticVersionSetChecksum = checksum;
          return { ok: true as const, value: undefined };
        },
        async proposeChapterWrite() {
          changeSet = await v2DiagnosticChangeSet(runId, providerSemanticVersionSetChecksum);
          return { ok: true, value: changeSet };
        },
        async decide(command: Record<string, unknown>) {
          legacyDecisions.push(command);
          throw new Error("a v2 rejection must never use legacy decide");
        },
        async rejectV2(input: Record<string, unknown>) {
          rejected.push(input);
          return {
            ok: true,
            value: {
              schemaVersion: "2.0",
              decision: "reject_all",
              resolvedAt: input["resolvedAt"],
              displayBindingChecksum: changeSet.displayBindingChecksum
            }
          };
        }
      }
    });

    await session.startAgentRun(startCommand());
    const pending = await awaitPendingChangeSet(session, runId);
    const command = changeSetCommand(runId, pending, changeSet, "reject_all");
    await expect(session.decideChangeSet(command)).resolves.toMatchObject({ ok: true });

    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      displayBindingChecksum: changeSet.displayBindingChecksum
    });
    expect(rejected[0]).not.toHaveProperty("binding");
    expect(rejected[0]).not.toHaveProperty("reservationTransactionId");
    expect(legacyDecisions).toEqual([]);
    await expect(session.readAgentRun(runId)).resolves.toMatchObject({
      value: {
        snapshot: {
          status: "executing_model",
          pendingChangeSetId: null,
          pendingChangeSetRevision: null,
          pendingChangeSetChecksum: null
        }
      }
    });
    await expect(
      repository.readCommandReceipt(runId, String(command["commandId"]))
    ).resolves.toMatchObject({
      ok: true,
      value: { ok: true }
    });
  });

  test("fails closed for v2 apply when the trusted Main bridge is absent or throws", async () => {
    for (const [runId, bridge] of [
      ["run_v2_bridge_absent", undefined],
      [
        "run_v2_bridge_error",
        {
          async prepare() {
            throw new Error("Main surface failed");
          }
        }
      ]
    ] as const) {
      let providerSemanticVersionSetChecksum = "";
      let changeSet = await v2DiagnosticChangeSet(runId);
      const legacyDecisions: Record<string, unknown>[] = [];
      const decided: Record<string, unknown>[] = [];
      const session = createSession({
        coordinatorOptions: { createRunId: () => runId },
        repository: durableMemoryRepository(),
        newRunToolFacadeVersion: "v2",
        agentGuidanceV3: true,
        capabilitySnapshot: { ...creativeV2Capabilities(), writingOperations: ["chapter_replace"] },
        modelDriver: { streamRound: v2ChapterProposalRound },
        startPreflight: echoStartPreflight(),
        readToolExecutor: readExecutor,
        changeSetSession: {
          bindRunProviderSemanticVersionSet(_runId: string, checksum: string) {
            providerSemanticVersionSetChecksum = checksum;
            return { ok: true as const, value: undefined };
          },
          async proposeChapterWrite() {
            changeSet = await v2DiagnosticChangeSet(runId, providerSemanticVersionSetChecksum);
            return { ok: true, value: changeSet };
          },
          async persistApprovalDecisionProof(input: Record<string, unknown>) {
            const proof = input["proof"] as { readonly proofId: string };
            return {
              ok: true,
              value: { proofId: proof.proofId, proofChecksum: "c".repeat(64) }
            };
          },
          async decide(command: Record<string, unknown>) {
            legacyDecisions.push(command);
            throw new Error("a v2 Change Set must never fall back to legacy decide");
          },
          async decideV2(input: Record<string, unknown>) {
            decided.push(input);
            throw new Error("a missing or failed bridge must not reach decideV2");
          },
          async rejectV2() {
            throw new Error("unused");
          }
        },
        versionGroupExecutor: {
          async apply() {
            throw new Error("a failed bridge must not apply the Change Set");
          },
          async undoRun() {
            throw new Error("unused");
          }
        },
        ...(bridge === undefined ? {} : { changeSetApprovalV2: bridge })
      });

      await session.startAgentRun(startCommand());
      const pending = await awaitPendingChangeSet(session, runId);
      const command = changeSetCommand(runId, pending, changeSet, "apply_selected");
      if (bridge === undefined) {
        await expect(session.decideChangeSet(command)).resolves.toMatchObject({
          ok: false,
          error: { code: "CHANGE_SET_TRUSTED_SURFACE_UNAVAILABLE" }
        });
      } else {
        await expect(session.decideChangeSet(command)).resolves.toMatchObject({
          ok: false,
          error: { code: "CHANGE_SET_TRUSTED_SURFACE_FAILED" }
        });
      }
      expect(decided).toEqual([]);
      expect(legacyDecisions).toEqual([]);
      await expect(session.readAgentRun(runId)).resolves.toMatchObject({
        value: {
          snapshot: {
            status: "awaiting_write_approval",
            pendingChangeSetId: changeSet.changeSetId,
            pendingChangeSetRevision: changeSet.revision,
            pendingChangeSetChecksum: changeSet.checksum
          }
        }
      });
    }
  });

  test("keeps explicit legacy Change Set approvals on the historical decide path", async () => {
    const runId = "run_legacy_historical_apply";
    const changeSet = diagnosticChangeSet(runId);
    const legacyDecisions: Record<string, unknown>[] = [];
    const applied: Record<string, unknown>[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v1",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: { streamRound: legacyChapterProposalRound },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor,
      changeSetSession: {
        async proposeChapterWrite() {
          return { ok: true, value: changeSet };
        },
        async decide(command: Record<string, unknown>) {
          legacyDecisions.push(command);
          return {
            ok: true,
            value: {
              schemaVersion: "1.1",
              decision: "apply_selected",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-08-06T00:00:00.000Z",
              binding: {
                changeSetId: changeSet.changeSetId,
                revision: changeSet.revision,
                checksum: changeSet.checksum,
                approvalToken: changeSet.approvalToken
              }
            }
          };
        },
        async decideV2() {
          throw new Error("legacy Change Sets must not enter the v2 gate");
        },
        async rejectV2() {
          throw new Error("unused");
        }
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          applied.push(input);
          return { ok: true, value: { versionGroupId: "version_group_legacy_apply" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const pending = await awaitPendingChangeSet(session, runId);
    await expect(
      session.decideChangeSet(
        changeSetCommand(
          runId,
          pending,
          changeSet as {
            readonly changeSetId: string;
            readonly revision: number;
            readonly checksum: string;
          },
          "apply_selected"
        )
      )
    ).resolves.toMatchObject({ ok: true });
    expect(legacyDecisions).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  test("starts a non-Guidance v2 facade with no legacy mutation aliases", async () => {
    const runId = "run_v2_schema_1_read_only";
    let toolNames: readonly string[] = [];
    const session = createSession({
      coordinatorOptions: { createRunId: () => runId },
      repository: durableMemoryRepository(),
      newRunToolFacadeVersion: "v2",
      capabilitySnapshot: creativeV2Capabilities(),
      modelDriver: {
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
          toolNames = input.tools.map((tool) => tool.name);
          yield { type: "round_completed" as const, finishReason: "stop" as const };
        }
      },
      startPreflight: echoStartPreflight(),
      readToolExecutor: readExecutor
    });

    await expect(session.startAgentRun(startCommand())).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(toolNames).not.toEqual([]));
    expect(toolNames).not.toEqual(
      expect.arrayContaining([
        "edit_text",
        "create_resource",
        "manage_path",
        "create_story_bible",
        "patch_story_bible",
        "set_story_bible_status",
        "restore_story_bible"
      ])
    );
  });
});

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
          ...(command["executionWritePolicyDraft"] === undefined
            ? {}
            : { executionWritePolicyDraft: command["executionWritePolicyDraft"] }),
          userRequest: command["userRequest"] ?? "",
          ...(command["writingTaskIntent"] === undefined
            ? {}
            : { writingTaskIntent: command["writingTaskIntent"] }),
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
              contextWindow: snapshot["contextWindow"] ?? 128000,
              ...(snapshot["promptCache"] === undefined
                ? {}
                : { promptCache: snapshot["promptCache"] })
            },
            requiredContextTokens: snapshot["requiredContextTokens"] ?? 8000,
            reasoningStrength,
            ...(snapshot["connectionIdentityChecksum"] === undefined
              ? {}
              : { connectionIdentityChecksum: snapshot["connectionIdentityChecksum"] }),
            ...(snapshot["accountIsolationChecksum"] === undefined
              ? {}
              : { accountIsolationChecksum: snapshot["accountIsolationChecksum"] })
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

function cacheablePromptCapability() {
  return {
    mode: "explicit_breakpoints" as const,
    policyVersion: "anthropic-ephemeral@2.0",
    minimumCacheableTokens: 1,
    ttlSeconds: 300,
    inputTokenSemantics: "excluded_from_input" as const,
    reportsCacheReadTokens: true,
    reportsCacheWriteTokens: true
  };
}

function testCapabilityBoundary() {
  return {
    canonicalRootIdentityChecksum: "1".repeat(64),
    effectiveCapabilityStateChecksum: "2".repeat(64),
    sharingDefaultsRevision: "3".repeat(64),
    sharingGrantRevision: "4".repeat(64),
    policyRevision: "policy_01",
    providerToolProjectionChecksum: "5".repeat(64),
    providerSemanticVersionSetChecksum: "6".repeat(64)
  };
}

function promptCacheMemoryRepository() {
  const repository = durableMemoryRepository();
  const promptCacheArtifacts = new Map<string, Record<string, unknown>>();
  return {
    ...repository,
    async writePromptCacheArtifact(runId: string, artifact: Record<string, unknown>) {
      promptCacheArtifacts.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true as const, value: artifact };
    },
    async readPromptCacheArtifact(runId: string, artifactId: string) {
      return {
        ok: true as const,
        value: promptCacheArtifacts.get(`${runId}:${artifactId}`)
      };
    }
  };
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
  const toolCatalogs = new Map<string, Record<string, unknown>>();
  const contextSnapshots = new Map<string, Record<string, unknown>>();
  const promptMaterializations = new Map<string, Record<string, unknown>>();
  const contextSourceMaterializations = new Map<string, Record<string, unknown>>();
  const budgetSnapshots = new Map<string, Record<string, unknown>>();
  const compactionSummaryArtifacts = new Map<string, Record<string, unknown>>();
  const planArtifacts = new Map<string, Record<string, unknown>>();
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
    async commitRunStateV20(input: {
      readonly snapshot: AgentRunSnapshotV20;
      readonly event: AgentRunEventV20;
    }) {
      const prior = events.get(input.snapshot.runId) ?? [];
      if (!prior.some((event) => event["sequence"] === input.event.sequence)) {
        events.set(input.snapshot.runId, [
          ...prior,
          structuredClone(input.event)
        ] as unknown as Record<string, unknown>[]);
      }
      snapshots.set(
        input.snapshot.runId,
        structuredClone(input.snapshot) as unknown as Record<string, unknown>
      );
      return { ok: true as const, value: input.snapshot };
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
    async readSnapshotV20(runId: string) {
      const snapshot = snapshots.get(runId);
      if (snapshot === undefined) return { ok: true as const, value: undefined };
      if (snapshot["schemaVersion"] !== "2.0") {
        return {
          ok: false as const,
          error: testRepositoryError("AGENT_RUN_SNAPSHOT_V20_LEGACY_RECORD")
        };
      }
      return { ok: true as const, value: snapshot as unknown as AgentRunSnapshotV20 };
    },
    async readEventsV20(runId: string) {
      return {
        ok: true as const,
        value: (events.get(runId) ?? []) as unknown as AgentRunEventV20[]
      };
    },
    async writeToolCatalog(runId: string, catalog: Record<string, unknown>) {
      toolCatalogs.set(
        `${runId}:${String(catalog["toolCatalogSnapshotId"])}`,
        structuredClone(catalog)
      );
      return { ok: true, value: catalog };
    },
    async readToolCatalog(runId: string, toolCatalogSnapshotId: string) {
      return {
        ok: true,
        value: toolCatalogs.get(`${runId}:${toolCatalogSnapshotId}`)
      };
    },
    async writeContextSnapshot(snapshot: Record<string, unknown>) {
      contextSnapshots.set(
        `${String(snapshot["runId"])}:${String(snapshot["contextSnapshotId"])}`,
        structuredClone(snapshot)
      );
      return { ok: true, value: snapshot };
    },
    async readContextSnapshot(runId: string, contextSnapshotId: string) {
      return { ok: true, value: contextSnapshots.get(`${runId}:${contextSnapshotId}`) };
    },
    async writeBudgetSnapshot(runId: string, snapshot: Record<string, unknown>) {
      budgetSnapshots.set(
        `${runId}:${String(snapshot["contextBudgetSnapshotId"])}`,
        structuredClone(snapshot)
      );
      return { ok: true, value: snapshot };
    },
    async readBudgetSnapshot(runId: string, contextBudgetSnapshotId: string) {
      return { ok: true, value: budgetSnapshots.get(`${runId}:${contextBudgetSnapshotId}`) };
    },
    async writeCompactionSummaryArtifact(runId: string, artifact: Record<string, unknown>) {
      compactionSummaryArtifacts.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true, value: artifact };
    },
    async readCompactionSummaryArtifact(runId: string, artifactId: string) {
      return { ok: true, value: compactionSummaryArtifacts.get(`${runId}:${artifactId}`) };
    },
    async writePromptMaterialization(runId: string, artifact: Record<string, unknown>) {
      promptMaterializations.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true, value: artifact };
    },
    async readPromptMaterialization(runId: string, artifactId: string) {
      return { ok: true, value: promptMaterializations.get(`${runId}:${artifactId}`) };
    },
    async writeContextSourceMaterialization(runId: string, artifact: Record<string, unknown>) {
      contextSourceMaterializations.set(
        `${runId}:${String(artifact["artifactId"])}`,
        structuredClone(artifact)
      );
      return { ok: true, value: artifact };
    },
    async readContextSourceMaterialization(runId: string, artifactId: string) {
      return { ok: true, value: contextSourceMaterializations.get(`${runId}:${artifactId}`) };
    },
    async writePlanArtifact(plan: Record<string, unknown>) {
      planArtifacts.set(
        `${String(plan["planId"])}:${String(plan["revision"])}`,
        structuredClone(plan)
      );
      return { ok: true, value: plan };
    },
    async readPlanArtifact(planId: string, revision: number) {
      return { ok: true, value: planArtifacts.get(`${planId}:${String(revision)}`) };
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
        value: [...snapshots.values()].filter((snapshot) => {
          const scope = snapshot["scope"];
          return (
            snapshot["projectId"] === projectId ||
            (typeof scope === "object" &&
              scope !== null &&
              !Array.isArray(scope) &&
              (scope as Record<string, unknown>)["workspaceId"] === projectId)
          );
        })
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

function testRepositoryError(code: string) {
  return {
    schemaVersion: "1.0" as const,
    errorId: `test_${code.toLowerCase()}`,
    code,
    category: "StorageError" as const,
    message: "The requested test repository record uses another schema version.",
    recoverability: "fatal" as const,
    suggestedAction: "Use the matching strict or legacy test reader.",
    traceId: "agent-run-session-test",
    createdAt: "2026-08-04T00:00:00.000Z"
  };
}

function creativeV2Capabilities(): AgentToolCapabilitySnapshot {
  return {
    workspaceKind: "creativeProject",
    searchEnabled: true,
    fileLifecycleEnabled: true,
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkReadEnabled: false,
    pluginToolsEnabled: false,
    mcpToolsEnabled: false,
    featureFlagRevision: "v2-test"
  };
}

function networkReadResult() {
  return {
    kind: "untrusted_remote_data" as const,
    url: "https://example.test/status",
    fetchedAt: "2026-07-25T00:00:00.000Z",
    contentDigest: "a".repeat(64),
    contentSummary: "ok",
    truncated: false,
    sourceLabel: "test"
  };
}

async function v2DiagnosticChangeSet(
  runId: string,
  providerSemanticVersionSetChecksum = "a".repeat(64)
) {
  const baseContent = "before";
  return createChangeSetRevisionV2(
    {
      changeSetId: `changes_v2_${runId}`,
      runId,
      projectId: "project-01",
      checkpointId: `checkpoint_v2_${runId}`,
      contextSnapshotId: `context_v2_${runId}`,
      writePolicy: "write_before_confirmation",
      createdAt: "2026-08-06T00:00:00.000Z",
      providerSemanticVersionSetChecksum,
      proposal: {
        relativePath: "chapters/chapter-01.md",
        assetType: "chapter",
        baseContent,
        baseChecksum: createHash("sha256").update(baseContent).digest("hex"),
        range: { unit: "character", start: 0, end: baseContent.length },
        replacement: "after"
      }
    },
    { createHunkId: () => `hunk_v2_${runId}` }
  );
}

async function* v2ChapterProposalRound() {
  yield toolCall("v2-change-set-proposal", "edit_text", {
    ref: "chapter:chapter-01",
    baseHash: createHash("sha256").update("before").digest("hex"),
    range: { unit: "character", start: 0, end: "before".length },
    replacement: "after"
  });
  yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
}

async function* legacyChapterProposalRound() {
  yield toolCall("legacy-change-set-proposal", "propose_chapter_write", {
    chapterId: "chapter-01",
    baseHash: createHash("sha256").update("before").digest("hex"),
    range: { unit: "character", start: 0, end: "before".length },
    replacement: "after"
  });
  yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
}

async function awaitPendingChangeSet(
  session: { readonly readAgentRun: (runId: string) => Promise<Record<string, unknown>> },
  runId: string
): Promise<number> {
  await vi.waitFor(async () => {
    expect(await session.readAgentRun(runId)).toMatchObject({
      value: { snapshot: { status: "awaiting_write_approval" } }
    });
  });
  const read = await session.readAgentRun(runId);
  const value = read["value"] as { readonly snapshot: { readonly runRevision: number } };
  return value.snapshot.runRevision;
}

function changeSetCommand(
  runId: string,
  expectedRunRevision: number,
  changeSet: {
    readonly changeSetId: string;
    readonly revision: number;
    readonly checksum: string;
  },
  decision: "apply_selected" | "reject_all"
): Record<string, unknown> {
  return {
    projectId: "project-01",
    runId,
    commandId: `${runId}:${decision}`,
    expectedRunRevision,
    changeSetId: changeSet.changeSetId,
    revision: changeSet.revision,
    checksum: changeSet.checksum,
    decision
  };
}

function v2Approval(
  changeSet: {
    readonly displayBindingChecksum: string;
  },
  decision: "apply_selected" | "reject_all"
): Record<string, unknown> {
  return {
    schemaVersion: "2.0",
    decision,
    approvalSource: "human_confirmation",
    resolvedAt: "2026-08-06T00:00:00.000Z",
    displayBindingChecksum: changeSet.displayBindingChecksum,
    authorizationId: "auth_v2",
    reservationTransactionId: "reservation_v2",
    binding: { mainOnly: true }
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
