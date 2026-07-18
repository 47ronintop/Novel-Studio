import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { createProjectPathGuard, writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ITEMS = 300;
const DEFAULT_MAX_TEXT_BYTES = 5 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "build",
  "out",
  "coverage"
]);
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export interface EngineeringWorkspaceFileRepositoryOptions {
  readonly contentRoot: string;
  readonly maxDepth?: number;
  readonly maxItems?: number;
  readonly maxTextBytes?: number;
  readonly traceId?: string;
  readonly atomicWriter?: typeof writeTextAtomically;
}

interface EngineeringTreeNode {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly readOnlyReason?: string;
  readonly children?: readonly EngineeringTreeNode[];
}

interface EngineeringTextFileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly readOnlyReason?: string;
}

type EngineeringTextFileSaveResult =
  | { readonly kind: "saved"; readonly document: EngineeringTextFileSnapshot }
  | {
      readonly kind: "conflict";
      readonly current: EngineeringTextFileSnapshot;
      readonly attemptedContent: string;
    };

interface TraversalBudget {
  remaining: number;
  truncated: boolean;
}

export class EngineeringWorkspaceFileRepository {
  private readonly canonicalRoot: Promise<string>;
  private readonly maxDepth: number;
  private readonly maxItems: number;
  private readonly maxTextBytes: number;
  private readonly traceId: string;
  private readonly atomicWriter: typeof writeTextAtomically;

  public constructor(private readonly options: EngineeringWorkspaceFileRepositoryOptions) {
    this.canonicalRoot = realpath(options.contentRoot);
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxTextBytes = options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES;
    this.traceId = options.traceId ?? "engineering-workspace-repository";
    this.atomicWriter = options.atomicWriter ?? writeTextAtomically;
  }

  public async openWorkspace(): Promise<
    Result<
      {
        readonly canonicalContentRoot: string;
        readonly displayName: string;
        readonly tree: {
          readonly nodes: readonly EngineeringTreeNode[];
          readonly truncated: boolean;
        };
      },
      UnifiedError
    >
  > {
    try {
      const canonicalRoot = await this.assertRootIdentity();
      const stats = await lstat(canonicalRoot);
      if (!stats.isDirectory()) {
        return this.openFailed();
      }

      const budget: TraversalBudget = {
        remaining: this.maxItems,
        truncated: false
      };
      const nodes = await this.readDirectory(canonicalRoot, "", 0, budget);
      return ok({
        canonicalContentRoot: canonicalRoot,
        displayName: basename(canonicalRoot),
        tree: {
          nodes,
          truncated: budget.truncated
        }
      });
    } catch {
      return this.openFailed();
    }
  }

  public async readTextFile(
    path: string
  ): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>> {
    const validated = validateRelativePath(path, this.traceId);
    if (!validated.ok) return validated;

    const target = await this.resolveExistingPath(validated.value);
    if (!target.ok) return target;
    return this.readSnapshot(validated.value, target.value);
  }

