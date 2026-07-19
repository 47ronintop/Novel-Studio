import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface AgentProjectEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: "directory" | "file";
}

export interface AgentProjectTextReadResult {
  readonly relativePath: string;
  readonly content: string;
  readonly checksum: string;
  readonly byteLength: number;
}

export interface AgentProjectReadRepositoryOptions {
  readonly projectRoot: string;
  readonly maxReadBytes?: number;
  readonly traceId?: string;
}

const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".ts"]);
const blockedRoots = new Set([
  ".git",
  ".novel-studio",
  "node_modules",
  "history",
  "dist",
  "build",
  ".cache"
]);
const deviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export class AgentProjectReadRepository {
  private readonly canonicalRoot: Promise<string>;
  private readonly maxReadBytes: number;
  private readonly traceId: string;

  public constructor(private readonly options: AgentProjectReadRepositoryOptions) {
    this.canonicalRoot = realpath(options.projectRoot);
    this.maxReadBytes = options.maxReadBytes ?? 1024 * 1024;
    this.traceId = options.traceId ?? "agent-project-read-repository";
  }

  public async readText(
    relativePath: string
  ): Promise<Result<AgentProjectTextReadResult, UnifiedError>> {
    const validated = validateRelativePath(relativePath, false);
    if (!validated.ok) return validated;
    try {
      const targetPath = await this.resolveExistingPath(validated.value);
      const stats = await lstat(targetPath);
      if (!stats.isFile() || stats.size > this.maxReadBytes) {
        return this.rejected(validated.value);
      }
      const bytes = await readFile(targetPath);
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return this.rejected(validated.value);
      }
      if (content.includes("\0")) return this.rejected(validated.value);
      return ok({
        relativePath: validated.value,
        content,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength
      });
    } catch {
      return this.rejected(validated.value);
    }
  }

  public async listEntries(
    relativeDirectory = ""
  ): Promise<Result<readonly AgentProjectEntry[], UnifiedError>> {
    const validated = validateRelativePath(relativeDirectory, true);
    if (!validated.ok) return validated;
    try {
      const canonicalRoot = await this.canonicalRoot;
      const directoryPath =
        validated.value.length === 0
          ? canonicalRoot
          : await this.resolveExistingPath(validated.value);
      const directoryStats = await lstat(directoryPath);
      if (!directoryStats.isDirectory()) return this.rejected(validated.value);
      const entries = await readdir(directoryPath, { withFileTypes: true });
      const visible: AgentProjectEntry[] = [];
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink() || deviceName.test(entry.name)) continue;
        if (validated.value.length === 0 && blockedRoots.has(entry.name.toLowerCase())) continue;
        const childRelative =
          validated.value.length === 0 ? entry.name : `${validated.value}/${entry.name}`;
        if (entry.isDirectory()) {
          visible.push({ name: entry.name, relativePath: childRelative, kind: "directory" });
        } else if (entry.isFile() && allowedExtensions.has(extname(entry.name).toLowerCase())) {
          visible.push({ name: entry.name, relativePath: childRelative, kind: "file" });
        }
      }
      return ok(visible);
    } catch {
      return this.rejected(validated.value);
    }
  }

  private async resolveExistingPath(relativePath: string): Promise<string> {
    const canonicalRoot = await this.canonicalRoot;
    let current = canonicalRoot;
    for (const segment of relativePath.split("/").filter(Boolean)) {
      current = join(current, segment);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error("Reparse point rejected.");
    }
    const canonicalTarget = await realpath(current);
    const rootRelative = relative(canonicalRoot, canonicalTarget);
    if (
      rootRelative === ".." ||
      rootRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
      isAbsolute(rootRelative)
    ) {
      throw new Error("Project root escape rejected.");
    }
    return canonicalTarget;
  }

  private rejected(relativePath: string): Result<never, UnifiedError> {
    return err(
      createUnifiedError({
        code: "AGENT_PROJECT_PATH_REJECTED",
        category: "ValidationError",
        message: "The Agent project read was rejected by the project-root boundary.",
        recoverability: "user-action",
        suggestedAction: "Use an existing canonical project-relative text path.",
        traceId: this.traceId,
        redactedDetail: { relativePath: redact(relativePath) }
      })
    );
  }
}

function validateRelativePath(
  input: string,
  allowDirectory: boolean
): Result<string, UnifiedError> {
  const value = input.trim();
  const segments = value.length === 0 ? [] : value.split("/");
  const invalid =
    (!allowDirectory && value.length === 0) ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.includes(":") ||
    isAbsolute(value) ||
    value.startsWith("//") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => deviceName.test(segment)) ||
    blockedRoots.has((segments[0] ?? "").toLowerCase()) ||
    (!allowDirectory && !allowedExtensions.has(extname(value).toLowerCase()));
  return invalid
    ? err(
        createUnifiedError({
          code: "AGENT_PROJECT_PATH_REJECTED",
          category: "ValidationError",
          message: "The Agent project path is invalid.",
          recoverability: "user-action",
          suggestedAction: "Use a canonical project-relative text path.",
          traceId: "agent-project-read-repository",
          redactedDetail: { relativePath: redact(value) }
        })
      )
    : ok(value);
}

function redact(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}
