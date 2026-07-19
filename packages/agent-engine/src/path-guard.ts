import { extname, isAbsolute } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface AgentRelativePath {
  readonly relativePath: string;
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
const windowsDeviceNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function validateAgentRelativePath(input: string): Result<AgentRelativePath, UnifiedError> {
  const path = input.trim();
  const segments = path.split("/");
  const rejected =
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.includes(":") ||
    isAbsolute(path) ||
    path.startsWith("//") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => windowsDeviceNames.test(segment)) ||
    blockedRoots.has((segments[0] ?? "").toLowerCase()) ||
    !allowedExtensions.has(extname(path).toLowerCase());

  if (rejected) {
    return err(
      createUnifiedError({
        code: "AGENT_PATH_REJECTED",
        category: "ValidationError",
        message: "The Agent file path is outside the allowed project text boundary.",
        recoverability: "user-action",
        suggestedAction: "Use a canonical project-relative path to an allowed text file.",
        traceId: "agent-path-guard",
        redactedDetail: { relativePath: redactPath(path) }
      })
    );
  }

  return ok({ relativePath: path });
}

function redactPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
}
