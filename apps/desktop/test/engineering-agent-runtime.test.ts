import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ProjectLockFileRepository } from "@novel-studio/repository";
import { createDesktopAgentRuntime } from "../src/main/agent-run-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("engineering Agent runtime", () => {
  test("applies a general_file Change Set to content while keeping all Agent state app-local", async () => {
    const contentRoot = await createRoot("content");
    const stateRoot = await createRoot("state");
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "before\n", "utf8");
    const lockOwnerId = "engineering-agent-runtime-test";
    const lock = new ProjectLockFileRepository({ projectRoot: stateRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const runtime = createDesktopAgentRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "ws_engineering",
      contentRoot,
      stateRoot,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-engineering-write",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("proposal-engineering", "propose_file_write", {
              path: "src/index.ts",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
          } else {
            yield toolCall("finish-engineering", "finish", { summary: "Applied." });
          }
          yield { type: "round_completed" as const, finishReason: "tool_calls" };
        }
      }
    });
    expect(await runtime.prepare()).toMatchObject({ ok: true });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "ws_engineering",
      commandId: "create-engineering-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;

    expect(
      await runtime.agentRunSession.startAgentRun(
        executionCommand(conversation.value.conversationId, "general_file")
      )
    ).toMatchObject({ ok: true });
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun("run-engineering-write");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      if (!read.ok) return;
      awaitingRevision = read.value.snapshot.runRevision;
      changeSet = read.value.changeSet as unknown as Record<string, unknown>;
    });
    if (changeSet === undefined) throw new Error("Expected a staged engineering Change Set.");

    expect(
      await runtime.agentRunSession.decideChangeSet({
        runId: "run-engineering-write",
        projectId: "ws_engineering",
        commandId: "apply-engineering-write",
        expectedRunRevision: awaitingRevision,
        changeSetId: String(changeSet["changeSetId"]),
        revision: Number(changeSet["revision"]),
        checksum: String(changeSet["checksum"]),
        decision: "apply_selected"
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-engineering-write")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("after\n");
    await expect(pathExists(join(contentRoot, ".novel-studio"))).resolves.toBe(false);
    await expect(pathExists(join(contentRoot, "history"))).resolves.toBe(false);
    await expect(pathExists(join(stateRoot, ".novel-studio", "project-lock.json"))).resolves.toBe(
      true
    );
    await expect(pathExists(join(stateRoot, "history", "agent-runs"))).resolves.toBe(true);
    await expect(pathExists(join(stateRoot, "history", "agent-transactions"))).resolves.toBe(true);
  });

  test("rejects a writing draft before resolving model facts or executing the model", async () => {
    const contentRoot = await createRoot("writing-content");
    const stateRoot = await createRoot("writing-state");
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "content\n", "utf8");
    const resolveModelStartFacts = vi.fn(async () => modelFacts());
    const streamRound = vi.fn(async function* () {
      yield { type: "round_completed" as const, finishReason: "stop" };
    });
    const runtime = createDesktopAgentRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "ws_writing_rejected",
      contentRoot,
      stateRoot,
      createRunId: () => "run-writing-rejected",
      resolveModelStartFacts,
      modelDriver: { streamRound }
    });
    expect(await runtime.prepare()).toMatchObject({ ok: true });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "ws_writing_rejected",
      commandId: "create-writing-rejected-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const draft = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "ws_writing_rejected",
      conversationId: conversation.value.conversationId,
      commandId: "sync-writing-rejected-draft",
      userRequest: "Write a chapter.",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-engineering",
      contextRefs: []
    });
    expect(draft).toMatchObject({ ok: true });
    if (!draft.ok) return;

    const started = await runtime.agentRunSession.startAgentRun({
      projectId: "ws_writing_rejected",
      conversationId: conversation.value.conversationId,
      commandId: "start-writing-rejected",
      expectedRunRevision: 0,
      runDraftId: draft.value.runDraft.runDraftId,
      runDraftRevision: draft.value.runDraft.revision,
      runDraftChecksum: draft.value.runDraft.checksum
    });

    expect(started).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_MODE_UNAVAILABLE" }
    });
    expect(resolveModelStartFacts).not.toHaveBeenCalled();
    expect(streamRound).not.toHaveBeenCalled();
  });
});

async function createRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-engineering-agent-${name}-`));
  roots.push(root);
  return root;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function executionCommand(conversationId: string, contextMode: "writing" | "general_file") {
  return {
    projectId: "ws_engineering",
    conversationId,
    commandId: "start-engineering-write",
    expectedRunRevision: 0,
    operationMode: "execution" as const,
    contextMode,
    writePolicy: "write_before_confirmation" as const,
    userRequest: "Update src/index.ts.",
    providerCapabilitySnapshot: {
      profileId: "demo-agent",
      provider: "demo",
      modelName: "desktop-scripted-agent",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000,
      requiredContextTokens: 8000
    }
  };
}

function toolCall(toolCallId: string, name: string, value: Record<string, unknown>) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(value)
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function modelFacts() {
  return {
    profileId: "profile-engineering",
    provider: "demo",
    modelName: "engineering-model",
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128000
    },
    requiredContextTokens: 8000,
    reasoningStrength: { status: "hidden" as const, reason: "test model" }
  };
}
