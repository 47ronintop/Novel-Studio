import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type ChapterLifecyclePreparationPort,
  type PreparedChapterLifecycleChange,
  type PreparedChapterLifecycleFile
} from "@novel-studio/application";
import {
  chapterLifecycleChecksum,
  ChapterWriteCoordinator,
  serializeChapterDocument,
  type ChapterOutlineSnapshot,
  type ChapterWriteCoordinatorRepository,
  type PreparedChapterWrite
} from "@novel-studio/repository";
import { writeTextAtomically } from "@novel-studio/repository";
import {
  createChapterStatusTransitionProof,
  isChapterStatusTransitionProof,
  parseChapterStatusTransitionProof,
  type ChapterStatusTransitionProof
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type { ChapterDocument } from "@novel-studio/shared";
import type {
  ChapterFileRepository,
  HistoryRepository,
  StoryBibleFileRepository
} from "@novel-studio/repository";

interface CreateDesktopChapterLifecyclePreparationPortOptions {
  readonly chapterRepository: ChapterFileRepository;
  readonly storyBible: StoryBibleFileRepository;
  readonly historyRepository: HistoryRepository;
  /** Main-owned state directory. Lifecycle candidates are unusable without this durable proof. */
  readonly proofRoot: string;
  /** Never exposed outside Main. A restart without the key invalidates unconsumed proposals. */
  readonly proofIntegrityKey?: string;
  readonly now?: () => string;
  readonly traceId?: string;
}

interface LifecycleProofTransactionFile {
  readonly relativePath: string;
  readonly assetType: "chapter" | "text";
  readonly contentMode?: "serialized_chapter";
  readonly assetId?: string;
  readonly baseContent: string;
  readonly candidateContent: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly chapterStatusTransitionProof?: ChapterStatusTransitionProof;
}

interface LifecycleProofTransactionInput {
  readonly consistencyGroupId?: string;
  readonly operations?: readonly unknown[];
  readonly preparationProof?: {
    readonly proofId: string;
    readonly proofChecksum: string;
  };
  readonly files: readonly LifecycleProofTransactionFile[];
}

interface DurableLifecyclePreparationProof {
  readonly version: 1;
  readonly proofId: string;
  readonly createdAt: string;
  readonly operation: PreparedChapterLifecycleChange["operation"];
  readonly targetChapterId: string;
  readonly consistencyGroupId: string;
  readonly files: readonly LifecycleProofTransactionFile[];
  readonly canonicalChecksum: string;
  readonly proofChecksum: string;
  readonly integrityTag: string;
  readonly consumedAt?: string;
}

/** Main-only one-shot proof bridge from lifecycle preparation to transaction preflight. */
export interface ChapterLifecyclePreparationProofBridge {
  readonly lifecyclePreparationProofBridge: true;
  validateAndConsumeLifecyclePreparation(
    input: LifecycleProofTransactionInput
  ): Promise<Result<void, UnifiedError>>;
}

export type DesktopChapterLifecyclePreparationPort = ChapterLifecyclePreparationPort &
  ChapterLifecyclePreparationProofBridge;

/**
 * Desktop Main adapter for chapter lifecycle proposals. It deliberately exposes only read-only
 * preparation: the returned serialized chapter/outline candidates must subsequently cross the
 * Change Set, approval, Version Group and transaction boundary.
 */
export function createDesktopChapterLifecyclePreparationPort(
  options: CreateDesktopChapterLifecyclePreparationPortOptions
): DesktopChapterLifecyclePreparationPort {
  const traceId = options.traceId ?? "desktop-agent-chapter-lifecycle";
  const proofIntegrityKey = options.proofIntegrityKey ?? randomProofNonce();
  let operationTimestamp: string | undefined;
  const now = () => operationTimestamp ?? options.now?.() ?? new Date().toISOString();
  const repository: ChapterWriteCoordinatorRepository = {
    readChapter: (chapterId) => options.chapterRepository.readChapter(chapterId),
    writeChapter: (chapter) => options.chapterRepository.writeChapter(chapter),
    listChapterCatalog: (input) => options.chapterRepository.listChapterCatalog(input),
    readChapterOutline: () => readOutlineSnapshot(options.storyBible, traceId),
    // This adapter is preparation-only. Presence lets the coordinator prepare outline changes;
    // the implementation remains a hard failure if a future caller attempts to bypass Change Set.
    writeChapterOutline: async () => err(directWriteForbidden(traceId)),
    readChapterReferenceImpactChecksum: (chapterId) =>
      readChapterReferenceImpactChecksum(options.chapterRepository, options.storyBible, chapterId)
  };
  const coordinator = new ChapterWriteCoordinator(repository, { traceId, now });
  const reservedProofIds = new Set<string>();

  return {
    lifecyclePreparationProofBridge: true,
    async prepareRename(input) {
      return withOperationTimestamp(async () => {
        const prepared = await coordinator.prepareRename(
          input.chapterId,
          input.title,
          input.baseRevision
        );
        return prepared.ok
          ? prepareAndPersistLifecycleChange(
              prepared.value,
              options.chapterRepository,
              options.storyBible,
              options.proofRoot,
              proofIntegrityKey,
              now(),
              traceId
            )
          : prepared;
      });
    },
    async prepareReorder(input) {
      return withOperationTimestamp(async () => {
        const prepared = await coordinator.prepareReorder(input);
        return prepared.ok
          ? prepareAndPersistLifecycleChange(
              prepared.value,
              options.chapterRepository,
              options.storyBible,
              options.proofRoot,
              proofIntegrityKey,
              now(),
              traceId
            )
          : prepared;
      });
    },
    async prepareStatus(input) {
      return withOperationTimestamp(async () => {
        const prepared = await coordinator.prepareStatus(input);
        return prepared.ok
          ? prepareAndPersistLifecycleChange(
              prepared.value,
              options.chapterRepository,
              options.storyBible,
              options.proofRoot,
              proofIntegrityKey,
              now(),
              traceId
            )
          : prepared;
      });
    },
    async prepareDelete(input) {
      return withOperationTimestamp(async () => {
        const proof = await createDeleteProof({
          chapterRepository: options.chapterRepository,
          storyBible: options.storyBible,
          chapterId: input.chapterId,
          baseRevision: input.baseRevision,
          now: now(),
          traceId
        });
        if (!proof.ok) return proof;
        const prepared = await coordinator.prepareDelete({ ...input, proof: proof.value });
        return prepared.ok
          ? prepareAndPersistLifecycleChange(
              prepared.value,
              options.chapterRepository,
              options.storyBible,
              options.proofRoot,
              proofIntegrityKey,
              now(),
              traceId
            )
          : prepared;
      });
    },
    async prepareRestore(input) {
      return withOperationTimestamp(async () => {
        const proof = await createRestoreProof({
          chapterRepository: options.chapterRepository,
          storyBible: options.storyBible,
          historyRepository: options.historyRepository,
          chapterId: input.chapterId,
          baseRevision: input.baseRevision,
          now: now(),
          traceId
        });
        if (!proof.ok) return proof;
        const prepared = await coordinator.prepareRestore({ ...input, proof: proof.value });
        return prepared.ok
          ? prepareAndPersistLifecycleChange(
              prepared.value,
              options.chapterRepository,
              options.storyBible,
              options.proofRoot,
              proofIntegrityKey,
              now(),
              traceId
            )
          : prepared;
      });
    },
    async validateAndConsumeLifecyclePreparation(input) {
      const groupId = input.consistencyGroupId;
      if (
        typeof groupId !== "string" ||
        !/^chapter-lifecycle-[a-f0-9]{48}$/u.test(groupId) ||
        (input.operations?.length ?? 0) !== 0
      ) {
        return err(lifecycleProofInvalid(traceId));
      }
      const proofPath = lifecycleProofPath(options.proofRoot, groupId);
      let proof: DurableLifecyclePreparationProof | undefined;
      try {
        proof = parseDurableLifecyclePreparationProof(
          JSON.parse(await readFile(proofPath, "utf8")) as unknown
        );
      } catch {
        return err(lifecycleProofInvalid(traceId));
      }
      if (
        proof === undefined ||
        proof.consistencyGroupId !== groupId ||
        proof.consumedAt !== undefined ||
        reservedProofIds.has(proof.proofId) ||
        input.preparationProof?.proofId !== proof.proofId ||
        input.preparationProof?.proofChecksum !== proof.proofChecksum ||
        proof.canonicalChecksum !== lifecycleTransactionChecksum(proof.files) ||
        proof.proofChecksum !== lifecyclePreparationProofChecksum(proof) ||
        proof.integrityTag !== lifecycleProofIntegrityTag(proof, proofIntegrityKey) ||
        lifecycleTransactionChecksum(input.files) !== proof.canonicalChecksum ||
        !sameLifecycleTransactionFiles(input.files, proof.files)
      ) {
        return err(lifecycleProofInvalid(traceId));
      }
      reservedProofIds.add(proof.proofId);
      const consumed = { ...proof, consumedAt: now() };
      const persisted = await writeTextAtomically({
        targetPath: proofPath,
        content: `${JSON.stringify(
          { ...consumed, integrityTag: lifecycleProofIntegrityTag(consumed, proofIntegrityKey) },
          null,
          2
        )}\n`,
        traceId
      });
      if (!persisted.ok) {
        reservedProofIds.delete(proof.proofId);
        return err(lifecycleProofInvalid(traceId));
      }
      return ok(undefined);
    }
  };

  async function withOperationTimestamp<T>(
    callback: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    if (operationTimestamp !== undefined) return err(lifecycleUnavailable(traceId));
    operationTimestamp = options.now?.() ?? new Date().toISOString();
    try {
      return await callback();
    } finally {
      operationTimestamp = undefined;
    }
  }
}

export function isChapterLifecyclePreparationProofBridge(
  value: ChapterLifecyclePreparationPort | undefined
): value is DesktopChapterLifecyclePreparationPort {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<ChapterLifecyclePreparationProofBridge>).lifecyclePreparationProofBridge ===
      true &&
    typeof (value as Partial<ChapterLifecyclePreparationProofBridge>)
      .validateAndConsumeLifecyclePreparation === "function"
  );
}

