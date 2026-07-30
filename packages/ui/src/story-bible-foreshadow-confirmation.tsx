import type { ForeshadowTrackingStatus } from "@novel-studio/shared";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  RotateCcw,
  XCircle
} from "lucide-react";

import { storyBibleForeshadowStatusLabel } from "./story-bible-foreshadow.js";
import type {
  StoryBibleChapterOption,
  StoryBibleForeshadowChangeItem,
  StoryBibleForeshadowFieldChange,
  StoryBibleForeshadowReviewState
} from "./workspace-shell-types.js";

type ConfirmationReview = Exclude<
  StoryBibleForeshadowReviewState,
  { readonly step: "candidates" } | { readonly step: "preparing" }
>;

export interface StoryBibleForeshadowConfirmationProps {
  readonly chapterOptions: readonly StoryBibleChapterOption[];
  readonly onBack: () => void;
  readonly onConfirm: () => void;
  readonly onRetryFailed: () => void;
  readonly review: ConfirmationReview;
}

export function StoryBibleForeshadowConfirmation({
  chapterOptions,
  onBack,
  onConfirm,
  onRetryFailed,
  review
}: StoryBibleForeshadowConfirmationProps) {
  const applying = review.step === "applying";
  const failedCount = review.changes.filter((change) => change.status === "failed").length;

  return (
    <div className="ns-foreshadow-confirmation" data-review-step={review.step}>
      <ol aria-label="伏笔保存变更" className="ns-foreshadow-change-list">
        {review.changes.map((change) => (
          <ForeshadowChange change={change} chapterOptions={chapterOptions} key={change.changeId} />
        ))}
      </ol>

      {review.step === "results" && review.message !== undefined ? (
        <p className="ns-foreshadow-analysis-error">{review.message}</p>
      ) : null}

      {review.step === "confirmation" ? (
        <div className="ns-foreshadow-confirmation-actions">
          <button
            aria-label="返回伏笔候选"
            className="ns-icon-text-button"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={14} />
            返回候选
          </button>
          <button
            aria-label="确认保存伏笔变更"
            className="ns-icon-text-button ns-foreshadow-confirm"
            onClick={onConfirm}
            type="button"
          >
            <Check aria-hidden="true" size={14} />
            确认保存
          </button>
        </div>
      ) : review.step === "results" && failedCount > 0 ? (
        <div className="ns-foreshadow-confirmation-actions">
          <span>{`${failedCount} 项保存失败`}</span>
          <button
            aria-label="仅重试失败的伏笔变更"
            className="ns-icon-text-button"
            onClick={onRetryFailed}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} />
            仅重试失败项
          </button>
        </div>
      ) : applying ? (
        <p className="ns-foreshadow-confirmation-progress">
          <LoaderCircle aria-hidden="true" className="ns-spin" size={14} />
          正在逐项保存，请稍候...
        </p>
      ) : null}
    </div>
  );
}

function ForeshadowChange({
  change,
  chapterOptions
}: {
  readonly change: StoryBibleForeshadowChangeItem;
  readonly chapterOptions: readonly StoryBibleChapterOption[];
}) {
  return (
    <li data-change-id={change.changeId} data-change-status={change.status}>
      <div className="ns-foreshadow-change-heading">
        <div>
          <strong>
            {change.operation === "create" ? `新建《${change.title}》` : `更新《${change.title}》`}
          </strong>
          {change.sourceCandidateIds.length > 1 ? (
            <span>{`合并 ${change.sourceCandidateIds.length} 条候选`}</span>
          ) : null}
        </div>
        <span className="ns-foreshadow-change-status">
          <ChangeStatusIcon status={change.status} />
          {changeStatusLabel(change.status)}
        </span>
      </div>

      {change.fields.length === 0 ? null : (
        <dl className="ns-foreshadow-change-fields">
          {change.fields.map((field) => (
            <ForeshadowFieldChange
              chapterOptions={chapterOptions}
              change={field}
              key={field.field}
            />
          ))}
        </dl>
      )}

      {change.evidenceAdditions.length === 0 ? null : (
        <div className="ns-foreshadow-change-evidence">
          <span>新增原文证据</span>
          <ol>
            {change.evidenceAdditions.map((evidence) => (
              <li key={`${evidence.chapterId}:${evidence.excerptHash}`}>
                <strong>{chapterLabel(chapterOptions, evidence.chapterId)}</strong>
                <blockquote>{evidence.excerpt}</blockquote>
              </li>
            ))}
          </ol>
        </div>
      )}

      {change.status === "failed" && change.errorMessage !== undefined ? (
        <p className="ns-foreshadow-change-error">{change.errorMessage}</p>
      ) : null}
    </li>
  );
}

function ForeshadowFieldChange({
  change,
  chapterOptions
}: {
  readonly change: StoryBibleForeshadowFieldChange;
  readonly chapterOptions: readonly StoryBibleChapterOption[];
}) {
  return (
    <div>
      <dt>{fieldLabel(change.field)}</dt>
      <dd>
        <span>
          <small>原值</small>
          <span>{formatFieldValue(change.field, change.before, chapterOptions)}</span>
        </span>
        <ArrowRight aria-hidden="true" size={13} />
        <span>
          <small>新值</small>
          <span>{formatFieldValue(change.field, change.after, chapterOptions)}</span>
        </span>
      </dd>
    </div>
  );
}

function ChangeStatusIcon({
  status
}: {
  readonly status: StoryBibleForeshadowChangeItem["status"];
}) {
  switch (status) {
    case "pending":
      return <Clock3 aria-hidden="true" size={13} />;
    case "applying":
      return <LoaderCircle aria-hidden="true" className="ns-spin" size={13} />;
    case "succeeded":
      return <CheckCircle2 aria-hidden="true" size={13} />;
    case "failed":
      return <XCircle aria-hidden="true" size={13} />;
  }
}

function changeStatusLabel(status: StoryBibleForeshadowChangeItem["status"]): string {
  switch (status) {
    case "pending":
      return "待保存";
    case "applying":
      return "保存中";
    case "succeeded":
      return "已保存";
    case "failed":
      return "保存失败";
  }
}

function fieldLabel(field: StoryBibleForeshadowFieldChange["field"]): string {
  switch (field) {
    case "title":
      return "标题";
    case "summary":
      return "摘要";
    case "trackingStatus":
      return "跟踪状态";
    case "plantedChapterId":
      return "埋设章节";
    case "plannedPayoffChapterId":
      return "计划回收";
    case "actualPayoffChapterId":
      return "实际回收";
    case "notes":
      return "备注";
    case "relatedEntityIds":
      return "关联资料";
  }
}

function formatFieldValue(
  field: StoryBibleForeshadowFieldChange["field"],
  value: string | undefined,
  chapterOptions: readonly StoryBibleChapterOption[]
): string {
  if (value === undefined) return "未设置";
  if (value.length === 0) return "（空）";
  if (field === "trackingStatus") {
    return storyBibleForeshadowStatusLabel(value as ForeshadowTrackingStatus);
  }
  if (
    field === "plantedChapterId" ||
    field === "plannedPayoffChapterId" ||
    field === "actualPayoffChapterId"
  ) {
    return chapterLabel(chapterOptions, value);
  }
  return value;
}

function chapterLabel(chapters: readonly StoryBibleChapterOption[], chapterId: string): string {
  const chapter = chapters.find((item) => item.id === chapterId);
  return chapter === undefined ? chapterId : `${chapter.order}. ${chapter.title}`;
}
