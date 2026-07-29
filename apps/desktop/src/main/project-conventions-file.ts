import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import type { ProjectConventionsCreateResult } from "@novel-studio/application";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopProjectConventionsCreateInput {
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace";
  readonly projectRoot: string;
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

/** Main-owned fixed-path creation. No renderer-provided path participates in this operation. */
export async function createDesktopProjectConventionsFile(
  input: DesktopProjectConventionsCreateInput
): Promise<Result<ProjectConventionsCreateResult, UnifiedError>> {
  const definition = FILES[input.workspaceKind];
  try {
    const canonicalRoot = await realpath(input.projectRoot);
    const parentPath =
      input.workspaceKind === "creativeProject" ? join(canonicalRoot, "conventions") : canonicalRoot;
    if (input.workspaceKind === "creativeProject") {
      try {
        await mkdir(parentPath);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) return err(fileError("PROJECT_CONVENTIONS_CREATE_FAILED"));
      }
    }

    const [canonicalParent, parentStats] = await Promise.all([
      realpath(parentPath),
      lstat(parentPath)
    ]);
    if (
      !parentStats.isDirectory() ||
      parentStats.isSymbolicLink() ||
      !isContainedPath(canonicalRoot, canonicalParent)
    ) {
      return err(fileError("PROJECT_CONVENTIONS_PATH_REJECTED"));
    }

    const targetPath = join(canonicalParent, definition.relativePath.split("/").at(-1) ?? "");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(targetPath, "wx", 0o600);
      await handle.writeFile(definition.initialContent, "utf8");
      await handle.sync();
    } catch (error) {
      if (!hasCode(error, "EEXIST")) return err(fileError("PROJECT_CONVENTIONS_CREATE_FAILED"));
      const targetStats = await lstat(targetPath);
      if (!targetStats.isFile() || targetStats.isSymbolicLink()) {
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

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath.length === 0 ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function hasCode(value: unknown, code: string): value is NodeJS.ErrnoException {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NodeJS.ErrnoException).code === code
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
