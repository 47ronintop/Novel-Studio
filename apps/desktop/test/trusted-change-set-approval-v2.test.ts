import { describe, expect, test, vi } from "vitest";

import {
  checksumChangeSetSelection,
  checksumChangeSetText,
  createChangeSetRevisionV2,
  type ChangeSetV2
} from "@novel-studio/agent-engine";
import type { AgentRunChangeSetApprovalV2ApprovalContext } from "@novel-studio/application";
import { ApprovalAuthorizationLedger } from "@novel-studio/repository";
import { ok } from "@novel-studio/shared";

import {
  MainApprovalConfirmationCoordinator,
  type TrustedApprovalSurfaceQualificationV1
} from "../src/main/agent-approval-confirmation.js";
import {
  buildTrustedApprovalPreparation,
  createTrustedChangeSetApprovalV2Port
} from "../src/main/trusted-change-set-approval-v2.js";

const checksum = "a".repeat(64);
const candidateChecksum = "b".repeat(64);
const qualification: TrustedApprovalSurfaceQualificationV1 = {
  schemaVersion: "1.0",
  status: "qualified",
  bundleDigest: checksum,
  qualificationRevision: "approval-ui-r1",
  sourceRevision: "1".repeat(40),
  approvalArtifactManifestChecksum: "2".repeat(64),
  qualificationMatrixRevision: "adr-0004-qualification-r1",
  qualificationMatrixChecksum: "3".repeat(64),
  automatedReportChecksum: "4".repeat(64),
  ownerApprovalId: "owner-approval-1",
  ownerKeyId: "owner-key-1",
  issuedAt: "2098-12-01T00:00:00.000Z",
  expiresAt: "2099-02-01T00:00:00.000Z",
  attestationChecksum: "5".repeat(64)
};

