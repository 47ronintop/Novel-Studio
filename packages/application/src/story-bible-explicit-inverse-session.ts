import { createHash, randomUUID } from "node:crypto";

import {
  createFileOperation,
  deleteFileOperation,
  inspectChangeSetConsistencyGroups,
  type ChangeSet,
  type ChangeSetApproval,
  type ChangeSetOperation
} from "@novel-studio/agent-engine";
import type { ChapterCatalogRepositoryPort, JsonObject } from "@novel-studio/shared";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { ChangeSetSession } from "./change-set-session.js";
import {
  buildStoryBibleProposalApprovalProof,
  type StoryBibleProposalApprovalProof
} from "./story-bible-agent-tool-session.js";
import { validateStoryBibleCandidate } from "./story-bible-candidate.js";
import type {
  SaveStoryBibleAssetCandidateCommand,
  StoryBibleRelation,
  StoryBibleWriteCandidate
} from "./story-bible-session.js";
import type { VersionGroupApplyBatchResult, VersionGroupSession } from "./version-group-session.js";

const TRACE_ID = "story-bible-explicit-inverse";
const DEFAULT_PREVIEW_TTL_MS = 10 * 60 * 1_000;

export interface StoryBibleExplicitInversePersistedAsset extends StoryBibleWriteCandidate {
  readonly updatedAt: string;
  readonly revision: number;
  readonly relatedEntityIds?: string[];
  readonly passthrough?: JsonObject;
}

export interface StoryBibleExplicitInverseCompatibleRead {
  readonly asset: StoryBibleExplicitInversePersistedAsset;
  readonly persistedSchemaVersion: "1.0" | "1.1";
  readonly relativePath: string;
  readonly checksum: string;
  readonly revision: number;
  readonly passthroughPresent: boolean;
  readonly passthroughFieldCount: number;
}

export interface StoryBibleExplicitInversePreparedWrite {
  readonly asset: StoryBibleExplicitInversePersistedAsset;
  readonly current: StoryBibleExplicitInverseCompatibleRead;
  readonly relativePath: string;
  readonly content: string;
  readonly baseContent: string;
  readonly baseRevision: number;
  readonly baseChecksum: string;
}

export interface StoryBibleExplicitInverseRepositoryPort {
  readCompatibleStoryAsset(
    assetId: string
  ): Promise<Result<StoryBibleExplicitInverseCompatibleRead, UnifiedError>>;
  prepareStoryAssetCandidateReadOnly(input: {
    readonly candidate: StoryBibleWriteCandidate;
    readonly baseRevision: number;
    readonly baseChecksum: string;
    readonly knownChapterIds?: readonly string[];
    readonly deferProjectRelationPairValidation: true;
  }): Promise<Result<StoryBibleExplicitInversePreparedWrite, UnifiedError>>;
  validateStoryBibleCandidateGroup(input: {
    readonly candidates: readonly {
      readonly relativePath: string;
      readonly candidateContent: string;
    }[];
    readonly knownChapterIds?: readonly string[];
  }): Promise<Result<void, UnifiedError>>;
}

export interface StoryBibleExplicitInversePreview {
  readonly schemaVersion: "1.0";
  readonly previewId: string;
  readonly expiresAt: string;
  readonly sourceAssetId: string;
  readonly affectedAssetIds: readonly string[];
  readonly approvalProofs: readonly StoryBibleProposalApprovalProof[];
  readonly changeSet: ChangeSet;
}

export interface StoryBibleExplicitInverseApplyResult {
  readonly schemaVersion: "1.0";
  readonly previewId: string;
  readonly applied: boolean;
  readonly batch: VersionGroupApplyBatchResult;
}

export interface StoryBibleExplicitInverseCancelResult {
  readonly schemaVersion: "1.0";
  readonly previewId: string;
  readonly canceled: true;
}

export interface StoryBibleExplicitInverseSourceCommand extends Omit<
  SaveStoryBibleAssetCandidateCommand,
  "baseChecksum"
> {
  readonly baseChecksum: string;
}

