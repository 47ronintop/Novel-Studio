import type { UnifiedError } from "@novel-studio/shared";

export type PluginCapabilityType = "command" | "workflow-step" | "asset-view" | "tool";

export type PluginPermission =
  "project:read" | "asset:read" | "asset:write" | "workflow:invoke" | "tool:invoke";

export type PluginScope =
  "project" | "chapters" | "characters" | "world" | "outline" | "timeline" | "memories";

export interface PluginEntryPoint {
  kind: "local-process" | "webview" | "none";
  command: string;
}

export interface PluginCompatibleAppVersion {
  min: string;
  max?: string;
}

export interface PluginCapability {
  type: PluginCapabilityType;
  id: string;
  title: string;
}

export interface PluginPermissionGrant {
  permission: PluginPermission;
  scopes: PluginScope[];
}

export interface PluginContribution {
  id: string;
  title: string;
}

/**
 * Task E.1 — a plugin-declared tool the Agent (LLM) may call, distinct from the
 * UI-facing command/workflow-step contributions above. `inputSchema` is a strict
 * JSON Schema object subset (validated by the manifest schema); `timeoutMs` and
 * `maxOutputBytes` are optional per-tool overrides with code-level defaults of
 * 2000ms / 32768 bytes when absent.
 */
export interface PluginToolContribution {
  id: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface PluginManifest {
  schemaVersion: "1.0";
  id: string;
  displayName: string;
  version: string;
  entry: PluginEntryPoint;
  compatibleAppVersion: PluginCompatibleAppVersion;
  capabilities: PluginCapability[];
  permissions: PluginPermissionGrant[];
  contributes: {
    commands: PluginContribution[];
    workflowSteps: PluginContribution[];
    /** Optional for backward compatibility with manifests written before Task E.1. */
    tools?: PluginToolContribution[];
  };
}

export interface PluginRegistryEntry {
  pluginId: string;
  enabled: boolean;
  manifestPath: string;
  grantedPermissions: PluginPermissionGrant[];
}

export type PluginRuntimeStatus = "enabled" | "disabled";

export interface PluginRuntimeRecord {
  pluginId: string;
  displayName: string;
  version: string;
  status: PluginRuntimeStatus;
  manifestPath: string;
  capabilities: PluginCapability[];
  grantedPermissions: PluginPermissionGrant[];
}

export interface PluginRegistrySnapshot {
  schemaVersion: "1.0";
  plugins: PluginRuntimeRecord[];
}

export interface BuildPluginRegistryInput {
  appVersion: string;
  manifests: PluginManifest[];
  entries: PluginRegistryEntry[];
}

export interface PluginActionRequest {
  capability: PluginCapabilityType;
  permission: PluginPermission;
  scope: PluginScope;
}

export interface AuthorizePluginActionInput {
  manifest: PluginManifest;
  entry: PluginRegistryEntry;
  action: PluginActionRequest;
}

export type PluginResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: UnifiedError;
    };
