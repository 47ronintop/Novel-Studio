import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createOperationsChangeSetRevisionV2 } from "@novel-studio/agent-engine";
import { describe, expect, test, vi } from "vitest";

import {
  createEngineeringAbsenceProofV2,
  createEngineeringRawByteManifestV2,
  engineeringMutationBlobIdForSha256V2,
  sha256EngineeringMutationTextV2,
  type EngineeringFileMutationOperationKindV2
} from "../src/engineering-file-mutation-port-v2.js";
import {
  FileEngineeringMutationProposalRepositoryV2,
  InMemoryEngineeringMutationProposalRepositoryV2,
  type EngineeringMutationProposalCreateInputV2
} from "../src/engineering-mutation-proposal-repository-v2.js";
import { type EngineeringStateDurabilityPortV2 } from "../src/engineering-mutation-blob-store.js";

const hash = (value: string) => sha256EngineeringMutationTextV2(value);
const createdAt = "2099-01-01T00:00:00.000Z";

describe("EngineeringMutationProposalRepositoryV2", () => {
  test("creates once and gives same-run/toolCall idempotency only to the same canonical payload", async () => {
    const repository = new InMemoryEngineeringMutationProposalRepositoryV2({
      now: () => createdAt
    });
    const input = proposalInput();

    const first = await repository.create(input);
    const replay = await repository.create({ ...input, proposalId: "proposal_replayed" });
    if (!first.ok || !replay.ok) throw new Error("expected proposal to persist");

    expect(replay.value).toBe(first.value);
    expect(first.value).toMatchObject({
      schemaVersion: "2.0",
      status: "proposed",
      proposalPayloadChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    await expect(repository.getByProposalId(input.proposalId)).resolves.toMatchObject({
      ok: true,
      value: { proposalId: input.proposalId }
    });
    await expect(
      repository.getByRunToolCall({ runId: input.runId, toolCallId: input.toolCallId })
    ).resolves.toMatchObject({
      ok: true,
      value: { proposalId: input.proposalId }
    });
    await expect(
      repository.create({
        ...input,
        canonicalPayloadChecksum: hash("different-canonical-tool-payload")
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_PROPOSAL_TOOL_CALL_CONFLICT" }
    });
  });

  test("binds one exact Change Set then keeps terminal proposal state monotonic", async () => {
    const repository = new InMemoryEngineeringMutationProposalRepositoryV2({
      now: () => "2099-01-01T00:00:01.000Z"
    });
    const input = proposalInput({ operationKind: "replace_file" });
    const stored = await repository.create(input);
    if (!stored.ok) throw new Error(stored.error.message);
    const binding = changeSetBinding(input);

    await expect(repository.markApplied(input.proposalId)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_UNBOUND" }
    });
    await expect(repository.bindChangeSet(binding)).resolves.toMatchObject({
      ok: true,
      value: { changeSetBinding: { changeSetId: "changes_01" } }
    });
    await expect(repository.bindChangeSet(binding)).resolves.toMatchObject({ ok: true });
    await expect(
      repository.bindChangeSet({ ...binding, selectionChecksum: hash("changed-selection") })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_PROPOSAL_CHANGE_SET_CONFLICT" }
    });
    await expect(repository.markApplied(input.proposalId)).resolves.toMatchObject({
      ok: true,
      value: { status: "applied" }
    });
    await expect(repository.markApplied(input.proposalId)).resolves.toMatchObject({
      ok: true,
      value: { status: "applied" }
    });
    await expect(repository.reject(input.proposalId)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_PROPOSAL_STATE_CONFLICT" }
    });
  });

  test("file repository survives reload, hashes disk ids, and uses durable replace for binding", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-proposals-"));
    const durability = nodeTestDurability();
    const input = proposalInput();
    try {
      const repository = new FileEngineeringMutationProposalRepositoryV2({
        stateRoot,
        durability,
        now: () => createdAt
      });
      const stored = await repository.create(input);
      if (!stored.ok) throw new Error(stored.error.message);

      const directory = proposalDirectory(stateRoot);
      const names = await readdir(directory);
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^tool-call-[a-f0-9]{64}\.json$/u);
      expect(names.join(" ")).not.toContain(input.runId);
      expect(names.join(" ")).not.toContain(input.toolCallId);

      const bound = await repository.bindChangeSet(changeSetBinding(input));
      if (!bound.ok) throw new Error(bound.error.message);
      expect(durability.renameReplaceNoFollow).toHaveBeenCalledTimes(1);
      expect(durability.flushDirectory).toHaveBeenCalled();

      await expect(
        new FileEngineeringMutationProposalRepositoryV2({ stateRoot, durability }).getByProposalId(
          input.proposalId
        )
      ).resolves.toMatchObject({
        ok: true,
        value: {
          proposalId: input.proposalId,
          changeSetBinding: { checksum: bound.value.changeSetBinding?.checksum }
        }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("crash residue and unknown proposal-store objects fail closed", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-proposals-"));
    const durability = nodeTestDurability();
    const input = proposalInput();
    try {
      const repository = new FileEngineeringMutationProposalRepositoryV2({
        stateRoot,
        durability,
        now: () => createdAt
      });
      const stored = await repository.create(input);
      if (!stored.ok) throw new Error(stored.error.message);
      await writeFile(join(proposalDirectory(stateRoot), "crashed-write.tmp"), "partial");

      await expect(repository.scan()).resolves.toMatchObject({
        ok: true,
        value: { unknownObjectCount: 1 }
      });
      await expect(repository.getByProposalId(input.proposalId)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_PROPOSAL_UNKNOWN_OBJECT" }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("strict file reader rejects forged records and valid records under a mismatched disk id", async () => {
    const forgedRoot = await mkdtemp(join(tmpdir(), "engineering-v2-proposals-"));
    const mismatchRoot = await mkdtemp(join(tmpdir(), "engineering-v2-proposals-"));
    const input = proposalInput();
    try {
      const forgedDurability = nodeTestDurability();
      const forgedRepository = new FileEngineeringMutationProposalRepositoryV2({
        stateRoot: forgedRoot,
        durability: forgedDurability,
        now: () => createdAt
      });
      const stored = await forgedRepository.create(input);
      if (!stored.ok) throw new Error(stored.error.message);
      const forgedPath = join(
        proposalDirectory(forgedRoot),
        (await readdir(proposalDirectory(forgedRoot)))[0] ?? ""
      );
      const forged = JSON.parse(await readFile(forgedPath, "utf8")) as Record<string, unknown>;
      forged["policyRevision"] = "forged-policy-revision";
      await writeFile(forgedPath, JSON.stringify(forged));
      await expect(forgedRepository.getByProposalId(input.proposalId)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_PROPOSAL_AUTHENTICATION_FAILED" }
      });

      const mismatchDurability = nodeTestDurability();
      const mismatchRepository = new FileEngineeringMutationProposalRepositoryV2({
        stateRoot: mismatchRoot,
        durability: mismatchDurability,
        now: () => createdAt
      });
      const mismatchStored = await mismatchRepository.create(input);
      if (!mismatchStored.ok) throw new Error(mismatchStored.error.message);
      const directory = proposalDirectory(mismatchRoot);
      const originalName = (await readdir(directory))[0];
      if (originalName === undefined) throw new Error("proposal record was not written");
      await writeFile(
        join(directory, `tool-call-${"f".repeat(64)}.json`),
        await readFile(join(directory, originalName))
      );
      await expect(mismatchRepository.scan()).resolves.toMatchObject({
        ok: true,
        value: { authenticationFailureCount: 1 }
      });
      await expect(mismatchRepository.getByProposalId(input.proposalId)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_PROPOSAL_AUTHENTICATION_FAILED" }
      });
    } finally {
      await rm(forgedRoot, { recursive: true, force: true });
      await rm(mismatchRoot, { recursive: true, force: true });
    }
  });
});

function proposalInput(
  options: {
    readonly operationKind?: EngineeringFileMutationOperationKindV2;
    readonly proposalId?: string;
    readonly canonicalPayloadChecksum?: string;
  } = {}
): EngineeringMutationProposalCreateInputV2 {
  const operationKind = options.operationKind ?? "create_file";
  const contentRootBindingId = "root_01";
  const relativeIdentity = "src/main.ts";
  const candidateBytes = new TextEncoder().encode("export const candidate = true;\n");
  const candidateManifest = createEngineeringRawByteManifestV2({
    identity: {
      kind: "target",
      rootBindingId: contentRootBindingId,
      relativeIdentity,
      fileIdentity: null
    },
    bytes: candidateBytes,
    metadataChecksum: hash("candidate-metadata")
  });
  const before =
    operationKind === "replace_file"
      ? {
          schemaVersion: "2.0" as const,
          kind: "present" as const,
          manifest: createEngineeringRawByteManifestV2({
            identity: {
              kind: "observed_file",
              rootBindingId: contentRootBindingId,
              relativeIdentity,
              fileIdentity: "file_01"
            },
            bytes: new TextEncoder().encode("export const candidate = false;\n"),
            metadataChecksum: hash("before-metadata")
          })
        }
      : {
          schemaVersion: "2.0" as const,
          kind: "absent" as const,
          absenceProof: createEngineeringAbsenceProofV2({
            rootBindingId: contentRootBindingId,
            relativeIdentity,
            parentDirectoryIdentity: "directory_01",
            observedAt: createdAt
          })
        };
  const beforeWithBlob =
    before.kind === "present"
      ? { ...before, blob: blobFor(before.manifest, contentRootBindingId) }
      : before;

  return {
    schemaVersion: "2.0",
    proposalId: options.proposalId ?? "proposal_01",
    runId: "run_01",
    projectId: "project_01",
    toolCallId: "tool_01",
    canonicalPayloadChecksum: options.canonicalPayloadChecksum ?? hash("canonical-tool-payload"),
    operationKind,
    contentRootBindingId,
    pathPolicyRevision: "path-policy_01",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01",
    providerSemanticVersionSetChecksum: hash("provider-semantic-version-set"),
    approvalRuleSetVersion: "ordinary_create_only_v1",
    approvalRuleSetChecksum: hash("approval-rule-set"),
    relativeIdentity,
    sourceRef:
      operationKind === "replace_file" ? opaqueRef("file", "a") : opaqueRef("directory", "b"),
    targetRef: opaqueRef("file", "c"),
    before: beforeWithBlob,
    candidate: {
      schemaVersion: "2.0",
      manifest: candidateManifest,
      blob: blobFor(candidateManifest, contentRootBindingId)
    },
    operationId: "op_01",
    stagingObjectId: "staging_01"
  };
}

function changeSetBinding(input: EngineeringMutationProposalCreateInputV2) {
  return {
    proposalId: input.proposalId,
    changeSet: createOperationsChangeSetRevisionV2({
      changeSetId: "changes_01",
      runId: input.runId,
      projectId: input.projectId,
      checkpointId: "checkpoint_01",
      contextSnapshotId: "context_01",
      operations: [
        {
          kind: "create_file" as const,
          operationId: input.operationId,
          relativePath: input.relativeIdentity,
          content: "export const candidate = true;\n",
          toolCallIdempotencyKey: input.toolCallId
        }
      ],
      createdAt,
      providerSemanticVersionSetChecksum: input.providerSemanticVersionSetChecksum
    }),
    selectionChecksum: hash("selection"),
    operationOrderChecksum: hash("operation-order"),
    selectedOperationIds: [input.operationId]
  };
}

function blobFor(
  manifest: ReturnType<typeof createEngineeringRawByteManifestV2>,
  contentRootBindingId: string
) {
  return {
    schemaVersion: "2.0" as const,
    contentRootBindingId,
    blobId: engineeringMutationBlobIdForSha256V2(manifest.sha256),
    storage: "main_owned_immutable_blob" as const,
    sha256: manifest.sha256,
    byteLength: manifest.byteLength,
    encoding: manifest.encoding,
    bom: manifest.bom,
    eol: manifest.eol
  };
}

function opaqueRef(kind: "file" | "directory", fill: string): string {
  return `engineering_${kind}_ref:${fill.repeat(64)}`;
}

function proposalDirectory(stateRoot: string): string {
  return join(stateRoot, "engineering-v2", "proposals");
}

function nodeTestDurability(): EngineeringStateDurabilityPortV2 & {
  flushDirectory: ReturnType<typeof vi.fn>;
  renameReplaceNoFollow: ReturnType<typeof vi.fn>;
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
    renameReplaceNoFollow: vi.fn(async (oldPath: string, newPath: string) =>
      rename(oldPath, newPath)
    ),
    unlinkNoFollow: async (path) => unlink(path)
  };
}
