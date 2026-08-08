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
import { describe, expect, test, vi } from "vitest";

import {
  FileEngineeringMutationSyncRequiredStoreV2,
  validateEngineeringMutationSyncRequiredRecordV2,
  type FileEngineeringMutationSyncRequiredStoreV2Options
} from "../src/engineering-mutation-sync-required-store-v2.js";
import type { EngineeringStateDurabilityPortV2 } from "../src/engineering-mutation-blob-store.js";

const record = {
  schemaVersion: "2.0" as const,
  kind: "sync_required" as const,
  contentRootBindingId: "root_01",
  transactionId: "transaction_01",
  operationKind: "replace_file" as const,
  relativeIdentities: ["chapters/one.md"],
  recordedAt: "2026-08-08T12:00:00.000Z"
};

describe("FileEngineeringMutationSyncRequiredStoreV2", () => {
  test("durably records a root block, reloads it, and rejects the next mutation", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-sync-required-"));
    const durability = nodeTestDurability();
    try {
      const store = new FileEngineeringMutationSyncRequiredStoreV2({ stateRoot, durability });
      await expect(store.assertNoSyncRequired(record.contentRootBindingId)).resolves.toMatchObject({
        ok: true
      });
      await expect(store.writeSyncRequired(record)).resolves.toMatchObject({ ok: true });
      await expect(store.writeSyncRequired(record)).resolves.toMatchObject({ ok: true });

      const reloaded = new FileEngineeringMutationSyncRequiredStoreV2({ stateRoot, durability });
      await expect(reloaded.readSyncRequired(record.contentRootBindingId)).resolves.toMatchObject({
        ok: true,
        value: record
      });
      await expect(
        reloaded.assertNoSyncRequired(record.contentRootBindingId)
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_SYNC_REQUIRED" }
      });
      await expect(
        reloaded.writeSyncRequired({ ...record, transactionId: "transaction_02" })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_SYNC_REQUIRED_CONFLICT" }
      });

      const names = await readdir(join(stateRoot, "engineering-v2", "sync-required"));
      expect(names).toEqual([expect.stringMatching(/^root-[a-f0-9]{64}\.json$/u)]);
      expect(durability.flushDirectory).toHaveBeenCalled();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("fails closed for tampered, unknown-version, and unknown namespace state", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-sync-required-"));
    const durability = nodeTestDurability();
    try {
      const store = new FileEngineeringMutationSyncRequiredStoreV2({ stateRoot, durability });
      await expect(store.writeSyncRequired(record)).resolves.toMatchObject({ ok: true });
      const directory = join(stateRoot, "engineering-v2", "sync-required");
      const [fileName] = await readdir(directory);
      if (fileName === undefined) throw new Error("Expected a stored sync-required record");
      const stored = JSON.parse(await readFile(join(directory, fileName), "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        join(directory, fileName),
        JSON.stringify({ ...stored, checksum: "0".repeat(64) }),
        "utf8"
      );

      await expect(store.assertNoSyncRequired(record.contentRootBindingId)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_SYNC_REQUIRED_AUTHENTICATION_FAILED" }
      });

      await writeFile(join(directory, "leftover.tmp"), "unexpected", "utf8");
      await expect(store.readSyncRequired("root_other")).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_SYNC_REQUIRED_AUTHENTICATION_FAILED" }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("strictly validates runtime-compatible input and fails closed without qualified durability", async () => {
    expect(
      validateEngineeringMutationSyncRequiredRecordV2({
        ...record,
        relativeIdentities: ["chapters/z.md", "chapters/a.md"]
      })
    ).toMatchObject({ ok: false });
    expect(
      validateEngineeringMutationSyncRequiredRecordV2({ ...record, schemaVersion: "1.0" })
    ).toMatchObject({ ok: false });
    expect(
      validateEngineeringMutationSyncRequiredRecordV2({ ...record, extra: true })
    ).toMatchObject({ ok: false });

    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-sync-required-"));
    try {
      const store = new FileEngineeringMutationSyncRequiredStoreV2({
        stateRoot
      } as FileEngineeringMutationSyncRequiredStoreV2Options);
      await expect(store.writeSyncRequired(record)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_MUTATION_SYNC_REQUIRED_DURABILITY_UNQUALIFIED" }
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
