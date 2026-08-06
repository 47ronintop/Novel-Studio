import { createHash } from "node:crypto";

import {
  collectStoryBibleDeclaredChapterReferences,
  isStoryBibleV11AssetType,
  type StoryBibleReferenceTargetType,
  type StoryBibleV11AssetType
} from "@novel-studio/schemas";
import {
  collectForeshadowContractWarnings,
  createUnifiedError,
  err,
  ok,
  type ChapterCatalogRepositoryPort,
  type ForeshadowContractWarning,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import {
  canonicalizeApprovalDecisionProofJson,
  type StoryBibleStatusTransitionProof
} from "@novel-studio/agent-engine";

import {
  prepareStoryBiblePatch,
  type StoryBiblePatchAsset,
  type StoryBiblePatchDependency,
  type StoryBiblePatchEntryRef,
  type StoryBiblePatchOperation
} from "./story-bible-patch.js";

export type StoryBibleAgentWriteToolName =
  "create_story_bible" | "patch_story_bible" | "set_story_bible_status" | "restore_story_bible";

export interface StoryBibleAgentToolAsset extends StoryBiblePatchAsset {
  readonly type: StoryBibleV11AssetType;
  readonly status: "active" | "draft" | "archived" | "deleted";
}

export interface StoryBibleAgentFieldDiff extends JsonObject {
  readonly path: string;
  readonly beforePresent: boolean;
  readonly beforeValue?: JsonValue;
  readonly afterPresent: boolean;
  readonly afterValue?: JsonValue;
}

export type StoryBibleProposalReferenceImpact = "none" | "present" | "unknown";
export type StoryBibleProposalStateBoundary = "ordinary" | "archive" | "delete" | "restore";

export interface StoryBibleProposalApprovalProof {
  readonly schemaVersion: "1.0";
  readonly policyId: "bounded-story-bible-proposal@1.0";
  readonly operation:
    "story_bible_create" | "story_bible_patch" | "story_bible_status" | "story_bible_restore";
  readonly effectRuleId?:
    "bounded_story_bible_create_v1" | "no_reference_impact_story_bible_patch_v1";
  readonly measurements: {
    readonly fieldCount: number | null;
    readonly relationCount: number | null;
    readonly totalBytes: number | null;
  };
  readonly thresholds: {
    readonly maxFieldCount: 128;
    readonly maxRelationCount: 16;
    readonly maxTotalBytes: 65536;
  };
  readonly evidence: {
    readonly createOnly: "proven" | "not_applicable";
    readonly referenceImpact: StoryBibleProposalReferenceImpact;
    readonly limits: "within" | "exceeded" | "unknown";
    readonly stateBoundary: StoryBibleProposalStateBoundary;
  };
  /** This is a floor for Main's final decision; editor/policy facts may only make it stricter. */
  readonly reviewRequirement: "conditional_candidate" | "always_human";
  readonly referenceImpactChecksum: string;
}

export interface StoryBiblePreparedAgentProposal {
  readonly kind: "create" | "replace";
  readonly action: "create" | "patch" | "status" | "restore";
  readonly assetId: string;
  readonly assetType: StoryBibleV11AssetType;
  readonly relativePath: string;
  /** Present when an existing legacy asset must be migrated during Change Set application. */
  readonly currentRelativePath?: string;
  readonly content: string;
  readonly baseContent?: string;
  readonly baseChecksum?: string;
  readonly baseRevision?: number;
  readonly nextRevision: number;
  readonly changedPaths: readonly string[];
  readonly fieldDiffs: readonly StoryBibleAgentFieldDiff[];
  readonly rebased: boolean;
  /** App-owned, deterministic inputs for the final Main-only approval decision proof. */
  readonly approvalProof: StoryBibleProposalApprovalProof;
  readonly consistencyGroupId?: string;
  readonly referenceImpact?: JsonObject;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
  readonly warnings: readonly ForeshadowContractWarning[];
}

export interface StoryBibleRestoreAuthorization {
  readonly status: "active" | "draft" | "archived";
  readonly historyAuthorizationChecksum: string;
}

interface StoryBibleCompatibleToolRead {
  readonly asset: StoryBibleAgentToolAsset;
  readonly checksum: string;
  readonly revision: number;
}

interface StoryBiblePreparedCreateResult {
  readonly asset: StoryBibleAgentToolAsset;
  readonly relativePath: string;
  readonly content: string;
}

interface StoryBiblePreparedWriteResult {
  readonly asset: StoryBibleAgentToolAsset;
  readonly current: StoryBibleCompatibleToolRead;
  readonly currentRelativePath?: string;
  readonly relativePath: string;
  readonly content: string;
  readonly baseContent: string;
  readonly baseRevision: number;
  readonly baseChecksum: string;
}

export interface StoryBibleTemporaryReferenceTarget {
  readonly targetId: string;
  readonly targetType: StoryBibleReferenceTargetType;
}

export interface StoryBibleAgentToolRepositoryPort {
  readCompatibleStoryAsset(
    assetId: string
  ): Promise<Result<StoryBibleCompatibleToolRead, UnifiedError>>;
  prepareCreateStoryAsset(input: {
    readonly type: StoryBibleV11AssetType;
    readonly value: JsonObject;
    readonly reservedAssetId?: string;
    readonly additionalKnownAssetIds?: readonly string[];
    /** Main-derived targets materialized by another candidate in the same atomic consistency group. */
    readonly additionalKnownReferenceTargets?: readonly StoryBibleTemporaryReferenceTarget[];
    readonly knownChapterIds?: readonly string[];
    /** Application-owned proof that project-level inverse-pair checks run on the complete group. */
    readonly deferProjectRelationPairValidation?: boolean;
  }): Promise<Result<StoryBiblePreparedCreateResult, UnifiedError>>;
  prepareStoryAssetCandidateReadOnly(input: {
    readonly candidate: JsonObject;
    readonly baseRevision: number;
    readonly baseChecksum: string;
    readonly additionalKnownAssetIds?: readonly string[];
    /** Main-derived targets materialized by another candidate in the same atomic consistency group. */
    readonly additionalKnownReferenceTargets?: readonly StoryBibleTemporaryReferenceTarget[];
    readonly knownChapterIds?: readonly string[];
    /** Application-owned proof that project-level inverse-pair checks run on the complete group. */
    readonly deferProjectRelationPairValidation?: boolean;
  }): Promise<Result<StoryBiblePreparedWriteResult, UnifiedError>>;
  getStoryBibleReferences?(
    assetId: string,
    knownChapterIds?: readonly string[]
  ): Promise<Result<JsonObject, UnifiedError>>;
}

export interface StoryBibleAgentToolSessionOptions {
  readonly repository: StoryBibleAgentToolRepositoryPort;
  readonly chapterCatalog?: Pick<ChapterCatalogRepositoryPort, "listChapters">;
  readonly resolveRestoreAuthorization?: (
    assetId: string,
    currentRevision: number,
    currentChecksum: string
  ) => Promise<Result<StoryBibleRestoreAuthorization, UnifiedError>>;
  readonly traceId?: string;
}

export interface StoryBibleAgentToolSession {
  prepare(input: {
    readonly toolName: StoryBibleAgentWriteToolName;
    readonly arguments: JsonObject;
  }): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>>;
}

export function createStoryBibleAgentToolSession(
  options: StoryBibleAgentToolSessionOptions
): StoryBibleAgentToolSession {
  const traceId = options.traceId ?? "story-bible-agent-tool-session";

  return {
    async prepare(input) {
      const consistencyGroupId = readConsistencyGroupId(input.arguments);
      if (consistencyGroupId === null) {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
            "consistencyGroupId must be a stable identifier when provided."
          )
        );
      }
      if (input.toolName === "create_story_bible") {
        return prepareCreate(input.arguments, consistencyGroupId);
      }
      if (input.toolName === "patch_story_bible") {
        return preparePatch(input.arguments, "patch", consistencyGroupId);
      }
      if (input.toolName === "set_story_bible_status") {
        return prepareStatus(input.arguments, "status", consistencyGroupId);
      }
      return prepareRestore(input.arguments, consistencyGroupId);
    }
  };

  async function prepareCreate(
    argumentsValue: JsonObject,
    consistencyGroupId: string | undefined
  ): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>> {
    const type = argumentsValue["type"];
    const value = argumentsValue["value"];
    if (!isStoryBibleV11AssetType(type) || !isRecord(value)) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "create_story_bible requires a supported type and a structured value."
        )
      );
    }
    const knownChapterIds = await readKnownChapterIds();
    if (!knownChapterIds.ok) return knownChapterIds;
    const prepared = await options.repository.prepareCreateStoryAsset({
      type,
      value,
      ...(consistencyGroupId === undefined ? {} : { deferProjectRelationPairValidation: true }),
      ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
    });
    if (!prepared.ok) return prepared;
    return ok({
      kind: "create",
      action: "create",
      assetId: prepared.value.asset.id,
      assetType: prepared.value.asset.type,
      relativePath: prepared.value.relativePath,
      content: prepared.value.content,
      nextRevision: prepared.value.asset.revision,
      changedPaths: ["/"],
      fieldDiffs: [
        {
          path: "/",
          beforePresent: false,
          afterPresent: true,
          afterValue: cloneJson(prepared.value.asset)
        }
      ],
      rebased: false,
      approvalProof: buildStoryBibleProposalApprovalProof({
        action: "create",
        afterAsset: prepared.value.asset,
        content: prepared.value.content
      }),
      warnings: storyBibleContractWarnings(prepared.value.asset),
      ...(consistencyGroupId === undefined ? {} : { consistencyGroupId })
    });
  }

  async function preparePatch(
    argumentsValue: JsonObject,
    action: "patch",
    consistencyGroupId: string | undefined
  ): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>> {
    const assetId = readAssetId(argumentsValue);
    const baseRevision = readNonNegativeInteger(argumentsValue["baseRevision"]);
    const baseChecksum = readChecksum(argumentsValue["baseChecksum"]);
    const operations = readPatchOperations(argumentsValue["operations"]);
    if (
      assetId === undefined ||
      baseRevision === undefined ||
      baseChecksum === undefined ||
      operations === undefined
    ) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "patch_story_bible requires assetId, fresh baseRevision/baseChecksum, and valid patch operations."
        )
      );
    }
    const entryRef = readEntryRef(argumentsValue["entryRef"]);
    if (entryRef === undefined) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "patch_story_bible entryRef is invalid."
        )
      );
    }
    if (entryRef === null && operations.some((operation) => operation.path === "/status")) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED",
          "Story Bible status must be changed with the dedicated status or restore tool."
        )
      );
    }
    const dependencies = readDependencies(argumentsValue["dependencies"]);
    if (dependencies === undefined) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "patch_story_bible dependencies are invalid."
        )
      );
    }
    let referenceImpact: JsonObject | undefined;
    if (patchRequiresReferenceImpact(entryRef, operations)) {
      const impact = await readReferenceImpact(assetId);
      if (!impact.ok) return impact;
      referenceImpact = impact.value;
    }
    return prepareExisting({
      assetId,
      baseRevision,
      baseChecksum,
      entryRef,
      operations,
      dependencies,
      action,
      ...(referenceImpact === undefined ? {} : { referenceImpact }),
      ...(consistencyGroupId === undefined ? {} : { consistencyGroupId })
    });
  }

  async function prepareStatus(
    argumentsValue: JsonObject,
    action: "status",
    consistencyGroupId: string | undefined
  ): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>> {
    const assetId = readAssetId(argumentsValue);
    const baseRevision = readNonNegativeInteger(argumentsValue["baseRevision"]);
    const baseChecksum = readChecksum(argumentsValue["baseChecksum"]);
    const status = argumentsValue["status"];
    if (
      assetId === undefined ||
      baseRevision === undefined ||
      baseChecksum === undefined ||
      (status !== "active" && status !== "draft" && status !== "archived" && status !== "deleted")
    ) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "set_story_bible_status requires assetId, fresh baseRevision/baseChecksum, and a supported status."
        )
      );
    }
    let referenceImpact: JsonObject | undefined;
    let storyBibleStatusProof: StoryBibleStatusTransitionProof | undefined;
    if (status === "deleted") {
      const impact = await readReferenceImpact(assetId);
      if (!impact.ok) return impact;
      if (!isKnownReferenceImpact(impact.value, assetId)) {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_REFERENCE_IMPACT_INVALID",
            "Story Bible deletion impact is not bound to the requested asset."
          )
        );
      }
      if (impact.value["canSetDeleted"] !== true) {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_SINGLETON_DELETE_FORBIDDEN",
            "Outline and timeline singletons cannot be moved to deleted."
          )
        );
      }
      const deletionImpactChecksum = readChecksum(impact.value["deletionImpactChecksum"]);
      if (deletionImpactChecksum === undefined) {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_REFERENCE_IMPACT_INVALID",
            "Story Bible deletion impact is missing its immutable checksum."
          )
        );
      }
      referenceImpact = impact.value;
      storyBibleStatusProof = { action: "delete", deletionImpactChecksum };
    }
    return prepareExisting({
      assetId,
      baseRevision,
      baseChecksum,
      entryRef: null,
      operations: [{ op: "replace", path: "/status", value: status }],
      dependencies: [],
      action,
      ...(referenceImpact === undefined ? {} : { referenceImpact }),
      ...(storyBibleStatusProof === undefined ? {} : { storyBibleStatusProof }),
      ...(consistencyGroupId === undefined ? {} : { consistencyGroupId })
    });
  }

  async function prepareRestore(
    argumentsValue: JsonObject,
    consistencyGroupId: string | undefined
  ): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>> {
    const assetId = readAssetId(argumentsValue);
    const baseRevision = readNonNegativeInteger(argumentsValue["baseRevision"]);
    const baseChecksum = readChecksum(argumentsValue["baseChecksum"]);
    if (assetId === undefined || baseRevision === undefined || baseChecksum === undefined) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_TOOL_ARGUMENTS_INVALID",
          "restore_story_bible requires assetId and fresh baseRevision/baseChecksum."
        )
      );
    }
    const current = await options.repository.readCompatibleStoryAsset(assetId);
    if (!current.ok) return current;
    if (current.value.checksum !== baseChecksum) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_CHECKSUM_CONFLICT",
          "The Story Bible asset changed after it was read."
        )
      );
    }
    if (current.value.asset.status !== "deleted") {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_RESTORE_NOT_DELETED",
          "Only a deleted Story Bible asset can be restored."
        )
      );
    }
    if (options.resolveRestoreAuthorization === undefined) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE",
          "The status before deletion is unavailable."
        )
      );
    }
    const authorization = await options.resolveRestoreAuthorization(
      assetId,
      current.value.revision,
      current.value.checksum
    );
    if (!authorization.ok) return authorization;
    if (!/^[a-f0-9]{64}$/u.test(authorization.value.historyAuthorizationChecksum)) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE",
          "The deletion History authorization is invalid."
        )
      );
    }
    const impact = await readReferenceImpact(assetId);
    if (!impact.ok) return impact;
    if (!isKnownReferenceImpact(impact.value, assetId)) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_REFERENCE_IMPACT_INVALID",
          "Story Bible restore impact is not bound to the requested asset."
        )
      );
    }
    return prepareExisting({
      assetId,
      baseRevision,
      baseChecksum,
      entryRef: null,
      operations: [{ op: "replace", path: "/status", value: authorization.value.status }],
      dependencies: [],
      action: "restore",
      referenceImpact: impact.value,
      storyBibleStatusProof: {
        action: "restore",
        expectedStatus: authorization.value.status,
        historyAuthorizationChecksum: authorization.value.historyAuthorizationChecksum
      },
      ...(consistencyGroupId === undefined ? {} : { consistencyGroupId })
    });
  }

  async function prepareExisting(input: {
    readonly assetId: string;
    readonly baseRevision: number;
    readonly baseChecksum: string;
    readonly entryRef: StoryBiblePatchEntryRef | null;
    readonly operations: readonly StoryBiblePatchOperation[];
    readonly dependencies: readonly StoryBiblePatchDependency[];
    readonly action: "patch" | "status" | "restore";
    readonly consistencyGroupId?: string;
    readonly referenceImpact?: JsonObject;
    readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
  }): Promise<Result<StoryBiblePreparedAgentProposal, UnifiedError>> {
    const read = await options.repository.readCompatibleStoryAsset(input.assetId);
    if (!read.ok) return read;
    if (input.baseChecksum !== read.value.checksum) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_CHECKSUM_CONFLICT",
          "The Story Bible asset changed after it was read."
        )
      );
    }
    if (input.action === "status" && input.operations[0]?.op === "replace") {
      const nextStatus = input.operations[0].value;
      if (read.value.asset.status === "deleted" && nextStatus !== "deleted") {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_RESTORE_COMMAND_REQUIRED",
            "A deleted Story Bible asset can leave deleted only through restore_story_bible."
          )
        );
      }
      if (read.value.asset.status === nextStatus) {
        return err(
          toolError(
            traceId,
            "STORY_BIBLE_STATUS_UNCHANGED",
            "The Story Bible asset already has the requested status."
          )
        );
      }
    }
    const patched = prepareStoryBiblePatch({
      asset: read.value.asset,
      baseRevision: input.baseRevision,
      entryRef: input.entryRef,
      operations: input.operations,
      dependencies: input.dependencies
    });
    if (!patched.ok) return patched;
    const knownChapterIds = await readKnownChapterIds();
    if (!knownChapterIds.ok) return knownChapterIds;
    const prepared = await options.repository.prepareStoryAssetCandidateReadOnly({
      candidate: patched.value.candidate,
      baseRevision: patched.value.latestBaseRevision,
      baseChecksum: read.value.checksum,
      ...(input.consistencyGroupId === undefined
        ? {}
        : { deferProjectRelationPairValidation: true }),
      ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
    });
    if (!prepared.ok) return prepared;
    if (
      prepared.value.currentRelativePath !== undefined &&
      prepared.value.currentRelativePath !== prepared.value.relativePath &&
      (input.action === "status" || input.action === "restore")
    ) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_LEGACY_STATUS_MIGRATION_UNSUPPORTED",
          "Upgrade the legacy Story Bible asset with a regular patch before changing its status."
        )
      );
    }
    const fieldDiffs = buildFieldDiffs(
      read.value.asset,
      prepared.value.asset,
      input.entryRef,
      input.operations,
      patched.value.changedPaths
    );
    const approvalProof = buildStoryBibleProposalApprovalProof({
      action: input.action,
      beforeAsset: read.value.asset,
      afterAsset: prepared.value.asset,
      content: prepared.value.content,
      ...(input.referenceImpact === undefined
        ? {}
        : { referenceImpact: input.referenceImpact, referenceImpactRequired: true })
    });
    return ok({
      kind: "replace",
      action: input.action,
      assetId: prepared.value.asset.id,
      assetType: prepared.value.asset.type,
      relativePath: prepared.value.relativePath,
      ...(prepared.value.currentRelativePath === undefined ||
      prepared.value.currentRelativePath === prepared.value.relativePath
        ? {}
        : { currentRelativePath: prepared.value.currentRelativePath }),
      content: prepared.value.content,
      baseContent: prepared.value.baseContent,
      baseChecksum: prepared.value.baseChecksum,
      baseRevision: prepared.value.baseRevision,
      nextRevision: prepared.value.asset.revision,
      changedPaths: patched.value.changedPaths,
      fieldDiffs,
      rebased: patched.value.rebased,
      approvalProof,
      warnings: storyBibleContractWarnings(prepared.value.asset),
      ...(input.consistencyGroupId === undefined
        ? {}
        : { consistencyGroupId: input.consistencyGroupId }),
      ...(input.referenceImpact === undefined ? {} : { referenceImpact: input.referenceImpact }),
      ...(input.storyBibleStatusProof === undefined
        ? {}
        : { storyBibleStatusProof: input.storyBibleStatusProof })
    });
  }

  async function readReferenceImpact(assetId: string): Promise<Result<JsonObject, UnifiedError>> {
    if (options.repository.getStoryBibleReferences === undefined) {
      return err(
        toolError(
          traceId,
          "STORY_BIBLE_REFERENCE_QUERY_UNAVAILABLE",
          "Story Bible reference impact cannot be evaluated."
        )
      );
    }
    const knownChapterIds = await readKnownChapterIds();
    if (!knownChapterIds.ok) return knownChapterIds;
    return options.repository.getStoryBibleReferences(assetId, knownChapterIds.value);
  }

  async function readKnownChapterIds(): Promise<
    Result<readonly string[] | undefined, UnifiedError>
  > {
    if (options.chapterCatalog === undefined) return ok(undefined);
    const chapters = await options.chapterCatalog.listChapters();
    return chapters.ok ? ok(chapters.value.map((chapter) => chapter.id)) : chapters;
  }
}

