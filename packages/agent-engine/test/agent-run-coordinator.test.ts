import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

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

  test("authors a v1.1 snapshot and events with Stage 5 defaults", () => {
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
      schemaVersion: "1.1",
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
      schemaVersion: "1.1",
      type: "run_started"
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
      .restoreRun(
        legacySnapshot as typeof started.value,
        source.readEvents(started.value.runId)
      );

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
});
