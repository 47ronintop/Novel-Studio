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
import { describe, expect, test, vi } from "vitest";

import {
  FileEngineeringMutationBlobStoreV2,
  InMemoryEngineeringMutationBlobStoreV2,
  type FileEngineeringMutationBlobStoreV2Options,
  type EngineeringStateDurabilityPortV2
} from "../src/engineering-mutation-blob-store.js";

describe("EngineeringMutationBlobStoreV2", () => {
  test("stores immutable raw bytes under deterministic content addresses", async () => {
    const store = new InMemoryEngineeringMutationBlobStoreV2();
    const bytes = new TextEncoder().encode("\ufeffone\r\ntwo\r\n");
    const stored = await store.put({ contentRootBindingId: "root_01", bytes });
    if (!stored.ok) throw new Error(stored.error.message);

    const read = await store.get(stored.value);
    expect(read).toMatchObject({ ok: true });
    if (!read.ok) throw new Error(read.error.message);
    expect(new TextDecoder().decode(read.value)).toBe("one\r\ntwo\r\n");
    expect(stored.value).toMatchObject({
      blobId: `blob_${stored.value.sha256}`,
      bom: "utf-8",
      eol: "crlf"
    });

    expect(await store.get({ ...stored.value, contentRootBindingId: "root_other" })).toMatchObject({
      ok: false,
      error: { code: "ENGINEERING_MUTATION_BLOB_MISSING" }
    });
  });

  test("uses only the injected qualified durability seam and opaque on-disk ids", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-blobs-"));
    const durability = nodeTestDurability();
    try {
      const store = new FileEngineeringMutationBlobStoreV2({ stateRoot, durability });
      const stored = await store.put({
        contentRootBindingId: "root:01",
        bytes: new TextEncoder().encode("const created = true;\n")
      });
      if (!stored.ok) throw new Error(stored.error.message);

      const reloaded = new FileEngineeringMutationBlobStoreV2({ stateRoot, durability });
      await expect(reloaded.get(stored.value)).resolves.toMatchObject({ ok: true });
      await expect(
        reloaded.scanRoot({ contentRootBindingId: "root:01", referencedBlobIds: [] })
      ).resolves.toMatchObject({
        ok: true,
        value: { orphanBlobIds: [stored.value.blobId], authenticationFailureCount: 0 }
      });
      const rootDirectories = await readdir(join(stateRoot, "engineering-v2", "blobs"));
      expect(rootDirectories).toHaveLength(1);
      expect(rootDirectories[0]).toMatch(/^root-[a-f0-9]{64}$/u);
      expect(durability.flushDirectory).toHaveBeenCalled();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("fails closed when qualified durability is absent or a directory flush fails", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-blobs-"));
    try {
      const unavailable = new FileEngineeringMutationBlobStoreV2({
        stateRoot
      } as FileEngineeringMutationBlobStoreV2Options);
      await expect(
        unavailable.put({ contentRootBindingId: "root_01", bytes: new TextEncoder().encode("x") })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_BLOB_DURABILITY_UNQUALIFIED" }
      });

      const durable = nodeTestDurability();
      const failing = {
        ...durable,
        flushDirectory: vi.fn(async () => {
          throw Object.assign(new Error("flush failed"), { code: "EIO" });
        })
      } satisfies EngineeringStateDurabilityPortV2;
      const store = new FileEngineeringMutationBlobStoreV2({ stateRoot, durability: failing });
      await expect(
        store.put({ contentRootBindingId: "root_01", bytes: new TextEncoder().encode("x") })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_BLOB_WRITE_FAILED" }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});

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