export interface StoryBibleExplicitInverseSession {
  prepareStoryBibleExplicitInverseChange(input: {
    readonly source: StoryBibleExplicitInverseSourceCommand;
  }): Promise<Result<StoryBibleExplicitInversePreview, UnifiedError>>;
  applyStoryBibleExplicitInverseChange(input: {
    readonly previewId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryBibleExplicitInverseApplyResult, UnifiedError>>;
  cancelStoryBibleExplicitInverseChange(input: {
    readonly previewId: string;
    readonly revision: number;
    readonly checksum: string;
  }): Promise<Result<StoryBibleExplicitInverseCancelResult, UnifiedError>>;
  clearPreviews(): void;
}

export interface StoryBibleExplicitInverseSessionOptions {
  readonly projectId: string;
  readonly repository: StoryBibleExplicitInverseRepositoryPort;
  readonly changeSets: Pick<
    ChangeSetSession,
    "proposeStoryBibleWrite" | "proposeOperationBatch" | "readChangeSet" | "decide"
  >;
  readonly versionGroups: Pick<VersionGroupSession, "applyApprovedBatch">;
  readonly chapterCatalog?: Pick<ChapterCatalogRepositoryPort, "listChapters">;
  readonly createId?: (
    kind: "run" | "checkpoint" | "context" | "group" | "preview" | "relation"
  ) => string;
  readonly now?: () => string;
  readonly previewTtlMs?: number;
}

interface PreviewReceipt {
  readonly previewId: string;
  readonly expiresAtMs: number;
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly consistencyGroupId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly expectedAssetIds: readonly string[];
  readonly migrations: readonly ExplicitInverseMigrationPlan[];
  state: "ready" | "applying" | "consumed";
}

interface ExplicitInverseMigrationPlan {
  readonly assetId: string;
  readonly createOperation: Extract<ChangeSetOperation, { readonly kind: "create_file" }>;
  readonly deleteOperation: Extract<ChangeSetOperation, { readonly kind: "delete_file" }>;
}

interface MutableTarget {
  readonly read: StoryBibleExplicitInverseCompatibleRead;
  relations: StoryBibleRelation[];
}

export function createStoryBibleExplicitInverseSession(
  options: StoryBibleExplicitInverseSessionOptions
): StoryBibleExplicitInverseSession {
  const receipts = new Map<string, PreviewReceipt>();
  const now = options.now ?? (() => new Date().toISOString());
  const previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
  const createId = options.createId ?? defaultId;

  return {
    async prepareStoryBibleExplicitInverseChange(input) {
      pruneExpiredReceipts(receipts, Date.parse(now()));
      const sourceRead = await options.repository.readCompatibleStoryAsset(
        input.source.candidate.id
      );
      if (!sourceRead.ok) return sourceRead;
      const knownChapterIds = await readKnownChapterIds(options.chapterCatalog);
      if (!knownChapterIds.ok) return knownChapterIds;
      const derived = await deriveCandidateGroup({
        source: input.source,
        sourceRead: sourceRead.value,
        repository: options.repository,
        createRelationId: () => createRelationId(() => createId("relation"))
      });
      if (!derived.ok) return derived;

      const prepared: StoryBibleExplicitInversePreparedWrite[] = [];
      for (const candidate of derived.value) {
        const next = await options.repository.prepareStoryAssetCandidateReadOnly({
          candidate: candidate.candidate,
          baseRevision: candidate.baseRevision,
          baseChecksum: candidate.baseChecksum,
          deferProjectRelationPairValidation: true,
          ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
        });
        if (!next.ok) return next;
        prepared.push(next.value);
      }
      const validated = await options.repository.validateStoryBibleCandidateGroup({
        candidates: prepared.map((candidate) => ({
          relativePath: candidate.relativePath,
          candidateContent: candidate.content
        })),
        ...(knownChapterIds.value === undefined ? {} : { knownChapterIds: knownChapterIds.value })
      });
      if (!validated.ok) return validated;

      const runId = normalizeGeneratedId("manual_story_bible", createId("run"));
      const checkpointId = normalizeGeneratedId("checkpoint", createId("checkpoint"));
      const contextSnapshotId = normalizeGeneratedId("context", createId("context"));
      const consistencyGroupId = normalizeGeneratedId("group", createId("group"));
      const migrations = prepared.flatMap((candidate) =>
        sameRelativePath(candidate.current.relativePath, candidate.relativePath)
          ? []
          : [createMigrationPlan(candidate, consistencyGroupId)]
      );
      const migrationsByAssetId = new Map(
        migrations.map((migration) => [migration.assetId, migration] as const)
      );
      let changeSet: ChangeSet | undefined;
      for (const candidate of prepared) {
        const migration = migrationsByAssetId.get(candidate.asset.id);
        if (migration !== undefined) {
          const proposed = await options.changeSets.proposeOperationBatch({
            runId,
            projectId: options.projectId,
            checkpointId,
            contextSnapshotId,
            operations: [migration.createOperation, migration.deleteOperation].map((operation) => ({
              toolCallId: operation.toolCallIdempotencyKey,
              operation
            }))
          });
          if (!proposed.ok) return proposed;
          changeSet = proposed.value;
          continue;
        }
        const proposed = await options.changeSets.proposeStoryBibleWrite({
          runId,
          projectId: options.projectId,
          checkpointId,
          contextSnapshotId,
          assetId: candidate.asset.id,
          range: {
            unit: "character",
            start: 0,
            end: candidate.baseContent.length
          },
          baseHash: candidate.baseChecksum,
          replacement: candidate.content,
          consistencyGroupId,
          repositoryPrepared: true
        });
        if (!proposed.ok) return proposed;
        changeSet = proposed.value;
      }
      if (changeSet === undefined) {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_CHANGE_EMPTY",
            "The explicit inverse edit produced no reviewable changes."
          )
        );
      }
      const expectedAssetIds = prepared.map((candidate) => candidate.asset.id);
      const approvalProofs = Object.freeze(
        prepared.map((candidate) =>
          buildStoryBibleProposalApprovalProof({
            action: "patch",
            beforeAsset: candidate.current.asset,
            afterAsset: candidate.asset,
            content: candidate.content,
            forceReferenceImpact: "present"
          })
        )
      );
      const binding = validatePreparedChangeSet(changeSet, {
        runId,
        projectId: options.projectId,
        checkpointId,
        consistencyGroupId,
        expectedAssetIds,
        migrations
      });
      if (!binding.ok) return binding;

      const previewId = normalizeGeneratedId("preview", createId("preview"));
      const createdAtMs = Date.parse(now());
      const expiresAtMs = createdAtMs + previewTtlMs;
      receipts.set(previewId, {
        previewId,
        expiresAtMs,
        runId,
        projectId: options.projectId,
        checkpointId,
        consistencyGroupId,
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        checksum: changeSet.checksum,
        expectedAssetIds,
        migrations,
        state: "ready"
      });
      return ok({
        schemaVersion: "1.0",
        previewId,
        expiresAt: new Date(expiresAtMs).toISOString(),
        sourceAssetId: input.source.candidate.id,
        affectedAssetIds: expectedAssetIds,
        approvalProofs,
        changeSet
      });
    },

    async applyStoryBibleExplicitInverseChange(input) {
      const nowMs = Date.parse(now());
      pruneExpiredReceipts(receipts, nowMs);
      const receipt = receipts.get(input.previewId);
      if (receipt === undefined || receipt.state !== "ready") {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID",
            "The explicit inverse preview is missing, expired, already applying, or already consumed."
          )
        );
      }
      if (receipt.revision !== input.revision || receipt.checksum !== input.checksum) {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_BINDING_MISMATCH",
            "The explicit inverse preview revision or checksum was changed."
          )
        );
      }
      receipt.state = "applying";
      const persisted = await options.changeSets.readChangeSet(receipt.changeSetId);
      if (!persisted.ok) {
        receipt.state = "ready";
        return persisted;
      }
      if (
        persisted.value.revision !== receipt.revision ||
        persisted.value.checksum !== receipt.checksum
      ) {
        receipt.state = "ready";
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_CHANGE_SET_STALE",
            "The persisted Change Set changed after the explicit inverse preview was prepared."
          )
        );
      }
      const binding = validatePreparedChangeSet(persisted.value, {
        runId: receipt.runId,
        projectId: receipt.projectId,
        checkpointId: receipt.checkpointId,
        consistencyGroupId: receipt.consistencyGroupId,
        expectedAssetIds: receipt.expectedAssetIds,
        migrations: receipt.migrations
      });
      if (!binding.ok) {
        receipt.state = "ready";
        return binding;
      }

      const approval = await options.changeSets.decide({
        runId: receipt.runId,
        projectId: receipt.projectId,
        commandId: stableId(
          "cmd",
          `${receipt.previewId}:${receipt.changeSetId}:${receipt.revision}:${receipt.checksum}`
        ),
        expectedRunRevision: 0,
        changeSetId: receipt.changeSetId,
        revision: receipt.revision,
        checksum: receipt.checksum,
        decision: "apply_selected"
      });
      if (!approval.ok) {
        receipt.state = "ready";
        return approval;
      }
      if (!isChangeSetApproval(approval.value)) {
        receipt.state = "ready";
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_APPROVAL_INVALID",
            "The explicit inverse Change Set did not produce a human approval binding."
          )
        );
      }
      const applied = await options.versionGroups.applyApprovedBatch({
        changeSet: persisted.value,
        approval: approval.value,
        applyBatchId: stableId(
          "apply",
          `${receipt.previewId}:${receipt.changeSetId}:${receipt.revision}:${receipt.checksum}`
        )
      });
      if (!applied.ok) {
        receipt.state = "ready";
        return applied;
      }
      const group = applied.value.groups.find(
        (candidate) => candidate.consistencyGroupId === receipt.consistencyGroupId
      );
      if (applied.value.groups.length !== 1 || group === undefined) {
        receipt.state = "ready";
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_APPLY_RESULT_INVALID",
            "The Version Group batch did not return exactly the reviewed consistency group."
          )
        );
      }
      receipt.state = "consumed";
      return ok({
        schemaVersion: "1.0",
        previewId: receipt.previewId,
        applied: group.status === "applied",
        batch: applied.value
      });
    },

    async cancelStoryBibleExplicitInverseChange(input) {
      pruneExpiredReceipts(receipts, Date.parse(now()));
      const receipt = receipts.get(input.previewId);
      if (receipt === undefined || receipt.state !== "ready") {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID",
            "The explicit inverse preview is missing, expired, already applying, or already consumed."
          )
        );
      }
      if (receipt.revision !== input.revision || receipt.checksum !== input.checksum) {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_BINDING_MISMATCH",
            "The explicit inverse preview revision or checksum was changed."
          )
        );
      }
      receipts.delete(input.previewId);
      return ok({
        schemaVersion: "1.0",
        previewId: input.previewId,
        canceled: true
      });
    },

    clearPreviews() {
      receipts.clear();
    }
  };
}

