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

/** The minimal repository surface required by the lifecycle coordinator. */
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
}

export interface ChapterWriteCoordinatorOptions {
  readonly traceId?: string;
  readonly now?: () => string;
}

export interface ChapterReorderInput {
  readonly chapterId: string;
  readonly baseRevision: number;
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

export type ChapterWriteInverse =
  | {
      readonly kind: "rename";
      readonly chapterId: string;
      readonly title: string;
      readonly revision: number;
    }
  | {
      readonly kind: "reorder";
      readonly orders: readonly {
        readonly chapterId: string;
        readonly order: number;
        readonly revision: number;
      }[];
    }
  | {
      readonly kind: "status";
      readonly chapterId: string;
      readonly status: ChapterStatus;
      readonly revision: number;
    };

export interface ChapterWriteReceipt {
  readonly chapter: ChapterDocument;
  readonly inverse: ChapterWriteInverse;
  readonly proof?: ChapterStatusTransitionProof;
}

/**
 * Main-owned, bounded chapter lifecycle writer. It does not mutate the stable id or path and
 * treats deleted order slots as occupied. Every mutation re-reads the target and checks its
 * app-owned revision; delete/restore additionally require a complete authenticated proof.
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
    const current = await this.loadCurrent(chapterId, baseRevision);
    if (!current.ok) return current;
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0 || normalizedTitle.length > 512) {
      return this.fail("CHAPTER_TITLE_INVALID", "Chapter title must contain 1 to 512 characters.");
    }
    const revision = chapterRevision(current.value) + 1;
    const chapter = withMetadata(current.value, { title: normalizedTitle, revision }, this.now());
    const written = await this.repository.writeChapter(chapter);
    if (!written.ok) return written;
    return ok({
      chapter: written.value,
      inverse: { kind: "rename", chapterId, title: current.value.frontmatter.title, revision }
    });
  }

  public async reorder(
    input: ChapterReorderInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    if (input.beforeChapterId != null && input.afterChapterId != null) {
      return this.fail(
        "CHAPTER_REORDER_TARGET_INVALID",
        "Choose a before or after neighbor, not both."
      );
    }
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    if (current.value.frontmatter.status === "deleted") {
      return this.fail("CHAPTER_REORDER_DELETED", "Deleted chapters cannot be reordered.");
    }
    const catalog = await this.repository.listChapterCatalog({ includeDeleted: true, limit: 100 });
    if (!catalog.ok) return catalog;
    if (catalog.value.nextCursor !== null) {
      return this.fail(
        "CHAPTER_CATALOG_TOO_LARGE",
        "Lifecycle reorder requires a complete chapter catalog."
      );
    }
    const records = catalog.value.items;
    const target = records.find((item) => item.chapterId === input.chapterId);
    if (target === undefined)
      return this.fail("CHAPTER_FILE_MISSING", "Chapter is not present in the catalog.");
    const active = records.filter((item) => item.status !== "deleted").sort(compareItems);
    const originalOrders = new Map(active.map((item) => [item.chapterId, item.order]));
    const withoutTarget = active.filter((item) => item.chapterId !== input.chapterId);
    const neighbor = input.beforeChapterId ?? input.afterChapterId;
    if (
      neighbor !== undefined &&
      neighbor !== null &&
      !withoutTarget.some((item) => item.chapterId === neighbor)
    ) {
      return this.fail(
        "CHAPTER_REORDER_TARGET_INVALID",
        "The requested chapter neighbor does not exist."
      );
    }
    const index =
      neighbor == null
        ? withoutTarget.length
        : Math.max(
            0,
            withoutTarget.findIndex((item) => item.chapterId === neighbor) +
              (input.afterChapterId != null ? 1 : 0)
          );
    withoutTarget.splice(index, 0, target);
    const tombstoneOrders = new Set(
      records.filter((item) => item.status === "deleted").map((item) => item.order)
    );
    const available: number[] = [];
    for (let order = 1; available.length < active.length; order += 1) {
      if (!tombstoneOrders.has(order)) available.push(order);
    }
    const nextOrders = new Map<string, number>();
    for (const [position, item] of withoutTarget.entries()) {
      const order = available[position];
      if (order === undefined) {
        return this.fail(
          "CHAPTER_ORDER_ALLOCATION_FAILED",
          "Chapter order slots could not be allocated safely."
        );
      }
      nextOrders.set(item.chapterId, order);
    }
    const changed = [...nextOrders.entries()].filter(
      ([id, order]) => order !== originalOrders.get(id)
    );
    if (changed.length === 0) {
      return ok({ chapter: current.value, inverse: { kind: "reorder", orders: [] } });
    }
    const timestamp = this.now();
    const inverse: {
      chapterId: string;
      order: number;
      revision: number;
    }[] = [];
    for (const [id] of changed) {
      const originalOrder = originalOrders.get(id);
      const record = records.find((item) => item.chapterId === id);
      if (originalOrder === undefined || record === undefined) {
        return this.fail(
          "CHAPTER_REORDER_TARGET_INVALID",
          "A chapter changed while the reorder proposal was being prepared."
        );
      }
      inverse.push({
        chapterId: id,
        order: originalOrder,
        revision: chapterRevision(record) + 1
      });
    }
    let updatedTarget = current.value;
    for (const [id, order] of changed) {
      const loaded = id === input.chapterId ? current : await this.repository.readChapter(id);
      if (!loaded.ok) return loaded;
      const next = withMetadata(
        loaded.value,
        { order, revision: chapterRevision(loaded.value) + 1 },
        timestamp
      );
      const written = await this.repository.writeChapter(next);
      if (!written.ok) return written;
      if (id === input.chapterId) updatedTarget = written.value;
    }
    return ok({ chapter: updatedTarget, inverse: { kind: "reorder", orders: inverse } });
  }

  public async setStatus(
    input: ChapterStatusInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
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
    const chapter = withMetadata(current.value, { status: input.status, revision }, this.now());
    const written = await this.repository.writeChapter(chapter);
    if (!written.ok) return written;
    return ok({
      chapter: written.value,
      inverse: {
        kind: "status",
        chapterId: input.chapterId,
        status: current.value.frontmatter.status,
        revision
      }
    });
  }

  public async delete(
    input: ChapterDeleteInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    const proof = this.validateProof(input.proof, "delete", current.value, "deleted");
    if (!proof.ok) return proof;
    const chapter = withMetadata(
      current.value,
      { status: "deleted", revision: chapterRevision(current.value) + 1 },
      this.now()
    );
    if (proof.value.afterChecksum !== chapterLifecycleChecksum(chapter))
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "Delete proof does not describe the resulting chapter."
      );
    const written = await this.repository.writeChapter(chapter);
    if (!written.ok) return written;
    return ok({
      chapter: written.value,
      proof: proof.value,
      inverse: {
        kind: "status",
        chapterId: input.chapterId,
        status: current.value.frontmatter.status,
        revision: chapterRevision(chapter)
      }
    });
  }

  public async restore(
    input: ChapterRestoreInput
  ): Promise<Result<ChapterWriteReceipt, UnifiedError>> {
    const current = await this.loadCurrent(input.chapterId, input.baseRevision);
    if (!current.ok) return current;
    const proof = this.validateProof(
      input.proof,
      "restore",
      current.value,
      input.proof.afterStatus
    );
    if (!proof.ok) return proof;
    const chapter = withMetadata(
      current.value,
      { status: proof.value.afterStatus, revision: chapterRevision(current.value) + 1 },
      this.now()
    );
    if (proof.value.afterChecksum !== chapterLifecycleChecksum(chapter))
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "Restore proof does not describe the resulting chapter."
      );
    const written = await this.repository.writeChapter(chapter);
    if (!written.ok) return written;
    return ok({
      chapter: written.value,
      proof: proof.value,
      inverse: {
        kind: "status",
        chapterId: input.chapterId,
        status: "deleted",
        revision: chapterRevision(chapter)
      }
    });
  }

  private async loadCurrent(
    chapterId: string,
    baseRevision: number
  ): Promise<Result<ChapterDocument, UnifiedError>> {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 1)
      return this.fail(
        "CHAPTER_REVISION_INVALID",
        "Chapter base revision must be a positive integer."
      );
    const loaded = await this.repository.readChapter(chapterId);
    if (!loaded.ok) return loaded;
    if (chapterRevision(loaded.value) !== baseRevision)
      return this.fail("CHAPTER_REVISION_STALE", "Chapter changed since it was read.");
    return loaded;
  }

  private validateProof(
    value: ChapterStatusTransitionProof,
    action: ChapterStatusTransitionProof["action"],
    current: ChapterDocument,
    expectedAfterStatus: ChapterStatus
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
    if (
      proof.action !== action ||
      proof.chapterId !== current.frontmatter.id ||
      proof.stableRef !== `chapter:${current.frontmatter.id}` ||
      proof.beforeStatus !== current.frontmatter.status ||
      proof.afterStatus !== expectedAfterStatus ||
      proof.beforeRevision !== chapterRevision(current) ||
      proof.afterRevision !== expectedRevision ||
      proof.beforeChecksum !== chapterLifecycleChecksum(current)
    ) {
      return this.fail(
        "CHAPTER_STATUS_PROOF_MISMATCH",
        "The status transition proof does not match the current chapter."
      );
    }
    return ok(proof);
  }

  private fail(code: string, message: string): Result<never, UnifiedError> {
    return err(
      validationError({
        code,
        message,
        suggestedAction: "Refresh the chapter and submit a new lifecycle proposal.",
        traceId: this.traceId
      })
    );
  }
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

function compareItems(left: ChapterAgentCatalogItem, right: ChapterAgentCatalogItem): number {
  return (
    left.order - right.order ||
    left.title.localeCompare(right.title) ||
    left.chapterId.localeCompare(right.chapterId)
  );
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
