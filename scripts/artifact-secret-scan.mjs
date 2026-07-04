import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const require = createRequire(import.meta.url);
const { extractFile, listPackage } = require("@electron/asar");

const root = process.cwd();
const artifactPath = process.argv[2] ?? (await resolveDefaultArtifactPath());
const absoluteArtifactPath = join(root, artifactPath);
const failures = [];

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".txt",
  ".yml"
]);

const secretPatterns = [
  { name: "OpenAI API key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: "Generic plaintext API key", pattern: /api[_-]?key["']?\s*[:=]\s*["'][^"']{12,}["']/i },
  { name: "Generic plaintext token", pattern: /token["']?\s*[:=]\s*["'][^"']{16,}["']/i }
];

await assertArtifactExists();
await scanDirectory(absoluteArtifactPath);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Artifact secret scan passed: ${artifactPath}`);
}

async function assertArtifactExists() {
  try {
    const artifactStat = await stat(absoluteArtifactPath);
    if (!artifactStat.isDirectory()) {
      failures.push(`Artifact path is not a directory: ${artifactPath}`);
    }
  } catch {
    failures.push(`Artifact path does not exist: ${artifactPath}`);
  }
}

async function scanDirectory(directoryPath) {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === "app.asar") {
      await scanAsar(entryPath);
      continue;
    }
    if (shouldScanTextFile(entry.name)) {
      await scanText(entryPath, formatPath(entryPath));
    }
  }
}

async function scanAsar(asarPath) {
  let files;
  try {
    files = listPackage(asarPath);
  } catch (error) {
    failures.push(
      `Unable to read app.asar: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  for (const filePath of files) {
    if (!shouldScanTextFile(filePath)) {
      continue;
    }
    let buffer;
    try {
      buffer = extractFile(asarPath, filePath);
    } catch {
      continue;
    }
    scanContent(buffer.toString("utf8"), `app.asar${sep}${filePath}`);
  }
}

async function scanText(filePath, displayPath) {
  const content = await readFile(filePath, "utf8");
  scanContent(content, displayPath);
}

function scanContent(content, displayPath) {
  for (const { name, pattern } of secretPatterns) {
    if (pattern.test(content)) {
      failures.push(`${name} pattern found in ${displayPath}`);
    }
  }
}

function shouldScanTextFile(filePath) {
  for (const extension of textExtensions) {
    if (filePath.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function formatPath(filePath) {
  return relative(root, filePath);
}

async function resolveDefaultArtifactPath() {
  try {
    const latest = await readFile(join(root, "release", "latest-package-dir.txt"), "utf8");
    return latest.trim();
  } catch {
    return "release/win-unpacked";
  }
}
