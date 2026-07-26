/**
 * Standard trusted-creative replacement backend.
 *
 * This backend is intentionally distinct from the native lifecycle port. Node
 * path APIs cannot close a hostile same-user reparse-point race, so this port is
 * only composed for app-managed creative projects and never claims hardened
 * native isolation. It supports replacement of existing text assets only.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  AgentWriteTrustedCreativeMutationPort,
  AgentWriteTrustedCreativeReplaceMutation
} from "./agent-write-transaction.js";
import { isSafeProjectRelativePath } from "./no-follow-file-operations.js";
import type { AgentOperationPathSnapshot } from "./ports.js";

const checksumPattern = /^[a-f0-9]{64}$/u;
const allowedTextExtensions = new Set([".json", ".md", ".toml", ".txt", ".yaml", ".yml"]);
const blockedRoots = new Set([
  ".cache",
  ".git",
  ".novel-studio",
  "build",
  "dist",
  "history",
  "node_modules",
  "plugins"
]);

export interface TrustedCreativeFileOperationsOptions {
  /** Main-owned workspace classification. Renderer/model input cannot set it. */
  readonly workspaceKind: "creativeProject";
  /** Absolute app-managed creative project content root. */
  readonly projectRoot: string;
  readonly fileSystem?: TrustedCreativeFileSystem;
  readonly createTempId?: () => string;
}

