import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createUnsignedBetaEngineeringCapabilityAuthority } from "../src/main/unsigned-beta-engineering-authority.js";
import {
  createUnsignedBetaAuthorizationService,
  createUnsignedBetaPackageIdentityChecksum
} from "../src/main/unsigned-beta-qualification.js";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("unsigned beta engineering capability authority", () => {
  test("requires a current Main grant and intersects it with native batch metadata", async () => {
    const harness = await authorizationHarness();
    let current = await harness.service.requestAuthorization(async () => true);
    const batch = { value: "6" as "6" | "7" | "8" };
    const accessEligible = { value: "available" as "available" | "unavailable" };
    const authority = createUnsignedBetaEngineeringCapabilityAuthority({
      authorizationService: harness.service,
      getCurrentAuthorization: () => current,
      packageIdentityChecksum: harness.packageIdentityChecksum,
      addonLoader: {
        load: () => ({
          status: "loaded" as const,
          addon: {} as never,
          metadata:
            batch.value === "6"
              ? {
                  adapterId: "novel_studio_engineering_file_access" as const,
                  target: "win32-x64" as const,
                  batch: "6" as const,
                  accessEligible: accessEligible.value,
                  mutation: "unavailable" as const,
                  recovery: "unavailable" as const
                }
              : {
                  adapterId: "novel_studio_engineering_file_access" as const,
                  target: "win32-x64" as const,
                  batch: batch.value,
                  accessEligible: accessEligible.value,
                  mutation: "available" as const,
                  recovery: "available" as const,
                  mutationV2Probe: "available" as const,
                  recoveryScanProbe: "available" as const,
                  stateDurabilityProbe: "available" as const
                }
        })
      },
      now: harness.now
    });

    await expect(authority.hasCapability("root")).resolves.toBe(true);
    await expect(authority.hasCapability("access")).resolves.toBe(true);
    await expect(authority.hasCapability("mutation")).resolves.toBe(false);
    batch.value = "7";
    await expect(authority.hasCapability("mutation")).resolves.toBe(false);
    await expect(authority.hasCapability("recovery")).resolves.toBe(false);
    expect(authority.currentRevision()).toBe("unavailable");
    batch.value = "8";
    await expect(authority.hasCapability("mutation")).resolves.toBe(true);
    await expect(authority.hasCapability("recovery")).resolves.toBe(true);
    expect(authority.currentRevision()).toMatch(/^[a-f0-9]{64}:native-batch-8$/u);
    accessEligible.value = "unavailable";
    await expect(authority.hasCapability("root")).resolves.toBe(false);
    expect(authority.currentRevision()).toBe("unavailable");

    await harness.service.revoke("test");
    current = undefined;
    await expect(authority.hasCapability("root")).resolves.toBe(false);
    expect(authority.currentRevision()).toBe("unavailable");
  });

  test("propagates grant revocation so an active native session can close", async () => {
    const harness = await authorizationHarness();
    const current = await harness.service.requestAuthorization(async () => true);
    const authority = createUnsignedBetaEngineeringCapabilityAuthority({
      authorizationService: harness.service,
      getCurrentAuthorization: () => current,
      packageIdentityChecksum: harness.packageIdentityChecksum,
      addonLoader: {
        load: () => ({
          status: "unavailable" as const,
          reason: "native_module_load_failed" as const
        })
      },
      now: harness.now
    });
    const revoked = vi.fn();
    authority.subscribeRevocation(revoked);

    await harness.service.revoke("test");
    expect(revoked).toHaveBeenCalledOnce();
  });
});

async function authorizationHarness() {
  const root = await mkdtemp(join(tmpdir(), "unsigned-beta-engineering-authority-"));
  roots.push(root);
  const packageIdentityChecksum = createUnsignedBetaPackageIdentityChecksum({
    appVersion: "1.0.0",
    appRoot: root
  });
  const now = () => "2026-08-19T00:00:00.000Z";
  return {
    packageIdentityChecksum,
    now,
    service: createUnsignedBetaAuthorizationService({
      userDataRoot: root,
      packageIdentityChecksum,
      now
    })
  };
}
