import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const root = process.cwd();
const failures = [];

await checkPackageScripts();
await checkElectronBuilderConfig();
await checkReleaseChannelManifest();
await checkReleaseNotes();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Release check passed");
}

async function checkPackageScripts() {
  const packageJson = await readJson("package.json");
  const scripts = packageJson.scripts;

  if (!isRecord(scripts)) {
    failures.push("Root package.json scripts must be an object.");
    return;
  }

  expectScript(scripts, "package:installer", "node scripts/package-installer.mjs");
  expectScript(scripts, "release:notes", "node scripts/release-notes.mjs");
  expectScript(scripts, "release:check", "node scripts/release-check.mjs");
}

async function checkElectronBuilderConfig() {
  const config = require("../apps/desktop/electron-builder.config.cjs");
  const targets = new Set(
    (Array.isArray(config.win?.target) ? config.win.target : []).map((target) =>
      typeof target === "string" ? target : target.target
    )
  );

  if (!targets.has("dir")) {
    failures.push("Windows builder config must keep dir target.");
  }
  if (!targets.has("nsis")) {
    failures.push("Windows builder config must include nsis target.");
  }
  if (config.win?.forceCodeSigning !== false) {
    failures.push("Local beta release channel must not require code signing.");
  }
  if (config.win?.icon !== "apps/desktop/build/icon.svg") {
    failures.push("Windows builder config must declare the icon asset.");
  }
  if (!(await fileExists("apps/desktop/build/icon.svg"))) {
    failures.push("Icon asset is missing.");
  }
  if (config.nsis?.oneClick !== false) {
    failures.push("NSIS oneClick must be false for assisted installation.");
  }
}

async function checkReleaseChannelManifest() {
  const schema = await readJson("packages/schemas/schema/release-channel.schema.json");
  const manifest = await readJson("release-channel/beta.json");
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    failures.push(
      `Release channel manifest is invalid: ${(validate.errors ?? [])
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
        .join("; ")}`
    );
    return;
  }

  if (manifest.channel !== "beta") {
    failures.push("Release channel manifest must describe the beta channel.");
  }
  if (manifest.publishMode !== "manual") {
    failures.push("M17 release channel must use manual publish mode.");
  }
  if (manifest.signing.required !== false) {
    failures.push("M17 beta signing must be explicit and optional.");
  }
}

async function checkReleaseNotes() {
  const manifest = await readJson("release-channel/beta.json");
  if (!isRecord(manifest) || typeof manifest.releaseNotesPath !== "string") {
    failures.push("Release channel manifest must contain releaseNotesPath.");
    return;
  }

  if (!(await fileExists(manifest.releaseNotesPath))) {
    failures.push(`Release notes file is missing: ${manifest.releaseNotesPath}`);
    return;
  }

  const notes = await readFile(join(root, manifest.releaseNotesPath), "utf8");
  if (!notes.includes("M17 安装器与发布通道")) {
    failures.push("Release notes must include M17 installer and release channel notes.");
  }
}

function expectScript(scripts, name, expected) {
  if (scripts[name] !== expected) {
    failures.push(`Root package.json must expose ${name} as ${expected}.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(join(root, filePath), "utf8"));
}

async function fileExists(filePath) {
  try {
    await stat(join(root, filePath));
    return true;
  } catch {
    return false;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
