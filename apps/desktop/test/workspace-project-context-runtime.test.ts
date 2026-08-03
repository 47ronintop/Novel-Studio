import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentModelRoundInput } from "@novel-studio/application";
import {
  AgentRunFileRepository,
  type CreativeProjectFileTreeSnapshot
} from "@novel-studio/repository";
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createDesktopAgentRunSession,
  createDesktopAgentRuntime
} from "../src/main/agent-run-runtime.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop workspace project context runtime", () => {
  test("injects conventions and the profile-specific outline before the user request", async () => {
    const engineering = await createRoots("engineering-profile");
    await mkdir(join(engineering.contentRoot, "src"), { recursive: true });
    await writeFile(join(engineering.contentRoot, "AGENTS.md"), "ENGINEERING_CONVENTION", "utf8");
    await writeFile(join(engineering.contentRoot, "src", "main.ts"), "export {};\n", "utf8");
    const engineeringInput = await firstRound({
      workspaceKind: "engineeringWorkspace",
      projectId: "workspace-engineering",
      contextMode: "general_file",
      ...engineering
    });
    expectProjectPrefix(engineeringInput, "ENGINEERING_CONVENTION", "src/main.ts");

    const writing = await createRoots("writing-profile");
    await mkdir(join(writing.contentRoot, "conventions"), { recursive: true });
    await mkdir(join(writing.contentRoot, "chapters"), { recursive: true });
    await mkdir(join(writing.contentRoot, "characters"), { recursive: true });
    await writeFile(
      join(writing.contentRoot, "conventions", "writing.md"),
      "WRITING_CONVENTION",
      "utf8"
    );
    await writeFile(
      join(writing.contentRoot, "chapters", "chapter-01.md"),
      '---\nschemaVersion: "1.0"\nid: chapter-01\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\nwordCount: 321\ncreatedAt: "2026-01-01T00:00:00.000Z"\nupdatedAt: "2026-01-01T00:00:00.000Z"\n---\nCHAPTER_BODY_SECRET',
      "utf8"
    );
    await writeFile(
      join(writing.contentRoot, "characters", "alex.json"),
      '{"schemaVersion":"1.0","id":"character-alex","type":"character","title":"Alex","summary":"STORY_BIBLE_BODY_SECRET"}',
      "utf8"
    );
    const writingInput = await firstRound({
      workspaceKind: "creativeProject",
      projectId: "workspace-writing",
      contextMode: "writing",
      ...writing
    });
    expectProjectPrefix(writingInput, "WRITING_CONVENTION", 'chapter id="chapter-01"');
    expect(JSON.stringify(writingInput.messages)).toContain("story_bible_asset");
    expect(JSON.stringify(writingInput.messages)).toContain("character-alex");
    expect(JSON.stringify(writingInput.messages)).not.toContain("CHAPTER_BODY_SECRET");
    expect(JSON.stringify(writingInput.messages)).not.toContain("STORY_BIBLE_BODY_SECRET");

    const creative = await createRoots("creative-profile");
    await mkdir(join(creative.contentRoot, "conventions"), { recursive: true });
    await writeFile(
      join(creative.contentRoot, "conventions", "writing.md"),
      "CREATIVE_CONVENTION",
      "utf8"
    );
    const creativeInput = await firstRound({
      workspaceKind: "creativeProject",
      projectId: "workspace-creative",
      contextMode: "general_file",
      reattestCreativeProjectFileTreeSnapshot: async () => ok(creativeTree("workspace-creative")),
      ...creative
    });
    expectProjectPrefix(creativeInput, "CREATIVE_CONVENTION", "notes/brief.md");
    expect(JSON.stringify(creativeInput.messages)).not.toContain("chapters/managed.md");
  });

  test("preview, start, and first round share the same convention/outline budget operands", async () => {
    const roots = await createRoots("preview-boundary");
    await mkdir(join(roots.contentRoot, "conventions"), { recursive: true });
    await writeFile(
      join(roots.contentRoot, "conventions", "writing.md"),
      "PREVIEW_CONVENTION",
      "utf8"
    );
    const getTree = vi.fn(async () => ok(creativeTree("workspace-preview")));
    const modelInputs: AgentModelRoundInput[] = [];
    let notifyRoundStarted: (() => void) | undefined;
    const roundStarted = new Promise<void>((resolve) => {
      notifyRoundStarted = resolve;
    });
    const userDataRoot = await createRoot("preview-user-data");
    const runtime = createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "workspace-preview",
      ...roots,
      userDataRoot,
      workspaceTrust: "trusted",
      projectConventionsEnabled: true,
      reattestCreativeProjectFileTreeSnapshot: getTree,
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      createRunId: () => "run-preview-boundary",
      resolveModelStartFacts: async () => modelFacts("profile-preview"),
      modelDriver: {
        async *streamRound(input) {
          modelInputs.push(input);
          notifyRoundStarted?.();
          await new Promise<void>((resolve) => {
            if (input.signal.aborted) resolve();
            else input.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          if (!input.signal.aborted) {
            yield { type: "round_completed", finishReason: "stop" };
          }
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "workspace-preview",
      commandId: "create-preview-conversation"
    });
    if (!conversation.ok) throw conversation.error;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "workspace-preview",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-preview",
      userRequest: "Preview context.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-preview",
      contextRefs: []
    });
    if (!prepared.ok) throw prepared.error;

    const preview = await runtime.agentContextSession.previewPackedContext({
      projectId: "workspace-preview",
      conversationId: conversation.value.conversationId,
      commandId: "preview-context",
      runDraftId: prepared.value.runDraft.runDraftId,
      expectedDraftRevision: prepared.value.runDraft.revision,
      runDraftChecksum: prepared.value.runDraft.checksum
    });

    expect(preview).toMatchObject({
      ok: true,
      value: { budget: { systemReserve: expect.any(Number) } }
    });
    if (!preview.ok) throw preview.error;
    const budget = preview.value.budget;
    expect(getTree).toHaveBeenCalledTimes(1);

    const started = await runtime.agentRunSession.startAgentRun({
      projectId: "workspace-preview",
      conversationId: conversation.value.conversationId,
      commandId: "start-preview-context",
      expectedRunRevision: 0,
      runDraftId: prepared.value.runDraft.runDraftId,
      runDraftRevision: prepared.value.runDraft.revision,
      runDraftChecksum: prepared.value.runDraft.checksum,
      packedContextId: preview.value.packedContextId,
      packedContextPayloadChecksum: preview.value.payloadChecksum
    });
    if (!started.ok) throw started.error;
    await roundStarted;
    expect(getTree).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(modelInputs[0]?.messages)).toContain("PREVIEW_CONVENTION");
    const roundBudget = modelInputs[0]?.contextBudget;
    expect(roundBudget).toBeDefined();
    const repository = new AgentRunFileRepository({ projectRoot: roots.stateRoot });
    const run = await repository.readSnapshot("run-preview-boundary");
    if (!run.ok || run.value === undefined) throw new Error("Expected persisted run");
    const startBudgetId = String(run.value["contextBudgetSnapshotId"]);
    const startBudget = await repository.readBudgetSnapshot("run-preview-boundary", startBudgetId);
    if (!startBudget.ok || startBudget.value === undefined || roundBudget === undefined) {
      throw new Error("Expected persisted C4 budgets");
    }
    const comparable = (value: Record<string, unknown>) => ({
      contextWindow: value["contextWindow"],
      safeInputBudget: value["safeInputBudget"],
      toolReserve: value["toolReserve"],
      systemReserve: value["systemReserve"],
      usedTokens: value["usedTokens"],
      audit: value["audit"]
    });
    expect(comparable(startBudget.value)).toEqual(
      comparable(budget as unknown as Record<string, unknown>)
    );
    expect(comparable(roundBudget as unknown as Record<string, unknown>)).toEqual(
      comparable(startBudget.value)
    );

    const live = await runtime.agentRunSession.readAgentRun("run-preview-boundary");
    if (!live.ok) throw live.error;
    const compacted = await runtime.agentRunSession.compactContext({
      projectId: "workspace-preview",
      runId: "run-preview-boundary",
      commandId: "compact-preview-context",
      expectedRunRevision: live.value.snapshot.runRevision,
      contextBudgetSnapshotId: startBudgetId,
      trigger: "manual"
    });
    if (!compacted.ok) throw compacted.error;
    const compactedBudgetId = compacted.value.contextBudgetSnapshotId;
    if (compactedBudgetId === null) throw new Error("Expected compacted budget id");
    const compactedBudget = await repository.readBudgetSnapshot(
      "run-preview-boundary",
      compactedBudgetId
    );
    if (!compactedBudget.ok || compactedBudget.value === undefined) {
      throw new Error("Expected compacted C4 budget");
    }
    expect(comparable(compactedBudget.value)).toEqual(comparable(roundBudget));

    const afterCompaction = await runtime.agentRunSession.readAgentRun("run-preview-boundary");
    if (!afterCompaction.ok) throw afterCompaction.error;
    await runtime.agentRunSession.stopAgentRun({
      projectId: "workspace-preview",
      runId: "run-preview-boundary",
      commandId: "stop-preview-context",
      expectedRunRevision: afterCompaction.value.snapshot.runRevision
    });
  });

  test("fails a persisted creative general-file start without a Main Files-surface proof", async () => {
    const roots = await createRoots("creative-general-proof-required");
    const runtime = createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "workspace-proof-required",
      ...roots,
      createRunId: () => "run-proof-required"
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "workspace-proof-required",
      commandId: "create-proof-required-conversation"
    });
    if (!conversation.ok) throw conversation.error;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "workspace-proof-required",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-proof-required",
      userRequest: "Inspect the Files surface.",
      operationMode: "planning",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-proof-required",
      contextRefs: [],
      activeResourceRef: null
    });
    if (!prepared.ok) throw prepared.error;

    await expect(
      runtime.agentRunSession.startAgentRun({
        projectId: "workspace-proof-required",
        conversationId: conversation.value.conversationId,
        commandId: "start-proof-required",
        expectedRunRevision: 0,
        runDraftId: prepared.value.runDraft.runDraftId,
        runDraftRevision: prepared.value.runDraft.revision,
        runDraftChecksum: prepared.value.runDraft.checksum
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_PREVIEW_REQUIRED" }
    });
  });

  test("detects a convention change outside the injected truncation range, refreshes, and hydrates", async () => {
    const roots = await createRoots("conventions-stale");
    await writeFile(join(roots.contentRoot, "README.md"), "read target\n", "utf8");
    const original = "😀".repeat(4_500);
    const changed = `${"😀".repeat(4_000)}X${"😀".repeat(499)}`;
    await writeFile(join(roots.contentRoot, "AGENTS.md"), original, "utf8");
    let round = 0;
    const session = createDesktopAgentRunSession({
      workspaceKind: "engineeringWorkspace",
      projectId: "workspace-conventions-stale",
      ...roots,
      workspaceTrust: "trusted",
      projectConventionsEnabled: true,
      createRunId: () => "run-conventions-stale",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            await writeFile(join(roots.contentRoot, "AGENTS.md"), changed, "utf8");
            yield toolCall("read-before-conventions-refresh", "read_resource", {
              ref: "file:README.md"
            });
          } else {
            yield toolCall("finish-after-conventions-refresh", "finish", { summary: "Done." });
          }
          yield { type: "round_completed" as const, finishReason: "tool_calls" };
        }
      }
    });

    const started = await session.startAgentRun(
      startCommand("workspace-conventions-stale", "general_file")
    );
    if (!started.ok) throw started.error;
    const initialArtifactId = started.value.conventionsArtifactId;
    expect(initialArtifactId).toEqual(expect.any(String));
    await waitForStatus(session, "run-conventions-stale", "awaiting_context_refresh");
    const stale = await session.readAgentRun("run-conventions-stale");
    if (!stale.ok) throw stale.error;
    expect(stale.value.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context_stale",
          detail: expect.objectContaining({
            staleRefs: [expect.stringContaining("project_conventions_")]
          })
        })
      ])
    );
    const refreshed = await session.refreshContext({
      projectId: "workspace-conventions-stale",
      runId: "run-conventions-stale",
      commandId: "refresh-conventions",
      expectedRunRevision: stale.value.snapshot.runRevision,
      decision: "refresh"
    });
    if (!refreshed.ok) throw refreshed.error;
    await waitForStatus(session, "run-conventions-stale", "completed");

    const repository = new AgentRunFileRepository({ projectRoot: roots.stateRoot });
    const completed = await session.readAgentRun("run-conventions-stale");
    if (!completed.ok || completed.value.snapshot.contextSnapshotId === null) {
      throw new Error("Expected refreshed context snapshot");
    }
    const context = await repository.readContextSnapshot(
      "run-conventions-stale",
      completed.value.snapshot.contextSnapshotId
    );
    if (!context.ok || context.value === undefined) throw new Error("Expected context snapshot");
    const convention = (context.value["sources"] as Record<string, unknown>[]).find(
      (source) => source["sourceKind"] === "project_conventions"
    );
    const materialization = convention?.["sourceMaterialization"] as Record<string, unknown>;
    expect(convention?.["sourceRevision"]).toBe(1);
    expect(materialization["artifactId"]).not.toBe(initialArtifactId);
    expect(completed.value.snapshot.conventionsArtifactId).toBe(materialization["artifactId"]);
    const artifact = await repository.readContextSourceMaterialization(
      "run-conventions-stale",
      String(materialization["artifactId"])
    );
    expect(artifact).toMatchObject({
      ok: true,
      value: {
        content: "😀".repeat(1_000),
        materialization: {
          truncationRange: { start: 0, end: 1_000, originalEnd: 4_500 }
        }
      }
    });

    const hydrated = createDesktopAgentRunSession({
      workspaceKind: "engineeringWorkspace",
      projectId: "workspace-conventions-stale",
      ...roots,
      workspaceTrust: "trusted",
      projectConventionsEnabled: true,
      modelDriver: finishingDriver([])
    });
    await expect(hydrated.readAgentRun("run-conventions-stale")).resolves.toMatchObject({
      ok: true,
      value: { snapshot: { status: "completed" } }
    });
  });

  test("refreshes a stale engineering outline to a new artifact and source revision", async () => {
    const roots = await createRoots("outline-stale");
    await mkdir(join(roots.contentRoot, "src"), { recursive: true });
    await writeFile(join(roots.contentRoot, "README.md"), "read target\n", "utf8");
    await writeFile(join(roots.contentRoot, "src", "before.ts"), "export {};\n", "utf8");
    let round = 0;
    const session = createDesktopAgentRunSession({
      workspaceKind: "engineeringWorkspace",
      projectId: "workspace-outline-stale",
      ...roots,
      createRunId: () => "run-outline-stale",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            await writeFile(join(roots.contentRoot, "src", "added.ts"), "export {};\n", "utf8");
            yield toolCall("read-before-outline-refresh", "read_resource", {
              ref: "file:README.md"
            });
          } else {
            yield toolCall("finish-after-outline-refresh", "finish", { summary: "Done." });
          }
          yield { type: "round_completed" as const, finishReason: "tool_calls" };
        }
      }
    });

    const started = await session.startAgentRun(
      startCommand("workspace-outline-stale", "general_file")
    );
    if (!started.ok || started.value.contextSnapshotId === null) throw new Error("Start failed");
    const repository = new AgentRunFileRepository({ projectRoot: roots.stateRoot });
    const initial = await repository.readContextSnapshot(
      "run-outline-stale",
      started.value.contextSnapshotId
    );
    if (!initial.ok || initial.value === undefined) throw new Error("Missing initial context");
    const initialOutline = (initial.value["sources"] as Record<string, unknown>[]).find(
      (source) => source["sourceKind"] === "workspace_outline"
    );
    const initialMaterialization = initialOutline?.["sourceMaterialization"] as Record<
      string,
      unknown
    >;

    await waitForStatus(session, "run-outline-stale", "awaiting_context_refresh");
    const stale = await session.readAgentRun("run-outline-stale");
    if (!stale.ok) throw stale.error;
    expect(stale.value.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context_stale",
          detail: expect.objectContaining({
            staleRefs: [expect.stringContaining("workspace_outline_")]
          })
        })
      ])
    );
    const refreshed = await session.refreshContext({
      projectId: "workspace-outline-stale",
      runId: "run-outline-stale",
      commandId: "refresh-outline",
      expectedRunRevision: stale.value.snapshot.runRevision,
      decision: "refresh"
    });
    if (!refreshed.ok) throw refreshed.error;
    await waitForStatus(session, "run-outline-stale", "completed");
    const completed = await session.readAgentRun("run-outline-stale");
    if (!completed.ok || completed.value.snapshot.contextSnapshotId === null) {
      throw new Error("Expected refreshed context");
    }
    const next = await repository.readContextSnapshot(
      "run-outline-stale",
      completed.value.snapshot.contextSnapshotId
    );
    if (!next.ok || next.value === undefined) throw new Error("Missing refreshed context");
    const nextOutline = (next.value["sources"] as Record<string, unknown>[]).find(
      (source) => source["sourceKind"] === "workspace_outline"
    );
    const nextMaterialization = nextOutline?.["sourceMaterialization"] as Record<string, unknown>;
    expect(nextOutline?.["sourceRevision"]).toBe(1);
    expect(nextMaterialization["artifactId"]).not.toBe(initialMaterialization["artifactId"]);
    const artifact = await repository.readContextSourceMaterialization(
      "run-outline-stale",
      String(nextMaterialization["artifactId"])
    );
    expect(JSON.stringify(artifact)).toContain("src/added.ts");
  });

  test("treats a deleted selected Story Bible asset as stale context that can be excluded", async () => {
    const roots = await createRoots("story-bible-missing");
    await mkdir(join(roots.contentRoot, "characters"), { recursive: true });
    await writeFile(join(roots.contentRoot, "README.md"), "read target\n", "utf8");
    const assetPath = join(roots.contentRoot, "characters", "chr_mira.json");
    const asset = JSON.stringify({
      schemaVersion: "1.0",
      id: "chr_mira",
      type: "character",
      title: "Mira",
      status: "active",
      summary: "Captain of the city watch.",
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z"
    });
    await writeFile(assetPath, asset, "utf8");

    let round = 0;
    const session = createDesktopAgentRunSession({
      workspaceKind: "creativeProject",
      projectId: "workspace-story-bible-missing",
      ...roots,
      createRunId: () => "run-story-bible-missing",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            await unlink(assetPath);
            yield toolCall("read-before-story-bible-refresh", "read_resource", {
              ref: "file:README.md"
            });
          } else {
            yield toolCall("finish-after-story-bible-exclude", "finish", { summary: "Done." });
          }
          yield { type: "round_completed" as const, finishReason: "tool_calls" };
        }
      }
    });

    let exclusionTriggered = false;
    const immediateExclusion = new Promise<void>((resolve, reject) => {
      const unsubscribe = session.subscribe((event) => {
        if (
          exclusionTriggered ||
          event.runId !== "run-story-bible-missing" ||
          event.type !== "context_stale"
        ) {
          return;
        }
        exclusionTriggered = true;
        unsubscribe();
        void session
          .refreshContext({
            projectId: "workspace-story-bible-missing",
            runId: "run-story-bible-missing",
            commandId: "exclude-missing-story-bible",
            expectedRunRevision: event.runRevision,
            decision: "exclude"
          })
          .then((result) => {
            if (!result.ok) throw result.error;
            resolve();
          })
          .catch(reject);
      });
    });

    const started = await session.startAgentRun({
      ...startCommand("workspace-story-bible-missing", "writing"),
      initialContextSources: [
        {
          refId: "story_bible:chr_mira",
          sourceKind: "story_bible_asset" as const,
          assetId: "chr_mira",
          content: asset,
          dirty: false
        }
      ]
    });
    if (!started.ok) throw started.error;
    await immediateExclusion;

    const stale = await session.readAgentRun("run-story-bible-missing");
    if (!stale.ok) throw stale.error;
    expect(stale.value.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "context_stale",
          detail: expect.objectContaining({
            staleRefs: expect.arrayContaining(["story_bible:chr_mira"])
          })
        })
      ])
    );
    const errorRecordedIndex = stale.value.events.findIndex(
      (event) => event.type === "error_recorded" && event.detail?.["code"] === "AGENT_CONTEXT_STALE"
    );
    const contextStaleIndex = stale.value.events.findIndex(
      (event) => event.type === "context_stale"
    );
    expect(errorRecordedIndex).toBeGreaterThanOrEqual(0);
    expect(contextStaleIndex).toBeGreaterThan(errorRecordedIndex);
    await vi.waitFor(async () => {
      const current = await session.readAgentRun("run-story-bible-missing");
      expect(["completed", "awaiting_context_refresh"]).toContain(
        current.ok ? current.value.snapshot.status : undefined
      );
    });
    const afterAssetExclusion = await session.readAgentRun("run-story-bible-missing");
    if (!afterAssetExclusion.ok) throw afterAssetExclusion.error;
    if (afterAssetExclusion.value.snapshot.status === "awaiting_context_refresh") {
      expect(afterAssetExclusion.value.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "context_stale",
            detail: expect.objectContaining({
              staleRefs: expect.arrayContaining([expect.stringContaining("workspace_outline_")])
            })
          })
        ])
      );
      const outlineExcluded = await session.refreshContext({
        projectId: "workspace-story-bible-missing",
        runId: "run-story-bible-missing",
        commandId: "exclude-stale-outline-after-story-bible",
        expectedRunRevision: afterAssetExclusion.value.snapshot.runRevision,
        decision: "exclude"
      });
      if (!outlineExcluded.ok) throw outlineExcluded.error;
    }
    await waitForStatus(session, "run-story-bible-missing", "completed");

    const completed = await session.readAgentRun("run-story-bible-missing");
    if (!completed.ok) throw completed.error;
    expect(completed.value.events.some((event) => event.type === "run_failed")).toBe(false);
  });
});

