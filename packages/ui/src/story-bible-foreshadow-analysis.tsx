import type { ForeshadowAnalysisCandidateDto } from "@novel-studio/application";
import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { storyBibleForeshadowStatusLabel } from "./story-bible-foreshadow.js";
import type {
  StoryBibleChapterOption,
  StoryBibleEditorEntry,
  StoryBibleForeshadowAnalysisState
} from "./workspace-shell-types.js";

export interface StoryBibleForeshadowAnalysisProps {
  readonly analysis: StoryBibleForeshadowAnalysisState;
  readonly chapterOptions: readonly StoryBibleChapterOption[];
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly onChapterToggle: (chapterId: string) => void;
  readonly onClose: () => void;
  readonly onStart: () => void;
}

export function StoryBibleForeshadowAnalysis({
  analysis,
  chapterOptions,
  entries,
  onChapterToggle,
  onClose,
  onStart
}: StoryBibleForeshadowAnalysisProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const open = analysis.status !== "closed";
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [analysis.status, open]);

  if (!open) return null;

  const chapters = [...chapterOptions].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  );
  const selected = new Set(analysis.selectedChapterIds);
  const selecting = analysis.status === "selecting" || analysis.status === "error";
  const analysisLabel =
    analysis.status === "review"
      ? "伏笔识别候选审查"
      : selecting
        ? "伏笔识别章节选择"
        : "伏笔识别进度";

  return (
    <section
      aria-label={analysisLabel}
      className="ns-foreshadow-analysis"
      data-status={analysis.status}
      id="ns-foreshadow-analysis"
    >
      <header className="ns-foreshadow-analysis-header">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            AI 识别伏笔
          </h2>
          <span aria-live="polite" role="status">
            {analysis.status === "review"
              ? `${analysis.result.candidates.length} 条候选`
              : `已选 ${analysis.selectedChapterIds.length} / 5 章`}
          </span>
        </div>
        <button
          aria-label="关闭伏笔识别"
          className="ns-icon-button"
          onClick={onClose}
          title="关闭伏笔识别"
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </header>

      {selecting ? (
        <>
          <div className="ns-foreshadow-analysis-chapters">
            {chapters.length === 0 ? (
              <p className="ns-foreshadow-analysis-empty">当前项目还没有可识别的已保存章节。</p>
            ) : (
              chapters.map((chapter) => {
                const checked = selected.has(chapter.id);
                return (
                  <label key={chapter.id}>
                    <input
                      aria-label={`选择章节：${chapter.title}`}
                      checked={checked}
                      disabled={!checked && selected.size >= 5}
                      onChange={() => onChapterToggle(chapter.id)}
                      type="checkbox"
                    />
                    <span>{`${chapter.order}. ${chapter.title}`}</span>
                  </label>
                );
              })
            )}
          </div>
          {analysis.status === "error" ? (
            <p className="ns-foreshadow-analysis-error" role="alert">
              {analysis.message}
            </p>
          ) : null}
          <div className="ns-foreshadow-analysis-actions">
            <button
              aria-label="开始识别伏笔"
              className="ns-icon-text-button ns-foreshadow-analysis-start"
              disabled={selected.size === 0}
              onClick={onStart}
              type="button"
            >
              开始识别
            </button>
          </div>
        </>
      ) : null}

      {analysis.status === "preparing" || analysis.status === "scanning" ? (
        <div className="ns-foreshadow-analysis-progress" role="status">
          <LoaderCircle aria-hidden="true" className="ns-spin" size={16} />
          <span>
            {analysis.status === "preparing" ? "正在保存所选的当前章节..." : "正在分析所选章节..."}
          </span>
        </div>
      ) : null}

      {analysis.status === "review" ? (
        analysis.result.candidates.length === 0 ? (
          <p className="ns-foreshadow-analysis-empty">未识别到需要记录的伏笔候选。</p>
        ) : (
          <ol className="ns-foreshadow-candidate-list">
            {analysis.result.candidates.map((candidate) => (
              <ForeshadowCandidate
                candidate={candidate}
                chapterOptions={chapters}
                entries={entries}
                key={candidate.candidateId}
              />
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

function ForeshadowCandidate({
  candidate,
  chapterOptions,
  entries
}: {
  readonly candidate: ForeshadowAnalysisCandidateDto;
  readonly chapterOptions: readonly StoryBibleChapterOption[];
  readonly entries: readonly StoryBibleEditorEntry[];
}) {
  const evidenceChapter = chapterOptions.find(
    (chapter) => chapter.id === candidate.evidence.chapterId
  );
  const suggestionRows = candidateSuggestionRows(candidate, chapterOptions, entries);

  return (
    <li data-candidate-kind={candidate.kind}>
      <div className="ns-foreshadow-candidate-heading">
        <strong>{candidateKindLabel(candidate.kind)}</strong>
        <span>{chapterLabel(evidenceChapter, candidate.evidence.chapterId)}</span>
      </div>
      <span className="ns-foreshadow-candidate-label">原文证据</span>
      <blockquote>{candidate.evidence.excerpt}</blockquote>
      <span className="ns-foreshadow-candidate-label">判断理由</span>
      <p className="ns-foreshadow-candidate-reason">{candidate.reason}</p>
      <dl className="ns-foreshadow-candidate-suggestion">
        {suggestionRows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
      {candidate.duplicateForeshadowIds.length === 0 ? null : (
        <p className="ns-foreshadow-candidate-duplicate">
          可能与已有伏笔重复：
          {candidate.duplicateForeshadowIds
            .map((id) => entries.find((entry) => entry.id === id)?.title ?? id)
            .join("、")}
        </p>
      )}
    </li>
  );
}

function candidateSuggestionRows(
  candidate: ForeshadowAnalysisCandidateDto,
  chapters: readonly StoryBibleChapterOption[],
  entries: readonly StoryBibleEditorEntry[]
): readonly { readonly label: string; readonly value: string }[] {
  if (candidate.kind === "new") {
    return compactRows([
      { label: "建议标题", value: candidate.suggested.title },
      { label: "建议摘要", value: candidate.suggested.summary },
      {
        label: "建议状态",
        value: storyBibleForeshadowStatusLabel(candidate.suggested.trackingStatus)
      },
      {
        label: "埋设章节",
        value: chapterLabelById(chapters, candidate.suggested.plantedChapterId)
      },
      candidate.suggested.plannedPayoffChapterId === undefined
        ? undefined
        : {
            label: "计划回收",
            value: chapterLabelById(chapters, candidate.suggested.plannedPayoffChapterId)
          },
      candidate.suggested.notes === undefined
        ? undefined
        : { label: "建议备注", value: candidate.suggested.notes },
      candidate.suggested.relatedEntityIds === undefined ||
      candidate.suggested.relatedEntityIds.length === 0
        ? undefined
        : { label: "关联资料", value: candidate.suggested.relatedEntityIds.join("、") }
    ]);
  }

  const target = entries.find((entry) => entry.id === candidate.targetForeshadowId);
  return compactRows([
    {
      label: "目标伏笔",
      value:
        target === undefined
          ? candidate.targetForeshadowId
          : `${target.title}（${candidate.targetForeshadowId}）`
    },
    {
      label: "建议状态",
      value: storyBibleForeshadowStatusLabel(candidate.suggested.trackingStatus)
    },
    candidate.kind === "payoff"
      ? {
          label: "实际回收",
          value: chapterLabelById(chapters, candidate.suggested.actualPayoffChapterId)
        }
      : undefined,
    candidate.suggested.summary === undefined
      ? undefined
      : { label: "建议摘要", value: candidate.suggested.summary },
    candidate.suggested.notes === undefined
      ? undefined
      : { label: "建议备注", value: candidate.suggested.notes }
  ]);
}

function compactRows<T>(rows: readonly (T | undefined)[]): readonly T[] {
  return rows.filter((row): row is T => row !== undefined);
}

function candidateKindLabel(kind: ForeshadowAnalysisCandidateDto["kind"]): string {
  switch (kind) {
    case "new":
      return "新伏笔";
    case "progress":
      return "推进";
    case "payoff":
      return "回收";
  }
}

function chapterLabelById(chapters: readonly StoryBibleChapterOption[], chapterId: string): string {
  return chapterLabel(
    chapters.find((chapter) => chapter.id === chapterId),
    chapterId
  );
}

function chapterLabel(chapter: StoryBibleChapterOption | undefined, fallbackId: string): string {
  return chapter === undefined ? fallbackId : `${chapter.order}. ${chapter.title}`;
}
