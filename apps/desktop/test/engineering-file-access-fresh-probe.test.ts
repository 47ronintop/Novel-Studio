import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_NEGATIVE_CONTROLS,
  ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_POSITIVE_PROTECTIONS,
  ENGINEERING_FILE_NEGATIVE_CONTROLS,
  ENGINEERING_FILE_POSITIVE_PROTECTIONS,
  validateEngineeringFileProbeReport,
  validateEngineeringFileProbeReportV2
} from "@novel-studio/agent-engine";
import { describe, expect, test, vi } from "vitest";

import { createMainOwnedEngineeringFileAccessFreshProbe } from "../src/main/engineering-file-access-fresh-probe.js";

const checkedAt = "2026-08-07T00:00:00.000Z";
const publisherPolicyChecksum = "d".repeat(64);

describe("Main-owned engineering file access fresh probe", () => {
  test("probes only the supplied addon against a temporary fixture and constructs the exact report", async () => {
    await withInstalledArtifacts(async (paths) => {
      const loadAddon = vi.fn((path: string) => {
        expect(path).toBe(paths.artifactPath);
        return hardenedFixtureAddon();
      });
      const probe = createMainOwnedEngineeringFileAccessFreshProbe({ loadAddon });

      const report = await probe.probe({
        ...paths,
        checkedAt,
        publisherPolicyChecksum,
        protectionEvidence: passingProtectionEvidence()
      });

      expect(Object.keys(probe)).toEqual(["probe"]);
      expect(loadAddon).toHaveBeenCalledTimes(1);
      expect(report).toMatchObject({
        schemaVersion: "1.0",
        target: "win32-x64",
        packageKind: "production",
        artifactSignatureVerification: "trusted_publisher",
        manifestSignatureVerification: "trusted_publisher",
        digestVerification: "match",
        generatedAt: checkedAt,
        expiresAt: "2026-08-07T01:00:00.000Z",
        positiveProtections: passingProtectionEvidence().positiveProtections,
        negativeControls: passingProtectionEvidence().negativeControls
      });
      expect(Object.isFrozen(report)).toBe(true);
      expect(validateEngineeringFileProbeReport(report, checkedAt)).toEqual({
        valid: true,
        failureReasons: []
      });
    });
  });

  test("rejects altered installed bytes and malformed signed-manifest evidence before loading an addon", async () => {
    await withInstalledArtifacts(async (paths) => {
      const loadAddon = vi.fn(() => hardenedFixtureAddon());
      const probe = createMainOwnedEngineeringFileAccessFreshProbe({ loadAddon });
      await writeFile(paths.artifactPath, "altered", "utf8");

      await expect(
        probe.probe({
          ...paths,
          checkedAt,
          publisherPolicyChecksum,
          protectionEvidence: passingProtectionEvidence()
        })
      ).rejects.toThrow("ENGINEERING_FILE_ACCESS_FRESH_PROBE_DIGEST_MISMATCH");
      expect(loadAddon).not.toHaveBeenCalled();

      await expect(
        probe.probe({
          ...paths,
          checkedAt,
          publisherPolicyChecksum,
          protectionEvidence: {
            ...passingProtectionEvidence(),
            negativeControls: {
              ...passingProtectionEvidence().negativeControls,
              noFollowDisabled: "canary_blocked"
            } as never
          }
        })
      ).rejects.toThrow("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_PROTECTION_EVIDENCE");
      expect(loadAddon).not.toHaveBeenCalled();
    });
  });

  test("emits a versioned Batch 7 report only after checking the installed mutation/recovery surface", async () => {
    await withInstalledArtifacts(async (paths) => {
      const probe = createMainOwnedEngineeringFileAccessFreshProbe({
        loadAddon: () => batch7HardenedFixtureAddon()
      });
      const report = await probe.probe({
        ...paths,
        checkedAt,
        publisherPolicyChecksum,
        protectionEvidence: passingProtectionEvidence(),
        mutationRecoveryEvidence: passingBatch7MutationRecoveryEvidence(),
        lifecycleEvidence: passingBatch8LifecycleEvidence()
      });

      expect(report).toMatchObject({ schemaVersion: "2.0", batch: "7" });
      expect(validateEngineeringFileProbeReportV2(report, checkedAt)).toEqual({
        valid: true,
        failureReasons: []
      });
    }, "7");
  });

  test("accepts the B8 native superset only for the signed B7 operation set", async () => {
    await withInstalledArtifacts(async (paths) => {
      const probe = createMainOwnedEngineeringFileAccessFreshProbe({
        loadAddon: () => batch7HardenedFixtureAddon("8")
      });
      const report = await probe.probe({
        ...paths,
        checkedAt,
        publisherPolicyChecksum,
        protectionEvidence: passingProtectionEvidence(),
        mutationRecoveryEvidence: passingBatch7MutationRecoveryEvidence(),
        lifecycleEvidence: passingBatch8LifecycleEvidence()
      });

      expect(report).toMatchObject({ schemaVersion: "2.0", batch: "7" });
      expect(validateEngineeringFileProbeReportV2(report, checkedAt)).toEqual({
        valid: true,
        failureReasons: []
      });
    }, "7");
  });

  test("fails closed when a signed B7 probe omits the B8 lifecycle evidence contract", async () => {
    await withInstalledArtifacts(async (paths) => {
      const probe = createMainOwnedEngineeringFileAccessFreshProbe({
        loadAddon: () => batch7HardenedFixtureAddon("8")
      });
      await expect(
        probe.probe({
          ...paths,
          checkedAt,
          publisherPolicyChecksum,
          protectionEvidence: passingProtectionEvidence(),
          mutationRecoveryEvidence: passingBatch7MutationRecoveryEvidence()
        })
      ).rejects.toThrow("ENGINEERING_FILE_ACCESS_FRESH_PROBE_MISSING_BATCH_8_EVIDENCE");
    }, "7");
  });
});