async function prepareAndPersistLifecycleChange(
  prepared: PreparedChapterWrite,
  chapterRepository: ChapterFileRepository,
  storyBible: StoryBibleFileRepository,
  proofRoot: string,
  proofIntegrityKey: string,
  createdAt: string,
  traceId: string
): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>> {
  const change = await toPreparedLifecycleChange(prepared, chapterRepository, storyBible, traceId);
  if (!change.ok) return change;
  const files = lifecycleProofFiles(change.value);
  const proof: DurableLifecyclePreparationProof = {
    version: 1,
    proofId: checksum(`${createdAt}\n${change.value.consistencyGroupId}\n${randomProofNonce()}`),
    createdAt,
    operation: change.value.operation,
    targetChapterId: change.value.targetChapterId,
    consistencyGroupId: change.value.consistencyGroupId,
    files,
    canonicalChecksum: lifecycleTransactionChecksum(files),
    proofChecksum: "",
    integrityTag: ""
  };
  const proofWithChecksum: DurableLifecyclePreparationProof = {
    ...proof,
    proofChecksum: lifecyclePreparationProofChecksum(proof)
  };
  const signedProof: DurableLifecyclePreparationProof = {
    ...proofWithChecksum,
    integrityTag: lifecycleProofIntegrityTag(proofWithChecksum, proofIntegrityKey)
  };
  const proofPath = lifecycleProofPath(proofRoot, proof.consistencyGroupId);
  try {
    await mkdir(dirname(proofPath), { recursive: true });
  } catch {
    return err(lifecycleProofUnavailable(traceId));
  }
  const persisted = await writeTextAtomically({
    targetPath: proofPath,
    content: `${JSON.stringify(signedProof, null, 2)}\n`,
    traceId
  });
  return persisted.ok
    ? ok({
        ...change.value,
        preparationProof: {
          proofId: signedProof.proofId,
          proofChecksum: signedProof.proofChecksum
        }
      })
    : err(lifecycleProofUnavailable(traceId));
}

