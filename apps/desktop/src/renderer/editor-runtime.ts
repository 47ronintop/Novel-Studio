import type { ChapterEditorDiffPreview, ChapterEditorRuntimeProps } from "@novel-studio/ui";
import type { SaveStatus } from "@novel-studio/application";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const LARGE_DOCUMENT_LINE_THRESHOLD = 200;

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

export interface EditorSelectionAiPreviewDraft {
  readonly command: EditorSelectionCommand;
  readonly diffPreview: ChapterEditorDiffPreview;
  readonly previewOnly: true;
}

export interface EditorRuntimeDomMountTarget {
  readonly targetId: string;
  readonly ownerDocumentLabel: string;
}

export type EditorRuntimeDomViewMount =
  | {
      readonly status: "not-requested";
      readonly packageName: "@codemirror/view";
      readonly role: "dom-view";
      readonly fallbackRuntimeId: "textarea";
    }
  | {
      readonly status: "planned";
      readonly packageName: "@codemirror/view";
      readonly role: "dom-view";
      readonly targetId: string;
      readonly ownerDocumentLabel: string;
      readonly fallbackRuntimeId: "textarea";
    }
  | {
      readonly status: "mounted";
      readonly packageName: "@codemirror/view";
      readonly role: "dom-view";
      readonly targetId: string;
      readonly ownerDocumentLabel: string;
      readonly fallbackRuntimeId: "textarea";
    };

export interface EditorVisualDiffDecoration {
  readonly kind: "insert" | "delete" | "replace";
  readonly startOffset: number;
  readonly endOffset: number;
  readonly rangeSource: "body-match" | "document-end" | "full-document";
  readonly valuePreview: string;
  readonly previewOnly: true;
}

export interface EditorVisualDiffReview {
  readonly title: string;
  readonly previewOnly: true;
  readonly changeCount: number;
  readonly insertCount: number;
  readonly deleteCount: number;
  readonly replaceCount: number;
  readonly decorations: readonly EditorVisualDiffDecoration[];
}

export interface EditorLocalDiffReview {
  readonly title: string;
  readonly status: "reviewing";
  readonly runtimeId: string;
  readonly previewOnly: true;
  readonly fallbackRuntimeId: "textarea";
  readonly rollbackLabel: "Rollback to textarea runtime";
  readonly largeDocumentSmoke: {
    readonly status: "passed" | "not-required";
    readonly lineCount: number;
    readonly threshold: number;
  };
  readonly reviewActions: {
    readonly canAccept: boolean;
    readonly canReject: boolean;
    readonly canRollback: boolean;
  };
  readonly decorations: readonly EditorVisualDiffDecoration[];
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
  readonly runtimePackage?: {
    readonly name: "@codemirror/state";
    readonly role: "headless-state";
  };
  readonly runtimeViewPackage?: {
    readonly name: "@codemirror/view";
    readonly role: "dom-view";
  };
  readonly documentMode: string;
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly selection?: EditorRuntimeSelection;
  readonly selectionSummary?: EditorRuntimeSelectionSummary;
  readonly domViewMount?: EditorRuntimeDomViewMount;
  readonly focused: boolean;
  readonly destroyed: boolean;
  readonly warnings: readonly string[];
}

export interface EditorRuntimeMountInput {
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly domMountTarget?: EditorRuntimeDomMountTarget;
  readonly domMountElement?: unknown;
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

export interface EditorRuntimeDefaultReadinessInput {
  readonly codeMirrorEnabled?: boolean;
  readonly domViewMount?: EditorRuntimeDomViewMount;
  readonly eventParityPassed?: boolean;
  readonly fallbackRuntimeAvailable?: boolean;
  readonly largeDocumentSmokePassed?: boolean;
}

export interface EditorRuntimeDefaultReadinessDecision {
  readonly status: "ready" | "blocked";
  readonly recommendedDefaultRuntimeId: "textarea" | "codemirror";
  readonly fallbackRuntimeId: "textarea";
  readonly blockerMessages: readonly string[];
  readonly warningMessages: readonly string[];
  readonly migrationRisk: "low" | "medium" | "high";
}

export interface EditorRuntimeLargeDocumentBenchmark {
  readonly status: "passed" | "failed" | "not-run";
  readonly lineCount: number;
  readonly maxLatencyMs: number;
}

export interface EditorRuntimeMigrationGate {
  readonly schemaVersion: "1.0";
  readonly status: "ready" | "blocked";
  readonly defaultRuntimeId: "textarea" | "codemirror";
  readonly fallbackRuntimeId: "textarea";
  readonly canSwitchDefault: boolean;
  readonly label: string;
  readonly blockers: readonly string[];
  readonly evidence: {
    readonly readinessStatus: "ready" | "blocked";
    readonly e2eParityPassed: boolean;
    readonly largeDocumentBenchmark: EditorRuntimeLargeDocumentBenchmark;
    readonly rollbackReady: boolean;
  };
}

export function createTextareaEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return createMemoryBackedEditorRuntimeAdapter({
    runtimeId: "textarea",
    adapterLabel: "Textarea Runtime"
  });
}