  public async saveTextFile(input: {
    readonly path: string;
    readonly content: string;
    readonly expectedChecksum: string;
  }): Promise<Result<EngineeringTextFileSaveResult, UnifiedError>> {
    const validated = validateRelativePath(input.path, this.traceId);
    if (!validated.ok) return validated;
    if (input.content.includes("\0")) {
      return err(
        storageError({
          code: "ENGINEERING_TEXT_FILE_WRITE_REJECTED",
          message: "The text file content contains an unsupported null character.",
          suggestedAction: "Remove the null character and try saving again.",
          traceId: this.traceId
        })
      );
    }
    if (Buffer.byteLength(input.content, "utf8") > this.maxTextBytes) {
      return this.tooLarge(validated.value);
    }

    const target = await this.resolveExistingPath(validated.value);
    if (!target.ok) return target;
    const current = await this.readSnapshot(validated.value, target.value);
    if (!current.ok) return current;
    if (current.value.checksum !== input.expectedChecksum) {
      return ok({
        kind: "conflict",
        current: current.value,
        attemptedContent: input.content
      });
    }

    let racedCurrent: EngineeringTextFileSnapshot | undefined;
    const canonicalRoot = await this.assertRootIdentity().catch(() => undefined);
    if (canonicalRoot === undefined) return this.openFailed();
    let write: Result<void, UnifiedError>;
    try {
      write = await this.atomicWriter({
        targetPath: target.value,
        content: input.content,
        traceId: this.traceId,
        pathGuard: createProjectPathGuard(canonicalRoot),
        beforeReplace: async () => {
          const latestTarget = await this.resolveExistingPath(validated.value);
          if (!latestTarget.ok) return latestTarget;
          const latest = await this.readSnapshot(validated.value, latestTarget.value);
          if (!latest.ok) return latest;
          if (latest.value.checksum !== input.expectedChecksum) {
            racedCurrent = latest.value;
            return err(this.atomicConflictError());
          }
          return ok(undefined);
        }
      });
    } catch {
      return this.textWriteFailed(validated.value);
    }
    if (!write.ok) {
      if (racedCurrent !== undefined) {
        return ok({
          kind: "conflict",
          current: racedCurrent,
          attemptedContent: input.content
        });
      }
      return this.textWriteFailed(validated.value);
    }

    const saved = await this.readTextFile(validated.value);
    if (!saved.ok) return saved;
    return ok({ kind: "saved", document: saved.value });
  }

  private async readDirectory(
    directory: string,
    relativeDirectory: string,
    depth: number,
    budget: TraversalBudget
  ): Promise<readonly EngineeringTreeNode[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    const nodes: EngineeringTreeNode[] = [];
    for (const entry of entries) {
      if (isIgnoredDirectory(entry.name, entry.isDirectory()) || entry.isSymbolicLink()) {
        continue;
      }
      if (budget.remaining <= 0) {
        budget.truncated = true;
        break;
      }

      const absolutePath = join(directory, entry.name);
      let stats;
      try {
        stats = await lstat(absolutePath);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        continue;
      }

      budget.remaining -= 1;
      const path =
        relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (stats.isDirectory()) {
        const isDepthBoundary = depth + 1 >= this.maxDepth;
        const node: EngineeringTreeNode = {
          id: `folder:${path}`,
          name: entry.name,
          kind: "directory",
          path,
          ...(!isDepthBoundary
            ? { children: await this.readDirectory(absolutePath, path, depth + 1, budget) }
            : {})
        };
        if (isDepthBoundary && (await this.hasVisibleChild(absolutePath))) {
          budget.truncated = true;
        }
        nodes.push(node);
      } else {
        nodes.push({
          id: `file:${path}`,
          name: entry.name,
          kind: "file",
          path
        });
      }
    }
    return nodes;
  }

  private async hasVisibleChild(directory: string): Promise<boolean> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (isIgnoredDirectory(entry.name, entry.isDirectory()) || entry.isSymbolicLink()) {
          continue;
        }
        const stats = await lstat(join(directory, entry.name));
        if (!stats.isSymbolicLink() && (stats.isDirectory() || stats.isFile())) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private async resolveExistingPath(path: string): Promise<Result<string, UnifiedError>> {
    try {
      const canonicalRoot = await this.assertRootIdentity();
      let current = canonicalRoot;
      const segments = path.split("/");
      for (const [index, segment] of segments.entries()) {
        current = join(current, segment);
        const stats = await lstat(current);
        if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
        if (index < segments.length - 1 && !stats.isDirectory()) {
          throw new Error("Path parent is not a directory.");
        }
        const canonicalCurrent = await realpath(current);
        if (!isContained(relative(canonicalRoot, canonicalCurrent))) {
          throw new Error("Path escaped the canonical root.");
        }
      }
      const canonicalTarget = await realpath(current);
      if (!isContained(relative(canonicalRoot, canonicalTarget))) {
        throw new Error("Path escaped the canonical root.");
      }
      const targetStats = await lstat(current);
      if (!targetStats.isFile()) throw new Error("Target is not a file.");
      return ok(canonicalTarget);
    } catch {
      return this.pathRejected(path);
    }
  }

