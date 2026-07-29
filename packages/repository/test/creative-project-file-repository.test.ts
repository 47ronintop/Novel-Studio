import { lstat, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ok } from "@novel-studio/shared";
import { afterEach, describe, expect, test } from "vitest";

import {
  CreativeProjectFileRepository,
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  normalizeCreativeProjectFilePath,
  normalizeCreativeProjectFilePolicy,
  type CreativeProjectFileLifecycleCommand,
  type CreativeProjectFileLifecycleReceipt,
  type CreativeProjectFileReceiptStore,
  type CreativeProjectFileTreeNode
} from "../src/creative-project-file-repository.js";
import type { NoFollowNativeFileOperationPort } from "../src/no-follow-file-operations.js";

const roots: string[] = [];
const identity = { projectId: "prj_01", workspaceId: "ws_01" } as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CreativeProjectFileRepository", () => {
  test("normalizes separators and dot segments before exact-segment policy checks", () => {
    const normalized = normalizeCreativeProjectFilePath("Research\\./Notes.MD", "file");

    expect(normalized).toEqual(
      okPath(process.platform === "win32" ? "research/notes.md" : "Research/Notes.MD")
    );
    expect(normalizeCreativeProjectFilePath("drafts/chapters/idea.md", "file")).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(normalizeCreativeProjectFilePath("notes/../outside.md", "file")).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(
      normalizeCreativeProjectFilePolicy({
        ...DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
        schemaVersion: "2.0"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_POLICY_VERSION_UNSUPPORTED" }
    });
  });

  test("builds a versioned safe tree without roots, body text, or managed paths", async () => {
    const root = await createRoot();
    await mkdir(join(root, "research", "nested"), { recursive: true });
    await mkdir(join(root, "chapters"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "scripts"), { recursive: true });
    await writeFile(join(root, "research", "brief.md"), "brief body\n", "utf8");
    await writeFile(join(root, "research", "nested", "facts.csv"), "name,value\n", "utf8");
    await writeFile(join(root, "chapters", "ch_01.md"), "managed\n", "utf8");
    await writeFile(join(root, "project.json"), "{}\n", "utf8");
    await writeFile(join(root, ".git", "config"), "managed\n", "utf8");
    await writeFile(join(root, "scripts", "tool.ts"), "export {};\n", "utf8");

    const repository = createRepository(root);
    const tree = await repository.getTreeSnapshot();

    if (!tree.ok) throw new Error(tree.error.message);
    const paths = flatten(tree.value.nodes).map((node) => node.path);
    expect(tree.value).toMatchObject({
      schemaVersion: "1.0",
      ...identity,
      policyVersion: "1.0",
      truncated: false
    });
    expect(tree.value.dependencyManifestChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(tree.value.treeRevision).toMatch(/^tree:[a-f0-9]{64}$/u);
    expect(paths).toEqual(
      expect.arrayContaining(["research", "research/brief.md", "research/nested/facts.csv"])
    );
    expect(paths).not.toEqual(
      expect.arrayContaining([
        "chapters",
        "chapters/ch_01.md",
        "project.json",
        ".git",
        "scripts/tool.ts"
      ])
    );
    expect(JSON.stringify(tree.value)).not.toContain(root);
    expect(JSON.stringify(tree.value)).not.toContain("brief body");
    expect(flatten(tree.value.nodes).every((node) => node.nodeRevision.startsWith("node:"))).toBe(
      true
    );
  });

  test("uses expected tree, node, and checksum revisions while content saves preserve structure revision", async () => {
    const root = await createRoot();
    await writeFile(join(root, "notes.md"), "original\n", "utf8");
    const repository = createRepository(root);
    const tree = await repository.getTreeSnapshot();
    const original = await repository.readTextFile("notes.md");
    if (!tree.ok || !original.ok) throw new Error("Expected initial tree and document.");

    const saved = await repository.saveTextFile({
      ...identity,
      path: "notes.md",
      content: "saved\n",
      expectedTreeRevision: tree.value.treeRevision,
      expectedNodeRevision: original.value.nodeRevision,
      expectedChecksum: original.value.checksum
    });

    expect(saved).toMatchObject({
      ok: true,
      value: {
        kind: "saved",
        treeRevision: tree.value.treeRevision,
        document: { content: "saved\n" }
      }
    });
    if (!saved.ok || saved.value.kind !== "saved") throw new Error("Expected save.");
    expect(saved.value.document.nodeRevision).not.toBe(original.value.nodeRevision);
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("saved\n");

    await writeFile(join(root, "notes.md"), "external\n", "utf8");
    const external = await repository.readTextFile("notes.md");
    if (!external.ok) throw new Error(external.error.message);
    const checksumConflict = await repository.saveTextFile({
      ...identity,
      path: "notes.md",
      content: "draft\n",
      expectedTreeRevision: tree.value.treeRevision,
      expectedNodeRevision: external.value.nodeRevision,
      expectedChecksum: saved.value.document.checksum
    });
    expect(checksumConflict).toMatchObject({
      ok: true,
      value: { kind: "conflict", conflictKind: "checksum", current: { content: "external\n" } }
    });

    const nodeConflict = await repository.saveTextFile({
      ...identity,
      path: "notes.md",
      content: "draft\n",
      expectedTreeRevision: tree.value.treeRevision,
      expectedNodeRevision: saved.value.document.nodeRevision,
      expectedChecksum: saved.value.document.checksum
    });
    expect(nodeConflict).toMatchObject({
      ok: true,
      value: { kind: "conflict", conflictKind: "node_revision" }
    });

    await writeFile(join(root, "new.md"), "new\n", "utf8");
    const treeConflict = await repository.saveTextFile({
      ...identity,
      path: "notes.md",
      content: "draft\n",
      expectedTreeRevision: tree.value.treeRevision,
      expectedNodeRevision: external.value.nodeRevision,
      expectedChecksum: external.value.checksum
    });
    expect(treeConflict).toMatchObject({
      ok: true,
      value: { kind: "conflict", conflictKind: "tree_revision" }
    });
  });

  test("rejects managed, ignored, unsupported, lexical, device, symlink, invalid UTF-8, and oversized paths", async () => {
    const root = await createRoot();
    const outside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(root, "chapters"), { recursive: true });
    await writeFile(join(root, "chapters", "chapter.md"), "managed\n", "utf8");
    await writeFile(join(root, "draft.exe"), "unsupported\n", "utf8");
    await writeFile(join(root, "invalid.txt"), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, "large.txt"), "too large\n", "utf8");
    await writeFile(join(outside, "secret.md"), "outside\n", "utf8");
    await symlink(outside, join(root, "linked"), "junction");
    const repository = createRepository(root, { maxTextBytes: 8 });

    for (const path of [
      "../outside.md",
      "C:/outside.md",
      "chapters/chapter.md",
      "project.json",
      "draft.exe",
      "COM1.md",
      "linked/secret.md"
    ]) {
      expect(await repository.readTextFile(path)).toMatchObject({
        ok: false,
        error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
      });
    }
    expect(await repository.readTextFile("invalid.txt")).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_TEXT_READ_FAILED" }
    });
    expect(await repository.readTextFile("large.txt")).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_TOO_LARGE" }
    });

    const tree = await repository.getTreeSnapshot();
    if (!tree.ok) throw new Error(tree.error.message);
    const command = lifecycle({
      kind: "createTextFile",
      commandId: "create-managed",
      expectedTreeRevision: tree.value.treeRevision,
      path: "chapters/new.md",
      content: "nope\n"
    });
    expect(await repository.executeLifecycleCommand(command)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    const hiddenFileRename = lifecycle({
      kind: "renamePath",
      commandId: "rename-unsupported",
      expectedTreeRevision: tree.value.treeRevision,
      sourcePath: "draft.exe",
      targetPath: "draft.md",
      expectedSourceRevision: "node:unavailable"
    });
    expect(await repository.executeLifecycleCommand(hiddenFileRename)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await readFile(join(outside, "secret.md"), "utf8")).toBe("outside\n");
  });

  test("executes versioned lifecycle commands idempotently and rejects stale tree or node revisions", async () => {
    const root = await createRoot();
    const repository = createRepository(root);
    const initial = await repository.getTreeSnapshot();
    if (!initial.ok) throw new Error(initial.error.message);

    const createDirectory = lifecycle({
      kind: "createDirectory",
      commandId: "create-directory",
      expectedTreeRevision: initial.value.treeRevision,
      path: "notes"
    });
    const directoryReceipt = await repository.executeLifecycleCommand(createDirectory);
    expect(directoryReceipt).toMatchObject({
      ok: true,
      value: {
        commandId: "create-directory",
        commandKind: "createDirectory",
        affectedPaths: ["notes"]
      }
    });
    expect(await repository.executeLifecycleCommand(createDirectory)).toEqual(directoryReceipt);

    const afterDirectory = await repository.getTreeSnapshot();
    if (!afterDirectory.ok) throw new Error(afterDirectory.error.message);
    const staleCreate = lifecycle({
      kind: "createTextFile",
      commandId: "stale-create",
      expectedTreeRevision: initial.value.treeRevision,
      path: "notes/old.md",
      content: "stale\n"
    });
    expect(await repository.executeLifecycleCommand(staleCreate)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_TREE_REVISION_CONFLICT" }
    });

    const createFile = lifecycle({
      kind: "createTextFile",
      commandId: "create-file",
      expectedTreeRevision: afterDirectory.value.treeRevision,
      path: "notes/a.md",
      content: "a\n"
    });
    const createdFile = await repository.executeLifecycleCommand(createFile);
    expect(createdFile).toMatchObject({ ok: true });
    const afterCreate = await repository.getTreeSnapshot();
    if (!afterCreate.ok) throw new Error(afterCreate.error.message);
    const source = node(afterCreate.value.nodes, "notes/a.md");

    await writeFile(join(root, "notes", "a.md"), "external\n", "utf8");
    const staleNodeRename = lifecycle({
      kind: "renamePath",
      commandId: "rename-stale-node",
      expectedTreeRevision: afterCreate.value.treeRevision,
      sourcePath: "notes/a.md",
      targetPath: "notes/stale.md",
      expectedSourceRevision: source.nodeRevision
    });
    expect(await repository.executeLifecycleCommand(staleNodeRename)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_NODE_REVISION_CONFLICT" }
    });
    const afterExternalEdit = await repository.getTreeSnapshot();
    if (!afterExternalEdit.ok) throw new Error(afterExternalEdit.error.message);
    const currentSource = node(afterExternalEdit.value.nodes, "notes/a.md");
    expect(afterExternalEdit.value.treeRevision).toBe(afterCreate.value.treeRevision);

    const rename = lifecycle({
      kind: "renamePath",
      commandId: "rename-file",
      expectedTreeRevision: afterExternalEdit.value.treeRevision,
      sourcePath: "notes/a.md",
      targetPath: "notes/b.md",
      expectedSourceRevision: currentSource.nodeRevision
    });
    expect(await repository.executeLifecycleCommand(rename)).toMatchObject({
      ok: true,
      value: { affectedPaths: ["notes/a.md", "notes/b.md"] }
    });
    const afterRename = await repository.getTreeSnapshot();
    if (!afterRename.ok) throw new Error(afterRename.error.message);
    const target = node(afterRename.value.nodes, "notes/b.md");

    const deleteFile = lifecycle({
      kind: "deleteFile",
      commandId: "delete-file",
      expectedTreeRevision: afterRename.value.treeRevision,
      path: "notes/b.md",
      expectedSourceRevision: target.nodeRevision,
      confirmed: true
    });
    expect(await repository.executeLifecycleCommand(deleteFile)).toMatchObject({ ok: true });
    const afterDelete = await repository.getTreeSnapshot();
    if (!afterDelete.ok) throw new Error(afterDelete.error.message);
    const directory = node(afterDelete.value.nodes, "notes");
    const deleteDirectory = lifecycle({
      kind: "deleteEmptyDirectory",
      commandId: "delete-directory",
      expectedTreeRevision: afterDelete.value.treeRevision,
      path: "notes",
      expectedSourceRevision: directory.nodeRevision,
      confirmed: true
    });
    expect(await repository.executeLifecycleCommand(deleteDirectory)).toMatchObject({ ok: true });

    const duplicateIdWithChangedPayload = lifecycle({
      kind: "createDirectory",
      commandId: "create-directory",
      expectedTreeRevision: afterDelete.value.treeRevision,
      path: "different"
    });
    expect(await repository.executeLifecycleCommand(duplicateIdWithChangedPayload)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT" }
    });
  });

  test("replays a durable receipt before validating a now-stale lifecycle command", async () => {
    const root = await createRoot();
    const receipts = new Map<string, CreativeProjectFileLifecycleReceipt>();
    const receiptStore: CreativeProjectFileReceiptStore = {
      readReceipt: async (commandId) => ok(receipts.get(commandId)),
      writeReceipt: async (receipt) => {
        receipts.set(receipt.commandId, receipt);
        return ok(receipt);
      }
    };
    const firstRepository = new CreativeProjectFileRepository({
      projectRoot: root,
      ...identity,
      receiptStore
    });
    const tree = await firstRepository.getTreeSnapshot();
    if (!tree.ok) throw new Error(tree.error.message);
    const command = lifecycle({
      kind: "createDirectory",
      commandId: "durable-create-directory",
      expectedTreeRevision: tree.value.treeRevision,
      path: "notes"
    });
    const applied = await firstRepository.executeLifecycleCommand(command);
    if (!applied.ok) throw new Error(applied.error.message);

    const restoredRepository = new CreativeProjectFileRepository({
      projectRoot: root,
      ...identity,
      receiptStore
    });
    const replayed = await restoredRepository.executeLifecycleCommand(command);

    expect(replayed).toEqual(applied);
  });

  test("revalidates canonical parents immediately before create and rename side effects", async () => {
    const textRoot = await createRoot();
    const textOutside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(textRoot, "notes"));
    await writeFile(join(textOutside, "new.md"), "outside\n", "utf8");
    let textHooked = false;
    const textRepository = new CreativeProjectFileRepository({
      projectRoot: textRoot,
      ...identity,
      beforeFinalLifecycleValidation: async ({ kind }) => {
        if (kind !== "createTextFile" || textHooked) return;
        textHooked = true;
        await replaceDirectoryWithJunction(textRoot, "notes", textOutside);
      }
    });
    const textTree = await textRepository.getTreeSnapshot();
    if (!textTree.ok) throw new Error(textTree.error.message);

    const textCreate = lifecycle({
      kind: "createTextFile",
      commandId: "raced-create-text",
      expectedTreeRevision: textTree.value.treeRevision,
      path: "notes/new.md",
      content: "created\n"
    });
    expect(await textRepository.executeLifecycleCommand(textCreate)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await readFile(join(textOutside, "new.md"), "utf8")).toBe("outside\n");

    const directoryRoot = await createRoot();
    const directoryOutside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(directoryRoot, "notes"));
    let directoryHooked = false;
    const directoryRepository = new CreativeProjectFileRepository({
      projectRoot: directoryRoot,
      ...identity,
      beforeFinalLifecycleValidation: async ({ kind }) => {
        if (kind !== "createDirectory" || directoryHooked) return;
        directoryHooked = true;
        await replaceDirectoryWithJunction(directoryRoot, "notes", directoryOutside);
      }
    });
    const directoryTree = await directoryRepository.getTreeSnapshot();
    if (!directoryTree.ok) throw new Error(directoryTree.error.message);

    const directoryCreate = lifecycle({
      kind: "createDirectory",
      commandId: "raced-create-directory",
      expectedTreeRevision: directoryTree.value.treeRevision,
      path: "notes/new-directory"
    });
    expect(await directoryRepository.executeLifecycleCommand(directoryCreate)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await pathExists(join(directoryOutside, "new-directory"))).toBe(false);

    const renameRoot = await createRoot();
    const renameOutside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(renameRoot, "target"));
    await writeFile(join(renameRoot, "source.md"), "source\n", "utf8");
    await writeFile(join(renameOutside, "new.md"), "outside\n", "utf8");
    let renameHooked = false;
    const renameRepository = new CreativeProjectFileRepository({
      projectRoot: renameRoot,
      ...identity,
      beforeFinalLifecycleValidation: async ({ kind }) => {
        if (kind !== "renamePath" || renameHooked) return;
        renameHooked = true;
        await replaceDirectoryWithJunction(renameRoot, "target", renameOutside);
      }
    });
    const renameTree = await renameRepository.getTreeSnapshot();
    if (!renameTree.ok) throw new Error(renameTree.error.message);
    const source = node(renameTree.value.nodes, "source.md");

    const renameCommand = lifecycle({
      kind: "renamePath",
      commandId: "raced-rename",
      expectedTreeRevision: renameTree.value.treeRevision,
      sourcePath: "source.md",
      targetPath: "target/new.md",
      expectedSourceRevision: source.nodeRevision
    });
    expect(await renameRepository.executeLifecycleCommand(renameCommand)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await readFile(join(renameRoot, "source.md"), "utf8")).toBe("source\n");
    expect(await readFile(join(renameOutside, "new.md"), "utf8")).toBe("outside\n");
  });

  test("revalidates canonical paths immediately before file and directory deletion", async () => {
    const fileRoot = await createRoot();
    const fileOutside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(fileRoot, "notes"));
    await writeFile(join(fileRoot, "notes", "delete.md"), "inside\n", "utf8");
    await writeFile(join(fileOutside, "delete.md"), "outside\n", "utf8");
    let fileHooked = false;
    const fileRepository = new CreativeProjectFileRepository({
      projectRoot: fileRoot,
      ...identity,
      beforeFinalLifecycleValidation: async ({ kind }) => {
        if (kind !== "deleteFile" || fileHooked) return;
        fileHooked = true;
        await replaceDirectoryWithJunction(fileRoot, "notes", fileOutside);
      }
    });
    const fileTree = await fileRepository.getTreeSnapshot();
    if (!fileTree.ok) throw new Error(fileTree.error.message);
    const file = node(fileTree.value.nodes, "notes/delete.md");

    const deleteFile = lifecycle({
      kind: "deleteFile",
      commandId: "raced-delete-file",
      expectedTreeRevision: fileTree.value.treeRevision,
      path: "notes/delete.md",
      expectedSourceRevision: file.nodeRevision,
      confirmed: true
    });
    expect(await fileRepository.executeLifecycleCommand(deleteFile)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await readFile(join(fileOutside, "delete.md"), "utf8")).toBe("outside\n");

    const directoryRoot = await createRoot();
    const directoryOutside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(directoryRoot, "empty"));
    let directoryHooked = false;
    const directoryRepository = new CreativeProjectFileRepository({
      projectRoot: directoryRoot,
      ...identity,
      beforeFinalLifecycleValidation: async ({ kind }) => {
        if (kind !== "deleteEmptyDirectory" || directoryHooked) return;
        directoryHooked = true;
        await replaceDirectoryWithJunction(directoryRoot, "empty", directoryOutside);
      }
    });
    const directoryTree = await directoryRepository.getTreeSnapshot();
    if (!directoryTree.ok) throw new Error(directoryTree.error.message);
    const directory = node(directoryTree.value.nodes, "empty");

    const deleteDirectory = lifecycle({
      kind: "deleteEmptyDirectory",
      commandId: "raced-delete-directory",
      expectedTreeRevision: directoryTree.value.treeRevision,
      path: "empty",
      expectedSourceRevision: directory.nodeRevision,
      confirmed: true
    });
    expect(await directoryRepository.executeLifecycleCommand(deleteDirectory)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_PATH_REJECTED" }
    });
    expect(await pathExists(directoryOutside)).toBe(true);
  });

  test("does not hand a post-validation junction replacement to a hardened lifecycle port", async () => {
    const root = await createRoot();
    const outside = await createRoot("novel-studio-creative-outside-");
    await mkdir(join(root, "notes"));
    await writeFile(join(outside, "new.md"), "outside\n", "utf8");
    let nativeCalls = 0;
    const nativeOperations = recordingNativeOperations(() => {
      nativeCalls += 1;
    });
    let swapped = false;
    const repository = new CreativeProjectFileRepository({
      projectRoot: root,
      ...identity,
      noFollowNativeOperations: nativeOperations,
      beforeLifecycleMutation: async ({ kind }) => {
        if (kind !== "createTextFile" || swapped) return;
        swapped = true;
        await replaceDirectoryWithJunction(root, "notes", outside);
      }
    });
    const tree = await repository.getTreeSnapshot();
    if (!tree.ok) throw new Error(tree.error.message);

    const result = await repository.executeLifecycleCommand(
      lifecycle({
        kind: "createTextFile",
        commandId: "post-validation-junction",
        expectedTreeRevision: tree.value.treeRevision,
        path: "notes/new.md",
        content: "created\n"
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "NO_FOLLOW_SYMLINK_REJECTED" }
    });
    expect(nativeCalls).toBe(0);
    expect(await readFile(join(outside, "new.md"), "utf8")).toBe("outside\n");
  });

  test("does not hand a post-validation leaf symlink replacement to a hardened lifecycle port", async () => {
    const root = await createRoot();
    const outside = await createRoot("novel-studio-creative-outside-");
    const targetPath = join(root, "delete.md");
    const outsidePath = join(outside, "delete.md");
    await writeFile(targetPath, "inside\n", "utf8");
    await writeFile(outsidePath, "outside\n", "utf8");

    try {
      const probePath = join(root, "symlink-probe.md");
      await symlink(outsidePath, probePath, "file");
      await rm(probePath, { force: true });
    } catch {
      // File symlink creation can be unavailable in restricted Windows environments.
      return;
    }

    let nativeCalls = 0;
    let swapped = false;
    const repository = new CreativeProjectFileRepository({
      projectRoot: root,
      ...identity,
      noFollowNativeOperations: recordingNativeOperations(() => {
        nativeCalls += 1;
      }),
      beforeLifecycleMutation: async ({ kind }) => {
        if (kind !== "deleteFile" || swapped) return;
        swapped = true;
        await rm(targetPath, { force: true });
        await symlink(outsidePath, targetPath, "file");
      }
    });
    const tree = await repository.getTreeSnapshot();
    if (!tree.ok) throw new Error(tree.error.message);
    const target = node(tree.value.nodes, "delete.md");

    const result = await repository.executeLifecycleCommand(
      lifecycle({
        kind: "deleteFile",
        commandId: "post-validation-leaf-symlink",
        expectedTreeRevision: tree.value.treeRevision,
        path: "delete.md",
        expectedSourceRevision: target.nodeRevision,
        confirmed: true
      })
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "NO_FOLLOW_SYMLINK_REJECTED" }
    });
    expect(nativeCalls).toBe(0);
    expect(await readFile(outsidePath, "utf8")).toBe("outside\n");
  });

  test("refuses nonempty directory deletion and unsafe directory renames after bounded policy traversal", async () => {
    const root = await createRoot();
    await mkdir(join(root, "safe"), { recursive: true });
    await mkdir(join(root, "unsupported"), { recursive: true });
    await writeFile(join(root, "safe", "child.md"), "safe\n", "utf8");
    await writeFile(join(root, "unsupported", "tool.exe"), "not allowed\n", "utf8");
    const repository = createRepository(root);
    const tree = await repository.getTreeSnapshot();
    if (!tree.ok) throw new Error(tree.error.message);

    const safe = node(tree.value.nodes, "safe");
    const nonemptyDelete = lifecycle({
      kind: "deleteEmptyDirectory",
      commandId: "delete-safe",
      expectedTreeRevision: tree.value.treeRevision,
      path: "safe",
      expectedSourceRevision: safe.nodeRevision,
      confirmed: true
    });
    expect(await repository.executeLifecycleCommand(nonemptyDelete)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_DIRECTORY_NOT_EMPTY" }
    });

    const safeRename = lifecycle({
      kind: "renamePath",
      commandId: "rename-safe",
      expectedTreeRevision: tree.value.treeRevision,
      sourcePath: "safe",
      targetPath: "renamed",
      expectedSourceRevision: safe.nodeRevision
    });
    expect(await repository.executeLifecycleCommand(safeRename)).toMatchObject({ ok: true });
    expect(await readFile(join(root, "renamed", "child.md"), "utf8")).toBe("safe\n");

    const afterSafeRename = await repository.getTreeSnapshot();
    if (!afterSafeRename.ok) throw new Error(afterSafeRename.error.message);
    const unsupported = node(afterSafeRename.value.nodes, "unsupported");
    const unsafeRename = lifecycle({
      kind: "renamePath",
      commandId: "rename-unsupported",
      expectedTreeRevision: afterSafeRename.value.treeRevision,
      sourcePath: "unsupported",
      targetPath: "moved",
      expectedSourceRevision: unsupported.nodeRevision
    });
    expect(await repository.executeLifecycleCommand(unsafeRename)).toMatchObject({
      ok: false,
      error: { code: "CREATIVE_PROJECT_FILE_DIRECTORY_RENAME_REJECTED" }
    });
  });
});

