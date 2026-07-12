import type { ChapterDocument } from "@novel-studio/shared";
import { Eye, History, RotateCcw } from "lucide-react";
import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import {
  CodeMirrorDocumentEditor,
  type CodeMirrorDocumentSelection
} from "./codemirror-document-editor.js";
import {
  EditorFindReplace,
  type EditorFindMode
} from "./editor-find-replace.js";
import {
  DEFAULT_EDITOR_PREFERENCES,
  editorFontFamilyValue,
  type EditorPreferences
} from "./editor-toolbar.js";

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
  readonly runtimeId?: "textarea" | "codemirror";
  readonly adapterLabel: string;
  readonly documentMode: string;
  readonly activeRangeLabel: string;
  readonly cursorPositionLabel: string;
  readonly selectionSummaryLabel?: string;
  readonly selectionAiPreviewCommand?: {
    readonly commandId: string;
    readonly label: string;
    readonly disabledReason?: string;
  };
  readonly visualDiffSummaryLabel?: string;
  readonly localDiffReviewLabel?: string;
  readonly migrationGateLabel?: string;
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
  readonly selectionReview?: ChapterEditorSelectionReview;
  readonly runtime?: ChapterEditorRuntimeProps;
  readonly editorPreferences?: EditorPreferences;
  readonly findMode?: EditorFindMode | undefined;
  readonly onBodyChange?: (nextBody: string) => void;
  readonly onFindModeChange?: ((mode: EditorFindMode) => void) | undefined;
  readonly onSelectionChange?: (selection: ChapterEditorSelection) => void;
  readonly onEditorPreferencesChange?: (preferences: EditorPreferences) => void;
  readonly onFocusModeToggle?: () => void;
  readonly onSave?: () => void;
  readonly onSelectionReviewAccept?: () => void;
  readonly onSelectionReviewReject?: () => void;
  readonly onSelectionReviewUndo?: () => void;
  readonly onSelectionAiPreview?: (commandId: string) => void;
  readonly onVersionPreview?: (versionId: string) => void;
  readonly onVersionRestore?: (versionId: string) => void;
}

export interface ChapterEditorSelectionReview {
  readonly status: "pending" | "rejected" | "applied";
  readonly originalText: string;
  readonly proposedText: string;
  readonly rangeLabel: string;
  readonly compareLabel: string;
  readonly canUndo: boolean;
}

export interface ChapterEditorSelection {
  readonly anchor: number;
  readonly head: number;
}

