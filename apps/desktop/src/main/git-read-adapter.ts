import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";

export interface GitStatusResult {
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly branch: string;
}

export interface GitDiffFile {
  readonly relativePath: string;
  readonly diff: string;
}

export interface GitDiffResult {
  readonly diffs: readonly GitDiffFile[];
  readonly truncated: boolean;
}

export interface GitRuntimeManifest {
  readonly schemaVersion: "1.0";
  readonly version: string;
  readonly digest: string;
  /** Path relative to Electron's process.resourcesPath, never to the package root. */
  readonly path: string;
  readonly license: string;
}

export interface VerifiedGitRuntime extends GitRuntimeManifest {
  readonly executablePath: string;
}

export interface GitReadSandboxQualification {
  readonly attestationId: string;
  readonly expiresAt: string;
  readonly hostDigest: string;
  readonly gitRuntimeDigest: string;
  readonly profile: "git-readonly-v1";
  readonly capabilities: {
    readonly fileIsolation: "verified";
    readonly networkIsolation: "verified";
    readonly jobObjectKillOnClose: "verified";
    readonly appContainerOrLowBox: "verified";
  };
}

export interface GitReadSandboxLaunchInput {
  readonly profile: "git-readonly-v1";
  readonly attestationId: string;
  readonly runtime: VerifiedGitRuntime;
  readonly worktreePath: string;
  readonly gitDirectoryPath: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly maxOutputBytes: number;
}

export interface GitReadSandboxOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly truncated: boolean;
}

/**
 * Main-process implementation must route this to the qualified native sandbox
 * profile. GitReadAdapter deliberately has no child_process import or fallback.
 */
export interface GitReadSandboxPort {
  getQualification(): Promise<Result<GitReadSandboxQualification, UnifiedError>>;
  executeGitRead(
    input: GitReadSandboxLaunchInput
  ): Promise<Result<GitReadSandboxOutput, UnifiedError>>;
}

const MAX_DIFF_BYTES = 256 * 1024;
const GIT_MANIFEST_SCHEMA_VERSION = "1.0";
const GIT_READ_PROFILE = "git-readonly-v1" as const;

const SAFE_GIT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "NUL",
  GIT_CONFIG_COUNT: "0",
  GIT_ATTR_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "Never",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  HOME: "NUL",
  USERPROFILE: "NUL",
  HOMEDRIVE: "",
  HOMEPATH: "",
  XDG_CONFIG_HOME: "NUL"
});

/**
 * Git read adapter. This class only validates a fixed runtime and forwards a
 * declarative invocation to a qualified read-only sandbox. It never spawns Git.
 */
export class GitReadAdapter {
  private readonly manifestPath: string;
  private readonly resourcesBase: string;
  private readonly sandbox: GitReadSandboxPort | undefined;
  private cachedRuntime: VerifiedGitRuntime | undefined;

  constructor(options: { readonly resourcesBase: string; readonly sandbox?: GitReadSandboxPort }) {
    this.resourcesBase = resolve(options.resourcesBase);
    this.manifestPath = join(this.resourcesBase, "git", "manifest.json");
    this.sandbox = options.sandbox;
  }