  private async readSnapshot(
    path: string,
    targetPath: string
  ): Promise<Result<EngineeringTextFileSnapshot, UnifiedError>> {
    try {
      const stats = await lstat(targetPath);
      if (!stats.isFile()) return this.pathRejected(path);
      if (stats.size > this.maxTextBytes) return this.tooLarge(path);
      const bytes = await readFile(targetPath);
      if (bytes.byteLength > this.maxTextBytes) return this.tooLarge(path);
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return this.textReadFailed(path);
      }
      if (content.includes("\0")) return this.textReadFailed(path);
      return ok({
        path,
        content,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength
      });
    } catch {
      return this.textReadFailed(path);
    }
  }

  private async assertRootIdentity(): Promise<string> {
    const canonicalRoot = await this.canonicalRoot;
    const currentRoot = await realpath(this.options.contentRoot);
    if (!samePath(canonicalRoot, currentRoot)) {
      throw new Error("Workspace root identity changed.");
    }
    return canonicalRoot;
  }

  private openFailed(): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "ENGINEERING_WORKSPACE_OPEN_FAILED",
        message: "The engineering workspace could not be opened.",
        suggestedAction: "Choose an existing folder and try opening it again.",
        traceId: this.traceId
      })
    );
  }

  private pathRejected(path: string): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "ENGINEERING_WORKSPACE_PATH_REJECTED",
        message: "The engineering workspace path was rejected.",
        suggestedAction: "Use a canonical path relative to the opened workspace.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private textReadFailed(path: string): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "ENGINEERING_TEXT_FILE_READ_FAILED",
        message: "The text file could not be decoded as UTF-8.",
        suggestedAction: "Choose a UTF-8 text file and try again.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private textWriteFailed(path: string): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "ENGINEERING_TEXT_FILE_WRITE_FAILED",
        message: "The text file could not be saved.",
        suggestedAction: "Retry the save. If it fails again, check filesystem permissions.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path) }
      })
    );
  }

  private tooLarge(path: string): Result<never, UnifiedError> {
    return err(
      storageError({
        code: "ENGINEERING_TEXT_FILE_TOO_LARGE",
        message: "The text file is too large to open in the editor.",
        suggestedAction: "Open a smaller text file.",
        traceId: this.traceId,
        redactedDetail: { path: redact(path), maxBytes: this.maxTextBytes }
      })
    );
  }

  private atomicConflictError(): UnifiedError {
    return storageError({
      code: "ENGINEERING_TEXT_FILE_CONFLICT_RACE",
      message: "The file changed while it was being saved.",
      suggestedAction: "Reload the current file and review the external change.",
      traceId: this.traceId
    });
  }
}

function validateRelativePath(input: string, traceId: string): Result<string, UnifiedError> {
  const value = typeof input === "string" ? input : "";
  const segments = value.split("/");
  const invalid =
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.startsWith("/") ||
    isAbsolute(value) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => DEVICE_NAME.test(segment)) ||
    segments.some((segment) => IGNORED_DIRECTORIES.has(segment.toLowerCase()));
  return invalid
    ? err(
        validationError({
          code: "ENGINEERING_WORKSPACE_PATH_REJECTED",
          message: "The engineering workspace path was rejected.",
          suggestedAction: "Use a canonical path relative to the opened workspace.",
          traceId,
          redactedDetail: { path: redact(value) }
        })
      )
    : ok(value);
}

function isIgnoredDirectory(name: string, isDirectory: boolean): boolean {
  return isDirectory && IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function isContained(value: string): boolean {
  return (
    value !== ".." &&
    !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
    !isAbsolute(value)
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function redact(value: string): string {
  return value.split(/[\\/]/u).filter(Boolean).slice(-2).join("/");
}
