import { randomUUID } from "node:crypto";

import {
  canonicalizeApprovalDecisionProofJson,
  checksumChangeSetSelection,
  checksumChangeSetText,
  createMainOnlyApprovalDecisionProofV1,
  providerVisibleApprovalDecisionSummaryV1,
  type ApprovalDecisionProofBindingV1,
  type ApprovalDecisionProofEvidenceV1,
  type ApprovalDecisionProofRefV1,
  type ChangeSet,
  type MainOnlyApprovalDecisionProofV1,
  type ProviderVisibleApprovalDecisionSummaryV1,
  type ProviderVisibleWriteOperation
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { ChangeSetSession } from "./change-set-session.js";
import type { StoryBibleProposalApprovalProof } from "./story-bible-agent-tool-session.js";
import {
  createStoryBibleReferenceDependencyBinding,
  checksumStoryBibleReferenceDependencies,
  type StoryBibleReferenceDependencyBindingRepositoryPort,
  type StoryBibleReferenceDependencyV1
} from "./story-bible-reference-dependency-guard.js";

/**
 * Main-only finalization for the preliminary Story Bible proposal facts produced by the structured
 * tool session. It deliberately stores the resulting reference beside a frozen Change Set revision
 * rather than mutating that revision: putting the ref in the checksummed Change Set would make the
 * proof's own binding circular.
 */
export interface StoryBibleApprovalProofSession {
  readonly referenceDependenciesRequired: boolean;
  finalize(
    input: FinalizeStoryBibleApprovalProofInput
  ): Promise<Result<StoryBibleApprovalProofFinalization, UnifiedError>>;
}

export interface CreateStoryBibleApprovalProofSessionOptions {
  readonly changeSets: Pick<ChangeSetSession, "readChangeSet" | "persistApprovalDecisionProof">;
  /**
   * Main-only durable store for editor/reference dependencies. Production composition must provide
   * this together with the corresponding apply guard; omitted only for historical/test readers.
   */
  readonly referenceDependencyRepository?: Pick<
    StoryBibleReferenceDependencyBindingRepositoryPort,
    "writeStoryBibleReferenceDependencyBinding"
  >;
  readonly createProofId?: () => string;
}

export interface FinalizeStoryBibleApprovalProofInput {
  /** Exact immutable Change Set identity shown to the user. */
  readonly runId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  /** A group is mandatory for coordinated changes such as an explicit inverse. */
  readonly consistencyGroupId?: string;
  readonly groupKind?: "ordinary" | "explicit_inverse";
  /** App-owned facts from the structured proposal session, never renderer/model input. */
  readonly proposals: readonly StoryBibleProposalApprovalProof[];
  /** Main-derived managed resources whose clean revisions were used by reference-impact analysis. */
  readonly referenceDependencies?: readonly StoryBibleReferenceDependencyV1[];
  /** Frozen catalog/rule identity for this execution run. */
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly providerSemanticVersionSetChecksum?: string;
  /** Main-only workspace/policy/catalog bindings. */
  readonly workspaceBindingId: string;
  readonly rootBindingId?: string;
  readonly recoveryRootBindingId?: string;
  readonly recoveryGrantRevision?: string;
  readonly policyRevision: string;
  /** Must be the frozen tool-catalog/capability revision, not a renderer value. */
  readonly capabilityRevision: string;
  readonly pathClass: ApprovalDecisionProofEvidenceV1["pathClass"];
  readonly targetFreshness: ApprovalDecisionProofEvidenceV1["targetFreshness"];
  readonly baseManifestChecksum?: string;
  readonly candidateManifestChecksum?: string;
  readonly recoverySideEffectChecksum?: string;
}

export interface StoryBibleApprovalProofFinalization {
  readonly proofRef: ApprovalDecisionProofRefV1;
  readonly providerSummary: ProviderVisibleApprovalDecisionSummaryV1;
}

export function createStoryBibleApprovalProofSession(
  options: CreateStoryBibleApprovalProofSessionOptions
): StoryBibleApprovalProofSession {
  const createProofId =
    options.createProofId ?? (() => `proof_story_bible_${randomUUID().replaceAll("-", "")}`);

  return {
    referenceDependenciesRequired: options.referenceDependencyRepository !== undefined,
    async finalize(input) {
      const inputError = validateInputShape(input);
      if (inputError !== undefined) return err(inputError);
      if (
        options.referenceDependencyRepository !== undefined &&
        input.referenceDependencies === undefined
      ) {
        return err(proofError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_REQUIRED"));
      }

      const stored = await options.changeSets.readChangeSet(input.changeSetId, input.revision);
      if (!stored.ok) return stored;
      const changeSet = stored.value;
      const bindingError = validateFrozenChangeSet(changeSet, input);
      if (bindingError !== undefined) return err(bindingError);

      const proofFacts = normalizeProposalFacts(input.proposals, input.groupKind ?? "ordinary");
      if (!proofFacts.ok) return proofFacts;
      const selection = selectedGroupBinding(changeSet, input.consistencyGroupId);
      if (!selection.ok) return selection;
      const dependencyChecksum =
        input.referenceDependencies === undefined
          ? undefined
          : checksumStoryBibleReferenceDependencies(input.referenceDependencies);
      if (input.referenceDependencies !== undefined && dependencyChecksum === undefined) {
        return err(proofError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_INVALID"));
      }

      const binding: ApprovalDecisionProofBindingV1 = {
        workspaceBindingId: input.workspaceBindingId,
        ...(input.rootBindingId === undefined ? {} : { rootBindingId: input.rootBindingId }),
        ...(input.recoveryRootBindingId === undefined
          ? {}
          : { recoveryRootBindingId: input.recoveryRootBindingId }),
        ...(input.recoveryGrantRevision === undefined
          ? {}
          : { recoveryGrantRevision: input.recoveryGrantRevision }),
        runId: changeSet.runId,
        changeSetId: changeSet.changeSetId,
        changeSetRevision: changeSet.revision,
        changeSetChecksum: changeSet.checksum,
        consistencyGroupChecksum: selection.value,
        proposalPayloadChecksum: checksumCanonical({
          schemaVersion: "1.0",
          changeSet: {
            changeSetId: changeSet.changeSetId,
            revision: changeSet.revision,
            checksum: changeSet.checksum,
            contextSnapshotId: changeSet.contextSnapshotId
          },
          consistencyGroupId: input.consistencyGroupId ?? null,
          groupKind: input.groupKind ?? "ordinary",
          proposals: [...input.proposals].sort(compareProposalProofs)
        }),
        referenceImpactChecksum: checksumCanonical({
          proposalReferenceImpactChecksums: [...input.proposals]
            .map((proposal) => proposal.referenceImpactChecksum)
            .sort(),
          dependencyChecksum: dependencyChecksum ?? null
        }),
        ...(input.baseManifestChecksum === undefined
          ? {}
          : { baseManifestChecksum: input.baseManifestChecksum }),
        ...(input.candidateManifestChecksum === undefined
          ? {}
          : { candidateManifestChecksum: input.candidateManifestChecksum }),
        ...(input.recoverySideEffectChecksum === undefined
          ? {}
          : { recoverySideEffectChecksum: input.recoverySideEffectChecksum }),
        executionWritePolicy: changeSet.writePolicy ?? "write_before_confirmation",
        policyRevision: input.policyRevision,
        capabilityRevision: input.capabilityRevision
      };

      let proof: MainOnlyApprovalDecisionProofV1;
      try {
        proof = createMainOnlyApprovalDecisionProofV1({
          proofId: createProofId(),
          approvalRuleSetVersion: input.approvalRuleSetVersion,
          approvalRuleSetChecksum: input.approvalRuleSetChecksum,
          operation: proofFacts.value.operation,
          ...(proofFacts.value.effectRuleId === undefined
            ? {}
            : { effectRuleId: proofFacts.value.effectRuleId }),
          binding,
          evidence: {
            // Story Bible mutations are domain objects, not path operations. An ordinary domain
            // target is therefore not applicable to the file-path rule dimension; restrictive
            // Main facts still survive and can only make the decision stricter.
            pathClass: storyBiblePathClass(input.pathClass),
            targetFreshness:
              proofFacts.value.operation === "story_bible_create"
                ? "not_applicable"
                : input.targetFreshness,
            createOnly: proofFacts.value.createOnly,
            referenceImpact: proofFacts.value.referenceImpact,
            limits: proofFacts.value.limits,
            stateBoundary: proofFacts.value.stateBoundary
          }
        });
      } catch {
        return err(proofError("STORY_BIBLE_APPROVAL_PROOF_RULE_MISMATCH"));
      }

      const persisted = await options.changeSets.persistApprovalDecisionProof({
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        proof
      });
      if (!persisted.ok) return persisted;
      if (options.referenceDependencyRepository !== undefined) {
        const binding = createStoryBibleReferenceDependencyBinding({
          proofRef: persisted.value,
          runId: changeSet.runId,
          changeSetId: changeSet.changeSetId,
          changeSetRevision: changeSet.revision,
          changeSetChecksum: changeSet.checksum,
          proposalReferenceImpactChecksums: [...input.proposals]
            .map((proposal) => proposal.referenceImpactChecksum)
            .sort(),
          dependencies: input.referenceDependencies ?? []
        });
        if (!binding.ok) return binding;
        const written =
          await options.referenceDependencyRepository.writeStoryBibleReferenceDependencyBinding(
            binding.value
          );
        if (!written.ok) return written;
        if (
          written.value.bindingChecksum !== binding.value.bindingChecksum ||
          written.value.proofId !== persisted.value.proofId ||
          written.value.proofChecksum !== persisted.value.proofChecksum
        ) {
          return err(proofError("STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_STALE"));
        }
      }
      return ok({
        proofRef: persisted.value,
        providerSummary: providerVisibleApprovalDecisionSummaryV1(proof)
      });
    }
  };
}

type ProposalOperation = Extract<
  ProviderVisibleWriteOperation,
  "story_bible_create" | "story_bible_patch" | "story_bible_status" | "story_bible_restore"
>;

interface NormalizedProposalFacts {
  readonly operation: ProposalOperation;
  readonly effectRuleId?:
    "bounded_story_bible_create_v1" | "no_reference_impact_story_bible_patch_v1";
  readonly createOnly: ApprovalDecisionProofEvidenceV1["createOnly"];
  readonly referenceImpact: ApprovalDecisionProofEvidenceV1["referenceImpact"];
  readonly limits: ApprovalDecisionProofEvidenceV1["limits"];
  readonly stateBoundary: ApprovalDecisionProofEvidenceV1["stateBoundary"];
}

function validateInputShape(input: FinalizeStoryBibleApprovalProofInput): UnifiedError | undefined {
  if (
    !isSafeIdentifier(input.runId) ||
    !isSafeIdentifier(input.changeSetId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !isChecksum(input.checksum) ||
    !isNonEmpty(input.approvalRuleSetVersion) ||
    !isChecksum(input.approvalRuleSetChecksum) ||
    !isNonEmpty(input.workspaceBindingId) ||
    !isNonEmpty(input.policyRevision) ||
    !isNonEmpty(input.capabilityRevision) ||
    !isPathClass(input.pathClass) ||
    !isTargetFreshness(input.targetFreshness) ||
    (input.consistencyGroupId !== undefined && !isSafeIdentifier(input.consistencyGroupId)) ||
    (input.groupKind === "explicit_inverse" && input.consistencyGroupId === undefined) ||
    (input.providerSemanticVersionSetChecksum !== undefined &&
      !isChecksum(input.providerSemanticVersionSetChecksum)) ||
    !optionalChecksumsAreValid(input)
  ) {
    return proofError("STORY_BIBLE_APPROVAL_PROOF_INPUT_INVALID");
  }
  return undefined;
}

function validateFrozenChangeSet(
  changeSet: ChangeSet,
  input: FinalizeStoryBibleApprovalProofInput
): UnifiedError | undefined {
  if (
    changeSet.runId !== input.runId ||
    changeSet.changeSetId !== input.changeSetId ||
    changeSet.revision !== input.revision ||
    changeSet.checksum !== input.checksum
  ) {
    return proofError("STORY_BIBLE_APPROVAL_PROOF_CHANGE_SET_STALE");
  }
  if (
    (changeSet.schemaVersion === "2.0" &&
      changeSet.providerSemanticVersionSetChecksum !== input.providerSemanticVersionSetChecksum) ||
    (changeSet.schemaVersion !== "2.0" && input.providerSemanticVersionSetChecksum !== undefined)
  ) {
    return proofError("STORY_BIBLE_APPROVAL_PROOF_CATALOG_MISMATCH");
  }
  return undefined;
}

function normalizeProposalFacts(
  proposals: readonly StoryBibleProposalApprovalProof[],
  groupKind: "ordinary" | "explicit_inverse"
): Result<NormalizedProposalFacts, UnifiedError> {
  if (proposals.length === 0 || proposals.length > 128 || !proposals.every(isProposalProof)) {
    return err(proofError("STORY_BIBLE_APPROVAL_PROOF_PROPOSAL_INVALID"));
  }
  const operations = [...new Set(proposals.map((proposal) => proposal.operation))];
  if (operations.length !== 1) {
    return err(proofError("STORY_BIBLE_APPROVAL_PROOF_GROUP_MIXED"));
  }
  const operation = operations[0] as ProposalOperation;
  if (
    groupKind === "explicit_inverse" &&
    (operation !== "story_bible_patch" || proposals.length < 2)
  ) {
    return err(proofError("STORY_BIBLE_APPROVAL_PROOF_INVERSE_INVALID"));
  }

  const referenceImpact =
    groupKind === "explicit_inverse"
      ? "present"
      : proposals.some((proposal) => proposal.evidence.referenceImpact === "unknown")
        ? "unknown"
        : proposals.some((proposal) => proposal.evidence.referenceImpact === "present")
          ? "present"
          : "none";
  const limits = proposals.some((proposal) => proposal.evidence.limits === "unknown")
    ? "unknown"
    : proposals.some((proposal) => proposal.evidence.limits === "exceeded")
      ? "exceeded"
      : "within";
  const boundaries = [...new Set(proposals.map((proposal) => proposal.evidence.stateBoundary))];
  const stateBoundary =
    boundaries.length === 1 && boundaries[0] === "ordinary" ? "ordinary" : "delete";
  const createOnly =
    operation === "story_bible_create"
      ? proposals.every((proposal) => proposal.evidence.createOnly === "proven")
        ? "proven"
        : "not_proven"
      : "not_applicable";
  const effectRuleId =
    operation === "story_bible_create"
      ? "bounded_story_bible_create_v1"
      : operation === "story_bible_patch"
        ? "no_reference_impact_story_bible_patch_v1"
        : undefined;
  return ok({
    operation,
    ...(effectRuleId === undefined ? {} : { effectRuleId }),
    createOnly,
    referenceImpact,
    limits,
    stateBoundary
  });
}

function selectedGroupBinding(
  changeSet: ChangeSet,
  consistencyGroupId: string | undefined
): Result<string, UnifiedError> {
  const selectedGroupIds = consistencyGroupId === undefined ? [] : [consistencyGroupId];
  const selectedFiles = changeSet.files.filter((file) => file.selected);
  const selectedOperations = (changeSet.operations ?? []).filter(
    (operation) => operation.selected !== false
  );
  if (
    (consistencyGroupId === undefined &&
      (selectedFiles.some((file) => file.consistencyGroupId !== undefined) ||
        selectedOperations.some((operation) => operation.consistencyGroupId !== undefined))) ||
    (consistencyGroupId !== undefined &&
      (selectedFiles.some((file) => file.consistencyGroupId === consistencyGroupId) === false ||
        selectedFiles.some(
          (file) =>
            file.consistencyGroupId !== undefined && file.consistencyGroupId !== consistencyGroupId
        ) ||
        selectedOperations.some(
          (operation) =>
            operation.consistencyGroupId !== undefined &&
            operation.consistencyGroupId !== consistencyGroupId
        )))
  ) {
    return err(proofError("STORY_BIBLE_APPROVAL_PROOF_SELECTION_MISMATCH"));
  }
  return ok(checksumChangeSetSelection(changeSet, selectedGroupIds));
}

function isProposalProof(value: unknown): value is StoryBibleProposalApprovalProof {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== "1.0" ||
    value["policyId"] !== "bounded-story-bible-proposal@1.0"
  ) {
    return false;
  }
  const operation = value["operation"];
  const effectRuleId = value["effectRuleId"];
  const evidence = value["evidence"];
  const measurements = value["measurements"];
  const thresholds = value["thresholds"];
  return (
    (operation === "story_bible_create" ||
      operation === "story_bible_patch" ||
      operation === "story_bible_status" ||
      operation === "story_bible_restore") &&
    ((operation === "story_bible_create" && effectRuleId === "bounded_story_bible_create_v1") ||
      (operation === "story_bible_patch" &&
        effectRuleId === "no_reference_impact_story_bible_patch_v1") ||
      ((operation === "story_bible_status" || operation === "story_bible_restore") &&
        effectRuleId === undefined)) &&
    isRecord(evidence) &&
    (evidence["createOnly"] === "proven" || evidence["createOnly"] === "not_applicable") &&
    (evidence["referenceImpact"] === "none" ||
      evidence["referenceImpact"] === "present" ||
      evidence["referenceImpact"] === "unknown") &&
    (evidence["limits"] === "within" ||
      evidence["limits"] === "exceeded" ||
      evidence["limits"] === "unknown") &&
    (evidence["stateBoundary"] === "ordinary" ||
      evidence["stateBoundary"] === "archive" ||
      evidence["stateBoundary"] === "delete" ||
      evidence["stateBoundary"] === "restore") &&
    isRecord(measurements) &&
    ["fieldCount", "relationCount", "totalBytes"].every(
      (key) =>
        measurements[key] === null ||
        (Number.isSafeInteger(measurements[key]) && Number(measurements[key]) >= 0)
    ) &&
    isRecord(thresholds) &&
    thresholds["maxFieldCount"] === 128 &&
    thresholds["maxRelationCount"] === 16 &&
    thresholds["maxTotalBytes"] === 65_536 &&
    (value["reviewRequirement"] === "conditional_candidate" ||
      value["reviewRequirement"] === "always_human") &&
    isChecksum(value["referenceImpactChecksum"])
  );
}

function compareProposalProofs(
  left: StoryBibleProposalApprovalProof,
  right: StoryBibleProposalApprovalProof
): number {
  return canonicalizeApprovalDecisionProofJson(left).localeCompare(
    canonicalizeApprovalDecisionProofJson(right)
  );
}

function checksumCanonical(value: unknown): string {
  return checksumChangeSetText(canonicalizeApprovalDecisionProofJson(value));
}

function optionalChecksumsAreValid(input: FinalizeStoryBibleApprovalProofInput): boolean {
  return [
    input.baseManifestChecksum,
    input.candidateManifestChecksum,
    input.recoverySideEffectChecksum
  ].every((value) => value === undefined || isChecksum(value));
}

function isPathClass(value: unknown): value is ApprovalDecisionProofEvidenceV1["pathClass"] {
  return [
    "not_applicable",
    "ordinary",
    "policy_managed",
    "ignored_generated",
    "hard_denied",
    "mixed",
    "unknown"
  ].includes(value as string);
}

function storyBiblePathClass(
  value: ApprovalDecisionProofEvidenceV1["pathClass"]
): ApprovalDecisionProofEvidenceV1["pathClass"] {
  return value === "ordinary" ? "not_applicable" : value;
}

function isTargetFreshness(
  value: unknown
): value is ApprovalDecisionProofEvidenceV1["targetFreshness"] {
  return ["not_applicable", "clean_stable", "dirty", "stale", "unknown"].includes(value as string);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function proofError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Story Bible approval proof finalization was rejected.",
    recoverability: "user-action",
    suggestedAction: "Refresh the frozen Change Set and regenerate its Main-owned approval proof.",
    traceId: "story-bible-approval-proof-session"
  });
}
