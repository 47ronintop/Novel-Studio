import { describe, expect, test } from "vitest";

import {
  createMainOwnedCreativeFileOperationCandidateInspector,
  runCreativeFileOperationProbe
} from "../src/main/creative-file-operation-fresh-probe.js";
import {
  CREATIVE_FILE_OPERATIONS,
  createCreativeFileOperationQualificationService,
  hasMainOwnedCreativeFileOperationQualification
} from "../src/main/creative-file-operation-qualification.js";

const checkedAt = "2026-08-08T02:00:00.000Z";
const packageIdentityChecksum = "a".repeat(64);

describe("Main-owned creative file operation fresh probe", () => {
  test("executes replace, create, move, and delete against the production backend", async () => {
    const report = await runCreativeFileOperationProbe(packageIdentityChecksum, () => checkedAt);

    expect(report).toMatchObject({
      schemaVersion: "1.0",
      backendId: "trusted_creative_file_operations",
      packageIdentityChecksum,
      checkedAt,
      operationStatus: {
        replace_file: "passed",
        create_file: "passed",
        move_file: "passed",
        delete_file: "passed"
      },
      negativeControls: {
        managedPathRejected: "passed",
        staleBaseRejected: "passed"
      }
    });
    expect(report.reportChecksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("issues distinct short-lived evidence for every qualified operation", async () => {
    const inspector = createMainOwnedCreativeFileOperationCandidateInspector({
      packageIdentityChecksum,
      now: () => checkedAt
    });
    const service = createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => checkedAt,
      candidateInspector: inspector
    });

    const attestations = await service.readAll();
    const evidence = new Set<string>();
    for (const operation of CREATIVE_FILE_OPERATIONS) {
      const attestation = attestations[operation];
      expect(attestation.status).toBe("qualified");
      expect(attestation.productionQualified).toBe(true);
      expect(
        hasMainOwnedCreativeFileOperationQualification(attestation, operation, checkedAt)
      ).toBe(true);
      if (attestation.evidenceChecksum !== null) evidence.add(attestation.evidenceChecksum);
    }
    expect(evidence.size).toBe(CREATIVE_FILE_OPERATIONS.length);
  });

  test("fails closed when the probe timestamp is not canonical", async () => {
    const inspector = createMainOwnedCreativeFileOperationCandidateInspector({
      packageIdentityChecksum,
      now: () => "not-a-timestamp"
    });

    await expect(inspector.inspect("replace_file")).resolves.toEqual({
      status: "unavailable",
      failureReasons: ["probe_failed"]
    });
  });
});
