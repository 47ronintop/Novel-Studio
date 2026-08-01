import type {
  ChapterCompletionAnalysisDisposition,
  NovelStudioApi
} from "@novel-studio/application";
import type { ChapterStatus } from "@novel-studio/shared";
import type {
  ChapterCompletionFeedbackProps,
  ChapterEditorProps,
  ProjectWorkflowProps,
  StoryAnalysisReviewProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createStoryAnalysisBridge, type StoryAnalysisBridge } from "./story-analysis-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";

export interface StoryAnalysisWorkspaceOptions {
  readonly api: NovelStudioApi | undefined;
  readonly activeCreativeProjectId: string | undefined;
  readonly activeCreativeWorkspaceId: string | undefined;
  readonly activeChapterId: string | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly projectWorkflowBridge: ProjectWorkflowBridge | undefined;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly setProjectWorkflow: Dispatch<SetStateAction<ProjectWorkflowProps | undefined>>;
  readonly setStoryBible: Dispatch<SetStateAction<StoryBibleSummaryProps | undefined>>;
  readonly setStoryBibleEditor: Dispatch<SetStateAction<StoryBibleEditorProps | undefined>>;
}

export interface StoryAnalysisWorkspace {
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
  readonly onChapterStatusChange: (status: ChapterStatus) => void;
  readonly beforeNavigateToChapter: (chapterId: string) => Promise<boolean>;
  readonly beforeCreateChapter: () => Promise<boolean>;
}

/**
 * A renderer-local identity for asynchronous work.
 *
 * Project/workspace activation updates can render before React cleans up the
 * previous effect. Keeping a monotonically increasing revision lets every
 * continuation fail closed instead of publishing data from the former scope.
 */
interface StoryAnalysisScope {
  readonly projectId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly revision: number;
}

