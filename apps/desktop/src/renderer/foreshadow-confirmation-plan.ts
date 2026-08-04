import type { ForeshadowAnalysisCandidateDto, ForeshadowAsset } from "@novel-studio/application";
import {
  createForeshadowEvidence,
  type ForeshadowSourceRef,
  type ForeshadowTrackingStatus
} from "@novel-studio/shared";
import type {
  StoryBibleForeshadowChangeItem,
  StoryBibleForeshadowFieldChange
} from "@novel-studio/ui";
import { validateStoryBibleForeshadow } from "@novel-studio/ui";

type UpdateCandidate = Exclude<ForeshadowAnalysisCandidateDto, { readonly kind: "new" }>;

export interface ForeshadowConfirmationPlanInput {
  readonly candidates: readonly ForeshadowAnalysisCandidateDto[];
  readonly selectedCandidateIds: readonly string[];
  readonly foreshadows: readonly ForeshadowAsset[];
  readonly chapterIdsInOrder: readonly string[];
  readonly createAssetIdentity: () => string;
  readonly now: () => string;
}

export interface ForeshadowConfirmationOperation {
  readonly changeId: string;
  readonly sourceCandidateIds: readonly string[];
  readonly baseAsset?: ForeshadowAsset;
  readonly asset: ForeshadowAsset;
  readonly preview: StoryBibleForeshadowChangeItem;
}

export interface ForeshadowConfirmationPlan {
  readonly operations: readonly ForeshadowConfirmationOperation[];
  readonly referencedChapterIds: readonly string[];
}

export type ForeshadowConfirmationPlanResult =
  | { readonly ok: true; readonly value: ForeshadowConfirmationPlan }
  | { readonly ok: false; readonly message: string };

export async function createForeshadowConfirmationPlan(
  input: ForeshadowConfirmationPlanInput
): Promise<ForeshadowConfirmationPlanResult> {
  const selectedIds = new Set(input.selectedCandidateIds);
  if (selectedIds.size === 0) {
    return { ok: false, message: "请至少选择一条伏笔候选。" };
  }

  const selectedCandidates = input.candidates.filter((candidate) =>
    selectedIds.has(candidate.candidateId)
  );
  if (selectedCandidates.length !== selectedIds.size) {
    return { ok: false, message: "所选伏笔候选已失效，请重新选择。" };
  }

  const chapterOrder = new Map(
    input.chapterIdsInOrder.map((chapterId, index) => [chapterId, index] as const)
  );
  if (selectedCandidates.some((candidate) => !candidateChaptersExist(candidate, chapterOrder))) {
    return { ok: false, message: "候选引用的章节已不存在，请返回候选并重新识别。" };
  }

  const descriptors: Array<
    | {
        readonly kind: "new";
        readonly candidate: Extract<ForeshadowAnalysisCandidateDto, { kind: "new" }>;
      }
    | {
        readonly kind: "update";
        readonly targetForeshadowId: string;
        readonly candidates: UpdateCandidate[];
      }
  > = [];
  const updateDescriptors = new Map<
    string,
    Extract<(typeof descriptors)[number], { readonly kind: "update" }>
  >();

  for (const candidate of selectedCandidates) {
    if (candidate.kind === "new") {
      descriptors.push({ kind: "new", candidate });
      continue;
    }
    const existing = updateDescriptors.get(candidate.targetForeshadowId);
    if (existing === undefined) {
      const descriptor = {
        kind: "update" as const,
        targetForeshadowId: candidate.targetForeshadowId,
        candidates: [candidate]
      };
      updateDescriptors.set(candidate.targetForeshadowId, descriptor);
      descriptors.push(descriptor);
    } else {
      existing.candidates.push(candidate);
    }
  }

  const foreshadowsById = new Map(input.foreshadows.map((asset) => [asset.id, asset] as const));
  for (const descriptor of updateDescriptors.values()) {
    const target = foreshadowsById.get(descriptor.targetForeshadowId);
    if (target === undefined || target.status === "deleted") {
      return { ok: false, message: "目标伏笔已不存在，请返回候选并重新识别。" };
    }
  }

  try {
    const timestamp = input.now();
    const operations: ForeshadowConfirmationOperation[] = [];
    const reservedAssetIds = new Set(input.foreshadows.map((asset) => asset.id));
    let workingForeshadows = [...input.foreshadows];
    for (const descriptor of descriptors) {
      let operation: ForeshadowConfirmationOperation;
      if (descriptor.kind === "new") {
        const nextOperation = await createOperation(
          descriptor.candidate,
          input,
          timestamp,
          reservedAssetIds
        );
        if (nextOperation === undefined) {
          return { ok: false, message: "无法生成伏笔 ID，请重试。" };
        }
        operation = nextOperation;
      } else {
        const target = foreshadowsById.get(descriptor.targetForeshadowId);
        if (target === undefined) {
          return { ok: false, message: "目标伏笔已不存在，请返回候选并重新识别。" };
        }
        operation = await updateOperation(target, descriptor.candidates, chapterOrder, timestamp);
      }

      if (
        validateStoryBibleForeshadow(operation.asset, workingForeshadows).some(
          (issue) => issue.severity === "error"
        )
      ) {
        return {
          ok: false,
          message: "所选候选与现有伏笔包含重复或无效的原文证据，请返回候选重新选择。"
        };
      }
      operations.push(operation);
      reservedAssetIds.add(operation.asset.id);
      workingForeshadows = [
        ...workingForeshadows.filter((asset) => asset.id !== operation.asset.id),
        operation.asset
      ];
    }
    const referencedChapterIds = input.chapterIdsInOrder.filter((chapterId) =>
      selectedCandidates.some((candidate) => candidateReferencesChapter(candidate, chapterId))
    );
    return { ok: true, value: { operations, referencedChapterIds } };
  } catch {
    return { ok: false, message: "无法准备伏笔变更，请稍后重试。" };
  }
}

