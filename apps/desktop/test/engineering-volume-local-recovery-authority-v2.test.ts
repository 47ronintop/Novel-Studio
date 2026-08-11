import { createUnifiedError, err, ok } from "@novel-studio/shared";
import { describe, expect, test, vi } from "vitest";

import {
  openDesktopEngineeringVolumeLocalRecoveryAuthorityV2,
  type OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options
} from "../src/main/engineering-volume-local-recovery-authority-v2.js";

const marker = "a".repeat(64);
const sideEffect = "b".repeat(64);

describe("Desktop volume-local recovery authority V2", () => {
  test("binds native same-volume evidence and durability to the exact recovery handle", async () => {
    const addon = recoveryAddon();
    const inspectCapacity = vi.fn(async () =>
      ok({ capacityBytes: 32 * 1024 * 1024, reservedBytes: 1024 })
    );
    const authenticateEvidence = vi.fn(() => ok(undefined));
    const opened = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
      authorityOptions({ addon, inspectCapacity, authenticateEvidence })
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.code);

    expect(opened.value.binding).toMatchObject({
      contentRootBindingId: "content_root_01",
      recoveryRootBindingId: "recovery_root_01",
      recoveryRootId: "21",
      contentVolumeIdentity: "volume_01",
      recoveryVolumeIdentity: "volume_01",
      contentDirectoryIdentity: "directory_content_01",
      recoveryDirectoryIdentity: "directory_recovery_01",
      rootRelationship: "identity_disjoint",
      authority: "app_state_root",
      grantRevision: "grant_01"
    });
    expect(authenticateEvidence).toHaveBeenCalledTimes(1);
    expect(addon.openEngineeringStateRoot).not.toHaveBeenCalled();
    expect(addon.openEngineeringStateRootBoundToRecoveryV2).toHaveBeenCalledWith(21n);

    await opened.value.durability.ensureDirectoryNoFollow(
      "C:\\Novel Studio\\state\\recovery\\.novel-studio-engineering-v2"
    );
    expect(addon.ensureEngineeringStateDirectoryNoFollow).toHaveBeenCalledWith(
      91n,
      ".novel-studio-engineering-v2"
    );

    const lifecycle = await opened.value.resolveLifecycleBinding(sideEffect);
    expect(lifecycle).toEqual(
      ok({
        recoveryRootBindingId: "recovery_root_01",
        recoveryRootId: 21n,
        grantRevision: "grant_01",
        sideEffectChecksum: sideEffect
      })
    );
    expect(inspectCapacity).toHaveBeenNthCalledWith(1, { recoveryRootId: 21n });
    expect(inspectCapacity).toHaveBeenNthCalledWith(2, { recoveryRootId: 22n });
    expect(addon.openEngineeringRecoveryRootV2).toHaveBeenCalledTimes(2);
    expect(addon.closeEngineeringRecoveryRootV2).toHaveBeenCalledWith(22n);

    opened.value.dispose();
    opened.value.dispose();
    expect(addon.closeEngineeringRecoveryRootV2).toHaveBeenCalledWith(21n);
    expect(addon.closeEngineeringRecoveryRootV2).toHaveBeenCalledTimes(2);
  });

  test("requires an explicit app-owned path within the configured state root", async () => {
    const addon = recoveryAddon();
    const opened = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
      authorityOptions({
        addon,
        recoveryRoot: "D:\\content-sibling\\recovery"
      })
    );

    expect(opened).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_AUTHORITY_ARGUMENTS_INVALID" }
    });
    expect(addon.openEngineeringRecoveryRootV2).not.toHaveBeenCalled();
  });

  test("fails closed when the selected path resolves to a different physical directory", async () => {
    const addon = recoveryAddon();
    addon.openEngineeringRecoveryRootV2
      .mockImplementationOnce(() => nativeEvidence(21n))
      .mockImplementationOnce(() => ({
        ...nativeEvidence(22n),
        directoryIdentity: "directory_replacement_01"
      }));
    const opened = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
      authorityOptions({ addon })
    );
    if (!opened.ok) throw new Error(opened.error.code);

    await expect(opened.value.assertCurrent()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_AUTHORITY_IDENTITY_DRIFT" }
    });
    opened.value.dispose();
  });

  test("fails closed on grant authentication or capacity drift", async () => {
    const addon = recoveryAddon();
    const authenticateEvidence = vi
      .fn()
      .mockReturnValueOnce(ok(undefined))
      .mockReturnValueOnce(
        err(
          createUnifiedError({
            code: "ENGINEERING_RECOVERY_GRANT_REVOKED",
            category: "PermissionError",
            message: "Recovery grant revoked.",
            recoverability: "user-action",
            suggestedAction: "Select the recovery root again.",
            traceId: "test"
          })
        )
      );
    const revoked = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
      authorityOptions({ addon, authenticateEvidence })
    );
    if (!revoked.ok) throw new Error(revoked.error.code);
    await expect(revoked.value.assertCurrent()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_GRANT_REVOKED" }
    });
    revoked.value.dispose();

    const capacityAddon = recoveryAddon();
    const inspectCapacity = vi
      .fn()
      .mockResolvedValueOnce(ok({ capacityBytes: 4096, reservedBytes: 0 }))
      .mockResolvedValueOnce(ok({ capacityBytes: 4096, reservedBytes: 4096 }));
    const capacity = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2(
      authorityOptions({ addon: capacityAddon, inspectCapacity, minimumFreeBytes: 1 })
    );
    if (!capacity.ok) throw new Error(capacity.error.code);
    await expect(capacity.value.assertCurrent()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_BINDING_CAPACITY_UNAVAILABLE" }
    });
    capacity.value.dispose();
  });

  test("rejects an incomplete ABI or non-B8 addon before opening authority", async () => {
    const addon = recoveryAddon();
    const options = authorityOptions({ addon });
    const missingAbi = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2({
      ...options,
      addonLoader: loadedAddon({ ...addon, openEngineeringRecoveryRootV2: undefined })
    });
    expect(missingAbi).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_AUTHORITY_NATIVE_UNAVAILABLE" }
    });

    const batch7 = await openDesktopEngineeringVolumeLocalRecoveryAuthorityV2({
      ...options,
      addonLoader: {
        load: () => ({
          status: "loaded" as const,
          addon,
          metadata: {
            adapterId: "novel_studio_engineering_file_access" as const,
            target: "win32-x64" as const,
            batch: "7" as const,
            accessEligible: "available" as const,
            mutation: "available" as const,
            recovery: "available" as const,
            mutationV2Probe: "available" as const,
            recoveryScanProbe: "available" as const,
            stateDurabilityProbe: "available" as const
          }
        })
      }
    });
    expect(batch7).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_AUTHORITY_NATIVE_UNAVAILABLE" }
    });
    expect(addon.openEngineeringRecoveryRootV2).not.toHaveBeenCalled();
  });
});