function createRepository(root: string, limits: Partial<{ readonly maxTextBytes: number }> = {}) {
  return new CreativeProjectFileRepository({
    projectRoot: root,
    ...identity,
    policy: {
      ...DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
      ...limits
    }
  });
}

function recordingNativeOperations(onCall: () => void): NoFollowNativeFileOperationPort {
  return {
    async rename() {
      onCall();
      return ok(undefined);
    },
    async unlink() {
      onCall();
      return ok(undefined);
    },
    async mkdir() {
      onCall();
      return ok(undefined);
    },
    async rmdir() {
      onCall();
      return ok(undefined);
    },
    async writeFile() {
      onCall();
      return ok(undefined);
    }
  };
}

type LifecycleCommandInput = CreativeProjectFileLifecycleCommand extends infer Command
  ? Command extends unknown
    ? Omit<Command, keyof typeof identity | "schemaVersion">
    : never
  : never;

function lifecycle(command: LifecycleCommandInput): CreativeProjectFileLifecycleCommand {
  switch (command.kind) {
    case "createTextFile":
      return {
        schemaVersion: "1.0",
        ...identity,
        kind: command.kind,
        commandId: command.commandId,
        expectedTreeRevision: command.expectedTreeRevision,
        path: command.path,
        content: command.content
      };
    case "createDirectory":
      return {
        schemaVersion: "1.0",
        ...identity,
        kind: command.kind,
        commandId: command.commandId,
        expectedTreeRevision: command.expectedTreeRevision,
        path: command.path
      };
    case "renamePath":
      return {
        schemaVersion: "1.0",
        ...identity,
        kind: command.kind,
        commandId: command.commandId,
        expectedTreeRevision: command.expectedTreeRevision,
        sourcePath: command.sourcePath,
        targetPath: command.targetPath,
        expectedSourceRevision: command.expectedSourceRevision
      };
    case "deleteFile":
    case "deleteEmptyDirectory":
      return {
        schemaVersion: "1.0",
        ...identity,
        kind: command.kind,
        commandId: command.commandId,
        expectedTreeRevision: command.expectedTreeRevision,
        path: command.path,
        expectedSourceRevision: command.expectedSourceRevision,
        confirmed: true
      };
  }
}

function node(
  nodes: readonly CreativeProjectFileTreeNode[],
  path: string
): CreativeProjectFileTreeNode {
  const found = flatten(nodes).find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`Expected tree node: ${path}`);
  return found;
}

function flatten<T extends { readonly children?: readonly T[] }>(
  nodes: readonly T[]
): readonly T[] {
  return nodes.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

async function createRoot(prefix = "novel-studio-creative-root-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function replaceDirectoryWithJunction(
  root: string,
  relativePath: string,
  target: string
): Promise<void> {
  const source = join(root, relativePath);
  await rename(source, join(root, `.raced-${relativePath}`));
  await symlink(target, source, "junction");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function okPath(path: string) {
  return { ok: true, value: path };
}