const STORY_BIBLE_PROPOSAL_THRESHOLDS = Object.freeze({
  maxFieldCount: 128,
  maxRelationCount: 16,
  maxTotalBytes: 65_536
} as const);

export function buildStoryBibleProposalApprovalProof(input: {
  readonly action: "create" | "patch" | "status" | "restore";
  readonly beforeAsset?: JsonObject;
  readonly afterAsset: JsonObject;
  readonly content: string;
  readonly referenceImpact?: JsonObject;
  readonly referenceImpactRequired?: boolean;
  readonly forceReferenceImpact?: Exclude<StoryBibleProposalReferenceImpact, "none">;
}): StoryBibleProposalApprovalProof {
  const beforeReferences =
    input.beforeAsset === undefined
      ? emptyReferenceFacts()
      : collectReferenceFacts(input.beforeAsset);
  const afterReferences = collectReferenceFacts(input.afterAsset);
  const referenceImpact = classifyProposalReferenceImpact({
    action: input.action,
    beforeReferences,
    afterReferences,
    ...(typeof input.afterAsset["id"] === "string"
      ? { expectedAssetId: input.afterAsset["id"] }
      : {}),
    referenceImpactRequired: input.referenceImpactRequired === true,
    ...(input.referenceImpact === undefined ? {} : { referenceImpact: input.referenceImpact }),
    ...(input.forceReferenceImpact === undefined
      ? {}
      : { forceReferenceImpact: input.forceReferenceImpact })
  });
  const measurements = Object.freeze({
    fieldCount: countCandidateFields(input.afterAsset),
    relationCount: countCandidateRelations(input.afterAsset),
    totalBytes: utf8ByteLength(input.content)
  });
  const limits = classifyProposalLimits(measurements);
  const operation = storyBibleOperationForAction(input.action);
  const stateBoundary = classifyStateBoundary(input.action, input.beforeAsset, input.afterAsset);
  const reviewRequirement =
    (operation === "story_bible_create" || operation === "story_bible_patch") &&
    referenceImpact === "none" &&
    limits === "within" &&
    stateBoundary === "ordinary"
      ? "conditional_candidate"
      : "always_human";
  const referenceImpactChecksum = checksumCanonicalValue({
    state: referenceImpact,
    before: beforeReferences,
    after: afterReferences,
    snapshot: input.referenceImpact ?? null
  });

  return deepFreeze({
    schemaVersion: "1.0",
    policyId: "bounded-story-bible-proposal@1.0",
    operation,
    ...(operation === "story_bible_create"
      ? { effectRuleId: "bounded_story_bible_create_v1" as const }
      : operation === "story_bible_patch"
        ? { effectRuleId: "no_reference_impact_story_bible_patch_v1" as const }
        : {}),
    measurements,
    thresholds: STORY_BIBLE_PROPOSAL_THRESHOLDS,
    evidence: {
      createOnly: input.action === "create" ? "proven" : "not_applicable",
      referenceImpact,
      limits,
      stateBoundary
    },
    reviewRequirement,
    referenceImpactChecksum
  });
}

