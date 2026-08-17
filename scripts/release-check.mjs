import { Buffer } from "node:buffer";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { runStrictPackagedQualificationChecks } from "./release-gate-sequencing.mjs";

const require = createRequire(import.meta.url);
const Ajv = require("ajv");
const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const strictReleaseGate = options.strict;
const failures = [];
let qualifiedPackageDirectory;

await checkPackageScripts();
await checkElectronBuilderConfig();
await checkReleaseChannelManifest();
await checkReleaseNotes();
await checkPublicInstallGate();
await checkV1ShipReadiness();
const stage5OverallStatus = await checkStage5Evidence();
if (strictReleaseGate) {
  await runStrictPackagedQualificationChecks({
    verifyLayout: async () => {
      qualifiedPackageDirectory = await verifyPackagedLayout(options.packageDirectory);
      return qualifiedPackageDirectory;
    },
    verifyOwnerQualification: verifySecurityOwnerQualification,
    runPackagedE2e: runQualifiedPackagedE2e
  });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Release readiness metadata check passed.");
  console.log(
    "Public install metadata and V1 conditional-readiness records are internally consistent."
  );
  if (strictReleaseGate) {
    console.log("Strict packaged release gate passed.");
  } else if (stage5OverallStatus === "Complete") {
    console.log(
      "Stage 5 is Complete; run `npm run release:gate -- <package-dir>` to authorize a packaged artifact."
    );
  } else {
    console.log("Stage 5 is Blocked; agent-tool release authorization remains unavailable.");
  }
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
  expectScript(scripts, "release:gate", "node scripts/release-check.mjs --strict --package-dir");
  expectScript(
    scripts,
    "test:e2e:packaged",
    "playwright test --config=playwright.packaged.config.ts"
  );
}

