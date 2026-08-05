import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checksumChangeSetSelection,
  checksumChangeSetText,
  createAgentRunCoordinator,
  createChangeSetRevision,
  decideChangeSetApproval,
  type AgentToolCapabilitySnapshot,
  type ChangeSet,
  type ChangeSetApproval
} from "@novel-studio/agent-engine";
import {
  AgentProjectReadRepository,
  AgentRunFileRepository,
  AgentSendLedgerFileRepository,
  AgentUsageFileRepository,
  ChapterFileRepository,
  HistoryRepository,
  ProjectLockFileRepository,
  RecoveryRepository,
  StoryBibleFileRepository,
  createTrustedCreativeFileOperationsPort,
  type AgentTransactionJournal,
  type AgentOperationPathSnapshot,
  type AgentWriteLifecycleOperationPort,
  type StoryBibleV11Asset
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
  test("intersects operation release evidence, feature gate, backend, and transaction executor", () => {
    const requested: AgentToolCapabilitySnapshot = {
      workspaceKind: "creativeProject",
      searchEnabled: false,
      fileLifecycleEnabled: false,
      writingOperations: ["chapter_replace"],
      workspaceFileOperations: [],
      storyBibleStructuredToolsEnabled: false,
      controlledExecutionEnabled: false,
      gitReadEnabled: false,
      networkReadEnabled: false,
      pluginToolsEnabled: false,
      mcpToolsEnabled: false,
      featureFlagRevision: "desktop-operation-evidence"
    };
    const featureFlags = createAgentFeatureFlags({
      agentGuidanceV3: true,
      approvalBindingV2: true,
      writingDomainCrudV2: true,
      revision: "desktop-operation-feature"
    });
    const qualified = {
      requested,
      featureFlags,
      lifecycleOperations: createTestingReplaceLifecyclePort("unused-operation-root"),
      hasVersionGroupExecutor: true,
      hasTrustedApprovalV2: true
    };

    expect(runtimeExports.buildRuntimeCapabilitySnapshot(qualified).writingOperations).toEqual([
      "chapter_replace"
    ]);
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        ...qualified,
        requested: { ...requested, writingOperations: [] }
      }).writingOperations
    ).toEqual([]);
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        requested,
        featureFlags,
        hasVersionGroupExecutor: true,
        hasTrustedApprovalV2: true
      }).writingOperations
    ).toEqual([]);
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        ...qualified,
        hasVersionGroupExecutor: false
      }).writingOperations
    ).toEqual([]);
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        ...qualified,
        hasTrustedApprovalV2: false
      }).writingOperations
    ).toEqual([]);
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        ...qualified,
        featureFlags: createAgentFeatureFlags({
          agentGuidanceV3: false,
          revision: "desktop-operation-feature-disabled"
        })
      }).writingOperations
    ).toEqual([]);

    const broadLegacyFlags = createAgentFeatureFlags({
      agentGuidanceV3: true,
      approvalBindingV2: true,
      phaseB_fileLifecycleEnabled: true,
      revision: "desktop-legacy-lifecycle-only"
    });
    expect(
      runtimeExports.buildRuntimeCapabilitySnapshot({
        ...qualified,
        requested: {
          ...requested,
          fileLifecycleEnabled: true,
          writingOperations: [],
          workspaceFileOperations: []
        },
        featureFlags: broadLegacyFlags
      })
    ).toMatchObject({ writingOperations: [], workspaceFileOperations: [] });
  });

  test.each([
    {
      label: "creative trusted fallback",
      workspaceKind: "creativeProject" as const,
      withProjectLock: true,
      withNativeLifecycle: false,
      withExplicitLifecycleCapability: false,
      expected: "standard_trusted_creative"
    },
    {
      label: "creative runtime without a transaction executor",
      workspaceKind: "creativeProject" as const,
      withProjectLock: false,
      withNativeLifecycle: false,
      withExplicitLifecycleCapability: false,
      expected: "unavailable"
    },
    {
      label: "engineering runtime without native lifecycle",
      workspaceKind: "engineeringWorkspace" as const,
      withProjectLock: true,
      withNativeLifecycle: false,
      withExplicitLifecycleCapability: false,
      expected: "unavailable"
    },
    {
      label: "engineering runtime with an unqualified legacy lifecycle port",
      workspaceKind: "engineeringWorkspace" as const,
      withProjectLock: true,
      withNativeLifecycle: true,
      withExplicitLifecycleCapability: true,
      expected: "unavailable"
    },
    {
      label: "qualified lifecycle contract",
      workspaceKind: "creativeProject" as const,
      withProjectLock: true,
      withNativeLifecycle: true,
      withExplicitLifecycleCapability: false,
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
        : {}),
      ...(testCase.withExplicitLifecycleCapability
        ? {
            capabilitySnapshot: {
              workspaceKind: testCase.workspaceKind,
              searchEnabled: false,
              fileLifecycleEnabled: true,
              storyBibleStructuredToolsEnabled: false,
              controlledExecutionEnabled: false,
              gitReadEnabled: false,
              networkReadEnabled: false,
              pluginToolsEnabled: false,
              mcpToolsEnabled: false,
              featureFlagRevision: "unqualified-explicit-engineering-lifecycle"
            }
          }
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

  test("persists Catalog 2.0 usage from the frozen tool catalog schema", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-usage-v2-project-"));
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-usage-v2-data-"));
    roots.push(projectRoot, userDataRoot);
    const runId = "run-desktop-usage-v2";
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      userDataRoot,
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      projectLockOwnerId: "desktop-usage-v2",
      createRunId: () => runId,
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      featureFlags: createAgentFeatureFlags({
        agentGuidanceV3: true,
        revision: "desktop-usage-catalog-v2"
      }),
      resolveModelStartFacts: async () => ({
        profileId: "demo-agent",
        provider: "demo",
        modelName: "desktop-scripted-agent",
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
          const verificationRef = `run-event/${String(
            input.snapshot.lastSequence + 4
          )}/tool_completed/catalog-v2-usage-read`;
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
          yield runtimeToolCall("catalog-v2-usage-read", "list_project_entries", {});
          yield runtimeToolCall("catalog-v2-usage-finish", "finish", {
            outcome: "completed",
            report: {
              result: "The Catalog 2.0 usage check is complete.",
              appliedChanges: [],
              verification: [verificationRef],
              residualRisks: []
            },
            evidenceRefs: [verificationRef]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-desktop-usage-v2"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-desktop-usage-v2",
      userRequest: "Review the project context.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "demo-agent",
      contextRefs: []
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const previewed = await previewDraftStart(runtime, prepared.value, "start-desktop-usage-v2");
    expect(await runtime.agentRunSession.startAgentRun(previewed.command)).toMatchObject({
      ok: true
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    const completed = await runtime.agentRunSession.readAgentRun(runId);
    expect(completed).toMatchObject({
      ok: true,
      value: { snapshot: { usageId: expect.any(String) } }
    });
    if (!completed.ok || completed.value.snapshot.usageId === null) return;
    expect(await runtime.agentUsageSession?.getAgentUsage(completed.value.snapshot.usageId)).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        storageScope: "local_only",
        usageId: completed.value.snapshot.usageId,
        runId,
        guidanceVersion: "3.0",
        messageOrderVersion: "2.0",
        toolCatalogVersion: "2.0"
      }
    });

    const detailFiles = await readdir(join(userDataRoot, "agent-usage", "details"));
    expect(detailFiles).toHaveLength(1);
    const [detailFile] = detailFiles;
    if (detailFile === undefined) throw new Error("Expected one persisted Catalog 2.0 usage file");
    const record = JSON.parse(
      await readFile(join(userDataRoot, "agent-usage", "details", detailFile), "utf8")
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      runId,
      provider: "demo",
      model: "desktop-scripted-agent",
      contextWindow: 128000,
      safeInputBudget: expect.any(Number)
    });
  });

  test("strictly restores a Guidance 3.0 planning run and rejects tampered or mixed V20 history", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-v20-restart-"));
    roots.push(projectRoot);
    const runId = "run_desktop_v20_restart";
    const planId = "plan_desktop_v20_restart";
    const featureFlags = createAgentFeatureFlags({
      agentGuidanceV3: true,
      revision: "desktop-v20-restart"
    });
    const resolveModelStartFacts = async () => ({
      profileId: "demo-agent",
      provider: "demo",
      modelName: "desktop-scripted-agent",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 128000
      },
      requiredContextTokens: 8000,
      reasoningStrength: { status: "hidden" as const, reason: "test model" }
    });
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => runId,
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      featureFlags,
      resolveModelStartFacts,
      modelDriver: {
        async *streamRound() {
          yield runtimeToolCall("finish-v20-restart-plan", "finish_plan", {
            planId,
            goal: "Verify strict planning persistence across restart.",
            successCriteria: ["The strict plan can be restored without changing authority."],
            nonGoals: ["Do not mutate project files."],
            facts: [],
            assumptions: [],
            openQuestions: [],
            targetRefs: [],
            steps: [
              {
                stepId: "verify-v20-restart",
                title: "Restore the strict run",
                verification: "Read the persisted V20 snapshot, events, and Plan Artifact."
              }
            ],
            risks: [],
            verification: ["Restart the Application session and hydrate the run."],
            sourceRefs: []
          });
          yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-v20-restart-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-v20-restart",
      userRequest: "Prepare a restart-safe read-only plan.",
      operationMode: "planning",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      executionWritePolicyDraft: "user_preapproved_run",
      modelProfileId: "demo-agent",
      contextRefs: []
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const previewed = await previewDraftStart(runtime, prepared.value, "start-v20-restart");
    expect(await runtime.agentRunSession.startAgentRun(previewed.command)).toMatchObject({
      ok: true,
      value: { schemaVersion: "2.0", runId }
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: {
          snapshot: { schemaVersion: "2.0", status: "plan_ready" },
          planArtifact: {
            schemaVersion: "2.0",
            planId,
            executionWritePolicyDraft: "user_preapproved_run"
          }
        }
      });
    });

    const repository = new AgentRunFileRepository({ projectRoot });
    await vi.waitFor(async () => {
      const [snapshot, events, planArtifact] = await Promise.all([
        repository.readSnapshotV20(runId),
        repository.readEventsV20(runId),
        repository.readPlanArtifact(planId, 1)
      ]);
      const persisted = { snapshot, events, planArtifact };
      expect(persisted, JSON.stringify(persisted)).toMatchObject({
        snapshot: {
          ok: true,
          value: { schemaVersion: "2.0", status: "plan_ready" }
        },
        events: {
          ok: true,
          value: expect.arrayContaining([
            expect.objectContaining({ schemaVersion: "2.0", type: "run_started" }),
            expect.objectContaining({ type: "plan_ready" })
          ])
        },
        planArtifact: {
          ok: true,
          value: {
            schemaVersion: "2.0",
            executionWritePolicyDraft: "user_preapproved_run"
          }
        }
      });
    });

    let restoredProviderCalls = 0;
    const createRestoredRuntime = () =>
      runtimeExports.createDesktopAgentRuntime({
        workspaceKind: "creativeProject",
        projectId: "project-01",
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        createRunId: () => "unused_restored_run",
        verifyCreativeGeneralActiveResource: async () => ok(undefined),
        featureFlags,
        resolveModelStartFacts,
        modelDriver: {
          async *streamRound(input: { readonly runId: string }) {
            if (input.runId === runId) {
              restoredProviderCalls += 1;
              throw new Error("A restored paused or terminal run must not call the Provider.");
            }
            yield { type: "round_completed" as const, finishReason: "stop" as const };
          }
        }
      });
    await expect(
      createRestoredRuntime().agentRunSession.readAgentRun(runId)
    ).resolves.toMatchObject({
      ok: true,
      value: {
        snapshot: { schemaVersion: "2.0", status: "plan_ready" },
        planArtifact: { executionWritePolicyDraft: "user_preapproved_run" }
      }
    });
    expect(restoredProviderCalls).toBe(0);

    const runPath = join(projectRoot, "history", "agent-runs", runId, "run.json");
    const eventsPath = join(projectRoot, "history", "agent-runs", runId, "events.json");
    const originalSnapshot = await readFile(runPath, "utf8");
    const originalEvents = await readFile(eventsPath, "utf8");
    const strictSnapshot = await repository.readSnapshotV20(runId);
    const strictEvents = await repository.readEventsV20(runId);
    expect(strictSnapshot).toMatchObject({ ok: true });
    expect(strictEvents).toMatchObject({ ok: true });
    if (!strictSnapshot.ok || strictSnapshot.value === undefined || !strictEvents.ok) return;
    const boundaryCoordinator = createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:01.000Z"
    });
    expect(boundaryCoordinator.restoreRun(strictSnapshot.value, strictEvents.value)).toMatchObject({
      ok: true
    });
    const capabilityBoundary = boundaryCoordinator.recordRunEvent({
      runId,
      status: "capability_changed",
      type: "capability_changed",
      detail: {
        effectiveCapabilityRevision: strictSnapshot.value.capabilities.revision + 1,
        reason: "desktop_restart_boundary_test"
      }
    });
    expect(capabilityBoundary).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        status: "capability_changed",
        pending: { kind: "none" },
        pendingToolApproval: null
      }
    });
    if (!capabilityBoundary.ok || capabilityBoundary.value.schemaVersion !== "2.0") return;
    const capabilityEvent = boundaryCoordinator.readEvents(runId).at(-1);
    if (capabilityEvent?.schemaVersion !== "2.0") {
      throw new Error("Expected a strict capability boundary event.");
    }
    await expect(
      repository.commitRunStateV20({
        snapshot: capabilityBoundary.value,
        event: capabilityEvent
      })
    ).resolves.toMatchObject({ ok: true });
    const boundaryRuntime = createRestoredRuntime();
    const boundaryRead = await boundaryRuntime.agentRunSession.readAgentRun(runId);
    expect(boundaryRead).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          schemaVersion: "2.0",
          status: "capability_changed",
          pending: { kind: "none" },
          pendingToolApproval: null
        }
      }
    });
    if (!boundaryRead.ok) return;
    expect(boundaryRead.value).not.toHaveProperty("pendingUserInput");
    await expect(
      boundaryRuntime.agentRunSession.resumeAgentRun({
        projectId: "project-01",
        runId,
        commandId: "resume-v20-capability-boundary",
        expectedRunRevision: boundaryRead.value.snapshot.runRevision
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ALREADY_TERMINAL" }
    });
    expect(restoredProviderCalls).toBe(0);
    const replacementConversation =
      await boundaryRuntime.agentConversationSession.createConversation({
        projectId: "project-01",
        commandId: "create-after-v20-capability-boundary"
      });
    expect(replacementConversation).toMatchObject({ ok: true });
    if (!replacementConversation.ok) return;
    const replacementPrepared = await boundaryRuntime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: replacementConversation.value.conversationId,
      commandId: "prepare-after-v20-capability-boundary",
      userRequest: "Start a new read-only plan after the capability boundary.",
      operationMode: "planning",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      executionWritePolicyDraft: "write_before_confirmation",
      modelProfileId: "demo-agent",
      contextRefs: []
    });
    expect(replacementPrepared).toMatchObject({ ok: true });
    if (!replacementPrepared.ok) return;
    const replacementPreview = await previewDraftStart(
      boundaryRuntime,
      replacementPrepared.value,
      "start-after-v20-capability-boundary"
    );
    await expect(
      boundaryRuntime.agentRunSession.startAgentRun(replacementPreview.command)
    ).resolves.toMatchObject({
      ok: true,
      value: { schemaVersion: "2.0", runId: "unused_restored_run" }
    });

    // Restore the original strict pair before the independent tamper cases below.
    await writeFile(runPath, originalSnapshot, "utf8");
    await writeFile(eventsPath, originalEvents, "utf8");
    const parsedSnapshot = JSON.parse(originalSnapshot) as Record<string, unknown>;
    await writeFile(
      runPath,
      `${JSON.stringify({ ...parsedSnapshot, forgedAuthority: true })}\n`,
      "utf8"
    );
    await expect(
      createRestoredRuntime().agentRunSession.readAgentRun(runId)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_V20_INVALID" }
    });
    await writeFile(runPath, originalSnapshot, "utf8");

    const parsedEvents = JSON.parse(originalEvents) as Record<string, unknown>[];
    const firstEvent = parsedEvents[0];
    if (firstEvent === undefined) throw new Error("Expected a persisted V20 start event.");
    parsedEvents[0] = { ...firstEvent, schemaVersion: "1.3" };
    await writeFile(eventsPath, `${JSON.stringify(parsedEvents)}\n`, "utf8");
    await expect(
      createRestoredRuntime().agentRunSession.readAgentRun(runId)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: expect.stringMatching(/^AGENT_RUN_/u) }
    });
  });

  test("restores a legacy planning run only through the legacy reader", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-legacy-restart-"));
    roots.push(projectRoot);
    const runId = "run_desktop_legacy_restart";
    const planId = "plan_desktop_legacy_restart";
    const createRuntime = (onProviderCall: () => void) =>
      runtimeExports.createDesktopAgentRuntime({
        workspaceKind: "creativeProject",
        projectId: "project-01",
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        createRunId: () => runId,
        modelDriver: {
          async *streamRound() {
            onProviderCall();
            yield runtimeToolCall("finish-legacy-restart-plan", "finish_plan", {
              planId,
              goal: "Verify legacy planning persistence.",
              successCriteria: ["The legacy plan remains readable as legacy data."],
              nonGoals: [],
              facts: [],
              assumptions: [],
              openQuestions: [],
              targetRefs: [],
              steps: [
                {
                  stepId: "verify-legacy-restart",
                  title: "Restore the legacy run",
                  verification: "Use the exact legacy reader."
                }
              ],
              risks: [],
              verification: ["Read the exact legacy artifact after restart."],
              sourceRefs: []
            });
            yield { type: "round_completed" as const, finishReason: "tool_calls" as const };
          }
        }
      });
    let providerCalls = 0;
    const runtime = createRuntime(() => {
      providerCalls += 1;
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-legacy-restart-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    expect(
      await runtime.agentRunSession.startAgentRun(
        strictPlanningCommand(conversation.value.conversationId, "start-legacy-restart")
      )
    ).toMatchObject({ ok: true, value: { schemaVersion: "1.3", runId } });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { schemaVersion: "1.3", status: "plan_ready" } }
      });
    });
    expect(providerCalls).toBe(1);

    const repository = new AgentRunFileRepository({ projectRoot });
    await expect(repository.readSnapshotV20(runId)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_SNAPSHOT_V20_LEGACY_RECORD" }
    });
    await expect(repository.readSnapshot(runId)).resolves.toMatchObject({
      ok: true,
      value: { schemaVersion: "1.3", status: "plan_ready" }
    });

    let restoredProviderCalls = 0;
    const restored = createRuntime(() => {
      restoredProviderCalls += 1;
    });
    await expect(restored.agentRunSession.readAgentRun(runId)).resolves.toMatchObject({
      ok: true,
      value: {
        snapshot: { schemaVersion: "1.3", status: "plan_ready" },
        planArtifact: { schemaVersion: "1.0", planId }
      }
    });
    expect(restoredProviderCalls).toBe(0);
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

  test("requires a Packed Context preview and reuses its exact blocks through Provider and persistence", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-packed-context-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    const sourceContent = "AUTHOR_VISIBLE_PACKED_CONTEXT_BODY\n";
    await writeFile(join(projectRoot, "notes", "context.md"), sourceContent, "utf8");
    let providerMessages: readonly { readonly role: string; readonly content: string }[] = [];
    let modelRounds = 0;
    const runId = "run-packed-context-binding";
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => runId,
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      resolveModelStartFacts: async () => ({
        profileId: "profile-packed-context",
        provider: "demo",
        modelName: "packed-context-model",
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
          modelRounds += 1;
          providerMessages = input.messages;
          yield runtimeToolCall("finish-packed-context", "finish", { summary: "Finished." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-packed-context-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-packed-context-run",
      userRequest: "Use the selected project context.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-packed-context",
      contextRefs: [
        {
          kind: "project_file",
          refId: "file:notes/context.md",
          relativePath: "notes/context.md",
          label: "Context"
        }
      ]
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;

    expect(
      await runtime.agentRunSession.startAgentRun(
        draftOnlyStartCommand(
          runtime.workspaceId,
          prepared.value,
          "start-packed-context-without-preview"
        )
      )
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_PREVIEW_REQUIRED" }
    });
    expect(modelRounds).toBe(0);

    const previewed = await previewDraftStart(
      runtime,
      prepared.value,
      "start-packed-context-with-preview"
    );
    expect(previewed.preview.blocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: sourceContent })])
    );
    expect(await runtime.agentRunSession.startAgentRun(previewed.command)).toMatchObject({
      ok: true
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(modelRounds).toBe(1);

    const contextSnapshotId = "context_" + runId + "_1";
    const promptArtifact = JSON.parse(
      await readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          runId,
          "prompt-materializations",
          "prompt_" + contextSnapshotId + ".json"
        ),
        "utf8"
      )
    ) as { readonly messages: readonly { readonly role: string; readonly content: string }[] };
    const contextSnapshot = JSON.parse(
      await readFile(
        join(
          projectRoot,
          "history",
          "agent-runs",
          runId,
          "context-snapshots",
          contextSnapshotId + ".json"
        ),
        "utf8"
      )
    ) as Record<string, unknown>;
    const previewChecksums = previewed.preview.blocks.map((block) => block.checksum);
    const providerBlocks = messagesBoundToChecksums(providerMessages, previewChecksums);
    const artifactBlocks = messagesBoundToChecksums(promptArtifact.messages, previewChecksums);
    expect(providerBlocks.map((block) => block.checksum)).toEqual(previewChecksums);
    expect(artifactBlocks).toEqual(providerBlocks);
    expect(contextSnapshot["packedContextManifest"]).toMatchObject({
      packedContextId: previewed.preview.packedContextId,
      payloadChecksum: previewed.preview.payloadChecksum,
      blocks: previewed.preview.blocks.map((block) => ({
        blockId: block.blockId,
        refId: block.refId,
        sourceKind: block.sourceKind,
        order: block.order,
        checksum: block.checksum,
        tokenCount: block.tokenCount,
        precision: block.precision,
        truncationRange: block.truncationRange
      }))
    });
  });

  test("rejects a Packed Context checksum mismatch and a draft changed after preview", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-packed-stale-"));
    roots.push(projectRoot);
    let modelRounds = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-packed-context-stale",
      resolveModelStartFacts: async () => ({
        profileId: "profile-packed-stale",
        provider: "demo",
        modelName: "packed-stale-model",
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
          yield runtimeToolCall("finish-packed-stale", "finish", { summary: "Unexpected." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-packed-stale-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-packed-stale-run",
      userRequest: "Use the current context.",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-packed-stale",
      contextRefs: []
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const previewed = await previewDraftStart(runtime, prepared.value, "unused-packed-stale-start");

    expect(
      await runtime.agentRunSession.startAgentRun({
        ...draftOnlyStartCommand(
          runtime.workspaceId,
          prepared.value,
          "start-packed-checksum-mismatch",
          previewed.preview
        ),
        packedContextPayloadChecksum: "0".repeat(64)
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_PREVIEW_STALE" }
    });

    const changed = await runtime.agentRunDraftSession.updateAgentRunDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "change-draft-after-packed-preview",
      expectedDraftRevision: prepared.value.runDraft.revision,
      mutation: { kind: "set_request", request: "Use the changed request." }
    });
    expect(changed).toMatchObject({ ok: true });
    if (!changed.ok) return;
    expect(
      await runtime.agentRunSession.startAgentRun(
        draftOnlyStartCommand(
          runtime.workspaceId,
          changed.value,
          "start-packed-draft-mismatch",
          previewed.preview
        )
      )
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_PREVIEW_STALE" }
    });
    expect(modelRounds).toBe(0);
  });

  test("blocks a draft start when pinned context alone exceeds the fixed input budget", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-packed-overflow-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "pinned.md"), "x".repeat(140_000), "utf8");
    let modelRounds = 0;
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-packed-context-overflow",
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      resolveModelStartFacts: async () => ({
        profileId: "profile-packed-overflow",
        provider: "demo",
        modelName: "packed-overflow-model",
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
          yield runtimeToolCall("finish-packed-overflow", "finish", { summary: "Unexpected." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-packed-overflow-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-packed-overflow-run",
      userRequest: "Use all pinned context.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-packed-overflow",
      contextRefs: [
        {
          kind: "project_file",
          refId: "file:notes/pinned.md",
          relativePath: "notes/pinned.md",
          label: "Pinned"
        }
      ]
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;
    const pinned = await runtime.agentRunDraftSession.updateContextDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "pin-packed-overflow-source",
      contextDraftId: prepared.value.contextDraft.contextDraftId,
      expectedDraftRevision: prepared.value.contextDraft.revision,
      mutation: {
        kind: "set_source_override",
        refId: "file:notes/pinned.md",
        decision: "pinned",
        priority: 100
      }
    });
    expect(pinned).toMatchObject({ ok: true });
    if (!pinned.ok) return;
    const preview = await runtime.agentContextSession.previewPackedContext({
      projectId: runtime.workspaceId,
      conversationId: conversation.value.conversationId,
      commandId: "preview-packed-overflow",
      runDraftId: pinned.value.runDraft.runDraftId,
      expectedDraftRevision: pinned.value.runDraft.revision,
      runDraftChecksum: pinned.value.runDraft.checksum
    });
    expect(preview).toMatchObject({
      ok: false,
      error: { code: "CONTEXT_PACKING_ACTIVE_OR_PINNED_OVERFLOW" }
    });
    expect(modelRounds).toBe(0);
  });

  test.each(["excluded", "pinned"] as const)(
    "restores a project-%s source to base selection for this run only",
    async (projectDecision) => {
      const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-context-neutral-"));
      roots.push(projectRoot);
      await mkdir(join(projectRoot, "notes"), { recursive: true });
      await writeFile(join(projectRoot, "notes", "neutral.md"), "Neutral context body.\n", "utf8");
      const sourcePreference = {
        refId: "file:notes/neutral.md",
        decision: projectDecision,
        priority: 99,
        ref: {
          kind: "project_file" as const,
          refId: "file:notes/neutral.md",
          relativePath: "notes/neutral.md",
          label: "Neutral context"
        }
      };
      const projectPreferences = [sourcePreference] as const;
      const originalPreferences = structuredClone(projectPreferences);
      const runtime = runtimeExports.createDesktopAgentRuntime({
        workspaceKind: "creativeProject",
        projectId: "project-context-neutral",
        contentRoot: projectRoot,
        stateRoot: projectRoot,
        contextSourcePreferences: projectPreferences,
        verifyCreativeGeneralActiveResource: async () => ok(undefined),
        resolveModelStartFacts: async () => ({
          profileId: "profile-context-neutral",
          provider: "demo",
          modelName: "context-neutral-model",
          capabilities: {
            streaming: true,
            toolCalling: true,
            structuredArguments: true,
            contextWindow: 128000
          },
          requiredContextTokens: 8000,
          reasoningStrength: { status: "hidden", reason: "test model" }
        })
      });
      const conversation = await runtime.agentConversationSession.createConversation({
        projectId: "project-context-neutral",
        commandId: `create-context-neutral-${projectDecision}`
      });
      expect(conversation).toMatchObject({ ok: true });
      if (!conversation.ok) return;
      const prepared = await runtime.agentRunDraftSession.syncStartDraft({
        projectId: "project-context-neutral",
        conversationId: conversation.value.conversationId,
        commandId: `prepare-context-neutral-${projectDecision}`,
        userRequest: "Use the neutral source.",
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        modelProfileId: "profile-context-neutral",
        contextRefs: []
      });
      expect(prepared).toMatchObject({ ok: true });
      if (!prepared.ok) return;
      const restored = await runtime.agentRunDraftSession.updateContextDraft({
        projectId: "project-context-neutral",
        conversationId: conversation.value.conversationId,
        commandId: `restore-context-neutral-${projectDecision}`,
        contextDraftId: prepared.value.contextDraft.contextDraftId,
        expectedDraftRevision: prepared.value.contextDraft.revision,
        mutation: {
          kind: "set_source_override",
          refId: sourcePreference.refId,
          decision: "automatic"
        }
      });
      if (!restored.ok) throw new Error(JSON.stringify(restored.error));

      const previewed = await previewDraftStart(
        runtime,
        restored.value,
        `preview-context-neutral-${projectDecision}`
      );
      expect(
        previewed.preview.sources.find((source) => source.refId === sourcePreference.refId)
      ).toMatchObject({
        state: "active",
        selectionPolicy: "explicit",
        preferenceScope: "run",
        selectionReason: "Restored to automatic selection for this run",
        priority: 70
      });
      expect(projectPreferences).toEqual(originalPreferences);
    }
  );

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

    const previewed = await previewDraftStart(runtime, prepared.value, "start-saved-editor-run");
    const started = await runtime.agentRunSession.startAgentRun(previewed.command);
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

    const previewed = await previewDraftStart(
      runtime,
      withManualRef.value,
      "start-active-file-suffix-run"
    );
    expect(await runtime.agentRunSession.startAgentRun(previewed.command)).toMatchObject({
      ok: true
    });
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
    expect(manualIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeLessThan(requestIndex);
    expect(manualIndex).toBeLessThan(requestIndex);
    expect(firstRoundMessages.at(-1)?.content).toBe("Use the current project file.");
  });

  test("reads the active Story Bible asset into the writing prompt suffix", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-active-story-"));
    roots.push(projectRoot);
    const storyBible = new StoryBibleFileRepository({ projectRoot });
    expect(
      await storyBible.saveStoryAsset({
        schemaVersion: "1.0",
        id: "chr_active",
        type: "character",
        title: "Active Hero",
        status: "active",
        summary: "The currently open character.",
        details: { privateMarker: "ACTIVE_STORY_DETAIL_MARKER" },
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z"
      })
    ).toMatchObject({ ok: true });
    const roundMessages: Array<readonly { readonly role: string; readonly content: string }[]> = [];
    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      createRunId: () => "run-active-story-suffix",
      resolveModelStartFacts: async () => ({
        profileId: "profile-active-story",
        provider: "demo",
        modelName: "active-story-model",
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
          yield runtimeToolCall("finish-active-story-suffix", "finish", { summary: "Finished." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });
    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-active-story-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-active-story-run",
      userRequest: "Use the open character setting.",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-active-story",
      contextRefs: [],
      activeResourceRef: {
        kind: "story_bible",
        refId: "story_bible:chr_active",
        assetId: "chr_active",
        label: "Active Hero"
      }
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;

    const previewed = await previewDraftStart(runtime, prepared.value, "start-active-story-run");
    expect(await runtime.agentRunSession.startAgentRun(previewed.command)).toMatchObject({
      ok: true
    });
    await vi.waitFor(async () => {
      expect(await runtime.agentRunSession.readAgentRun("run-active-story-suffix")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });

    const firstRoundMessages = roundMessages[0] ?? [];
    const requestIndex = firstRoundMessages.findIndex(
      (message) => message.role === "user" && message.content === "Use the open character setting."
    );
    const activeIndex = firstRoundMessages.findIndex((message) =>
      message.content.includes("ACTIVE_STORY_DETAIL_MARKER")
    );
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeGreaterThanOrEqual(0);
    expect(activeIndex).toBeLessThan(requestIndex);
    expect(firstRoundMessages.at(-1)?.content).toBe("Use the open character setting.");
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
    const previewed = await previewDraftStart(
      runtime,
      prepared.value,
      "start-active-file-stale-run"
    );
    await writeFile(join(projectRoot, "notes", "current.md"), "Externally changed body.\n", "utf8");

    await expect(runtime.agentRunSession.startAgentRun(previewed.command)).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" }
    });
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
          content: expect.stringContaining('"kind":"untrusted_conversation_data"')
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

  test("stages foreshadow edits at the managed path with foreshadow schema validation", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "novel-studio-desktop-agent-foreshadow-edit-")
    );
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });
    const timestamp = "2026-07-30T00:00:00.000Z";
    const assetId = `fsh_${"a".repeat(32)}`;
    expect(
      await repository.saveStoryAsset({
        schemaVersion: "1.0",
        id: assetId,
        type: "foreshadow",
        title: "Sealed archive",
        status: "active",
        summary: "The archive remains sealed.",
        createdAt: timestamp,
        updatedAt: timestamp,
        details: { trackingStatus: "planned", origin: "manual" }
      })
    ).toMatchObject({ ok: true });
    const relativePath = `foreshadows/${assetId}.json`;
    const assetPath = join(projectRoot, "foreshadows", `${assetId}.json`);
    const content = await readFile(assetPath, "utf8");
    const summary = "The archive remains sealed.";
    const summaryStart = content.indexOf(summary);
    expect(summaryStart).toBeGreaterThanOrEqual(0);
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-foreshadow-edit",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("edit-foreshadow", "edit_text", {
              ref: `story_bible:${assetId}`,
              baseHash: sha256(content),
              range: {
                unit: "character",
                start: summaryStart,
                end: summaryStart + summary.length
              },
              replacement: "The archive key has surfaced."
            });
          } else {
            yield runtimeToolCall("finish-foreshadow-edit", "finish", { summary: "Finished." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-foreshadow-edit")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            files: [
              {
                relativePath,
                validation: { schema: { status: "valid" } }
              }
            ]
          }
        }
      });
    });
    expect(await readFile(assetPath, "utf8")).toBe(content);
  });

  test("validates v2 foreshadow creation before persisting its Change Set", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "novel-studio-desktop-agent-foreshadow-create-")
    );
    roots.push(projectRoot);
    const assetId = `fsh_${"c".repeat(32)}`;
    const timestamp = "2026-07-31T00:00:00.000Z";
    const invalidContent = JSON.stringify({ id: assetId, type: "foreshadow" });
    const validContent = `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: assetId,
        type: "foreshadow",
        title: "Sealed archive",
        status: "active",
        summary: "The archive remains sealed.",
        details: { trackingStatus: "planned", origin: "manual" },
        createdAt: timestamp,
        updatedAt: timestamp
      },
      null,
      2
    )}\n`;
    const lockOwnerId = "desktop-agent-foreshadow-create-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-foreshadow-create",
      featureFlags: createAgentFeatureFlags({
        phaseB_fileLifecycleEnabled: true,
        revision: "desktop-foreshadow-create-test"
      }),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("create-invalid-foreshadow", "create_resource", {
              kind: "story_bible",
              assetType: "foreshadow",
              content: invalidContent
            });
          } else if (round === 2) {
            yield runtimeToolCall("create-valid-foreshadow", "create_resource", {
              kind: "story_bible",
              assetType: "foreshadow",
              content: validContent
            });
          } else {
            yield runtimeToolCall("finish-foreshadow-create", "finish", { summary: "Finished." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("writing"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-foreshadow-create")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval", contextMode: "writing" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "create-invalid-foreshadow",
                code: "CHANGE_SET_OPERATION_INVALID"
              })
            })
          ]),
          changeSet: {
            operations: [
              expect.objectContaining({
                kind: "create_file",
                relativePath: `foreshadows/${assetId}.json`,
                content: validContent
              })
            ]
          }
        }
      });
    });
    await expect(
      readFile(join(projectRoot, "foreshadows", `${assetId}.json`), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("serves complete Agent-safe Story Bible discovery without exposing passthrough values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-story-bible-read-"));
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });
    const chapterId = "ch_story_bible_reference";
    const chapters = new ChapterFileRepository({ projectRoot });
    await expect(
      chapters.createChapter({ chapterId, title: "Reference chapter", body: "" })
    ).resolves.toMatchObject({ ok: true });
    const assetId = "chr_legacy_character_read";
    expect(
      await repository.saveStoryAsset({
        schemaVersion: "1.0",
        id: assetId,
        type: "character",
        title: "林砚",
        status: "active",
        summary: "调查旧港失踪案",
        details: { role: "记者", privateLegacyNote: "legacy-secret-value" },
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
        privateLegacyRoot: "legacy-secret-value"
      })
    ).toMatchObject({ ok: true });
    let round = 0;
    let toolPayload = "";
    let visibleTools: string[] = [];
    const referenceInputs: (readonly string[] | undefined)[] = [];
    const getReferences = StoryBibleFileRepository.prototype.getStoryBibleReferences;
    const referenceSpy = vi
      .spyOn(StoryBibleFileRepository.prototype, "getStoryBibleReferences")
      .mockImplementation(async function (referenceAssetId, knownChapterIds) {
        referenceInputs.push(knownChapterIds);
        return getReferences.call(this, referenceAssetId, knownChapterIds);
      });
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-story-bible-read",
      modelDriver: {
        async *streamRound(input: {
          tools: readonly { name: string }[];
          messages: readonly { role: string; content: string }[];
        }) {
          round += 1;
          visibleTools = input.tools.map((tool) => tool.name);
          if (round === 1) {
            yield runtimeToolCall("describe-character", "describe_story_bible_type", {
              type: "character"
            });
            yield runtimeToolCall("list-story-bible", "list_story_bible", {
              types: ["character"],
              limit: 10
            });
          } else if (round === 2) {
            yield runtimeToolCall("read-story-bible", "read_story_bible", { assetId });
            yield runtimeToolCall("references-story-bible", "get_story_bible_references", {
              assetId
            });
          } else {
            toolPayload = input.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content)
              .join("\n");
            yield runtimeToolCall("finish-story-bible-read", "finish", { summary: "Read." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("writing"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-story-bible-read")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(visibleTools).toEqual(
      expect.arrayContaining([
        "describe_story_bible_type",
        "list_story_bible",
        "read_story_bible",
        "get_story_bible_references"
      ])
    );
    expect(toolPayload).toContain("createValueSchema");
    expect(toolPayload).toContain(assetId);
    expect(toolPayload).toContain('"present":true');
    expect(toolPayload).not.toContain("legacy-secret-value");
    expect(referenceInputs).toContainEqual([chapterId]);
    referenceSpy.mockRestore();
  });

  test("propagates chapter catalog failures from Story Bible reference queries", async () => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), "novel-studio-desktop-story-bible-ref-error-")
    );
    roots.push(projectRoot);
    const listChapters = vi
      .spyOn(ChapterFileRepository.prototype, "listChapters")
      .mockResolvedValue(
        err({
          schemaVersion: "1.0",
          errorId: "err_story_bible_reference_chapters",
          code: "CHAPTER_CATALOG_UNAVAILABLE",
          category: "StorageError",
          message: "Chapter catalog is unavailable.",
          recoverability: "retryable",
          suggestedAction: "Retry.",
          traceId: "desktop-agent-run-runtime-test"
        })
      );
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-story-bible-ref-error",
      modelDriver: {
        async *streamRound() {
          round += 1;
          yield round === 1
            ? runtimeToolCall("references-fail", "get_story_bible_references", {
                assetId: "chr_unavailable"
              })
            : runtimeToolCall("finish-references-fail", "finish", { summary: "Finished." });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand());
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-story-bible-ref-error")).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "completed" },
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "tool_failed",
              detail: expect.objectContaining({
                toolCallId: "references-fail",
                code: "CHAPTER_CATALOG_UNAVAILABLE"
              })
            })
          ])
        }
      });
    });
    listChapters.mockRestore();
  });

  test("applies a structured Story Bible patch only after Change Set approval", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-story-bible-patch-"));
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-07-31T00:00:00.000Z"
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "林砚", summary: "尚未进入旧港。" }
    });
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) throw new Error(created.error.message);
    const assetId = created.value.id;
    const relativePath = `characters/${assetId}.json`;
    const assetPath = join(projectRoot, relativePath);
    const beforeContent = await readFile(assetPath, "utf8");
    const before = await repository.readCompatibleStoryAsset(assetId);
    expect(before).toMatchObject({ ok: true });
    if (!before.ok) throw new Error(before.error.message);
    const lockOwnerId = "desktop-story-bible-patch-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      lifecycleOperations: createTestingReplaceLifecyclePort(projectRoot),
      createRunId: () => "run-desktop-story-bible-patch",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("patch-character", "patch_story_bible", {
              assetId,
              baseRevision: before.value.revision,
              baseChecksum: before.value.checksum,
              operations: [{ op: "replace", path: "/summary", value: "已经进入旧港调查失踪案。" }]
            });
          } else {
            yield runtimeToolCall("finish-story-bible-patch", "finish", { summary: "Patched." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand("writing"));
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-story-bible-patch");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            files: [
              expect.objectContaining({
                relativePath,
                candidateContent: expect.stringContaining("已经进入旧港调查失踪案。")
              })
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
    expect(await readFile(assetPath, "utf8")).toBe(beforeContent);
    if (changeSet === undefined) throw new Error("Expected a staged Story Bible Change Set.");

    expect(
      await session.decideChangeSet({
        runId: "run-desktop-story-bible-patch",
        projectId: "project-01",
        commandId: "apply-story-bible-patch",
        expectedRunRevision: awaitingRevision,
        changeSetId: changeSet["changeSetId"],
        revision: changeSet["revision"],
        checksum: changeSet["checksum"],
        decision: "apply_selected"
      })
    ).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-story-bible-patch")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(await repository.readCompatibleStoryAsset(assetId)).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        asset: { summary: "已经进入旧港调查失踪案。", revision: 2 }
      }
    });
  });

  test("migrates a legacy Story Bible patch only through an approved Change Set and restores it on undo", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-story-bible-legacy-"));
    roots.push(projectRoot);
    const assetId = "loc_legacy_port";
    const legacyPath = join(projectRoot, "world", "locations", "legacy-port.json");
    const canonicalPath = join(projectRoot, "world", `${assetId}.json`);
    await mkdir(join(projectRoot, "world", "locations"), { recursive: true });
    const legacyContent = `${JSON.stringify(
      {
        schemaVersion: "1.0",
        id: assetId,
        type: "world.location",
        title: "旧港",
        status: "active",
        summary: "尚未修订。",
        details: { constraints: [] },
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z"
      },
      null,
      2
    )}\n`;
    await writeFile(legacyPath, legacyContent, "utf8");
    const repository = new StoryBibleFileRepository({ projectRoot });
    const before = await repository.readCompatibleStoryAsset(assetId);
    if (!before.ok) throw new Error(before.error.message);
    const lockOwnerId = "desktop-story-bible-legacy-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-story-bible-legacy",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("patch-legacy-location", "patch_story_bible", {
              assetId,
              baseRevision: before.value.revision,
              baseChecksum: before.value.checksum,
              operations: [{ op: "replace", path: "/summary", value: "已经修订。" }]
            });
          } else {
            yield runtimeToolCall("finish-legacy-location", "finish", { summary: "Patched." });
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
    let awaitingRevision = 0;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-story-bible-legacy");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            operations: [
              expect.objectContaining({
                kind: "create_file",
                relativePath: `world/${assetId}.json`
              }),
              expect.objectContaining({
                kind: "delete_file",
                relativePath: "world/locations/legacy-port.json",
                dependsOn: [expect.any(String)]
              })
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
    expect(await readFile(legacyPath, "utf8")).toBe(legacyContent);
    await expect(readFile(canonicalPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    if (changeSet === undefined) throw new Error("Expected legacy migration Change Set.");
    await session.decideChangeSet({
      runId: "run-desktop-story-bible-legacy",
      projectId: "project-01",
      commandId: "apply-story-bible-legacy",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-story-bible-legacy")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(canonicalPath, "utf8")).toContain("已经修订。");
    const journals = await new RecoveryRepository({ projectRoot }).listAgentTransactionJournals();
    expect(journals.ok).toBe(true);
    if (!journals.ok) throw new Error(journals.error.message);
    expect(journals.value[0]?.storyBibleReceipt?.assets[0]).toMatchObject({
      assetId,
      beforeRevision: 0,
      beforeChecksum: before.value.checksum
    });
    const completed = (await session.readAgentRun("run-desktop-story-bible-legacy")) as {
      value: { snapshot: { runRevision: number } };
    };
    await expect(
      session.undoRun({
        projectId: "project-01",
        runId: "run-desktop-story-bible-legacy",
        commandId: "undo-story-bible-legacy",
        expectedRunRevision: completed.value.snapshot.runRevision
      })
    ).resolves.toMatchObject({ ok: true, value: { status: "completed" } });
    expect(await readFile(legacyPath, "utf8")).toBe(legacyContent);
    await expect(readFile(canonicalPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    ["null", null],
    ["malformed", { afterStatus: "deleted" }]
  ])("fails closed for a %s Story Bible deletion transition record", async (_label, malformed) => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-restore-proof-malformed-"));
    roots.push(projectRoot);
    const assetId = `chr_${"1".repeat(32)}`;
    const beforeContent = statusAssetContent(assetId, "active", 1);
    const deletedContent = statusAssetContent(assetId, "deleted", 2);
    const versionId = "ver_restore_malformed";
    const history = new HistoryRepository({ projectRoot, createVersionId: () => versionId });
    const snapshot = await history.snapshotTextAsset({
      assetType: "text",
      assetId,
      reason: "before-agent-write",
      content: beforeContent,
      candidateContent: deletedContent
    });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    const recordPath = join(
      projectRoot,
      "history",
      "texts-records",
      `asset_${sha256(assetId)}`,
      `${versionId}.json`
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    record["storyBibleStatusTransition"] = malformed;
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    await expect(
      runtimeExports.resolveStoryBibleRestoreAuthorization(
        history,
        assetId,
        2,
        sha256(deletedContent)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE" }
    });
  });

  test("binds restore authorization to the current deleted checksum", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-restore-proof-checksum-"));
    roots.push(projectRoot);
    const assetId = `chr_${"2".repeat(32)}`;
    const beforeContent = statusAssetContent(assetId, "draft", 1);
    const deletedContent = statusAssetContent(assetId, "deleted", 2);
    const history = new HistoryRepository({ projectRoot });
    const snapshot = await history.snapshotTextAsset({
      assetType: "text",
      assetId,
      reason: "before-agent-write",
      content: beforeContent,
      candidateContent: deletedContent
    });
    if (!snapshot.ok) throw new Error(snapshot.error.message);

    await expect(
      runtimeExports.resolveStoryBibleRestoreAuthorization(
        history,
        assetId,
        2,
        sha256(`${deletedContent}changed`)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE" }
    });
  });

  test.each(["record", "snapshot"] as const)(
    "rejects restore authorization when the History %s checksum is tampered",
    async (tamperedPart) => {
      const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-restore-proof-tamper-"));
      roots.push(projectRoot);
      const assetId = `chr_${"4".repeat(32)}`;
      const beforeContent = statusAssetContent(assetId, "active", 1);
      const deletedContent = statusAssetContent(assetId, "deleted", 2);
      const versionId = "ver_restore_tamper";
      const history = new HistoryRepository({ projectRoot, createVersionId: () => versionId });
      const snapshot = await history.snapshotTextAsset({
        assetType: "text",
        assetId,
        reason: "before-agent-write",
        content: beforeContent,
        candidateContent: deletedContent
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);
      const assetHistoryKey = `asset_${sha256(assetId)}`;
      if (tamperedPart === "record") {
        const recordPath = join(
          projectRoot,
          "history",
          "texts-records",
          assetHistoryKey,
          `${versionId}.json`
        );
        const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
        record["checksum"] = `sha256:${"f".repeat(64)}`;
        await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      } else {
        await writeFile(
          join(projectRoot, "history", "texts", assetHistoryKey, `${versionId}.txt`),
          `${beforeContent}tampered`,
          "utf8"
        );
      }

      await expect(
        runtimeExports.resolveStoryBibleRestoreAuthorization(
          history,
          assetId,
          2,
          sha256(deletedContent)
        )
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE" }
      });
    }
  );

  test("rejects conflicting pre-delete statuses for the same deleted revision", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-restore-proof-conflict-"));
    roots.push(projectRoot);
    const assetId = `chr_${"3".repeat(32)}`;
    const deletedContent = statusAssetContent(assetId, "deleted", 2);
    const versionIds = ["ver_restore_active", "ver_restore_archived"];
    let versionIndex = 0;
    const history = new HistoryRepository({
      projectRoot,
      createVersionId: () => versionIds[versionIndex++] ?? `ver_restore_extra_${versionIndex}`
    });
    for (const status of ["active", "archived"] as const) {
      const snapshot = await history.snapshotTextAsset({
        assetType: "text",
        assetId,
        reason: "before-agent-write",
        content: statusAssetContent(assetId, status, 1),
        candidateContent: deletedContent
      });
      if (!snapshot.ok) throw new Error(snapshot.error.message);
    }

    await expect(
      runtimeExports.resolveStoryBibleRestoreAuthorization(
        history,
        assetId,
        2,
        sha256(deletedContent)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE" }
    });
  });

  test("rejects a stale Story Bible deletion impact before snapshots or business writes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-delete-proof-stale-"));
    roots.push(projectRoot);
    const targetId = `chr_${"5".repeat(32)}`;
    const sourceId = `chr_${"6".repeat(32)}`;
    const assetIds = [targetId, sourceId];
    let assetIndex = 0;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-08-01T00:00:00.000Z",
      createAssetId: () => assetIds[assetIndex++] ?? `chr_${"9".repeat(32)}`
    });
    const target = await repository.createStoryAsset({
      type: "character",
      value: { title: "待删除人物" }
    });
    const source = await repository.createStoryAsset({
      type: "character",
      value: { title: "引用人物" }
    });
    if (!target.ok || !source.ok) throw new Error("Failed to create Story Bible proof fixtures.");
    const targetRead = await repository.readCompatibleStoryAsset(targetId);
    if (!targetRead.ok) throw new Error(targetRead.error.message);
    const initialImpact = await repository.getStoryBibleReferences(targetId);
    if (!initialImpact.ok) throw new Error(initialImpact.error.message);
    const preparedDelete = await repository.prepareStoryAssetCandidate({
      candidate: storyBibleStatusCandidate(targetRead.value.asset, "deleted"),
      baseRevision: targetRead.value.revision,
      baseChecksum: targetRead.value.checksum
    });
    if (!preparedDelete.ok) throw new Error(preparedDelete.error.message);
    const changeSet = await createChangeSetRevision({
      changeSetId: "changes-delete-proof-stale",
      runId: "run-delete-proof-stale",
      projectId: "project-01",
      checkpointId: "checkpoint-delete-proof-stale",
      contextSnapshotId: "context-delete-proof-stale",
      createdAt: "2026-08-01T00:01:00.000Z",
      proposal: {
        relativePath: preparedDelete.value.relativePath,
        assetType: "text",
        assetId: targetId,
        baseContent: preparedDelete.value.baseContent,
        baseChecksum: preparedDelete.value.baseChecksum,
        range: { unit: "character", start: 0, end: preparedDelete.value.baseContent.length },
        replacement: preparedDelete.value.content,
        storyBibleStatusProof: {
          action: "delete",
          deletionImpactChecksum: initialImpact.value.deletionImpactChecksum
        }
      }
    });
    const approval = decideChangeSetApproval({
      changeSet,
      decision: "apply_selected",
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      resolvedAt: "2026-08-01T00:02:00.000Z"
    });
    if (!approval.ok) throw new Error(approval.error.message);

    const sourceRead = await repository.readCompatibleStoryAsset(sourceId);
    if (!sourceRead.ok) throw new Error(sourceRead.error.message);
    const sourceCandidate = storyBibleStatusCandidate(
      sourceRead.value.asset,
      sourceRead.value.asset.status
    );
    sourceCandidate.relations = [
      {
        relationId: `rel_${"7".repeat(32)}`,
        sourceId,
        targetId,
        relationType: "character.knows",
        direction: "directed",
        status: "active",
        validFromChapterId: null,
        validToChapterId: null,
        inversePolicy: "none",
        inverseRelationId: null,
        evidence: [],
        note: ""
      }
    ];
    const savedSource = await repository.saveStoryAssetCandidate({
      candidate: sourceCandidate,
      baseRevision: sourceRead.value.revision,
      baseChecksum: sourceRead.value.checksum
    });
    if (!savedSource.ok) throw new Error(savedSource.error.message);

    const lockOwnerId = "desktop-delete-proof-stale";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    const services = runtimeExports.createDesktopVersionGroupServices({
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      projectId: "project-01",
      projectLockOwnerId: lockOwnerId,
      trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
        workspaceKind: "creativeProject",
        projectRoot
      }),
      projectReads: new AgentProjectReadRepository({ projectRoot }),
      storyBible: repository
    });
    const rejected = await services.versionGroupSession.applyApproved({
      changeSet,
      approval: approval.value
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_DELETION_IMPACT_CHANGED" }
    });
    expect(await repository.readCompatibleStoryAsset(targetId)).toMatchObject({
      ok: true,
      value: { asset: { status: "active" }, revision: 1 }
    });
    await expect(
      new HistoryRepository({ projectRoot }).listTextAssetSnapshotRecords({
        assetType: "text",
        assetId: targetId
      })
    ).resolves.toEqual(ok([]));
    await expect(
      new RecoveryRepository({ projectRoot }).listAgentTransactionJournals()
    ).resolves.toEqual(ok([]));
  });

  test("rejects a stale Story Bible restore authorization before snapshots or business writes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-restore-proof-stale-"));
    roots.push(projectRoot);
    const assetId = `chr_${"8".repeat(32)}`;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-08-01T00:00:00.000Z",
      createAssetId: () => assetId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "待恢复人物", status: "draft" }
    });
    if (!created.ok) throw new Error(created.error.message);
    const activeRead = await repository.readCompatibleStoryAsset(assetId);
    if (!activeRead.ok) throw new Error(activeRead.error.message);
    const deletionImpact = await repository.getStoryBibleReferences(assetId);
    if (!deletionImpact.ok) throw new Error(deletionImpact.error.message);
    const preparedDelete = await repository.prepareStoryAssetCandidate({
      candidate: storyBibleStatusCandidate(activeRead.value.asset, "deleted"),
      baseRevision: activeRead.value.revision,
      baseChecksum: activeRead.value.checksum
    });
    if (!preparedDelete.ok) throw new Error(preparedDelete.error.message);
    const versionIds = ["ver_restore_initial", "ver_restore_late"];
    let versionIndex = 0;
    const history = new HistoryRepository({
      projectRoot,
      createVersionId: () => versionIds[versionIndex++] ?? `ver_restore_extra_${versionIndex}`
    });
    const initialSnapshot = await history.snapshotTextAsset({
      assetType: "text",
      assetId,
      reason: "before-agent-write",
      content: preparedDelete.value.baseContent,
      candidateContent: preparedDelete.value.content
    });
    if (!initialSnapshot.ok) throw new Error(initialSnapshot.error.message);
    const deleted = await repository.saveStoryAssetStatusTransition({
      candidate: storyBibleStatusCandidate(activeRead.value.asset, "deleted"),
      baseRevision: activeRead.value.revision,
      baseChecksum: activeRead.value.checksum,
      statusTransition: {
        action: "move-to-deleted",
        expectedDeletionImpactChecksum: deletionImpact.value.deletionImpactChecksum
      }
    });
    if (!deleted.ok) throw new Error(deleted.error.message);
    const deletedRead = await repository.readCompatibleStoryAsset(assetId);
    if (!deletedRead.ok) throw new Error(deletedRead.error.message);
    const authorization = await runtimeExports.resolveStoryBibleRestoreAuthorization(
      history,
      assetId,
      deletedRead.value.revision,
      deletedRead.value.checksum
    );
    if (!authorization.ok) throw new Error(authorization.error.message);
    const preparedRestore = await repository.prepareStoryAssetCandidate({
      candidate: storyBibleStatusCandidate(deletedRead.value.asset, authorization.value.status),
      baseRevision: deletedRead.value.revision,
      baseChecksum: deletedRead.value.checksum
    });
    if (!preparedRestore.ok) throw new Error(preparedRestore.error.message);
    const changeSet = await createChangeSetRevision({
      changeSetId: "changes-restore-proof-stale",
      runId: "run-restore-proof-stale",
      projectId: "project-01",
      checkpointId: "checkpoint-restore-proof-stale",
      contextSnapshotId: "context-restore-proof-stale",
      createdAt: "2026-08-01T00:01:00.000Z",
      proposal: {
        relativePath: preparedRestore.value.relativePath,
        assetType: "text",
        assetId,
        baseContent: preparedRestore.value.baseContent,
        baseChecksum: preparedRestore.value.baseChecksum,
        range: {
          unit: "character",
          start: 0,
          end: preparedRestore.value.baseContent.length
        },
        replacement: preparedRestore.value.content,
        storyBibleStatusProof: {
          action: "restore",
          expectedStatus: authorization.value.status,
          historyAuthorizationChecksum: authorization.value.historyAuthorizationChecksum
        }
      }
    });
    const approval = decideChangeSetApproval({
      changeSet,
      decision: "apply_selected",
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      resolvedAt: "2026-08-01T00:02:00.000Z"
    });
    if (!approval.ok) throw new Error(approval.error.message);

    const lateSnapshot = await history.snapshotTextAsset({
      assetType: "text",
      assetId,
      reason: "before-agent-write",
      content: preparedDelete.value.baseContent,
      candidateContent: preparedDelete.value.content
    });
    if (!lateSnapshot.ok) throw new Error(lateSnapshot.error.message);
    expect(
      await runtimeExports.resolveStoryBibleRestoreAuthorization(
        history,
        assetId,
        deletedRead.value.revision,
        deletedRead.value.checksum
      )
    ).not.toEqual(authorization);

    const lockOwnerId = "desktop-restore-proof-stale";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    const services = runtimeExports.createDesktopVersionGroupServices({
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      projectId: "project-01",
      projectLockOwnerId: lockOwnerId,
      trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
        workspaceKind: "creativeProject",
        projectRoot
      }),
      projectReads: new AgentProjectReadRepository({ projectRoot }),
      storyBible: repository
    });
    const rejected = await services.versionGroupSession.applyApproved({
      changeSet,
      approval: approval.value
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_AUTHORIZATION_CHANGED" }
    });
    expect(await repository.readCompatibleStoryAsset(assetId)).toMatchObject({
      ok: true,
      value: { asset: { status: "deleted" }, revision: deletedRead.value.revision }
    });
    await expect(
      history.listTextAssetSnapshotRecords({ assetType: "text", assetId })
    ).resolves.toMatchObject({ ok: true, value: [{}, {}] });
    await expect(
      new RecoveryRepository({ projectRoot }).listAgentTransactionJournals()
    ).resolves.toEqual(ok([]));
  });

  test("validates the complete Story Bible file-and-create group before transaction writes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-story-bible-group-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const firstId = `chr_${"a".repeat(32)}`;
    const secondId = `chr_${"b".repeat(32)}`;
    const firstRelationId = `rel_${"1".repeat(32)}`;
    const secondRelationId = `rel_${"2".repeat(32)}`;
    const repository = new StoryBibleFileRepository({
      projectRoot,
      now: () => "2026-07-31T00:00:00.000Z",
      createAssetId: () => firstId
    });
    const created = await repository.createStoryAsset({
      type: "character",
      value: { title: "林砚" }
    });
    if (!created.ok) throw new Error(created.error.message);
    const firstRead = await repository.readCompatibleStoryAsset(firstId);
    if (!firstRead.ok) throw new Error(firstRead.error.message);
    const relation = (input: {
      relationId: string;
      sourceId: string;
      targetId: string;
      inverseRelationId: string;
      status?: "active" | "ended";
    }) => ({
      relationId: input.relationId,
      sourceId: input.sourceId,
      targetId: input.targetId,
      relationType: "character.trust",
      direction: "directed" as const,
      status: input.status ?? ("active" as const),
      validFromChapterId: null,
      validToChapterId: null,
      inversePolicy: "explicit" as const,
      inverseRelationId: input.inverseRelationId,
      evidence: [],
      note: ""
    });
    const firstCandidate = {
      schemaVersion: "1.1" as const,
      id: firstRead.value.asset.id,
      type: firstRead.value.asset.type,
      title: firstRead.value.asset.title,
      status: firstRead.value.asset.status,
      summary: firstRead.value.asset.summary,
      aliases: [...firstRead.value.asset.aliases],
      relations: [
        relation({
          relationId: firstRelationId,
          sourceId: firstId,
          targetId: secondId,
          inverseRelationId: secondRelationId
        })
      ],
      details: firstRead.value.asset.details,
      extensions: firstRead.value.asset.extensions,
      createdAt: firstRead.value.asset.createdAt
    };
    const preparedFirst = await repository.prepareStoryAssetCandidate({
      candidate: firstCandidate,
      baseRevision: firstRead.value.revision,
      baseChecksum: firstRead.value.checksum,
      additionalKnownAssetIds: [secondId],
      deferProjectRelationPairValidation: true
    });
    if (!preparedFirst.ok) throw new Error(preparedFirst.error.message);
    const preparedSecond = await repository.prepareCreateStoryAsset({
      type: "character",
      reservedAssetId: secondId,
      value: {
        title: "顾岚",
        relations: [
          relation({
            relationId: secondRelationId,
            sourceId: secondId,
            targetId: firstId,
            inverseRelationId: firstRelationId
          })
        ]
      },
      deferProjectRelationPairValidation: true
    });
    if (!preparedSecond.ok) throw new Error(preparedSecond.error.message);

    const groupId = "fact_inverse_pair_01";
    const buildChangeSet = (input: {
      changeSetId: string;
      preparedContent: string;
      baseContent: string;
      baseChecksum: string;
      candidateChecksum: string;
      operation?: {
        readonly relativePath: string;
        readonly content: string;
      };
    }): ChangeSet => {
      const checksum = sha256(`${input.changeSetId}:${input.preparedContent}`);
      return {
        schemaVersion: "1.1",
        changeSetId: input.changeSetId,
        revision: 1,
        runId: "run-story-bible-group",
        projectId: "project-01",
        checkpointId: "checkpoint-story-bible-group",
        contextSnapshotId: "context-story-bible-group",
        writePolicy: "write_before_confirmation",
        status: "awaiting_approval",
        checksum,
        approvalToken: checksumChangeSetText(`${input.changeSetId}:1:${checksum}`),
        createdAt: "2026-07-31T00:00:00.000Z",
        files: [
          {
            relativePath: preparedFirst.value.relativePath,
            assetType: "text",
            assetId: firstId,
            baseChecksum: input.baseChecksum,
            candidateChecksum: input.candidateChecksum,
            baseContent: input.baseContent,
            candidateContent: input.preparedContent,
            selected: true,
            consistencyGroupId: groupId,
            hunks: [],
            validation: {
              valid: true,
              utf8: { status: "valid" },
              syntax: { status: "valid" },
              schema: { status: "valid" },
              asset: { status: "valid" }
            }
          }
        ],
        operationsSchemaVersion: "1.1",
        operations:
          input.operation === undefined
            ? []
            : [
                {
                  kind: "create_file",
                  operationId: "create-second-character",
                  toolCallIdempotencyKey: "tool-create-second-character",
                  relativePath: input.operation.relativePath,
                  content: input.operation.content,
                  selected: true,
                  consistencyGroupId: groupId
                }
              ]
      };
    };
    const approvalFor = (changeSet: ChangeSet): ChangeSetApproval => ({
      schemaVersion: "1.1",
      decision: "apply_selected",
      approvalSource: "human_confirmation",
      resolvedAt: "2026-07-31T00:01:00.000Z",
      binding: {
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        checksum: changeSet.checksum,
        approvalToken: changeSet.approvalToken,
        selectedConsistencyGroupIds: [groupId],
        selectionChecksum: checksumChangeSetSelection(changeSet, [groupId])
      }
    });

    const lockOwnerId = "desktop-story-bible-group-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    const services = runtimeExports.createDesktopVersionGroupServices({
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      projectId: "project-01",
      projectLockOwnerId: lockOwnerId,
      trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
        workspaceKind: "creativeProject",
        projectRoot
      }),
      projectReads: new AgentProjectReadRepository({ projectRoot }),
      chapterRepository: new ChapterFileRepository({ projectRoot }),
      storyBible: repository
    });
    const validChangeSet = buildChangeSet({
      changeSetId: "changes-story-bible-group-valid",
      preparedContent: preparedFirst.value.content,
      baseContent: preparedFirst.value.baseContent,
      baseChecksum: preparedFirst.value.baseChecksum,
      candidateChecksum: sha256(preparedFirst.value.content),
      operation: {
        relativePath: preparedSecond.value.relativePath,
        content: preparedSecond.value.content
      }
    });
    const applied = await services.versionGroupSession.applyApproved({
      changeSet: validChangeSet,
      approval: approvalFor(validChangeSet),
      group: { applyBatchId: "apply-story-bible-group-valid", consistencyGroupId: groupId }
    });
    if (!applied.ok) {
      throw new Error(JSON.stringify(applied.error));
    }
    expect(applied).toMatchObject({
      ok: true,
      value: {
        transactionStatus: "applied",
        writes: [{ relativePath: preparedFirst.value.relativePath, status: "applied" }],
        operations: [{ relativePaths: [preparedSecond.value.relativePath], status: "applied" }]
      }
    });
    expect(await repository.readCompatibleStoryAsset(secondId)).toMatchObject({
      ok: true,
      value: { asset: { relations: [{ inverseRelationId: firstRelationId }] } }
    });

    const currentFirst = await repository.readCompatibleStoryAsset(firstId);
    if (!currentFirst.ok) throw new Error(currentFirst.error.message);
    const inconsistentCandidate = {
      schemaVersion: "1.1" as const,
      id: currentFirst.value.asset.id,
      type: currentFirst.value.asset.type,
      title: currentFirst.value.asset.title,
      status: currentFirst.value.asset.status,
      summary: currentFirst.value.asset.summary,
      aliases: [...currentFirst.value.asset.aliases],
      relations: currentFirst.value.asset.relations.map((entry) => ({
        ...entry,
        status: "ended" as const
      })),
      details: currentFirst.value.asset.details,
      extensions: currentFirst.value.asset.extensions,
      createdAt: currentFirst.value.asset.createdAt
    };
    const preparedInconsistent = await repository.prepareStoryAssetCandidate({
      candidate: inconsistentCandidate,
      baseRevision: currentFirst.value.revision,
      baseChecksum: currentFirst.value.checksum,
      deferProjectRelationPairValidation: true
    });
    if (!preparedInconsistent.ok) throw new Error(preparedInconsistent.error.message);
    const invalidChangeSet = buildChangeSet({
      changeSetId: "changes-story-bible-group-invalid",
      preparedContent: preparedInconsistent.value.content,
      baseContent: preparedInconsistent.value.baseContent,
      baseChecksum: preparedInconsistent.value.baseChecksum,
      candidateChecksum: sha256(preparedInconsistent.value.content)
    });
    const beforeRejectedApply = await readFile(
      join(projectRoot, preparedInconsistent.value.relativePath),
      "utf8"
    );
    const rejected = await services.versionGroupSession.applyApproved({
      changeSet: invalidChangeSet,
      approval: approvalFor(invalidChangeSet),
      group: { applyBatchId: "apply-story-bible-group-invalid", consistencyGroupId: groupId }
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CANDIDATE_INVALID" }
    });
    expect(await readFile(join(projectRoot, preparedInconsistent.value.relativePath), "utf8")).toBe(
      beforeRejectedApply
    );
    await expect(
      new RecoveryRepository({ projectRoot }).listAgentTransactionJournals()
    ).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ transactionStatus: "applied" })]
    });
  });

  test("creates Story Bible assets with server-owned identity through approval", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-story-bible-create-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "world"), { recursive: true });
    const lockOwnerId = "desktop-story-bible-create-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-story-bible-create",
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("create-lore", "create_story_bible", {
              type: "world.lore",
              value: { title: "潮汐誓约", summary: "旧港守夜人遵循的誓约。" }
            });
          } else {
            yield runtimeToolCall("finish-story-bible-create", "finish", { summary: "Created." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    }) as unknown as {
      startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      refreshContext(command: Record<string, unknown>): Promise<Record<string, unknown>>;
      readAgentRun(runId: string): Promise<Record<string, unknown>>;
    };

    await session.startAgentRun(executionCommand("writing"));
    let awaitingRevision = 0;
    let changeSet: Record<string, unknown> | undefined;
    let operation: Record<string, unknown> | undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-story-bible-create");
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: "awaiting_write_approval" },
          changeSet: {
            operations: [
              expect.objectContaining({
                kind: "create_file",
                relativePath: expect.stringMatching(/^world\/lore_[a-f0-9]{32}\.json$/u)
              })
            ]
          }
        }
      });
      const value = read as {
        value: {
          snapshot: { runRevision: number };
          changeSet: Record<string, unknown> & { operations: Record<string, unknown>[] };
        };
      };
      awaitingRevision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
      operation = value.value.changeSet.operations[0];
    });
    if (changeSet === undefined || operation === undefined) {
      throw new Error("Expected a staged Story Bible create operation.");
    }
    const relativePath = String(operation["relativePath"]);
    const preparedAsset = JSON.parse(String(operation["content"])) as Record<string, unknown>;
    expect(preparedAsset).toMatchObject({
      schemaVersion: "1.1",
      id: expect.stringMatching(/^lore_[a-f0-9]{32}$/u),
      type: "world.lore",
      title: "潮汐誓约",
      revision: 1
    });
    expect(relativePath).toBe(`world/${String(preparedAsset["id"])}.json`);
    await expect(readFile(join(projectRoot, relativePath), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const applied = await session.decideChangeSet({
      runId: "run-desktop-story-bible-create",
      projectId: "project-01",
      commandId: "apply-story-bible-create",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "apply_selected"
    });
    expect(applied).toMatchObject({ ok: true });
    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-story-bible-create")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(JSON.parse(await readFile(join(projectRoot, relativePath), "utf8"))).toMatchObject({
      id: preparedAsset["id"],
      type: "world.lore",
      revision: 1
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
    const projectChanges: { readonly reason: string; readonly relativePaths: readonly string[] }[] =
      [];
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
      notifyProjectFilesChanged: async (input: {
        readonly reason: string;
        readonly relativePaths: readonly string[];
      }) => {
        projectChanges.push(input);
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
    expect(projectChanges).toEqual([]);
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

  test("does not notify for rejection, then notifies for apply and undo", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-agent-text-"));
    roots.push(projectRoot);
    const notesPath = join(projectRoot, "notes.txt");
    const notes = "Original notes.\n";
    await writeFile(notesPath, notes, "utf8");
    const lockOwnerId = "desktop-agent-trusted-text-test";
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect((await lock.acquireProjectLock()).ok).toBe(true);
    const projectChanges: {
      readonly reason: string;
      readonly versionGroupId: string;
      readonly relativePaths: readonly string[];
    }[] = [];
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => "run-desktop-text-validation",
      notifyProjectFilesChanged: async (input: {
        readonly reason: string;
        readonly versionGroupId: string;
        readonly relativePaths: readonly string[];
      }) => {
        projectChanges.push(input);
      },
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round <= 2) {
            yield runtimeToolCall(`proposal-text-${round}`, "edit_text", {
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

    const rejected = await session.decideChangeSet({
      runId: "run-desktop-text-validation",
      projectId: "project-01",
      commandId: "reject-desktop-trusted-text",
      expectedRunRevision: awaitingRevision,
      changeSetId: changeSet["changeSetId"],
      revision: changeSet["revision"],
      checksum: changeSet["checksum"],
      decision: "reject_all"
    });
    expect(rejected).toMatchObject({ ok: true });
    expect(await readFile(notesPath, "utf8")).toBe(notes);
    expect(projectChanges).toEqual([]);

    changeSet = undefined;
    await vi.waitFor(async () => {
      const read = await session.readAgentRun("run-desktop-text-validation");
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "awaiting_write_approval" } }
      });
      const value = read as {
        value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
      };
      awaitingRevision = value.value.snapshot.runRevision;
      changeSet = value.value.changeSet;
    });
    if (changeSet === undefined) throw new Error("Expected a second staged text Change Set.");

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
    expect(projectChanges).toEqual([
      {
        reason: "agent-change-set-apply",
        versionGroupId: expect.any(String),
        relativePaths: ["notes.txt"]
      }
    ]);

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
    expect(projectChanges).toEqual([
      {
        reason: "agent-change-set-apply",
        versionGroupId: expect.any(String),
        relativePaths: ["notes.txt"]
      },
      {
        reason: "agent-run-undo",
        versionGroupId: expect.any(String),
        relativePaths: ["notes.txt"]
      }
    ]);
  });

  test("applies legacy v2-facade lifecycle proposals one approval boundary at a time", async () => {
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
      // This is the flag-off legacy compatibility path. Catalog 2.0 capability tests use the
      // operation-specific flags and must never inherit this umbrella lifecycle flag.
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
          } else if (round === 2) {
            yield runtimeToolCall("create-v2-directory", "manage_path", {
              operation: "create_directory",
              path: "assets"
            });
          } else if (round === 3) {
            yield runtimeToolCall("move-v2-file", "manage_path", {
              operation: "move_file",
              sourceRef: "file:draft.md",
              targetPath: "moved.md",
              baseHash: sha256(source)
            });
          } else if (round === 4) {
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
    type PendingChangeSet = {
      readonly runRevision: number;
      readonly changeSet: Record<string, unknown>;
    };
    const waitForPendingChangeSet = async (
      expectedOperation: Record<string, unknown>,
      extraExpected: Record<string, unknown> = {}
    ): Promise<PendingChangeSet> => {
      let pending: PendingChangeSet | undefined;
      await vi.waitFor(async () => {
        const read = await session.readAgentRun("run-desktop-v2-lifecycle");
        expect(read).toMatchObject({
          ok: true,
          value: {
            snapshot: { status: "awaiting_write_approval" },
            ...extraExpected,
            changeSet: {
              operations: expect.arrayContaining([expect.objectContaining(expectedOperation)])
            }
          }
        });
        const value = read as {
          value: { snapshot: { runRevision: number }; changeSet: Record<string, unknown> };
        };
        pending = {
          runRevision: value.value.snapshot.runRevision,
          changeSet: value.value.changeSet
        };
      });
      if (pending === undefined) throw new Error("Expected a staged lifecycle Change Set.");
      return pending;
    };
    const applyPendingChangeSet = async (
      pending: PendingChangeSet,
      commandId: string
    ): Promise<void> => {
      const applied = await session.decideChangeSet({
        runId: "run-desktop-v2-lifecycle",
        projectId: "project-01",
        commandId,
        expectedRunRevision: pending.runRevision,
        changeSetId: pending.changeSet["changeSetId"],
        revision: pending.changeSet["revision"],
        checksum: pending.changeSet["checksum"],
        decision: "apply_selected"
      });
      expect(applied).toMatchObject({ ok: true, value: { status: "executing_model" } });
    };

    const createdFileChangeSet = await waitForPendingChangeSet(
      { kind: "create_file", relativePath: "created.txt" },
      {
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
        ])
      }
    );
    expect(await readFile(sourcePath, "utf8")).toBe(source);
    expect(await readFile(obsoletePath, "utf8")).toBe(obsolete);
    expect(await readdir(projectRoot)).not.toContain("created.txt");
    expect(await readdir(projectRoot)).not.toContain("assets");
    expect(await readdir(join(projectRoot, "chapters"))).toEqual([]);
    await expect(readFile(storyBiblePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await applyPendingChangeSet(createdFileChangeSet, "apply-desktop-v2-create-file");
    await applyPendingChangeSet(
      await waitForPendingChangeSet({ kind: "create_directory", relativePath: "assets" }),
      "apply-desktop-v2-create-directory"
    );
    await applyPendingChangeSet(
      await waitForPendingChangeSet({
        kind: "move_file",
        sourcePath: "draft.md",
        targetPath: "moved.md"
      }),
      "apply-desktop-v2-move-file"
    );
    await applyPendingChangeSet(
      await waitForPendingChangeSet({ kind: "delete_file", relativePath: "obsolete.txt" }),
      "apply-desktop-v2-delete-file"
    );
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

  test.each([
    {
      label: "edit",
      toolName: "edit_text",
      argumentsFor: (assetId: string, content: string) => ({
        ref: `file:foreshadows/${assetId}.json`,
        baseHash: sha256(content),
        range: { unit: "character", start: 0, end: content.length },
        replacement: content
      })
    },
    {
      label: "create",
      toolName: "create_resource",
      argumentsFor: (assetId: string) => ({
        kind: "file",
        path: `foreshadows/${assetId}-new.json`,
        content: "{}\n"
      })
    },
    {
      label: "move",
      toolName: "manage_path",
      argumentsFor: (assetId: string, content: string) => ({
        operation: "move_file",
        sourceRef: `file:foreshadows/${assetId}.json`,
        targetPath: "notes/moved.json",
        baseHash: sha256(content)
      })
    },
    {
      label: "delete",
      toolName: "manage_path",
      argumentsFor: (assetId: string, content: string) => ({
        operation: "delete_file",
        ref: `file:foreshadows/${assetId}.json`,
        baseHash: sha256(content)
      })
    },
    {
      label: "create directory",
      toolName: "manage_path",
      argumentsFor: () => ({
        operation: "create_directory",
        path: "foreshadows/nested"
      })
    }
  ])("rejects writing generic file $label operations on managed foreshadows", async (input) => {
    const projectRoot = await mkdtemp(
      join(tmpdir(), `novel-studio-desktop-writing-managed-${input.label.replace(" ", "-")}-`)
    );
    roots.push(projectRoot);
    const repository = new StoryBibleFileRepository({ projectRoot });
    const timestamp = "2026-07-30T00:00:00.000Z";
    const assetId = `fsh_${"b".repeat(32)}`;
    expect(
      await repository.saveStoryAsset({
        schemaVersion: "1.0",
        id: assetId,
        type: "foreshadow",
        title: "Managed clue",
        status: "active",
        summary: "This clue must stay managed.",
        createdAt: timestamp,
        updatedAt: timestamp,
        details: { trackingStatus: "planned", origin: "manual" }
      })
    ).toMatchObject({ ok: true });
    const assetPath = join(projectRoot, "foreshadows", `${assetId}.json`);
    const content = await readFile(assetPath, "utf8");
    const runId = `run-desktop-writing-managed-${input.label.replace(" ", "-")}`;
    const lockOwnerId = `${runId}-lock`;
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: lockOwnerId });
    expect(await lock.acquireProjectLock()).toMatchObject({ ok: true });
    let round = 0;
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      projectLockOwnerId: lockOwnerId,
      createRunId: () => runId,
      featureFlags: createAgentFeatureFlags({
        phaseB_fileLifecycleEnabled: true,
        revision: `${runId}-features`
      }),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall(
              `managed-${input.label.replace(" ", "-")}`,
              input.toolName,
              input.argumentsFor(assetId, content)
            );
          } else {
            yield runtimeToolCall(`finish-managed-${input.label.replace(" ", "-")}`, "finish", {
              summary: "Managed generic path rejected."
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("writing"));

    await vi.waitFor(
      async () => {
        expect(await session.readAgentRun(runId)).toMatchObject({
          ok: true,
          value: {
            snapshot: { status: "completed", contextMode: "writing" },
            events: expect.arrayContaining([
              expect.objectContaining({
                type: "tool_failed",
                detail: expect.objectContaining({
                  toolCallId: `managed-${input.label.replace(" ", "-")}`,
                  code: "CREATIVE_PROJECT_FILE_PATH_REJECTED"
                })
              })
            ])
          }
        });
      },
      { timeout: 10_000 }
    );
    const rejected = await session.readAgentRun(runId);
    expect(rejected).not.toMatchObject({ value: { changeSet: expect.anything() } });
    expect(await readFile(assetPath, "utf8")).toBe(content);
    await expect(
      readFile(join(projectRoot, "foreshadows", `${assetId}-new.json`), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(projectRoot, "notes", "moved.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readdir(join(projectRoot, "foreshadows", "nested"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("rejects managed creative reads and directory lists before repository execution", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-managed-reads-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await mkdir(join(projectRoot, "foreshadows"), { recursive: true });
    await writeFile(join(projectRoot, "foreshadows", "clue.json"), "managed clue\n", "utf8");
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
            yield runtimeToolCall("read-managed-foreshadow", "read_resource", {
              ref: "file:foreshadows/clue.json"
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
            expect(toolPayload).not.toContain("managed clue");
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
                toolCallId: "read-managed-foreshadow",
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

  test("routes writing search through the complete creative index", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-writing-search-"));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    const storyBible = new StoryBibleFileRepository({ projectRoot });
    expect(
      await storyBible.saveStoryAsset({
        schemaVersion: "1.0",
        id: "chr_search",
        type: "character",
        title: "林砚",
        status: "active",
        summary: "writingsearchneedle 调查旧港失踪案",
        details: { role: "记者" },
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z"
      })
    ).toMatchObject({ ok: true });
    let round = 0;
    let observedToolPayload = "";
    const session = createDesktopRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      activeChapterId: "chapter-unused",
      createRunId: () => "run-desktop-writing-search",
      featureFlags: createAgentFeatureFlags({
        phaseA_searchEnabled: true,
        revision: "desktop-writing-search-test"
      }),
      modelDriver: {
        async *streamRound(input) {
          round += 1;
          if (round === 1) {
            yield runtimeToolCall("search-writing-story", "search_project", {
              mode: "text",
              query: "writingsearchneedle",
              maxResults: 10
            });
          } else {
            observedToolPayload = input.messages
              .filter((message) => message.role === "tool")
              .map((message) => message.content)
              .join("\n");
            yield runtimeToolCall("finish-writing-search", "finish", { summary: "Found." });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    await session.startAgentRun(executionCommand("writing"));

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run-desktop-writing-search")).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed", contextMode: "writing" } }
      });
    });
    expect(observedToolPayload).toContain("characters/chr_search.json");
    expect(observedToolPayload).toContain("story_bible:chr_search");
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

  test("guards Desktop read results before execution and refreshes the send manifest after approval", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-desktop-jit-sharing-"));
    roots.push(projectRoot);
    const readContent = "JIT protected project content.\n";
    const sharingDefaultsRevision = "a".repeat(64);
    await mkdir(join(projectRoot, "notes"), { recursive: true });
    await writeFile(join(projectRoot, "notes", "jit.md"), readContent, "utf8");
    let readerCalls = 0;
    let modelRounds = 0;

    const runtime = runtimeExports.createDesktopAgentRuntime({
      workspaceKind: "creativeProject",
      projectId: "project-01",
      contentRoot: projectRoot,
      stateRoot: projectRoot,
      featureFlags: createAgentFeatureFlags({
        agentGuidanceV3: true,
        revision: "desktop-jit-sharing-test"
      }),
      sharingDefaults: {
        outlineMetadata: "automatic",
        activeResource: "automatic",
        conversationSummary: "ask",
        toolReadResults: "ask"
      },
      sharingDefaultsRevision,
      verifyCreativeGeneralActiveResource: async () => ok(undefined),
      resolveModelStartFacts: async () => ({
        profileId: "profile-desktop-jit-sharing",
        provider: "demo",
        modelName: "desktop-jit-sharing-model",
        capabilities: {
          streaming: true,
          toolCalling: true,
          structuredArguments: true,
          contextWindow: 128000
        },
        requiredContextTokens: 8000,
        reasoningStrength: { status: "hidden" as const, reason: "test model" }
      }),
      readCreativeProjectFile: async (relativePath: string) => {
        readerCalls += 1;
        return ok({
          schemaVersion: "1.0" as const,
          projectId: "project-01",
          workspaceId: "project-01",
          path: relativePath,
          content: readContent,
          checksum: sha256(readContent),
          byteLength: Buffer.byteLength(readContent, "utf8"),
          nodeRevision: "jit-reader-node-1"
        });
      },
      modelDriver: {
        async *streamRound(input) {
          modelRounds += 1;
          if (modelRounds === 1) {
            yield runtimeToolCall("desktop-jit-read", "read_resource", {
              ref: "file:notes/jit.md"
            });
          } else {
            const evidenceRef = `run-event/${String(
              input.snapshot.lastSequence
            )}/tool_completed/desktop-jit-read`;
            yield runtimeToolCall("desktop-jit-finish", "finish", {
              outcome: "completed",
              report: {
                result: "JIT sharing approval completed.",
                appliedChanges: [],
                verification: [evidenceRef],
                residualRisks: []
              },
              evidenceRefs: [evidenceRef]
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      }
    });

    const conversation = await runtime.agentConversationSession.createConversation({
      projectId: "project-01",
      commandId: "create-desktop-jit-sharing-conversation"
    });
    expect(conversation).toMatchObject({ ok: true });
    if (!conversation.ok) return;
    const prepared = await runtime.agentRunDraftSession.syncStartDraft({
      projectId: "project-01",
      conversationId: conversation.value.conversationId,
      commandId: "prepare-desktop-jit-sharing",
      userRequest: "Read the protected project file.",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      modelProfileId: "profile-desktop-jit-sharing",
      contextRefs: []
    });
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) return;

    const packedPreview = await previewDraftStart(
      runtime,
      prepared.value,
      "preview-desktop-jit-sharing-context"
    );
    const preview = await runtime.prepareAgentSendPreview({
      schemaVersion: "2.0",
      commandId: "prepare-desktop-jit-sharing-send",
      startCommand: {
        ...packedPreview.command,
        commandId: "start-desktop-jit-sharing"
      }
    });
    expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true });
    if (!preview.ok) return;

    const confirmed = await runtime.confirmAgentSendPreview({
      schemaVersion: "2.0",
      previewId: preview.value.previewId,
      canonicalPayloadChecksum: preview.value.canonicalPayloadChecksum
    });
    expect(confirmed).toMatchObject({ ok: true });
    if (!confirmed.ok) return;
    const runId = confirmed.value.runId;

    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun(runId);
      if (read.ok && read.value.snapshot.status === "failed") {
        throw new Error("Desktop JIT run unexpectedly failed");
      }
      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "awaiting_context_share_approval",
            pending: { kind: "context_share_approval", requestId: expect.any(String) }
          },
          pendingContextShareApproval: {
            resultKind: "tool:read_resource",
            toolCallId: "desktop-jit-read"
          }
        }
      });
    });
    expect(readerCalls).toBe(0);

    const pendingRead = await runtime.agentRunSession.readAgentRun(runId);
    expect(pendingRead).toMatchObject({ ok: true });
    if (!pendingRead.ok || pendingRead.value.pendingContextShareApproval === undefined) return;
    const pending = pendingRead.value.pendingContextShareApproval;
    const approved = await runtime.agentRunSession.decideContextShareApproval({
      projectId: "project-01",
      runId,
      commandId: "approve-desktop-jit-sharing",
      expectedRunRevision: pendingRead.value.snapshot.runRevision,
      requestId: pending.approvalBinding,
      approvalBinding: pending.approvalBinding,
      decision: "approve"
    });
    expect(approved).toMatchObject({ ok: true });

    await vi.waitFor(async () => {
      const read = await runtime.agentRunSession.readAgentRun(runId);
      if (read.ok && read.value.snapshot.status === "failed") {
        throw new Error("Desktop JIT run unexpectedly failed");
      }
      expect(read).toMatchObject({
        ok: true,
        value: { snapshot: { status: "completed" } }
      });
    });
    expect(readerCalls).toBe(1);
    expect(modelRounds).toBe(2);

    const ledgerRepository = new AgentSendLedgerFileRepository({ projectRoot });
    const ledger = await ledgerRepository.readEntries(runId);
    expect(ledger).toMatchObject({ ok: true });
    if (!ledger.ok) return;
    expect(ledger.value).toHaveLength(2);
    const firstManifest = JSON.parse(ledger.value[0].canonicalRoundManifestJson) as {
      readonly sharing: { readonly runGrantRevision: string };
    };
    const secondManifest = JSON.parse(ledger.value[1].canonicalRoundManifestJson) as {
      readonly sharing: { readonly runGrantRevision: string };
    };
    expect(secondManifest.sharing.runGrantRevision).not.toBe(
      firstManifest.sharing.runGrantRevision
    );
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

interface DraftStartView {
  readonly runDraft: {
    readonly runDraftId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly conversationId: string;
  };
}

function draftOnlyStartCommand(
  projectId: string,
  view: DraftStartView,
  commandId: string,
  preview?: { readonly packedContextId: string; readonly payloadChecksum: string }
) {
  return {
    projectId,
    conversationId: view.runDraft.conversationId,
    commandId,
    expectedRunRevision: 0 as const,
    runDraftId: view.runDraft.runDraftId,
    runDraftRevision: view.runDraft.revision,
    runDraftChecksum: view.runDraft.checksum,
    ...(preview === undefined
      ? {}
      : {
          packedContextId: preview.packedContextId,
          packedContextPayloadChecksum: preview.payloadChecksum
        })
  };
}

async function previewDraftStart(
  runtime: ReturnType<typeof runtimeExports.createDesktopAgentRuntime>,
  view: DraftStartView,
  commandId: string
) {
  const preview = await runtime.agentContextSession.previewPackedContext({
    projectId: runtime.workspaceId,
    conversationId: view.runDraft.conversationId,
    commandId: `${commandId}-context-preview`,
    runDraftId: view.runDraft.runDraftId,
    expectedDraftRevision: view.runDraft.revision,
    runDraftChecksum: view.runDraft.checksum
  });
  expect(preview, JSON.stringify(preview)).toMatchObject({ ok: true });
  if (!preview.ok) throw preview.error;
  return {
    preview: preview.value,
    command: draftOnlyStartCommand(runtime.workspaceId, view, commandId, preview.value)
  };
}

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

function messagesBoundToChecksums(
  messages: readonly { readonly role: string; readonly content: string }[],
  checksums: readonly string[]
) {
  const expected = new Set(checksums);
  return messages
    .map((message) => ({ ...message, checksum: sha256(message.content) }))
    .filter((message) => expected.has(message.checksum));
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function statusAssetContent(
  assetId: string,
  status: "active" | "draft" | "archived" | "deleted",
  revision: number
): string {
  return `${JSON.stringify({
    schemaVersion: "1.1",
    id: assetId,
    type: "character",
    status,
    revision
  })}\n`;
}

function storyBibleStatusCandidate(
  asset: StoryBibleV11Asset,
  status: "active" | "draft" | "archived" | "deleted"
) {
  return {
    schemaVersion: asset.schemaVersion,
    id: asset.id,
    type: asset.type,
    title: asset.title,
    status,
    summary: asset.summary,
    aliases: [...asset.aliases],
    relations: [...asset.relations],
    details: asset.details,
    extensions: asset.extensions,
    createdAt: asset.createdAt
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
    errorId: "err_desktop_agent_lifecycle_test",
    code,
    category: "StorageError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Fix the lifecycle test setup.",
    traceId: "desktop-agent-run-runtime-test"
  };
}
