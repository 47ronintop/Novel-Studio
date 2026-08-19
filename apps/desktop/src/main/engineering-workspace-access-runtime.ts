import {
  createEngineeringWorkspaceAccessPort,
  type EngineeringWorkspaceMainOnlyRootHandleBindingV2,
  type EngineeringWorkspaceAccessSession,
  type EngineeringWorkspaceRootBindingIssuer
} from "@novel-studio/repository";
import { createUnifiedError, err, type Result, type UnifiedError } from "@novel-studio/shared";
import type { EngineeringPathPolicy } from "@novel-studio/agent-engine";

import type { EngineeringFileCapabilityAuthority } from "./engineering-file-capability-authority.js";
import {
  ENGINEERING_WORKSPACE_ACCESS_OPERATIONS,
  createEngineeringFileAccessAddonLoader,
  type EngineeringFileAccessAddonLoader,
  type EngineeringWorkspaceAccessOperation
} from "./engineering-file-access-adapter.js";

export type EngineeringWorkspaceAccessRuntimeUnavailableReason =
  "qualification_unavailable" | "native_addon_unavailable" | "workspace_access_unavailable";

/** A Main-only root path. This value is never returned from the runtime or its sessions. */
export interface EngineeringWorkspaceAccessRuntimeOpenRequest {
  readonly rootPath: string;
}

export type EngineeringWorkspaceAccessRuntimeOpenResult =
  | {
      readonly status: "available";
      readonly session: EngineeringWorkspaceAccessSession;
    }
  | {
      readonly status: "unavailable";
      readonly reason: EngineeringWorkspaceAccessRuntimeUnavailableReason;
    };

/**
 * The Main-owned B6 entry point. A caller can only open a read-only session; it cannot supply a
 * root binding, native addon, or qualification result.
 */
export interface EngineeringWorkspaceAccessRuntime {
  readonly operations: readonly EngineeringWorkspaceAccessOperation[];
  openWorkspace(
    request: EngineeringWorkspaceAccessRuntimeOpenRequest
  ): Promise<EngineeringWorkspaceAccessRuntimeOpenResult>;
}

export interface EngineeringWorkspaceAccessRuntimeOptions {
  /** Required Main-owned signed-production or explicitly authorized unsigned-beta authority. */
  readonly capabilityAuthority: EngineeringFileCapabilityAuthority;
  /** Required Main-owned binding issuer, invoked only after native root identity verification. */
  readonly issueRootBinding: EngineeringWorkspaceRootBindingIssuer;
  /** Required Main-owned policy associated with every session opened by this runtime. */
  readonly pathPolicy: EngineeringPathPolicy;
  /** Main composition/test seam only. */
  readonly addonLoader?: EngineeringFileAccessAddonLoader;
  /**
   * Main-only revocation signal. It is emitted once when the native root identity changes, before
   * this wrapper closes the handle; Renderer and Agent code never receive a path or native handle.
   */
  readonly onRootChanged?: (input: { readonly rootBindingId: string }) => void;
  /** Main-only evidence expiry/drift signal; it revokes the same opaque root binding. */
  readonly onQualificationRevoked?: (input: { readonly rootBindingId: string }) => void;
}

/**
 * Creates a read-only session factory over the repository B6 port. Qualification is checked
 * before loading native code. Each open obtains a native root identity and passes Main's binding
 * issuer to the port; the returned wrapper closes the root on a root-change signal.
 */
export function createEngineeringWorkspaceAccessRuntime(
  options: EngineeringWorkspaceAccessRuntimeOptions
): EngineeringWorkspaceAccessRuntime {
  const addonLoader = options.addonLoader ?? createEngineeringFileAccessAddonLoader();

  return Object.freeze({
    operations: ENGINEERING_WORKSPACE_ACCESS_OPERATIONS,
    async openWorkspace(
      request: EngineeringWorkspaceAccessRuntimeOpenRequest
    ): Promise<EngineeringWorkspaceAccessRuntimeOpenResult> {
      if (
        !(await hasCurrentQualification(options.capabilityAuthority, "root")) ||
        !(await hasCurrentQualification(options.capabilityAuthority, "access"))
      ) {
        return unavailable("qualification_unavailable");
      }

      const loaded = addonLoader.load();
      if (loaded.status !== "loaded" || loaded.metadata.accessEligible !== "available") {
        return unavailable("native_addon_unavailable");
      }

      const opened = await createEngineeringWorkspaceAccessPort({ addon: loaded.addon }).open({
        rootPath: request.rootPath,
        pathPolicy: options.pathPolicy,
        issueRootBinding: options.issueRootBinding
      });
      if (!opened.ok) return unavailable("workspace_access_unavailable");

      return Object.freeze({
        status: "available" as const,
        session: new MainOwnedEngineeringWorkspaceAccessSession(
          opened.value,
          options.onRootChanged,
          options.onQualificationRevoked,
          options.capabilityAuthority
        )
      });
    }
  });
}

class MainOwnedEngineeringWorkspaceAccessSession implements EngineeringWorkspaceAccessSession {
  public readonly binding: EngineeringWorkspaceAccessSession["binding"];
  private closing:
    Promise<Result<Readonly<{ readonly closed: boolean }>, UnifiedError>> | undefined;
  private rootChangeNotified = false;
  private qualificationRevokedNotified = false;
  private unsubscribeQualification: (() => void) | undefined;

