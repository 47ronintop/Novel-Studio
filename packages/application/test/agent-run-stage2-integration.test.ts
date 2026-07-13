import { describe, expect, test, vi } from "vitest";

import * as applicationExports from "../src/index.js";

describe("AgentRunSession Stage 2 integration", () => {
  test("stages a proposal without writing and pauses on the persisted Change Set", async () => {
    const createSession = requireCreateSession();
    const proposalCalls: Record<string, unknown>[] = [];
    let toolsShownToModel: string[] = [];
    let round = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_proposal" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound(input: {
          readonly tools: readonly { readonly name: string }[];
        }) {
          round += 1;
          toolsShownToModel = input.tools.map((tool) => tool.name);
          if (round === 1) {
            yield toolCall("propose_notes", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_after_proposal", "finish", { summary: "unexpected resume" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite(input: Record<string, unknown>) {
          proposalCalls.push(input);
          return { ok: true, value: pendingChangeSet("run_stage2_proposal") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());

    await vi.waitFor(async () => {
      expect(await session.readAgentRun("run_stage2_proposal")).toMatchObject({
        ok: true,
        value: {
          snapshot: {
            status: "awaiting_write_approval",
            pendingChangeSetId: "changes_stage2",
            pendingChangeSetRevision: 1,
            pendingChangeSetChecksum: "checksum_revision_1"
          },
          changeSet: {
            changeSetId: "changes_stage2",
            revision: 1,
            status: "awaiting_approval"
          }
        }
      });
    });

    expect(toolsShownToModel).toContain("propose_file_write");
    expect(proposalCalls).toHaveLength(1);
    expect(round).toBe(1);
    const read = await session.readAgentRun("run_stage2_proposal");
    expect(JSON.stringify(read)).not.toContain("unexpected resume");
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).toContain("change_set_ready");
  });

  test("applies an approved revision through Version Group once when the command is replayed", async () => {
    const createSession = requireCreateSession();
    let applyCount = 0;
    let round = 0;
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    let releaseVerification!: () => void;
    const verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_apply" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_apply", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          await verificationGate;
          yield toolCall("finish_apply", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_apply") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          applyCount += 1;
          expect(input).toMatchObject({
            changeSet: {
              changeSetId: "changes_stage2",
              revision: 1,
              checksum: "checksum_revision_1"
            },
            approval: {
              approvalSource: "human_confirmation",
              binding: {
                changeSetId: "changes_stage2",
                revision: 1,
                checksum: "checksum_revision_1"
              }
            }
          });
          await applyGate;
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_stage2",
              runId: "run_stage2_apply",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
              synchronization: {
                status: "recovery_required",
                failedHooks: ["markRecoveryClean"]
              },
              writes: []
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(session, "run_stage2_apply", "awaiting_write_approval");
    const command = {
      projectId: "project-01",
      runId: "run_stage2_apply",
      commandId: "apply-stage2-01",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };

    const firstPending = session.decideChangeSet(command);
    await vi.waitFor(() => expect(applyCount).toBe(1));
    const duplicatePending = session.decideChangeSet(command);
    releaseApply();
    const [first, duplicate] = await Promise.all([firstPending, duplicatePending]);

    expect(duplicate).toEqual(first);
    expect(applyCount).toBe(1);
    const duringVerification = await session.readAgentRun("run_stage2_apply");
    const eventTypes = (duringVerification as { value: { events: { type: string }[] } }).value.events
      .map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["approval_resolved", "write_started", "write_applied"])
    );
    expect(
      (duringVerification as {
        value: { events: { type: string; detail?: Record<string, unknown> }[] };
      }).value.events.find((event) => event.type === "write_applied")
    ).toMatchObject({
      detail: {
        synchronizationStatus: "recovery_required",
        synchronizationFailedHooks: ["markRecoveryClean"]
      }
    });
    releaseVerification();
    await waitForStatus(session, "run_stage2_apply", "completed");
    expect(await session.readAgentRun("run_stage2_apply")).toMatchObject({
      ok: true,
      value: { changeSet: { changeSetId: "changes_stage2", status: "applied" } }
    });
  });

  test("does not cache a successful apply when its command receipt cannot be persisted", async () => {
    const createSession = requireCreateSession();
    const durableRepository = memoryRepository();
    let failReceiptWrites = false;
    let applyCount = 0;
    const repository = {
      ...durableRepository,
      async writeCommandReceipt(
        runId: string,
        commandId: string,
        receipt: Record<string, unknown>
      ) {
        if (failReceiptWrites) {
          return {
            ok: false as const,
            error: storageError("AGENT_RUN_RECEIPT_WRITE_FAILED")
          };
        }
        return durableRepository.writeCommandReceipt(runId, commandId, receipt);
      }
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_receipt_failure" },
      repository,
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_receipt_failure") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "versions_receipt_failure" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_receipt_failure",
      "awaiting_write_approval"
    );
    const command = {
      projectId: "project-01",
      runId: "run_stage2_receipt_failure",
      commandId: "apply-stage2-receipt-failure",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };
    failReceiptWrites = true;

    expect(await session.decideChangeSet(command)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_RECEIPT_WRITE_FAILED" },
      latestSnapshot: { versionGroupId: "versions_receipt_failure" }
    });
    expect(await session.decideChangeSet(command)).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_REVISION_CONFLICT" }
    });
    expect(applyCount).toBe(1);
  });

  test("reports base conflicts and per-file rollback state without emitting write_applied", async () => {
    const createSession = requireCreateSession();
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_conflict" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_conflict") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: false as const,
            error: {
              schemaVersion: "1.0",
              errorId: "err_stage2_conflict",
              code: "AGENT_WRITE_BASE_CONFLICT",
              category: "ValidationError",
              message: "The target changed.",
              recoverability: "user-action",
              suggestedAction: "Refresh the Change Set.",
              traceId: "stage2-test",
              createdAt: "2026-07-13T00:00:00.000Z",
              redactedDetail: {
                baseHashConflictPaths: ["notes/outline.md"],
                writes: [
                  {
                    relativePath: "notes/outline.md",
                    status: "pending",
                    errorCode: "AGENT_WRITE_BASE_CONFLICT"
                  }
                ]
              }
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_conflict",
      "awaiting_write_approval"
    );
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_conflict",
      commandId: "apply-stage2-conflict",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    const read = await session.readAgentRun("run_stage2_conflict");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "failed" } } });
    const events = (read as { value: { events: { type: string; detail?: unknown }[] } }).value
      .events;
    expect(events.find((event) => event.type === "write_failed")).toMatchObject({
      detail: {
        code: "AGENT_WRITE_BASE_CONFLICT",
        baseHashConflictPaths: ["notes/outline.md"],
        writes: [
          {
            relativePath: "notes/outline.md",
            status: "pending",
            errorCode: "AGENT_WRITE_BASE_CONFLICT"
          }
        ]
      }
    });
    expect(events.some((event) => event.type === "write_applied")).toBe(false);
  });

  test("creates and binds a new immutable revision when the file or hunk selection changes", async () => {
    const createSession = requireCreateSession();
    let selectCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_selection" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_selection") };
        },
        ...unusedChangeSetMethods(),
        async selectRevision(input: Record<string, unknown>) {
          selectCount += 1;
          expect(input).toMatchObject({
            changeSetId: "changes_stage2",
            revision: 1,
            files: [{ relativePath: "notes/outline.md", selected: false }]
          });
          return {
            ok: true,
            value: {
              ...pendingChangeSet("run_stage2_selection"),
              revision: 2,
              checksum: "checksum_revision_2",
              approvalToken: "approval_revision_2",
              files: []
            }
          };
        }
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_selection",
      "awaiting_write_approval"
    );
    const command = {
      projectId: "project-01",
      runId: "run_stage2_selection",
      commandId: "select-stage2-01",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "update_selection",
      files: [{ relativePath: "notes/outline.md", selected: false }]
    };
    const first = await session.decideChangeSet(command);
    const duplicate = await session.decideChangeSet(command);

    expect(duplicate).toEqual(first);
    expect(selectCount).toBe(1);
    expect(await session.readAgentRun("run_stage2_selection")).toMatchObject({
      value: {
        snapshot: {
          status: "awaiting_write_approval",
          pendingChangeSetRevision: 2,
          pendingChangeSetChecksum: "checksum_revision_2"
        },
        changeSet: { revision: 2, checksum: "checksum_revision_2" }
      }
    });
  });

  test("replays run-level undo without repeating the Version Group compensation", async () => {
    const createSession = requireCreateSession();
    let undoCount = 0;
    let round = 0;
    let releaseUndo!: () => void;
    const undoGate = new Promise<void>((resolve) => {
      releaseUndo = resolve;
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_undo" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_undo") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage2_undo", transactionStatus: "applied" }
          };
        },
        async undoRun() {
          undoCount += 1;
          await undoGate;
          return {
            ok: true,
            value: {
              versionGroupId: "versions_stage2_undo",
              transactionStatus: "applied",
              undoStatus: "completed",
              undoMetadata: {
                runId: "run_stage2_undo",
                undoOfVersionGroupIds: ["versions_stage2_undo"]
              }
            }
          };
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(session, "run_stage2_undo", "awaiting_write_approval");
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_undo",
      commandId: "apply-stage2-undo",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage2_undo", "completed");
    const command = {
      projectId: "project-01",
      runId: "run_stage2_undo",
      commandId: "undo-stage2-01",
      expectedRunRevision: completed.runRevision
    };
    const firstPending = session.undoRun(command);
    await vi.waitFor(() => expect(undoCount).toBe(1));
    const duplicatePending = session.undoRun(command);
    releaseUndo();
    const [first, duplicate] = await Promise.all([firstPending, duplicatePending]);

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        runRevision: completed.runRevision + 2,
        lastSequence: completed.lastSequence + 2
      }
    });
    expect(undoCount).toBe(1);
    const read = await session.readAgentRun("run_stage2_undo");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "completed" } } });
    const events = (read as { value: { events: readonly Record<string, unknown>[] } }).value.events;
    expect(events.slice(-2)).toMatchObject([
      {
        type: "run_undo_started",
        detail: { commandId: "undo-stage2-01" }
      },
      {
        type: "run_undone",
        detail: {
          versionGroup: {
            versionGroupId: "versions_stage2_undo",
            transactionStatus: "applied",
            undoStatus: "completed",
            undoMetadata: {
              runId: "run_stage2_undo",
              undoOfVersionGroupIds: ["versions_stage2_undo"]
            }
          }
        }
      }
    ]);
  });

  test("records a failed run-level undo without changing the completed terminal status", async () => {
    const createSession = requireCreateSession();
    let round = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_undo_failure" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo_failure", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo_failure", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_undo_failure") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage2_undo_failure", transactionStatus: "applied" }
          };
        },
        async undoRun() {
          return {
            ok: false as const,
            error: {
              schemaVersion: "1.0",
              errorId: "err_stage2_undo_failure",
              code: "AGENT_RUN_UNDO_FAILED",
              category: "StorageError",
              message: "The run undo failed.",
              recoverability: "retryable",
              suggestedAction: "Retry the failed undo.",
              traceId: "stage2-test",
              createdAt: "2026-07-13T00:00:00.000Z",
              redactedDetail: {
                versionGroupId: "versions_stage2_undo_failure",
                failureKind: "undo_failure",
                writes: [{ relativePath: "notes/outline.md", status: "rollback_failed" }]
              }
            }
          };
        }
      }
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_undo_failure",
      "awaiting_write_approval"
    );
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_undo_failure",
      commandId: "apply-stage2-undo-failure",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage2_undo_failure", "completed");
    const result = await session.undoRun({
      projectId: "project-01",
      runId: "run_stage2_undo_failure",
      commandId: "undo-stage2-failure",
      expectedRunRevision: completed.runRevision
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_UNDO_FAILED" },
      latestSnapshot: {
        status: "completed",
        runRevision: completed.runRevision + 2,
        lastSequence: completed.lastSequence + 2
      }
    });
    const read = await session.readAgentRun("run_stage2_undo_failure");
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status: "completed" } } });
    const events = (read as { value: { events: readonly Record<string, unknown>[] } }).value.events;
    expect(events.slice(-2)).toMatchObject([
      { type: "run_undo_started", detail: { commandId: "undo-stage2-failure" } },
      {
        type: "run_undo_failed",
        detail: {
          code: "AGENT_RUN_UNDO_FAILED",
          versionGroupId: "versions_stage2_undo_failure",
          failureKind: "undo_failure",
          writes: [{ relativePath: "notes/outline.md", status: "rollback_failed" }]
        }
      }
    ]);
  });

  test("does not let the generic resume command bypass pending write approval", async () => {
    const createSession = requireCreateSession();
    let rounds = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_resume_gate" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          rounds += 1;
          yield toolCall("propose_resume_gate", "propose_file_write", {
            path: "notes/outline.md",
            baseHash: sha256("before\n"),
            range: { unit: "character", start: 0, end: 7 },
            replacement: "after\n"
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_resume_gate") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_resume_gate",
      "awaiting_write_approval"
    );
    const resumed = await session.resumeAgentRun({
      projectId: "project-01",
      runId: "run_stage2_resume_gate",
      commandId: "resume-stage2-gate",
      expectedRunRevision: awaiting.runRevision
    });

    expect(resumed).toMatchObject({
      ok: false,
      error: { code: "AGENT_CHANGE_SET_DECISION_REQUIRED" }
    });
    expect(rounds).toBe(1);
  });

  test("invalidates a pending Change Set when a bound context source changes before apply", async () => {
    const createSession = requireCreateSession();
    let currentContext = "supporting context before";
    let applyCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage2_stale_context" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      contextSourceReader: {
        async readCurrentSources(input: { readonly sources: readonly { readonly refId: string }[] }) {
          return {
            ok: true,
            value: input.sources.map((source) => ({
              refId: source.refId,
              content: currentContext
            }))
          };
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_stale_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await session.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: currentContext,
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      session,
      "run_stage2_stale_context",
      "awaiting_write_approval"
    );
    currentContext = "supporting context changed";

    const result = await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_stale_context",
      commandId: "apply-stage2-stale-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" },
      latestSnapshot: { status: "awaiting_context_refresh" }
    });
    expect(applyCount).toBe(0);
    expect(await session.readAgentRun("run_stage2_stale_context")).toMatchObject({
      value: { changeSet: { status: "stale" } }
    });
  });

  test("restores the bound context snapshot before approving a reloaded Change Set", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    let currentContext = "persisted context before";
    let applyCount = 0;
    const createOptions = () => ({
      repository,
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      contextSourceReader: {
        async readCurrentSources(input: { readonly sources: readonly { readonly refId: string }[] }) {
          return {
            ok: true,
            value: input.sources.map((source) => ({
              refId: source.refId,
              content: currentContext
            }))
          };
        }
      },
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_reloaded_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply_after_reload" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });
    const firstSession = createSession({
      ...createOptions(),
      coordinatorOptions: { createRunId: () => "run_stage2_reloaded_context" }
    });

    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: currentContext,
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      firstSession,
      "run_stage2_reloaded_context",
      "awaiting_write_approval"
    );
    currentContext = "persisted context changed";

    const reloadedSession = createSession(createOptions());
    const result = await reloadedSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_reloaded_context",
      commandId: "apply-stage2-reloaded-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_STALE" },
      latestSnapshot: { status: "awaiting_context_refresh" }
    });
    expect(applyCount).toBe(0);
  });

  test("fails closed when a reloaded Change Set has no restorable context snapshot", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    let applyCount = 0;
    const sharedOptions = {
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_missing_context") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return { ok: true, value: { versionGroupId: "must_not_apply_without_context" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    };
    const firstSession = createSession({
      ...sharedOptions,
      repository,
      coordinatorOptions: { createRunId: () => "run_stage2_missing_context" }
    });
    await firstSession.startAgentRun({
      ...startCommand(),
      initialContextSources: [
        {
          refId: "file:notes/supporting.md",
          sourceKind: "disk_file",
          relativePath: "notes/supporting.md",
          content: "persist me",
          dirty: false
        }
      ]
    });
    const awaiting = await waitForStatus(
      firstSession,
      "run_stage2_missing_context",
      "awaiting_write_approval"
    );

    const reloadedSession = createSession({
      ...sharedOptions,
      repository: {
        ...repository,
        async readContextSnapshot() {
          return { ok: true, value: undefined };
        }
      }
    });
    const result = await reloadedSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_missing_context",
      commandId: "apply-stage2-missing-context",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_SNAPSHOT_UNAVAILABLE" },
      latestSnapshot: { status: "awaiting_write_approval" }
    });
    expect(applyCount).toBe(0);
  });

  test("allocates a new proposal checkpoint after apply, reload, and resume", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    const checkpointIds: string[] = [];
    const changeSetSession = {
      async proposeFileWrite(input: { readonly checkpointId: string }) {
        checkpointIds.push(input.checkpointId);
        return { ok: true, value: pendingChangeSet("run_stage2_checkpoint_reload") };
      },
      ...unusedChangeSetMethods()
    };
    let firstRound = 0;
    const firstSession = createSession({
      repository,
      coordinatorOptions: { createRunId: () => "run_stage2_checkpoint_reload" },
      modelDriver: {
        async *streamRound() {
          firstRound += 1;
          if (firstRound === 1) {
            yield toolCall("proposal-before-reload", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
          } else {
            yield toolCall("pause-before-reload", "request_user_input", {
              questionId: "question_checkpoint_reload",
              prompt: "Continue?",
              reason: "Verify durable checkpoint allocation.",
              options: [
                { id: "continue", label: "Continue" },
                { id: "stop", label: "Stop" }
              ]
            });
          }
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: {
        async apply() {
          return { ok: true, value: { versionGroupId: "vg_checkpoint_reload" } };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    await firstSession.startAgentRun(startCommand());
    const awaitingApproval = await waitForStatus(
      firstSession,
      "run_stage2_checkpoint_reload",
      "awaiting_write_approval"
    );
    await firstSession.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_checkpoint_reload",
      commandId: "apply-checkpoint-reload",
      expectedRunRevision: awaitingApproval.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const paused = await waitForStatus(
      firstSession,
      "run_stage2_checkpoint_reload",
      "awaiting_user_input"
    );

    const reloadedSession = createSession({
      repository,
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: unusedVersionGroupExecutor()
    });
    await reloadedSession.answerUserInput({
      projectId: "project-01",
      runId: "run_stage2_checkpoint_reload",
      commandId: "answer-checkpoint-reload",
      expectedRunRevision: paused.runRevision,
      questionId: "question_checkpoint_reload",
      answer: "Continue"
    });
    await waitForStatus(
      reloadedSession,
      "run_stage2_checkpoint_reload",
      "awaiting_write_approval"
    );

    expect(checkpointIds).toHaveLength(2);
    expect(checkpointIds[1]).not.toBe(checkpointIds[0]);
  });

  test("restores rejected and abandoned Change Sets as final after reload", async () => {
    const createSession = requireCreateSession();

    for (const terminalDecision of ["rejected", "abandoned"] as const) {
      const runId = `run_stage2_${terminalDecision}`;
      const repository = memoryRepository();
      let round = 0;
      const changeSetSession = {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet(runId) };
        },
        ...unusedChangeSetMethods(),
        async decide() {
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              decision: "reject_all",
              approvalSource: "human_confirmation",
              resolvedAt: "2026-07-13T00:00:00.000Z",
              binding: {
                changeSetId: "changes_stage2",
                revision: 1,
                checksum: "checksum_revision_1",
                approvalToken: "approval_stage2"
              }
            }
          };
        }
      };
      const session = createSession({
        repository,
        coordinatorOptions: { createRunId: () => runId },
        modelDriver: {
          async *streamRound() {
            round += 1;
            if (round === 1) {
              yield toolCall("proposal-final-state", "propose_file_write", {
                path: "notes/outline.md",
                baseHash: sha256("before\n"),
                range: { unit: "character", start: 0, end: 7 },
                replacement: "after\n"
              });
            } else {
              yield toolCall("finish-final-state", "finish", { summary: "Rejected." });
            }
            yield { type: "round_completed", finishReason: "tool_calls" };
          }
        },
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: unusedVersionGroupExecutor()
      });
      await session.startAgentRun(startCommand());
      const awaiting = await waitForStatus(session, runId, "awaiting_write_approval");
      if (terminalDecision === "rejected") {
        await session.decideChangeSet({
          projectId: "project-01",
          runId,
          commandId: "reject-final-state",
          expectedRunRevision: awaiting.runRevision,
          changeSetId: "changes_stage2",
          revision: 1,
          checksum: "checksum_revision_1",
          decision: "reject_all"
        });
        await waitForStatus(session, runId, "completed");
      } else {
        await session.stopAgentRun({
          projectId: "project-01",
          runId,
          commandId: "stop-final-state",
          expectedRunRevision: awaiting.runRevision
        });
        await waitForStatus(session, runId, "cancelled");
      }

      const reloaded = createSession({
        repository,
        modelDriver: proposalOnlyDriver(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: unusedVersionGroupExecutor()
      });
      expect(await reloaded.readAgentRun(runId)).toMatchObject({
        ok: true,
        value: { changeSet: { status: terminalDecision } }
      });
    }
  });

  test("reconciles an applying run with durable transaction recovery after reload", async () => {
    const createSession = requireCreateSession();

    for (const recoveryStatus of ["applied", "none"] as const) {
      const runId = `run_stage2_reconcile_${recoveryStatus}`;
      const repository = memoryRepository();
      const changeSetSession = {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet(runId) };
        },
        ...unusedChangeSetMethods()
      };
      const interrupted = createSession({
        repository,
        coordinatorOptions: { createRunId: () => runId },
        modelDriver: proposalOnlyDriver(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: {
          async apply() {
            return new Promise(() => undefined);
          },
          async undoRun() {
            throw new Error("unused");
          }
        }
      });
      await interrupted.startAgentRun(startCommand());
      const awaiting = await waitForStatus(interrupted, runId, "awaiting_write_approval");
      void interrupted.decideChangeSet({
        projectId: "project-01",
        runId,
        commandId: `apply-reconcile-${recoveryStatus}`,
        expectedRunRevision: awaiting.runRevision,
        changeSetId: "changes_stage2",
        revision: 1,
        checksum: "checksum_revision_1",
        decision: "apply_selected"
      });
      await waitForStatus(interrupted, runId, "applying_changes");

      const reloaded = createSession({
        repository,
        modelDriver: proposalOnlyDriver(),
        readToolExecutor: unusedReadExecutor(),
        changeSetSession,
        versionGroupExecutor: {
          async apply() {
            throw new Error("unused");
          },
          async undoRun() {
            throw new Error("unused");
          },
          async recoverRun() {
            return {
              ok: true,
              value:
                recoveryStatus === "applied"
                  ? {
                      status: "applied",
                      versionGroup: {
                        versionGroupId: `vg_reconcile_${recoveryStatus}`,
                        transactionStatus: "applied"
                      }
                    }
                  : { status: "none" }
            };
          }
        }
      });
      const read = await reloaded.readAgentRun(runId);

      expect(read).toMatchObject({
        ok: true,
        value: {
          snapshot: { status: recoveryStatus === "applied" ? "completed" : "failed" },
          changeSet: {
            status: recoveryStatus === "applied" ? "applied" : "awaiting_approval"
          }
        }
      });
    }
  });

  test("keeps approval pending when the Version Group service is unavailable", async () => {
    const createSession = requireCreateSession();
    const session = createSession({
      repository: memoryRepository(),
      coordinatorOptions: { createRunId: () => "run_stage2_no_version_group" },
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage2_no_version_group") };
        },
        ...unusedChangeSetMethods()
      }
    });
    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage2_no_version_group",
      "awaiting_write_approval"
    );

    const result = await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage2_no_version_group",
      commandId: "apply-no-version-group",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_VERSION_GROUP_UNAVAILABLE" }
    });
    expect(await session.readAgentRun("run_stage2_no_version_group")).toMatchObject({
      ok: true,
      value: {
        snapshot: { status: "awaiting_write_approval" },
        events: expect.not.arrayContaining([
          expect.objectContaining({ type: "approval_resolved" })
        ])
      }
    });
  });
});

