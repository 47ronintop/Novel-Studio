import { describe, expect, test } from "vitest";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  LEGACY_AGENT_CONVERSATION_ID,
  createAgentConversationSession,
  type AgentConversationDiagnostic,
  type AgentConversationPersistenceListPage,
  type AgentConversationPersistencePort,
  type AgentConversationPersistenceSearchPage
} from "../src/agent-conversation-session.js";
import * as browserExports from "../src/browser-index.js";

describe("AgentConversationSession", () => {
  test("creates one idempotent empty conversation and derives its first title from a run", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    const first = await session.createConversation({
      projectId: "project_01",
      commandId: "cmd_create"
    });
    expect(
      await session.createConversation({ projectId: "project_01", commandId: "cmd_create" })
    ).toEqual(first);
    expect(first).toMatchObject({
      ok: true,
      value: { conversationId: "conv_01", title: "新会话", revision: 1, runCount: 0 }
    });

    expect(
      await session.noteRunStarted(
        runSnapshot({
          runId: "run_title",
          userRequest: "  统一\n第 3 章的人物动机，并保留现有结尾  "
        })
      )
    ).toMatchObject({
      ok: true,
      value: { title: "统一 第 3 章的人物动机，并保留现有结尾", revision: 2, runCount: 1 }
    });
  });

  test("archives and restores with revision checks and refuses active run ownership", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.runs.push(runSnapshot({ runId: "run_active", status: "planning_model" }));

    expect(
      await session.archiveConversation(statusCommand("cmd_archive_blocked", 1))
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_ARCHIVE_BLOCKED" } });
    port.runs[0] = { ...port.runs[0], status: "completed" };
    expect(await session.archiveConversation(statusCommand("cmd_archive", 1))).toMatchObject({
      ok: true,
      value: { status: "archived", revision: 2 }
    });
    expect(await session.restoreConversation(statusCommand("cmd_restore_zero", 0))).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_REVISION_CONFLICT" },
      latestConversation: { revision: 2, status: "archived" }
    });
    expect(await session.restoreConversation(statusCommand("cmd_restore_stale", 1))).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_REVISION_CONFLICT" },
      latestConversation: { revision: 2, status: "archived" }
    });
    expect(await session.restoreConversation(statusCommand("cmd_restore", 2))).toMatchObject({
      ok: true,
      value: { status: "active", revision: 3 }
    });
  });

  test("lists and reads conversation runs without leaking another project", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.runs.push(
      runSnapshot({ runId: "run_old", updatedAt: "2026-07-14T00:00:00.000Z" }),
      runSnapshot({ runId: "run_new", updatedAt: "2026-07-14T02:00:00.000Z" }),
      runSnapshot({ runId: "run_other", projectId: "project_02" })
    );

    expect(await session.listConversations({ projectId: "project_01" })).toMatchObject({
      ok: true,
      value: {
        items: [{ conversationId: "conv_01", runCount: 2, lastRunId: "run_new" }],
        diagnostics: []
      }
    });
    expect(
      await session.readConversation({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({
      ok: true,
      value: { runs: [{ runId: "run_new" }, { runId: "run_old" }] }
    });
  });

  test("restores assistant text and sanitized activity events from persisted run events", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.runs.push(runSnapshot({ runRevision: 5, lastSequence: 5 }));
    port.events.set("run_01", [
      runEvent("run_01", 1, "tool_started", {
        toolCallId: "read-01",
        toolName: "read_chapter",
        summary: "正在读取第一章",
        argumentsText: '{"chapterId":"chapter-01"}'
      }),
      runEvent("run_01", 2, "tool_completed", {
        toolCallId: "read-01",
        toolName: "read_chapter",
        summary: "已读取第一章",
        relativePath: "chapters/chapter-01.md",
        providerFrame: "raw-provider-frame"
      }),
      runEvent("run_01", 3, "assistant_text_completed", { text: "第一章线索已经核对。" }),
      runEvent("run_01", 4, "run_completed", { summary: "核对完成。" })
    ]);

    const read = await session.readConversation({
      projectId: "project_01",
      conversationId: "conv_01"
    });

    expect(read).toMatchObject({
      ok: true,
      value: {
        runs: [
          {
            runId: "run_01",
            assistantText: "核对完成。",
            events: [
              { sequence: 1, type: "tool_started" },
              { sequence: 2, type: "tool_completed" }
            ]
          }
        ]
      }
    });
    expect(JSON.stringify(read)).not.toContain("argumentsText");
    expect(JSON.stringify(read)).not.toContain("raw-provider-frame");
  });

  test("exposes non-empty old runs through a read-only virtual conversation", async () => {
    const port = new MemoryConversationPort();
    port.runs.push(runSnapshot({ runId: "run_legacy", conversationId: null }));
    const session = createSession(port);

    expect(await session.listConversations({ projectId: "project_01" })).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            conversationId: LEGACY_AGENT_CONVERSATION_ID,
            title: "历史 Agent 运行",
            virtual: true,
            runCount: 1
          }
        ]
      }
    });
    expect(
      await session.assertRunMayStart({
        projectId: "project_01",
        conversationId: LEGACY_AGENT_CONVERSATION_ID
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_READ_ONLY" } });
  });

  test("binds commands to one project before receipt lookup", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.readReceiptCalls = 0;
    port.receipts.set("conv_01:cmd_archive", {
      ok: true,
      value: conversationSummary({ projectId: "project_01" })
    });

    expect(
      await session.createConversation({ projectId: "project_02", commandId: "cmd_create" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_PROJECT_MISMATCH" } });
    expect(
      await session.archiveConversation({
        ...statusCommand("cmd_archive", 1),
        projectId: "project_02"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_PROJECT_MISMATCH" } });
    expect(port.readReceiptCalls).toBe(0);
  });

  test("recovers create, archive, and restore after receipt persistence failures", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);

    port.failNextReceiptWrites = 1;
    expect(
      await session.createConversation({ projectId: "project_01", commandId: "cmd_create" })
    ).toMatchObject({ ok: false, error: { code: "TEST_RECEIPT_WRITE_FAILED" } });
    expect(
      await session.createConversation({ projectId: "project_01", commandId: "cmd_create" })
    ).toMatchObject({ ok: true, value: { revision: 1, status: "active" } });

    port.failNextReceiptWrites = 1;
    expect(await session.archiveConversation(statusCommand("cmd_archive", 1))).toMatchObject({
      ok: false,
      error: { code: "TEST_RECEIPT_WRITE_FAILED" }
    });
    expect(await session.archiveConversation(statusCommand("cmd_archive", 1))).toMatchObject({
      ok: true,
      value: { revision: 2, status: "archived" }
    });

    port.failNextReceiptWrites = 1;
    expect(await session.restoreConversation(statusCommand("cmd_restore", 2))).toMatchObject({
      ok: false,
      error: { code: "TEST_RECEIPT_WRITE_FAILED" }
    });
    expect(await session.restoreConversation(statusCommand("cmd_restore", 2))).toMatchObject({
      ok: true,
      value: { revision: 3, status: "active" }
    });
  });

  test("blocks archive while a run start is reserved and allows explicit cancellation", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });

    expect(
      await session.assertRunMayStart({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({ ok: true });
    expect(
      await session.archiveConversation(statusCommand("cmd_archive_blocked", 1))
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_ARCHIVE_BLOCKED" } });
    expect(
      await session.cancelRunStart({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({ ok: true });
    expect(await session.archiveConversation(statusCommand("cmd_archive", 1))).toMatchObject({
      ok: true,
      value: { status: "archived" }
    });
  });

  test("repairs a failed run note once and never regresses its timestamp", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    const snapshot = runSnapshot({
      runId: "run_repair",
      updatedAt: "2026-07-14T04:00:00.000Z",
      userRequest: "Repair the metadata"
    });
    port.failNextUpdates = 1;

    expect(await session.noteRunStarted(snapshot)).toMatchObject({
      ok: false,
      error: { code: "TEST_UPDATE_FAILED" }
    });
    expect(await session.noteRunStarted(snapshot)).toMatchObject({
      ok: true,
      value: { revision: 2, updatedAt: "2026-07-14T04:00:00.000Z", runCount: 1 }
    });
    expect(
      await session.noteRunStarted({ ...snapshot, updatedAt: "2026-07-14T03:00:00.000Z" })
    ).toMatchObject({
      ok: true,
      value: { revision: 2, updatedAt: "2026-07-14T04:00:00.000Z", runCount: 1 }
    });
  });

  test("degrades corrupt summaries and rejects an empty legacy read", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.latestSummaryResult = failure("AGENT_CONVERSATION_SUMMARY_INVALID");

    expect(
      await session.readConversation({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({
      ok: true,
      value: {
        summaryFreshness: "unavailable",
        diagnostics: [{ code: "AGENT_CONVERSATION_SUMMARY_INVALID" }]
      }
    });
    expect(
      await session.readConversation({
        projectId: "project_01",
        conversationId: LEGACY_AGENT_CONVERSATION_ID
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_NOT_FOUND" } });
  });

  test("filters active records before pagination and preserves partial diagnostics", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    for (let index = 0; index < 35; index += 1) {
      port.records.set(`conv_archived_${index}`, {
        ...conversationRecord(`conv_archived_${index}`),
        status: "archived",
        updatedAt: `2026-07-14T02:${String(index).padStart(2, "0")}:00.000Z`
      });
    }
    port.records.set("conv_active", conversationRecord("conv_active"));
    port.records.set("conv_invalid", {
      projectId: "project_01",
      status: "active",
      updatedAt: "2026-07-14T00:30:00.000Z"
    });
    port.listDiagnostics = [{ conversationId: "conv_bad", code: "AGENT_CONVERSATION_READ_FAILED" }];

    expect(await session.listConversations({ projectId: "project_01" })).toMatchObject({
      ok: true,
      value: {
        items: [{ conversationId: "conv_active" }],
        diagnostics: [
          { conversationId: "conv_bad", code: "AGENT_CONVERSATION_READ_FAILED" },
          { code: "AGENT_CONVERSATION_RECORD_INVALID" }
        ]
      }
    });
    expect(port.listInputs.at(-1)).toMatchObject({ status: "active", limit: 30 });
  });

  test("blocks archive for a pending review even when every run is terminal", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.runs.push(runSnapshot({ status: "completed" }));
    port.pendingReview = true;

    expect(await session.archiveConversation(statusCommand("cmd_archive", 1))).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_ARCHIVE_BLOCKED" }
    });
  });

  test("builds deterministic summaries from completed assistant turns with legacy delta fallback", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    const legacy = runSnapshot({
      runId: "run_legacy_delta",
      runRevision: 2,
      lastSequence: 4,
      updatedAt: "2026-07-14T01:00:00.000Z",
      userRequest: "旧请求"
    });
    const current = runSnapshot({
      runId: "run_completed_text",
      runRevision: 3,
      lastSequence: 7,
      updatedAt: "2026-07-14T02:00:00.000Z",
      userRequest: "当前请求"
    });
    port.runs.push(legacy, current);
    port.events.set("run_legacy_delta", [
      runEvent("run_legacy_delta", 1, "assistant_text_delta", { delta: "旧" }),
      runEvent("run_legacy_delta", 2, "assistant_text_delta", { delta: "回答" }),
      runEvent("run_legacy_delta", 3, "tool_completed", { summary: "读取了章节" }),
      runEvent("run_legacy_delta", 4, "run_completed")
    ]);
    port.events.set("run_completed_text", [
      runEvent("run_completed_text", 1, "assistant_text_delta", { delta: "不应重复" }),
      runEvent("run_completed_text", 2, "assistant_text_completed", { text: "完整回答" }),
      runEvent("run_completed_text", 3, "assistant_text_delta", { delta: "第二轮" }),
      runEvent("run_completed_text", 4, "assistant_text_completed", { text: "第二轮" }),
      runEvent("run_completed_text", 7, "run_completed")
    ]);

    expect(await session.noteRunTerminal(current)).toEqual({ ok: true, value: undefined });
    expect(port.summaries).toHaveLength(1);
    expect(port.summaries[0]).toMatchObject({
      conversationId: "conv_01",
      revision: 1,
      sourceRunIds: ["run_legacy_delta", "run_completed_text"],
      throughRunId: "run_completed_text",
      throughRunRevision: 3,
      throughRunLastSequence: 7
    });
    const content = JSON.parse(String(port.summaries[0]?.["content"])) as {
      recentRuns: { runId: string; assistantTurns?: string[] }[];
    };
    expect(content.recentRuns).toEqual([
      expect.objectContaining({ runId: "run_legacy_delta", assistantTurns: ["旧回答"] }),
      expect.objectContaining({
        runId: "run_completed_text",
        assistantTurns: ["完整回答", "第二轮"]
      })
    ]);
    expect(String(port.summaries[0]?.["content"])).not.toContain("不应重复");
  });

  test("loads at most six recent runs within 8 KiB and never crosses conversation ownership", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    for (let index = 1; index <= 7; index += 1) {
      const runId = `run_${index}`;
      port.runs.push(
        runSnapshot({
          runId,
          lastSequence: 2,
          updatedAt: `2026-07-14T0${String(index)}:00:00.000Z`,
          userRequest: `请求 ${index} ${"章".repeat(600)}`
        })
      );
      port.events.set(runId, [
        runEvent(runId, 1, "assistant_text_completed", {
          text: `回答 ${index} ${"文".repeat(900)}`
        }),
        runEvent(runId, 2, "run_completed")
      ]);
    }
    port.runs.push(
      runSnapshot({
        runId: "run_other_conversation",
        conversationId: "conv_other",
        userRequest: "other conversation secret"
      })
    );
    port.events.set("run_other_conversation", [
      runEvent("run_other_conversation", 1, "assistant_text_completed", {
        text: "other conversation secret"
      })
    ]);

    const loaded = await session.loadContext({
      projectId: "project_01",
      conversationId: "conv_01"
    });
    expect(loaded).toMatchObject({ ok: true, value: [{ role: "system" }] });
    if (!loaded.ok) return;
    const serialized = loaded.value.map((message) => message.content).join("\n");
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(serialized).not.toContain("other conversation secret");
    const content = JSON.parse(serialized) as { recentRuns: { runId: string }[] };
    expect(content.recentRuns.map((run) => run.runId)).toEqual([
      "run_2",
      "run_3",
      "run_4",
      "run_5",
      "run_6",
      "run_7"
    ]);
  });

  test("keeps summary source boundaries within the repository limit", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    for (let index = 1; index <= 101; index += 1) {
      port.runs.push(
        runSnapshot({
          runId: `run_${String(index).padStart(3, "0")}`,
          updatedAt: `2026-07-${String(index).padStart(3, "0")}T00:00:00.000Z`
        })
      );
    }

    expect(await session.noteRunTerminal(port.runs.at(-1) ?? {})).toEqual({
      ok: true,
      value: undefined
    });
    expect(port.summaries[0]?.["sourceRunIds"]).toHaveLength(100);
    expect(port.summaries[0]?.["sourceRunIds"]).not.toContain("run_001");
  });

  test("marks an immutable summary stale after undo and refreshes at the new run boundary", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    const terminal = runSnapshot({ runRevision: 3, lastSequence: 5 });
    port.runs.push(terminal);
    port.events.set("run_01", [
      runEvent("run_01", 1, "assistant_text_completed", { text: "已完成" }),
      runEvent("run_01", 5, "run_completed")
    ]);
    expect(await session.noteRunTerminal(terminal)).toEqual({ ok: true, value: undefined });

    const undone = { ...terminal, runRevision: 4, lastSequence: 8 };
    port.runs[0] = undone;
    port.events.set("run_01", [
      ...(port.events.get("run_01") ?? []),
      runEvent("run_01", 8, "run_undone", { status: "applied" })
    ]);
    expect(
      await session.readConversation({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({ ok: true, value: { summaryFreshness: "stale" } });

    expect(
      await session.loadContext({ projectId: "project_01", conversationId: "conv_01" })
    ).toMatchObject({ ok: true });
    expect(port.summaries).toHaveLength(2);
    expect(port.summaries[1]).toMatchObject({
      revision: 2,
      throughRunId: "run_01",
      throughRunRevision: 4,
      throughRunLastSequence: 8
    });
  });

  test("assembles Chinese search documents from title, latest summary, and run requests only", async () => {
    const port = new MemoryConversationPort();
    const session = createSession(port);
    await session.createConversation({ projectId: "project_01", commandId: "cmd_create" });
    port.records.set("conv_01", {
      ...port.records.get("conv_01"),
      title: "雪山追逐"
    });
    const run = runSnapshot({
      userRequest: "调整第三章的人物动机",
      runRevision: 2,
      lastSequence: 3
    });
    port.runs.push(run);
    port.events.set("run_01", [
      runEvent("run_01", 1, "assistant_text_completed", {
        text: "assistant secret must not enter search"
      })
    ]);
    port.summaries.push({
      schemaVersion: "1.0",
      conversationId: "conv_01",
      revision: 1,
      sourceRunIds: ["run_01"],
      throughRunId: "run_01",
      throughRunRevision: 2,
      throughRunLastSequence: 3,
      content: "林夏确认了父亲留下的线索",
      createdAt: "2026-07-14T02:00:00.000Z"
    });

    for (const query of ["雪山", "父亲留下", "人物动机"]) {
      expect(await session.searchConversations({ projectId: "project_01", query })).toMatchObject({
        ok: true,
        value: { items: [{ conversationId: "conv_01" }] }
      });
    }
    expect(port.searchInputs).toHaveLength(3);
    const document = (port.searchInputs[0]?.["documents"] as JsonObject[] | undefined)?.[0];
    expect(document).toMatchObject({
      title: "雪山追逐",
      latestSummary: "林夏确认了父亲留下的线索",
      userRequests: ["调整第三章的人物动机"]
    });
    expect(JSON.stringify(document)).not.toContain("assistant secret");
  });

  test("rejects the reserved legacy id and exports browser-safe contracts", async () => {
    const port = new MemoryConversationPort();
    const session = createAgentConversationSession({
      projectId: "project_01",
      repository: port,
      runReader: port,
      createConversationId: () => LEGACY_AGENT_CONVERSATION_ID
    });
    expect(
      await session.createConversation({ projectId: "project_01", commandId: "cmd_create" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_ID_RESERVED" } });
    expect(browserExports.LEGACY_AGENT_CONVERSATION_ID).toBe(LEGACY_AGENT_CONVERSATION_ID);
  });
});

function createSession(port: MemoryConversationPort) {
  return createAgentConversationSession({
    projectId: "project_01",
    repository: port,
    runReader: port,
    createConversationId: () => "conv_01",
    now: (() => {
      let hour = 0;
      return () => `2026-07-14T${String(hour++).padStart(2, "0")}:00:00.000Z`;
    })()
  });
}

class MemoryConversationPort implements AgentConversationPersistencePort {
  public readonly records = new Map<string, JsonObject>();
  public readonly receipts = new Map<string, JsonObject>();
  public readonly runs: JsonObject[] = [];
  public readonly events = new Map<string, JsonObject[]>();
  public readonly summaries: JsonObject[] = [];
  public readonly searchInputs: {
    readonly projectId: string;
    readonly query: string;
    readonly includeArchived?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
    readonly documents: readonly JsonObject[];
  }[] = [];
  public readonly listInputs: JsonObject[] = [];
  public listDiagnostics: AgentConversationDiagnostic[] = [];
  public readReceiptCalls = 0;
  public failNextReceiptWrites = 0;
  public failNextUpdates = 0;
  public pendingReview = false;
  public latestSummaryResult: Result<JsonObject | undefined, UnifiedError> = ok(undefined);

  public createConversation(record: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const id = String(record["conversationId"]);
    const existing = this.records.get(id);
    if (existing !== undefined) {
      return Promise.resolve(
        JSON.stringify(existing) === JSON.stringify(record)
          ? ok(existing)
          : failure("AGENT_CONVERSATION_CREATE_CONFLICT")
      );
    }
    this.records.set(id, record);
    return Promise.resolve(ok(record));
  }

  public readConversation(id: string): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return Promise.resolve(ok(this.records.get(id)));
  }

  public listConversations(input: {
    readonly projectId: string;
    readonly status?: "active" | "archived";
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<Result<AgentConversationPersistenceListPage, UnifiedError>> {
    this.listInputs.push(input as JsonObject);
    const limit = Math.min(input.limit ?? 30, 100);
    const items = [...this.records.values()]
      .filter(
        (record) =>
          record["projectId"] === input.projectId &&
          (input.status === undefined || record["status"] === input.status)
      )
      .sort((left, right) => String(right["updatedAt"]).localeCompare(String(left["updatedAt"])))
      .slice(0, limit);
    return Promise.resolve(ok({ items, diagnostics: this.listDiagnostics }));
  }

  public updateConversation(input: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    if (this.failNextUpdates > 0) {
      this.failNextUpdates -= 1;
      return Promise.resolve(failure("TEST_UPDATE_FAILED"));
    }
    const id = String(input["conversationId"]);
    const record = this.records.get(id);
    if (record === undefined) return Promise.resolve(failure("AGENT_CONVERSATION_NOT_FOUND"));
    if (record["revision"] !== input["expectedRevision"]) {
      return Promise.resolve(failure("AGENT_CONVERSATION_REVISION_CONFLICT"));
    }
    const updatedAt = input["updatedAt"];
    if (typeof updatedAt !== "string") {
      return Promise.resolve(failure("AGENT_CONVERSATION_UPDATED_AT_INVALID"));
    }
    const next: JsonObject = {
      ...record,
      revision: Number(record["revision"]) + 1,
      updatedAt,
      ...(input["title"] === undefined ? {} : { title: input["title"] }),
      ...(input["status"] === undefined ? {} : { status: input["status"] }),
      ...(input["mutationCommandId"] === undefined
        ? {}
        : { lastMutationCommandId: input["mutationCommandId"] })
    };
    this.records.set(id, next);
    return Promise.resolve(ok(next));
  }

  public writeCommandReceipt(
    conversationId: string,
    commandId: string,
    receipt: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    if (this.failNextReceiptWrites > 0) {
      this.failNextReceiptWrites -= 1;
      return Promise.resolve(failure("TEST_RECEIPT_WRITE_FAILED"));
    }
    this.receipts.set(`${conversationId}:${commandId}`, receipt);
    return Promise.resolve(ok(receipt));
  }

  public readCommandReceipt(
    conversationId: string,
    commandId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    this.readReceiptCalls += 1;
    return Promise.resolve(ok(this.receipts.get(`${conversationId}:${commandId}`)));
  }

  public readLatestSummary(
    conversationId?: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>> {
    return this.latestSummaryResult.ok && this.latestSummaryResult.value === undefined
      ? Promise.resolve(
          ok(
            [...this.summaries]
              .reverse()
              .find(
                (summary) =>
                  conversationId === undefined || summary["conversationId"] === conversationId
              )
          )
        )
      : Promise.resolve(this.latestSummaryResult);
  }

  public searchConversations(input: {
    readonly projectId: string;
    readonly query: string;
    readonly includeArchived?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
    readonly documents: readonly JsonObject[];
  }): Promise<Result<AgentConversationPersistenceSearchPage, UnifiedError>> {
    this.searchInputs.push(input);
    const query = input.query.toLocaleLowerCase();
    return Promise.resolve(
      ok({
        items: input.documents
          .filter((document) =>
            [
              document["title"],
              document["latestSummary"],
              ...(Array.isArray(document["userRequests"]) ? document["userRequests"] : [])
            ].some(
              (value) => typeof value === "string" && value.toLocaleLowerCase().includes(query)
            )
          )
          .flatMap((document) => {
            const conversationId = document["conversationId"];
            const snippet = document["title"];
            return typeof conversationId === "string" && typeof snippet === "string"
              ? [{ conversationId, snippet }]
              : [];
          }),
        diagnostics: []
      })
    );
  }

  public writeSummary(summary: JsonObject): Promise<Result<JsonObject, UnifiedError>> {
    const existing = this.summaries.find(
      (candidate) => candidate["revision"] === summary["revision"]
    );
    if (existing !== undefined) {
      return Promise.resolve(
        JSON.stringify(existing) === JSON.stringify(summary)
          ? ok(existing)
          : failure("AGENT_CONVERSATION_SUMMARY_CONFLICT")
      );
    }
    this.summaries.push(summary);
    return Promise.resolve(ok(summary));
  }

  public listRunSnapshots(projectId: string): Promise<Result<JsonObject[], UnifiedError>> {
    return Promise.resolve(ok(this.runs.filter((run) => run["projectId"] === projectId)));
  }

  public readRunEvents(runId: string): Promise<Result<JsonObject[], UnifiedError>> {
    return Promise.resolve(ok(this.events.get(runId) ?? []));
  }

  public hasPendingReview(): Promise<Result<boolean, UnifiedError>> {
    return Promise.resolve(ok(this.pendingReview));
  }
}

function statusCommand(commandId: string, expectedConversationRevision: number) {
  return {
    projectId: "project_01",
    conversationId: "conv_01",
    commandId,
    expectedConversationRevision
  };
}

function conversationRecord(conversationId: string): JsonObject {
  return {
    schemaVersion: "1.0",
    conversationId,
    projectId: "project_01",
    revision: 1,
    title: "新会话",
    status: "active",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z"
  };
}

function conversationSummary(overrides: JsonObject = {}): JsonObject {
  return {
    ...conversationRecord("conv_01"),
    runCount: 0,
    summaryFreshness: "unavailable",
    ...overrides
  };
}

function runSnapshot(overrides: JsonObject = {}): JsonObject {
  return {
    schemaVersion: "1.0",
    runId: "run_01",
    conversationId: "conv_01",
    projectId: "project_01",
    userRequest: "检查当前章节",
    status: "completed",
    runRevision: 1,
    lastSequence: 1,
    startedAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    ...overrides
  };
}

function runEvent(runId: string, sequence: number, type: string, detail?: JsonObject): JsonObject {
  return {
    schemaVersion: "1.0",
    runId,
    projectId: "project_01",
    sequence,
    runRevision: sequence,
    type,
    createdAt: `2026-07-14T00:${String(sequence).padStart(2, "0")}:00.000Z`,
    ...(detail === undefined ? {} : { detail })
  };
}

function failure(code: string): { readonly ok: false; readonly error: UnifiedError } {
  return err({
    schemaVersion: "1.0",
    errorId: `err_${code.toLowerCase()}`,
    code,
    category: "AgentError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry.",
    traceId: "test-agent-conversation",
    createdAt: "2026-07-14T00:00:00.000Z"
  });
}