describe("Trusted Change Set Approval v2", () => {
  test("binds the exact frozen selection, order, proof, catalog, and boundary; issue then reserve", async () => {
    const clock = { value: "2099-01-01T00:00:00.000Z" };
    const changeSet = await changeSetV2();
    const context = approvalContext(changeSet);
    const { coordinator, ledger, displayInputs, modalController } = approvedHarness(clock);
    const port = createTrustedChangeSetApprovalV2Port({
      authorizationLedger: ledger,
      coordinator,
      modalController,
      resolveParentWindow: () => parentWindow,
      surfaceQualification: qualification,
      workspaceLabel: "Example workspace",
      now: () => clock.value,
      createTransactionId: () => "transaction_1"
    });

    const result = await port.prepare(applyInput(changeSet, context));
    expect(result).toMatchObject({
      ok: true,
      value: {
        changeSet,
        decision: "apply_selected",
        authorizationId: expect.any(String),
        reservationTransactionId: "transaction_1",
        trustedConfirmationQualified: true,
        binding: {
          workspaceBindingId: context.workspaceBindingId,
          rootBindingId: context.capabilityBoundary.canonicalRootIdentityChecksum,
          changeSetId: changeSet.changeSetId,
          changeSetRevision: changeSet.revision,
          changeSetChecksum: changeSet.checksum,
          providerSemanticVersionSetChecksum: changeSet.providerSemanticVersionSetChecksum,
          operationKind: "chapter_replace",
          selectionChecksum: context.preview.selectionChecksum,
          selectedOperationIds: ["chapters/chapter-01.md"],
          operationOrderChecksum: checksumChangeSetText("chapters/chapter-01.md"),
          baseManifestChecksum: context.preview.baseManifestChecksum,
          candidateManifestChecksum: context.preview.candidateManifestChecksum,
          proofId: context.proofRef.proofId,
          proofChecksum: context.proofRef.proofChecksum,
          approvalRuleSetVersion: context.approvalRuleSet.version,
          approvalRuleSetChecksum: context.approvalRuleSet.checksum,
          capabilityRevision: context.approvalRuleSet.catalogRevision,
          policyRevision: context.capabilityBoundary.policyRevision
        }
      }
    });
    if (!result.ok) return;
    await expect(
      ledger.query(result.value.authorizationId as string, result.value.reservationTransactionId)
    ).resolves.toMatchObject({ ok: true, value: { state: "reserved" } });

    expect(displayInputs).toHaveLength(1);
    const displayText = JSON.stringify(displayInputs[0]?.display);
    expect(displayText).not.toContain("capability");
    expect(displayText).not.toContain("authorizationId");
    expect(displayText).not.toContain("reservationTransactionId");
    expect(displayText).not.toContain(context.proofRef.proofId);
  });

  test("accepts one modal decision only and reserves exactly once on replay", async () => {
    const clock = { value: "2099-01-01T00:00:00.000Z" };
    const changeSet = await changeSetV2();
    const context = approvalContext(changeSet);
    const { coordinator, ledger, modalController, modalDecisions } = approvedHarness(clock, {
      replayDecision: true
    });
    const reserve = vi.spyOn(ledger, "reserve");
    const port = createTrustedChangeSetApprovalV2Port({
      authorizationLedger: ledger,
      coordinator,
      modalController,
      resolveParentWindow: () => parentWindow,
      surfaceQualification: qualification,
      workspaceLabel: "Example workspace",
      now: () => clock.value,
      createTransactionId: () => "transaction_replay"
    });

    await expect(port.prepare(applyInput(changeSet, context))).resolves.toMatchObject({ ok: true });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(modalDecisions).toHaveLength(2);
    expect(modalDecisions[1]).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_REPLAY_REJECTED" }
    });
  });

  test("never reserves when the trusted decision is cancelled, revoked, or expired", async () => {
    for (const mode of ["cancel", "revoke", "expire"] as const) {
      const clock = { value: "2099-01-01T00:00:00.000Z" };
      const changeSet = await changeSetV2();
      const context = approvalContext(changeSet);
      const { coordinator, ledger, modalController } = approvedHarness(clock, { mode });
      const reserve = vi.spyOn(ledger, "reserve");
      const port = createTrustedChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        coordinator,
        modalController,
        resolveParentWindow: () => parentWindow,
        surfaceQualification: qualification,
        workspaceLabel: "Example workspace",
        now: () => clock.value,
        createTransactionId: () => `transaction_${mode}`
      });

      await expect(port.prepare(applyInput(changeSet, context))).resolves.toMatchObject({
        ok: false,
        error: {
          code:
            mode === "cancel"
              ? "CHANGE_SET_TRUSTED_APPROVAL_DISMISSED"
              : "CHANGE_SET_TRUSTED_APPROVAL_REVOKED"
        }
      });
      expect(reserve).not.toHaveBeenCalled();
    }
  });

  test("fails closed for stale selection, wrong operation projection, and delete without recovery", async () => {
    const changeSet = await changeSetV2();
    const context = approvalContext(changeSet);
    expect(
      buildTrustedApprovalPreparation({
        changeSet,
        context: {
          ...context,
          preview: { ...context.preview, selectionChecksum: checksum }
        },
        workspaceLabel: "Example workspace",
        issuedAt: "2099-01-01T00:00:00.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "CHANGE_SET_TRUSTED_APPROVAL_CONTEXT_STALE" } });
    expect(
      buildTrustedApprovalPreparation({
        changeSet,
        context: { ...context, operation: "chapter_create" },
        workspaceLabel: "Example workspace",
        issuedAt: "2099-01-01T00:00:00.000Z"
      })
    ).toMatchObject({ ok: false, error: { code: "CHANGE_SET_TRUSTED_APPROVAL_CONTEXT_STALE" } });
    expect(
      buildTrustedApprovalPreparation({
        changeSet,
        context: {
          ...context,
          operation: "chapter_status",
          approvalBindingOperationKind: "chapter_delete"
        },
        workspaceLabel: "Example workspace",
        issuedAt: "2099-01-01T00:00:00.000Z"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_TRUSTED_APPROVAL_RECOVERY_BINDING_REQUIRED" }
    });
  });
});

function approvedHarness(
  clock: { value: string },
  options: {
    readonly replayDecision?: boolean;
    readonly mode?: "cancel" | "revoke" | "expire";
  } = {}
) {
  const ledger = new ApprovalAuthorizationLedger({ now: () => clock.value });
  const displayInputs: Array<Record<string, unknown>> = [];
  const modalDecisions: unknown[] = [];
  const core = new MainApprovalConfirmationCoordinator({
    authorizationLedger: ledger,
    nativeConfirm: async () => true,
    getSurfaceQualification: () => qualification,
    humanIntentEvidenceJournal: {
      async issue() {
        return ok(undefined);
      },
      async revoke() {
        return ok(undefined);
      }
    },
    now: () => clock.value,
    createId: (() => {
      let id = 0;
      return () => `id_${++id}`;
    })()
  });
  const coordinator = {
    prepare(input: Record<string, unknown>) {
      displayInputs.push(input);
      return core.prepare(input as never);
    },
    waitForDecision: core.waitForDecision.bind(core),
    revoke: core.revoke.bind(core)
  };
  const modalController = {
    async open(_parent: unknown, previewId: string) {
      const opened = core.openFromRenderer(11, previewId, 22);
      if (!opened.ok) return opened;
      if (options.mode === "revoke") {
        core.revoke(previewId, "approval_modal_closed");
        return ok(undefined);
      }
      if (options.mode === "expire") clock.value = "2099-01-01T00:06:00.000Z";
      const decision = await core.decideFromModal(22, {
        previewId,
        modalInstanceId: opened.value.modalInstanceId,
        nonce: opened.value.nonce,
        decision: options.mode === "cancel" ? "cancel" : "approve"
      });
      modalDecisions.push(decision);
      if (options.replayDecision) {
        modalDecisions.push(
          await core.decideFromModal(22, {
            previewId,
            modalInstanceId: opened.value.modalInstanceId,
            nonce: opened.value.nonce,
            decision: "approve"
          })
        );
      }
      return ok(undefined);
    }
  };
  return { coordinator, ledger, displayInputs, modalController, modalDecisions };
}

async function changeSetV2(): Promise<ChangeSetV2> {
  const base = "before";
  return createChangeSetRevisionV2(
    {
      changeSetId: "changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      writePolicy: "write_before_confirmation",
      createdAt: "2099-01-01T00:00:00.000Z",
      providerSemanticVersionSetChecksum: checksum,
      proposal: {
        relativePath: "chapters/chapter-01.md",
        assetType: "chapter",
        assetId: "chapter_01",
        baseContent: base,
        baseChecksum: checksumChangeSetText(base),
        range: { unit: "character", start: 0, end: base.length },
        replacement: "after"
      }
    },
    { createHunkId: () => "hunk_01" }
  );
}

function approvalContext(changeSet: ChangeSetV2): AgentRunChangeSetApprovalV2ApprovalContext {
  const selectionChecksum = checksumChangeSetSelection(changeSet, []);
  return {
    proofRef: { proofId: "proof_01", proofChecksum: checksum },
    workspaceBindingId: "workspace_01",
    operation: "chapter_replace",
    approvalBindingOperationKind: "chapter_replace",
    approvalRuleSet: {
      version: "novel-studio-core@1.0",
      checksum,
      catalogRevision: "catalog_01"
    },
    capabilityBoundary: {
      canonicalRootIdentityChecksum: "root_01",
      effectiveCapabilityStateChecksum: checksum,
      sharingDefaultsRevision: checksum,
      sharingGrantRevision: checksum,
      policyRevision: "policy_01",
      providerToolProjectionChecksum: checksum,
      providerSemanticVersionSetChecksum: checksum
    },
    preview: {
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      displayBindingChecksum: changeSet.displayBindingChecksum,
      providerSemanticVersionSetChecksum: changeSet.providerSemanticVersionSetChecksum,
      selectionChecksum,
      baseManifestChecksum: checksum,
      candidateManifestChecksum: candidateChecksum
    }
  };
}

function applyInput(
  changeSet: ChangeSetV2,
  approvalContext: AgentRunChangeSetApprovalV2ApprovalContext
) {
  return {
    changeSet,
    command: { decision: "apply_selected" },
    approvalContext
  } as never;
}

const parentWindow = {
  webContents: { id: 11 },
  isDestroyed: () => false
} as const;
