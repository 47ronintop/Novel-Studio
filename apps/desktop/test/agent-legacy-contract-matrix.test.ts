import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

type ReaderDisposition =
  | "replay_only"
  | "read_only"
  | "view_or_reject_only"
  | "legacy_recovery_only"
  | "explicit_reject"
  | "missing_new_contract";

interface LegacyContractMatrix {
  readonly schemaVersion: "1.0";
  readonly baselineCommit: string;
  readonly frozenForBatch: "0";
  readonly contracts: readonly LegacyContractEntry[];
  readonly legacyPendingChangeSet: {
    readonly record: Record<string, unknown>;
    readonly migrationExpectation: {
      readonly disposition: "view_or_reject_only";
      readonly v2ApplyAllowed: false;
      readonly rebuildRequiredForExecution: true;
      readonly ownerTask: "1.2b";
    };
  };
}

interface LegacyContractEntry {
  readonly id: string;
  readonly currentVersions: readonly string[];
  readonly targetVersion: string;
  readonly writerPaths: readonly string[];
  readonly readerPaths: readonly string[];
  readonly sourceAnchors: readonly string[];
  readonly tests: readonly { readonly path: string; readonly title: string }[];
  readonly readerDisposition: ReaderDisposition;
  readonly grantsNewPermissions: false;
  readonly futureOwnerTask: string;
}

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixturePath = join(
  repositoryRoot,
  "apps",
  "desktop",
  "test",
  "fixtures",
  "agent-legacy-contract-matrix.json"
);

const expectedContractIds = [
  "system_guidance",
  "prompt_artifact",
  "agent_run_tool_catalog",
  "message_order",
  "provider_visible_untrusted_envelope",
  "legacy_context_runtime_facts",
  "provider_visible_runtime_facts",
  "writing_task_intent",
  "writing_generation_guidance",
  "provider_semantic_version_set",
  "context_snapshot",
  "packed_agent_context_manifest",
  "canonical_round_manifest",
  "permission_summary",
  "approval_rule_and_decision_proof",
  "change_set",
  "approval_binding",
  "authorization_ledger",
  "run_snapshot_and_event",
  "run_draft",
  "plan_artifact",
  "plan_execution",
  "engineering_transaction_journal",
  "prompt_cache_identity",
  "context_budget_identity"
] as const;

describe("Agent legacy contract matrix", () => {
  test("exhaustively freezes the Batch 0 legacy and missing-target contract ids", async () => {
    const matrix = await readMatrix();
    expect(matrix).toMatchObject({
      schemaVersion: "1.0",
      baselineCommit: "5c234d4",
      frozenForBatch: "0"
    });
    expect(matrix.contracts.map(({ id }) => id)).toEqual(expectedContractIds);
    expect(new Set(matrix.contracts.map(({ id }) => id)).size).toBe(matrix.contracts.length);

    for (const contract of matrix.contracts) {
      expect(new Set(contract.currentVersions).size, contract.id).toBe(
        contract.currentVersions.length
      );
      expect(contract.grantsNewPermissions, contract.id).toBe(false);
      expect(contract.futureOwnerTask.length, contract.id).toBeGreaterThan(0);
      if (contract.readerDisposition === "missing_new_contract") {
        expect(contract.currentVersions, contract.id).toEqual([]);
        expect(contract.writerPaths, contract.id).toEqual([]);
        expect(contract.readerPaths, contract.id).toEqual([]);
        expect(contract.sourceAnchors, contract.id).toEqual([]);
        expect(contract.tests, contract.id).toEqual([]);
      } else {
        expect(contract.currentVersions.length, contract.id).toBeGreaterThan(0);
        expect(contract.writerPaths.length, contract.id).toBeGreaterThan(0);
        expect(contract.readerPaths.length, contract.id).toBeGreaterThan(0);
        expect(contract.sourceAnchors.length, contract.id).toBeGreaterThan(0);
        expect(contract.tests.length, contract.id).toBeGreaterThan(0);
      }
    }
  });

  test("binds every implemented contract to existing source anchors and named compatibility tests", async () => {
    const matrix = await readMatrix();
    for (const contract of matrix.contracts) {
      if (contract.readerDisposition === "missing_new_contract") continue;
      const sourcePaths = [...new Set([...contract.writerPaths, ...contract.readerPaths])];
      const sourceBodies = await Promise.all(
        sourcePaths.map(async (path) => {
          await expect(stat(join(repositoryRoot, path)), path).resolves.toBeDefined();
          return readFile(join(repositoryRoot, path), "utf8");
        })
      );
      for (const anchor of contract.sourceAnchors) {
        expect(
          sourceBodies.some((body) => body.includes(anchor)),
          `${contract.id}:${anchor}`
        ).toBe(true);
      }
      for (const carryingTest of contract.tests) {
        const testBody = await readFile(join(repositoryRoot, carryingTest.path), "utf8");
        expect(testBody, `${contract.id}:${carryingTest.title}`).toContain(carryingTest.title);
      }
    }
  });

  test("freezes the deterministic pending Change Set token as view-or-reject only", async () => {
    const { legacyPendingChangeSet } = await readMatrix();
    const record = legacyPendingChangeSet.record;
    const expectedToken = createHash("sha256")
      .update(
        `${String(record["changeSetId"])}:${String(record["revision"])}:${String(record["checksum"])}`,
        "utf8"
      )
      .digest("hex");
    expect(record).toMatchObject({
      schemaVersion: "1.0",
      status: "awaiting_approval",
      approvalToken: expectedToken
    });
    expect(legacyPendingChangeSet.migrationExpectation).toEqual({
      disposition: "view_or_reject_only",
      v2ApplyAllowed: false,
      rebuildRequiredForExecution: true,
      ownerTask: "1.2b"
    });
  });
});

async function readMatrix(): Promise<LegacyContractMatrix> {
  return JSON.parse(await readFile(fixturePath, "utf8")) as LegacyContractMatrix;
}
