import { createUnifiedError, ok, err, type Result, type UnifiedError } from "@novel-studio/shared";
import { resolve, sep } from "node:path";

/** Git status result wrapped in untrusted_project_data. */
export interface AgentGitStatusResult {
  readonly kind: "untrusted_project_data";
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly branch: string;
}

/** Git diff result wrapped in untrusted_project_data. */
export interface AgentGitDiffResult {
  readonly kind: "untrusted_project_data";
  readonly diffs: readonly { readonly relativePath: string; readonly diff: string }[];
  readonly truncated: boolean;
}

/** Minimal git adapter interface consumed by AgentGitToolSession. */
export interface GitReadAdapterPort {
  gitStatus(projectRoot: string): Promise<
    Result<
      {
        readonly staged: readonly string[];
        readonly unstaged: readonly string[];
        readonly untracked: readonly string[];
        readonly branch: string;
      },
      UnifiedError
    >
  >;
  gitDiff(
    projectRoot: string,
    paths?: readonly string[]
  ): Promise<
    Result<
      {
        readonly diffs: readonly { readonly relativePath: string; readonly diff: string }[];
        readonly truncated: boolean;
      },
      UnifiedError
    >
  >;
}

export interface AgentGitToolSession {
  gitStatus(projectPath: string): Promise<Result<AgentGitStatusResult, UnifiedError>>;
  gitDiff(
    projectPath: string,
    paths?: readonly string[]
  ): Promise<Result<AgentGitDiffResult, UnifiedError>>;
}

export interface CreateAgentGitToolSessionOptions {
  readonly gitAdapter: GitReadAdapterPort;
  readonly projectRoot: string;
}

export function createAgentGitToolSession(
  options: CreateAgentGitToolSessionOptions
): AgentGitToolSession {
  function validateProjectPath(projectPath: string): Result<void, UnifiedError> {
    const resolved = resolve(projectPath);
    const rootResolved = resolve(options.projectRoot);
    if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) {
      return err(
        createUnifiedError({
          code: "AGENT_GIT_PATH_OUTSIDE_ROOT",
          category: "ValidationError",
          message: "Git operation path must be within the project root.",
          recoverability: "user-action",
          suggestedAction: "Use the project's root directory or a sub-path within it.",
          traceId: "agent-git-tool-session"
        })
      );
    }
    return ok(undefined);
  }

  return {
    async gitStatus(projectPath) {
      const validation = validateProjectPath(projectPath);
      if (!validation.ok) return validation;

      const result = await options.gitAdapter.gitStatus(projectPath);
      if (!result.ok) return result;

      return ok({
        kind: "untrusted_project_data" as const,
        staged: result.value.staged,
        unstaged: result.value.unstaged,
        untracked: result.value.untracked,
        branch: result.value.branch
      });
    },

    async gitDiff(projectPath, paths) {
      const validation = validateProjectPath(projectPath);
      if (!validation.ok) return validation;

      if (paths !== undefined) {
        for (const p of paths) {
          if (p.includes("..") || p.includes("\0") || p.startsWith("/") || p.startsWith(":")) {
            return err(
              createUnifiedError({
                code: "AGENT_GIT_PATHSPEC_INVALID",
                category: "ValidationError",
                message: `Invalid pathspec: ${p}`,
                recoverability: "user-action",
                suggestedAction: "Use project-relative paths without traversal.",
                traceId: "agent-git-tool-session"
              })
            );
          }
        }
      }

      const result = await options.gitAdapter.gitDiff(projectPath, paths);
      if (!result.ok) return result;

      return ok({
        kind: "untrusted_project_data" as const,
        diffs: result.value.diffs,
        truncated: result.value.truncated
      });
    }
  };
}
