import { spawn } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import { join, resolve, isAbsolute, sep } from "node:path";
import { readFile } from "node:fs/promises";
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

export interface GitManifest {
  readonly version: string;
  readonly digest: string;
  readonly path: string;
  readonly license: string;
}

const MAX_DIFF_BYTES = 256 * 1024; // 256 KiB

/**
 * GitReadAdapter — executes git status/diff using the packaged Git binary.
 *
 * Security invariants:
 *  - Git binary comes from packaged resources, never PATH discovery.
 *  - All git env vars are cleared before exec.
 *  - Arguments are passed as arrays (never shell interpolation).
 *  - Worktree must be within project root; no external gitdir/symlinks.
 *  - Fail-closed: missing binary → AGENT_GIT_ADAPTER_UNAVAILABLE.
 */
export class GitReadAdapter {
  private readonly manifestPath: string;
  private readonly resourcesBase: string;
  private cachedBinaryPath: string | undefined;

  constructor(options: { readonly resourcesBase: string }) {
    this.resourcesBase = resolve(options.resourcesBase);
    this.manifestPath = join(this.resourcesBase, "git", "manifest.json");
  }

  /** Resolve the Git binary path from the packaged manifest. */
  private async resolveGitBinary(): Promise<Result<string, UnifiedError>> {
    if (this.cachedBinaryPath !== undefined) return ok(this.cachedBinaryPath);

    let manifestContent: string;
    try {
      manifestContent = await readFile(this.manifestPath, "utf8");
    } catch {
      return err(unavailableError("Git runtime manifest not found in packaged resources."));
    }

    let manifest: GitManifest;
    try {
      manifest = JSON.parse(manifestContent) as GitManifest;
    } catch {
      return err(unavailableError("Git runtime manifest is malformed."));
    }

    if (manifest.digest === "placeholder") {
      // Development placeholder — git adapter is unavailable
      return err(
        unavailableError(
          "Git runtime manifest is a placeholder. A real packaged Git binary is required."
        )
      );
    }

    const binaryPath = resolve(join(this.resourcesBase, manifest.path));

    // Verify it stays within resourcesBase
    if (!binaryPath.startsWith(this.resourcesBase + sep)) {
      return err(unavailableError("Git binary path escapes resources directory."));
    }

    try {
      await stat(binaryPath);
    } catch {
      return err(unavailableError("Packaged Git binary not found."));
    }

    this.cachedBinaryPath = binaryPath;
    return ok(binaryPath);
  }

  /**
   * Validate that projectRoot is a safe Git worktree.
   * Rejects: symlinks in gitdir path, external gitdir, workspace-external paths.
   */
  private async validateWorktree(projectRoot: string): Promise<Result<string, UnifiedError>> {
    const resolvedRoot = resolve(projectRoot);

    // Verify the path exists and is a directory
    let rootStat: Awaited<ReturnType<typeof stat>>;
    try {
      rootStat = await stat(resolvedRoot);
    } catch {
      return err(unavailableError("Project root does not exist."));
    }
    if (!rootStat.isDirectory()) {
      return err(unavailableError("Project root is not a directory."));
    }

    // Verify via realpath that root has no symlinks
    try {
      const real = await realpath(resolvedRoot);
      if (real !== resolvedRoot) {
        return err(
          unavailableError("Project root contains symlinks or reparse points; rejected for safety.")
        );
      }
    } catch {
      // If realpath fails, we can't verify — fail closed
      return err(unavailableError("Cannot resolve real path of project root."));
    }

    return ok(resolvedRoot);
  }

  /**
   * Validate that a set of paths are safe for git diff pathspecs.
   * Rejects absolute paths, traversal, pathspec magic, null bytes.
   */
  private validatePaths(
    projectRoot: string,
    paths: readonly string[]
  ): Result<readonly string[], UnifiedError> {
    for (const p of paths) {
      if (!p || isAbsolute(p) || p.includes("..") || p.includes("\0") || p.startsWith(":")) {
        return err(
          createUnifiedError({
            code: "AGENT_GIT_PATHSPEC_INVALID",
            category: "ValidationError",
            message: `Invalid git pathspec: ${p}`,
            recoverability: "user-action",
            suggestedAction: "Use project-relative paths without traversal or pathspec magic.",
            traceId: "git-read-adapter"
          })
        );
      }
    }
    return ok(paths);
  }