interface StoryBibleReferenceFacts {
  readonly relations: readonly string[];
  readonly chapterReferences: readonly string[];
}

function emptyReferenceFacts(): StoryBibleReferenceFacts {
  return { relations: [], chapterReferences: [] };
}

function collectReferenceFacts(asset: JsonObject): StoryBibleReferenceFacts | null {
  if (!Array.isArray(asset["relations"]) || !asset["relations"].every(isRecord)) return null;
  try {
    const relations = asset["relations"].map((relation) => canonicalJson(relation)).sort();
    const chapterReferences = collectStoryBibleDeclaredChapterReferences(asset)
      .map((reference) =>
        canonicalJson({
          constraintKey: reference.constraintKey,
          path: reference.path,
          chapterId: reference.chapterId
        })
      )
      .sort();
    return { relations, chapterReferences };
  } catch {
    return null;
  }
}

function classifyProposalReferenceImpact(input: {
  readonly action: "create" | "patch" | "status" | "restore";
  readonly beforeReferences: StoryBibleReferenceFacts | null;
  readonly afterReferences: StoryBibleReferenceFacts | null;
  readonly expectedAssetId?: string;
  readonly referenceImpact?: JsonObject;
  readonly referenceImpactRequired: boolean;
  readonly forceReferenceImpact?: Exclude<StoryBibleProposalReferenceImpact, "none">;
}): StoryBibleProposalReferenceImpact {
  if (input.forceReferenceImpact !== undefined) return input.forceReferenceImpact;
  if (input.beforeReferences === null || input.afterReferences === null) return "unknown";
  if (
    (input.referenceImpactRequired || input.referenceImpact !== undefined) &&
    !isKnownReferenceImpact(input.referenceImpact, input.expectedAssetId)
  ) {
    return "unknown";
  }
  if (input.action === "create") {
    return hasReferences(input.afterReferences) ? "present" : "none";
  }
  if (input.action === "patch") {
    return canonicalJson(input.beforeReferences) === canonicalJson(input.afterReferences)
      ? "none"
      : "present";
  }
  if (input.referenceImpact !== undefined) {
    return referenceImpactHasAffectedTargets(input.referenceImpact) ? "present" : "none";
  }
  return input.referenceImpactRequired ? "unknown" : "none";
}

