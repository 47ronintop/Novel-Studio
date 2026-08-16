import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

function strictStartInput(
  overrides: Partial<engineExports.ResolvedAgentRunStartInput> = {}
): engineExports.ResolvedAgentRunStartInput {
  return {
    projectId: "project_01",
    conversationId: "conversation_v20",
    commandId: "start_v20",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    userRequest: "Run the strict contract.",
    providerCapabilitySnapshot: {
      profileId: "model_01",
      provider: "openai-compatible",
      modelName: "tool-model",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 32_000,
      requiredContextTokens: 8_000
    },
    toolFacadeVersion: "v2",
    toolCatalogRevision: "catalog-v20-r1",
    profileVersion: "3.0",
    guidanceTemplateChecksum: "d".repeat(64),
    cachePrefixChecksum: "e".repeat(64),
    promptCacheIdentityBaseChecksum: "f".repeat(64),
    promptCacheIdentityChecksum: "0".repeat(64),
    runV20: {
      schemaVersion: "2.0",
      providerSemanticVersionSetChecksum: "a".repeat(64),
      authorityRegistryKey: "writing.execution.3.0",
      materializedGuidanceChecksum: "b".repeat(64),
      toolCatalogChecksum: "c".repeat(64),
      effectiveCapabilityRevision: 1
    },
    ...overrides
  };
}

