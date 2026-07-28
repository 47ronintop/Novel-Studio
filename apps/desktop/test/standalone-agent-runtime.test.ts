import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  STANDALONE_AGENT_STATE_DIRECTORY,
  STANDALONE_AGENT_SCOPE,
  STANDALONE_EMPTY_TOOL_CATALOG,
  createDesktopStandaloneAgentRuntime,
  createStandaloneAgentRuntime,
  resolveStandaloneAgentStateRoot
} from "../src/main/standalone-agent-runtime.js";
import type { DesktopStandaloneAgentRuntime } from "../src/main/agent-runtime-manager.js";
import type { AgentModelRoundInput, AgentRunModelDriver } from "@novel-studio/application";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }))
  );
});

describe("standalone Agent state root", () => {
  test("derives one canonical, application-owned root below userData", async () => {
    const userDataRoot = await createRoot("canonical");

    const resolved = await resolveStandaloneAgentStateRoot(userDataRoot);

    expect(resolved).toEqual({
      ok: true,
      value: {
        scopeId: "standalone",
        stateRoot: await realpath(join(userDataRoot, "agent", "standalone"))
      }
    });
    expect(STANDALONE_AGENT_STATE_DIRECTORY).toBe(join("agent", "standalone"));
  });

  test("fails closed when no userData root is available", async () => {
    await expect(resolveStandaloneAgentStateRoot(" ")).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_STANDALONE_STATE_ROOT_INVALID" }
    });
  });

  test("hands a runtime factory only the guarded standalone state", async () => {
    const userDataRoot = await createRoot("factory");
    let received: unknown;

    const created = await createStandaloneAgentRuntime({
      userDataRoot,
      createRuntime(state) {
        received = state;
        return {
          scopeId: "standalone",
          stateRoot: state.stateRoot
        } as DesktopStandaloneAgentRuntime;
      }
    });

    expect(created).toMatchObject({ ok: true, value: { scopeId: "standalone" } });
    expect(received).toEqual({
      scopeId: "standalone",
      stateRoot: await realpath(join(userDataRoot, "agent", "standalone"))
    });
  });

  test("persists a scope-only text conversation and restores it without a project path", async () => {
    const userDataRoot = await createRoot("persistent");
    const modelInputs: AgentModelRoundInput[] = [];
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_01",
      createDraftId: () => "standalone_draft_01",
      createRunId: () => "standalone_run_01",
      modelDriver: textModelDriver(modelInputs, "这是不依赖项目的回答。"),
      resolveModelStartFacts: textModelFacts
    });

    expect(runtime).toMatchObject({ ok: true, value: { scopeId: "standalone" } });
    if (!runtime.ok) return;
    expect("workspaceId" in runtime.value).toBe(false);
    expect("contentRoot" in runtime.value).toBe(false);
    await expect(runtime.value.prepare()).resolves.toEqual({ ok: true, value: undefined });

    const started = await startStandaloneTextRun(runtime.value);
    if (!started.ok) throw new Error(`${started.error.code}: ${started.error.message}`);
    expect(started).toMatchObject({ ok: true, value: { runId: "standalone_run_01" } });
    await waitForTerminal(runtime.value, started.value.runId);

    expect(modelInputs).toHaveLength(1);
    expect(modelInputs[0]?.tools).toEqual([]);
    expect(modelInputs[0]?.snapshot.scope).toEqual(STANDALONE_AGENT_SCOPE);
    expect("projectId" in (modelInputs[0]?.snapshot ?? {})).toBe(false);
    expect(JSON.stringify(modelInputs[0])).not.toContain(userDataRoot);

    const reloaded = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      modelDriver: textModelDriver([], "must not run during restore"),
      resolveModelStartFacts: textModelFacts
    });
    expect(reloaded).toMatchObject({ ok: true });
    if (!reloaded.ok) return;
    await expect(reloaded.value.prepare()).resolves.toEqual({ ok: true, value: undefined });

    const conversations = await reloaded.value.agentConversationSession.listConversations({
      scope: STANDALONE_AGENT_SCOPE
    });
    expect(conversations).toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ conversationId: "standalone_conversation_01" })] }
    });
    const snapshots = await reloaded.value.listRunSnapshots();
    expect(snapshots).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          runId: "standalone_run_01",
          scope: STANDALONE_AGENT_SCOPE,
          status: "completed"
        })
      ]
    });
    if (snapshots.ok) {
      const snapshot = snapshots.value.at(0);
      expect(snapshot).toBeDefined();
      if (snapshot !== undefined) expect("projectId" in snapshot).toBe(false);
    }
  });

  test("persists completed model usage under the standalone state root without a project id", async () => {
    const userDataRoot = await createRoot("usage");
    const modelInputs: AgentModelRoundInput[] = [];
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      now: () => "2026-11-01T06:30:00.000Z",
      createConversationId: () => "standalone_conversation_usage",
      createDraftId: () => "standalone_draft_usage",
      createRunId: () => "standalone_run_usage",
      modelDriver: {
        async *streamRound(input) {
          modelInputs.push(input);
          yield {
            type: "usage",
            usage: {
              inputTokens: 20,
              outputTokens: 5,
              totalTokens: 25,
              usageStatus: "actual",
              cost: { amount: 0.001, currency: "USD", status: "actual" }
            }
          };
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      resolveModelStartFacts: textModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const started = await startStandaloneTextRun(runtime.value);
    if (!started.ok) throw new Error(`${started.error.code}: ${started.error.message}`);
    await waitForTerminal(runtime.value, started.value.runId);

    expect(modelInputs).toHaveLength(1);
    const detailDirectory = join(userDataRoot, "agent", "standalone", "agent-usage", "details");
    const detailFiles = await readdir(detailDirectory);
    expect(detailFiles).toHaveLength(1);
    const detailFile = detailFiles[0];
    if (detailFile === undefined) throw new Error("Expected one standalone usage detail file.");
    const record = JSON.parse(await readFile(join(detailDirectory, detailFile), "utf8")) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      schemaVersion: "1.1",
      scope: STANDALONE_AGENT_SCOPE,
      runId: "standalone_run_usage",
      conversationId: "standalone_conversation_usage",
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      localDate: "2026-11-01"
    });
    expect(record).not.toHaveProperty("projectId");
    expect(JSON.stringify(record)).not.toContain(userDataRoot);

    const usageSession = runtime.value.agentUsageSession;
    if (usageSession === undefined) throw new Error("Expected standalone usage session.");
    await expect(
      usageSession.listAgentUsage({
        range: { fromLocalDate: "2026-11-01", toLocalDate: "2026-11-01" },
        detailLocalDate: "2026-11-01"
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        runs: [
          expect.objectContaining({
            scope: STANDALONE_AGENT_SCOPE,
            runId: "standalone_run_usage"
          })
        ]
      }
    });
  });

  test("previews the canonical standalone budget from a frozen empty tool catalog", async () => {
    const userDataRoot = await createRoot("budget-preview");
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_budget",
      createDraftId: () => "standalone_draft_budget",
      modelDriver: textModelDriver([], "unused"),
      resolveModelStartFacts: textModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const conversation = await runtime.value.agentConversationSession.createConversation({
      scope: STANDALONE_AGENT_SCOPE,
      commandId: "create_budget_conversation"
    });
    if (!conversation.ok) throw conversation.error;
    const draft = await runtime.value.agentRunDraftSession.syncStartDraft({
      scope: STANDALONE_AGENT_SCOPE,
      conversationId: conversation.value.conversationId,
      commandId: "sync_budget_draft",
      userRequest: "Summarize the goal.",
      operationMode: "conversation",
      contextMode: "standalone_chat",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "text-only-model",
      contextRefs: []
    });
    if (!draft.ok) throw draft.error;

    const preview = await runtime.value.agentContextSession.previewContextBudget({
      scope: STANDALONE_AGENT_SCOPE,
      conversationId: conversation.value.conversationId,
      commandId: "preview_standalone_budget",
      runDraftId: draft.value.runDraft.runDraftId,
      expectedDraftRevision: draft.value.runDraft.revision,
      runDraftChecksum: draft.value.runDraft.checksum
    });

    expect(preview).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        toolReserve: 0,
        audit: {
          toolCatalog: {
            facadeVersion: "v2",
            catalogRevision: STANDALONE_EMPTY_TOOL_CATALOG.catalogRevision,
            descriptorCount: 0
          }
        }
      }
    });
  });

  test("routes a scope-only compact command through the standalone run session", async () => {
    const userDataRoot = await createRoot("run-session-compaction");
    let releaseModel: (() => void) | undefined;
    let modelCalls = 0;
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_run_compaction",
      createDraftId: () => "standalone_draft_run_compaction",
      createRunId: () => "standalone_run_session_compaction",
      modelDriver: {
        async *streamRound() {
          modelCalls += 1;
          await new Promise<void>((resolve) => {
            releaseModel = resolve;
          });
          yield { type: "round_completed", finishReason: "stop" };
        }
      },
      resolveModelStartFacts: textModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const started = await startStandaloneTextRun(runtime.value);
    if (!started.ok) throw started.error;
    await waitFor(() => modelCalls === 1);
    const active = await runtime.value.agentRunSession.readAgentRun(started.value.runId);
    if (!active.ok) throw active.error;
    const budgetId = active.value.snapshot.contextBudgetSnapshotId;
    if (budgetId === null) throw new Error("Expected a persisted standalone budget snapshot.");

    const compacted = await runtime.value.agentRunSession.compactContext({
      scope: STANDALONE_AGENT_SCOPE,
      runId: active.value.snapshot.runId,
      commandId: "compact_active_standalone_run",
      expectedRunRevision: active.value.snapshot.runRevision,
      contextBudgetSnapshotId: budgetId,
      trigger: "manual"
    });
    expect(compacted).toMatchObject({
      ok: true,
      value: { scope: STANDALONE_AGENT_SCOPE, activeCompactionId: expect.any(String) }
    });

    const latest = await runtime.value.agentRunSession.readAgentRun(started.value.runId);
    if (latest.ok) {
      await runtime.value.agentRunSession.stopAgentRun({
        scope: STANDALONE_AGENT_SCOPE,
        runId: latest.value.snapshot.runId,
        commandId: "stop_compacted_standalone_run",
        expectedRunRevision: latest.value.snapshot.runRevision
      });
    }
    releaseModel?.();
  });

  test("persists and hydrates a model-assisted standalone summary without project facts or tools", async () => {
    const userDataRoot = await createRoot("compaction");
    const summaryBody = JSON.stringify({
      userGoal: "Keep the discussion concise",
      decisions: ["Use the agreed structure"],
      constraints: ["Preserve verified facts"],
      openQuestions: ["Which detail comes next"],
      nextSteps: ["Answer the pending question"]
    });
    const modelInputs: AgentModelRoundInput[] = [];
    const modelDriver: AgentRunModelDriver = {
      async *streamRound(input) {
        modelInputs.push(input);
        if (modelInputs.length === 1) {
          yield { type: "assistant_text_delta", delta: "A".repeat(60_000) };
          yield { type: "round_completed", finishReason: "stop" };
          return;
        }
        yield { type: "assistant_text_delta", delta: summaryBody };
        yield { type: "round_completed", finishReason: "stop" };
      }
    };
    const compactModelFacts = async () => ({
      ...(await textModelFacts()),
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredArguments: false,
        contextWindow: 12_288
      }
    });
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_compaction",
      createDraftId: () => "standalone_draft_compaction",
      createRunId: () => "standalone_run_compaction",
      modelDriver,
      resolveModelStartFacts: compactModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const started = await startStandaloneTextRun(runtime.value);
    if (!started.ok) throw started.error;
    const terminal = await waitForTerminal(runtime.value, started.value.runId);
    const budgetId = terminal.snapshot.contextBudgetSnapshotId;
    if (budgetId === null) throw new Error("Expected a persisted standalone budget snapshot.");

    const compacted = await runtime.value.agentContextSession.compactContext({
      scope: STANDALONE_AGENT_SCOPE,
      runId: terminal.snapshot.runId,
      commandId: "compact_standalone_context",
      expectedRunRevision: terminal.snapshot.runRevision,
      contextBudgetSnapshotId: budgetId,
      trigger: "manual"
    });
    expect(compacted, compacted.ok ? undefined : JSON.stringify(compacted.error)).toMatchObject({
      ok: true,
      value: { revision: { strategy: "model_assisted" } }
    });
    if (!compacted.ok) return;

    expect(modelInputs).toHaveLength(2);
    expect(modelInputs.every((input) => input.tools.length === 0)).toBe(true);
    expect(modelInputs[1]?.systemPrompt).toContain(
      "userGoal, decisions, constraints, openQuestions, nextSteps"
    );
    const artifact = JSON.parse(
      await readFile(
        join(
          userDataRoot,
          "agent",
          "standalone",
          "history",
          "agent-runs",
          terminal.snapshot.runId,
          "compaction-summaries",
          `summary_${compacted.value.compactionId}.json`
        ),
        "utf8"
      )
    ) as Record<string, unknown>;
    expect(artifact).toMatchObject({
      schemaVersion: "1.0",
      runId: terminal.snapshot.runId,
      contextProfileId: "standalone",
      body: summaryBody,
      tokenCount: expect.any(Number),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/u),
      artifactChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(artifact).not.toHaveProperty("projectId");

    const reloaded = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      modelDriver: textModelDriver([], "must not run during hydrate"),
      resolveModelStartFacts: compactModelFacts
    });
    expect(reloaded).toMatchObject({ ok: true });
    if (!reloaded.ok) return;
    const hydrated = await reloaded.value.agentRunSession.readAgentRun(terminal.snapshot.runId);
    expect(hydrated, hydrated.ok ? undefined : JSON.stringify(hydrated.error)).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          scope: STANDALONE_AGENT_SCOPE,
          activeCompactionId: compacted.value.compactionId
        }
      }
    });
  });

  test("freezes an empty catalog and rejects a model tool call before any project executor", async () => {
    const userDataRoot = await createRoot("tool-rejection");
    const modelInputs: AgentModelRoundInput[] = [];
    let rounds = 0;
    const modelDriver: AgentRunModelDriver = {
      async *streamRound(input) {
        modelInputs.push(input);
        rounds += 1;
        if (rounds === 1) {
          yield {
            type: "tool_call_delta",
            toolCallId: "forbidden_tool_call",
            name: "read_project_text",
            argumentsDelta: JSON.stringify({ path: "secret.md" })
          };
          yield { type: "round_completed", finishReason: "tool_calls" };
          return;
        }
        yield { type: "assistant_text_delta", delta: "工具不可用，因此只给出文本回答。" };
        yield { type: "round_completed", finishReason: "stop" };
      }
    };
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_02",
      createDraftId: () => "standalone_draft_02",
      createRunId: () => "standalone_run_02",
      modelDriver,
      resolveModelStartFacts: textModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const started = await startStandaloneTextRun(runtime.value);
    if (!started.ok) throw new Error(`${started.error.code}: ${started.error.message}`);
    expect(started).toMatchObject({ ok: true });
    const completed = await waitForTerminal(runtime.value, started.value.runId);

    expect(modelInputs).toHaveLength(2);
    expect(modelInputs.every((input) => input.tools.length === 0)).toBe(true);
    expect(completed.events.some((event) => event.type === "tool_failed")).toBe(true);
    expect(completed.events.some((event) => event.type === "tool_started")).toBe(false);
    expect(completed.snapshot.status).toBe("completed");
  });

  test("rejects a forged project identity before it can reach the standalone model", async () => {
    const userDataRoot = await createRoot("forged-project-id");
    const modelInputs: AgentModelRoundInput[] = [];
    const runtime = await createDesktopStandaloneAgentRuntime({
      userDataRoot,
      createConversationId: () => "standalone_conversation_03",
      createDraftId: () => "standalone_draft_03",
      createRunId: () => "standalone_run_03",
      modelDriver: textModelDriver(modelInputs, "This must not be requested."),
      resolveModelStartFacts: textModelFacts
    });
    expect(runtime).toMatchObject({ ok: true });
    if (!runtime.ok) return;

    const started = await startStandaloneTextRun(runtime.value, {
      projectId: "forged_project_identity"
    });

    expect(started).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_SCOPE_INVALID" }
    });
    expect(modelInputs).toEqual([]);
  });
});