async function toPreparedLifecycleChange(
  prepared: PreparedChapterWrite,
  chapterRepository: ChapterFileRepository,
  storyBible: StoryBibleFileRepository,
  traceId: string
): Promise<Result<PreparedChapterLifecycleChange, UnifiedError>> {
  const chapters: PreparedChapterLifecycleFile[] = [];
  for (const change of prepared.chapters) {
    const chapterId = change.before.frontmatter.id;
    const persisted = await chapterRepository.readSerializedChapter(chapterId);
    if (!persisted.ok) return persisted;
    if (
      chapterLifecycleChecksum(persisted.value.chapter) !== chapterLifecycleChecksum(change.before)
    ) {
      return err(lifecycleStale(traceId));
    }
    const candidateContent = serializeChapterDocument(change.after);
    chapters.push({
      stableRef: `chapter:${chapterId}`,
      assetId: chapterId,
      relativePath: `chapters/${chapterId}.md`,
      baseContent: persisted.value.content,
      candidateContent,
      baseChecksum: checksum(persisted.value.content),
      candidateChecksum: checksum(candidateContent)
    });
  }
  if (chapters.length === 0) return err(lifecycleNoChanges(traceId));
  const outline =
    prepared.outline === undefined
      ? ok(undefined)
      : await prepareOutlineCandidate(
          storyBible,
          chapterRepository,
          prepared.outline.before,
          prepared.outline.after,
          traceId
        );
  if (!outline.ok) return outline;
  if (prepared.operation === "undo") return err(lifecycleUnavailable(traceId));
  const consistencyGroupId = `chapter-lifecycle-${checksum(
    JSON.stringify({
      operation: prepared.operation,
      targetChapterId: prepared.targetChapterId,
      chapters: chapters.map((chapter) => [
        chapter.assetId,
        chapter.baseChecksum,
        chapter.candidateChecksum
      ]),
      outline:
        outline.value === undefined
          ? null
          : [outline.value.baseChecksum, outline.value.candidateChecksum]
    })
  ).slice(0, 48)}`;
  return ok({
    operation: prepared.operation,
    targetChapterId: prepared.targetChapterId,
    consistencyGroupId,
    chapters,
    ...(outline.value === undefined ? {} : { outline: outline.value }),
    ...(prepared.proof === undefined ? {} : { proof: prepared.proof }),
    ...(prepared.referenceImpactChecksum === undefined
      ? {}
      : { referenceImpactChecksum: prepared.referenceImpactChecksum })
  });
}