export function createCodeMirrorEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return createCodeMirrorBackedEditorRuntimeAdapter();
}

export function resolveEditorRuntimeAdapter(
  options: EditorRuntimeResolverOptions = {}
): EditorRuntimeAdapter {
  if (options.preferredRuntimeId === "textarea" || options.codeMirrorEnabled === false) {
    return createTextareaEditorRuntimeAdapter();
  }

  return createCodeMirrorEditorRuntimeAdapter();
}

export function evaluateEditorRuntimeDefaultReadiness(
  input: EditorRuntimeDefaultReadinessInput
): EditorRuntimeDefaultReadinessDecision {
  const blockerMessages: string[] = [];
  const warningMessages: string[] = [];

  if (input.codeMirrorEnabled !== true) {
    blockerMessages.push("CodeMirror feature flag is not enabled.");
  }

  if (input.domViewMount === undefined || input.domViewMount.status === "not-requested") {
    blockerMessages.push("CodeMirror DOM view has not been requested.");
  } else if (input.domViewMount.status === "planned") {
    blockerMessages.push("CodeMirror DOM view is planned but not mounted.");
  }

  if (input.eventParityPassed !== true) {
    blockerMessages.push("Editor runtime event parity has not passed.");
  }

  if (input.fallbackRuntimeAvailable !== true) {
    blockerMessages.push("Textarea fallback runtime is not available.");
  }

  if (input.largeDocumentSmokePassed !== true) {
    blockerMessages.push("Large document runtime smoke test has not passed.");
  }

  const ready = blockerMessages.length === 0;

  return {
    status: ready ? "ready" : "blocked",
    recommendedDefaultRuntimeId: ready ? "codemirror" : "textarea",
    fallbackRuntimeId: "textarea",
    blockerMessages,
    warningMessages,
    migrationRisk: ready ? "low" : blockerMessages.length > 2 ? "high" : "medium"
  };
}