async function createRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-standalone-${name}-`));
  roots.push(root);
  return root;
}

const textModelFacts = async () => ({
  profileId: "text-only-model",
  provider: "test-provider",
  modelName: "text-only-model",
  capabilities: {
    streaming: true,
    toolCalling: false,
    structuredArguments: false,
    contextWindow: 32_768
  },
  requiredContextTokens: 1_024,
  reasoningStrength: { status: "hidden" as const, reason: "Text-only standalone model." }
});

function textModelDriver(inputs: AgentModelRoundInput[], response: string): AgentRunModelDriver {
  return {
    async *streamRound(input) {
      inputs.push(input);
      yield { type: "assistant_text_delta", delta: response };
      yield { type: "round_completed", finishReason: "stop" };
    }
  };
}

async function startStandaloneTextRun(
  runtime: DesktopStandaloneAgentRuntime,
  options: { readonly projectId?: string } = {}
) {
  const conversation = await runtime.agentConversationSession.createConversation({
    scope: STANDALONE_AGENT_SCOPE,
    commandId: "create_standalone_conversation"
  });
  if (!conversation.ok) return conversation;
  const draft = await runtime.agentRunDraftSession.syncStartDraft({
    scope: STANDALONE_AGENT_SCOPE,
    conversationId: conversation.value.conversationId,
    commandId: "sync_standalone_draft",
    userRequest: "请直接回答，不要使用任何工具。",
    operationMode: "conversation",
    contextMode: "standalone_chat",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    modelProfileId: "text-only-model",
    contextRefs: []
  } as Parameters<typeof runtime.agentRunDraftSession.syncStartDraft>[0]);
  if (!draft.ok) return draft;
  return runtime.agentRunSession.startAgentRun({
    scope: STANDALONE_AGENT_SCOPE,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    conversationId: conversation.value.conversationId,
    commandId: "start_standalone_run",
    expectedRunRevision: 0,
    runDraftId: draft.value.runDraft.runDraftId,
    runDraftRevision: draft.value.runDraft.revision,
    runDraftChecksum: draft.value.runDraft.checksum
  });
}

async function waitForTerminal(runtime: DesktopStandaloneAgentRuntime, runId: string) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const run = await runtime.agentRunSession.readAgentRun(runId);
    if (
      run.ok &&
      (run.value.snapshot.status === "completed" ||
        run.value.snapshot.status === "cancelled" ||
        run.value.snapshot.status === "failed" ||
        run.value.snapshot.status === "limit_reached")
    ) {
      return run.value;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Standalone run ${runId} did not become terminal.`);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the standalone model call.");
}