async function runQualifiedPackagedE2e(packageDirectory) {
  const executablePath = join(packageDirectory, "Novel Studio.exe");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const completed = await new Promise((resolvePromise) => {
    const child = spawn(npmCommand, ["run", "test:e2e:packaged"], {
      cwd: root,
      env: {
        ...process.env,
        NOVEL_STUDIO_QUALIFIED_PACKAGE_EXE: executablePath
      },
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", () => resolvePromise(false));
    child.once("exit", (code) => resolvePromise(code === 0));
  });
  if (!completed) {
    failures.push("Qualified packaged Agent E2E failed.");
  }
  return completed;
}

async function verifySecurityOwnerQualification(packageDirectory) {
  const reportPath = process.env["NOVEL_STUDIO_APPROVAL_QUALIFICATION_REPORT"];
  const publicKeyFile = process.env["NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_PATH"];
  const publicKeyEnv = process.env["NOVEL_STUDIO_SECURITY_OWNER_ED25519_PUBLIC_KEY_ENV"];
  if ((publicKeyFile === undefined) === (publicKeyEnv === undefined)) {
    failures.push(
      "Strict release gate requires exactly one external Security Owner Ed25519 public key input."
    );
    return false;
  }
  const argumentsList = [
    "scripts/verify-approval-surface-qualification.mjs",
    "--app-asar",
    join(packageDirectory, "resources", "app.asar")
  ];
  if (reportPath !== undefined && reportPath.length > 0) {
    argumentsList.push("--report", reportPath);
  }
  if (publicKeyFile !== undefined && publicKeyFile.length > 0) {
    argumentsList.push("--public-key-file", publicKeyFile);
  } else if (publicKeyEnv !== undefined && publicKeyEnv.length > 0) {
    argumentsList.push("--public-key-env", publicKeyEnv);
  } else {
    failures.push("Strict release gate Security Owner public key input is empty.");
    return false;
  }
  const completed = await new Promise((resolvePromise) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", () => resolvePromise(false));
    child.once("exit", (code) => resolvePromise(code === 0));
  });
  if (!completed) {
    failures.push("Strict release gate Security Owner qualification verification failed.");
  }
  return completed;
}

function parseArguments(argumentsList) {
  let strict = false;
  let packageDirectory;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--strict") {
      strict = true;
      continue;
    }
    if (argument === "--package-dir") {
      const candidate = argumentsList[index + 1];
      if (candidate === undefined || candidate.startsWith("--")) {
        throw new Error("--package-dir requires a value.");
      }
      packageDirectory = candidate;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported release-check argument: ${argument}`);
  }
  if (strict && packageDirectory === undefined) {
    throw new Error("--strict requires an explicit --package-dir.");
  }
  if (packageDirectory !== undefined && !strict) {
    throw new Error("--package-dir is only valid with --strict.");
  }
  return { strict, packageDirectory };
}

async function verifyPackagedLayout(packageDirectory) {
  const layoutFailures = [];
  const failLayout = (message) => {
    layoutFailures.push(message);
    failures.push(message);
  };
  if (!isNonEmptyString(packageDirectory)) {
    failLayout("Strict release gate requires a non-empty packaged directory path.");
    return undefined;
  }

  const requestedDirectory = resolve(root, packageDirectory);
  let packageStat;
  let canonicalDirectory;
  try {
    packageStat = await lstat(requestedDirectory);
    canonicalDirectory = await realpath(requestedDirectory);
  } catch {
    failLayout("Strict release gate package directory does not exist or cannot be canonicalized.");
    return undefined;
  }
  if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
    failLayout("Strict release gate package directory must be a regular canonical directory.");
    return undefined;
  }

  const electronExecutable = join(canonicalDirectory, "Novel Studio.exe");
  const resourcesDirectory = join(canonicalDirectory, "resources");
  const appAsar = join(resourcesDirectory, "app.asar");
  if (
    !(await isContainedRegularFile(canonicalDirectory, electronExecutable)) ||
    !(await isPortableExecutable(electronExecutable))
  ) {
    failLayout("Strict release gate package is missing a valid Electron executable.");
  } else if (!(await hasValidWindowsAuthenticodeSignature(electronExecutable))) {
    failLayout("Strict release gate requires a valid Windows Authenticode signature.");
  }
  if (!(await isContainedRegularDirectory(canonicalDirectory, resourcesDirectory))) {
    failLayout("Strict release gate package is missing a canonical resources directory.");
  }
  if (!(await isContainedRegularFile(canonicalDirectory, appAsar))) {
    failLayout("Strict release gate package is missing resources/app.asar.");
  } else if (!(await hasExpectedAsarPackageMetadata(appAsar))) {
    failLayout("Strict release gate app.asar is missing expected package metadata.");
  }

  return layoutFailures.length === 0 ? canonicalDirectory : undefined;
}

async function hasValidWindowsAuthenticodeSignature(executablePath) {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined) return false;
  const windowsPowerShellRoot = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
  return new Promise((resolvePromise) => {
    execFile(
      join(windowsPowerShellRoot, "powershell.exe"),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Import-Module $env:NOVEL_STUDIO_SIGNATURE_MODULE -ErrorAction Stop; $signature = Get-AuthenticodeSignature -LiteralPath $env:NOVEL_STUDIO_SIGNATURE_TARGET; if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) { exit 1 }"
      ],
      {
        env: {
          ...process.env,
          NOVEL_STUDIO_SIGNATURE_TARGET: executablePath,
          NOVEL_STUDIO_SIGNATURE_MODULE: join(
            windowsPowerShellRoot,
            "Modules",
            "Microsoft.PowerShell.Security",
            "Microsoft.PowerShell.Security.psd1"
          )
        },
        windowsHide: true
      },
      (error) => resolvePromise(error === null)
    );
  });
}

async function hasExpectedAsarPackageMetadata(asarPath) {
  try {
    const { extractFile, listPackage } = require("@electron/asar");
    const packageEntry = listPackage(asarPath).find(
      (entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "") === "package.json"
    );
    if (packageEntry === undefined) return false;
    const metadata = JSON.parse(extractFile(asarPath, packageEntry).toString("utf8"));
    return isRecord(metadata) && metadata.main === "apps/desktop/dist/main/index.js";
  } catch {
    return false;
  }
}

async function isContainedRegularFile(base, candidate) {
  try {
    const candidateStat = await lstat(candidate);
    const resolvedCandidate = await realpath(candidate);
    return (
      candidateStat.isFile() &&
      !candidateStat.isSymbolicLink() &&
      isContainedPath(base, resolvedCandidate)
    );
  } catch {
    return false;
  }
}

async function isContainedRegularDirectory(base, candidate) {
  try {
    const candidateStat = await lstat(candidate);
    const resolvedCandidate = await realpath(candidate);
    return (
      candidateStat.isDirectory() &&
      !candidateStat.isSymbolicLink() &&
      isContainedPath(base, resolvedCandidate)
    );
  } catch {
    return false;
  }
}

async function isPortableExecutable(path) {
  try {
    const bytes = await readFile(path);
    const peOffset = bytes.readUInt32LE(0x3c);
    return (
      bytes.length >= 0x40 &&
      bytes[0] === 0x4d &&
      bytes[1] === 0x5a &&
      peOffset >= 0x40 &&
      peOffset + 4 <= bytes.length &&
      bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\\0\\0"))
    );
  } catch {
    return false;
  }
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
  if (config.win?.icon !== "apps/desktop/build/icon-shanhai.png") {
    failures.push("Windows builder config must declare the icon asset.");
  }
  if (!(await fileExists("apps/desktop/build/icon-shanhai.png"))) {
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
  if (!notes.includes("M18 插件系统边界")) {
    failures.push("Release notes must include M18 plugin system boundary notes.");
  }
}

async function checkPublicInstallGate() {
  const packageJson = await readJson("package.json");
  const scripts = packageJson.scripts;
  if (!isRecord(scripts)) {
    failures.push("Root package.json scripts must be available for the public install gate.");
    return;
  }

  expectScript(scripts, "test:e2e", "npm run build && npm run test:e2e:built");
  expectScript(scripts, "package:artifact-check", "node scripts/artifact-secret-scan.mjs");

  const publicGatePath = "docs/packaging/m97-public-install-release-gate.md";
  if (!(await fileExists(publicGatePath))) {
    failures.push(`Public install release gate document is missing: ${publicGatePath}`);
    return;
  }

  const publicGate = await readFile(join(root, publicGatePath), "utf8");
  const requiredPhrases = [
    "Windows public install gate",
    "signing.required=true",
    "npm run test:e2e",
    "npm run package:artifact-check",
    "No macOS notarization is required unless macOS artifacts enter v1."
  ];

  for (const phrase of requiredPhrases) {
    if (!publicGate.includes(phrase)) {
      failures.push(`Public install release gate document must include: ${phrase}`);
    }
  }
}

async function checkV1ShipReadiness() {
  const readinessPath = "docs/releases/m98-v1-ship-readiness.md";
  if (!(await fileExists(readinessPath))) {
    failures.push(`V1 ship readiness document is missing: ${readinessPath}`);
    return;
  }

  const readiness = await readFile(join(root, readinessPath), "utf8");
  const requiredPhrases = [
    "V1 ship decision: CONDITIONAL HOLD",
    "Core writing journey evidence",
    "npm run test:e2e",
    "npm run release:check",
    "live provider manual verification pending",
    "V2/backlog deferred scope",
    "Reading aloud decision: GO for v1.1 backlog, NO for v1 blocker.",
    "No M99/M100 is authorized unless M98 finds a v1 blocker.",
    "M98 final gate: conditional hold until manual live provider verification passes."
  ];

  for (const phrase of requiredPhrases) {
    if (!readiness.includes(phrase)) {
      failures.push(`V1 ship readiness document must include: ${phrase}`);
    }
  }
}

async function checkStage5Evidence() {
  const evidencePath = "docs/releases/stage5-agent-tool-evidence.json";
  if (!(await fileExists(evidencePath))) {
    failures.push(`Stage 5 evidence manifest is missing: ${evidencePath}`);
    return;
  }

  let manifest;
  try {
    manifest = await readJson(evidencePath);
  } catch {
    failures.push("Stage 5 evidence manifest must be valid JSON.");
    return;
  }

  const allowedStatuses = new Set(["Partial", "Blocked", "Unavailable", "Complete"]);
  const allowedEvidenceKinds = new Set([
    "unit",
    "source",
    "gate",
    "decision",
    "production-e2e",
    "security-qualification"
  ]);
  const requiredPhases = new Set([
    "phase-0",
    "phase-a",
    "phase-b",
    "phase-d",
    "phase-e3",
    "phase-c0",
    "phase-c1-c4",
    "phase-e1-e2",
    "phase-e4",
    "phase-f"
  ]);
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== "1.0" ||
    (manifest.overallStatus !== "Blocked" && manifest.overallStatus !== "Complete") ||
    !Array.isArray(manifest.phases)
  ) {
    failures.push(
      "Stage 5 evidence manifest must declare schema 1.0 and an overall Blocked or Complete status."
    );
    return undefined;
  }
  if (strictReleaseGate && manifest.overallStatus !== "Complete") {
    failures.push(
      `Strict release gate cannot pass while Stage 5 overall status is ${manifest.overallStatus}.`
    );
  }

  const actualPhases = new Set();
  for (const phase of manifest.phases) {
    if (!isRecord(phase) || typeof phase.id !== "string") {
      failures.push("Every Stage 5 evidence entry must have an id.");
      continue;
    }
    actualPhases.add(phase.id);
    const evidence = Array.isArray(phase.evidence) ? phase.evidence : [];
    const complete = phase.status === "Complete";
    const productionEvidence = evidence.some(
      (item) => isRecord(item) && item.kind === "production-e2e"
    );
    const securityEvidence = evidence.some(
      (item) => isRecord(item) && item.kind === "security-qualification"
    );

    if (
      !allowedStatuses.has(phase.status) ||
      typeof phase.releaseEligible !== "boolean" ||
      typeof phase.productionRuntimeWired !== "boolean" ||
      typeof phase.securityQualified !== "boolean" ||
      typeof phase.userControlsComplete !== "boolean" ||
      typeof phase.endToEndEvidence !== "boolean" ||
      evidence.length === 0 ||
      !evidence.every(
        (item) =>
          isRecord(item) &&
          allowedEvidenceKinds.has(item.kind) &&
          isSafeEvidencePath(item.path) &&
          hasEvidenceKindSemantics(item.kind, item.path)
      )
    ) {
      failures.push(`Stage 5 evidence entry is incomplete: ${phase.id}.`);
      continue;
    }
    if (
      complete &&
      (!phase.productionRuntimeWired ||
        !phase.securityQualified ||
        !phase.userControlsComplete ||
        !phase.endToEndEvidence ||
        !productionEvidence ||
        !securityEvidence)
    ) {
      failures.push(
        `Stage 5 phase ${phase.id} cannot be Complete without production and security evidence.`
      );
    }
    if (!complete && phase.releaseEligible) {
      failures.push(`Stage 5 non-Complete phase ${phase.id} cannot be release eligible.`);
    }
    if (strictReleaseGate && (!complete || !phase.releaseEligible)) {
      failures.push(
        `Strict release gate requires Phase ${phase.id} to be Complete and release eligible.`
      );
    }
    for (const item of evidence) {
      if (!isSafeEvidencePath(item.path) || !hasEvidenceKindSemantics(item.kind, item.path)) {
        failures.push(`Stage 5 evidence entry has an unsafe kind or path for ${phase.id}.`);
      } else if (!(await fileExists(item.path))) {
        failures.push(`Stage 5 evidence path is missing for ${phase.id}: ${item.path}`);
      }
    }
  }

  for (const phaseId of requiredPhases) {
    if (!actualPhases.has(phaseId)) {
      failures.push(`Stage 5 evidence manifest is missing required phase: ${phaseId}`);
    }
  }

  if (
    manifest.overallStatus === "Complete" &&
    manifest.phases.some((phase) => !isRecord(phase) || phase.status !== "Complete")
  ) {
    failures.push("Stage 5 overall Complete status requires every phase to be Complete.");
  }
  if (
    manifest.overallStatus === "Complete" &&
    manifest.phases.some((phase) => !isRecord(phase) || phase.releaseEligible !== true)
  ) {
    failures.push("Stage 5 overall Complete status requires every phase to be release eligible.");
  }

  const roadmap = await readFile(join(root, "ROADMAP.md"), "utf8");
  const readiness = await readFile(join(root, "docs/releases/m98-v1-ship-readiness.md"), "utf8");
  for (const phase of manifest.phases) {
    const rowPattern = new RegExp(
      `\\|\\s*${escapeRegExp(phase.label)}\\s*\\|\\s*${escapeRegExp(phase.status)}\\s*\\|`
    );
    if (!rowPattern.test(roadmap) || !rowPattern.test(readiness)) {
      failures.push(`Stage 5 status row must match the evidence manifest: ${phase.id}`);
    }
  }

  return manifest.overallStatus;
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

function isSafeEvidencePath(value) {
  if (!isNonEmptyString(value) || value.includes("\0") || isAbsolute(value)) return false;
  return value
    .split(/[\\/]+/)
    .every((part) => part.length > 0 && part !== "." && part !== ".." && !part.includes(":"));
}

function hasEvidenceKindSemantics(kind, path) {
  const normalizedPath = path.replace(/\\/g, "/");
  if (kind === "unit")
    return /(?:^|\/)test\//.test(normalizedPath) && /\.test\.[cm]?[jt]sx?$/.test(normalizedPath);
  if (kind === "source") return /\/src\//.test(normalizedPath);
  if (kind === "gate")
    return normalizedPath.startsWith("scripts/") && normalizedPath.endsWith(".mjs");
  if (kind === "decision")
    return normalizedPath.startsWith("docs/superpowers/plans/") && normalizedPath.endsWith(".md");
  if (kind === "production-e2e") return /\.e2e\.[cm]?[jt]sx?$/.test(normalizedPath);
  if (kind === "security-qualification")
    return /(?:qualification|attestation|security)/i.test(normalizedPath);
  return false;
}

function isContainedPath(base, candidate) {
  const relativePath = relative(base, candidate);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !isAbsolute(relativePath)
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
