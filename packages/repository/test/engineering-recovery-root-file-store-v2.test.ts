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

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  FileEngineeringRecoveryGlobalRecordStoreV2,
  FileEngineeringRecoveryObjectManifestStoreV2,
  type EngineeringVolumeLocalRecoveryDurabilityPortV2
} from "../src/engineering-recovery-root-file-store-v2.js";
import {
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "../src/engineering-file-mutation-port-v2.js";
import type { EngineeringStateDurabilityPortV2 } from "../src/engineering-mutation-blob-store.js";
import {
  EngineeringRecoveryRootRepositoryV2,
  type EngineeringRecoveryObjectManifestV2
} from "../src/engineering-recovery-root-repository.js";
import {
  issueVolumeLocalRecoveryBindingV2,
  volumeLocalRecoverySideEffectChecksumV2,
  type VolumeLocalRecoveryBindingV2
} from "../src/volume-local-recovery-binding.js";

const temporaryRoots: string[] = [];
const hash = (value: string) => sha256EngineeringMutationTextV2(value);

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("file-backed engineering recovery-root stores", () => {
  test("durably reloads the global record and volume-local manifest as one authenticated pair", async () => {
    const roots = await createRoots();
    const binding = createBinding();
    const stateDurability = nodeTestDurability();
    const recoveryDurability = volumeLocalDurability(binding);
    const stores = createStores(roots, binding, stateDurability, recoveryDurability);
    const repository = createRepository(binding, stores);

    await expect(repository.recordQuarantine(createRecordInput(binding))).resolves.toMatchObject({
      ok: true,
      value: { recoveryObjectId: "object_01", state: "quarantined" }
    });

    const reloadedStores = createStores(roots, binding, stateDurability, recoveryDurability);
    const reloaded = createRepository(binding, reloadedStores);
    await expect(reloaded.scanRoot()).resolves.toMatchObject({
      ok: true,
      value: {
        status: "clear",
        globalRecordCount: 1,
        manifestCount: 1,
        usedBytes: 8
      }
    });
    await expect(reloadedStores.globalRecords.get("object_01")).resolves.toMatchObject({
      ok: true,
      value: { recoveryObjectId: "object_01" }
    });
    await expect(reloadedStores.manifests.get("object_01")).resolves.toMatchObject({
      ok: true,
      value: { recoveryObjectId: "object_01", relativeIdentity: "src/main.ts" }
    });

    const globalFiles = await allFiles(roots.stateRoot);
    const manifestFiles = await allFiles(roots.recoveryRoot);
    expect(globalFiles).toEqual([
      expect.stringMatching(/global-records.*object-[a-f0-9]{64}\.json$/u)
    ]);
    expect(manifestFiles).toEqual([
      expect.stringMatching(/volume-local-manifests.*object-[a-f0-9]{64}\.json$/u)
    ]);
    expect([...globalFiles, ...manifestFiles].join("/")).not.toContain("object_01");
    expect(stateDurability.flushDirectory).toHaveBeenCalled();
    expect(recoveryDurability.flushDirectory).toHaveBeenCalled();
  });

  test("fails closed for malformed, unknown, missing-pair, and binding-mismatched state", async () => {
    const roots = await createRoots();
    const binding = createBinding();
    const stateDurability = nodeTestDurability();
    const recoveryDurability = volumeLocalDurability(binding);
    const stores = createStores(roots, binding, stateDurability, recoveryDurability);
    const repository = createRepository(binding, stores);
    await repository.recordQuarantine(createRecordInput(binding));

    const [manifestPath] = await allFiles(roots.recoveryRoot, true);
    if (manifestPath === undefined) throw new Error("Expected a durable recovery manifest");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    await writeFile(manifestPath, JSON.stringify({ ...manifest, extra: true }), "utf8");
    await expect(stores.manifests.list(binding.contentRootBindingId)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_AUTHENTICATION_FAILED" }
    });
    await expect(repository.scanRoot()).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_ROOT_BLOCKED" }
    });

    const cleanRoots = await createRoots();
    const cleanStores = createStores(
      cleanRoots,
      binding,
      nodeTestDurability(),
      volumeLocalDurability(binding)
    );
    await cleanStores.manifests.put(createManifest(binding));
    await expect(createRepository(binding, cleanStores).scanRoot()).resolves.toMatchObject({
      ok: true,
      value: { status: "blocked", reasons: ["orphaned_manifest"] }
    });
    const manifestDirectory = join(
      cleanRoots.recoveryRoot,
      ".novel-studio-engineering-v2",
      "volume-local-manifests",
      `content-${hash(binding.contentRootBindingId)}`,
      `recovery-${hash(binding.recoveryRootBindingId)}`
    );
    await writeFile(join(manifestDirectory, "leftover.tmp"), "unknown", "utf8");
    await expect(cleanStores.manifests.list(binding.contentRootBindingId)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_AUTHENTICATION_FAILED" }
    });

    const otherBinding = createBinding({ recoveryRootBindingId: "recovery_other" });
    const mismatched = new FileEngineeringRecoveryObjectManifestStoreV2({
      recoveryRoot: cleanRoots.recoveryRoot,
      binding,
      durability: volumeLocalDurability(otherBinding)
    });
    await expect(mismatched.get("object_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_BOUNDARY_MISMATCH" }
    });
    await expect(cleanStores.globalRecords.list("root_other")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_BOUNDARY_MISMATCH" }
    });
  });

  test("uses immutable put and authenticated compare-and-swap replacement", async () => {
    const roots = await createRoots();
    const binding = createBinding();
    const stores = createStores(
      roots,
      binding,
      nodeTestDurability(),
      volumeLocalDurability(binding)
    );
    const manifest = createManifest(binding);
    await expect(stores.manifests.put(manifest)).resolves.toMatchObject({ ok: true });
    await expect(stores.manifests.put(manifest)).resolves.toMatchObject({ ok: true });
    await expect(
      stores.manifests.put(sealManifest(manifest, { byteLength: 9 }))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_CONFLICT" }
    });

    const restored = sealManifest(manifest, { state: "restored" });
    await expect(stores.manifests.replace(manifest, restored)).resolves.toMatchObject({
      ok: true,
      value: { state: "restored" }
    });
    await expect(stores.manifests.replace(manifest, restored)).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_CONFLICT" }
    });
  });

  test("requires qualified durability and an exact same-volume recovery authority", async () => {
    const roots = await createRoots();
    const binding = createBinding();
    const unqualified = new FileEngineeringRecoveryGlobalRecordStoreV2({
      stateRoot: roots.stateRoot,
      binding
    } as never);
    await expect(unqualified.get("object_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_DURABILITY_UNQUALIFIED" }
    });

    const crossedVolume = createBinding(
      {
        recoveryVolumeIdentity: "volume_other",
        recoveryRootBindingId: "recovery_crossed"
      },
      false
    );
    const crossedStore = new FileEngineeringRecoveryObjectManifestStoreV2({
      recoveryRoot: roots.recoveryRoot,
      binding,
      durability: {
        ...nodeTestDurability(),
        recoveryBinding: crossedVolume
      }
    });
    await expect(crossedStore.get("object_01")).resolves.toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_RECOVERY_STORE_BOUNDARY_MISMATCH" }
    });
  });
});