async function firstRound(input: {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectId: string;
  readonly contentRoot: string;
  readonly stateRoot: string;
  readonly contextMode: "writing" | "general_file";
  readonly reattestCreativeProjectFileTreeSnapshot?: () => Promise<
    Result<CreativeProjectFileTreeSnapshot | undefined, UnifiedError>
  >;
}): Promise<AgentModelRoundInput> {
  const inputs: AgentModelRoundInput[] = [];
  const session = createDesktopAgentRunSession({
    ...input,
    workspaceTrust: "trusted",
    projectConventionsEnabled: true,
    createRunId: () => `run-${input.projectId}`,
    modelDriver: finishingDriver(inputs)
  });
  const started = await session.startAgentRun(startCommand(input.projectId, input.contextMode));
  if (!started.ok) throw started.error;
  await waitForStatus(session, started.value.runId, "completed");
  const first = inputs[0];
  if (first === undefined) throw new Error("Expected first model input");
  return first;
}

function expectProjectPrefix(
  input: AgentModelRoundInput,
  conventionMarker: string,
  outlineMarker: string
): void {
  const sources = input.messages
    .map((message, index) => ({ message, index, payload: parseJson(message.content) }))
    .filter(({ payload }) => payload?.["kind"] === "untrusted_project_data");
  expect(
    sources.map(({ payload }) =>
      String((payload?.["source"] as Record<string, unknown> | undefined)?.["sourceKind"])
    )
  ).toEqual(["project_conventions", "workspace_outline"]);
  expect(sources[0]?.message.role).toBe("user");
  expect(sources[1]?.message.role).toBe("user");
  expect(String(sources[0]?.payload?.["data"])).toContain(conventionMarker);
  expect(String(sources[1]?.payload?.["data"])).toContain(outlineMarker);
  const requestIndex = input.messages.findIndex(
    (message) => message.content === "Inspect context."
  );
  expect(sources[1]?.index).toBeLessThan(requestIndex);
  expect(input.systemPrompt).not.toContain(conventionMarker);
  expect(input.systemPrompt).not.toContain(outlineMarker);
}

