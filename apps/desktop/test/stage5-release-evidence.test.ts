import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

interface Stage5Evidence {
  readonly overallStatus: string;
  readonly phases: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly releaseEligible: boolean;
    readonly productionRuntimeWired: boolean;
    readonly securityQualified: boolean;
    readonly userControlsComplete: boolean;
    readonly endToEndEvidence: boolean;
    readonly evidence: ReadonlyArray<{ readonly kind: string; readonly path: string }>;
  }>;
}

describe("Stage 5 release evidence", () => {
  test("keeps incomplete and canceled agent-tool phases out of the release-ready state", async () => {
    const manifest = JSON.parse(
      await readFile("docs/releases/stage5-agent-tool-evidence.json", "utf8")
    ) as Stage5Evidence;

    expect(manifest.overallStatus).toBe("Blocked");
    expect(manifest.phases.find((phase) => phase.id === "phase-c0")?.status).toBe("Unavailable");

    for (const phase of manifest.phases) {
      if (phase.status !== "Complete") {
        expect(phase.releaseEligible).toBe(false);
        continue;
      }

      expect(phase.productionRuntimeWired).toBe(true);
      expect(phase.securityQualified).toBe(true);
      expect(phase.userControlsComplete).toBe(true);
      expect(phase.endToEndEvidence).toBe(true);
      expect(phase.evidence.map((item) => item.kind)).toEqual(
        expect.arrayContaining(["production-e2e", "security-qualification"])
      );
    }
  });

  test("uses the same evidence manifest from the release gate", async () => {
    const releaseCheck = await readFile("scripts/release-check.mjs", "utf8");

    expect(releaseCheck).toContain("checkStage5Evidence");
    expect(releaseCheck).toContain("docs/releases/stage5-agent-tool-evidence.json");
    expect(releaseCheck).toContain("cannot be Complete without production and security evidence");
    expect(releaseCheck).toContain('if (kind === "decision")');
    expect(releaseCheck).toContain("Strict release gate cannot pass while Stage 5 overall status");
    expect(releaseCheck).toContain("overall Blocked or Complete status");
    expect(releaseCheck).toContain("isSafeEvidencePath");
    expect(releaseCheck).toContain("hasEvidenceKindSemantics");
  });
});
