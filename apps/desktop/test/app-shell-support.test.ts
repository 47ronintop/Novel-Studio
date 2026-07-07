import { describe, expect, test } from "vitest";

import type { ChapterEditorProps } from "@novel-studio/ui";

import {
  createChapterEditorRuntime,
  createChapterEditorSelectionCommand
} from "../src/renderer/app-shell-support.js";

const chapterEditor = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_runtime",
      type: "chapter",
      title: "Runtime Chapter",
      order: 1,
      status: "draft",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z"
    },
    body: "Alpha sentence.\nBeta sentence."
  },
  saveStatus: "Saved",
  dirty: false,
  versionHistory: []
} satisfies ChapterEditorProps;

describe("renderer app shell editor runtime support", () => {
  test("defaults the interactive chapter runtime to CodeMirror", () => {
    expect(
      createChapterEditorRuntime(chapterEditor, {
        anchor: 0,
        head: 15
      })
    ).toMatchObject({
      adapterLabel: "CodeMirror 6 Runtime",
      activeRangeLabel: "Selection 0-15",
      selectionSummaryLabel: "Selection 15 chars, lines 1-1"
    });
  });

  test("keeps an explicit textarea fallback for recovery and feature flag rollback", () => {
    expect(
      createChapterEditorRuntime(
        chapterEditor,
        {
          anchor: 0,
          head: 15
        },
        {
          preferredRuntimeId: "textarea",
          codeMirrorEnabled: false
        }
      )
    ).toMatchObject({
      adapterLabel: "Textarea Runtime",
      activeRangeLabel: "Selection 0-15"
    });
  });

  test("creates selection preview commands from the default CodeMirror runtime", () => {
    expect(
      createChapterEditorSelectionCommand(chapterEditor, {
        commandId: "editor.ai.preview-selection",
        selection: {
          anchor: 0,
          head: 15
        }
      })
    ).toMatchObject({
      commandId: "editor.ai.preview-selection",
      runtimeId: "codemirror",
      selection: {
        startOffset: 0,
        endOffset: 15,
        selectedTextPreview: "Alpha sentence.",
        collapsed: false
      }
    });
  });
});