export function useStoryAnalysisWorkspace(
  options: StoryAnalysisWorkspaceOptions
): StoryAnalysisWorkspace {
  const {
    api,
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    activeChapterId,
    projectWorkflow,
    chapterBridge,
    chapterEditor,
    projectWorkflowBridge,
    storyBibleBridge,
    storyBibleEditor,
    setChapterEditor,
    setProjectWorkflow,
    setStoryBible,
    setStoryBibleEditor
  } = options;
  const [bridge] = useState(() =>
    api === undefined
      ? undefined
      : createStoryAnalysisBridge(
          api,
          storyBibleBridge === undefined
            ? {}
            : { getStoryBibleSnapshot: () => storyBibleBridge.getSnapshot() }
        )
  );
  const [review, setReview] = useState(() => bridge?.getProps());
  const bypassedTransitions = useRef(new Set<string>());
  const scheduledAnalysisChapters = useRef(new Set<string>());
  const scopeRef = useRef<StoryAnalysisScope>({
    projectId: activeCreativeProjectId,
    workspaceId: activeCreativeWorkspaceId,
    revision: 0
  });
  const previousScope = scopeRef.current;
  if (
    previousScope.projectId !== activeCreativeProjectId ||
    previousScope.workspaceId !== activeCreativeWorkspaceId
  ) {
    scopeRef.current = {
      projectId: activeCreativeProjectId,
      workspaceId: activeCreativeWorkspaceId,
      revision: previousScope.revision + 1
    };
    bypassedTransitions.current.clear();
    scheduledAnalysisChapters.current.clear();
  }

  useEffect(() => {
    if (bridge === undefined) return;
    const scope = scopeRef.current;
    if (activeCreativeProjectId === undefined) {
      setReview(bridge.clear());
      return;
    }
    let active = true;
    setReview(bridge.clear());
    const pending = bridge.loadOverview();
    setReview(bridge.getProps());
    void pending.then((next) => {
      if (active && scopeRef.current === scope) setReview(next);
    });
    return () => {
      active = false;
    };
  }, [activeCreativeProjectId, activeCreativeWorkspaceId, bridge]);

  const runAction = useCallback(
    (action: (target: StoryAnalysisBridge) => Promise<StoryAnalysisReviewProps>) => {
      if (bridge === undefined) return;
      const scope = scopeRef.current;
      const pending = action(bridge);
      if (scopeRef.current === scope) setReview(bridge.getProps());
      void pending.then((next) => {
        if (scopeRef.current === scope) setReview(next);
      });
    },
    [bridge]
  );
  const update = useCallback(
    (action: (target: StoryAnalysisBridge) => StoryAnalysisReviewProps) => {
      if (bridge === undefined) return;
      setReview(action(bridge));
    },
    [bridge]
  );
  const applyPrepared = useCallback(() => {
    if (bridge === undefined) return;
    const scope = scopeRef.current;
    const pending = bridge.applyPrepared();
    if (scopeRef.current === scope) setReview(bridge.getProps());
    void pending.then(async (next) => {
      if (scopeRef.current !== scope) return;
      setReview(next);
      if (
        next.result === undefined ||
        storyBibleBridge === undefined ||
        scope.workspaceId === undefined ||
        storyBibleBridge.getSnapshotBinding(scope.workspaceId) === undefined ||
        !next.result.groups.some(
          (group) => group.status === "applied" || group.status === "partial_failure"
        )
      ) {
        return;
      }
      const editor = await storyBibleBridge.handleStoryAnalysisExternalUpdate({
        projectId: scope.workspaceId,
        updateId: next.result.applyBatchId
      });
      if (scopeRef.current !== scope) return;
      setStoryBible(storyBibleBridge.getProps());
      setStoryBibleEditor(editor);
    });
  }, [bridge, setStoryBible, setStoryBibleEditor, storyBibleBridge]);
  const analyzeCompletedChapter = useCallback(
    (chapterId: string) => {
      if (bridge === undefined) return;
      const scope = scopeRef.current;
      setChapterEditor((current) =>
        current?.chapter.frontmatter.id !== chapterId
          ? current
          : {
              ...current,
              completionFeedback: {
                kind: "info",
                message: "正在分析本章产生的资料变化。"
              }
            }
      );
      const pending = bridge.analyze(chapterId);
      if (scopeRef.current === scope) setReview(bridge.getProps());
      void pending.then(
        (next) => {
          if (scopeRef.current !== scope) return;
          setReview(next);
          setChapterEditor((current) =>
            current?.chapter.frontmatter.id !== chapterId
              ? current
              : {
                  ...current,
                  completionFeedback:
                    next.status === "error"
                      ? {
                          kind: "error",
                          message: next.feedback?.message ?? "资料分析失败，章节已正常保存。"
                        }
                      : {
                          kind: "info",
                          message: "资料分析已完成，请审查更新建议。"
                        }
                }
          );
        },
        (error: unknown) => {
          if (scopeRef.current !== scope) return;
          setChapterEditor((current) =>
            current?.chapter.frontmatter.id !== chapterId
              ? current
              : {
                  ...current,
                  completionFeedback: {
                    kind: "error",
                    message: `${chapterStatusErrorMessage(error)} 章节已正常保存。`
                  }
                }
          );
        }
      );
    },
    [bridge, setChapterEditor]
  );
  const onChapterStatusChange = useCallback(
    (status: ChapterStatus) => {
      if (chapterBridge === undefined) return;
      const scope = scopeRef.current;
      const chapterId = chapterEditor?.chapter.frontmatter.id;
      // Mark this before the status save starts. A very fast background analysis
      // can publish its completion event before saveWithStatus resolves; the
      // event clears this marker, and the later "scheduled" disposition must
      // not re-add it.
      if (status === "done" && chapterId !== undefined) {
        scheduledAnalysisChapters.current.add(chapterId);
      }
      setChapterEditor((current) => {
        if (current === undefined) return current;
        const next = { ...current };
        delete next.completionFeedback;
        return { ...next, statusBusy: true, saveStatus: "Saving" };
      });
      void chapterBridge.saveWithStatus(status).then(
        async ({ editor, completionAnalysis }) => {
          if (scopeRef.current !== scope) return;
          if (
            status === "done" &&
            chapterId !== undefined &&
            completionAnalysis.status !== "scheduled"
          ) {
            scheduledAnalysisChapters.current.delete(chapterId);
          }
          const completionFeedback = chapterCompletionFeedback(
            completionAnalysis,
            analyzeCompletedChapter
          );
          setChapterEditor((current) =>
            chapterId !== undefined && current?.chapter.frontmatter.id !== chapterId
              ? current
              : {
                  ...editor,
                  statusBusy: false,
                  ...(completionFeedback === undefined ? {} : { completionFeedback })
                }
          );
          if (
            projectWorkflowBridge !== undefined &&
            activeCreativeProjectId !== undefined &&
            chapterId === editor.chapter.frontmatter.id
          ) {
            const workflow = await projectWorkflowBridge.loadActiveProject(activeCreativeProjectId);
            if (scopeRef.current !== scope) return;
            setProjectWorkflow(workflow);
          }
        },
        (error: unknown) => {
          if (scopeRef.current !== scope) return;
          if (status === "done" && chapterId !== undefined) {
            scheduledAnalysisChapters.current.delete(chapterId);
          }
          setChapterEditor((current) =>
            current === undefined || current.chapter.frontmatter.id !== chapterId
              ? current
              : {
                  ...current,
                  statusBusy: false,
                  saveStatus: "Unsaved",
                  completionFeedback: {
                    kind: "error",
                    message: chapterStatusErrorMessage(error)
                  }
                }
          );
        }
      );
    },
    [
      activeCreativeProjectId,
      analyzeCompletedChapter,
      chapterBridge,
      chapterEditor?.chapter.frontmatter.id,
      projectWorkflowBridge,
      setChapterEditor,
      setProjectWorkflow
    ]
  );

  const confirmOutstandingReview = useCallback(
    async (sourceChapterId: string, targetKey: string): Promise<boolean> => {
      if (bridge === undefined || bypassedTransitions.current.has(targetKey)) return true;
      const scope = scopeRef.current;
      try {
        if (
          !(await bridge.hasOutstandingReviewForChapter(sourceChapterId, {
            analysisScheduled: scheduledAnalysisChapters.current.has(sourceChapterId)
          }))
        ) {
          return true;
        }
      } catch {
        // The reminder must never block writing when its read-only check is unavailable.
        return true;
      }
      if (scopeRef.current !== scope) return true;
      const proceed = window.confirm(
        "上一章还有资料更新建议未确认写入。继续进入下一章时，AI 可能使用旧资料。是否仍然继续？取消可先到故事资料的“更新建议”中审查。"
      );
      if (proceed) bypassedTransitions.current.add(targetKey);
      return proceed;
    },
    [bridge]
  );

  useEffect(() => {
    if (api === undefined || bridge === undefined || activeCreativeProjectId === undefined) return;
    const scope = scopeRef.current;
    let active = true;
    const unsubscribe = api.storyAnalysis.onCompletion((event) => {
      if (!active || scopeRef.current !== scope || event.projectId !== scope.projectId) {
        return;
      }
      if (event.trigger === "chapter_completed") {
        scheduledAnalysisChapters.current.delete(event.chapterId);
      }
      const pending = bridge.loadOverview();
      setReview(bridge.getProps());
      void pending.then(async (next) => {
        if (!active || scopeRef.current !== scope) return;
        setReview(next);
        const summary = next.summaries.find(
          (candidate) => candidate.workflowRunId === event.workflowRunId
        );
        setChapterEditor((current) =>
          current?.chapter.frontmatter.id !== event.chapterId
            ? current
            : {
                ...current,
                completionFeedback:
                  event.workflowStatus === "failed" || next.status === "error"
                    ? {
                        kind: "error",
                        message: "资料分析已结束，但结果需要检查；章节已正常保存。"
                      }
                    : event.storyBibleChanged
                      ? {
                          kind: "info",
                          message: "资料分析已完成，故事资料有后台变更，请查看资料与恢复状态。"
                        }
                      : (summary?.pendingSuggestionCount ?? 0) + (summary?.openIssueCount ?? 0) > 0
                        ? {
                            kind: "info",
                            message: `资料分析已完成，发现 ${(summary?.pendingSuggestionCount ?? 0) + (summary?.openIssueCount ?? 0)} 条待审查更新。`
                          }
                        : {
                            kind: "info",
                            message: "资料分析已完成，未发现待处理的资料更新。"
                          }
              }
        );
        if (
          !event.storyBibleChanged ||
          storyBibleBridge === undefined ||
          scope.workspaceId === undefined ||
          storyBibleBridge.getSnapshotBinding(scope.workspaceId) === undefined
        ) {
          return;
        }
        const editor = await storyBibleBridge.handleStoryAnalysisExternalUpdate({
          projectId: scope.workspaceId,
          updateId: event.workflowRunId
        });
        if (!active || scopeRef.current !== scope) return;
        setStoryBible(storyBibleBridge.getProps());
        setStoryBibleEditor(editor);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    api,
    bridge,
    setChapterEditor,
    setStoryBible,
    setStoryBibleEditor,
    storyBibleBridge
  ]);

  const beforeNavigateToChapter = useCallback(
    async (targetChapterId: string): Promise<boolean> => {
      if (projectWorkflow === undefined || projectWorkflow.activeChapterId === undefined)
        return true;
      const chapters = [...projectWorkflow.chapters].sort(
        (left, right) => left.order - right.order || left.id.localeCompare(right.id, "en")
      );
      const current = chapters.find((chapter) => chapter.id === projectWorkflow.activeChapterId);
      const targetIndex = chapters.findIndex((chapter) => chapter.id === targetChapterId);
      const target = targetIndex < 0 ? undefined : chapters[targetIndex];
      if (
        current === undefined ||
        target === undefined ||
        targetIndex <= 0 ||
        target.order <= current.order
      ) {
        return true;
      }
      const previous = [...chapters.slice(0, targetIndex)]
        .reverse()
        .find((chapter) => chapter.status === "done");
      if (previous === undefined || previous.status !== "done") return true;
      return confirmOutstandingReview(previous.id, `${previous.id}->${targetChapterId}`);
    },
    [confirmOutstandingReview, projectWorkflow]
  );

  const beforeCreateChapter = useCallback(async (): Promise<boolean> => {
    if (projectWorkflow === undefined) return true;
    const last = [...projectWorkflow.chapters]
      .sort((left, right) => right.order - left.order || right.id.localeCompare(left.id, "en"))
      .find((chapter) => chapter.status === "done");
    if (last === undefined || last.status !== "done") return true;
    return confirmOutstandingReview(last.id, `${last.id}->new`);
  }, [confirmOutstandingReview, projectWorkflow]);

  const interactiveStoryBibleEditor =
    storyBibleEditor === undefined || review === undefined
      ? storyBibleEditor
      : {
          ...storyBibleEditor,
          analysisReview: {
            ...review,
            onOpen: () => runAction((target) => target.open()),
            onClose: () => update((target) => target.close()),
            onRunSelect: (workflowRunId) => runAction((target) => target.selectRun(workflowRunId)),
            onFiltersChange: (filters) => update((target) => target.updateFilters(filters)),
            onSuggestionToggle: (suggestionId) =>
              update((target) => target.toggleSuggestion(suggestionId)),
            onAcceptSelected: () => runAction((target) => target.acceptSelected()),
            onRejectSelected: () => runAction((target) => target.rejectSelected()),
            onPrepareSelected: () => runAction((target) => target.prepareSelected()),
            onApplyPrepared: applyPrepared,
            onRefreshStaleness: () => runAction((target) => target.refreshStaleness()),
            onResolveIssue: (issueId, decision) =>
              runAction((target) => target.resolveIssue(issueId, decision)),
            onDismissIssue: (issueId, reason) =>
              runAction((target) => target.dismissIssue(issueId, reason)),
            onReanalyze: () =>
              runAction((target) =>
                target.analyze(
                  review.activeChapterId ?? activeChapterId ?? chapterEditor?.chapter.frontmatter.id
                )
              ),
            onCompletionModeChange: (mode) =>
              runAction((target) => target.saveCompletionMode(mode)),
            onMaintenanceModeChange: (mode) =>
              runAction((target) => target.saveMaintenanceMode(mode))
          } satisfies StoryAnalysisReviewProps
        };

  return {
    storyBibleEditor: interactiveStoryBibleEditor,
    onChapterStatusChange,
    beforeNavigateToChapter,
    beforeCreateChapter
  };
}

export function chapterCompletionFeedback(
  disposition: ChapterCompletionAnalysisDisposition,
  onAnalyze: (chapterId: string) => void
): ChapterCompletionFeedbackProps | undefined {
  switch (disposition.status) {
    case "not-triggered":
      return undefined;
    case "disabled":
      return {
        kind: "info",
        message: "章节已完成，章后资料分析当前已关闭。"
      };
    case "prompt":
      return {
        kind: "info",
        message: "章节已完成，可以分析本章产生的资料变化。",
        action: {
          label: "立即分析",
          onInvoke: () => onAnalyze(disposition.chapterId)
        }
      };
    case "scheduled":
      return {
        kind: "info",
        message: "章节已完成，资料分析已在后台启动。"
      };
    case "unavailable":
      return {
        kind: "error",
        message: `章节已保存，但资料分析暂不可用（${disposition.code}）。`
      };
  }
}

export function chapterStatusErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "章节状态保存失败，请重试。";
}