async function withInstalledArtifacts(
  run: (paths: {
    artifactPath: string;
    manifestPath: string;
    signaturePath: string;
  }) => Promise<void>,
  batch: "6" | "7" = "6"
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "engineering-file-access-fresh-probe-test-"));
  const artifactPath = join(directory, "engineering_file_access.node");
  const manifestPath = join(directory, "engineering_file_access.manifest.json");
  const signaturePath = join(directory, "engineering_file_access.manifest.p7s");
  try {
    await writeFile(artifactPath, "installed-addon-bytes", "utf8");
    const artifactSha256 = createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
    await writeFile(
      manifestPath,
      JSON.stringify({
        adapterId: "novel_studio_engineering_file_access",
        target: "win32-x64",
        artifact: { sha256: artifactSha256 },
        publisherPolicyChecksum,
        eligibility: { batch }
      }),
      "utf8"
    );
    await writeFile(signaturePath, "already-validated-detached-signature", "utf8");
    await run({ artifactPath, manifestPath, signaturePath });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function passingBatch7MutationRecoveryEvidence() {
  return {
    positiveProtections: Object.fromEntries(
      ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_POSITIVE_PROTECTIONS.map((key) => [key, "passed"])
    ),
    negativeControls: Object.fromEntries(
      ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_NEGATIVE_CONTROLS.map((key) => [
        key,
        "canary_exposed"
      ])
    )
  } as {
    positiveProtections: Record<
      (typeof ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_POSITIVE_PROTECTIONS)[number],
      "passed"
    >;
    negativeControls: Record<
      (typeof ENGINEERING_FILE_BATCH_7_MUTATION_RECOVERY_NEGATIVE_CONTROLS)[number],
      "canary_exposed"
    >;
  };
}

function passingBatch8LifecycleEvidence() {
  return {
    positiveProtections: {
      createDirectory: "passed",
      move: "passed",
      quarantine: "passed",
      restore: "passed",
      purge: "passed"
    },
    negativeControls: {}
  } as const;
}

function passingProtectionEvidence() {
  return {
    positiveProtections: Object.fromEntries(
      ENGINEERING_FILE_POSITIVE_PROTECTIONS.map((key) => [key, "passed"])
    ),
    negativeControls: Object.fromEntries(
      ENGINEERING_FILE_NEGATIVE_CONTROLS.map((key) => [key, "canary_exposed"])
    )
  } as {
    positiveProtections: Record<(typeof ENGINEERING_FILE_POSITIVE_PROTECTIONS)[number], "passed">;
    negativeControls: Record<(typeof ENGINEERING_FILE_NEGATIVE_CONTROLS)[number], "canary_exposed">;
  };
}

function hardenedFixtureAddon() {
  let rootPath: string | undefined;
  const fixtureText = "B6 fresh probe fixture: 你好, café, 😀\nneedle: fresh-probe\n";
  const byteLength = BigInt(Buffer.byteLength(fixtureText, "utf8"));
  const byteOffset = BigInt(Buffer.byteLength("B6 fresh probe fixture: 你好, café, 😀\n", "utf8"));
  return {
    adapterInfo: () => ({
      target: "win32-x64",
      batch: "6",
      accessEligible: "available",
      mutation: "unavailable",
      recovery: "unavailable"
    }),
    openWorkspaceRoot(path: string) {
      rootPath = path;
      return { rootId: 1n, capability: "available" };
    },
    closeWorkspaceRoot(rootId: bigint) {
      expect(rootId).toBe(1n);
      rootPath = undefined;
    },
    readFile(rootId: bigint, relativePath: string) {
      if (rootId !== 1n || relativePath !== "docs/ordinary-utf8.txt" || rootPath === undefined) {
        throw new Error("root-relative canary rejected");
      }
      return readFileSync(join(rootPath, relativePath));
    },
    listDirectory(rootId: bigint, relativePath: string) {
      if (rootId !== 1n || relativePath !== "docs") throw new Error("unexpected list");
      return [{ name: "ordinary-utf8.txt", directory: false, byteLength }];
    },
    buildIndex(rootId: bigint) {
      if (rootId !== 1n) throw new Error("unexpected index");
      return {
        files: [{ relativePath: "docs/ordinary-utf8.txt", byteLength }],
        truncated: false
      };
    },
    searchText(rootId: bigint, query: string) {
      if (rootId !== 1n || query !== "needle: fresh-probe") throw new Error("unexpected search");
      return {
        matches: [{ relativePath: "docs/ordinary-utf8.txt", byteOffset }],
        truncated: false
      };
    }
  };
}

function batch7HardenedFixtureAddon(addonBatch: "7" | "8" = "7") {
  return {
    ...hardenedFixtureAddon(),
    adapterInfo: () => ({
      target: "win32-x64",
      batch: addonBatch,
      accessEligible: "available",
      mutation: "available",
      recovery: "available"
    }),
    mutationV2ProbeInfo: () => ({ status: "available" }),
    scanMutationRecovery: () => ({ state: "clear" }),
    mutationV2FaultProbe: () => ({ status: "available" })
  };
}
