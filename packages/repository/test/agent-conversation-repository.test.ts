import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { AgentConversationFileRepository } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentConversationFileRepository", () => {
  test("creates, reads, and lists conversations in stable newest-first order", async () => {
    const { projectRoot, repository } = await createRepository();
    const older = conversationRecord("conv_older", "2026-07-14T00:00:00.000Z");
    const newer = conversationRecord("conv_newer", "2026-07-14T01:00:00.000Z");

    expect(await repository.createConversation(older)).toEqual({ ok: true, value: older });
    expect(await repository.createConversation(newer)).toEqual({ ok: true, value: newer });
    expect(await repository.readConversation("conv_older")).toEqual({
      ok: true,
      value: older
    });
    expect(await repository.listConversations({ projectId: "project_01" })).toEqual({
      ok: true,
      value: { items: [newer, older], diagnostics: [] }
    });

    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "conversations", "conv_newer", "conversation.json"),
          "utf8"
        )
      )
    ).toEqual(newer);
  });

  test("keeps create and summary revisions immutable", async () => {
    const { repository } = await createRepository();
    const record = conversationRecord("conv_immutable", "2026-07-14T00:00:00.000Z");
    const summary = summaryRevision("conv_immutable", 1, "First summary");

    await repository.createConversation(record);
    expect(await repository.createConversation(record)).toEqual({ ok: true, value: record });
    expect(
      await repository.createConversation({ ...record, title: "Different" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_CREATE_CONFLICT" } });

    expect(await repository.writeSummary(summary)).toEqual({ ok: true, value: summary });
    expect(await repository.writeSummary(summary)).toEqual({ ok: true, value: summary });
    expect(
      await repository.writeSummary({ ...summary, content: "Different summary" })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_SUMMARY_CONFLICT" } });
    expect(
      await repository.writeSummary({ ...summary, throughRunLastSequence: 4 })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_SUMMARY_CONFLICT" } });
    expect(await repository.readLatestSummary("conv_immutable")).toEqual({
      ok: true,
      value: summary
    });
  });

  test("updates status with optimistic revision control and persists command receipts", async () => {
    const { repository } = await createRepository();
    const record = conversationRecord("conv_status", "2026-07-14T00:00:00.000Z");
    await repository.createConversation(record);

    const archived = { ...record, revision: 2, status: "archived", updatedAt: "2026-07-14T02:00:00.000Z" };
    expect(
      await repository.updateConversation({
        conversationId: "conv_status",
        projectId: "project_01",
        expectedRevision: 1,
        status: "archived",
        updatedAt: archived.updatedAt
      })
    ).toEqual({ ok: true, value: archived });
    const conflict = await repository.updateConversation({
        conversationId: "conv_status",
        projectId: "project_01",
        expectedRevision: 1,
        status: "active",
        updatedAt: "2026-07-14T03:00:00.000Z"
      });
    expect(conflict).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_CONVERSATION_REVISION_CONFLICT",
        redactedDetail: { latestConversation: archived }
      }
    });

    const receipt = { ok: true, value: archived };
    expect(await repository.writeCommandReceipt("conv_status", "cmd_archive", receipt)).toEqual({
      ok: true,
      value: receipt
    });
    expect(await repository.readCommandReceipt("conv_status", "cmd_archive")).toEqual({
      ok: true,
      value: receipt
    });
  });

  test("rejects unsafe identifiers and isolates corrupted records from list results", async () => {
    const { projectRoot, repository } = await createRepository();
    const valid = conversationRecord("conv_valid", "2026-07-14T00:00:00.000Z");
    await repository.createConversation(valid);
    const corruptedDirectory = join(projectRoot, "history", "conversations", "conv_corrupt");
    await mkdir(corruptedDirectory, { recursive: true });
    await writeFile(join(corruptedDirectory, "conversation.json"), "{not-json", "utf8");

    expect(await repository.readConversation("../outside")).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_ID_INVALID" }
    });
    expect(await repository.listConversations({ projectId: "project_01" })).toEqual({
      ok: true,
      value: {
        items: [valid],
        diagnostics: [
          { conversationId: "conv_corrupt", code: "AGENT_CONVERSATION_READ_FAILED" }
        ]
      }
    });
    expect(await repository.readConversation("conv_corrupt")).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_READ_FAILED" }
    });
  });

  test("filters by status before applying stable cursor pagination", async () => {
    const { repository } = await createRepository();
    for (let index = 0; index < 35; index += 1) {
      const id = `conv_archived_${String(index).padStart(2, "0")}`;
      await repository.createConversation({
        ...conversationRecord(id, `2026-07-14T02:${String(index).padStart(2, "0")}:00.000Z`),
        status: "archived"
      });
    }
    for (let index = 0; index < 35; index += 1) {
      const id = `conv_active_${String(index).padStart(2, "0")}`;
      await repository.createConversation(
        conversationRecord(id, `2026-07-14T01:${String(index).padStart(2, "0")}:00.000Z`)
      );
    }

    const first = await repository.listConversations({
      projectId: "project_01",
      status: "active"
    });
    expect(first).toMatchObject({
      ok: true,
      value: { items: expect.any(Array), nextCursor: expect.any(String), diagnostics: [] }
    });
    if (!first.ok) return;
    expect(first.value.items).toHaveLength(30);
    expect(first.value.items.every((record) => record.status === "active")).toBe(true);
    const cursor = first.value.nextCursor;
    if (cursor === undefined) return;

    const second = await repository.listConversations({
      projectId: "project_01",
      status: "active",
      cursor
    });
    expect(second).toMatchObject({ ok: true, value: { diagnostics: [] } });
    if (!second.ok) return;
    expect(second.value.items).toHaveLength(5);
    expect(second.value.nextCursor).toBeUndefined();

    expect(
      await repository.listConversations({
        projectId: "project_01",
        status: "archived",
        cursor
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_CURSOR_INVALID" } });
  });

  test("serializes same-conversation writes so only one concurrent revision wins", async () => {
    const { repository } = await createRepository();
    const record = conversationRecord("conv_concurrent", "2026-07-14T00:00:00.000Z");
    await repository.createConversation(record);

    const updates = await Promise.all([
      repository.updateConversation({
        conversationId: record.conversationId,
        projectId: record.projectId,
        expectedRevision: 1,
        status: "archived",
        updatedAt: "2026-07-14T01:00:00.000Z"
      }),
      repository.updateConversation({
        conversationId: record.conversationId,
        projectId: record.projectId,
        expectedRevision: 1,
        title: "Concurrent title",
        updatedAt: "2026-07-14T02:00:00.000Z"
      })
    ]);
    expect(updates.filter((result) => result.ok)).toHaveLength(1);
    expect(updates.filter((result) => !result.ok)).toHaveLength(1);
    expect(updates.find((result) => !result.ok)).toMatchObject({
      error: { code: "AGENT_CONVERSATION_REVISION_CONFLICT" }
    });

    const receipts = await Promise.all([
      repository.writeCommandReceipt(record.conversationId, "cmd_same", { result: "first" }),
      repository.writeCommandReceipt(record.conversationId, "cmd_same", { result: "second" })
    ]);
    expect(receipts.filter((result) => result.ok)).toHaveLength(1);
    expect(receipts.filter((result) => !result.ok)).toHaveLength(1);

    const summaries = await Promise.all([
      repository.writeSummary(summaryRevision(record.conversationId, 1, "First")),
      repository.writeSummary(summaryRevision(record.conversationId, 1, "Second"))
    ]);
    expect(summaries.filter((result) => result.ok)).toHaveLength(1);
    expect(summaries.filter((result) => !result.ok)).toHaveLength(1);
  });

  test("rejects reserved identities, oversized data, and orphan summary revisions", async () => {
    const { repository } = await createRepository();
    expect(
      await repository.createConversation(
        conversationRecord("legacy_agent_runs", "2026-07-14T00:00:00.000Z")
      )
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_ID_RESERVED" } });
    expect(await repository.readConversation("legacy_agent_runs")).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_ID_RESERVED" }
    });
    expect(
      await repository.createConversation({
        ...conversationRecord("conv_large_title", "2026-07-14T00:00:00.000Z"),
        title: "标".repeat(300)
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_RECORD_INVALID" } });
    expect(
      await repository.createConversation({
        ...conversationRecord("conv_large_record", "2026-07-14T00:00:00.000Z"),
        extra: "x".repeat(20 * 1024)
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_RECORD_INVALID" } });
    expect(
      await repository.writeSummary(summaryRevision("conv_missing", 1, "Orphan"))
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_NOT_FOUND" } });

    const record = conversationRecord("conv_summary_limit", "2026-07-14T00:00:00.000Z");
    await repository.createConversation(record);
    expect(
      await repository.writeSummary(
        summaryRevision(record.conversationId, 1, "x".repeat(8 * 1024 + 1))
      )
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONVERSATION_SUMMARY_INVALID" } });
  });

  test("searches Chinese title, latest summary, and run requests with archive filtering and pagination", async () => {
    const { repository } = await createRepository();
    const documents = [
      searchDocument("conv_title", "2026-07-14T04:00:00.000Z", {
        title: "雪山追逐"
      }),
      searchDocument("conv_summary", "2026-07-14T03:00:00.000Z", {
        latestSummary: "林夏终于确认了父亲留下的线索"
      }),
      searchDocument("conv_request", "2026-07-14T02:00:00.000Z", {
        userRequests: ["调整第三章的人物动机"]
      }),
      searchDocument("conv_archived", "2026-07-14T01:00:00.000Z", {
        status: "archived",
        userRequests: ["归档线索"]
      })
    ];

    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "雪山",
        documents
      })
    ).toMatchObject({ ok: true, value: { items: [{ conversationId: "conv_title" }] } });
    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "父亲留下",
        documents
      })
    ).toMatchObject({ ok: true, value: { items: [{ conversationId: "conv_summary" }] } });
    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "人物动机",
        documents
      })
    ).toMatchObject({ ok: true, value: { items: [{ conversationId: "conv_request" }] } });
    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "归档线索",
        documents
      })
    ).toMatchObject({ ok: true, value: { items: [] } });
    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "归档线索",
        includeArchived: true,
        documents
      })
    ).toMatchObject({ ok: true, value: { items: [{ conversationId: "conv_archived" }] } });

    const commonDocuments = documents.map((document) => ({
      ...document,
      userRequests: [...document.userRequests, "共同关键词"]
    }));
    const first = await repository.searchConversations({
      projectId: "project_01",
      query: "共同关键词",
      documents: commonDocuments,
      limit: 2
    });
    expect(first).toMatchObject({
      ok: true,
      value: {
        items: [{ conversationId: "conv_title" }, { conversationId: "conv_summary" }],
        nextCursor: expect.any(String)
      }
    });
    if (!first.ok || first.value.nextCursor === undefined) return;
    const second = await repository.searchConversations({
      projectId: "project_01",
      query: "共同关键词",
      documents: commonDocuments,
      limit: 2,
      cursor: first.value.nextCursor
    });
    expect(second).toMatchObject({
      ok: true,
      value: { items: [{ conversationId: "conv_request" }] }
    });
    if (second.ok) expect(second.value.nextCursor).toBeUndefined();
  });

  test("rebuilds a corrupt disposable search cache without blocking valid results", async () => {
    const { projectRoot, repository } = await createRepository();
    const cachePath = join(projectRoot, "cache", "indexes", "conversations.json");
    await mkdir(join(projectRoot, "cache", "indexes"), { recursive: true });
    await writeFile(cachePath, "{not-json", "utf8");
    const documents = [
      searchDocument("conv_rebuild", "2026-07-14T00:00:00.000Z", {
        userRequests: ["重建索引"]
      })
    ];

    expect(
      await repository.searchConversations({
        projectId: "project_01",
        query: "重建索引",
        documents
      })
    ).toMatchObject({
      ok: true,
      value: {
        items: [{ conversationId: "conv_rebuild" }],
        diagnostics: [{ code: "AGENT_CONVERSATION_SEARCH_INDEX_REBUILT" }]
      }
    });
    expect(JSON.parse(await readFile(cachePath, "utf8"))).toMatchObject({
      schemaVersion: "1.0",
      projectId: "project_01",
      documents: [{ conversationId: "conv_rebuild" }]
    });
  });
});

async function createRepository() {
  const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-agent-conversation-"));
  roots.push(projectRoot);
  return {
    projectRoot,
    repository: new AgentConversationFileRepository({ projectRoot })
  };
}

function conversationRecord(conversationId: string, updatedAt: string) {
  return {
    schemaVersion: "1.0" as const,
    conversationId,
    projectId: "project_01",
    revision: 1,
    title: conversationId,
    status: "active" as const,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt
  };
}

function summaryRevision(conversationId: string, revision: number, content: string) {
  return {
    schemaVersion: "1.0" as const,
    conversationId,
    revision,
    sourceRunIds: ["run_01"],
    throughRunId: "run_01",
    throughRunRevision: 2,
    throughRunLastSequence: 3,
    content,
    createdAt: "2026-07-14T01:00:00.000Z"
  };
}

function searchDocument(
  conversationId: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    schemaVersion: "1.0" as const,
    conversationId,
    projectId: "project_01",
    title: conversationId,
    status: "active" as const,
    updatedAt,
    latestSummary: "",
    userRequests: [] as string[],
    ...overrides
  };
}
