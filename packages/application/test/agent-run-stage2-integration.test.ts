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
        async *streamRound(input: { readonly tools: readonly { readonly name: string }[] }) {
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

  test("auto-approves an acknowledged execution run through the same Version Group path", async () => {
    const createSession = requireCreateSession();
    let round = 0;
    let applyCount = 0;
    let proposalToolResult: Record<string, unknown> | undefined;
    const durableRepository = memoryRepository();
    const receiptCommandIds: string[] = [];
    const repository = {
      ...durableRepository,
      async readCommandReceipt(runId: string, commandId: string) {
        receiptCommandIds.push(commandId);
        return /^[A-Za-z0-9_-]+$/.test(commandId)
          ? durableRepository.readCommandReceipt(runId, commandId)
          : { ok: false as const, error: storageError("AGENT_RUN_RECEIPT_INVALID") };
      },
      async writeCommandReceipt(
        runId: string,
        commandId: string,
        receipt: Record<string, unknown>
      ) {
        receiptCommandIds.push(commandId);
        return /^[A-Za-z0-9_-]+$/.test(commandId)
          ? durableRepository.writeCommandReceipt(runId, commandId, receipt)
          : { ok: false as const, error: storageError("AGENT_RUN_RECEIPT_INVALID") };
      }
    };
    const changeSetSession = applicationExports.createChangeSetSession({
      port: {
        async readChapterTarget() {
          throw new Error("unused");
        },
        async readFileTarget() {
          return {
            ok: true as const,
            value: {
              relativePath: "notes/outline.md",
              assetType: "text" as const,
              content: "before\n",
              checksum: sha256("before\n"),
              dirty: false,
              supported: true
            }
          };
        },
        async validateCandidate() {
          return { ok: true as const, value: {} };
        },
        async persistChangeSet(changeSet) {
          return { ok: true as const, value: changeSet };
        }
      },
      createChangeSetId: () => "changes_stage3_auto",
      createHunkId: () => "hunk_stage3_auto",
      now: () => "2026-07-13T00:00:00.000Z"
    });
    const versionGroupSession = applicationExports.createVersionGroupSession({
      transaction: {
        async listIncompleteTransactionPaths() {
          return { ok: true as const, value: [] };
        },
        async apply(input) {
          applyCount += 1;
          expect(input).toMatchObject({
            writePolicy: "user_preapproved_run",
            approvalSource: "user_preapproved_run"
          });
          return {
            ok: true as const,
            value: {
              schemaVersion: "1.0" as const,
              versionGroupId: "versions_stage3_auto",
              runId: input.runId,
              checkpointId: input.checkpointId,
              changeSetId: input.changeSetId,
              changeSetRevision: input.revision,
              changeSetChecksum: input.checksum,
              writePolicy: input.writePolicy,
              approvalSource: input.approvalSource,
              createdAt: "2026-07-13T00:01:00.000Z",
              transactionStatus: "applied" as const,
              undoStatus: "available" as const,
              writes: [],
              baselineByPath: {},
              undoMetadata: {
                runId: input.runId,
                versionGroupId: "versions_stage3_auto",
                baselineVersionIds: {},
                lastWriteChecksums: {}
              }
            }
          };
        },
        async recoverIncompleteTransactions() {
          return { ok: true as const, value: [] };
        },
        async undoVersionGroup() {
          throw new Error("unused");
        },
        async undoWrite() {
          throw new Error("unused");
        },
        async undoRun() {
          throw new Error("unused");
        }
      },
      hooks: {
        async pauseAutosave() {},
        async resumeAutosave() {},
        async syncSavedEditor() {},
        async preserveDirtyBuffers() {},
        async markRecoveryClean() {},
        async surfaceTransactionRecoveryReview() {}
      }
    });
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_auto" },
      repository,
      modelDriver: {
        async *streamRound(input: {
          readonly messages: readonly {
            readonly role: string;
            readonly content: string;
            readonly toolCallId?: string;
          }[];
        }) {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_auto", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          proposalToolResult = JSON.parse(
            input.messages.find(
              (message) => message.role === "tool" && message.toolCallId === "propose_auto"
            )?.content ?? "{}"
          ) as Record<string, unknown>;
          yield toolCall("finish_auto", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession,
      versionGroupExecutor: {
        async apply(
          input: Parameters<typeof versionGroupSession.applyApproved>[0]
        ): Promise<Record<string, unknown>> {
          return (await versionGroupSession.applyApproved(input)) as unknown as Record<
            string,
            unknown
          >;
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    const started = await session.startAgentRun({
      ...startCommand(),
      commandId: "start-stage3-auto",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    expect(started).toMatchObject({ ok: true, value: { writePolicy: "user_preapproved_run" } });
    await waitForStatus(session, "run_stage3_auto", "completed");

    const read = await session.readAgentRun("run_stage3_auto");
    expect(applyCount).toBe(1);
    expect(receiptCommandIds).toContain("auto_approve_changes_stage3_auto_1");
    expect(proposalToolResult).toMatchObject({ status: "awaiting_approval" });
    expect(read).toMatchObject({
      ok: true,
      value: {
        changeSet: { status: "applied" },
        snapshot: { versionGroupId: "versions_stage3_auto" }
      }
    });
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).toEqual(
      expect.arrayContaining([
        "change_set_ready",
        "change_set_auto_approved",
        "approval_resolved",
        "write_started",
        "write_applied"
      ])
    );
    const eventTypes = (read as { value: { events: { type: string }[] } }).value.events.map(
      (event) => event.type
    );
    expect(eventTypes.indexOf("change_set_ready")).toBeLessThan(
      eventTypes.indexOf("change_set_auto_approved")
    );
    expect(eventTypes.indexOf("change_set_auto_approved")).toBeLessThan(
      eventTypes.indexOf("approval_resolved")
    );
    expect(eventTypes.indexOf("approval_resolved")).toBeLessThan(
      eventTypes.indexOf("write_started")
    );
  });

  test("does not emit auto approval when approval validation fails", async () => {
    const createSession = requireCreateSession();
    let decisionCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_invalid_auto" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return {
            ok: true,
            value: pendingChangeSet("run_stage3_invalid_auto", "user_preapproved_run")
          };
        },
        ...unusedChangeSetMethods(),
        async decide() {
          decisionCount += 1;
          return { ok: false, error: storageError("CHANGE_SET_INVALID") };
        }
      },
      versionGroupExecutor: unusedVersionGroupExecutor()
    });

    await session.startAgentRun({
      ...startCommand(),
      commandId: "start-invalid-auto",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true
    });
    await vi.waitFor(() => expect(decisionCount).toBe(1));

    const read = await session.readAgentRun("run_stage3_invalid_auto");
    expect(read).toMatchObject({
      ok: true,
      value: { snapshot: { status: "awaiting_write_approval" } }
    });
    const eventTypes = (read as { value: { events: { type: string }[] } }).value.events.map(
      (event) => event.type
    );
    expect(eventTypes).not.toContain("change_set_auto_approved");
    expect(eventTypes).not.toContain("approval_resolved");
    expect(eventTypes).not.toContain("write_started");
  });

  test("keeps automatic approval source internal to the run session", async () => {
    const createSession = requireCreateSession();
    let observedApprovalSource: unknown;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_external_source" },
      repository: memoryRepository(),
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_external_source") };
        },
        ...unusedChangeSetMethods(),
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
      },
      versionGroupExecutor: {
        async apply(input: Record<string, unknown>) {
          observedApprovalSource = (input["approval"] as Record<string, unknown> | undefined)?.[
            "approvalSource"
          ];
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_external_source",
              runId: "run_external_source",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
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
    const awaiting = await waitForStatus(session, "run_external_source", "awaiting_write_approval");
    const command = {
      action: "request" as const,
      projectId: "project-01",
      runId: "run_external_source",
      commandId: "external-source-injection",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected" as const
    };

    await Reflect.apply(session.decideChangeSet, session, [command, "user_preapproved_run"]);

    expect(observedApprovalSource).toBe("human_confirmation");
  });

  test("downgrades a persisted automatic policy before a restored run can write", async () => {
    const createSession = requireCreateSession();
    const repository = memoryRepository();
    const createdAt = "2026-07-13T00:00:00.000Z";
    await repository.writeSnapshot({
      schemaVersion: "1.0",
      runId: "run_forged_auto",
      projectId: "project-01",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "user_preapproved_run",
      userRequest: "Update the outline.",
      status: "executing_model",
      runRevision: 1,
      lastSequence: 1,
      startedAt: createdAt,
      updatedAt: createdAt,
      limits: {
        maxModelRounds: 20,
        maxToolCalls: 50,
        maxConsecutiveToolFailures: 3
      },
      providerCapabilitySnapshot: startCommand()["providerCapabilitySnapshot"],
      pendingUserInputId: null,
      contextSnapshotId: null,
      sourcePlanId: null,
      sourcePlanRevision: null
    });
    await repository.appendEvent({
      schemaVersion: "1.0",
      runId: "run_forged_auto",
      projectId: "project-01",
      sequence: 1,
      runRevision: 1,
      type: "run_started",
      createdAt
    });
    let applyCount = 0;
    const session = createSession({
      repository,
      modelDriver: proposalOnlyDriver(),
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_forged_auto") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          applyCount += 1;
          return {
            ok: true,
            value: {
              schemaVersion: "1.0",
              versionGroupId: "versions_forged_auto",
              runId: "run_forged_auto",
              checkpointId: "checkpoint_stage2",
              transactionStatus: "applied",
              undoStatus: "available",
              writes: []
            }
          };
        },
        async undoRun() {
          throw new Error("unused");
        }
      }
    });

    expect(await session.readAgentRun("run_forged_auto")).toMatchObject({
      ok: true,
      value: { snapshot: { writePolicy: "write_before_confirmation" } }
    });
    await session.resumeAgentRun({
      runId: "run_forged_auto",
      projectId: "project-01",
      commandId: "resume-forged-auto",
      expectedRunRevision: 1
    });
    await waitForStatus(session, "run_forged_auto", "awaiting_write_approval");

    const read = await session.readAgentRun("run_forged_auto");
    expect(applyCount).toBe(0);
    expect(
      (read as { value: { events: { type: string }[] } }).value.events.map((event) => event.type)
    ).not.toContain("change_set_auto_approved");
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
    const eventTypes = (
      duringVerification as { value: { events: { type: string }[] } }
    ).value.events.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining(["approval_resolved", "write_started", "write_applied"])
    );
    expect(
      (
        duringVerification as {
          value: { events: { type: string; detail?: Record<string, unknown> }[] };
        }
      ).value.events.find((event) => event.type === "write_applied")
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
    const awaiting = await waitForStatus(session, "run_stage2_conflict", "awaiting_write_approval");
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

  test("rejects run undo for planning before writing audit events or calling the executor", async () => {
    const createSession = requireCreateSession();
    let undoCount = 0;
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_planning_undo" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          yield toolCall("finish_planning_undo", "finish_plan", {
            planId: "plan-planning-undo",
            goal: "Plan without writing files.",
            successCriteria: ["The plan remains read-only."],
            nonGoals: ["Do not modify project files."],
            facts: ["Planning mode is active."],
            assumptions: [],
            openQuestions: [],
            targetRefs: [{ refId: "notes:outline", intent: "Review the outline." }],
            steps: [{ stepId: "step-01", title: "Review", verification: "Read again." }],
            risks: [],
            verification: ["Confirm no write occurred."],
            sourceRefs: ["notes:outline"]
          });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      versionGroupExecutor: {
        async apply() {
          throw new Error("Planning must not apply a Version Group.");
        },
        async undoRun() {
          undoCount += 1;
          return {
            ok: true,
            value: { versionGroupId: "unexpected", transactionStatus: "applied" }
          };
        }
      }
    });

    await session.startAgentRun({ ...startCommand(), operationMode: "planning" });
    const ready = await waitForStatus(session, "run_stage3_planning_undo", "plan_ready");
    const cancelled = await session.decidePlan({
      projectId: "project-01",
      runId: "run_stage3_planning_undo",
      commandId: "reject-planning-01",
      expectedRunRevision: ready.runRevision,
      planId: "plan-planning-undo",
      planRevision: 1,
      decision: "reject"
    });
    expect(cancelled).toMatchObject({ ok: true, value: { status: "completed" } });
    const cancelledRevision = (cancelled as { value: { runRevision: number } }).value.runRevision;
    const before = await session.readAgentRun("run_stage3_planning_undo");
    const beforeEvents = (before as { value: { events: readonly unknown[] } }).value.events.length;

    const rejected = await session.undoRun({
      action: "request",
      projectId: "project-01",
      runId: "run_stage3_planning_undo",
      commandId: "undo-planning-01",
      expectedRunRevision: cancelledRevision
    });

    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "AGENT_RUN_UNDO_NOT_ALLOWED" }
    });
    expect(undoCount).toBe(0);
    const after = await session.readAgentRun("run_stage3_planning_undo");
    expect((after as { value: { events: readonly unknown[] } }).value.events).toHaveLength(
      beforeEvents
    );
  });

  test("keeps a conflict-aware undo interactive until reviewed decisions complete it", async () => {
    const createSession = requireCreateSession();
    const undoInputs: Record<string, unknown>[] = [];
    let round = 0;
    const rollbackReview = {
      schemaVersion: "1.0",
      reviewId: "rollback_review_01",
      runId: "run_stage3_undo_review",
      status: "pending",
      sourceVersionGroupIds: ["versions_stage3_undo_review"],
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      processedCommandIds: [],
      files: [
        {
          relativePath: "notes/outline.md",
          assetType: "text",
          baselineContent: "before\n",
          baselineChecksum: sha256("before\n"),
          baselineVersionId: "ver_before",
          runLastWriteContent: "after\n",
          runLastWriteChecksum: sha256("after\n"),
          reviewedCurrentContent: "user edit\n",
          reviewedCurrentChecksum: sha256("user edit\n"),
          diff: {
            currentToLastWrite: "current -> ai",
            currentToBaseline: "current -> baseline",
            lastWriteToBaseline: "ai -> baseline"
          },
          status: "conflict"
        }
      ]
    };
    const session = createSession({
      coordinatorOptions: { createRunId: () => "run_stage3_undo_review" },
      repository: memoryRepository(),
      modelDriver: {
        async *streamRound() {
          round += 1;
          if (round === 1) {
            yield toolCall("propose_undo_review", "propose_file_write", {
              path: "notes/outline.md",
              baseHash: sha256("before\n"),
              range: { unit: "character", start: 0, end: 7 },
              replacement: "after\n"
            });
            yield { type: "round_completed", finishReason: "tool_calls" };
            return;
          }
          yield toolCall("finish_undo_review", "finish", { summary: "verified" });
          yield { type: "round_completed", finishReason: "tool_calls" };
        }
      },
      readToolExecutor: unusedReadExecutor(),
      changeSetSession: {
        async proposeFileWrite() {
          return { ok: true, value: pendingChangeSet("run_stage3_undo_review") };
        },
        ...unusedChangeSetMethods()
      },
      versionGroupExecutor: {
        async apply() {
          return {
            ok: true,
            value: { versionGroupId: "versions_stage3_undo_review", transactionStatus: "applied" }
          };
        },
        async undoRun(input: Record<string, unknown>) {
          undoInputs.push(input);
          return input["action"] === "resolve"
            ? {
                ok: true,
                value: {
                  versionGroupId: "rollback_review_01",
                  transactionStatus: "applied",
                  undoStatus: "completed",
                  rollbackReview: { ...rollbackReview, status: "completed" }
                }
              }
            : {
                ok: true,
                value: {
                  versionGroupId: "rollback_review_01",
                  transactionStatus: "awaiting_review",
                  undoStatus: "review_required",
                  rollbackReview
                }
              };
        },
        async readRollbackReview() {
          return { ok: true, value: rollbackReview };
        }
      }
    });
    await session.startAgentRun(startCommand());
    const awaiting = await waitForStatus(
      session,
      "run_stage3_undo_review",
      "awaiting_write_approval"
    );
    await session.decideChangeSet({
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "apply-stage3-undo-review",
      expectedRunRevision: awaiting.runRevision,
      changeSetId: "changes_stage2",
      revision: 1,
      checksum: "checksum_revision_1",
      decision: "apply_selected"
    });
    const completed = await waitForStatus(session, "run_stage3_undo_review", "completed");

    const requested = await session.undoRun({
      action: "request",
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "undo-review-request",
      expectedRunRevision: completed.runRevision
    });

    if (!requested.ok) throw new Error(JSON.stringify(requested));
    const pendingRead = await session.readAgentRun("run_stage3_undo_review");
    expect(pendingRead).toMatchObject({
      ok: true,
      value: {
        rollbackReview: { reviewId: "rollback_review_01", status: "pending" }
      }
    });
    expect(
      (pendingRead as { value: { events: readonly Record<string, unknown>[] } }).value.events
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "run_undo_review_required" })])
    );
    const resolved = await session.undoRun({
      action: "resolve",
      projectId: "project-01",
      runId: "run_stage3_undo_review",
      commandId: "undo-review-resolve",
      expectedRunRevision: (requested.value as { runRevision: number }).runRevision,
      reviewId: "rollback_review_01",
      decisions: [{ relativePath: "notes/outline.md", decision: "keep_current" }]
    });

    expect(resolved.ok).toBe(true);
    expect(undoInputs).toMatchObject([
      { action: "request", commandId: "undo-review-request" },
      {
        action: "resolve",
        commandId: "undo-review-resolve",
        reviewId: "rollback_review_01",
        decisions: [{ relativePath: "notes/outline.md", decision: "keep_current" }]
      }
    ]);
    const resolvedRead = await session.readAgentRun("run_stage3_undo_review");
    expect(resolvedRead.ok).toBe(true);
    expect(
      (resolvedRead as { value: { events: readonly Record<string, unknown>[] } }).value.events
    ).toEqual(expect.arrayContaining([expect.objectContaining({ type: "run_undone" })]));
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
      action: "request",
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
        async readCurrentSources(input: {
          readonly sources: readonly { readonly refId: string }[];
        }) {
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
        async readCurrentSources(input: {
          readonly sources: readonly { readonly refId: string }[];
        }) {
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
    await waitForStatus(reloadedSession, "run_stage2_checkpoint_reload", "awaiting_write_approval");

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
        events: expect.not.arrayContaining([expect.objectContaining({ type: "approval_resolved" })])
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
  decidePlan(command: Record<string, unknown>): Promise<Record<string, unknown>>;
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

function pendingChangeSet(
  runId: string,
  writePolicy?: "write_before_confirmation" | "user_preapproved_run"
): Record<string, unknown> {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_stage2",
    revision: 1,
    runId,
    checkpointId: "checkpoint_stage2",
    contextSnapshotId: "context_stage2",
    ...(writePolicy === undefined ? {} : { writePolicy }),
    status: "awaiting_approval",
    checksum: "checksum_revision_1",
    approvalToken: "approval_stage2",
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
    snapshot = (read as { value: { snapshot: { runRevision: number; lastSequence: number } } })
      .value.snapshot;
  });
  if (snapshot === undefined) throw new Error(`Run ${runId} never reached ${status}.`);
  return snapshot;
}

function sha256(value: string): string {
  // Fixed fixtures keep this renderer-neutral integration test free of Node crypto imports.
  if (value === "before\n")
    return "9160d4be34c8695bd172a76c7c7966587ea5a4d991ad22c87b2b91af54aa9ebb";
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
