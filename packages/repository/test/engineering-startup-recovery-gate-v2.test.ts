import { describe, expect, test } from "vitest";

import { err, ok } from "@novel-studio/shared";

import {
  createEngineeringRecoveryGateSnapshotV2,
  type EngineeringRecoveryGateReasonV2,
  type EngineeringRecoveryGateSnapshotV2
} from "../src/engineering-recovery-gate.js";
import {
  createEngineeringStartupRecoveryGateV2,
  type EngineeringStartupRecoveryRootGatePortV2
} from "../src/engineering-startup-recovery-gate-v2.js";

const scannedAt = "2099-01-01T00:00:00.000Z";

describe("EngineeringStartupRecoveryGateV2", () => {
  test("keeps every affected root closed until startup scans classify V2, legacy, recovery, and object state", async () => {
    const snapshots = new Map<string, EngineeringRecoveryGateSnapshotV2>([
      ["root_clean", sourceSnapshot("root_clean", [])],
      ["root_v2_wal", sourceSnapshot("root_v2_wal", ["prepared_transaction"])],
      ["root_legacy_recovery", sourceSnapshot("root_legacy_recovery", ["legacy_recovery_pending"])],
      ["root_blob_staging", sourceSnapshot("root_blob_staging", ["orphaned_object"])],
      ["root_orphan_reservation", sourceSnapshot("root_orphan_reservation", ["orphaned_object"])],
      ["root_unknown", sourceSnapshot("root_unknown", ["unknown_record"])],
      ["root_auth", sourceSnapshot("root_auth", ["authentication_failed"])],
      ["root_unavailable", sourceSnapshot("root_unavailable", ["root_unavailable"])]
    ]);
    const gate = createEngineeringStartupRecoveryGateV2({
      rootGate: rootGate(snapshots),
      now: () => scannedAt
    });

    await expect(gate.assertMutationAllowed("root_clean")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_ROOT_UNSCANNED" }
    });
    const initialized = await gate.initialize({
      contentRootBindingIds: [...snapshots.keys()]
    });
    if (!initialized.ok) throw new Error(initialized.error.message);

    expect(initialized.value).toMatchObject({ status: "blocked" });
    expect(gate.rootSnapshot("root_v2_wal")).toMatchObject({
      status: "blocked",
      recoverySnapshot: { reasons: ["prepared_transaction"] }
    });
    expect(gate.rootSnapshot("root_legacy_recovery")).toMatchObject({
      recoverySnapshot: { reasons: ["legacy_recovery_pending"] }
    });
    expect(gate.rootSnapshot("root_blob_staging")).toMatchObject({
      recoverySnapshot: { reasons: ["orphaned_object"] }
    });
    expect(gate.rootSnapshot("root_orphan_reservation")).toMatchObject({
      recoverySnapshot: { reasons: ["orphaned_object"] }
    });
    expect(gate.rootSnapshot("root_unknown")).toMatchObject({
      recoverySnapshot: { reasons: ["unknown_record"] }
    });
    expect(gate.rootSnapshot("root_auth")).toMatchObject({
      recoverySnapshot: { reasons: ["authentication_failed"] }
    });
    expect(gate.rootSnapshot("root_unavailable")).toMatchObject({
      recoverySnapshot: { reasons: ["root_unavailable"] }
    });

    await expect(gate.assertMutationAllowed("root_clean")).resolves.toEqual({
      ok: true,
      value: undefined
    });
    for (const root of [...snapshots.keys()].filter((root) => root !== "root_clean")) {
      await expect(gate.assertMutationAllowed(root)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
      });
    }
  });

  test("fails closed for source scan errors or forged snapshots and revokes a previously clear root on fresh assertion failure", async () => {
    const clean = sourceSnapshot("root_clean", []);
    const forged = {
      ...sourceSnapshot("root_forged", []),
      capabilityRevision: "f".repeat(64)
    } as EngineeringRecoveryGateSnapshotV2;
    let freshAssertionAllowed = true;
    const gate = createEngineeringStartupRecoveryGateV2({
      rootGate: {
        scanRoot: async ({ contentRootBindingId }) => {
          if (contentRootBindingId === "root_forged") return ok(forged);
          if (contentRootBindingId === "root_scan_error") {
            return err({ code: "ROOT_SCAN_FAILED" } as never);
          }
          return ok(clean);
        },
        assertMutationAllowed: async (contentRootBindingId) =>
          contentRootBindingId === "root_clean" && freshAssertionAllowed
            ? ok(undefined)
            : err({ code: "ROOT_CHANGED" } as never)
      },
      now: () => scannedAt
    });

    const initialized = await gate.initialize({
      contentRootBindingIds: ["root_clean", "root_forged", "root_scan_error"]
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    expect(gate.rootSnapshot("root_forged")).toMatchObject({
      status: "blocked",
      recoverySnapshot: null,
      startupFailure: "startup_scan_failed"
    });
    expect(gate.rootSnapshot("root_scan_error")).toMatchObject({
      status: "blocked",
      recoverySnapshot: null,
      startupFailure: "startup_scan_failed"
    });

    freshAssertionAllowed = false;
    await expect(gate.assertMutationAllowed("root_clean")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
    });
    expect(gate.rootSnapshot("root_clean")).toMatchObject({
      status: "blocked",
      recoverySnapshot: null,
      startupFailure: "fresh_assertion_failed"
    });
    expect(gate.snapshot()).toMatchObject({ status: "blocked" });
  });

  test("rejects duplicate root input rather than silently narrowing the startup scan", async () => {
    const gate = createEngineeringStartupRecoveryGateV2({
      rootGate: rootGate(new Map([["root_01", sourceSnapshot("root_01", [])]])),
      now: () => scannedAt
    });

    await expect(
      gate.initialize({ contentRootBindingIds: ["root_01", "root_01"] })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_INPUT_INVALID" }
    });
    expect(gate.snapshot()).toMatchObject({ status: "not_started", roots: [] });
  });
});

function sourceSnapshot(
  contentRootBindingId: string,
  reasons: readonly EngineeringRecoveryGateReasonV2[]
): EngineeringRecoveryGateSnapshotV2 {
  return createEngineeringRecoveryGateSnapshotV2({ contentRootBindingId, reasons, scannedAt });
}

function rootGate(
  snapshots: ReadonlyMap<string, EngineeringRecoveryGateSnapshotV2>
): EngineeringStartupRecoveryRootGatePortV2 {
  return {
    scanRoot: async ({ contentRootBindingId }) => {
      const snapshot = snapshots.get(contentRootBindingId);
      return snapshot === undefined ? err({ code: "ROOT_UNKNOWN" } as never) : ok(snapshot);
    },
    assertMutationAllowed: async (contentRootBindingId) => {
      const snapshot = snapshots.get(contentRootBindingId);
      return snapshot?.status === "clear" ? ok(undefined) : err({ code: "ROOT_BLOCKED" } as never);
    }
  };
}
