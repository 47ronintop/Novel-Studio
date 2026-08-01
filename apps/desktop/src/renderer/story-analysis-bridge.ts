import type {
  NovelStudioApi,
  StoryAnalysisApplicationPreviewDto,
  StoryAnalysisApplicationResultDto,
  StoryAnalysisCompletionMode,
  StoryBibleMaintenanceMode,
  StoryAnalysisRecordDto,
  StoryAnalysisReviewCommand,
  StoryBibleAsset,
  StoryBibleSnapshot
} from "@novel-studio/application";
import type { StoryChangeSuggestion, StoryReviewIssue } from "@novel-studio/schemas";
import type { Result, UnifiedError } from "@novel-studio/shared";
import type {
  StoryAnalysisApplicationPreviewProps,
  StoryAnalysisApplicationResultProps,
  StoryAnalysisIssueProps,
  StoryAnalysisReviewFilters,
  StoryAnalysisReviewProps,
  StoryAnalysisSuggestionProps
} from "@novel-studio/ui";

export interface StoryAnalysisBridge {
  getProps(): StoryAnalysisReviewProps;
  clear(): StoryAnalysisReviewProps;
  loadOverview(): Promise<StoryAnalysisReviewProps>;
  open(): Promise<StoryAnalysisReviewProps>;
  close(): StoryAnalysisReviewProps;
  selectRun(workflowRunId: string): Promise<StoryAnalysisReviewProps>;
  updateFilters(filters: Partial<StoryAnalysisReviewFilters>): StoryAnalysisReviewProps;
  toggleSuggestion(suggestionId: string): StoryAnalysisReviewProps;
  acceptSelected(): Promise<StoryAnalysisReviewProps>;
  rejectSelected(): Promise<StoryAnalysisReviewProps>;
  prepareSelected(): Promise<StoryAnalysisReviewProps>;
  applyPrepared(): Promise<StoryAnalysisReviewProps>;
  refreshStaleness(): Promise<StoryAnalysisReviewProps>;
  resolveIssue(issueId: string, decision: string): Promise<StoryAnalysisReviewProps>;
  dismissIssue(issueId: string, reason: string): Promise<StoryAnalysisReviewProps>;
  analyze(chapterId?: string): Promise<StoryAnalysisReviewProps>;
  hasOutstandingReviewForChapter(
    chapterId: string,
    options?: { readonly analysisScheduled?: boolean }
  ): Promise<boolean>;
  saveCompletionMode(mode: StoryAnalysisCompletionMode): Promise<StoryAnalysisReviewProps>;
  saveMaintenanceMode(mode: StoryBibleMaintenanceMode): Promise<StoryAnalysisReviewProps>;
}

export interface StoryAnalysisBridgeOptions {
  readonly getStoryBibleSnapshot?: () => StoryBibleSnapshot;
}

interface StoryAnalysisBridgeState {
  readonly open: boolean;
  readonly status: StoryAnalysisReviewProps["status"];
  readonly completionMode: StoryAnalysisCompletionMode;
  readonly maintenanceMode: StoryBibleMaintenanceMode;
  readonly summaries: StoryAnalysisReviewProps["summaries"];
  readonly activeWorkflowRunId: string | undefined;
  readonly record: StoryAnalysisRecordDto | undefined;
  readonly selectedSuggestionIds: readonly string[];
  readonly filters: StoryAnalysisReviewFilters;
  readonly preview: StoryAnalysisApplicationPreviewDto | undefined;
  readonly previewSuggestionIds: readonly string[];
  readonly result: StoryAnalysisApplicationResultDto | undefined;
  readonly feedback: StoryAnalysisReviewProps["feedback"] | undefined;
}

const DEFAULT_FILTERS: StoryAnalysisReviewFilters = {
  recordType: "all",
  status: "all",
  domain: "all"
};

