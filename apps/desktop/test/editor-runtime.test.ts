import { describe, expect, test } from "vitest";

import {
  buildChapterEditorRuntimeProps,
  createChapterEditorRuntimeProps,
  createCodeMirrorEditorRuntimeAdapter,
  createEditorSelectionCommand,
  createEditorVisualDiffReview,
  createSelectionAwareAiPreviewDraft,
  createTextareaChapterEditorRuntimeProps,
  createTextareaEditorRuntimeAdapter,
  createEditorLocalDiffReview,
  createEditorRuntimeMigrationGate,
  evaluateEditorRuntimeDefaultReadiness,
  resolveEditorRuntimeAdapter,
  type EditorRuntimeEvent
} from "../src/renderer/editor-runtime.js";

describe("textarea editor runtime adapter", () => {
  test("mounts a textarea runtime and derives ChapterEditor runtime props", () => {
    const adapter = createTextareaEditorRuntimeAdapter();
    const handle = adapter.mount({
      body: "First line\nSecond line",
      saveStatus: "Saved"
    });

    expect(handle.getSnapshot()).toMatchObject({
      runtimeId: "textarea",
      adapterLabel: "Textarea Runtime",
      documentMode: "Markdown",
      body: "First line\nSecond line",
      focused: false,
      destroyed: false
    });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toEqual({
      runtimeId: "textarea",
      adapterLabel: "Textarea Runtime",
      documentMode: "Markdown",
      activeRangeLabel: "Lines 1-2",
      cursorPositionLabel: "行 1，列 1",
      autosaveLabel: "Autosave armed",
      shortcutProfileLabel: "Default shortcuts",
      warnings: []
    });
  });

  test("emits structured body, save, selection, command, and warning events", () => {
    const events: EditorRuntimeEvent[] = [];
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Opening line",
      saveStatus: "Unsaved",
      onEvent: (event) => events.push(event)
    });

    handle.dispatchBodyChange("Opening line\nNext line");
    handle.updateSelection({ anchor: 0, head: 7 });
    handle.requestSave();
    handle.dispatchCommand("editor.toggle-bold");
    handle.reportWarning("Large document optimizations active");

    expect(events).toEqual([
      {
        kind: "body-changed",
        body: "Opening line\nNext line"
      },
      {
        kind: "selection-changed",
        selection: { anchor: 0, head: 7 }
      },
      {
        kind: "save-requested"
      },
      {
        kind: "command-dispatched",
        commandId: "editor.toggle-bold"
      },
      {
        kind: "runtime-warning",
        message: "Large document optimizations active"
      }
    ]);
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      activeRangeLabel: "Selection 0-7",
      autosaveLabel: "Autosave armed",
      warnings: ["Large document optimizations active"]
    });
  });

  test("derives real cursor position and selection length labels", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "First\nSecond line",
      saveStatus: "Saved"
    });

    handle.updateSelection({ anchor: 8, head: 8 });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      cursorPositionLabel: "行 2，列 3"
    });

    handle.updateSelection({ anchor: 0, head: 5 });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      cursorPositionLabel: "已选择 5 字"
    });
  });

  test("updates external body, focus state, and destroyed lifecycle without file access", () => {
    const events: EditorRuntimeEvent[] = [];
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Before",
      saveStatus: "Recovery available",
      onEvent: (event) => events.push(event)
    });

    handle.applyExternalBody("After");
    handle.focus();
    handle.destroy();
    handle.dispatchBodyChange("Ignored after destroy");

    expect(handle.getSnapshot()).toMatchObject({
      body: "After",
      focused: true,
      destroyed: true
    });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot()).autosaveLabel).toBe(
      "Recovery draft available"
    );
    expect(events).toEqual([]);
  });
});

