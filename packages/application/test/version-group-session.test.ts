import { describe, expect, test, vi } from "vitest";

import type { ChangeSet, ChangeSetApproval, VersionGroup } from "@novel-studio/agent-engine";
import { err, ok } from "@novel-studio/shared";

import {
  createVersionGroupSession,
  type VersionGroupSessionHooks,
  type VersionGroupSessionTransactionPort
} from "../src/version-group-session.js";

describe("VersionGroupSession", () => {
  test("applies an exact approval binding with safe autosave/editor/recovery order", async () => {
    const operations: string[] = [];
    let appliedInput: Parameters<VersionGroupSessionTransactionPort["apply"]>[0] | undefined;
    const session = createSession(operations, {
      async apply(input) {
        appliedInput = input;
        operations.push(`transaction:${input.changeSetId}:${input.revision}`);
        return ok(appliedGroup());
      }
    });

    const result = await session.applyApproved({
      changeSet: changeSet(),
      approval: approval()
    });

    expect(result.ok).toBe(true);
    expect(appliedInput).toMatchObject({
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: "token_01"
    });
    expect(operations).toEqual([
      "pause:notes/one.md",
      "transaction:changes_01:1",
      "sync:notes/one.md:Saved:agent",
      "recovery-clean:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("rejects a publicly forged preapproved-run source before the transaction port", async () => {
    const operations: string[] = [];
    const apply = vi.fn(async () =>
      ok({ ...appliedGroup(), approvalSource: "user_preapproved_run" as const })
    );
    const session = createSession(operations, {
      apply
    });

    const result = await session.applyApproved({
      changeSet: { ...changeSet(), writePolicy: "user_preapproved_run" },
      approval: { ...approval(), approvalSource: "user_preapproved_run" }
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VERSION_GROUP_APPROVAL_MISMATCH" }
    });
    expect(apply).not.toHaveBeenCalled();
    expect(operations).toEqual([]);
  });

  test("reports post-commit synchronization failures without turning an applied write into failure", async () => {
    const operations: string[] = [];
    const session = createSession(
      operations,
      {
        async apply() {
          operations.push("transaction");
          return ok(appliedGroup());
        }
      },
      {
        async syncSavedEditor(input) {
          operations.push(`sync-failed:${input.relativePath}`);
          throw new Error("editor unavailable");
        },
        async reportPostCommitSyncFailure(input) {
          operations.push(`sync-review:${input.failedHooks.join(",")}`);
        }
      }
    );

    const result = await session.applyApproved({
      changeSet: changeSet(),
      approval: approval()
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        transactionStatus: "applied",
        synchronization: {
          status: "recovery_required",
          failedHooks: ["syncSavedEditor"]
        }
      }
    });
    expect(operations).toEqual([
      "pause:notes/one.md",
      "transaction",
      "sync-failed:notes/one.md",
      "preserve-dirty:notes/one.md",
      "resume:notes/one.md",
      "sync-review:syncSavedEditor"
    ]);
  });

  test("preserves dirty buffers when preflight fails without a write", async () => {
    const operations: string[] = [];
    const session = createSession(operations, {
      async apply() {
        operations.push("transaction");
        return err(testError("AGENT_WRITE_BASE_CONFLICT"));
      }
    });

    const result = await session.applyApproved({
      changeSet: changeSet(),
      approval: approval()
    });

    expect(result.ok).toBe(false);
    expect(operations).toEqual([
      "pause:notes/one.md",
      "transaction",
      "preserve-dirty:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("surfaces recovery review and never marks clean for partial failure", async () => {
    const operations: string[] = [];
    const session = createSession(operations, {
      async apply() {
        operations.push("transaction");
        return ok(partialGroup());
      }
    });

    const result = await session.applyApproved({
      changeSet: changeSet(),
      approval: approval()
    });

    expect(result.ok && result.value.transactionStatus).toBe("partial_failure");
    expect(operations).toEqual([
      "pause:notes/one.md",
      "transaction",
      "recovery-review:vg_01:partial_failure",
      "resume:notes/one.md"
    ]);
  });

  test("recovers incomplete journals on startup and surfaces unresolved review", async () => {
    const operations: string[] = [];
    const session = createSession(operations, {
      async listIncompleteTransactionPaths() {
        return ok(["notes/one.md"]);
      },
      async recoverIncompleteTransactions() {
        operations.push("recover");
        return ok([partialGroup()]);
      }
    });

    const result = await session.recoverOnStartup();

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/one.md",
      "recover",
      "recovery-review:vg_01:partial_failure",
      "resume:notes/one.md"
    ]);
  });

  test("startup recovery synchronizes rolled-back editors before resuming autosave", async () => {
    const operations: string[] = [];
    const firstWrite = appliedGroup().writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const rolledBack: VersionGroup = {
      ...appliedGroup(),
      transactionStatus: "rolled_back",
      failureKind: "write_failure",
      undoStatus: "not_available",
      writes: [{ ...firstWrite, status: "rolled_back" }]
    };
    const session = createSession(operations, {
      async listIncompleteTransactionPaths() {
        return ok(["notes/one.md"]);
      },
      async recoverIncompleteTransactions() {
        operations.push("recover");
        return ok([rolledBack]);
      }
    });

    const result = await session.recoverOnStartup();

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/one.md",
      "recover",
      `sync:notes/one.md:Saved:${"a".repeat(64)}`,
      "recovery-clean:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("pauses autosave while run undo restores files and synchronizes Saved editors", async () => {
    const operations: string[] = [];
    const session = createSession(operations, {
      async undoRun(input) {
        operations.push(`undo-run:${input.runId}`);
        return ok({ ...appliedGroup(), undoStatus: "completed" });
      }
    });

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/one.md"]
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/one.md",
      "undo-run:run_01",
      `sync:notes/one.md:Saved:${"b".repeat(64)}`,
      "recovery-clean:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("keeps clean run undo recovery dirty when editor synchronization fails", async () => {
    const operations: string[] = [];
    const session = createSession(
      operations,
      {
        async undoRun() {
          return ok({ ...appliedGroup(), undoStatus: "completed" });
        }
      },
      {
        async syncSavedEditor(input) {
          operations.push(`sync-failed:${input.relativePath}`);
          throw new Error("dirty editor changed");
        }
      }
    );

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/one.md"]
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.synchronization).toEqual({
      status: "recovery_required",
      failedHooks: ["syncSavedEditor"]
    });
    expect(operations).toEqual([
      "pause:notes/one.md",
      "sync-failed:notes/one.md",
      "preserve-dirty:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("re-reads dirty editor content after pausing autosave", async () => {
    const operations: string[] = [];
    let receivedEditorContents: readonly { readonly relativePath: string; readonly content: string }[] = [];
    const session = createSession(
      operations,
      {
        async undoRun(input) {
          receivedEditorContents = input.currentEditorContents ?? [];
          operations.push("undo-run");
          return ok({ ...appliedGroup(), undoStatus: "completed" });
        }
      },
      {
        async readEditorState(relativePath: string) {
          operations.push(`read-editor:${relativePath}`);
          return { dirty: true, content: "dirty after pause" };
        }
      }
    );

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/one.md"],
      currentEditorContents: [{ relativePath: "notes/one.md", content: "dirty before pause" }]
    });

    expect(result.ok).toBe(true);
    expect(receivedEditorContents).toEqual([
      { relativePath: "notes/one.md", content: "dirty after pause" }
    ]);
    expect(operations.slice(0, 3)).toEqual([
      "pause:notes/one.md",
      "read-editor:notes/one.md",
      "undo-run"
    ]);
  });

  test("synchronizes completed rollback files without cleaning kept user buffers", async () => {
    const operations: string[] = [];
    const base = appliedGroup();
    const firstWrite = base.writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const session = createSession(operations, {
      async undoRun() {
        return ok({
          ...base,
          versionGroupId: "rollback_run_01",
          undoStatus: "completed" as const,
          writes: [
            { ...firstWrite, relativePath: "notes/restored.md", status: "completed" as const },
            { ...firstWrite, relativePath: "notes/kept.md", status: "kept" as const }
          ],
          rollbackReview: {
            schemaVersion: "1.0" as const,
            reviewId: "rollback_run_01",
            runId: "run_01",
            status: "completed" as const,
            sourceVersionGroupIds: ["vg_01"],
            createdAt: "2026-07-13T01:03:00.000Z",
            updatedAt: "2026-07-13T01:03:00.000Z",
            processedCommandIds: [],
            files: []
          }
        });
      }
    });

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/restored.md", "notes/kept.md"]
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/restored.md,notes/kept.md",
      `sync:notes/restored.md:Saved:${"b".repeat(64)}`,
      "recovery-clean:notes/restored.md",
      "preserve-dirty:notes/kept.md",
      "resume:notes/restored.md,notes/kept.md"
    ]);
  });

  test("keeps rollback recovery dirty when editor synchronization fails", async () => {
    const operations: string[] = [];
    const base = appliedGroup();
    const firstWrite = base.writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const session = createSession(
      operations,
      {
        async undoRun() {
          return ok({
            ...base,
            versionGroupId: "rollback_run_sync_failure",
            writes: [{ ...firstWrite, status: "completed" as const }],
            rollbackReview: {
              schemaVersion: "1.0" as const,
              reviewId: "rollback_run_sync_failure",
              runId: "run_01",
              status: "completed" as const,
              sourceVersionGroupIds: ["vg_01"],
              createdAt: "2026-07-13T01:03:00.000Z",
              updatedAt: "2026-07-13T01:03:00.000Z",
              processedCommandIds: [],
              files: [
                {
                  relativePath: "notes/one.md",
                  assetType: "text" as const,
                  baselineContent: "baseline",
                  baselineChecksum: "b".repeat(64),
                  baselineVersionId: "ver-baseline",
                  runLastWriteContent: "agent",
                  runLastWriteChecksum: "c".repeat(64),
                  reviewedCurrentContent: "dirty A",
                  reviewedCurrentChecksum: "d".repeat(64),
                  reviewedEditorChecksum: "a".repeat(64),
                  diff: {
                    currentToLastWrite: "current -> agent",
                    currentToBaseline: "current -> baseline",
                    lastWriteToBaseline: "agent -> baseline"
                  },
                  decision: "restore_baseline" as const,
                  status: "completed" as const
                }
              ]
            }
          });
        }
      },
      {
        async syncSavedEditor(input) {
          operations.push(
            `sync-failed:${input.relativePath}:${input.expectedDirtyChecksum ?? "missing"}`
          );
          throw new Error("dirty editor");
        }
      }
    );

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/one.md"]
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.synchronization).toEqual({
      status: "recovery_required",
      failedHooks: ["syncSavedEditor"]
    });
    expect(operations).toEqual([
      "pause:notes/one.md",
      `sync-failed:notes/one.md:${"a".repeat(64)}`,
      "preserve-dirty:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("does not mask a completed rollback when dirty-buffer preservation fails", async () => {
    const operations: string[] = [];
    const base = appliedGroup();
    const firstWrite = base.writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const session = createSession(
      operations,
      {
        async undoRun() {
          return ok({
            ...base,
            versionGroupId: "rollback_run_preserve_failure",
            writes: [{ ...firstWrite, status: "completed" as const }],
            rollbackReview: {
              schemaVersion: "1.0" as const,
              reviewId: "rollback_run_preserve_failure",
              runId: "run_01",
              status: "completed" as const,
              sourceVersionGroupIds: ["vg_01"],
              createdAt: "2026-07-13T01:03:00.000Z",
              updatedAt: "2026-07-13T01:03:00.000Z",
              processedCommandIds: [],
              files: []
            }
          });
        }
      },
      {
        async syncSavedEditor() {
          operations.push("sync-failed");
          throw new Error("editor changed");
        },
        async preserveDirtyBuffers() {
          operations.push("preserve-failed");
          throw new Error("recovery unavailable");
        }
      }
    );

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/one.md"]
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.synchronization).toEqual({
      status: "recovery_required",
      failedHooks: ["syncSavedEditor", "preserveDirtyBuffers"]
    });
    expect(operations).toEqual([
      "pause:notes/one.md",
      "sync-failed",
      "preserve-failed",
      "resume:notes/one.md"
    ]);
  });

  test("preserves kept buffers alongside failed files in a partial rollback", async () => {
    const operations: string[] = [];
    const base = appliedGroup();
    const firstWrite = base.writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const session = createSession(operations, {
      async undoRun() {
        return ok({
          ...base,
          versionGroupId: "rollback_run_01",
          transactionStatus: "partial_failure" as const,
          failureKind: "undo_failure" as const,
          undoStatus: "partial_failure" as const,
          writes: [
            { ...firstWrite, relativePath: "notes/restored.md", status: "completed" as const },
            { ...firstWrite, relativePath: "notes/kept.md", status: "kept" as const },
            {
              ...firstWrite,
              relativePath: "notes/failed.md",
              status: "rollback_failed" as const
            }
          ],
          rollbackReview: {
            schemaVersion: "1.0" as const,
            reviewId: "rollback_run_01",
            runId: "run_01",
            status: "partial_failure" as const,
            sourceVersionGroupIds: ["vg_01"],
            createdAt: "2026-07-13T01:03:00.000Z",
            updatedAt: "2026-07-13T01:03:00.000Z",
            processedCommandIds: [],
            files: []
          }
        });
      }
    });

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/restored.md", "notes/kept.md", "notes/failed.md"]
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/restored.md,notes/kept.md,notes/failed.md",
      `sync:notes/restored.md:Saved:${"b".repeat(64)}`,
      "recovery-clean:notes/restored.md",
      "preserve-dirty:notes/kept.md",
      "preserve-dirty:notes/failed.md",
      "recovery-review:rollback_run_01:partial_failure",
      "resume:notes/restored.md,notes/kept.md,notes/failed.md"
    ]);
  });

  test("does not mask a partial rollback when recovery hooks fail", async () => {
    const operations: string[] = [];
    const base = appliedGroup();
    const firstWrite = base.writes[0];
    if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
    const session = createSession(
      operations,
      {
        async undoRun() {
          return ok({
            ...base,
            versionGroupId: "rollback_run_hook_failure",
            transactionStatus: "partial_failure" as const,
            failureKind: "undo_failure" as const,
            undoStatus: "partial_failure" as const,
            writes: [
              { ...firstWrite, relativePath: "notes/kept.md", status: "kept" as const },
              {
                ...firstWrite,
                relativePath: "notes/failed.md",
                status: "rollback_failed" as const
              }
            ],
            rollbackReview: {
              schemaVersion: "1.0" as const,
              reviewId: "rollback_run_hook_failure",
              runId: "run_01",
              status: "partial_failure" as const,
              sourceVersionGroupIds: ["vg_01"],
              createdAt: "2026-07-13T01:03:00.000Z",
              updatedAt: "2026-07-13T01:03:00.000Z",
              processedCommandIds: [],
              files: []
            }
          });
        }
      },
      {
        async preserveDirtyBuffers(relativePaths) {
          operations.push(`preserve-failed:${relativePaths.join(",")}`);
          throw new Error("recovery unavailable");
        },
        async surfaceTransactionRecoveryReview() {
          operations.push("review-failed");
          throw new Error("review unavailable");
        }
      }
    );

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/kept.md", "notes/failed.md"]
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.synchronization).toEqual({
      status: "recovery_required",
      failedHooks: ["preserveDirtyBuffers", "surfaceTransactionRecoveryReview"]
    });
    expect(operations).toEqual([
      "pause:notes/kept.md,notes/failed.md",
      "preserve-failed:notes/kept.md",
      "preserve-failed:notes/failed.md",
      "review-failed",
      "resume:notes/kept.md,notes/failed.md"
    ]);
  });

  test("routes a single-write undo through the same autosave and Saved synchronization hooks", async () => {
    const operations: string[] = [];
    const session = createSession(operations, {
      async undoWrite(input) {
        operations.push(`undo-write:${input.versionGroupId}:${input.writeId}`);
        return ok({ ...appliedGroup(), undoStatus: "completed" });
      }
    });

    const result = await session.undoWrite({
      versionGroupId: "vg_01",
      writeId: "write_01",
      relativePath: "notes/one.md"
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/one.md",
      "undo-write:vg_01:write_01",
      `sync:notes/one.md:Saved:${"b".repeat(64)}`,
      "recovery-clean:notes/one.md",
      "resume:notes/one.md"
    ]);
  });

  test("rejects a stale approval before pausing autosave or calling the transaction", async () => {
    const operations: string[] = [];
    const session = createSession(operations);

    const result = await session.applyApproved({
      changeSet: changeSet(),
      approval: {
        ...approval(),
        binding: { ...approval().binding, checksum: "f".repeat(64) }
      }
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("VERSION_GROUP_APPROVAL_MISMATCH");
    expect(operations).toEqual([]);
  });
});

