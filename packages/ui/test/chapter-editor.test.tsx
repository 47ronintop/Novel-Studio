// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ChapterEditor } from "../src/chapter-editor.js";
import {
  CodeMirrorDocumentEditor,
  type CodeMirrorDocumentSelection
} from "../src/codemirror-document-editor.js";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const chapter = {
  frontmatter: {
    schemaVersion: "1.0" as const,
    id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
    type: "chapter" as const,
    title: "第一章",
    order: 1,
    status: "draft" as const,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "原始章节正文。\n"
};

describe("ChapterEditor", () => {
  test("renders dirty and saved states without exposing filesystem access", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[
          {
            versionId: "ver_01",
            label: "Before AI apply",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        ]}
        diffPreview={{
          title: "AI suggestion",
          changes: [
            {
              kind: "insert",
              value: "A revised opening paragraph.\n"
            }
          ]
        }}
      />
    );

    expect(html).toContain('data-dirty="true"');
    expect(html).not.toContain("未保存");
    expect(html).not.toContain("已修改");
    expect(html).toContain("版本历史");
    expect(html).toContain("AI suggestion");
    expect(html).not.toMatch(/fs|filesystem|node:/i);
  });

  test("renders callback-driven save, version preview, restore, and preview-only AI diff controls", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[
          {
            versionId: "ver_manual_save",
            label: "Manual save",
            createdAt: "2026-07-04T00:00:00.000Z"
          }
        ]}
        diffPreview={{
          title: "AI suggestion",
          changes: [
            {
              kind: "replace",
              value: "AI revised opening.\n"
            }
          ]
        }}
        onBodyChange={() => undefined}
        onSave={() => undefined}
        onVersionPreview={() => undefined}
        onVersionRestore={() => undefined}
      />
    );

    expect(html).not.toContain('aria-label="保存章节"');
    expect(html).toContain('aria-label="预览版本 Manual save"');
    expect(html).toContain('aria-label="恢复版本 Manual save"');
    expect(html).toContain("仅预览");
    expect(html).not.toContain("Apply suggestion");
  });

  test("renders large-document metrics, capped line gutter, and diff summary", () => {
    const largeBody = Array.from({ length: 260 }, (_, index) => `Line ${index + 1}`).join("\n");
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={{
          ...chapter,
          body: largeBody
        }}
        saveStatus="Saved"
        dirty={false}
        versionHistory={[]}
        diffPreview={{
          title: "AI suggestion",
          changes: [
            {
              kind: "insert",
              value: "New paragraph.\n"
            },
            {
              kind: "delete",
              value: "Old paragraph.\n"
            },
            {
              kind: "replace",
              value: "Rewritten paragraph.\n"
            }
          ]
        }}
      />
    );

    expect(html).toContain("Diff summary: 1 insert / 1 delete / 1 replace");
    expect(html).toContain('data-large-document="true"');
    expect(html).toContain('data-runtime-id="textarea"');
    expect(html.match(/ns-editor-line-number/g)?.length).toBe(120);
  });

  test("keeps editor chrome out of the document body while applying style preferences", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={{
          ...chapter,
          body: "她走进雨里。\nA quiet room waits."
        }}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[]}
        editorPreferences={{
          fontFamily: "serif",
          fontSize: 16,
          lineHeight: 1.8
        }}
        onEditorPreferencesChange={() => undefined}
        onFocusModeToggle={() => undefined}
      />
    );

    expect(html).not.toContain('class="ns-editor-header"');
    expect(html).not.toContain('aria-label="Editor document metrics"');
    expect(html).not.toContain('aria-label="编辑器工具栏"');
    expect(html).not.toContain('aria-label="保存章节"');
    expect(html).toContain("--ns-editor-font-size:16px");
    expect(html).toContain("--ns-editor-line-height:1.8");
  });

  test("renders editor runtime status without filesystem details", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[]}
        runtime={{
          adapterLabel: "Textarea Runtime",
          documentMode: "Markdown",
          activeRangeLabel: "Lines 1-1",
          selectionAiPreviewCommand: {
            commandId: "editor.ai.preview-selection",
            label: "Preview selection rewrite"
          },
          visualDiffSummaryLabel: "Visual diff preview: 2 changes",
          localDiffReviewLabel: "Local diff review: 2 changes, rollback textarea",
          migrationGateLabel: "CodeMirror default blocked: opt-in disabled",
          autosaveLabel: "Autosave armed",
          shortcutProfileLabel: "Default shortcuts",
          warnings: ["Large document optimizations inactive"]
        }}
        onSelectionAiPreview={() => undefined}
      />
    );

    expect(html).toContain('aria-label="Editor Runtime"');
    expect(html).toContain("基础编辑器");
    expect(html).toContain("Markdown");
    expect(html).toContain("第 1-1 行");
    expect(html).toContain('aria-label="Preview selection rewrite"');
    expect(html).toContain("Preview selection rewrite");
    expect(html).toContain("Visual diff preview: 2 changes");
    expect(html).toContain("Local diff review: 2 changes, rollback textarea");
    expect(html).toContain("CodeMirror default blocked: opt-in disabled");
    expect(html).toContain("自动保存已启用");
    expect(html).toContain("默认快捷键");
    expect(html).toContain("Large document optimizations inactive");
    expect(html).not.toMatch(/filesystem|node:fs|projectRoot/i);
  });

  test("marks the editor surface when the CodeMirror runtime is active", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[]}
        runtime={{
          runtimeId: "codemirror",
          adapterLabel: "CodeMirror 6 Runtime",
          documentMode: "Markdown",
          activeRangeLabel: "Lines 1-1",
          autosaveLabel: "Autosave armed",
          shortcutProfileLabel: "Default shortcuts",
          warnings: []
        }}
      />
    );

    expect(html).toContain('data-runtime-id="codemirror"');
    expect(html).toContain("CodeMirror 6 Runtime");
    expect(html).not.toMatch(/filesystem|node:fs|projectRoot/i);
  });

  test("mounts a real CodeMirror editor surface for the CodeMirror runtime", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <ChapterEditor
            chapter={chapter}
            saveStatus="Unsaved"
            dirty={true}
            versionHistory={[]}
            runtime={{
              runtimeId: "codemirror",
              adapterLabel: "CodeMirror 6 Runtime",
              documentMode: "Markdown",
              activeRangeLabel: "Lines 1-1",
              autosaveLabel: "Autosave armed",
              shortcutProfileLabel: "Default shortcuts",
              warnings: []
            }}
            onBodyChange={() => undefined}
          />
        );
      });

      expect(container.querySelector(".cm-editor")).not.toBeNull();
      expect(container.querySelector("textarea")).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps the textarea fallback with find shortcuts and focus restoration", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const modes: string[] = [];

    try {
      await act(async () => {
        root.render(
          <ChapterEditor
            chapter={chapter}
            saveStatus="Unsaved"
            dirty={true}
            findMode="find"
            onFindModeChange={(mode) => modes.push(mode)}
            versionHistory={[]}
            runtime={{
              runtimeId: "textarea",
              adapterLabel: "Textarea Runtime",
              documentMode: "Markdown",
              activeRangeLabel: "Lines 1-1",
              autosaveLabel: "Autosave armed",
              shortcutProfileLabel: "Default shortcuts",
              warnings: []
            }}
            onBodyChange={() => undefined}
          />
        );
      });

      const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
      expect(textarea).not.toBeNull();
      expect(container.querySelector(".cm-editor")).toBeNull();

      await act(async () => {
        textarea?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })
        );
        textarea?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true })
        );
        container
          .querySelector<HTMLButtonElement>('[aria-label="关闭查找替换"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(modes).toEqual(["find", "replace", "closed"]);
      expect(document.activeElement).toBe(textarea);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("requests find and replace modes from CodeMirror shortcuts", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const modes: string[] = [];

    try {
      await act(async () => {
        root.render(
          <ChapterEditor
            chapter={chapter}
            saveStatus="Unsaved"
            dirty={true}
            findMode="closed"
            onFindModeChange={(mode) => modes.push(mode)}
            versionHistory={[]}
            runtime={{
              runtimeId: "codemirror",
              adapterLabel: "CodeMirror 6 Runtime",
              documentMode: "Markdown",
              activeRangeLabel: "Lines 1-1",
              autosaveLabel: "Autosave armed",
              shortcutProfileLabel: "Default shortcuts",
              warnings: []
            }}
            onBodyChange={() => undefined}
          />
        );
      });

      const content = container.querySelector<HTMLElement>(".cm-content");
      await act(async () => {
        content?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true })
        );
        content?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true })
        );
      });

      expect(modes).toEqual(["find", "replace"]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  test("registers a CodeMirror selection controller that updates the real editor selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const selections: CodeMirrorDocumentSelection[] = [];
    let selectRange: ((selection: CodeMirrorDocumentSelection) => void) | undefined;

    try {
      await act(async () => {
        root.render(
          <CodeMirrorDocumentEditor
            ariaLabel="Selection test editor"
            body="Moon over moon."
            readOnly={false}
            onBodyChange={() => undefined}
            onEditorFocusRegister={() => undefined}
            onEditorSelectionRegister={(select) => {
              selectRange = select;
            }}
            onFindModeChange={() => undefined}
            onSelectionChange={(selection) => selections.push(selection)}
          />
        );
      });

      await act(async () => {
        selectRange?.({ anchor: 10, head: 14 });
      });

      expect(selectRange).toBeDefined();
      expect(selections.at(-1)).toEqual({ anchor: 10, head: 14 });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  test("renders selection review compare, reject, accept, and undo controls", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[]}
        diffPreview={{
          title: "Selection AI preview",
          changes: [{ kind: "replace", value: "The opening line tightened.\n" }]
        }}
        selectionReview={{
          status: "pending",
          originalText: "Opening line.",
          proposedText: "The opening line tightened.",
          rangeLabel: "0-13",
          compareLabel: "Opening line. -> The opening line tightened.",
          canUndo: false
        }}
        onSelectionReviewAccept={() => undefined}
        onSelectionReviewReject={() => undefined}
        onSelectionReviewUndo={() => undefined}
      />
    );

    expect(html).toContain('aria-label="Selection AI review"');
    expect(html).toContain("Opening line. -&gt; The opening line tightened.");
    expect(html).toContain('aria-label="Accept selection AI preview"');
    expect(html).toContain('aria-label="Reject selection AI preview"');
    expect(html).toContain('aria-label="Undo selection AI rejection"');
    expect(html).toContain('disabled=""');
  });
});
