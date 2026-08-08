import { describe, expect, test } from "vitest";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringFileMutationRequestChecksumV2,
  engineeringMutationBlobIdForSha256V2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationRequestV2
} from "../src/engineering-file-mutation-port-v2.js";
import {
  createEngineeringMutationReceiptV2,
  validateEngineeringMutationReceiptV2,
  verifyEngineeringMutationReceiptBindingV2
} from "../src/engineering-mutation-receipt.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringMutationReceiptV2", () => {
  test("binds receipt identity, root, transaction, operation, and provider version set", () => {
    const request = createRequest();
    const receipt = receiptFor(request);

    expect(verifyEngineeringMutationReceiptBindingV2(receipt, request)).toMatchObject({ ok: true });
    expect(
      verifyEngineeringMutationReceiptBindingV2(
        { ...receipt, providerSemanticVersionSetChecksum: hash("other") },
        request
      )
    ).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_RECEIPT_V2_AUTHENTICATION_FAILED" }
    });
  });

  test("rejects a checksum-valid-looking receipt once any covered content changes", () => {
    const receipt = receiptFor(createRequest());
    expect(
      validateEngineeringMutationReceiptV2({
        ...receipt,
        relativeIdentity: "src/other.ts"
      })
    ).toMatchObject({ ok: false, error: { code: "ENGINEERING_MUTATION_RECEIPT_V2_INVALID" } });
  });
});

function createRequest(): EngineeringFileMutationRequestV2 {
  const bytes = new TextEncoder().encode("export const value = 1;\n");
  const manifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: "root_01",
      relativeIdentity: "src/main.ts",
      fileIdentity: null
    },
    bytes,
    metadataChecksum: hash("metadata")
  });
  return {
    schemaVersion: "2.0",
    operationKind: "create_file",
    contentRootBindingId: "root_01",
    transactionId: "tx_01",
    operationId: "op_01",
    providerSemanticVersionSetChecksum: hash("provider"),
    relativeIdentity: "src/main.ts",
    before: {
      schemaVersion: "2.0",
      kind: "absent",
      absenceProof: createEngineeringAbsenceProofV2({
        rootBindingId: "root_01",
        relativeIdentity: "src/main.ts",
        parentDirectoryIdentity: "directory_01",
        observedAt: "2099-01-01T00:00:00.000Z"
      })
    },
    candidate: {
      schemaVersion: "2.0",
      manifest,
      blob: {
        schemaVersion: "2.0",
        contentRootBindingId: "root_01",
        blobId: engineeringMutationBlobIdForSha256V2(manifest.sha256),
        storage: "main_owned_immutable_blob",
        sha256: manifest.sha256,
        byteLength: manifest.byteLength,
        encoding: manifest.encoding,
        bom: manifest.bom,
        eol: manifest.eol
      }
    },
    stagingObjectId: "staging_01"
  };
}

function receiptFor(request: EngineeringFileMutationRequestV2) {
  return createEngineeringMutationReceiptV2({
    transactionId: request.transactionId,
    operationId: request.operationId,
    operationKind: request.operationKind,
    contentRootBindingId: request.contentRootBindingId,
    providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
    relativeIdentity: request.relativeIdentity,
    requestChecksum: engineeringFileMutationRequestChecksumV2(request),
    observedBefore: request.before,
    observedAfter: {
      ...request.candidate.manifest,
      identity: {
        kind: "observed_file",
        rootBindingId: "root_01",
        relativeIdentity: "src/main.ts",
        fileIdentity: "file_01"
      }
    },
    stagingObjectId: request.stagingObjectId,
    recoveryObjectId: null,
    durability: "data_and_directory_flushed"
  });
}
