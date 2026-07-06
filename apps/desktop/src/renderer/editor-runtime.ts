import type { ChapterEditorRuntimeProps } from "@novel-studio/ui";
import type { SaveStatus } from "@novel-studio/application";

export interface EditorRuntimeSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface EditorRuntimeSelectionSummary {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly characterCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly selectedTextPreview: string;
  readonly collapsed: boolean;
}

export interface EditorSelectionCommand {
  readonly commandId: string;
  readonly runtimeId: string;
  readonly selection: EditorRuntimeSelectionSummary;
}

export type EditorRuntimeEvent =
  | {
      readonly kind: "body-changed";
      readonly body: string;
    }
  | {
      readonly kind: "selection-changed";
      readonly selection: EditorRuntimeSelection;
    }
  | {
      readonly kind: "save-requested";
    }
  | {
      readonly kind: "command-dispatched";
      readonly commandId: string;
    }
  | {
      readonly kind: "runtime-warning";
      readonly message: string;
    };

export interface EditorRuntimeSnapshot {
  readonly runtimeId: string;
  readonly adapterLabel: string;
  readonly documentMode: string;
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly selection?: EditorRuntimeSelection;
  readonly selectionSummary?: EditorRuntimeSelectionSummary;
  readonly focused: boolean;
  readonly destroyed: boolean;
  readonly warnings: readonly string[];
}

export interface EditorRuntimeMountInput {
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly onEvent?: (event: EditorRuntimeEvent) => void;
}

export interface EditorRuntimeHandle {
  getSnapshot(): EditorRuntimeSnapshot;
  applyExternalBody(body: string): void;
  dispatchBodyChange(body: string): void;
  updateSelection(selection: EditorRuntimeSelection): void;
  requestSave(): void;
  dispatchCommand(commandId: string): void;
  reportWarning(message: string): void;
  focus(): void;
  destroy(): void;
}

export interface EditorRuntimeAdapter {
  readonly runtimeId: string;
  readonly adapterLabel: string;
  mount(input: EditorRuntimeMountInput): EditorRuntimeHandle;
}

export interface EditorRuntimeResolverOptions {
  readonly preferredRuntimeId?: "textarea" | "codemirror";
  readonly codeMirrorEnabled?: boolean;
}

export function createTextareaEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return createMemoryBackedEditorRuntimeAdapter({
    runtimeId: "textarea",
    adapterLabel: "Textarea Runtime"
  });
}

export function createCodeMirrorEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return createMemoryBackedEditorRuntimeAdapter({
    runtimeId: "codemirror",
    adapterLabel: "CodeMirror Adapter (flagged)"
  });
}

export function resolveEditorRuntimeAdapter(
  options: EditorRuntimeResolverOptions = {}
): EditorRuntimeAdapter {
  if (options.preferredRuntimeId === "codemirror" && options.codeMirrorEnabled === true) {
    return createCodeMirrorEditorRuntimeAdapter();
  }

  return createTextareaEditorRuntimeAdapter();
}

function createMemoryBackedEditorRuntimeAdapter(input: {
  readonly runtimeId: string;
  readonly adapterLabel: string;
}): EditorRuntimeAdapter {
  return {
    runtimeId: input.runtimeId,
    adapterLabel: input.adapterLabel,
    mount(mountInput) {
      let body = mountInput.body;
      let selection: EditorRuntimeSelection | undefined;
      let focused = false;
      let destroyed = false;
      const warnings: string[] = [];

      return {
        getSnapshot() {
          return {
            runtimeId: input.runtimeId,
            adapterLabel: input.adapterLabel,
            documentMode: "Markdown",
            body,
            saveStatus: mountInput.saveStatus,
            ...(selection === undefined ? {} : { selection }),
            ...(selection === undefined
              ? {}
              : { selectionSummary: summarizeSelection(body, selection) }),
            focused,
            destroyed,
            warnings
          };
        },
        applyExternalBody(nextBody) {
          if (destroyed) {
            return;
          }
          body = nextBody;
        },
        dispatchBodyChange(nextBody) {
          if (destroyed) {
            return;
          }
          body = nextBody;
          mountInput.onEvent?.({ kind: "body-changed", body: nextBody });
        },
        updateSelection(nextSelection) {
          if (destroyed) {
            return;
          }
          selection = nextSelection;
          mountInput.onEvent?.({ kind: "selection-changed", selection: nextSelection });
        },
        requestSave() {
          if (destroyed) {
            return;
          }
          mountInput.onEvent?.({ kind: "save-requested" });
        },
        dispatchCommand(commandId) {
          if (destroyed) {
            return;
          }
          mountInput.onEvent?.({ kind: "command-dispatched", commandId });
        },
        reportWarning(message) {
          if (destroyed) {
            return;
          }
          if (!warnings.includes(message)) {
            warnings.push(message);
          }
          mountInput.onEvent?.({ kind: "runtime-warning", message });
        },
        focus() {
          if (destroyed) {
            return;
          }
          focused = true;
        },
        destroy() {
          destroyed = true;
        }
      };
    }
  };
}

