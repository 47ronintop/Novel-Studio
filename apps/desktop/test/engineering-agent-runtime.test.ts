import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ProjectLockFileRepository,
  type AgentOperationPathSnapshot,
  type AgentWriteLifecycleOperationPort,
  type EngineeringWorkspaceAccessSession
} from "@novel-studio/repository";
import { err, ok, type UnifiedError } from "@novel-studio/shared";
import { createDesktopAgentRuntime } from "../src/main/agent-run-runtime.js";
import { createAgentFeatureFlags } from "../src/main/agent-feature-flags.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
});

describe("engineering Agent runtime", () => {
  test("keeps qualified engineering access read-only when Phase B and a legacy lifecycle port are injected", async () => {
    const contentRoot = await createRoot("content");
    const stateRoot = await createRoot("state");
    await mkdir(join(contentRoot, "src"), { recursive: true });
    await writeFile(join(contentRoot, "src", "index.ts"), "before\n", "utf8");
    const lockOwnerId = "engineering-agent-runtime-test";
    const lock = new ProjectLockFileRepository({ projectRoot: stateRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    const observedTools: string[][] = [];
    const runtime = createDesktopAgentRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "ws_engineering",
      contentRoot,
      stateRoot,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-engineering-write",
      engineeringWorkspaceAccessSession: createTestingEngineeringAccessSession(),
      lifecycleOperations: createTestingReplaceLifecyclePort(contentRoot),
      featureFlags: createAgentFeatureFlags({
        phaseB_fileLifecycleEnabled: true,
        revision: "engineering-edit-text-test"
      }),
      modelDriver: {
        async *streamRound(input) {
          observedTools.push(input.tools.map((tool) => tool.name));
          yield toolCall("finish-engineering", "finish", { summary: "Read-only." });
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
    ).toMatchObject({
      ok: true,
      value: {
        scope: {
          kind: "workspace",
          workspaceKind: "engineeringWorkspace",
          workspaceId: "ws_engineering"
        }
      }
    });
    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun("run-engineering-write");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(observedTools).toHaveLength(1);
    expect(observedTools[0]).not.toContain("edit_text");
    expect(observedTools[0]).not.toContain("create_resource");
    expect(observedTools[0]).not.toContain("manage_path");
    expect(await readFile(join(contentRoot, "src", "index.ts"), "utf8")).toBe("before\n");
    await expect(pathExists(join(contentRoot, ".novel-studio"))).resolves.toBe(false);
    await expect(pathExists(join(contentRoot, "history"))).resolves.toBe(false);
    await expect(pathExists(join(stateRoot, ".novel-studio", "project-lock.json"))).resolves.toBe(
      true
    );
    await expect(pathExists(join(stateRoot, "history", "agent-runs"))).resolves.toBe(true);
    await expect(pathExists(join(stateRoot, "history", "agent-transactions"))).resolves.toBe(false);
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
      error: {
        code: "AGENT_CONTEXT_PREVIEW_REQUIRED",
        message: "A current context preview is required before this Agent request can start."
      }
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

function createTestingEngineeringAccessSession(): EngineeringWorkspaceAccessSession {
  const binding = {
    rootBindingId: "engineering-agent-runtime-root",
    pathPolicyRevision: "engineering-agent-runtime-policy-v1"
  };
  return {
    binding,
    async listDirectory() {
      return ok({ entries: [] });
    },
    async readTextFile() {
      return err(testLifecycleError("AGENT_PROJECT_FILE_NOT_FOUND"));
    },
    async searchText() {
      return ok({ matches: [], truncated: false });
    },
    async buildIndex() {
      return ok({ files: [], truncated: false });
    },
    async close() {
      return ok({ closed: true });
    }
  };
}

function createTestingReplaceLifecyclePort(projectRoot: string): AgentWriteLifecycleOperationPort {
  return {
    async mutate(input) {
      if (input.kind !== "replace_file") {
        return err(testLifecycleError("TEST_LIFECYCLE_MUTATION_UNSUPPORTED"));
      }
      if (!(await testingSnapshotsMatch(projectRoot, input.before))) {
        return err(testLifecycleError("TEST_LIFECYCLE_PRECONDITION_FAILED"));
      }
      const targetPath = testingProjectPath(projectRoot, input.relativePath);
      if (targetPath === undefined) return err(testLifecycleError("TEST_LIFECYCLE_PATH_INVALID"));
      await writeFile(targetPath, input.content, "utf8");
      return (await testingSnapshotsMatch(projectRoot, input.after))
        ? ok(undefined)
        : err(testLifecycleError("TEST_LIFECYCLE_POSTCONDITION_FAILED"));
    }
  };
}

async function testingSnapshotsMatch(
  projectRoot: string,
  expected: readonly AgentOperationPathSnapshot[]
): Promise<boolean> {
  for (const snapshot of expected) {
    const targetPath = testingProjectPath(projectRoot, snapshot.relativePath);
    if (targetPath === undefined) return false;
    let actual: AgentOperationPathSnapshot;
    try {
      const content = await readFile(targetPath, "utf8");
      actual = {
        kind: "file",
        relativePath: snapshot.relativePath,
        content,
        checksum: sha256(content)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
      actual = { kind: "missing", relativePath: snapshot.relativePath };
    }
    if (
      actual.kind !== snapshot.kind ||
      actual.relativePath !== snapshot.relativePath ||
      (actual.kind === "file" &&
        (snapshot.kind !== "file" ||
          actual.checksum !== snapshot.checksum ||
          actual.content !== snapshot.content))
    ) {
      return false;
    }
  }
  return true;
}

function testingProjectPath(projectRoot: string, relativePath: string): string | undefined {
  if (isAbsolute(relativePath)) return undefined;
  const targetPath = join(projectRoot, relativePath);
  const pathFromRoot = relative(projectRoot, targetPath);
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
    ? targetPath
    : undefined;
}

function testLifecycleError(code: string): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: "err_engineering_agent_lifecycle_test",
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Fix the lifecycle test setup.",
    traceId: "engineering-agent-runtime-test"
  };
}