describe("editor runtime adapter resolver", () => {
  test("uses CodeMirror as the default runtime with textarea fallback available", () => {
    const adapter = resolveEditorRuntimeAdapter();
    const handle = adapter.mount({
      body: "Default runtime body",
      saveStatus: "Saved"
    });

    expect(adapter.runtimeId).toBe("codemirror");
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      adapterLabel: "CodeMirror 6 Runtime",
      activeRangeLabel: "Lines 1-1"
    });
  });

  test("keeps textarea recommended while CodeMirror default readiness has blockers", () => {
    const readiness = evaluateEditorRuntimeDefaultReadiness({
      codeMirrorEnabled: true,
      domViewMount: {
        status: "planned",
        packageName: "@codemirror/view",
        role: "dom-view",
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document",
        fallbackRuntimeId: "textarea"
      },
      eventParityPassed: true,
      fallbackRuntimeAvailable: true,
      largeDocumentSmokePassed: true
    });

    expect(readiness).toEqual({
      status: "blocked",
      recommendedDefaultRuntimeId: "textarea",
      fallbackRuntimeId: "textarea",
      blockerMessages: ["CodeMirror DOM view is planned but not mounted."],
      warningMessages: [],
      migrationRisk: "medium"
    });
  });

  test("recommends CodeMirror only after default readiness evidence passes", () => {
    const readiness = evaluateEditorRuntimeDefaultReadiness({
      codeMirrorEnabled: true,
      domViewMount: {
        status: "mounted",
        packageName: "@codemirror/view",
        role: "dom-view",
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document",
        fallbackRuntimeId: "textarea"
      },
      eventParityPassed: true,
      fallbackRuntimeAvailable: true,
      largeDocumentSmokePassed: true
    });

    expect(readiness).toEqual({
      status: "ready",
      recommendedDefaultRuntimeId: "codemirror",
      fallbackRuntimeId: "textarea",
      blockerMessages: [],
      warningMessages: [],
      migrationRisk: "low"
    });
  });

  test("defaults to textarea when CodeMirror is requested without the feature flag", () => {
    const adapter = resolveEditorRuntimeAdapter({
      preferredRuntimeId: "codemirror",
      codeMirrorEnabled: false
    });

    expect(adapter.runtimeId).toBe("textarea");
    expect(adapter.adapterLabel).toBe("Textarea Runtime");
  });

  test("selects CodeMirror when the feature flag is enabled", () => {
    const adapter = resolveEditorRuntimeAdapter({
      preferredRuntimeId: "codemirror",
      codeMirrorEnabled: true
    });
    const events: EditorRuntimeEvent[] = [];
    const handle = adapter.mount({
      body: "Flagged body",
      saveStatus: "Saved",
      onEvent: (event) => events.push(event)
    });

    handle.dispatchBodyChange("Flagged body\nNext");
    handle.updateSelection({ anchor: 2, head: 9 });

    expect(adapter.runtimeId).toBe("codemirror");
    expect(handle.getSnapshot()).toMatchObject({
      runtimeId: "codemirror",
      adapterLabel: "CodeMirror 6 Runtime",
      documentMode: "Markdown",
      body: "Flagged body\nNext",
      runtimePackage: {
        name: "@codemirror/state",
        role: "headless-state"
      }
    });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      adapterLabel: "CodeMirror 6 Runtime",
      activeRangeLabel: "Selection 2-9"
    });
    expect(events).toEqual([
      { kind: "body-changed", body: "Flagged body\nNext" },
      { kind: "selection-changed", selection: { anchor: 2, head: 9 } }
    ]);
  });

  test("exposes an explicit CodeMirror adapter contract for parity tests", () => {
    const adapter = createCodeMirrorEditorRuntimeAdapter();

    expect(adapter.runtimeId).toBe("codemirror");
    expect(adapter.adapterLabel).toBe("CodeMirror 6 Runtime");
  });

  test("keeps CodeMirror package-backed selection parity with textarea runtime events", () => {
    const events: EditorRuntimeEvent[] = [];
    const handle = createCodeMirrorEditorRuntimeAdapter().mount({
      body: "Alpha\nBeta\nGamma",
      saveStatus: "Saved",
      onEvent: (event) => events.push(event)
    });

    handle.updateSelection({ anchor: 14, head: 6 });
    handle.dispatchBodyChange("Alpha\nBeta revised\nGamma");

    expect(handle.getSnapshot().selectionSummary).toMatchObject({
      startOffset: 6,
      endOffset: 14,
      selectedTextPreview: "Beta rev"
    });
    expect(handle.getSnapshot().body).toBe("Alpha\nBeta revised\nGamma");
    expect(events).toEqual([
      { kind: "selection-changed", selection: { anchor: 14, head: 6 } },
      { kind: "body-changed", body: "Alpha\nBeta revised\nGamma" }
    ]);
  });

  test("keeps CodeMirror DOM view unmounted unless an explicit mount target is provided", () => {
    const textareaSnapshot = createTextareaEditorRuntimeAdapter()
      .mount({
        body: "Plain textarea",
        saveStatus: "Saved"
      })
      .getSnapshot();
    const codeMirrorSnapshot = createCodeMirrorEditorRuntimeAdapter()
      .mount({
        body: "CodeMirror body",
        saveStatus: "Saved"
      })
      .getSnapshot();

    expect(textareaSnapshot.domViewMount).toBeUndefined();
    expect(codeMirrorSnapshot.domViewMount).toEqual({
      status: "not-requested",
      packageName: "@codemirror/view",
      role: "dom-view",
      fallbackRuntimeId: "textarea"
    });
  });

  test("creates a CodeMirror DOM mount plan behind the adapter boundary", () => {
    const handle = createCodeMirrorEditorRuntimeAdapter().mount({
      body: "CodeMirror body",
      saveStatus: "Saved",
      domMountTarget: {
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document"
      }
    });

    expect(handle.getSnapshot().domViewMount).toEqual({
      status: "planned",
      packageName: "@codemirror/view",
      role: "dom-view",
      targetId: "chapter-editor-root",
      ownerDocumentLabel: "renderer-document",
      fallbackRuntimeId: "textarea"
    });
  });

  test("records an explicit CodeMirror DOM view mount request with view package metadata", () => {
    const mountInput = {
      body: "CodeMirror view body",
      saveStatus: "Saved" as const,
      domMountTarget: {
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document"
      },
      domMountElement: { nodeType: 1 }
    };

    const handle = createCodeMirrorEditorRuntimeAdapter().mount(mountInput);

    expect(handle.getSnapshot()).toMatchObject({
      runtimeViewPackage: {
        name: "@codemirror/view",
        role: "dom-view"
      },
      domViewMount: {
        status: "mounted",
        packageName: "@codemirror/view",
        role: "dom-view",
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document",
        fallbackRuntimeId: "textarea"
      }
    });
  });

  test("summarizes normalized editor selections for future focused commands", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "First line\nSecond line\nThird line",
      saveStatus: "Saved"
    });

    handle.updateSelection({ anchor: 22, head: 6 });

    expect(handle.getSnapshot().selectionSummary).toEqual({
      startOffset: 6,
      endOffset: 22,
      characterCount: 16,
      lineStart: 1,
      lineEnd: 2,
      selectedTextPreview: "line\nSecond line",
      collapsed: false
    });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot()).selectionSummaryLabel).toBe(
      "Selection 16 chars, lines 1-2"
    );
  });

  test("creates selection command DTOs without executing AI actions", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Alpha\nBeta",
      saveStatus: "Saved"
    });
    handle.updateSelection({ anchor: 7, head: 7 });

    expect(
      createEditorSelectionCommand(handle.getSnapshot(), "editor.ai.rewrite-selection")
    ).toEqual({
      commandId: "editor.ai.rewrite-selection",
      runtimeId: "textarea",
      selection: {
        startOffset: 7,
        endOffset: 7,
        characterCount: 0,
        lineStart: 2,
        lineEnd: 2,
        selectedTextPreview: "",
        collapsed: true
      }
    });
  });

  test("derives preview-only visual diff review metadata for runtime decorations", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Original paragraph.\n",
      saveStatus: "Saved"
    });

    const review = createEditorVisualDiffReview(handle.getSnapshot(), {
      title: "AI suggestion",
      changes: [
        { kind: "delete", value: "Original paragraph.\n" },
        { kind: "insert", value: "Rewritten paragraph.\n" }
      ]
    });

    expect(review).toEqual({
      title: "AI suggestion",
      previewOnly: true,
      changeCount: 2,
      insertCount: 1,
      deleteCount: 1,
      replaceCount: 0,
      decorations: [
        {
          kind: "delete",
          startOffset: 0,
          endOffset: 20,
          rangeSource: "body-match",
          valuePreview: "Original paragraph.\n",
          previewOnly: true
        },
        {
          kind: "insert",
          startOffset: 20,
          endOffset: 20,
          rangeSource: "document-end",
          valuePreview: "Rewritten paragraph.\n",
          previewOnly: true
        }
      ]
    });
    expect(
      buildChapterEditorRuntimeProps(handle.getSnapshot(), {
        title: "AI suggestion",
        changes: [{ kind: "insert", value: "Rewritten paragraph.\n" }]
      }).visualDiffSummaryLabel
    ).toBe("Visual diff preview: 1 change");
  });

  test("creates local diff review metadata with fallback rollback and large document smoke evidence", () => {
    const handle = createCodeMirrorEditorRuntimeAdapter().mount({
      body: Array.from({ length: 220 }, (_, index) => `Line ${index + 1}`).join("\n"),
      saveStatus: "Saved",
      domMountTarget: {
        targetId: "chapter-editor-root",
        ownerDocumentLabel: "renderer-document"
      },
      domMountElement: { nodeType: 1 }
    });

    const review = createEditorLocalDiffReview(handle.getSnapshot(), {
      title: "Local diff review",
      changes: [{ kind: "replace", value: "Line 1" }]
    });

    expect(review).toMatchObject({
      title: "Local diff review",
      status: "reviewing",
      runtimeId: "codemirror",
      previewOnly: true,
      fallbackRuntimeId: "textarea",
      rollbackLabel: "Rollback to textarea runtime",
      largeDocumentSmoke: {
        status: "passed",
        lineCount: 220,
        threshold: 200
      },
      reviewActions: {
        canAccept: true,
        canReject: true,
        canRollback: true
      }
    });
    expect(review.decorations[0]).toMatchObject({
      kind: "replace",
      rangeSource: "body-match",
      valuePreview: "Line 1",
      previewOnly: true
    });
    expect(
      buildChapterEditorRuntimeProps(handle.getSnapshot(), {
        title: "Local diff review",
        changes: [{ kind: "replace", value: "Line 1" }]
      }).localDiffReviewLabel
    ).toBe("Local diff review: 1 change, rollback textarea");
  });

  test("blocks CodeMirror default migration without opt-in rollback evidence", () => {
    const gate = createEditorRuntimeMigrationGate({
      optInEnabled: false,
      readiness: evaluateEditorRuntimeDefaultReadiness({
        codeMirrorEnabled: true,
        domViewMount: {
          status: "mounted",
          packageName: "@codemirror/view",
          role: "dom-view",
          targetId: "chapter-editor-root",
          ownerDocumentLabel: "renderer-document",
          fallbackRuntimeId: "textarea"
        },
        eventParityPassed: true,
        fallbackRuntimeAvailable: true,
        largeDocumentSmokePassed: true
      }),
      e2eParityPassed: true,
      largeDocumentBenchmark: {
        status: "passed",
        lineCount: 1200,
        maxLatencyMs: 32
      },
      rollbackReady: false
    });

    expect(gate).toEqual({
      schemaVersion: "1.0",
      status: "blocked",
      defaultRuntimeId: "textarea",
      fallbackRuntimeId: "textarea",
      canSwitchDefault: false,
      label: "CodeMirror default blocked: opt-in disabled, rollback unavailable",
      blockers: ["CodeMirror default opt-in is disabled.", "Textarea rollback is not ready."],
      evidence: {
        readinessStatus: "ready",
        e2eParityPassed: true,
        largeDocumentBenchmark: {
          status: "passed",
          lineCount: 1200,
          maxLatencyMs: 32
        },
        rollbackReady: false
      }
    });
  });

  test("allows CodeMirror default migration only when every gate passes", () => {
    const gate = createEditorRuntimeMigrationGate({
      optInEnabled: true,
      readiness: evaluateEditorRuntimeDefaultReadiness({
        codeMirrorEnabled: true,
        domViewMount: {
          status: "mounted",
          packageName: "@codemirror/view",
          role: "dom-view",
          targetId: "chapter-editor-root",
          ownerDocumentLabel: "renderer-document",
          fallbackRuntimeId: "textarea"
        },
        eventParityPassed: true,
        fallbackRuntimeAvailable: true,
        largeDocumentSmokePassed: true
      }),
      e2eParityPassed: true,
      largeDocumentBenchmark: {
        status: "passed",
        lineCount: 1200,
        maxLatencyMs: 28
      },
      rollbackReady: true
    });

    expect(gate).toMatchObject({
      status: "ready",
      defaultRuntimeId: "codemirror",
      canSwitchDefault: true,
      label: "CodeMirror default ready with textarea rollback"
    });
    expect(
      buildChapterEditorRuntimeProps(
        createCodeMirrorEditorRuntimeAdapter()
          .mount({
            body: "Ready",
            saveStatus: "Saved",
            domMountTarget: {
              targetId: "chapter-editor-root",
              ownerDocumentLabel: "renderer-document"
            },
            domMountElement: { nodeType: 1 }
          })
          .getSnapshot(),
        undefined,
        gate
      ).migrationGateLabel
    ).toBe("CodeMirror default ready with textarea rollback");
  });

  test("creates selection-aware AI preview drafts without applying content", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Alpha sentence.\nBeta sentence.",
      saveStatus: "Saved"
    });
    handle.updateSelection({ anchor: 0, head: 15 });

    expect(
      createSelectionAwareAiPreviewDraft({
        snapshot: handle.getSnapshot(),
        commandId: "editor.ai.preview-selection",
        proposedText: "Rewritten alpha sentence."
      })
    ).toEqual({
      command: {
        commandId: "editor.ai.preview-selection",
        runtimeId: "textarea",
        selection: {
          startOffset: 0,
          endOffset: 15,
          characterCount: 15,
          lineStart: 1,
          lineEnd: 1,
          selectedTextPreview: "Alpha sentence.",
          collapsed: false
        }
      },
      diffPreview: {
        title: "Selection AI preview",
        changes: [
          {
            kind: "replace",
            value: "Rewritten alpha sentence.\nBeta sentence."
          }
        ]
      },
      previewOnly: true
    });
  });

  test("derives textarea runtime props from explicit UI selection events", () => {
    expect(
      createTextareaChapterEditorRuntimeProps({
        body: "Alpha sentence.\nBeta sentence.",
        saveStatus: "Saved",
        selection: {
          anchor: 0,
          head: 15
        }
      })
    ).toMatchObject({
      activeRangeLabel: "Selection 0-15",
      selectionSummaryLabel: "Selection 15 chars, lines 1-1",
      selectionAiPreviewCommand: {
        commandId: "editor.ai.preview-selection",
        label: "Preview selection rewrite"
      }
    });
  });

  test("derives default CodeMirror chapter runtime props and preserves explicit textarea fallback", () => {
    expect(
      createChapterEditorRuntimeProps({
        body: "Alpha sentence.\nBeta sentence.",
        saveStatus: "Saved",
        selection: {
          anchor: 0,
          head: 15
        }
      })
    ).toMatchObject({
      adapterLabel: "CodeMirror 6 Runtime",
      activeRangeLabel: "Selection 0-15",
      selectionSummaryLabel: "Selection 15 chars, lines 1-1",
      selectionAiPreviewCommand: {
        commandId: "editor.ai.preview-selection",
        label: "Preview selection rewrite"
      }
    });

    expect(
      createChapterEditorRuntimeProps({
        body: "Alpha sentence.",
        saveStatus: "Saved",
        preferredRuntimeId: "textarea",
        codeMirrorEnabled: false
      })
    ).toMatchObject({
      adapterLabel: "Textarea Runtime",
      activeRangeLabel: "Lines 1-1"
    });
  });

  test("rejects selection-aware AI preview drafts for collapsed selections", () => {
    const handle = createTextareaEditorRuntimeAdapter().mount({
      body: "Alpha sentence.",
      saveStatus: "Saved"
    });
    handle.updateSelection({ anchor: 5, head: 5 });

    expect(
      createSelectionAwareAiPreviewDraft({
        snapshot: handle.getSnapshot(),
        commandId: "editor.ai.preview-selection",
        proposedText: "Replacement"
      })
    ).toBeUndefined();
  });
});
