import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const failures = [];

await checkPackageScripts();
await checkPackagingEnvironment();
await checkBuildArtifacts();
await checkBuildManifest();
await checkElectronBuilderConfig();
await checkAgentAutonomyPrerequisites();
await checkAgentConversationPrerequisites();
await checkAgentStage5Prerequisites();
if (failures.length === 0) {
  await checkFreshPackageArtifact();
}

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

async function checkBuildManifest() {
  const manifestPath = join(root, "apps", "desktop", "dist", "build-manifest.json");
  if (!(await fileExists(manifestPath))) {
    failures.push("Missing Electron build consistency manifest.");
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== "1.0" || typeof manifest.sourceRevision !== "string") {
    failures.push("Electron build consistency manifest is invalid.");
    return;
  }

  for (const name of ["main", "preload", "renderer"]) {
    const artifact = manifest.artifacts?.[name];
    if (
      artifact === undefined ||
      typeof artifact.path !== "string" ||
      typeof artifact.sha256 !== "string" ||
      artifact.sourceRevision !== manifest.sourceRevision
    ) {
      failures.push(`Electron build manifest entry is invalid: ${name}`);
      continue;
    }
    const artifactPath = join(root, artifact.path);
    if (!(await fileExists(artifactPath))) {
      failures.push(`Electron build manifest artifact is missing: ${artifact.path}`);
      continue;
    }
    const digest = createHash("sha256")
      .update(await readFile(artifactPath))
      .digest("hex");
    if (digest !== artifact.sha256) {
      failures.push(`Electron build artifact hash mismatch: ${artifact.path}`);
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
  const compiledTestExclusion = "!packages/*/dist/test{,/**}";
  if (!Array.isArray(config.files) || !config.files.includes(compiledTestExclusion)) {
    failures.push("Package files must exclude tests and fixtures.");
  }
  if (!Array.isArray(config.files) || !config.files.includes("packages/schemas/schema/**")) {
    failures.push("Electron package files must include JSON Schema runtime contracts.");
  }
  const allowedPackageFiles = new Set([
    "apps/desktop/dist/**",
    "packages/*/dist/**",
    compiledTestExclusion,
    "packages/schemas/schema/**",
    "package.json",
    "package-lock.json"
  ]);
  if (
    Array.isArray(config.files) &&
    config.files.some((pattern) => typeof pattern !== "string" || !allowedPackageFiles.has(pattern))
  ) {
    failures.push("Package files must exclude tests and fixtures.");
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

async function checkAgentAutonomyPrerequisites() {
  const requiredSafetySuites = [
    "packages/agent-engine/test/full-autonomy-policy.test.ts",
    "packages/repository/test/agent-write-transaction.test.ts",
    "packages/repository/test/history-versions.test.ts",
    "packages/application/test/run-undo-conflict.test.ts",
    "packages/application/test/chapter-autosave-recovery.test.ts",
    "apps/desktop/test/agent-write.e2e.ts",
    "apps/desktop/test/agent-run-autonomy.e2e.ts"
  ];
  const existingSafetySuites = new Set();

  for (const suite of requiredSafetySuites) {
    if (!(await fileExists(join(root, suite)))) {
      failures.push(`Agent autonomy prerequisite suite is missing: ${suite}`);
    } else {
      existingSafetySuites.add(suite);
    }
  }

  const manualPolicy = "write_before_confirmation";
  const policySuitePath = join(root, requiredSafetySuites[0]);
  if (await fileExists(policySuitePath)) {
    const policySuite = await readFile(policySuitePath, "utf8");
    if (
      !policySuite.includes("keeps manual confirmation as the default execution policy") ||
      !policySuite.includes(`writePolicy: "${manualPolicy}"`)
    ) {
      failures.push("Manual confirmation must remain the default Agent write policy.");
    }
  }

  const runnableSafetySuites = requiredSafetySuites.slice(0, 5);
  if (runnableSafetySuites.every((suite) => existingSafetySuites.has(suite))) {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--passWithNoTests",
        ...runnableSafetySuites
      ],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      failures.push(
        `Agent autonomy prerequisite suites failed.${detail.length === 0 ? "" : `\n${detail}`}`
      );
    }
  }
}

async function checkAgentConversationPrerequisites() {
  const requiredStage4Suites = [
    "packages/repository/test/agent-conversation-repository.test.ts",
    "packages/application/test/agent-conversation-session.test.ts",
    "apps/desktop/test/agent-conversation-bridge.test.ts",
    "apps/desktop/test/agent-runtime-manager.test.ts",
    "apps/desktop/test/agent-run-ipc.test.ts",
    "apps/desktop/test/desktop-agent-run-runtime.test.ts",
    "packages/ui/test/agent-conversation-navigator.test.tsx",
    "packages/ui/test/agent-conversation-view.test.tsx",
    "packages/ui/test/agent-conversation-workspace.test.tsx",
    "apps/desktop/test/agent-conversations.e2e.ts",
    "packages/application/test/agent-run-session.test.ts",
    "packages/application/test/agent-run-stage2-integration.test.ts",
    "packages/agent-engine/test/agent-run-coordinator.test.ts",
    "apps/desktop/test/agent-write.e2e.ts",
    "apps/desktop/test/agent-run-autonomy.e2e.ts"
  ];
  const existingStage4Suites = new Set();

  for (const suite of requiredStage4Suites) {
    if (!(await fileExists(join(root, suite)))) {
      failures.push(`Agent conversation prerequisite suite is missing: ${suite}`);
    } else {
      existingStage4Suites.add(suite);
    }
  }

  const runnableStage4Suites = requiredStage4Suites.filter(
    (suite) => suite.endsWith(".test.ts") || suite.endsWith(".test.tsx")
  );
  if (runnableStage4Suites.every((suite) => existingStage4Suites.has(suite))) {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--passWithNoTests",
        ...runnableStage4Suites
      ],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      failures.push(
        `Agent conversation prerequisite suites failed.${detail.length === 0 ? "" : `\n${detail}`}`
      );
    }
  }
}

