import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const manifestPath = join(root, "apps", "desktop", "dist", "build-manifest.json");
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8"
}).trim();
const sourceDirty =
  execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
const artifactPaths = {
  main: "apps/desktop/dist/main/index.js",
  preload: "apps/desktop/dist/preload/index.cjs",
  renderer: "apps/desktop/dist/renderer/index.html"
};
const artifacts = {};

for (const [name, path] of Object.entries(artifactPaths)) {
  const bytes = await readFile(join(root, path));
  artifacts[name] = {
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceRevision
  };
}

await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      sourceRevision,
      sourceDirty,
      builtAt: new Date().toISOString(),
      artifacts
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Build manifest written for ${sourceRevision}${sourceDirty ? " (dirty)" : ""}`);
