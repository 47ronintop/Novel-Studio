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

import type { EngineeringStateDurabilityPortV2 } from "../src/engineering-mutation-blob-store.js";
import {
  FileEngineeringRecoveryPurgeDecisionStoreV2,
  type FileEngineeringRecoveryPurgeDecisionStoreV2Options
} from "../src/engineering-recovery-purge-decision-store-v2.js";

const input = {
  recoveryObjectId: "object_01",
  actor: "local_user" as const,
  reason: "user_confirmed" as const,
  decidedAt: "2099-01-15T00:00:00.000Z",
  contentRootBindingId: "root_01",
  recoveryRootBindingId: "recovery_01",
  recoveryGrantRevision: "grant_01",
  recoverySideEffectChecksum: "a".repeat(64)
};

describe("FileEngineeringRecoveryPurgeDecisionStoreV2", () => {
  test("durably persists one exact immutable decision and reloads it idempotently", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-purge-decision-"));
    const durability = nodeTestDurability();
    try {
      const store = new FileEngineeringRecoveryPurgeDecisionStoreV2({ stateRoot, durability });
      const first = await store.persist(input);
      expect(first).toMatchObject({
        ok: true,
        value: {
          ...input,
          kind: "engineering_quarantine_retention_decision",
          state: "purge_authorized",
          decisionChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
        }
      });
      const reloaded = new FileEngineeringRecoveryPurgeDecisionStoreV2({ stateRoot, durability });
      await expect(reloaded.persist(input)).resolves.toEqual(first);
      await expect(
        reloaded.persist({ ...input, decidedAt: "2099-01-15T00:00:01.000Z" })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_PURGE_DECISION_CONFLICT" }
      });
      expect(durability.flushDirectory).toHaveBeenCalled();
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("rejects tampered records and unknown namespace objects", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-purge-decision-"));
    const durability = nodeTestDurability();
    try {
      const store = new FileEngineeringRecoveryPurgeDecisionStoreV2({ stateRoot, durability });
      await expect(store.persist(input)).resolves.toMatchObject({ ok: true });
      const rootDirectory = join(stateRoot, "engineering-v2", "recovery-purge-decisions");
      const [bindingDirectory] = await readdir(rootDirectory);
      if (bindingDirectory === undefined) throw new Error("missing binding directory");
      const directory = join(rootDirectory, bindingDirectory);
      const [fileName] = await readdir(directory);
      if (fileName === undefined) throw new Error("missing purge decision");
      const record = JSON.parse(await readFile(join(directory, fileName), "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        join(directory, fileName),
        JSON.stringify({ ...record, decisionChecksum: "0".repeat(64) }),
        "utf8"
      );
      await expect(store.persist(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_PURGE_DECISION_AUTHENTICATION_FAILED" }
      });
      await writeFile(join(directory, "unknown.tmp"), "unknown", "utf8");
      await expect(store.persist(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_PURGE_DECISION_AUTHENTICATION_FAILED" }
      });
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  test("validates the actor/reason boundary and requires qualified durability", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "engineering-v2-purge-decision-"));
    try {
      const invalidStore = new FileEngineeringRecoveryPurgeDecisionStoreV2({
        stateRoot,
        durability: nodeTestDurability()
      });
      await expect(
        invalidStore.persist({ ...input, actor: "retention_policy" })
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_PURGE_DECISION_INVALID" }
      });
      const unavailable = new FileEngineeringRecoveryPurgeDecisionStoreV2({
        stateRoot
      } as FileEngineeringRecoveryPurgeDecisionStoreV2Options);
      await expect(unavailable.persist(input)).resolves.toMatchObject({
        ok: false,
        error: { code: "ENGINEERING_RECOVERY_PURGE_DECISION_DURABILITY_UNAVAILABLE" }
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