async function createDeleteProof(input: {
  readonly chapterRepository: ChapterFileRepository;
  readonly storyBible: StoryBibleFileRepository;
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly now: string;
  readonly traceId: string;
}): Promise<Result<ChapterStatusTransitionProof, UnifiedError>> {
  const current = await input.chapterRepository.readChapter(input.chapterId);
  if (!current.ok) return current;
  if (
    chapterRevision(current.value) !== input.baseRevision ||
    current.value.frontmatter.status === "deleted"
  ) {
    return err(lifecycleStale(input.traceId));
  }
  const outline = await readOutlineSnapshot(input.storyBible, input.traceId);
  if (!outline.ok) return outline;
  const placement = placementFor(outline.value, input.chapterId);
  if (!placement.ok) return placement;
  const impact = await readChapterReferenceImpactChecksum(
    input.chapterRepository,
    input.storyBible,
    input.chapterId
  );
  if (!impact.ok) return impact;
  const after = deletedChapter(current.value, input.now);
  return ok(
    createChapterStatusTransitionProof({
      proofId: transitionProofId("delete", input.chapterId, input.now),
      stableRef: `chapter:${input.chapterId}`,
      chapterId: input.chapterId,
      action: "delete",
      beforeStatus: current.value.frontmatter.status,
      afterStatus: "deleted",
      restoreStatus: current.value.frontmatter.status,
      beforeRevision: chapterRevision(current.value),
      afterRevision: chapterRevision(after),
      beforeChecksum: chapterLifecycleChecksum(current.value),
      afterChecksum: chapterLifecycleChecksum(after),
      outlineRevision: outline.value.revision,
      outlineChecksum: outline.value.checksum,
      originalVolumeRef: placement.value.volumeRef,
      beforeNeighborRefs: placement.value.neighbors,
      afterNeighborRefs: placement.value.neighbors,
      referenceImpactChecksum: impact.value,
      createdAt: input.now
    })
  );
}

