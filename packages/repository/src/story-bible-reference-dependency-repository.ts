import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  canonicalizeApprovalDecisionProofJson,
  checksumChangeSetText
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  withProjectFileLock,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";

export interface StoryBibleReferenceDependencyFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
  readonly atomicWriter?: typeof writeTextAtomically;
  readonly now?: () => Date;
}

/** Structural counterpart of the Application Main-only dependency sidecar contract. */
export interface StoryBibleReferenceDependencyRecordV1 {
  readonly resourceKind: "story_bible" | "chapter";
  readonly resourceId: string;
  readonly revision: number;
  readonly checksum: string;
}

export interface StoryBibleReferenceDependencyBindingRecordV1 {
  readonly schemaVersion: "1.0";
  readonly proofId: string;
  readonly proofChecksum: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly referenceImpactComposite: {
    readonly proposalReferenceImpactChecksums: readonly string[];
    readonly dependencyChecksum: string;
  };
  readonly dependencyChecksum: string;
  readonly dependencies: readonly StoryBibleReferenceDependencyRecordV1[];
  readonly bindingChecksum: string;
}

interface StoryBibleReferenceDependencyClaimV1 {
  readonly schemaVersion: "1.0";
  readonly proofId: string;
  readonly proofChecksum: string;
  readonly bindingChecksum: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly applyAttemptId: string;
  readonly claimedAt: string;
}

/**
 * Immutable dependency sidecars and one-way apply claims. The claim lives independently from the
 * process so a restarted Main process still rejects a replayed proof.
 */
export class StoryBibleReferenceDependencyFileRepository {
  private readonly traceId: string;
  private readonly pathGuard: ProjectPathGuard;
  private readonly atomicWriter: typeof writeTextAtomically;
  private readonly now: () => Date;

  public constructor(private readonly options: StoryBibleReferenceDependencyFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_story_bible_reference_dependency";
    this.pathGuard = createProjectPathGuard(options.projectRoot);
    this.atomicWriter = options.atomicWriter ?? writeTextAtomically;
    this.now = options.now ?? (() => new Date());
  }

  public async writeStoryBibleReferenceDependencyBinding(
    binding: StoryBibleReferenceDependencyBindingRecordV1
  ): Promise<Result<StoryBibleReferenceDependencyBindingRecordV1, UnifiedError>> {
    if (!isBinding(binding)) return this.invalid();
    const path = this.bindingPath(binding.runId, binding.proofId);
    return withProjectFileLock(this.lockInput(), () => this.writeImmutableBinding(path, binding));
  }

  public async readStoryBibleReferenceDependencyBinding(input: {
    readonly runId: string;
    readonly proofId: string;
    readonly proofChecksum: string;
  }): Promise<Result<StoryBibleReferenceDependencyBindingRecordV1 | undefined, UnifiedError>> {
    if (!isSafeId(input.runId) || !isSafeId(input.proofId) || !isChecksum(input.proofChecksum)) {
      return this.invalid();
    }
    const text = await this.readText(this.bindingPath(input.runId, input.proofId));
    if (!text.ok) return text;
    if (text.value === undefined) return ok(undefined);
    const binding = parseBinding(text.value);
    if (
      binding === undefined ||
      binding.runId !== input.runId ||
      binding.proofId !== input.proofId ||
      binding.proofChecksum !== input.proofChecksum
    ) {
      return this.corrupt();
    }
    return ok(binding);
  }

