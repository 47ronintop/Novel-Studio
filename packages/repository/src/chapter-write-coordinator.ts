import { createHash } from "node:crypto";

import {
  assertChapterStatusTransitionProof,
  type ChapterStatusTransitionProof
} from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterAgentCatalogItem,
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterStatus
} from "@novel-studio/shared";

import { validationError } from "./errors.js";

export interface ChapterOutlineVolumeSnapshot {
  readonly stableRef: string;
  readonly volumeId: string;
  readonly chapterIds: readonly string[];
}

/** Repository-owned projection of outline/outline.json used by lifecycle preparation. */
export interface ChapterOutlineSnapshot {
  readonly revision: number;
  readonly checksum: string;
  readonly volumes: readonly ChapterOutlineVolumeSnapshot[];
}

export interface ChapterWriteChange {
  readonly before: ChapterDocument;
  readonly after: ChapterDocument;
}

export interface ChapterOutlineChange {
  readonly before: ChapterOutlineSnapshot;
  readonly after: ChapterOutlineSnapshot;
}

export interface ChapterWriteBatch {
  readonly operation: "rename" | "reorder" | "status" | "delete" | "restore" | "undo";
  readonly targetChapterId: string;
  readonly chapters: readonly ChapterWriteChange[];
  readonly outline?: ChapterOutlineChange;
  readonly proof?: ChapterStatusTransitionProof;
  readonly referenceImpactChecksum?: string;
}

/** The bounded repository surface required by the lifecycle coordinator. */
export interface ChapterWriteCoordinatorRepository extends ChapterDraftRepositoryPort {
  listChapterCatalog(input?: { includeDeleted?: boolean; limit?: number }): Promise<
    | {
        ok: true;
        value: {
          readonly items: readonly ChapterAgentCatalogItem[];
          readonly nextCursor: string | null;
        };
      }
    | { ok: false; error: UnifiedError }
  >;
  /** Required for outline membership changes and authenticated delete/restore. */
  readChapterOutline?(): Promise<Result<ChapterOutlineSnapshot, UnifiedError>>;
  writeChapterOutline?(
    outline: ChapterOutlineSnapshot
  ): Promise<Result<ChapterOutlineSnapshot, UnifiedError>>;
  readChapterReferenceImpactChecksum?(chapterId: string): Promise<Result<string, UnifiedError>>;
  /** Preferred production path. Implementations must apply the complete batch atomically. */
  applyChapterWriteBatch?(batch: ChapterWriteBatch): Promise<Result<void, UnifiedError>>;
}

export interface ChapterWriteCoordinatorOptions {
  readonly traceId?: string;
  readonly now?: () => string;
}

export interface ChapterReorderInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly beforeChapterRef?: string | null;
  readonly afterChapterRef?: string | null;
  readonly targetVolumeRef?: string | null;
  /** Compatibility aliases. Provider-facing callers should use stable refs. */
  readonly beforeChapterId?: string | null;
  readonly afterChapterId?: string | null;
}

export interface ChapterStatusInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly status: Exclude<ChapterStatus, "deleted">;
}

export interface ChapterDeleteInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly proof: ChapterStatusTransitionProof;
}

export interface ChapterRestoreInput {
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly proof: ChapterStatusTransitionProof;
}

interface CompleteChapterWriteInverse {
  readonly chapters: readonly ChapterDocument[];
  readonly outline?: ChapterOutlineSnapshot;
  readonly expectedAfterChecksums: Readonly<Record<string, string>>;
  readonly expectedAfterOutlineChecksum?: string;
}

export type ChapterWriteInverse =
  | (CompleteChapterWriteInverse & {
      readonly kind: "rename";
      readonly chapterId: string;
      readonly title: string;
      readonly revision: number;
    })
  | (CompleteChapterWriteInverse & {
      readonly kind: "reorder";
      readonly orders: readonly {
        readonly chapterId: string;
        readonly order: number;
        readonly revision: number;
      }[];
    })
  | (CompleteChapterWriteInverse & {
      readonly kind: "status";
      readonly chapterId: string;
      readonly status: ChapterStatus;
      readonly revision: number;
    });

export interface PreparedChapterWrite extends ChapterWriteBatch {
  readonly inverse: ChapterWriteInverse;
}

export interface ChapterWriteReceipt {
  readonly operation: PreparedChapterWrite["operation"];
  readonly chapter: ChapterDocument;
  readonly changedChapters: readonly ChapterWriteChange[];
  readonly outlineChange?: ChapterOutlineChange;
  readonly inverse: ChapterWriteInverse;
  readonly proof?: ChapterStatusTransitionProof;
  readonly referenceImpactChecksum?: string;
}

/**
 * Main-owned chapter lifecycle coordinator. Preparation is read-only and freezes complete
 * chapter/outline inverses. Apply revalidates every before-state and then uses a repository atomic
 * batch when available, otherwise it compensates attempted writes in fixed reverse order.
 */
export class ChapterWriteCoordinator {
  private readonly traceId: string;
  private readonly now: () => string;

  public constructor(
    private readonly repository: ChapterWriteCoordinatorRepository,
    options: ChapterWriteCoordinatorOptions = {}
  ) {
    this.traceId = options.traceId ?? "trace_repository_chapter_lifecycle";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async rename(
    chapterId: string,
    title: string,
    baseRevision: number
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const prepared = await this.prepareRename(chapterId, title, baseRevision);
    return prepared.ok ? this.applyPrepared(prepared.value) : prepared;
  }

  public async prepareRename(
    chapterId: string,
    title: string,
    baseRevision: number
  ): Promise<Result<PreparedChapterWrite, UnifiedError>> {
    const current = await this.loadCurrent(chapterId, baseRevision);
    if (!current.ok) return current;
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0 || normalizedTitle.length > 512) {
      return this.fail("CHAPTER_TITLE_INVALID", "Chapter title must contain 1 to 512 characters.");
    }
    if (normalizedTitle === current.value.frontmatter.title) {
      return this.fail("CHAPTER_TITLE_NOOP", "Chapter already has the requested title.");
    }
    const revision = chapterRevision(current.value) + 1;
    const after = withMetadata(current.value, { title: normalizedTitle, revision }, this.now());
    return ok(
      this.prepared("rename", chapterId, [{ before: current.value, after }], undefined, {
        kind: "rename",
        chapterId,
        title: current.value.frontmatter.title,
        revision,
        ...completeInverse([{ before: current.value, after }])
      })
    );
  }

