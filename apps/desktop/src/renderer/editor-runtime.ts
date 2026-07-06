import type { ChapterEditorRuntimeProps } from "@novel-studio/ui";
import type { SaveStatus } from "@novel-studio/application";

export interface EditorRuntimeSelection {
  readonly anchor: number;
  readonly head: number;
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

export function createTextareaEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return {
    runtimeId: "textarea",
    adapterLabel: "Textarea Runtime",
    mount(input) {
      let body = input.body;
      let selection: EditorRuntimeSelection | undefined;
      let focused = false;
      let destroyed = false;
      const warnings: string[] = [];

      return {
        getSnapshot() {
          return {
            runtimeId: "textarea",
            adapterLabel: "Textarea Runtime",
            documentMode: "Markdown",
            body,
            saveStatus: input.saveStatus,
            ...(selection === undefined ? {} : { selection }),
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
          input.onEvent?.({ kind: "body-changed", body: nextBody });
        },
        updateSelection(nextSelection) {
          if (destroyed) {
            return;
          }
          selection = nextSelection;
          input.onEvent?.({ kind: "selection-changed", selection: nextSelection });
        },
        requestSave() {
          if (destroyed) {
            return;
          }
          input.onEvent?.({ kind: "save-requested" });
        },
        dispatchCommand(commandId) {
          if (destroyed) {
            return;
          }
          input.onEvent?.({ kind: "command-dispatched", commandId });
        },
        reportWarning(message) {
          if (destroyed) {
            return;
          }
          if (!warnings.includes(message)) {
            warnings.push(message);
          }
          input.onEvent?.({ kind: "runtime-warning", message });
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
    autosaveLabel:
      snapshot.saveStatus === "Recovery available" ? "Recovery draft available" : "Autosave armed",
    shortcutProfileLabel: "Default shortcuts",
    warnings: snapshot.warnings
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
