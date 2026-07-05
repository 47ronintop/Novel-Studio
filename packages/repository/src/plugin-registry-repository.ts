import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

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
}
