import { AlertTriangle, CheckCircle2, FileText, RotateCcw } from "lucide-react";

export interface ChangeSetReviewModel {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly status: string;
  readonly files: readonly ChangeSetReviewFile[];
}

export interface ChangeSetReviewFile {
  readonly relativePath: string;
  readonly assetType: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly selected: boolean;
  readonly validation: ChangeSetReviewValidation;
  readonly hunks: readonly ChangeSetReviewHunk[];
}

export interface ChangeSetReviewValidation {
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface ChangeSetReviewHunk {
  readonly hunkId: string;
  readonly label: string;
  readonly baseText: string;
  readonly candidateText: string;
  readonly baseRange: { readonly start: number; readonly end: number };
  readonly candidateRange: { readonly start: number; readonly end: number };
  readonly selected: boolean;
  readonly additions: number;
  readonly deletions: number;
}

export interface ChangeSetSelection {
  readonly files: readonly ChangeSetFileSelection[];
}

export interface ChangeSetFileSelection {
  readonly relativePath: string;
  readonly selected: boolean;
  readonly selectedHunkIds?: readonly string[];
}

export interface ChangeSetReviewProps {
  readonly changeSet: ChangeSetReviewModel;
  readonly runRevision: number;
  readonly applying: boolean;
  readonly stale: boolean;
  readonly selectionPending: boolean;
  readonly baseHashConflictPaths: readonly string[];
  readonly dirtyTargetPaths: readonly string[];
  readonly open?: boolean;
  readonly onOpen?: () => void;
  readonly onSelectionChange: (selection: ChangeSetSelection) => void;
  readonly onApply: () => void;
  readonly onReject: () => void;
  readonly onReturn: () => void;
  readonly canUndoRun?: boolean;
  readonly onUndoRun?: () => void;
}

export type RollbackReviewDecision = "keep_current" | "restore_baseline";
export type RollbackReviewFileStatus =
  | "ready"
  | "conflict"
  | "stale"
  | "failed"
  | "completed"
  | "kept";

export interface RollbackReviewModel {
  readonly schemaVersion: "1.0";
  readonly reviewId: string;
  readonly runId: string;
  readonly status: "pending" | "partial_failure" | "completed";
  readonly sourceVersionGroupIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly processedCommandIds: readonly string[];
  readonly files: readonly RollbackReviewFile[];
}

export interface RollbackReviewFile {
  readonly relativePath: string;
  readonly assetType: string;
  readonly baselineContent: string;
  readonly baselineHistoryContent?: string;
  readonly baselineChecksum: string;
  readonly baselineVersionId: string;
  readonly runLastWriteContent: string;
  readonly runLastWriteHistoryContent?: string;
  readonly runLastWriteChecksum: string;
  readonly reviewedCurrentContent: string;
  readonly reviewedCurrentHistoryContent?: string;
  readonly reviewedEditorChecksum?: string;
  readonly reviewedCurrentChecksum: string;
  readonly diff: {
    readonly currentToLastWrite: string;
    readonly currentToBaseline: string;
    readonly lastWriteToBaseline: string;
  };
  readonly decision?: RollbackReviewDecision;
  readonly status: RollbackReviewFileStatus;
  readonly snapshotVersionId?: string;
  readonly errorCode?: string;
}

export interface RollbackReviewProps {
  readonly review: RollbackReviewModel;
  readonly applying: boolean;
  readonly open?: boolean;
  readonly onOpen?: () => void;
  readonly decisions: Readonly<Record<string, RollbackReviewDecision>>;
  readonly onDecisionChange: (relativePath: string, decision: RollbackReviewDecision) => void;
  readonly onApply: () => void;
  readonly onRetryFailed: () => void;
  readonly onReturn: () => void;
}

export function ChangeSetReview({ review }: { readonly review: ChangeSetReviewProps }) {
  const totals = changeSetTotals(review.changeSet);
  const hasConflict = review.baseHashConflictPaths.length > 0;
  const hasInvalidFile = review.changeSet.files.some((file) => !file.validation.valid);
  const written = review.changeSet.status === "applied";

  return (
    <section
      className="ns-change-set-summary"
      aria-label="Change Set 摘要"
      onClick={review.onOpen}
      onKeyDown={(event) => {
        if (review.onOpen !== undefined && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          review.onOpen();
        }
      }}
      role={review.onOpen === undefined ? undefined : "button"}
      tabIndex={review.onOpen === undefined ? undefined : 0}
    >
      <header className="ns-change-set-summary-header">
        <span className="ns-change-set-state">{written ? "已写入" : "尚未写入"}</span>
        <span>v{review.changeSet.revision}</span>
      </header>
      <div className="ns-change-set-summary-stats">
        <span>{review.changeSet.files.length} 个文件</span>
        <span className="ns-diff-addition">+{totals.additions}</span>
        <span className="ns-diff-deletion">-{totals.deletions}</span>
      </div>
      <code className="ns-change-set-checksum">{review.changeSet.checksum}</code>
      <ul className="ns-change-set-summary-files">
        {review.changeSet.files.map((file) => (
          <li key={file.relativePath}>
            <FileText aria-hidden="true" size={13} />
            <span>{file.relativePath}</span>
            <span>{file.validation.valid ? "校验通过" : "校验失败"}</span>
          </li>
        ))}
      </ul>
      {hasConflict ? (
        <p className="ns-change-set-alert" role="status">
          <AlertTriangle aria-hidden="true" size={14} />
          Base hash 冲突
        </p>
      ) : hasInvalidFile ? (
        <p className="ns-change-set-alert" role="status">
          <AlertTriangle aria-hidden="true" size={14} />
          校验失败
        </p>
      ) : (
        <p className="ns-change-set-valid">
          <CheckCircle2 aria-hidden="true" size={14} />
          校验通过
        </p>
      )}
    </section>
  );
}

export function RollbackReview({ review }: { readonly review: RollbackReviewProps }) {
  const unresolved = review.review.files.filter((file) =>
    ["ready", "conflict", "stale", "failed"].includes(file.status)
  );
  const failed = review.review.files.some((file) => file.status === "failed");
  const canApply =
    !review.applying &&
    unresolved.some(
      (file) =>
        review.decisions[file.relativePath] !== undefined ||
        (file.decision !== undefined && file.status !== "failed")
    );

  return (
    <section className="ns-rollback-review" aria-label="运行撤销冲突审阅">
      <header className="ns-rollback-review-header">
        <div>
          <strong>撤销本次运行</strong>
          <span>检测到运行后的人工编辑。逐文件确认，当前内容不会被静默覆盖。</span>
        </div>
        <span data-rollback-review-status={review.review.status}>
          {rollbackReviewStatusLabel(review.review.status)}
        </span>
      </header>

      <div className="ns-rollback-review-files">
        {review.review.files.map((file) => {
          const decision = review.decisions[file.relativePath] ?? file.decision;
          const resolved = file.status === "completed" || file.status === "kept";
          return (
            <section
              className="ns-rollback-review-file"
              data-status={file.status}
              key={file.relativePath}
            >
              <div className="ns-rollback-review-file-header">
                <div>
                  <FileText aria-hidden="true" size={14} />
                  <strong>{file.relativePath}</strong>
                </div>
                <span>{rollbackFileStatusLabel(file.status)}</span>
              </div>
              {file.errorCode === undefined ? null : (
                <p className="ns-rollback-review-error" role="status">
                  {file.errorCode}
                </p>
              )}
              <div className="ns-rollback-comparison">
                <RollbackContent
                  label="当前内容"
                  content={file.reviewedCurrentHistoryContent ?? file.reviewedCurrentContent}
                />
                <RollbackContent
                  label="AI 最后写入"
                  content={file.runLastWriteHistoryContent ?? file.runLastWriteContent}
                />
                <RollbackContent
                  label="运行前基线"
                  content={file.baselineHistoryContent ?? file.baselineContent}
                />
              </div>
              {resolved ? null : (
                <fieldset className="ns-rollback-decisions" disabled={review.applying}>
                  <legend>此文件如何处理</legend>
                  <label>
                    <input
                      checked={decision === "keep_current"}
                      name={`rollback-${review.review.reviewId}-${file.relativePath}`}
                      onChange={() => review.onDecisionChange(file.relativePath, "keep_current")}
                      type="radio"
                    />
                    <span>保留当前</span>
                  </label>
                  <label>
                    <input
                      checked={decision === "restore_baseline"}
                      name={`rollback-${review.review.reviewId}-${file.relativePath}`}
                      onChange={() =>
                        review.onDecisionChange(file.relativePath, "restore_baseline")
                      }
                      type="radio"
                    />
                    <span>恢复运行前</span>
                  </label>
                </fieldset>
              )}
            </section>
          );
        })}
      </div>

      <footer className="ns-rollback-review-actions">
        <button className="ns-ai-secondary-button" onClick={review.onReturn} type="button">
          返回对话
        </button>
        {failed ? (
          <button
            className="ns-ai-secondary-button"
            disabled={review.applying}
            onClick={review.onRetryFailed}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
            仅重试失败项
          </button>
        ) : null}
        <button
          className="ns-ai-send-button"
          disabled={!canApply}
          onClick={review.onApply}
          type="button"
        >
          应用所选恢复
        </button>
      </footer>
    </section>
  );
}

function RollbackContent({ label, content }: { readonly label: string; readonly content: string }) {
  return (
    <div className="ns-rollback-content">
      <span>{label}</span>
      <pre>{content}</pre>
    </div>
  );
}

function rollbackReviewStatusLabel(status: RollbackReviewModel["status"]): string {
  if (status === "completed") return "已解决";
  if (status === "partial_failure") return "部分失败";
  return "等待决定";
}

function rollbackFileStatusLabel(status: RollbackReviewFileStatus): string {
  switch (status) {
    case "ready":
      return "待恢复";
    case "conflict":
      return "冲突";
    case "stale":
      return "已变化";
    case "failed":
      return "失败";
    case "completed":
      return "已恢复";
    case "kept":
      return "已保留";
  }
}

export function changeSetTotals(changeSet: ChangeSetReviewModel): {
  readonly additions: number;
  readonly deletions: number;
} {
  return changeSet.files.reduce(
    (totals, file) =>
      file.hunks.reduce(
        (fileTotals, hunk) => ({
          additions: fileTotals.additions + hunk.additions,
          deletions: fileTotals.deletions + hunk.deletions
        }),
        totals
      ),
    { additions: 0, deletions: 0 }
  );
}

export function selectedChangeSetFiles(changeSet: ChangeSetReviewModel): ChangeSetFileSelection[] {
  return changeSet.files.map((file) => ({
    relativePath: file.relativePath,
    selected: file.selected,
    selectedHunkIds: file.hunks.filter((hunk) => hunk.selected).map((hunk) => hunk.hunkId)
  }));
}

export function canApplyChangeSet(review: ChangeSetReviewProps): boolean {
  if (
    review.applying ||
    review.stale ||
    review.selectionPending ||
    review.baseHashConflictPaths.length > 0 ||
    review.dirtyTargetPaths.length > 0 ||
    isFinalChangeSetStatus(review.changeSet.status)
  ) {
    return false;
  }
  const selectedFiles = review.changeSet.files.filter((file) => file.selected);
  return (
    selectedFiles.length > 0 &&
    selectedFiles.every(
      (file) => file.validation.valid && file.hunks.some((hunk) => hunk.selected)
    )
  );
}

export function isFinalChangeSetStatus(status: string): boolean {
  return status === "applied" || status === "rejected" || status === "abandoned";
}
