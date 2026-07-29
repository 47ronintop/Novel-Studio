import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { ProjectConventionsCreateResult } from "@novel-studio/application";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopProjectConventionsCreateInput {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectRoot: string;
  /** Test seam: runs after the initial parent check and before the final check. */
  readonly beforeFinalPathValidation?: () => Promise<void>;
}

interface BoundParent {
  readonly canonicalPath: string;
  readonly device: number;
  readonly inode: number;
}

const FILES = {
  creativeProject: {
    relativePath: "conventions/writing.md" as const,
    initialContent: "# Writing conventions\n\n"
  },
  engineeringWorkspace: {
    relativePath: "AGENTS.md" as const,
    initialContent: "# Project conventions\n\n"
  }
};

/**
 * Main-owned fixed-path creation. No renderer-provided path participates in this operation.
 *
 * Node does not expose a portable openat-style API for directory-handle-relative creation.
 * This operation therefore verifies the parent identity immediately before opening and
 * verifies the opened file identity before writing. It rejects detectable same-user
 * symlink/junction substitution, but cannot claim atomic resistance to a replacement in the
 * remaining OS pathname window.
 */
export async function createDesktopProjectConventionsFile(
  input: DesktopProjectConventionsCreateInput
): Promise<Result<ProjectConventionsCreateResult, UnifiedError>> {
  const definition = FILES[input.workspaceKind];
  try {
    const rootStats = await lstat(input.projectRoot);
    const canonicalRoot = await realpath(input.projectRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
    }

    const parentPath =
      input.workspaceKind === "creativeProject"
        ? join(canonicalRoot, "conventions")
        : canonicalRoot;
    if (input.workspaceKind === "creativeProject") {
      try {
        await mkdir(parentPath);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) return err(fileError("PROJECT_CONVENTIONS_CREATE_FAILED"));
      }
    }

    const initialParent = await bindParent(canonicalRoot, parentPath);
    if (initialParent === undefined) return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
    await input.beforeFinalPathValidation?.();
    const parent = await verifyBoundParent(canonicalRoot, parentPath, initialParent);
    if (parent === undefined) return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));

    const targetPath = join(parent.canonicalPath, definition.relativePath.split("/").at(-1) ?? "");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
      handle = await open(
        targetPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        0o600
      );
      const openedStats = await handle.stat();
      if (!hasVerifiedFileIdentity(openedStats)) {
        return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
      }
      const parentBeforeWrite = await verifyBoundParent(canonicalRoot, parentPath, parent);
      if (
        parentBeforeWrite === undefined ||
        !(await verifyTarget(canonicalRoot, parentBeforeWrite, targetPath, openedStats))
      ) {
        return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
      }

      await handle.writeFile(definition.initialContent, "utf8");
      await handle.sync();

      const writtenStats = await handle.stat();
      const parentAfterWrite = await verifyBoundParent(canonicalRoot, parentPath, parent);
      if (
        !hasSameFileIdentity(openedStats, writtenStats) ||
        parentAfterWrite === undefined ||
        !(await verifyTarget(canonicalRoot, parentAfterWrite, targetPath, writtenStats))
      ) {
        return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
      }
    } catch (error) {
      if (!hasCode(error, "EEXIST")) return err(fileError("PROJECT_CONVENTIONS_CREATE_FAILED"));
      const parentForExisting = await verifyBoundParent(canonicalRoot, parentPath, parent);
      if (
        parentForExisting === undefined ||
        !(await verifyExistingTarget(canonicalRoot, parentForExisting, targetPath))
      ) {
        return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
      }
      return ok({ relativePath: definition.relativePath, status: "existing" });
    } finally {
      await handle?.close();
    }

    return ok({ relativePath: definition.relativePath, status: "created" });
  } catch {
    return err(fileError("PROJECT_CONVENTIONS_CREATE_FAILED"));
  }
}

async function bindParent(root: string, parentPath: string): Promise<BoundParent | undefined> {
  const [canonicalPath, stats] = await Promise.all([realpath(parentPath), lstat(parentPath)]);
  if (!stats.isDirectory() || stats.isSymbolicLink() || !isContainedPath(root, canonicalPath)) {
    return undefined;
  }
  return { canonicalPath, device: stats.dev, inode: stats.ino };
}

async function verifyBoundParent(
  root: string,
  parentPath: string,
  expected: BoundParent
): Promise<BoundParent | undefined> {
  const current = await bindParent(root, parentPath);
  return current !== undefined &&
    current.device === expected.device &&
    current.inode === expected.inode &&
    samePath(current.canonicalPath, expected.canonicalPath)
    ? current
    : undefined;
}

async function verifyTarget(
  root: string,
  parent: BoundParent,
  targetPath: string,
  openedStats: Stats
): Promise<boolean> {
  try {
    const [pathStats, canonicalTarget] = await Promise.all([
      lstat(targetPath),
      realpath(targetPath)
    ]);
    return (
      hasSameFileIdentity(openedStats, pathStats) &&
      isContainedPath(root, canonicalTarget) &&
      samePath(
        join(parent.canonicalPath, canonicalTarget.split(/[\\/]/u).at(-1) ?? ""),
        canonicalTarget
      )
    );
  } catch {
    return false;
  }
}

async function verifyExistingTarget(
  root: string,
  parent: BoundParent,
  targetPath: string
): Promise<boolean> {
  try {
    const [stats, canonicalTarget] = await Promise.all([lstat(targetPath), realpath(targetPath)]);
    return (
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      isContainedPath(root, canonicalTarget) &&
      samePath(
        join(parent.canonicalPath, canonicalTarget.split(/[\\/]/u).at(-1) ?? ""),
        canonicalTarget
      )
    );
  } catch {
    return false;
  }
}

function hasVerifiedFileIdentity(stats: Stats): boolean {
  return stats.dev !== 0 && stats.ino !== 0 && stats.isFile();
}

function hasSameFileIdentity(left: Stats, right: Stats): boolean {
  return (
    hasVerifiedFileIdentity(left) &&
    hasVerifiedFileIdentity(right) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function hasCode(value: unknown, code: string): value is NodeJS.ErrnoException {
  return (
    typeof value === "object" && value !== null && (value as NodeJS.ErrnoException).code === code
  );
}

function fileError(
  code: "PROJECT_CONVENTIONS_CREATE_FAILED" | "PROJECT_CONVENTIONS_PATH_REJECTED"
): UnifiedError {
  return createUnifiedError({
    code,
    category: code === "PROJECT_CONVENTIONS_PATH_REJECTED" ? "ValidationError" : "StorageError",
    message:
      code === "PROJECT_CONVENTIONS_PATH_REJECTED"
        ? "The fixed project conventions path is not a regular workspace path."
        : "The project conventions file could not be created.",
    recoverability: "user-action",
    suggestedAction: "Review the workspace path and retry creating the conventions file.",
    traceId: "desktop-project-conventions-file"
  });
}
