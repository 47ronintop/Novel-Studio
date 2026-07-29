import type {
  ForeshadowDetails,
  ForeshadowSourceRef,
  ForeshadowTrackingStatus
} from "@novel-studio/shared";
import { Plus, Trash2 } from "lucide-react";

import { STORY_BIBLE_FORESHADOW_STATUS_OPTIONS } from "./story-bible-foreshadow.js";
import type { StoryBibleChapterOption, StoryBibleEditorProps } from "./workspace-shell-types.js";

const PENDING_EVIDENCE_HASH = "0".repeat(64);

export function StoryBibleForeshadowEditor({ editor }: { readonly editor: StoryBibleEditorProps }) {
  if (editor.draft.kind !== "foreshadow") return null;

  const details = editor.draft.details;
  const sourceRefs = details.sourceRefs ?? [];
  const chapters = [...editor.chapterOptions].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id, "en-US")
  );
  const defaultEvidenceChapterId =
    chapters.find((chapter) => chapter.id === editor.currentChapterId)?.id ?? chapters[0]?.id;

  const updateDetails = (patch: Partial<ForeshadowDetails>) => {
    editor.onDraftChange("foreshadow", {
      details: {
        ...patch,
        trackingStatus: patch.trackingStatus ?? details.trackingStatus
      }
    });
  };
  const updateEvidence = (
    sourceIndex: number,
    patch: { readonly chapterId?: string; readonly excerpt?: string }
  ) => {
    updateDetails({
      sourceRefs: sourceRefs.map((sourceRef, index) =>
        index === sourceIndex ? ({ ...sourceRef, ...patch } as ForeshadowSourceRef) : sourceRef
      )
    });
  };

  return (
    <div className="ns-foreshadow-editor">
      <div className="ns-story-form-grid ns-story-form-grid-compact">
        <label className="ns-story-field">
          <span>标题</span>
          <input
            aria-label="伏笔标题"
            className="ns-search-input"
            onChange={(event) =>
              editor.onDraftChange("foreshadow", { title: event.currentTarget.value })
            }
            value={editor.draft.title}
          />
        </label>
        <label className="ns-story-field">
          <span>跟踪状态</span>
          <select
            aria-label="伏笔跟踪状态"
            onChange={(event) =>
              updateDetails({
                trackingStatus: event.currentTarget.value as ForeshadowTrackingStatus
              })
            }
            value={details.trackingStatus}
          >
            {STORY_BIBLE_FORESHADOW_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ns-story-field ns-story-field-wide">
          <span>摘要</span>
          <textarea
            aria-label="伏笔摘要"
            className="ns-story-textarea ns-story-textarea-compact"
            onChange={(event) =>
              editor.onDraftChange("foreshadow", { summary: event.currentTarget.value })
            }
            value={editor.draft.summary}
          />
        </label>

        <div className="ns-foreshadow-chapter-fields">
          <ForeshadowChapterSelect
            ariaLabel="埋设章节"
            chapters={chapters}
            onChange={(plantedChapterId) => updateDetails({ plantedChapterId })}
            value={details.plantedChapterId ?? ""}
          />
          <ForeshadowChapterSelect
            ariaLabel="计划回收章节"
            chapters={chapters}
            onChange={(plannedPayoffChapterId) => updateDetails({ plannedPayoffChapterId })}
            value={details.plannedPayoffChapterId ?? ""}
          />
          <ForeshadowChapterSelect
            ariaLabel="实际回收章节"
            chapters={chapters}
            onChange={(actualPayoffChapterId) => updateDetails({ actualPayoffChapterId })}
            required={details.trackingStatus === "paid-off"}
            value={details.actualPayoffChapterId ?? ""}
          />
        </div>

        <label className="ns-story-field ns-story-field-wide">
          <span>备注</span>
          <textarea
            aria-label="伏笔备注"
            className="ns-story-textarea ns-story-textarea-compact"
            onChange={(event) => updateDetails({ notes: event.currentTarget.value })}
            value={details.notes ?? ""}
          />
        </label>
        <label className="ns-story-field ns-story-field-wide">
          <span>关联资料 ID</span>
          <textarea
            aria-label="伏笔关联资料 ID"
            className="ns-story-textarea ns-story-textarea-compact"
            onChange={(event) =>
              editor.onDraftChange("foreshadow", {
                relatedEntityIds: splitLines(event.currentTarget.value)
              })
            }
            value={editor.draft.relatedEntityIds.join("\n")}
          />
        </label>
      </div>

      <section aria-label="伏笔原文证据" className="ns-foreshadow-evidence">
        <div className="ns-foreshadow-evidence-header">
          <div>
            <strong>原文证据</strong>
            <span>{sourceRefs.length} 条</span>
          </div>
          <button
            aria-label="添加原文证据"
            className="ns-icon-text-button"
            disabled={defaultEvidenceChapterId === undefined}
            onClick={() => {
              if (defaultEvidenceChapterId === undefined) return;
              updateDetails({
                sourceRefs: [
                  ...sourceRefs,
                  {
                    chapterId: defaultEvidenceChapterId,
                    excerpt: "",
                    excerptHash: PENDING_EVIDENCE_HASH
                  }
                ]
              });
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            添加证据
          </button>
        </div>

        {sourceRefs.length === 0 ? (
          <p className="ns-foreshadow-evidence-empty">暂无原文证据</p>
        ) : (
          <ol className="ns-foreshadow-evidence-list">
            {sourceRefs.map((sourceRef, sourceIndex) => (
              <li key={`${sourceIndex}:${sourceRef.chapterId}:${sourceRef.excerptHash}`}>
                <ForeshadowChapterSelect
                  ariaLabel={`证据 ${sourceIndex + 1} 章节`}
                  chapters={chapters}
                  onChange={(chapterId) => updateEvidence(sourceIndex, { chapterId })}
                  required
                  value={sourceRef.chapterId}
                />
                <label className="ns-story-field">
                  <span>原文片段</span>
                  <textarea
                    aria-label={`证据 ${sourceIndex + 1} 原文片段`}
                    className="ns-story-textarea ns-story-textarea-compact"
                    onChange={(event) =>
                      updateEvidence(sourceIndex, { excerpt: event.currentTarget.value })
                    }
                    value={sourceRef.excerpt}
                  />
                </label>
                <button
                  aria-label={`删除第 ${sourceIndex + 1} 条原文证据`}
                  className="ns-icon-button"
                  onClick={() =>
                    updateDetails({
                      sourceRefs: sourceRefs.filter((_sourceRef, index) => index !== sourceIndex)
                    })
                  }
                  title={`删除第 ${sourceIndex + 1} 条原文证据`}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <details className="ns-story-supplemental">
        <summary>补充设定</summary>
        <div className="ns-story-form-grid ns-story-form-grid-compact">
          <label className="ns-story-field">
            <span>资料状态</span>
            <select
              aria-label="伏笔资料状态"
              onChange={(event) =>
                editor.onDraftChange("foreshadow", {
                  status: event.currentTarget.value as StoryBibleEditorProps["draft"]["status"]
                })
              }
              value={editor.draft.status}
            >
              <option value="active">启用</option>
              <option value="draft">草稿</option>
              <option value="archived">归档</option>
              <option value="deleted">已删除</option>
            </select>
          </label>
          <label className="ns-story-field">
            <span>别名</span>
            <textarea
              aria-label="伏笔别名"
              className="ns-story-textarea ns-story-textarea-compact"
              onChange={(event) =>
                editor.onDraftChange("foreshadow", {
                  aliases: splitLines(event.currentTarget.value)
                })
              }
              value={editor.draft.aliases.join("\n")}
            />
          </label>
        </div>
      </details>
    </div>
  );
}

function ForeshadowChapterSelect({
  ariaLabel,
  chapters,
  onChange,
  required = false,
  value
}: {
  readonly ariaLabel: string;
  readonly chapters: readonly StoryBibleChapterOption[];
  readonly onChange: (chapterId: string) => void;
  readonly required?: boolean;
  readonly value: string;
}) {
  const missing = value.length > 0 && !chapters.some((chapter) => chapter.id === value);
  return (
    <label className="ns-story-field">
      <span>{ariaLabel}</span>
      <select
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.value)}
        required={required}
        value={value}
      >
        <option value="">未设置</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.order}. {chapter.title}
          </option>
        ))}
        {missing ? <option value={value}>{value}（章节已不存在）</option> : null}
      </select>
    </label>
  );
}

function splitLines(value: string): string[] {
  return value.length === 0 ? [] : value.replace(/\r\n?/gu, "\n").split("\n");
}