  public async reorder(
    input: ChapterReorderInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const prepared = await this.prepareReorder(input);
    return prepared.ok ? this.applyPrepared(prepared.value) : prepared;
  }

  public async prepareReorder(
    input: ChapterReorderInput
  ): Promise<Result<PreparedChapterWrite, UnifiedError>> {
    const normalized = normalizeReorderInput(input);
    if (!normalized.ok) return this.fail(normalized.code, normalized.message);
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    if (current.value.frontmatter.status === "deleted") {
      return this.fail("CHAPTER_REORDER_DELETED", "Deleted chapters cannot be reordered.");
    }
    const catalog = await this.readCompleteCatalog();
    if (!catalog.ok) return catalog;
    const orderValidation = validateCatalogOrders(catalog.value);
    if (!orderValidation.ok) return this.fail(orderValidation.code, orderValidation.message);

    const target = catalog.value.find((item) => item.chapterId === input.chapterId);
    if (target === undefined) {
      return this.fail("CHAPTER_FILE_MISSING", "Chapter is not present in the catalog.");
    }
    const active = catalog.value.filter((item) => item.status !== "deleted").sort(compareItems);
    const byId = new Map(active.map((item) => [item.chapterId, item]));
    const beforeId = normalized.beforeRef && chapterIdFromRef(normalized.beforeRef);
    const afterId = normalized.afterRef && chapterIdFromRef(normalized.afterRef);
    if (beforeId === undefined || afterId === undefined) {
      return this.fail(
        "CHAPTER_REORDER_TARGET_INVALID",
        "Chapter neighbors must be canonical stable chapter refs."
      );
    }
    for (const neighborId of [beforeId, afterId]) {
      if (neighborId !== null && (neighborId === input.chapterId || !byId.has(neighborId))) {
        return this.fail(
          "CHAPTER_REORDER_NEIGHBOR_STALE",
          "A requested stable neighbor is missing, deleted, or identifies the target chapter."
        );
      }
    }

    const outline = await this.readOptionalOutline();
    if (!outline.ok) return outline;
    if (
      outline.value === undefined &&
      active.some((item) => item.effectiveOutlineRevision !== undefined)
    ) {
      return this.fail(
        "CHAPTER_OUTLINE_WRITE_REQUIRED",
        "The effective outline is present but is not available to the lifecycle consistency group."
      );
    }
    if (input.targetVolumeRef !== undefined && outline.value === undefined) {
      return this.fail(
        "CHAPTER_OUTLINE_WRITE_REQUIRED",
        "Volume assignment requires a writable outline consistency group."
      );
    }
    if (outline.value !== undefined) {
      const validOutline = validateOutline(outline.value, catalog.value);
      if (!validOutline.ok) return this.fail(validOutline.code, validOutline.message);
    }

    const placement = placeChapter({
      active,
      targetChapterId: input.chapterId,
      beforeChapterId: beforeId,
      afterChapterId: afterId,
      targetVolumeRef: input.targetVolumeRef,
      outline: outline.value
    });
    if (!placement.ok) return this.fail(placement.code, placement.message);

    const tombstoneOrders = new Set(
      catalog.value.filter((item) => item.status === "deleted").map((item) => item.order)
    );
    const available = allocateOrders(placement.orderedChapterIds.length, tombstoneOrders);
    const timestamp = this.now();
    const changes: ChapterWriteChange[] = [];
    for (const [position, chapterId] of placement.orderedChapterIds.entries()) {
      const item = byId.get(chapterId);
      const order = available[position];
      if (item === undefined || order === undefined) {
        return this.fail(
          "CHAPTER_ORDER_ALLOCATION_FAILED",
          "Chapter order slots could not be allocated safely."
        );
      }
      const desiredVolumeId = placement.volumeIdByChapterId.get(chapterId);
      const volumeChanged = item.frontmatter.volumeId !== desiredVolumeId;
      if (item.order === order && !volumeChanged) continue;
      const loaded =
        chapterId === input.chapterId ? current : await this.repository.readChapter(chapterId);
      if (!loaded.ok) return loaded;
      if (chapterRevision(loaded.value) !== chapterRevision(item)) {
        return this.fail(
          "CHAPTER_REVISION_STALE",
          "A chapter changed while the reorder operation was being prepared."
        );
      }
      const after = withVolumeMetadata(
        loaded.value,
        desiredVolumeId,
        order,
        chapterRevision(loaded.value) + 1,
        timestamp
      );
      changes.push({ before: loaded.value, after });
    }
    const outlineChange = placement.outlineAfter
      ? { before: outline.value as ChapterOutlineSnapshot, after: placement.outlineAfter }
      : undefined;
    if (
      outlineChange !== undefined &&
      !this.repository.writeChapterOutline &&
      !this.repository.applyChapterWriteBatch
    ) {
      return this.fail(
        "CHAPTER_OUTLINE_WRITE_REQUIRED",
        "The repository cannot atomically persist the prepared outline membership."
      );
    }
    if (changes.length === 0 && outlineChange === undefined) {
      return ok(
        this.prepared("reorder", input.chapterId, [], undefined, {
          kind: "reorder",
          orders: [],
          ...completeInverse([])
        })
      );
    }
    const inverse = {
      kind: "reorder" as const,
      orders: changes.map(({ before, after }) => ({
        chapterId: before.frontmatter.id,
        order: before.frontmatter.order,
        revision: chapterRevision(after)
      })),
      ...completeInverse(changes, outlineChange)
    };
    return ok(this.prepared("reorder", input.chapterId, changes, outlineChange, inverse));
  }

  public async setStatus(
    input: ChapterStatusInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const prepared = await this.prepareStatus(input);
    return prepared.ok ? this.applyPrepared(prepared.value) : prepared;
  }