describe("Agent Run Coordinator", () => {
  test("enforces revisions, command idempotency, one active run, and one terminal event", () => {
    const factory = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunCoordinator"
    ];
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") {
      return;
    }

    const coordinator = factory({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_01"
    }) as {
      startRun(input: Record<string, unknown>): unknown;
      stopRun(input: Record<string, unknown>): unknown;
      recordRunEvent(input: Record<string, unknown>): unknown;
      readEvents(runId: string): readonly Record<string, unknown>[];
    };
    const startCommand = {
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "command_start_01",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Plan a continuity revision.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    };

    const started = coordinator.startRun(startCommand);
    expect(started).toMatchObject({
      ok: true,
      value: {
        runId: "run_01",
        projectId: "project_01",
        conversationId: "conv_01",
        status: "planning_model",
        runRevision: 1,
        lastSequence: 1,
        limits: {
          maxModelRounds: 20,
          maxToolCalls: 50,
          maxConsecutiveToolFailures: 3
        }
      }
    });
    expect(coordinator.startRun(startCommand)).toEqual(started);

    const { conversationId: _conversationId, ...missingConversation } = startCommand;
    void _conversationId;
    expect(
      coordinator.startRun({
        ...missingConversation,
        commandId: "command_start_missing_conversation"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONVERSATION_ID_INVALID" }
    });

    expect(
      coordinator.recordRunEvent({
        runId: "run_01",
        status: "executing_read_tool",
        type: "tool_started",
        detail: { toolCallId: "tool_01", toolName: "read_chapter", summary: "Read chapter 3" }
      })
    ).toMatchObject({
      ok: true,
      value: { status: "executing_read_tool", runRevision: 2, lastSequence: 2 }
    });

    expect(
      coordinator.startRun({
        ...startCommand,
        commandId: "command_start_02"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_ALREADY_ACTIVE" }
    });

    expect(
      coordinator.stopRun({
        runId: "run_01",
        projectId: "project_01",
        commandId: "command_stop_stale",
        expectedRunRevision: 0
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_REVISION_CONFLICT" },
      latestSnapshot: { runRevision: 2 }
    });

    const stopped = coordinator.stopRun({
      runId: "run_01",
      projectId: "project_01",
      commandId: "command_stop_01",
      expectedRunRevision: 2
    });
    expect(stopped).toMatchObject({
      ok: true,
      value: { status: "cancelled", runRevision: 3, lastSequence: 3 }
    });
    expect(
      coordinator.stopRun({
        runId: "run_01",
        projectId: "project_01",
        commandId: "command_stop_01",
        expectedRunRevision: 2
      })
    ).toEqual(stopped);
    expect(coordinator.readEvents("run_01")).toMatchObject([
      { sequence: 1, type: "run_started" },
      { sequence: 2, type: "tool_started" },
      { sequence: 3, type: "run_cancelled" }
    ]);
  });

  test("authors a scope-aware v1.3 snapshot and v1.3 events", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_v11"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "command_start_v11",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      userRequest: "Author a v1.1 run.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // The coordinator authors a complete v1.1 literal, not a v1.0 shape normalized later.
    expect(started.value).toMatchObject({
      schemaVersion: "1.3",
      modelProfileId: "model_01",
      permissionSummaryId: null,
      contextBudgetSnapshotId: null,
      activeCompactionId: null,
      planExecutionId: null,
      planExecutionRevision: null,
      activeErrorId: null,
      recoveryState: "none",
      usageSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0, usageStatus: "missing" }
    });
    expect(coordinator.readEvents("run_v11")[0]).toMatchObject({
      schemaVersion: "1.3",
      type: "run_started"
    });
  });

  test("requires a persisted write event before completed reports claim applied changes", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_finish_evidence"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_finish_evidence",
      commandId: "command_start_finish_evidence",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Apply a verified edit.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const checksum = "a".repeat(64);
    const writeEvidenceRef = engineExports.formatWriteAppliedEvidenceRef({
      sequence: started.value.lastSequence + 1,
      changeSetId: "change-set-01",
      revision: 2,
      checksum
    });
    const report = {
      outcome: "completed" as const,
      report: {
        result: "Applied the edit.",
        appliedChanges: [writeEvidenceRef],
        verification: ["not-run: no verification tool was available"],
        residualRisks: []
      },
      evidenceRefs: [writeEvidenceRef]
    };
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_01",
        commandId: "finish-without-write-evidence",
        expectedRunRevision: started.value.runRevision,
        finishReport: report
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_EVIDENCE_MISSING" } });

    const write = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "write_applied",
      detail: { changeSetId: "change-set-01", revision: 2, checksum }
    });
    expect(write).toMatchObject({
      ok: true,
      value: { runRevision: started.value.runRevision + 1 }
    });
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_01",
        commandId: "finish-with-write-evidence",
        expectedRunRevision: started.value.runRevision + 1,
        finishReport: report
      })
    ).toMatchObject({
      ok: true,
      value: { status: "completed", finishReport: { outcome: "completed" } }
    });
  });

  test("rejects a write from another Change Set, forged verification, and project mismatch", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      createRunId: () => "run_finish_mismatch"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_finish_mismatch",
      commandId: "start_finish_mismatch",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      userRequest: "Apply one edit.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "demo",
        modelName: "model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32000,
        requiredContextTokens: 8000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const actualChecksum = "b".repeat(64);
    const write = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "write_applied",
      detail: { changeSetId: "actual-change", revision: 1, checksum: actualChecksum }
    });
    expect(write.ok).toBe(true);
    if (!write.ok) return;
    const forgedWrite = engineExports.formatWriteAppliedEvidenceRef({
      sequence: write.value.lastSequence,
      changeSetId: "other-change",
      revision: 1,
      checksum: actualChecksum
    });
    const baseReport = {
      outcome: "completed" as const,
      report: {
        result: "Done.",
        appliedChanges: [forgedWrite],
        verification: ["not-run: unavailable"],
        residualRisks: []
      },
      evidenceRefs: [forgedWrite]
    };
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_01",
        commandId: "wrong-write",
        expectedRunRevision: write.value.runRevision,
        finishReport: baseReport
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_EVIDENCE_MISSING" } });

    const actualWrite = engineExports.formatWriteAppliedEvidenceRef({
      sequence: write.value.lastSequence,
      changeSetId: "actual-change",
      revision: 1,
      checksum: actualChecksum
    });
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_01",
        commandId: "forged-verification",
        expectedRunRevision: write.value.runRevision,
        finishReport: {
          ...baseReport,
          report: {
            ...baseReport.report,
            appliedChanges: [actualWrite],
            verification: ["run-event/999/tool_completed/fake"]
          },
          evidenceRefs: [actualWrite]
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_VERIFICATION_UNPROVEN" } });
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_02",
        commandId: "wrong-project",
        expectedRunRevision: write.value.runRevision,
        finishReport: {
          ...baseReport,
          report: { ...baseReport.report, appliedChanges: [actualWrite] },
          evidenceRefs: [actualWrite]
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_CONTEXT_SCOPE_INVALID" } });
  });

  test("requires recordFinish for strict execution terminals and rejects mismatched hydration", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_strict_finish"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_strict_finish",
      commandId: "command_start_strict_finish",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Finish with evidence.",
      finishContractVersion: "2.0",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    expect(
      coordinator.recordRunEvent({
        runId: started.value.runId,
        status: "executing_model",
        type: "run_completed"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_REQUIRED" } });
    expect(
      coordinator.recordRunEvent({
        runId: started.value.runId,
        status: "executing_model",
        type: "assistant_text_completed",
        snapshotPatch: {
          finishReport: {
            outcome: "completed",
            report: {
              result: "Forged report.",
              appliedChanges: [],
              verification: ["not-run: forged"],
              residualRisks: []
            },
            evidenceRefs: ["run-event/1/completion_evidence_recorded/forged"]
          }
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_REQUIRED" } });

    expect(
      coordinator.recordRunEvent({
        runId: started.value.runId,
        status: "completed",
        type: "run_completed"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_REQUIRED" } });
    expect(
      coordinator.recordRunEvent({
        runId: started.value.runId,
        status: "blocked",
        type: "run_blocked"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_REQUIRED" } });

    const failedRun = engineExports.createAgentRunCoordinator({
      createRunId: () => "run_strict_failure"
    });
    const failureStarted = failedRun.startRun({
      projectId: "project_01",
      conversationId: "conversation_01",
      commandId: "start-strict-failure",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Fail safely.",
      finishContractVersion: "2.0",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(failureStarted.ok).toBe(true);
    if (!failureStarted.ok) return;
    expect(
      failedRun.recordRunEvent({
        runId: failureStarted.value.runId,
        status: "failed",
        type: "run_failed",
        detail: { code: "AGENT_CAPABILITY_CHANGED" }
      })
    ).toMatchObject({ ok: true, value: { status: "failed" } });

    const verified = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "tool_completed",
      detail: { toolCallId: "read-verification", toolName: "read_resource" }
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const verificationRef = engineExports.formatToolCompletionEvidenceRef({
      sequence: verified.value.lastSequence,
      toolCallId: "read-verification"
    });
    const finished = coordinator.recordFinish({
      runId: started.value.runId,
      projectId: "project_01",
      commandId: "strict-finish",
      expectedRunRevision: verified.value.runRevision,
      finishReport: {
        outcome: "completed",
        report: {
          result: "Read-only verification is complete.",
          appliedChanges: [],
          verification: [verificationRef],
          residualRisks: []
        },
        evidenceRefs: [verificationRef]
      }
    });
    expect(finished).toMatchObject({ ok: true, value: { status: "completed" } });
    if (!finished.ok) return;

    const events = coordinator.readEvents(started.value.runId);
    const tampered = { ...finished.value, status: "blocked" as const };
    const restored = engineExports.createAgentRunCoordinator();
    expect(restored.restoreRun(tampered, events)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RESTORE_INVALID" }
    });
    const finishReport = finished.value.finishReport;
    if (finishReport === undefined || finishReport === null) return;
    const tamperedEvidence = {
      ...finished.value,
      finishReport: {
        ...finishReport,
        schemaVersion: "2.0" as const,
        evidenceRefs: ["run-event/999/tool_completed/fake"]
      }
    };
    expect(restored.restoreRun(tamperedEvidence, events)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RESTORE_INVALID" }
    });
    const terminalEvent = events.at(-1);
    if (terminalEvent === undefined) return;
    const tamperedEventReport = [
      ...events.slice(0, -1),
      {
        ...terminalEvent,
        detail: {
          finishReport: {
            ...finishReport,
            report: { ...finishReport.report, result: "Different terminal event report." }
          }
        } as unknown as typeof terminalEvent.detail
      } as typeof terminalEvent
    ];
    expect(restored.restoreRun(finished.value, tamperedEventReport)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RESTORE_INVALID" }
    });
    const missingReport = { ...finished.value, finishReport: null };
    expect(restored.restoreRun(missingReport, events)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RESTORE_INVALID" }
    });
  });

  test("binds a server-created plan execution pointer at execution run start", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-17T00:00:00.000Z",
      createRunId: () => "run_execution"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "command_execution",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Execute an approved plan.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      },
      sourcePlanId: "plan_01",
      sourcePlanRevision: 2,
      planExecutionId: "execution_01",
      planExecutionRevision: 1
    });

    expect(started).toMatchObject({
      ok: true,
      value: { planExecutionId: "execution_01", planExecutionRevision: 1 }
    });
  });

  test("carries a Stage 5 snapshot patch and status through recordRunEvent", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_patch"
    });
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_01",
      commandId: "command_start_patch",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Patch Stage 5 pointers.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const patched = coordinator.recordRunEvent({
      runId: "run_patch",
      status: "context_compacting",
      type: "context_compaction_started",
      snapshotPatch: {
        activeCompactionId: "compaction_01",
        contextBudgetSnapshotId: "budget_01",
        recoveryState: "retryable"
      }
    });
    expect(patched).toMatchObject({
      ok: true,
      value: {
        status: "context_compacting",
        activeCompactionId: "compaction_01",
        contextBudgetSnapshotId: "budget_01",
        recoveryState: "retryable"
      }
    });
  });

  test("normalizes legacy snapshots without a conversation id to null", () => {
    const source = engineExports.createAgentRunCoordinator({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_legacy"
    });
    const started = source.startRun({
      projectId: "project_01",
      conversationId: "conv_legacy_source",
      commandId: "command_start_legacy",
      expectedRunRevision: 0,
      operationMode: "planning",
      contextMode: "writing",
      userRequest: "Restore an old run.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const { conversationId: _conversationId, ...legacySnapshot } = started.value;
    void _conversationId;

    const restored = engineExports
      .createAgentRunCoordinator()
      .restoreRun(legacySnapshot as typeof started.value, source.readEvents(started.value.runId));

    expect(restored).toMatchObject({
      ok: true,
      value: { runId: "run_legacy", conversationId: null }
    });
  });

  test("appends undo audit events after termination without changing the terminal status", () => {
    const factory = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunCoordinator"
    ];
    expect(typeof factory).toBe("function");
    if (typeof factory !== "function") return;

    const coordinator = factory({
      now: () => "2026-07-13T00:00:00.000Z",
      createRunId: () => "run_terminal_audit"
    }) as {
      startRun(input: Record<string, unknown>): { readonly ok: boolean };
      recordRunEvent(input: Record<string, unknown>): unknown;
      recordTerminalAuditEvent?: (input: Record<string, unknown>) => unknown;
      readEvents(runId: string): readonly Record<string, unknown>[];
    };
    const started = coordinator.startRun({
      projectId: "project_01",
      conversationId: "conv_terminal_audit",
      commandId: "command_start_terminal_audit",
      expectedRunRevision: 0,
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      userRequest: "Apply and audit an undo.",
      providerCapabilitySnapshot: {
        profileId: "model_01",
        provider: "openai-compatible",
        modelName: "tool-model",
        streaming: true,
        toolCalling: true,
        structuredArguments: true,
        contextWindow: 32_000,
        requiredContextTokens: 8_000
      }
    });
    expect(started).toMatchObject({ ok: true });
    expect(
      coordinator.recordRunEvent({
        runId: "run_terminal_audit",
        status: "completed",
        type: "run_completed"
      })
    ).toMatchObject({
      ok: true,
      value: { status: "completed", runRevision: 2, lastSequence: 2 }
    });

    expect(typeof coordinator.recordTerminalAuditEvent).toBe("function");
    if (coordinator.recordTerminalAuditEvent === undefined) return;
    expect(
      coordinator.recordTerminalAuditEvent({
        runId: "run_terminal_audit",
        type: "run_undo_started",
        detail: { commandId: "command_undo_terminal_audit" }
      })
    ).toMatchObject({
      ok: true,
      value: { status: "completed", runRevision: 3, lastSequence: 3 }
    });
    expect(
      coordinator.recordTerminalAuditEvent({
        runId: "run_terminal_audit",
        type: "run_undone",
        detail: { versionGroupId: "version_group_undo" }
      })
    ).toMatchObject({
      ok: true,
      value: { status: "completed", runRevision: 4, lastSequence: 4 }
    });
    expect(
      coordinator.recordRunEvent({
        runId: "run_terminal_audit",
        status: "completed",
        type: "assistant_text_completed"
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ALREADY_TERMINAL" } });
    expect(coordinator.readEvents("run_terminal_audit")).toMatchObject([
      { sequence: 1, type: "run_started" },
      { sequence: 2, type: "run_completed" },
      { sequence: 3, type: "run_undo_started" },
      { sequence: 4, type: "run_undone" }
    ]);
    expect(
      coordinator
        .readEvents("run_terminal_audit")
        .filter((event) => event["type"] === "run_completed")
    ).toHaveLength(1);
  });

  test("authors native V20 state/event pairs only when strict start facts are present", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:00.000Z",
      createRunId: () => "run_native_v20"
    });
    const started = coordinator.startRun(strictStartInput());
    expect(started).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "2.0",
        finishContractVersion: "2.0",
        executionWritePolicyDraft: "write_before_confirmation",
        providerSemanticVersionSetChecksum: "a".repeat(64),
        authority: { contractVersion: "2.0", registryKey: "writing.execution.3.0" },
        catalog: { contractVersion: "2.0", facadeVersion: "v2", revision: "catalog-v20-r1" },
        capabilities: { contractVersion: "2.0", revision: 1, state: "active" },
        pending: { kind: "none" },
        finish: { state: "not_finished", report: null }
      }
    });
    expect(coordinator.readEvents("run_native_v20")).toMatchObject([
      { schemaVersion: "2.0", sequence: 1, runRevision: 1, type: "run_started" }
    ]);
    if (!started.ok) return;
    expect(
      engineExports.validateAgentRunHistoryV20({
        snapshot: started.value,
        events: coordinator.readEvents(started.value.runId)
      }).ok
    ).toBe(true);

    const planningFacts = strictStartInput().runV20;
    expect(planningFacts).toBeDefined();
    if (planningFacts === undefined) return;
    const planning = engineExports
      .createAgentRunCoordinator({
        createRunId: () => "run_planning_v20"
      })
      .startRun(
        strictStartInput({
          commandId: "start_planning_v20",
          operationMode: "planning",
          runV20: { ...planningFacts }
        })
      );
    expect(planning).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_V20_EXECUTION_POLICY_DRAFT_REQUIRED" }
    });

    const {
      runV20: _strictFacts,
      toolCatalogRevision: _strictCatalogRevision,
      ...legacyStart
    } = strictStartInput();
    void _strictFacts;
    void _strictCatalogRevision;
    const legacy = engineExports
      .createAgentRunCoordinator({
        createRunId: () => "run_legacy_after_v20"
      })
      .startRun({
        ...legacyStart,
        commandId: "start_legacy_after_v20",
        toolFacadeVersion: "v1"
      });
    expect(legacy).toMatchObject({ ok: true, value: { schemaVersion: "1.3" } });
  });

  test("keeps active Change Sets separate from V20 pending approval and round-trips full tool approval", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:00.000Z",
      createRunId: () => "run_pending_v20"
    });
    const started = coordinator.startRun(strictStartInput());
    expect(started.ok).toBe(true);
    if (!started.ok || started.value.schemaVersion !== "2.0") return;
    const checksum = "1".repeat(64);
    const ready = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "awaiting_write_approval",
      type: "change_set_ready",
      snapshotPatch: {
        pendingChangeSetId: "change_set_01",
        pendingChangeSetRevision: 1,
        pendingChangeSetChecksum: checksum
      },
      detail: { changeSetId: "change_set_01", revision: 1, checksum }
    });
    expect(ready).toMatchObject({
      ok: true,
      value: { pending: { kind: "write_approval", changeSetId: "change_set_01" } }
    });
    if (!ready.ok) return;
    const applying = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "applying_changes",
      type: "approval_resolved",
      detail: { changeSetId: "change_set_01", revision: 1, checksum, decision: "apply_selected" }
    });
    expect(applying).toMatchObject({
      ok: true,
      value: {
        pendingChangeSetId: "change_set_01",
        pending: { kind: "none" },
        status: "applying_changes"
      }
    });
    if (!applying.ok) return;
    const resumed = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "write_applied",
      snapshotPatch: {
        pendingChangeSetId: null,
        pendingChangeSetRevision: null,
        pendingChangeSetChecksum: null,
        versionGroupId: "version_group_01"
      },
      detail: {
        changeSetId: "change_set_01",
        revision: 1,
        checksum,
        versionGroupId: "version_group_01"
      }
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    const approval: engineExports.PendingToolApproval = {
      binding: {
        kind: "task",
        bindingId: "binding_01",
        runId: started.value.runId,
        runRevision: resumed.value.runRevision,
        toolCallId: "tool_call_01",
        taskId: "task_01",
        snapshotDigest: "2".repeat(64),
        parametersDigest: "3".repeat(64),
        catalogRevision: "catalog-v20-r1",
        attestationRef: "attestation_01",
        executionSnapshotId: "execution_snapshot_01",
        effectiveCapabilityRevision: 1,
        expiresAt: "2026-08-04T00:05:00.000Z"
      },
      canonicalToolId: "run_task",
      providerToolName: "run_task",
      argumentsText: "{}",
      requestedAt: "2026-08-04T00:00:00.000Z"
    };
    const requested = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "awaiting_tool_approval",
      type: "tool_approval_requested",
      snapshotPatch: { pendingToolApproval: approval },
      detail: {
        toolCallId: "tool_call_01",
        binding: approval.binding as unknown as Record<string, never>
      }
    });
    expect(requested).toMatchObject({
      ok: true,
      value: { pending: { kind: "tool_approval", approval }, pendingToolApproval: approval }
    });
    if (!requested.ok) return;
    const resolved = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "tool_approval_resolved",
      snapshotPatch: { pendingToolApproval: null },
      detail: { toolCallId: "tool_call_01", bindingId: "binding_01", decision: "approve" }
    });
    expect(resolved).toMatchObject({
      ok: true,
      value: { pending: { kind: "none" }, pendingToolApproval: null }
    });
    if (!resolved.ok) return;
    expect(
      engineExports.validateAgentRunHistoryV20({
        snapshot: resolved.value,
        events: coordinator.readEvents(started.value.runId)
      }).ok
    ).toBe(true);
  });

  test("accepts the namespaced idempotency key used by external tool approvals", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:00.000Z",
      createRunId: () => "run_external_approval_v20"
    });
    const started = coordinator.startRun(strictStartInput());
    expect(started.ok).toBe(true);
    if (!started.ok || started.value.schemaVersion !== "2.0") return;

    const approval: engineExports.PendingToolApproval = {
      binding: {
        kind: "external",
        bindingId: "binding_external_01",
        runId: started.value.runId,
        runRevision: started.value.runRevision,
        toolCallId: "external_call_01",
        sourceId: "trusted",
        descriptorDigest: "2".repeat(64),
        argumentDigest: "3".repeat(64),
        idempotencyKey: `agent:${started.value.runId}:external_call_01:${"4".repeat(24)}`,
        effectiveCapabilityRevision: 1,
        expiresAt: "2026-08-04T00:05:00.000Z"
      },
      canonicalToolId: "mcp:trusted/send_message",
      providerToolName: "mcp__trusted__send_message",
      argumentsText: '{"message":"hello"}',
      requestedAt: "2026-08-04T00:00:00.000Z"
    };
    const requested = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "awaiting_tool_approval",
      type: "tool_approval_requested",
      snapshotPatch: { pendingToolApproval: approval },
      detail: {
        toolCallId: approval.binding.toolCallId,
        binding: approval.binding as unknown as Record<string, never>
      }
    });

    expect(requested).toMatchObject({
      ok: true,
      value: { pendingToolApproval: approval }
    });
  });

  test("allows evidence-backed blocked after retryable failure but rejects completed and mixed histories", () => {
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:00.000Z",
      createRunId: () => "run_blocked_v20"
    });
    const started = coordinator.startRun(strictStartInput());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const failed = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "executing_model",
      type: "tool_failed",
      snapshotPatch: { activeErrorId: "error_01", recoveryState: "retryable" },
      detail: { toolCallId: "tool_call_failed" }
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    const evidence = `run-event/${String(failed.value.lastSequence)}/tool_failed/tool_call_failed`;
    expect(
      coordinator.recordFinish({
        runId: started.value.runId,
        projectId: "project_01",
        commandId: "finish_completed_v20",
        expectedRunRevision: failed.value.runRevision,
        finishReport: {
          outcome: "completed",
          report: {
            result: "Incorrectly complete.",
            appliedChanges: [],
            verification: ["not-run: blocked"],
            residualRisks: []
          },
          evidenceRefs: [evidence]
        }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_FINISH_RECOVERY_ACTIVE" } });
    const blocked = coordinator.recordFinish({
      runId: started.value.runId,
      projectId: "project_01",
      commandId: "finish_blocked_v20",
      expectedRunRevision: failed.value.runRevision,
      finishReport: {
        outcome: "blocked",
        report: {
          result: "The retryable tool failure prevents safe completion.",
          appliedChanges: [],
          verification: [],
          residualRisks: ["The requested operation remains incomplete."],
          nextStep: "Resolve the tool failure and start a new run."
        },
        evidenceRefs: [evidence]
      }
    });
    expect(blocked).toMatchObject({
      ok: true,
      value: { schemaVersion: "2.0", status: "blocked", finish: { state: "blocked" } }
    });
    if (!blocked.ok) return;
    const history = coordinator.readEvents(started.value.runId);
    expect(
      engineExports.validateAgentRunHistoryV20({ snapshot: blocked.value, events: history }).ok
    ).toBe(true);
    const mixed = [{ ...history[0], schemaVersion: "1.3" }, ...history.slice(1)];
    expect(
      engineExports.createAgentRunCoordinator().restoreRun(blocked.value, mixed as typeof history)
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_RESTORE_INVALID" } });
  });

  test("treats capability_changed as an absorbing V20 boundary", () => {
    const ids = ["run_capability_v20", "run_after_capability_v20"];
    const coordinator = engineExports.createAgentRunCoordinator({
      now: () => "2026-08-04T00:00:00.000Z",
      createRunId: () => ids.shift() ?? "run_unexpected"
    });
    const started = coordinator.startRun(strictStartInput());
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const changed = coordinator.recordRunEvent({
      runId: started.value.runId,
      status: "capability_changed",
      type: "capability_changed",
      detail: { effectiveCapabilityRevision: 2, reason: "workspace_policy_changed" }
    });
    expect(changed).toMatchObject({
      ok: true,
      value: {
        status: "capability_changed",
        capabilities: {
          revision: 2,
          state: "capability_changed",
          changeReason: "workspace_policy_changed"
        },
        pending: { kind: "none" }
      }
    });
    expect(
      coordinator.recordRunEvent({
        runId: started.value.runId,
        status: "executing_model",
        type: "assistant_text_completed",
        detail: { text: "must not continue" }
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_RUN_ALREADY_TERMINAL" } });
    expect(
      coordinator.startRun(
        strictStartInput({
          conversationId: "conversation_after_capability",
          commandId: "start_after_capability"
        })
      )
    ).toMatchObject({ ok: true, value: { runId: "run_after_capability_v20" } });
  });
});
