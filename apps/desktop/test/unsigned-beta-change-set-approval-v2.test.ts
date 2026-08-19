import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";
import {
  checksumChangeSetSelection,
  checksumChangeSetText,
  createChangeSetRevisionV2,
  type ChangeSetV2
} from "@novel-studio/agent-engine";
import type {
  AgentRunChangeSetApprovalV2ApprovalContext,
  AgentRunChangeSetApprovalV2Port
} from "@novel-studio/application";
import { ApprovalAuthorizationLedger } from "@novel-studio/repository";

import {
  createUnsignedBetaAuthorizationService,
  createUnsignedBetaPackageIdentityChecksum
} from "../src/main/unsigned-beta-qualification.js";
import { createUnsignedBetaChangeSetApprovalV2Port } from "../src/main/unsigned-beta-change-set-approval-v2.js";

const checksum = "a".repeat(64);

describe("Unsigned beta Change Set Approval v2", () => {
  test("confirms, issues, and reserves the exact Main-built binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-unsigned-beta-"));
    try {
      const clock = { value: "2099-01-01T00:00:00.000Z" };
      const packageIdentityChecksum = createUnsignedBetaPackageIdentityChecksum({
        appVersion: "1.0.0",
        appRoot: root
      });
      const auth = createUnsignedBetaAuthorizationService({
        userDataRoot: root,
        packageIdentityChecksum,
        now: () => clock.value
      });
      const grant = await auth.requestAuthorization(async () => true);
      const ledger = new ApprovalAuthorizationLedger({ now: () => clock.value });
      let display: unknown;
      const port = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async (value) => {
          display = value;
          return true;
        },
        workspaceLabel: "Unsigned beta workspace",
        now: () => clock.value,
        createTransactionId: () => "unsigned_beta_tx_01"
      });

      const changeSet = await changeSetV2();
      const result = await port.prepare(input(changeSet));
      expect(result).toMatchObject({
        ok: true,
        value: {
          decision: "apply_selected",
          reservationTransactionId: "unsigned_beta_tx_01",
          binding: {
            changeSetId: changeSet.changeSetId,
            selectedOperationIds: ["chapters/chapter-01.md"]
          }
        }
      });
      expect(display).toMatchObject({
        workspaceLabel: "Unsigned beta workspace",
        changeSetId: changeSet.changeSetId
      });
      if (result.ok) {
        await expect(
          ledger.query(result.value.authorizationId as string, "unsigned_beta_tx_01")
        ).resolves.toMatchObject({ ok: true, value: { state: "reserved" } });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not issue or reserve when cancelled, revoked, or near expiry", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-unsigned-beta-"));
    try {
      const clock = { value: "2099-01-01T00:00:00.000Z" };
      const packageIdentityChecksum = createUnsignedBetaPackageIdentityChecksum({
        appVersion: "1",
        appRoot: root
      });
      const auth = createUnsignedBetaAuthorizationService({
        userDataRoot: root,
        packageIdentityChecksum,
        now: () => clock.value
      });
      const grant = await auth.requestAuthorization(async () => true);
      const ledger = new ApprovalAuthorizationLedger({ now: () => clock.value });
      const issue = vi.spyOn(ledger, "issue");
      const reserve = vi.spyOn(ledger, "reserve");
      const changeSet = await changeSetV2();

      const cancelled = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => false,
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(cancelled.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_APPROVAL_DISMISSED" }
      });
      expect(issue).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();

      // The grant is still current, but its remaining lifetime is shorter than the
      // generated five-minute binding and must therefore fail closed.
      clock.value = "2099-01-01T23:58:00.000Z";
      const nearExpiry = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => true,
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(nearExpiry.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_REQUIRED" }
      });

      await auth.revoke("test-revoked");
      const revoked = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => true,
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(revoked.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_REQUIRED" }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails closed if the Main grant changes while the confirmation is open", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-unsigned-beta-"));
    try {
      const clock = { value: "2099-01-01T00:00:00.000Z" };
      const packageIdentityChecksum = createUnsignedBetaPackageIdentityChecksum({
        appVersion: "1",
        appRoot: root
      });
      const auth = createUnsignedBetaAuthorizationService({
        userDataRoot: root,
        packageIdentityChecksum,
        now: () => clock.value
      });
      const grant = await auth.requestAuthorization(async () => true);
      const ledger = new ApprovalAuthorizationLedger({ now: () => clock.value });
      const port = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => {
          await auth.revoke("during-confirmation");
          return true;
        },
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(port.prepare(input(await changeSetV2()))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_STALE" }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects another workspace and operations outside the creative beta scope", async () => {
    const ledger = new ApprovalAuthorizationLedger();
    const confirm = vi.fn(async () => true);
    const port = createUnsignedBetaChangeSetApprovalV2Port({
      authorizationLedger: ledger,
      getCurrentAuthorization: () => undefined,
      packageIdentityChecksum: checksum,
      workspaceBindingId: "workspace_01",
      projectId: "project_01",
      confirm,
      workspaceLabel: "workspace"
    });
    const changeSet = await changeSetV2();
    const current = input(changeSet);

    await expect(
      port.prepare({
        ...current,
        approvalContext: { ...current.approvalContext, workspaceBindingId: "workspace_02" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_UNSIGNED_BETA_SCOPE_REJECTED" }
    });
    await expect(
      port.prepare({
        ...current,
        approvalContext: {
          ...current.approvalContext,
          operation: "delete_file",
          approvalBindingOperationKind: "delete_file"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_UNSIGNED_BETA_SCOPE_REJECTED" }
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  test("fails closed on confirmation and reservation faults and revokes issued authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-unsigned-beta-"));
    try {
      const clock = { value: "2099-01-01T00:00:00.000Z" };
      const packageIdentityChecksum = createUnsignedBetaPackageIdentityChecksum({
        appVersion: "1",
        appRoot: root
      });
      const auth = createUnsignedBetaAuthorizationService({
        userDataRoot: root,
        packageIdentityChecksum,
        now: () => clock.value
      });
      const grant = await auth.requestAuthorization(async () => true);
      const changeSet = await changeSetV2();

      const confirmationFailure = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: new ApprovalAuthorizationLedger({ now: () => clock.value }),
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => {
          throw new Error("native dialog failed");
        },
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(confirmationFailure.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_CONFIRMATION_FAILED" }
      });

      const ledger = new ApprovalAuthorizationLedger({ now: () => clock.value });
      vi.spyOn(ledger, "reserve").mockRejectedValueOnce(new Error("reservation failed"));
      const revoke = vi.spyOn(ledger, "revoke");
      const reservationFailure = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: ledger,
        getCurrentAuthorization: () => grant,
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => true,
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(reservationFailure.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_RESERVATION_FAILED" }
      });
      expect(revoke).toHaveBeenCalledWith(expect.any(String), "authorization_reservation_failed");

      const staleLedger = new ApprovalAuthorizationLedger({ now: () => clock.value });
      const staleRevoke = vi.spyOn(staleLedger, "revoke");
      let authorizationReads = 0;
      const staleAfterReservation = createUnsignedBetaChangeSetApprovalV2Port({
        authorizationLedger: staleLedger,
        getCurrentAuthorization: () => {
          authorizationReads += 1;
          return authorizationReads < 3 ? grant : undefined;
        },
        packageIdentityChecksum,
        workspaceBindingId: "workspace_01",
        projectId: "project_01",
        confirm: async () => true,
        workspaceLabel: "workspace",
        now: () => clock.value
      });
      await expect(staleAfterReservation.prepare(input(changeSet))).resolves.toMatchObject({
        ok: false,
        error: { code: "CHANGE_SET_UNSIGNED_BETA_AUTHORIZATION_STALE" }
      });
      expect(staleRevoke).toHaveBeenCalledWith(expect.any(String), "beta_authorization_stale");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function changeSetV2(): Promise<ChangeSetV2> {
  const base = "before\n";
  return createChangeSetRevisionV2(
    {
      changeSetId: "unsigned_beta_changes_01",
      runId: "run_01",
      projectId: "project_01",
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      writePolicy: "write_before_confirmation",
      createdAt: "2099-01-01T00:00:00.000Z",
      providerSemanticVersionSetChecksum: checksum,
      proposal: {
        relativePath: "chapters/chapter-01.md",
        assetType: "text",
        baseContent: base,
        baseChecksum: checksumChangeSetText(base),
        range: { unit: "character", start: 0, end: base.length },
        replacement: "after\n"
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
    operation: "replace_file",
    approvalBindingOperationKind: "replace_file",
    approvalRuleSet: { version: "novel-studio-core@1.0", checksum, catalogRevision: "catalog_01" },
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
      candidateManifestChecksum: "b".repeat(64)
    }
  };
}

function input(changeSet: ChangeSetV2): Parameters<AgentRunChangeSetApprovalV2Port["prepare"]>[0] {
  return {
    changeSet,
    command: { decision: "apply_selected" },
    approvalContext: approvalContext(changeSet)
  };
}
