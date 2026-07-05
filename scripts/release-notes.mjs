import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "release-channel", "beta.json"), "utf8"));
const sourcePath = join(root, manifest.releaseNotesPath);
const outputPath = join(root, "release", "notes", "novel-studio-v0.1.0-beta.md");
const notes = await readFile(sourcePath, "utf8");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, notes, "utf8");

console.log(`Release notes ready: ${outputPath}`);