  public async claimStoryBibleReferenceDependencyBinding(input: {
    readonly binding: StoryBibleReferenceDependencyBindingRecordV1;
    readonly applyAttemptId: string;
  }): Promise<Result<void, UnifiedError>> {
    if (!isBinding(input.binding) || !isSafeId(input.applyAttemptId)) return this.invalid();
    const bindingPath = this.bindingPath(input.binding.runId, input.binding.proofId);
    const claimPath = this.claimPath(input.binding.runId, input.binding.proofId);
    return withProjectFileLock(this.lockInput(), async () => {
      const persisted = await this.readText(bindingPath);
      if (!persisted.ok) return persisted as Result<void, UnifiedError>;
      if (persisted.value === undefined) return this.missing();
      const stored = parseBinding(persisted.value);
      if (stored === undefined) return this.corrupt();
      if (stored.bindingChecksum !== input.binding.bindingChecksum) return this.stale();

      const existing = await this.readText(claimPath);
      if (!existing.ok) return existing as Result<void, UnifiedError>;
      if (existing.value !== undefined) {
        return parseClaim(existing.value) === undefined ? this.corruptClaim() : this.replay();
      }
      const claim: StoryBibleReferenceDependencyClaimV1 = {
        schemaVersion: "1.0",
        proofId: stored.proofId,
        proofChecksum: stored.proofChecksum,
        bindingChecksum: stored.bindingChecksum,
        runId: stored.runId,
        changeSetId: stored.changeSetId,
        changeSetRevision: stored.changeSetRevision,
        changeSetChecksum: stored.changeSetChecksum,
        applyAttemptId: input.applyAttemptId,
        claimedAt: this.now().toISOString()
      };
      const content = canonical(claim);
      const written = await this.atomicWriter({
        targetPath: claimPath,
        content,
        traceId: this.traceId,
        pathGuard: this.pathGuard,
        beforeReplace: async () => {
          const latest = await this.readText(claimPath);
          if (!latest.ok) return latest as Result<void, UnifiedError>;
          return latest.value === undefined ? ok(undefined) : this.replay();
        }
      });
      return written.ok ? ok(undefined) : written;
    });
  }

  private async writeImmutableBinding(
    path: string,
    binding: StoryBibleReferenceDependencyBindingRecordV1
  ): Promise<Result<StoryBibleReferenceDependencyBindingRecordV1, UnifiedError>> {
    const content = canonical(binding);
    const existing = await this.readText(path);
    if (!existing.ok)
      return existing as Result<StoryBibleReferenceDependencyBindingRecordV1, UnifiedError>;
    if (existing.value !== undefined) {
      const parsed = parseBinding(existing.value);
      if (parsed === undefined) return this.corrupt();
      return existing.value === content ? ok(parsed) : this.conflict();
    }
    let concurrentlyWritten: StoryBibleReferenceDependencyBindingRecordV1 | undefined;
    const written = await this.atomicWriter({
      targetPath: path,
      content,
      traceId: this.traceId,
      pathGuard: this.pathGuard,
      beforeReplace: async () => {
        const latest = await this.readText(path);
        if (!latest.ok) return latest as Result<void, UnifiedError>;
        if (latest.value === undefined) return ok(undefined);
        const parsed = parseBinding(latest.value);
        if (parsed === undefined) return this.corrupt();
        if (latest.value === content) concurrentlyWritten = parsed;
        return this.conflict();
      }
    });
    if (concurrentlyWritten !== undefined) return ok(concurrentlyWritten);
    return written.ok ? ok(binding) : written;
  }

  private async readText(path: string): Promise<Result<string | undefined, UnifiedError>> {
    const checked = await verifyProjectStoragePath(this.pathGuard, path, this.traceId);
    if (!checked.ok) return checked;
    try {
      return ok(await readFile(path, "utf8"));
    } catch (error) {
      return isMissing(error)
        ? ok(undefined)
        : this.storage("STORY_BIBLE_REFERENCE_DEPENDENCY_READ_FAILED");
    }
  }

  private bindingPath(runId: string, proofId: string): string {
    return join(
      this.options.projectRoot,
      "history",
      "agent-runs",
      runId,
      "story-bible-reference-dependencies",
      `${proofId}.json`
    );
  }

  private claimPath(runId: string, proofId: string): string {
    return join(
      this.options.projectRoot,
      "history",
      "agent-runs",
      runId,
      "story-bible-reference-dependency-claims",
      `${proofId}.json`
    );
  }

  private lockInput() {
    return {
      lockPath: join(
        this.options.projectRoot,
        "history",
        "agent-runs",
        ".story-bible-reference-dependencies.lock"
      ),
      pathGuard: this.pathGuard,
      traceId: this.traceId
    };
  }

  private invalid<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_INVALID", "ValidationError");
  }
  private missing<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_MISSING", "StorageError");
  }
  private corrupt<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_CORRUPT", "StorageError");
  }
  private corruptClaim<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_CLAIM_CORRUPT", "StorageError");
  }
  private stale<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_STALE", "ValidationError");
  }
  private replay<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_REPLAY", "ValidationError");
  }
  private conflict<T = never>(): Result<T, UnifiedError> {
    return this.error("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_CONFLICT", "StorageError");
  }
  private storage<T = never>(code: string): Result<T, UnifiedError> {
    return this.error(code, "StorageError");
  }
  private error<T = never>(
    code: string,
    category: "ValidationError" | "StorageError"
  ): Result<T, UnifiedError> {
    return err(
      createUnifiedError({
        code,
        category,
        message: "Story Bible reference dependency storage could not be validated.",
        recoverability: "user-action",
        suggestedAction: "Regenerate the Story Bible proposal and retry.",
        traceId: this.traceId
      })
    );
  }
}