export interface TrustedCreativeFileHandle {
  writeFile(content: string, encoding: "utf8"): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface TrustedCreativePathStats {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/** Injectable filesystem seam used to verify write, sync, close, and rename ordering. */
export interface TrustedCreativeFileSystem {
  lstat(path: string): Promise<TrustedCreativePathStats>;
  realpath(path: string): Promise<string>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  open(path: string, flags: "wx"): Promise<TrustedCreativeFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string): Promise<void>;
}

interface BoundCreativeRoot {
  readonly projectRoot: string;
  readonly canonicalRoot: string;
  readonly device: string;
  readonly inode: string;
}

interface ValidatedSnapshots {
  readonly before: Extract<AgentOperationPathSnapshot, { readonly kind: "file" }>;
  readonly after: Extract<AgentOperationPathSnapshot, { readonly kind: "file" }>;
}

const defaultFileSystem: TrustedCreativeFileSystem = {
  lstat: (path) => lstat(path, { bigint: true }),
  realpath: (path) => realpath(path),
  readFile: (path, encoding) => readFile(path, encoding),
  async open(path, flags) {
    const handle = await open(path, flags);
    return {
      writeFile: (content, encoding) => handle.writeFile(content, encoding),
      sync: () => handle.sync(),
      close: () => handle.close()
    };
  },
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  rm: async (path) => {
    await rm(path, { force: true });
  }
};

/**
 * Create a replacement port whose authority is permanently bound to one
 * creative-project root. Root validation is cached as a Result and root identity
 * is rechecked before every mutation and immediately before rename.
 */
export function createTrustedCreativeFileOperationsPort(
  options: TrustedCreativeFileOperationsOptions
): AgentWriteTrustedCreativeMutationPort {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const boundRoot = bindTrustedCreativeRoot(options, fileSystem);
  const createTempId = options.createTempId ?? (() => randomUUID());

  return Object.freeze({
    trustLevel: "standard_trusted_creative" as const,
    async replace(
      input: AgentWriteTrustedCreativeReplaceMutation
    ): Promise<Result<void, UnifiedError>> {
      const snapshots = validateReplaceMutation(input);
      if (!snapshots.ok) return snapshots;
      const binding = await boundRoot;
      if (!binding.ok) return binding;

      const targetPath = join(binding.value.projectRoot, ...input.relativePath.split("/"));
      const initial = await verifyExpectedFile(
        binding.value,
        targetPath,
        input.relativePath,
        snapshots.value.before,
        "before",
        fileSystem
      );
      if (!initial.ok) return initial;

      const tempId = createTempId();
      const fileName = input.relativePath.split("/").at(-1);
      if (fileName === undefined || !/^[A-Za-z0-9-]{1,128}$/u.test(tempId)) {
        return err(
          trustedCreativeError(
            "TRUSTED_CREATIVE_TEMP_PATH_REJECTED",
            "The temporary replacement path could not be created safely.",
            input.relativePath,
            "StorageError"
          )
        );
      }
      const tempPath = join(
        binding.value.projectRoot,
        ...input.relativePath.split("/").slice(0, -1),
        `.${fileName}.tmp-${tempId}`
      );
      let handle: TrustedCreativeFileHandle | undefined;
      let tempExists = false;
      try {
        handle = await fileSystem.open(tempPath, "wx");
        tempExists = true;
        await handle.writeFile(input.content, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
      } catch {
        await closeQuietly(handle);
        if (tempExists) await removeQuietly(fileSystem, tempPath);
        return err(
          trustedCreativeError(
            "TRUSTED_CREATIVE_TEMP_WRITE_FAILED",
            "The replacement could not be flushed to a temporary file.",
            input.relativePath,
            "StorageError"
          )
        );
      }

      const tempCheck = await verifyTemporaryFile(binding.value, tempPath, fileSystem);
      if (!tempCheck.ok) {
        await removeQuietly(fileSystem, tempPath);
        return tempCheck;
      }
      const immediateBefore = await verifyExpectedFile(
        binding.value,
        targetPath,
        input.relativePath,
        snapshots.value.before,
        "before",
        fileSystem
      );
      if (!immediateBefore.ok) {
        await removeQuietly(fileSystem, tempPath);
        return immediateBefore;
      }

      try {
        await fileSystem.rename(tempPath, targetPath);
        tempExists = false;
      } catch {
        if (tempExists) await removeQuietly(fileSystem, tempPath);
        return err(
          trustedCreativeError(
            "TRUSTED_CREATIVE_REPLACE_FAILED",
            "The synchronized temporary file could not replace the target.",
            input.relativePath,
            "StorageError"
          )
        );
      }

      return verifyExpectedFile(
        binding.value,
        targetPath,
        input.relativePath,
        snapshots.value.after,
        "after",
        fileSystem
      );
    }
  });
}

async function bindTrustedCreativeRoot(
  options: TrustedCreativeFileOperationsOptions,
  fileSystem: TrustedCreativeFileSystem
): Promise<Result<BoundCreativeRoot, UnifiedError>> {
  const workspaceKind = (options as { readonly workspaceKind?: unknown }).workspaceKind;
  return workspaceKind === "creativeProject"
    ? bindCreativeRoot(options.projectRoot, fileSystem)
    : err(workspaceKindRejectedError());
}

function validateReplaceMutation(
  input: AgentWriteTrustedCreativeReplaceMutation
): Result<ValidatedSnapshots, UnifiedError> {
  if (!isAllowedCreativeTextPath(input.relativePath)) {
    return err(
      trustedCreativeError(
        "TRUSTED_CREATIVE_PATH_REJECTED",
        "Only safe creative-project text assets can be replaced.",
        input.relativePath,
        "ValidationError"
      )
    );
  }
  const before = input.before.length === 1 ? input.before[0] : undefined;
  const after = input.after.length === 1 ? input.after[0] : undefined;
  if (
    before?.kind !== "file" ||
    after?.kind !== "file" ||
    before.relativePath !== input.relativePath ||
    after.relativePath !== input.relativePath ||
    before.content.includes("\0") ||
    after.content.includes("\0") ||
    input.content.includes("\0") ||
    !checksumPattern.test(before.checksum) ||
    !checksumPattern.test(after.checksum) ||
    before.checksum !== checksum(before.content) ||
    after.checksum !== checksum(after.content) ||
    after.content !== input.content
  ) {
    return err(
      trustedCreativeError(
        "TRUSTED_CREATIVE_SNAPSHOT_INVALID",
        "Replacement requires matching before and after file snapshots.",
        input.relativePath,
        "ValidationError"
      )
    );
  }
  return ok({ before, after });
}

async function bindCreativeRoot(
  projectRoot: string,
  fileSystem: TrustedCreativeFileSystem
): Promise<Result<BoundCreativeRoot, UnifiedError>> {
  if (!isAbsolute(projectRoot)) return err(rootRejectedError());
  const resolvedRoot = resolve(projectRoot);
  try {
    const stats = await fileSystem.lstat(resolvedRoot);
    const canonicalRoot = await fileSystem.realpath(resolvedRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return err(rootRejectedError());
    }
    return ok({
      projectRoot: resolvedRoot,
      canonicalRoot,
      device: String(stats.dev),
      inode: String(stats.ino)
    });
  } catch {
    return err(rootRejectedError());
  }
}

async function verifyExpectedFile(
  root: BoundCreativeRoot,
  targetPath: string,
  relativePath: string,
  expected: Extract<AgentOperationPathSnapshot, { readonly kind: "file" }>,
  phase: "before" | "after",
  fileSystem: TrustedCreativeFileSystem
): Promise<Result<void, UnifiedError>> {
  const pathCheck = await verifyBoundPath(root, targetPath, relativePath, fileSystem);
  if (!pathCheck.ok) return pathCheck;
  try {
    const actualContent = await fileSystem.readFile(targetPath, "utf8");
    if (
      actualContent.includes("\0") ||
      actualContent !== expected.content ||
      checksum(actualContent) !== expected.checksum
    ) {
      return err(
        trustedCreativeError(
          phase === "before"
            ? "TRUSTED_CREATIVE_BASE_CONFLICT"
            : "TRUSTED_CREATIVE_POSTCONDITION_FAILED",
          phase === "before"
            ? "The target changed after the approved Change Set was created."
            : "The replaced target does not match the approved result.",
          relativePath,
          phase === "before" ? "ValidationError" : "StorageError"
        )
      );
    }
    return ok(undefined);
  } catch {
    return err(
      trustedCreativeError(
        "TRUSTED_CREATIVE_TARGET_READ_FAILED",
        "The existing target could not be read as UTF-8 text.",
        relativePath,
        "StorageError"
      )
    );
  }
}

async function verifyBoundPath(
  root: BoundCreativeRoot,
  targetPath: string,
  relativePath: string,
  fileSystem: TrustedCreativeFileSystem
): Promise<Result<void, UnifiedError>> {
  const lexicalRelative = relative(root.projectRoot, resolve(targetPath));
  if (!isContainedRelativePath(lexicalRelative) || lexicalRelative.length === 0) {
    return err(pathRejectedError(relativePath));
  }
  try {
    const rootStats = await fileSystem.lstat(root.projectRoot);
    const currentCanonicalRoot = await fileSystem.realpath(root.projectRoot);
    if (
      rootStats.isSymbolicLink() ||
      !rootStats.isDirectory() ||
      String(rootStats.dev) !== root.device ||
      String(rootStats.ino) !== root.inode ||
      !samePath(currentCanonicalRoot, root.canonicalRoot)
    ) {
      return err(rootRejectedError());
    }

    let current = root.projectRoot;
    const segments = relativePath.split("/");
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      const stats = await fileSystem.lstat(current);
      const canonical = await fileSystem.realpath(current);
      if (
        stats.isSymbolicLink() ||
        !isContainedRelativePath(relative(root.canonicalRoot, canonical)) ||
        (index < segments.length - 1 ? !stats.isDirectory() : !stats.isFile())
      ) {
        return err(pathRejectedError(relativePath));
      }
    }
    return ok(undefined);
  } catch {
    return err(pathRejectedError(relativePath));
  }
}

async function verifyTemporaryFile(
  root: BoundCreativeRoot,
  tempPath: string,
  fileSystem: TrustedCreativeFileSystem
): Promise<Result<void, UnifiedError>> {
  try {
    const stats = await fileSystem.lstat(tempPath);
    const canonical = await fileSystem.realpath(tempPath);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      !isContainedRelativePath(relative(root.canonicalRoot, canonical))
    ) {
      throw new Error("Temporary path is not a regular contained file.");
    }
    return ok(undefined);
  } catch {
    return err(
      trustedCreativeError(
        "TRUSTED_CREATIVE_TEMP_PATH_REJECTED",
        "The synchronized temporary file failed containment checks.",
        undefined,
        "StorageError"
      )
    );
  }
}

