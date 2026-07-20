// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { RecoveryReview } from "../src/recovery-review.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("RecoveryReview", () => {
  afterEach(() => document.body.replaceChildren());

  test("keeps chapter autosave preview, apply, and discard actions", () => {
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <RecoveryReview
          source="chapter_autosave"
          recovery={{
            availableItems: [{ sessionId: "session-01", chapterId: "chapter-01", updatedAt: "10:00" }],
            review: {
              status: "previewing",
              selectedDraft: {
                sessionId: "session-01",
                chapterId: "chapter-01",
                chapterTitle: "第一章",
                updatedAt: "10:00",
                body: "恢复草稿"
              }
            }
          }}
          chapters={[
            {
              id: "chapter-01",
              title: "第一章",
              order: 1,
              status: "draft",
              updatedAt: "2026-07-20T00:00:00.000Z"
            }
          ]}
          onPreview={onPreview}
          onApply={onApply}
          onDiscard={onDiscard}
        />
      );
    });

    expect(host.querySelector('[aria-label="章节恢复审阅"]')).not.toBeNull();
    expect(host.textContent).toContain("恢复草稿");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="预览恢复草稿"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="应用恢复草稿"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="丢弃恢复草稿"]')?.click());
    expect(onPreview).toHaveBeenCalledWith("session-01");
    expect(onApply).toHaveBeenCalledWith("session-01");
    expect(onDiscard).toHaveBeenCalledWith("session-01");
    act(() => root.unmount());
  });

  test("shows agent transaction recovery as required and routes only to rollback or retry", () => {
    const onOpenRollback = vi.fn();
    const onRetry = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <RecoveryReview
          source="agent_transaction"
          runId="run-recovery"
          versionGroupId="version-group-recovery"
          errorCode="AGENT_RECOVERY_REQUIRED"
          message="部分写入需要恢复审阅"
          failedHooks={["syncSavedEditor"]}
          onOpenRollback={onOpenRollback}
          onRetry={onRetry}
        />
      );
    });

    const review = host.querySelector('[aria-label="Agent 事务恢复审阅"]');
    expect(review).not.toBeNull();
    expect(review?.textContent).toContain("recovery_required");
    expect(review?.textContent).toContain("version-group-recovery");
    expect(review?.textContent).not.toContain("恢复成功");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="打开撤销审阅"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="重试 Agent 运行"]')?.click());
    expect(onOpenRollback).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });
});
