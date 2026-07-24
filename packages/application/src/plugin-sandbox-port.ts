/**
 * Task E.1 — PluginSandboxPort: the boundary Application uses to invoke a plugin-declared
 * tool inside the real OS sandbox (see apps/desktop/src/main/plugin-sandbox-runtime.ts for the
 * production implementation, which depends on Phase C.0's native host through an injected
 * launcher port). This file only defines the port contract and a pure, I/O-free authorization
 * function; it performs no process launching itself.
 *
 * authorizePluginToolCall mirrors packages/plugin-engine's authorizePluginAction, but is
 * stricter and tool-specific: it is the last policy gate before a call ever reaches the real
 * sandbox port, and it must hard-deny on any missing/invalid/untrusted/unverified precondition
 * (plan principle 9 — no partial or best-effort authorization).
 */
import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";

const PROJECT_SCOPE = "project";
const TOOL_INVOKE_PERMISSION = "tool:invoke";

// ── PluginSandboxPort contract ───────────────────────────────────────────────

export interface PluginSandboxToolCallInput {
  readonly pluginId: string;
  readonly toolId: string;
  readonly toolArguments: JsonObject;
  readonly idempotencyKey?: string;
  readonly signal: AbortSignal;
}

export type PluginSandboxToolCallOutcome =
  | { readonly status: "completed"; readonly result: JsonObject }
  | { readonly status: "outcome_unknown"; readonly reason: string };

export interface PluginSandboxPort {
  callTool(
    input: PluginSandboxToolCallInput
  ): Promise<Result<PluginSandboxToolCallOutcome, UnifiedError>>;
}

// ── authorizePluginToolCall ──────────────────────────────────────────────────

export type PluginSandboxToolTrustState = "trusted-local" | "signed" | "untrusted";

export interface PluginSandboxToolPermissionGrant {
  readonly permission: string;
  readonly scopes: readonly string[];
}

export interface PluginSandboxToolDeclaration {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface PluginSandboxToolCapability {
  readonly type: string;
  readonly id: string;
  readonly title: string;
}

/** Manifest fields relevant to tool-call authorization (a subset of PluginManifestSummary). */
export interface PluginSandboxToolManifestLike {
  readonly capabilities: readonly PluginSandboxToolCapability[];
  readonly requestedPermissions: readonly PluginSandboxToolPermissionGrant[];
  readonly contributes: {
    readonly tools?: readonly PluginSandboxToolDeclaration[];
  };
}

/** Registry entry fields relevant to tool-call authorization (a PluginRegistryEntry-like shape). */
export interface PluginSandboxToolRegistryEntryLike {
  readonly enabled: boolean;
  readonly grantedPermissions: readonly PluginSandboxToolPermissionGrant[];
}

export interface AuthorizePluginToolCallInput {
  readonly pluginId: string;
  readonly toolId: string;
  readonly entry: PluginSandboxToolRegistryEntryLike;
  /** undefined models a missing manifest; combine with manifestStatus for an invalid one. */
  readonly manifest: PluginSandboxToolManifestLike | undefined;
  readonly manifestStatus?: "valid" | "missing" | "invalid";
  readonly trustState: PluginSandboxToolTrustState;
  /** Whether Phase C.0's plugin sandbox profile attestation is currently verified. */
  readonly sandboxProfileVerified: boolean;
}

/**
 * Pure, I/O-free authorization gate for a single plugin tool call. Every branch is a hard
 * deny — there is no "partial" or "best effort" outcome. Callers (e.g.
 * createPluginSandboxToolAdapter in plugin-runtime-session.ts) must call this before ever
 * invoking PluginSandboxPort.callTool.
 */
export function authorizePluginToolCall(
  input: AuthorizePluginToolCallInput
): Result<true, UnifiedError> {
  if (!input.entry.enabled) {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_DISABLED",
      message: "Plugin is disabled.",
      suggestedAction: "Enable the plugin before calling its tools.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  if (input.manifest === undefined || (input.manifestStatus ?? "valid") !== "valid") {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_MANIFEST_INVALID",
      message: "Plugin manifest is missing or invalid.",
      suggestedAction: "Restore a valid plugin manifest before calling its tools.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  const declaredTool = (input.manifest.contributes.tools ?? []).find(
    (tool) => tool.id === input.toolId
  );
  if (declaredTool === undefined) {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_NOT_DECLARED",
      message: "Plugin does not declare this tool contribution.",
      suggestedAction: "Refresh the plugin registry and choose an available tool.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  const declaredCapability = input.manifest.capabilities.some(
    (capability) => capability.type === "tool" && capability.id === input.toolId
  );
  if (!declaredCapability) {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_CAPABILITY_MISSING",
      message: "Plugin does not declare a matching tool capability.",
      suggestedAction: "Declare a tool capability entry matching this tool id.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  const grantedInManifest = hasToolInvokePermission(input.manifest.requestedPermissions);
  const grantedInEntry = hasToolInvokePermission(input.entry.grantedPermissions);
  if (!grantedInManifest || !grantedInEntry) {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_PERMISSION_DENIED",
      message: `Plugin is missing ${TOOL_INVOKE_PERMISSION} permission for project scope.`,
      suggestedAction: "Grant tool:invoke permission for project scope before calling this tool.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  if (input.trustState === "untrusted") {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_UNTRUSTED",
      message: "Plugin package is not trusted for sandboxed tool execution.",
      suggestedAction: "Verify and trust the plugin signature before calling its tools.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  if (!input.sandboxProfileVerified) {
    return denied({
      code: "PLUGIN_SANDBOX_TOOL_PROFILE_UNVERIFIED",
      message: "The plugin sandbox profile attestation is not currently verified.",
      suggestedAction: "Wait for sandbox qualification to complete before calling plugin tools.",
      pluginId: input.pluginId,
      toolId: input.toolId
    });
  }

  return ok(true);
}

function hasToolInvokePermission(
  grants: readonly PluginSandboxToolPermissionGrant[]
): boolean {
  return grants.some(
    (grant) => grant.permission === TOOL_INVOKE_PERMISSION && grant.scopes.includes(PROJECT_SCOPE)
  );
}

function denied(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
  readonly pluginId: string;
  readonly toolId: string;
}): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "PluginError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: "plugin-sandbox-port",
      redactedDetail: {
        pluginId: input.pluginId,
        toolId: input.toolId
      }
    })
  );
}