function createRepository(
  binding: VolumeLocalRecoveryBindingV2,
  stores: ReturnType<typeof createStores>
) {
  return new EngineeringRecoveryRootRepositoryV2({
    binding,
    globalRecords: stores.globalRecords,
    manifests: stores.manifests,
    isGrantCurrent: async () => true,
    now: () => "2099-01-01T00:00:00.000Z"
  });
}

function createStores(
  roots: { readonly stateRoot: string; readonly recoveryRoot: string },
  binding: VolumeLocalRecoveryBindingV2,
  stateDurability: EngineeringStateDurabilityPortV2,
  recoveryDurability: EngineeringVolumeLocalRecoveryDurabilityPortV2
) {
  return {
    globalRecords: new FileEngineeringRecoveryGlobalRecordStoreV2({
      stateRoot: roots.stateRoot,
      binding,
      durability: stateDurability
    }),
    manifests: new FileEngineeringRecoveryObjectManifestStoreV2({
      recoveryRoot: roots.recoveryRoot,
      binding,
      durability: recoveryDurability
    })
  };
}

async function createRoots() {
  const parent = await mkdtemp(join(tmpdir(), "engineering-v2-recovery-store-"));
  temporaryRoots.push(parent);
  const stateRoot = join(parent, "state");
  const recoveryRoot = join(parent, "volume-recovery");
  await mkdir(stateRoot);
  await mkdir(recoveryRoot);
  return { stateRoot, recoveryRoot };
}

