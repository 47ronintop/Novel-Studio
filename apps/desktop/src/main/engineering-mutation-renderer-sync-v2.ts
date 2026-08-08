import { randomBytes } from "node:crypto";

import { validateEngineeringRelativePath } from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export const ENGINEERING_MUTATION_RENDERER_SYNC_EVENT =
  "application:engineering-mutation-sync-request" as const;

export interface EngineeringMutationRendererSyncRequestV2 {
  readonly schemaVersion: "2.0";
  readonly requestId: string;
  readonly operationKind: "replace_file" | "create_file";
  readonly relativePaths: readonly string[];
}

export interface EngineeringMutationRendererSyncCompletionV2 {
  readonly schemaVersion: "2.0";
  readonly requestId: string;
  readonly status: "synchronized" | "failed";
}

export interface EngineeringMutationRendererSyncTargetV2 {
  send(channel: typeof ENGINEERING_MUTATION_RENDERER_SYNC_EVENT, payload: unknown): void;
}

export interface EngineeringMutationRendererSyncCoordinatorV2 {
  request(input: {
    readonly operationKind: "replace_file" | "create_file";
    readonly relativePaths: readonly string[];
  }): Promise<Result<void, UnifiedError>>;
  complete(input: unknown): Result<void, UnifiedError>;
  dispose(): void;
}

/** Main owns the one-shot request; the ordinary Renderer can only acknowledge its opaque id. */
export function createEngineeringMutationRendererSyncCoordinatorV2(options: {
  readonly resolveTarget: () => EngineeringMutationRendererSyncTargetV2 | undefined;
  readonly timeoutMs?: number;
  readonly createRequestId?: () => string;
}): EngineeringMutationRendererSyncCoordinatorV2 {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const createRequestId =
    options.createRequestId ?? (() => `engineering_sync_${randomBytes(24).toString("hex")}`);
  let pending:
    | {
        readonly request: EngineeringMutationRendererSyncRequestV2;
        readonly finish: (result: Result<void, UnifiedError>) => void;
        readonly timer: NodeJS.Timeout;
      }
    | undefined;

  async function request(input: {
    readonly operationKind: "replace_file" | "create_file";
    readonly relativePaths: readonly string[];
  }): Promise<Result<void, UnifiedError>> {
    if (pending !== undefined) return failure("ENGINEERING_MUTATION_RENDERER_SYNC_BUSY");
    const relativePaths = canonicalPaths(input.relativePaths);
    const requestId = createRequestId();
    const target = options.resolveTarget();
    if (
      relativePaths === undefined ||
      (input.operationKind !== "replace_file" && input.operationKind !== "create_file") ||
      !/^engineering_sync_[a-f0-9]{48}$/u.test(requestId) ||
      target === undefined
    ) {
      return failure("ENGINEERING_MUTATION_RENDERER_SYNC_UNAVAILABLE");
    }
    const payload = Object.freeze({
      schemaVersion: "2.0" as const,
      requestId,
      operationKind: input.operationKind,
      relativePaths
    });
    return await new Promise<Result<void, UnifiedError>>((resolve) => {
      const timer = setTimeout(() => {
        if (pending?.request.requestId !== requestId) return;
        pending = undefined;
        resolve(failure("ENGINEERING_MUTATION_RENDERER_SYNC_TIMEOUT"));
      }, timeoutMs);
      pending = { request: payload, finish: resolve, timer };
      try {
        target.send(ENGINEERING_MUTATION_RENDERER_SYNC_EVENT, payload);
      } catch {
        clearTimeout(timer);
        pending = undefined;
        resolve(failure("ENGINEERING_MUTATION_RENDERER_SYNC_UNAVAILABLE"));
      }
    });
  }

  function complete(input: unknown): Result<void, UnifiedError> {
    if (!isCompletion(input) || pending?.request.requestId !== input.requestId) {
      return failure("ENGINEERING_MUTATION_RENDERER_SYNC_COMPLETION_REJECTED");
    }
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    const result =
      input.status === "synchronized"
        ? ok(undefined)
        : failure("ENGINEERING_MUTATION_RENDERER_SYNC_FAILED");
    current.finish(result);
    return ok(undefined);
  }

  function dispose(): void {
    if (pending === undefined) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    current.finish(failure("ENGINEERING_MUTATION_RENDERER_SYNC_UNAVAILABLE"));
  }

  return Object.freeze({ request, complete, dispose });
}

function canonicalPaths(value: readonly string[]): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return undefined;
  const paths: string[] = [];
  for (const candidate of value) {
    const validated = validateEngineeringRelativePath(candidate);
    if (!validated.ok) return undefined;
    paths.push(validated.relativeIdentity);
  }
  return new Set(paths).size === paths.length
    ? Object.freeze(paths.sort((left, right) => left.localeCompare(right)))
    : undefined;
}

function isCompletion(value: unknown): value is EngineeringMutationRendererSyncCompletionV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 3 &&
    keys[0] === "requestId" &&
    keys[1] === "schemaVersion" &&
    keys[2] === "status" &&
    record["schemaVersion"] === "2.0" &&
    typeof record["requestId"] === "string" &&
    /^engineering_sync_[a-f0-9]{48}$/u.test(record["requestId"]) &&
    (record["status"] === "synchronized" || record["status"] === "failed")
  );
}

function failure<T = never>(code: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "StorageError",
      message: "Engineering editor/tree synchronization did not complete.",
      recoverability: "user-action",
      suggestedAction: "Keep this root mutation-blocked until Main completes synchronization.",
      traceId: "engineering-mutation-renderer-sync-v2"
    })
  );
}