async function deriveCandidateGroup(input: {
  readonly source: StoryBibleExplicitInverseSourceCommand;
  readonly sourceRead: StoryBibleExplicitInverseCompatibleRead;
  readonly repository: Pick<StoryBibleExplicitInverseRepositoryPort, "readCompatibleStoryAsset">;
  readonly createRelationId: () => string;
}): Promise<
  Result<
    readonly {
      readonly candidate: StoryBibleWriteCandidate;
      readonly baseRevision: number;
      readonly baseChecksum: string;
    }[],
    UnifiedError
  >
> {
  const current = input.sourceRead.asset;
  const submitted = input.source.candidate;
  if (
    current.id !== submitted.id ||
    current.type !== submitted.type ||
    current.createdAt !== submitted.createdAt ||
    current.status !== submitted.status
  ) {
    return err(
      explicitInverseError(
        "STORY_BIBLE_EXPLICIT_INVERSE_SOURCE_BINDING_INVALID",
        "The explicit inverse source identity, type, creation time, and status must match the authoritative asset."
      )
    );
  }
  if (
    input.source.baseRevision !== input.sourceRead.revision ||
    input.source.baseChecksum !== input.sourceRead.checksum
  ) {
    return err(
      explicitInverseError(
        "STORY_BIBLE_EXPLICIT_INVERSE_SOURCE_CONFLICT",
        "The explicit inverse source changed after the editor baseline was loaded."
      )
    );
  }
  const currentById = uniqueRelations(current.relations);
  if (!currentById.ok) return currentById;
  const submittedById = uniqueRelations(submitted.relations);
  if (!submittedById.ok) return submittedById;

  const enrichedRelations: StoryBibleRelation[] = [];
  for (const relation of submitted.relations) {
    const previous = currentById.value.get(relation.relationId);
    if (relation.inversePolicy !== "explicit") {
      enrichedRelations.push({ ...relation });
      continue;
    }
    if (relation.direction !== "directed" || relation.sourceId !== submitted.id) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_RELATION_INVALID",
          "Explicit inverse relations must be directed and owned by the edited source asset."
        )
      );
    }
    if (relation.targetId === submitted.id) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_SELF_REFERENCE_INVALID",
          "An explicit inverse relation must target another Story Bible asset."
        )
      );
    }
    if (previous?.inversePolicy === "explicit") {
      if (
        relation.inverseRelationId === null ||
        relation.inverseRelationId !== previous.inverseRelationId
      ) {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_ID_IMMUTABLE",
            "An existing explicit inverse relation ID cannot be replaced by the Renderer."
          )
        );
      }
      enrichedRelations.push({ ...relation });
      continue;
    }
    if (relation.inverseRelationId !== null) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_ID_UNTRUSTED",
          "A new explicit inverse relation ID must be generated by the Application."
        )
      );
    }
    enrichedRelations.push({ ...relation, inverseRelationId: input.createRelationId() });
  }
  const sourceCandidate: StoryBibleWriteCandidate = {
    ...submitted,
    relations: enrichedRelations
  };
  const localValidation = validateStoryBibleCandidate(sourceCandidate, {
    assetType: sourceCandidate.type,
    allowLegacyId: true
  });
  if (!localValidation.valid) {
    return err(
      explicitInverseError(
        "STORY_BIBLE_EXPLICIT_INVERSE_SOURCE_INVALID",
        `The explicit inverse source candidate is invalid at ${localValidation.issues[0]?.instancePath || "/"}.`
      )
    );
  }
  const nextById = new Map(
    sourceCandidate.relations.map((relation) => [relation.relationId, relation])
  );
  const targets = new Map<string, MutableTarget>();
  const movedInverseTemplates = new Map<string, StoryBibleRelation>();

  const loadTarget = async (assetId: string): Promise<Result<MutableTarget, UnifiedError>> => {
    const cached = targets.get(assetId);
    if (cached !== undefined) return ok(cached);
    const read = await input.repository.readCompatibleStoryAsset(assetId);
    if (!read.ok) return read;
    const target: MutableTarget = {
      read: read.value,
      relations: read.value.asset.relations.map((relation) => ({ ...relation }))
    };
    targets.set(assetId, target);
    return ok(target);
  };

  for (const previous of current.relations) {
    if (previous.inversePolicy !== "explicit" || previous.inverseRelationId === null) continue;
    const next = nextById.get(previous.relationId);
    const staysOnSameTarget =
      next?.inversePolicy === "explicit" && next.targetId === previous.targetId;
    if (staysOnSameTarget) continue;
    const target = await loadTarget(previous.targetId);
    if (!target.ok) return target;
    const inverseIndex = target.value.relations.findIndex(
      (relation) => relation.relationId === previous.inverseRelationId
    );
    const inverse = target.value.relations[inverseIndex];
    if (inverseIndex < 0 || inverse === undefined || !isReciprocalInverse(previous, inverse)) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_BASELINE_INVALID",
          "The authoritative target no longer contains the expected reciprocal inverse relation."
        )
      );
    }
    movedInverseTemplates.set(previous.relationId, inverse);
    target.value.relations.splice(inverseIndex, 1);
  }

  for (const next of sourceCandidate.relations) {
    if (next.inversePolicy !== "explicit" || next.inverseRelationId === null) continue;
    const previous = currentById.value.get(next.relationId);
    const sameTarget =
      previous?.inversePolicy === "explicit" && previous.targetId === next.targetId;
    const pairChanged =
      previous === undefined || !sameTarget || inverseStructureChanged(previous, next);
    if (!pairChanged) continue;
    const target = await loadTarget(next.targetId);
    if (!target.ok) return target;
    if (sameTarget && previous?.inversePolicy === "explicit") {
      const inverseIndex = target.value.relations.findIndex(
        (relation) => relation.relationId === next.inverseRelationId
      );
      const inverse = target.value.relations[inverseIndex];
      if (inverseIndex < 0 || inverse === undefined || !isReciprocalInverse(previous, inverse)) {
        return err(
          explicitInverseError(
            "STORY_BIBLE_EXPLICIT_INVERSE_BASELINE_INVALID",
            "The authoritative target no longer contains the expected reciprocal inverse relation."
          )
        );
      }
      target.value.relations[inverseIndex] = synchronizeInverse(next, inverse);
      continue;
    }
    if (target.value.relations.some((relation) => relation.relationId === next.inverseRelationId)) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_ID_CONFLICT",
          "The Application-generated inverse relation ID already exists in the target asset."
        )
      );
    }
    const template = movedInverseTemplates.get(next.relationId);
    target.value.relations.push(
      synchronizeInverse(
        next,
        template ?? {
          ...next,
          relationId: next.inverseRelationId,
          sourceId: next.targetId,
          targetId: next.sourceId,
          inverseRelationId: next.relationId
        }
      )
    );
  }

  if (targets.size === 0) {
    return err(
      explicitInverseError(
        "STORY_BIBLE_EXPLICIT_INVERSE_CHANGE_NOT_REQUIRED",
        "This draft does not add, remove, move, or structurally update an explicit inverse pair."
      )
    );
  }
  const targetCandidates = [...targets.values()]
    .sort((left, right) => left.read.asset.id.localeCompare(right.read.asset.id, "en"))
    .map((target) => ({
      candidate: authorCandidate(target.read.asset, target.relations),
      baseRevision: target.read.revision,
      baseChecksum: target.read.checksum
    }));
  return ok([
    {
      candidate: sourceCandidate,
      baseRevision: input.source.baseRevision,
      baseChecksum: input.source.baseChecksum
    },
    ...targetCandidates
  ]);
}