function createSession(
  operations: string[],
  transactionOverrides: Partial<VersionGroupSessionTransactionPort> = {},
  hookOverrides: Partial<VersionGroupSessionHooks> = {}
) {
  const transaction: VersionGroupSessionTransactionPort = {
    async listIncompleteTransactionPaths() {
      return ok([]);
    },
    async apply() {
      operations.push("unexpected-apply");
      return ok(appliedGroup());
    },
    async recoverIncompleteTransactions() {
      return ok([]);
    },
    async undoVersionGroup() {
      return ok({ ...appliedGroup(), undoStatus: "completed" });
    },
    async undoWrite() {
      return ok({ ...appliedGroup(), undoStatus: "completed" });
    },
    async undoRun() {
      return ok({ ...appliedGroup(), undoStatus: "completed" });
    },
    ...transactionOverrides
  };
  return createVersionGroupSession({
    transaction,
    hooks: {
      async pauseAutosave(relativePaths) {
        operations.push(`pause:${relativePaths.join(",")}`);
      },
      async resumeAutosave(relativePaths) {
        operations.push(`resume:${relativePaths.join(",")}`);
      },
      async syncSavedEditor(input) {
        operations.push(
          `sync:${input.relativePath}:${input.saveStatus}:${input.content ?? input.checksum}`
        );
      },
      async preserveDirtyBuffers(relativePaths) {
        operations.push(`preserve-dirty:${relativePaths.join(",")}`);
      },
      async markRecoveryClean(relativePaths) {
        operations.push(`recovery-clean:${relativePaths.join(",")}`);
      },
      async surfaceTransactionRecoveryReview(group) {
        operations.push(`recovery-review:${group.versionGroupId}:${group.transactionStatus}`);
      },
      ...hookOverrides
    }
  });
}

