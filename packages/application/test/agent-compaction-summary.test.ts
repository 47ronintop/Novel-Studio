import { createHash } from "node:crypto";

import { createDeterministicTokenEstimator } from "@novel-studio/agent-engine";
import type { JsonObject } from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import {
  AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION,
  buildCompactionSummaryPrompt,
  createCompactionSummaryArtifact,
  parseCompactionSummaryArtifact,
  validateCompactionSummaryResult,
  type CompactionSummaryResult
} from "../src/agent-compaction-summary.js";

const bodies = {
  standalone: JSON.stringify({
    userGoal: "Choose a launch strategy",
    decisions: ["Start locally"],
    constraints: ["No project is attached"],
    openQuestions: ["Which audience?"],
    nextSteps: ["Clarify the audience"]
  }),
  writing: JSON.stringify({
    plotFacts: ["The bridge collapsed"],
    characterStates: ["Mara is injured"],
    foreshadowing: ["The brass key remains unexplained"],
    userDecisions: ["Keep Mara alive"]
  }),
  creative_general: JSON.stringify({
    currentFiles: ["notes/pitch.md"],
    userDecisions: ["Use the short version"],
    unfinishedItems: ["Verify the date"],
    nextSteps: ["Revise the opening"]
  }),
  engineering: JSON.stringify({
    modifiedFiles: ["src/parser.ts"],
    changeIntent: ["Reject malformed input"],
    todos: ["Add the regression fixture"],
    errorHighlights: ["Expected token at line 3"],
    nextSteps: ["Run the parser tests"]
  })
} as const;

function result(body: string): CompactionSummaryResult {
  const estimator = createDeterministicTokenEstimator();
  return {
    body,
    provenance: {
      kind: "model_assisted",
      provider: "anthropic",
      model: "claude-test",
      modelProfileId: "profile-c4",
      templateVersion: AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION,
      inputChecksum: "a".repeat(64)
    },
    tokenCount: estimator.count(body, "profile-c4").tokens,
    checksum: createHash("sha256").update(body, "utf8").digest("hex"),
    precision: "estimated"
  };
}

describe("C4 profile compaction summaries", () => {
  test.each(Object.entries(bodies))("freezes required %s fields", (profileId, body) => {
    const prompt = buildCompactionSummaryPrompt(profileId as keyof typeof bodies);
    expect(prompt.templateVersion).toBe(AGENT_COMPACTION_SUMMARY_TEMPLATE_VERSION);
    for (const key of Object.keys(JSON.parse(body) as object))
      expect(prompt.systemPrompt).toContain(key);

    const candidate = result(body);
    const validated = validateCompactionSummaryResult({
      profileId: profileId as keyof typeof bodies,
      result: candidate,
      maxSummaryTokens: candidate.tokenCount,
      estimator: createDeterministicTokenEstimator()
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.value.checksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("standalone schema cannot claim file or workspace state", () => {
    const invalid = result(
      JSON.stringify({
        userGoal: "Discuss options",
        decisions: [],
        constraints: [],
        openQuestions: [],
        nextSteps: [],
        modifiedFiles: ["invented.txt"]
      })
    );
    expect(
      validateCompactionSummaryResult({
        profileId: "standalone",
        result: invalid,
        maxSummaryTokens: 1_000,
        estimator: createDeterministicTokenEstimator()
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_SUMMARY_INVALID" } });
  });

  test("fails closed when checksum/token provenance is unverifiable or target is missed", () => {
    const candidate = result(bodies.engineering);
    expect(
      validateCompactionSummaryResult({
        profileId: "engineering",
        result: { ...candidate, precision: "unknown" },
        maxSummaryTokens: 1_000,
        estimator: createDeterministicTokenEstimator()
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_SUMMARY_INVALID" } });
    expect(
      validateCompactionSummaryResult({
        profileId: "engineering",
        result: { ...candidate, precision: "reported" },
        maxSummaryTokens: 1_000,
        estimator: createDeterministicTokenEstimator()
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_SUMMARY_INVALID" } });
    expect(
      validateCompactionSummaryResult({
        profileId: "engineering",
        result: candidate,
        maxSummaryTokens: candidate.tokenCount - 1,
        estimator: createDeterministicTokenEstimator()
      })
    ).toMatchObject({ ok: false, error: { code: "AGENT_COMPACTION_SUMMARY_TARGET_MISSED" } });
  });

  test("creates a checksum-bound immutable artifact", () => {
    const candidate = result(bodies.writing);
    const validated = validateCompactionSummaryResult({
      profileId: "writing",
      result: candidate,
      maxSummaryTokens: 1_000,
      estimator: createDeterministicTokenEstimator()
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const artifact = createCompactionSummaryArtifact({
      artifactId: "summary_compaction_01",
      runId: "run_01",
      compactionId: "compaction_01",
      contextProfileId: "writing",
      sourceSnapshotId: "context_01",
      throughSequence: 12,
      inputManifestChecksum: "b".repeat(64),
      result: validated.value,
      createdAt: "2026-07-28T00:00:00.000Z"
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(artifact).toMatchObject({
      schemaVersion: "1.0",
      body: candidate.body,
      provenance: candidate.provenance,
      tokenCount: candidate.tokenCount,
      checksum: validated.value.checksum,
      precision: "estimated"
    });
    const restored = parseCompactionSummaryArtifact(
      JSON.parse(JSON.stringify(artifact)) as JsonObject
    );
    expect(Object.isFrozen(restored)).toBe(true);
    expect(restored).toEqual(artifact);
    expect(() =>
      parseCompactionSummaryArtifact({
        ...(JSON.parse(JSON.stringify(artifact)) as JsonObject),
        body: bodies.engineering
      })
    ).toThrow("AGENT_COMPACTION_SUMMARY_ARTIFACT_INVALID");
  });
});