function authorCandidate(
  asset: StoryBibleExplicitInversePersistedAsset,
  relations: StoryBibleRelation[]
): StoryBibleWriteCandidate {
  return {
    schemaVersion: "1.1",
    id: asset.id,
    type: asset.type,
    title: asset.title,
    status: asset.status,
    summary: asset.summary,
    aliases: [...asset.aliases],
    relations,
    details: asset.details,
    extensions: asset.extensions,
    createdAt: asset.createdAt
  };
}

function synchronizeInverse(
  source: StoryBibleRelation,
  inverse: StoryBibleRelation
): StoryBibleRelation {
  return {
    ...inverse,
    relationId: source.inverseRelationId as string,
    sourceId: source.targetId,
    targetId: source.sourceId,
    direction: "directed",
    status: source.status,
    validFromChapterId: source.validFromChapterId,
    validToChapterId: source.validToChapterId,
    inversePolicy: "explicit",
    inverseRelationId: source.relationId
  };
}

function isReciprocalInverse(source: StoryBibleRelation, inverse: StoryBibleRelation): boolean {
  return (
    source.inverseRelationId !== null &&
    inverse.relationId === source.inverseRelationId &&
    inverse.sourceId === source.targetId &&
    inverse.targetId === source.sourceId &&
    inverse.direction === "directed" &&
    inverse.inversePolicy === "explicit" &&
    inverse.inverseRelationId === source.relationId
  );
}

