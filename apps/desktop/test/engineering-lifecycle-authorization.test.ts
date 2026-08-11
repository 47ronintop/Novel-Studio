import { describe, expect, test } from "vitest";

import { approvalBindingV2Checksum, createApprovalBindingV2 } from "@novel-studio/agent-engine";
import {
  ApprovalAuthorizationLedger,
  engineeringLifecycleSideEffectSubjectChecksumV2,
  type EngineeringLifecycleWriteTransactionInputV2
} from "@novel-studio/repository";

import { verifyEngineeringPreparedLifecycleAuthorization } from "../src/main/index.js";

const NOW = "2099-01-01T00:10:00.000Z";
const PROVIDER_CHECKSUM = "a".repeat(64);
const CHANGE_SET_CHECKSUM = "b".repeat(64);

describe("production Engineering lifecycle authorization", () => {
  test("accepts consumed authorization only for an explicit terminal-state check", async () => {
    const fixture = await createFixture();

    await expect(
      verifyEngineeringPreparedLifecycleAuthorization(fixture.ledger, fixture.prepared)
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyEngineeringPreparedLifecycleAuthorization(fixture.ledger, fixture.prepared, [
        "consumed"
      ])
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_AUTHORIZATION_BINDING_STALE" }
    });

    await expect(
      fixture.ledger.consume(fixture.authorizationId, fixture.prepared.transactionId)
    ).resolves.toMatchObject({ ok: true, value: { state: "consumed" } });
    await expect(
      verifyEngineeringPreparedLifecycleAuthorization(fixture.ledger, fixture.prepared)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_AUTHORIZATION_BINDING_STALE" }
    });
    await expect(
      verifyEngineeringPreparedLifecycleAuthorization(fixture.ledger, fixture.prepared, [
        "reserved",
        "consumed"
      ])
    ).resolves.toMatchObject({ ok: true });
  });

  test("keeps terminal checks bound to the exact Change Set and ordered operations", async () => {
    const fixture = await createFixture();
    await fixture.ledger.consume(fixture.authorizationId, fixture.prepared.transactionId);
    const originalOperation = fixture.prepared.operations[0];
    if (originalOperation === undefined) throw new Error("expected lifecycle operation");

    const staleChangeSet = {
      ...fixture.prepared,
      authorization: {
        ...fixture.prepared.authorization,
        changeSetRevision: fixture.prepared.authorization.changeSetRevision + 1
      }
    };
    const staleOperation = {
      ...fixture.prepared,
      operations: [
        {
          ...originalOperation,
          request: {
            ...originalOperation.request,
            relativeTarget: "src/other.ts"
          }
        }
      ]
    };

    for (const prepared of [staleChangeSet, staleOperation]) {
      await expect(
        verifyEngineeringPreparedLifecycleAuthorization(
          fixture.ledger,
          prepared as EngineeringLifecycleWriteTransactionInputV2,
          ["reserved", "consumed"]
        )
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_AUTHORIZATION_BINDING_STALE" }
      });
    }
  });
});

async function createFixture() {
  const transactionId = "lifecycle_transaction_01";
  const authorizationId = "lifecycle_authorization_01";
  const contentRootBindingId = "root_01";
  const request = {
    schemaVersion: "3.0" as const,
    operationKind: "move_file" as const,
    transactionId,
    operationId: "lifecycle_operation_01",
    contentRootBindingId,
    relativeSource: "src/old.ts",
    relativeTarget: "src/new.ts",
    sourceFileIdentity: "file_lifecycle_01",
    sourceSha256: "c".repeat(64),
    targetProof: "absent" as const,
    recoveryRootBindingId: "",
    recoveryGrantRevision: "",
    recoverySideEffectChecksum: "d".repeat(64),
    recoveryObjectId: "",
    stagingObjectId: "staging_lifecycle_01",
    expectedState: "wal_prepared" as const
  };
  const binding = createApprovalBindingV2({
    workspaceBindingId: "workspace_01",
    rootBindingId: contentRootBindingId,
    runId: "run_01",
    changeSetId: "change_set_01",
    changeSetRevision: 1,
    changeSetChecksum: CHANGE_SET_CHECKSUM,
    providerSemanticVersionSetChecksum: PROVIDER_CHECKSUM,
    operationKind: "move_file",
    selectionChecksum: "e".repeat(64),
    selectedOperationIds: [request.operationId],
    operationOrderChecksum: "f".repeat(64),
    sourceRef: "file:src/old.ts",
    targetRef: "file:src/new.ts",
    baseChecksum: request.sourceSha256,
    candidateChecksum: request.sourceSha256,
    baseManifestChecksum: "1".repeat(64),
    candidateManifestChecksum: "2".repeat(64),
    encoding: "not_applicable",
    bom: "not_applicable",
    eol: "not_applicable",
    approvalRuleSetVersion: "rules-2.0",
    approvalRuleSetChecksum: "3".repeat(64),
    proofId: "proof_01",
    proofChecksum: "4".repeat(64),
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    approvalSource: "human_confirmation",
    issuedAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
  const prepared: EngineeringLifecycleWriteTransactionInputV2 = {
    schemaVersion: "2.0",
    transactionId,
    contentRootBindingId,
    providerSemanticVersionSetChecksum: PROVIDER_CHECKSUM,
    authorization: {
      authorizationId,
      approvalBindingId: binding.bindingId,
      approvalBindingChecksum: approvalBindingV2Checksum(binding),
      sideEffectSubjectChecksum: engineeringLifecycleSideEffectSubjectChecksumV2({
        transactionId,
        contentRootBindingId,
        providerSemanticVersionSetChecksum: PROVIDER_CHECKSUM,
        operations: [request]
      }),
      changeSetId: binding.changeSetId,
      changeSetRevision: binding.changeSetRevision,
      changeSetChecksum: binding.changeSetChecksum
    },
    operations: [{ request, recoveryBinding: null }],
    preparedAt: NOW
  };
  const ledger = new ApprovalAuthorizationLedger({ now: () => NOW });
  await ledger.issue({ binding, authorizationId });
  await ledger.reserve({ authorizationId, transactionId });
  return { authorizationId, ledger, prepared };
}