function isKnownReferenceImpact(
  value: JsonObject | undefined,
  expectedAssetId?: string
): value is JsonObject {
  if (value === undefined) return false;
  const assetId = value["assetId"];
  const incoming = value["incoming"];
  const outgoing = value["outgoing"];
  const deletionImpact = value["deletionImpact"];
  if (
    typeof assetId !== "string" ||
    (expectedAssetId !== undefined && assetId !== expectedAssetId) ||
    !Array.isArray(incoming) ||
    !Array.isArray(outgoing) ||
    !incoming.every(isRecord) ||
    !outgoing.every(isRecord)
  ) {
    return false;
  }
  const incomingSources = incoming.map((reference) => reference["sourceAssetId"]);
  const outgoingTargets = outgoing.map((reference) => reference["targetAssetId"]);
  const affectedAssetIds = isRecord(deletionImpact)
    ? deletionImpact["affectedAssetIds"]
    : undefined;
  return (
    incoming.every(
      (reference) =>
        reference["targetAssetId"] === assetId && typeof reference["sourceAssetId"] === "string"
    ) &&
    outgoing.every(
      (reference) =>
        reference["sourceAssetId"] === assetId && typeof reference["targetAssetId"] === "string"
    ) &&
    typeof value["deletionImpactChecksum"] === "string" &&
    /^[a-f0-9]{64}$/u.test(value["deletionImpactChecksum"]) &&
    typeof value["canSetDeleted"] === "boolean" &&
    isRecord(deletionImpact) &&
    Number.isSafeInteger(deletionImpact["affectedReferenceCount"]) &&
    Number(deletionImpact["affectedReferenceCount"]) >= 0 &&
    Number(deletionImpact["affectedReferenceCount"]) === incoming.length &&
    Array.isArray(affectedAssetIds) &&
    affectedAssetIds.every((id) => typeof id === "string") &&
    new Set(affectedAssetIds).size === affectedAssetIds.length &&
    [...affectedAssetIds].sort().every((id, index) => id === affectedAssetIds[index]) &&
    [...new Set(incomingSources)].sort().length === affectedAssetIds.length &&
    [...new Set(incomingSources)].sort().every((id, index) => id === affectedAssetIds[index]) &&
    outgoingTargets.every((id) => typeof id === "string") &&
    deletionImpact["cascades"] === false
  );
}

