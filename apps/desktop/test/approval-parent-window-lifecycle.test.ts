import { describe, expect, test, vi } from "vitest";

import {
  bindApprovalParentWindowFailClosedLifecycle,
  type ApprovalParentWindowLifecycleLike
} from "../src/main/approval-parent-window-lifecycle.js";

describe("approval parent window fail-closed lifecycle", () => {
  test("revokes every pending review when the untrusted workbench crashes, reloads, or navigates", () => {
    const listeners = new Map<string, () => void>();
    const window = {
      webContents: {
        on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener))
      }
    } as unknown as ApprovalParentWindowLifecycleLike;
    const revokeAll = vi.fn();

    bindApprovalParentWindowFailClosedLifecycle(window, () => ({ revokeAll }) as never);

    listeners.get("render-process-gone")?.();
    listeners.get("did-start-navigation")?.();
    listeners.get("will-navigate")?.();
    listeners.get("will-frame-navigate")?.();

    expect(revokeAll).toHaveBeenNthCalledWith(1, "main_renderer_crashed");
    expect(revokeAll).toHaveBeenNthCalledWith(2, "main_renderer_navigation");
    expect(revokeAll).toHaveBeenNthCalledWith(3, "main_renderer_navigation");
    expect(revokeAll).toHaveBeenNthCalledWith(4, "main_renderer_navigation");
  });
});