export function ChapterEditor({
  chapter,
  dirty,
  versionHistory,
  diffPreview,
  selectionReview,
  runtime,
  editorPreferences = DEFAULT_EDITOR_PREFERENCES,
  findMode = "closed",
  onBodyChange,
  onFindModeChange,
  onSelectionChange,
  onSelectionReviewAccept,
  onSelectionReviewReject,
  onSelectionReviewUndo,
  onVersionPreview,
  onVersionRestore
}: ChapterEditorProps) {
  const editorFocusRef = useRef<() => void>(() => undefined);
  const editorSelectionRef = useRef<(selection: CodeMirrorDocumentSelection) => void>(
    () => undefined
  );
  const documentLines = useMemo(() => chapter.body.split("\n"), [chapter.body]);
  const metrics = useMemo(() => calculateDocumentMetrics(chapter.body), [chapter.body]);
  const largeDocument = metrics.lineCount > LARGE_DOCUMENT_LINE_THRESHOLD;
  const gutterLines = largeDocument
    ? documentLines.slice(0, MAX_RENDERED_GUTTER_LINES)
    : documentLines;
  const diffSummary = diffPreview === undefined ? undefined : summarizeDiff(diffPreview);
  const registerEditorFocus = useCallback((focus: () => void) => {
    editorFocusRef.current = focus;
  }, []);
  const registerEditorSelection = useCallback(
    (select: (selection: CodeMirrorDocumentSelection) => void) => {
      editorSelectionRef.current = select;
    },
    []
  );
  const registerTextarea = useCallback(
    (textarea: HTMLTextAreaElement | null) => {
      if (textarea === null) {
        editorFocusRef.current = () => undefined;
        editorSelectionRef.current = () => undefined;
        return;
      }

      editorFocusRef.current = () => textarea.focus();
      editorSelectionRef.current = (selection) => {
        textarea.focus();
        textarea.setSelectionRange(selection.anchor, selection.head);
        onSelectionChange?.(selection);
      };
    },
    [onSelectionChange]
  );
  const requestEditorFocus = useCallback(() => editorFocusRef.current(), []);
  const requestEditorSelection = useCallback(
    (selection: CodeMirrorDocumentSelection) => editorSelectionRef.current(selection),
    []
  );
  const runtimeId = runtime?.runtimeId ?? "textarea";
  const editorStyle = {
    "--ns-editor-font-family": editorFontFamilyValue(editorPreferences.fontFamily),
    "--ns-editor-font-size": `${editorPreferences.fontSize}px`,
    "--ns-editor-line-height": String(editorPreferences.lineHeight)
  } as CSSProperties;

  return (
    <section className="ns-editor-layout" aria-label="章节编辑器">
      {runtime === undefined ? null : (
        <ChapterEditorRuntime runtime={runtime} />
      )}

      <EditorFindReplace
        body={chapter.body}
        mode={findMode}
        onModeChange={onFindModeChange}
        onRequestEditorFocus={requestEditorFocus}
        onSelectionChange={requestEditorSelection}
        {...(onBodyChange === undefined ? {} : { onBodyChange })}
      />

      <div
        className="ns-editor-body"
        data-dirty={dirty}
        data-large-document={largeDocument}
        data-runtime-id={runtimeId}
        style={editorStyle}
      >
        {runtimeId === "codemirror" ? (
          <CodeMirrorDocumentEditor
            ariaLabel="章节正文"
            body={chapter.body}
            readOnly={onBodyChange === undefined}
            onEditorFocusRegister={registerEditorFocus}
            onEditorSelectionRegister={registerEditorSelection}
            onFindModeChange={(mode) => onFindModeChange?.(mode)}
            {...(onBodyChange === undefined ? {} : { onBodyChange })}
            {...(onSelectionChange === undefined ? {} : { onSelectionChange })}
          />
        ) : (
          <>
            <textarea
              aria-label="章节正文"
              className="ns-editor-textarea"
              onChange={(event) => onBodyChange?.(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (!(event.ctrlKey || event.metaKey)) {
                  return;
                }

                const key = event.key.toLocaleLowerCase();
                if (key === "f" || key === "h") {
                  event.preventDefault();
                  onFindModeChange?.(key === "f" ? "find" : "replace");
                }
              }}
              onKeyUp={(event) => {
                onSelectionChange?.({
                  anchor: event.currentTarget.selectionStart,
                  head: event.currentTarget.selectionEnd
                });
              }}
              onMouseUp={(event) => {
                onSelectionChange?.({
                  anchor: event.currentTarget.selectionStart,
                  head: event.currentTarget.selectionEnd
                });
              }}
              onSelect={(event) => {
                onSelectionChange?.({
                  anchor: event.currentTarget.selectionStart,
                  head: event.currentTarget.selectionEnd
                });
              }}
              readOnly={onBodyChange === undefined}
              ref={registerTextarea}
              spellCheck={true}
              value={chapter.body}
            />
            <div className="ns-editor-gutter" aria-hidden="true">
              {gutterLines.map((line, index) => (
                <div className="ns-editor-line-number" key={`${index}-${line.length}`}>
                  {index + 1}
                </div>
              ))}
            </div>
          </>
        )}
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
        {selectionReview === undefined ? null : (
          <SelectionReviewPanel
            review={selectionReview}
            {...(onSelectionReviewAccept === undefined
              ? {}
              : { onAccept: onSelectionReviewAccept })}
            {...(onSelectionReviewReject === undefined
              ? {}
              : { onReject: onSelectionReviewReject })}
            {...(onSelectionReviewUndo === undefined ? {} : { onUndo: onSelectionReviewUndo })}
          />
        )}
      </div>
    </section>
  );
}

function ChapterEditorRuntime({ runtime }: { readonly runtime: ChapterEditorRuntimeProps }) {
  if (runtime.warnings.length === 0) {
    return null;
  }

  return (
    <section className="ns-editor-runtime" aria-label="Editor Runtime">
      <ul className="ns-editor-runtime-warnings" aria-label="Editor Runtime warnings">
        {runtime.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}

function SelectionReviewPanel({
  review,
  onAccept,
  onReject,
  onUndo
}: {
  readonly review: ChapterEditorSelectionReview;
  readonly onAccept?: () => void;
  readonly onReject?: () => void;
  readonly onUndo?: () => void;
}) {
  return (
    <section className="ns-editor-panel" aria-label="Selection AI review">
      <div className="ns-editor-panel-header">
        <span>Selection review</span>
        <span className="ns-preview-only">{review.status}</span>
      </div>
      <p className="ns-diff-summary">
        Range {review.rangeLabel}: {review.compareLabel}
      </p>
      <div className="ns-version-actions">
        <button
          aria-label="Accept selection AI preview"
          className="ns-icon-button"
          disabled={review.status !== "pending" || onAccept === undefined}
          onClick={onAccept}
          type="button"
        >
          Accept
        </button>
        <button
          aria-label="Reject selection AI preview"
          className="ns-icon-button"
          disabled={review.status !== "pending" || onReject === undefined}
          onClick={onReject}
          type="button"
        >
          Reject
        </button>
        <button
          aria-label="Undo selection AI rejection"
          className="ns-icon-button"
          disabled={!review.canUndo || onUndo === undefined}
          onClick={onUndo}
          type="button"
        >
          Undo
        </button>
      </div>
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