async function checkAgentStage5Prerequisites() {
  const requiredStage5Suites = [
    "packages/ui/test/agent-composer.test.tsx",
    "packages/ui/test/agent-conversation-view.test.tsx",
    "packages/ui/test/agent-run-panel.test.tsx",
    "packages/ui/test/agent-popover.test.tsx",
    "packages/ui/test/workspace-shell.test.tsx",
    "packages/ui/test/agent-conversation-workspace.test.tsx",
    "apps/desktop/test/agent-run-bridge.test.ts",
    "apps/desktop/test/agent-conversation-bridge.test.ts",
    "packages/agent-engine/test/context-snapshot.test.ts",
    "packages/agent-engine/test/stage5-event-contract.test.ts",
    "packages/repository/test/agent-run-repository.test.ts",
    "packages/application/test/agent-run-session.test.ts",
    "packages/agent-engine/test/agent-run-draft.test.ts",
    "packages/agent-engine/test/context-draft.test.ts",
    "packages/agent-engine/test/context-budget.test.ts",
    "packages/agent-engine/test/context-compaction.test.ts",
    "packages/application/test/agent-run-draft-session.test.ts",
    "packages/application/test/agent-model-capabilities.test.ts",
    "packages/application/test/agent-context-session.test.ts",
    "packages/application/test/agent-context-session-compaction.test.ts",
    "packages/application/test/agent-run-model-driver.test.ts",
    "packages/repository/test/agent-conversation-repository.test.ts",
    "apps/desktop/test/agent-compaction-composer.test.ts",
    "packages/agent-engine/test/permission-summary.test.ts",
    "packages/application/test/agent-permission-session.test.ts",
    "packages/agent-engine/test/plan-execution.test.ts",
    "packages/application/test/agent-plan-execution-session.test.ts",
    "packages/agent-engine/test/approval-gate.test.ts",
    "packages/agent-engine/test/tool-registry.test.ts",
    "packages/agent-engine/test/plan-artifact.test.ts",
    "packages/agent-engine/test/agent-run-error.test.ts",
    "packages/application/test/agent-diagnostics-session.test.ts",
    "packages/agent-engine/test/agent-usage-record.test.ts",
    "packages/application/test/agent-pricing-registry.test.ts",
    "packages/application/test/agent-usage-session.test.ts",
    "packages/repository/test/agent-usage-repository.test.ts",
    "packages/llm-adapter/test",
    "apps/desktop/test/settings-bridge.test.ts",
    "packages/ui/test/settings-and-studio.test.tsx",
    "packages/repository/test/agent-write-transaction.test.ts",
    "packages/repository/test/history-versions.test.ts",
    "packages/application/test/run-undo-conflict.test.ts",
    "packages/application/test/chapter-autosave-recovery.test.ts",
    "apps/desktop/test/agent-conversations.e2e.ts",
    "apps/desktop/test/agent-run.e2e.ts",
    "apps/desktop/test/agent-write.e2e.ts",
    "apps/desktop/test/agent-run-autonomy.e2e.ts",
    "apps/desktop/test/agent-context-runtime.e2e.ts",
    "apps/desktop/test/agent-permission-plan.e2e.ts",
    "apps/desktop/test/agent-diagnostics.e2e.ts",
    "apps/desktop/test/agent-usage-settings.e2e.ts"
  ];
  const existingStage5Suites = new Set();

  for (const suite of requiredStage5Suites) {
    if (!(await fileExists(join(root, suite)))) {
      failures.push(`Agent Stage 5 prerequisite suite is missing: ${suite}`);
    } else {
      existingStage5Suites.add(suite);
    }
  }

  const runnableStage5Suites = requiredStage5Suites.filter(
    (suite) =>
      suite === "packages/llm-adapter/test" ||
      suite.endsWith(".test.ts") ||
      suite.endsWith(".test.tsx")
  );
  if (runnableStage5Suites.every((suite) => existingStage5Suites.has(suite))) {
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--passWithNoTests",
        "--no-file-parallelism",
        ...runnableStage5Suites
      ],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
      failures.push(
        `Agent Stage 5 prerequisite suites failed.${detail.length === 0 ? "" : `\n${detail}`}`
      );
    }
  }
}

async function checkFreshPackageArtifact() {
  const result = spawnSync("npm", ["run", "package:dir"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: true
  });
  if (result.status !== 0) {
    const processError =
      result.error === undefined
        ? ""
        : result.error instanceof Error
          ? result.error.message
          : String(result.error);
    const detail = `${processError}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    failures.push(
      `Fresh package artifact creation and scan failed.${detail.length === 0 ? "" : `\n${detail}`}`
    );
    return;
  }
  if (result.stdout !== null) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr !== null) {
    process.stderr.write(result.stderr);
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