function referenceImpactHasAffectedTargets(value: JsonObject): boolean {
  const deletionImpact = value["deletionImpact"] as JsonObject;
  return (
    (value["incoming"] as unknown[]).length > 0 ||
    (value["outgoing"] as unknown[]).length > 0 ||
    Number(deletionImpact["affectedReferenceCount"]) > 0 ||
    (deletionImpact["affectedAssetIds"] as unknown[]).length > 0 ||
    deletionImpact["cascades"] === true
  );
}

function hasReferences(value: StoryBibleReferenceFacts): boolean {
  return value.relations.length > 0 || value.chapterReferences.length > 0;
}

function countCandidateFields(asset: JsonObject): number | null {
  const authorFields = ["title", "summary", "aliases", "details", "extensions"] as const;
  try {
    return authorFields.reduce<number>(
      (count, key) => count + (key in asset ? 1 + countNestedFields(asset[key] as JsonValue) : 0),
      0
    );
  } catch {
    return null;
  }
}

function countNestedFields(value: JsonValue): number {
  if (Array.isArray(value)) {
    return value.reduce<number>((count, entry) => count + countNestedFields(entry), 0);
  }
  if (!isRecord(value)) return 0;
  return Object.entries(value).reduce(
    (count, [, child]) => count + 1 + countNestedFields(child),
    0
  );
}

