import type { ChapterEditorProps } from "./chapter-editor.js";
import { calculateWritingMetrics } from "./editor-toolbar.js";
import type { PlainFileEditorProps } from "./workspace-shell-types.js";

export interface WorkspaceStatusBarProps {
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly fileEditor: PlainFileEditorProps | undefined;
  readonly fileSelection: { readonly anchor: number; readonly head: number };
}

export function WorkspaceStatusBar({
  chapterEditor,
  fileEditor,
  fileSelection
}: WorkspaceStatusBarProps) {
  const body = fileEditor?.content ?? chapterEditor?.chapter.body;
  if (body === undefined) {
    return null;
  }

  if (fileEditor !== undefined) {
    return (
      <footer aria-label="状态栏" className="ns-status-bar" data-region="status-bar">
        <div className="ns-status-bar-left">
          <span>{documentSaveStatusLabel(fileEditor.saveStatus)}</span>
          {fileEditor.readOnlyReason === undefined ? null : <span>只读</span>}
        </div>
        <div className="ns-status-bar-right">
          <span>{formatDocumentCursorLabel(body, fileSelection)}</span>
          <span>UTF-8</span>
          <span>{body.includes("\r\n") ? "CRLF" : "LF"}</span>
          <span>{fileModeLabel(fileEditor.path)}</span>
        </div>
      </footer>
    );
  }

  const metrics = calculateWritingMetrics(body);
  const saveStatus = chapterEditor?.saveStatus ?? "Saved";
  const cursorPositionLabel =
    chapterEditor?.runtime?.cursorPositionLabel ??
    formatDocumentCursorLabel(body, { anchor: 0, head: 0 });
  const documentMode = chapterEditor?.runtime?.documentMode ?? "Markdown";

  return (
    <footer aria-label="状态栏" className="ns-status-bar" data-region="status-bar">
      <div className="ns-status-bar-left">
        <span>{documentSaveStatusLabel(saveStatus)}</span>
      </div>
      <div className="ns-status-bar-right">
        <span>{metrics.wordCountLabel}</span>
        <span data-status-reading-time>{metrics.readingTimeLabel}</span>
        <span>{cursorPositionLabel}</span>
        <span>{documentMode}</span>
      </div>
    </footer>
  );
}

function fileModeLabel(path: string): string {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "css":
      return "CSS";
    case "html":
      return "HTML";
    default:
      return extension === undefined ? "Text" : extension.toUpperCase();
  }
}

export function formatDocumentCursorLabel(
  body: string,
  selection: { readonly anchor: number; readonly head: number }
): string {
  if (selection.anchor !== selection.head) {
    return `已选择 ${Math.abs(selection.head - selection.anchor)} 字`;
  }

  const offset = Math.max(0, Math.min(selection.head, body.length));
  const lines = body.slice(0, offset).split("\n");
  return `行 ${lines.length}，列 ${(lines.at(-1)?.length ?? 0) + 1}`;
}

function documentSaveStatusLabel(
  status: PlainFileEditorProps["saveStatus"] | ChapterEditorProps["saveStatus"]
): string {
  switch (status) {
    case "Saved":
      return "已保存";
    case "Saving":
      return "保存中";
    case "Unsaved":
      return "未保存";
    case "Recovery available":
      return "有可恢复内容";
  }
}
