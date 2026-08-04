import type {
  StoryBibleCreateValue,
  StoryBibleEditableAsset,
  ForeshadowAsset,
  MemoryRecord,
  NovelStudioApi,
  StoryBibleAsset,
  StoryBibleConsistencyRef,
  StoryBibleConsistencyReport,
  StoryBibleReferenceImpact,
  StoryBibleRegularAsset,
  StoryBibleExplicitInverseSourceCommand,
  StoryBibleSnapshot,
  StoryBibleWriteCandidate
} from "@novel-studio/application";
import type { ContextDraftActiveResourceRef } from "@novel-studio/agent-engine";
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import { createForeshadowEvidence, createUnifiedError } from "@novel-studio/shared";
import {
  storyBibleForeshadowValidationMessage,
  storyBibleOutlineValidationMessage,
  storyBibleTimelineValidationMessage,
  validateStoryBibleForeshadow,
  validateStoryBibleOutline,
  validateStoryBibleTimeline
} from "@novel-studio/ui";
import type {
  StoryBibleEditorDraft,
  StoryBibleEditorDraftFor,
  StoryBibleEditorEntry,
  StoryBibleEditorFilters,
  StoryBibleForeshadowChangeItem,
  StoryBibleForeshadowAnalysisState,
  StoryBibleEditorKind,
  StoryBibleEditorProps,
  StoryBibleEditorRelation,
  StoryBibleExplicitInversePreviewState,
  StoryBibleWorldAssetType,
  StoryBibleConsistencyProps,
  StoryBibleStatusAction,
  StoryBibleStatusActionState,
  StoryTimelineEvent,
  StoryBibleSummaryAsset,
  StoryBibleSummaryProps
} from "@novel-studio/ui";

import {
  createForeshadowConfirmationPlan,
  type ForeshadowConfirmationOperation,
  type ForeshadowConfirmationPlan
} from "./foreshadow-confirmation-plan.js";

export interface StoryBibleBridge {
  getProps(): StoryBibleSummaryProps;
  getEditorProps(): StoryBibleEditorProps;
  getSnapshot(): StoryBibleSnapshot;
  getSnapshotBinding(workspaceId?: string): StoryBibleSnapshotBinding | undefined;
  getActiveResourceRef(): ContextDraftActiveResourceRef | null;
  clear(): void;
  load(workspaceId: string): Promise<StoryBibleSummaryProps>;
  selectKind(kind: StoryBibleEditorKind): StoryBibleEditorProps;
  selectEntry(entryId: string): StoryBibleEditorProps;
  selectEntryForEditing(entryId: string): Promise<StoryBibleEditorProps>;
  beginCreate(
    kind: StoryBibleEditorKind,
    assetType?: StoryBibleWorldAssetType
  ): StoryBibleEditorProps;
  cancelDraft(): StoryBibleEditorProps;
  cancelExplicitInversePreview(): Promise<StoryBibleEditorProps>;
  updateDraft<K extends StoryBibleEditorKind>(
    kind: K,
    draft: Partial<StoryBibleEditorDraftFor<K>>
  ): StoryBibleEditorProps;
  updateFilters(filters: Partial<StoryBibleEditorFilters>): StoryBibleEditorProps;
  openForeshadowAnalysis(defaultChapterId?: string): StoryBibleEditorProps;
  toggleForeshadowAnalysisChapter(chapterId: string): StoryBibleEditorProps;
  prepareForeshadowAnalysis(): ForeshadowAnalysisPreparation;
  beginForeshadowAnalysis(token: number): ForeshadowAnalysisStart;
  cancelForeshadowAnalysisPreparation(token: number): ForeshadowAnalysisTransition;
  failForeshadowAnalysisPreparation(token: number, message: string): ForeshadowAnalysisTransition;
  detectForeshadows(token: number): Promise<ForeshadowAnalysisTransition>;
  toggleForeshadowAnalysisCandidate(candidateId: string): StoryBibleEditorProps;
  beginForeshadowAnalysisPreview(): ForeshadowAnalysisStart;
  prepareForeshadowAnalysisPreview(
    token: number,
    chapterIdsInOrder: readonly string[]
  ): Promise<ForeshadowAnalysisTransition>;
  backToForeshadowAnalysisCandidates(): StoryBibleEditorProps;
  beginForeshadowAnalysisSave(retryFailedOnly: boolean): ForeshadowAnalysisStart;
  saveForeshadowAnalysisChanges(token: number): Promise<ForeshadowAnalysisTransition>;
  closeForeshadowAnalysis(): StoryBibleEditorProps;
  handleExternalUpdate(input: StoryBibleExternalUpdateInput): Promise<StoryBibleEditorProps>;
  handleStoryAnalysisExternalUpdate(input: {
    readonly projectId: string;
    readonly updateId: string;
  }): Promise<StoryBibleEditorProps>;
  reloadExternalUpdate(): Promise<StoryBibleEditorProps>;
  continueExternalUpdate(): StoryBibleEditorProps;
  requestStatusAction(action: StoryBibleStatusAction): Promise<StoryBibleEditorProps>;
  cancelStatusAction(): StoryBibleEditorProps;
  confirmStatusAction(): Promise<StoryBibleStatusActionPreparation>;
  beginSave(): StoryBibleEditorProps;
  saveDraft(options?: StoryBibleSaveOptions): Promise<StoryBibleEditorProps>;
}

export interface StoryBibleExternalUpdateInput {
  readonly projectId: string;
  readonly reason: "agent-change-set-apply" | "agent-run-undo";
  readonly versionGroupId: string;
  readonly relativePaths: readonly string[];
}

export interface ForeshadowAnalysisPreparation {
  readonly editor: StoryBibleEditorProps;
  readonly token?: number;
}

export interface ForeshadowAnalysisStart {
  readonly editor: StoryBibleEditorProps;
  readonly started: boolean;
  readonly token?: number;
}

export interface ForeshadowAnalysisTransition {
  readonly editor: StoryBibleEditorProps;
  readonly applied: boolean;
}

export interface StoryBibleSaveOptions {
  readonly chapterIds?: readonly string[];
}

export interface StoryBibleStatusActionPreparation {
  readonly editor: StoryBibleEditorProps;
  readonly readyToSave: boolean;
}

export interface StoryBibleBridgeOptions {
  readonly createAssetIdentity?: () => string;
  readonly createEntryIdentity?: () => string;
  readonly now?: () => string;
}

export interface StoryBibleSnapshotBinding {
  readonly workspaceId: string;
  readonly snapshot: StoryBibleSnapshot;
}

interface StoryBibleEditorState {
  readonly activeKind: StoryBibleEditorKind;
  readonly activeTimelineEventId: string | undefined;
  readonly viewMode: StoryBibleEditorProps["viewMode"];
  readonly status: StoryBibleEditorProps["status"];
  readonly dirty: boolean;
  readonly draft: StoryBibleEditorDraft;
  readonly filters: StoryBibleEditorFilters;
  readonly foreshadowAnalysis: StoryBibleForeshadowAnalysisState;
  readonly externalUpdate: StoryBibleEditorProps["externalUpdate"];
  readonly statusAction: StoryBibleStatusActionState;
  readonly explicitInversePreview?: StoryBibleExplicitInversePreviewState;
  readonly feedback?: StoryBibleEditorProps["feedback"];
}

interface StoryBibleAffectedPath {
  readonly kind: StoryBibleEditorKind;
  readonly assetId?: string;
}

interface PendingStoryBibleExternalUpdate extends StoryBibleExternalUpdateInput {
  readonly affectedPaths: readonly StoryBibleAffectedPath[];
}

type PendingStoryBibleStatusTransition =
  | {
      readonly action: "move-to-deleted";
      readonly expectedDeletionImpactChecksum: string;
    }
  | { readonly action: "restore" };

const DEFAULT_FILTERS: StoryBibleEditorFilters = {
  query: "",
  status: "available",
  worldAssetType: "all",
  foreshadowTrackingStatus: "all"
};

