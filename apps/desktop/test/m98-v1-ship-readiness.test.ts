import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
});