function parseBinding(value: string): StoryBibleReferenceDependencyBindingRecordV1 | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isBinding(parsed) && canonical(parsed) === value ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseClaim(value: string): StoryBibleReferenceDependencyClaimV1 | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isClaim(parsed) && canonical(parsed) === value ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isBinding(value: unknown): value is StoryBibleReferenceDependencyBindingRecordV1 {
  if (!isRecord(value) || value.schemaVersion !== "1.0") return false;
  const dependencies = value.dependencies;
  if (
    !isSafeId(value.proofId) ||
    !isChecksum(value.proofChecksum) ||
    !isSafeId(value.runId) ||
    !isSafeId(value.changeSetId) ||
    !isRevision(value.changeSetRevision) ||
    !isChecksum(value.changeSetChecksum) ||
    !isRecord(value.referenceImpactComposite) ||
    !Array.isArray(value.referenceImpactComposite.proposalReferenceImpactChecksums) ||
    !value.referenceImpactComposite.proposalReferenceImpactChecksums.every(isChecksum) ||
    value.referenceImpactComposite.proposalReferenceImpactChecksums.length > 128 ||
    !isChecksum(value.referenceImpactComposite.dependencyChecksum) ||
    !isChecksum(value.dependencyChecksum) ||
    !isChecksum(value.bindingChecksum) ||
    !Array.isArray(dependencies) ||
    !dependencies.every(isDependency)
  )
    return false;
  const canonicalDependencies = [...dependencies].sort((left, right) =>
    dependencyKey(left).localeCompare(dependencyKey(right), "en")
  );
  if (
    canonicalDependencies.some((item, index) => {
      const previous = canonicalDependencies[index - 1];
      return index > 0 && previous !== undefined && dependencyKey(item) === dependencyKey(previous);
    })
  )
    return false;
  const expectedDependencyChecksum = checksum(canonicalDependencies);
  const referenceImpactComposite = {
    proposalReferenceImpactChecksums: [
      ...value.referenceImpactComposite.proposalReferenceImpactChecksums
    ].sort(),
    dependencyChecksum: value.referenceImpactComposite.dependencyChecksum
  };
  const withoutChecksum = {
    schemaVersion: "1.0" as const,
    proofId: value.proofId,
    proofChecksum: value.proofChecksum,
    runId: value.runId,
    changeSetId: value.changeSetId,
    changeSetRevision: value.changeSetRevision,
    changeSetChecksum: value.changeSetChecksum,
    referenceImpactComposite,
    dependencyChecksum: value.dependencyChecksum,
    dependencies: canonicalDependencies
  };
  return (
    value.dependencyChecksum === expectedDependencyChecksum &&
    value.referenceImpactComposite.dependencyChecksum === value.dependencyChecksum &&
    value.bindingChecksum === checksum(withoutChecksum)
  );
}

function isClaim(value: unknown): value is StoryBibleReferenceDependencyClaimV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === "1.0" &&
    isSafeId(value.proofId) &&
    isChecksum(value.proofChecksum) &&
    isChecksum(value.bindingChecksum) &&
    isSafeId(value.runId) &&
    isSafeId(value.changeSetId) &&
    isRevision(value.changeSetRevision) &&
    isChecksum(value.changeSetChecksum) &&
    isSafeId(value.applyAttemptId) &&
    typeof value.claimedAt === "string" &&
    Number.isFinite(Date.parse(value.claimedAt))
  );
}

function isDependency(value: unknown): value is StoryBibleReferenceDependencyRecordV1 {
  return (
    isRecord(value) &&
    (value.resourceKind === "story_bible" || value.resourceKind === "chapter") &&
    isSafeId(value.resourceId) &&
    typeof value.revision === "number" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    isChecksum(value.checksum)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}
function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
function dependencyKey(value: StoryBibleReferenceDependencyRecordV1): string {
  return `${value.resourceKind}\u0000${value.resourceId}`;
}
function canonical(value: unknown): string {
  return canonicalizeApprovalDecisionProofJson(value);
}
function checksum(value: unknown): string {
  return checksumChangeSetText(canonical(value));
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export { StoryBibleReferenceDependencyFileRepository as StoryBibleReferenceDependencyRepository };