  private async resolveGitRuntime(): Promise<Result<VerifiedGitRuntime, UnifiedError>> {
    if (this.cachedRuntime !== undefined) return ok(this.cachedRuntime);

    let manifestContent: string;
    try {
      manifestContent = await readFile(this.manifestPath, "utf8");
    } catch {
      return err(unavailableError("Git runtime manifest not found in packaged resources."));
    }

    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestContent);
    } catch {
      return err(unavailableError("Git runtime manifest is malformed."));
    }
    const manifest = parseGitRuntimeManifest(manifestValue);
    if (manifest === undefined) {
      return err(unavailableError("Git runtime manifest does not match the required schema."));
    }
    if (manifest.version === "unavailable") {
      return err(unavailableError("Git runtime is explicitly marked unavailable."));
    }

    let resolvedResourcesBase: string;
    try {
      resolvedResourcesBase = await realpath(this.resourcesBase);
    } catch {
      return err(unavailableError("Cannot resolve the packaged resources directory."));
    }
    const executablePath = resolve(resolvedResourcesBase, manifest.path);
    if (!isContainedPath(resolvedResourcesBase, executablePath)) {
      return err(unavailableError("Git runtime path escapes packaged resources."));
    }

    let executableStat: Awaited<ReturnType<typeof lstat>>;
    try {
      executableStat = await lstat(executablePath);
    } catch {
      return err(unavailableError("Packaged Git runtime is missing."));
    }
    if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
      return err(unavailableError("Packaged Git runtime must be a regular file."));
    }

    let resolvedExecutablePath: string;
    try {
      resolvedExecutablePath = await realpath(executablePath);
    } catch {
      return err(unavailableError("Cannot resolve the packaged Git runtime."));
    }
    if (!isContainedPath(resolvedResourcesBase, resolvedExecutablePath)) {
      return err(unavailableError("Packaged Git runtime resolves outside packaged resources."));
    }

    const actualDigest = createHash("sha256")
      .update(await readFile(resolvedExecutablePath))
      .digest("hex");
    if (actualDigest !== manifest.digest) {
      return err(unavailableError("Packaged Git runtime digest mismatch."));
    }

    const runtime = { ...manifest, executablePath: resolvedExecutablePath };
    this.cachedRuntime = runtime;
    return ok(runtime);
  }

  /**
   * Accept only a normal, self-contained repository. Linked worktrees, gitdir
   * files, alternates, config includes, and reparse points are rejected before
   * the native profile receives any filesystem grant.
   */
  private async validateWorktree(
    projectRoot: string
  ): Promise<Result<{ worktreePath: string; gitDirectoryPath: string }, UnifiedError>> {
    const resolvedRoot = resolve(projectRoot);
    let rootStat: Awaited<ReturnType<typeof lstat>>;
    try {
      rootStat = await lstat(resolvedRoot);
    } catch {
      return err(unavailableError("Project root does not exist."));
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return err(
        unavailableError("Project root must be a regular directory without reparse points.")
      );
    }

    let worktreePath: string;
    try {
      worktreePath = await realpath(resolvedRoot);
    } catch {
      return err(unavailableError("Cannot resolve project root."));
    }
    // Use the canonical path for every later grant. The input may use a Windows
    // 8.3 alias even when the directory itself is not a reparse point.

    const gitDirectoryPath = join(worktreePath, ".git");
    let gitDirectoryStat: Awaited<ReturnType<typeof lstat>>;
    try {
      gitDirectoryStat = await lstat(gitDirectoryPath);
    } catch {
      return err(unavailableError("Project root is not a self-contained Git worktree."));
    }
    if (!gitDirectoryStat.isDirectory() || gitDirectoryStat.isSymbolicLink()) {
      return err(
        unavailableError("Linked worktrees and reparse-point Git directories are not supported.")
      );
    }

    let resolvedGitDirectory: string;
    try {
      resolvedGitDirectory = await realpath(gitDirectoryPath);
    } catch {
      return err(unavailableError("Cannot resolve the Git directory."));
    }
    if (!isContainedPath(worktreePath, resolvedGitDirectory)) {
      return err(unavailableError("Git directory resolves outside the worktree."));
    }

    for (const blockedPath of [
      "commondir",
      "config.worktree",
      join("objects", "info", "alternates"),
      "worktrees",
      "modules"
    ]) {
      if (await pathExists(join(resolvedGitDirectory, blockedPath))) {
        return err(
          unavailableError(`Unsupported Git repository feature detected: ${blockedPath}.`)
        );
      }
    }

    const configResult = await validateGitConfig(join(resolvedGitDirectory, "config"));
    if (!configResult.ok) return configResult;

    return ok({ worktreePath, gitDirectoryPath: resolvedGitDirectory });
  }

  private validatePaths(paths: readonly string[]): Result<readonly string[], UnifiedError> {
    for (const path of paths) {
      if (
        !path ||
        isAbsolute(path) ||
        /^[a-zA-Z]:/.test(path) ||
        path.startsWith("\\\\") ||
        path.includes("\0") ||
        path.startsWith(":") ||
        path.split(/[\\/]+/).some((segment) => segment === ".." || segment === ".")
      ) {
        return err(
          createUnifiedError({
            code: "AGENT_GIT_PATHSPEC_INVALID",
            category: "ValidationError",
            message: `Invalid Git pathspec: ${path}`,
            recoverability: "user-action",
            suggestedAction: "Use a project-relative path without traversal or Git pathspec magic.",
            traceId: "git-read-adapter"
          })
        );
      }
    }
    return ok(paths);
  }

  private async runGit(
    projectRoot: string,
    commandArgs: readonly string[],
    maxOutputBytes = MAX_DIFF_BYTES
  ): Promise<Result<{ stdout: string; truncated: boolean }, UnifiedError>> {
    const runtime = await this.resolveGitRuntime();
    if (!runtime.ok) return runtime;
    const worktree = await this.validateWorktree(projectRoot);
    if (!worktree.ok) return worktree;
    const qualification = await this.getQualification(runtime.value);
    if (!qualification.ok) return qualification;

    if (this.sandbox === undefined) {
      return err(
        unavailableError("Git reads require a qualified native read-only sandbox profile.")
      );
    }
    const execution = await this.sandbox.executeGitRead({
      profile: GIT_READ_PROFILE,
      attestationId: qualification.value.attestationId,
      runtime: runtime.value,
      worktreePath: worktree.value.worktreePath,
      gitDirectoryPath: worktree.value.gitDirectoryPath,
      argv: [
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=NUL",
        "-c",
        "credential.helper=",
        "-c",
        "core.pager=cat",
        "-c",
        "diff.external=",
        "-c",
        "diff.trustExitCode=false",
        "--git-dir",
        worktree.value.gitDirectoryPath,
        "--work-tree",
        worktree.value.worktreePath,
        ...commandArgs
      ],
      environment: SAFE_GIT_ENV,
      maxOutputBytes
    });
    if (!execution.ok) return execution;
    if (execution.value.exitCode !== 0 && !execution.value.truncated) {
      return err(
        unavailableError(
          `Git read failed with code ${execution.value.exitCode ?? "unknown"}: ${execution.value.stderr.slice(0, 256)}`
        )
      );
    }
    return ok({ stdout: execution.value.stdout, truncated: execution.value.truncated });
  }

  private async getQualification(
    runtime: VerifiedGitRuntime
  ): Promise<Result<GitReadSandboxQualification, UnifiedError>> {
    if (this.sandbox === undefined) {
      return err(
        unavailableError("Git reads require a qualified native read-only sandbox profile.")
      );
    }
    const result = await this.sandbox.getQualification();
    if (!result.ok) return err(unavailableError("Git sandbox qualification is unavailable."));
    const qualification = result.value;
    if (
      qualification.profile !== GIT_READ_PROFILE ||
      qualification.gitRuntimeDigest !== runtime.digest ||
      !isSha256(qualification.hostDigest) ||
      !qualification.attestationId ||
      new Date(qualification.expiresAt).getTime() <= Date.now() ||
      qualification.capabilities.fileIsolation !== "verified" ||
      qualification.capabilities.networkIsolation !== "verified" ||
      qualification.capabilities.jobObjectKillOnClose !== "verified" ||
      qualification.capabilities.appContainerOrLowBox !== "verified"
    ) {
      return err(
        unavailableError(
          "Git sandbox qualification is stale, incomplete, or bound to another runtime."
        )
      );
    }
    return ok(qualification);
  }

  async gitStatus(projectRoot: string): Promise<Result<GitStatusResult, UnifiedError>> {
    const result = await this.runGit(projectRoot, [
      "status",
      "--porcelain=v1",
      "--branch",
      "--untracked-files=all"
    ]);
    if (!result.ok) return result;

    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    let branch = "unknown";
    for (const line of result.value.stdout.split("\n").filter((candidate) => candidate.trim())) {
      if (line.startsWith("## ")) {
        const branchPart = (line.slice(3).split("...")[0] ?? "").split(" ")[0] ?? "";
        branch = branchPart || "unknown";
        continue;
      }
      if (line.length < 3) continue;
      const xy = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (xy[0] === "?") {
        untracked.push(file);
      } else {
        if (xy[0] !== " ") staged.push(file);
        if (xy[1] !== " ") unstaged.push(file);
      }
    }
    return ok({ staged, unstaged, untracked, branch });
  }

  async gitDiff(
    projectRoot: string,
    paths?: readonly string[]
  ): Promise<Result<GitDiffResult, UnifiedError>> {
    const pathsResult = paths === undefined ? ok([]) : this.validatePaths(paths);
    if (!pathsResult.ok) return pathsResult;
    const result = await this.runGit(projectRoot, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--",
      ...pathsResult.value
    ]);
    if (!result.ok) return result;
    return ok({ diffs: parseDiffOutput(result.value.stdout), truncated: result.value.truncated });
  }
}

