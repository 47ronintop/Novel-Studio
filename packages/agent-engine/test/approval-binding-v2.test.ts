import { describe, expect, test } from "vitest";

import {
  createApprovalBindingV2,
  changeSetV2DisplayBindingChecksum,
  createChangeSetRevisionV2,
  checksumChangeSetText,
  decideChangeSetApprovalV2,
  isChangeSetV2,
  parseApprovalBindingV2,
  projectApprovalBindingV2ForDisplay,
  validateApprovalBindingV2
} from "../src/index.js";

const providerChecksum = "a".repeat(64);
const hash = "b".repeat(64);

function binding(overrides: Partial<Parameters<typeof createApprovalBindingV2>[0]> = {}) {
  return createApprovalBindingV2({
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: hash,
    providerSemanticVersionSetChecksum: providerChecksum,
    operationKind: "replace_file",
    selectionChecksum: hash,
    selectedOperationIds: ["notes/one.md"],
    operationOrderChecksum: hash,
    sourceRef: "file:notes/one.md",
    targetRef: "file:notes/one.md",
    baseChecksum: hash,
    candidateChecksum: "c".repeat(64),
    baseManifestChecksum: hash,
    candidateManifestChecksum: "c".repeat(64),
    encoding: "utf-8",
    bom: "absent",
    eol: "lf",
    approvalRuleSetVersion: "rules-2.0",
    approvalRuleSetChecksum: hash,
    proofId: "proof_01",
    proofChecksum: hash,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    approvalSource: "human_confirmation",
    issuedAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z",
    ...overrides
  });
}

describe("Approval Binding 2.0", () => {
  test("is strict and never projects the opaque capability or nonce", () => {
    const value = binding();
    const display = projectApprovalBindingV2ForDisplay(value);
    expect(display).not.toHaveProperty("capability");
    expect(display).not.toHaveProperty("nonce");
    expect(parseApprovalBindingV2(value)).toBe(value);

    const unknown = { ...value, displayBindingChecksum: hash };
    expect(validateApprovalBindingV2(unknown)).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_BINDING_V2_UNKNOWN_FIELD" }
    });
  });

  test("requires the recovery triple for delete and forbids it for replacement", () => {
    expect(() =>
      binding({ operationKind: "delete_file", recoveryRootBindingId: "recovery_01" })
    ).toThrow();
    expect(() =>
      binding({
        recoveryRootBindingId: "recovery_01",
        recoveryGrantRevision: "grant_01",
        recoverySideEffectChecksum: hash
      })
    ).toThrow();
    expect(
      binding({
        operationKind: "delete_file",
        recoveryRootBindingId: "recovery_01",
        recoveryGrantRevision: "grant_01",
        recoverySideEffectChecksum: hash
      }).operationKind
    ).toBe("delete_file");
  });

  test("a display checksum cannot authorize a Change Set 2.0", async () => {
    const changeSet = await createChangeSetRevisionV2({
      changeSetId: "changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      providerSemanticVersionSetChecksum: providerChecksum,
      proposal: {
        relativePath: "notes/one.md",
        assetType: "text",
        baseContent: "old",
        baseChecksum: checksumChangeSetText("old"),
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      },
      createdAt: "2099-01-01T00:00:00.000Z"
    });
    expect(isChangeSetV2(changeSet)).toBe(true);
    expect(changeSetV2DisplayBindingChecksum(changeSet)).toBe(changeSet.displayBindingChecksum);
    const signed = binding({
      changeSetChecksum: changeSet.checksum,
      selectedOperationIds: ["notes/one.md"]
    });
    expect(
      decideChangeSetApprovalV2({
        changeSet,
        decision: "apply_selected",
        displayBindingChecksum: "0".repeat(64),
        binding: signed,
        resolvedAt: "2099-01-01T00:00:01.000Z",
        now: Date.parse("2099-01-01T00:00:30.000Z")
      })
    ).toMatchObject({ ok: false, error: { code: "CHANGE_SET_DISPLAY_BINDING_MISMATCH" } });
  });

  test("rejects unknown top-level Change Set 2.0 fields", async () => {
    const changeSet = await createChangeSetRevisionV2({
      changeSetId: "changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      providerSemanticVersionSetChecksum: providerChecksum,
      proposal: {
        relativePath: "notes/one.md",
        assetType: "text",
        baseContent: "old",
        baseChecksum: checksumChangeSetText("old"),
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      },
      createdAt: "2099-01-01T00:00:00.000Z"
    });
    expect(isChangeSetV2({ ...changeSet, forged: true })).toBe(false);
    expect(isChangeSetV2({ ...changeSet, files: undefined })).toBe(false);
    expect(
      isChangeSetV2({
        ...changeSet,
        files: [{ ...changeSet.files[0], validation: null }]
      })
    ).toBe(false);
  });

  test("requires an explicit Main-owned reservation for apply", async () => {
    const changeSet = await createChangeSetRevisionV2({
      changeSetId: "changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      providerSemanticVersionSetChecksum: providerChecksum,
      proposal: {
        relativePath: "notes/one.md",
        assetType: "text",
        baseContent: "old",
        baseChecksum: checksumChangeSetText("old"),
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      },
      createdAt: "2099-01-01T00:00:00.000Z"
    });
    const result = decideChangeSetApprovalV2({
      changeSet,
      decision: "apply_selected",
      displayBindingChecksum: changeSet.displayBindingChecksum,
      binding: binding({
        changeSetChecksum: changeSet.checksum,
        selectedOperationIds: ["notes/one.md"]
      }),
      resolvedAt: "2099-01-01T00:00:01.000Z",
      now: Date.parse("2099-01-01T00:00:30.000Z")
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_V2_RESERVATION_REQUIRED" }
    });

    const forgedPreapproval = decideChangeSetApprovalV2({
      changeSet,
      decision: "apply_selected",
      displayBindingChecksum: changeSet.displayBindingChecksum,
      binding: binding({
        changeSetChecksum: changeSet.checksum,
        executionWritePolicy: "user_preapproved_run",
        approvalSource: "user_preapproved_run",
        selectedOperationIds: ["notes/one.md"]
      }),
      trustedConfirmationQualified: true,
      authorizationId: "auth_01",
      reservationTransactionId: "tx_01",
      resolvedAt: "2099-01-01T00:00:01.000Z",
      now: Date.parse("2099-01-01T00:00:30.000Z")
    });
    expect(forgedPreapproval).toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_TRUSTED_SURFACE_UNAVAILABLE" }
    });
  });
});
