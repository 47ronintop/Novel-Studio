import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  CreativeProjectFileRepository,
  type CreativeProjectFileLifecycleCommand
} from "@novel-studio/repository";
import { createDesktopCreativeProjectFileReceiptStore } from "../src/main/creative-project-file-receipt-store.js";

const roots: string[] = [];
const identity = { projectId: "prj_01", workspaceId: "ws_01" } as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop creative project file receipt store", () => {
  test("replays a lifecycle receipt after a repository and store restart", async () => {
    const contentRoot = await createRoot("content");
    const stateRoot = await createRoot("state");
    const first = repository(contentRoot, stateRoot);
    const tree = await first.getTreeSnapshot();
    if (!tree.ok) throw tree.error;
    const command = createDirectory(tree.value.treeRevision, "create-notes", "notes");

    const applied = await first.executeLifecycleCommand(command);
    expect(applied).toMatchObject({ ok: true, value: { commandFingerprint: expect.any(String) } });
    if (!applied.ok) throw applied.error;

    const restarted = repository(contentRoot, stateRoot);
    await expect(restarted.executeLifecycleCommand(command)).resolves.toEqual(applied);
    await expect(restarted.executeLifecycleCommand({ ...command, path: "other" })).resolves.toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT" }
    });
  });

  test("keeps receipts isolated by workspace identity even when state roots are shared", async () => {
    const stateRoot = await createRoot("state");
    const first = createDesktopCreativeProjectFileReceiptStore({ stateRoot, ...identity });
    const second = createDesktopCreativeProjectFileReceiptStore({
      stateRoot,
      projectId: "prj_02",
      workspaceId: "ws_02"
    });
    const receipt = {
      schemaVersion: "1.0" as const,
      commandId: "create-notes",
      commandKind: "createDirectory" as const,
      commandFingerprint: "a".repeat(64),
      ...identity,
      treeRevision: "tree:1",
      affectedPaths: ["notes"]
    };

    await expect(first.writeReceipt(receipt)).resolves.toEqual({ ok: true, value: receipt });
    await expect(second.readReceipt(receipt.commandId)).resolves.toEqual({ ok: true, value: undefined });
  });

  test("fails closed when persisted receipt data is corrupt", async () => {
    const stateRoot = await createRoot("state");
    const store = createDesktopCreativeProjectFileReceiptStore({ stateRoot, ...identity });
    const receipt = {
      schemaVersion: "1.0" as const,
      commandId: "create-notes",
      commandKind: "createDirectory" as const,
      commandFingerprint: "a".repeat(64),
      ...identity,
      treeRevision: "tree:1",
      affectedPaths: ["notes"]
    };
    await expect(store.writeReceipt(receipt)).resolves.toMatchObject({ ok: true });

    const directory = join(stateRoot, "agent", "creative-project-file-receipts");
    const [file] = await readdir(directory);
    if (file === undefined) throw new Error("Expected receipt file");
    await writeFile(join(directory, file), "{not-json", "utf8");

    await expect(store.readReceipt(receipt.commandId)).resolves.toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID" }
    });
  });
});

function repository(contentRoot: string, stateRoot: string): CreativeProjectFileRepository {
  return new CreativeProjectFileRepository({
    projectRoot: contentRoot,
    ...identity,
    receiptStore: createDesktopCreativeProjectFileReceiptStore({ stateRoot, ...identity })
  });
}

function createDirectory(
  expectedTreeRevision: string,
  commandId: string,
  path: string
): Extract<CreativeProjectFileLifecycleCommand, { readonly kind: "createDirectory" }> {
  return {
    schemaVersion: "1.0",
    commandId,
    ...identity,
    expectedTreeRevision,
    kind: "createDirectory",
    path
  };
}

async function createRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-receipt-${label}-`));
  roots.push(root);
  return root;
}
