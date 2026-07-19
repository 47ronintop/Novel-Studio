import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createUnifiedError, err, isErr, isOk } from "@novel-studio/shared";

import { ProjectCreationFileRepository } from "../src/project-creation-repository.js";
import { ProjectFileRepository } from "../src/project-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("project creation repository", () => {
  test("creates exactly one child project and keeps its title independent from the folder", async () => {
    const parentDirectory = await createTempRoot();
    const folderName = "\u957f\u5b89\u65e7\u68a6";
    const title = "\u957f\u5b89\u65e7\u68a6\uff1a\u7b2c\u4e00\u90e8";
    const canonicalParent = await realpath(parentDirectory);
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z"
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName,
      projectId: "prj_changan",
      title,
      language: "zh-CN"
    });

    expect(isOk(created)).toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }
    expect(created.value).toMatchObject({
      projectRoot: join(canonicalParent, folderName),
      snapshot: {
        project: {
          projectId: "prj_changan",
          title
        }
      }
    });
    expect(await readdir(parentDirectory)).toEqual([folderName]);
    await expect(pathExists(join(parentDirectory, "project.json"))).resolves.toBe(false);
    await expect(pathExists(join(parentDirectory, folderName, "project.json"))).resolves.toBe(true);
  });

  test("previews the canonical child path without writing to the parent", async () => {
    const parentDirectory = await createTempRoot();
    const canonicalParent = await realpath(parentDirectory);
    await mkdir(join(parentDirectory, "existing-sibling"));
    const repository = new ProjectCreationFileRepository();

    const preview = await repository.previewProjectInParent({
      parentDirectory,
      folderName: "new-project"
    });

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }
    expect(preview.value).toEqual({
      parentDirectory: canonicalParent,
      folderName: "new-project",
      projectRoot: join(canonicalParent, "new-project"),
      parentDisplayName: basename(canonicalParent),
      targetDisplayName: "new-project"
    });
    expect(await readdir(parentDirectory)).toEqual(["existing-sibling"]);
  });

  test.each([
    "",
    " ",
    " leading",
    "trailing ",
    ".",
    "..",
    "bad/name",
    "bad\\name",
    "CON",
    "con.txt",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "LPT9.backup",
    "bad\u0001name",
    "tail.",
    "\uff23\uff2f\uff2e",
    "fullwidth\uff0fslash"
  ])("rejects unsafe child folder name %j", async (folderName) => {
    const parentDirectory = await createTempRoot();
    const repository = new ProjectCreationFileRepository();

    const preview = await repository.previewProjectInParent({ parentDirectory, folderName });
    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName,
      projectId: "prj_invalid",
      title: "Invalid",
      language: "en"
    });

    expect(isErr(preview)).toBe(true);
    expect(isErr(created)).toBe(true);
    if (isErr(created)) {
      expect(created.error.code).toBe("PROJECT_CREATE_FOLDER_NAME_INVALID");
    }
    expect(await readdir(parentDirectory)).toEqual([]);
  });

  test.each(["file", "directory"] as const)("rejects an existing target %s", async (targetKind) => {
    const parentDirectory = await createTempRoot();
    const targetRoot = join(parentDirectory, "existing-project");
    if (targetKind === "file") {
      await writeFile(targetRoot, "sentinel", "utf8");
    } else {
      await mkdir(targetRoot);
    }
    const repository = new ProjectCreationFileRepository();

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "existing-project",
      projectId: "prj_existing",
      title: "Existing",
      language: "en"
    });

    expect(isErr(created)).toBe(true);
    if (isErr(created)) {
      expect(created.error.code).toBe("PROJECT_CREATE_TARGET_EXISTS");
    }
    await expect(pathExists(targetRoot)).resolves.toBe(true);
  });

  test.each(["missing", "file"] as const)(
    "rejects a parent path that is a %s",
    async (parentKind) => {
      const root = await createTempRoot();
      const parentDirectory = join(root, "parent");
      if (parentKind === "file") {
        await writeFile(parentDirectory, "not a directory", "utf8");
      }
      const repository = new ProjectCreationFileRepository();

      const created = await repository.createProjectInParent({
        parentDirectory,
        folderName: "child",
        projectId: "prj_parent_invalid",
        title: "Parent Invalid",
        language: "en"
      });

      expect(isErr(created)).toBe(true);
      if (isErr(created)) {
        expect(created.error.code).toBe("PROJECT_CREATE_PARENT_INVALID");
      }
    }
  );

  test("removes only the new child when project initialization fails", async () => {
    const parentDirectory = await createTempRoot();
    const sibling = join(parentDirectory, "keep-me");
    await mkdir(sibling);
    await writeFile(join(sibling, "sentinel.txt"), "keep", "utf8");
    const repository = new ProjectCreationFileRepository({
      now: () => "not-an-iso-timestamp"
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "failed-project",
      projectId: "prj_failed",
      title: "Failed",
      language: "en"
    });

    expect(isErr(created)).toBe(true);
    await expect(pathExists(join(parentDirectory, "failed-project"))).resolves.toBe(false);
    await expect(pathExists(join(sibling, "sentinel.txt"))).resolves.toBe(true);
    expect(await readdir(parentDirectory)).toEqual(["keep-me"]);
  });

  test("cleans up only project roots created by the same repository instance", async () => {
    const parentDirectory = await createTempRoot();
    const sibling = join(parentDirectory, "sibling");
    await mkdir(sibling);
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z"
    });
    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "created-project",
      projectId: "prj_cleanup",
      title: "Cleanup",
      language: "en"
    });
    expect(isOk(created)).toBe(true);

    const rejected = await repository.cleanupCreatedProject(sibling);

    expect(isErr(rejected)).toBe(true);
    await expect(pathExists(sibling)).resolves.toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }

    const cleaned = await repository.cleanupCreatedProject(created.value.projectRoot);

    expect(isOk(cleaned)).toBe(true);
    await expect(pathExists(created.value.projectRoot)).resolves.toBe(false);
    await expect(pathExists(sibling)).resolves.toBe(true);
  });

  test("refuses cleanup when the created child path has been replaced", async () => {
    const parentDirectory = await createTempRoot();
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z"
    });
    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "owned-project",
      projectId: "prj_owned",
      title: "Owned",
      language: "en"
    });
    expect(isOk(created)).toBe(true);
    if (isErr(created)) {
      throw new Error(created.error.message);
    }
    const movedRoot = join(parentDirectory, "moved-owned-project");
    await rename(created.value.projectRoot, movedRoot);
    await mkdir(created.value.projectRoot);
    const replacementSentinel = join(created.value.projectRoot, "replacement.txt");
    await writeFile(replacementSentinel, "do not delete", "utf8");

    const cleaned = await repository.cleanupCreatedProject(created.value.projectRoot);

    expect(isErr(cleaned)).toBe(true);
    if (isErr(cleaned)) {
      expect(cleaned.error.code).toBe("PROJECT_CREATE_CLEANUP_REJECTED");
    }
    await expect(pathExists(replacementSentinel)).resolves.toBe(true);
    await expect(pathExists(join(movedRoot, "project.json"))).resolves.toBe(true);
  });

  test("does not initialize through a junction that replaces the captured child directory", async () => {
    const parentDirectory = await createTempRoot();
    const outsideRoot = await createTempRoot();
    const targetRoot = join(parentDirectory, "junction-project");
    const movedRoot = join(parentDirectory, "captured-project");
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z",
      createProjectRepository(options) {
        const delegate = new ProjectFileRepository(options);
        return {
          async createProject(input) {
            await rename(targetRoot, movedRoot);
            await symlink(outsideRoot, targetRoot, "junction");
            return delegate.createProject(input);
          }
        };
      }
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "junction-project",
      projectId: "prj_junction",
      title: "Junction",
      language: "en"
    });

    expect(isErr(created)).toBe(true);
    await expect(pathExists(join(outsideRoot, "project.json"))).resolves.toBe(false);
    await expect(pathExists(join(movedRoot, "project.json"))).resolves.toBe(false);
  });

  test("revalidates the parent identity immediately before creating the child", async () => {
    const container = await createTempRoot();
    const parentDirectory = join(container, "parent");
    const movedParent = join(container, "moved-parent");
    const outsideRoot = await createTempRoot();
    await mkdir(parentDirectory);
    const canonicalParent = await realpath(parentDirectory);
    const targetRoot = join(canonicalParent, "parent-race-project");
    let swapped = false;
    const lstatWithParentSwap = (async (
      path: Parameters<typeof lstat>[0],
      options?: Parameters<typeof lstat>[1]
    ) => {
      try {
        return await lstat(path, options);
      } catch (error) {
        if (path === targetRoot && !swapped) {
          swapped = true;
          await rename(canonicalParent, movedParent);
          await symlink(outsideRoot, canonicalParent, "junction");
        }
        throw error;
      }
    }) as typeof lstat;
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z",
      fileSystem: {
        lstat: lstatWithParentSwap,
        mkdir,
        realpath,
        rename,
        rm
      }
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "parent-race-project",
      projectId: "prj_parent_race",
      title: "Parent Race",
      language: "en"
    });

    expect(created).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CREATE_TARGET_CHANGED" }
    });
    await expect(pathExists(join(outsideRoot, "parent-race-project"))).resolves.toBe(false);
  });

  test("rejects a redirected managed directory before project initialization", async () => {
    const parentDirectory = await createTempRoot();
    const outsideRoot = await createTempRoot();
    const targetRoot = join(parentDirectory, "redirected-directory-project");
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z",
      createProjectRepository(options) {
        const delegate = new ProjectFileRepository(options);
        return {
          async createProject(input) {
            await symlink(outsideRoot, join(targetRoot, "chapters"), "junction");
            return delegate.createProject(input);
          }
        };
      }
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "redirected-directory-project",
      projectId: "prj_redirected_directory",
      title: "Redirected Directory",
      language: "en"
    });

    expect(created).toMatchObject({
      ok: false,
      error: { code: "PROJECT_STORAGE_PATH_REJECTED" }
    });
    await expect(pathExists(join(outsideRoot, "project.json"))).resolves.toBe(false);
    await expect(pathExists(join(targetRoot, "project.json"))).resolves.toBe(false);
  });

  test("does not delete a replacement moved into cleanup quarantine", async () => {
    const parentDirectory = await createTempRoot();
    const movedRoot = join(parentDirectory, "cleanup-race-owned");
    const ownedRoot = join(await realpath(parentDirectory), "cleanup-race");
    let replacementSentinel: string | undefined;
    let swapped = false;
    const swapTarget = async (targetRoot: string) => {
      if (swapped) return;
      swapped = true;
      await rename(targetRoot, movedRoot);
      await mkdir(targetRoot);
      replacementSentinel = join(targetRoot, "replacement.txt");
      await writeFile(replacementSentinel, "do not delete", "utf8");
    };
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z",
      fileSystem: {
        lstat,
        mkdir,
        realpath,
        async rename(source, destination) {
          if (source === ownedRoot) await swapTarget(source);
          await rename(source, destination);
        },
        async rm(path, options) {
          if (path === ownedRoot) await swapTarget(path);
          await rm(path, options);
        }
      }
    });
    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "cleanup-race",
      projectId: "prj_cleanup_race",
      title: "Cleanup Race",
      language: "en"
    });
    if (!created.ok) throw new Error(created.error.message);

    const cleaned = await repository.cleanupCreatedProject(created.value.projectRoot);

    expect(cleaned).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CREATE_CLEANUP_REJECTED" }
    });
    if (replacementSentinel === undefined) throw new Error("replacement was not installed");
    await expect(pathExists(replacementSentinel)).resolves.toBe(true);
    await expect(pathExists(join(movedRoot, "project.json"))).resolves.toBe(true);
  });

  test("does not restore a quarantined replacement over a newly occupied project path", async () => {
    const parentDirectory = await createTempRoot();
    const movedOwnedRoot = join(parentDirectory, "moved-owned-project");
    const ownedRoot = join(await realpath(parentDirectory), "restore-race");
    let quarantineRoot: string | undefined;
    let concurrentSentinel: string | undefined;
    let restoreAttempted = false;
    const lstatWithConcurrentTarget = (async (
      path: Parameters<typeof lstat>[0],
      options?: Parameters<typeof lstat>[1]
    ) => {
      const stats = await lstat(path, options);
      if (path === quarantineRoot && concurrentSentinel === undefined) {
        await mkdir(ownedRoot);
        concurrentSentinel = join(ownedRoot, "concurrent.txt");
        await writeFile(concurrentSentinel, "do not replace", "utf8");
      }
      return stats;
    }) as typeof lstat;
    const repository = new ProjectCreationFileRepository({
      now: () => "2026-07-19T00:00:00.000Z",
      fileSystem: {
        lstat: lstatWithConcurrentTarget,
        mkdir,
        realpath,
        async rename(source, destination) {
          if (
            source === ownedRoot &&
            typeof destination === "string" &&
            quarantineRoot === undefined
          ) {
            quarantineRoot = destination;
            await rename(source, movedOwnedRoot);
            await mkdir(source);
            await writeFile(join(source, "replacement.txt"), "replacement", "utf8");
          } else if (source === quarantineRoot && destination === ownedRoot) {
            restoreAttempted = true;
            throw new Error("unsafe restore attempted");
          }
          await rename(source, destination);
        },
        rm
      }
    });
    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "restore-race",
      projectId: "prj_restore_race",
      title: "Restore Race",
      language: "en"
    });
    if (!created.ok) throw new Error(created.error.message);

    const cleaned = await repository.cleanupCreatedProject(created.value.projectRoot);

    expect(cleaned).toMatchObject({
      ok: false,
      error: { code: "PROJECT_CREATE_CLEANUP_REJECTED" }
    });
    expect(restoreAttempted).toBe(false);
    if (concurrentSentinel === undefined) throw new Error("concurrent target was not installed");
    await expect(pathExists(concurrentSentinel)).resolves.toBe(true);
    await expect(pathExists(join(movedOwnedRoot, "project.json"))).resolves.toBe(true);
  });

  test("reports cleanup failure when initialization fails and the child cannot be removed", async () => {
    const parentDirectory = await createTempRoot();
    const primaryFailure = createUnifiedError({
      code: "TEST_PROJECT_INITIALIZATION_FAILED",
      category: "StorageError",
      message: "Initialization failed.",
      recoverability: "retryable",
      suggestedAction: "Retry initialization.",
      traceId: "test-project-initialization"
    });
    const repository = new ProjectCreationFileRepository({
      createProjectRepository: () => ({
        createProject: async () => err(primaryFailure)
      }),
      fileSystem: {
        lstat,
        mkdir,
        realpath,
        rename,
        async rm() {
          throw new Error("cleanup denied");
        }
      }
    });

    const created = await repository.createProjectInParent({
      parentDirectory,
      folderName: "cleanup-failure",
      projectId: "prj_cleanup_failure",
      title: "Cleanup Failure",
      language: "en"
    });

    expect(created).toMatchObject({
      ok: false,
      error: {
        code: "PROJECT_CREATE_CLEANUP_FAILED",
        redactedDetail: {
          primaryErrorCode: "TEST_PROJECT_INITIALIZATION_FAILED"
        }
      }
    });
    await expect(pathExists(join(parentDirectory, "cleanup-failure"))).resolves.toBe(false);
    const quarantineEntry = (await readdir(parentDirectory)).find((entry) =>
      entry.startsWith(".cleanup-failure.cleanup-")
    );
    expect(quarantineEntry).toBeDefined();
    if (quarantineEntry === undefined) throw new Error("cleanup quarantine was not preserved");
    await expect(pathExists(join(parentDirectory, quarantineEntry))).resolves.toBe(true);
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-project-create-"));
  tempRoots.push(root);
  return root;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