export function createStoryBibleBridge(
  api: NovelStudioApi,
  options: StoryBibleBridgeOptions = {}
): StoryBibleBridge {
  const createAssetIdentity = options.createAssetIdentity ?? createRandomAssetIdentity;
  const createEntryIdentity = options.createEntryIdentity ?? createRandomAssetIdentity;
  const now = options.now ?? (() => new Date().toISOString());
  let props: StoryBibleSummaryProps = { assets: [] };
  let snapshot = emptySnapshot();
  let snapshotBinding: StoryBibleSnapshotBinding | undefined;
  let loadGeneration = 0;
  let foreshadowAnalysisGeneration = 0;
  let foreshadowConfirmationPlan: ForeshadowConfirmationPlan | undefined;
  let consistency: StoryBibleConsistencyProps | undefined;
  let baselineDraft = emptyDraft("character");
  let baselineAsset: StoryBibleAsset | undefined;
  let baselineEditableAsset: StoryBibleEditableAsset | undefined;
  let entryLoadGeneration = 0;
  let externalRefreshGeneration = 0;
  let statusActionGeneration = 0;
  let explicitInverseGeneration = 0;
  let pendingStatusTransition: PendingStoryBibleStatusTransition | undefined;
  let pendingExternalUpdates: PendingStoryBibleExternalUpdate[] = [];
  let validateExternalBaselineBeforeSave = false;
  const handledVersionGroupIds = new Set<string>();
  let editorState: StoryBibleEditorState = {
    activeKind: "character",
    activeTimelineEventId: undefined,
    viewMode: "list",
    status: "idle",
    dirty: false,
    draft: baselineDraft,
    filters: DEFAULT_FILTERS,
    foreshadowAnalysis: closedForeshadowAnalysis(),
    externalUpdate: { status: "none" },
    statusAction: { status: "idle" }
  };
  let editorProps = createEditorProps(snapshot, editorState, consistency);

  const publishEditor = (): StoryBibleEditorProps => {
    editorProps = createEditorProps(snapshot, editorState, consistency);
    return editorProps;
  };

  return {
    getProps: () => props,
    getEditorProps: () => editorProps,
    getSnapshot: () => snapshot,
    getActiveResourceRef() {
      if (editorState.viewMode !== "detail" || editorState.draft.id === undefined) return null;
      return {
        kind: "story_bible",
        refId: `story_bible:${editorState.draft.id}`,
        assetId: editorState.draft.id,
        label: baselineAsset?.title.trim() || editorState.draft.title.trim() || editorState.draft.id
      };
    },
    getSnapshotBinding(workspaceId) {
      return workspaceId === undefined || snapshotBinding?.workspaceId !== workspaceId
        ? undefined
        : snapshotBinding;
    },
    clear() {
      loadGeneration += 1;
      reset();
    },
    async load(workspaceId) {
      const generation = ++loadGeneration;
      reset();
      const nextSnapshot = await unwrap(api.storyBible.load());
      if (generation !== loadGeneration) return props;
      const nextConsistency = toConsistencyProps(
        await unwrap(api.storyBible.buildConsistencyReport())
      );
      if (generation !== loadGeneration) return props;
      snapshot = nextSnapshot;
      snapshotBinding = { workspaceId, snapshot };
      consistency = nextConsistency;
      props = toProps(snapshot);
      publishEditor();
      return props;
    },
    selectKind(kind) {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
      if (editorState.explicitInversePreview !== undefined) {
        return requireExplicitInversePreviewCancellation();
      }
      statusActionGeneration += 1;
      pendingStatusTransition = undefined;
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = emptyDraft(kind);
      baselineAsset = undefined;
      baselineEditableAsset = undefined;
      entryLoadGeneration += 1;
      const externalUpdate = externalUpdateAfterNavigation();
      editorState = {
        ...editorState,
        activeKind: kind,
        activeTimelineEventId: undefined,
        viewMode: "list",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        foreshadowAnalysis: closedForeshadowAnalysis(),
        externalUpdate,
        statusAction: { status: "idle" }
      };
      deleteFeedback();
      return publishEditor();
    },
    selectEntry: selectEntryFromSnapshot,
    async selectEntryForEditing(entryId) {
      const blockedByDirtyDraft = editorState.dirty && editorState.draft.id !== entryId;
      const selected = selectEntryFromSnapshot(entryId);
      if (blockedByDirtyDraft) return selected;
      const assetId = editorState.draft.id;
      if (
        assetId === undefined ||
        typeof api.storyBible.readAsset !== "function" ||
        isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)
      ) {
        return selected;
      }
      const token = entryLoadGeneration;
      const timelineEventIndex = selectedTimelineEventIndex(
        baselineAsset,
        editorState.activeTimelineEventId
      );
      const read = await api.storyBible.readAsset(assetId);
      if (token !== entryLoadGeneration || editorState.draft.id !== assetId || !read.ok) {
        if (!read.ok && token === entryLoadGeneration && editorState.draft.id === assetId) {
          editorState = {
            ...editorState,
            status: "error",
            feedback: { kind: "error", message: read.error.message }
          };
          return publishEditor();
        }
        return editorProps;
      }
      baselineEditableAsset = read.value;
      snapshot = replaceStoryBibleAsset(snapshot, read.value.asset);
      if (snapshotBinding !== undefined) snapshotBinding = { ...snapshotBinding, snapshot };
      props = toProps(snapshot);
      const entry = createEditorEntries(snapshot).find((candidate) => candidate.id === assetId);
      if (entry === undefined) return editorProps;
      baselineAsset = read.value.asset;
      baselineDraft = draftFromEntry(entry);
      const activeTimelineEventId =
        entry.kind === "timeline" && timelineEventIndex !== undefined
          ? entry.timelineEvents[timelineEventIndex]?.id
          : undefined;
      editorState = {
        ...editorState,
        activeKind: entry.kind,
        activeTimelineEventId,
        viewMode: "detail",
        status: "idle",
        dirty: false,
        draft: baselineDraft
      };
      deleteFeedback();
      return publishEditor();
    },
    beginCreate(kind, assetType) {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
      if (editorState.explicitInversePreview !== undefined) {
        return requireExplicitInversePreviewCancellation();
      }
      statusActionGeneration += 1;
      explicitInverseGeneration += 1;
      pendingStatusTransition = undefined;
      if (kind === "world" && assetType === undefined) {
        throw new Error("A world asset type is required before creating a world draft.");
      }
      if (assetType !== undefined && (kind !== "world" || !WORLD_ASSET_TYPES.has(assetType))) {
        throw new Error("World asset types can only be used to create world drafts.");
      }
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = emptyDraft(kind, assetType);
      baselineAsset = undefined;
      baselineEditableAsset = undefined;
      entryLoadGeneration += 1;
      const externalUpdate = externalUpdateAfterNavigation();
      editorState = {
        ...editorState,
        activeKind: kind,
        activeTimelineEventId: undefined,
        viewMode: "detail",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        foreshadowAnalysis: closedForeshadowAnalysis(),
        externalUpdate,
        statusAction: { status: "idle" },
        explicitInversePreview: undefined
      };
      deleteFeedback();
      return publishEditor();
    },
    cancelDraft() {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
      if (editorState.explicitInversePreview !== undefined) {
        return requireExplicitInversePreviewCancellation();
      }
      statusActionGeneration += 1;
      explicitInverseGeneration += 1;
      pendingStatusTransition = undefined;
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = emptyDraft(editorState.activeKind);
      baselineAsset = undefined;
      baselineEditableAsset = undefined;
      entryLoadGeneration += 1;
      const externalUpdate = externalUpdateAfterNavigation();
      editorState = {
        ...editorState,
        activeTimelineEventId: undefined,
        viewMode: "list",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        foreshadowAnalysis: closedForeshadowAnalysis(),
        externalUpdate,
        statusAction: { status: "idle" },
        explicitInversePreview: undefined
      };
      deleteFeedback();
      return publishEditor();
    },
    async cancelExplicitInversePreview() {
      const preview = editorState.explicitInversePreview;
      if (preview === undefined) return editorProps;
      if (typeof api.storyBible.cancelExplicitInverseChange !== "function") {
        editorState = {
          ...editorState,
          status: "error",
          feedback: { kind: "error", message: storyBibleExplicitInverseUnavailable().message }
        };
        return publishEditor();
      }
      const generation = loadGeneration;
      const token = ++explicitInverseGeneration;
      let canceled: Awaited<
        ReturnType<NonNullable<NovelStudioApi["storyBible"]["cancelExplicitInverseChange"]>>
      >;
      try {
        canceled = await api.storyBible.cancelExplicitInverseChange({
          previewId: preview.previewId,
          revision: preview.revision,
          checksum: preview.checksum
        });
      } catch {
        canceled = { ok: false, error: storyBibleExplicitInverseUnavailable() };
      }
      if (generation !== loadGeneration || token !== explicitInverseGeneration) return editorProps;
      if (!canceled.ok || !canceled.value.canceled) {
        editorState = {
          ...editorState,
          status: "error",
          dirty: true,
          explicitInversePreview: preview,
          feedback: {
            kind: "error",
            message: canceled.ok
              ? "双端关系预览未能撤销，请重试后再编辑或离开。"
              : canceled.error.message
          }
        };
        return publishEditor();
      }
      editorState = {
        ...editorState,
        status: "idle",
        dirty: true,
        explicitInversePreview: undefined,
        feedback: {
          kind: "info",
          message: "已取消双端关系预览，当前草稿仍保留。"
        }
      };
      return publishEditor();
    },
    updateDraft(kind, draft) {
      if (editorState.explicitInversePreview !== undefined) {
        return requireExplicitInversePreviewCancellation();
      }
      statusActionGeneration += 1;
      explicitInverseGeneration += 1;
      pendingStatusTransition = undefined;
      assertDraftPatch(editorState.draft, kind, draft);
      const nextDraft = mergeDraftPatch(editorState.draft, draft);
      if (pendingExternalUpdates.length > 0) validateExternalBaselineBeforeSave = true;
      editorState = {
        ...editorState,
        activeKind: nextDraft.kind,
        viewMode: "detail",
        status: "idle",
        dirty: !draftsEqual(nextDraft, baselineDraft),
        draft: nextDraft,
        statusAction: { status: "idle" },
        explicitInversePreview: undefined
      };
      deleteFeedback();
      return publishEditor();
    },
    updateFilters(filters) {
      editorState = {
        ...editorState,
        filters: { ...editorState.filters, ...filters }
      };
      return publishEditor();
    },
    openForeshadowAnalysis(defaultChapterId) {
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          status: "selecting",
          selectedChapterIds: defaultChapterId === undefined ? [] : [defaultChapterId]
        }
      };
      return publishEditor();
    },
    toggleForeshadowAnalysisChapter(chapterId) {
      const analysis = editorState.foreshadowAnalysis;
      if (
        chapterId.length === 0 ||
        (analysis.status !== "selecting" && analysis.status !== "error")
      ) {
        return editorProps;
      }
      const selectedChapterIds = analysis.selectedChapterIds.includes(chapterId)
        ? analysis.selectedChapterIds.filter((selectedId) => selectedId !== chapterId)
        : analysis.selectedChapterIds.length >= 5
          ? analysis.selectedChapterIds
          : [...analysis.selectedChapterIds, chapterId];
      editorState = {
        ...editorState,
        foreshadowAnalysis: { status: "selecting", selectedChapterIds }
      };
      return publishEditor();
    },
    prepareForeshadowAnalysis() {
      const analysis = editorState.foreshadowAnalysis;
      if (analysis.status !== "selecting" && analysis.status !== "error") {
        return { editor: editorProps };
      }
      if (analysis.selectedChapterIds.length < 1 || analysis.selectedChapterIds.length > 5) {
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            status: "error",
            selectedChapterIds: analysis.selectedChapterIds,
            message: "请选择 1 至 5 个章节。"
          }
        };
        return { editor: publishEditor() };
      }
      const token = ++foreshadowAnalysisGeneration;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          status: "preparing",
          selectedChapterIds: analysis.selectedChapterIds
        }
      };
      return { editor: publishEditor(), token };
    },
    beginForeshadowAnalysis(token) {
      const analysis = editorState.foreshadowAnalysis;
      if (token !== foreshadowAnalysisGeneration || analysis.status !== "preparing") {
        return { editor: editorProps, started: false };
      }
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          status: "scanning",
          selectedChapterIds: analysis.selectedChapterIds
        }
      };
      return { editor: publishEditor(), started: true };
    },
    cancelForeshadowAnalysisPreparation(token) {
      const analysis = editorState.foreshadowAnalysis;
      if (token !== foreshadowAnalysisGeneration || analysis.status !== "preparing") {
        return { editor: editorProps, applied: false };
      }
      foreshadowAnalysisGeneration += 1;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          status: "selecting",
          selectedChapterIds: analysis.selectedChapterIds
        }
      };
      return { editor: publishEditor(), applied: true };
    },
    failForeshadowAnalysisPreparation(token, message) {
      const analysis = editorState.foreshadowAnalysis;
      if (token !== foreshadowAnalysisGeneration || analysis.status !== "preparing") {
        return { editor: editorProps, applied: false };
      }
      foreshadowAnalysisGeneration += 1;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          status: "error",
          selectedChapterIds: analysis.selectedChapterIds,
          message
        }
      };
      return { editor: publishEditor(), applied: true };
    },
    async detectForeshadows(token) {
      const analysis = editorState.foreshadowAnalysis;
      if (token !== foreshadowAnalysisGeneration || analysis.status !== "scanning") {
        return { editor: editorProps, applied: false };
      }

      const selectedChapterIds = [...analysis.selectedChapterIds];
      try {
        const result = await api.storyBible.detectForeshadows({ chapterIds: selectedChapterIds });
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        editorState = {
          ...editorState,
          foreshadowAnalysis: result.ok
            ? {
                status: "review",
                selectedChapterIds,
                result: result.value,
                review: { step: "candidates", selectedCandidateIds: [] }
              }
            : {
                status: "error",
                selectedChapterIds,
                message: result.error.message
              }
        };
      } catch {
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            status: "error",
            selectedChapterIds,
            message: "伏笔识别失败，请稍后重试。"
          }
        };
      }
      return { editor: publishEditor(), applied: true };
    },
    toggleForeshadowAnalysisCandidate(candidateId) {
      const analysis = editorState.foreshadowAnalysis;
      if (
        analysis.status !== "review" ||
        analysis.review.step !== "candidates" ||
        !analysis.result.candidates.some((candidate) => candidate.candidateId === candidateId)
      ) {
        return editorProps;
      }
      const selectedCandidateIds = analysis.review.selectedCandidateIds.includes(candidateId)
        ? analysis.review.selectedCandidateIds.filter((selectedId) => selectedId !== candidateId)
        : [...analysis.review.selectedCandidateIds, candidateId];
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: { step: "candidates", selectedCandidateIds }
        }
      };
      return publishEditor();
    },
    beginForeshadowAnalysisPreview() {
      const analysis = editorState.foreshadowAnalysis;
      if (analysis.status !== "review" || analysis.review.step !== "candidates") {
        return { editor: editorProps, started: false };
      }
      if (analysis.review.selectedCandidateIds.length === 0) {
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            ...analysis,
            review: {
              step: "candidates",
              selectedCandidateIds: [],
              message: "请至少选择一条伏笔候选。"
            }
          }
        };
        return { editor: publishEditor(), started: false };
      }
      const token = ++foreshadowAnalysisGeneration;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: {
            step: "preparing",
            selectedCandidateIds: analysis.review.selectedCandidateIds
          }
        }
      };
      return { editor: publishEditor(), started: true, token };
    },
    async prepareForeshadowAnalysisPreview(token, chapterIdsInOrder) {
      const analysis = editorState.foreshadowAnalysis;
      if (
        token !== foreshadowAnalysisGeneration ||
        analysis.status !== "review" ||
        analysis.review.step !== "preparing"
      ) {
        return { editor: editorProps, applied: false };
      }
      const workspaceId = snapshotBinding?.workspaceId;
      let latestSnapshot: StoryBibleSnapshot;
      try {
        const loaded = await api.storyBible.load();
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        if (!loaded.ok) {
          foreshadowConfirmationPlan = undefined;
          editorState = {
            ...editorState,
            foreshadowAnalysis: {
              ...analysis,
              review: {
                step: "candidates",
                selectedCandidateIds: analysis.review.selectedCandidateIds,
                message: "无法读取最新故事资料，请稍后重试。"
              }
            }
          };
          return { editor: publishEditor(), applied: true };
        }
        latestSnapshot = loaded.value;
      } catch {
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        foreshadowConfirmationPlan = undefined;
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            ...analysis,
            review: {
              step: "candidates",
              selectedCandidateIds: analysis.review.selectedCandidateIds,
              message: "无法读取最新故事资料，请稍后重试。"
            }
          }
        };
        return { editor: publishEditor(), applied: true };
      }
      snapshot = latestSnapshot;
      snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
      props = toProps(snapshot);
      const plan = await createForeshadowConfirmationPlan({
        candidates: analysis.result.candidates,
        selectedCandidateIds: analysis.review.selectedCandidateIds,
        foreshadows: snapshot.foreshadows,
        chapterIdsInOrder,
        createAssetIdentity,
        now
      });
      if (token !== foreshadowAnalysisGeneration) {
        return { editor: editorProps, applied: false };
      }
      if (!plan.ok) {
        foreshadowConfirmationPlan = undefined;
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            ...analysis,
            review: {
              step: "candidates",
              selectedCandidateIds: analysis.review.selectedCandidateIds,
              message: plan.message
            }
          }
        };
        return { editor: publishEditor(), applied: true };
      }
      foreshadowConfirmationPlan = plan.value;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: {
            step: "confirmation",
            selectedCandidateIds: analysis.review.selectedCandidateIds,
            changes: plan.value.operations.map((operation) => operation.preview)
          }
        }
      };
      return { editor: publishEditor(), applied: true };
    },
    backToForeshadowAnalysisCandidates() {
      const analysis = editorState.foreshadowAnalysis;
      if (analysis.status !== "review" || analysis.review.step !== "confirmation") {
        return editorProps;
      }
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: {
            step: "candidates",
            selectedCandidateIds: analysis.review.selectedCandidateIds
          }
        }
      };
      return publishEditor();
    },
    beginForeshadowAnalysisSave(retryFailedOnly) {
      const analysis = editorState.foreshadowAnalysis;
      if (analysis.status !== "review" || foreshadowConfirmationPlan === undefined) {
        return { editor: editorProps, started: false };
      }
      const changes = changesToApply(analysis, retryFailedOnly);
      if (changes === undefined || !changes.some((change) => change.status === "applying")) {
        return { editor: editorProps, started: false };
      }
      const token = ++foreshadowAnalysisGeneration;
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: {
            step: "applying",
            selectedCandidateIds: analysis.review.selectedCandidateIds,
            changes
          }
        }
      };
      return { editor: publishEditor(), started: true, token };
    },
    async saveForeshadowAnalysisChanges(token) {
      const analysis = editorState.foreshadowAnalysis;
      const plan = foreshadowConfirmationPlan;
      if (
        token !== foreshadowAnalysisGeneration ||
        analysis.status !== "review" ||
        analysis.review.step !== "applying" ||
        plan === undefined
      ) {
        return { editor: editorProps, applied: false };
      }
      let changes = [...analysis.review.changes];
      const workspaceId = snapshotBinding?.workspaceId;
      const failSavePreparation = (message: string): ForeshadowAnalysisTransition => {
        changes = failApplyingForeshadowChanges(changes, message);
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            ...analysis,
            review: {
              step: "results",
              selectedCandidateIds: analysis.review.selectedCandidateIds,
              changes,
              outcome: "partial_failure"
            }
          }
        };
        return { editor: publishEditor(), applied: true };
      };
      let latestChapterIds: ReadonlySet<string>;
      try {
        const chapters = await api.project.listChapters();
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        if (!chapters.ok) {
          return failSavePreparation("无法读取最新章节目录，本次未保存；请重试。");
        }
        latestChapterIds = new Set(chapters.value.map((chapter) => chapter.id));
      } catch {
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        return failSavePreparation("无法读取最新章节目录，本次未保存；请重试。");
      }
      if (plan.referencedChapterIds.some((chapterId) => !latestChapterIds.has(chapterId))) {
        if (!changes.some((change) => change.status === "succeeded")) {
          foreshadowAnalysisGeneration += 1;
          foreshadowConfirmationPlan = undefined;
          editorState = {
            ...editorState,
            foreshadowAnalysis: {
              ...analysis,
              review: {
                step: "candidates",
                selectedCandidateIds: analysis.review.selectedCandidateIds,
                message: "候选引用的章节已发生变化，请重新识别后再保存。"
              }
            }
          };
          return { editor: publishEditor(), applied: true };
        }
        return failSavePreparation("候选引用的章节已发生变化，请重新识别后再保存。");
      }
      let latestSnapshot: StoryBibleSnapshot;
      try {
        const loaded = await api.storyBible.load();
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        if (!loaded.ok) {
          return failSavePreparation("无法读取最新故事资料，本次未保存；请重试。");
        }
        latestSnapshot = loaded.value;
      } catch {
        if (token !== foreshadowAnalysisGeneration) {
          return { editor: editorProps, applied: false };
        }
        return failSavePreparation("无法读取最新故事资料，本次未保存；请重试。");
      }

      snapshot = latestSnapshot;
      snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
      props = toProps(snapshot);
      const conflictingChangeIds = new Set(
        plan.operations
          .filter((operation) => {
            const change = changes.find((item) => item.changeId === operation.changeId);
            return (
              change?.status === "applying" &&
              foreshadowOperationHasConflict(operation, latestSnapshot.foreshadows)
            );
          })
          .map((operation) => operation.changeId)
      );
      if (
        conflictingChangeIds.size > 0 &&
        !changes.some((change) => change.status === "succeeded")
      ) {
        foreshadowAnalysisGeneration += 1;
        foreshadowConfirmationPlan = undefined;
        editorState = {
          ...editorState,
          foreshadowAnalysis: {
            ...analysis,
            review: {
              step: "candidates",
              selectedCandidateIds: analysis.review.selectedCandidateIds,
              message: "故事资料已在预览后发生变化，请重新预览并确认。"
            }
          }
        };
        return { editor: publishEditor(), applied: true };
      }
      for (const changeId of conflictingChangeIds) {
        const change = changes.find((item) => item.changeId === changeId);
        if (change === undefined) continue;
        changes = replaceForeshadowChange(changes, changeId, {
          ...change,
          status: "failed",
          errorMessage: "目标伏笔已在预览后发生变化，请重新识别后再保存。"
        });
      }

      let anySucceeded = false;
      for (const operation of plan.operations) {
        const change = changes.find((item) => item.changeId === operation.changeId);
        if (change?.status !== "applying") continue;
        try {
          const saved = await saveForeshadowOperation(operation);
          if (token !== foreshadowAnalysisGeneration) {
            return { editor: editorProps, applied: false };
          }
          changes = replaceForeshadowChange(changes, operation.changeId, {
            ...change,
            status: saved.ok ? "succeeded" : "failed",
            ...(saved.ok ? { assetId: saved.value.id } : { errorMessage: saved.error.message })
          });
          anySucceeded ||= saved.ok;
        } catch {
          if (token !== foreshadowAnalysisGeneration) {
            return { editor: editorProps, applied: false };
          }
          changes = replaceForeshadowChange(changes, operation.changeId, {
            ...change,
            status: "failed",
            errorMessage: "保存伏笔变更失败，请重试。"
          });
        }
      }

      let refreshMessage: string | undefined;
      if (anySucceeded) {
        try {
          const loaded = await api.storyBible.load();
          if (token !== foreshadowAnalysisGeneration) {
            return { editor: editorProps, applied: false };
          }
          if (loaded.ok) {
            snapshot = loaded.value;
            snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
            props = toProps(snapshot);
            try {
              const report = await api.storyBible.buildConsistencyReport();
              if (token !== foreshadowAnalysisGeneration) {
                return { editor: editorProps, applied: false };
              }
              if (report.ok) {
                consistency = toConsistencyProps(report.value);
              } else {
                refreshMessage = "变更已保存，但一致性检查刷新失败。";
              }
            } catch {
              if (token !== foreshadowAnalysisGeneration) {
                return { editor: editorProps, applied: false };
              }
              refreshMessage = "变更已保存，但一致性检查刷新失败。";
            }
          } else {
            refreshMessage = "变更已保存，但故事资料刷新失败；重新打开项目后可查看。";
          }
        } catch {
          if (token !== foreshadowAnalysisGeneration) {
            return { editor: editorProps, applied: false };
          }
          refreshMessage = "变更已保存，但故事资料刷新失败；重新打开项目后可查看。";
        }
      }

      const outcome = changes.every((change) => change.status === "succeeded")
        ? "completed"
        : "partial_failure";
      editorState = {
        ...editorState,
        foreshadowAnalysis: {
          ...analysis,
          review: {
            step: "results",
            selectedCandidateIds: analysis.review.selectedCandidateIds,
            changes,
            outcome,
            ...(refreshMessage === undefined ? {} : { message: refreshMessage })
          }
        }
      };
      return { editor: publishEditor(), applied: true };
    },
    closeForeshadowAnalysis() {
      const analysis = editorState.foreshadowAnalysis;
      if (analysis.status === "review" && analysis.review.step === "applying") {
        return editorProps;
      }
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      editorState = {
        ...editorState,
        foreshadowAnalysis: closedForeshadowAnalysis()
      };
      return publishEditor();
    },
    async handleExternalUpdate(input) {
      if (
        snapshotBinding?.workspaceId !== input.projectId ||
        handledVersionGroupIds.has(input.versionGroupId)
      ) {
        return editorProps;
      }
      const affectedPaths = input.relativePaths.flatMap(parseStoryBibleAffectedPath);
      if (affectedPaths.length === 0) return editorProps;
      return queueExternalUpdate({ ...input, affectedPaths });
    },
    async handleStoryAnalysisExternalUpdate(input) {
      if (snapshotBinding?.workspaceId !== input.projectId) return editorProps;
      return queueExternalUpdate({
        projectId: input.projectId,
        reason: "agent-change-set-apply",
        versionGroupId: `story_analysis_${input.updateId}`,
        relativePaths: [],
        // Completion events intentionally expose no changed file paths. Keep the
        // affected-entry projection empty instead of claiming unrelated entries
        // changed; a non-dirty editor still refreshes the authoritative snapshot.
        affectedPaths: []
      });
    },
    reloadExternalUpdate() {
      return pendingExternalUpdates.length === 0
        ? Promise.resolve(editorProps)
        : refreshExternalUpdates(pendingExternalUpdates);
    },
    continueExternalUpdate() {
      if (pendingExternalUpdates.length === 0) return editorProps;
      validateExternalBaselineBeforeSave = true;
      editorState = { ...editorState, externalUpdate: { status: "none" } };
      return publishEditor();
    },
    async requestStatusAction(action) {
      const assetId = editorState.draft.id;
      const assetTitle = editorState.draft.title.trim() || assetId || "故事资料";
      if (assetId === undefined || editorState.viewMode !== "detail") return editorProps;
      if (editorState.dirty) {
        editorState = {
          ...editorState,
          statusAction: {
            status: "error",
            action,
            assetId,
            assetTitle,
            message: "请先保存或放弃当前修改，再更改资料状态。"
          }
        };
        return publishEditor();
      }
      if (
        (action === "move-to-deleted" && editorState.draft.status === "deleted") ||
        (action === "restore" && editorState.draft.status !== "deleted")
      ) {
        return editorProps;
      }

      const token = ++statusActionGeneration;
      editorState = {
        ...editorState,
        statusAction: { status: "loading", action, assetId, assetTitle }
      };
      publishEditor();
      if (action === "restore") {
        editorState = {
          ...editorState,
          statusAction: { status: "confirmation", action, assetId, assetTitle }
        };
        return publishEditor();
      }

      let impact: Result<StoryBibleReferenceImpact, UnifiedError>;
      try {
        impact =
          api.storyBible.getReferences === undefined
            ? {
                ok: false,
                error: statusActionError("STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE")
              }
            : await api.storyBible.getReferences(assetId);
      } catch {
        impact = {
          ok: false,
          error: statusActionError("STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE")
        };
      }
      if (
        token !== statusActionGeneration ||
        editorState.draft.id !== assetId ||
        editorState.draft.status === "deleted"
      ) {
        return editorProps;
      }
      if (!impact.ok) {
        editorState = {
          ...editorState,
          statusAction: {
            status: "error",
            action,
            assetId,
            assetTitle,
            message: impact.error.message
          }
        };
        return publishEditor();
      }
      editorState = {
        ...editorState,
        statusAction: deletionConfirmationState(impact.value, assetTitle)
      };
      return publishEditor();
    },
    cancelStatusAction() {
      statusActionGeneration += 1;
      editorState = { ...editorState, statusAction: { status: "idle" } };
      return publishEditor();
    },
    async confirmStatusAction() {
      const confirmation = editorState.statusAction;
      if (confirmation.status !== "confirmation") {
        return { editor: editorProps, readyToSave: false };
      }
      const { action, assetId, assetTitle } = confirmation;
      const token = ++statusActionGeneration;
      editorState = {
        ...editorState,
        statusAction: { status: "loading", action, assetId, assetTitle }
      };
      publishEditor();

      if (action === "move-to-deleted") {
        if (!confirmation.canSetDeleted) {
          editorState = {
            ...editorState,
            statusAction: {
              status: "error",
              action,
              assetId,
              assetTitle,
              message: "大纲和时间线单例不能移入已删除。"
            }
          };
          return { editor: publishEditor(), readyToSave: false };
        }
        let impact: Result<StoryBibleReferenceImpact, UnifiedError>;
        try {
          impact =
            api.storyBible.getReferences === undefined
              ? {
                  ok: false,
                  error: statusActionError("STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE")
                }
              : await api.storyBible.getReferences(assetId);
        } catch {
          impact = {
            ok: false,
            error: statusActionError("STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE")
          };
        }
        if (token !== statusActionGeneration || editorState.draft.id !== assetId) {
          return { editor: editorProps, readyToSave: false };
        }
        if (!impact.ok) {
          editorState = {
            ...editorState,
            statusAction: {
              status: "error",
              action,
              assetId,
              assetTitle,
              message: impact.error.message
            }
          };
          return { editor: publishEditor(), readyToSave: false };
        }
        if (deletionImpactSignature(impact.value) !== deletionConfirmationSignature(confirmation)) {
          editorState = {
            ...editorState,
            statusAction: {
              status: "error",
              action,
              assetId,
              assetTitle,
              message: "入向引用影响已变化，请重新检查后再确认。"
            }
          };
          return { editor: publishEditor(), readyToSave: false };
        }
        editorState = {
          ...editorState,
          dirty: true,
          draft: { ...editorState.draft, status: "deleted" },
          statusAction: { status: "idle" }
        };
        pendingStatusTransition = {
          action: "move-to-deleted",
          expectedDeletionImpactChecksum: impact.value.deletionImpactChecksum
        };
        return { editor: publishEditor(), readyToSave: true };
      }

      let restored: Result<"active" | "draft" | "archived", UnifiedError>;
      try {
        restored =
          api.storyBible.resolveRestoreStatus === undefined
            ? {
                ok: false,
                error: statusActionError("STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE")
              }
            : await api.storyBible.resolveRestoreStatus(assetId);
      } catch {
        restored = {
          ok: false,
          error: statusActionError("STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE")
        };
      }
      if (token !== statusActionGeneration || editorState.draft.id !== assetId) {
        return { editor: editorProps, readyToSave: false };
      }
      if (!restored.ok) {
        editorState = {
          ...editorState,
          statusAction: {
            status: "error",
            action,
            assetId,
            assetTitle,
            message: restored.error.message
          }
        };
        return { editor: publishEditor(), readyToSave: false };
      }
      editorState = {
        ...editorState,
        dirty: true,
        draft: { ...editorState.draft, status: restored.value },
        statusAction: { status: "idle" }
      };
      pendingStatusTransition = { action: "restore" };
      return { editor: publishEditor(), readyToSave: true };
    },
    beginSave() {
      statusActionGeneration += 1;
      editorState = { ...editorState, status: "saving", statusAction: { status: "idle" } };
      deleteFeedback();
      return publishEditor();
    },
    async saveDraft(saveOptions) {
      const generation = loadGeneration;
      const workspaceId = snapshotBinding?.workspaceId;
      const draft = normalizeDraft(editorState.draft);
      const validationError = validateStoryBibleDraft(draft, snapshot, saveOptions);
      if (validationError !== undefined) {
        editorState = {
          ...editorState,
          status: "error",
          dirty: true,
          draft,
          feedback: {
            kind: "error",
            message: validationError
          }
        };
        return publishEditor();
      }
      const normalizedDraft = await normalizeForeshadowDraft(draft);
      if (generation !== loadGeneration) return editorProps;
      if (
        validateExternalBaselineBeforeSave &&
        normalizedDraft.id !== undefined &&
        baselineAsset !== undefined
      ) {
        let latest: Result<StoryBibleSnapshot, UnifiedError>;
        try {
          latest = await api.storyBible.load();
        } catch {
          editorState = {
            ...editorState,
            status: "error",
            dirty: true,
            draft: normalizedDraft,
            feedback: {
              kind: "error",
              message: "无法读取最新故事资料，本次未保存；请重试。"
            }
          };
          return publishEditor();
        }
        if (generation !== loadGeneration) return editorProps;
        if (!latest.ok) {
          editorState = {
            ...editorState,
            status: "error",
            dirty: true,
            draft: normalizedDraft,
            feedback: { kind: "error", message: latest.error.message }
          };
          return publishEditor();
        }
        snapshot = latest.value;
        snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
        props = toProps(snapshot);
        const latestAsset = findExistingAsset(snapshot, normalizedDraft.id);
        if (latestAsset === undefined || !storyBibleAssetsEqual(latestAsset, baselineAsset)) {
          editorState = {
            ...editorState,
            status: "error",
            dirty: true,
            draft: normalizedDraft,
            externalUpdate: externalUpdateState(pendingExternalUpdates, snapshot),
            feedback: {
              kind: "error",
              message: "该资料已由 Agent 更新，当前草稿与最新版本冲突。请重新加载后再编辑。"
            }
          };
          return publishEditor();
        }
      }
      const attemptedStatusTransition = pendingStatusTransition;
      const explicitInversePreview = editorState.explicitInversePreview;
      if (
        attemptedStatusTransition === undefined &&
        explicitInversePreview?.status === "confirmation"
      ) {
        return applyExplicitInversePreview(
          normalizedDraft,
          explicitInversePreview as NonNullable<StoryBibleExplicitInversePreviewState> & {
            readonly status: "confirmation";
          },
          generation,
          workspaceId
        );
      }
      if (
        attemptedStatusTransition === undefined &&
        requiresExplicitInversePairWrite(
          storyBibleRelations(baselineEditableAsset?.asset.relations),
          normalizedDraft.relations ?? []
        )
      ) {
        const explicitCommand = existingDraftCandidateCommand(normalizedDraft);
        if (!explicitCommand.ok) {
          editorState = {
            ...editorState,
            status: "error",
            dirty: true,
            draft: normalizedDraft,
            feedback: { kind: "error", message: explicitCommand.error.message }
          };
          return publishEditor();
        }
        return prepareExplicitInversePreview(normalizedDraft, explicitCommand.value, generation);
      }
      const saved = await saveStructuredDraft(normalizedDraft, attemptedStatusTransition);

      if (!saved.ok) {
        if (attemptedStatusTransition !== undefined) pendingStatusTransition = undefined;
        editorState = {
          ...editorState,
          status: "error",
          dirty: attemptedStatusTransition === undefined,
          draft:
            attemptedStatusTransition === undefined
              ? normalizedDraft
              : { ...normalizedDraft, status: baselineDraft.status },
          feedback: {
            kind: "error",
            message: saved.error.message
          }
        };
        return publishEditor();
      }

      return finishSavedDraft(
        normalizedDraft,
        saved.value.id,
        generation,
        workspaceId,
        "故事圣经已保存。"
      );
    }
  };

  function existingDraftCandidateCommand(
    draft: StoryBibleEditorDraft
  ): Result<StoryBibleExplicitInverseSourceCommand, UnifiedError> {
    if (draft.id === undefined || baselineEditableAsset === undefined) {
      return {
        ok: false,
        error: storyBibleEditingBaselineUnavailable()
      };
    }
    return {
      ok: true,
      value: {
        candidate: {
          schemaVersion: "1.1",
          id: draft.id,
          type: draft.assetType,
          title: draft.title,
          status: draft.status,
          summary: draft.summary,
          aliases: [...draft.aliases],
          relations: (draft.relations ?? []).map((relation) => ({ ...relation })),
          details: toStrictStoryBibleDetails(draft, createEntryIdentity),
          extensions: jsonObjectValue(baselineEditableAsset.asset.extensions),
          createdAt: baselineEditableAsset.asset.createdAt
        },
        baseRevision: baselineEditableAsset.revision,
        baseChecksum: baselineEditableAsset.checksum
      }
    };
  }

  async function prepareExplicitInversePreview(
    draft: StoryBibleEditorDraft,
    command: StoryBibleExplicitInverseSourceCommand,
    generation: number
  ): Promise<StoryBibleEditorProps> {
    if (typeof api.storyBible.prepareExplicitInverseChange !== "function") {
      editorState = {
        ...editorState,
        status: "error",
        dirty: true,
        draft,
        explicitInversePreview: undefined,
        feedback: { kind: "error", message: storyBibleExplicitInverseUnavailable().message }
      };
      return publishEditor();
    }
    const token = ++explicitInverseGeneration;
    let prepared: Awaited<
      ReturnType<NonNullable<NovelStudioApi["storyBible"]["prepareExplicitInverseChange"]>>
    >;
    try {
      prepared = await api.storyBible.prepareExplicitInverseChange({ source: command });
    } catch {
      prepared = { ok: false, error: storyBibleExplicitInverseUnavailable() };
    }
    if (generation !== loadGeneration || token !== explicitInverseGeneration) return editorProps;
    if (!prepared.ok) {
      editorState = {
        ...editorState,
        status: "error",
        dirty: true,
        draft,
        explicitInversePreview: undefined,
        feedback: { kind: "error", message: prepared.error.message }
      };
      return publishEditor();
    }
    const entries = createEditorEntries(snapshot);
    editorState = {
      ...editorState,
      status: "idle",
      dirty: true,
      draft,
      explicitInversePreview: {
        status: "confirmation",
        previewId: prepared.value.previewId,
        revision: prepared.value.changeSet.revision,
        checksum: prepared.value.changeSet.checksum,
        expiresAt: prepared.value.expiresAt,
        files: prepared.value.affectedAssetIds.map((assetId) => {
          const file = prepared.value.changeSet.files.find(
            (candidate) => candidate.assetId === assetId
          );
          return {
            assetId,
            title: entries.find((entry) => entry.id === assetId)?.title ?? assetId,
            side: assetId === draft.id ? "source" : "inverse",
            hunkCount: file?.hunks.length ?? 1
          };
        })
      },
      feedback: {
        kind: "info",
        message: "请确认显式双向关系的两端差异；确认前不会写入任何资料。"
      }
    };
    return publishEditor();
  }

  function requireExplicitInversePreviewCancellation(): StoryBibleEditorProps {
    editorState = {
      ...editorState,
      feedback: {
        kind: "error",
        message: "请先取消当前双端关系预览，再继续编辑或离开。"
      }
    };
    return publishEditor();
  }

  async function applyExplicitInversePreview(
    draft: StoryBibleEditorDraft,
    preview: NonNullable<StoryBibleExplicitInversePreviewState> & {
      readonly status: "confirmation";
    },
    generation: number,
    workspaceId: string | undefined
  ): Promise<StoryBibleEditorProps> {
    if (typeof api.storyBible.applyExplicitInverseChange !== "function") {
      editorState = {
        ...editorState,
        status: "error",
        dirty: true,
        draft,
        feedback: { kind: "error", message: storyBibleExplicitInverseUnavailable().message }
      };
      return publishEditor();
    }
    const token = ++explicitInverseGeneration;
    editorState = {
      ...editorState,
      status: "saving",
      explicitInversePreview: { ...preview, status: "applying" }
    };
    publishEditor();
    let applied: Awaited<
      ReturnType<NonNullable<NovelStudioApi["storyBible"]["applyExplicitInverseChange"]>>
    >;
    try {
      applied = await api.storyBible.applyExplicitInverseChange({
        previewId: preview.previewId,
        revision: preview.revision,
        checksum: preview.checksum
      });
    } catch {
      applied = { ok: false, error: storyBibleExplicitInverseUnavailable() };
    }
    if (generation !== loadGeneration || token !== explicitInverseGeneration) return editorProps;
    if (!applied.ok || !applied.value.applied) {
      const batchError = applied.ok
        ? applied.value.batch.groups.find((group) => group.error !== undefined)?.error
        : undefined;
      editorState = {
        ...editorState,
        status: "error",
        dirty: true,
        draft,
        explicitInversePreview: preview,
        feedback: {
          kind: "error",
          message: applied.ok
            ? (batchError?.message ?? "双端关系未能原子提交，当前草稿仍保留。")
            : applied.error.message
        }
      };
      return publishEditor();
    }
    if (draft.id === undefined) return editorProps;
    return finishSavedDraft(
      draft,
      draft.id,
      generation,
      workspaceId,
      "显式双向关系的两端资料已原子保存。"
    );
  }

  async function finishSavedDraft(
    normalizedDraft: StoryBibleEditorDraft,
    savedAssetId: string,
    generation: number,
    workspaceId: string | undefined,
    message: string
  ): Promise<StoryBibleEditorProps> {
    if (generation !== loadGeneration) return editorProps;
    let nextSnapshot = await unwrap(api.storyBible.load());
    if (generation !== loadGeneration) return editorProps;
    const editable =
      typeof api.storyBible.readAsset === "function"
        ? await api.storyBible.readAsset(savedAssetId)
        : undefined;
    if (generation !== loadGeneration) return editorProps;
    if (editable?.ok === true) {
      baselineEditableAsset = editable.value;
      nextSnapshot = replaceStoryBibleAsset(nextSnapshot, editable.value.asset);
    } else {
      baselineEditableAsset = undefined;
    }
    const nextConsistency = toConsistencyProps(
      await unwrap(api.storyBible.buildConsistencyReport())
    );
    if (generation !== loadGeneration) return editorProps;
    snapshot = nextSnapshot;
    snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
    consistency = nextConsistency;
    props = toProps(snapshot);
    baselineDraft = draftFromSnapshot(snapshot, { ...normalizedDraft, id: savedAssetId });
    baselineAsset = baselineEditableAsset?.asset ?? findExistingAsset(snapshot, savedAssetId);
    pendingStatusTransition = undefined;
    clearPendingExternalUpdate();
    const activeTimelineEventId =
      editorState.activeTimelineEventId !== undefined &&
      draftHasTimelineEvent(baselineDraft, editorState.activeTimelineEventId)
        ? editorState.activeTimelineEventId
        : undefined;
    editorState = {
      ...editorState,
      activeKind: baselineDraft.kind,
      activeTimelineEventId,
      viewMode: "detail",
      status: "saved",
      dirty: false,
      draft: baselineDraft,
      externalUpdate: { status: "none" },
      statusAction: { status: "idle" },
      explicitInversePreview: undefined,
      feedback: { kind: "info", message }
    };
    return publishEditor();
  }

  function selectEntryFromSnapshot(entryId: string): StoryBibleEditorProps {
    if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
    if (editorState.explicitInversePreview !== undefined) {
      return requireExplicitInversePreviewCancellation();
    }
    if (editorState.dirty && editorState.draft.id !== entryId) {
      editorState = {
        ...editorState,
        feedback: {
          kind: "error",
          message: "当前资料有未保存修改。请先保存或放弃草稿，再打开目标资料。"
        }
      };
      return publishEditor();
    }
    statusActionGeneration += 1;
    explicitInverseGeneration += 1;
    pendingStatusTransition = undefined;
    entryLoadGeneration += 1;
    const entries = createEditorEntries(snapshot);
    let activeTimelineEventId: string | undefined;
    let entry = entries.find((candidate) => candidate.id === entryId);
    if (entry === undefined) {
      entry = entries.find(
        (candidate) =>
          candidate.kind === "timeline" &&
          candidate.timelineEvents.some((event) => event.id === entryId)
      );
      if (entry !== undefined) activeTimelineEventId = entryId;
    }
    if (entry === undefined) return editorProps;

    foreshadowAnalysisGeneration += 1;
    foreshadowConfirmationPlan = undefined;
    baselineDraft = draftFromEntry(entry);
    baselineAsset = findExistingAsset(snapshot, entry.id);
    baselineEditableAsset = undefined;
    const externalUpdate = externalUpdateAfterNavigation();
    editorState = {
      ...editorState,
      activeKind: entry.kind,
      activeTimelineEventId,
      viewMode: "detail",
      status: "idle",
      dirty: false,
      draft: baselineDraft,
      foreshadowAnalysis: closedForeshadowAnalysis(),
      externalUpdate,
      statusAction: { status: "idle" },
      explicitInversePreview: undefined
    };
    deleteFeedback();
    return publishEditor();
  }

  function saveStructuredDraft(
    draft: StoryBibleEditorDraft,
    statusTransition?: PendingStoryBibleStatusTransition
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    if (
      typeof api.storyBible.createAsset !== "function" ||
      typeof api.storyBible.saveAssetCandidate !== "function"
    ) {
      return statusTransition === undefined
        ? api.storyBible.saveAsset(toStoryAsset(draft, now(), snapshot, createAssetIdentity))
        : Promise.resolve({
            ok: false,
            error: storyBibleStatusTransitionUnavailable()
          });
    }
    if (draft.id === undefined) {
      const details = toStrictStoryBibleDetails(draft, createEntryIdentity);
      const value: StoryBibleCreateValue = {
        title: draft.title,
        ...(draft.status === "deleted" ? {} : { status: draft.status }),
        summary: draft.summary,
        aliases: [...draft.aliases],
        relations: [],
        details,
        extensions: {}
      };
      return api.storyBible.createAsset({ type: draft.assetType, value });
    }
    const command = existingDraftCandidateCommand(draft);
    if (!command.ok) return Promise.resolve(command);
    if (statusTransition !== undefined) {
      return typeof api.storyBible.saveStatusTransition === "function"
        ? api.storyBible.saveStatusTransition({ ...command.value, ...statusTransition })
        : Promise.resolve({ ok: false, error: storyBibleStatusTransitionUnavailable() });
    }
    return api.storyBible.saveAssetCandidate(command.value);
  }

  async function saveForeshadowOperation(
    operation: ForeshadowConfirmationOperation
  ): Promise<Result<StoryBibleAsset, UnifiedError>> {
    if (
      typeof api.storyBible.readAsset !== "function" ||
      typeof api.storyBible.createAsset !== "function" ||
      typeof api.storyBible.saveAssetCandidate !== "function"
    ) {
      return api.storyBible.saveAsset(operation.asset);
    }
    if (operation.baseAsset === undefined) {
      return api.storyBible.createAsset({
        type: "foreshadow",
        value: {
          title: operation.asset.title,
          status: operation.asset.status === "deleted" ? "active" : operation.asset.status,
          summary: operation.asset.summary,
          aliases: [...(operation.asset.aliases ?? [])],
          relations: relationsFromRelatedIds(
            operation.asset.id,
            operation.asset.relatedEntityIds ?? []
          ),
          details: strictForeshadowOperationDetails(operation),
          extensions: {}
        }
      });
    }

    const baseline = await api.storyBible.readAsset(operation.asset.id);
    if (!baseline.ok) return baseline;
    if (baseline.value.asset.type !== "foreshadow") {
      return {
        ok: false,
        error: storyBibleEditingBaselineUnavailable()
      };
    }
    const candidate: StoryBibleWriteCandidate = {
      schemaVersion: "1.1",
      id: baseline.value.asset.id,
      type: "foreshadow",
      title: operation.asset.title,
      status: operation.asset.status,
      summary: operation.asset.summary,
      aliases: [...(operation.asset.aliases ?? baseline.value.asset.aliases ?? [])],
      relations: storyBibleRelations(baseline.value.asset.relations).map((relation) => ({
        ...relation
      })),
      details: strictForeshadowOperationDetails(
        operation,
        jsonObjectValue(baseline.value.asset.details)
      ),
      extensions: jsonObjectValue(baseline.value.asset.extensions),
      createdAt: baseline.value.asset.createdAt
    };
    return api.storyBible.saveAssetCandidate({
      candidate,
      baseRevision: baseline.value.revision,
      baseChecksum: baseline.value.checksum
    });
  }

  function relationsFromRelatedIds(
    sourceId: string,
    relatedEntityIds: readonly string[]
  ): StoryBibleEditorRelation[] {
    return [...new Set(relatedEntityIds)].map((targetId, index) => ({
      relationId: `rel_${stableHexIdentity(`${sourceId}:relation:${targetId}:${index}`)}`,
      sourceId,
      targetId,
      relationType: "story.related",
      direction: "directed",
      status: "active",
      validFromChapterId: null,
      validToChapterId: null,
      inversePolicy: "none",
      inverseRelationId: null,
      evidence: [],
      note: ""
    }));
  }

  function strictForeshadowOperationDetails(
    operation: ForeshadowConfirmationOperation,
    baseline: JsonObject = {}
  ): JsonObject {
    const details = operation.asset.details;
    const sourceRefs = recordArray(details.sourceRefs);
    const milestones = recordArray(baseline["milestones"]);
    const milestoneEvidence = new Set(
      milestones.map((milestone) => {
        const evidence = jsonObjectValue(milestone["evidence"]);
        return `${String(milestone["chapterId"])}\u0000${String(evidence["excerptHash"])}`;
      })
    );
    for (const [index, sourceRef] of sourceRefs.entries()) {
      const chapterId = stringValue(sourceRef["chapterId"]);
      const excerpt = stringValue(sourceRef["excerpt"]);
      const excerptHash = stringValue(sourceRef["excerptHash"]);
      if (chapterId === undefined || excerpt === undefined || excerptHash === undefined) continue;
      const evidenceKey = `${chapterId}\u0000${excerptHash}`;
      if (milestoneEvidence.has(evidenceKey)) continue;
      milestoneEvidence.add(evidenceKey);
      const isPayoff =
        details.trackingStatus === "paid-off" && details.actualPayoffChapterId === chapterId;
      milestones.push({
        milestoneId: strictEntryId(
          "fsm",
          undefined,
          `${operation.changeId}:milestone:${chapterId}:${excerptHash}:${index}`
        ),
        entryRevision: 1,
        kind: isPayoff ? "payoff" : operation.baseAsset === undefined ? "plant" : "progress",
        chapterId,
        timelineEventId: null,
        evidence: {
          start: 0,
          end: Math.max(1, [...excerpt].length),
          excerptHash
        },
        note: ""
      });
    }
    return {
      ...baseline,
      ...details,
      milestones
    };
  }

  function deleteFeedback(): void {
    if (editorState.feedback === undefined) {
      return;
    }
    editorState = {
      activeKind: editorState.activeKind,
      activeTimelineEventId: editorState.activeTimelineEventId,
      viewMode: editorState.viewMode,
      status: editorState.status,
      dirty: editorState.dirty,
      draft: editorState.draft,
      filters: editorState.filters,
      foreshadowAnalysis: editorState.foreshadowAnalysis,
      externalUpdate: editorState.externalUpdate,
      statusAction: editorState.statusAction
    };
  }

  function clearPendingExternalUpdate(): void {
    pendingExternalUpdates = [];
    validateExternalBaselineBeforeSave = false;
  }

  function externalUpdateAfterNavigation(): StoryBibleEditorProps["externalUpdate"] {
    if (pendingExternalUpdates.length > 0) return editorState.externalUpdate;
    clearPendingExternalUpdate();
    return { status: "none" };
  }

  function rememberHandledVersionGroup(versionGroupId: string): void {
    handledVersionGroupIds.add(versionGroupId);
    if (handledVersionGroupIds.size <= 128) return;
    const oldest = handledVersionGroupIds.values().next().value as string | undefined;
    if (oldest !== undefined) handledVersionGroupIds.delete(oldest);
  }

  async function refreshExternalUpdates(
    updates: readonly PendingStoryBibleExternalUpdate[]
  ): Promise<StoryBibleEditorProps> {
    const workspaceId = snapshotBinding?.workspaceId;
    if (workspaceId === undefined || updates.length === 0) return editorProps;
    const generation = ++externalRefreshGeneration;
    const previousState = editorState;
    let loaded: Result<StoryBibleSnapshot, UnifiedError>;
    try {
      loaded = await api.storyBible.load();
    } catch {
      if (
        generation !== externalRefreshGeneration ||
        snapshotBinding?.workspaceId !== workspaceId
      ) {
        return editorProps;
      }
      return failExternalRefresh(updates, "故事资料已有外部更新，但重新加载失败；请重试。");
    }
    if (generation !== externalRefreshGeneration || snapshotBinding?.workspaceId !== workspaceId) {
      return editorProps;
    }
    if (!loaded.ok) return failExternalRefresh(updates, loaded.error.message);

    let nextConsistency = consistency;
    try {
      const report = await api.storyBible.buildConsistencyReport();
      if (
        generation !== externalRefreshGeneration ||
        snapshotBinding?.workspaceId !== workspaceId
      ) {
        return editorProps;
      }
      if (report.ok) nextConsistency = toConsistencyProps(report.value);
    } catch {
      // The source snapshot is authoritative; a later consistency check can refresh diagnostics.
    }

    snapshot = loaded.value;
    snapshotBinding = { workspaceId, snapshot };
    consistency = nextConsistency;
    props = toProps(snapshot);
    if (!previousState.dirty && editorState.dirty) {
      editorState = {
        ...editorState,
        status: "idle",
        externalUpdate: externalUpdateState(updates, snapshot)
      };
      return publishEditor();
    }
    applyExternalRefreshNavigation(previousState, updates);
    clearPendingExternalUpdate();
    return publishEditor();
  }

  async function queueExternalUpdate(
    update: PendingStoryBibleExternalUpdate
  ): Promise<StoryBibleEditorProps> {
    if (handledVersionGroupIds.has(update.versionGroupId)) return editorProps;
    statusActionGeneration += 1;
    pendingStatusTransition = undefined;
    editorState = { ...editorState, statusAction: { status: "idle" } };
    rememberHandledVersionGroup(update.versionGroupId);
    pendingExternalUpdates = [...pendingExternalUpdates, update];
    if (editorState.dirty) {
      validateExternalBaselineBeforeSave = true;
      editorState = {
        ...editorState,
        externalUpdate: externalUpdateState(pendingExternalUpdates, snapshot)
      };
      return publishEditor();
    }
    return refreshExternalUpdates(pendingExternalUpdates);
  }

  function failExternalRefresh(
    updates: readonly PendingStoryBibleExternalUpdate[],
    message: string
  ): StoryBibleEditorProps {
    pendingExternalUpdates = [...updates];
    editorState = {
      ...editorState,
      status: "error",
      externalUpdate: externalUpdateState(updates, snapshot),
      feedback: { kind: "error", message }
    };
    return publishEditor();
  }

  function applyExternalRefreshNavigation(
    previousState: StoryBibleEditorState,
    updates: readonly PendingStoryBibleExternalUpdate[]
  ): void {
    const entries = createEditorEntries(snapshot);
    const affectedEntryIds = affectedEntryIdsForSnapshot(updates, snapshot);
    const allApply = updates.every((update) => update.reason === "agent-change-set-apply");
    const allUndo = updates.every((update) => update.reason === "agent-run-undo");
    const currentEntryId = previousState.viewMode === "detail" ? previousState.draft.id : undefined;
    const targetEntryId =
      allApply && affectedEntryIds.length === 1
        ? affectedEntryIds[0]
        : allUndo && currentEntryId !== undefined
          ? currentEntryId
          : undefined;
    const targetEntry = entries.find((entry) => entry.id === targetEntryId);
    if (targetEntry !== undefined) {
      baselineDraft = draftFromEntry(targetEntry);
      baselineAsset = findExistingAsset(snapshot, targetEntry.id);
      baselineEditableAsset = undefined;
      entryLoadGeneration += 1;
      const activeTimelineEventId =
        targetEntry.kind === "timeline" &&
        previousState.activeTimelineEventId !== undefined &&
        targetEntry.timelineEvents.some((event) => event.id === previousState.activeTimelineEventId)
          ? previousState.activeTimelineEventId
          : undefined;
      editorState = {
        ...previousState,
        activeKind: targetEntry.kind,
        activeTimelineEventId,
        viewMode: "detail",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        externalUpdate: { status: "none" },
        feedback: {
          kind: "info",
          message: "故事资料已刷新为最新内容。"
        }
      };
      return;
    }

    const affectedKinds = updates.flatMap((update) =>
      update.affectedPaths.map((affected) => affected.kind)
    );
    const activeKind = affectedKinds.includes(previousState.activeKind)
      ? previousState.activeKind
      : (affectedKinds[0] ?? previousState.activeKind);
    baselineDraft = emptyDraft(activeKind);
    baselineAsset = undefined;
    baselineEditableAsset = undefined;
    entryLoadGeneration += 1;
    editorState = {
      ...previousState,
      activeKind,
      activeTimelineEventId: undefined,
      viewMode: "list",
      status: "idle",
      dirty: false,
      draft: baselineDraft,
      externalUpdate: { status: "none" },
      feedback: {
        kind: "info",
        message: "故事资料已刷新为最新内容。"
      }
    };
  }

  function reset(): void {
    foreshadowAnalysisGeneration += 1;
    externalRefreshGeneration += 1;
    statusActionGeneration += 1;
    explicitInverseGeneration += 1;
    pendingStatusTransition = undefined;
    foreshadowConfirmationPlan = undefined;
    handledVersionGroupIds.clear();
    clearPendingExternalUpdate();
    snapshot = emptySnapshot();
    snapshotBinding = undefined;
    consistency = undefined;
    props = { assets: [] };
    baselineDraft = emptyDraft(editorState.activeKind);
    baselineAsset = undefined;
    baselineEditableAsset = undefined;
    entryLoadGeneration += 1;
    editorState = {
      ...editorState,
      activeTimelineEventId: undefined,
      viewMode: "list",
      status: "idle",
      dirty: false,
      draft: baselineDraft,
      foreshadowAnalysis: closedForeshadowAnalysis(),
      externalUpdate: { status: "none" },
      statusAction: { status: "idle" },
      explicitInversePreview: undefined
    };
    deleteFeedback();
    publishEditor();
  }
}

