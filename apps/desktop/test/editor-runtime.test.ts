import { describe, expect, test } from "vitest";

import {
  buildChapterEditorRuntimeProps,
  createCodeMirrorEditorRuntimeAdapter,
  createTextareaEditorRuntimeAdapter,
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
      adapterLabel: "Textarea Runtime",
      documentMode: "Markdown",
      activeRangeLabel: "Lines 1-2",
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
  test("defaults to textarea when CodeMirror is requested without the feature flag", () => {
    const adapter = resolveEditorRuntimeAdapter({
      preferredRuntimeId: "codemirror",
      codeMirrorEnabled: false
    });

    expect(adapter.runtimeId).toBe("textarea");
    expect(adapter.adapterLabel).toBe("Textarea Runtime");
  });

  test("selects CodeMirror only when the feature flag is enabled", () => {
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
      adapterLabel: "CodeMirror Adapter (flagged)",
      documentMode: "Markdown",
      body: "Flagged body\nNext"
    });
    expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
      adapterLabel: "CodeMirror Adapter (flagged)",
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
    expect(adapter.adapterLabel).toBe("CodeMirror Adapter (flagged)");
  });
});
