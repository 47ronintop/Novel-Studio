import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";

export interface PluginRegistryPermissionGrant {
  readonly permission: string;
  readonly scopes: readonly string[];
}

export interface PluginRegistryEntry {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly grantedPermissions: readonly PluginRegistryPermissionGrant[];
}

export interface PluginRegistrySnapshot {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginRegistryEntry[];
}

export interface PluginManifestCapability {
  readonly type: "command" | "workflow-step" | "asset-view";
  readonly id: string;
  readonly title: string;
}

export interface PluginManifestPermission {
  readonly permission: "project:read" | "asset:read" | "asset:write" | "workflow:invoke";
  readonly scopes: readonly string[];
}

export interface PluginManifestContribution {
  readonly id: string;
  readonly title: string;
}

export interface PluginManifestSummary {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly entryKind: "local-process" | "webview" | "none";
  readonly compatibleAppVersion: {
    readonly min: string;
    readonly max?: string;
  };
  readonly capabilities: readonly PluginManifestCapability[];
  readonly requestedPermissions: readonly PluginManifestPermission[];
  readonly contributes: {
    readonly commands: readonly PluginManifestContribution[];
    readonly workflowSteps: readonly PluginManifestContribution[];
  };
}

export interface PluginSettingsEntry {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly grantedPermissions: readonly PluginRegistryPermissionGrant[];
  readonly manifestStatus: "valid" | "missing" | "invalid";
  readonly manifest?: PluginManifestSummary;
  readonly manifestError?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface PluginSettingsSnapshot {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginSettingsEntry[];
}

export interface PluginRegistryFileRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export class PluginRegistryFileRepository {
  private readonly traceId: string;

  public constructor(private readonly options: PluginRegistryFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_plugin_registry";
  }

  public async readPluginRegistry(): Promise<Result<PluginRegistrySnapshot, UnifiedError>> {
    let parsed: unknown;

    try {
      parsed = JSON.parse(
        await readFile(join(this.options.projectRoot, "plugins", "plugins.json"), "utf8")
      );
    } catch (error) {
      return err(
        storageError({
          code: "PLUGIN_REGISTRY_FILE_MISSING",
          message: "plugins/plugins.json could not be read.",
          suggestedAction: "Restore plugins/plugins.json or choose a valid Novel Studio project.",
          traceId: this.traceId,
          redactedDetail: {
            fileName: "plugins/plugins.json",
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    const validation = await validateWithSchema("plugin-registry", parsed);
    if (!validation.valid) {
      return err(
        validationError({
          code: "PLUGIN_REGISTRY_FILE_INVALID",
          message: "plugins/plugins.json failed schema validation.",
          suggestedAction: "Fix the project plugin registry and retry.",
          traceId: this.traceId,
          redactedDetail: {
            fileName: "plugins/plugins.json",
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    return ok(parsed as PluginRegistrySnapshot);
  }

  public async readPluginSettings(): Promise<Result<PluginSettingsSnapshot, UnifiedError>> {
    const registry = await this.readPluginRegistry();
    if (!registry.ok) {
      return registry;
    }

    const plugins = await Promise.all(
      registry.value.plugins.map(async (entry) => this.readPluginSettingsEntry(entry))
    );

    return ok({
      schemaVersion: registry.value.schemaVersion,
      plugins
    });
  }

  public async setPluginEnabled(
    pluginId: string,
    enabled: boolean
  ): Promise<Result<PluginSettingsSnapshot, UnifiedError>> {
    const registry = await this.readPluginRegistry();
    if (!registry.ok) {
      return registry;
    }

    let found = false;
    const nextRegistry: PluginRegistrySnapshot = {
      schemaVersion: registry.value.schemaVersion,
      plugins: registry.value.plugins.map((entry) => {
        if (entry.pluginId !== pluginId) {
          return entry;
        }
        found = true;
        return {
          ...entry,
          enabled
        };
      })
    };

    if (!found) {
      return err(
        validationError({
          code: "PLUGIN_REGISTRY_PLUGIN_NOT_FOUND",
          message: "The requested plugin is not registered in plugins/plugins.json.",
          suggestedAction: "Refresh plugin settings or restore the plugin registry entry.",
          traceId: this.traceId,
          redactedDetail: {
            pluginId
          }
        })
      );
    }

    const validation = await validateWithSchema("plugin-registry", nextRegistry);
    if (!validation.valid) {
      return err(
        validationError({
          code: "PLUGIN_REGISTRY_FILE_INVALID",
          message: "Updated plugin registry failed schema validation.",
          suggestedAction: "Fix the project plugin registry and retry.",
          traceId: this.traceId,
          redactedDetail: {
            fileName: "plugins/plugins.json",
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const writeResult = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, "plugins", "plugins.json"),
      content: `${JSON.stringify(nextRegistry, null, 2)}\n`,
      traceId: this.traceId
    });

    if (!writeResult.ok) {
      return writeResult;
    }

    return this.readPluginSettings();
  }

  private async readPluginSettingsEntry(entry: PluginRegistryEntry): Promise<PluginSettingsEntry> {
    const manifestPath = join(this.options.projectRoot, entry.manifestPath);
    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      return {
        ...entry,
        manifestStatus: "missing",
        manifestError: {
          code: "PLUGIN_MANIFEST_FILE_MISSING",
          message: error instanceof Error ? error.message : "Plugin manifest could not be read."
        }
      };
    }

    const validation = await validateWithSchema("plugin-manifest", parsed);
    if (!validation.valid) {
      return {
        ...entry,
        manifestStatus: "invalid",
        manifestError: {
          code: "PLUGIN_MANIFEST_FILE_INVALID",
          message: "Plugin manifest failed schema validation."
        }
      };
    }

    const manifest = parsed as PluginManifestFile;
    return {
      ...entry,
      manifestStatus: "valid",
      manifest: {
        id: manifest.id,
        displayName: manifest.displayName,
        version: manifest.version,
        entryKind: manifest.entry.kind,
        compatibleAppVersion: manifest.compatibleAppVersion,
        capabilities: manifest.capabilities,
        requestedPermissions: manifest.permissions,
        contributes: manifest.contributes
      }
    };
  }
}

interface PluginManifestFile {
  readonly schemaVersion: "1.0";
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly entry: {
    readonly kind: "local-process" | "webview" | "none";
    readonly command: string;
  };
  readonly compatibleAppVersion: {
    readonly min: string;
    readonly max?: string;
  };
  readonly capabilities: readonly PluginManifestCapability[];
  readonly permissions: readonly PluginManifestPermission[];
  readonly contributes: {
    readonly commands: readonly PluginManifestContribution[];
    readonly workflowSteps: readonly PluginManifestContribution[];
  };
}
