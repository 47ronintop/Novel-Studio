import { describe, expect, test } from "vitest";

import type { VersionGroup } from "@novel-studio/agent-engine";
import { ok } from "@novel-studio/shared";

import {
  createVersionGroupSession,
  type VersionGroupSessionHooks,
  type VersionGroupSessionTransactionPort
} from "../src/version-group-session.js";

describe("conflict-aware run undo", () => {
  test("surfaces rollback review while synchronizing only files restored without conflict", async () => {
    const operations: string[] = [];
    const group = awaitingReviewGroup();
    const transaction: VersionGroupSessionTransactionPort = {
      async listIncompleteTransactionPaths() {
        return ok([]);
      },
      async apply() {
        throw new Error("not used");
      },
      async recoverIncompleteTransactions() {
        return ok([]);
      },
      async undoVersionGroup() {
        throw new Error("not used");
      },
      async undoWrite() {
        throw new Error("not used");
      },
      async undoRun() {
        operations.push("transaction");
        return ok(group);
      }
    };
    const hooks: VersionGroupSessionHooks = {
      async pauseAutosave(paths) {
        operations.push(`pause:${paths.join(",")}`);
      },
      async resumeAutosave(paths) {
        operations.push(`resume:${paths.join(",")}`);
      },
      async syncSavedEditor(input) {
        operations.push(`sync:${input.relativePath}:${input.checksum}`);
      },
      async preserveDirtyBuffers(paths) {
        operations.push(`preserve:${paths.join(",")}`);
      },
      async markRecoveryClean(paths) {
        operations.push(`clean:${paths.join(",")}`);
      },
      async surfaceTransactionRecoveryReview(input) {
        operations.push(`review:${input.versionGroupId}`);
      }
    };
    const session = createVersionGroupSession({ transaction, hooks });

    const result = await session.undoRun({
      runId: "run_01",
      relativePaths: ["notes/direct.md", "notes/conflict.md"]
    });

    expect(result.ok).toBe(true);
    expect(operations).toEqual([
      "pause:notes/direct.md,notes/conflict.md",
      "transaction",
      `sync:notes/direct.md:${"a".repeat(64)}`,
      "clean:notes/direct.md",
      "preserve:notes/conflict.md",
      "review:rollback_run_01",
      "resume:notes/direct.md,notes/conflict.md"
    ]);
  });
});

function awaitingReviewGroup(): VersionGroup {
  return {
    schemaVersion: "1.0",
    versionGroupId: "rollback_run_01",
    runId: "run_01",
    checkpointId: "checkpoint_02",
    changeSetId: "undo_run_01",
    changeSetRevision: 0,
    changeSetChecksum: "c".repeat(64),
    createdAt: "2026-07-13T01:00:00.000Z",
    transactionStatus: "awaiting_review",
    undoStatus: "review_required",
    writes: [
      {
        writeId: "rollback_direct",
        relativePath: "notes/direct.md",
        assetType: "text",
        beforeChecksum: "b".repeat(64),
        afterChecksum: "a".repeat(64),
        beforeVersionId: "ver_direct",
        status: "completed"
      },
      {
        writeId: "rollback_conflict",
        relativePath: "notes/conflict.md",
        assetType: "text",
        beforeChecksum: "d".repeat(64),
        afterChecksum: "e".repeat(64),
        beforeVersionId: "ver_conflict",
        status: "conflict",
        errorCode: "AGENT_WRITE_UNDO_CONFLICT"
      }
    ],
    baselineByPath: {
      "notes/direct.md": {
        relativePath: "notes/direct.md",
        checksum: "a".repeat(64),
        beforeVersionId: "ver_direct"
      },
      "notes/conflict.md": {
        relativePath: "notes/conflict.md",
        checksum: "e".repeat(64),
        beforeVersionId: "ver_conflict"
      }
    },
    undoMetadata: {
      runId: "run_01",
      versionGroupId: "rollback_run_01",
      baselineVersionIds: {
        "notes/direct.md": "ver_direct",
        "notes/conflict.md": "ver_conflict"
      },
      lastWriteChecksums: {
        "notes/direct.md": "b".repeat(64),
        "notes/conflict.md": "f".repeat(64)
      }
    },
    rollbackReview: {
      schemaVersion: "1.0",
      reviewId: "rollback_run_01",
      runId: "run_01",
      status: "pending",
      sourceVersionGroupIds: ["vg_01", "vg_02"],
      createdAt: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T01:00:00.000Z",
      processedCommandIds: [],
      files: []
    }
  };
}
