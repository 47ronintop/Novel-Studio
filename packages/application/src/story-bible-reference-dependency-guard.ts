import {
  buildApprovalDecisionProofRefV1,
  canonicalizeApprovalDecisionProofJson,
  checksumChangeSetText,
  type ApprovalDecisionProofRefV1,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

/**
 * Main-only snapshot of a managed resource whose current editor state was used to establish a
 * Story Bible reference-impact proof. Asset/resource IDs are deliberately never provider data.
 */
export interface StoryBibleReferenceDependencyV1 {
  readonly resourceKind: "story_bible" | "chapter";
  readonly resourceId: string;
  readonly revision: number;
  readonly checksum: string;
}

/** Durable sidecar, keyed by an approval proof rather than embedded in provider-visible Change Set data. */
export interface StoryBibleReferenceDependencyBindingV1 {
  readonly schemaVersion: "1.0";
  readonly proofId: string;
  readonly proofChecksum: string;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  /** Recomputable Main-only link to the exact proof binding, not a provider projection. */
  readonly referenceImpactComposite: {
    readonly proposalReferenceImpactChecksums: readonly string[];
    readonly dependencyChecksum: string;
  };
  readonly dependencyChecksum: string;
  readonly dependencies: readonly StoryBibleReferenceDependencyV1[];
  /** Checksum of every preceding field; this is the durable sidecar identity. */
  readonly bindingChecksum: string;
}

export interface CreateStoryBibleReferenceDependencyBindingInput {
  readonly proofRef: ApprovalDecisionProofRefV1;
  readonly runId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly proposalReferenceImpactChecksums: readonly string[];
  readonly dependencies: readonly StoryBibleReferenceDependencyV1[];
}

export interface StoryBibleReferenceDependencyBindingRepositoryPort {
  writeStoryBibleReferenceDependencyBinding(
    binding: StoryBibleReferenceDependencyBindingV1
  ): Promise<Result<StoryBibleReferenceDependencyBindingV1, UnifiedError>>;
  readStoryBibleReferenceDependencyBinding(input: {
    readonly runId: string;
    readonly proofId: string;
    readonly proofChecksum: string;
  }): Promise<Result<StoryBibleReferenceDependencyBindingV1 | undefined, UnifiedError>>;
  /** Atomically claims a sidecar for one apply attempt. A repeated claim must fail. */
  claimStoryBibleReferenceDependencyBinding(input: {
    readonly binding: StoryBibleReferenceDependencyBindingV1;
    readonly applyAttemptId: string;
  }): Promise<Result<void, UnifiedError>>;
}

/** Main-owned editor state; renderer/provider values must not implement this port. */
export interface StoryBibleReferenceDependencyEditorStatePort {
  readManagedResourceState(dependency: StoryBibleReferenceDependencyV1): Promise<
    Result<
      {
        readonly state: "clean" | "dirty" | "unknown";
        readonly revision?: number;
        readonly checksum?: string;
      },
      UnifiedError
    >
  >;
}

export interface StoryBibleReferenceDependencyProofReaderPort {
  readApprovalDecisionProof(input: {
    readonly runId: string;
    readonly proofId: string;
  }): Promise<Result<MainOnlyApprovalDecisionProofV1 | undefined, UnifiedError>>;
}

export interface StoryBibleReferenceDependencyApplyGuard {
  verifyAndClaim(input: {
    readonly proofRef: ApprovalDecisionProofRefV1;
    readonly runId: string;
    readonly changeSetId: string;
    readonly revision: number;
    readonly checksum: string;
    readonly applyAttemptId: string;
  }): Promise<Result<void, UnifiedError>>;
}

export interface CreateStoryBibleReferenceDependencyApplyGuardOptions {
  readonly repository: StoryBibleReferenceDependencyBindingRepositoryPort;
  readonly editorStates: StoryBibleReferenceDependencyEditorStatePort;
  readonly proofs: StoryBibleReferenceDependencyProofReaderPort;
}

export function createStoryBibleReferenceDependencyBinding(
  input: CreateStoryBibleReferenceDependencyBindingInput
): Result<StoryBibleReferenceDependencyBindingV1, UnifiedError> {
  if (
    !isProofRef(input.proofRef) ||
    !isIdentifier(input.runId) ||
    !isIdentifier(input.changeSetId) ||
    !Number.isSafeInteger(input.changeSetRevision) ||
    input.changeSetRevision < 1 ||
    !isChecksum(input.changeSetChecksum) ||
    !isChecksumArray(input.proposalReferenceImpactChecksums)
  ) {
    return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_INVALID"));
  }
  const dependencies = canonicalDependencies(input.dependencies);
  if (dependencies === undefined) {
    return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_INVALID"));
  }
  const dependencyChecksum = checksumCanonical(dependencies);
  const referenceImpactComposite = {
    proposalReferenceImpactChecksums: [...input.proposalReferenceImpactChecksums].sort(),
    dependencyChecksum
  };
  const withoutChecksum = {
    schemaVersion: "1.0" as const,
    proofId: input.proofRef.proofId,
    proofChecksum: input.proofRef.proofChecksum,
    runId: input.runId,
    changeSetId: input.changeSetId,
    changeSetRevision: input.changeSetRevision,
    changeSetChecksum: input.changeSetChecksum,
    referenceImpactComposite,
    dependencyChecksum,
    dependencies
  };
  return ok({ ...withoutChecksum, bindingChecksum: checksumCanonical(withoutChecksum) });
}

export function createStoryBibleReferenceDependencyApplyGuard(
  options: CreateStoryBibleReferenceDependencyApplyGuardOptions
): StoryBibleReferenceDependencyApplyGuard {
  return {
    async verifyAndClaim(input) {
      if (
        !isProofRef(input.proofRef) ||
        !isIdentifier(input.runId) ||
        !isIdentifier(input.changeSetId) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 1 ||
        !isChecksum(input.checksum) ||
        !isIdentifier(input.applyAttemptId)
      ) {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_GUARD_INVALID"));
      }
      const read = await options.repository.readStoryBibleReferenceDependencyBinding({
        runId: input.runId,
        ...input.proofRef
      });
      if (!read.ok) return read;
      if (read.value === undefined || !isBinding(read.value)) {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_MISSING"));
      }
      const binding = read.value;
      if (
        binding.proofId !== input.proofRef.proofId ||
        binding.proofChecksum !== input.proofRef.proofChecksum ||
        binding.runId !== input.runId ||
        binding.changeSetId !== input.changeSetId ||
        binding.changeSetRevision !== input.revision ||
        binding.changeSetChecksum !== input.checksum
      ) {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_STALE"));
      }
      const proof = await options.proofs.readApprovalDecisionProof({
        runId: input.runId,
        proofId: input.proofRef.proofId
      });
      if (!proof.ok) return proof;
      if (proof.value === undefined) {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_PROOF_MISSING"));
      }
      let proofRef: ApprovalDecisionProofRefV1;
      try {
        proofRef = buildApprovalDecisionProofRefV1(proof.value);
      } catch {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_PROOF_INVALID"));
      }
      if (
        proofRef.proofChecksum !== input.proofRef.proofChecksum ||
        proof.value.binding.runId !== input.runId ||
        proof.value.binding.changeSetId !== input.changeSetId ||
        proof.value.binding.changeSetRevision !== input.revision ||
        proof.value.binding.changeSetChecksum !== input.checksum ||
        proof.value.binding.referenceImpactChecksum !==
          checksumCanonical(binding.referenceImpactComposite)
      ) {
        return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_PROOF_STALE"));
      }
      for (const dependency of binding.dependencies) {
        const state = await options.editorStates.readManagedResourceState(dependency);
        if (!state.ok) return state;
        if (state.value.state === "unknown") {
          return err(dependencyError("EDITOR_STATE_UNKNOWN"));
        }
        if (state.value.state === "dirty") {
          return err(dependencyError("TARGET_DIRTY"));
        }
        if (
          state.value.revision !== dependency.revision ||
          state.value.checksum !== dependency.checksum
        ) {
          return err(dependencyError("STORY_BIBLE_REFERENCE_DEPENDENCY_STALE"));
        }
      }
      return options.repository.claimStoryBibleReferenceDependencyBinding({
        binding,
        applyAttemptId: input.applyAttemptId
      });
    }
  };
}

export function checksumStoryBibleReferenceDependencies(
  dependencies: readonly StoryBibleReferenceDependencyV1[]
): string | undefined {
  const canonical = canonicalDependencies(dependencies);
  return canonical === undefined ? undefined : checksumCanonical(canonical);
}

function isBinding(value: StoryBibleReferenceDependencyBindingV1): boolean {
  const rebuilt = createStoryBibleReferenceDependencyBinding({
    proofRef: { proofId: value.proofId, proofChecksum: value.proofChecksum },
    runId: value.runId,
    changeSetId: value.changeSetId,
    changeSetRevision: value.changeSetRevision,
    changeSetChecksum: value.changeSetChecksum,
    proposalReferenceImpactChecksums:
      value.referenceImpactComposite.proposalReferenceImpactChecksums,
    dependencies: value.dependencies
  });
  return (
    rebuilt.ok &&
    rebuilt.value.dependencyChecksum === value.dependencyChecksum &&
    rebuilt.value.bindingChecksum === value.bindingChecksum
  );
}

function canonicalDependencies(
  dependencies: readonly StoryBibleReferenceDependencyV1[]
): readonly StoryBibleReferenceDependencyV1[] | undefined {
  if (dependencies.length > 512 || !dependencies.every(isDependency)) return undefined;
  const canonical = [...dependencies]
    .map((dependency) => ({ ...dependency }))
    .sort((left, right) => dependencyKey(left).localeCompare(dependencyKey(right), "en"));
  return canonical.some((item, index) => {
    const previous = canonical[index - 1];
    return index > 0 && previous !== undefined && dependencyKey(item) === dependencyKey(previous);
  })
    ? undefined
    : Object.freeze(canonical);
}

function isDependency(value: StoryBibleReferenceDependencyV1): boolean {
  return (
    (value.resourceKind === "story_bible" || value.resourceKind === "chapter") &&
    isIdentifier(value.resourceId) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    isChecksum(value.checksum)
  );
}

function isChecksumArray(value: readonly string[]): boolean {
  return value.length <= 128 && value.every(isChecksum);
}

function dependencyKey(value: StoryBibleReferenceDependencyV1): string {
  return `${value.resourceKind}\u0000${value.resourceId}`;
}

function isProofRef(value: ApprovalDecisionProofRefV1): boolean {
  return isIdentifier(value.proofId) && isChecksum(value.proofChecksum);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/u.test(value);
}

function isChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function checksumCanonical(value: unknown): string {
  return checksumChangeSetText(canonicalizeApprovalDecisionProofJson(value));
}

function dependencyError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Story Bible reference dependency validation failed.",
    recoverability: "user-action",
    suggestedAction: "Save or discard affected editors, then regenerate the Story Bible proposal.",
    traceId: "story-bible-reference-dependency-guard"
  });
}