function inverseStructureChanged(previous: StoryBibleRelation, next: StoryBibleRelation): boolean {
  return (
    previous.sourceId !== next.sourceId ||
    previous.targetId !== next.targetId ||
    previous.direction !== next.direction ||
    previous.status !== next.status ||
    previous.validFromChapterId !== next.validFromChapterId ||
    previous.validToChapterId !== next.validToChapterId ||
    previous.inversePolicy !== next.inversePolicy ||
    previous.inverseRelationId !== next.inverseRelationId
  );
}

function uniqueRelations(
  relations: readonly StoryBibleRelation[]
): Result<ReadonlyMap<string, StoryBibleRelation>, UnifiedError> {
  const byId = new Map<string, StoryBibleRelation>();
  for (const relation of relations) {
    if (byId.has(relation.relationId)) {
      return err(
        explicitInverseError(
          "STORY_BIBLE_EXPLICIT_INVERSE_RELATION_ID_DUPLICATE",
          "Relation IDs must be unique in the edited source asset."
        )
      );
    }
    byId.set(relation.relationId, relation);
  }
  return ok(byId);
}

function validatePreparedChangeSet(
  changeSet: ChangeSet,
  expected: {
    readonly runId: string;
    readonly projectId: string;
    readonly checkpointId: string;
    readonly consistencyGroupId: string;
    readonly expectedAssetIds: readonly string[];
    readonly migrations: readonly ExplicitInverseMigrationPlan[];
  }
): Result<void, UnifiedError> {
  const groups = inspectChangeSetConsistencyGroups(changeSet);
  const migrationAssetIds = new Set(expected.migrations.map((migration) => migration.assetId));
  const actualAssetIds = changeSet.files
    .map((file) => file.assetId)
    .filter((assetId): assetId is string => assetId !== undefined)
    .sort();
  const expectedAssetIds = [...expected.expectedAssetIds].sort();
  const expectedFileAssetIds = expectedAssetIds
    .filter((assetId) => !migrationAssetIds.has(assetId))
    .sort();
  const operations = changeSet.operations ?? [];
  if (
    changeSet.runId !== expected.runId ||
    changeSet.projectId !== expected.projectId ||
    changeSet.checkpointId !== expected.checkpointId ||
    expectedAssetIds.length < 2 ||
    new Set(expectedAssetIds).size !== expectedAssetIds.length ||
    migrationAssetIds.size !== expected.migrations.length ||
    expected.migrations.some((migration) => !expectedAssetIds.includes(migration.assetId)) ||
    changeSet.files.some(
      (file) =>
        file.assetType !== "text" ||
        file.assetId === undefined ||
        file.consistencyGroupId !== expected.consistencyGroupId ||
        !file.selected ||
        file.hunks.some((hunk) => !hunk.selected)
    ) ||
    !migrationOperationsMatch(operations, expected.migrations, expected.consistencyGroupId) ||
    groups.splitGroupIds.length > 0 ||
    groups.selectedGroupIds.length !== 1 ||
    groups.selectedGroupIds[0] !== expected.consistencyGroupId ||
    actualAssetIds.length !== expectedFileAssetIds.length ||
    actualAssetIds.some((assetId, index) => assetId !== expectedFileAssetIds[index])
  ) {
    return err(
      explicitInverseError(
        "STORY_BIBLE_EXPLICIT_INVERSE_CHANGE_SET_BINDING_INVALID",
        "The Change Set is not the complete, selected Story Bible consistency group prepared by the Application."
      )
    );
  }
  return ok(undefined);
}

