import { FileText, FolderInput } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ProjectFolderImportPreviewProps } from "./workspace-shell-types.js";

export interface ProjectFolderImportDialogProps extends ProjectFolderImportPreviewProps {
  readonly open: boolean;
  readonly onCandidateToggle: (relativePath: string, selected: boolean) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function ProjectFolderImportDialog(props: ProjectFolderImportDialogProps) {
  const firstCheckboxRef = useRef<HTMLInputElement>(null);
  const selectedCount = props.candidates.filter((candidate) => candidate.selected).length;

  useEffect(() => {
    if (!props.open) return;
    firstCheckboxRef.current?.focus();
  }, [props.open]);

  useEffect(() => {
    if (!props.open || props.busy) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.busy, props.onCancel, props.open]);

  if (!props.open) return null;

  return (
    <div
      className="ns-project-folder-import-dialog"
      aria-label="接入普通小说文件夹"
      aria-modal="true"
      role="dialog"
    >
      <div
        className="ns-project-create-dialog-backdrop"
        onClick={props.busy ? undefined : props.onCancel}
      />
      <section className="ns-project-folder-import-dialog-content">
        <header className="ns-project-create-dialog-header">
          <strong>接入普通小说文件夹</strong>
          <p className="ns-project-create-dialog-description">
            将在同级创建新项目“{props.targetDisplayName}”，源文件夹不会被修改。
          </p>
        </header>

        <div className="ns-project-folder-import-summary">
          <FolderInput aria-hidden="true" size={16} />
          <span>{props.sourceDisplayName}</span>
          <span className="ns-muted">已选择 {selectedCount} 项</span>
        </div>

        <div className="ns-project-folder-import-candidates" aria-label="候选章节文件">
          {props.candidates.map((candidate, index) => (
            <label key={candidate.relativePath}>
              <input
                checked={candidate.selected}
                disabled={props.busy}
                onChange={(event) =>
                  props.onCandidateToggle(candidate.relativePath, event.currentTarget.checked)
                }
                ref={index === 0 ? firstCheckboxRef : undefined}
                type="checkbox"
              />
              <FileText aria-hidden="true" size={15} />
              <span>
                <strong>{candidate.defaultTitle}</strong>
                <small>
                  {candidate.relativePath} · {formatFileSize(candidate.sizeBytes)}
                </small>
              </span>
            </label>
          ))}
        </div>

        <div className="ns-project-create-dialog-actions">
          <button
            className="ns-icon-text-button"
            disabled={props.busy}
            onClick={props.onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="ns-ai-send-button"
            disabled={props.busy || selectedCount === 0}
            onClick={props.onConfirm}
            type="button"
          >
            {props.busy ? "正在创建项目..." : `创建项目并导入 ${selectedCount} 章`}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}
