import { FileWarning, RefreshCw, Save } from "lucide-react";

export interface PlainFileConflictReviewProps {
  readonly fileName: string;
  readonly conflict: {
    readonly diskContent: string;
    readonly draftContent: string;
    readonly diskChecksum: string;
  };
  readonly onReloadFromDisk: () => void;
  readonly onKeepDraft: () => void;
}

export function PlainFileConflictReview({
  fileName,
  conflict,
  onReloadFromDisk,
  onKeepDraft
}: PlainFileConflictReviewProps) {
  return (
    <section aria-label={`文件冲突审查：${fileName}`} className="ns-file-conflict-review">
      <div className="ns-editor-panel-header">
        <span><FileWarning aria-hidden="true" size={15} />文件冲突审查</span>
        <span className="ns-muted">{fileName}</span>
      </div>
      <div className="ns-file-conflict-columns">
        <section aria-label="磁盘版本">
          <h3>磁盘版本</h3>
          <pre>{conflict.diskContent}</pre>
        </section>
        <section aria-label="当前草稿">
          <h3>当前草稿</h3>
          <pre>{conflict.draftContent}</pre>
        </section>
      </div>
      <div className="ns-project-actions">
        <button aria-label="重新载入磁盘版本" onClick={onReloadFromDisk} type="button">
          <RefreshCw aria-hidden="true" size={14} />重新载入磁盘版本
        </button>
        <button aria-label="保留当前草稿" onClick={onKeepDraft} type="button">
          <Save aria-hidden="true" size={14} />保留当前草稿
        </button>
      </div>
    </section>
  );
}
