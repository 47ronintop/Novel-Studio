import { ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createAgentRunDraftSession,
  type AgentRunDraftInitialization,
  type AgentRunDraftSession,
  type ReadAgentRunDraftCommand
} from "../src/agent-run-draft-session.js";

/** In-memory store mirroring the real repository's per-revision immutability + conflict rules. */
function createMemoryRepository() {
  const runDrafts = new Map<string, Map<number, JsonObject>>();
  const contextDrafts = new Map<string, Map<number, JsonObject>>();

  function write(
    store: Map<string, Map<number, JsonObject>>,
    draft: JsonObject
  ): Result<JsonObject, UnifiedError> {
    const conversationId = draft["conversationId"] as string;
    const revision = draft["revision"] as number;
    const byRevision = store.get(conversationId) ?? new Map<number, JsonObject>();
    const existing = byRevision.get(revision);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(draft)) {
      return { ok: false, error: { code: "AGENT_CONVERSATION_DRAFT_CONFLICT" } as UnifiedError };
    }
    byRevision.set(revision, draft);
    store.set(conversationId, byRevision);
    return ok(draft);
  }

  function readLatest(
    store: Map<string, Map<number, JsonObject>>,
    conversationId: string
  ): Result<JsonObject | undefined, UnifiedError> {
    const byRevision = store.get(conversationId);
    if (byRevision === undefined || byRevision.size === 0) return ok(undefined);
    const latest = [...byRevision.keys()].sort((left, right) => right - left)[0]!;
    return ok(byRevision.get(latest));
  }

  return {
    writeRunDraft: (draft: JsonObject) => Promise.resolve(write(runDrafts, draft)),
    readLatestRunDraft: (conversationId: string) =>
      Promise.resolve(readLatest(runDrafts, conversationId)),
    writeContextDraft: (draft: JsonObject) => Promise.resolve(write(contextDrafts, draft)),
    readLatestContextDraft: (conversationId: string) =>
      Promise.resolve(readLatest(contextDrafts, conversationId))
  };
}

const initialize: AgentRunDraftInitialization = {
  modelProfileId: "model_01",
  reasoningEffort: "medium",
  operationMode: "planning",
  contextMode: "writing",
  writePolicy: "write_before_confirmation"
};

const readCommand: ReadAgentRunDraftCommand = {
  projectId: "project_01",
  conversationId: "conv_01",
  initialize
};

