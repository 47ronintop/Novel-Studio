import { access, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { ProjectCreationFileRepository } from "../src/project-creation-repository.js";

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
