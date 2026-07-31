import type {
  ForeshadowAsset,
  MemoryRecord,
  NovelStudioApi,
  StoryBibleAsset,
  StoryBibleConsistencyRef,
  StoryBibleConsistencyReport,
  StoryBibleRegularAsset,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type { ContextDraftActiveResourceRef } from "@novel-studio/agent-engine";
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";
import { createForeshadowEvidence } from "@novel-studio/shared";
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
  StoryBibleWorldAssetType,
  StoryBibleConsistencyProps,
  StoryTimelineEvent,
  StoryBibleSummaryAsset,
  StoryBibleSummaryProps
} from "@novel-studio/ui";

import {
  createForeshadowConfirmationPlan,
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
  beginCreate(
    kind: StoryBibleEditorKind,
    assetType?: StoryBibleWorldAssetType
  ): StoryBibleEditorProps;
  cancelDraft(): StoryBibleEditorProps;
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
  reloadExternalUpdate(): Promise<StoryBibleEditorProps>;
  continueExternalUpdate(): StoryBibleEditorProps;
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

export interface StoryBibleBridgeOptions {
  readonly createAssetIdentity?: () => string;
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
  readonly feedback?: StoryBibleEditorProps["feedback"];
}

interface StoryBibleAffectedPath {
  readonly kind: StoryBibleEditorKind;
  readonly assetId?: string;
}

interface PendingStoryBibleExternalUpdate extends StoryBibleExternalUpdateInput {
  readonly affectedPaths: readonly StoryBibleAffectedPath[];
}

const DEFAULT_FILTERS: StoryBibleEditorFilters = {
  query: "",
  status: "all",
  worldAssetType: "all",
  foreshadowTrackingStatus: "all"
};

export function createStoryBibleBridge(
  api: NovelStudioApi,
  options: StoryBibleBridgeOptions = {}
): StoryBibleBridge {
  const createAssetIdentity = options.createAssetIdentity ?? createRandomAssetIdentity;
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
  let externalRefreshGeneration = 0;
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
    externalUpdate: { status: "none" }
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
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = emptyDraft(kind);
      baselineAsset = undefined;
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
        externalUpdate
      };
      deleteFeedback();
      return publishEditor();
    },
    selectEntry(entryId) {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
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
      if (entry === undefined) {
        return editorProps;
      }

      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = draftFromEntry(entry);
      baselineAsset = findExistingAsset(snapshot, entry.id);
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
        externalUpdate
      };
      deleteFeedback();
      return publishEditor();
    },
    beginCreate(kind, assetType) {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
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
        externalUpdate
      };
      deleteFeedback();
      return publishEditor();
    },
    cancelDraft() {
      if (isForeshadowAnalysisApplying(editorState.foreshadowAnalysis)) return editorProps;
      foreshadowAnalysisGeneration += 1;
      foreshadowConfirmationPlan = undefined;
      baselineDraft = emptyDraft(editorState.activeKind);
      baselineAsset = undefined;
      const externalUpdate = externalUpdateAfterNavigation();
      editorState = {
        ...editorState,
        activeTimelineEventId: undefined,
        viewMode: "list",
        status: "idle",
        dirty: false,
        draft: baselineDraft,
        foreshadowAnalysis: closedForeshadowAnalysis(),
        externalUpdate
      };
      deleteFeedback();
      return publishEditor();
    },
    updateDraft(kind, draft) {
      assertDraftPatch(editorState.draft, kind, draft);
      const nextDraft = mergeDraftPatch(editorState.draft, draft);
      if (pendingExternalUpdates.length > 0) validateExternalBaselineBeforeSave = true;
      editorState = {
        ...editorState,
        activeKind: nextDraft.kind,
        viewMode: "detail",
        status: "idle",
        dirty: !draftsEqual(nextDraft, baselineDraft),
        draft: nextDraft
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
          const saved = await api.storyBible.saveAsset(operation.asset);
          if (token !== foreshadowAnalysisGeneration) {
            return { editor: editorProps, applied: false };
          }
          changes = replaceForeshadowChange(changes, operation.changeId, {
            ...change,
            status: saved.ok ? "succeeded" : "failed",
            ...(saved.ok ? {} : { errorMessage: saved.error.message })
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
      rememberHandledVersionGroup(input.versionGroupId);
      const update: PendingStoryBibleExternalUpdate = { ...input, affectedPaths };
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
    beginSave() {
      editorState = { ...editorState, status: "saving" };
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
      const saved = await api.storyBible.saveAsset(
        toStoryAsset(normalizedDraft, now(), snapshot, createAssetIdentity)
      );

      if (!saved.ok) {
        editorState = {
          ...editorState,
          status: "error",
          dirty: true,
          draft: normalizedDraft,
          feedback: {
            kind: "error",
            message: saved.error.message
          }
        };
        return publishEditor();
      }

      if (generation !== loadGeneration) return editorProps;
      const nextSnapshot = await unwrap(api.storyBible.load());
      if (generation !== loadGeneration) return editorProps;
      const nextConsistency = toConsistencyProps(
        await unwrap(api.storyBible.buildConsistencyReport())
      );
      if (generation !== loadGeneration) return editorProps;
      snapshot = nextSnapshot;
      snapshotBinding = workspaceId === undefined ? undefined : { workspaceId, snapshot };
      consistency = nextConsistency;
      props = toProps(snapshot);
      baselineDraft = draftFromSnapshot(snapshot, { ...normalizedDraft, id: saved.value.id });
      baselineAsset = findExistingAsset(snapshot, saved.value.id);
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
        feedback: {
          kind: "info",
          message: "故事圣经已保存。"
        }
      };
      return publishEditor();
    }
  };

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
      externalUpdate: editorState.externalUpdate
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
      return failExternalRefresh(updates, "故事资料已由 Agent 更新，但重新加载失败；请重试。");
    }
    if (
      generation !== externalRefreshGeneration ||
      snapshotBinding?.workspaceId !== workspaceId
    ) {
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
    const currentEntryId =
      previousState.viewMode === "detail" ? previousState.draft.id : undefined;
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
      const activeTimelineEventId =
        targetEntry.kind === "timeline" &&
        previousState.activeTimelineEventId !== undefined &&
        targetEntry.timelineEvents.some(
          (event) => event.id === previousState.activeTimelineEventId
        )
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
          message: "故事资料已同步 Agent 的最新变更。"
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
        message: "故事资料已同步 Agent 的最新变更。"
      }
    };
  }

  function reset(): void {
    foreshadowAnalysisGeneration += 1;
    externalRefreshGeneration += 1;
    foreshadowConfirmationPlan = undefined;
    handledVersionGroupIds.clear();
    clearPendingExternalUpdate();
    snapshot = emptySnapshot();
    snapshotBinding = undefined;
    consistency = undefined;
    props = { assets: [] };
    baselineDraft = emptyDraft(editorState.activeKind);
    baselineAsset = undefined;
    editorState = {
      ...editorState,
      activeTimelineEventId: undefined,
      viewMode: "list",
      status: "idle",
      dirty: false,
      draft: baselineDraft,
      foreshadowAnalysis: closedForeshadowAnalysis(),
      externalUpdate: { status: "none" }
    };
    deleteFeedback();
    publishEditor();
  }
}

