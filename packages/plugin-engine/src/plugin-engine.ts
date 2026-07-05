import type {
  AuthorizePluginActionInput,
  BuildPluginRegistryInput,
  PluginManifest,
  PluginPermission,
  PluginPermissionGrant,
  PluginRegistrySnapshot,
  PluginResult,
  PluginRuntimeRecord,
  PluginScope
} from "./types.js";
import { createPluginError } from "./errors.js";

export function buildPluginRegistry(
  input: BuildPluginRegistryInput
): PluginResult<PluginRegistrySnapshot> {
  const manifestIds = new Set<string>();
  const records: PluginRuntimeRecord[] = [];

  for (const manifest of input.manifests) {
    if (manifestIds.has(manifest.id)) {
      return {
        ok: false,
        error: createPluginError("PLUGIN_DUPLICATE_ID", "Plugin ids must be unique.", {
          pluginId: manifest.id
        })
      };
    }
    manifestIds.add(manifest.id);

    if (!isCompatibleAppVersion(input.appVersion, manifest.compatibleAppVersion)) {
      return {
        ok: false,
        error: createPluginError(
          "PLUGIN_INCOMPATIBLE_APP_VERSION",
          "Plugin is not compatible with this app version.",
          {
            pluginId: manifest.id,
            appVersion: input.appVersion
          }
        )
      };
    }

    const entry = input.entries.find((candidate) => candidate.pluginId === manifest.id);
    if (entry === undefined) {
      continue;
    }

    records.push({
      pluginId: manifest.id,
      displayName: manifest.displayName,
      version: manifest.version,
      status: entry.enabled ? "enabled" : "disabled",
      manifestPath: entry.manifestPath,
      capabilities: manifest.capabilities,
      grantedPermissions: entry.grantedPermissions
    });
  }

  return {
    ok: true,
    value: {
      schemaVersion: "1.0",
      plugins: records
    }
  };
}

export function authorizePluginAction(input: AuthorizePluginActionInput): PluginResult<true> {
  if (!input.entry.enabled) {
    return {
      ok: false,
      error: createPluginError("PLUGIN_DISABLED", "Disabled plugins cannot perform actions.", {
        pluginId: input.manifest.id
      })
    };
  }

  if (
    !input.manifest.capabilities.some((capability) => capability.type === input.action.capability)
  ) {
    return {
      ok: false,
      error: createPluginError(
        "PLUGIN_CAPABILITY_MISSING",
        "Plugin does not declare the requested capability.",
        {
          pluginId: input.manifest.id,
          capability: input.action.capability
        }
      )
    };
  }

  if (
    !hasPermission(input.manifest.permissions, input.action.permission, input.action.scope) ||
    !hasPermission(input.entry.grantedPermissions, input.action.permission, input.action.scope)
  ) {
    return {
      ok: false,
      error: createPluginError(
        "PLUGIN_PERMISSION_DENIED",
        "Plugin does not have the requested permission scope.",
        {
          pluginId: input.manifest.id,
          permission: input.action.permission,
          scope: input.action.scope
        }
      )
    };
  }

  return {
    ok: true,
    value: true
  };
}

function hasPermission(
  grants: PluginPermissionGrant[],
  permission: PluginPermission,
  scope: PluginScope
): boolean {
  return grants.some((grant) => grant.permission === permission && grant.scopes.includes(scope));
}

function isCompatibleAppVersion(
  appVersion: string,
  range: PluginManifest["compatibleAppVersion"]
): boolean {
  if (compareVersions(appVersion, range.min) < 0) {
    return false;
  }
  if (range.max !== undefined && compareVersions(appVersion, range.max) > 0) {
    return false;
  }
  return true;
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return [Number(major), Number(minor), Number(patch)];
}