function finishingDriver(inputs: AgentModelRoundInput[]) {
  return {
    async *streamRound(input: AgentModelRoundInput) {
      inputs.push(input);
      yield toolCall("finish-context", "finish", { summary: "Done." });
      yield { type: "round_completed" as const, finishReason: "tool_calls" };
    }
  };
}

function startCommand(projectId: string, contextMode: "writing" | "general_file") {
  return {
    projectId,
    conversationId: `conversation-${projectId}`,
    commandId: `start-${projectId}`,
    expectedRunRevision: 0,
    operationMode: "execution" as const,
    contextMode,
    writePolicy: "write_before_confirmation" as const,
    userRequest: "Inspect context.",
    providerCapabilitySnapshot: {
      profileId: "demo-agent",
      provider: "demo",
      modelName: "context-runtime-model",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128_000,
      requiredContextTokens: 8_000
    }
  };
}

function modelFacts(profileId: string) {
  return {
    profileId,
    provider: "demo",
    modelName: "context-runtime-model",
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 128_000
    },
    requiredContextTokens: 8_000,
    reasoningStrength: { status: "hidden" as const, reason: "test model" }
  };
}

function creativeTree(workspaceId: string): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.0",
    projectId: workspaceId,
    workspaceId,
    policyVersion: "1.0",
    treeRevision: "tree:context-runtime",
    nodes: [
      {
        id: "node:notes",
        name: "notes",
        kind: "directory",
        path: "notes",
        nodeRevision: "node:notes",
        children: [
          {
            id: "node:brief",
            name: "brief.md",
            kind: "file",
            path: "notes/brief.md",
            nodeRevision: "node:brief"
          }
        ]
      },
      {
        id: "node:managed",
        name: "chapters",
        kind: "directory",
        path: "chapters",
        nodeRevision: "node:managed",
        children: [
          {
            id: "node:managed-file",
            name: "managed.md",
            kind: "file",
            path: "chapters/managed.md",
            nodeRevision: "node:managed-file"
          }
        ]
      }
    ],
    truncated: false,
    truncationReasons: [],
    dependencyManifestChecksum: "d".repeat(64)
  };
}

async function createRoots(label: string): Promise<{
  readonly contentRoot: string;
  readonly stateRoot: string;
}> {
  return {
    contentRoot: await createRoot(`${label}-content`),
    stateRoot: await createRoot(`${label}-state`)
  };
}

async function createRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-${label}-`));
  roots.push(root);
  return root;
}

async function waitForStatus(
  session: ReturnType<typeof createDesktopAgentRunSession>,
  runId: string,
  status: string
): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await session.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status } }
      });
    },
    { timeout: 10_000 }
  );
}

function toolCall(toolCallId: string, name: string, value: Record<string, unknown>) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(value)
  };
}

function parseJson(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
