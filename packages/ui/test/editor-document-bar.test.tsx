import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { EditorDocumentBar } from "../src/editor-document-bar.js";

describe("EditorDocumentBar", () => {
  test("renders real open documents and only available commands", () => {
    const html = renderToStaticMarkup(
      <EditorDocumentBar
        tabs={[
          { id: "chapter:ch_opening", label: "开篇.md", active: true, dirty: false },
          { id: "file:notes/scene.md", label: "scene.md", active: false, dirty: true }
        ]}
        dirty={false}
        saving={false}
        onSave={() => undefined}
        onFind={() => undefined}
      />
    );

    expect(html).toContain("开篇.md");
    expect(html).toContain("scene.md");
    expect(html).toContain('aria-label="保存当前文档"');
    expect(html).toContain('aria-label="查找当前文档"');
    expect(html).not.toContain('aria-label="切换专注模式"');
  });
});