  public async prepareStatus(
    input: ChapterStatusInput
  ): Promise<Result<PreparedChapterWrite, UnifiedError>> {
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    if (current.value.frontmatter.status === "deleted") {
      return this.fail(
        "CHAPTER_STATUS_DELETED_BOUNDARY",
        "Deleted chapters can only be changed through restore."
      );
    }
    if (input.status === current.value.frontmatter.status) {
      return this.fail("CHAPTER_STATUS_NOOP", "Chapter already has the requested status.");
    }
    const revision = chapterRevision(current.value) + 1;
    const after = withMetadata(current.value, { status: input.status, revision }, this.now());
    const changes = [{ before: current.value, after }];
    return ok(
      this.prepared("status", input.chapterId, changes, undefined, {
        kind: "status",
        chapterId: input.chapterId,
        status: current.value.frontmatter.status,
        revision,
        ...completeInverse(changes)
      })
    );
  }

  public async delete(
    input: ChapterDeleteInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const prepared = await this.prepareDelete(input);
    return prepared.ok ? this.applyPrepared(prepared.value) : prepared;
  }

  public async prepareDelete(
    input: ChapterDeleteInput
  ): Promise<Result<PreparedChapterWrite, UnifiedError>> {
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    const evidence = await this.readLifecycleEvidence(input.chapterId);
    if (!evidence.ok) return evidence;
    const lifecycleCatalog = await this.validateLifecycleCatalog(evidence.value.outline);
    if (!lifecycleCatalog.ok) return lifecycleCatalog;
    const placement = outlinePlacement(evidence.value.outline, input.chapterId);
    if (!placement.ok) return this.fail(placement.code, placement.message);
    const after = withoutVolume(
      withMetadata(
        current.value,
        { status: "deleted", revision: chapterRevision(current.value) + 1 },
        this.now()
      )
    );
    const proof = this.validateProof(input.proof, "delete", current.value, "deleted", {
      ...evidence.value,
      volumeRef: placement.value.volume?.stableRef ?? null,
      neighbors: placement.value.neighbors,
      after
    });
    if (!proof.ok) return proof;
    const outlineAfter = removeChapterFromOutline(evidence.value.outline, input.chapterId);
    const outlineChange = outlinesEqual(evidence.value.outline, outlineAfter)
      ? undefined
      : { before: evidence.value.outline, after: outlineAfter };
    const changes = [{ before: current.value, after }];
    return ok(
      this.prepared(
        "delete",
        input.chapterId,
        changes,
        outlineChange,
        {
          kind: "status",
          chapterId: input.chapterId,
          status: current.value.frontmatter.status,
          revision: chapterRevision(after),
          ...completeInverse(changes, outlineChange)
        },
        proof.value,
        evidence.value.referenceImpactChecksum
      )
    );
  }

  public async restore(
    input: ChapterRestoreInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const prepared = await this.prepareRestore(input);
    return prepared.ok ? this.applyPrepared(prepared.value) : prepared;
  }

  public async prepareRestore(
    input: ChapterRestoreInput
  ): Promise<Result<PreparedChapterWrite, UnifiedError>> {
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    if (input.proof.afterStatus === "archived") {
      return this.fail(
        "CHAPTER_RESTORE_ARCHIVED_INVALID",
        "Archived chapters cannot be restored through a deleted-chapter restore proof."
      );
    }
    const evidence = await this.readLifecycleEvidence(input.chapterId);
    if (!evidence.ok) return evidence;
    const lifecycleCatalog = await this.validateLifecycleCatalog(evidence.value.outline);
    if (!lifecycleCatalog.ok) return lifecycleCatalog;
    const currentPlacement = outlinePlacement(evidence.value.outline, input.chapterId);
    if (!currentPlacement.ok) return this.fail(currentPlacement.code, currentPlacement.message);
    if (currentPlacement.value.volume !== undefined) {
      return this.fail(
        "CHAPTER_RESTORE_OUTLINE_CONFLICT",
        "A deleted chapter is still present in an active outline volume."
      );
    }
    const desiredVolume = volumeForRef(evidence.value.outline, input.proof.originalVolumeRef);
    if (!desiredVolume.ok) return this.fail(desiredVolume.code, desiredVolume.message);
    const desiredVolumeId = desiredVolume.value?.volumeId;
    const after = withVolumeMetadata(
      current.value,
      desiredVolumeId,
      current.value.frontmatter.order,
      chapterRevision(current.value) + 1,
      this.now(),
      input.proof.afterStatus
    );
    const proof = this.validateProof(
      input.proof,
      "restore",
      current.value,
      input.proof.afterStatus,
      {
        ...evidence.value,
        volumeRef: input.proof.originalVolumeRef,
        neighbors: input.proof.afterNeighborRefs,
        after
      }
    );
    if (!proof.ok) return proof;
    const inserted = insertChapterIntoOutline(
      evidence.value.outline,
      input.chapterId,
      input.proof.originalVolumeRef,
      input.proof.afterNeighborRefs
    );
    if (!inserted.ok) return this.fail(inserted.code, inserted.message);
    const outlineChange = outlinesEqual(evidence.value.outline, inserted.value)
      ? undefined
      : { before: evidence.value.outline, after: inserted.value };
    const changes = [{ before: current.value, after }];
    return ok(
      this.prepared(
        "restore",
        input.chapterId,
        changes,
        outlineChange,
        {
          kind: "status",
          chapterId: input.chapterId,
          status: "deleted",
          revision: chapterRevision(after),
          ...completeInverse(changes, outlineChange)
        },
        proof.value,
        evidence.value.referenceImpactChecksum
      )
    );
  }

  public async applyPrepared(
    prepared: PreparedChapterWrite
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const stale = await this.validatePreparedBase(prepared);
    if (!stale.ok) return stale;
    const applied = this.repository.applyChapterWriteBatch
      ? await this.repository.applyChapterWriteBatch(toBatch(prepared))
      : await this.applyWithCompensation(prepared);
    if (!applied.ok) return applied;
    const target =
      prepared.chapters.find((change) => change.after.frontmatter.id === prepared.targetChapterId)
        ?.after ?? (await this.repository.readChapter(prepared.targetChapterId));
    if ("ok" in target) {
      if (!target.ok) return target;
      return ok(this.receipt(prepared, target.value));
    }
    return ok(this.receipt(prepared, target));
  }

