import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { err, ok } from "@novel-studio/shared";
import { deriveChangeSetGroupApprovalToken } from "@novel-studio/agent-engine";

import {
  AgentWriteTransaction,
  type AgentWriteLifecycleMutation,
  type AgentWriteLifecycleOperationPort,
  type AgentWriteTransactionOptions,
  type AgentWriteTrustedCreativeMutationPort
} from "../src/agent-write-transaction.js";
import { writeTextAtomically } from "../src/atomic-write.js";
import { HistoryRepository } from "../src/history-repository.js";
import { ProjectLockFileRepository } from "../src/project-lock-repository.js";
import type {
  AgentTransactionJournal,
  AgentOperationPathSnapshot,
  AgentWriteHistoryPort,
  AgentWriteProjectLockPort,
  AgentWriteRecoveryPort,
  AgentWriteTransactionInput
} from "../src/ports.js";
import { RecoveryRepository } from "../src/recovery-repository.js";
import { createTrustedCreativeFileOperationsPort } from "../src/trusted-creative-file-operations.js";

const tempRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("AgentWriteTransaction", () => {
  test("rejects revision zero before creating transaction artifacts", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations)
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")], {
        revision: 0,
        approvalToken: approvalToken("changes_01", 0, "c".repeat(64))
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_INPUT_INVALID" }
    });
    expect(operations).not.toContainEqual(expect.stringMatching(/^(snapshot|journal|replace):/));
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("rejects a Story Bible status proof attached to a non-Story-Bible path", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations)
    });
    const file = {
      ...fileChange("notes/one.md", "before", "after", "text"),
      storyBibleStatusProof: {
        action: "delete" as const,
        deletionImpactChecksum: "a".repeat(64)
      }
    };

    const result = await transaction.apply(createInput([file]));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_INPUT_INVALID" }
    });
    expect(operations).toEqual([]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("requires the currently owned project lock lease", async () => {
    const projectRoot = await createProject({});
    const owner = new ProjectLockFileRepository({ projectRoot, ownerId: "window_owner" });
    const other = new ProjectLockFileRepository({ projectRoot, ownerId: "window_other" });
    const acquired = await owner.acquireProjectLock();
    if (!acquired.ok) throw new Error(acquired.error.message);

    const owned = await owner.verifyProjectLockOwnership();
    const rejected = await other.verifyProjectLockOwnership();

    expect(owned).toEqual(ok(undefined));
    expect(rejected.ok).toBe(false);
    expect(!rejected.ok && rejected.error.code).toBe("PROJECT_LOCK_OWNER_MISMATCH");
  });

  test("rejects a project lock directory junction outside the project root", async () => {
    const projectRoot = await createProject({});
    const outsideRoot = await createProject({});
    await symlink(outsideRoot, join(projectRoot, ".novel-studio"), "junction");
    const lock = new ProjectLockFileRepository({ projectRoot, ownerId: "window_owner" });

    const result = await lock.acquireProjectLock();

    expect(result.ok).toBe(false);
    await expect(readFile(join(outsideRoot, "project-lock.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("rejects a transaction journal directory junction outside the project root", async () => {
    const projectRoot = await createProject({});
    const outsideRoot = await createProject({});
    await symlink(outsideRoot, join(projectRoot, "history"), "junction");
    const recovery = new RecoveryRepository({ projectRoot });

    const result = await recovery.writeAgentTransactionJournal(
      appliedJournal({
        transactionId: "tx_outside_junction",
        versionGroupId: "vg_outside_junction",
        runSequence: 1,
        beforeContent: "before",
        candidateContent: "candidate",
        beforeVersionId: "ver_before"
      })
    );

    expect(result.ok).toBe(false);
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  test("rejects the internal project lock path as an Agent write target", async () => {
    const lockContent = '{"schemaVersion":"1.0","ownerId":"window_owner"}\n';
    const relativePath = ".novel-studio/project-lock.json";
    const projectRoot = await createProject({ [relativePath]: lockContent });
    const transaction = createTransaction(projectRoot);

    const result = await transaction.apply(
      createInput([fileChange(relativePath, lockContent, "{}\n", "text")])
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_PATH_REJECTED" }
    });
    expect(await readFile(join(projectRoot, relativePath), "utf8")).toBe(lockContent);
  });

  test("atomic replacement keeps the target unchanged when final verification rejects", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const targetPath = join(projectRoot, "notes/one.md");

    const result = await writeTextAtomically({
      targetPath,
      content: "after",
      beforeReplace: async () => err(transactionTestError("AGENT_WRITE_BASE_CONFLICT"))
    });

    expect(result.ok).toBe(false);
    expect(await readFile(targetPath, "utf8")).toBe("before");
  });

  test("rechecks project lock ownership immediately before replacement", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    let lockChecks = 0;
    const transaction = createTransaction(projectRoot, {
      projectLock: {
        async verifyProjectLockOwnership() {
          lockChecks += 1;
          return lockChecks === 1
            ? ok(undefined)
            : err(transactionTestError("PROJECT_LOCK_OWNER_MISMATCH"));
        }
      }
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.transactionStatus).toBe("rolled_back");
    expect(lockChecks).toBeGreaterThan(1);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("rejects the full batch before snapshots or replacements when one base is stale", async () => {
    const projectRoot = await createProject({
      "chapters/one.md": "one before",
      "chapters/two.md": "two changed"
    });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations)
    });
    const input = createInput([
      fileChange("chapters/one.md", "one before", "one after", "chapter"),
      fileChange("chapters/two.md", "two before", "two after", "chapter")
    ]);

    const result = await transaction.apply(input);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected stale preflight failure.");
    expect(result.error.code).toBe("AGENT_WRITE_BASE_CONFLICT");
    expect(operations).toEqual(["lock"]);
    expect(await readFile(join(projectRoot, "chapters/one.md"), "utf8")).toBe("one before");
  });

  test("creates every before snapshot and the journal before the first replacement", async () => {
    const projectRoot = await createProject({
      "chapters/one.md": "one before",
      "notes/two.md": "two before"
    });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations)
    });

    const result = await transaction.apply(
      createInput([
        fileChange("chapters/one.md", "one before", "one after", "chapter"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const firstReplace = operations.indexOf("replace:apply:chapters/one.md");
    expect(operations[0]).toBe("lock");
    expect(operations.indexOf("snapshot:chapters/one.md:before-agent-write")).toBeLessThan(
      firstReplace
    );
    expect(operations.indexOf("snapshot:notes/two.md:before-agent-write")).toBeLessThan(
      firstReplace
    );
    expect(operations.indexOf("journal:prepared")).toBeLessThan(firstReplace);
    expect(result.value.transactionStatus).toBe("applied");
    expect(result.value.writes.map((write) => write.afterChecksum)).toEqual([
      checksum("one after"),
      checksum("two after")
    ]);
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two after");
  });

  test("records an aborted preparation when a later before snapshot fails", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    let snapshots = 0;
    const successfulHistory = recordingHistory([]);
    const transaction = createTransaction(projectRoot, {
      historyRepository: {
        async snapshotTextAsset(input) {
          snapshots += 1;
          return snapshots === 2
            ? err(transactionTestError("AGENT_WRITE_SNAPSHOT_FAILED"))
            : successfulHistory.snapshotTextAsset(input);
        }
      }
    });

    const result = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_SNAPSHOT_FAILED" } });
    const journals = await readJournals(projectRoot);
    expect(journals).toHaveLength(1);
    expect(journals[0]).toMatchObject({ transactionStatus: "rolled_back" });
    expect(journals[0]?.entries).toHaveLength(1);
    expect(journals[0]?.entries[0]?.status).toBe("rolled_back");
  });

  test("records an aborted preparation when the first prepared journal write fails", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: failingJournalRecovery(projectRoot, 1)
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TRANSACTION_JOURNAL_WRITE_FAILED" }
    });
    const journal = await readOnlyJournal(projectRoot);
    expect(journal.transactionStatus).toBe("rolled_back");
    expect(journal.entries[0]?.status).toBe("rolled_back");
  });

  test("persists the human approval binding before the first replacement", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const persisted: AgentTransactionJournal[] = [];
    const backingRecovery = recordingRecovery([]);
    let journalBeforeFirstReplace: AgentTransactionJournal | undefined;
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: {
        async writeAgentTransactionJournal(journal) {
          persisted.push(structuredClone(journal));
          return backingRecovery.writeAgentTransactionJournal(journal);
        },
        readAgentTransactionJournal: (transactionId) =>
          backingRecovery.readAgentTransactionJournal(transactionId),
        listAgentTransactionJournals: () => backingRecovery.listAgentTransactionJournals()
      },
      failReplace: () => {
        journalBeforeFirstReplace ??= persisted.at(-1);
        return false;
      }
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result.ok).toBe(true);
    expect(persisted[0]).toMatchObject({
      transactionStatus: "prepared",
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: approvalToken("changes_01", 1, "c".repeat(64))
    });
    expect(journalBeforeFirstReplace).toMatchObject({
      transactionStatus: "applying",
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: approvalToken("changes_01", 1, "c".repeat(64))
    });
  });

  test("returns apply validation errors before snapshots, journals, or mutations", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const operations: string[] = [];
    const backingRecovery = recordingRecovery(operations);
    const recoveryRepository: AgentWriteRecoveryPort = {
      writeAgentTransactionJournal: (journal) =>
        backingRecovery.writeAgentTransactionJournal(journal),
      readAgentTransactionJournal: (transactionId) =>
        backingRecovery.readAgentTransactionJournal(transactionId),
      async listAgentTransactionJournals() {
        operations.push("list");
        return backingRecovery.listAgentTransactionJournals();
      }
    };
    const validateApply = vi.fn(async (input: AgentWriteTransactionInput) => {
      operations.push("validate");
      expect(input.consistencyGroupId).toBe("fact_validation_01");
      return err(transactionTestError("STORY_BIBLE_GROUP_INVALID"));
    });
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository,
      validateApply
    });
    const selectionChecksum = "e".repeat(64);
    const input = createInput([fileChange("notes/one.md", "before", "after", "text")], {
      applyBatchId: "apply_batch_validation_01",
      consistencyGroupId: "fact_validation_01",
      selectionChecksum,
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_validation_01",
        consistencyGroupId: "fact_validation_01",
        selectionChecksum
      })
    });

    const result = await transaction.apply(input);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_GROUP_INVALID" }
    });
    expect(operations).toEqual(["lock", "list", "validate"]);
    expect(validateApply).toHaveBeenCalledOnce();
    expect(await backingRecovery.listAgentTransactionJournals()).toEqual(ok([]));
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("persists group metadata and returns the first result for an idempotent apply retry", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const operations: string[] = [];
    const recoveryRepository = recordingRecovery(operations);
    const validateApply = vi.fn(async () => ok(undefined));
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository,
      validateApply
    });
    const selectionChecksum = "e".repeat(64);
    const groupedInput = createInput([fileChange("notes/one.md", "before", "after", "text")], {
      applyBatchId: "apply_batch_01",
      consistencyGroupId: "fact_location_01",
      selectionChecksum,
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_01",
        consistencyGroupId: "fact_location_01",
        selectionChecksum
      })
    });

    const first = await transaction.apply(groupedInput);
    const repeated = await transaction.apply(groupedInput);

    expect(first).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        applyBatchId: "apply_batch_01",
        consistencyGroupId: "fact_location_01",
        selectionChecksum
      }
    });
    expect(repeated).toEqual(first);
    expect(validateApply).toHaveBeenCalledOnce();
    expect(
      operations.filter((operation) => operation === "replace:apply:notes/one.md")
    ).toHaveLength(1);
    await expect(recoveryRepository.listAgentTransactionJournals()).resolves.toMatchObject({
      ok: true,
      value: [
        {
          schemaVersion: "1.1",
          applyBatchId: "apply_batch_01",
          consistencyGroupId: "fact_location_01",
          selectionChecksum
        }
      ]
    });
  });

  test("round-trips a v1.1 grouped journal through the filesystem repository", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const selectionChecksum = "e".repeat(64);
    const groupedInput = createInput([fileChange("notes/one.md", "before", "after", "text")], {
      applyBatchId: "apply_batch_round_trip",
      consistencyGroupId: "fact_location_round_trip",
      selectionChecksum,
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_round_trip",
        consistencyGroupId: "fact_location_round_trip",
        selectionChecksum
      })
    });

    const applied = await createTransaction(projectRoot).apply(groupedInput);
    const listed = await new RecoveryRepository({
      projectRoot
    }).listAgentTransactionJournals();

    expect(applied.ok).toBe(true);
    expect(listed).toMatchObject({
      ok: true,
      value: [
        {
          schemaVersion: "1.1",
          transactionStatus: "applied",
          applyBatchId: "apply_batch_round_trip",
          consistencyGroupId: "fact_location_round_trip",
          selectionChecksum
        }
      ]
    });
  });

  test("projects Story Bible revisions, History identity, suggestions, and inverse patch", async () => {
    const before = JSON.stringify({
      schemaVersion: "1.1",
      id: "char_hero",
      type: "character",
      revision: 1,
      title: "Hero"
    });
    const after = JSON.stringify({
      schemaVersion: "1.1",
      id: "char_hero",
      type: "character",
      revision: 2,
      title: "Changed Hero"
    });
    const projectRoot = await createProject({ "characters/hero.json": before });
    const selectionChecksum = "e".repeat(64);
    const input = createInput([fileChange("characters/hero.json", before, after, "text")], {
      applyBatchId: "apply_batch_receipt",
      consistencyGroupId: "fact_character_receipt",
      selectionChecksum,
      storyBibleSuggestionIds: ["sug_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_receipt",
        consistencyGroupId: "fact_character_receipt",
        selectionChecksum
      })
    });

    const applied = await createTransaction(projectRoot).apply(input);

    expect(applied).toMatchObject({
      ok: true,
      value: {
        storyBibleReceipt: {
          schemaVersion: "1.0",
          changeSetId: "changes_01",
          consistencyGroupId: "fact_character_receipt",
          suggestionIds: ["sug_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          assets: [
            {
              assetId: "char_hero",
              relativePath: "characters/hero.json",
              beforeRevision: 1,
              afterRevision: 2,
              beforeChecksum: expect.any(String),
              afterChecksum: expect.any(String),
              historyVersionId: expect.any(String),
              inversePatch: expect.arrayContaining([
                { op: "replace", path: "/revision", value: 1 },
                { op: "replace", path: "/title", value: "Hero" }
              ])
            }
          ]
        }
      }
    });
    expect(Object.isFrozen(applied.ok && applied.value.storyBibleReceipt)).toBe(true);
  });

  test("persists the History identity for a Story Bible create receipt", async () => {
    const projectRoot = await createProject({});
    await mkdir(join(projectRoot, "characters"));
    const content = JSON.stringify({
      schemaVersion: "1.1",
      id: `chr_${"c".repeat(32)}`,
      type: "character",
      revision: 1,
      title: "Created character"
    });
    const selectionChecksum = "e".repeat(64);
    const input = createInput([], {
      applyBatchId: "apply_batch_create_receipt",
      consistencyGroupId: "fact_create_receipt",
      selectionChecksum,
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_create_receipt",
        consistencyGroupId: "fact_create_receipt",
        selectionChecksum
      }),
      operations: [
        {
          kind: "create_file",
          operationId: "create_character",
          toolCallIdempotencyKey: "tool_create_character",
          relativePath: `characters/chr_${"c".repeat(32)}.json`,
          content
        }
      ]
    });

    const applied = await createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    }).apply(input);

    if (!applied.ok) throw new Error(JSON.stringify(applied.error));
    expect(applied).toMatchObject({
      ok: true,
      value: {
        storyBibleReceipt: {
          assets: [
            {
              assetId: `chr_${"c".repeat(32)}`,
              beforeRevision: null,
              beforeChecksum: null,
              afterRevision: 1,
              historyVersionId: expect.any(String),
              inversePatch: [{ op: "remove", path: "" }]
            }
          ]
        }
      }
    });
    const journals = await new RecoveryRepository({
      projectRoot
    }).listAgentTransactionJournals();
    expect(journals.ok).toBe(true);
    if (!journals.ok) throw new Error(journals.error.message);
    expect(journals.value).toHaveLength(1);
    expect(journals.value[0]?.storyBibleReceipt?.assets[0]?.historyVersionId).toEqual(
      expect.any(String)
    );
  });

  test("rejects different content that reuses a grouped apply idempotency key", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const transaction = createTransaction(projectRoot);
    const selectionChecksum = "e".repeat(64);
    const groupBinding = {
      applyBatchId: "apply_batch_conflict",
      consistencyGroupId: "fact_location_conflict",
      selectionChecksum,
      approvalToken: deriveChangeSetGroupApprovalToken({
        changeSetId: "changes_01",
        revision: 1,
        checksum: "c".repeat(64),
        applyBatchId: "apply_batch_conflict",
        consistencyGroupId: "fact_location_conflict",
        selectionChecksum
      })
    } as const;

    const first = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")], groupBinding)
    );
    const conflicting = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "different", "text")], groupBinding)
    );

    expect(first.ok).toBe(true);
    expect(conflicting).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_IDEMPOTENCY_CONFLICT" }
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("after");
  });

  test("recovers an incomplete grouped journal when the same apply is retried", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    const selectionChecksum = "e".repeat(64);
    const groupedInput = createInput(
      [
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ],
      {
        applyBatchId: "apply_batch_recovery",
        consistencyGroupId: "fact_location_recovery",
        selectionChecksum,
        approvalToken: deriveChangeSetGroupApprovalToken({
          changeSetId: "changes_01",
          revision: 1,
          checksum: "c".repeat(64),
          applyBatchId: "apply_batch_recovery",
          consistencyGroupId: "fact_location_recovery",
          selectionChecksum
        })
      }
    );
    const failing = createTransaction(projectRoot, {
      failReplace: ({ phase, relativePath }) =>
        (phase === "apply" && relativePath === "notes/two.md") || phase === "compensate"
    });

    const validateApply = vi.fn(async () => err(transactionTestError("STORY_BIBLE_GROUP_INVALID")));
    const first = await failing.apply(groupedInput);
    const retried = await createTransaction(projectRoot, { validateApply }).apply(groupedInput);
    const journals = await readJournals(projectRoot);

    expect(first.ok && first.value.transactionStatus).toBe("partial_failure");
    expect(retried).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        transactionStatus: "rolled_back",
        applyBatchId: "apply_batch_recovery",
        consistencyGroupId: "fact_location_recovery"
      }
    });
    expect(journals).toHaveLength(1);
    expect(validateApply).not.toHaveBeenCalled();
    expect(journals[0]?.transactionStatus).toBe("rolled_back");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one before");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two before");
  });

  test("keeps apply validation inside the transaction exclusive section", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    let releaseValidation: (() => void) | undefined;
    let signalValidationStarted: (() => void) | undefined;
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const validationStarted = new Promise<void>((resolve) => {
      signalValidationStarted = resolve;
    });
    const validateApply = vi.fn(async () => {
      signalValidationStarted?.();
      await validationGate;
      return ok(undefined);
    });
    const transaction = createTransaction(projectRoot, { validateApply });
    const input = createInput([fileChange("notes/one.md", "before", "after", "text")]);

    const firstApply = transaction.apply(input);
    await validationStarted;
    const overlappingApply = await transaction.apply(input);
    releaseValidation?.();
    const firstResult = await firstApply;

    expect(overlappingApply).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_TRANSACTION_ACTIVE" }
    });
    expect(firstResult.ok).toBe(true);
    expect(validateApply).toHaveBeenCalledOnce();
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("after");
  });

  test("persists a preapproved-run binding before the first replacement", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const persisted: AgentTransactionJournal[] = [];
    const backingRecovery = recordingRecovery([]);
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: {
        async writeAgentTransactionJournal(journal) {
          persisted.push(structuredClone(journal));
          return backingRecovery.writeAgentTransactionJournal(journal);
        },
        readAgentTransactionJournal: (transactionId) =>
          backingRecovery.readAgentTransactionJournal(transactionId),
        listAgentTransactionJournals: () => backingRecovery.listAgentTransactionJournals()
      }
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")], {
        writePolicy: "user_preapproved_run",
        approvalSource: "user_preapproved_run"
      })
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        writePolicy: "user_preapproved_run",
        approvalSource: "user_preapproved_run"
      }
    });
    expect(persisted[0]).toMatchObject({
      transactionStatus: "prepared",
      writePolicy: "user_preapproved_run",
      approvalSource: "user_preapproved_run",
      approvalToken: approvalToken("changes_01", 1, "c".repeat(64))
    });
  });

  test("compensates earlier files when the Nth replacement fails", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      failReplace: ({ phase, relativePath }) => phase === "apply" && relativePath === "notes/two.md"
    });

    const result = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.transactionStatus).toBe("rolled_back");
    expect(result.value.failureKind).toBe("write_failure");
    expect(result.value.writes.map((write) => write.status)).toEqual(["rolled_back", "pending"]);
    expect(operations).toContain("replace:compensate:notes/one.md");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one before");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two before");
  });

  test("persists explicit per-file partial failure when compensation fails", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    const transaction = createTransaction(projectRoot, {
      failReplace: ({ phase, relativePath }) =>
        (phase === "apply" && relativePath === "notes/two.md") ||
        (phase === "compensate" && relativePath === "notes/one.md")
    });

    const result = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      transactionStatus: "partial_failure",
      failureKind: "partial_failure",
      undoStatus: "partial_failure"
    });
    expect(result.value.writes[0]).toMatchObject({
      relativePath: "notes/one.md",
      status: "rollback_failed",
      errorCode: "AGENT_WRITE_ROLLBACK_FAILED"
    });
    const journal = await readOnlyJournal(projectRoot);
    expect(journal.transactionStatus).toBe("partial_failure");
    expect(journal.entries[0]?.status).toBe("rollback_failed");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one after");
  });

  test.each([4, 6])(
    "compensates instead of returning an uncertain error when journal write %i fails",
    async (failedJournalWrite) => {
      const projectRoot = await createProject({
        "notes/one.md": "one before",
        "notes/two.md": "two before"
      });
      const transaction = createTransaction(projectRoot, {
        recoveryRepository: failingJournalRecovery(projectRoot, failedJournalWrite)
      });

      const result = await transaction.apply(
        createInput([
          fileChange("notes/one.md", "one before", "one after", "text"),
          fileChange("notes/two.md", "two before", "two after", "text")
        ])
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.transactionStatus).toBe("rolled_back");
      expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one before");
      expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two before");
    }
  );

  test("closes a prepared journal when the first applying update fails", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: failingJournalRecovery(projectRoot, 2)
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.transactionStatus).toBe("rolled_back");
    expect((await readOnlyJournal(projectRoot)).transactionStatus).toBe("rolled_back");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("does not report rollback success when the final compensation journal cannot persist", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: failingJournalRecoveryFrom(projectRoot, 5),
      failReplace: ({ phase, relativePath }) => phase === "apply" && relativePath === "notes/two.md"
    });

    const result = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TRANSACTION_JOURNAL_WRITE_FAILED" }
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one before");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two before");
  });

  test("startup recovery resumes compensation idempotently", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one before",
      "notes/two.md": "two before"
    });
    const failing = createTransaction(projectRoot, {
      failReplace: ({ phase, relativePath }) =>
        (phase === "apply" && relativePath === "notes/two.md") || phase === "compensate"
    });
    const applied = await failing.apply(
      createInput([
        fileChange("notes/one.md", "one before", "one after", "text"),
        fileChange("notes/two.md", "two before", "two after", "text")
      ])
    );
    expect(applied.ok && applied.value.transactionStatus).toBe("partial_failure");

    const recovering = createTransaction(projectRoot);
    const firstRecovery = await recovering.recoverIncompleteTransactions();
    const secondRecovery = await recovering.recoverIncompleteTransactions();

    expect(firstRecovery.ok).toBe(true);
    if (!firstRecovery.ok) throw new Error(firstRecovery.error.message);
    expect(firstRecovery.value).toHaveLength(1);
    expect(firstRecovery.value[0]?.transactionStatus).toBe("rolled_back");
    expect(secondRecovery).toEqual(ok([]));
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one before");
    expect((await readOnlyJournal(projectRoot)).transactionStatus).toBe("rolled_back");
  });

  test("startup recovery detects a rename completed before its pending journal entry was updated", async () => {
    const projectRoot = await createProject({ "notes/one.md": "candidate" });
    const recovery = new RecoveryRepository({ projectRoot });
    const journal: AgentTransactionJournal = {
      schemaVersion: "1.0",
      transactionId: "tx_crash_window",
      versionGroupId: "vg_crash_window",
      kind: "apply",
      runId: "run_01",
      runSequence: 1,
      checkpointId: "checkpoint_01",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: approvalToken("changes_01", 1, "c".repeat(64)),
      createdAt: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T01:00:01.000Z",
      transactionStatus: "applying",
      entries: [
        {
          writeId: "write_crash_window",
          relativePath: "notes/one.md",
          assetType: "text",
          beforeChecksum: checksum("before"),
          candidateChecksum: checksum("candidate"),
          beforeContent: "before",
          candidateContent: "candidate",
          beforeVersionId: "ver_before",
          status: "pending"
        }
      ]
    };
    const persisted = await recovery.writeAgentTransactionJournal(journal);
    if (!persisted.ok) throw new Error(persisted.error.message);

    const recovered = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(recovered.ok).toBe(true);
    if (!recovered.ok) throw new Error(recovered.error.message);
    expect(recovered.value[0]?.transactionStatus).toBe("rolled_back");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
    expect((await readOnlyJournal(projectRoot)).entries[0]?.status).toBe("rolled_back");
  });

  test("startup recovery never infers a replacement from a prepared journal", async () => {
    const projectRoot = await createProject({ "notes/one.md": "later approved content" });
    const recovery = new RecoveryRepository({ projectRoot });
    const source = appliedJournal({
      transactionId: "tx_prepared_only",
      versionGroupId: "vg_prepared_only",
      runSequence: 1,
      beforeContent: "before",
      candidateContent: "later approved content",
      beforeVersionId: "ver_before"
    });
    const prepared: AgentTransactionJournal = {
      ...source,
      transactionStatus: "prepared",
      entries: source.entries.map((entry) => ({ ...entry, status: "pending" }))
    };
    const persisted = await recovery.writeAgentTransactionJournal(prepared);
    if (!persisted.ok) throw new Error(persisted.error.message);

    const result = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value[0]?.transactionStatus).toBe("rolled_back");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe(
      "later approved content"
    );
    expect((await readOnlyJournal(projectRoot)).entries[0]?.status).toBe("rolled_back");
  });

  test("startup recovery preserves undo failure semantics for a prepared undo journal", async () => {
    const projectRoot = await createProject({ "notes/one.md": "agent content" });
    const recovery = new RecoveryRepository({ projectRoot });
    const applyShape = appliedJournal({
      transactionId: "tx_prepared_undo",
      versionGroupId: "vg_prepared_undo",
      runSequence: 2,
      beforeContent: "agent content",
      candidateContent: "baseline",
      beforeVersionId: "ver_agent"
    });
    const {
      writePolicy: _writePolicy,
      approvalSource: _approvalSource,
      approvalToken: _approvalToken,
      ...withoutApproval
    } = applyShape;
    void _writePolicy;
    void _approvalSource;
    void _approvalToken;
    const preparedUndo: AgentTransactionJournal = {
      ...withoutApproval,
      kind: "run_undo",
      changeSetId: "undo_run_01",
      changeSetRevision: 0,
      transactionStatus: "prepared",
      entries: withoutApproval.entries.map((entry) => ({ ...entry, status: "pending" })),
      undoOfVersionGroupIds: ["vg_original"]
    };
    const persisted = await recovery.writeAgentTransactionJournal(preparedUndo);
    if (!persisted.ok) throw new Error(persisted.error.message);

    const result = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value[0]?.failureKind).toBe("undo_failure");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("agent content");
  });

  test("rejects a recovery journal whose before content does not match its checksum", async () => {
    const projectRoot = await createProject({ "notes/one.md": "candidate" });
    const recovery = new RecoveryRepository({ projectRoot });
    const base = appliedJournal({
      transactionId: "tx_corrupt_recovery",
      versionGroupId: "vg_corrupt_recovery",
      runSequence: 1,
      beforeContent: "before",
      candidateContent: "candidate",
      beforeVersionId: "ver_before"
    });
    const journal: AgentTransactionJournal = {
      ...base,
      transactionStatus: "applying",
      entries: base.entries.map((entry) => ({ ...entry, status: "pending" }))
    };
    const written = await recovery.writeAgentTransactionJournal(journal);
    if (!written.ok) throw new Error(written.error.message);
    const corrupted = {
      ...journal,
      entries: journal.entries.map((entry) => ({ ...entry, beforeContent: "tampered" }))
    };
    await writeFile(
      join(projectRoot, "history", "agent-transactions", `${journal.transactionId}.json`),
      `${JSON.stringify(corrupted, null, 2)}\n`,
      "utf8"
    );

    const result = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TRANSACTION_JOURNAL_INVALID" }
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("candidate");
  });

  test("rejects a recovery journal whose payload id differs from its file name", async () => {
    const projectRoot = await createProject({ "notes/one.md": "candidate" });
    const recovery = new RecoveryRepository({ projectRoot });
    const journal = appliedJournal({
      transactionId: "tx_payload_id",
      versionGroupId: "vg_payload_id",
      runSequence: 1,
      beforeContent: "before",
      candidateContent: "candidate",
      beforeVersionId: "ver_before"
    });
    const journalRoot = join(projectRoot, "history", "agent-transactions");
    await mkdir(journalRoot, { recursive: true });
    await writeFile(
      join(journalRoot, "tx_file_name.json"),
      `${JSON.stringify(journal, null, 2)}\n`,
      "utf8"
    );

    const result = await recovery.readAgentTransactionJournal("tx_file_name");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TRANSACTION_JOURNAL_INVALID" }
    });
  });

  test("normalizes a missing legacy write policy to manual during recovery", async () => {
    const projectRoot = await createProject({ "notes/one.md": "candidate" });
    const journal = appliedJournal({
      transactionId: "tx_legacy_policy",
      versionGroupId: "vg_legacy_policy",
      runSequence: 1,
      beforeContent: "before",
      candidateContent: "candidate",
      beforeVersionId: "ver_before"
    });
    const legacy: Record<string, unknown> = { ...journal, transactionStatus: "applying" };
    delete legacy.writePolicy;
    const journalRoot = join(projectRoot, "history", "agent-transactions");
    await mkdir(journalRoot, { recursive: true });
    await writeFile(
      join(journalRoot, `${journal.transactionId}.json`),
      `${JSON.stringify(legacy, null, 2)}\n`,
      "utf8"
    );

    const result = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(result).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          writePolicy: "write_before_confirmation",
          approvalSource: "human_confirmation",
          transactionStatus: "rolled_back"
        })
      ]
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test.each([
    "missing_binding",
    "missing_auto_policy",
    "forged_policy",
    "mismatched_policy",
    "forged_source",
    "forged_token"
  ] as const)("fails closed when an apply recovery journal has %s", async (corruption) => {
    const projectRoot = await createProject({ "notes/one.md": "candidate" });
    const journal = appliedJournal({
      transactionId: `tx_${corruption}`,
      versionGroupId: `vg_${corruption}`,
      runSequence: 1,
      beforeContent: "before",
      candidateContent: "candidate",
      beforeVersionId: "ver_before"
    });
    const corrupted: Record<string, unknown> = { ...journal, transactionStatus: "applying" };
    if (corruption === "missing_binding") {
      delete corrupted.approvalSource;
      delete corrupted.approvalToken;
    } else if (corruption === "missing_auto_policy") {
      delete corrupted.writePolicy;
      corrupted.approvalSource = "user_preapproved_run";
    } else if (corruption === "forged_policy") {
      corrupted.writePolicy = "model_requested_auto_write";
    } else if (corruption === "mismatched_policy") {
      corrupted.writePolicy = "write_before_confirmation";
      corrupted.approvalSource = "user_preapproved_run";
    } else if (corruption === "forged_source") {
      corrupted.approvalSource = "model_requested_auto_write";
    } else {
      corrupted.approvalToken = "forged-approval-token-must-stay-redacted";
    }
    const journalRoot = join(projectRoot, "history", "agent-transactions");
    await mkdir(journalRoot, { recursive: true });
    await writeFile(
      join(journalRoot, `${journal.transactionId}.json`),
      `${JSON.stringify(corrupted, null, 2)}\n`,
      "utf8"
    );

    const result = await createTransaction(projectRoot).recoverIncompleteTransactions();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_TRANSACTION_JOURNAL_INVALID" }
    });
    expect(JSON.stringify(result)).not.toContain("forged-approval-token-must-stay-redacted");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("candidate");
  });

  test("rejects traversal, reparse paths, and a final base-hash TOCTOU change", async () => {
    const outsideRoot = await createProject({ "secret.md": "outside" });
    const projectRoot = await createProject({ "notes/safe.md": "before" });
    await symlink(outsideRoot, join(projectRoot, "linked"), "junction");
    const transaction = createTransaction(projectRoot);

    const traversal = await transaction.apply(
      createInput([fileChange("../secret.md", "outside", "changed", "text")])
    );
    const reparse = await transaction.apply(
      createInput([fileChange("linked/secret.md", "outside", "changed", "text")])
    );
    const toctouTransaction = createTransaction(projectRoot, {
      mutateBeforeFinalVerify: async ({ relativePath }) => {
        if (relativePath === "notes/safe.md") {
          await writeFile(join(projectRoot, relativePath), "user changed", "utf8");
        }
      }
    });
    const toctou = await toctouTransaction.apply(
      createInput([fileChange("notes/safe.md", "before", "after", "text")])
    );

    expect(traversal.ok).toBe(false);
    expect(!traversal.ok && traversal.error.code).toBe("AGENT_WRITE_PATH_REJECTED");
    expect(reparse.ok).toBe(false);
    expect(!reparse.ok && reparse.error.code).toBe("AGENT_WRITE_PATH_REJECTED");
    expect(toctou.ok).toBe(true);
    expect(toctou.ok && toctou.value.transactionStatus).toBe("rolled_back");
    expect(await readFile(join(projectRoot, "notes/safe.md"), "utf8")).toBe("user changed");
    expect(await readFile(join(outsideRoot, "secret.md"), "utf8")).toBe("outside");
  });

  test("rejects a project-root retarget between preflight and replacement", async () => {
    const rootA = await createProject({ "notes/one.md": "before" });
    const rootB = await createProject({ "notes/one.md": "before" });
    const linkParent = await mkdtemp(join(tmpdir(), "novel-studio-agent-root-link-"));
    tempRoots.push(linkParent);
    const projectRoot = join(linkParent, "project");
    await symlink(rootA, projectRoot, "junction");
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations),
      mutateBeforeFinalVerify: async () => {
        await rm(projectRoot, { recursive: true, force: true });
        await symlink(rootB, projectRoot, "junction");
      }
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result.ok && result.value.transactionStatus).not.toBe("applied");
    expect(await readFile(join(rootA, "notes/one.md"), "utf8")).toBe("before");
    expect(await readFile(join(rootB, "notes/one.md"), "utf8")).toBe("before");
  });

  test("undoes one Version Group only when the current checksum is its last write", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const undone = await transaction.undoVersionGroup({
      versionGroupId: applied.value.versionGroupId
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.value.transactionStatus).toBe("applied");
    expect(undone.value.undoStatus).toBe("completed");
    expect(undone.value.undoMetadata.undoOfVersionGroupIds).toEqual([applied.value.versionGroupId]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
    expect(await historyReasons(projectRoot)).toContain("before-agent-session-undo");
    const undoJournal = (await readJournals(projectRoot)).find(
      (journal) => journal.kind === "version_group_undo"
    );
    expect(undoJournal).not.toHaveProperty("approvalSource");
    expect(undoJournal).not.toHaveProperty("approvalToken");
  });

  test("reports undo failure when the Nth undo replacement fails and compensation succeeds", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one baseline",
      "notes/two.md": "two baseline"
    });
    let failUndo = false;
    const transaction = createTransaction(projectRoot, {
      failReplace: ({ phase, relativePath }) =>
        failUndo && phase === "undo" && relativePath === "notes/one.md"
    });
    const applied = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one baseline", "one agent", "text"),
        fileChange("notes/two.md", "two baseline", "two agent", "text")
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);

    failUndo = true;
    const undone = await transaction.undoVersionGroup({
      versionGroupId: applied.value.versionGroupId
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.value.transactionStatus).toBe("rolled_back");
    expect(undone.value.failureKind).toBe("undo_failure");
    expect(undone.value.writes.map((write) => write.status)).toEqual(["rolled_back", "pending"]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one agent");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two agent");
  });

  test("undoes one write from a multi-file Version Group without changing its siblings", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one baseline",
      "notes/two.md": "two baseline"
    });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one baseline", "one agent", "text"),
        fileChange("notes/two.md", "two baseline", "two agent", "text")
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    const firstWrite = applied.value.writes[0];
    if (firstWrite === undefined) throw new Error("Expected a Version Group write.");

    const undone = await transaction.undoWrite({
      versionGroupId: applied.value.versionGroupId,
      writeId: firstWrite.writeId
    });

    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.value.writes.map((write) => write.relativePath)).toEqual(["notes/one.md"]);
    expect(undone.value.undoMetadata.undoOfVersionGroupIds).toEqual([applied.value.versionGroupId]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one baseline");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two agent");
  });

  test("run undo skips a write already restored by single-write undo", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one baseline",
      "notes/two.md": "two baseline"
    });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one baseline", "one agent", "text"),
        fileChange("notes/two.md", "two baseline", "two agent", "text")
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    const firstWrite = applied.value.writes[0];
    if (firstWrite === undefined) throw new Error("Expected a Version Group write.");
    const singleUndo = await transaction.undoWrite({
      versionGroupId: applied.value.versionGroupId,
      writeId: firstWrite.writeId
    });
    if (!singleUndo.ok) throw new Error(singleUndo.error.message);

    const runUndo = await transaction.undoRun({ runId: "run_01" });

    expect(runUndo.ok).toBe(true);
    expect(runUndo.ok && runUndo.value.undoStatus).toBe("completed");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one baseline");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two baseline");
  });

  test("run undo persists a rollback review and refuses to overwrite a later user edit", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot);
    const first = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent one", "text")], {
        checkpointId: "checkpoint_01"
      })
    );
    if (!first.ok) throw new Error(first.error.message);
    const second = await transaction.apply(
      createInput([fileChange("notes/one.md", "agent one", "agent two", "text")], {
        checkpointId: "checkpoint_02"
      })
    );
    if (!second.ok) throw new Error(second.error.message);

    await writeFile(join(projectRoot, "notes/one.md"), "later user edit", "utf8");
    const conflict = await transaction.undoRun({ runId: "run_01" });

    expect(conflict.ok).toBe(true);
    if (!conflict.ok) throw new Error(conflict.error.message);
    expect(conflict.value.transactionStatus).toBe("awaiting_review");
    expect(conflict.value.writes[0]?.status).toBe("conflict");
    expect(conflict.value.rollbackReview).toMatchObject({
      runId: "run_01",
      status: "pending",
      files: [
        {
          relativePath: "notes/one.md",
          baselineContent: "baseline",
          baselineChecksum: checksum("baseline"),
          runLastWriteContent: "agent two",
          runLastWriteChecksum: checksum("agent two"),
          reviewedCurrentContent: "later user edit",
          reviewedCurrentChecksum: checksum("later user edit"),
          status: "conflict"
        }
      ]
    });
    expect(conflict.value.undoMetadata.undoOfVersionGroupIds).toEqual([
      first.value.versionGroupId,
      second.value.versionGroupId
    ]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("later user edit");

    const durable = await new RecoveryRepository({ projectRoot }).readRollbackReview("run_01");
    expect(durable.ok).toBe(true);
    expect(durable.ok && durable.value).toEqual(conflict.value.rollbackReview);
  });

  test("keep_current resolves a reviewed conflict without snapshots or file writes", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations)
    });
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "user edit", "utf8");
    const pending = await transaction.undoRun({ runId: "run_01", commandId: "undo_request" });
    if (!pending.ok) throw new Error(pending.error.message);
    const operationCount = operations.length;

    const kept = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_keep",
      decisions: [{ relativePath: "notes/one.md", decision: "keep_current" }]
    });

    expect(kept.ok).toBe(true);
    expect(kept.ok && kept.value.transactionStatus).toBe("applied");
    expect(kept.ok && kept.value.writes[0]?.status).toBe("kept");
    expect(operations.slice(operationCount)).toEqual(["lock"]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("user edit");
  });

  test("restore_baseline becomes stale when current bytes change after review", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations)
    });
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "reviewed edit", "utf8");
    const pending = await transaction.undoRun({ runId: "run_01", commandId: "undo_request" });
    if (!pending.ok) throw new Error(pending.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "newer edit", "utf8");
    const operationCount = operations.length;

    const stale = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_restore",
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(stale.ok).toBe(true);
    expect(stale.ok && stale.value.transactionStatus).toBe("awaiting_review");
    expect(stale.ok && stale.value.rollbackReview?.files[0]).toMatchObject({
      reviewedCurrentContent: "newer edit",
      reviewedCurrentChecksum: checksum("newer edit"),
      status: "stale"
    });
    expect(stale.ok && stale.value.rollbackReview?.files[0]).not.toHaveProperty("decision");
    expect(operations.slice(operationCount)).toEqual(["lock"]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("newer edit");
  });

  test("rechecks the reviewed checksum immediately before replace and never overwrites a raced edit", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    let raceRestore = false;
    const transaction = createTransaction(projectRoot, {
      mutateBeforeFinalVerify: async ({ relativePath }) => {
        if (!raceRestore) return;
        raceRestore = false;
        await writeFile(join(projectRoot, relativePath), "raced edit", "utf8");
      }
    });
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "reviewed edit", "utf8");
    const pending = await transaction.undoRun({ runId: "run_01", commandId: "undo_request" });
    if (!pending.ok) throw new Error(pending.error.message);
    raceRestore = true;

    const stale = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_restore",
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(stale.ok).toBe(true);
    expect(stale.ok && stale.value.transactionStatus).toBe("awaiting_review");
    expect(stale.ok && stale.value.rollbackReview?.files[0]).toMatchObject({
      reviewedCurrentContent: "raced edit",
      reviewedCurrentChecksum: checksum("raced edit"),
      status: "stale"
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("raced edit");
  });

  test("reconciles a completed rollback after its review status fails to persist", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const durableRecovery = new RecoveryRepository({ projectRoot });
    let rollbackReviewWrites = 0;
    const interruptedRecovery: AgentWriteRecoveryPort = {
      writeAgentTransactionJournal: (journal) =>
        durableRecovery.writeAgentTransactionJournal(journal),
      readAgentTransactionJournal: (transactionId) =>
        durableRecovery.readAgentTransactionJournal(transactionId),
      listAgentTransactionJournals: () => durableRecovery.listAgentTransactionJournals(),
      async writeRollbackReview(review) {
        rollbackReviewWrites += 1;
        if (rollbackReviewWrites === 6) {
          return err(transactionTestError("ROLLBACK_REVIEW_WRITE_FAILED"));
        }
        return durableRecovery.writeRollbackReview(review);
      },
      readRollbackReview: (runId) => durableRecovery.readRollbackReview(runId)
    };
    const interrupted = createTransaction(projectRoot, {
      recoveryRepository: interruptedRecovery
    });
    const applied = await interrupted.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "user edit", "utf8");
    const pending = await interrupted.undoRun({
      runId: "run_01",
      commandId: "undo_request"
    });
    if (!pending.ok || pending.value.rollbackReview === undefined) {
      throw new Error("Expected a rollback review.");
    }

    const failedPersistence = await interrupted.undoRun({
      runId: "run_01",
      commandId: "undo_interrupted",
      reviewId: pending.value.rollbackReview.reviewId,
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(failedPersistence.ok).toBe(false);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");

    const recovered = await createTransaction(projectRoot).undoRun({
      runId: "run_01",
      commandId: "undo_recovered"
    });

    expect(recovered.ok).toBe(true);
    expect(recovered.ok && recovered.value.transactionStatus).toBe("applied");
    expect(recovered.ok && recovered.value.rollbackReview?.files[0]?.status).toBe("completed");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
  });

  test("persists completed kept and failed files then retries only the failed restore", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one baseline",
      "notes/two.md": "two baseline",
      "notes/three.md": "three baseline"
    });
    const operations: string[] = [];
    let failThree = true;
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      failReplace: ({ phase, relativePath }) =>
        failThree && phase === "undo" && relativePath === "notes/three.md"
    });
    const applied = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one baseline", "one agent", "text"),
        fileChange("notes/two.md", "two baseline", "two agent", "text"),
        fileChange("notes/three.md", "three baseline", "three agent", "text")
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "one user", "utf8");
    await writeFile(join(projectRoot, "notes/two.md"), "two user", "utf8");
    await writeFile(join(projectRoot, "notes/three.md"), "three user", "utf8");
    const pending = await transaction.undoRun({ runId: "run_01", commandId: "undo_request" });
    if (!pending.ok) throw new Error(pending.error.message);

    const partial = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_decisions",
      decisions: [
        { relativePath: "notes/one.md", decision: "restore_baseline" },
        { relativePath: "notes/two.md", decision: "keep_current" },
        { relativePath: "notes/three.md", decision: "restore_baseline" }
      ]
    });

    expect(partial.ok).toBe(true);
    expect(partial.ok && partial.value.transactionStatus).toBe("partial_failure");
    expect(
      partial.ok &&
        partial.value.rollbackReview?.files.map((file) => [file.relativePath, file.status])
    ).toEqual([
      ["notes/one.md", "completed"],
      ["notes/two.md", "kept"],
      ["notes/three.md", "failed"]
    ]);
    const beforeRetry = operations.length;
    failThree = false;

    const retried = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_retry",
      retryFailedOnly: true
    });

    expect(retried.ok).toBe(true);
    expect(retried.ok && retried.value.transactionStatus).toBe("applied");
    expect(operations.slice(beforeRetry)).toEqual([
      "lock",
      "replace:undo:notes/three.md",
      "lock",
      "lock"
    ]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one baseline");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two user");
    expect(await readFile(join(projectRoot, "notes/three.md"), "utf8")).toBe("three baseline");

    const afterRetry = operations.length;
    const duplicate = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_retry",
      retryFailedOnly: true
    });
    expect(duplicate.ok).toBe(true);
    expect(operations.slice(afterRetry)).toEqual(["lock"]);
  });

  test("a rebuilt transaction restores the pending rollback review", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const firstTransaction = createTransaction(projectRoot);
    const applied = await firstTransaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "user edit", "utf8");
    const firstReview = await firstTransaction.undoRun({
      runId: "run_01",
      commandId: "undo_request"
    });
    if (!firstReview.ok) throw new Error(firstReview.error.message);

    const restored = await createTransaction(projectRoot).undoRun({ runId: "run_01" });

    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.value.rollbackReview).toEqual(firstReview.value.rollbackReview);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("user edit");
  });

  test("rejects a durable rollback review that is not bound to the run journals", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    await writeFile(join(projectRoot, "notes/one.md"), "user edit", "utf8");
    const pending = await transaction.undoRun({ runId: "run_01", commandId: "undo_request" });
    if (!pending.ok || pending.value.rollbackReview === undefined) {
      throw new Error("Expected a rollback review.");
    }
    const recovery = new RecoveryRepository({ projectRoot });
    const tampered = await recovery.writeRollbackReview({
      ...pending.value.rollbackReview,
      sourceVersionGroupIds: ["vg_tampered"]
    });
    if (!tampered.ok) throw new Error(tampered.error.message);

    const resumed = await createTransaction(projectRoot).undoRun({
      runId: "run_01",
      commandId: "undo_tampered",
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(resumed).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_ROLLBACK_REVIEW_INVALID" }
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("user edit");
  });

  test("rejects a rollback review file that exceeds the configured byte limit", async () => {
    const projectRoot = await createProject({});
    const recovery = new RecoveryRepository({ projectRoot, maxRollbackReviewBytes: 256 });
    const content = "x".repeat(300);
    const review = {
      schemaVersion: "1.0" as const,
      reviewId: `rollback_${checksum("run_01").slice(0, 24)}`,
      runId: "run_01",
      status: "pending" as const,
      sourceVersionGroupIds: ["vg_01"],
      createdAt: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T01:00:00.000Z",
      processedCommandIds: [],
      files: [
        {
          relativePath: "notes/one.md",
          assetType: "text" as const,
          baselineContent: content,
          baselineChecksum: checksum(content),
          baselineVersionId: "ver_01",
          runLastWriteContent: content,
          runLastWriteChecksum: checksum(content),
          reviewedCurrentContent: content,
          reviewedCurrentChecksum: checksum(content),
          reviewedCurrentHistoryContent: content,
          diff: {
            currentToLastWrite: "current = ai-last-write",
            currentToBaseline: "current = baseline",
            lastWriteToBaseline: "ai-last-write = baseline"
          },
          status: "conflict" as const,
          errorCode: "AGENT_WRITE_UNDO_CONFLICT"
        }
      ]
    };

    const written = await recovery.writeRollbackReview(review);

    expect(written).toMatchObject({
      ok: false,
      error: { code: "ROLLBACK_REVIEW_TOO_LARGE" }
    });
  });

  test("run undo uses the earliest baseline across multiple successful writes", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot);
    const first = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent one", "text")], {
        checkpointId: "checkpoint_01"
      })
    );
    if (!first.ok) throw new Error(first.error.message);
    const second = await transaction.apply(
      createInput([fileChange("notes/one.md", "agent one", "agent two", "text")], {
        checkpointId: "checkpoint_02"
      })
    );
    if (!second.ok) throw new Error(second.error.message);

    const undone = await transaction.undoRun({ runId: "run_01" });

    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.value.undoStatus).toBe("completed");
    expect(undone.value.baselineByPath["notes/one.md"]?.checksum).toBe(checksum("baseline"));
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
  });

  test("clean run undo persists one applied run_undo transaction journal", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "one baseline",
      "notes/two.md": "two baseline"
    });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([
        fileChange("notes/one.md", "one baseline", "one agent", "text"),
        fileChange("notes/two.md", "two baseline", "two agent", "text")
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const undone = await transaction.undoRun({ runId: "run_01" });

    expect(undone.ok).toBe(true);
    const undoJournals = (await readJournals(projectRoot)).filter(
      (journal) => journal.kind === "run_undo"
    );
    expect(undoJournals).toHaveLength(1);
    expect(undoJournals[0]).toMatchObject({
      runId: "run_01",
      transactionStatus: "applied",
      entries: [{ status: "applied" }, { status: "applied" }]
    });
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("one baseline");
    expect(await readFile(join(projectRoot, "notes/two.md"), "utf8")).toBe("two baseline");
  });

  test("run undo is idempotent after every file already reached its baseline", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot);
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!applied.ok) throw new Error(applied.error.message);
    const firstUndo = await transaction.undoRun({ runId: "run_01" });
    if (!firstUndo.ok) throw new Error(firstUndo.error.message);
    const journalCount = (await readJournals(projectRoot)).length;

    const secondUndo = await transaction.undoRun({ runId: "run_01" });

    expect(secondUndo.ok).toBe(true);
    expect(secondUndo.ok && secondUndo.value.undoStatus).toBe("completed");
    expect((await readJournals(projectRoot)).length).toBe(journalCount);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
  });

  test("run undo uses durable run sequence when timestamps and transaction id order disagree", async () => {
    const projectRoot = await createProject({ "notes/one.md": "agent two" });
    const recovery = new RecoveryRepository({ projectRoot });
    const first = appliedJournal({
      transactionId: "tx_z_first",
      versionGroupId: "vg_first",
      runSequence: 1,
      beforeContent: "baseline",
      candidateContent: "agent one",
      beforeVersionId: "ver_baseline"
    });
    const second = appliedJournal({
      transactionId: "tx_a_second",
      versionGroupId: "vg_second",
      runSequence: 2,
      beforeContent: "agent one",
      candidateContent: "agent two",
      beforeVersionId: "ver_agent_one"
    });
    const firstWrite = await recovery.writeAgentTransactionJournal(first);
    const secondWrite = await recovery.writeAgentTransactionJournal(second);
    if (!firstWrite.ok) throw new Error(firstWrite.error.message);
    if (!secondWrite.ok) throw new Error(secondWrite.error.message);

    const undone = await createTransaction(projectRoot).undoRun({ runId: "run_01" });

    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.value.transactionStatus).toBe("applied");
    expect(undone.value.undoStatus).toBe("completed");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
  });

  test("run undo snapshots a chapter under its real asset id with chapter body content", async () => {
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D4";
    const relativePath = `chapters/${chapterId}.md`;
    const baselineBody = "Baseline chapter body.\n";
    const agentBody = "Agent chapter body.\n";
    const baselineFile = `---\nid: ${chapterId}\n---\n\n${baselineBody}`;
    const agentFile = `---\nid: ${chapterId}\n---\n\n${agentBody}`;
    const projectRoot = await createProject({ [relativePath]: baselineFile });
    const snapshots: {
      readonly assetId: string;
      readonly reason: string;
      readonly content: string;
    }[] = [];
    let version = 0;
    const historyRepository: AgentWriteHistoryPort = {
      async snapshotTextAsset(input) {
        snapshots.push({
          assetId: input.assetId,
          reason: input.reason,
          content: input.content
        });
        return ok({
          schemaVersion: "1.0",
          versionId: `ver_${++version}`,
          assetType: input.assetType,
          assetId: input.assetId,
          reason: input.reason,
          createdBy: input.createdBy ?? "system",
          createdAt: "2026-07-13T01:00:00.000Z",
          checksum: `sha256:${checksum(input.content)}`
        });
      }
    };
    const transaction = createTransaction(projectRoot, { historyRepository });
    const applied = await transaction.apply(
      createInput([
        {
          ...fileChange(relativePath, baselineFile, agentFile, "chapter"),
          assetId: chapterId,
          historyBaseContent: baselineBody,
          historyCandidateContent: agentBody
        }
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const undone = await transaction.undoRun({ runId: "run_01" });

    expect(undone.ok).toBe(true);
    expect(snapshots).toContainEqual({
      assetId: chapterId,
      reason: "before-agent-session-undo",
      content: agentBody
    });
  });

  test("keeps a dirty chapter editor in rollback review until the user restores baseline", async () => {
    const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D5";
    const relativePath = `chapters/${chapterId}.md`;
    const baselineBody = "Baseline body.\n";
    const agentBody = "Agent body.\n";
    const dirtyBody = "Unsaved user body.\n";
    const baselineFile = `---\nid: ${chapterId}\n---\n\n${baselineBody}`;
    const agentFile = `---\nid: ${chapterId}\n---\n\n${agentBody}`;
    const projectRoot = await createProject({ [relativePath]: baselineFile });
    const snapshots: { readonly reason: string; readonly content: string }[] = [];
    let version = 0;
    const transaction = createTransaction(projectRoot, {
      historyRepository: {
        async snapshotTextAsset(input) {
          snapshots.push({ reason: input.reason, content: input.content });
          return ok({
            schemaVersion: "1.0",
            versionId: `ver_${++version}`,
            assetType: input.assetType,
            assetId: input.assetId,
            reason: input.reason,
            createdBy: input.createdBy ?? "system",
            createdAt: "2026-07-13T01:00:00.000Z",
            checksum: `sha256:${checksum(input.content)}`
          });
        }
      }
    });
    const applied = await transaction.apply(
      createInput([
        {
          ...fileChange(relativePath, baselineFile, agentFile, "chapter"),
          assetId: chapterId,
          historyBaseContent: baselineBody,
          historyCandidateContent: agentBody
        }
      ])
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const pending = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_dirty_request",
      currentEditorContents: [{ relativePath, content: dirtyBody }]
    });

    expect(pending.ok).toBe(true);
    expect(pending.ok && pending.value.transactionStatus).toBe("awaiting_review");
    expect(pending.ok && pending.value.rollbackReview?.files[0]).toMatchObject({
      reviewedCurrentHistoryContent: dirtyBody,
      status: "conflict"
    });
    expect(await readFile(join(projectRoot, relativePath), "utf8")).toBe(agentFile);

    const restored = await transaction.undoRun({
      runId: "run_01",
      commandId: "undo_dirty_restore",
      currentEditorContents: [{ relativePath, content: dirtyBody }],
      decisions: [{ relativePath, decision: "restore_baseline" }]
    });

    expect(restored.ok).toBe(true);
    expect(restored.ok && restored.value.transactionStatus).toBe("applied");
    expect(await readFile(join(projectRoot, relativePath), "utf8")).toBe(baselineFile);
    expect(snapshots).toContainEqual({
      reason: "before-agent-session-undo",
      content: dirtyBody
    });
  });
});