export function createStoryAnalysisBridge(
  api: NovelStudioApi,
  options: StoryAnalysisBridgeOptions = {}
): StoryAnalysisBridge {
  let generation = 0;
  let state: StoryAnalysisBridgeState = initialState();
  let props = toProps(state, options.getStoryBibleSnapshot?.());

  function publish(): StoryAnalysisReviewProps {
    props = toProps(state, options.getStoryBibleSnapshot?.());
    return props;
  }

  function begin(status: StoryAnalysisReviewProps["status"]): number {
    state = { ...state, status, feedback: undefined };
    publish();
    return ++generation;
  }

  function fail(error: unknown): StoryAnalysisReviewProps {
    state = {
      ...state,
      status: "error",
      feedback: { kind: "error", message: errorMessage(error) }
    };
    return publish();
  }

  async function loadSummaries(): Promise<void> {
    const summaries = await unwrap(api.storyAnalysis.list());
    state = {
      ...state,
      summaries: [...summaries].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt, "en") ||
          left.workflowRunId.localeCompare(right.workflowRunId, "en")
      )
    };
  }

  async function loadActiveRecord(workflowRunId: string | undefined): Promise<void> {
    if (workflowRunId === undefined) {
      state = {
        ...state,
        activeWorkflowRunId: undefined,
        record: undefined,
        selectedSuggestionIds: [],
        preview: undefined,
        previewSuggestionIds: [],
        result: undefined
      };
      return;
    }
    const record = await unwrap(api.storyAnalysis.read(workflowRunId));
    state = {
      ...state,
      activeWorkflowRunId: workflowRunId,
      record,
      selectedSuggestionIds: reconcileSelection(state.selectedSuggestionIds, record),
      preview: undefined,
      previewSuggestionIds: [],
      result: undefined
    };
  }

  async function refreshSummariesAfterMutation(): Promise<void> {
    await loadSummaries();
    state = {
      ...state,
      selectedSuggestionIds:
        state.record === undefined
          ? []
          : reconcileSelection(state.selectedSuggestionIds, state.record)
    };
  }

  async function transitionSelected(
    transition: "accepted" | "rejected"
  ): Promise<StoryAnalysisReviewProps> {
    if (state.record === undefined || state.selectedSuggestionIds.length === 0) {
      state = {
        ...state,
        status: "ready",
        feedback: { kind: "error", message: "请先选择需要处理的资料建议。" }
      };
      return publish();
    }
    const token = begin("transitioning");
    try {
      let record = state.record;
      const selected = selectedSuggestions(record, state.selectedSuggestionIds);
      const groupIds = [...new Set(selected.map((suggestion) => suggestion.consistencyGroupId))];
      for (const groupId of groupIds) {
        const current = record.storyAnalysis.records.find(
          (candidate): candidate is StoryChangeSuggestion =>
            candidate.recordType === "change" &&
            candidate.consistencyGroupId === groupId &&
            candidate.status === "pending"
        );
        if (current === undefined) continue;
        record = await unwrap(
          api.storyAnalysis.transitionRecord({
            workflowRunId: record.workflowRunId,
            recordId: current.suggestionId,
            expectedRevision: current.revision,
            transition: { status: transition }
          })
        );
      }
      if (token !== generation) return props;
      state = {
        ...state,
        status: "ready",
        record,
        selectedSuggestionIds:
          transition === "accepted" ? reconcileSelection(state.selectedSuggestionIds, record) : [],
        preview: undefined,
        previewSuggestionIds: [],
        result: undefined,
        feedback: {
          kind: "info",
          message: transition === "accepted" ? "所选一致性组已接受。" : "所选一致性组已拒绝。"
        }
      };
      await refreshSummariesAfterMutation();
      return publish();
    } catch (error) {
      if (token !== generation) return props;
      return fail(error);
    }
  }

  async function transitionIssue(
    issueId: string,
    transition: StoryAnalysisReviewCommand["transition"]
  ): Promise<StoryAnalysisReviewProps> {
    const record = state.record;
    const issue = record?.storyAnalysis.records.find(
      (candidate): candidate is StoryReviewIssue =>
        candidate.recordType === "review_issue" && candidate.issueId === issueId
    );
    if (record === undefined || issue === undefined || issue.status !== "open") return props;
    const token = begin("transitioning");
    try {
      const next = await unwrap(
        api.storyAnalysis.transitionRecord({
          workflowRunId: record.workflowRunId,
          recordId: issue.issueId,
          expectedRevision: issue.revision,
          transition
        })
      );
      if (token !== generation) return props;
      state = {
        ...state,
        status: "ready",
        record: next,
        feedback: { kind: "info", message: "一致性问题已更新。" }
      };
      await refreshSummariesAfterMutation();
      return publish();
    } catch (error) {
      if (token !== generation) return props;
      return fail(error);
    }
  }

  const bridge: StoryAnalysisBridge = {
    getProps: () => props,
    clear() {
      generation += 1;
      state = initialState();
      return publish();
    },
    async loadOverview() {
      const token = begin("loading");
      try {
        const [summaries, settings] = await Promise.all([
          unwrap(api.storyAnalysis.list()),
          unwrap(api.settings.readStoryAnalysisSettings())
        ]);
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          completionMode: settings.completionMode,
          maintenanceMode: settings.storyBibleMaintenanceMode,
          summaries: [...summaries].sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt, "en")
          ),
          feedback: undefined
        };
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    async open() {
      const token = begin("loading");
      state = { ...state, open: true };
      publish();
      try {
        const [summaries, settings] = await Promise.all([
          unwrap(api.storyAnalysis.list()),
          unwrap(api.settings.readStoryAnalysisSettings())
        ]);
        if (token !== generation) return props;
        state = {
          ...state,
          completionMode: settings.completionMode,
          maintenanceMode: settings.storyBibleMaintenanceMode,
          summaries: [...summaries].sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt, "en")
          )
        };
        const activeWorkflowRunId = chooseActiveRun(state.activeWorkflowRunId, state.summaries);
        await loadActiveRecord(activeWorkflowRunId);
        if (token !== generation) return props;
        state = { ...state, status: "ready", open: true, feedback: undefined };
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    close() {
      generation += 1;
      state = { ...state, open: false, status: "ready", feedback: undefined };
      return publish();
    },
    async selectRun(workflowRunId) {
      if (!state.summaries.some((summary) => summary.workflowRunId === workflowRunId)) return props;
      const token = begin("loading");
      try {
        await loadActiveRecord(workflowRunId);
        if (token !== generation) return props;
        state = { ...state, status: "ready", feedback: undefined };
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    updateFilters(filters) {
      state = { ...state, filters: { ...state.filters, ...filters } };
      return publish();
    },
    toggleSuggestion(suggestionId) {
      const record = state.record;
      if (record === undefined) return props;
      const suggestion = record.storyAnalysis.records.find(
        (candidate): candidate is StoryChangeSuggestion =>
          candidate.recordType === "change" && candidate.suggestionId === suggestionId
      );
      if (
        suggestion === undefined ||
        (suggestion.status !== "pending" && suggestion.status !== "accepted")
      ) {
        return props;
      }
      const groupIds = record.storyAnalysis.records.flatMap((candidate) =>
        candidate.recordType === "change" &&
        candidate.consistencyGroupId === suggestion.consistencyGroupId &&
        (candidate.status === "pending" || candidate.status === "accepted")
          ? [candidate.suggestionId]
          : []
      );
      const selected = new Set(state.selectedSuggestionIds);
      const remove = groupIds.every((id) => selected.has(id));
      for (const id of groupIds) {
        if (remove) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
      }
      state = {
        ...state,
        selectedSuggestionIds: [...selected].sort((left, right) => left.localeCompare(right, "en")),
        preview: undefined,
        previewSuggestionIds: [],
        result: undefined,
        feedback: undefined
      };
      return publish();
    },
    acceptSelected: () => transitionSelected("accepted"),
    rejectSelected: () => transitionSelected("rejected"),
    async prepareSelected() {
      const record = state.record;
      const suggestionIds = [...state.selectedSuggestionIds];
      if (record === undefined || suggestionIds.length === 0) {
        state = {
          ...state,
          feedback: { kind: "error", message: "请先选择需要应用的资料建议。" }
        };
        return publish();
      }
      const token = begin("preparing");
      try {
        const preview = await unwrap(
          api.storyAnalysis.prepareApplication({
            workflowRunId: record.workflowRunId,
            suggestionIds
          })
        );
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          record: preview.analysis,
          preview,
          previewSuggestionIds: suggestionIds,
          result: undefined,
          feedback: { kind: "info", message: "变更预览已生成，确认后才会写入资料。" }
        };
        await refreshSummariesAfterMutation();
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    async applyPrepared() {
      const preview = state.preview;
      if (preview === undefined || state.previewSuggestionIds.length === 0) return props;
      const token = begin("applying");
      try {
        const result = await unwrap(
          api.storyAnalysis.applyApplication({
            workflowRunId: preview.analysis.workflowRunId,
            suggestionIds: state.previewSuggestionIds,
            changeSetId: preview.changeSet.changeSetId,
            revision: preview.changeSet.revision,
            checksum: preview.changeSet.checksum
          })
        );
        if (token !== generation) return props;
        const allGroupsApplied = result.batch.groups.every((group) => group.status === "applied");
        state = {
          ...state,
          status: "ready",
          record: result.analysis,
          selectedSuggestionIds: [],
          preview: undefined,
          previewSuggestionIds: [],
          result,
          feedback: {
            // A record-sync warning is intentionally not an apply failure: the
            // Version Group has committed and re-applying would risk a duplicate
            // author action. It only changes a fully-applied result; a partial
            // batch must retain its own error and recovery path.
            kind: allGroupsApplied ? "info" : "error",
            message: !allGroupsApplied
              ? "部分一致性组未能应用，请查看分组结果。"
              : result.recordSyncWarning === undefined
                ? "所选资料更新已事务写入。"
                : "资料已写入，但建议状态同步失败，可刷新/重试。"
          }
        };
        await refreshSummariesAfterMutation();
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    async refreshStaleness() {
      const record = state.record;
      if (record === undefined) return props;
      const token = begin("loading");
      try {
        const next = await unwrap(api.storyAnalysis.refreshStaleness(record.workflowRunId));
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          record: next,
          selectedSuggestionIds: reconcileSelection(state.selectedSuggestionIds, next),
          preview: undefined,
          previewSuggestionIds: [],
          feedback: { kind: "info", message: "建议基线已重新检查。" }
        };
        await refreshSummariesAfterMutation();
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    resolveIssue: (issueId, decision) => transitionIssue(issueId, { status: "resolved", decision }),
    dismissIssue: (issueId, reason) => transitionIssue(issueId, { status: "dismissed", reason }),
    async analyze(chapterId) {
      const targetChapterId =
        chapterId ?? state.record?.storyAnalysis.analysisRun.chapter.chapterId;
      if (targetChapterId === undefined) return props;
      const token = begin("analyzing");
      try {
        const record = await unwrap(
          api.storyAnalysis.analyzeChapter({ chapterId: targetChapterId })
        );
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          open: true,
          activeWorkflowRunId: record.workflowRunId,
          record,
          selectedSuggestionIds: [],
          preview: undefined,
          previewSuggestionIds: [],
          result: undefined,
          feedback: { kind: "info", message: "章节分析已完成。" }
        };
        await refreshSummariesAfterMutation();
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    async hasOutstandingReviewForChapter(chapterId, options = {}) {
      const settings = await unwrap(api.settings.readStoryAnalysisSettings());
      if (settings.storyBibleMaintenanceMode !== "review") return false;
      if (options.analysisScheduled === true) return true;
      const summaries = await unwrap(api.storyAnalysis.list());

      const chapterRuns = summaries.filter((summary) => summary.chapterId === chapterId);
      if (
        chapterRuns.some(
          (summary) =>
            summary.status === "queued" ||
            summary.status === "running" ||
            summary.status === "partial" ||
            summary.status === "failed"
        )
      ) {
        return true;
      }

      const records = await Promise.all(
        chapterRuns.map((summary) => unwrap(api.storyAnalysis.read(summary.workflowRunId)))
      );
      return records.some((record) =>
        record.storyAnalysis.records.some(
          (entry) =>
            (entry.recordType === "change" &&
              (entry.status === "pending" ||
                entry.status === "accepted" ||
                entry.status === "failed")) ||
            (entry.recordType === "review_issue" && entry.status === "open")
        )
      );
    },
    async saveCompletionMode(mode) {
      const token = begin("saving-settings");
      try {
        const saved = await unwrap(
          api.settings.saveStoryAnalysisSettings({
            completionMode: mode,
            storyBibleMaintenanceMode: state.maintenanceMode
          })
        );
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          completionMode: saved.completionMode,
          maintenanceMode: saved.storyBibleMaintenanceMode,
          feedback: { kind: "info", message: "章后资料分析设置已保存。" }
        };
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    },
    async saveMaintenanceMode(mode) {
      const token = begin("saving-settings");
      try {
        const saved = await unwrap(
          api.settings.saveStoryAnalysisSettings({
            completionMode: state.completionMode,
            storyBibleMaintenanceMode: mode
          })
        );
        if (token !== generation) return props;
        state = {
          ...state,
          status: "ready",
          completionMode: saved.completionMode,
          maintenanceMode: saved.storyBibleMaintenanceMode,
          feedback: {
            kind: "info",
            message:
              saved.storyBibleMaintenanceMode === "safe-auto"
                ? "已开启安全自动更新；高风险建议仍需审查。"
                : "已切换为审查后写入。"
          }
        };
        return publish();
      } catch (error) {
        if (token !== generation) return props;
        return fail(error);
      }
    }
  };

  return bridge;
}

function initialState(): StoryAnalysisBridgeState {
  return {
    open: false,
    status: "idle",
    completionMode: "prompt",
    maintenanceMode: "review",
    summaries: [],
    activeWorkflowRunId: undefined,
    record: undefined,
    selectedSuggestionIds: [],
    filters: DEFAULT_FILTERS,
    preview: undefined,
    previewSuggestionIds: [],
    result: undefined,
    feedback: undefined
  };
}

function toProps(
  state: StoryAnalysisBridgeState,
  snapshot: StoryBibleSnapshot | undefined
): StoryAnalysisReviewProps {
  const records = state.record?.storyAnalysis.records ?? [];
  const groupSizes = new Map<string, number>();
  for (const record of records) {
    if (record.recordType === "change") {
      groupSizes.set(
        record.consistencyGroupId,
        (groupSizes.get(record.consistencyGroupId) ?? 0) + 1
      );
    }
  }
  const suggestions = records.flatMap((record) =>
    record.recordType === "change"
      ? [toSuggestionProps(record, groupSizes.get(record.consistencyGroupId) ?? 1, snapshot)]
      : []
  );
  const issues = records.flatMap((record) =>
    record.recordType === "review_issue" ? [toIssueProps(record)] : []
  );
  return {
    open: state.open,
    status: state.status,
    completionMode: state.completionMode,
    maintenanceMode: state.maintenanceMode,
    pendingCount: state.summaries.reduce(
      (count, summary) => count + summary.pendingSuggestionCount,
      0
    ),
    openIssueCount: state.summaries.reduce((count, summary) => count + summary.openIssueCount, 0),
    summaries: state.summaries,
    ...(state.activeWorkflowRunId === undefined
      ? {}
      : { activeWorkflowRunId: state.activeWorkflowRunId }),
    ...(state.record === undefined
      ? {}
      : { activeChapterId: state.record.storyAnalysis.analysisRun.chapter.chapterId }),
    selectedSuggestionIds: state.selectedSuggestionIds,
    filters: state.filters,
    suggestions,
    issues,
    ...(state.preview === undefined ? {} : { preview: toPreviewProps(state.preview) }),
    ...(state.result === undefined ? {} : { result: toResultProps(state.result) }),
    ...(state.feedback === undefined ? {} : { feedback: state.feedback }),
    onOpen: () => undefined,
    onClose: () => undefined,
    onRunSelect: () => undefined,
    onFiltersChange: () => undefined,
    onSuggestionToggle: () => undefined,
    onAcceptSelected: () => undefined,
    onRejectSelected: () => undefined,
    onPrepareSelected: () => undefined,
    onApplyPrepared: () => undefined,
    onRefreshStaleness: () => undefined,
    onResolveIssue: () => undefined,
    onDismissIssue: () => undefined,
    onReanalyze: () => undefined,
    onCompletionModeChange: () => undefined,
    onMaintenanceModeChange: () => undefined
  };
}

function toSuggestionProps(
  suggestion: StoryChangeSuggestion,
  groupSize: number,
  snapshot: StoryBibleSnapshot | undefined
): StoryAnalysisSuggestionProps {
  const targetAsset =
    suggestion.target === null ? undefined : findAsset(snapshot, suggestion.target.assetId);
  return {
    suggestionId: suggestion.suggestionId,
    consistencyGroupId: suggestion.consistencyGroupId,
    groupSize,
    status: suggestion.status,
    revision: suggestion.revision,
    domain: suggestion.domain,
    action: suggestion.action,
    ...(suggestion.target === null ? {} : { targetAssetId: suggestion.target.assetId }),
    ...(suggestion.proposedAssetType === null
      ? {}
      : { proposedAssetType: suggestion.proposedAssetType }),
    ...(typeof suggestion.createValue?.["title"] === "string"
      ? { proposedTitle: suggestion.createValue["title"] }
      : {}),
    operations: suggestion.operations.map((operation) => {
      const before =
        suggestion.target?.entryRef === null && targetAsset !== undefined
          ? readPointer(targetAsset, operation.path)
          : { present: false as const };
      return {
        op: operation.op,
        path: operation.path,
        beforePresent: before.present,
        ...(before.present ? { beforeValue: before.value } : {}),
        ...(operation.op === "remove" ? {} : { afterValue: operation.value })
      };
    }),
    evidence: suggestion.evidence,
    epistemicStatus: suggestion.epistemicStatus,
    confidence: suggestion.confidence,
    reason: suggestion.reason
  };
}

function toIssueProps(issue: StoryReviewIssue): StoryAnalysisIssueProps {
  return {
    issueId: issue.issueId,
    revision: issue.revision,
    issueType: issue.issueType,
    status: issue.status,
    claims: issue.claims,
    affectedRefs: issue.affectedRefs
  };
}

function toPreviewProps(
  preview: StoryAnalysisApplicationPreviewDto
): StoryAnalysisApplicationPreviewProps {
  return {
    changeSetId: preview.changeSet.changeSetId,
    revision: preview.changeSet.revision,
    checksum: preview.changeSet.checksum,
    files: preview.changeSet.files.map((file) => ({
      relativePath: file.relativePath,
      ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
      ...(file.consistencyGroupId === undefined
        ? {}
        : { consistencyGroupId: file.consistencyGroupId }),
      valid: file.validation.valid,
      hunkCount: file.hunks.length
    })),
    operations: (preview.changeSet.operations ?? []).map((operation) => ({
      operationId: operation.operationId,
      kind: operation.kind,
      ...operationPath(operation),
      ...("consistencyGroupId" in operation && typeof operation.consistencyGroupId === "string"
        ? { consistencyGroupId: operation.consistencyGroupId }
        : {})
    }))
  };
}

function toResultProps(
  result: StoryAnalysisApplicationResultDto
): StoryAnalysisApplicationResultProps {
  return {
    applyBatchId: result.batch.applyBatchId,
    ...(result.recordSyncWarning === undefined
      ? {}
      : { recordSyncWarning: result.recordSyncWarning }),
    groups: result.batch.groups.map((group) => ({
      consistencyGroupId: group.consistencyGroupId,
      status: group.status,
      ...(group.versionGroup === undefined
        ? {}
        : { versionGroupId: group.versionGroup.versionGroupId }),
      suggestionIds: group.storyBibleReceipt?.suggestionIds ?? [],
      ...(group.error === undefined ? {} : { errorMessage: group.error.message })
    }))
  };
}

function chooseActiveRun(
  activeWorkflowRunId: string | undefined,
  summaries: StoryAnalysisReviewProps["summaries"]
): string | undefined {
  if (summaries.some((summary) => summary.workflowRunId === activeWorkflowRunId)) {
    return activeWorkflowRunId;
  }
  return (
    summaries.find((summary) => summary.pendingSuggestionCount > 0 || summary.openIssueCount > 0) ??
    summaries[0]
  )?.workflowRunId;
}

function selectedSuggestions(
  record: StoryAnalysisRecordDto,
  suggestionIds: readonly string[]
): StoryChangeSuggestion[] {
  const selected = new Set(suggestionIds);
  return record.storyAnalysis.records.filter(
    (candidate): candidate is StoryChangeSuggestion =>
      candidate.recordType === "change" && selected.has(candidate.suggestionId)
  );
}

function reconcileSelection(
  suggestionIds: readonly string[],
  record: StoryAnalysisRecordDto
): string[] {
  const applicable = new Set(
    record.storyAnalysis.records.flatMap((candidate) =>
      candidate.recordType === "change" &&
      (candidate.status === "pending" || candidate.status === "accepted")
        ? [candidate.suggestionId]
        : []
    )
  );
  return suggestionIds.filter((suggestionId) => applicable.has(suggestionId));
}

function findAsset(
  snapshot: StoryBibleSnapshot | undefined,
  assetId: string
): StoryBibleAsset | undefined {
  if (snapshot === undefined) return undefined;
  return [
    ...snapshot.characters,
    ...snapshot.worldAssets,
    ...(snapshot.outline === undefined ? [] : [snapshot.outline]),
    ...snapshot.foreshadows,
    ...(snapshot.timeline === undefined ? [] : [snapshot.timeline])
  ].find((asset) => asset.id === assetId);
}

function readPointer(
  source: unknown,
  pointer: string
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  if (!pointer.startsWith("/") || pointer.includes("\0")) return { present: false };
  let current = source;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return { present: false };
    current = current[segment];
  }
  return { present: true, value: current };
}

function operationPath(operation: unknown): { readonly relativePath?: string } {
  if (!isRecord(operation)) return {};
  const path =
    typeof operation["relativePath"] === "string"
      ? operation["relativePath"]
      : typeof operation["targetPath"] === "string"
        ? operation["targetPath"]
        : typeof operation["sourcePath"] === "string"
          ? operation["sourcePath"]
          : undefined;
  return path === undefined ? {} : { relativePath: path };
}

async function unwrap<T>(promise: Promise<Result<T, UnifiedError>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "资料分析操作失败，请重试。";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