function countCandidateRelations(asset: JsonObject): number | null {
  const relations = asset["relations"];
  return Array.isArray(relations) && relations.every(isRecord) ? relations.length : null;
}

function utf8ByteLength(value: string): number | null {
  try {
    return Buffer.byteLength(value, "utf8");
  } catch {
    return null;
  }
}

function classifyProposalLimits(measurements: {
  readonly fieldCount: number | null;
  readonly relationCount: number | null;
  readonly totalBytes: number | null;
}): "within" | "exceeded" | "unknown" {
  if (
    measurements.fieldCount === null ||
    measurements.relationCount === null ||
    measurements.totalBytes === null
  ) {
    return "unknown";
  }
  return measurements.fieldCount > STORY_BIBLE_PROPOSAL_THRESHOLDS.maxFieldCount ||
    measurements.relationCount > STORY_BIBLE_PROPOSAL_THRESHOLDS.maxRelationCount ||
    measurements.totalBytes > STORY_BIBLE_PROPOSAL_THRESHOLDS.maxTotalBytes
    ? "exceeded"
    : "within";
}

function storyBibleOperationForAction(
  action: "create" | "patch" | "status" | "restore"
): StoryBibleProposalApprovalProof["operation"] {
  if (action === "create") return "story_bible_create";
  if (action === "patch") return "story_bible_patch";
  if (action === "status") return "story_bible_status";
  return "story_bible_restore";
}