async function createOperation(
  candidate: Extract<ForeshadowAnalysisCandidateDto, { readonly kind: "new" }>,
  input: ForeshadowConfirmationPlanInput,
  timestamp: string,
  reservedAssetIds: ReadonlySet<string>
): Promise<ForeshadowConfirmationOperation | undefined> {
  const assetId = createAvailableAssetId(input.createAssetIdentity, reservedAssetIds);
  if (assetId === undefined) return undefined;

  const evidence = await createForeshadowEvidence(
    candidate.evidence.chapterId,
    candidate.evidence.excerpt
  );
  const asset: ForeshadowAsset = {
    schemaVersion: "1.0",
    id: assetId,
    type: "foreshadow",
    title: candidate.suggested.title,
    status: "active",
    summary: candidate.suggested.summary,
    aliases: [],
    relatedEntityIds: [...(candidate.suggested.relatedEntityIds ?? [])],
    createdAt: timestamp,
    updatedAt: timestamp,
    details: {
      trackingStatus: "planted",
      plantedChapterId: candidate.suggested.plantedChapterId,
      sourceRefs: [evidence],
      origin: "ai-confirmed",
      ...(candidate.suggested.plannedPayoffChapterId === undefined
        ? {}
        : { plannedPayoffChapterId: candidate.suggested.plannedPayoffChapterId }),
      ...(candidate.suggested.notes === undefined ? {} : { notes: candidate.suggested.notes })
    }
  };
  const fields: StoryBibleForeshadowFieldChange[] = [
    { field: "title", after: asset.title },
    { field: "summary", after: asset.summary },
    { field: "trackingStatus", after: asset.details.trackingStatus },
    { field: "plantedChapterId", after: candidate.suggested.plantedChapterId },
    ...(candidate.suggested.plannedPayoffChapterId === undefined
      ? []
      : [
          {
            field: "plannedPayoffChapterId" as const,
            after: candidate.suggested.plannedPayoffChapterId
          }
        ]),
    ...(candidate.suggested.notes === undefined
      ? []
      : [{ field: "notes" as const, after: candidate.suggested.notes }]),
    ...(asset.relatedEntityIds === undefined || asset.relatedEntityIds.length === 0
      ? []
      : [{ field: "relatedEntityIds" as const, after: asset.relatedEntityIds.join("、") }])
  ];
  const changeId = `new:${candidate.candidateId}`;
  return {
    changeId,
    sourceCandidateIds: [candidate.candidateId],
    asset,
    preview: {
      changeId,
      operation: "create",
      assetId: asset.id,
      title: asset.title,
      sourceCandidateIds: [candidate.candidateId],
      fields,
      evidenceAdditions: [evidence],
      status: "pending"
    }
  };
}

function createAvailableAssetId(
  createAssetIdentity: () => string,
  reservedAssetIds: ReadonlySet<string>
): string | undefined {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const identity = createAssetIdentity();
    if (!/^[0-9a-f]{32}$/u.test(identity)) return undefined;
    const assetId = `fsh_${identity}`;
    if (!reservedAssetIds.has(assetId)) return assetId;
  }
  return undefined;
}