function requireCreateSession(): (options: Record<string, unknown>) => SessionShape {
  const value = (applicationExports as unknown as Record<string, unknown>)["createAgentRunSession"];
  expect(typeof value).toBe("function");
  return value as (options: Record<string, unknown>) => SessionShape;
}

interface SessionShape {
  startAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  answerUserInput(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  stopAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  decideChangeSet(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  undoRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  resumeAgentRun(command: Record<string, unknown>): Promise<Record<string, unknown>>;
  readAgentRun(runId: string): Promise<Record<string, unknown>>;
}

function startCommand(): Record<string, unknown> {
  return {
    projectId: "project-01",
    commandId: "start-stage2",
    expectedRunRevision: 0,
    operationMode: "execution",
    contextMode: "general_file",
    writePolicy: "write_before_confirmation",
    userRequest: "Update the outline.",
    providerCapabilitySnapshot: {
      profileId: "profile-stage2",
      provider: "demo",
      modelName: "demo-stage2",
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow: 32_000,
      requiredContextTokens: 1_000
    }
  };
}

function pendingChangeSet(runId: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_stage2",
    revision: 1,
    runId,
    checkpointId: "checkpoint_stage2",
    contextSnapshotId: "context_stage2",
    status: "awaiting_approval",
    checksum: "checksum_revision_1",
    files: [
      {
        relativePath: "notes/outline.md",
        assetType: "text",
        baseChecksum: sha256("before\n"),
        candidateChecksum: sha256("after\n"),
        baseContent: "before\n",
        candidateContent: "after\n",
        hunks: [],
        validation: { valid: true, issues: [] },
        selected: true
      }
    ]
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

function proposalOnlyDriver() {
  return {
    async *streamRound() {
      yield toolCall("propose_selection", "propose_file_write", {
        path: "notes/outline.md",
        baseHash: sha256("before\n"),
        range: { unit: "character", start: 0, end: 7 },
        replacement: "after\n"
      });
      yield { type: "round_completed", finishReason: "tool_calls" };
    }
  };
}

function memoryRepository() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const events = new Map<string, Record<string, unknown>[]>();
  const receipts = new Map<string, Record<string, unknown>>();
  const contextSnapshots = new Map<string, Record<string, unknown>>();
  return {
    async writeSnapshot(snapshot: Record<string, unknown>) {
      snapshots.set(String(snapshot["runId"]), snapshot);
      return { ok: true, value: snapshot };
    },
    async appendEvent(event: Record<string, unknown>) {
      const runId = String(event["runId"]);
      events.set(runId, [...(events.get(runId) ?? []), event]);
      return { ok: true, value: event };
    },
    async writeCommandReceipt(runId: string, commandId: string, receipt: Record<string, unknown>) {
      receipts.set(`${runId}:${commandId}`, receipt);
      return { ok: true, value: receipt };
    },
    async readCommandReceipt(runId: string, commandId: string) {
      return { ok: true, value: receipts.get(`${runId}:${commandId}`) };
    },
    async readSnapshot(runId: string) {
      return { ok: true, value: snapshots.get(runId) };
    },
    async readEvents(runId: string) {
      return { ok: true, value: events.get(runId) ?? [] };
    },
    async writeContextSnapshot(snapshot: Record<string, unknown>) {
      const key = `${String(snapshot["runId"])}:${String(snapshot["contextSnapshotId"])}`;
      contextSnapshots.set(key, snapshot);
      return { ok: true, value: snapshot };
    },
    async readContextSnapshot(runId: string, contextSnapshotId: string) {
      return { ok: true, value: contextSnapshots.get(`${runId}:${contextSnapshotId}`) };
    }
  };
}

function unusedReadExecutor() {
  return {
    async execute() {
      throw new Error("proposal must not use the read executor");
    }
  };
}

function unusedChangeSetMethods() {
  return {
    async proposeChapterWrite() {
      throw new Error("unused");
    },
    async selectRevision() {
      throw new Error("unused");
    },
    async readChangeSet() {
      throw new Error("unused");
    },
    async decide() {
      return {
        ok: true,
        value: {
          schemaVersion: "1.0",
          decision: "apply_selected",
          approvalSource: "human_confirmation",
          resolvedAt: "2026-07-13T00:00:00.000Z",
          binding: {
            changeSetId: "changes_stage2",
            revision: 1,
            checksum: "checksum_revision_1",
            approvalToken: "approval_stage2"
          }
        }
      };
    }
  };
}

function unusedVersionGroupExecutor() {
  return {
    async apply() {
      throw new Error("proposal must not apply a Version Group");
    },
    async undoRun() {
      throw new Error("proposal must not undo a Version Group");
    }
  };
}

async function waitForStatus(
  session: SessionShape,
  runId: string,
  status: string
): Promise<{ readonly runRevision: number; readonly lastSequence: number }> {
  let snapshot: { readonly runRevision: number; readonly lastSequence: number } | undefined;
  await vi.waitFor(async () => {
    const read = await session.readAgentRun(runId);
    expect(read).toMatchObject({ ok: true, value: { snapshot: { status } } });
    snapshot = (
      read as { value: { snapshot: { runRevision: number; lastSequence: number } } }
    ).value.snapshot;
  });
  if (snapshot === undefined) throw new Error(`Run ${runId} never reached ${status}.`);
  return snapshot;
}

function sha256(value: string): string {
  // Fixed fixtures keep this renderer-neutral integration test free of Node crypto imports.
  if (value === "before\n") return "9160d4be34c8695bd172a76c7c7966587ea5a4d991ad22c87b2b91af54aa9ebb";
  return "7b9a72466d3960eb2aacccfc848939453490db0678bd4725def3f789b891c919";
}

function storageError(code: string): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    errorId: `err_${code.toLowerCase()}`,
    code,
    category: "StorageError",
    message: "The command receipt could not be persisted.",
    recoverability: "retryable",
    suggestedAction: "Retry after storage is available.",
    traceId: "stage2-test",
    createdAt: "2026-07-13T00:00:00.000Z"
  };
}
