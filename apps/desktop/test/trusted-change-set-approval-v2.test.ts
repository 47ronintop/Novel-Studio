import { describe, expect, test, vi } from "vitest";

import {
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
  LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
  approvalDecisionProofChecksum,
  checksumChangeSetSelection,
  checksumChangeSetText,
  createApprovalBindingV2,
  createMainOnlyApprovalDecisionProofV1,
  createChangeSetRevisionV2,
  createOperationsChangeSetRevisionV2,
  type ChangeSetV2
} from "@novel-studio/agent-engine";
import {
  buildEngineeringApprovalBindingV2,
  type AgentRunChangeSetApprovalV2ApprovalContext,
  type EngineeringApprovalBindingFactsV2
} from "@novel-studio/application";
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

  test("uses Main-validated raw-byte Engineering facts instead of inferring manifests from JS text", async () => {
    const changeSet = await engineeringChangeSetV2();
    const selectionChecksum = checksumChangeSetSelection(changeSet, []);
    const baseManifestChecksum = "6".repeat(64);
    const candidateManifestChecksum = "7".repeat(64);
    const proposalPayloadChecksum = "8".repeat(64);
    const proof = createMainOnlyApprovalDecisionProofV1({
      proofId: "engineering_proof_01",
      approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
      approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
      operation: "replace_file",
      binding: {
        workspaceBindingId: "workspace_01",
        rootBindingId: "engineering_root_01",
        runId: changeSet.runId,
        changeSetId: changeSet.changeSetId,
        changeSetRevision: changeSet.revision,
        changeSetChecksum: changeSet.checksum,
        consistencyGroupChecksum: selectionChecksum,
        proposalPayloadChecksum,
        baseManifestChecksum,
        candidateManifestChecksum,
        executionWritePolicy: "write_before_confirmation",
        policyRevision: "engineering_policy_01",
        capabilityRevision: "engineering_gate_01"
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
      rootBindingId: "engineering_root_01",
      operationKind: "replace_file",
      relativeIdentity: "src/file.ts",
      selectedOperationIds: ["src/file.ts"],
      selectionChecksum,
      operationOrderChecksum: checksumChangeSetText("src/file.ts"),
      sourceRef: `engineering_file_ref:${"a".repeat(32)}`,
      targetRef: `engineering_file_ref:${"a".repeat(32)}`,
      beforeKind: "present",
      baseChecksum: changeSet.files[0]?.baseChecksum ?? "",
      candidateChecksum: changeSet.files[0]?.candidateChecksum ?? "",
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
      policyRevision: "engineering_policy_01",
      capabilityRevision: "engineering_gate_01",
      providerSemanticVersionSetChecksum: checksum
    };
    const context: AgentRunChangeSetApprovalV2ApprovalContext = {
      proofRef: { proofId: proof.proofId, proofChecksum: approvalDecisionProofChecksum(proof) },
      workspaceBindingId: facts.workspaceBindingId,
      operation: "replace_file",
      approvalBindingOperationKind: "replace_file",
      approvalRuleSet: {
        version: facts.approvalRuleSetVersion,
        checksum: facts.approvalRuleSetChecksum,
        catalogRevision: "catalog_01"
      },
      capabilityBoundary: {
        canonicalRootIdentityChecksum: "9".repeat(64),
        effectiveCapabilityStateChecksum: checksum,
        sharingDefaultsRevision: checksum,
        sharingGrantRevision: checksum,
        policyRevision: facts.policyRevision,
        providerToolProjectionChecksum: checksum,
        providerSemanticVersionSetChecksum: checksum
      },
      engineeringApprovalFacts: facts,
      preview: {
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        checksum: changeSet.checksum,
        displayBindingChecksum: changeSet.displayBindingChecksum,
        providerSemanticVersionSetChecksum: checksum,
        selectionChecksum,
        baseManifestChecksum,
        candidateManifestChecksum
      }
    };
    const seed = buildEngineeringApprovalBindingV2({
      schemaVersion: "2.0",
      changeSet,
      facts,
      issuedAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:05:00.000Z"
    });
    if (!seed.ok) throw new Error(`${seed.error.code}: ${seed.error.message}`);
    expect(() => createApprovalBindingV2(seed.value)).not.toThrow();

    const built = buildTrustedApprovalPreparation({
      changeSet,
      context,
      workspaceLabel: "Engineering workspace",
      issuedAt: "2099-01-01T00:00:00.000Z"
    });
    if (!built.ok) throw new Error(`${built.error.code}: ${built.error.message}`);
    expect(built).toMatchObject({
      ok: true,
      value: {
        binding: {
          rootBindingId: facts.rootBindingId,
          baseManifestChecksum,
          candidateManifestChecksum,
          policyRevision: facts.policyRevision,
          capabilityRevision: facts.capabilityRevision,
          approvalSource: "human_confirmation"
        }
      }
    });
  });

  test("reserves the exact Main-planned lifecycle transaction only after confirmation", async () => {
    const clock = { value: "2099-01-01T00:00:00.000Z" };
    const changeSet = engineeringMoveChangeSetV2();
    const context = engineeringMoveApprovalContext(changeSet, "planned_lifecycle_tx_01");
    const { coordinator, ledger, modalController } = approvedHarness(clock);
    const fallbackTransactionId = vi.fn(() => "unexpected_fallback_tx");
    const reserve = vi.spyOn(ledger, "reserve");
    const port = createTrustedChangeSetApprovalV2Port({
      authorizationLedger: ledger,
      coordinator,
      modalController,
      resolveParentWindow: () => parentWindow,
      surfaceQualification: qualification,
      workspaceLabel: "Engineering workspace",
      now: () => clock.value,
      createTransactionId: fallbackTransactionId
    });

    await expect(port.prepare(applyInput(changeSet, context))).resolves.toMatchObject({
      ok: true,
      value: { reservationTransactionId: "planned_lifecycle_tx_01" }
    });
    expect(fallbackTransactionId).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledWith({
      authorizationId: expect.any(String),
      transactionId: "planned_lifecycle_tx_01"
    });

    expect(
      buildTrustedApprovalPreparation({
        changeSet,
        context: { ...context, engineeringReservationTransactionId: undefined },
        workspaceLabel: "Engineering workspace",
        issuedAt: clock.value
      })
    ).toMatchObject({ ok: false, error: { code: "CHANGE_SET_TRUSTED_APPROVAL_CONTEXT_STALE" } });
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

async function engineeringChangeSetV2(): Promise<ChangeSetV2> {
  const base = "const before = true;\n";
  return createChangeSetRevisionV2(
    {
      changeSetId: "engineering_changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      writePolicy: "write_before_confirmation",
      createdAt: "2099-01-01T00:00:00.000Z",
      providerSemanticVersionSetChecksum: checksum,
      proposal: {
        relativePath: "src/file.ts",
        assetType: "text",
        baseContent: base,
        baseChecksum: checksumChangeSetText(base),
        range: { unit: "character", start: 0, end: base.length },
        replacement: "const after = true;\n"
      }
    },
    { createHunkId: () => "engineering_hunk_01" }
  );
}

function engineeringMoveChangeSetV2(): ChangeSetV2 {
  return createOperationsChangeSetRevisionV2({
    changeSetId: "engineering_move_changes_01",
    runId: "run_01",
    projectId: "project_01",
    checkpointId: "checkpoint_01",
    contextSnapshotId: "context_01",
    operations: [
      {
        kind: "move_file",
        operationId: "move_op_01",
        sourcePath: "src/file.ts",
        targetPath: "src/renamed.ts",
        sourceChecksum: checksumChangeSetText("source"),
        toolCallIdempotencyKey: "tool_move_01"
      }
    ],
    createdAt: "2099-01-01T00:00:00.000Z",
    providerSemanticVersionSetChecksum: checksum,
    writePolicy: "write_before_confirmation"
  });
}

function engineeringMoveApprovalContext(
  changeSet: ChangeSetV2,
  plannedTransactionId: string
): AgentRunChangeSetApprovalV2ApprovalContext {
  const selectionChecksum = checksumChangeSetSelection(changeSet, []);
  const baseManifestChecksum = "6".repeat(64);
  const candidateManifestChecksum = "7".repeat(64);
  const proposalPayloadChecksum = "8".repeat(64);
  const proof = createMainOnlyApprovalDecisionProofV1({
    proofId: "engineering_move_proof_01",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    operation: "move_file",
    binding: {
      workspaceBindingId: "workspace_01",
      rootBindingId: "engineering_root_01",
      runId: changeSet.runId,
      changeSetId: changeSet.changeSetId,
      changeSetRevision: changeSet.revision,
      changeSetChecksum: changeSet.checksum,
      consistencyGroupChecksum: selectionChecksum,
      proposalPayloadChecksum,
      baseManifestChecksum,
      candidateManifestChecksum,
      executionWritePolicy: "write_before_confirmation",
      policyRevision: "engineering_policy_01",
      capabilityRevision: "engineering_gate_01"
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
    rootBindingId: "engineering_root_01",
    operationKind: "move_file",
    relativeIdentity: "src/file.ts",
    selectedOperationIds: ["move_op_01"],
    selectionChecksum,
    operationOrderChecksum: checksumChangeSetText("move_op_01"),
    sourceRef: `engineering_file_ref:${"a".repeat(32)}`,
    targetRef: `engineering_directory_ref:${"b".repeat(32)}`,
    beforeKind: "present",
    baseChecksum: checksumChangeSetText("source"),
    candidateChecksum: "not_applicable",
    baseManifestChecksum,
    candidateManifestChecksum,
    encoding: "not_applicable",
    bom: "not_applicable",
    eol: "not_applicable",
    approvalRuleSetVersion: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: LEGACY_ALL_HUMAN_APPROVAL_RULE_SET_CHECKSUM,
    proof,
    proposalPayloadChecksum,
    executionWritePolicy: "write_before_confirmation",
    policyRevision: "engineering_policy_01",
    capabilityRevision: "engineering_gate_01",
    providerSemanticVersionSetChecksum: checksum
  };
  return {
    proofRef: { proofId: proof.proofId, proofChecksum: approvalDecisionProofChecksum(proof) },
    workspaceBindingId: facts.workspaceBindingId,
    operation: "move_file",
    approvalBindingOperationKind: "move_file",
    approvalRuleSet: {
      version: facts.approvalRuleSetVersion,
      checksum: facts.approvalRuleSetChecksum,
      catalogRevision: "catalog_01"
    },
    capabilityBoundary: {
      canonicalRootIdentityChecksum: "9".repeat(64),
      effectiveCapabilityStateChecksum: checksum,
      sharingDefaultsRevision: checksum,
      sharingGrantRevision: checksum,
      policyRevision: facts.policyRevision,
      providerToolProjectionChecksum: checksum,
      providerSemanticVersionSetChecksum: checksum
    },
    engineeringApprovalFacts: facts,
    engineeringReservationTransactionId: plannedTransactionId,
    preview: {
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      displayBindingChecksum: changeSet.displayBindingChecksum,
      providerSemanticVersionSetChecksum: checksum,
      selectionChecksum,
      baseManifestChecksum,
      candidateManifestChecksum
    }
  };
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
