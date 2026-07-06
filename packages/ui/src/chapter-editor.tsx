import type { ChapterDocument } from "@novel-studio/shared";
import { Eye, History, RotateCcw, Save, SquarePen } from "lucide-react";
import { useMemo } from "react";

const LARGE_DOCUMENT_LINE_THRESHOLD = 200;
const MAX_RENDERED_GUTTER_LINES = 120;

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

export interface ChapterEditorRuntimeProps {
  readonly adapterLabel: string;
  readonly documentMode: string;
  readonly activeRangeLabel: string;
  readonly selectionSummaryLabel?: string;
  readonly selectionAiPreviewCommand?: {
    readonly commandId: string;
    readonly label: string;
    readonly disabledReason?: string;
  };
  readonly visualDiffSummaryLabel?: string;
  readonly autosaveLabel: string;
  readonly shortcutProfileLabel: string;
  readonly warnings: readonly string[];
}

export interface ChapterEditorProps {
  readonly chapter: ChapterDocument;
  readonly saveStatus: "Saved" | "Saving" | "Unsaved" | "Recovery available";
  readonly dirty: boolean;
  readonly versionHistory: readonly ChapterEditorVersionEntry[];
  readonly diffPreview?: ChapterEditorDiffPreview;
  readonly runtime?: ChapterEditorRuntimeProps;
  readonly onBodyChange?: (nextBody: string) => void;
  readonly onSelectionChange?: (selection: ChapterEditorSelection) => void;
  readonly onSave?: () => void;
  readonly onSelectionAiPreview?: (commandId: string) => void;
  readonly onVersionPreview?: (versionId: string) => void;
  readonly onVersionRestore?: (versionId: string) => void;
}

export interface ChapterEditorSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface TextareaSelectionSource {
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export function ChapterEditor({
  chapter,
  saveStatus,
  dirty,
  versionHistory,
  diffPreview,
  runtime,
  onBodyChange,
  onSelectionChange,
  onSave,
  onSelectionAiPreview,
  onVersionPreview,
  onVersionRestore
}: ChapterEditorProps) {
  const editorStateLabel = dirty ? "已修改" : "未修改";
  const documentLines = useMemo(() => chapter.body.split("\n"), [chapter.body]);
  const metrics = useMemo(() => calculateDocumentMetrics(chapter.body), [chapter.body]);
  const largeDocument = metrics.lineCount > LARGE_DOCUMENT_LINE_THRESHOLD;
  const gutterLines = largeDocument
    ? documentLines.slice(0, MAX_RENDERED_GUTTER_LINES)
    : documentLines;
  const diffSummary = diffPreview === undefined ? undefined : summarizeDiff(diffPreview);
  const handleSelectionChange = (source: TextareaSelectionSource) => {
    onSelectionChange?.(readTextareaSelection(source));
  };

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
        <div
          className="ns-editor-metrics"
          aria-label="Editor document metrics"
          data-large-document={largeDocument}
        >
          <span>{metrics.lineCount} lines</span>
          <span>{metrics.wordCount} words</span>
          <span>{metrics.characterCount} chars</span>
          {largeDocument ? <span>Large document mode</span> : null}
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

      {runtime === undefined ? null : (
        <ChapterEditorRuntime
          runtime={runtime}
          {...(onSelectionAiPreview === undefined ? {} : { onSelectionAiPreview })}
        />
      )}

      <div className="ns-editor-body" data-dirty={dirty} data-large-document={largeDocument}>
        <textarea
          aria-label="章节正文"
          className="ns-editor-textarea"
          onChange={(event) => {
            onBodyChange?.(event.currentTarget.value);
          }}
          onKeyUp={(event) => {
            handleSelectionChange(event.currentTarget);
          }}
          onMouseUp={(event) => {
            handleSelectionChange(event.currentTarget);
          }}
          onSelect={(event) => {
            handleSelectionChange(event.currentTarget);
          }}
          readOnly={onBodyChange === undefined}
          value={chapter.body}
          spellCheck={true}
        />
        <div className="ns-editor-gutter" aria-hidden="true">
          {gutterLines.map((line, index) => (
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
            {diffSummary === undefined ? null : (
              <p className="ns-diff-summary">
                Diff summary: {diffSummary.insertCount} insert / {diffSummary.deleteCount} delete /{" "}
                {diffSummary.replaceCount} replace
              </p>
            )}
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

export function readTextareaSelection(source: TextareaSelectionSource): ChapterEditorSelection {
  return {
    anchor: source.selectionStart,
    head: source.selectionEnd
  };
}

function ChapterEditorRuntime({
  runtime,
  onSelectionAiPreview
}: {
  readonly runtime: ChapterEditorRuntimeProps;
  readonly onSelectionAiPreview?: (commandId: string) => void;
}) {
  const selectionAiPreviewCommand = runtime.selectionAiPreviewCommand;

  return (
    <section className="ns-editor-runtime" aria-label="Editor Runtime">
      <div className="ns-editor-runtime-main">
        <span>{runtime.adapterLabel}</span>
        <span>{runtime.documentMode}</span>
        <span>{runtime.activeRangeLabel}</span>
        {runtime.selectionSummaryLabel === undefined ? null : (
          <span>{runtime.selectionSummaryLabel}</span>
        )}
        {runtime.visualDiffSummaryLabel === undefined ? null : (
          <span>{runtime.visualDiffSummaryLabel}</span>
        )}
        {selectionAiPreviewCommand === undefined ? null : (
          <button
            aria-label={selectionAiPreviewCommand.label}
            disabled={
              selectionAiPreviewCommand.disabledReason !== undefined ||
              onSelectionAiPreview === undefined
            }
            onClick={() => onSelectionAiPreview?.(selectionAiPreviewCommand.commandId)}
            type="button"
          >
            {selectionAiPreviewCommand.label}
          </button>
        )}
        <span>{runtime.autosaveLabel}</span>
        <span>{runtime.shortcutProfileLabel}</span>
      </div>
      {runtime.warnings.length === 0 ? null : (
        <ul className="ns-editor-runtime-warnings" aria-label="Editor Runtime warnings">
          {runtime.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function calculateDocumentMetrics(body: string): {
  readonly lineCount: number;
  readonly wordCount: number;
  readonly characterCount: number;
} {
  const lines = body.length === 0 ? [""] : body.split("\n");
  const words = body.match(/\S+/g) ?? [];

  return {
    lineCount: lines.length,
    wordCount: words.length,
    characterCount: body.length
  };
}

function summarizeDiff(diffPreview: ChapterEditorDiffPreview): {
  readonly insertCount: number;
  readonly deleteCount: number;
  readonly replaceCount: number;
} {
  return {
    insertCount: diffPreview.changes.filter((change) => change.kind === "insert").length,
    deleteCount: diffPreview.changes.filter((change) => change.kind === "delete").length,
    replaceCount: diffPreview.changes.filter((change) => change.kind === "replace").length
  };
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