function createMigrationPlan(
  candidate: StoryBibleExplicitInversePreparedWrite,
  consistencyGroupId: string
): ExplicitInverseMigrationPlan {
  const seed = `${consistencyGroupId}:${candidate.asset.id}:${candidate.current.relativePath}:${candidate.relativePath}`;
  const createToolCallId = stableId("tool", `${seed}:create`);
  const createOperation = createFileOperation({
    operationId: stableId("op", `${seed}:create`),
    relativePath: candidate.relativePath,
    content: candidate.content,
    toolCallIdempotencyKey: createToolCallId,
    consistencyGroupId
  });
  const deleteToolCallId = stableId("tool", `${seed}:delete`);
  const deleteOperation = deleteFileOperation({
    operationId: stableId("op", `${seed}:delete`),
    relativePath: candidate.current.relativePath,
    baseChecksum: candidate.baseChecksum,
    toolCallIdempotencyKey: deleteToolCallId,
    dependsOn: [createOperation.operationId],
    consistencyGroupId
  });
  return { assetId: candidate.asset.id, createOperation, deleteOperation };
}

function migrationOperationsMatch(
  operations: readonly ChangeSetOperation[],
  migrations: readonly ExplicitInverseMigrationPlan[],
  consistencyGroupId: string
): boolean {
  const expectedOperations = migrations.flatMap((migration) => [
    migration.createOperation,
    migration.deleteOperation
  ]);
  if (operations.length !== expectedOperations.length) return false;
  const actualById = new Map(operations.map((operation) => [operation.operationId, operation]));
  if (actualById.size !== operations.length) return false;
  return expectedOperations.every((expected) => {
    const actual = actualById.get(expected.operationId);
    if (
      actual === undefined ||
      actual.kind !== expected.kind ||
      actual.toolCallIdempotencyKey !== expected.toolCallIdempotencyKey ||
      actual.selected !== true ||
      actual.consistencyGroupId !== consistencyGroupId ||
      !sameDependencies(actual.dependsOn, expected.dependsOn)
    ) {
      return false;
    }
    if (actual.kind === "create_file" && expected.kind === "create_file") {
      return actual.relativePath === expected.relativePath && actual.content === expected.content;
    }
    if (actual.kind === "delete_file" && expected.kind === "delete_file") {
      return (
        actual.relativePath === expected.relativePath &&
        actual.baseChecksum === expected.baseChecksum
      );
    }
    return false;
  });
}

