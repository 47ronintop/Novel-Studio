import { mkdir, writeFile } from "node:fs/promises";
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
});
