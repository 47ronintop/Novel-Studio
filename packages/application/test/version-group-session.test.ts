import { describe, expect, test } from "vitest";

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