function selectedTimelineEventIndex(
  asset: StoryBibleAsset | undefined,
  eventId: string | undefined
): number | undefined {
  if (asset?.type !== "timeline.events" || eventId === undefined) return undefined;
  const events = asset.details?.["events"];
  if (!Array.isArray(events)) return undefined;
  const index = events.findIndex(
    (event) => isRecord(event) && (event["eventId"] === eventId || event["id"] === eventId)
  );
  return index < 0 ? undefined : index;
}

function replaceStoryBibleAsset(
  snapshot: StoryBibleSnapshot,
  asset: StoryBibleAsset
): StoryBibleSnapshot {
  switch (asset.type) {
    case "character":
      return {
        ...snapshot,
        characters: replaceAsset(snapshot.characters, asset)
      };
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.item":
    case "world.lore":
      return {
        ...snapshot,
        worldAssets: replaceAsset(snapshot.worldAssets, asset)
      };
    case "outline":
      return { ...snapshot, outline: asset };
    case "timeline.events":
      return { ...snapshot, timeline: asset };
    case "foreshadow":
      return {
        ...snapshot,
        foreshadows: replaceAsset(snapshot.foreshadows, asset)
      };
  }
}

function replaceAsset<T extends StoryBibleAsset>(assets: readonly T[], asset: T): T[] {
  const index = assets.findIndex((candidate) => candidate.id === asset.id);
  return index < 0
    ? [...assets, asset]
    : assets.map((candidate, candidateIndex) => (candidateIndex === index ? asset : candidate));
}

