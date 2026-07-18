import { ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import { beforeEach, describe, expect, test } from "vitest";

import {
  createAgentContextSession,
  type AgentContextBudgetInputs,
  type AgentContextBudgetInputsPort
} from "../src/agent-context-session.js";
import {
  createAgentRunDraftSession,
  type AgentRunDraftSession,
  type SyncStartDraftCommand
} from "../src/agent-run-draft-session.js";
import type { AgentTokenEstimator, PreviewContextBudgetCommand } from "@novel-studio/agent-engine";

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
    const latest = [...byRevision.keys()].sort((left, right) => right - left).at(0);
    if (latest === undefined) return ok(undefined);
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

const syncCommand: SyncStartDraftCommand = {
  projectId: "project_01",
  conversationId: "conv_01",
  commandId: "sync_01",
  userRequest: "写下一章",
  operationMode: "execution",
  contextMode: "writing",
  writePolicy: "write_before_confirmation",
  writePolicyAcknowledged: false,
  modelProfileId: "profile_01",
  contextRefs: []
};

function budgetInputsPort(
  inputs: AgentContextBudgetInputs,
  onCall?: () => void
): AgentContextBudgetInputsPort {
  return {
    async resolveBudgetInputs() {
      onCall?.();
      return ok(inputs);
    }
  };
}

const facts128k: AgentContextBudgetInputs = {
  model: {
    provider: "demo",
    model: "large",
    contextWindow: 128000,
    maxOutputTokens: 8000,
    toolReserve: 2000,
    systemReserve: 1000,
    requiredContextTokens: 8000
  },
  contents: []
};

async function seedDraft(draftSession: AgentRunDraftSession) {
  const synced = await draftSession.syncStartDraft(syncCommand);
  if (!synced.ok) throw synced.error;
  return synced.value.runDraft;
}

describe("Agent Context session — previewContextBudget", () => {
  let draftSession: AgentRunDraftSession;

  beforeEach(() => {
    draftSession = createAgentRunDraftSession({
      repository: createMemoryRepository(),
      now: () => "2026-07-16T00:00:00.000Z",
      createId: (() => {
        let n = 0;
        return () => `id_${(n += 1)}`;
      })()
    });
  });

  function previewCommand(
    draft: { runDraftId: string; revision: number; checksum: string },
    overrides: Partial<PreviewContextBudgetCommand> = {}
  ): PreviewContextBudgetCommand {
    return {
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "preview_01",
      runDraftId: draft.runDraftId,
      expectedDraftRevision: draft.revision,
      runDraftChecksum: draft.checksum,
      ...overrides
    };
  }

  test("resolves a budget from the draft's model facts and estimated content", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k),
      createBudgetSnapshotId: () => "budget_preview",
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contextBudgetSnapshotId).toBe("budget_preview");
    expect(result.value.safeInputBudget).toBe(128000 - 8000 - 2000 - 1000);
    expect(result.value.usedTokens).toBeGreaterThan(0);
    expect(result.value.precision).toBe("estimated");
  });

  test("sums used tokens across the request and resolved content", async () => {
    const draft = await seedDraft(draftSession);
    const inputs: AgentContextBudgetInputs = {
      model: facts128k.model,
      contents: [
        { refId: "chapter:ch_01", content: "x".repeat(400) },
        { refId: "story_bible:asset_01", content: "y".repeat(400) }
      ]
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(inputs),
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 800 content bytes / 4 = 200 tokens, plus the request estimate.
    expect(result.value.usedTokens).toBeGreaterThanOrEqual(200);
    expect(result.value.remainingTokens).toBe(result.value.safeInputBudget - result.value.usedTokens);
  });

  test("marks precision reported only when a provider tokenizer reports it", async () => {
    const draft = await seedDraft(draftSession);
    const reportedEstimator: AgentTokenEstimator = {
      count: () => ({ tokens: 10, precision: "reported" })
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k),
      estimator: reportedEstimator,
      now: () => "2026-07-16T00:00:00.000Z"
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.precision).toBe("reported");
  });

  test("rejects a stale draft revision without reaching the budget inputs", async () => {
    const draft = await seedDraft(draftSession);
    let called = false;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k, () => {
        called = true;
      })
    });
    const result = await session.previewContextBudget(
      previewCommand(draft, { expectedDraftRevision: draft.revision + 1, commandId: "preview_stale" })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_RUN_DRAFT_REVISION_CONFLICT" } });
    expect(called).toBe(false);
  });

  test("rejects a checksum mismatch", async () => {
    const draft = await seedDraft(draftSession);
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k)
    });
    const result = await session.previewContextBudget(
      previewCommand(draft, { runDraftChecksum: "deadbeef", commandId: "preview_checksum" })
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_DRAFT_CHECKSUM_MISMATCH" }
    });
  });

  test("propagates an insufficient-window rejection from the calculator", async () => {
    const draft = await seedDraft(draftSession);
    const tiny: AgentContextBudgetInputs = {
      model: {
        provider: "demo",
        model: "tiny",
        contextWindow: 12000,
        maxOutputTokens: 4000,
        toolReserve: 500,
        systemReserve: 500,
        requiredContextTokens: 8000
      },
      contents: []
    };
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(tiny)
    });
    const result = await session.previewContextBudget(previewCommand(draft));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_BUDGET_INSUFFICIENT" }
    });
  });

  test("is idempotent per command id", async () => {
    const draft = await seedDraft(draftSession);
    let calls = 0;
    const session = createAgentContextSession({
      draftSession,
      budgetInputs: budgetInputsPort(facts128k, () => {
        calls += 1;
      }),
      createBudgetSnapshotId: (() => {
        let n = 0;
        return () => `budget_${(n += 1)}`;
      })()
    });
    const first = await session.previewContextBudget(previewCommand(draft));
    const second = await session.previewContextBudget(previewCommand(draft));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.contextBudgetSnapshotId).toBe(second.value.contextBudgetSnapshotId);
    expect(calls).toBe(1);
  });
});
