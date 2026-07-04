import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const failures = [];

await checkRequiredFiles();
await checkPackageScripts();
await checkSecretLikeTokens();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Alpha check passed");
}

async function checkRequiredFiles() {
  const requiredFiles = [
    "apps/desktop/dist/main/index.js",
    "apps/desktop/dist/preload/index.js",
    "apps/desktop/dist/renderer/index.html",
    "packages/application/dist/src/index.js",
    "packages/repository/dist/src/index.js",
    "packages/ui/dist/src/index.js",
    "docs/performance/m9-alpha-baseline.md",
    "apps/desktop/electron-builder.config.cjs",
    "apps/desktop/vite.config.ts",
    "scripts/create-performance-fixture.mjs"
  ];

  for (const filePath of requiredFiles) {
    if (!(await fileExists(join(root, filePath)))) {
      failures.push(`Missing alpha artifact: ${filePath}`);
    }
  }
}

async function checkPackageScripts() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (packageJson.scripts?.build !== "npm run build:types && npm run build:renderer") {
    failures.push("Root package.json must expose build script as the M10 type and renderer build.");
  }
  if (packageJson.scripts?.["build:types"] !== "tsc -b") {
    failures.push("Root package.json must expose build:types script.");
  }
  if (
    packageJson.scripts?.["build:renderer"] !== "vite build --config apps/desktop/vite.config.ts"
  ) {
    failures.push("Root package.json must expose build:renderer script.");
  }
  if (packageJson.scripts?.["alpha:check"] !== "npm run build && node scripts/alpha-check.mjs") {
    failures.push("Root package.json must expose alpha:check script.");
  }
  if (
    packageJson.scripts?.["package:check"] !== "npm run build && node scripts/package-check.mjs"
  ) {
    failures.push("Root package.json must expose package:check script.");
  }
  if (
    packageJson.scripts?.["package:dir"] !==
    "npm run build && electron-builder --dir --config apps/desktop/electron-builder.config.cjs"
  ) {
    failures.push("Root package.json must expose package:dir script.");
  }

  const rendererHtmlPath = join(root, "apps", "desktop", "dist", "renderer", "index.html");
  if (await fileExists(rendererHtmlPath)) {
    const rendererHtml = await readFile(rendererHtmlPath, "utf8");
    if (!/assets\/index-[A-Za-z0-9_-]+\.js/.test(rendererHtml)) {
      failures.push("Renderer HTML must load a Vite bundled asset.");
    }
  }
}

async function checkSecretLikeTokens() {
  const scannedRoots = ["apps", "packages", "fixtures", "docs"];
  const secretPattern = /\bsk-[A-Za-z0-9_-]{4,}\b/;

  for (const scannedRoot of scannedRoots) {
    const absoluteRoot = join(root, scannedRoot);
    if (!(await fileExists(absoluteRoot))) {
      continue;
    }

    const filePaths = await listFiles(absoluteRoot);
    for (const filePath of filePaths) {
      const relativePath = normalizePath(relative(root, filePath));
      if (shouldSkipSecretScan(relativePath)) {
        continue;
      }

      const content = await readFile(filePath, "utf8");
      if (secretPattern.test(content)) {
        failures.push(`Secret-like token found in ${relativePath}`);
      }
    }
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function shouldSkipSecretScan(relativePath) {
  return (
    relativePath.includes("/dist/") ||
    relativePath.includes("/test/") ||
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(".tsbuildinfo")
  );
}

function normalizePath(filePath) {
  return filePath.split(sep).join("/");
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
