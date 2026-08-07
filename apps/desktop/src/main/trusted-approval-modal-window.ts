import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { BaseWindow, MessageBoxOptions } from "electron";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type {
  MainApprovalConfirmationCoordinator,
  TrustedApprovalPreview
} from "./agent-approval-confirmation.js";
import { createSecureWebPreferences } from "./security.js";

export interface ApprovalModalWindowLike {
  readonly webContents: ApprovalModalWebContentsLike;
  loadFile(filePath: string, options: { readonly hash: string }): Promise<void>;
  show(): void;
  close(): void;
  destroy(): void;
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): void;
}

export interface ApprovalModalWebContentsLike {
  readonly id: number;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  on(
    event:
      | "will-navigate"
      | "will-frame-navigate"
      | "will-attach-webview"
      | "did-start-navigation"
      | "render-process-gone"
      | "devtools-opened",
    listener: (event?: { preventDefault(): void }, url?: string) => void
  ): void;
  closeDevTools(): void;
}

export interface ApprovalModalWindowFactory {
  create(options: TrustedApprovalModalWindowOptions): ApprovalModalWindowLike;
}

export interface TrustedApprovalModalWindowOptions {
  readonly parent: ApprovalModalWindowLike;
  readonly modal: true;
  readonly show: false;
  readonly width: number;
  readonly height: number;
  readonly resizable: false;
  readonly minimizable: false;
  readonly maximizable: false;
  readonly autoHideMenuBar: true;
  readonly title: string;
  readonly webPreferences: ReturnType<typeof createSecureWebPreferences> & {
    readonly partition: string;
    readonly webviewTag: false;
    readonly devTools: false;
  };
}

export interface TrustedApprovalModalControllerOptions {
  readonly factory: ApprovalModalWindowFactory;
  readonly coordinator: Pick<MainApprovalConfirmationCoordinator, "openFromRenderer" | "revoke">;
  /** Compiled app-owned `dist/approval/index.html`, never a workbench renderer route. */
  readonly approvalRendererPath: string;
  /** Compiled app-owned `dist/preload/approval-preload.cjs`. */
  readonly approvalPreloadPath: string;
  /** Non-persistent partition suffix; it must be fresh per modal. */
  readonly createSessionId?: () => string;
  /** A native confirmation may have completed issuance before the modal closes. */
  readonly preserveAfterNativeConfirmation?: (previewId: string) => boolean;
}

/**
 * Opens an opaque prepared preview in a dedicated Main-owned modal. The modal
 * always loads the separately bundled approval document, never data:, a web
 * route, or a caller-provided URL.
 */
export class TrustedApprovalModalController {
  private readonly createSessionId: () => string;

  public constructor(private readonly options: TrustedApprovalModalControllerOptions) {
    this.createSessionId = options.createSessionId ?? randomUUID;
  }

  public async open(
    parent: ApprovalModalWindowLike,
    previewId: string
  ): Promise<Result<void, UnifiedError>> {
    const modal = this.options.factory.create({
      parent,
      modal: true,
      show: false,
      width: 760,
      height: 680,
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title: "Confirm change set",
      webPreferences: {
        ...createSecureWebPreferences(this.options.approvalPreloadPath),
        // No `persist:` prefix: Electron destroys the session once its window is gone.
        partition: `approval-modal-${this.createSessionId()}`,
        webviewTag: false,
        devTools: false
      }
    });
    let closed = false;
    modal.once("closed", () => {
      closed = true;
      if (!this.options.preserveAfterNativeConfirmation?.(previewId)) {
        this.options.coordinator.revoke(previewId, "approval_modal_closed");
      }
    });

    const bound = this.options.coordinator.openFromRenderer(
      parent.webContents.id,
      previewId,
      modal.webContents.id
    );
    if (!bound.ok) {
      modal.destroy();
      return bound;
    }

    const documentUrl = `${pathToFileURL(this.options.approvalRendererPath).toString()}#${encodeURIComponent(previewId)}`;
    let initialDocumentLoaded = false;
    this.harden(modal, previewId, documentUrl, () => initialDocumentLoaded);
    try {
      await modal.loadFile(this.options.approvalRendererPath, { hash: previewId });
      initialDocumentLoaded = true;
      if (!closed && !modal.isDestroyed()) modal.show();
      return ok(undefined);
    } catch {
      this.options.coordinator.revoke(previewId, "approval_modal_load_failed");
      if (!modal.isDestroyed()) modal.destroy();
      return err(
        createUnifiedError({
          code: "TRUSTED_APPROVAL_MODAL_LOAD_FAILED",
          category: "AgentError",
          message: "The isolated confirmation window could not be loaded.",
          recoverability: "user-action",
          suggestedAction: "Open a new confirmation from the current change set.",
          traceId: "desktop-trusted-approval-modal"
        })
      );
    }
  }

