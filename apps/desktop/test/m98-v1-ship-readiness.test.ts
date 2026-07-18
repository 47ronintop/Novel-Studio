import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { createPackageWithOptions } from "@electron/asar";
import { describe, expect, test } from "vitest";

describe("M98 V1 ship readiness", () => {
  test("records the v1 ship decision, evidence, limits, and reading aloud scope", async () => {
    const document = await readFile("docs/releases/m98-v1-ship-readiness.md", "utf8");

    expect(document).toContain("V1 ship decision: CONDITIONAL HOLD");
    expect(document).toContain("Core writing journey evidence");
    expect(document).toContain("npm run test:e2e");
    expect(document).toContain("npm run release:check");
    expect(document).toContain("live provider manual verification pending");
    expect(document).toContain("V2/backlog deferred scope");
    expect(document).toContain("Reading aloud decision: GO for v1.1 backlog, NO for v1 blocker.");
    expect(document).toContain("No M99/M100 is authorized unless M98 finds a v1 blocker.");
    expect(document).toContain("Edge TTS behind an explicit experimental provider switch.");
    expect(document).toContain("Manual Provider Verification Required");
  });

  test("release check validates M98 readiness without publishing", () => {
    const result = spawnSync("npm run release:check", {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("V1 conditional ship readiness gate recorded");
    expect(result.stdout).not.toMatch(/push|upload|publish/i);
  });

  test("package check gates autonomy on the Stage 2 safety evidence and manual default", async () => {
    const packageCheck = await readFile("scripts/package-check.mjs", "utf8");
    const requiredSuites = [
      "packages/agent-engine/test/full-autonomy-policy.test.ts",
      "packages/repository/test/agent-write-transaction.test.ts",
      "packages/repository/test/history-versions.test.ts",
      "packages/application/test/run-undo-conflict.test.ts",
      "packages/application/test/chapter-autosave-recovery.test.ts",
      "apps/desktop/test/agent-write.e2e.ts",
      "apps/desktop/test/agent-run-autonomy.e2e.ts"
    ];

    expect(packageCheck).toContain("checkAgentAutonomyPrerequisites");
    for (const suite of requiredSuites) expect(packageCheck).toContain(suite);
    expect(packageCheck).toContain('"write_before_confirmation"');
    expect(packageCheck).toContain(
      "Manual confirmation must remain the default Agent write policy."
    );
    expect(packageCheck).toContain("Agent autonomy prerequisite suites failed.");
    expect(packageCheck).toContain("spawnSync");
  });

  test("package check gates Stage 4 conversation isolation and acceptance evidence", async () => {
    const packageCheck = await readFile("scripts/package-check.mjs", "utf8");
    const requiredSuites = [
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

    expect(packageCheck).toContain("checkAgentConversationPrerequisites");
    for (const suite of requiredSuites) expect(packageCheck).toContain(suite);
    expect(packageCheck).toContain("Agent conversation prerequisite suites failed.");
  });

  test("package check gates the complete Stage 5 acceptance evidence", async () => {
    const packageCheck = await readFile("scripts/package-check.mjs", "utf8");
    const requiredSuites = [
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

    expect(packageCheck).toContain("checkAgentStage5Prerequisites");
    for (const suite of requiredSuites) expect(packageCheck).toContain(suite);
    expect(packageCheck).toContain("Agent Stage 5 prerequisite suites failed.");
    expect(packageCheck).toContain('"--no-file-parallelism"');
    expect(packageCheck).toContain("spawnSync");
    expect(packageCheck).toContain("checkFreshPackageArtifact");
    expect(packageCheck).toContain('["run", "package:dir"]');
    expect(packageCheck).toContain("Fresh package artifact creation and scan failed.");
    expect(packageCheck).toContain("maxBuffer");
    expect(packageCheck).toContain("result.error");
  });

  test("package check excludes compiled Stage 5 tests from Electron package inputs", async () => {
    const packageCheck = await readFile("scripts/package-check.mjs", "utf8");
    const builderConfig = await readFile("apps/desktop/electron-builder.config.cjs", "utf8");
    const runtimeGlob = "packages/*/dist/**";
    const compiledTestExclusion = "!packages/*/dist/test{,/**}";

    expect(builderConfig).toContain(runtimeGlob);
    expect(builderConfig).toContain(compiledTestExclusion);
    expect(packageCheck).toContain(runtimeGlob);
    expect(packageCheck).toContain(compiledTestExclusion);
    expect(packageCheck).toContain("Package files must exclude tests and fixtures.");
  });

  test("artifact scan rejects compiled Stage 5 fixture content and test paths", async () => {
    const artifactScan = await readFile("scripts/artifact-secret-scan.mjs", "utf8");
    const sensitiveFixtureCanaries = [
      "sk-nested-secret",
      "private chapter text",
      "chapter contents",
      "Bearer must-not-cross-boundary"
    ];

    expect(artifactScan).toContain("assertNoCompiledTestOutput");
    expect(artifactScan).toContain("Compiled test output must not be packaged");
    expect(artifactScan).toContain("Unable to scan artifact directory");
    expect(artifactScan).toContain("Unable to extract app.asar file");
    expect(artifactScan).toContain("Artifact package must contain app.asar");
    expect(artifactScan).toContain("Unsupported artifact entry");
    for (const canary of sensitiveFixtureCanaries) expect(artifactScan).toContain(canary);
  });

  test("artifact scan fails closed when an artifact directory has no app.asar", async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), ".tmp-novel-studio-empty-artifact-"));

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/artifact-secret-scan.mjs", relative(process.cwd(), tempRoot)],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Artifact package must contain app.asar");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("artifact scan fails closed when the artifact path cannot be traversed", async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), ".tmp-novel-studio-artifact-scan-"));
    const artifactFile = join(tempRoot, "artifact-file");
    await writeFile(artifactFile, "not a directory", "utf8");

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/artifact-secret-scan.mjs", relative(process.cwd(), artifactFile)],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unable to scan artifact directory");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("artifact scan fails closed when a listed asar entry cannot be extracted", async () => {
    const tempRoot = await mkdtemp(join(process.cwd(), ".tmp-novel-studio-asar-scan-"));
    const sourceRoot = join(tempRoot, "source");
    const artifactRoot = join(tempRoot, "win-unpacked");
    const asarPath = join(artifactRoot, "resources", "app.asar");
    const schemaRoot = join(sourceRoot, "packages", "schemas", "schema");
    await mkdir(schemaRoot, { recursive: true });
    await mkdir(join(artifactRoot, "resources"), { recursive: true });
    for (const schema of [
      "project.schema.json",
      "settings.schema.json",
      "chapter-frontmatter.schema.json",
      "plugin-registry.schema.json"
    ]) {
      await writeFile(join(schemaRoot, schema), "{}", "utf8");
    }
    await writeFile(join(sourceRoot, "broken.ts"), "fixture", "utf8");
    await createPackageWithOptions(sourceRoot, asarPath, { unpack: "broken.ts" });
    await rm(`${asarPath}.unpacked`, { recursive: true, force: true });

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/artifact-secret-scan.mjs", relative(process.cwd(), artifactRoot)],
        { cwd: process.cwd(), encoding: "utf8" }
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unable to extract app.asar file");
      expect(result.stderr).toContain("broken.ts");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