function toStrictStoryBibleDetails(
  draft: StoryBibleEditorDraft,
  createEntryIdentity: () => string
): JsonObject {
  switch (draft.assetType) {
    case "outline":
      return strictOutlineDetails(draft.details, draft.id ?? draft.title);
    case "timeline.events":
      return strictTimelineDetails(draft.details, draft.id ?? draft.title);
    case "foreshadow":
      return {
        ...draft.details,
        trackingStatus: draft.details.trackingStatus,
        milestones: Array.isArray(draft.details.milestones) ? draft.details.milestones : []
      };
    case "character":
      return strictCharacterDetails(draft.details, createEntryIdentity);
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
      return { ...draft.details };
    case "world.item": {
      const details = { ...draft.details };
      if (Array.isArray(details["stateHistory"])) {
        details["stateHistory"] = strictStateHistory(details["stateHistory"], createEntryIdentity);
      }
      return details;
    }
    case "world.lore":
      return { ...draft.details };
  }
}

function strictCharacterDetails(
  rawDetails: JsonObject,
  createEntryIdentity: () => string
): JsonObject {
  const details: JsonObject = { ...rawDetails };
  delete details["appearanceChapterIds"];
  const goals = details["goals"];
  if (Array.isArray(goals)) {
    details["goals"] = {
      external: typeof goals[0] === "string" ? goals[0] : "",
      internal: typeof goals[1] === "string" ? goals[1] : ""
    };
  }
  const arc = details["arc"];
  if (isRecord(arc)) {
    details["arc"] = {
      start: typeof arc["start"] === "string" ? arc["start"] : "",
      turningPoints: stringArray(arc["turningPoints"]),
      targetState:
        typeof arc["targetState"] === "string"
          ? arc["targetState"]
          : typeof arc["end"] === "string"
            ? arc["end"]
            : ""
    };
  }
  if (Array.isArray(details["knowledgeStates"])) {
    details["knowledgeStates"] = strictStableRecords(
      details["knowledgeStates"],
      "knw",
      "knowledgeStateId",
      createEntryIdentity
    );
  }
  if (Array.isArray(details["stateHistory"])) {
    details["stateHistory"] = strictStateHistory(details["stateHistory"], createEntryIdentity);
  }
  return details;
}

