import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";

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
