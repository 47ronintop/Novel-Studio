import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const { extractFile, listPackage, statFile } = require("@electron/asar");

const root = process.cwd();
const artifactPath = process.argv[2] ?? (await resolveDefaultArtifactPath());
const absoluteArtifactPath = resolve(root, artifactPath);
const failures = [];
let asarCount = 0;

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".ts",
  ".txt",
  ".yml"
]);

const secretPatterns = [
  { name: "OpenAI API key", pattern: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: "Generic plaintext API key", pattern: /api[_-]?key["']?\s*[:=]\s*["'][^"']{12,}["']/i },
  { name: "Generic plaintext token", pattern: /token["']?\s*[:=]\s*["'][^"']{16,}["']/i },
  { name: "Stage 5 API key fixture", pattern: /sk-nested-secret/ },
  { name: "Stage 5 prompt body fixture", pattern: /private chapter text/ },
  { name: "Stage 5 file body fixture", pattern: /chapter contents/ },
  { name: "Stage 5 raw provider frame fixture", pattern: /Bearer must-not-cross-boundary/ }
];

await assertArtifactExists();
await scanDirectory(absoluteArtifactPath);
if (asarCount === 0) {
  failures.push("Artifact package must contain app.asar.");
}

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
  } catch (error) {
    failures.push(
      `Unable to scan artifact directory ${formatPath(directoryPath)}: ${formatError(error)}`
    );
    return;
  }

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(entryPath);
      continue;
    }
    if (!entry.isFile()) {
      failures.push(`Unsupported artifact entry: ${formatPath(entryPath)}`);
      continue;
    }
    if (entry.name === "app.asar") {
      asarCount += 1;
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

  assertRequiredAsarFiles(files);
  assertNoCompiledTestOutput(files);

  for (const filePath of files) {
    if (!shouldScanTextFile(filePath)) {
      continue;
    }
    const asarEntryPath = filePath.replace(/^[/\\]+/, "");
    try {
      const file = statFile(asarPath, asarEntryPath);
      if ("files" in file) {
        continue;
      }
    } catch (error) {
      failures.push(
        `Unable to inspect app.asar file ${normalizeAsarPath(filePath)}: ${formatError(error)}`
      );
      continue;
    }
    let buffer;
    try {
      buffer = extractFile(asarPath, asarEntryPath);
    } catch (error) {
      failures.push(
        `Unable to extract app.asar file ${normalizeAsarPath(filePath)}: ${formatError(error)}`
      );
      continue;
    }
    scanContent(buffer.toString("utf8"), `app.asar${sep}${filePath}`);
  }
}

function assertRequiredAsarFiles(files) {
  const fileSet = new Set(files.map(normalizeAsarPath));
  const requiredFiles = [
    "/packages/schemas/schema/project.schema.json",
    "/packages/schemas/schema/settings.schema.json",
    "/packages/schemas/schema/chapter-frontmatter.schema.json",
    "/packages/schemas/schema/plugin-registry.schema.json"
  ];

  for (const requiredFile of requiredFiles) {
    if (!fileSet.has(requiredFile)) {
      failures.push(`Required runtime schema missing from app.asar: ${requiredFile}`);
    }
  }
}

function assertNoCompiledTestOutput(files) {
  for (const filePath of files.map(normalizeAsarPath)) {
    if (/^\/packages\/[^/]+\/dist\/test(?:\/|$)/.test(filePath)) {
      failures.push(`Compiled test output must not be packaged: ${filePath}`);
    }
  }
}

function normalizeAsarPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function resolveDefaultArtifactPath() {
  try {
    const latest = await readFile(join(root, "release", "latest-package-dir.txt"), "utf8");
    return latest.trim();
  } catch {
    return "release/win-unpacked";
  }
}