  /** Apply the authenticated full inverse after checking that every after-state is still current. */
  public async undo(
    receipt: ChapterWriteReceipt
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const chapters = receipt.changedChapters.map((change) => ({
      before: change.after,
      after: change.before
    }));
    const outline = receipt.outlineChange
      ? { before: receipt.outlineChange.after, after: receipt.outlineChange.before }
      : undefined;
    const targetAfter = chapters.find(
      (change) => change.after.frontmatter.id === receipt.chapter.frontmatter.id
    )?.after;
    if (targetAfter === undefined) {
      return this.fail("CHAPTER_UNDO_EMPTY", "The chapter receipt has no target inverse.");
    }
    const inverse = inverseForUndo(receipt, chapters, outline);
    return this.applyPrepared({
      operation: "undo",
      targetChapterId: receipt.chapter.frontmatter.id,
      chapters,
      ...(outline ? { outline } : {}),
      inverse,
      ...(receipt.referenceImpactChecksum
        ? { referenceImpactChecksum: receipt.referenceImpactChecksum }
        : {})
    });
  }

  private prepared(
    operation: PreparedChapterWrite["operation"],
    targetChapterId: string,
    chapters: readonly ChapterWriteChange[],
    outline: ChapterOutlineChange | undefined,
    inverse: ChapterWriteInverse,
    proof?: ChapterStatusTransitionProof,
    referenceImpactChecksum?: string
  ): PreparedChapterWrite {
    return {
      operation,
      targetChapterId,
      chapters,
      ...(outline ? { outline } : {}),
      inverse,
      ...(proof ? { proof } : {}),
      ...(referenceImpactChecksum ? { referenceImpactChecksum } : {})
    };
  }

  private receipt(prepared: PreparedChapterWrite, chapter: ChapterDocument): ChapterWriteReceipt {
    return {
      operation: prepared.operation,
      chapter,
      changedChapters: prepared.chapters,
      ...(prepared.outline ? { outlineChange: prepared.outline } : {}),
      inverse: prepared.inverse,
      ...(prepared.proof ? { proof: prepared.proof } : {}),
      ...(prepared.referenceImpactChecksum
        ? { referenceImpactChecksum: prepared.referenceImpactChecksum }
        : {})
    };
  }

  private async validatePreparedBase(
    prepared: PreparedChapterWrite
  ): Promise<Result<void, UnifiedError>> {
    for (const change of prepared.chapters) {
      const current = await this.repository.readChapter(change.before.frontmatter.id);
      if (!current.ok) return current;
      if (chapterLifecycleChecksum(current.value) !== chapterLifecycleChecksum(change.before)) {
        return this.fail(
          "CHAPTER_PREPARED_BASE_STALE",
          "A chapter changed after the lifecycle operation was prepared."
        );
      }
    }
    if (prepared.outline) {
      if (!this.repository.readChapterOutline) {
        return this.fail(
          "CHAPTER_OUTLINE_WRITE_REQUIRED",
          "The prepared operation requires a writable outline consistency group."
        );
      }
      const current = await this.repository.readChapterOutline();
      if (!current.ok) return current;
      if (
        current.value.revision !== prepared.outline.before.revision ||
        current.value.checksum !== prepared.outline.before.checksum
      ) {
        return this.fail(
          "CHAPTER_OUTLINE_STALE",
          "The outline changed after the lifecycle operation was prepared."
        );
      }
    }
    if (prepared.referenceImpactChecksum !== undefined) {
      if (!this.repository.readChapterReferenceImpactChecksum) {
        return this.fail(
          "CHAPTER_LIFECYCLE_EVIDENCE_UNAVAILABLE",
          "The prepared lifecycle operation requires current reference-impact evidence."
        );
      }
      const current = await this.repository.readChapterReferenceImpactChecksum(
        prepared.targetChapterId
      );
      if (!current.ok) return current;
      if (current.value !== prepared.referenceImpactChecksum) {
        return this.fail(
          "CHAPTER_REFERENCE_IMPACT_STALE",
          "Chapter references changed after the lifecycle operation was prepared."
        );
      }
    }
    return ok(undefined);
  }

  private async applyWithCompensation(
    prepared: PreparedChapterWrite
  ): Promise<Result<void, UnifiedError>> {
    const attempted: ChapterWriteChange[] = [];
    for (const change of prepared.chapters) {
      attempted.push(change);
      const written = await this.repository.writeChapter(change.after);
      if (!written.ok) return this.compensate(prepared, attempted, written.error, false);
    }
    if (prepared.outline) {
      if (!this.repository.writeChapterOutline) {
        return this.compensate(
          prepared,
          attempted,
          this.coordinatorError(
            "CHAPTER_OUTLINE_WRITE_REQUIRED",
            "The prepared operation requires a writable outline consistency group."
          ),
          false
        );
      }
      const written = await this.repository.writeChapterOutline(prepared.outline.after);
      if (!written.ok) return this.compensate(prepared, attempted, written.error, true);
    }
    return ok(undefined);
  }

  private async compensate(
    prepared: PreparedChapterWrite,
    attempted: readonly ChapterWriteChange[],
    originalError: UnifiedError,
    outlineAttempted: boolean
  ): Promise<Result<void, UnifiedError>> {
    let failed = false;
    if (outlineAttempted && prepared.outline && this.repository.writeChapterOutline) {
      const current = this.repository.readChapterOutline
        ? await this.repository.readChapterOutline()
        : undefined;
      if (!current || !current.ok) {
        failed = true;
      } else if (
        current.value.revision === prepared.outline.after.revision &&
        current.value.checksum === prepared.outline.after.checksum
      ) {
        const restored = await this.repository.writeChapterOutline(prepared.outline.before);
        failed ||= !restored.ok;
      } else if (
        current.value.revision !== prepared.outline.before.revision ||
        current.value.checksum !== prepared.outline.before.checksum
      ) {
        failed = true;
      }
    }
    for (const change of [...attempted].reverse()) {
      const current = await this.repository.readChapter(change.before.frontmatter.id);
      if (!current.ok) {
        failed = true;
        continue;
      }
      const checksum = chapterLifecycleChecksum(current.value);
      if (checksum === chapterLifecycleChecksum(change.after)) {
        const restored = await this.repository.writeChapter(change.before);
        failed ||= !restored.ok;
      } else if (checksum !== chapterLifecycleChecksum(change.before)) {
        failed = true;
      }
    }
    if (failed) {
      return this.fail(
        "CHAPTER_WRITE_COMPENSATION_FAILED",
        "The lifecycle write failed and its inverse could not be fully restored."
      );
    }
    return err(originalError);
  }