async function createRestoreProof(input: {
  readonly chapterRepository: ChapterFileRepository;
  readonly storyBible: StoryBibleFileRepository;
  readonly historyRepository: HistoryRepository;
  readonly chapterId: string;
  readonly baseRevision: number;
  readonly now: string;
  readonly traceId: string;
}): Promise<Result<ChapterStatusTransitionProof, UnifiedError>> {
  const current = await input.chapterRepository.readChapter(input.chapterId);
  if (!current.ok) return current;
  if (
    chapterRevision(current.value) !== input.baseRevision ||
    current.value.frontmatter.status !== "deleted"
  ) {
    return err(lifecycleStale(input.traceId));
  }
  const deleteProof = await latestDeleteProof(
    input.historyRepository,
    input.chapterId,
    input.traceId
  );
  if (!deleteProof.ok) return deleteProof;
  if (
    deleteProof.value.afterStatus !== "deleted" ||
    deleteProof.value.afterRevision !== chapterRevision(current.value) ||
    deleteProof.value.afterChecksum !== chapterLifecycleChecksum(current.value) ||
    deleteProof.value.restoreStatus === null ||
    deleteProof.value.restoreStatus === "archived"
  ) {
    return err(lifecycleRestoreUnavailable(input.traceId));
  }
  const outline = await readOutlineSnapshot(input.storyBible, input.traceId);
  if (!outline.ok) return outline;
  const impact = await readChapterReferenceImpactChecksum(
    input.chapterRepository,
    input.storyBible,
    input.chapterId
  );
  if (!impact.ok) return impact;
  const after = restoredChapter(current.value, deleteProof.value, input.now);
  return ok(
    createChapterStatusTransitionProof({
      proofId: transitionProofId("restore", input.chapterId, input.now),
      stableRef: `chapter:${input.chapterId}`,
      chapterId: input.chapterId,
      action: "restore",
      beforeStatus: "deleted",
      afterStatus: deleteProof.value.restoreStatus,
      restoreStatus: deleteProof.value.restoreStatus,
      beforeRevision: chapterRevision(current.value),
      afterRevision: chapterRevision(after),
      beforeChecksum: chapterLifecycleChecksum(current.value),
      afterChecksum: chapterLifecycleChecksum(after),
      outlineRevision: outline.value.revision,
      outlineChecksum: outline.value.checksum,
      originalVolumeRef: deleteProof.value.originalVolumeRef,
      beforeNeighborRefs: deleteProof.value.afterNeighborRefs,
      afterNeighborRefs: deleteProof.value.beforeNeighborRefs,
      referenceImpactChecksum: impact.value,
      createdAt: input.now
    })
  );
}

async function latestDeleteProof(
  historyRepository: HistoryRepository,
  chapterId: string,
  traceId: string
): Promise<Result<ChapterStatusTransitionProof, UnifiedError>> {
  const records = await historyRepository.listTextAssetSnapshotRecords({
    assetType: "chapter",
    assetId: chapterId
  });
  if (!records.ok) return records;
  for (const record of records.value) {
    if (record.chapterStatusTransitionProof === undefined) continue;
    try {
      const proof = parseChapterStatusTransitionProof(record.chapterStatusTransitionProof);
      if (proof.action === "delete" && proof.chapterId === chapterId) return ok(proof);
    } catch {
      return err(lifecycleRestoreUnavailable(traceId));
    }
  }
  return err(lifecycleRestoreUnavailable(traceId));
}

async function readOutlineSnapshot(
  storyBible: StoryBibleFileRepository,
  traceId: string
): Promise<Result<ChapterOutlineSnapshot, UnifiedError>> {
  const read = await storyBible.readCompatibleStoryAsset("outline_main");
  if (!read.ok) return err(lifecycleOutlineUnavailable(traceId));
  if (read.value.asset.type !== "outline" || !Array.isArray(read.value.asset.details["volumes"])) {
    return err(lifecycleOutlineUnavailable(traceId));
  }
  const volumes = read.value.asset.details["volumes"];
  const mapped: Array<{
    readonly stableRef: string;
    readonly volumeId: string;
    readonly chapterIds: readonly string[];
  }> = [];
  for (const volume of volumes) {
    if (
      !isRecord(volume) ||
      typeof volume["volumeId"] !== "string" ||
      !Array.isArray(volume["chapterIds"])
    ) {
      return err(lifecycleOutlineUnavailable(traceId));
    }
    const chapterIds = volume["chapterIds"];
    if (chapterIds.some((chapterId) => typeof chapterId !== "string"))
      return err(lifecycleOutlineUnavailable(traceId));
    mapped.push({
      stableRef: `story_bible:${volume["volumeId"]}`,
      volumeId: volume["volumeId"],
      chapterIds: [...chapterIds] as string[]
    });
  }
  return ok({
    revision: read.value.revision,
    checksum: read.value.checksum,
    volumes: mapped
  });
}

