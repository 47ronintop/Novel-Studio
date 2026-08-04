import { describe, expect, test, vi } from "vitest";

import { createApprovalBindingV2 } from "@novel-studio/agent-engine";
import { ApprovalAuthorizationLedger } from "@novel-studio/repository";

import { MainApprovalConfirmationCoordinator } from "../src/main/agent-approval-confirmation.js";

const now = "2099-01-01T00:00:10.000Z";
const checksum = "a".repeat(64);

function binding() {
  return createApprovalBindingV2({
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: checksum,
    providerSemanticVersionSetChecksum: checksum,
    operationKind: "replace_file",
    selectionChecksum: checksum,
    selectedOperationIds: ["notes/one.md"],
    operationOrderChecksum: checksum,
    sourceRef: "file:notes/one.md",
    targetRef: "file:notes/one.md",
    baseChecksum: checksum,
    candidateChecksum: "b".repeat(64),
    baseManifestChecksum: checksum,
    candidateManifestChecksum: "b".repeat(64),
    encoding: "utf-8",
    bom: "absent",
    eol: "lf",
    approvalRuleSetVersion: "rules-2.0",
    approvalRuleSetChecksum: checksum,
    proofId: "proof_01",
    proofChecksum: checksum,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    approvalSource: "human_confirmation",
    issuedAt: "2099-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
}

function coordinator(nativeConfirm = vi.fn(async () => true)) {
  return {
    nativeConfirm,
    coordinator: new MainApprovalConfirmationCoordinator({
      authorizationLedger: new ApprovalAuthorizationLedger({ now: () => now }),
      nativeConfirm,
      now: () => now,
      createId: (() => {
        let id = 0;
        return () => `id_${++id}`;
      })()
    })
  };
}

function prepare(coordinator: MainApprovalConfirmationCoordinator) {
  return coordinator.prepare({
    parentWebContentsId: 10,
    action: "plan_to_act",
    displayChecksum: "d".repeat(64),
    canonicalChecksum: checksum,
    binding: binding(),
    bundleDigest: checksum,
    qualificationRevision: "approval-ui-r1",
    expiresAt: "2099-01-01T01:00:00.000Z"
  });
}

describe("ADR-0004 Main approval confirmation", () => {
  test("keeps every production confirmation entrypoint unavailable before qualification", async () => {
    const { coordinator: subject, nativeConfirm } = coordinator();
    expect(prepare(subject)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(subject.openFromRenderer(10, "preview_forged", 22)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(subject.readFromModal(22, "preview_forged")).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: "preview_forged",
        modalInstanceId: "modal_forged",
        nonce: "nonce_forged",
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  test("does not let caller-supplied bundle or qualification claims enable the surface", async () => {
    const nativeConfirm = vi.fn(async () => true);
    const { coordinator: subject } = coordinator(nativeConfirm);
    const forged = {
      parentWebContentsId: 10,
      action: "plan_to_act" as const,
      displayChecksum: "d".repeat(64),
      canonicalChecksum: checksum,
      binding: binding(),
      bundleDigest: "f".repeat(64),
      qualificationRevision: "caller-claims-qualified-r999",
      expiresAt: "2099-01-01T01:00:00.000Z"
    };
    expect(subject.prepare(forged)).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    await expect(
      subject.decideFromModal(22, {
        previewId: "approval_claimed",
        modalInstanceId: "modal_claimed",
        nonce: "nonce_claimed",
        decision: "approve"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_SURFACE_UNAVAILABLE" }
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