  private async readCompleteCatalog(): Promise<
    Result<readonly ChapterAgentCatalogItem[], UnifiedError>
  > {
    const catalog = await this.repository.listChapterCatalog({ includeDeleted: true, limit: 100 });
    if (!catalog.ok) return catalog;
    if (catalog.value.nextCursor !== null) {
      return this.fail(
        "CHAPTER_CATALOG_TOO_LARGE",
        "Lifecycle preparation requires a complete chapter catalog."
      );
    }
    return ok(catalog.value.items);
  }

  private async readOptionalOutline(): Promise<
    Result<ChapterOutlineSnapshot | undefined, UnifiedError>
  > {
    if (!this.repository.readChapterOutline) return ok(undefined);
    return this.repository.readChapterOutline();
  }

  private async readLifecycleEvidence(chapterId: string): Promise<
    Result<
      {
        readonly outline: ChapterOutlineSnapshot;
        readonly referenceImpactChecksum: string;
      },
      UnifiedError
    >
  > {
    if (
      !this.repository.readChapterOutline ||
      !this.repository.readChapterReferenceImpactChecksum ||
      (!this.repository.writeChapterOutline && !this.repository.applyChapterWriteBatch)
    ) {
      return this.fail(
        "CHAPTER_LIFECYCLE_EVIDENCE_UNAVAILABLE",
        "Delete and restore require outline and reference-impact evidence."
      );
    }
    const outline = await this.repository.readChapterOutline();
    if (!outline.ok) return outline;
    const impact = await this.repository.readChapterReferenceImpactChecksum(chapterId);
    if (!impact.ok) return impact;
    if (!CHECKSUM.test(impact.value)) {
      return this.fail(
        "CHAPTER_REFERENCE_IMPACT_INVALID",
        "The reference-impact evidence is not a valid checksum."
      );
    }
    return ok({ outline: outline.value, referenceImpactChecksum: impact.value });
  }

  private async validateLifecycleCatalog(
    outline: ChapterOutlineSnapshot
  ): Promise<Result<void, UnifiedError>> {
    const catalog = await this.readCompleteCatalog();
    if (!catalog.ok) return catalog;
    const orders = validateCatalogOrders(catalog.value);
    if (!orders.ok) return this.fail(orders.code, orders.message);
    const validOutline = validateOutline(outline, catalog.value);
    if (!validOutline.ok) return this.fail(validOutline.code, validOutline.message);
    return ok(undefined);
  }

  private async loadCurrent(
    chapterId: string,
    baseRevision: number
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) {
      return this.fail(
        "CHAPTER_REVISION_INVALID",
        "Chapter base revision must be a positive integer."
      );
    }
    const loaded = await this.repository.readChapter(chapterId);
    if (!loaded.ok) return loaded;
    if (chapterRevision(loaded.value) !== baseRevision) {
      return this.fail("CHAPTER_REVISION_STALE", "Chapter changed since it was read.");
    }
    return loaded;
  }

  private validateProof(
    value: ChapterStatusTransitionProof,
    action: ChapterStatusTransitionProof["action"],
    current: ChapterDocument,
    expectedAfterStatus: ChapterStatus,
    evidence: {
      readonly outline: ChapterOutlineSnapshot;
      readonly referenceImpactChecksum: string;
      readonly volumeRef: string | null;
      readonly neighbors: ChapterStatusTransitionProof["beforeNeighborRefs"];
      readonly after: ChapterDocument;
    }
  ): Result<ChapterStatusTransitionProof, UnifiedError> {
    let proof: ChapterStatusTransitionProof;
    try {
      proof = assertChapterStatusTransitionProof(value);
    } catch {
      return this.fail(
        "CHAPTER_STATUS_PROOF_INVALID",
        "The chapter status transition proof is invalid."
      );
    }
    const expectedRevision = chapterRevision(current) + 1;
    const neighbors = action === "restore" ? proof.afterNeighborRefs : proof.beforeNeighborRefs;
    if (
      proof.action !== action ||
      proof.chapterId !== current.frontmatter.id ||
      proof.stableRef !== chapterRef(current.frontmatter.id) ||
      proof.beforeStatus !== current.frontmatter.status ||
      proof.afterStatus !== expectedAfterStatus ||
      proof.beforeRevision !== chapterRevision(current) ||
      proof.afterRevision !== expectedRevision ||
      proof.beforeChecksum !== chapterLifecycleChecksum(current) ||
      proof.afterChecksum !== chapterLifecycleChecksum(evidence.after) ||
      proof.outlineRevision !== evidence.outline.revision ||
      proof.outlineChecksum !== evidence.outline.checksum ||
      proof.originalVolumeRef !== evidence.volumeRef ||
      !neighborRefsEqual(neighbors, evidence.neighbors) ||
      proof.referenceImpactChecksum !== evidence.referenceImpactChecksum
    ) {
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "The status transition proof does not match current metadata, outline, or references."
      );
    }
    if (action === "delete" && proof.restoreStatus !== current.frontmatter.status) {
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "The delete proof does not preserve the chapter's prior status."
      );
    }
    if (action === "delete" && !neighborRefsEqual(proof.afterNeighborRefs, evidence.neighbors)) {
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "The delete proof does not preserve the authenticated outline gap."
      );
    }
    if (action === "restore" && proof.restoreStatus !== proof.afterStatus) {
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "The restore proof does not preserve its authenticated restore status."
      );
    }
    return ok(proof);
  }

  private fail(code: string, message: string): Result<never, UnifiedError> {
    return err(this.coordinatorError(code, message));
  }

  private coordinatorError(code: string, message: string): UnifiedError {
    return validationError({
      code,
      message,
      suggestedAction: "Refresh the chapter and submit a new lifecycle proposal.",
      traceId: this.traceId
    });
  }
}

