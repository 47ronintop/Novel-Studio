import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, test } from "vitest";

import { PluginRegistryFileRepository } from "../src/plugin-registry-repository.js";

describe("plugin registry repository", () => {
  test("reads a schema-validated project plugin registry", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-plugins-"));
    await mkdir(join(projectRoot, "plugins"), { recursive: true });
    await writeFile(
      join(projectRoot, "plugins", "plugins.json"),
      JSON.stringify(
        {
          schemaVersion: "1.0",
          plugins: [
            {
              pluginId: "novel.timeline-tools",
              enabled: true,
              manifestPath: "plugins/novel.timeline-tools/plugin.json",
              grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }]
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );
    const repository = new PluginRegistryFileRepository({ projectRoot });

    const result = await repository.readPluginRegistry();

    expect(result).toMatchObject({
      ok: true,
      value: {
        plugins: [{ pluginId: "novel.timeline-tools", enabled: true }]
      }
    });
  });

  test("rejects invalid plugin registry files before returning data", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-plugins-invalid-"));
    await mkdir(join(projectRoot, "plugins"), { recursive: true });
    await writeFile(
      join(projectRoot, "plugins", "plugins.json"),
      JSON.stringify({
        schemaVersion: "1.0",
        plugins: [{ pluginId: "Plugin With Spaces", enabled: true, manifestPath: "../plugin.json" }]
      }),
      "utf8"
    );
    const repository = new PluginRegistryFileRepository({ projectRoot });

    const result = await repository.readPluginRegistry();

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PLUGIN_REGISTRY_FILE_INVALID"
      }
    });
  });

  test("reads validated plugin manifest summaries for registered plugins", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-plugin-manifest-"));
    await writePluginRegistryProject(projectRoot, true);
    const repository = new PluginRegistryFileRepository({ projectRoot });

    const result = await repository.readPluginSettings();

    expect(result).toMatchObject({
      ok: true,
      value: {
        plugins: [
          {
            pluginId: "novel.timeline-tools",
            enabled: true,
            manifestStatus: "valid",
            manifest: {
              displayName: "Timeline Tools",
              version: "1.2.3",
              entryKind: "none",
              capabilities: [{ type: "asset-view", id: "timeline.rail" }],
              requestedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }],
              contributes: {
                commands: [{ id: "timeline.open-map", title: "Open timeline map" }],
                workflowSteps: []
              }
            }
          }
        ]
      }
    });
  });

  test("persists plugin enabled state changes through schema-validated registry writes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-plugin-toggle-"));
    await writePluginRegistryProject(projectRoot, true);
    const repository = new PluginRegistryFileRepository({ projectRoot });

    const result = await repository.setPluginEnabled("novel.timeline-tools", false);

    expect(result).toMatchObject({
      ok: true,
      value: {
        plugins: [{ pluginId: "novel.timeline-tools", enabled: false }]
      }
    });

    const stored = JSON.parse(
      await readFile(join(projectRoot, "plugins", "plugins.json"), "utf8")
    ) as { plugins: { pluginId: string; enabled: boolean }[] };
    expect(stored.plugins[0]).toMatchObject({
      pluginId: "novel.timeline-tools",
      enabled: false
    });
  });
});

async function writePluginRegistryProject(projectRoot: string, enabled: boolean): Promise<void> {
  await mkdir(join(projectRoot, "plugins", "novel.timeline-tools"), { recursive: true });
  await writeFile(
    join(projectRoot, "plugins", "plugins.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        plugins: [
          {
            pluginId: "novel.timeline-tools",
            enabled,
            manifestPath: "plugins/novel.timeline-tools/plugin.json",
            grantedPermissions: [{ permission: "asset:read", scopes: ["timeline"] }]
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    join(projectRoot, "plugins", "novel.timeline-tools", "plugin.json"),
    JSON.stringify(
      {
        schemaVersion: "1.0",
        id: "novel.timeline-tools",
        displayName: "Timeline Tools",
        version: "1.2.3",
        entry: {
          kind: "none",
          command: "plugin.js"
        },
        compatibleAppVersion: {
          min: "0.1.0",
          max: "0.2.0"
        },
        capabilities: [
          {
            type: "asset-view",
            id: "timeline.rail",
            title: "Timeline Rail"
          }
        ],
        permissions: [{ permission: "asset:read", scopes: ["timeline"] }],
        contributes: {
          commands: [{ id: "timeline.open-map", title: "Open timeline map" }],
          workflowSteps: []
        }
      },
      null,
      2
    ),
    "utf8"
  );
}
