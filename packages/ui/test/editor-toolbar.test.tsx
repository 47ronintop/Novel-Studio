import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { calculateWritingMetrics, EditorToolbar } from "../src/editor-toolbar.js";

describe("editor toolbar", () => {
  test("counts Chinese characters and English words as writing units", () => {
    expect(calculateWritingMetrics("她走进雨里。\nA quiet room waits.")).toEqual({
      lineCount: 2,
      writingUnitCount: 9,
      readingTimeMinutes: 1,
      wordCountLabel: "9 字",
      readingTimeLabel: "约 1 分钟阅读"
    });
  });

  test("renders compact editor controls with labels and preference controls", () => {
    const html = renderToStaticMarkup(
      <EditorToolbar
        metrics={calculateWritingMetrics("她走进雨里。\nA quiet room waits.")}
        preferences={{
          fontFamily: "serif",
          fontSize: 16,
          lineHeight: 1.8
        }}
        findReplaceOpen={false}
        onFindReplaceToggle={() => undefined}
        onFocusModeToggle={() => undefined}
        onPreferencesChange={() => undefined}
      />
    );

    expect(html).toContain('aria-label="编辑器工具栏"');
    expect(html).toContain("9 字");
    expect(html).toContain("约 1 分钟阅读");
    expect(html).toContain('aria-label="打开查找替换"');
    expect(html).toContain('aria-label="切换专注模式"');
    expect(html).toContain('aria-label="编辑器字体"');
    expect(html).toContain('aria-label="编辑器行高"');
  });
});
