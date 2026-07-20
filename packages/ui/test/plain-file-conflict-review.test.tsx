// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PlainFileConflictReview } from "../src/plain-file-conflict-review.js";

describe("PlainFileConflictReview", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  test("shows disk and draft content with only the two safe actions", () => {
    const onReloadFromDisk = vi.fn();
    const onKeepDraft = vi.fn();
    act(() => {
      root.render(
        <PlainFileConflictReview
          fileName="notes/scene.md"
          conflict={{
            diskContent: "disk version",
            draftContent: "draft version",
            diskChecksum: "disk-checksum"
          }}
          onReloadFromDisk={onReloadFromDisk}
          onKeepDraft={onKeepDraft}
        />
      );
    });

    expect(host.textContent).toContain("磁盘版本");
    expect(host.textContent).toContain("disk version");
    expect(host.textContent).toContain("当前草稿");
    expect(host.textContent).toContain("draft version");
    expect(host.querySelectorAll("button")).toHaveLength(2);
    expect(host.querySelector('button[aria-label="重新载入磁盘版本"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="保留当前草稿"]')).not.toBeNull();
    expect(host.textContent).not.toContain("强制覆盖");

    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="重新载入磁盘版本"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="保留当前草稿"]')?.click());
    expect(onReloadFromDisk).toHaveBeenCalledOnce();
    expect(onKeepDraft).toHaveBeenCalledOnce();
  });
});
