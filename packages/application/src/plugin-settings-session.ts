import { createUnifiedError, err } from "@novel-studio/shared";
import type { Result, UnifiedError } from "@novel-studio/shared";

export interface PluginSettingsPermissionGrant {
  readonly permission: string;
  readonly scopes: readonly string[];
}

export interface PluginSettingsEntry {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly grantedPermissions: readonly PluginSettingsPermissionGrant[];
}

export interface PluginSettingsSnapshot {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginSettingsEntry[];
}

export interface PluginRegistryPort {
  readPluginRegistry(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
}

export interface PluginSettingsSession {
  load(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
}

export interface PluginSettingsSessionOptions {
  readonly pluginRegistryPort: PluginRegistryPort;
}

export function createPluginSettingsSession(
  options: PluginSettingsSessionOptions
): PluginSettingsSession {
  return {
    load: () => options.pluginRegistryPort.readPluginRegistry()
  };
}

export function pluginRegistryUnavailable(): Result<PluginSettingsSnapshot, UnifiedError> {
  return err(
    createUnifiedError({
      code: "PLUGIN_REGISTRY_UNAVAILABLE",
      category: "PluginError",
      message: "Plugin registry is not available in this desktop session.",
      recoverability: "user-action",
      suggestedAction: "Open a Novel Studio project before managing plugins.",
      traceId: "application-plugin-settings"
    })
  );
}