const CHECKSUM = /^[a-f0-9]{64}$/u;

function normalizeReorderInput(
  input: ChapterReorderInput
):
  | { readonly ok: true; readonly beforeRef: string | null; readonly afterRef: string | null }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const beforeAlias = input.beforeChapterId == null ? null : chapterRef(input.beforeChapterId);
  const afterAlias = input.afterChapterId == null ? null : chapterRef(input.afterChapterId);
  if (
    (input.beforeChapterRef !== undefined &&
      beforeAlias !== null &&
      input.beforeChapterRef !== beforeAlias) ||
    (input.afterChapterRef !== undefined &&
      afterAlias !== null &&
      input.afterChapterRef !== afterAlias)
  ) {
    return {
      ok: false,
      code: "CHAPTER_REORDER_TARGET_INVALID",
      message: "Stable neighbor refs conflict with their compatibility aliases."
    };
  }
  return {
    ok: true,
    beforeRef: input.beforeChapterRef ?? beforeAlias,
    afterRef: input.afterChapterRef ?? afterAlias
  };
}

function placeChapter(input: {
  readonly active: readonly ChapterAgentCatalogItem[];
  readonly targetChapterId: string;
  readonly beforeChapterId: string | null;
  readonly afterChapterId: string | null;
  readonly targetVolumeRef: string | null | undefined;
  readonly outline: ChapterOutlineSnapshot | undefined;
}):
  | {
      readonly ok: true;
      readonly orderedChapterIds: readonly string[];
      readonly volumeIdByChapterId: ReadonlyMap<string, string | undefined>;
      readonly outlineAfter?: ChapterOutlineSnapshot;
    }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  if (input.outline === undefined) {
    const ordered = input.active.map((item) => item.chapterId);
    const moved = insertBetween(
      ordered,
      input.targetChapterId,
      input.afterChapterId,
      input.beforeChapterId
    );
    if (!moved.ok) return moved;
    return {
      ok: true,
      orderedChapterIds: moved.value,
      volumeIdByChapterId: new Map(
        input.active.map((item) => [item.chapterId, item.frontmatter.volumeId])
      )
    };
  }

  const current = outlinePlacement(input.outline, input.targetChapterId);
  if (!current.ok) return current;
  const targetVolumeRef =
    input.targetVolumeRef === undefined
      ? (current.value.volume?.stableRef ?? null)
      : input.targetVolumeRef;
  const targetVolume = volumeForRef(input.outline, targetVolumeRef);
  if (!targetVolume.ok) return targetVolume;
  const activeIds = new Set(input.active.map((item) => item.chapterId));
  const volumes = input.outline.volumes.map((volume) => ({
    ...volume,
    chapterIds: volume.chapterIds.filter((chapterId) => chapterId !== input.targetChapterId)
  }));
  const membership = targetVolume.value
    ? [
        ...(volumes.find((volume) => volume.stableRef === targetVolume.value?.stableRef)
          ?.chapterIds ?? [])
      ]
    : input.active
        .filter(
          (item) =>
            item.chapterId !== input.targetChapterId &&
            !volumes.some((volume) => volume.chapterIds.includes(item.chapterId))
        )
        .map((item) => item.chapterId);
  const moved = insertBetween(
    membership,
    input.targetChapterId,
    input.afterChapterId,
    input.beforeChapterId
  );
  if (!moved.ok) return moved;
  if (targetVolume.value) {
    const volume = volumes.find(
      (candidate) => candidate.stableRef === targetVolume.value?.stableRef
    );
    if (volume === undefined) {
      return { ok: false, code: "CHAPTER_VOLUME_STALE", message: "The target volume changed." };
    }
    volume.chapterIds = [...moved.value];
  }
  const assigned = new Set(volumes.flatMap((volume) => volume.chapterIds));
  const unassigned = input.active
    .filter((item) => !assigned.has(item.chapterId) && item.chapterId !== input.targetChapterId)
    .map((item) => item.chapterId);
  if (targetVolume.value === undefined) {
    unassigned.splice(0, unassigned.length, ...moved.value);
  }
  const ordered = [
    ...volumes.flatMap((volume) => volume.chapterIds.filter((id) => activeIds.has(id))),
    ...unassigned
  ];
  if (new Set(ordered).size !== input.active.length) {
    return {
      ok: false,
      code: "CHAPTER_OUTLINE_VOLUME_AMBIGUOUS",
      message: "Outline memberships do not identify each active chapter exactly once."
    };
  }
  const volumeIdByChapterId = new Map<string, string | undefined>();
  for (const item of input.active) volumeIdByChapterId.set(item.chapterId, undefined);
  for (const volume of volumes) {
    for (const chapterId of volume.chapterIds) volumeIdByChapterId.set(chapterId, volume.volumeId);
  }
  const nextOutline = nextOutlineSnapshot(input.outline, volumes);
  return {
    ok: true,
    orderedChapterIds: ordered,
    volumeIdByChapterId,
    ...(outlinesEqual(input.outline, nextOutline) ? {} : { outlineAfter: nextOutline })
  };
}

function insertBetween(
  source: readonly string[],
  target: string,
  before: string | null,
  after: string | null
):
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const values = source.filter((chapterId) => chapterId !== target);
  const beforeIndex = before === null ? -1 : values.indexOf(before);
  const afterIndex = after === null ? -1 : values.indexOf(after);
  if ((before !== null && beforeIndex < 0) || (after !== null && afterIndex < 0)) {
    return {
      ok: false,
      code: "CHAPTER_REORDER_NEIGHBOR_STALE",
      message: "A stable neighbor is no longer in the target volume."
    };
  }
  if (before !== null && after !== null && beforeIndex + 1 !== afterIndex) {
    return {
      ok: false,
      code: "CHAPTER_REORDER_NEIGHBOR_STALE",
      message: "The stable neighbor pair is no longer adjacent."
    };
  }
  const index = before !== null ? beforeIndex + 1 : after !== null ? afterIndex : values.length;
  values.splice(index, 0, target);
  return { ok: true, value: values };
}

