import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";
import {
  createMainOwnedNativeConfirmation,
  TrustedApprovalModalController,
  type ApprovalModalWindowLike
} from "../src/main/trusted-approval-modal-window.js";

function windowStub(id: number): {
  readonly window: ApprovalModalWindowLike;
  readonly events: Map<string, Array<(...args: never[]) => void>>;
  readonly options: { loadUrl: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
} {
  const events = new Map<string, Array<(...args: never[]) => void>>();
  const options = { loadUrl: vi.fn(async () => undefined), destroy: vi.fn() };
  const webContents = {
    id,
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, listener: (...args: never[]) => void) => {
      const listeners = events.get(event) ?? [];
      listeners.push(listener);
      events.set(event, listeners);
    }),
    closeDevTools: vi.fn()
  };
  return {
    window: {
      webContents,
      loadFile: options.loadUrl,
      show: vi.fn(),
      close: vi.fn(),
      destroy: options.destroy,
      isDestroyed: vi.fn(() => false),
      once: vi.fn((event: string, listener: (...args: never[]) => void) => {
        const listeners = events.get(event) ?? [];
        listeners.push(listener);
        events.set(event, listeners);
      })
    } as unknown as ApprovalModalWindowLike,
    events,
    options
  };
}

describe("ADR-0004 isolated approval window", () => {
  test("creates a Main-owned, sandboxed, non-persistent modal and rejects navigation", async () => {
    const parent = windowStub(17);
    const modal = windowStub(29);
    const coordinator = {
      openFromRenderer: vi.fn(() => ok({ previewId: "preview_1" })),
      revoke: vi.fn()
    };
    const factory = { create: vi.fn(() => modal.window) };
    const subject = new TrustedApprovalModalController({
      factory,
      coordinator: coordinator as never,
      approvalRendererPath: "D:\\app\\approval\\index.html",
      approvalPreloadPath: "approval-preload.cjs",
      createSessionId: () => "fresh-session"
    });

    await expect(subject.open(parent.window, "preview_1")).resolves.toEqual(ok(undefined));
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: parent.window,
        modal: true,
        show: false,
        webPreferences: expect.objectContaining({
          preload: "approval-preload.cjs",
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          devTools: false,
          partition: "approval-modal-fresh-session"
        })
      })
    );
    expect(coordinator.openFromRenderer).toHaveBeenCalledWith(17, "preview_1", 29);
    expect(modal.window.webContents.setWindowOpenHandler).toHaveBeenCalledWith(
      expect.any(Function)
    );
    const popupHandler = vi.mocked(modal.window.webContents.setWindowOpenHandler).mock
      .calls[0]?.[0];
    expect(popupHandler?.()).toEqual({ action: "deny" });

    expect(modal.options.loadUrl).toHaveBeenCalledWith("D:\\app\\approval\\index.html", {
      hash: "preview_1"
    });
    const navigation = modal.events.get("will-navigate")?.[0];
    const preventDefault = vi.fn();
    navigation?.({ preventDefault }, "https://attacker.invalid" as never);
    expect(preventDefault).toHaveBeenCalledOnce();
    const webview = modal.events.get("will-attach-webview")?.[0];
    const blockWebView = vi.fn();
    webview?.({ preventDefault: blockWebView });
    expect(blockWebView).toHaveBeenCalledOnce();
  });

  test("revokes on close, renderer crash, reload/navigation, and load failure", async () => {
    const parent = windowStub(17);
    const modal = windowStub(29);
    const coordinator = {
      openFromRenderer: vi.fn(() => ok({ previewId: "preview_1" })),
      revoke: vi.fn()
    };
    const subject = new TrustedApprovalModalController({
      factory: { create: vi.fn(() => modal.window) },
      coordinator: coordinator as never,
      approvalRendererPath: "D:\\app\\approval\\index.html",
      approvalPreloadPath: "approval-preload.cjs"
    });
    await subject.open(parent.window, "preview_1");
    const reload = modal.events.get("did-start-navigation")?.[0];
    reload?.({} as never, "file:///D:/app/approval/index.html#preview_1" as never);
    const navigation = modal.events.get("will-navigate")?.[0];
    const preventDefault = vi.fn();
    navigation?.({ preventDefault }, "https://attacker.invalid" as never);
    expect(preventDefault).toHaveBeenCalledOnce();
    const crash = modal.events.get("render-process-gone")?.[0];
    crash?.();
    modal.events.get("closed")?.[0]?.();
    expect(coordinator.revoke).toHaveBeenCalledWith("preview_1", "approval_modal_navigation");
    expect(coordinator.revoke).toHaveBeenCalledWith("preview_1", "approval_modal_renderer_crashed");
    expect(coordinator.revoke).toHaveBeenCalledWith("preview_1", "approval_modal_closed");

    const broken = windowStub(31);
    broken.options.loadUrl.mockRejectedValueOnce(new Error("cannot load"));
    const failed = new TrustedApprovalModalController({
      factory: { create: vi.fn(() => broken.window) },
      coordinator: coordinator as never,
      approvalRendererPath: "D:\\app\\approval\\index.html",
      approvalPreloadPath: "approval-preload.cjs"
    });
    await expect(failed.open(parent.window, "preview_2")).resolves.toMatchObject({
      ok: false,
      error: { code: "TRUSTED_APPROVAL_MODAL_LOAD_FAILED" }
    });
    expect(coordinator.revoke).toHaveBeenCalledWith("preview_2", "approval_modal_load_failed");
    expect(broken.options.destroy).toHaveBeenCalledOnce();
  });

  test("keeps the fixed bundle free of HTML assignment and does not revoke after final native confirmation", async () => {
    const parent = windowStub(17);
    const modal = windowStub(29);
    const coordinator = {
      openFromRenderer: vi.fn(() => ok({ previewId: "preview_1" })),
      revoke: vi.fn()
    };
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 0 })) };
    const confirmation = createMainOwnedNativeConfirmation(dialog, () => parent.window as never);
    await expect(
      confirmation.confirm({
        previewId: "preview_1",
        action: "change_set",
        displayChecksum: "a".repeat(64),
        expiresAt: "2099-01-01T00:00:00.000Z"
      })
    ).resolves.toBe(true);
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      parent.window as never,
      expect.objectContaining({
        buttons: ["Approve change set", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: "Final confirmation required",
        message: "Approve this change set?"
      })
    );
    const subject = new TrustedApprovalModalController({
      factory: { create: vi.fn(() => modal.window) },
      coordinator: coordinator as never,
      approvalRendererPath: "D:\\app\\approval\\index.html",
      approvalPreloadPath: "approval-preload.cjs",
      preserveAfterNativeConfirmation: confirmation.hasAccepted
    });
    await subject.open(parent.window, "preview_1");
    modal.events.get("closed")?.[0]?.();
    expect(coordinator.revoke).not.toHaveBeenCalled();

    const root = join(process.cwd(), "apps", "desktop", "src", "approval");
    const html = readFileSync(join(root, "index.html"), "utf8");
    const script = readFileSync(join(root, "approval.js"), "utf8");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("approval.js");
    expect(script).toContain("textContent");
    expect(script).toContain("selectedOperations");
    expect(script).toContain("canonicalDiff");
    expect(script).toContain("recoverySideEffect");
    expect(script).toContain('result.value.status === "approved"');
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("http://");
    expect(script).not.toContain("https://");
  });

  test("localizes the Main-owned native confirmation only for zh and zh-CN", async () => {
    const parent = windowStub(17);
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 1 })) };
    const preview = {
      previewId: "preview_1",
      action: "change_set" as const,
      displayChecksum: "a".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z"
    };

    const chinese = createMainOwnedNativeConfirmation(
      dialog,
      () => parent.window as never,
      () => "zh-CN"
    );
    await expect(chinese.confirm(preview)).resolves.toBe(false);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
      parent.window as never,
      expect.objectContaining({
        buttons: ["批准变更集", "取消"],
        defaultId: 1,
        cancelId: 1,
        title: "需要最终确认",
        message: "批准此变更集？",
        detail: `显示校验和: ${preview.displayChecksum}`
      })
    );

    const otherLocale = createMainOwnedNativeConfirmation(
      dialog,
      () => parent.window as never,
      () => "zh-TW"
    );
    await expect(otherLocale.confirm(preview)).resolves.toBe(false);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(
      parent.window as never,
      expect.objectContaining({
        buttons: ["Approve change set", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        title: "Final confirmation required",
        message: "Approve this change set?",
        detail: `Display checksum: ${preview.displayChecksum}`
      })
    );
  });

  test("keeps the fixed approval bundle keyboard-safe, localized, and readable at high zoom", () => {
    const root = join(process.cwd(), "apps", "desktop", "src", "approval");
    const html = readFileSync(join(root, "index.html"), "utf8");
    const script = readFileSync(join(root, "approval.js"), "utf8");
    const css = readFileSync(join(root, "approval.css"), "utf8");

    expect(html).toContain('id="cancel" type="button" autofocus');
    expect(html).toContain('id="approve" type="button" disabled');
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('id="details" class="card" role="region" tabindex="0"');
    expect(html).toContain('id="actions" class="actions" role="group"');
    expect(script).toContain('navigator.language.toLowerCase().startsWith("zh")');
    expect(script).toContain('"zh-CN"');
    expect(script).toContain('event.key === "Escape"');
    expect(script).toContain("void cancelApproval()");
    expect(script).toContain("cancel.focus()");
    expect(css).toContain("max-block-size: min(52vh, 34rem)");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("@media (forced-colors: active)");
  });

  test("fails closed if native confirmation cannot locate a Main-owned parent", async () => {
    const confirmation = createMainOwnedNativeConfirmation(
      { showMessageBox: vi.fn() },
      () => undefined
    );
    await expect(
      confirmation.confirm({
        previewId: "preview_1",
        action: "change_set",
        displayChecksum: "a".repeat(64),
        expiresAt: "2099-01-01T00:00:00.000Z"
      })
    ).resolves.toBe(false);
  });
});
