import { describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ApprovalAuthorizationLedger,
  projectAuthorizationLedgerRecordForDisplay,
  RecoveryRepository
} from "../src/index.js";
import { createApprovalBindingV2 } from "@novel-studio/agent-engine";

const checksum = "a".repeat(64);

function binding(expiresAt = "2099-01-01T01:00:00.000Z") {
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
    expiresAt
  });
}

describe("Authorization Ledger 2.0", () => {
  test("enforces issued -> reserved -> consumed and transaction ownership", async () => {
    const ledger = new ApprovalAuthorizationLedger({ now: () => "2099-01-01T00:00:10.000Z" });
    const issued = await ledger.issue(binding());
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const reserved = await ledger.reserve({
      authorizationId: issued.value.authorizationId,
      transactionId: "tx_01"
    });
    expect(reserved).toMatchObject({
      ok: true,
      value: { state: "reserved", reservedTransactionId: "tx_01" }
    });
    await expect(ledger.query(issued.value.authorizationId, "tx_other")).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTHORIZATION_LEDGER_TRANSACTION_MISMATCH" }
    });
    const consumed = await ledger.consume(issued.value.authorizationId, "tx_01");
    expect(consumed).toMatchObject({ ok: true, value: { state: "consumed" } });
  });

  test("revokes an orphan reservation without touching project files", async () => {
    const ledger = new ApprovalAuthorizationLedger({ now: () => "2099-01-01T00:00:10.000Z" });
    const issued = await ledger.issue(binding());
    if (!issued.ok) throw new Error(issued.error.message);
    await ledger.reserve(issued.value.authorizationId, "tx_orphan");
    const reconciled = await ledger.reconcileOrphanReservations();
    expect(reconciled).toMatchObject({ ok: true, value: [issued.value.authorizationId] });
    await expect(ledger.query(issued.value.authorizationId)).resolves.toMatchObject({
      ok: true,
      value: { state: "revoked" }
    });
  });

  test("display projection does not expose capability", async () => {
    const ledger = new ApprovalAuthorizationLedger({ now: () => "2099-01-01T00:00:10.000Z" });
    const issued = await ledger.issue(binding());
    if (!issued.ok) throw new Error(issued.error.message);
    const display = projectAuthorizationLedgerRecordForDisplay(issued.value);
    expect(display.binding).not.toHaveProperty("capability");
    expect(display.binding).not.toHaveProperty("nonce");
  });

  test("does not accept a caller-supplied WAL that differs from the persisted reservation", async () => {
    const ledger = new ApprovalAuthorizationLedger({ now: () => "2099-01-01T00:00:10.000Z" });
    const issued = await ledger.issue(binding());
    if (!issued.ok) throw new Error(issued.error.message);
    await ledger.reserve(issued.value.authorizationId, "tx_orphan");
    const wals = await ledger.listReservationWals();
    if (!wals.ok || wals.value[0] === undefined) throw new Error("reservation WAL missing");
    const forged = { ...wals.value[0], transactionId: "tx_other" };

    await expect(
      ledger.reconcileOrphanReservations({
        preparedTransactionIds: ["tx_orphan"],
        reservationWals: [forged]
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "AUTHORIZATION_LEDGER_WAL_MISMATCH" } });
    await expect(ledger.query(issued.value.authorizationId, "tx_orphan")).resolves.toMatchObject({
      ok: true,
      value: { state: "reserved" }
    });
  });

  test("reconciles reservations when the transaction journal directory is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-ledger-"));
    try {
      const ledger = new ApprovalAuthorizationLedger({
        projectRoot: root,
        now: () => "2099-01-01T00:00:10.000Z"
      });
      const issued = await ledger.issue(binding());
      if (!issued.ok) throw new Error(issued.error.message);
      await ledger.reserve(issued.value.authorizationId, "tx_orphan");

      const recovery = new RecoveryRepository({ projectRoot: root, authorizationLedger: ledger });
      await expect(recovery.listAgentTransactionJournals()).resolves.toEqual({
        ok: true,
        value: []
      });
      await expect(recovery.reconcileAuthorizationReservationsAtStartup()).resolves.toEqual({
        ok: true,
        value: undefined
      });
      await expect(ledger.query(issued.value.authorizationId)).resolves.toMatchObject({
        ok: true,
        value: { state: "revoked", revocationReason: "orphan_reservation" }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not reconcile a reservation during ordinary journal listing", async () => {
    const root = await mkdtemp(join(tmpdir(), "novel-studio-ledger-"));
    try {
      const ledger = new ApprovalAuthorizationLedger({
        projectRoot: root,
        now: () => "2099-01-01T00:00:10.000Z"
      });
      const issued = await ledger.issue(binding());
      if (!issued.ok) throw new Error(issued.error.message);
      await ledger.reserve(issued.value.authorizationId, "tx_pending");

      const recovery = new RecoveryRepository({ projectRoot: root, authorizationLedger: ledger });
      await expect(recovery.listAgentTransactionJournals()).resolves.toEqual({
        ok: true,
        value: []
      });
      await expect(ledger.query(issued.value.authorizationId, "tx_pending")).resolves.toMatchObject(
        {
          ok: true,
          value: { state: "reserved", reservedTransactionId: "tx_pending" }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