function strictStateHistory(value: unknown, createEntryIdentity: () => string): JsonObject[] {
  return strictStableRecords(value, "sth", "stateHistoryId", createEntryIdentity);
}

function strictStableRecords(
  value: unknown,
  prefix: "knw" | "sth",
  idField: "knowledgeStateId" | "stateHistoryId",
  createEntryIdentity: () => string
): JsonObject[] {
  const records = recordArray(value);
  const pattern = new RegExp(`^${prefix}_[a-f0-9]{32}$`, "u");
  const usedIds = new Set(
    records.flatMap((entry) => {
      const id = entry[idField];
      return typeof id === "string" && pattern.test(id) ? [id] : [];
    })
  );
  return records.map((entry) => {
    const currentId = entry[idField];
    const stableId =
      typeof currentId === "string" && pattern.test(currentId)
        ? currentId
        : allocateStableRecordId(prefix, usedIds, createEntryIdentity);
    usedIds.add(stableId);
    return {
      ...entry,
      [idField]: stableId,
      entryRevision: positiveInteger(entry["entryRevision"])
    };
  });
}

function allocateStableRecordId(
  prefix: "knw" | "sth",
  usedIds: ReadonlySet<string>,
  createEntryIdentity: () => string
): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const identity = createEntryIdentity();
    if (!/^[a-f0-9]{32}$/u.test(identity)) {
      throw new Error("Story Bible entry identity must be 32 lowercase hexadecimal characters.");
    }
    const id = `${prefix}_${identity}`;
    if (!usedIds.has(id)) return id;
  }
  throw new Error("Story Bible entry identity allocation collided repeatedly.");
}

