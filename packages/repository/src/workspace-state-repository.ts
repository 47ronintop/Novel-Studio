import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { storageError, validationError } from "./errors.js";

export interface WorkspaceStateFileRepositoryOptions {
  readonly userDataRoot: string;
  readonly traceId?: string;
}

export class WorkspaceStateFileRepository {
  private readonly traceId: string;

  public constructor(private readonly options: WorkspaceStateFileRepositoryOptions) {
    this.traceId = options.traceId ?? "workspace-state-repository";
  }

  public async resolveState(
    canonicalContentRoot: string
  ): Promise<Result<{ readonly workspaceId: string; readonly stateRoot: string }, UnifiedError>> {
    if (!isAbsolute(canonicalContentRoot)) return this.contentRootRejected();

    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(canonicalContentRoot);
      const rootStats = await lstat(resolvedRoot);
      if (!rootStats.isDirectory() || !samePath(resolvedRoot, canonicalContentRoot)) {
        return this.contentRootRejected();
      }
    } catch {
      return this.contentRootRejected();
    }

    const digest = createHash("sha256").update(resolvedRoot, "utf8").digest("hex");
    const workspaceId = `ws_${digest.slice(0, 24)}`;
    const stateRoot = join(this.options.userDataRoot, "workspaces", workspaceId);
    try {
      await mkdir(stateRoot, { recursive: true });
      return ok({ workspaceId, stateRoot });
    } catch {
      return err(
        storageError({
          code: "WORKSPACE_STATE_ROOT_CREATE_FAILED",
          message: "Workspace state storage could not be created.",
          suggestedAction:
            "Check application data permissions and try opening the workspace again.",
          traceId: this.traceId
        })
      );
    }
  }

  private contentRootRejected(): Result<never, UnifiedError> {
    return err(
      validationError({
        code: "WORKSPACE_STATE_CONTENT_ROOT_REJECTED",
        message: "The workspace content root is missing or is not canonical.",
        suggestedAction: "Choose an existing workspace folder and try again.",
        traceId: this.traceId
      })
    );
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}