async function updateOperation(
  target: ForeshadowAsset,
  candidates: readonly UpdateCandidate[],
  chapterOrder: ReadonlyMap<string, number>,
  timestamp: string
): Promise<ForeshadowConfirmationOperation> {
  const ordered = [...candidates].sort((left, right) => {
    const leftOrder = chapterOrder.get(left.evidence.chapterId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = chapterOrder.get(right.evidence.chapterId) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.candidateId.localeCompare(right.candidateId);
  });
  const normalizedEvidence = await Promise.all(
    ordered.map((candidate) =>
      createForeshadowEvidence(candidate.evidence.chapterId, candidate.evidence.excerpt)
    )
  );
  const sourceRefs = [...(target.details.sourceRefs ?? [])];
  const sourceKeys = new Set(sourceRefs.map(evidenceKey));
  const evidenceAdditions: ForeshadowSourceRef[] = [];
  for (const evidence of normalizedEvidence) {
    const key = evidenceKey(evidence);
    if (sourceKeys.has(key)) continue;
    sourceKeys.add(key);
    sourceRefs.push(evidence);
    evidenceAdditions.push(evidence);
  }

  let summary = target.summary;
  let notes = target.details.notes;
  let trackingStatus: ForeshadowTrackingStatus = target.details.trackingStatus;
  for (const candidate of ordered) {
    if (candidate.suggested.summary !== undefined) summary = candidate.suggested.summary;
    if (candidate.suggested.notes !== undefined) notes = candidate.suggested.notes;
    if (candidate.kind === "progress") trackingStatus = candidate.suggested.trackingStatus;
  }
  const payoffs = ordered.filter(
    (candidate): candidate is Extract<UpdateCandidate, { readonly kind: "payoff" }> =>
      candidate.kind === "payoff"
  );
  const finalPayoff = payoffs.at(-1);
  if (finalPayoff !== undefined) trackingStatus = "paid-off";

  const asset: ForeshadowAsset = {
    ...target,
    summary,
    updatedAt: timestamp,
    details: {
      ...target.details,
      trackingStatus,
      sourceRefs,
      ...(notes === undefined ? {} : { notes }),
      ...(finalPayoff === undefined
        ? {}
        : { actualPayoffChapterId: finalPayoff.suggested.actualPayoffChapterId })
    }
  };
  const fields = changedFields(target, asset, finalPayoff !== undefined);
  const changeId = `update:${target.id}`;
  const sourceCandidateIds = ordered.map((candidate) => candidate.candidateId);
  return {
    changeId,
    sourceCandidateIds,
    baseAsset: target,
    asset,
    preview: {
      changeId,
      operation: "update",
      assetId: target.id,
      title: target.title,
      sourceCandidateIds,
      fields,
      evidenceAdditions,
      status: "pending"
    }
  };
}

function changedFields(
  before: ForeshadowAsset,
  after: ForeshadowAsset,
  includeActualPayoff: boolean
): readonly StoryBibleForeshadowFieldChange[] {
  return [
    change("summary", before.summary, after.summary),
    change("trackingStatus", before.details.trackingStatus, after.details.trackingStatus),
    includeActualPayoff
      ? change(
          "actualPayoffChapterId",
          before.details.actualPayoffChapterId,
          after.details.actualPayoffChapterId
        )
      : undefined,
    change("notes", before.details.notes, after.details.notes)
  ].filter((item): item is StoryBibleForeshadowFieldChange => item !== undefined);
}

function change(
  field: StoryBibleForeshadowFieldChange["field"],
  before: string | undefined,
  after: string | undefined
): StoryBibleForeshadowFieldChange | undefined {
  if (after === undefined || before === after) return undefined;
  return { field, ...(before === undefined ? {} : { before }), after };
}

function candidateChaptersExist(
  candidate: ForeshadowAnalysisCandidateDto,
  chapterOrder: ReadonlyMap<string, number>
): boolean {
  if (!chapterOrder.has(candidate.evidence.chapterId)) return false;
  if (candidate.kind === "new") {
    return (
      chapterOrder.has(candidate.suggested.plantedChapterId) &&
      (candidate.suggested.plannedPayoffChapterId === undefined ||
        chapterOrder.has(candidate.suggested.plannedPayoffChapterId))
    );
  }
  return candidate.kind !== "payoff" || chapterOrder.has(candidate.suggested.actualPayoffChapterId);
}

function candidateReferencesChapter(
  candidate: ForeshadowAnalysisCandidateDto,
  chapterId: string
): boolean {
  if (candidate.evidence.chapterId === chapterId) return true;
  if (candidate.kind === "new") {
    return (
      candidate.suggested.plantedChapterId === chapterId ||
      candidate.suggested.plannedPayoffChapterId === chapterId
    );
  }
  return candidate.kind === "payoff" && candidate.suggested.actualPayoffChapterId === chapterId;
}

function evidenceKey(evidence: ForeshadowSourceRef): string {
  return `${evidence.chapterId}\u0000${evidence.excerptHash}`;
}
