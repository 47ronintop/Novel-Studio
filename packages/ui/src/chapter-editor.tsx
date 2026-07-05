import type { ChapterDocument } from "@novel-studio/shared";
import { Eye, History, RotateCcw, Save, SquarePen } from "lucide-react";
import { useMemo } from "react";

export interface ChapterEditorVersionEntry {
  readonly versionId: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface ChapterEditorDiffChange {
  readonly kind: "insert" | "delete" | "replace";
  readonly value: string;
}

export interface ChapterEditorDiffPreview {
  readonly title: string;
  readonly changes: readonly ChapterEditorDiffChange[];
}

export interface ChapterEditorProps {
  readonly chapter: ChapterDocument;
  readonly saveStatus: "Saved" | "Saving" | "Unsaved" | "Recovery available";
  readonly dirty: boolean;
  readonly versionHistory: readonly ChapterEditorVersionEntry[];
  readonly diffPreview?: ChapterEditorDiffPreview;
  readonly onBodyChange?: (nextBody: string) => void;
  readonly onSave?: () => void;
  readonly onVersionPreview?: (versionId: string) => void;
  readonly onVersionRestore?: (versionId: string) => void;
}

export function ChapterEditor({
  chapter,
  saveStatus,
  dirty,
  versionHistory,
  diffPreview,
  onBodyChange,
  onSave,
  onVersionPreview,
  onVersionRestore
}: ChapterEditorProps) {
  const editorStateLabel = dirty ? "已修改" : "未修改";
  const documentLines = useMemo(() => chapter.body.split("\n"), [chapter.body]);

  return (
    <section className="ns-editor-layout" aria-label="章节编辑器">
      <header className="ns-editor-header">
        <div className="ns-editor-header-main">
          <SquarePen aria-hidden="true" size={15} />
          <div>
            <h2 className="ns-editor-title">{chapter.frontmatter.title}</h2>
            <p className="ns-editor-subtitle">
              <span>{editorStateLabel}</span>
              <span>{saveStatusLabel(saveStatus)}</span>
            </p>
          </div>
        </div>
        <button
          aria-label="保存章节"
          className="ns-editor-save"
          disabled={!dirty || saveStatus === "Saving"}
          onClick={onSave}
          type="button"
        >
          <Save aria-hidden="true" size={15} />
          保存
        </button>
      </header>

      <div className="ns-editor-body" data-dirty={dirty}>
        <textarea
          aria-label="章节正文"
          className="ns-editor-textarea"
          onChange={(event) => {
            onBodyChange?.(event.currentTarget.value);
          }}
          readOnly={onBodyChange === undefined}
          value={chapter.body}
          spellCheck={true}
        />
        <div className="ns-editor-gutter" aria-hidden="true">
          {documentLines.map((line, index) => (
            <div className="ns-editor-line-number" key={`${index}-${line.length}`}>
              {index + 1}
            </div>
          ))}
        </div>
      </div>

      <div className="ns-editor-panels">
        <section className="ns-editor-panel" aria-label="版本历史">
          <div className="ns-editor-panel-header">
            <History aria-hidden="true" size={14} />
            <span>版本历史</span>
          </div>
          <ul className="ns-version-list">
            {versionHistory.map((entry) => (
              <li className="ns-version-item" key={entry.versionId}>
                <div className="ns-version-main">
                  <span>{entry.label}</span>
                  <span>{entry.createdAt}</span>
                </div>
                <div className="ns-version-actions">
                  <button
                    aria-label={`预览版本 ${entry.label}`}
                    className="ns-icon-button"
                    onClick={() => {
                      onVersionPreview?.(entry.versionId);
                    }}
                    title={`预览版本 ${entry.label}`}
                    type="button"
                  >
                    <Eye aria-hidden="true" size={13} />
                  </button>
                  <button
                    aria-label={`恢复版本 ${entry.label}`}
                    className="ns-icon-button"
                    onClick={() => {
                      onVersionRestore?.(entry.versionId);
                    }}
                    title={`恢复版本 ${entry.label}`}
                    type="button"
                  >
                    <RotateCcw aria-hidden="true" size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {diffPreview ? (
          <section className="ns-editor-panel" aria-label="AI 建议差异">
            <div className="ns-editor-panel-header">
              <span>{diffPreview.title}</span>
              <span className="ns-preview-only">仅预览</span>
            </div>
            <ul className="ns-diff-list">
              {diffPreview.changes.map((change, index) => (
                <li
                  className={`ns-diff-item ns-diff-${change.kind}`}
                  key={`${change.kind}-${index}`}
                >
                  <span>{diffKindLabel(change.kind)}</span>
                  <pre>{change.value}</pre>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function saveStatusLabel(status: ChapterEditorProps["saveStatus"]): string {
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

function diffKindLabel(kind: ChapterEditorDiffChange["kind"]): string {
  switch (kind) {
    case "insert":
      return "新增";
    case "delete":
      return "删除";
    case "replace":
      return "替换";
  }
}