function sameDependencies(
  actual: readonly string[] | undefined,
  expected: readonly string[] | undefined
): boolean {
  const left = actual ?? [];
  const right = expected ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRelativePath(left: string, right: string): boolean {
  return left.replaceAll("\\", "/") === right.replaceAll("\\", "/");
}

function isChangeSetApproval(value: ChangeSet | ChangeSetApproval): value is ChangeSetApproval {
  return "approvalSource" in value && value.approvalSource === "human_confirmation";
}

async function readKnownChapterIds(
  chapterCatalog: Pick<ChapterCatalogRepositoryPort, "listChapters"> | undefined
): Promise<Result<readonly string[] | undefined, UnifiedError>> {
  if (chapterCatalog === undefined) return ok(undefined);
  const chapters = await chapterCatalog.listChapters();
  return chapters.ok ? ok(chapters.value.map((chapter) => chapter.id)) : chapters;
}

function pruneExpiredReceipts(receipts: Map<string, PreviewReceipt>, nowMs: number): void {
  for (const [previewId, receipt] of receipts) {
    if (receipt.expiresAtMs <= nowMs) receipts.delete(previewId);
  }
}

function createRelationId(createId: () => string): string {
  const value = createId();
  if (/^rel_[a-f0-9]{32}$/u.test(value)) return value;
  return `rel_${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32)}`;
}

function defaultId(
  kind: "run" | "checkpoint" | "context" | "group" | "preview" | "relation"
): string {
  const hex = randomUUID().replaceAll("-", "");
  return kind === "relation" ? `rel_${hex}` : `${kind}_${hex}`;
}

function normalizeGeneratedId(prefix: string, value: string): string {
  if (/^[A-Za-z0-9_-]{1,128}$/u.test(value)) return value;
  return stableId(prefix, value);
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32)}`;
}

function explicitInverseError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Reload both Story Bible entries, review the explicit inverse diff, and retry.",
    traceId: TRACE_ID
  });
}
