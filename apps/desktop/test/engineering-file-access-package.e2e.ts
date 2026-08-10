import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { readFile, stat } from "node:fs/promises";

import { expect, test } from "@playwright/test";

// @ts-expect-error This executable probe intentionally has no TypeScript declaration surface.
import { probeMutationV2Abi } from "../../../scripts/probe-engineering-file-access-package.mjs";

const artifactPath = process.env["NOVEL_STUDIO_PACKAGED_ENGINEERING_ADDON"];
const manifestPath = process.env["NOVEL_STUDIO_PACKAGED_ENGINEERING_MANIFEST"];
const signaturePath = process.env["NOVEL_STUDIO_PACKAGED_ENGINEERING_MANIFEST_SIGNATURE"];

test.describe("signed engineering file access package", () => {
  test("executes installed mutation/recovery positive and negative probes against the signed artifact", async () => {
    test.skip(
      artifactPath === undefined || manifestPath === undefined || signaturePath === undefined,
      "Requires the CI-installed signed package artifact paths."
    );
    if (artifactPath === undefined || manifestPath === undefined || signaturePath === undefined)
      return;
    expect(isAbsolute(artifactPath)).toBe(true);
    expect(isAbsolute(manifestPath)).toBe(true);
    expect(isAbsolute(signaturePath)).toBe(true);

    const [manifestBytes, signature] = await Promise.all([
      readFile(manifestPath),
      readFile(signaturePath)
    ]);
    const manifest = JSON.parse(manifestBytes.toString("utf8")) as Record<string, unknown>;
    expect(signature.byteLength).toBeGreaterThan(0);
    expect(manifest).toMatchObject({
      eligibility: {
        batch: "7",
        mutation: "available",
        recovery: "available"
      },
      qualification: {
        productionQualified: true,
        mutationRecoveryEvidence: {
          positiveProtections: {
            replace: "passed",
            create: "passed",
            receiptBinding: "passed",
            walPreparation: "passed",
            recoveryScan: "passed"
          },
          negativeControls: {
            rawByteManifestMismatch: "canary_exposed",
            staleBase: "canary_exposed",
            createRace: "canary_exposed",
            faultRecoveryRequired: "canary_exposed"
          }
        },
        lifecycleEvidence: {
          positiveProtections: {
            createDirectory: "passed",
            move: "passed",
            quarantine: "passed",
            restore: "passed",
            purge: "passed"
          },
          negativeControls: {}
        }
      }
    });

    const addon = createRequire(import.meta.url)(artifactPath);
    await expect(probeMutationV2Abi(addon)).resolves.toMatchObject({
      status: "passed"
    });
  });

  test("does not accept a missing installed signature as Batch 7 package evidence", async () => {
    test.skip(
      signaturePath === undefined,
      "Requires the CI-installed signed package artifact paths."
    );
    if (signaturePath === undefined) return;
    const [metadata, signature] = await Promise.all([stat(signaturePath), readFile(signaturePath)]);
    expect(metadata.isFile()).toBe(true);
    expect(signature.byteLength).toBeGreaterThan(0);
  });
});