function outlinePlacement(
  outline: ChapterOutlineSnapshot,
  chapterId: string
):
  | {
      readonly ok: true;
      readonly value: {
        readonly volume?: ChapterOutlineVolumeSnapshot;
        readonly neighbors: { readonly before: string | null; readonly after: string | null };
      };
    }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  const matches = outline.volumes.filter((volume) => volume.chapterIds.includes(chapterId));
  if (matches.length > 1) {
    return {
      ok: false,
      code: "CHAPTER_OUTLINE_VOLUME_AMBIGUOUS",
      message: "A chapter is assigned to more than one outline volume."
    };
  }
  const volume = matches[0];
  if (volume === undefined)
    return { ok: true, value: { neighbors: { before: null, after: null } } };
  const index = volume.chapterIds.indexOf(chapterId);
  return {
    ok: true,
    value: {
      volume,
      neighbors: {
        before: index > 0 ? chapterRef(volume.chapterIds[index - 1] as string) : null,
        after:
          index + 1 < volume.chapterIds.length
            ? chapterRef(volume.chapterIds[index + 1] as string)
            : null
      }
    }
  };
}

function insertChapterIntoOutline(
  outline: ChapterOutlineSnapshot,
  chapterId: string,
  volumeRef: string | null,
  neighbors: { readonly before: string | null; readonly after: string | null }
):
  | { readonly ok: true; readonly value: ChapterOutlineSnapshot }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  if (volumeRef === null) {
    if (neighbors.before !== null || neighbors.after !== null) {
      return {
        ok: false,
        code: "CHAPTER_RESTORE_NEIGHBOR_STALE",
        message: "An unassigned chapter cannot use volume neighbors."
      };
    }
    return { ok: true, value: outline };
  }
  const volume = outline.volumes.find((candidate) => candidate.stableRef === volumeRef);
  if (volume === undefined) {
    return {
      ok: false,
      code: "CHAPTER_RESTORE_VOLUME_STALE",
      message: "The authenticated restore volume no longer exists."
    };
  }
  const before = neighbors.before === null ? null : chapterIdFromRef(neighbors.before);
  const after = neighbors.after === null ? null : chapterIdFromRef(neighbors.after);
  if (before === undefined || after === undefined) {
    return {
      ok: false,
      code: "CHAPTER_RESTORE_NEIGHBOR_STALE",
      message: "Restore neighbors must be canonical stable chapter refs."
    };
  }
  const inserted = insertBetween(volume.chapterIds, chapterId, before, after);
  if (!inserted.ok) return { ...inserted, code: "CHAPTER_RESTORE_NEIGHBOR_STALE" };
  const volumes = outline.volumes.map((candidate) =>
    candidate.stableRef === volumeRef ? { ...candidate, chapterIds: inserted.value } : candidate
  );
  return { ok: true, value: nextOutlineSnapshot(outline, volumes) };
}

function removeChapterFromOutline(
  outline: ChapterOutlineSnapshot,
  chapterId: string
): ChapterOutlineSnapshot {
  return nextOutlineSnapshot(
    outline,
    outline.volumes.map((volume) => ({
      ...volume,
      chapterIds: volume.chapterIds.filter((id) => id !== chapterId)
    }))
  );
}

function nextOutlineSnapshot(
  before: ChapterOutlineSnapshot,
  volumes: readonly ChapterOutlineVolumeSnapshot[]
): ChapterOutlineSnapshot {
  const revision = before.revision + 1;
  const normalized = volumes.map((volume) => ({ ...volume, chapterIds: [...volume.chapterIds] }));
  return {
    revision,
    checksum: createHash("sha256")
      .update(JSON.stringify({ revision, volumes: normalized }), "utf8")
      .digest("hex"),
    volumes: normalized
  };
}

function volumeForRef(
  outline: ChapterOutlineSnapshot,
  volumeRef: string | null
):
  | { readonly ok: true; readonly value: ChapterOutlineVolumeSnapshot | undefined }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  if (volumeRef === null) return { ok: true, value: undefined };
  const volume = outline.volumes.find((candidate) => candidate.stableRef === volumeRef);
  return volume
    ? { ok: true, value: volume }
    : {
        ok: false,
        code: "CHAPTER_VOLUME_STALE",
        message: "The requested stable volume ref no longer exists."
      };
}

function validateOutline(
  outline: ChapterOutlineSnapshot,
  catalog: readonly ChapterAgentCatalogItem[]
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (
    !Number.isSafeInteger(outline.revision) ||
    outline.revision < 0 ||
    !CHECKSUM.test(outline.checksum)
  ) {
    return {
      ok: false,
      code: "CHAPTER_OUTLINE_INVALID",
      message: "The outline revision or checksum is invalid."
    };
  }
  const seenVolumes = new Set<string>();
  const seenVolumeIds = new Set<string>();
  const seenChapters = new Set<string>();
  const volumeIdByChapterId = new Map<string, string>();
  const statusById = new Map(catalog.map((item) => [item.chapterId, item.status]));
  for (const volume of outline.volumes) {
    if (
      seenVolumes.has(volume.stableRef) ||
      seenVolumeIds.has(volume.volumeId) ||
      volume.stableRef.length === 0 ||
      volume.volumeId.length === 0
    ) {
      return {
        ok: false,
        code: "CHAPTER_OUTLINE_INVALID",
        message: "Outline volume refs and ids must be unique and non-empty."
      };
    }
    seenVolumes.add(volume.stableRef);
    seenVolumeIds.add(volume.volumeId);
    for (const chapterId of volume.chapterIds) {
      if (!statusById.has(chapterId)) {
        return {
          ok: false,
          code: "CHAPTER_OUTLINE_MEMBER_MISSING",
          message: "The outline references a chapter that is absent from the chapter catalog."
        };
      }
      if (seenChapters.has(chapterId)) {
        return {
          ok: false,
          code: "CHAPTER_OUTLINE_VOLUME_AMBIGUOUS",
          message: "A chapter is assigned to more than one outline volume."
        };
      }
      if (statusById.get(chapterId) === "deleted") {
        return {
          ok: false,
          code: "CHAPTER_OUTLINE_DELETED_MEMBER",
          message: "Deleted chapters cannot remain in active outline volumes."
        };
      }
      seenChapters.add(chapterId);
      volumeIdByChapterId.set(chapterId, volume.volumeId);
    }
  }
  for (const chapter of catalog) {
    if (
      chapter.status !== "deleted" &&
      chapter.frontmatter.volumeId !== volumeIdByChapterId.get(chapter.chapterId)
    ) {
      return {
        ok: false,
        code: "CHAPTER_VOLUME_MIRROR_DRIFT",
        message: "Chapter volume metadata does not mirror the current outline truth."
      };
    }
  }
  return { ok: true };
}