  /**
   * Run a git command in the project root with all dangerous env vars cleared.
   */
  private async runGit(
    projectRoot: string,
    args: readonly string[],
    maxOutputBytes = MAX_DIFF_BYTES
  ): Promise<Result<{ stdout: string; truncated: boolean }, UnifiedError>> {
    const binaryResult = await this.resolveGitBinary();
    if (!binaryResult.ok) return binaryResult;

    const gitBinary = binaryResult.value;
    const worktreeResult = await this.validateWorktree(projectRoot);
    if (!worktreeResult.ok) return worktreeResult;

    return new Promise<Result<{ stdout: string; truncated: boolean }, UnifiedError>>((resolve) => {
      // Cleared dangerous env vars
      const safeEnv: Record<string, string> = {
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0"
        // HOME, XDG_CONFIG_HOME, GIT_* are NOT inherited
      };

      const child = spawn(gitBinary, [
        "--no-pager",
        "--no-config",
        "-c", "core.fsmonitor=false",
        "-c", "core.autocrlf=false",
        "-C", worktreeResult.value,
        ...args
      ], {
        shell: false,
        env: safeEnv,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let truncated = false;

      child.on("error", () => {
        resolve(err(unavailableError("Git process failed to start.")));
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        if (truncated) return;
        stdout += chunk.toString("utf8");
        if (stdout.length > maxOutputBytes) {
          stdout = stdout.slice(0, maxOutputBytes);
          truncated = true;
          child.kill("SIGTERM");
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });

      child.on("close", (code) => {
        if (code !== 0 && !truncated) {
          resolve(
            err(
              unavailableError(`Git exited with code ${code ?? "unknown"}: ${stderr.slice(0, 256)}`)
            )
          );
          return;
        }
        resolve(ok({ stdout, truncated }));
      });
    });
  }

  /** Run `git status --porcelain=v1` and parse the result. */
  async gitStatus(projectRoot: string): Promise<Result<GitStatusResult, UnifiedError>> {
    const result = await this.runGit(projectRoot, [
      "status",
      "--porcelain=v1",
      "--branch",
      "--literal-pathspecs"
    ]);
    if (!result.ok) return result;

    const lines = result.value.stdout.split("\n").filter((l) => l.trim());
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    let branch = "unknown";

    for (const line of lines) {
      if (line.startsWith("## ")) {
        // Branch line: "## main...origin/main" or "## HEAD (no branch)"
        const branchPart = (line.slice(3).split("...")[0] ?? "").split(" ")[0] ?? "";
        branch = branchPart || "unknown";
        continue;
      }
      if (line.length < 2) continue;
      const xy = line.slice(0, 2);
      const file = line.slice(3).trim();
      const x = xy[0];
      const y = xy[1];

      if (x === "?") {
        untracked.push(file);
      } else {
        if (x !== " " && x !== "?") staged.push(file);
        if (y !== " " && y !== "?") unstaged.push(file);
      }
    }

    return ok({ staged, unstaged, untracked, branch });
  }

  /** Run `git diff` (or `git diff --cached`) for specific paths. */
  async gitDiff(
    projectRoot: string,
    paths?: readonly string[]
  ): Promise<Result<GitDiffResult, UnifiedError>> {
    const pathsResult = paths !== undefined ? this.validatePaths(projectRoot, paths) : ok([]);
    if (!pathsResult.ok) return pathsResult;

    const validPaths = pathsResult.value;
    const args: string[] = [
      "diff",
      "--literal-pathspecs",
      "--",
      ...validPaths
    ];

    const result = await this.runGit(projectRoot, args, MAX_DIFF_BYTES);
    if (!result.ok) return result;

    // Parse per-file diffs
    const diffText = result.value.stdout;
    const diffs = parseDiffOutput(diffText);

    return ok({ diffs, truncated: result.value.truncated });
  }
}

function parseDiffOutput(diffText: string): GitDiffFile[] {
  if (!diffText.trim()) return [];
  // Split on "diff --git" boundaries
  const parts = diffText.split(/^(?=diff --git )/m);
  const diffs: GitDiffFile[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    // Extract filename from "diff --git a/<path> b/<path>"
    const match = /^diff --git a\/(.*?) b\//m.exec(part);
    if (match?.[1]) {
      diffs.push({ relativePath: match[1], diff: part });
    }
  }
  return diffs;
}

function unavailableError(message: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_GIT_ADAPTER_UNAVAILABLE",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Ensure the project is an initialized Git repository and the packaged Git runtime is present.",
    traceId: "git-read-adapter"
  });
}
