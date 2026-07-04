import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ChapterEditor } from "../src/chapter-editor.js";

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

    expect(html).toContain("Unsaved");
    expect(html).toContain("Dirty");
    expect(html).toContain("Version history");
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

    expect(html).toContain('aria-label="Save chapter"');
    expect(html).toContain('aria-label="Preview version Manual save"');
    expect(html).toContain('aria-label="Restore version Manual save"');
    expect(html).toContain("Preview only");
    expect(html).not.toContain("Apply suggestion");
  });
});