async function prepareOutlineCandidate(
  storyBible: StoryBibleFileRepository,
  chapterRepository: ChapterFileRepository,
  before: ChapterOutlineSnapshot,
  after: ChapterOutlineSnapshot,
  traceId: string
): Promise<Result<PreparedChapterLifecycleFile, UnifiedError>> {
  const current = await storyBible.readCompatibleStoryAsset("outline_main");
  if (
    !current.ok ||
    current.value.asset.type !== "outline" ||
    current.value.revision !== before.revision ||
    current.value.checksum !== before.checksum
  ) {
    return err(lifecycleStale(traceId));
  }
  const details = structuredClone(current.value.asset.details);
  const rawVolumes = details["volumes"];
  if (!Array.isArray(rawVolumes)) return err(lifecycleOutlineUnavailable(traceId));
  const afterById = new Map(after.volumes.map((volume) => [volume.volumeId, volume.chapterIds]));
  const volumes: JsonObject[] = [];
  for (const volume of rawVolumes) {
    if (!isRecord(volume) || typeof volume["volumeId"] !== "string")
      return err(lifecycleOutlineUnavailable(traceId));
    const chapterIds = afterById.get(volume["volumeId"]);
    if (chapterIds === undefined) return err(lifecycleOutlineUnavailable(traceId));
    volumes.push({ ...volume, chapterIds: [...chapterIds] });
  }
  const {
    updatedAt: _updatedAt,
    revision: _revision,
    relatedEntityIds: _related,
    passthrough: _passthrough,
    ...candidate
  } = current.value.asset;
  void _updatedAt;
  void _revision;
  void _related;
  void _passthrough;
  const catalog = await chapterRepository.listChapterCatalog({ includeDeleted: true, limit: 100 });
  if (!catalog.ok) return catalog;
  if (catalog.value.nextCursor !== null) return err(lifecycleUnavailable(traceId));
  const prepared = await storyBible.prepareStoryAssetCandidateReadOnly({
    candidate: { ...candidate, details: { ...details, volumes } },
    baseRevision: current.value.revision,
    baseChecksum: current.value.checksum,
    knownChapterIds: catalog.value.items.map((chapter) => chapter.chapterId)
  });
  if (!prepared.ok) return prepared;
  return ok({
    stableRef: "story_bible:outline_main",
    assetId: "outline_main",
    relativePath: prepared.value.relativePath,
    baseContent: prepared.value.baseContent,
    candidateContent: prepared.value.content,
    baseChecksum: prepared.value.baseChecksum,
    candidateChecksum: checksum(prepared.value.content)
  });
}

async function readChapterReferenceImpactChecksum(
  chapterRepository: ChapterFileRepository,
  storyBible: StoryBibleFileRepository,
  chapterId: string
): Promise<Result<string, UnifiedError>> {
  const catalog = await chapterRepository.listChapterCatalog({ includeDeleted: true, limit: 100 });
  if (!catalog.ok) return catalog;
  if (catalog.value.nextCursor !== null)
    return err(lifecycleUnavailable("desktop-agent-chapter-lifecycle"));
  return storyBible.getChapterReferenceImpactChecksum(
    chapterId,
    catalog.value.items.map((chapter) => chapter.chapterId)
  );
}

function placementFor(
  outline: ChapterOutlineSnapshot,
  chapterId: string
): Result<
  {
    readonly volumeRef: string | null;
    readonly neighbors: { readonly before: string | null; readonly after: string | null };
  },
  UnifiedError
> {
  const volume = outline.volumes.find((candidate) => candidate.chapterIds.includes(chapterId));
  if (volume === undefined)
    return err(lifecycleOutlineUnavailable("desktop-agent-chapter-lifecycle"));
  const index = volume.chapterIds.indexOf(chapterId);
  const before = volume.chapterIds[index - 1] ?? null;
  const after = volume.chapterIds[index + 1] ?? null;
  return ok({
    volumeRef: volume.stableRef,
    neighbors: {
      before: before === null ? null : `chapter:${before}`,
      after: after === null ? null : `chapter:${after}`
    }
  });
}

