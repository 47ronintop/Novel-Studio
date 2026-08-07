import type { MainApprovalConfirmationCoordinator } from "./agent-approval-confirmation.js";

export interface ApprovalParentWindowLifecycleLike {
  readonly webContents: {
    on(
      event:
        "render-process-gone" | "will-navigate" | "will-frame-navigate" | "did-start-navigation",
      listener: () => void
    ): void;
  };
}

/**
 * The workbench renderer is not part of the approval TCB. A crash, reload, or navigation ends
 * every pending review before the renderer can be reused or replaced.
 */
export function bindApprovalParentWindowFailClosedLifecycle(
  window: ApprovalParentWindowLifecycleLike,
  coordinator: () => Pick<MainApprovalConfirmationCoordinator, "revokeAll"> | undefined
): void {
  const revokeAll = (reason: string): void => coordinator()?.revokeAll(reason);
  window.webContents.on("render-process-gone", () => revokeAll("main_renderer_crashed"));
  window.webContents.on("will-navigate", () => revokeAll("main_renderer_navigation"));
  window.webContents.on("will-frame-navigate", () => revokeAll("main_renderer_navigation"));
  window.webContents.on("did-start-navigation", () => revokeAll("main_renderer_navigation"));
}