function classifyStateBoundary(
  action: "create" | "patch" | "status" | "restore",
  beforeAsset: JsonObject | undefined,
  afterAsset: JsonObject
): StoryBibleProposalStateBoundary {
  if (action === "restore") return "restore";
  const beforeStatus = beforeAsset?.["status"];
  const afterStatus = afterAsset["status"];
  if (afterStatus === "deleted") return "delete";
  if (beforeStatus === "deleted" && afterStatus !== "deleted") return "restore";
  if (beforeStatus === "archived" || afterStatus === "archived") return "archive";
  return "ordinary";
}

function checksumCanonicalValue(value: unknown): string {
  try {
    return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
  } catch {
    return createHash("sha256").update("unserializable", "utf8").digest("hex");
  }
}

function canonicalJson(value: unknown): string {
  return canonicalizeApprovalDecisionProofJson(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function storyBibleContractWarnings(
  asset: StoryBibleAgentToolAsset
): readonly ForeshadowContractWarning[] {
  return asset.type === "foreshadow" && isRecord(asset.details)
    ? collectForeshadowContractWarnings(asset.details)
    : Object.freeze([]);
}

function patchRequiresReferenceImpact(
  entryRef: StoryBiblePatchEntryRef | null,
  operations: readonly StoryBiblePatchOperation[]
): boolean {
  return (
    entryRef !== null ||
    operations.some(
      (operation) =>
        operation.path === "/relations" ||
        operation.path.startsWith("/relations/") ||
        operation.path === "/details" ||
        operation.path.startsWith("/details/")
    )
  );
}

function buildFieldDiffs(
  before: StoryBibleAgentToolAsset,
  after: StoryBibleAgentToolAsset,
  entryRef: StoryBiblePatchEntryRef | null,
  operations: readonly StoryBiblePatchOperation[],
  changedPaths: readonly string[]
): StoryBibleAgentFieldDiff[] {
  return operations.map((operation, index) => {
    const beforeTarget = entryRef === null ? before : findEntry(before, entryRef);
    const afterTarget = entryRef === null ? after : findEntry(after, entryRef);
    const beforeRead = readPointer(beforeTarget, operation.path);
    const afterRead = readPointer(afterTarget, operation.path);
    return {
      path: changedPaths[index] ?? operation.path,
      beforePresent: beforeRead.present,
      ...(beforeRead.present ? { beforeValue: cloneJson(beforeRead.value as JsonValue) } : {}),
      afterPresent: afterRead.present,
      ...(afterRead.present ? { afterValue: cloneJson(afterRead.value as JsonValue) } : {})
    };
  });
}

function findEntry(
  asset: StoryBibleAgentToolAsset,
  ref: StoryBiblePatchEntryRef
): JsonObject | undefined {
  const details = asset.details;
  if (ref.collection === "beats") {
    const chapter = recordArray(details["chapterOutlines"]).find(
      (entry) => entry["chapterOutlineId"] === ref.parentEntryId
    );
    return recordArray(chapter?.["beats"]).find((entry) => entry["beatId"] === ref.entryId);
  }
  const idFields: Readonly<Record<StoryBiblePatchEntryRef["collection"], string>> = {
    volumes: "volumeId",
    chapterOutlines: "chapterOutlineId",
    beats: "beatId",
    events: "eventId",
    knowledgeStates: "knowledgeStateId",
    stateHistory: "stateHistoryId",
    milestones: "milestoneId"
  };
  return recordArray(details[ref.collection]).find(
    (entry) => entry[idFields[ref.collection]] === ref.entryId
  );
}

function readPointer(
  value: JsonObject | undefined,
  pointer: string
): { readonly present: boolean; readonly value?: JsonValue } {
  if (value === undefined || !pointer.startsWith("/")) return { present: false };
  let current: JsonValue = value;
  for (const segment of pointer.slice(1).split("/")) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, key)) {
      return { present: false };
    }
    current = current[key] as JsonValue;
  }
  return { present: true, value: current };
}