function parseStoryBibleAffectedPath(relativePath: string): StoryBibleAffectedPath[] {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  const regular = /^(characters|world|foreshadows)\/([A-Za-z0-9_-]+)\.json$/u.exec(normalized);
  if (regular?.[1] !== undefined && regular[2] !== undefined) {
    const kind =
      regular[1] === "characters"
        ? "character"
        : regular[1] === "world"
          ? "world"
          : "foreshadow";
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
    message: "故事资料已由 Agent 更新。当前草稿未被覆盖。",
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
    onExternalUpdateReload: () => undefined,
    onExternalUpdateContinue: () => undefined,
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
  const common = {
    id: asset.id,
    title: asset.title,
    status: asset.status,
    summary: asset.summary,
    aliases: [...(asset.aliases ?? [])],
    relatedEntityIds: [...(asset.relatedEntityIds ?? [])],
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

  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : undefined;
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
  const timeLabel = typeof value.timeLabel === "string" ? value.timeLabel : "";
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

function draftHasTimelineEvent(draft: StoryBibleEditorDraft, eventId: string): boolean {
  if (draft.kind !== "timeline") return false;
  const events = draft.details["events"];
  return Array.isArray(events) && events.some((event) => isRecord(event) && event.id === eventId);
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
        details: { trackingStatus: "planned", origin: "manual" }
      };
    case "timeline":
      return { ...common, kind, assetType: "timeline.events", details: {} };
  }
}

function normalizeDraft(draft: StoryBibleEditorDraft): StoryBibleEditorDraft {
  return {
    ...draft,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    aliases: draft.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0),
    relatedEntityIds: draft.relatedEntityIds.map((id) => id.trim()).filter((id) => id.length > 0)
  } as StoryBibleEditorDraft;
}

function validateStoryBibleDraft(
  draft: StoryBibleEditorDraft,
  snapshot: StoryBibleSnapshot,
  saveOptions: StoryBibleSaveOptions | undefined
): string | undefined {
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
    const issues = validateStoryBibleForeshadow(draft, snapshot.foreshadows);
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
  "world.glossary"
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