function deletedChapter(chapter: ChapterDocument, updatedAt: string): ChapterDocument {
  const frontmatter = {
    ...chapter.frontmatter,
    status: "deleted" as const,
    revision: chapterRevision(chapter) + 1,
    updatedAt
  };
  delete frontmatter.volumeId;
  return { ...chapter, frontmatter };
}

function restoredChapter(
  chapter: ChapterDocument,
  deleteProof: ChapterStatusTransitionProof,
  updatedAt: string
): ChapterDocument {
  const frontmatter = {
    ...chapter.frontmatter,
    status: deleteProof.restoreStatus as NonNullable<typeof deleteProof.restoreStatus>,
    revision: chapterRevision(chapter) + 1,
    updatedAt
  };
  if (deleteProof.originalVolumeRef !== null) {
    frontmatter.volumeId = deleteProof.originalVolumeRef.slice("story_bible:".length);
  }
  return { ...chapter, frontmatter };
}

function chapterRevision(chapter: ChapterDocument): number {
  return typeof chapter.frontmatter.revision === "number" ? chapter.frontmatter.revision : 1;
}

function transitionProofId(
  action: "delete" | "restore",
  chapterId: string,
  createdAt: string
): string {
  return `chapter-${action}-${checksum(`${chapterId}\n${createdAt}`).slice(0, 32)}`;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function lifecycleProofFiles(
  change: PreparedChapterLifecycleChange
): readonly LifecycleProofTransactionFile[] {
  return [
    ...change.chapters.map((file) => ({
      relativePath: file.relativePath,
      assetType: "chapter" as const,
      contentMode: "serialized_chapter" as const,
      assetId: file.assetId,
      baseContent: file.baseContent,
      candidateContent: file.candidateContent,
      baseChecksum: file.baseChecksum,
      candidateChecksum: file.candidateChecksum,
      ...(change.proof === undefined || file.assetId !== change.targetChapterId
        ? {}
        : { chapterStatusTransitionProof: change.proof })
    })),
    ...(change.outline === undefined
      ? []
      : [
          {
            relativePath: change.outline.relativePath,
            assetType: "text" as const,
            assetId: change.outline.assetId,
            baseContent: change.outline.baseContent,
            candidateContent: change.outline.candidateContent,
            baseChecksum: change.outline.baseChecksum,
            candidateChecksum: change.outline.candidateChecksum
          }
        ])
  ];
}

function lifecycleProofPath(proofRoot: string, consistencyGroupId: string): string {
  return join(proofRoot, "agent-lifecycle-preparation-proofs", `${consistencyGroupId}.json`);
}

function randomProofNonce(): string {
  return randomBytes(32).toString("hex");
}

function lifecycleTransactionChecksum(files: readonly LifecycleProofTransactionFile[]): string {
  return checksum(JSON.stringify(files));
}

function lifecycleProofIntegrityTag(proof: DurableLifecyclePreparationProof, key: string): string {
  const { integrityTag: _integrityTag, ...unsigned } = proof;
  void _integrityTag;
  return createHmac("sha256", key).update(JSON.stringify(unsigned), "utf8").digest("hex");
}

function lifecyclePreparationProofChecksum(proof: DurableLifecyclePreparationProof): string {
  const {
    integrityTag: _integrityTag,
    proofChecksum: _proofChecksum,
    consumedAt: _consumedAt,
    ...unsigned
  } = proof;
  void _integrityTag;
  void _proofChecksum;
  void _consumedAt;
  return checksum(JSON.stringify(unsigned));
}

function sameLifecycleTransactionFiles(
  actual: readonly LifecycleProofTransactionFile[],
  expected: readonly LifecycleProofTransactionFile[]
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseDurableLifecyclePreparationProof(
  value: unknown
): DurableLifecyclePreparationProof | undefined {
  if (!isRecord(value) || value["version"] !== 1) return undefined;
  const proofId = value["proofId"];
  const createdAt = value["createdAt"];
  const operation = value["operation"];
  const targetChapterId = value["targetChapterId"];
  const consistencyGroupId = value["consistencyGroupId"];
  const files = value["files"];
  const canonicalChecksum = value["canonicalChecksum"];
  const proofChecksum = value["proofChecksum"];
  const integrityTag = value["integrityTag"];
  const consumedAt = value["consumedAt"];
  if (
    typeof proofId !== "string" ||
    !/^[a-f0-9]{64}$/u.test(proofId) ||
    typeof createdAt !== "string" ||
    !["rename", "reorder", "status", "delete", "restore"].includes(operation as string) ||
    typeof targetChapterId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(targetChapterId) ||
    typeof consistencyGroupId !== "string" ||
    !/^chapter-lifecycle-[a-f0-9]{48}$/u.test(consistencyGroupId) ||
    !Array.isArray(files) ||
    files.length === 0 ||
    !files.every(isLifecycleProofTransactionFile) ||
    typeof canonicalChecksum !== "string" ||
    !/^[a-f0-9]{64}$/u.test(canonicalChecksum) ||
    typeof proofChecksum !== "string" ||
    !/^[a-f0-9]{64}$/u.test(proofChecksum) ||
    typeof integrityTag !== "string" ||
    !/^[a-f0-9]{64}$/u.test(integrityTag) ||
    (consumedAt !== undefined && typeof consumedAt !== "string")
  ) {
    return undefined;
  }
  const proof: DurableLifecyclePreparationProof = {
    version: 1,
    proofId,
    createdAt,
    operation: operation as PreparedChapterLifecycleChange["operation"],
    targetChapterId,
    consistencyGroupId,
    files: files as unknown as LifecycleProofTransactionFile[],
    canonicalChecksum,
    proofChecksum,
    integrityTag,
    ...(consumedAt === undefined ? {} : { consumedAt })
  };
  return proof.proofChecksum === lifecyclePreparationProofChecksum(proof) ? proof : undefined;
}

function isLifecycleProofTransactionFile(value: unknown): value is LifecycleProofTransactionFile {
  if (!isRecord(value)) return false;
  const proof = value["chapterStatusTransitionProof"];
  return (
    typeof value["relativePath"] === "string" &&
    (value["assetType"] === "chapter" || value["assetType"] === "text") &&
    (value["contentMode"] === undefined || value["contentMode"] === "serialized_chapter") &&
    (value["assetId"] === undefined || typeof value["assetId"] === "string") &&
    typeof value["baseContent"] === "string" &&
    typeof value["candidateContent"] === "string" &&
    typeof value["baseChecksum"] === "string" &&
    typeof value["candidateChecksum"] === "string" &&
    (proof === undefined || isChapterStatusTransitionProof(proof))
  );
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lifecycleUnavailable(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_PREPARATION_UNAVAILABLE",
    "Chapter lifecycle preparation is unavailable."
  );
}

function lifecycleOutlineUnavailable(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_OUTLINE_WRITE_REQUIRED",
    "A valid writable Story Bible outline is required for this lifecycle operation."
  );
}

function lifecycleRestoreUnavailable(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_RESTORE_PROOF_UNAVAILABLE",
    "The deleted chapter does not have a current authenticated restore proof."
  );
}

function lifecycleStale(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_STALE",
    "The chapter lifecycle evidence changed; refresh and prepare again."
  );
}

function lifecycleNoChanges(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_NO_CHANGES",
    "The chapter lifecycle operation did not produce a Change Set candidate."
  );
}

function lifecycleProofUnavailable(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_PREPARATION_PROOF_UNAVAILABLE",
    "The Main-owned lifecycle preparation proof could not be persisted."
  );
}

function lifecycleProofInvalid(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_PREPARATION_PROOF_INVALID",
    "The lifecycle Change Set no longer matches a current Main-owned preparation proof."
  );
}

function directWriteForbidden(traceId: string): UnifiedError {
  return lifecycleError(
    traceId,
    "CHAPTER_LIFECYCLE_DIRECT_WRITE_FORBIDDEN",
    "Lifecycle preparation cannot write directly; apply the approved Change Set instead."
  );
}

function lifecycleError(traceId: string, code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the chapter lifecycle proposal and retry.",
    traceId
  });
}