export function createEditorRuntimeMigrationGate(input: {
  readonly optInEnabled: boolean;
  readonly readiness: EditorRuntimeDefaultReadinessDecision;
  readonly e2eParityPassed: boolean;
  readonly largeDocumentBenchmark: EditorRuntimeLargeDocumentBenchmark;
  readonly rollbackReady: boolean;
}): EditorRuntimeMigrationGate {
  const blockers = [
    ...(input.optInEnabled ? [] : ["CodeMirror default opt-in is disabled."]),
    ...input.readiness.blockerMessages,
    ...(input.e2eParityPassed ? [] : ["CodeMirror E2E parity has not passed."]),
    ...(input.largeDocumentBenchmark.status === "passed"
      ? []
      : ["Large document benchmark has not passed."]),
    ...(input.rollbackReady ? [] : ["Textarea rollback is not ready."])
  ];
  const ready = blockers.length === 0;

  return {
    schemaVersion: "1.0",
    status: ready ? "ready" : "blocked",
    defaultRuntimeId: ready ? "codemirror" : "textarea",
    fallbackRuntimeId: "textarea",
    canSwitchDefault: ready,
    label: ready
      ? "CodeMirror default ready with textarea rollback"
      : `CodeMirror default blocked: ${formatMigrationGateBlockers(blockers)}`,
    blockers,
    evidence: {
      readinessStatus: input.readiness.status,
      e2eParityPassed: input.e2eParityPassed,
      largeDocumentBenchmark: input.largeDocumentBenchmark,
      rollbackReady: input.rollbackReady
    }
  };
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

function createCodeMirrorBackedEditorRuntimeAdapter(): EditorRuntimeAdapter {
  return {
    runtimeId: "codemirror",
    adapterLabel: "CodeMirror 6 Runtime",
    mount(mountInput) {
      let state = EditorState.create({ doc: mountInput.body });
      let view = createCodeMirrorDomView(state, mountInput.domMountElement);
      let selection: EditorRuntimeSelection | undefined;
      let focused = false;
      let destroyed = false;
      const warnings: string[] = [];

      function body(): string {
        return state.doc.toString();
      }

      function setBody(nextBody: string): void {
        state = state.update({
          changes: { from: 0, to: state.doc.length, insert: nextBody }
        }).state;
        view?.setState(state);
      }

      function setSelection(nextSelection: EditorRuntimeSelection): void {
        const anchor = clampCodeMirrorOffset(nextSelection.anchor, state);
        const head = clampCodeMirrorOffset(nextSelection.head, state);
        state = state.update({
          selection: EditorSelection.single(anchor, head)
        }).state;
        view?.setState(state);
        selection = nextSelection;
      }

      function domViewMount(): EditorRuntimeDomViewMount {
        if (mountInput.domMountTarget === undefined) {
          return {
            status: "not-requested",
            packageName: "@codemirror/view",
            role: "dom-view",
            fallbackRuntimeId: "textarea"
          };
        }

        if (mountInput.domMountElement !== undefined) {
          return {
            status: "mounted",
            packageName: "@codemirror/view",
            role: "dom-view",
            targetId: mountInput.domMountTarget.targetId,
            ownerDocumentLabel: mountInput.domMountTarget.ownerDocumentLabel,
            fallbackRuntimeId: "textarea"
          };
        }

        return {
          status: "planned",
          packageName: "@codemirror/view",
          role: "dom-view",
          targetId: mountInput.domMountTarget.targetId,
          ownerDocumentLabel: mountInput.domMountTarget.ownerDocumentLabel,
          fallbackRuntimeId: "textarea"
        };
      }

      return {
        getSnapshot() {
          const currentBody = body();
          return {
            runtimeId: "codemirror",
            adapterLabel: "CodeMirror 6 Runtime",
            runtimePackage: {
              name: "@codemirror/state",
              role: "headless-state"
            },
            ...(mountInput.domMountElement === undefined
              ? {}
              : {
                  runtimeViewPackage: {
                    name: "@codemirror/view",
                    role: "dom-view"
                  }
                }),
            documentMode: "Markdown",
            body: currentBody,
            saveStatus: mountInput.saveStatus,
            ...(selection === undefined ? {} : { selection }),
            ...(selection === undefined
              ? {}
              : { selectionSummary: summarizeSelection(currentBody, selection) }),
            domViewMount: domViewMount(),
            focused,
            destroyed,
            warnings
          };
        },
        applyExternalBody(nextBody) {
          if (destroyed) {
            return;
          }
          setBody(nextBody);
        },
        dispatchBodyChange(nextBody) {
          if (destroyed) {
            return;
          }
          setBody(nextBody);
          mountInput.onEvent?.({ kind: "body-changed", body: nextBody });
        },
        updateSelection(nextSelection) {
          if (destroyed) {
            return;
          }
          setSelection(nextSelection);
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
          view?.focus();
        },
        destroy() {
          destroyed = true;
          view?.destroy();
          view = undefined;
        }
      };
    }
  };
}

export function buildChapterEditorRuntimeProps(
  snapshot: EditorRuntimeSnapshot,
  diffPreview?: ChapterEditorDiffPreview,
  migrationGate?: EditorRuntimeMigrationGate
): ChapterEditorRuntimeProps {
  const visualDiffReview =
    diffPreview === undefined ? undefined : createEditorVisualDiffReview(snapshot, diffPreview);
  const localDiffReview =
    diffPreview === undefined ? undefined : createEditorLocalDiffReview(snapshot, diffPreview);

  return {
    runtimeId: snapshot.runtimeId === "codemirror" ? "codemirror" : "textarea",
    adapterLabel: snapshot.adapterLabel,
    documentMode: snapshot.documentMode,
    activeRangeLabel: formatActiveRange(snapshot),
    cursorPositionLabel: formatCursorPosition(snapshot),
    ...(snapshot.selectionSummary === undefined
      ? {}
      : { selectionSummaryLabel: formatSelectionSummary(snapshot.selectionSummary) }),
    ...(snapshot.selectionSummary === undefined || snapshot.selectionSummary.collapsed
      ? {}
      : {
          selectionAiPreviewCommand: {
            commandId: "editor.ai.preview-selection",
            label: "Preview selection rewrite"
          }
        }),
    ...(visualDiffReview === undefined
      ? {}
      : { visualDiffSummaryLabel: formatVisualDiffSummary(visualDiffReview) }),
    ...(localDiffReview === undefined
      ? {}
      : { localDiffReviewLabel: formatLocalDiffReviewSummary(localDiffReview) }),
    ...(migrationGate === undefined ? {} : { migrationGateLabel: migrationGate.label }),
    autosaveLabel:
      snapshot.saveStatus === "Recovery available" ? "Recovery draft available" : "Autosave armed",
    shortcutProfileLabel: "Default shortcuts",
    warnings: snapshot.warnings
  };
}

function formatCursorPosition(snapshot: EditorRuntimeSnapshot): string {
  const selection = snapshot.selection;
  if (selection !== undefined && selection.anchor !== selection.head) {
    return `已选择 ${Math.abs(selection.head - selection.anchor)} 字`;
  }

  const offset = Math.max(0, Math.min(selection?.head ?? 0, snapshot.body.length));
  const lines = snapshot.body.slice(0, offset).split("\n");
  return `行 ${lines.length}，列 ${(lines.at(-1)?.length ?? 0) + 1}`;
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

export function createEditorVisualDiffReview(
  snapshot: EditorRuntimeSnapshot,
  diffPreview: ChapterEditorDiffPreview
): EditorVisualDiffReview {
  return {
    title: diffPreview.title,
    previewOnly: true,
    changeCount: diffPreview.changes.length,
    insertCount: diffPreview.changes.filter((change) => change.kind === "insert").length,
    deleteCount: diffPreview.changes.filter((change) => change.kind === "delete").length,
    replaceCount: diffPreview.changes.filter((change) => change.kind === "replace").length,
    decorations: diffPreview.changes.map((change) =>
      createVisualDiffDecoration(snapshot.body, change)
    )
  };
}

export function createEditorLocalDiffReview(
  snapshot: EditorRuntimeSnapshot,
  diffPreview: ChapterEditorDiffPreview
): EditorLocalDiffReview {
  const lineCount = countLines(snapshot.body);

  return {
    title: diffPreview.title,
    status: "reviewing",
    runtimeId: snapshot.runtimeId,
    previewOnly: true,
    fallbackRuntimeId: "textarea",
    rollbackLabel: "Rollback to textarea runtime",
    largeDocumentSmoke: {
      status: lineCount > LARGE_DOCUMENT_LINE_THRESHOLD ? "passed" : "not-required",
      lineCount,
      threshold: LARGE_DOCUMENT_LINE_THRESHOLD
    },
    reviewActions: {
      canAccept: true,
      canReject: true,
      canRollback: snapshot.runtimeId !== "textarea"
    },
    decorations: createEditorVisualDiffReview(snapshot, diffPreview).decorations
  };
}

export function createSelectionAwareAiPreviewDraft(input: {
  readonly snapshot: EditorRuntimeSnapshot;
  readonly commandId: string;
  readonly proposedText: string;
}): EditorSelectionAiPreviewDraft | undefined {
  const command = createEditorSelectionCommand(input.snapshot, input.commandId);
  if (command === undefined || command.selection.collapsed) {
    return undefined;
  }

  const nextBody = `${input.snapshot.body.slice(0, command.selection.startOffset)}${
    input.proposedText
  }${input.snapshot.body.slice(command.selection.endOffset)}`;

  return {
    command,
    diffPreview: {
      title: "Selection AI preview",
      changes: [
        {
          kind: "replace",
          value: nextBody
        }
      ]
    },
    previewOnly: true
  };
}

export function createTextareaChapterEditorRuntimeProps(input: {
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly selection?: EditorRuntimeSelection;
  readonly diffPreview?: ChapterEditorDiffPreview;
}): ChapterEditorRuntimeProps {
  return createChapterEditorRuntimeProps({
    ...input,
    preferredRuntimeId: "textarea",
    codeMirrorEnabled: false
  });
}

export function createChapterEditorRuntimeProps(input: {
  readonly body: string;
  readonly saveStatus: SaveStatus;
  readonly selection?: EditorRuntimeSelection;
  readonly diffPreview?: ChapterEditorDiffPreview;
  readonly preferredRuntimeId?: EditorRuntimeResolverOptions["preferredRuntimeId"];
  readonly codeMirrorEnabled?: boolean;
}): ChapterEditorRuntimeProps {
  const adapter = resolveEditorRuntimeAdapter({
    ...(input.preferredRuntimeId === undefined
      ? {}
      : { preferredRuntimeId: input.preferredRuntimeId }),
    ...(input.codeMirrorEnabled === undefined ? {} : { codeMirrorEnabled: input.codeMirrorEnabled })
  });
  const handle = adapter.mount({
    body: input.body,
    saveStatus: input.saveStatus
  });
  const lineCount = countLines(input.body);

  if (input.selection !== undefined) {
    handle.updateSelection(input.selection);
  }

  if (lineCount > LARGE_DOCUMENT_LINE_THRESHOLD) {
    handle.reportWarning("Large document optimizations active");
  }

  return buildChapterEditorRuntimeProps(handle.getSnapshot(), input.diffPreview);
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

function clampCodeMirrorOffset(value: number, state: EditorState): number {
  return Math.min(Math.max(0, value), state.doc.length);
}

function createCodeMirrorDomView(state: EditorState, parent: unknown): EditorView | undefined {
  if (parent === undefined || !isDomParent(parent)) {
    return undefined;
  }

  return new EditorView({ state, parent });
}

function isDomParent(value: unknown): value is Element | DocumentFragment {
  return (
    typeof value === "object" &&
    value !== null &&
    "appendChild" in value &&
    "ownerDocument" in value
  );
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

function createVisualDiffDecoration(
  body: string,
  change: ChapterEditorDiffPreview["changes"][number]
): EditorVisualDiffDecoration {
  if (change.kind === "insert") {
    return {
      kind: change.kind,
      startOffset: body.length,
      endOffset: body.length,
      rangeSource: "document-end",
      valuePreview: previewValue(change.value),
      previewOnly: true
    };
  }

  const startOffset = body.indexOf(change.value);
  if (startOffset >= 0) {
    return {
      kind: change.kind,
      startOffset,
      endOffset: startOffset + change.value.length,
      rangeSource: "body-match",
      valuePreview: previewValue(change.value),
      previewOnly: true
    };
  }

  return {
    kind: change.kind,
    startOffset: 0,
    endOffset: body.length,
    rangeSource: "full-document",
    valuePreview: previewValue(change.value),
    previewOnly: true
  };
}

function previewValue(value: string): string {
  return value.slice(0, 120);
}

function formatVisualDiffSummary(review: EditorVisualDiffReview): string {
  return `Visual diff preview: ${review.changeCount} ${
    review.changeCount === 1 ? "change" : "changes"
  }`;
}

function formatLocalDiffReviewSummary(review: EditorLocalDiffReview): string {
  return `Local diff review: ${review.decorations.length} ${
    review.decorations.length === 1 ? "change" : "changes"
  }, rollback ${review.fallbackRuntimeId}`;
}

function formatMigrationGateBlockers(blockers: readonly string[]): string {
  return blockers
    .map((blocker) => {
      if (blocker === "CodeMirror default opt-in is disabled.") {
        return "opt-in disabled";
      }
      if (blocker === "Textarea rollback is not ready.") {
        return "rollback unavailable";
      }
      return blocker.toLowerCase();
    })
    .join(", ");
}
