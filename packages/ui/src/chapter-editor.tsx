import type { ChapterDocument } from "@novel-studio/shared";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { Eye, History, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorFindReplace } from "./editor-find-replace.js";
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
  readonly onBodyChange?: (nextBody: string) => void;
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

export interface TextareaSelectionSource {
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

export function ChapterEditor({
  chapter,
  dirty,
  versionHistory,
  diffPreview,
  selectionReview,
  runtime,
  editorPreferences = DEFAULT_EDITOR_PREFERENCES,
  onBodyChange,
  onSelectionChange,
  onSelectionReviewAccept,
  onSelectionReviewReject,
  onSelectionReviewUndo,
  onSelectionAiPreview,
  onVersionPreview,
  onVersionRestore
}: ChapterEditorProps) {
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
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
  const editorStyle = {
    "--ns-editor-font-family": editorFontFamilyValue(editorPreferences.fontFamily),
    "--ns-editor-font-size": `${editorPreferences.fontSize}px`,
    "--ns-editor-line-height": String(editorPreferences.lineHeight)
  } as CSSProperties;

  return (
    <section className="ns-editor-layout" aria-label="章节编辑器">
      {runtime === undefined ? null : (
        <ChapterEditorRuntime
          runtime={runtime}
          {...(onSelectionAiPreview === undefined ? {} : { onSelectionAiPreview })}
        />
      )}

      <EditorFindReplace
        body={chapter.body}
        open={findReplaceOpen}
        {...(onBodyChange === undefined ? {} : { onBodyChange })}
        {...(onSelectionChange === undefined ? {} : { onSelectionChange })}
      />

      <div
        className="ns-editor-body"
        data-dirty={dirty}
        data-large-document={largeDocument}
        style={editorStyle}
        {...(runtime?.runtimeId === undefined ? {} : { "data-runtime-id": runtime.runtimeId })}
      >
        {runtime?.runtimeId === "codemirror" ? (
          <CodeMirrorChapterEditor
            body={chapter.body}
            readOnly={onBodyChange === undefined}
            onFindReplaceOpen={() => setFindReplaceOpen(true)}
            {...(onBodyChange === undefined ? {} : { onBodyChange })}
            {...(onSelectionChange === undefined ? {} : { onSelectionChange })}
          />
        ) : (
          <>
            <textarea
              aria-label="章节正文"
              className="ns-editor-textarea"
              onChange={(event) => {
                onBodyChange?.(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "h") {
                  event.preventDefault();
                  setFindReplaceOpen(true);
                }
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

export function readTextareaSelection(source: TextareaSelectionSource): ChapterEditorSelection {
  return {
    anchor: source.selectionStart,
    head: source.selectionEnd
  };
}

function CodeMirrorChapterEditor({
  body,
  readOnly,
  onBodyChange,
  onFindReplaceOpen,
  onSelectionChange
}: {
  readonly body: string;
  readonly readOnly: boolean;
  readonly onBodyChange?: (nextBody: string) => void;
  readonly onFindReplaceOpen: () => void;
  readonly onSelectionChange?: (selection: ChapterEditorSelection) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const suppressBodyChangeRef = useRef(false);
  const callbacksRef = useRef({
    onBodyChange,
    onFindReplaceOpen,
    onSelectionChange
  });

  useEffect(() => {
    callbacksRef.current = {
      onBodyChange,
      onFindReplaceOpen,
      onSelectionChange
    };
  }, [onBodyChange, onFindReplaceOpen, onSelectionChange]);

  useEffect(() => {
    const parent = mountRef.current;
    if (parent === null) {
      return undefined;
    }

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged && !suppressBodyChangeRef.current) {
        callbacksRef.current.onBodyChange?.(update.state.doc.toString());
      }

      if (update.selectionSet) {
        const selection = update.state.selection.main;
        callbacksRef.current.onSelectionChange?.({
          anchor: selection.anchor,
          head: selection.head
        });
      }
    });
    const findReplaceKeymap = keymap.of([
      {
        key: "Mod-h",
        preventDefault: true,
        run() {
          callbacksRef.current.onFindReplaceOpen();
          return true;
        }
      }
    ]);
    const state = EditorState.create({
      doc: body,
      extensions: [
        lineNumbers(),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly)
        ]),
        EditorView.lineWrapping,
        findReplaceKeymap,
        updateListener
      ]
    });
    const view = new EditorView({
      parent,
      state
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }

    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }

    const currentBody = view.state.doc.toString();
    if (currentBody === body) {
      return;
    }

    suppressBodyChangeRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: body
      }
    });
    suppressBodyChangeRef.current = false;
  }, [body]);

  return (
    <div
      aria-label="章节正文"
      className="ns-editor-codemirror"
      data-readonly={readOnly}
      ref={mountRef}
    />
  );
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
        <span>{runtimeAdapterLabel(runtime.adapterLabel)}</span>
        <span>{documentModeLabel(runtime.documentMode)}</span>
        <span>{activeRangeLabel(runtime.activeRangeLabel)}</span>
        {runtime.selectionSummaryLabel === undefined ? null : (
          <span>{runtime.selectionSummaryLabel}</span>
        )}
        {runtime.visualDiffSummaryLabel === undefined ? null : (
          <span>{runtime.visualDiffSummaryLabel}</span>
        )}
        {runtime.localDiffReviewLabel === undefined ? null : (
          <span>{runtime.localDiffReviewLabel}</span>
        )}
        {runtime.migrationGateLabel === undefined ? null : (
          <span>{runtime.migrationGateLabel}</span>
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
        <span>{autosaveLabel(runtime.autosaveLabel)}</span>
        <span>{shortcutProfileLabel(runtime.shortcutProfileLabel)}</span>
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

function runtimeAdapterLabel(label: string): string {
  return label === "Textarea Runtime" ? "基础编辑器" : label;
}

function documentModeLabel(label: string): string {
  return label === "Markdown" ? "Markdown" : label;
}

function activeRangeLabel(label: string): string {
  const match = /^Lines ([0-9]+)-([0-9]+)$/.exec(label);
  return match === null ? label : `第 ${match[1]}-${match[2]} 行`;
}

function autosaveLabel(label: string): string {
  if (label === "Autosave armed") {
    return "自动保存已启用";
  }
  if (label === "Recovery draft available") {
    return "有可恢复草稿";
  }
  return label;
}

function shortcutProfileLabel(label: string): string {
  return label === "Default shortcuts" ? "默认快捷键" : label;
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