function authorityOptions(
  input: Partial<OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options> & {
    readonly addon: ReturnType<typeof recoveryAddon>;
  }
): OpenDesktopEngineeringVolumeLocalRecoveryAuthorityV2Options {
  return {
    recoveryRoot: input.recoveryRoot ?? "C:\\Novel Studio\\state\\recovery",
    appStateRoot: "C:\\Novel Studio\\state",
    contentRoot: {
      contentRootBindingId: "content_root_01",
      rootId: 11n,
      volumeIdentity: "volume_01",
      directoryIdentity: "directory_content_01"
    },
    grant: {
      authority: "app_state_root",
      recoveryRootBindingId: "recovery_root_01",
      grantRevision: "grant_01",
      ownershipMarkerChecksum: marker,
      storageLabel: "Novel Studio Recovery",
      retentionDays: 30
    },
    addonLoader: loadedAddon(input.addon),
    inspectCapacity:
      input.inspectCapacity ??
      (async () => ok({ capacityBytes: 32 * 1024 * 1024, reservedBytes: 1024 })),
    authenticateEvidence: input.authenticateEvidence ?? (() => ok(undefined)),
    minimumFreeBytes: input.minimumFreeBytes ?? 1024,
    now: () => "2026-08-11T04:00:00.000Z",
    traceId: "test-volume-local-recovery-authority"
  };
}

function loadedAddon(addon: ReturnType<typeof recoveryAddon> | Record<string, unknown>) {
  return {
    load: () => ({
      status: "loaded" as const,
      addon: addon as ReturnType<typeof recoveryAddon>,
      metadata: {
        adapterId: "novel_studio_engineering_file_access" as const,
        target: "win32-x64" as const,
        batch: "8" as const,
        accessEligible: "available" as const,
        mutation: "available" as const,
        recovery: "available" as const,
        mutationV2Probe: "available" as const,
        recoveryScanProbe: "available" as const,
        stateDurabilityProbe: "available" as const
      }
    })
  };
}

function nativeEvidence(recoveryRootId: bigint) {
  return {
    recoveryRootId,
    volumeIdentity: "volume_01",
    directoryIdentity: "directory_recovery_01",
    recoveryRootBindingId: "recovery_root_01",
    grantRevision: "grant_01",
    ownershipMarkerChecksum: marker
  };
}

function recoveryAddon() {
  let nextRecoveryRootId = 21n;
  let nextStateRootId = 91n;
  return {
    adapterInfo: vi.fn(),
    openWorkspaceRoot: vi.fn(),
    closeWorkspaceRoot: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    searchText: vi.fn(),
    buildIndex: vi.fn(),
    openEngineeringRecoveryRootV2: vi.fn(() => nativeEvidence(nextRecoveryRootId++)),
    closeEngineeringRecoveryRootV2: vi.fn(),
    openEngineeringStateRoot: vi.fn(),
    openEngineeringStateRootBoundToRecoveryV2: vi.fn(() => nextStateRootId++),
    closeEngineeringStateRoot: vi.fn(),
    ensureEngineeringStateDirectoryNoFollow: vi.fn(),
    flushEngineeringStateDirectory: vi.fn(),
    openEngineeringStateExclusiveNoFollow: vi.fn(() => 101n),
    writeEngineeringStateFile: vi.fn(),
    syncEngineeringStateFile: vi.fn(),
    closeEngineeringStateFile: vi.fn(),
    readEngineeringStateFileNoFollow: vi.fn(() => new Uint8Array()),
    readEngineeringStateDirectoryNoFollow: vi.fn(() => []),
    linkEngineeringStateFileNoFollow: vi.fn(),
    renameReplaceEngineeringStateFileNoFollow: vi.fn(),
    unlinkEngineeringStateFileNoFollow: vi.fn()
  };
}