function changeSet(): ChangeSet {
  return {
    schemaVersion: "1.0",
    changeSetId: "changes_01",
    revision: 1,
    runId: "run_01",
    projectId: "project_01",
    checkpointId: "checkpoint_01",
    contextSnapshotId: "context_01",
    status: "awaiting_approval",
    checksum: "c".repeat(64),
    approvalToken: "token_01",
    createdAt: "2026-07-13T01:00:00.000Z",
    files: [
      {
        relativePath: "notes/one.md",
        assetType: "text",
        baseChecksum: "a".repeat(64),
        candidateChecksum: "b".repeat(64),
        baseContent: "base",
        candidateContent: "agent",
        selected: true,
        hunks: [],
        validation: {
          valid: true,
          utf8: { status: "valid" },
          syntax: { status: "not_applicable" },
          schema: { status: "not_applicable" },
          asset: { status: "not_applicable" }
        }
      }
    ]
  };
}

function approval(): ChangeSetApproval {
  return {
    schemaVersion: "1.0",
    decision: "apply_selected",
    approvalSource: "human_confirmation",
    resolvedAt: "2026-07-13T01:01:00.000Z",
    binding: {
      changeSetId: "changes_01",
      revision: 1,
      checksum: "c".repeat(64),
      approvalToken: "token_01"
    }
  };
}