export function parseGitRuntimeManifest(value: unknown): GitRuntimeManifest | undefined {
  if (!isRecord(value)) return undefined;
  const expectedKeys = new Set(["schemaVersion", "version", "digest", "path", "license"]);
  if (Object.keys(value).some((key) => !expectedKeys.has(key))) return undefined;
  if (
    value.schemaVersion !== GIT_MANIFEST_SCHEMA_VERSION ||
    !isNonEmptyString(value.version) ||
    !isSha256(value.digest) ||
    !isSafeResourcePath(value.path) ||
    !isNonEmptyString(value.license)
  ) {
    return undefined;
  }
  return {
    schemaVersion: GIT_MANIFEST_SCHEMA_VERSION,
    version: value.version,
    digest: value.digest,
    path: value.path,
    license: value.license
  };
}

function parseDiffOutput(diffText: string): GitDiffFile[] {
  if (!diffText.trim()) return [];
  const diffs: GitDiffFile[] = [];
  for (const part of diffText.split(/^(?=diff --git )/m)) {
    const match = /^diff --git a\/(.*?) b\//m.exec(part);
    if (match?.[1]) diffs.push({ relativePath: match[1], diff: part });
  }
  return diffs;
}

async function validateGitConfig(configPath: string): Promise<Result<void, UnifiedError>> {
  let config: string;
  try {
    config = await readFile(configPath, "utf8");
  } catch {
    return err(unavailableError("Git config is missing or unreadable."));
  }
  const forbidden =
    /(?:^|\n)\s*(?:\[\s*(?:include(?:if)?|credential|diff|filter)\b|(?:path|worktree|fsmonitor|hookspath|pager|external|textconv|helper)\s*=)/im;
  if (forbidden.test(config)) {
    return err(
      unavailableError("Git config contains unsupported executable or external-path behavior.")
    );
  }
  return ok(undefined);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function isSafeResourcePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.includes("\0") || isAbsolute(value)) return false;
  if (/^[a-zA-Z]:/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return false;
  return value
    .split(/[\\/]+/)
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":")
    );
}

function isContainedPath(base: string, candidate: string): boolean {
  const relativePath = relative(
    normalizePathForComparison(base),
    normalizePathForComparison(candidate)
  );
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !isAbsolute(relativePath)
  );
}

function normalizePathForComparison(path: string): string {
  const withoutDevicePrefix = path.startsWith("\\\\?\\UNC\\")
    ? `\\\\${path.slice("\\\\?\\UNC\\".length)}`
    : path.startsWith("\\\\?\\")
      ? path.slice("\\\\?\\".length)
      : path;
  return process.platform === "win32" ? withoutDevicePrefix.toLowerCase() : withoutDevicePrefix;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unavailableError(message: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_GIT_ADAPTER_UNAVAILABLE",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Install a verified Git runtime and re-run Windows sandbox qualification before using Git tools.",
    traceId: "git-read-adapter"
  });
}
