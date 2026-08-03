import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseApprovalDecisionProofV1,
  parseApprovalDecisionProofV1Json,
  serializeApprovalDecisionProofV1,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  withProjectFileLock,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";

export interface ApprovalDecisionProofFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly atomicWriter?: typeof writeTextAtomically;
}

/**
 * Immutable Main-only approval-proof storage. Proof records are intentionally separate from the
 * Change Set so all consumers bind to one canonical audit record rather than copying its facts.
 */
export class ApprovalDecisionProofFileRepository {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly atomicWriter: typeof writeTextAtomically;
  private readonly writeQueues = new Map<
    string,
    Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>>
  >();

  public constructor(private readonly options: ApprovalDecisionProofFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_approval_decision_proof";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
    this.atomicWriter = options.atomicWriter ?? writeTextAtomically;
  }

  public writeApprovalDecisionProof(
    runId: string,
    value: MainOnlyApprovalDecisionProofV1
  ): Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>> {
    let proof: MainOnlyApprovalDecisionProofV1;
    try {
      proof = parseApprovalDecisionProofV1(value);
    } catch {
      return Promise.resolve(this.invalidProof());
    }
    if (!isSafeId(runId) || !isSafeId(proof.proofId) || proof.binding.runId !== runId) {
      return Promise.resolve(this.invalidProof());
    }
    const targetPath = this.proofPath(runId, proof.proofId);
    return this.queueWrite(targetPath, () =>
      withProjectFileLock(
        {
          lockPath: this.lockPath(),
          pathGuard: this.pathGuard,
          traceId: this.traceId
        },
        () => this.writeImmutableProof(targetPath, proof)
      )
    );
  }

  public async readApprovalDecisionProof(
    runId: string,
    proofId: string
  ): Promise<Result<MainOnlyApprovalDecisionProofV1 | undefined, UnifiedError>> {
    if (!isSafeId(runId) || !isSafeId(proofId)) return this.invalidProof();
    const stored = await this.readStoredText(this.proofPath(runId, proofId));
    if (!stored.ok) return stored;
    if (stored.value === undefined) return ok(undefined);
    return this.parseStoredProof(stored.value, runId, proofId);
  }

  private queueWrite(
    path: string,
    operation: () => Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>>
  ): Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>> {
    const previous = this.writeQueues.get(path);
    const request = previous === undefined ? operation() : previous.then(operation, operation);
    this.writeQueues.set(path, request);
    const clear = () => {
      if (this.writeQueues.get(path) === request) this.writeQueues.delete(path);
    };
    void request.then(clear, clear);
    return request;
  }

  private async writeImmutableProof(
    path: string,
    proof: MainOnlyApprovalDecisionProofV1
  ): Promise<Result<MainOnlyApprovalDecisionProofV1, UnifiedError>> {
    const content = serializeApprovalDecisionProofV1(proof);
    const existing = await this.readStoredText(path);
    if (!existing.ok) return existing as Result<MainOnlyApprovalDecisionProofV1, UnifiedError>;
    if (existing.value !== undefined) {
      const parsed = this.parseStoredProof(existing.value, proof.binding.runId, proof.proofId);
      if (!parsed.ok) return parsed;
      return existing.value === content ? ok(parsed.value) : this.conflict();
    }

    let concurrentlyPersisted: MainOnlyApprovalDecisionProofV1 | undefined;
    const written = await this.atomicWriter({
      targetPath: path,
      content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () => {
        const latest = await this.readStoredText(path);
        if (!latest.ok) return latest as Result<void, UnifiedError>;
        if (latest.value === undefined) return ok(undefined);
        const parsed = this.parseStoredProof(latest.value, proof.binding.runId, proof.proofId);
        if (!parsed.ok) return parsed as Result<void, UnifiedError>;
        if (latest.value === content) concurrentlyPersisted = parsed.value;
        return this.conflict();
      }
    });
    if (concurrentlyPersisted !== undefined) return ok(concurrentlyPersisted);
    return written.ok ? ok(proof) : written;
  }

  private async readStoredText(path: string): Promise<Result<string | undefined, UnifiedError>> {
    const pathCheck = await verifyProjectStoragePath(this.pathGuard, path, this.traceId);
    if (!pathCheck.ok) return pathCheck;
    try {
      return ok(await readFile(path, "utf8"));
    } catch (error) {
      if (isMissingFileError(error)) return ok(undefined);
      return this.storageFailure("APPROVAL_DECISION_PROOF_READ_FAILED");
    }
  }

  private parseStoredProof(
    content: string,
    runId: string,
    proofId: string
  ): Result<MainOnlyApprovalDecisionProofV1, UnifiedError> {
    try {
      const proof = parseApprovalDecisionProofV1Json(content);
      if (proof.binding.runId !== runId || proof.proofId !== proofId) return this.corruptProof();
      return ok(proof);
    } catch {
      return this.corruptProof();
    }
  }

  private proofPath(runId: string, proofId: string): string {
    return join(
      this.options.projectRoot,
      "history",
      "agent-runs",
      runId,
      "approval-decision-proofs",
      `${proofId}.json`
    );
  }

  private lockPath(): string {
    return join(
      this.options.projectRoot,
      "history",
      "agent-runs",
      ".approval-decision-proofs.lock"
    );
  }

  private invalidProof<T = never>(): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code: "APPROVAL_DECISION_PROOF_INVALID",
        category: "ValidationError",
        message: "The approval decision proof is invalid.",
        recoverability: "user-action",
        suggestedAction: "Regenerate the frozen proposal before continuing.",
        traceId: this.traceId
      })
    );
  }

  private corruptProof<T = never>(): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code: "APPROVAL_DECISION_PROOF_CORRUPT",
        category: "StorageError",
        message: "The stored approval decision proof is invalid.",
        recoverability: "user-action",
        suggestedAction: "Discard the corrupt run record and regenerate the proposal.",
        traceId: this.traceId
      })
    );
  }

  private conflict<T = never>(): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code: "APPROVAL_DECISION_PROOF_CONFLICT",
        category: "StorageError",
        message: "A different approval decision proof already exists for this ID.",
        recoverability: "user-action",
        suggestedAction: "Use the existing frozen proposal or create a new proof ID.",
        traceId: this.traceId
      })
    );
  }

  private storageFailure<T = never>(code: string): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code,
        category: "StorageError",
        message: "Approval decision proof storage could not be read.",
        recoverability: "user-action",
        suggestedAction: "Check project storage permissions and retry.",
        traceId: this.traceId
      })
    );
  }
}

export { ApprovalDecisionProofFileRepository as ApprovalDecisionProofRepository };

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