describe("Agent Run Draft session", () => {
  let session: AgentRunDraftSession;
  let ids: number;

  beforeEach(() => {
    ids = 0;
    session = createAgentRunDraftSession({
      repository: createMemoryRepository(),
      now: () => "2026-07-16T00:00:00.000Z",
      createId: () => `draft_${(ids += 1)}`
    });
  });

  test("initializes a new conversation draft from defaults", async () => {
    const result = await session.readAgentRunDraft(readCommand);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runDraft).toMatchObject({
      revision: 1,
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      modelProfileId: "model_01",
      reasoningEffort: "medium"
    });
    expect(result.value.contextDraft.revision).toBe(1);
    expect(result.value.runDraft.contextDraftChecksum).toBe(result.value.contextDraft.checksum);
  });

  test("reload returns the persisted draft without re-initializing", async () => {
    const first = await session.readAgentRunDraft(readCommand);
    const second = await session.readAgentRunDraft(readCommand);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.runDraft.runDraftId).toBe(first.value.runDraft.runDraftId);
    expect(second.value.runDraft.revision).toBe(1);
  });

  test("updates the request into a new revision", async () => {
    await session.readAgentRunDraft(readCommand);
    const result = await session.updateAgentRunDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_01",
      expectedDraftRevision: 1,
      mutation: { kind: "set_request", request: "续写第三章" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runDraft.revision).toBe(2);
    expect(result.value.runDraft.userRequest).toBe("续写第三章");
  });

  test("rejects a stale expected revision", async () => {
    await session.readAgentRunDraft(readCommand);
    const result = await session.updateAgentRunDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_stale",
      expectedDraftRevision: 99,
      mutation: { kind: "set_request", request: "x" }
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT" }
    });
  });

  test("replays a command id idempotently", async () => {
    await session.readAgentRunDraft(readCommand);
    const command = {
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_idem",
      expectedDraftRevision: 1,
      mutation: { kind: "set_request" as const, request: "once" }
    };
    const first = await session.updateAgentRunDraft(command);
    const second = await session.updateAgentRunDraft(command);
    expect(first).toEqual(second);
    if (!first.ok) return;
    expect(first.value.runDraft.revision).toBe(2);
  });

  test("adding a context ref bumps the context draft and re-points the run draft", async () => {
    await session.readAgentRunDraft(readCommand);
    const initial = await session.readAgentRunDraft(readCommand);
    if (!initial.ok) return;
    const contextDraftId = initial.value.contextDraft.contextDraftId;
    const result = await session.updateContextDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_ref",
      contextDraftId,
      expectedDraftRevision: 1,
      mutation: {
        kind: "add_ref",
        ref: { kind: "chapter", refId: "chapter:ch_01", chapterId: "ch_01", label: "第 1 章" }
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contextDraft.revision).toBe(2);
    expect(result.value.contextDraft.refs).toHaveLength(1);
    // The run draft re-points at the new context revision + checksum, producing its own new revision.
    expect(result.value.runDraft.contextDraftRevision).toBe(2);
    expect(result.value.runDraft.contextDraftChecksum).toBe(result.value.contextDraft.checksum);
    expect(result.value.runDraft.revision).toBe(2);
  });

  test("switching to general-file prunes writing-only refs and syncs both drafts", async () => {
    await session.readAgentRunDraft(readCommand);
    const initial = await session.readAgentRunDraft(readCommand);
    if (!initial.ok) return;
    await session.updateContextDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_addref",
      contextDraftId: initial.value.contextDraft.contextDraftId,
      expectedDraftRevision: 1,
      mutation: {
        kind: "add_ref",
        ref: { kind: "chapter", refId: "chapter:ch_01", chapterId: "ch_01", label: "第 1 章" }
      }
    });
    const switched = await session.updateAgentRunDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_mode",
      expectedDraftRevision: 2,
      mutation: { kind: "set_context_mode", contextMode: "general_file" }
    });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.value.runDraft.contextMode).toBe("general_file");
    expect(switched.value.contextDraft.contextMode).toBe("general_file");
    expect(switched.value.contextDraft.refs).toEqual([]);
    expect(switched.value.runDraft.contextDraftChecksum).toBe(switched.value.contextDraft.checksum);
  });

  test("refresh bumps the context draft and re-points the run draft", async () => {
    await session.readAgentRunDraft(readCommand);
    const initial = await session.readAgentRunDraft(readCommand);
    if (!initial.ok) return;
    const result = await session.refreshContextDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "cmd_refresh",
      contextDraftId: initial.value.contextDraft.contextDraftId,
      expectedDraftRevision: 1
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contextDraft.revision).toBe(2);
    expect(result.value.runDraft.contextDraftRevision).toBe(2);
  });

  test("resolveStartDraft returns the draft pair for a matching reference", async () => {
    const created = await session.readAgentRunDraft(readCommand);
    if (!created.ok) return;
    const resolved = await session.resolveStartDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      runDraftId: created.value.runDraft.runDraftId,
      runDraftRevision: created.value.runDraft.revision,
      runDraftChecksum: created.value.runDraft.checksum
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.runDraft.runDraftId).toBe(created.value.runDraft.runDraftId);
    expect(resolved.value.contextDraft.contextDraftId).toBe(
      created.value.contextDraft.contextDraftId
    );
  });

  test("resolveStartDraft rejects when no draft exists", async () => {
    const resolved = await session.resolveStartDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      runDraftId: "draft_missing",
      runDraftRevision: 1,
      runDraftChecksum: "deadbeef"
    });
    expect(resolved).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_NOT_FOUND" }
    });
  });

  test("resolveStartDraft rejects a stale revision", async () => {
    const created = await session.readAgentRunDraft(readCommand);
    if (!created.ok) return;
    const resolved = await session.resolveStartDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      runDraftId: created.value.runDraft.runDraftId,
      runDraftRevision: 99,
      runDraftChecksum: created.value.runDraft.checksum
    });
    expect(resolved).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT" }
    });
  });

  test("resolveStartDraft rejects a checksum mismatch", async () => {
    const created = await session.readAgentRunDraft(readCommand);
    if (!created.ok) return;
    const resolved = await session.resolveStartDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      runDraftId: created.value.runDraft.runDraftId,
      runDraftRevision: created.value.runDraft.revision,
      runDraftChecksum: "0000"
    });
    expect(resolved).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_CHECKSUM_MISMATCH" }
    });
  });

  test("resolveStartDraft rejects a run-draft id mismatch", async () => {
    const created = await session.readAgentRunDraft(readCommand);
    if (!created.ok) return;
    const resolved = await session.resolveStartDraft({
      projectId: "project_01",
      conversationId: "conv_01",
      runDraftId: "draft_other",
      runDraftRevision: created.value.runDraft.revision,
      runDraftChecksum: created.value.runDraft.checksum
    });
    expect(resolved).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_NOT_FOUND" }
    });
  });
});
