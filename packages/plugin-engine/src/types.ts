import type { UnifiedError } from "@novel-studio/shared";

export type PluginCapabilityType = "command" | "workflow-step" | "asset-view";

export type PluginPermission = "project:read" | "asset:read" | "asset:write" | "workflow:invoke";

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
