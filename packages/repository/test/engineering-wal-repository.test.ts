import { describe, expect, test, vi } from "vitest";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringFileMutationRequestChecksumV2,
  engineeringMutationBlobIdForSha256V2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationRequestV2
} from "../src/engineering-file-mutation-port-v2.js";
import { createEngineeringMutationReceiptV2 } from "../src/engineering-mutation-receipt.js";
import {
  createEngineeringWriteTransactionPreparedV2,
  engineeringSideEffectSubjectChecksumV2,
  engineeringFullAfterManifestChecksumV2,
  FileEngineeringWalRepositoryV2,
  InMemoryEngineeringWalRepositoryV2,
  type FileEngineeringWalRepositoryV2Options
} from "../src/engineering-wal-repository.js";
import { type EngineeringStateDurabilityPortV2 } from "../src/engineering-mutation-blob-store.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);

describe("EngineeringWalRepositoryV2", () => {
  test("requires durable prepared -> ordered progress -> verified commit", async () => {
    const repository = new InMemoryEngineeringWalRepositoryV2();
    const request = createRequest();
    const prepared = createEngineeringWriteTransactionPreparedV2({
      transactionId: request.transactionId,
      contentRootBindingId: request.contentRootBindingId,
      providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
      authorization: authorization(),
      operations: [request],
      preparedAt: "2099-01-01T00:00:00.000Z"
    });
    const wal = await repository.prepare(prepared);
    if (!wal.ok) throw new Error(wal.error.message);

    await expect(
      repository.commit({
        contentRootBindingId: "root_01",
        transactionId: "tx_01",
        fullAfterManifestChecksum: hash("not-ready"),
        committedAt: "2099-01-01T00:00:01.000Z"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_WAL_V2_COMMIT_INCOMPLETE" }
    });

    const receipt = receiptFor(request);
    const progressed = await repository.appendProgress({
      contentRootBindingId: "root_01",
      transactionId: "tx_01",
      receipt,
      recordedAt: "2099-01-01T00:00:01.000Z"
    });
    if (!progressed.ok) throw new Error(progressed.error.message);
    const committed = await repository.commit({
      contentRootBindingId: "root_01",
      transactionId: "tx_01",
      fullAfterManifestChecksum: engineeringFullAfterManifestChecksumV2([receipt]),
      committedAt: "2099-01-01T00:00:02.000Z"
    });

    expect(committed).toMatchObject({ ok: true, value: { commit: { transactionId: "tx_01" } } });
  });

  test("file seam reloads an immutable prepared record instead of adopting a legacy shape", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-wal-"));
    const durability = nodeTestDurability();
    try {
      const request = createRequest();
      const prepared = createEngineeringWriteTransactionPreparedV2({
        transactionId: request.transactionId,
        contentRootBindingId: request.contentRootBindingId,
        providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
        authorization: authorization(),
        operations: [request],
        preparedAt: "2099-01-01T00:00:00.000Z"
      });
      const stored = await new FileEngineeringWalRepositoryV2({ stateRoot, durability }).prepare(
        prepared
      );
      if (!stored.ok) throw new Error(stored.error.message);
      await expect(
        new FileEngineeringWalRepositoryV2({ stateRoot, durability }).read({
          contentRootBindingId: "root_01",
          transactionId: "tx_01"
        })
      ).resolves.toMatchObject({ ok: true, value: { prepared: { transactionId: "tx_01" } } });
      expect(durability.flushDirectory).toHaveBeenCalled();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("treats an identical recovered receipt as idempotent progress and rejects a different one", async () => {
    const repository = new InMemoryEngineeringWalRepositoryV2();
    const request = createRequest();
    const prepared = createEngineeringWriteTransactionPreparedV2({
      transactionId: request.transactionId,
      contentRootBindingId: request.contentRootBindingId,
      providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
      authorization: authorization(),
      operations: [request],
      preparedAt: "2099-01-01T00:00:00.000Z"
    });
    await repository.prepare(prepared);
    const receipt = receiptFor(request);
    const input = {
      contentRootBindingId: request.contentRootBindingId,
      transactionId: request.transactionId,
      receipt,
      recordedAt: "2099-01-01T00:00:01.000Z"
    };

    await expect(repository.appendProgress(input)).resolves.toMatchObject({
      ok: true,
      value: { progress: [{ operationId: "op_01" }] }
    });
    await expect(repository.appendProgress(input)).resolves.toMatchObject({
      ok: true,
      value: { progress: [{ operationId: "op_01" }] }
    });
    await expect(
      repository.appendProgress({ ...input, receipt: receiptFor(request, "file_other") })
    ).resolves.toMatchObject({ ok: false, error: { code: "ENGINEERING_WAL_V2_CONFLICT" } });
  });

  test("file WAL remains closed when no qualified durability port is supplied", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-wal-"));
    try {
      const request = createRequest();
      const prepared = createEngineeringWriteTransactionPreparedV2({
        transactionId: request.transactionId,
        contentRootBindingId: request.contentRootBindingId,
        providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
        authorization: authorization(),
        operations: [request],
        preparedAt: "2099-01-01T00:00:00.000Z"
      });
      await expect(
        new FileEngineeringWalRepositoryV2({
          stateRoot
        } as FileEngineeringWalRepositoryV2Options).prepare(prepared)
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_WAL_V2_DURABILITY_UNQUALIFIED" }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

function authorization() {
  const request = createRequest();
  return {
    authorizationId: "auth_01",
    approvalBindingId: "binding_01",
    approvalBindingChecksum: hash("binding"),
    sideEffectSubjectChecksum: engineeringSideEffectSubjectChecksumV2({
      transactionId: request.transactionId,
      contentRootBindingId: request.contentRootBindingId,
      providerSemanticVersionSetChecksum: request.providerSemanticVersionSetChecksum,
      operations: [request]
    }),
    changeSetId: "changes_01",
    changeSetRevision: 1,
    changeSetChecksum: hash("changes")
  };
}

function createRequest(): EngineeringFileMutationRequestV2 {
  const bytes = new TextEncoder().encode("const created = true;\n");
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

function receiptFor(request: EngineeringFileMutationRequestV2, fileIdentity = "file_01") {
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
        fileIdentity
      }
    },
    stagingObjectId: request.stagingObjectId,
    recoveryObjectId: null,
    durability: "data_and_directory_flushed"
  });
}

function nodeTestDurability(): EngineeringStateDurabilityPortV2 & {
  flushDirectory: ReturnType<typeof vi.fn>;
} {
  return {
    qualification: "qualified",
    ensureDirectoryNoFollow: async (path) => {
      await mkdir(path, { recursive: true });
    },
    flushDirectory: vi.fn(async () => undefined),
    openExclusiveNoFollow: async (path) => {
      const handle = await open(path, "wx");
      return {
        writeFile: async (bytes) => handle.writeFile(bytes),
        sync: async () => handle.sync(),
        close: async () => handle.close()
      };
    },
    readFileNoFollow: async (path) => new Uint8Array(await readFile(path)),
    readDirectoryNoFollow: async (path) =>
      (await readdir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: entry.isFile()
          ? ("file" as const)
          : entry.isDirectory()
            ? ("directory" as const)
            : entry.isSymbolicLink()
              ? ("symlink" as const)
              : ("other" as const)
      })),
    linkNoFollow: async (existingPath, newPath) => link(existingPath, newPath),
    renameReplaceNoFollow: async (oldPath, newPath) => rename(oldPath, newPath),
    unlinkNoFollow: async (path) => unlink(path)
  };
}
