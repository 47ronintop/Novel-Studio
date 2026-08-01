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
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import { createStoryAnalysisBridge, type StoryAnalysisBridge } from "./story-analysis-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";

export interface StoryAnalysisWorkspaceOptions {
  readonly api: NovelStudioApi | undefined;
  readonly activeCreativeProjectId: string | undefined;
  readonly activeCreativeWorkspaceId: string | undefined;
  readonly activeChapterId: string | undefined;
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
}

export function useStoryAnalysisWorkspace(
  options: StoryAnalysisWorkspaceOptions
): StoryAnalysisWorkspace {
  const {
    api,
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    activeChapterId,
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

  useEffect(() => {
    if (bridge === undefined) return;
    if (activeCreativeProjectId === undefined) {
      setReview(bridge.clear());
      return;
    }
    let active = true;
    setReview(bridge.clear());
    const pending = bridge.loadOverview();
    setReview(bridge.getProps());
    void pending.then((next) => {
      if (active) setReview(next);
    });
    return () => {
      active = false;
    };
  }, [activeCreativeProjectId, bridge]);

  const runAction = useCallback(
    (action: (target: StoryAnalysisBridge) => Promise<StoryAnalysisReviewProps>) => {
      if (bridge === undefined) return;
      const pending = action(bridge);
      setReview(bridge.getProps());
      void pending.then(setReview);
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
    const pending = bridge.applyPrepared();
    setReview(bridge.getProps());
    void pending.then(async (next) => {
      setReview(next);
      if (
        next.result === undefined ||
        storyBibleBridge === undefined ||
        activeCreativeWorkspaceId === undefined
      ) {
        return;
      }
      const summary = await storyBibleBridge.load(activeCreativeWorkspaceId);
      setStoryBible(summary);
      setStoryBibleEditor(storyBibleBridge.getEditorProps());
    });
  }, [activeCreativeWorkspaceId, bridge, setStoryBible, setStoryBibleEditor, storyBibleBridge]);
  const analyzeCompletedChapter = useCallback(
    (chapterId: string) => {
      if (bridge === undefined) return;
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
      setReview(bridge.getProps());
      void pending.then(
        (next) => {
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
      const chapterId = chapterEditor?.chapter.frontmatter.id;
      setChapterEditor((current) => {
        if (current === undefined) return current;
        const next = { ...current };
        delete next.completionFeedback;
        return { ...next, statusBusy: true, saveStatus: "Saving" };
      });
      void chapterBridge.saveWithStatus(status).then(
        async ({ editor, completionAnalysis }) => {
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
            setProjectWorkflow(
              await projectWorkflowBridge.loadActiveProject(activeCreativeProjectId)
            );
          }
        },
        (error: unknown) => {
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
            onCompletionModeChange: (mode) => runAction((target) => target.saveCompletionMode(mode))
          } satisfies StoryAnalysisReviewProps
        };

  return {
    storyBibleEditor: interactiveStoryBibleEditor,
    onChapterStatusChange
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