function isAllowedCreativeTextPath(relativePath: string): boolean {
  if (!isSafeProjectRelativePath(relativePath)) return false;
  const firstSegment = relativePath.split("/", 1)[0]?.toLowerCase();
  return (
    firstSegment !== undefined &&
    !blockedRoots.has(firstSegment) &&
    allowedTextExtensions.has(extname(relativePath).toLowerCase())
  );
}

function isContainedRelativePath(path: string): boolean {
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(path)
  );
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function closeQuietly(handle: TrustedCreativeFileHandle | undefined): Promise<void> {
  try {
    await handle?.close();
  } catch {
    // Cleanup failure must not hide the original write failure.
  }
}

async function removeQuietly(fileSystem: TrustedCreativeFileSystem, path: string): Promise<void> {
  try {
    await fileSystem.rm(path);
  } catch {
    // Cleanup failure must not hide the original mutation failure.
  }
}

function rootRejectedError(): UnifiedError {
  return trustedCreativeError(
    "TRUSTED_CREATIVE_ROOT_REJECTED",
    "The creative project root is not an absolute, stable, ordinary directory.",
    undefined,
    "ValidationError"
  );
}

function workspaceKindRejectedError(): UnifiedError {
  return trustedCreativeError(
    "TRUSTED_CREATIVE_WORKSPACE_KIND_REJECTED",
    "Trusted creative replacement is available only for an app-managed creative project.",
    undefined,
    "ValidationError"
  );
}

function pathRejectedError(relativePath: string): UnifiedError {
  return trustedCreativeError(
    "TRUSTED_CREATIVE_REPARSE_REJECTED",
    "The target or one of its parent segments is redirected or is not a regular path.",
    relativePath,
    "ValidationError"
  );
}

function trustedCreativeError(
  code: string,
  message: string,
  relativePath: string | undefined,
  category: "StorageError" | "ValidationError"
): UnifiedError {
  return createUnifiedError({
    code,
    category,
    message,
    recoverability: "user-action",
    suggestedAction: "Reopen the creative project, refresh the Change Set, and retry.",
    traceId: "trusted-creative-file-operations",
    ...(relativePath === undefined ? {} : { redactedDetail: { relativePath } })
  });
}
