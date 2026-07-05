import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  authorizePluginAction,
  buildPluginRegistry,
  type PluginManifest,
  type PluginRegistryEntry
} from "../src/index.js";

const baseManifest: PluginManifest = {
  schemaVersion: "1.0",
  id: "novel.test-tools",
  displayName: "Test Tools",
  version: "0.1.0",
  entry: {
    kind: "local-process",
    command: "plugin.js"
  },
  compatibleAppVersion: {
    min: "0.1.0",
    max: "0.2.0"
  },
  capabilities: [
    {
      type: "command",
      id: "test-tools.open-character-map",
      title: "Open Character Map"
    }
  ],
  permissions: [
    {
      permission: "asset:read",
      scopes: ["characters"]
    }
  ],
  contributes: {
    commands: [
      {
        id: "test-tools.open-character-map",
        title: "Open Character Map"
      }
    ],
    workflowSteps: []
  }
};

const baseEntry: PluginRegistryEntry = {
  pluginId: "novel.test-tools",
  enabled: true,
  manifestPath: "plugins/novel.test-tools/plugin.json",
  grantedPermissions: [
    {
      permission: "asset:read",
      scopes: ["characters"]
    }
  ]
};

describe("M18 plugin engine", () => {
  test("builds an enabled plugin registry snapshot from compatible manifests", () => {
    const result = buildPluginRegistry({
      appVersion: "0.1.0",
      manifests: [baseManifest],
      entries: [baseEntry]
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.plugins).toHaveLength(1);
    expect(result.value.plugins[0]?.pluginId).toBe("novel.test-tools");
    expect(result.value.plugins[0]?.status).toBe("enabled");
  });

  test("rejects duplicate plugin ids", () => {
    const result = buildPluginRegistry({
      appVersion: "0.1.0",
      manifests: [baseManifest, { ...baseManifest }],
      entries: [baseEntry]
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PLUGIN_DUPLICATE_ID");
  });

  test("rejects incompatible app versions", () => {
    const result = buildPluginRegistry({
      appVersion: "0.3.0",
      manifests: [baseManifest],
      entries: [baseEntry]
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PLUGIN_INCOMPATIBLE_APP_VERSION");
  });

  test("denies an action when capability is missing", () => {
    const result = authorizePluginAction({
      manifest: baseManifest,
      entry: baseEntry,
      action: {
        capability: "workflow-step",
        permission: "workflow:invoke",
        scope: "chapters"
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PLUGIN_CAPABILITY_MISSING");
  });

  test("denies access when the requested permission scope is missing", () => {
    const result = authorizePluginAction({
      manifest: baseManifest,
      entry: baseEntry,
      action: {
        capability: "command",
        permission: "asset:read",
        scope: "chapters"
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PLUGIN_PERMISSION_DENIED");
  });

  test("denies disabled plugins before checking permissions", () => {
    const result = authorizePluginAction({
      manifest: baseManifest,
      entry: {
        ...baseEntry,
        enabled: false
      },
      action: {
        capability: "command",
        permission: "asset:read",
        scope: "characters"
      }
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PLUGIN_DISABLED");
  });

  test("does not depend on repository, ui, llm, agent, context, workflow, or electron packages", () => {
    const packageJson = JSON.parse(readFileSync("packages/plugin-engine/package.json", "utf8")) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {})
    ]);

    expect(dependencyNames.has("@novel-studio/repository")).toBe(false);
    expect(dependencyNames.has("@novel-studio/application")).toBe(false);
    expect(dependencyNames.has("@novel-studio/ui")).toBe(false);
    expect(dependencyNames.has("@novel-studio/llm-adapter")).toBe(false);
    expect(dependencyNames.has("@novel-studio/agent-engine")).toBe(false);
    expect(dependencyNames.has("@novel-studio/context-engine")).toBe(false);
    expect(dependencyNames.has("@novel-studio/workflow-engine")).toBe(false);
    expect(dependencyNames.has("electron")).toBe(false);
  });
});