  private harden(
    modal: ApprovalModalWindowLike,
    previewId: string,
    documentUrl: string,
    initialDocumentLoaded: () => boolean
  ): void {
    const revokeForNavigation = (
      event: { preventDefault(): void } | undefined,
      url?: string
    ): void => {
      // Electron's initial `loadFile` is the sole allowed navigation.  Any later navigation,
      // including a reload of the same bundle, loses the human-review binding.
      if (!initialDocumentLoaded() && url === documentUrl) return;
      event?.preventDefault();
      this.options.coordinator.revoke(previewId, "approval_modal_navigation");
    };
    modal.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    modal.webContents.on("will-navigate", revokeForNavigation);
    modal.webContents.on("will-frame-navigate", revokeForNavigation);
    modal.webContents.on("did-start-navigation", (_event, url) => {
      if (!initialDocumentLoaded() && url === documentUrl) return;
      this.options.coordinator.revoke(previewId, "approval_modal_navigation");
    });
    modal.webContents.on("will-attach-webview", (event) => {
      event?.preventDefault();
      this.options.coordinator.revoke(previewId, "approval_modal_webview_attempt");
    });
    modal.webContents.on("render-process-gone", () => {
      this.options.coordinator.revoke(previewId, "approval_modal_renderer_crashed");
    });
    modal.webContents.on("devtools-opened", () => modal.webContents.closeDevTools());
  }
}

export interface NativeApprovalDialog {
  showMessageBox(parent: BaseWindow, options: MessageBoxOptions): Promise<{ response: number }>;
}

export interface MainOwnedNativeConfirmation {
  readonly confirm: (preview: TrustedApprovalPreview) => Promise<boolean>;
  readonly hasAccepted: (previewId: string) => boolean;
}

/**
 * Final Main/native confirmation. The affirmative action is deliberately not
 * the default and cancellation is the default, including Escape/window close.
 */
export function createMainOwnedNativeConfirmation(
  dialog: NativeApprovalDialog,
  findParent: () => BaseWindow | undefined,
  getLocale: () => string = () => "en"
): MainOwnedNativeConfirmation {
  const acceptedPreviewIds = new Set<string>();
  return {
    confirm: async (preview) => {
      const parent = findParent();
      if (parent === undefined || parent.isDestroyed()) return false;
      const copy = nativeConfirmationCopy(getLocale);
      const response = await dialog.showMessageBox(parent, {
        type: "warning",
        buttons: copy.buttons,
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: copy.title,
        message: copy.message,
        detail: `${copy.displayChecksumLabel}: ${preview.displayChecksum}`
      });
      const approved = response.response === 0;
      if (approved) acceptedPreviewIds.add(preview.previewId);
      return approved;
    },
    hasAccepted: (previewId) => acceptedPreviewIds.has(previewId)
  };
}

function nativeConfirmationCopy(getLocale: () => string): {
  readonly buttons: [string, string];
  readonly title: string;
  readonly message: string;
  readonly displayChecksumLabel: string;
} {
  let locale = "en";
  try {
    locale = getLocale().toLowerCase();
  } catch {
    // Locale display is never an authority decision. If Electron cannot provide it, the
    // Main-owned English fallback preserves the same safe native confirmation.
  }
  if (locale === "zh" || locale === "zh-cn") {
    return {
      buttons: ["批准变更集", "取消"],
      title: "需要最终确认",
      message: "批准此变更集？",
      displayChecksumLabel: "显示校验和"
    };
  }
  return {
    buttons: ["Approve change set", "Cancel"],
    title: "Final confirmation required",
    message: "Approve this change set?",
    displayChecksumLabel: "Display checksum"
  };
}