function createBinding(changes: Record<string, unknown> = {}, expectIssued = true) {
  const unsigned = {
    schemaVersion: "2.0",
    recoveryRootBindingId: "recovery_01",
    contentRootBindingId: "root_01",
    recoveryRootId: "native_recovery_01",
    contentVolumeIdentity: "volume_01",
    recoveryVolumeIdentity: "volume_01",
    contentDirectoryIdentity: "directory_content",
    recoveryDirectoryIdentity: "directory_recovery",
    rootRelationship: "identity_disjoint",
    authority: "installer_managed",
    grantRevision: "grant_01",
    ownershipMarkerChecksum: hash("marker"),
    aclModeQualification: "qualified",
    atomicRenameQualification: "qualified",
    directoryDurabilityQualification: "qualified",
    storageLabel: "Volume recovery storage",
    capacityBytes: 1024,
    reservedBytes: 0,
    retentionDays: 30,
    observedAt: "2099-01-01T00:00:00.000Z",
    ...changes
  };
  const issued = issueVolumeLocalRecoveryBindingV2(
    { ...unsigned, evidenceChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned)) },
    { authenticateEvidence: () => ({ ok: true, value: undefined }) }
  );
  if (issued.ok) return issued.value;
  if (expectIssued) throw new Error(issued.error.message);
  return {
    ...unsigned,
    bindingChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned))
  } as VolumeLocalRecoveryBindingV2;
}

function createRecordInput(binding: VolumeLocalRecoveryBindingV2) {
  return {
    recoveryObjectId: "object_01",
    transactionId: "tx_01",
    operationId: "op_01",
    relativeIdentity: "src/main.ts",
    sourceSha256: hash("source"),
    byteLength: 8,
    sideEffectChecksum: volumeLocalRecoverySideEffectChecksumV2({
      binding,
      transactionId: "tx_01",
      operationId: "op_01",
      recoveryObjectId: "object_01",
      relativeIdentity: "src/main.ts",
      sourceSha256: hash("source")
    })
  };
}

function createManifest(binding: VolumeLocalRecoveryBindingV2) {
  const sideEffectChecksum = volumeLocalRecoverySideEffectChecksumV2({
    binding,
    transactionId: "tx_01",
    operationId: "op_01",
    recoveryObjectId: "object_01",
    relativeIdentity: "src/main.ts",
    sourceSha256: hash("source")
  });
  const unsigned = {
    schemaVersion: "2.0" as const,
    kind: "engineering_recovery_object_manifest" as const,
    recoveryObjectId: "object_01",
    contentRootBindingId: binding.contentRootBindingId,
    recoveryRootBindingId: binding.recoveryRootBindingId,
    transactionId: "tx_01",
    operationId: "op_01",
    relativeIdentity: "src/main.ts",
    sourceSha256: hash("source"),
    byteLength: 8,
    bindingChecksum: binding.bindingChecksum,
    sideEffectChecksum,
    state: "quarantined" as const,
    pinned: false,
    createdAt: "2099-01-01T00:00:00.000Z",
    retentionExpiresAt: "2099-02-01T00:00:00.000Z"
  };
  return {
    ...unsigned,
    manifestChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned))
  };
}

function sealManifest(
  manifest: EngineeringRecoveryObjectManifestV2,
  changes: Partial<EngineeringRecoveryObjectManifestV2>
): EngineeringRecoveryObjectManifestV2 {
  const unsigned = { ...manifest, ...changes } as Record<string, unknown>;
  delete unsigned["manifestChecksum"];
  return {
    ...unsigned,
    manifestChecksum: hash(canonicalizeEngineeringMutationV2Json(unsigned))
  } as EngineeringRecoveryObjectManifestV2;
}

function volumeLocalDurability(
  binding: VolumeLocalRecoveryBindingV2
): EngineeringVolumeLocalRecoveryDurabilityPortV2 & {
  flushDirectory: ReturnType<typeof vi.fn>;
} {
  return { ...nodeTestDurability(), recoveryBinding: binding };
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

async function allFiles(root: string, absolute = false): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(absolute ? path : path.slice(root.length + 1));
    }
  }
  await visit(root);
  return files.sort();
}
