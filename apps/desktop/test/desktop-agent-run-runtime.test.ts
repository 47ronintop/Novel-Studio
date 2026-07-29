import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AgentUsageFileRepository,
  ProjectLockFileRepository,
  RecoveryRepository,
  StoryBibleFileRepository,
  type AgentTransactionJournal,
  type AgentOperationPathSnapshot,
  type AgentWriteLifecycleOperationPort
} from "@novel-studio/repository";
import { err, ok, type UnifiedError } from "@novel-studio/shared";

import * as runtimeExports from "../src/main/agent-run-runtime.js";
import { createAgentFeatureFlags } from "../src/main/agent-feature-flags.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
});

describe("desktop Agent Run runtime", () => {
  test.each([
    {
      label: "creative trusted fallback",
      workspaceKind: "creativeProject" as const,
      withProjectLock: true,
      withNativeLifecycle: false,
      expected: "standard_trusted_creative"
    },
    {
      label: "creative runtime without a transaction executor",
      workspaceKind: "creativeProject" as const,
      withProjectLock: false,
      withNativeLifecycle: false,
      expected: "unavailable"
    },
    {
      label: "engineering runtime without native lifecycle",
      workspaceKind: "engineeringWorkspace" as const,
      withProjectLock: true,
      withNativeLifecycle: false,
      expected: "unavailable"
    },
    {
      label: "qualified lifecycle contract",
      workspaceKind: "creativeProject" as const,
      withProjectLock: true,
      withNativeLifecycle: true,
      expected: "hardened_native"
    }
  ])("records the write backend trust for $label", async (testCase) => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-write-trust-"));
    roots.push(projectRoot);
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: testCase.workspaceKind,
      projectId: "project-write-trust",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      ...(testCase.withProjectLock ? { projectLockOwnerId: "write-trust-owner" } : {}),
      ...(testCase.withNativeLifecycle
        ? { lifecycleOperations: createTestingReplaceLifecyclePort(projectRoot) }
        : {})
    });

    const summary = await runtime.agentPermissionSession.prepareForDraft({
      projectId: "project-write-trust",
      runDraftId: `draft-${testCase.expected}`,
      runDraftRevision: 1,
      operationMode: "execution",
      contextMode: testCase.workspaceKind === "creativeProject" ? "writing" : "general_file",
      writePolicy: "write_before_confirmation"
    });

    expect(summary).toMatchObject({
      ok: true,
      value: { writeMutationTrust: testCase.expected }
    });
  });

  test("recovers a trusted creative rename completed before the journal update", async () => {
    const contentRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-recovery-content-"));
    const stateRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-recovery-state-"));
    roots.push(contentRoot, stateRoot);
    const relativePath = "notes.txt";
    const before = "Before crash.\n";
    const candidate = "Candidate already renamed.\n";
    await writeFile(join(contentRoot, relativePath), candidate, "utf8");
    const lockOwnerId = "desktop-trusted-recovery";
    const lock = new ProjectLockFileRepository({ projectRoot: stateRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    const changeSetChecksum = "c".repeat(64);
    const recovery = new RecoveryRepository({ projectRoot: stateRoot });
    const journal: AgentTransactionJournal = {
      schemaVersion: "1.0",
      transactionId: "tx_desktop_trusted_recovery",
      versionGroupId: "vg_desktop_trusted_recovery",
      kind: "apply",
      runId: "run-desktop-trusted-recovery",
      runSequence: 1,
      checkpointId: "checkpoint-desktop-trusted-recovery",
      changeSetId: "changes-desktop-trusted-recovery",
      changeSetRevision: 1,
      changeSetChecksum,
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: sha256(`changes-desktop-trusted-recovery:1:${changeSetChecksum}`),
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:01.000Z",
      transactionStatus: "applying",
      entries: [
        {
          writeId: "write-desktop-trusted-recovery",
          relativePath,
          assetType: "text",
          beforeChecksum: sha256(before),
          candidateChecksum: sha256(candidate),
          beforeContent: before,
          candidateContent: candidate,
          beforeVersionId: "version-before-desktop-trusted-recovery",
          status: "pending"
        }
      ]
    };
    expect(await recovery.writeAgentTransactionJournal(journal)).toMatchObject({ ok: true });
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-desktop-trusted-recovery",
      contentRoot,
      stateRoot,
      projectLockOwnerId: lockOwnerId
    });

    expect(await runtime.prepare()).toMatchObject({ ok: true });

    expect(await readFile(join(contentRoot, relativePath), "utf8")).toBe(before);
    expect(await recovery.readAgentTransactionJournal("tx_desktop_trusted_recovery")).toMatchObject(
      {
        ok: true,
        value: {
          transactionStatus: "rolled_back",
          entries: [expect.objectContaining({ status: "rolled_back" })]
        }
      }
    );
  });

  test("exposes the usage session and enforces retention under the user-data root at startup", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "novel-studio-desktop-usage-session-project-")
    );
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-usage-session-data-"));
    roots.push(projectRoot, userDataRoot);
    const usageRepository = new AgentUsageFileRepository({ userDataRoot });
    const expired = desktopUsageRecord("expired_round", "2026-06-17", 1);
    const retained = desktopUsageRecord("retained_round", "2026-06-18", 2);
    expect((await usageRepository.writeFinal(expired)).ok).toBe(true);
    expect((await usageRepository.writeFinal(retained)).ok).toBe(true);

    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      userDataRoot,
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      usageTime: () => ({
        timestamp: "2026-07-17T12:00:00.000Z",
        localDate: "2026-07-17",
        timezone: "UTC",
        utcOffsetMinutes: 0
      })
    });
    expect(await runtime.prepare()).toMatchObject({ ok: true });
    const usageSession = (
      runtime as unknown as {
        agentUsageSession?: {
          listAgentUsage(query: Record<string, unknown>): Promise<Record<string, unknown>>;
        };
      }
    ).agentUsageSession;

    expect(usageSession).toBeDefined();
    await vi.waitFor(async () => {
      expect((await usageRepository.readById(String(expired["usageId"]))).value).toBeUndefined();
    });
    expect((await usageRepository.readById(String(retained["usageId"]))).value).toBeDefined();
    expect(
      await usageSession?.listAgentUsage({
        range: { fromLocalDate: "2026-06-18", toLocalDate: "2026-06-18" }
      })
    ).toMatchObject({
      ok: true,
      value: { days: [expect.objectContaining({ localDate: "2026-06-18" })] }
    });
  });

  test("persists completed model-round usage under the Electron user-data root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-usage-project-"));
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-usage-data-"));
    roots.push(projectRoot, userDataRoot);
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      userDataRoot,
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-usage",
      usageTime: () => ({
        timestamp: "2026-11-01T06:30:00.000Z",
        localDate: "2026-11-01",
        timezone: "America/New_York",
        utcOffsetMinutes: -300
      }),
      modelDriver: {
        async *streamRound() {
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
      }
    });

    await session.startAgentRun(executionCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-usage")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    const detailDirectory = join(userDataRoot, "agent-usage", "details");
    const detailFiles = await readdir(detailDirectory);
    expect(detailFiles).toHaveLength(1);
    const [detailFile] = detailFiles;
    if (detailFile === undefined) throw new Error("Expected one persisted usage detail file");
    const record = JSON.parse(await readFile(join(detailDirectory, detailFile), "utf8")) as Record<
      string,
      unknown
    >;
    expect(record).toMatchObject({
      runId: "run-desktop-usage",
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      provider: "demo",
      model: "desktop-scripted-agent",
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 25,
      pricingVersion: null,
      unitPrices: null,
      cost: { amount: 0.001, currency: "USD", status: "actual" },
      contextWindow: 128000,
      timestamp: "2026-11-01T06:30:00.000Z",
      localDate: "2026-11-01",
      timezone: "America/New_York",
      utcOffsetMinutes: -300
    });
    expect(record).not.toHaveProperty("projectId");
    expect(record["usageId"]).toBe(
      `run-desktop-usage:model_round_run-desktop-usage_1:${String(record["finalSequence"])}`
    );
    expect(record["safeInputBudget"]).toEqual(expect.any(Number));
    expect(record["safeInputBudget"]).toBeGreaterThan(0);
    expect(JSON.stringify(record)).not.toMatch(/prompt|body|authorization|providerFrame/i);
  });

  test("binds strict Conversation and Run persistence to the selected project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-conversation-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
    await writeFile(
      join(projectRoot, "chapters", `${chapterId}.md`),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-14T00:00:00.000Z"\nupdatedAt: "2026-07-14T00:00:00.000Z"\n---\n\nChapter body.\n`,
      "utf8"
    );
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      createRunId: () => "run-strict-conversation"
    });

    const created = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-strict-conversation"
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const conversationId = created.value.conversationId;
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand(conversationId, "start-strict-conversation")
      )
    ).toMatchObject({ ok: true });
    await vi.waitFor(
      async () => {
        expect(await runtime.agentRunSession.readAgentRun("run-strict-conversation")).toMatchObject(
          {
            ok: true,
            value: { snapshot: { conversationId, status: "plan_ready" } }
          }
        );
      },
      { timeout: 10_000 }
    );
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "conversations", conversationId, "conversation.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      conversationId
    });
    expect(
      JSON.parse(
        await readFile(
          join(projectRoot, "history", "agent-runs", "run-strict-conversation", "run.json"),
          "utf8"
        )
      )
    ).toMatchObject({
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project-01"
      },
      conversationId
    });

    const archived = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-archived-conversation"
    });
    expect(archived).toMatchObject({ ok: true });
    if (!archived.ok) return;
    expect(
      await runtime.agentConversationSession.archiveConversation({
        projectId: "project-01",
        conversationId: archived.value.conversationId,
        commandId: "archive-strict-conversation",
        expectedConversationRevision: archived.value.revision
      })
    ).toMatchObject({ ok: true, value: { status: "archived" } });
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand(archived.value.conversationId, "start-archived-conversation")
      )
    ).toMatchObject({ ok: false });
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand("conversation-missing", "start-missing-conversation")
      )
    ).toMatchObject({ ok: false });
  });

  test("treats a saved active editor as disk context during draft preflight", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-saved-editor-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D2";
    const relativePath = `chapters/${chapterId}.md`;
    const body = "Original saved chapter body.\n";
    await writeFile(
      join(projectRoot, relativePath),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Saved editor\norder: 1\nstatus: draft\ncreatedAt: "2026-07-17T00:00:00.000Z"\nupdatedAt: "2026-07-17T00:00:00.000Z"\n---\n\n${body}`,
      "utf8"
    );
    let round = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      createRunId: () => "run-saved-editor-preflight",
      readEditorBuffer: async (refId) => (refId === `chapter:${chapterId}` ? body : undefined),
      readEditorState: async (path) =>
        path === relativePath ? { dirty: false, content: body } : undefined,
      resolveModelStartFacts: async () => ({
        profileId: "profile-saved-editor",
        provider: "demo",
        modelName: "saved-editor-model",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: { status: "hidden", reason: "test model" }
      }),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-saved-editor", "edit_text", {
              ref: `chapter:${chapterId}`,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-saved-editor", "finish", { summary: "Finished." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-saved-editor-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-saved-editor-run",
      userRequest: "Revise the saved active chapter.",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-saved-editor",
      contextRefs: [
        {
          kind: "chapter",
          refId: `chapter:${chapterId}`,
          chapterId,
          label: "Saved editor"
        }
      ]
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;

    const started = await runtime.agentRunSession.startAgentRun({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "start-saved-editor-run",
      expectedRunRevision: 0,
      runDraftId: prepared.value.runDraft.runDraftId,
      runDraftRevision: prepared.value.runDraft.revision,
      runDraftChecksum: prepared.value.runDraft.checksum
    });
    expect(started).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun("run-saved-editor-preflight");
      expect(read).not.toMatchObject({
        value: {
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                message: "Save and refresh the dirty editor target before creating a Change Set."
              })
            })
          ])
        }
      });
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: { files: [{ relativePath }] }
        }
      });
    });
  });

  test("places a checksum-matched active creative file at the dynamic prompt suffix", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-active-file-suffix-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    const manualContent = "Manual research context.\n";
    const currentContent = "Current active file body.\n";
    await writeFile(join(projectRoot, "notes", "research.md"), manualContent, "utf8");
    await writeFile(join(projectRoot, "notes", "current.md"), currentContent, "utf8");
    const roundMessages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-active-file-suffix",
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      resolveModelStartFacts: async () => ({
        profileId: "profile-active-file",
        provider: "demo",
        modelName: "active-file-model",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: { status: "hidden", reason: "test model" }
      }),
      modelDriver: {
        async *streamRound(input) {
          roundMessages.push(input.messages);
          yield runtimeToolCall("finish-active-file-suffix", "finish", { summary: "Finished." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-active-file-suffix-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-active-file-suffix-run",
      userRequest: "Use the current project file.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-active-file",
      contextRefs: [],
      activeResourceRef: {
        kind: "project_file",
        refId: "file:notes/current.md",
        relativePath: "notes/current.md",
        label: "Current",
        expectedChecksum: sha256(currentContent)
      }
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const withManualRef = await runtime.agentRunDraftSession.updateContextDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "add-manual-active-file-suffix-ref",
      contextDraftId: prepared.value.contextDraft.contextDraftId,
      expectedDraftRevision: prepared.value.contextDraft.revision,
      mutation: {
        kind: "add_ref",
        ref: {
          kind: "project_file",
          refId: "file:notes/research.md",
          relativePath: "notes/research.md",
          label: "Research"
        }
      }
    });
    expect(withManualRef).toMatchObject({ ok: true });
    if (!withManualRef.ok) return;

    expect(
      await runtime.agentRunSession.startAgentRun({
        projectId: "project-01",
        conversationId: conversation.value.conversationId,
        commandId: "start-active-file-suffix-run",
        expectedRunRevision: 0,
        runDraftId: withManualRef.value.runDraft.runDraftId,
        runDraftRevision: withManualRef.value.runDraft.revision,
        runDraftChecksum: withManualRef.value.runDraft.checksum
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-active-file-suffix")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    const firstRoundMessages = roundMessages[0] ?? [];
    const requestIndex = firstRoundMessages.findIndex(
      (message) => message.role === "user" && message.content === "Use the current project file."
    );
    const activeIndex = firstRoundMessages.findIndex((message) =>
      message.content.includes("Current active file body.")
    );
    const manualIndex = firstRoundMessages.findIndex((message) =>
      message.content.includes("Manual research context.")
    );
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(manualIndex).toBeGreaterThan(requestIndex);
    expect(activeIndex).toBeGreaterThan(manualIndex);
    expect(firstRoundMessages.at(-1)?.content).toContain("Current active file body.");
  });

  test("fails closed when an active creative file changes after its checksum is captured", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-active-file-stale-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    const savedContent = "Saved active file body.\n";
    await writeFile(join(projectRoot, "notes", "current.md"), savedContent, "utf8");
    let modelRounds = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-active-file-stale",
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      resolveModelStartFacts: async () => ({
        profileId: "profile-active-file",
        provider: "demo",
        modelName: "active-file-model",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: { status: "hidden", reason: "test model" }
      }),
      modelDriver: {
        async *streamRound() {
          modelRounds += 1;
          yield runtimeToolCall("finish-active-file-stale", "finish", { summary: "Unexpected." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-active-file-stale-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-active-file-stale-run",
      userRequest: "Use the active project file.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-active-file",
      contextRefs: [],
      activeResourceRef: {
        kind: "project_file",
        refId: "file:notes/current.md",
        relativePath: "notes/current.md",
        label: "Current",
        expectedChecksum: sha256(savedContent)
      }
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    await writeFile(join(projectRoot, "notes", "current.md"), "Externally changed body.\n", "utf8");

    await expect(
      runtime.agentRunSession.startAgentRun({
        projectId: "project-01",
        conversationId: conversation.value.conversationId,
        commandId: "start-active-file-stale-run",
        expectedRunRevision: 0,
        runDraftId: prepared.value.runDraft.runDraftId,
        runDraftRevision: prepared.value.runDraft.revision,
        runDraftChecksum: prepared.value.runDraft.checksum
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_STALE" } });
    expect(modelRounds).toBe(0);
  });

  test("injects and indexes persisted context from earlier runs in the same conversation", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-context-"));
    roots.push(projectRoot);
    const runIds = ["run-context-first", "run-context-second"];
    const roundMessages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
    let round = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => runIds.shift() ?? "run-context-extra",
      modelDriver: {
        async *streamRound(input: {
          readonly messages: readonly { readonly role: string; readonly content: string }[];
        }) {
          round += 1;
          roundMessages.push(input.messages);
          yield { type: "assistant_text_delta", delta: `Answer ${String(round)}` };
          yield runtimeToolCall(`finish-context-${String(round)}`, "finish", {
            summary: `Context summary ${String(round)}`
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const created = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-context-conversation"
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;

    const firstStarted = await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: created.value.conversationId,
      commandId: "start-context-first",
      userRequest: "Remember the lantern clue."
    });
    expect(firstStarted).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-context-first")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    const secondStarted = await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: created.value.conversationId,
      commandId: "start-context-second",
      userRequest: "Continue from the clue."
    });
    expect(secondStarted).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(roundMessages).toHaveLength(2), { timeout: 5_000 });

    expect(roundMessages[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Untrusted conversation context")
        })
      ])
    );
    expect(roundMessages[1]?.map((message) => message.content).join("\n")).toContain(
      "Remember the lantern clue."
    );

    const searched = await runtime.agentConversationSession.searchConversations({
      projectId: "project-01",
      query: "lantern"
    });
    expect(searched).toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ conversationId: created.value.conversationId })] }
    });
  });

  test("stages a chapter proposal using the exact content and checksum returned by read_chapter", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-read-propose-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D2";
    const body = "Original chapter body.\n";
    await writeFile(
      join(projectRoot, "chapters", `${chapterId}.md`),
      `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`,
      "utf8"
    );
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      createRunId: () => "run-desktop-read-propose",
      modelDriver: {
        async *streamRound(input: {
          messages: readonly { readonly role: string; readonly content: string }[];
        }) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("read-before-proposal", "read_resource", {
              ref: `chapter:${chapterId}`
            });
          } else if (round === 2) {
            const toolMessage = input.messages.findLast((message) => message.role === "tool");
            if (toolMessage === undefined) throw new Error("Expected read_chapter tool output.");
            const envelope = JSON.parse(toolMessage.content) as {
              data: { content: string; checksum: string };
            };
            expect(envelope.data.content).toBe(body);
            expect(envelope.data.checksum).toBe(sha256(body));
            yield runtimeToolCall("proposal-from-read", "edit_text", {
              ref: `chapter:${chapterId}`,
              baseHash: envelope.data.checksum,
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-after-proposal", "finish", { summary: "Unexpected." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-read-propose")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
    });
  });

  test("rejects memory IDs as Story Bible edit targets without touching the timeline", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-memory-edit-"));
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });
    const timestamp = "2026-07-29T00:00:00.000Z";
    expect(
      await repository.saveMemory({
        schemaVersion: "1.0",
        id: "mem_hidden_oath",
        type: "memory.long-term",
        title: "Hidden oath",
        status: "active",
        origin: "user",
        confidence: "confirmed",
        content: "The hero made a hidden oath.",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toMatchObject({ ok: true });
    expect(
      await repository.saveStoryAsset({
        schemaVersion: "1.0",
        id: "timeline_main",
        type: "timeline.events",
        title: "Timeline",
        status: "active",
        summary: "Canonical timeline.",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toMatchObject({ ok: true });
    const timelinePath = join(projectRoot, "timeline", "events.json");
    const timeline = await readFile(timelinePath, "utf8");
    const titleStart = timeline.indexOf("Timeline");
    expect(titleStart).toBeGreaterThanOrEqual(0);
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-memory-story-bible-edit",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("edit-memory-as-story-bible", "edit_text", {
              ref: "story_bible:mem_hidden_oath",
              baseHash: sha256(timeline),
              range: { unit: "character", start: titleStart, end: titleStart + "Timeline".length },
              replacement: "Hijacked timeline"
            });
          } else {
            yield runtimeToolCall("finish-memory-rejection", "finish", { summary: "Rejected." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-memory-story-bible-edit")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "edit-memory-as-story-bible",
                code: "AGENT_STORY_BIBLE_ASSET_NOT_FOUND"
              })
            })
          ])
        }
      });
    });
    const rejected = await session.readAgentRun("run-desktop-memory-story-bible-edit");
    expect(rejected).not.toMatchObject({ value: { changeSet: expect.anything() } });
    expect(await readFile(timelinePath, "utf8")).toBe(timeline);
  });

  test("rejects unknown Story Bible asset types without defaulting to the timeline", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-unknown-edit-"));
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });
    const timestamp = "2026-07-29T00:00:00.000Z";
    expect(
      await repository.saveStoryAsset({
        schemaVersion: "1.0",
        id: "timeline_main",
        type: "timeline.events",
        title: "Timeline",
        status: "active",
        summary: "Canonical timeline.",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    ).toMatchObject({ ok: true });
    const timelinePath = join(projectRoot, "timeline", "events.json");
    const timeline = await readFile(timelinePath, "utf8");
    const titleStart = timeline.indexOf("Timeline");
    expect(titleStart).toBeGreaterThanOrEqual(0);
    const readStoryBible = vi
      .spyOn(StoryBibleFileRepository.prototype, "readStoryBible")
      .mockResolvedValue(
        ok({
          characters: [
            {
              schemaVersion: "1.0",
              id: "asset_unknown",
              type: "story.unknown",
              title: "Unknown asset",
              status: "active",
              summary: "Invalid type injected at the runtime boundary.",
              createdAt: timestamp,
              updatedAt: timestamp
            } as never
          ],
          worldAssets: [],
          foreshadows: [],
          memories: []
        })
      );
    let round = 0;
    try {
      const session = createDesktopRuntime({
        workspaceKind: "creativeProject",
        projectId: "project-01",
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        activeChapterId: "chapter-unused",
        createRunId: () => "run-desktop-unknown-story-bible-edit",
        modelDriver: {
          async *streamRound() {
            round += 1;
            if (round === 1) {
              yield runtimeToolCall("edit-unknown-story-bible", "edit_text", {
                ref: "story_bible:asset_unknown",
                baseHash: sha256(timeline),
                range: {
                  unit: "character",
                  start: titleStart,
                  end: titleStart + "Timeline".length
                },
                replacement: "Hijacked timeline"
              });
            } else {
              yield runtimeToolCall("finish-unknown-rejection", "finish", {
                summary: "Rejected."
              });
            }
            yield { type: "round_completed", finishReason: "tool_calls" };
          }
        }
      });

      await session.startAgentRun(executionCommand());

      await vi.waitFor(async () => {
        expect(await session.readAgentRun("run-desktop-unknown-story-bible-edit")).toMatchObject({
          ok: true,
          value: {
            snapshot: { status: "completed" },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_failed",
                detail: expect.objectContaining({
                  toolCallId: "edit-unknown-story-bible",
                  code: "AGENT_STORY_BIBLE_ASSET_TYPE_INVALID"
                })
              })
            ])
          }
        });
      });
      const rejected = await session.readAgentRun("run-desktop-unknown-story-bible-edit");
      expect(rejected).not.toMatchObject({ value: { changeSet: expect.anything() } });
      expect(await readFile(timelinePath, "utf8")).toBe(timeline);
    } finally {
      readStoryBible.mockRestore();
    }
  });

  test("uses project-root-bound real reads and finishes a read-only planning run", async () => {
    const createRuntime = (runtimeExports as unknown as Record<string, unknown>)[
      "createDesktopAgentRunSession"
    ];
    expect(typeof createRuntime).toBe("function");
    if (typeof createRuntime !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-run-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "brief.md"), "Planning context.\n", "utf8");
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D3";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\nChapter body.\n`;
    await writeFile(chapterPath, original, "utf8");

    const session = (
      createRuntime as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      createRunId: () => "run-desktop-plan",
      modelDriver: {
        async *streamRound(input: { readonly messages: readonly { readonly role: string }[] }) {
          const toolResultCount = input.messages.filter(
            (message) => message.role === "tool"
          ).length;
          if (toolResultCount === 0) {
            yield { type: "assistant_text_delta" as const, delta: "先读取项目结构。" };
            yield runtimeToolCall("plan-list-entries", "list_project_entries", {
              path: "notes"
            });
          } else if (toolResultCount === 1) {
            yield runtimeToolCall("plan-read-chapter", "read_resource", {
              ref: `chapter:${chapterId}`
            });
          } else {
            yield runtimeToolCall("plan-finish", "finish_plan", {
              planId: "plan-desktop-read-only",
              goal: "检查章节并制定修订计划。",
              successCriteria: ["完成只读上下文核对"],
              nonGoals: ["不修改任何项目文件"],
              facts: ["已读取项目结构和当前章节"],
              assumptions: [],
              openQuestions: [],
              targetRefs: [{ refId: `chapter:${chapterId}`, intent: "核对当前章节" }],
              steps: [
                {
                  stepId: "review-current-chapter",
                  title: "复核当前章节",
                  verification: "重新读取并核对目标与上下文"
                }
              ],
              risks: ["执行前上下文可能变化"],
              verification: ["执行前刷新 Context Snapshot"],
              sourceRefs: [`chapter:${chapterId}`]
            });
          }
          yield {
            type: "round_completed" as const,
            finishReason: "tool_calls" as const
          };
        }
      }
    });
    await session.startAgentRun({
      projectId: "project-01",
      conversationId: "conv-desktop-plan",
      commandId: "start-desktop-plan",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "检查章节并制定修订计划。",
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
    });
    await vi.waitFor(
      async () => {
        expect(await session.readAgentRun("run-desktop-plan")).toMatchObject({
          ok: true,
          value: {
            snapshot: { status: "plan_ready" },
            events: expect.arrayContaining([
              expect.objectContaining({ type: "assistant_text_delta" }),
              expect.objectContaining({
                type: "tool_completed",
                detail: expect.objectContaining({ toolName: "list_project_entries" })
              }),
              expect.objectContaining({
                type: "tool_completed",
                detail: expect.objectContaining({ toolName: "read_resource" })
              }),
              expect.objectContaining({ type: "plan_ready" })
            ])
          }
        });
      },
      { timeout: 10_000 }
    );
    expect(await readFile(chapterPath, "utf8")).toBe(original);
    await vi.waitFor(
      async () => {
        expect(
          JSON.parse(
            await readFile(
              join(projectRoot, "history", "agent-runs", "run-desktop-plan", "run.json"),
              "utf8"
            )
          )
        ).toMatchObject({ runId: "run-desktop-plan", status: "plan_ready" });
      },
      { timeout: 10_000 }
    );
  });

  test("stages a chapter-body proposal without writing, then applies it through one Version Group", async () => {
    const createRuntime = (runtimeExports as unknown as Record<string, unknown>)[
      "createDesktopAgentRunSession"
    ];
    expect(typeof createRuntime).toBe("function");
    if (typeof createRuntime !== "function") return;

    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-write-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const body = "Original chapter body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-write-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    const operations: string[] = [];
    let recoveryGroup: Record<string, unknown> | undefined;
    let round = 0;
    const session = (
      createRuntime as (options: Record<string, unknown>) => {
        startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
        readAgentRun(runId: string): Promise<Record<string, unknown>>;
      }
    )({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-write",
      lifecycleOperations: createTestingReplaceLifecyclePort(projectRoot),
      pauseAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`pause:${relativePaths.join(",")}`);
        expect(await readFile(chapterPath, "utf8")).toBe(original);
      },
      resumeAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`resume:${relativePaths.join(",")}`);
      },
      syncSavedEditor: async (relativePath: string) => {
        operations.push(`sync:${relativePath}`);
        expect(await readFile(chapterPath, "utf8")).toContain("Revised chapter body.");
        throw new Error("dirty editor became visible during synchronization");
      },
      surfaceTransactionRecoveryReview: async (group: Record<string, unknown>) => {
        operations.push("recovery-review");
        recoveryGroup = group;
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-01", "edit_text", {
              ref: `chapter:${chapterId}`,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-01", "finish", { summary: "Applied and verified." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-write");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = (
        read as { value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> } }
      ).value;
      awaitingRevision = value.snapshot.runRevision;
      changeSet = value.changeSet;
    });
    expect(await readFile(chapterPath, "utf8")).toBe(original);
    if (changeSet === undefined) throw new Error("Expected a staged Change Set.");

    await session.decideChangeSet({
      runId: "run-desktop-write",
      projectId: "project-01",
      commandId: "apply-desktop-write",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-write")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const applied = await readFile(chapterPath, "utf8");
    expect(applied).toContain(`id: ${chapterId}`);
    expect(applied).toContain("Revised chapter body.");
    expect(await readdir(join(projectRoot, "history", "agent-transactions"))).toHaveLength(1);
    expect(operations).toEqual([
      `pause:chapters/${chapterId}.md`,
      `sync:chapters/${chapterId}.md`,
      `resume:chapters/${chapterId}.md`,
      "recovery-review"
    ]);
    expect(recoveryGroup).toMatchObject({
      transactionStatus: "applied",
      synchronization: {
        status: "recovery_required",
        failedHooks: ["syncSavedEditor"]
      }
    });
  });

  test("preserves dirty buffers and resumes autosave when the target changes before apply", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-conflict-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D1";
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    const body = "Original chapter body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-conflict-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    const operations: string[] = [];
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-conflict",
      pauseAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`pause:${relativePaths.join(",")}`);
      },
      preserveDirtyBuffers: async (relativePaths: readonly string[]) => {
        operations.push(`preserve:${relativePaths.join(",")}`);
      },
      resumeAutosave: async (relativePaths: readonly string[]) => {
        operations.push(`resume:${relativePaths.join(",")}`);
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-conflict", "edit_text", {
              ref: `chapter:${chapterId}`,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-conflict");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = (
        read as {
          value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
        }
      ).value;
      awaitingRevision = value.snapshot.runRevision;
      changeSet = value.changeSet;
    });
    if (changeSet === undefined) throw new Error("Expected a staged Change Set.");
    await writeFile(
      chapterPath,
      original.replace(body, "Externally changed chapter body.\n"),
      "utf8"
    );

    const result = await session.decideChangeSet({
      runId: "run-desktop-conflict",
      projectId: "project-01",
      commandId: "apply-desktop-conflict",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });

    expect(result).toMatchObject({ ok: false });
    expect(operations).toEqual([
      `pause:chapters/${chapterId}.md`,
      `preserve:chapters/${chapterId}.md`,
      `resume:chapters/${chapterId}.md`
    ]);
    expect(await readFile(chapterPath, "utf8")).toContain("Externally changed chapter body.");
  });

  test("uses the trusted creative fallback for apply and dirty-editor undo", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-dirty-undo-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D6";
    const relativePath = `chapters/${chapterId}.md`;
    const chapterPath = join(projectRoot, relativePath);
    const body = "Original chapter body.\n";
    const dirtyBody = "Unsaved user body.\n";
    const original = `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Opening\norder: 1\nstatus: draft\ncreatedAt: "2026-07-13T00:00:00.000Z"\nupdatedAt: "2026-07-13T00:00:00.000Z"\n---\n\n${body}`;
    await writeFile(chapterPath, original, "utf8");
    const lockOwnerId = "desktop-agent-dirty-undo-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    let editorDirty = false;
    const editorReads: boolean[] = [];
    const syncOptions: (string | undefined)[] = [];
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: chapterId,
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-dirty-undo",
      readEditorState: async (path: string) => {
        editorReads.push(editorDirty);
        return path === relativePath
          ? { dirty: editorDirty, content: editorDirty ? dirtyBody : body }
          : undefined;
      },
      syncSavedEditor: async (
        path: string,
        options?: { readonly expectedDirtyChecksum?: string }
      ) => {
        if (path === relativePath) {
          syncOptions.push(options?.expectedDirtyChecksum);
          editorDirty = false;
        }
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-dirty-undo", "edit_text", {
              ref: `chapter:${chapterId}`,
              baseHash: sha256(body),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-dirty-undo", "finish", { summary: "Applied." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand());
    let changeSet: Record<string, unknown> | undefined;
    let revision = 0;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-dirty-undo");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = read as {
        value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
      };
      revision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
    });
    if (changeSet === undefined) throw new Error("Expected Change Set.");
    await session.decideChangeSet({
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "apply-desktop-dirty-undo",
      expectedRunRevision: revision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-dirty-undo")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const agentFile = await readFile(chapterPath, "utf8");
    expect(agentFile).toContain("Revised chapter body.");
    editorDirty = true;
    const completed = (await session.readAgentRun("run-desktop-dirty-undo")) as {
      value: { snapshot: { runRevision: number } };
    };

    const undoRequested = await session.undoRun({
      action: "request",
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "undo-desktop-dirty-undo",
      expectedRunRevision: completed.value.snapshot.runRevision
    });
    expect(undoRequested).toMatchObject({ ok: true });
    expect(editorReads).toContain(true);

    const reviewed = await session.readAgentRun("run-desktop-dirty-undo");
    expect(reviewed).toMatchObject({
      ok: true,
      value: {
        rollbackReview: {
          files: [
            expect.objectContaining({
              relativePath,
              reviewedCurrentHistoryContent: dirtyBody,
              status: "conflict"
            })
          ]
        }
      }
    });
    expect(await readFile(chapterPath, "utf8")).toBe(agentFile);
    const reviewValue = reviewed as {
      value: {
        snapshot: { runRevision: number };
        rollbackReview: { reviewId: string };
      };
    };

    await session.undoRun({
      action: "resolve",
      runId: "run-desktop-dirty-undo",
      projectId: "project-01",
      commandId: "restore-desktop-dirty-undo",
      expectedRunRevision: reviewValue.value.snapshot.runRevision,
      reviewId: reviewValue.value.rollbackReview.reviewId,
      decisions: [{ relativePath, decision: "restore_baseline" }]
    });

    expect(await readFile(chapterPath, "utf8")).toBe(original);
    expect(syncOptions).toContain(sha256(dirtyBody));
    expect(editorDirty).toBe(false);
  });

  test("applies and undoes an ordinary text proposal through the trusted creative fallback", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-text-"));
    roots.push(projectRoot);
    const notesPath = join(projectRoot, "notes.txt");
    const notes = "Original notes.\n";
    await writeFile(notesPath, notes, "utf8");
    const lockOwnerId = "desktop-agent-trusted-text-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-text-validation",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-text", "edit_text", {
              ref: "file:notes.txt",
              baseHash: sha256(notes),
              range: { unit: "character", start: 0, end: 8 },
              replacement: "Revised"
            });
          } else {
            yield runtimeToolCall("finish-text", "finish", { summary: "Text updated." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand("general_file"));

    let changeSet: Record<string, unknown> | undefined;
    let awaitingRevision = 0;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-text-validation");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            files: [
              {
                validation: {
                  schema: { status: "not_applicable" },
                  asset: { status: "not_applicable" }
                }
              }
            ]
          }
        }
      });
      const value = read as {
        value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
      };
      awaitingRevision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
    });
    expect(await readFile(notesPath, "utf8")).toBe(notes);
    if (changeSet === undefined) throw new Error("Expected a staged text Change Set.");

    await session.decideChangeSet({
      runId: "run-desktop-text-validation",
      projectId: "project-01",
      commandId: "apply-desktop-trusted-text",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-text-validation")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(await readFile(notesPath, "utf8")).toBe("Revised notes.\n");

    const completed = (await session.readAgentRun("run-desktop-text-validation")) as {
      value: { snapshot: { runRevision: number } };
    };
    const undone = await session.undoRun({
      projectId: "project-01",
      runId: "run-desktop-text-validation",
      commandId: "undo-desktop-trusted-text",
      expectedRunRevision: completed.value.snapshot.runRevision
    });
    expect(undone).toMatchObject({ ok: true, value: { status: "completed" } });
    expect(await readFile(notesPath, "utf8")).toBe(notes);
  });

  test("applies allowed v2 file lifecycle proposals and rejects managed creative resources", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-v2-lifecycle-"));
    roots.push(projectRoot);
    const sourcePath = join(projectRoot, "draft.md");
    const obsoletePath = join(projectRoot, "obsolete.txt");
    const movedPath = join(projectRoot, "moved.md");
    const createdPath = join(projectRoot, "created.txt");
    const storyBiblePath = join(projectRoot, "characters", "hero.json");
    const source = "Move this draft.\n";
    const obsolete = "Remove this file.\n";
    const created = "Created by the agent.\n";
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await mkdir(join(projectRoot, "characters"), { recursive: true });
    await writeFile(sourcePath, source, "utf8");
    await writeFile(obsoletePath, obsolete, "utf8");
    const lockOwnerId = "desktop-agent-v2-lifecycle-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-v2-lifecycle",
      featureFlags: createAgentFeatureFlags({
        phaseB_fileLifecycleEnabled: true,
        revision: "desktop-v2-lifecycle-test"
      }),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("create-v2-chapter", "create_resource", {
              kind: "chapter",
              title: "第一章",
              content: "雨夜里，故事开始了。"
            });
            yield runtimeToolCall("create-v2-story-bible", "create_resource", {
              kind: "story_bible",
              assetType: "character",
              content: JSON.stringify({ id: "hero", type: "character", name: "Lin" })
            });
            yield runtimeToolCall("create-v2-file", "create_resource", {
              kind: "file",
              path: "created.txt",
              content: created
            });
            yield runtimeToolCall("create-v2-directory", "manage_path", {
              operation: "create_directory",
              path: "assets"
            });
            yield runtimeToolCall("move-v2-file", "manage_path", {
              operation: "move_file",
              sourceRef: "file:draft.md",
              targetPath: "moved.md",
              baseHash: sha256(source)
            });
            yield runtimeToolCall("delete-v2-file", "manage_path", {
              operation: "delete_file",
              ref: "file:obsolete.txt",
              baseHash: sha256(obsolete)
            });
          } else {
            yield runtimeToolCall("finish-v2-lifecycle", "finish", { summary: "Applied." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand("general_file"));
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-v2-lifecycle");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "create-v2-chapter",
                code: "AGENT_CONTEXT_PROFILE_TOOL_REJECTED"
              })
            }),
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "create-v2-story-bible",
                code: "AGENT_CONTEXT_PROFILE_TOOL_REJECTED"
              })
            })
          ]),
          changeSet: {
            operations: expect.arrayContaining([
              expect.objectContaining({ kind: "create_file", relativePath: "created.txt" }),
              expect.objectContaining({ kind: "create_directory", relativePath: "assets" }),
              expect.objectContaining({
                kind: "move_file",
                sourcePath: "draft.md",
                targetPath: "moved.md"
              }),
              expect.objectContaining({ kind: "delete_file", relativePath: "obsolete.txt" })
            ])
          }
        }
      });
      const value = read as {
        value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
      };
      awaitingRevision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
    });
    expect(await readFile(sourcePath, "utf8")).toBe(source);
    expect(await readFile(obsoletePath, "utf8")).toBe(obsolete);
    expect(await readdir(projectRoot)).not.toContain("created.txt");
    expect(await readdir(projectRoot)).not.toContain("assets");
    expect(await readdir(join(projectRoot, "chapters"))).toEqual([]);
    await expect(readFile(storyBiblePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    if (changeSet === undefined) throw new Error("Expected a staged lifecycle Change Set.");

    const applied = await session.decideChangeSet({
      runId: "run-desktop-v2-lifecycle",
      projectId: "project-01",
      commandId: "apply-desktop-v2-lifecycle",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    expect(applied).toMatchObject({ ok: true, value: { status: "executing_model" } });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-v2-lifecycle")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(await readFile(createdPath, "utf8")).toBe(created);
    expect(await readdir(join(projectRoot, "chapters"))).toEqual([]);
    await expect(readFile(storyBiblePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(movedPath, "utf8")).toBe(source);
    await expect(readFile(sourcePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(obsoletePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(projectRoot)).toContain("assets");

    const completed = (await session.readAgentRun("run-desktop-v2-lifecycle")) as {
      value: { snapshot: { runRevision: number } };
    };
    expect(
      await session.undoRun({
        projectId: "project-01",
        runId: "run-desktop-v2-lifecycle",
        commandId: "undo-desktop-v2-lifecycle",
        expectedRunRevision: completed.value.snapshot.runRevision
      })
    ).toMatchObject({ ok: true, value: { status: "completed" } });
    expect(await readFile(sourcePath, "utf8")).toBe(source);
    expect(await readFile(obsoletePath, "utf8")).toBe(obsolete);
    await expect(readFile(createdPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(join(projectRoot, "chapters"))).toEqual([]);
    await expect(readFile(storyBiblePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(movedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(projectRoot)).not.toContain("assets");
  });

  test("rejects managed settings paths before creating a general-file Change Set", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-schema-"));
    roots.push(projectRoot);
    const settingsPath = join(projectRoot, "settings.json");
    const settings = "{}\n";
    const invalidCandidate = '{"schemaVersion":"1.0"}\n';
    await writeFile(settingsPath, settings, "utf8");
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-settings-schema",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("proposal-settings", "edit_text", {
              ref: "file:settings.json",
              baseHash: sha256(settings),
              range: { unit: "character", start: 0, end: settings.length },
              replacement: invalidCandidate
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-settings-schema")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "failed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "proposal-settings",
                code: "CREATIVE_PROJECT_FILE_PATH_REJECTED"
              })
            })
          ])
        }
      });
    });
    const rejected = await session.readAgentRun("run-desktop-settings-schema");
    expect(rejected).not.toMatchObject({ value: { changeSet: expect.anything() } });
    expect(await readFile(settingsPath, "utf8")).toBe(settings);
  });

  test("rejects managed creative reads and directory lists before repository execution", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-managed-reads-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await writeFile(join(projectRoot, "settings.json"), "managed secret\n", "utf8");
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-managed-reads",
      modelDriver: {
        async *streamRound(input) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("read-managed-settings", "read_resource", {
              ref: "file:settings.json"
            });
            yield runtimeToolCall("list-managed-chapters", "list_project_entries", {
              path: "chapters"
            });
          } else {
            const toolPayload = input.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content)
              .join("\n");
            expect(toolPayload).toContain("CREATIVE_PROJECT_FILE_PATH_REJECTED");
            expect(toolPayload).not.toContain("managed secret");
            yield runtimeToolCall("finish-managed-reads", "finish", { summary: "Rejected." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-managed-reads")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "read-managed-settings",
                code: "CREATIVE_PROJECT_FILE_PATH_REJECTED"
              })
            }),
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "list-managed-chapters",
                code: "CREATIVE_PROJECT_FILE_PATH_REJECTED"
              })
            })
          ])
        }
      });
    });
  });

  test("rejects managed creative project reads in writing mode", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-writing-managed-read-"));
    roots.push(projectRoot);
    await writeFile(join(projectRoot, "settings.json"), "managed writing secret\n", "utf8");
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-writing-managed-read",
      modelDriver: {
        async *streamRound(input) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("read-writing-managed-settings", "read_resource", {
              ref: "file:settings.json"
            });
          } else {
            const toolPayload = input.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content)
              .join("\n");
            expect(toolPayload).toContain("CREATIVE_PROJECT_FILE_PATH_REJECTED");
            expect(toolPayload).not.toContain("managed writing secret");
            yield runtimeToolCall("finish-writing-managed-read", "finish", {
              summary: "Rejected."
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("writing"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-writing-managed-read")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed", contextMode: "writing" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "read-writing-managed-settings",
                code: "CREATIVE_PROJECT_FILE_PATH_REJECTED"
              })
            })
          ])
        }
      });
    });
  });

  test("filters managed creative paths from Agent search results", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-managed-search-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await writeFile(join(projectRoot, "settings.json"), "visibilityneedle managed\n", "utf8");
    await writeFile(join(projectRoot, "notes", "visible.md"), "visibilityneedle visible\n", "utf8");
    let round = 0;
    let observedToolPayload = "";
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-managed-search",
      featureFlags: createAgentFeatureFlags({
        phaseA_searchEnabled: true,
        revision: "desktop-managed-search-test"
      }),
      modelDriver: {
        async *streamRound(input) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("search-managed-paths", "search_project", {
              mode: "text",
              query: "visibilityneedle",
              maxResults: 10
            });
          } else {
            observedToolPayload = input.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content)
              .join("\n");
            yield runtimeToolCall("finish-managed-search", "finish", { summary: "Filtered." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-managed-search")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed", contextMode: "general_file" } }
      });
    });
    expect(observedToolPayload).toContain("notes/visible.md");
    expect(observedToolPayload).not.toContain("settings.json");
  });

  test("composes the repository-backed search executor into the production runtime", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-search-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "needle.ts"), "export const needle = true;\n", "utf8");
    const observedToolLists: string[][] = [];
    let round = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-desktop-search",
      featureFlags: createAgentFeatureFlags({
        phaseA_searchEnabled: true,
        revision: "desktop-search-test"
      }),
      modelDriver: {
        async *streamRound(input) {
          observedToolLists.push(input.tools.map((tool) => tool.name));
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("search-needle", "search_project", {
              mode: "text",
              query: "needle",
              maxResults: 10
            });
          } else {
            yield runtimeToolCall("finish-search", "finish", { summary: "Search complete." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-desktop-search-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;

    await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: conversation.value.conversationId,
      commandId: "start-desktop-search"
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-desktop-search")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(observedToolLists[0]).toContain("search_project");
  });

  test("forwards Main's search-query auto-approval policy into the run session", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-web-search-"));
    roots.push(projectRoot);
    let round = 0;
    let searches = 0;
    const session = createDesktopRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-desktop-web-search",
      dataEgressPolicy: "auto_approve_search_queries",
      featureFlags: createAgentFeatureFlags({
        phaseD_networkReadEnabled: true,
        revision: "desktop-web-search-test"
      }),
      networkToolExecutor: {
        async webSearch() {
          searches += 1;
          return {
            ok: true,
            value: {
              kind: "untrusted_remote_data",
              url: "https://search.example.test/?q=context",
              fetchedAt: "2026-07-26T00:00:00.000Z",
              contentDigest: "a".repeat(64),
              contentSummary: "search result",
              truncated: false,
              sourceLabel: "search"
            }
          };
        },
        async fetchUrl() {
          throw new Error("fetch_url should not run");
        }
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("desktop-web-search", "web_search", { query: "context" });
          } else {
            yield runtimeToolCall("desktop-web-search-finish", "finish", { summary: "Done." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("general_file"));
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-web-search")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(searches).toBe(1);
  });

  test("keeps search tools hidden in the production runtime without the Main feature gate", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-search-off-"));
    roots.push(projectRoot);
    const observedToolLists: string[][] = [];
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "engineeringWorkspace",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-desktop-search-off",
      modelDriver: {
        async *streamRound(input) {
          observedToolLists.push(input.tools.map((tool) => tool.name));
          yield runtimeToolCall("finish-search-off", "finish", { summary: "No search." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-desktop-search-off-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;

    await runtime.agentRunSession.startAgentRun({
      ...executionCommand("general_file"),
      conversationId: conversation.value.conversationId,
      commandId: "start-desktop-search-off"
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-desktop-search-off")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(observedToolLists[0]).not.toContain("search_project");
  });
});

function createDesktopRuntime(options: Record<string, unknown>) {
  return (
    runtimeExports.createDesktopAgentRunSession as (options: Record<string, unknown>) => {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    }
  )(options);
}

function desktopUsageRecord(
  roundId: string,
  localDate: string,
  finalSequence: number
): Record<string, unknown> {
  return {
    schemaVersion: "1.2",
    scope: {
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: "project-01"
    },
    usageId: `run_desktop:${roundId}:${String(finalSequence)}`,
    runId: "run_desktop",
    conversationId: "conversation_desktop",
    roundId,
    finalSequence,
    provider: "demo",
    model: "desktop-model",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    usageStatus: "missing",
    cacheOutcome: "unknown",
    cacheUsageStatus: "unavailable",
    cacheInputTokenSemantics: "unavailable",
    cacheMode: null,
    cachePrefixChecksum: null,
    precision: "unknown",
    pricingVersion: null,
    unitPrices: null,
    cost: { amount: 0, currency: "", status: "unknown" },
    contextWindow: 128000,
    safeInputBudget: 100000,
    terminationReason: "stop",
    timestamp: `${localDate}T12:00:00.000Z`,
    localDate,
    timezone: "UTC",
    utcOffsetMinutes: 0
  };
}

function runtimeToolCall(toolCallId: string, name: string, value: Record<string, unknown>) {
  return {
    type: "tool_call_delta" as const,
    toolCallId,
    name,
    argumentsDelta: JSON.stringify(value)
  };
}

function executionCommand(
  contextMode: "writing" | "general_file" = "writing"
): Record<string, unknown> {
  return {
    projectId: "project-01",
    conversationId: "conv-desktop",
    commandId: "start-desktop-write",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode,
    writePolicy: "write_before_confirmation",
    userRequest: "Revise the active chapter.",
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

function strictPlanningCommand(conversationId: string, commandId: string) {
  return {
    ...executionCommand(),
    conversationId,
    commandId,
    operationMode: "planning" as const,
    userRequest: "Review the active chapter and prepare a plan."
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
    errorId: "err_desktop_agent_lifecycle_test",
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Fix the lifecycle test setup.",
    traceId: "desktop-agent-run-runtime-test"
  };
}