function appliedGroup(): VersionGroup {
  return {
    schemaVersion: "1.0",
    versionGroupId: "vg_01",
    runId: "run_01",
    checkpointId: "checkpoint_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: "c".repeat(64),
    createdAt: "2026-07-13T01:02:00.000Z",
    transactionStatus: "applied",
    undoStatus: "available",
    writes: [
      {
        writeId: "write_01",
        relativePath: "notes/one.md",
        assetType: "text",
        beforeChecksum: "a".repeat(64),
        afterChecksum: "b".repeat(64),
        beforeVersionId: "ver_01",
        status: "applied"
      }
    ],
    baselineByPath: {
      "notes/one.md": {
        relativePath: "notes/one.md",
        checksum: "a".repeat(64),
        beforeVersionId: "ver_01"
      }
    },
    undoMetadata: {
      runId: "run_01",
      versionGroupId: "vg_01",
      baselineVersionIds: { "notes/one.md": "ver_01" },
      lastWriteChecksums: { "notes/one.md": "b".repeat(64) }
    }
  };
}

function partialGroup(): VersionGroup {
  const group = appliedGroup();
  const firstWrite = group.writes[0];
  if (firstWrite === undefined) throw new Error("Expected an applied write fixture.");
  return {
    ...group,
    transactionStatus: "partial_failure",
    failureKind: "partial_failure",
    undoStatus: "partial_failure",
    writes: [
      {
        ...firstWrite,
        status: "rollback_failed",
        errorCode: "AGENT_WRITE_ROLLBACK_FAILED"
      }
    ]
  };
}

function testError(code: string) {
  return {
    schemaVersion: "1.0" as const,
    errorId: "err_test",
    code,
    category: "ValidationError" as const,
    message: "Test error.",
    recoverability: "user-action" as const,
    suggestedAction: "Review and retry.",
    traceId: "test",
    createdAt: "2026-07-13T01:00:00.000Z"
  };
}
