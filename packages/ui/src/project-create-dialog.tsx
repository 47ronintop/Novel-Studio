import { FolderOpen } from "lucide-react";
import { useEffect, useRef } from "react";

export interface ProjectCreateDialogProps {
  readonly open: boolean;
  readonly titleInput: string;
  readonly folderNameInput: string;
  readonly selectedParentDisplayName?: string;
  readonly creationPreview?: {
    readonly folderName: string;
    readonly parentDisplayName: string;
    readonly targetDisplayName: string;
  };
  readonly busy: boolean;
  readonly feedback?: {
    readonly kind: "info" | "error";
    readonly message: string;
  };
  readonly onTitleChange: (title: string) => void;
  readonly onFolderNameChange: (folderName: string) => void;
  readonly onChooseParentDirectory: () => void;
  readonly onCancel: () => void;
  readonly onCreate: () => void;
}

export function ProjectCreateDialog(props: ProjectCreateDialogProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) return;
    titleInputRef.current?.focus();
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.open, props.onCancel]);

  if (!props.open) {
    return null;
  }

  return (
    <div className="ns-project-create-dialog" aria-label="新建创作项目" aria-modal="true" role="dialog">
      <div className="ns-project-create-dialog-backdrop" onClick={props.onCancel} />
      <section className="ns-project-create-dialog-content">
        <header className="ns-project-create-dialog-header">
          <strong>新建创作项目</strong>
        </header>
        <div className="ns-project-create-dialog-form">
          <label>
            <span>项目标题</span>
            <input
              aria-label="项目标题"
              disabled={props.busy}
              onChange={(event) => props.onTitleChange(event.currentTarget.value)}
              ref={titleInputRef}
              value={props.titleInput}
            />
          </label>
          <label>
            <span>项目文件夹名称</span>
            <input
              aria-label="项目文件夹名称"
              disabled={props.busy}
              onChange={(event) => props.onFolderNameChange(event.currentTarget.value)}
              value={props.folderNameInput}
            />
          </label>
          <button
            aria-label="选择项目父文件夹"
            className="ns-icon-text-button"
            disabled={props.busy}
            onClick={props.onChooseParentDirectory}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={14} />
            {props.selectedParentDisplayName ?? "选择父文件夹"}
          </button>
          {props.creationPreview === undefined ? null : (
            <p className="ns-project-create-dialog-preview">
              {props.creationPreview.targetDisplayName}
            </p>
          )}
          {props.feedback === undefined ? null : (
            <p className="ns-project-feedback" data-kind={props.feedback.kind} role="status">
              {props.feedback.message}
            </p>
          )}
        </div>
        <div className="ns-project-create-dialog-actions">
          <button
            aria-label="取消创建项目"
            className="ns-icon-text-button"
            onClick={props.onCancel}
            type="button"
          >
            取消创建项目
          </button>
          <button
            aria-label="创建项目"
            className="ns-ai-send-button"
            disabled={props.busy}
            onClick={props.onCreate}
            type="button"
          >
            创建项目
          </button>
        </div>
      </section>
    </div>
  );
}