  public constructor(
    private readonly delegate: EngineeringWorkspaceAccessSession,
    private readonly onRootChanged: EngineeringWorkspaceAccessRuntimeOptions["onRootChanged"],
    private readonly onQualificationRevoked: EngineeringWorkspaceAccessRuntimeOptions["onQualificationRevoked"],
    private readonly capabilityAuthority: EngineeringFileCapabilityAuthority
  ) {
    this.binding = delegate.binding;
    const unsubscribe = capabilityAuthority.subscribeRevocation(() => {
      this.invalidateForQualificationRevocation();
    });
    if (this.closing !== undefined) unsubscribe();
    else this.unsubscribeQualification = unsubscribe;
  }

  public getMainOnlyRootHandleBindingV2(): EngineeringWorkspaceMainOnlyRootHandleBindingV2 {
    const binding = this.delegate.getMainOnlyRootHandleBindingV2?.();
    if (binding === undefined || binding.contentRootBindingId !== this.binding.rootBindingId) {
      throw new Error("ENGINEERING_WORKSPACE_MAIN_ONLY_ROOT_BINDING_UNAVAILABLE");
    }
    return binding;
  }

  public async listDirectory(
    input?: unknown
  ): ReturnType<EngineeringWorkspaceAccessSession["listDirectory"]> {
    if (this.closing !== undefined) return sessionUnavailable();
    if (!(await this.isQualified())) return sessionUnavailable();
    return await this.closeOnRootChange(await this.delegate.listDirectory(input));
  }

  public async readTextFile(
    input: unknown
  ): ReturnType<EngineeringWorkspaceAccessSession["readTextFile"]> {
    if (this.closing !== undefined) return sessionUnavailable();
    if (!(await this.isQualified())) return sessionUnavailable();
    return await this.closeOnRootChange(await this.delegate.readTextFile(input));
  }

  public async searchText(
    input: unknown
  ): ReturnType<EngineeringWorkspaceAccessSession["searchText"]> {
    if (this.closing !== undefined) return sessionUnavailable();
    if (!(await this.isQualified())) return sessionUnavailable();
    return await this.closeOnRootChange(await this.delegate.searchText(input));
  }

  public async buildIndex(): ReturnType<EngineeringWorkspaceAccessSession["buildIndex"]> {
    if (this.closing !== undefined) return sessionUnavailable();
    if (!(await this.isQualified())) return sessionUnavailable();
    return await this.closeOnRootChange(await this.delegate.buildIndex());
  }

  public async close(): ReturnType<EngineeringWorkspaceAccessSession["close"]> {
    this.unsubscribeQualification?.();
    this.unsubscribeQualification = undefined;
    this.closing ??= this.delegate.close();
    return await this.closing;
  }

  private async closeOnRootChange<T>(
    result: Result<T, UnifiedError>
  ): Promise<Result<T, UnifiedError>> {
    if (!result.ok && result.error.code === "ENGINEERING_WORKSPACE_ACCESS_ROOT_CHANGED") {
      this.notifyRootChanged();
      await this.close();
    }
    return result;
  }

  private notifyRootChanged(): void {
    if (this.rootChangeNotified) return;
    this.rootChangeNotified = true;
    try {
      this.onRootChanged?.({ rootBindingId: this.binding.rootBindingId });
    } catch {
      // The native root has already been fail-closed. A UI/runtime revocation callback must never
      // make this session usable again or mask the stable ROOT_CHANGED result.
    }
  }

  private async isQualified(): Promise<boolean> {
    const [root, access] = await Promise.all([
      hasCurrentQualification(this.capabilityAuthority, "root"),
      hasCurrentQualification(this.capabilityAuthority, "access")
    ]);
    if (root && access) return true;
    this.invalidateForQualificationRevocation();
    return false;
  }

  private invalidateForQualificationRevocation(): void {
    if (this.closing !== undefined) return;
    this.notifyQualificationRevoked();
    void this.close();
  }

  private notifyQualificationRevoked(): void {
    if (this.qualificationRevokedNotified) return;
    this.qualificationRevokedNotified = true;
    try {
      this.onQualificationRevoked?.({ rootBindingId: this.binding.rootBindingId });
    } catch {
      // An already-expired qualification remains unavailable regardless of Main cleanup failure.
    }
  }
}

async function hasCurrentQualification(
  capabilityAuthority: EngineeringFileCapabilityAuthority,
  capability: "root" | "access"
): Promise<boolean> {
  try {
    return await capabilityAuthority.hasCapability(capability);
  } catch {
    return false;
  }
}

function unavailable(
  reason: EngineeringWorkspaceAccessRuntimeUnavailableReason
): EngineeringWorkspaceAccessRuntimeOpenResult {
  return Object.freeze({ status: "unavailable" as const, reason });
}

function sessionUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_WORKSPACE_ACCESS_UNAVAILABLE",
      category: "StorageError",
      message: "The engineering workspace access session is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Reopen the workspace before trying again.",
      traceId: "engineering-workspace-access-runtime"
    })
  );
}
