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
  readonly manifestStatus: "valid" | "missing" | "invalid";
  readonly manifest?: {
    readonly displayName: string;
    readonly version: string;
    readonly entryKind: "local-process" | "webview" | "none";
    readonly compatibleAppVersion: {
      readonly min: string;
      readonly max?: string;
    };
    readonly capabilities: readonly {
      readonly type: "command" | "workflow-step" | "asset-view";
      readonly id: string;
      readonly title: string;
    }[];
    readonly requestedPermissions: readonly PluginSettingsPermissionGrant[];
    readonly contributes: {
      readonly commands: readonly {
        readonly id: string;
        readonly title: string;
      }[];
      readonly workflowSteps: readonly {
        readonly id: string;
        readonly title: string;
      }[];
    };
  };
  readonly manifestError?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface PluginSettingsSnapshot {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginSettingsEntry[];
}

export interface PluginRegistryPort {
  readPluginSettings(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  setPluginEnabled(
    pluginId: string,
    enabled: boolean
  ): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
}

export interface PluginSettingsSession {
  load(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  setEnabled(
    pluginId: string,
    enabled: boolean
  ): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
}

export interface PluginSettingsSessionOptions {
  readonly pluginRegistryPort: PluginRegistryPort;
}

export function createPluginSettingsSession(
  options: PluginSettingsSessionOptions
): PluginSettingsSession {
  return {
    load: () => options.pluginRegistryPort.readPluginSettings(),
    setEnabled: (pluginId, enabled) =>
      options.pluginRegistryPort.setPluginEnabled(pluginId, enabled)
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
