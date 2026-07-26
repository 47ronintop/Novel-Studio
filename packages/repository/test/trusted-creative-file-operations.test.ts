import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type {
  AgentWriteTrustedCreativeLifecycleMutation,
  AgentWriteTrustedCreativeReplaceMutation
} from "../src/agent-write-transaction.js";
import {
  createTrustedCreativeFileOperationsPort,
  type TrustedCreativeFileOperationsOptions,
  type TrustedCreativeFileSystem
} from "../src/trusted-creative-file-operations.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  );
});

describe("trusted creative file operations", () => {
  test("rejects a non-creative workspace at runtime", async () => {
    const projectRoot = await temporaryRoot("engineering-workspace");
    const relativePath = "notes.txt";
    const original = "Original.\n";
    const candidate = "Candidate.\n";
    await writeFile(join(projectRoot, relativePath), original, "utf8");
    const port = createTrustedCreativeFileOperationsPort({
      workspaceKind: "engineeringWorkspace",
      projectRoot
    } as unknown as TrustedCreativeFileOperationsOptions);

    const result = await port.replace(replaceMutation(relativePath, original, candidate));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_WORKSPACE_KIND_REJECTED" }
    });
    expect(await readFile(join(projectRoot, relativePath), "utf8")).toBe(original);
  });

  test("rejects a project-relative escape without touching the outside file", async () => {
    const projectRoot = await temporaryRoot("escape-project");
    const outsideRoot = await temporaryRoot("escape-outside");
    const outsidePath = join(outsideRoot, "outside.txt");
    const original = "Outside original.\n";
    const candidate = "Must not escape.\n";
    await writeFile(outsidePath, original, "utf8");
    const port = createPort(projectRoot);

    const result = await port.replace(
      replaceMutation(`../${basename(outsideRoot)}/outside.txt`, original, candidate)
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_PATH_REJECTED" }
    });
    expect(await readFile(outsidePath, "utf8")).toBe(original);
  });

  test("requires a before file snapshot and cannot turn replace into create", async () => {
    const projectRoot = await temporaryRoot("missing-before");
    const relativePath = "notes.txt";
    const candidate = "New notes.\n";
    const port = createPort(projectRoot);

    const result = await port.replace({
      kind: "replace_file",
      phase: "apply",
      relativePath,
      content: candidate,
      before: [],
      after: [fileSnapshot(relativePath, candidate)]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_SNAPSHOT_INVALID" }
    });
    await expect(readFile(join(projectRoot, relativePath), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  test("rejects a symlink or junction project root", async () => {
    const container = await temporaryRoot("linked-root-container");
    const actualRoot = await temporaryRoot("linked-root-target");
    const relativePath = "notes.txt";
    const original = "Original.\n";
    const candidate = "Candidate.\n";
    await writeFile(join(actualRoot, relativePath), original, "utf8");
    const linkedRoot = join(container, "creative-project");
    await directorySymlink(actualRoot, linkedRoot);
    const port = createPort(linkedRoot);

    const result = await port.replace(replaceMutation(relativePath, original, candidate));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_ROOT_REJECTED" }
    });
    expect(await readFile(join(actualRoot, relativePath), "utf8")).toBe(original);
  });

  test("rejects a symlink or junction in a parent path segment", async () => {
    const projectRoot = await temporaryRoot("linked-parent-project");
    const outsideRoot = await temporaryRoot("linked-parent-outside");
    const original = "Outside original.\n";
    const candidate = "Must not escape.\n";
    await writeFile(join(outsideRoot, "scene.txt"), original, "utf8");
    await directorySymlink(outsideRoot, join(projectRoot, "notes"));
    const port = createPort(projectRoot);

    const result = await port.replace(replaceMutation("notes/scene.txt", original, candidate));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_REPARSE_REJECTED" }
    });
    expect(await readFile(join(outsideRoot, "scene.txt"), "utf8")).toBe(original);
  });

  test("fails closed when the existing target no longer matches the approved checksum", async () => {
    const projectRoot = await temporaryRoot("checksum-conflict");
    const relativePath = "notes.txt";
    const approvedBase = "Approved base.\n";
    const userEdit = "Concurrent user edit.\n";
    const candidate = "Agent candidate.\n";
    await writeFile(join(projectRoot, relativePath), userEdit, "utf8");
    const port = createPort(projectRoot);

    const result = await port.replace(replaceMutation(relativePath, approvedBase, candidate));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_BASE_CONFLICT" }
    });
    expect(await readFile(join(projectRoot, relativePath), "utf8")).toBe(userEdit);
  });

  test("flushes and closes before same-directory rename, then supports undo", async () => {
    const projectRoot = await temporaryRoot("apply-undo");
    const relativePath = "chapters/chapter-01.md";
    const targetPath = join(projectRoot, "chapters", "chapter-01.md");
    const original = "Original chapter.\n";
    const candidate = "Revised chapter.\n";
    await mkdir(join(projectRoot, "chapters"), { recursive: true });
    await writeFile(targetPath, original, "utf8");
    const events: string[] = [];
    const fileSystem = recordingFileSystem(events);
    const port = createPort(projectRoot, fileSystem);

    const applied = await port.replace(replaceMutation(relativePath, original, candidate));
    const undone = await port.replace(replaceMutation(relativePath, candidate, original, "undo"));

    expect(applied).toEqual({ ok: true, value: undefined });
    expect(undone).toEqual({ ok: true, value: undefined });
    expect(await readFile(targetPath, "utf8")).toBe(original);
    expect(events).toEqual([
      "write",
      "sync",
      "close",
      "rename",
      "write",
      "sync",
      "close",
      "rename"
    ]);
  });

  test("detects a target that does not match the approved postcondition", async () => {
    const projectRoot = await temporaryRoot("postcondition");
    const relativePath = "notes.txt";
    const targetPath = join(projectRoot, relativePath);
    const original = "Original.\n";
    const candidate = "Candidate.\n";
    const tampered = "Tampered after rename.\n";
    await writeFile(targetPath, original, "utf8");
    const fileSystem = recordingFileSystem([], async (_oldPath, newPath) => {
      await writeFile(newPath, tampered, "utf8");
    });
    const port = createPort(projectRoot, fileSystem);

    const result = await port.replace(replaceMutation(relativePath, original, candidate));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_POSTCONDITION_FAILED" }
    });
    expect(await readFile(targetPath, "utf8")).toBe(tampered);
  });

  test("creates, moves, deletes, and removes creative paths with verified snapshots", async () => {
    const projectRoot = await temporaryRoot("lifecycle");
    const port = createPort(projectRoot);
    if (port.mutate === undefined) throw new Error("Expected lifecycle support.");

    expect(
      await port.mutate(directoryMutation("create_directory", "drafts", "missing", "directory"))
    ).toEqual({ ok: true, value: undefined });
    expect(await port.mutate(createFileMutation("drafts/new.md", "New draft.\n"))).toEqual({
      ok: true,
      value: undefined
    });
    expect(
      await port.mutate(moveFileMutation("drafts/new.md", "drafts/moved.md", "New draft.\n"))
    ).toEqual({ ok: true, value: undefined });
    expect(await readFile(join(projectRoot, "drafts/moved.md"), "utf8")).toBe("New draft.\n");

    expect(await port.mutate(deleteFileMutation("drafts/moved.md", "New draft.\n"))).toEqual({
      ok: true,
      value: undefined
    });
    expect(
      await port.mutate(directoryMutation("remove_directory", "drafts", "directory", "missing"))
    ).toEqual({ ok: true, value: undefined });
    await expect(lstat(join(projectRoot, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test.each([
    "../outside.md",
    "/outside.md",
    ".git/config.md",
    "CON.md",
    "notes/a.md:stream",
    "notes\\outside.md",
    "C:/outside.md"
  ])("rejects unsafe lifecycle path %s", async (relativePath) => {
    const projectRoot = await temporaryRoot("unsafe-lifecycle");
    const port = createPort(projectRoot);
    if (port.mutate === undefined) throw new Error("Expected lifecycle support.");

    const result = await port.mutate(createFileMutation(relativePath, "blocked"));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_PATH_REJECTED" }
    });
  });

  test("rejects a lifecycle mutation through a symlink or junction parent", async () => {
    const projectRoot = await temporaryRoot("lifecycle-linked-project");
    const outsideRoot = await temporaryRoot("lifecycle-linked-outside");
    await directorySymlink(outsideRoot, join(projectRoot, "drafts"));
    const port = createPort(projectRoot);
    if (port.mutate === undefined) throw new Error("Expected lifecycle support.");

    const result = await port.mutate(createFileMutation("drafts/new.md", "blocked"));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "TRUSTED_CREATIVE_REPARSE_REJECTED" }
    });
    await expect(readFile(join(outsideRoot, "new.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `novel-studio-trusted-${label}-`));
  roots.push(root);
  return root;
}

function createPort(projectRoot: string, fileSystem?: TrustedCreativeFileSystem) {
  return createTrustedCreativeFileOperationsPort({
    workspaceKind: "creativeProject",
    projectRoot,
    ...(fileSystem === undefined ? {} : { fileSystem })
  });
}

function replaceMutation(
  relativePath: string,
  before: string,
  after: string,
  phase: AgentWriteTrustedCreativeReplaceMutation["phase"] = "apply"
): AgentWriteTrustedCreativeReplaceMutation {
  return {
    kind: "replace_file",
    phase,
    relativePath,
    content: after,
    before: [fileSnapshot(relativePath, before)],
    after: [fileSnapshot(relativePath, after)]
  };
}

function createFileMutation(
  relativePath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "create_file",
    relativePath,
    content,
    before: [missingSnapshot(relativePath)],
    after: [fileSnapshot(relativePath, content)]
  };
}

function moveFileMutation(
  sourcePath: string,
  targetPath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "move_file",
    sourcePath,
    targetPath,
    before: [fileSnapshot(sourcePath, content), missingSnapshot(targetPath)],
    after: [missingSnapshot(sourcePath), fileSnapshot(targetPath, content)]
  };
}

function deleteFileMutation(
  relativePath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "delete_file",
    relativePath,
    before: [fileSnapshot(relativePath, content)],
    after: [missingSnapshot(relativePath)]
  };
}

function directoryMutation(
  kind: "create_directory" | "remove_directory",
  relativePath: string,
  before: "missing" | "directory",
  after: "missing" | "directory"
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind,
    relativePath,
    before: [{ kind: before, relativePath }],
    after: [{ kind: after, relativePath }]
  };
}

function missingSnapshot(relativePath: string) {
  return { kind: "missing" as const, relativePath };
}

function fileSnapshot(relativePath: string, content: string) {
  return {
    kind: "file" as const,
    relativePath,
    content,
    checksum: checksum(content)
  };
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function recordingFileSystem(
  events: string[],
  afterRename?: (oldPath: string, newPath: string) => Promise<void>
): TrustedCreativeFileSystem {
  return {
    lstat: (path) => lstat(path),
    realpath: (path) => realpath(path),
    readFile: (path, encoding) => readFile(path, encoding),
    async open(path, flags) {
      const handle = await open(path, flags);
      return {
        async writeFile(content, encoding) {
          events.push("write");
          await handle.writeFile(content, encoding);
        },
        async sync() {
          events.push("sync");
          await handle.sync();
        },
        async close() {
          events.push("close");
          await handle.close();
        }
      };
    },
    async rename(oldPath, newPath) {
      events.push("rename");
      await rename(oldPath, newPath);
      await afterRename?.(oldPath, newPath);
    },
    async rm(path) {
      await rm(path, { force: true });
    }
  };
}

async function directorySymlink(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}
