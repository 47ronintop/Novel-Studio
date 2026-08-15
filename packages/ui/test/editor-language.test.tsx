// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test } from "vitest";

import { CodeMirrorDocumentEditor } from "../src/codemirror-document-editor.js";
import {
  editorFileModeLabel,
  editorLanguageFromPath,
  editorLanguageLabel
} from "../src/editor-language.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("editor language support", () => {
  test.each([
    ["src/app.ts", "typescript"],
    ["src/app.tsx", "typescript"],
    ["src/data.jsonc", "json"],
    ["notes/chapter.md", "markdown"],
    ["styles/site.css", "css"],
    ["templates/page.html", "html"],
    ["scripts/build.py", "python"],
    ["queries/report.sql", "sql"],
    ["assets/icon.svg", "xml"],
    ["README", "plain"],
    ["data.bin", "plain"]
  ] satisfies readonly (readonly [string, string])[])("maps %s", (path, language) => {
    expect(editorLanguageFromPath(path)).toBe(language);
  });

  test("uses a text label for unknown files", () => {
    expect(editorLanguageLabel(editorLanguageFromPath("notes/license"))).toBe("Text");
    expect(editorFileModeLabel("notes/license")).toBe("LICENSE");
    expect(editorFileModeLabel("src/app.ts")).toBe("TypeScript");
  });

  test("highlights tokens for the selected language", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <CodeMirrorDocumentEditor
            ariaLabel="Language test editor"
            body={'const answer = 42; // note\nconsole.log("ok");'}
            language="javascript"
            readOnly={false}
            onEditorFocusRegister={() => undefined}
            onEditorSelectionRegister={() => undefined}
            onFindModeChange={() => undefined}
          />
        );
      });

      expect(host.querySelector(".ns-editor-token-keyword")).not.toBeNull();
      expect(host.querySelector(".ns-editor-token-number")).not.toBeNull();
      expect(host.querySelector(".ns-editor-token-comment")).not.toBeNull();
      expect(host.querySelector(".ns-editor-token-string")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  test("reconfigures highlighting when a file changes language", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    try {
      await act(async () => {
        root.render(
          <CodeMirrorDocumentEditor
            ariaLabel="Language switching test editor"
            body="const answer = 42;"
            language="javascript"
            readOnly={false}
            onEditorFocusRegister={() => undefined}
            onEditorSelectionRegister={() => undefined}
            onFindModeChange={() => undefined}
          />
        );
      });

      const editor = host.querySelector(".cm-editor");
      expect(editor?.querySelector(".ns-editor-token-keyword")).not.toBeNull();

      await act(async () => {
        root.render(
          <CodeMirrorDocumentEditor
            ariaLabel="Language switching test editor"
            body="# Heading\n\n**bold**"
            language="markdown"
            readOnly={false}
            onEditorFocusRegister={() => undefined}
            onEditorSelectionRegister={() => undefined}
            onFindModeChange={() => undefined}
          />
        );
      });

      expect(host.querySelector(".cm-editor")).toBe(editor);
      expect(host.querySelector(".ns-editor-token-heading")).not.toBeNull();
      expect(host.querySelector(".ns-editor-token-strong")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