function strictOutlineDetails(details: JsonObject, seed: string): JsonObject {
  const volumes = recordArray(details["volumes"]).map((volume, index) => ({
    volumeId: strictEntryId("vol", volume["volumeId"] ?? volume["id"], `${seed}:volume:${index}`),
    entryRevision: positiveInteger(volume["entryRevision"]),
    title: nonEmptyString(volume["title"]) ?? `未命名卷 ${index + 1}`,
    summary: stringValue(volume["summary"]) ?? "",
    goals: stringArray(volume["goals"]),
    chapterIds: stringArray(volume["chapterIds"])
  }));
  const chapterOutlines = recordArray(details["chapterOutlines"]).flatMap((chapter) => {
    const chapterId = nonEmptyString(chapter["chapterId"]);
    if (chapterId === undefined) return [];
    const beats = recordArray(chapter["beats"]).map((beat, beatIndex) => ({
      beatId: strictEntryId(
        "beat",
        beat["beatId"] ?? beat["id"],
        `${seed}:chapter:${chapterId}:beat:${beatIndex}`
      ),
      entryRevision: positiveInteger(beat["entryRevision"]),
      title: nonEmptyString(beat["title"]) ?? `节拍 ${beatIndex + 1}`,
      purpose: stringValue(beat["purpose"]) ?? "",
      result: stringValue(beat["result"]) ?? "",
      scene: stringValue(beat["scene"]) ?? ""
    }));
    return [
      {
        chapterOutlineId: strictEntryId(
          "cho",
          chapter["chapterOutlineId"],
          `${seed}:chapter:${chapterId}`
        ),
        chapterId,
        entryRevision: positiveInteger(chapter["entryRevision"]),
        goal: stringValue(chapter["goal"]) ?? "",
        conflict: stringValue(chapter["conflict"]) ?? "",
        turningPoint: stringValue(chapter["turningPoint"]) ?? "",
        notes: stringValue(chapter["notes"]) ?? "",
        povCharacterId: nullableString(chapter["povCharacterId"]),
        characterIds: stringArray(chapter["characterIds"]),
        locationIds: stringArray(chapter["locationIds"]),
        foreshadowIds: stringArray(chapter["foreshadowIds"]),
        beats,
        expectedStateChanges: stringArray(chapter["expectedStateChanges"]),
        actualOutcome: nullableString(chapter["actualOutcome"]),
        deviations: stringArray(chapter["deviations"])
      }
    ];
  });
  return {
    ...(typeof details["premise"] === "string" ? { premise: details["premise"] } : {}),
    ...(Array.isArray(details["themes"]) ? { themes: stringArray(details["themes"]) } : {}),
    volumes,
    chapterOutlines
  };
}

function strictTimelineDetails(details: JsonObject, seed: string): JsonObject {
  return {
    events: recordArray(details["events"]).map((event, index) => {
      const eventId = strictEntryId(
        "evt",
        event["eventId"] ?? event["id"],
        `${seed}:event:${index}`
      );
      const timeValue = isRecord(event["time"]) ? event["time"] : {};
      const time: JsonObject = {
        mode: timelineTimeMode(timeValue["mode"]),
        label: stringValue(timeValue["label"]) ?? stringValue(event["timeLabel"]) ?? "",
        uncertain: timeValue["uncertain"] === true,
        ...(typeof timeValue["absolute"] === "string" ? { absolute: timeValue["absolute"] } : {}),
        ...(typeof timeValue["anchorEventId"] === "string" || timeValue["anchorEventId"] === null
          ? { anchorEventId: timeValue["anchorEventId"] }
          : {}),
        ...(isRecord(timeValue["offset"]) || timeValue["offset"] === null
          ? { offset: timeValue["offset"] as JsonObject | null }
          : {})
      };
      return {
        eventId,
        entryRevision: positiveInteger(event["entryRevision"]),
        title: nonEmptyString(event["title"]) ?? eventId,
        sequence: positiveInteger(event["sequence"], index + 1),
        time,
        ...(typeof event["duration"] === "string" || event["duration"] === null
          ? { duration: event["duration"] }
          : {}),
        summary: stringValue(event["summary"]) ?? "",
        chapterIds: stringArray(event["chapterIds"]),
        characterIds: stringArray(event["characterIds"]),
        locationIds: stringArray(event["locationIds"]),
        parallelEventIds: stringArray(event["parallelEventIds"]),
        causes: stringArray(event["causes"]),
        effects: stringArray(event["effects"]),
        stateChanges: recordArray(event["stateChanges"])
      };
    })
  };
}

function strictEntryId(prefix: string, value: unknown, seed: string): string {
  if (typeof value === "string" && new RegExp(`^${prefix}_[a-f0-9]{32}$`, "u").test(value)) {
    return value;
  }
  return `${prefix}_${stableHexIdentity(seed)}`;
}

function stableHexIdentity(seed: string): string {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const character of seed) {
    const code = character.codePointAt(0) ?? 0;
    for (let index = 0; index < words.length; index += 1) {
      const current = words[index] ?? 0;
      words[index] = Math.imul(current ^ (code + index * 131), 0x01000193) >>> 0;
    }
  }
  return words.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function timelineTimeMode(value: unknown): "absolute" | "relative" | "sequence-only" | "unknown" {
  return value === "absolute" || value === "relative" || value === "sequence-only"
    ? value
    : "unknown";
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord).map((entry) => entry as JsonObject) : [];
}

function positiveInteger(value: unknown, fallback = 1): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function jsonObjectValue(value: unknown): JsonObject {
  return isRecord(value) ? (value as JsonObject) : {};
}

function storyBibleEditingBaselineUnavailable(): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: "err_story_bible_editing_baseline_unavailable",
    code: "STORY_BIBLE_EDITING_BASELINE_UNAVAILABLE",
    category: "ValidationError",
    message: "The Story Bible entry changed before its editing baseline was loaded.",
    recoverability: "user-action",
    suggestedAction: "Reload the Story Bible entry before saving.",
    traceId: "renderer-story-bible-editing",
    createdAt: new Date().toISOString()
  };
}

function storyBibleStatusTransitionUnavailable(): UnifiedError {
  return {
    ...storyBibleEditingBaselineUnavailable(),
    errorId: "err_story_bible_status_transition_unavailable",
    code: "STORY_BIBLE_STATUS_TRANSITION_UNAVAILABLE",
    message: "The dedicated Story Bible status command is unavailable.",
    suggestedAction: "Reload the Story Bible entry before retrying the status change."
  };
}

function storyBibleExplicitInverseUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "STORY_BIBLE_EXPLICIT_INVERSE_UNAVAILABLE",
    category: "ValidationError",
    message: "当前版本无法安全预览并原子保存显式双向关系。",
    recoverability: "user-action",
    suggestedAction: "重新加载应用后再试；当前草稿尚未写入。",
    traceId: "story-bible-renderer-explicit-inverse"
  });
}