function readPatchOperations(value: unknown): StoryBiblePatchOperation[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return undefined;
  const operations: StoryBiblePatchOperation[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["path"] !== "string") return undefined;
    if (entry["op"] === "remove") {
      operations.push({ op: "remove", path: entry["path"] });
    } else if ((entry["op"] === "add" || entry["op"] === "replace") && "value" in entry) {
      operations.push({ op: entry["op"], path: entry["path"], value: entry["value"] as JsonValue });
    } else {
      return undefined;
    }
  }
  return operations;
}

function readEntryRef(value: unknown): StoryBiblePatchEntryRef | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const collection = value["collection"];
  const allowed = [
    "volumes",
    "chapterOutlines",
    "beats",
    "events",
    "knowledgeStates",
    "stateHistory",
    "milestones"
  ] as const;
  if (
    typeof collection !== "string" ||
    !(allowed as readonly string[]).includes(collection) ||
    typeof value["entryId"] !== "string" ||
    readPositiveInteger(value["baseEntryRevision"]) === undefined ||
    (value["parentEntryId"] !== undefined && typeof value["parentEntryId"] !== "string")
  ) {
    return undefined;
  }
  return {
    collection: collection as StoryBiblePatchEntryRef["collection"],
    entryId: value["entryId"],
    baseEntryRevision: Number(value["baseEntryRevision"]),
    ...(value["parentEntryId"] === undefined ? {} : { parentEntryId: value["parentEntryId"] })
  };
}

function readDependencies(value: unknown): StoryBiblePatchDependency[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return undefined;
  const dependencies: StoryBiblePatchDependency[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry["path"] !== "string" ||
      typeof entry["valueChecksum"] !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry["valueChecksum"])
    ) {
      return undefined;
    }
    dependencies.push({ path: entry["path"], valueChecksum: entry["valueChecksum"] });
  }
  return dependencies;
}

function readAssetId(value: JsonObject): string | undefined {
  const assetId = value["assetId"];
  return typeof assetId === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(assetId)
    ? assetId
    : undefined;
}

function readConsistencyGroupId(value: JsonObject): string | null | undefined {
  const consistencyGroupId = value["consistencyGroupId"];
  if (consistencyGroupId === undefined) return undefined;
  return typeof consistencyGroupId === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(consistencyGroupId)
    ? consistencyGroupId
    : null;
}

function readChecksum(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : undefined;
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function toolError(traceId: string, code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Read the latest Story Bible asset and prepare the structured change again.",
    traceId
  });
}
