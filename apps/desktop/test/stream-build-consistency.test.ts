import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

interface BuildManifest {
  readonly schemaVersion: "1.0";
  readonly sourceRevision: string;
  readonly sourceDirty: boolean;
  readonly artifacts: Record<
    "main" | "preload" | "renderer",
    { readonly path: string; readonly sha256: string; readonly sourceRevision: string }
  >;
}

describe("Electron stream build consistency", () => {
  test("records one source revision and matching hashes for main, preload, and renderer", async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as {
      readonly scripts: Record<string, string>;
    };
    expect(packageJson.scripts["build"]).toContain("node scripts/write-build-manifest.mjs");

    const manifest = JSON.parse(
      await readFile(join(process.cwd(), "apps", "desktop", "dist", "build-manifest.json"), "utf8")
    ) as BuildManifest;
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.sourceRevision).toMatch(/^[0-9a-f]{40}$/);

    for (const artifact of Object.values(manifest.artifacts)) {
      const bytes = await readFile(join(process.cwd(), artifact.path));
      expect(artifact.sourceRevision).toBe(manifest.sourceRevision);
      expect(artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });
});
