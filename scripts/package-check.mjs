import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const failures = [];

await checkPackageScripts();
await checkPackagingEnvironment();
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
  if (packageJson.scripts?.["package:artifact-check"] !== "node scripts/artifact-secret-scan.mjs") {
    failures.push("Missing package:artifact-check script.");
  }
  if (packageJson.scripts?.["package:dir"] !== "node scripts/package-dir.mjs") {
    failures.push("package:dir must use the stable package-dir wrapper.");
  }
  if (packageJson.scripts?.["package:installer"] !== "node scripts/package-installer.mjs") {
    failures.push("Missing package:installer script.");
  }
  if (packageJson.scripts?.["release:notes"] !== "node scripts/release-notes.mjs") {
    failures.push("Missing release:notes script.");
  }
  if (packageJson.scripts?.["release:check"] !== "node scripts/release-check.mjs") {
    failures.push("Missing release:check script.");
  }
}

async function checkPackagingEnvironment() {
  const npmrcPath = join(root, ".npmrc");
  if (!(await fileExists(npmrcPath))) {
    failures.push("Missing .npmrc for Electron download mirror.");
  } else {
    const npmrc = await readFile(npmrcPath, "utf8");
    if (!npmrc.includes("electron_mirror=https://npmmirror.com/mirrors/electron/")) {
      failures.push("Electron mirror must be configured for repeatable package:dir.");
    }
  }

  const gitignorePath = join(root, ".gitignore");
  const gitignore = await readFile(gitignorePath, "utf8");
  if (!/^release\/$/m.test(gitignore)) {
    failures.push("release/ must be ignored so package artifacts are not committed.");
  }
}

async function checkBuildArtifacts() {
  const requiredFiles = [
    "apps/desktop/dist/main/index.js",
    "apps/desktop/dist/preload/index.cjs",
    "apps/desktop/dist/renderer/index.html",
    "packages/application/dist/src/index.js",
    "packages/repository/dist/src/index.js",
    "packages/ui/dist/src/index.js",
    "packages/plugin-engine/dist/src/index.js"
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
  if (config.directories?.output !== "release") {
    failures.push("Electron package output must default to release.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("apps/desktop/dist/**")) {
    failures.push("Electron package files must include desktop dist artifacts.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("packages/*/dist/**")) {
    failures.push("Electron package files must include workspace package dist artifacts.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("packages/schemas/schema/**")) {
    failures.push("Electron package files must include JSON Schema runtime contracts.");
  }
  if (config.artifactName !== "Novel-Studio-${version}-${os}-${arch}.${ext}") {
    failures.push("Electron package artifactName must be stable and include version/os/arch.");
  }
  if (config.directories?.buildResources !== "apps/desktop/build") {
    failures.push("Electron package buildResources must point to desktop build assets.");
  }
  if (config.win?.icon !== "apps/desktop/build/icon.svg") {
    failures.push("Windows package must declare the Novel Studio icon asset.");
  }
  if (!(await fileExists(join(root, "apps", "desktop", "build", "icon.svg")))) {
    failures.push("Missing desktop icon asset.");
  }
  if (config.win?.forceCodeSigning !== false) {
    failures.push("Local beta packaging must not require code signing in CI.");
  }
  const winTargets = new Set(
    (Array.isArray(config.win?.target) ? config.win.target : []).map((target) =>
      typeof target === "string" ? target : target.target
    )
  );
  if (!winTargets.has("dir")) {
    failures.push("Windows package target must keep dir output for artifact scanning.");
  }
  if (!winTargets.has("nsis")) {
    failures.push("Windows package target must include NSIS installer output.");
  }
  if (config.nsis?.oneClick !== false) {
    failures.push("NSIS installer must use assisted install mode.");
  }
  if (config.nsis?.allowToChangeInstallationDirectory !== true) {
    failures.push("NSIS installer must allow changing installation directory.");
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