function parseStoryBibleAffectedPath(relativePath: string): StoryBibleAffectedPath[] {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const regular = /^(characters|world|foreshadows)\/([A-Za-z0-9_-]+)\.json$/u.exec(normalized);
  if (regular?.[1] !== undefined && regular[2] !== undefined) {
    const kind =
      regular[1] === "characters" ? "character" : regular[1] === "world" ? "world" : "foreshadow";
    return [{ kind, assetId: regular[2] }];
  }
  if (normalized === "outline/outline.json") return [{ kind: "outline" }];
  if (normalized === "timeline/events.json") return [{ kind: "timeline" }];
  return [];
}

function externalUpdateState(
  updates: readonly PendingStoryBibleExternalUpdate[],
  snapshot: StoryBibleSnapshot
): StoryBibleEditorProps["externalUpdate"] {
  const latest = updates.at(-1);
  if (latest === undefined) return { status: "none" };
  return {
    status: "available",
    message: "故事资料已有外部更新。当前草稿未被覆盖。",
    affectedEntryIds: affectedEntryIdsForSnapshot(updates, snapshot),
    versionGroupId: latest.versionGroupId
  };
}

function affectedEntryIdsForSnapshot(
  updates: readonly PendingStoryBibleExternalUpdate[],
  snapshot: StoryBibleSnapshot
): string[] {
  const ids = updates.flatMap((update) =>
    update.affectedPaths.flatMap((affected) => {
      if (affected.assetId !== undefined) return [affected.assetId];
      if (affected.kind === "outline" && snapshot.outline !== undefined) {
        return [snapshot.outline.id];
      }
      if (affected.kind === "timeline" && snapshot.timeline !== undefined) {
        return [snapshot.timeline.id];
      }
      return [];
    })
  );
  return [...new Set(ids)];
}

function storyBibleAssetsEqual(left: StoryBibleAsset, right: StoryBibleAsset): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changesToApply(
  analysis: Extract<StoryBibleForeshadowAnalysisState, { readonly status: "review" }>,
  retryFailedOnly: boolean
): readonly StoryBibleForeshadowChangeItem[] | undefined {
  if (!retryFailedOnly && analysis.review.step === "confirmation") {
    return analysis.review.changes.map(markForeshadowChangeApplying);
  }
  if (
    retryFailedOnly &&
    analysis.review.step === "results" &&
    analysis.review.outcome === "partial_failure"
  ) {
    return analysis.review.changes.map((change) =>
      change.status === "failed" ? markForeshadowChangeApplying(change) : change
    );
  }
  return undefined;
}

function markForeshadowChangeApplying(
  change: StoryBibleForeshadowChangeItem
): StoryBibleForeshadowChangeItem {
  const { errorMessage: _errorMessage, ...rest } = change;
  void _errorMessage;
  return { ...rest, status: "applying" };
}

function replaceForeshadowChange(
  changes: readonly StoryBibleForeshadowChangeItem[],
  changeId: string,
  replacement: StoryBibleForeshadowChangeItem
): StoryBibleForeshadowChangeItem[] {
  return changes.map((change) => (change.changeId === changeId ? replacement : change));
}

function failApplyingForeshadowChanges(
  changes: readonly StoryBibleForeshadowChangeItem[],
  errorMessage: string
): StoryBibleForeshadowChangeItem[] {
  return changes.map((change) =>
    change.status === "applying" ? { ...change, status: "failed", errorMessage } : change
  );
}

function foreshadowOperationHasConflict(
  operation: ForeshadowConfirmationPlan["operations"][number],
  latestForeshadows: readonly ForeshadowAsset[]
): boolean {
  const latest = latestForeshadows.find((asset) => asset.id === operation.asset.id);
  if (operation.baseAsset === undefined) return latest !== undefined;
  return latest === undefined || JSON.stringify(latest) !== JSON.stringify(operation.baseAsset);
}

function closedForeshadowAnalysis(): StoryBibleForeshadowAnalysisState {
  return { status: "closed", selectedChapterIds: [] };
}

function isForeshadowAnalysisApplying(analysis: StoryBibleForeshadowAnalysisState): boolean {
  return analysis.status === "review" && analysis.review.step === "applying";
}

function emptySnapshot(): StoryBibleSnapshot {
  return {
    characters: [],
    worldAssets: [],
    foreshadows: [],
    memories: []
  };
}

async function unwrap<T>(promise: Promise<Result<T, UnifiedError>>): Promise<T> {
  const result = await promise;
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.error.message);
}

function toProps(snapshot: StoryBibleSnapshot): StoryBibleSummaryProps {
  return {
    assets: [
      ...snapshot.characters.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
      ...snapshot.worldAssets.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
      ...(snapshot.outline === undefined
        ? []
        : [
            {
              id: snapshot.outline.id,
              title: snapshot.outline.title,
              type: snapshot.outline.type,
              status: snapshot.outline.status,
              summary: snapshot.outline.summary,
              contextEligible: snapshot.outline.status === "active"
            }
          ]),
      ...snapshot.foreshadows.map((asset) => ({
        id: asset.id,
        title: asset.title,
        type: asset.type,
        status: asset.status,
        summary: asset.summary,
        contextEligible: asset.status === "active"
      })),
      ...(snapshot.timeline === undefined
        ? []
        : [
            {
              id: snapshot.timeline.id,
              title: snapshot.timeline.title,
              type: snapshot.timeline.type,
              status: snapshot.timeline.status,
              summary: snapshot.timeline.summary,
              contextEligible: snapshot.timeline.status === "active"
            }
          ]),
      ...snapshot.memories.map(memorySummary)
    ]
  };
}

function createEditorProps(
  snapshot: StoryBibleSnapshot,
  state: StoryBibleEditorState,
  consistency?: StoryBibleConsistencyProps
): StoryBibleEditorProps {
  return {
    activeKind: state.activeKind,
    ...(state.activeTimelineEventId === undefined
      ? {}
      : { activeTimelineEventId: state.activeTimelineEventId }),
    viewMode: state.viewMode,
    status: state.status,
    dirty: state.dirty,
    entries: createEditorEntries(snapshot),
    chapterOptions: [],
    foreshadowAnalysis: state.foreshadowAnalysis,
    filters: state.filters,
    externalUpdate: state.externalUpdate,
    statusAction: state.statusAction,
    ...(state.explicitInversePreview === undefined
      ? {}
      : { explicitInversePreview: state.explicitInversePreview }),
    ...(consistency === undefined ? {} : { consistency }),
    draft: state.draft,
    ...(state.feedback === undefined ? {} : { feedback: state.feedback }),
    onKindSelect: () => undefined,
    onEntrySelect: () => undefined,
    onDraftChange: () => undefined,
    onFiltersChange: () => undefined,
    onNewDraft: () => undefined,
    onCancelDraft: () => undefined,
    onSave: () => undefined,
    onExplicitInversePreviewCancel: () => undefined,
    onExternalUpdateReload: () => undefined,
    onExternalUpdateContinue: () => undefined,
    onStatusActionRequest: () => undefined,
    onStatusActionCancel: () => undefined,
    onStatusActionConfirm: () => undefined,
    onForeshadowAnalysisOpen: () => undefined,
    onForeshadowAnalysisChapterToggle: () => undefined,
    onForeshadowAnalysisStart: () => undefined,
    onForeshadowAnalysisCandidateToggle: () => undefined,
    onForeshadowAnalysisPreview: () => undefined,
    onForeshadowAnalysisBack: () => undefined,
    onForeshadowAnalysisConfirm: () => undefined,
    onForeshadowAnalysisRetryFailed: () => undefined,
    onForeshadowAnalysisClose: () => undefined
  };
}

function deletionConfirmationState(
  impact: StoryBibleReferenceImpact,
  assetTitle: string
): Extract<
  StoryBibleStatusActionState,
  { readonly status: "confirmation"; readonly action: "move-to-deleted" }
> {
  return {
    status: "confirmation",
    action: "move-to-deleted",
    assetId: impact.assetId,
    assetTitle,
    deletionImpactChecksum: impact.deletionImpactChecksum,
    canSetDeleted: impact.canSetDeleted,
    affectedReferenceCount: impact.deletionImpact.affectedReferenceCount,
    affectedAssetIds: [...impact.deletionImpact.affectedAssetIds],
    incoming: impact.incoming.map((reference) => ({
      sourceAssetId: reference.sourceAssetId,
      sourceTitle: reference.sourceTitle,
      sourceType: reference.sourceType,
      sourceStatus: reference.sourceStatus,
      path: reference.path,
      kind: reference.kind,
      integrity: reference.integrity,
      ...(reference.relationType === undefined ? {} : { relationType: reference.relationType })
    }))
  };
}

function deletionImpactSignature(impact: StoryBibleReferenceImpact): string {
  return impact.deletionImpactChecksum;
}

function deletionConfirmationSignature(
  state: Extract<
    StoryBibleStatusActionState,
    { readonly status: "confirmation"; readonly action: "move-to-deleted" }
  >
): string {
  return state.deletionImpactChecksum;
}

function statusActionError(
  code: "STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE" | "STORY_BIBLE_RESTORE_STATUS_UNAVAILABLE"
): UnifiedError {
  const references = code === "STORY_BIBLE_REFERENCE_IMPACT_UNAVAILABLE";
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: references
      ? "无法读取最新入向引用影响，本次未执行删除。"
      : "无法从 History 确定删除前状态，本次未执行恢复。",
    recoverability: "retryable",
    suggestedAction: references ? "重新检查引用影响。" : "重试恢复或从 History 手动恢复。",
    traceId: "desktop-story-bible-status-action"
  });
}

function toConsistencyProps(report: StoryBibleConsistencyReport): StoryBibleConsistencyProps {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    issues: report.issues.flatMap((issue) => {
      if (
        !isNavigableConsistencyRef(issue.sourceRef) ||
        !isNavigableConsistencyRef(issue.targetRef)
      ) {
        return [];
      }

      return [
        {
          id: issue.id,
          severity: issue.severity,
          title: issue.title,
          message: issue.message,
          sourceRef: issue.sourceRef,
          targetRef: issue.targetRef,
          suggestedAction: issue.suggestedAction
        }
      ];
    })
  };
}

function isNavigableConsistencyRef(
  ref: StoryBibleConsistencyRef
): ref is StoryBibleConsistencyRef & { readonly kind: StoryBibleEditorKind } {
  switch (ref.kind) {
    case "character":
    case "world":
    case "outline":
    case "foreshadow":
    case "timeline":
      return true;
    case "chapter":
    case "memory":
      return false;
  }
}

function createEditorEntries(snapshot: StoryBibleSnapshot): readonly StoryBibleEditorEntry[] {
  return [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...snapshot.foreshadows,
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ]
    .map(assetEntry)
    .sort(compareEditorEntries);
}

function assetEntry(asset: StoryBibleAsset): StoryBibleEditorEntry {
  const relations =
    asset.relations === undefined ? undefined : storyBibleRelations(asset.relations);
  const common = {
    id: asset.id,
    title: asset.title,
    status: asset.status,
    summary: asset.summary,
    aliases: [...(asset.aliases ?? [])],
    ...(relations === undefined ? {} : { relations }),
    relatedEntityIds: [
      ...(asset.relatedEntityIds ?? relations?.map((relation) => relation.targetId) ?? [])
    ],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
  switch (asset.type) {
    case "character":
      return { ...common, kind: "character", assetType: asset.type, details: asset.details ?? {} };
    case "world.location":
    case "world.faction":
    case "world.rule":
    case "world.glossary":
    case "world.item":
    case "world.lore":
      return { ...common, kind: "world", assetType: asset.type, details: asset.details ?? {} };
    case "outline":
      return { ...common, kind: "outline", assetType: asset.type, details: asset.details ?? {} };
    case "foreshadow":
      return { ...common, kind: "foreshadow", assetType: asset.type, details: asset.details };
    case "timeline.events":
      return {
        ...common,
        kind: "timeline",
        assetType: asset.type,
        details: asset.details ?? {},
        timelineEvents: timelineEventsFromAsset(asset)
      };
  }
}

const STORY_ENTRY_COLLATOR = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
  usage: "sort"
});

function compareEditorEntries(left: StoryBibleEditorEntry, right: StoryBibleEditorEntry): number {
  return (
    STORY_ENTRY_COLLATOR.compare(left.title, right.title) ||
    left.id.localeCompare(right.id, "en-US")
  );
}

function timelineEventsFromAsset(asset: StoryBibleAsset): readonly StoryTimelineEvent[] {
  const events = asset.details?.["events"];
  if (!Array.isArray(events)) {
    return [];
  }

  return events
    .map((event, index) => toTimelineEvent(event, index, asset.id))
    .filter((event): event is StoryTimelineEvent => event !== undefined)
    .sort(
      (left, right) =>
        left.sequence - right.sequence || STORY_ENTRY_COLLATOR.compare(left.title, right.title)
    );
}

