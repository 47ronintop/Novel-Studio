import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  createUnsignedBetaAuthorizationService,
  hasCurrentUnsignedBetaAuthorization
} from "../src/main/unsigned-beta-qualification.js";

describe("unsigned beta authorization", () => {
  test("requires a fresh Main confirmation and does not trust persisted JSON after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "unsigned-beta-qualification-"));
    const packageIdentityChecksum = "a".repeat(64);
    const now = () => "2026-08-19T00:00:00.000Z";
    const first = createUnsignedBetaAuthorizationService({
      userDataRoot: root,
      packageIdentityChecksum,
      now
    });

    expect(await first.read()).toBeUndefined();
    const granted = await first.requestAuthorization(async () => true);
    expect(granted).toBeDefined();
    expect(hasCurrentUnsignedBetaAuthorization(granted, packageIdentityChecksum, now())).toBe(true);

    const persisted = JSON.parse(
      await readFile(join(root, "agent-tool-settings", "unsigned-beta.json"), "utf8")
    ) as Record<string, unknown>;
    expect(persisted.channel).toBe("unsigned-beta");

    const restarted = createUnsignedBetaAuthorizationService({
      userDataRoot: root,
      packageIdentityChecksum,
      now
    });
    expect(await restarted.read()).toBeUndefined();
  });

  test("revocation invalidates the Main-owned grant", async () => {
    const root = await mkdtemp(join(tmpdir(), "unsigned-beta-revoke-"));
    const checksum = "b".repeat(64);
    const service = createUnsignedBetaAuthorizationService({
      userDataRoot: root,
      packageIdentityChecksum: checksum,
      now: () => "2026-08-19T00:00:00.000Z"
    });
    const granted = await service.requestAuthorization(async () => true);
    await service.revoke("test");
    expect(hasCurrentUnsignedBetaAuthorization(granted, checksum, "2026-08-19T00:00:00.000Z")).toBe(
      false
    );
    const confirm = vi.fn(async () => true);
    await expect(service.requestAuthorization(confirm)).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  test("notifies subscribers and removes authority when the grant expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T00:00:00.000Z"));
    try {
      const root = await mkdtemp(join(tmpdir(), "unsigned-beta-expiry-"));
      const checksum = "c".repeat(64);
      const service = createUnsignedBetaAuthorizationService({
        userDataRoot: root,
        packageIdentityChecksum: checksum
      });
      const revoked = vi.fn();
      service.subscribeRevocation(revoked);
      const granted = await service.requestAuthorization(async () => true);

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

      expect(revoked).toHaveBeenCalledOnce();
      await expect(service.read()).resolves.toBeUndefined();
      expect(hasCurrentUnsignedBetaAuthorization(granted, checksum, new Date().toISOString())).toBe(
        false
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
