import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
  approvalDecisionProofChecksum,
  checksumChangeSetText,
  createApprovalBindingV2,
  createChangeSetRevisionV2,
  createMainOnlyApprovalDecisionProofV1,
  type ApprovalBindingV2,
  type ChangeSetV2
} from "@novel-studio/agent-engine";
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  buildEngineeringApprovalBindingV2,
  projectEngineeringApprovalApplyV2ForExternal,
  validateEngineeringApprovalApplyV2,
  validateEngineeringApprovalBindingV2,
  type EngineeringApprovalBindingFactsV2
} from "../src/engineering-file-approval-v2.js";
import {
  authorizeApprovalBindingV2,
  createMainApprovalIssuer,
  revokeApprovalBindingV2Authorization
} from "../src/agent-write-authorization.js";

const providerSemanticVersionSetChecksum = "a".repeat(64);
const issuedAt = "2099-01-01T00:00:00.000Z";
const expiresAt = "2099-01-01T01:00:00.000Z";

interface Fixture {
  readonly changeSet: ChangeSetV2;
  readonly facts: EngineeringApprovalBindingFactsV2;
  readonly binding: ApprovalBindingV2;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function expectOk<T>(result: Result<T, UnifiedError>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function fixture(): Promise<Fixture> {
  const changeSet = await createChangeSetRevisionV2({
    changeSetId: "changes_01",
    runId: "run_01",
    projectId: "project_01",
    checkpointId: "checkpoint_01",
    contextSnapshotId: "context_01",
    providerSemanticVersionSetChecksum,
    proposal: {
      relativePath: "notes/one.md",
      assetType: "text",
      baseContent: "old",
      baseChecksum: sha256("old"),
      range: { unit: "character", start: 0, end: 3 },
      replacement: "new"
    },
    createdAt: issuedAt
  });
  const selectedOperationIds = changeSet.files
    .filter((file) => file.selected)
    .map((file) => file.relativePath);
  const selectionChecksum = sha256("engineering-selection-v2");
  const baseManifestChecksum = sha256("before-manifest-v2");
  const candidateManifestChecksum = sha256("candidate-manifest-v2");
  const proposalPayloadChecksum = sha256("engineering-proposal-payload-v2");
  const proof = createMainOnlyApprovalDecisionProofV1({
    proofId: "proof_01",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    operation: "replace_file",
    binding: {
      workspaceBindingId: "workspace_01",
      rootBindingId: "root_01",
      runId: changeSet.runId,
      changeSetId: changeSet.changeSetId,
      changeSetRevision: changeSet.revision,
      changeSetChecksum: changeSet.checksum,
      consistencyGroupChecksum: selectionChecksum,
      proposalPayloadChecksum,
      baseManifestChecksum,
      candidateManifestChecksum,
      executionWritePolicy: "write_before_confirmation",
      policyRevision: "policy_01",
      capabilityRevision: "capability_01"
    },
    evidence: {
      pathClass: "ordinary",
      targetFreshness: "clean_stable",
      createOnly: "not_applicable",
      referenceImpact: "not_applicable",
      limits: "within",
      stateBoundary: "ordinary"
    }
  });
  const facts: EngineeringApprovalBindingFactsV2 = {
    schemaVersion: "2.0",
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    operationKind: "replace_file",
    relativeIdentity: "notes/one.md",
    selectedOperationIds,
    selectionChecksum,
    operationOrderChecksum: checksumChangeSetText(selectedOperationIds.join("\n")),
    sourceRef: "file:notes/one.md",
    targetRef: "file:notes/one.md",
    beforeKind: "present",
    baseChecksum: sha256("old"),
    candidateChecksum: sha256("new"),
    baseManifestChecksum,
    candidateManifestChecksum,
    encoding: "utf-8",
    bom: "absent",
    eol: "lf",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    proof,
    proposalPayloadChecksum,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    providerSemanticVersionSetChecksum
  };
  const seed = expectOk(
    buildEngineeringApprovalBindingV2({
      schemaVersion: "2.0",
      changeSet,
      facts,
      issuedAt,
      expiresAt
    })
  );
  const binding = createApprovalBindingV2(seed);
  authorizeApprovalBindingV2(binding, createMainApprovalIssuer());
  return { changeSet, facts, binding };
}

function reservedLedger(binding: ApprovalBindingV2, transactionId = "transaction_01") {
  return {
    async query(authorizationId: string, requestedTransactionId?: string) {
      if (authorizationId !== "auth_01" || requestedTransactionId !== transactionId) {
        throw new Error("unexpected ledger lookup");
      }
      return ok({
        schemaVersion: "2.0" as const,
        authorizationId,
        binding,
        providerSemanticVersionSetChecksum: binding.providerSemanticVersionSetChecksum,
        state: "reserved" as const,
        issuedAt: binding.issuedAt,
        expiresAt: binding.expiresAt,
        reservedTransactionId: transactionId,
        reservedAt: issuedAt,
        reserveWalId: "wal_01"
      });
    }
  };
}

describe("Engineering shared approval v2 boundary", () => {
  test("builds a canonical human-only binding from Change Set 2.0 and immutable rule proof", async () => {
    const value = await fixture();
    const result = validateEngineeringApprovalBindingV2({
      schemaVersion: "2.0",
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        rootBindingId: "root_01",
        operationKind: "replace_file",
        baseManifestChecksum: value.facts.baseManifestChecksum,
        candidateManifestChecksum: value.facts.candidateManifestChecksum,
        operationOrderChecksum: value.facts.operationOrderChecksum,
        proofChecksum: approvalDecisionProofChecksum(value.facts.proof),
        approvalSource: "human_confirmation"
      }
    });
  });

  test("rejects cross-root, run, revision, provider version-set, and rule-set replay", async () => {
    const value = await fixture();
    const seed = expectOk(
      buildEngineeringApprovalBindingV2({
        schemaVersion: "2.0",
        changeSet: value.changeSet,
        facts: value.facts,
        issuedAt,
        expiresAt
      })
    );
    const staleValues = [
      { rootBindingId: "root_02" },
      { runId: "run_02" },
      { changeSetRevision: 2 },
      { providerSemanticVersionSetChecksum: "b".repeat(64) },
      { approvalRuleSetVersion: "rules_other" }
    ] as const;

    for (const stale of staleValues) {
      const binding = createApprovalBindingV2({ ...seed, ...stale });
      expect(
        validateEngineeringApprovalBindingV2({
          schemaVersion: "2.0",
          changeSet: value.changeSet,
          facts: value.facts,
          binding
        })
      ).toMatchObject({ ok: false, error: { code: "ENGINEERING_FILE_APPROVAL_V2_BINDING_STALE" } });
    }
  });

  test("requires an ADR-qualified Main-owned binding and a matching reserved Ledger 2.0 record", async () => {
    const value = await fixture();
    const result = await validateEngineeringApprovalApplyV2({
      schemaVersion: "2.0",
      trustedApprovalQualified: true,
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      ledger: reservedLedger(value.binding)
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        authorizationId: "auth_01",
        reservationTransactionId: "transaction_01"
      }
    });

    const unavailable = await validateEngineeringApprovalApplyV2({
      schemaVersion: "2.0",
      trustedApprovalQualified: false,
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      ledger: reservedLedger(value.binding)
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_APPROVAL_V2_CORE_UNAVAILABLE" }
    });

    revokeApprovalBindingV2Authorization(value.binding);
    const noMainProvenance = await validateEngineeringApprovalApplyV2({
      schemaVersion: "2.0",
      trustedApprovalQualified: true,
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      ledger: reservedLedger(value.binding)
    });
    expect(noMainProvenance).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_APPROVAL_V2_CORE_UNAVAILABLE" }
    });
  });

  test("rejects legacy deterministic and engineering-specific approval tokens", async () => {
    const value = await fixture();
    const legacyChangeSet = { ...value.changeSet, approvalToken: "legacy-deterministic-token" };
    expect(
      buildEngineeringApprovalBindingV2({
        schemaVersion: "2.0",
        changeSet: legacyChangeSet as ChangeSetV2,
        facts: value.facts,
        issuedAt,
        expiresAt
      })
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_APPROVAL_V2_LEGACY_TOKEN_REJECTED" }
    });

    const forged = {
      schemaVersion: "2.0" as const,
      trustedApprovalQualified: true,
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      ledger: reservedLedger(value.binding),
      engineeringApprovalToken: "engineering-only-token"
    };
    await expect(validateEngineeringApprovalApplyV2(forged)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_FILE_APPROVAL_V2_LEGACY_TOKEN_REJECTED" }
    });
  });

  test("projects no capability, reservation, root identity, or WAL handle to external callers", async () => {
    const value = await fixture();
    const validated = await validateEngineeringApprovalApplyV2({
      schemaVersion: "2.0",
      trustedApprovalQualified: true,
      changeSet: value.changeSet,
      facts: value.facts,
      binding: value.binding,
      authorizationId: "auth_01",
      reservationTransactionId: "transaction_01",
      ledger: reservedLedger(value.binding)
    });
    const projection = projectEngineeringApprovalApplyV2ForExternal(expectOk(validated));
    const serialized = JSON.stringify(projection);
    for (const secret of [
      "capability",
      "nonce",
      "rootBindingId",
      "workspaceBindingId",
      "authorizationId",
      "reservationTransactionId",
      "reserveWalId",
      "wal_01"
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(projection).toMatchObject({
      schemaVersion: "2.0",
      changeSetId: value.changeSet.changeSetId,
      operationKind: "replace_file",
      proofChecksum: approvalDecisionProofChecksum(value.facts.proof)
    });
  });
});