export function buildChapterEditorRuntimeProps(
  snapshot: EditorRuntimeSnapshot
): ChapterEditorRuntimeProps {
  return {
    adapterLabel: snapshot.adapterLabel,
    documentMode: snapshot.documentMode,
    activeRangeLabel: formatActiveRange(snapshot),
    ...(snapshot.selectionSummary === undefined
      ? {}
      : { selectionSummaryLabel: formatSelectionSummary(snapshot.selectionSummary) }),
    autosaveLabel:
      snapshot.saveStatus === "Recovery available" ? "Recovery draft available" : "Autosave armed",
    shortcutProfileLabel: "Default shortcuts",
    warnings: snapshot.warnings
  };
}

export function createEditorSelectionCommand(
  snapshot: EditorRuntimeSnapshot,
  commandId: string
): EditorSelectionCommand | undefined {
  if (snapshot.selectionSummary === undefined) {
    return undefined;
  }

  return {
    commandId,
    runtimeId: snapshot.runtimeId,
    selection: snapshot.selectionSummary
  };
}

export function createTextareaChapterEditorRuntimeProps(input: {
  readonly body: string;
  readonly saveStatus: SaveStatus;
}): ChapterEditorRuntimeProps {
  const adapter = createTextareaEditorRuntimeAdapter();
  const handle = adapter.mount(input);
  const lineCount = countLines(input.body);

  if (lineCount > 200) {
    handle.reportWarning("Large document optimizations active");
  }

  return buildChapterEditorRuntimeProps(handle.getSnapshot());
}

function formatActiveRange(snapshot: EditorRuntimeSnapshot): string {
  if (snapshot.selection !== undefined) {
    return `Selection ${snapshot.selection.anchor}-${snapshot.selection.head}`;
  }

  return `Lines 1-${Math.max(1, Math.min(countLines(snapshot.body), 120))}`;
}

function countLines(body: string): number {
  return body.length === 0 ? 1 : body.split("\n").length;
}

function summarizeSelection(
  body: string,
  selection: EditorRuntimeSelection
): EditorRuntimeSelectionSummary {
  const startOffset = clampOffset(Math.min(selection.anchor, selection.head), body);
  const endOffset = clampOffset(Math.max(selection.anchor, selection.head), body);
  const selectedText = body.slice(startOffset, endOffset);

  return {
    startOffset,
    endOffset,
    characterCount: endOffset - startOffset,
    lineStart: lineNumberForOffset(body, startOffset),
    lineEnd: lineNumberForOffset(body, endOffset),
    selectedTextPreview: selectedText.slice(0, 120),
    collapsed: startOffset === endOffset
  };
}

function clampOffset(value: number, body: string): number {
  return Math.min(Math.max(0, value), body.length);
}

function lineNumberForOffset(body: string, offset: number): number {
  return body.slice(0, offset).split("\n").length;
}

function formatSelectionSummary(selection: EditorRuntimeSelectionSummary): string {
  if (selection.collapsed) {
    return `Cursor line ${selection.lineStart}`;
  }

  return `Selection ${selection.characterCount} chars, lines ${selection.lineStart}-${selection.lineEnd}`;
}
