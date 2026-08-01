import { describe, expect, test, vi } from "vitest";

import {
  chapterCompletionFeedback,
  chapterStatusErrorMessage
} from "../src/renderer/story-analysis-workspace.js";

describe("Story Analysis workspace chapter completion feedback", () => {
  test("maps completion dispositions without offering a duplicate analysis action", () => {
    const onAnalyze = vi.fn();

    expect(chapterCompletionFeedback({ status: "not-triggered" }, onAnalyze)).toBeUndefined();
    expect(chapterCompletionFeedback({ status: "disabled", mode: "off" }, onAnalyze)).toEqual({
      kind: "info",
      message: "章节已完成，章后资料分析当前已关闭。"
    });
    expect(
      chapterCompletionFeedback(
        { status: "scheduled", mode: "background-review", chapterId: "chapter-1" },
        onAnalyze
      )
    ).toEqual({
      kind: "info",
      message: "章节已完成，资料分析已在后台启动。"
    });
    expect(
      chapterCompletionFeedback({ status: "unavailable", code: "MODEL_MISSING" }, onAnalyze)
    ).toEqual({
      kind: "error",
      message: "章节已保存，但资料分析暂不可用（MODEL_MISSING）。"
    });
    expect(onAnalyze).not.toHaveBeenCalled();
  });

  test("passes the completed chapter to the prompt analysis action", () => {
    const onAnalyze = vi.fn();
    const feedback = chapterCompletionFeedback(
      { status: "prompt", mode: "prompt", chapterId: "chapter-1" },
      onAnalyze
    );

    expect(feedback).toMatchObject({
      kind: "info",
      action: { label: "立即分析" }
    });
    feedback?.action?.onInvoke();
    expect(onAnalyze).toHaveBeenCalledWith("chapter-1");
  });

  test("keeps a useful status-save error fallback", () => {
    expect(chapterStatusErrorMessage(new Error("write failed"))).toBe("write failed");
    expect(chapterStatusErrorMessage(new Error("   "))).toBe("章节状态保存失败，请重试。");
    expect(chapterStatusErrorMessage(undefined)).toBe("章节状态保存失败，请重试。");
  });
});