function validateCatalogOrders(
  catalog: readonly ChapterAgentCatalogItem[]
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const seen = new Set<number>();
  for (const item of catalog) {
    if (!Number.isSafeInteger(item.order) || item.order < 1 || seen.has(item.order)) {
      return {
        ok: false,
        code: "CHAPTER_ORDER_MIGRATION_REQUIRED",
        message: "Chapter orders must be unique positive integers before lifecycle mutation."
      };
    }
    seen.add(item.order);
  }
  return { ok: true };
}

function allocateOrders(count: number, occupied: ReadonlySet<number>): readonly number[] {
  const result: number[] = [];
  for (let order = 1; result.length < count; order += 1) {
    if (!occupied.has(order)) result.push(order);
  }
  return result;
}

function completeInverse(
  changes: readonly ChapterWriteChange[],
  outline?: ChapterOutlineChange
): CompleteChapterWriteInverse {
  return {
    chapters: changes.map((change) => change.before),
    ...(outline ? { outline: outline.before } : {}),
    expectedAfterChecksums: Object.fromEntries(
      changes.map((change) => [change.after.frontmatter.id, chapterLifecycleChecksum(change.after)])
    ),
    ...(outline ? { expectedAfterOutlineChecksum: outline.after.checksum } : {})
  };
}

function inverseForUndo(
  receipt: ChapterWriteReceipt,
  changes: readonly ChapterWriteChange[],
  outline?: ChapterOutlineChange
): ChapterWriteInverse {
  const complete = completeInverse(changes, outline);
  if (receipt.inverse.kind === "rename") {
    return {
      kind: "rename",
      chapterId: receipt.inverse.chapterId,
      title: receipt.chapter.frontmatter.title,
      revision: chapterRevision(changes[0]?.after ?? receipt.chapter),
      ...complete
    };
  }
  if (receipt.inverse.kind === "reorder") {
    return {
      kind: "reorder",
      orders: changes.map((change) => ({
        chapterId: change.before.frontmatter.id,
        order: change.before.frontmatter.order,
        revision: chapterRevision(change.after)
      })),
      ...complete
    };
  }
  return {
    kind: "status",
    chapterId: receipt.inverse.chapterId,
    status: receipt.chapter.frontmatter.status,
    revision: chapterRevision(changes[0]?.after ?? receipt.chapter),
    ...complete
  };
}

function toBatch(prepared: PreparedChapterWrite): ChapterWriteBatch {
  return {
    operation: prepared.operation,
    targetChapterId: prepared.targetChapterId,
    chapters: prepared.chapters,
    ...(prepared.outline ? { outline: prepared.outline } : {}),
    ...(prepared.proof ? { proof: prepared.proof } : {}),
    ...(prepared.referenceImpactChecksum
      ? { referenceImpactChecksum: prepared.referenceImpactChecksum }
      : {})
  };
}

function chapterRevision(chapter: ChapterDocument | ChapterAgentCatalogItem): number {
  const revision = "body" in chapter ? chapter.frontmatter.revision : chapter.revision;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 1
    ? revision
    : 1;
}

function withMetadata(
  chapter: ChapterDocument,
  fields: Partial<ChapterDocument["frontmatter"]>,
  updatedAt: string
): ChapterDocument {
  return { ...chapter, frontmatter: { ...chapter.frontmatter, ...fields, updatedAt } };
}

function withVolumeMetadata(
  chapter: ChapterDocument,
  volumeId: string | undefined,
  order: number,
  revision: number,
  updatedAt: string,
  status?: ChapterStatus
): ChapterDocument {
  const next = withMetadata(chapter, { order, revision, ...(status ? { status } : {}) }, updatedAt);
  if (volumeId === undefined) return withoutVolume(next);
  return withMetadata(next, { volumeId }, updatedAt);
}

function withoutVolume(chapter: ChapterDocument): ChapterDocument {
  const frontmatter = { ...chapter.frontmatter };
  delete frontmatter.volumeId;
  return { ...chapter, frontmatter };
}

function compareItems(left: ChapterAgentCatalogItem, right: ChapterAgentCatalogItem): number {
  return (
    left.order - right.order ||
    left.title.localeCompare(right.title) ||
    left.chapterId.localeCompare(right.chapterId)
  );
}

function chapterRef(chapterId: string): string {
  return `chapter:${chapterId}`;
}

function chapterIdFromRef(ref: string | null): string | null | undefined {
  if (ref === null) return null;
  if (!ref.startsWith("chapter:") || ref.length === "chapter:".length) return undefined;
  return ref.slice("chapter:".length);
}

function neighborRefsEqual(
  left: { readonly before: string | null; readonly after: string | null },
  right: { readonly before: string | null; readonly after: string | null }
): boolean {
  return left.before === right.before && left.after === right.after;
}

function outlinesEqual(left: ChapterOutlineSnapshot, right: ChapterOutlineSnapshot): boolean {
  return JSON.stringify(left.volumes) === JSON.stringify(right.volumes);
}

export function chapterLifecycleChecksum(chapter: ChapterDocument): string {
  const canonical = JSON.stringify({
    frontmatter: sortObject(chapter.frontmatter),
    body: chapter.body
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );
}

export type { ChapterStatusTransitionProof };
