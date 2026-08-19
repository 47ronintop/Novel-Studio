import { describe, expect, test } from "vitest";

import {
  CREATIVE_FILE_OPERATIONS,
  createCreativeFileOperationQualificationService,
  hasMainOwnedCreativeFileOperationQualification,
  hasMainOwnedUnsignedBetaCreativeFileOperationQualification,
  isMainOwnedCreativeFileOperationQualification,
  validateCreativeFileOperationQualification,
  type CreativeFileOperation
} from "../src/main/creative-file-operation-qualification.js";

const checkedAt = "2026-08-07T00:30:00.000Z";

describe("Main-owned creative file operation qualification", () => {
  test("caches a separate unavailable attestation for every operation by default", async () => {
    const service = createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => checkedAt
    });
    const first = await service.readAttestation("replace_file");
    const second = await service.readAttestation("replace_file");
    const all = await service.readAll();

    expect(second).toBe(first);
    expect(Object.keys(all)).toEqual([...CREATIVE_FILE_OPERATIONS]);
    expect(Object.values(all)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "unavailable",
          productionQualified: false,
          failureReasons: ["evidence_missing"]
        })
      ])
    );
    expect(isMainOwnedCreativeFileOperationQualification(first)).toBe(true);
    expect(hasMainOwnedCreativeFileOperationQualification(first, "replace_file", checkedAt)).toBe(
      false
    );
  });

  test("opens only the operation with fresh Main-owned evidence", async () => {
    const evidence = "a".repeat(64);
    const service = createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => checkedAt,
      candidateInspector: {
        async inspect(operation: CreativeFileOperation) {
          return operation === "create_file"
            ? {
                status: "qualified" as const,
                evidenceChecksum: evidence,
                issuedAt: "2026-08-06T00:00:00.000Z",
                expiresAt: "2026-08-20T00:00:00.000Z"
              }
            : { status: "unavailable" as const, failureReasons: ["evidence_missing"] as const };
        }
      }
    });
    const all = await service.readAll();

    expect(
      hasMainOwnedCreativeFileOperationQualification(all.create_file, "create_file", checkedAt)
    ).toBe(true);
    expect(
      hasMainOwnedCreativeFileOperationQualification(all.replace_file, "replace_file", checkedAt)
    ).toBe(false);
    expect(all.create_file.evidenceChecksum).toBe(evidence);
    expect(validateCreativeFileOperationQualification(all.create_file)).toBe(true);
    expect(isMainOwnedCreativeFileOperationQualification({ ...all.create_file })).toBe(false);
  });

  test("unsigned beta evidence is qualified separately from production", async () => {
    const service = createCreativeFileOperationQualificationService({
      packageKind: "unsigned-beta",
      now: () => checkedAt,
      candidateInspector: {
        async inspect() {
          return {
            status: "qualified" as const,
            evidenceChecksum: "d".repeat(64),
            issuedAt: "2026-08-06T00:00:00.000Z",
            expiresAt: "2026-08-20T00:00:00.000Z"
          };
        }
      }
    });
    const attestation = await service.readAttestation("replace_file");
    expect(attestation.packageKind).toBe("unsigned-beta");
    expect(attestation.productionQualified).toBe(false);
    expect(
      hasMainOwnedCreativeFileOperationQualification(attestation, "replace_file", checkedAt)
    ).toBe(false);
    expect(
      hasMainOwnedUnsignedBetaCreativeFileOperationQualification(
        attestation,
        "replace_file",
        checkedAt
      )
    ).toBe(true);
  });

  test("rejects stale evidence and malformed available attestations", async () => {
    const service = createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => checkedAt,
      candidateInspector: {
        async inspect() {
          return {
            status: "qualified" as const,
            evidenceChecksum: "b".repeat(64),
            issuedAt: "2026-07-01T00:00:00.000Z",
            expiresAt: "2026-08-01T00:00:00.000Z"
          };
        }
      }
    });
    const stale = await service.readAttestation("delete_file");
    expect(stale.status).toBe("unavailable");
    expect(stale.failureReasons).toEqual(["evidence_stale"]);
    expect(
      validateCreativeFileOperationQualification({ ...stale, evidenceChecksum: "not-a-hash" })
    ).toBe(false);
  });

  test("fails closed when a qualified candidate also reports a failure", async () => {
    const service = createCreativeFileOperationQualificationService({
      packageKind: "production",
      now: () => checkedAt,
      candidateInspector: {
        async inspect() {
          return {
            status: "qualified" as const,
            evidenceChecksum: "c".repeat(64),
            issuedAt: "2026-08-01T00:00:00.000Z",
            expiresAt: "2026-08-20T00:00:00.000Z",
            failureReasons: ["probe_failed"] as const
          };
        }
      }
    });

    const attestation = await service.readAttestation("move_file");
    expect(attestation.status).toBe("unavailable");
    expect(attestation.failureReasons).toEqual(["probe_failed"]);
    expect(
      hasMainOwnedCreativeFileOperationQualification(attestation, "move_file", checkedAt)
    ).toBe(false);
  });
});
