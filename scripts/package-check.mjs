import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const failures = [];

await checkPackageScripts();
await checkBuildArtifacts();
await checkElectronBuilderConfig();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Package check passed");
}

async function checkPackageScripts() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (packageJson.scripts?.["package:dir"] === undefined) {
    failures.push("Missing package:dir script.");
  }
  if (
    packageJson.scripts?.["package:check"] !== "npm run build && node scripts/package-check.mjs"
  ) {
    failures.push("Missing package:check script.");
  }
}

async function checkBuildArtifacts() {
  const requiredFiles = [
    "apps/desktop/dist/main/index.js",
    "apps/desktop/dist/preload/index.js",
    "apps/desktop/dist/renderer/index.html",
    "packages/application/dist/src/index.js",
    "packages/repository/dist/src/index.js",
    "packages/ui/dist/src/index.js"
  ];

  for (const filePath of requiredFiles) {
    if (!(await fileExists(join(root, filePath)))) {
      failures.push(`Missing package artifact: ${filePath}`);
    }
  }

  const rendererHtmlPath = join(root, "apps", "desktop", "dist", "renderer", "index.html");
  if (await fileExists(rendererHtmlPath)) {
    const rendererHtml = await readFile(rendererHtmlPath, "utf8");
    if (!/assets\/index-[A-Za-z0-9_-]+\.js/.test(rendererHtml)) {
      failures.push("Renderer HTML must point to a bundled JavaScript asset.");
    }
  }
}

async function checkElectronBuilderConfig() {
  const config = require("../apps/desktop/electron-builder.config.cjs");
  if (config.productName !== "Novel Studio") {
    failures.push("Electron package productName must be Novel Studio.");
  }
  if (config.extraMetadata?.main !== "apps/desktop/dist/main/index.js") {
    failures.push("Electron package main entry must point to desktop dist main.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("apps/desktop/dist/**")) {
    failures.push("Electron package files must include desktop dist artifacts.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("packages/*/dist/**")) {
    failures.push("Electron package files must include workspace package dist artifacts.");
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