describe("AgentWriteTransaction lifecycle operations", () => {
  test("does not mark a dirty rollback review applied until lifecycle inverses complete", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "baseline",
      "notes/source.md": "source"
    });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")], {
        operations: [
          {
            kind: "delete_file",
            operationId: "delete_source",
            toolCallIdempotencyKey: "tool_delete_source",
            relativePath: "notes/source.md",
            baseChecksum: checksum("source")
          }
        ]
      })
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const pending = await transaction.undoRun({
      runId: "run_01",
      commandId: "dirty_undo_request",
      currentEditorContents: [{ relativePath: "notes/one.md", content: "unsaved user edit" }]
    });

    expect(pending.ok && pending.value.transactionStatus).toBe("awaiting_review");
    await expect(readFile(join(projectRoot, "notes/source.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const resolved = await transaction.undoRun({
      runId: "run_01",
      commandId: "dirty_undo_restore",
      currentEditorContents: [{ relativePath: "notes/one.md", content: "unsaved user edit" }],
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(resolved.ok && resolved.value.transactionStatus).toBe("applied");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
    expect(await readFile(join(projectRoot, "notes/source.md"), "utf8")).toBe("source");
    const lifecycleUndo = (await readJournals(projectRoot)).find(
      (journal) => journal.kind === "run_undo" && journal.operations?.length === 1
    );
    expect(lifecycleUndo).toMatchObject({
      transactionStatus: "applied",
      operations: [{ status: "applied", operation: { kind: "create_file" } }]
    });
  });

  test("does not claim a resolved dirty review is applied when its lifecycle undo fails", async () => {
    const projectRoot = await createProject({
      "notes/one.md": "baseline",
      "notes/source.md": "source"
    });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot, { failKind: "create_file" })
    });
    const applied = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")], {
        operations: [
          {
            kind: "delete_file",
            operationId: "delete_source",
            toolCallIdempotencyKey: "tool_delete_source",
            relativePath: "notes/source.md",
            baseChecksum: checksum("source")
          }
        ]
      })
    );
    if (!applied.ok) throw new Error(applied.error.message);

    const pending = await transaction.undoRun({
      runId: "run_01",
      currentEditorContents: [{ relativePath: "notes/one.md", content: "unsaved user edit" }]
    });
    if (!pending.ok) throw new Error(pending.error.message);

    const resolved = await transaction.undoRun({
      runId: "run_01",
      currentEditorContents: [{ relativePath: "notes/one.md", content: "unsaved user edit" }],
      decisions: [{ relativePath: "notes/one.md", decision: "restore_baseline" }]
    });

    expect(resolved.ok && resolved.value.transactionStatus).not.toBe("applied");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("agent");
    await expect(readFile(join(projectRoot, "notes/source.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("restores reviewed text before removing a file and its parent directory", async () => {
    const projectRoot = await createProject({});
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });
    const created = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_directory",
            operationId: "mkdir_drafts",
            toolCallIdempotencyKey: "tool_mkdir",
            relativePath: "drafts"
          },
          {
            kind: "create_file",
            operationId: "create_draft",
            toolCallIdempotencyKey: "tool_create",
            dependsOn: ["mkdir_drafts"],
            relativePath: "drafts/new.md",
            content: "created"
          }
        ]
      })
    );
    if (!created.ok) throw new Error(created.error.message);
    const writeChecksum = "f".repeat(64);
    const written = await transaction.apply(
      createInput([fileChange("drafts/new.md", "created", "edited", "text")], {
        checkpointId: "checkpoint_02",
        changeSetId: "changes_02",
        checksum: writeChecksum,
        approvalToken: approvalToken("changes_02", 1, writeChecksum)
      })
    );
    if (!written.ok) throw new Error(written.error.message);

    const pending = await transaction.undoRun({
      runId: "run_01",
      currentEditorContents: [{ relativePath: "drafts/new.md", content: "unsaved" }]
    });
    if (!pending.ok) throw new Error(pending.error.message);

    const resolved = await transaction.undoRun({
      runId: "run_01",
      currentEditorContents: [{ relativePath: "drafts/new.md", content: "unsaved" }],
      decisions: [{ relativePath: "drafts/new.md", decision: "restore_baseline" }]
    });

    expect(resolved.ok && resolved.value.transactionStatus).toBe("applied");
    await expect(lstat(join(projectRoot, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
    const undo = (await readJournals(projectRoot)).find((journal) => journal.kind === "run_undo");
    expect(undo?.mutationOrder?.map((mutation) => mutation.kind)).toEqual([
      "write",
      "operation",
      "operation"
    ]);
  });

  test("fails closed for text replacements without a native no-follow mutation port", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations),
      disableNativeFileMutations: true
    });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED" }
    });
    expect(operations).toEqual(["lock"]);
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("before");
  });

  test("rejects a junction swap after text final verification without writing outside the project", async () => {
    const projectRoot = await createProject({ "notes/one.md": "before" });
    const outsideRoot = await createProject({ "notes/one.md": "outside" });
    let swapped = false;
    const lifecycleOperations = createTestingLifecyclePort(projectRoot, {
      async beforeMutation(input) {
        if (input.kind !== "replace_file" || swapped) return;
        swapped = true;
        await rename(join(projectRoot, "notes"), join(projectRoot, "notes-original"));
        await symlink(outsideRoot, join(projectRoot, "notes"), "junction");
      }
    });
    const transaction = createTransaction(projectRoot, { lifecycleOperations });

    const result = await transaction.apply(
      createInput([fileChange("notes/one.md", "before", "after", "text")])
    );

    expect(result.ok && result.value.transactionStatus).toBe("rolled_back");
    expect(swapped).toBe(true);
    expect(await readFile(join(outsideRoot, "notes/one.md"), "utf8")).toBe("outside");
    expect(await readFile(join(projectRoot, "notes-original/one.md"), "utf8")).toBe("before");
  });

  test("undoRun restores a write before a later move across Change Sets in global reverse order", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });
    const first = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!first.ok) throw new Error(first.error.message);
    const secondChecksum = "d".repeat(64);
    const second = await transaction.apply(
      createInput([], {
        checkpointId: "checkpoint_02",
        changeSetId: "changes_02",
        checksum: secondChecksum,
        approvalToken: approvalToken("changes_02", 1, secondChecksum),
        operations: [
          {
            kind: "move_file",
            operationId: "move_one",
            toolCallIdempotencyKey: "tool_move_one",
            sourcePath: "notes/one.md",
            targetPath: "notes/moved.md",
            sourceChecksum: checksum("agent")
          }
        ]
      })
    );
    if (!second.ok) throw new Error(second.error.message);

    const undone = await transaction.undoRun({ runId: "run_01" });

    expect(undone.ok && undone.value.transactionStatus).toBe("applied");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
    await expect(readFile(join(projectRoot, "notes/moved.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    const journal = (await readJournals(projectRoot)).find(
      (candidate) => candidate.kind === "run_undo"
    );
    expect(journal?.mutationOrder?.map((mutation) => mutation.kind)).toEqual([
      "operation",
      "write"
    ]);
  });

  test("undoRun restores a write before a later delete across Change Sets in global reverse order", async () => {
    const projectRoot = await createProject({ "notes/one.md": "baseline" });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });
    const first = await transaction.apply(
      createInput([fileChange("notes/one.md", "baseline", "agent", "text")])
    );
    if (!first.ok) throw new Error(first.error.message);
    const secondChecksum = "e".repeat(64);
    const second = await transaction.apply(
      createInput([], {
        checkpointId: "checkpoint_02",
        changeSetId: "changes_02",
        checksum: secondChecksum,
        approvalToken: approvalToken("changes_02", 1, secondChecksum),
        operations: [
          {
            kind: "delete_file",
            operationId: "delete_one",
            toolCallIdempotencyKey: "tool_delete_one",
            relativePath: "notes/one.md",
            baseChecksum: checksum("agent")
          }
        ]
      })
    );
    if (!second.ok) throw new Error(second.error.message);

    const undone = await transaction.undoRun({ runId: "run_01" });

    expect(undone.ok && undone.value.transactionStatus).toBe("applied");
    expect(await readFile(join(projectRoot, "notes/one.md"), "utf8")).toBe("baseline");
    const journal = (await readJournals(projectRoot)).find(
      (candidate) => candidate.kind === "run_undo"
    );
    expect(journal?.mutationOrder?.map((mutation) => mutation.kind)).toEqual([
      "operation",
      "write"
    ]);
  });

  test("applies operations-only Change Sets and undoes create/move/delete/mkdir in reverse DAG order", async () => {
    const projectRoot = await createProject({
      "notes/source.md": "source",
      "notes/delete.md": "delete me"
    });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });

    const applied = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_directory",
            operationId: "mkdir_drafts",
            toolCallIdempotencyKey: "tool_mkdir",
            relativePath: "drafts"
          },
          {
            kind: "create_file",
            operationId: "create_new",
            toolCallIdempotencyKey: "tool_create",
            dependsOn: ["mkdir_drafts"],
            relativePath: "drafts/new.md",
            content: "new"
          },
          {
            kind: "move_file",
            operationId: "move_source",
            toolCallIdempotencyKey: "tool_move",
            dependsOn: ["mkdir_drafts"],
            sourcePath: "notes/source.md",
            targetPath: "drafts/moved.md",
            sourceChecksum: checksum("source")
          },
          {
            kind: "delete_file",
            operationId: "delete_old",
            toolCallIdempotencyKey: "tool_delete",
            relativePath: "notes/delete.md",
            baseChecksum: checksum("delete me")
          }
        ]
      })
    );

    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.value.writes).toEqual([]);
    expect(applied.value.operations?.map((operation) => operation.status)).toEqual([
      "applied",
      "applied",
      "applied",
      "applied"
    ]);
    expect(await readFile(join(projectRoot, "drafts/new.md"), "utf8")).toBe("new");
    expect(await readFile(join(projectRoot, "drafts/moved.md"), "utf8")).toBe("source");
    await expect(readFile(join(projectRoot, "notes/delete.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const undone = await transaction.undoVersionGroup({
      versionGroupId: applied.value.versionGroupId
    });

    expect(undone.ok).toBe(true);
    expect(await readFile(join(projectRoot, "notes/source.md"), "utf8")).toBe("source");
    expect(await readFile(join(projectRoot, "notes/delete.md"), "utf8")).toBe("delete me");
    await expect(readFile(join(projectRoot, "drafts/new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(projectRoot, "drafts/moved.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("uses the standard trusted creative lifecycle port for apply and undo", async () => {
    const projectRoot = await createProject({
      "notes/source.md": "source",
      "notes/delete.md": "delete me"
    });
    const transaction = createTransaction(projectRoot, {
      disableNativeFileMutations: true,
      trustedCreativeMutations: createTrustedCreativeFileOperationsPort({
        workspaceKind: "creativeProject",
        projectRoot
      })
    });

    const applied = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_directory",
            operationId: "mkdir_drafts",
            toolCallIdempotencyKey: "trusted_mkdir",
            relativePath: "drafts"
          },
          {
            kind: "create_file",
            operationId: "create_new",
            toolCallIdempotencyKey: "trusted_create",
            dependsOn: ["mkdir_drafts"],
            relativePath: "drafts/new.md",
            content: "new"
          },
          {
            kind: "move_file",
            operationId: "move_source",
            toolCallIdempotencyKey: "trusted_move",
            dependsOn: ["mkdir_drafts"],
            sourcePath: "notes/source.md",
            targetPath: "drafts/moved.md",
            sourceChecksum: checksum("source")
          },
          {
            kind: "delete_file",
            operationId: "delete_old",
            toolCallIdempotencyKey: "trusted_delete",
            relativePath: "notes/delete.md",
            baseChecksum: checksum("delete me")
          }
        ]
      })
    );

    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(await readFile(join(projectRoot, "drafts/new.md"), "utf8")).toBe("new");
    expect(await readFile(join(projectRoot, "drafts/moved.md"), "utf8")).toBe("source");
    await expect(readFile(join(projectRoot, "notes/delete.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const undone = await transaction.undoVersionGroup({
      versionGroupId: applied.value.versionGroupId
    });

    expect(undone.ok).toBe(true);
    expect(await readFile(join(projectRoot, "notes/source.md"), "utf8")).toBe("source");
    expect(await readFile(join(projectRoot, "notes/delete.md"), "utf8")).toBe("delete me");
    await expect(lstat(join(projectRoot, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps replacement-only trusted ports lifecycle-unavailable", async () => {
    const projectRoot = await createProject({});
    const replacementOnly: AgentWriteTrustedCreativeMutationPort = {
      trustLevel: "standard_trusted_creative",
      replace: async () => ok(undefined)
    };
    const transaction = createTransaction(projectRoot, {
      disableNativeFileMutations: true,
      trustedCreativeMutations: replacementOnly
    });

    const result = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_file",
            operationId: "create_file",
            toolCallIdempotencyKey: "replace_only_create",
            relativePath: "new.md",
            content: "new"
          }
        ]
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED" }
    });
    await expect(lstat(join(projectRoot, "new.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("compensates trusted creative lifecycle mutations after a later failure", async () => {
    const projectRoot = await createProject({});
    const backing = createTrustedCreativeFileOperationsPort({
      workspaceKind: "creativeProject",
      projectRoot
    });
    const trustedCreativeMutations: AgentWriteTrustedCreativeMutationPort = {
      trustLevel: "standard_trusted_creative",
      replace: (input) => backing.replace(input),
      async mutate(input) {
        if (input.kind === "create_file") return err(transactionTestError("INJECTED_FAILURE"));
        if (backing.mutate === undefined) throw new Error("Expected lifecycle support.");
        return backing.mutate(input);
      }
    };
    const transaction = createTransaction(projectRoot, {
      disableNativeFileMutations: true,
      trustedCreativeMutations
    });

    const result = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_directory",
            operationId: "mkdir_drafts",
            toolCallIdempotencyKey: "trusted_compensate_mkdir",
            relativePath: "drafts"
          },
          {
            kind: "create_file",
            operationId: "fail_create",
            toolCallIdempotencyKey: "trusted_compensate_create",
            dependsOn: ["mkdir_drafts"],
            relativePath: "drafts/new.md",
            content: "new"
          }
        ]
      })
    );

    expect(result.ok && result.value.transactionStatus).toBe("rolled_back");
    expect(result.ok && result.value.operations?.map((operation) => operation.status)).toEqual([
      "rolled_back",
      "pending"
    ]);
    await expect(lstat(join(projectRoot, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("fails closed without a native lifecycle executor before snapshots or journal writes", async () => {
    const projectRoot = await createProject({});
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations),
      disableNativeFileMutations: true
    });

    const result = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_file",
            operationId: "create_file",
            toolCallIdempotencyKey: "tool_create",
            relativePath: "new.md",
            content: "new"
          }
        ]
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED" }
    });
    expect(operations).toEqual(["lock"]);
  });

  test("preflights the first move source and target before it creates snapshots or mutates files", async () => {
    const projectRoot = await createProject({
      "notes/source.md": "source",
      "notes/target.md": "target"
    });
    const operations: string[] = [];
    const transaction = createTransaction(projectRoot, {
      operations,
      lifecycleOperations: createTestingLifecyclePort(projectRoot),
      historyRepository: recordingHistory(operations),
      recoveryRepository: recordingRecovery(operations)
    });

    const result = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "move_file",
            operationId: "move_source",
            toolCallIdempotencyKey: "tool_move",
            sourcePath: "notes/source.md",
            targetPath: "notes/target.md",
            sourceChecksum: checksum("source")
          }
        ]
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_WRITE_OPERATION_TARGET_EXISTS" }
    });
    expect(operations).toEqual(["lock"]);
    expect(await readFile(join(projectRoot, "notes/source.md"), "utf8")).toBe("source");
    expect(await readFile(join(projectRoot, "notes/target.md"), "utf8")).toBe("target");
  });

  test("does not accept destructive lifecycle operations under a preapproved-run approval", async () => {
    const projectRoot = await createProject({ "notes/source.md": "source" });
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });

    const result = await transaction.apply(
      createInput([], {
        writePolicy: "user_preapproved_run",
        approvalSource: "user_preapproved_run",
        operations: [
          {
            kind: "delete_file",
            operationId: "delete_source",
            toolCallIdempotencyKey: "tool_delete",
            relativePath: "notes/source.md",
            baseChecksum: checksum("source")
          }
        ]
      })
    );

    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_WRITE_INPUT_INVALID" } });
    expect(await readFile(join(projectRoot, "notes/source.md"), "utf8")).toBe("source");
  });

  test("compensates applied lifecycle operations after a later operation fails", async () => {
    const projectRoot = await createProject({});
    const transaction = createTransaction(projectRoot, {
      lifecycleOperations: createTestingLifecyclePort(projectRoot, { failKind: "create_file" })
    });

    const result = await transaction.apply(
      createInput([], {
        operations: [
          {
            kind: "create_directory",
            operationId: "mkdir_drafts",
            toolCallIdempotencyKey: "tool_mkdir",
            relativePath: "drafts"
          },
          {
            kind: "create_file",
            operationId: "create_new",
            toolCallIdempotencyKey: "tool_create",
            dependsOn: ["mkdir_drafts"],
            relativePath: "drafts/new.md",
            content: "new"
          }
        ]
      })
    );

    expect(result.ok && result.value.transactionStatus).toBe("rolled_back");
    await expect(readFile(join(projectRoot, "drafts/new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(lstat(join(projectRoot, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("startup recovery reconciles a pending lifecycle journal and compensates it", async () => {
    const projectRoot = await createProject({ "new.md": "new" });
    const recovery = new RecoveryRepository({ projectRoot });
    const journal: AgentTransactionJournal = {
      schemaVersion: "1.0",
      transactionId: "tx_lifecycle_recovery",
      versionGroupId: "vg_lifecycle_recovery",
      kind: "apply",
      runId: "run_01",
      runSequence: 1,
      checkpointId: "checkpoint_01",
      changeSetId: "changes_01",
      changeSetRevision: 1,
      changeSetChecksum: "c".repeat(64),
      writePolicy: "write_before_confirmation",
      approvalSource: "human_confirmation",
      approvalToken: approvalToken("changes_01", 1, "c".repeat(64)),
      createdAt: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T01:00:00.000Z",
      transactionStatus: "applying",
      entries: [],
      operations: [
        {
          operationId: "create_file",
          operation: {
            kind: "create_file",
            operationId: "create_file",
            toolCallIdempotencyKey: "tool_create",
            relativePath: "new.md",
            content: "new"
          },
          before: [{ kind: "missing", relativePath: "new.md" }],
          after: [
            {
              kind: "file",
              relativePath: "new.md",
              content: "new",
              checksum: checksum("new")
            }
          ],
          status: "pending"
        }
      ]
    };
    const written = await recovery.writeAgentTransactionJournal(journal);
    if (!written.ok) throw new Error(written.error.message);
    const transaction = createTransaction(projectRoot, {
      recoveryRepository: recovery,
      lifecycleOperations: createTestingLifecyclePort(projectRoot)
    });

    const recovered = await transaction.recoverIncompleteTransactions();

    expect(recovered.ok && recovered.value[0]?.transactionStatus).toBe("rolled_back");
    await expect(readFile(join(projectRoot, "new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("ordinary UTF-8 history", () => {
  test("default version ids remain unique within the same millisecond", async () => {
    const projectRoot = await createProject({});
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    try {
      const history = new HistoryRepository({ projectRoot });
      const first = await history.snapshotTextAsset({
        assetType: "text",
        assetId: "notes/one.md",
        reason: "before-agent-write",
        content: "first"
      });
      const second = await history.snapshotTextAsset({
        assetType: "text",
        assetId: "notes/one.md",
        reason: "before-agent-write",
        content: "second"
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.ok && second.ok && first.value.versionId).not.toBe(
        second.ok ? second.value.versionId : undefined
      );
    } finally {
      now.mockRestore();
    }
  });

  test("writes before-agent snapshots for ordinary text and reads legacy before-ai-apply", async () => {
    const projectRoot = await createProject({});
    let version = 0;
    const history = new HistoryRepository({
      projectRoot,
      now: () => "2026-07-13T01:00:00.000Z",
      createVersionId: () => `ver_${++version}`
    });

    const text = await history.snapshotTextAsset({
      assetType: "text",
      assetId: "notes/中文.md",
      reason: "before-agent-write",
      content: "普通 UTF-8 正文"
    });
    const legacy = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_legacy",
      reason: "before-ai-apply",
      content: "legacy"
    });
    const listed = await history.listChapterVersions("ch_legacy");
    const readText = text.ok
      ? await history.readTextAssetSnapshot({
          assetType: "text",
          assetId: "notes/中文.md",
          versionId: text.value.versionId
        })
      : text;

    expect(text.ok).toBe(true);
    expect(legacy.ok).toBe(true);
    expect(listed.ok && listed.value[0]?.reason).toBe("before-ai-apply");
    expect(readText.ok && readText.value.content).toBe("普通 UTF-8 正文");
  });
});

interface TransactionTestOptions {
  readonly operations?: string[];
  readonly historyRepository?: AgentWriteHistoryPort;
  readonly recoveryRepository?: AgentWriteRecoveryPort;
  readonly failReplace?: (input: {
    phase: "apply" | "compensate" | "undo";
    relativePath: string;
  }) => boolean;
  readonly mutateBeforeFinalVerify?: (input: { relativePath: string }) => Promise<void>;
  readonly projectLock?: AgentWriteProjectLockPort;
  readonly lifecycleOperations?: AgentWriteLifecycleOperationPort;
  readonly trustedCreativeMutations?: AgentWriteTrustedCreativeMutationPort;
  readonly validateApply?: AgentWriteTransactionOptions["validateApply"];
  readonly disableNativeFileMutations?: boolean;
}

function createTransaction(
  projectRoot: string,
  options: TransactionTestOptions = {}
): AgentWriteTransaction {
  const operations = options.operations ?? [];
  let nextId = 0;
  const historyRepository =
    options.historyRepository ??
    new HistoryRepository({
      projectRoot,
      createVersionId: () => `ver_${++nextId}`,
      now: () => "2026-07-13T01:00:00.000Z"
    });
  const recoveryRepository = options.recoveryRepository ?? new RecoveryRepository({ projectRoot });
  const projectLock: AgentWriteProjectLockPort = options.projectLock ?? {
    async verifyProjectLockOwnership() {
      operations.push("lock");
      return ok(undefined);
    }
  };
  const lifecycleOperations =
    options.lifecycleOperations ??
    (options.disableNativeFileMutations === true
      ? undefined
      : createTestingLifecyclePort(projectRoot));

  return new AgentWriteTransaction({
    projectRoot,
    projectLock,
    historyRepository,
    recoveryRepository,
    now: () => "2026-07-13T01:00:00.000Z",
    createTransactionId: () => `tx_${++nextId}`,
    createVersionGroupId: () => `vg_${++nextId}`,
    createWriteId: () => `write_${++nextId}`,
    ...(lifecycleOperations === undefined ? {} : { lifecycleOperations }),
    ...(options.trustedCreativeMutations === undefined
      ? {}
      : { trustedCreativeMutations: options.trustedCreativeMutations }),
    ...(options.validateApply === undefined ? {} : { validateApply: options.validateApply }),
    allowUnsafeReplaceFileForTesting: true,
    replaceFile: async (input) => {
      operations.push(`replace:${input.phase}:${input.relativePath}`);
      if (options.failReplace?.(input) === true) {
        return {
          ok: false,
          error: {
            schemaVersion: "1.0",
            errorId: "err_injected",
            code: "INJECTED_REPLACE_FAILURE",
            category: "StorageError",
            message: "Injected replacement failure.",
            recoverability: "retryable",
            suggestedAction: "Retry the test transaction.",
            traceId: "test",
            createdAt: "2026-07-13T01:00:00.000Z"
          }
        };
      }
      await options.mutateBeforeFinalVerify?.({ relativePath: input.relativePath });
      const verified = await input.verifyImmediatelyBeforeReplace();
      if (!verified.ok) return verified;
      return ok(undefined);
    }
  });
}

function failingJournalRecovery(
  projectRoot: string,
  failedJournalWrite: number
): AgentWriteRecoveryPort {
  const recovery = new RecoveryRepository({ projectRoot });
  let journalWrites = 0;
  return {
    async writeAgentTransactionJournal(journal) {
      journalWrites += 1;
      if (journalWrites === failedJournalWrite) {
        return err(transactionTestError("AGENT_TRANSACTION_JOURNAL_WRITE_FAILED"));
      }
      return recovery.writeAgentTransactionJournal(journal);
    },
    readAgentTransactionJournal: (transactionId) =>
      recovery.readAgentTransactionJournal(transactionId),
    listAgentTransactionJournals: () => recovery.listAgentTransactionJournals()
  };
}

function failingJournalRecoveryFrom(
  projectRoot: string,
  firstFailedJournalWrite: number
): AgentWriteRecoveryPort {
  const recovery = new RecoveryRepository({ projectRoot });
  let journalWrites = 0;
  return {
    async writeAgentTransactionJournal(journal) {
      journalWrites += 1;
      if (journalWrites >= firstFailedJournalWrite) {
        return err(transactionTestError("AGENT_TRANSACTION_JOURNAL_WRITE_FAILED"));
      }
      return recovery.writeAgentTransactionJournal(journal);
    },
    readAgentTransactionJournal: (transactionId) =>
      recovery.readAgentTransactionJournal(transactionId),
    listAgentTransactionJournals: () => recovery.listAgentTransactionJournals()
  };
}

function appliedJournal(input: {
  readonly transactionId: string;
  readonly versionGroupId: string;
  readonly runSequence: number;
  readonly beforeContent: string;
  readonly candidateContent: string;
  readonly beforeVersionId: string;
}): AgentTransactionJournal {
  return {
    schemaVersion: "1.0",
    transactionId: input.transactionId,
    versionGroupId: input.versionGroupId,
    kind: "apply",
    runId: "run_01",
    runSequence: input.runSequence,
    checkpointId: `checkpoint_${input.runSequence}`,
    changeSetId: `changes_${input.runSequence}`,
    changeSetRevision: 1,
    changeSetChecksum: "c".repeat(64),
    writePolicy: "write_before_confirmation",
    approvalSource: "human_confirmation",
    approvalToken: approvalToken(`changes_${input.runSequence}`, 1, "c".repeat(64)),
    createdAt: "2026-07-13T01:00:00.000Z",
    updatedAt: "2026-07-13T01:00:00.000Z",
    transactionStatus: "applied",
    entries: [
      {
        writeId: `write_${input.runSequence}`,
        relativePath: "notes/one.md",
        assetType: "text",
        beforeChecksum: checksum(input.beforeContent),
        candidateChecksum: checksum(input.candidateContent),
        beforeContent: input.beforeContent,
        candidateContent: input.candidateContent,
        beforeVersionId: input.beforeVersionId,
        status: "applied"
      }
    ]
  };
}

function recordingHistory(operations: string[]): AgentWriteHistoryPort {
  let version = 0;
  return {
    async snapshotTextAsset(input) {
      operations.push(`snapshot:${input.relativePath ?? input.assetId}:${input.reason}`);
      return ok({
        schemaVersion: "1.0",
        versionId: `ver_${++version}`,
        assetType: input.assetType,
        assetId: input.assetId,
        reason: input.reason,
        createdBy: input.createdBy ?? "system",
        createdAt: "2026-07-13T01:00:00.000Z",
        checksum: `sha256:${checksum(input.content)}`
      });
    }
  };
}

function recordingRecovery(operations: string[]): AgentWriteRecoveryPort {
  const journals = new Map<string, AgentTransactionJournal>();
  return {
    async writeAgentTransactionJournal(journal) {
      operations.push(`journal:${journal.transactionStatus}`);
      journals.set(journal.transactionId, structuredClone(journal));
      return ok(journal);
    },
    async readAgentTransactionJournal(transactionId) {
      const journal = journals.get(transactionId);
      if (journal === undefined) throw new Error("Missing test journal.");
      return ok(journal);
    },
    async listAgentTransactionJournals() {
      return ok([...journals.values()]);
    }
  };
}

function createInput(
  files: AgentWriteTransactionInput["files"],
  overrides: Partial<AgentWriteTransactionInput> = {}
): AgentWriteTransactionInput {
  return {
    runId: "run_01",
    checkpointId: "checkpoint_01",
    changeSetId: "changes_01",
    revision: 1,
    checksum: "c".repeat(64),
    writePolicy: "write_before_confirmation",
    approvalSource: "human_confirmation",
    approvalToken: approvalToken("changes_01", 1, "c".repeat(64)),
    files,
    ...overrides
  };
}

function createTestingLifecyclePort(
  projectRoot: string,
  options: {
    readonly failKind?:
      | "replace_file"
      | "create_file"
      | "move_file"
      | "delete_file"
      | "create_directory"
      | "remove_directory";
    readonly beforeMutation?: (input: AgentWriteLifecycleMutation) => Promise<void>;
  } = {}
): AgentWriteLifecycleOperationPort {
  return {
    async mutate(input) {
      await options.beforeMutation?.(input);
      const beforeMatches = await lifecycleSnapshotsMatch(projectRoot, input.before);
      if (!beforeMatches) return err(transactionTestError("LIFECYCLE_PRECONDITION_FAILED"));
      if (options.failKind === input.kind) {
        return err(transactionTestError("LIFECYCLE_INJECTED_FAILURE"));
      }
      try {
        switch (input.kind) {
          case "replace_file":
            await writeFile(join(projectRoot, input.relativePath), input.content, "utf8");
            break;
          case "create_file":
            await writeFile(join(projectRoot, input.relativePath), input.content, {
              encoding: "utf8",
              flag: "wx"
            });
            break;
          case "move_file":
            await rename(join(projectRoot, input.sourcePath), join(projectRoot, input.targetPath));
            break;
          case "delete_file":
            await unlink(join(projectRoot, input.relativePath));
            break;
          case "create_directory":
            await mkdir(join(projectRoot, input.relativePath));
            break;
          case "remove_directory":
            await rmdir(join(projectRoot, input.relativePath));
            break;
        }
      } catch {
        return err(transactionTestError("LIFECYCLE_IO_FAILURE"));
      }
      return (await lifecycleSnapshotsMatch(projectRoot, input.after))
        ? ok(undefined)
        : err(transactionTestError("LIFECYCLE_POSTCONDITION_FAILED"));
    }
  };
}

async function lifecycleSnapshotsMatch(
  projectRoot: string,
  expected: readonly AgentOperationPathSnapshot[]
): Promise<boolean> {
  for (const snapshot of expected) {
    const current = await testingSnapshot(projectRoot, snapshot.relativePath);
    if (current.kind !== snapshot.kind || current.relativePath !== snapshot.relativePath)
      return false;
    if (
      current.kind === "file" &&
      (snapshot.kind !== "file" ||
        current.checksum !== snapshot.checksum ||
        current.content !== snapshot.content)
    ) {
      return false;
    }
  }
  return true;
}

async function testingSnapshot(
  projectRoot: string,
  relativePath: string
): Promise<AgentOperationPathSnapshot> {
  const target = join(projectRoot, relativePath);
  try {
    const stats = await lstat(target);
    if (stats.isDirectory()) return { kind: "directory", relativePath };
    if (!stats.isFile()) throw new Error("Unexpected test file type.");
    const content = await readFile(target, "utf8");
    return { kind: "file", relativePath, content, checksum: checksum(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing", relativePath };
    }
    throw error;
  }
}

function fileChange(
  relativePath: string,
  baseContent: string,
  candidateContent: string,
  assetType: "chapter" | "text"
): AgentWriteTransactionInput["files"][number] {
  return {
    relativePath,
    assetType,
    baseChecksum: checksum(baseContent),
    candidateChecksum: checksum(candidateContent),
    baseContent,
    candidateContent
  };
}

async function createProject(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-agent-write-"));
  tempRoots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return root;
}

async function readOnlyJournal(projectRoot: string): Promise<AgentTransactionJournal> {
  const journals = await readJournals(projectRoot);
  if (journals.length !== 1) {
    throw new Error("Expected one transaction journal.");
  }
  const journal = journals[0];
  if (journal === undefined) throw new Error("Expected one transaction journal.");
  return journal;
}

async function readJournals(projectRoot: string): Promise<readonly AgentTransactionJournal[]> {
  const journals = await new RecoveryRepository({ projectRoot }).listAgentTransactionJournals();
  if (!journals.ok) throw new Error(journals.error.message);
  return journals.value;
}

async function historyReasons(projectRoot: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const historyRoot = join(projectRoot, "history");
  const entries = await readdir(historyRoot, { recursive: true, withFileTypes: true });
  const recordPaths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(entry.parentPath, entry.name));
  const records = await Promise.all(
    recordPaths.map(async (path) => JSON.parse(await readFile(path, "utf8")) as { reason?: string })
  );
  return records.flatMap((record) => (record.reason === undefined ? [] : [record.reason]));
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function approvalToken(changeSetId: string, revision: number, changeSetChecksum: string): string {
  return checksum(`${changeSetId}:${revision}:${changeSetChecksum}`);
}

function transactionTestError(code: string) {
  return {
    schemaVersion: "1.0" as const,
    errorId: "err_test",
    code,
    category: "ValidationError" as const,
    message: "Test transaction error.",
    recoverability: "user-action" as const,
    suggestedAction: "Review and retry.",
    traceId: "test",
    createdAt: "2026-07-13T01:00:00.000Z"
  };
}
