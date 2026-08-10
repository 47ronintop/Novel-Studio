import { describe, expect, test } from "vitest";

import {
  InMemoryEngineeringMutationBlobStoreV2,
  InMemoryEngineeringWalRepositoryV2
} from "@novel-studio/repository";
import { err, ok } from "@novel-studio/shared";

import { createDesktopEngineeringRecoveryRuntimeV2 } from "../src/main/engineering-recovery-runtime.js";

const NOW = "2099-01-01T00:00:00.000Z";

describe("desktop Engineering recovery runtime V2", () => {
  test("opens a clean root only after the complete startup scan", async () => {
    const runtime = await createDesktopEngineeringRecoveryRuntimeV2(recoveryOptions());

    expect(runtime).toMatchObject({ ok: true, value: { status: "clear" } });
    if (!runtime.ok) return;
    await expect(runtime.value.startupGate.assertMutationAllowed("root_01")).resolves.toEqual({
      ok: true,
      value: undefined
    });
  });

  test("keeps the entire root closed when native recovery state is unknown", async () => {
    const runtime = await createDesktopEngineeringRecoveryRuntimeV2(
      recoveryOptions({ nativeUnknown: true })
    );

    expect(runtime).toMatchObject({ ok: true, value: { status: "blocked" } });
    if (!runtime.ok) return;
    await expect(runtime.value.startupGate.assertMutationAllowed("root_01")).resolves.toMatchObject(
      {
        ok: false,
        error: { code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED" }
      }
    );
  });

  test("fails closed when the native root cannot be revalidated", async () => {
    const runtime = await createDesktopEngineeringRecoveryRuntimeV2(
      recoveryOptions({ rootUnavailable: true })
    );

    expect(runtime).toMatchObject({ ok: true, value: { status: "blocked" } });
  });

  test("forwards the volume-local recovery scan into the startup gate", async () => {
    const runtime = await createDesktopEngineeringRecoveryRuntimeV2(
      recoveryOptions({ volumeRecoveryBlocked: true })
    );

    expect(runtime).toMatchObject({ ok: true, value: { status: "blocked" } });
    if (!runtime.ok) return;
    expect(runtime.value.transactionGate.snapshot("root_01")?.status).toBe("blocked");
  });
});

function recoveryOptions(
  input: {
    readonly nativeUnknown?: boolean;
    readonly rootUnavailable?: boolean;
    readonly volumeRecoveryBlocked?: boolean;
  } = {}
) {
  return {
    contentRootBindingId: "root_01",
    walRepository: new InMemoryEngineeringWalRepositoryV2(),
    blobStore: new InMemoryEngineeringMutationBlobStoreV2(),
    verifyContentRootAvailable: async () =>
      input.rootUnavailable ? err(testError("ENGINEERING_ROOT_UNAVAILABLE")) : ok(undefined),
    verifyPreparedAuthorization: async () => ok(undefined),
    scanLegacyRecovery: async () => ok({ status: "clean" as const }),
    scanStaging: async ({
      referencedStagingObjectIds
    }: {
      readonly referencedStagingObjectIds: readonly string[];
    }) =>
      ok({
        verifiedObjectIds: input.nativeUnknown ? [] : referencedStagingObjectIds,
        missingObjectIds: [],
        orphanObjectIds: [],
        unknownObjectCount: input.nativeUnknown ? 1 : 0,
        authenticationFailureCount: 0
      }),
    scanReservations: async ({
      referencedAuthorizationIds
    }: {
      readonly referencedAuthorizationIds: readonly string[];
    }) =>
      ok({
        verifiedAuthorizationIds: referencedAuthorizationIds,
        missingAuthorizationIds: [],
        orphanAuthorizationIds: [],
        unknownRecordCount: 0,
        authenticationFailureCount: 0
      }),
    scanVolumeLocalRecovery: async () =>
      input.volumeRecoveryBlocked
        ? ok({ status: "blocked" as const, reasons: ["binding_invalid" as const] })
        : ok({ status: "clear" as const, reasons: [] as const }),
    now: () => NOW
  };
}

function testError(code: string) {
  return {
    schemaVersion: "1.0" as const,
    errorId: `err_${code.toLowerCase()}`,
    code,
    category: "StorageError" as const,
    message: code,
    recoverability: "user-action" as const,
    suggestedAction: "Keep mutation disabled.",
    traceId: "engineering-recovery-runtime-test"
  };
}