function toTimelineEvent(
  value: unknown,
  index: number,
  parentEntryId: string
): StoryTimelineEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const idValue = value.eventId ?? value.id;
  const id = typeof idValue === "string" && idValue.length > 0 ? idValue : undefined;
  if (id === undefined) {
    return undefined;
  }

  const sequence =
    typeof value.sequence === "number" && Number.isFinite(value.sequence)
      ? value.sequence
      : index + 1;
  const title = typeof value.title === "string" && value.title.length > 0 ? value.title : id;
  const status =
    typeof value.status === "string" && value.status.length > 0 ? value.status : "active";
  const summary = typeof value.summary === "string" ? value.summary : "";
  const time = isRecord(value.time) ? value.time : undefined;
  const timeLabel =
    typeof time?.label === "string"
      ? time.label
      : typeof value.timeLabel === "string"
        ? value.timeLabel
        : "";
  const chapterIds = Array.isArray(value.chapterIds)
    ? value.chapterIds.filter((chapterId): chapterId is string => typeof chapterId === "string")
    : [];
  const characterIds = stringArray(value.characterIds);
  const locationIds = stringArray(value.locationIds);
  const causes = stringArray(value.causes);
  const effects = stringArray(value.effects);

  return {
    id,
    parentEntryId,
    sequence,
    title,
    status,
    timeLabel,
    summary,
    chapterIds,
    characterIds,
    locationIds,
    causes,
    effects
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function storyBibleRelations(value: unknown): StoryBibleEditorRelation[] {
  return Array.isArray(value)
    ? value.filter(isRecord).map((relation) => relation as StoryBibleEditorRelation)
    : [];
}

function requiresExplicitInversePairWrite(
  previousRelations: readonly StoryBibleEditorRelation[],
  nextRelations: readonly StoryBibleEditorRelation[]
): boolean {
  const previousById = new Map(
    previousRelations.map((relation) => [relation.relationId, relation])
  );
  const nextById = new Map(nextRelations.map((relation) => [relation.relationId, relation]));
  for (const relationId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const previous = previousById.get(relationId);
    const next = nextById.get(relationId);
    if (previous?.inversePolicy !== "explicit" && next?.inversePolicy !== "explicit") continue;
    if (previous === undefined || next === undefined) return true;
    if (
      previous.sourceId !== next.sourceId ||
      previous.targetId !== next.targetId ||
      previous.direction !== next.direction ||
      previous.status !== next.status ||
      previous.validFromChapterId !== next.validFromChapterId ||
      previous.validToChapterId !== next.validToChapterId ||
      previous.inversePolicy !== next.inversePolicy ||
      previous.inverseRelationId !== next.inverseRelationId
    ) {
      return true;
    }
  }
  return false;
}

function draftHasTimelineEvent(draft: StoryBibleEditorDraft, eventId: string): boolean {
  if (draft.kind !== "timeline") return false;
  const events = draft.details["events"];
  return (
    Array.isArray(events) &&
    events.some((event) => isRecord(event) && (event.id === eventId || event.eventId === eventId))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyDraft(
  kind: StoryBibleEditorKind,
  worldAssetType: StoryBibleWorldAssetType = "world.location"
): StoryBibleEditorDraft {
  const common = {
    title: "",
    status: "active" as const,
    summary: "",
    aliases: [],
    relations: [],
    relatedEntityIds: []
  };
  switch (kind) {
    case "character":
      return { ...common, kind, assetType: "character", details: {} };
    case "world":
      return { ...common, kind, assetType: worldAssetType, details: {} };
    case "outline":
      return { ...common, kind, assetType: "outline", details: {} };
    case "foreshadow":
      return {
        ...common,
        kind,
        assetType: "foreshadow",
        details: { trackingStatus: "planned", origin: "manual", milestones: [] }
      };
    case "timeline":
      return { ...common, kind, assetType: "timeline.events", details: {} };
  }
}

function normalizeDraft(draft: StoryBibleEditorDraft): StoryBibleEditorDraft {
  const relations = draft.relations === undefined ? undefined : [...draft.relations];
  const useLegacyRelatedIds =
    relations === undefined || (relations.length === 0 && draft.relatedEntityIds.length > 0);
  return {
    ...draft,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    aliases: draft.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    ...(relations === undefined ? {} : { relations }),
    relatedEntityIds: useLegacyRelatedIds
      ? draft.relatedEntityIds.map((id) => id.trim()).filter((id) => id.length > 0)
      : [...new Set(relations.map((relation) => relation.targetId))]
  } as StoryBibleEditorDraft;
}

function validateStoryBibleDraft(
  draft: StoryBibleEditorDraft,
  snapshot: StoryBibleSnapshot,
  saveOptions: StoryBibleSaveOptions | undefined
): string | undefined {
  if (draft.id === undefined && draft.status === "deleted") {
    return "新资料不能以已删除状态创建。";
  }
  if (draft.kind === "outline") {
    if (saveOptions?.chapterIds === undefined) {
      return "无法保存大纲：当前章节目录不可用。";
    }
    const issues = validateStoryBibleOutline(draft.details, saveOptions.chapterIds);
    return issues.length === 0
      ? undefined
      : `无法保存大纲：${issues.map(storyBibleOutlineValidationMessage).join(" ")}`;
  }
  if (draft.kind === "foreshadow") {
    const issues = validateStoryBibleForeshadow(draft, snapshot.foreshadows).filter(
      (issue) => issue.severity === "error"
    );
    return issues.length === 0
      ? undefined
      : `无法保存伏笔：${issues.map(storyBibleForeshadowValidationMessage).join(" ")}`;
  }
  if (draft.kind === "timeline") {
    const issues = validateStoryBibleTimeline(draft.details);
    return issues.length === 0
      ? undefined
      : `无法保存时间线：${issues.map(storyBibleTimelineValidationMessage).join(" ")}`;
  }
  return undefined;
}

async function normalizeForeshadowDraft(
  draft: StoryBibleEditorDraft
): Promise<StoryBibleEditorDraft> {
  if (draft.kind !== "foreshadow" || draft.details.sourceRefs === undefined) {
    return draft;
  }

  const sourceRefs = await Promise.all(
    draft.details.sourceRefs.map(async (sourceRef) => ({
      ...sourceRef,
      ...(await createForeshadowEvidence(sourceRef.chapterId.trim(), sourceRef.excerpt))
    }))
  );
  return {
    ...draft,
    details: {
      ...draft.details,
      sourceRefs
    }
  };
}

function draftFromSnapshot(
  snapshot: StoryBibleSnapshot,
  fallback: StoryBibleEditorDraft
): StoryBibleEditorDraft {
  if (fallback.id === undefined) {
    return fallback;
  }

  const entry = createEditorEntries(snapshot).find((candidate) => candidate.id === fallback.id);
  if (entry === undefined) {
    return fallback;
  }

  return draftFromEntry(entry);
}

function toStoryAsset(
  draft: StoryBibleEditorDraft,
  now: string,
  snapshot: StoryBibleSnapshot,
  createAssetIdentity: () => string
): StoryBibleAsset {
  const existing = findExistingAsset(snapshot, draft.id);
  if (existing !== undefined && existing.type !== draft.assetType) {
    throw new Error("Existing Story Bible assets cannot change asset type.");
  }
  const id = draft.id ?? defaultAssetId(draft, createAssetIdentity);
  const details = mergeJsonObjects(existing?.details ?? {}, draft.details);
  if (draft.assetType === "character") delete details["appearanceChapterIds"];
  const common = {
    ...(existing ?? {}),
    schemaVersion: "1.0",
    id,
    title: draft.title,
    status: draft.status,
    summary: draft.summary,
    aliases: [...draft.aliases],
    relatedEntityIds: [...draft.relatedEntityIds],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  if (draft.kind === "foreshadow") {
    const { plantedChapterId, plannedPayoffChapterId, actualPayoffChapterId, ...otherDetails } =
      details;
    const foreshadowDetails: JsonObject = {
      ...otherDetails,
      trackingStatus: draft.details.trackingStatus,
      ...optionalTrimmedString("plantedChapterId", plantedChapterId),
      ...optionalTrimmedString("plannedPayoffChapterId", plannedPayoffChapterId),
      ...optionalTrimmedString("actualPayoffChapterId", actualPayoffChapterId)
    };
    return {
      ...common,
      type: "foreshadow",
      details: foreshadowDetails
    } as ForeshadowAsset;
  }
  return {
    ...common,
    type: draft.assetType,
    details
  } as StoryBibleRegularAsset;
}

function optionalTrimmedString(key: string, value: unknown): JsonObject {
  return typeof value === "string" && value.trim().length > 0 ? { [key]: value.trim() } : {};
}

function findExistingAsset(
  snapshot: StoryBibleSnapshot,
  id: string | undefined
): StoryBibleAsset | undefined {
  if (id === undefined) {
    return undefined;
  }

  return [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...snapshot.foreshadows,
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ].find((asset) => asset.id === id);
}

function defaultAssetId(draft: StoryBibleEditorDraft, createAssetIdentity: () => string): string {
  if (draft.assetType === "outline") {
    return "outline_main";
  }
  if (draft.assetType === "timeline.events") {
    return "timeline_main";
  }
  const identity = createAssetIdentity();
  if (!/^[0-9a-f]{32}$/u.test(identity)) {
    throw new Error("Story Bible asset identity must be 32 lowercase hexadecimal characters.");
  }
  switch (draft.assetType) {
    case "character":
      return `chr_${identity}`;
    case "world.location":
      return `loc_${identity}`;
    case "world.faction":
      return `fac_${identity}`;
    case "world.rule":
      return `rule_${identity}`;
    case "world.glossary":
      return `term_${identity}`;
    case "world.item":
      return `item_${identity}`;
    case "world.lore":
      return `lore_${identity}`;
    case "foreshadow":
      return `fsh_${identity}`;
  }
}

function draftFromEntry(entry: StoryBibleEditorEntry): StoryBibleEditorDraft {
  const common = {
    id: entry.id,
    title: entry.title,
    status: entry.status,
    summary: entry.summary,
    aliases: [...entry.aliases],
    relations: [...(entry.relations ?? [])],
    relatedEntityIds: [...entry.relatedEntityIds],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
  switch (entry.kind) {
    case "character":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "world":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "outline":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "foreshadow":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
    case "timeline":
      return { ...common, kind: entry.kind, assetType: entry.assetType, details: entry.details };
  }
}

function assertDraftPatch<K extends StoryBibleEditorKind>(
  current: StoryBibleEditorDraft,
  kind: K,
  patch: Partial<StoryBibleEditorDraftFor<K>>
): void {
  if (kind !== current.kind) {
    throw new Error(`Cannot apply a ${kind} patch to the active ${current.kind} draft.`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "kind")) {
    throw new Error("Story Bible draft patches cannot modify kind.");
  }
  const allowedKeys = new Set([
    "assetType",
    "title",
    "status",
    "summary",
    "aliases",
    "relations",
    "relatedEntityIds",
    "details"
  ]);
  const unknownKey = Object.keys(patch).find((key) => !allowedKeys.has(key));
  if (unknownKey !== undefined) {
    throw new Error(`Story Bible draft patch contains an unsupported ${unknownKey} field.`);
  }
  if (
    patch.assetType !== undefined &&
    (!assetTypeMatchesKind(kind, patch.assetType) ||
      (current.id !== undefined && patch.assetType !== current.assetType))
  ) {
    throw new Error(`Story Bible draft asset type does not match the active ${kind} draft.`);
  }
}

function assetTypeMatchesKind(
  kind: StoryBibleEditorKind,
  assetType: StoryBibleAsset["type"]
): boolean {
  switch (kind) {
    case "character":
      return assetType === "character";
    case "world":
      return WORLD_ASSET_TYPES.has(assetType);
    case "outline":
      return assetType === "outline";
    case "foreshadow":
      return assetType === "foreshadow";
    case "timeline":
      return assetType === "timeline.events";
  }
}

const WORLD_ASSET_TYPES = new Set<StoryBibleAsset["type"]>([
  "world.location",
  "world.faction",
  "world.rule",
  "world.glossary",
  "world.item",
  "world.lore"
]);

function mergeDraftPatch<K extends StoryBibleEditorKind>(
  current: StoryBibleEditorDraft,
  patch: Partial<StoryBibleEditorDraftFor<K>>
): StoryBibleEditorDraft {
  const assetTypeChanged = patch.assetType !== undefined && patch.assetType !== current.assetType;
  return {
    ...current,
    ...patch,
    details: assetTypeChanged
      ? (patch.details ?? {})
      : patch.details === undefined
        ? current.details
        : mergeJsonObjects(current.details, patch.details)
  } as StoryBibleEditorDraft;
}

function mergeJsonObjects(current: JsonObject, patch: JsonObject): JsonObject {
  const merged: JsonObject = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const currentValue = current[key];
    merged[key] =
      isJsonObject(currentValue) && isJsonObject(value)
        ? mergeJsonObjects(currentValue, value)
        : value;
  }
  return merged;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftsEqual(left: StoryBibleEditorDraft, right: StoryBibleEditorDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createRandomAssetIdentity(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function memorySummary(memory: MemoryRecord): StoryBibleSummaryAsset {
  return {
    id: memory.id,
    title: memory.title,
    type: memory.type,
    status: memory.status,
    summary: memory.content,
    contextEligible:
      memory.status === "active" &&
      memory.confidence === "confirmed" &&
      memory.origin !== "ai-unconfirmed"
  };
}
