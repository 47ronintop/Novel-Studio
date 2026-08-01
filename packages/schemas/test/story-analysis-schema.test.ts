import { describe, expect, test } from "vitest";
import {
  validateStoryAnalysisBundle,
  type StoryAnalysisBundle,
  type StoryFactDelta,
  type StoryReviewIssue
} from "../src/index.js";

const RUN_ID = `run_${"a".repeat(32)}`;
const OTHER_RUN_ID = `run_${"0".repeat(32)}`;
const OBSERVATION_ID = `obs_${"b".repeat(32)}`;
const DELTA_ID = `dlt_${"c".repeat(32)}`;
const SUGGESTION_ID = `sug_${"d".repeat(32)}`;
const CONSISTENCY_GROUP_ID = `cgrp_${"e".repeat(32)}`;
const ISSUE_ID = `issue_${"f".repeat(32)}`;
const CHARACTER_ID = `chr_${"1".repeat(32)}`;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

describe("Story Analysis schema", () => {
  test("accepts a complete analysis bundle", () => {
    expect(validateStoryAnalysisBundle(storyAnalysisBundle())).toEqual({
      valid: true,
      issues: []
    });
  });

  test("rejects evidence ranges whose end does not follow start", () => {
    const bundle = storyAnalysisBundle();
    const observation = requireAt(bundle.observations, 0, "Expected an observation fixture.");
    const result = validateStoryAnalysisBundle({
      ...bundle,
      observations: [
        {
          ...observation,
          evidence: [
            {
              ...requireAt(observation.evidence, 0, "Expected an evidence fixture."),
              start: 12,
              end: 12
            }
          ]
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        instancePath: "/observations/0/evidence/0/end",
        keyword: "evidenceRange"
      })
    );
  });

  test("rejects records bound to another run or chapter revision", () => {
    const bundle = storyAnalysisBundle();
    const observation = requireAt(bundle.observations, 0, "Expected an observation fixture.");
    const result = validateStoryAnalysisBundle({
      ...bundle,
      observations: [
        {
          ...observation,
          analysisRunId: OTHER_RUN_ID,
          chapter: { chapterId: "ch_02", checksum: HASH_B }
        }
      ]
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "analysisRunBinding" }),
        expect.objectContaining({ keyword: "chapterBinding" })
      ])
    );
  });

  test("enforces mutually exclusive create and patch payloads", () => {
    const bundle = storyAnalysisBundle();
    const patchDelta = requireAt(bundle.factDeltas, 0, "Expected a patch delta fixture.");
    const invalidCreate = { ...patchDelta, action: "create" };
    const validCreate = createDelta();
    const invalidPatch = { ...validCreate, action: "patch" };

    expect(validateStoryAnalysisBundle({ ...bundle, factDeltas: [invalidCreate] }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "createContract" })])
    );
    expect(validateStoryAnalysisBundle({ ...bundle, factDeltas: [invalidPatch] }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "patchContract" })])
    );
    expect(validateStoryAnalysisBundle({ ...bundle, factDeltas: [validCreate] })).toEqual({
      valid: true,
      issues: []
    });
  });

  test("enforces review issue lifecycle fields", () => {
    const bundle = storyAnalysisBundle();
    const issue = reviewIssue();
    const unresolved = validateStoryAnalysisBundle({
      ...bundle,
      records: [{ ...issue, status: "resolved", resolution: null }]
    });
    const unexplainedDismissal = validateStoryAnalysisBundle({
      ...bundle,
      records: [{ ...issue, status: "dismissed", dismissalReason: null }]
    });

    expect(unresolved.issues).toContainEqual(
      expect.objectContaining({ instancePath: "/records/0/resolution", keyword: "issueLifecycle" })
    );
    expect(unexplainedDismissal.issues).toContainEqual(
      expect.objectContaining({
        instancePath: "/records/0/dismissalReason",
        keyword: "issueLifecycle"
      })
    );
  });

  test("rejects model-controlled action, status, and delete fields on observations", () => {
    const bundle = storyAnalysisBundle();
    const observation = requireAt(bundle.observations, 0, "Expected an observation fixture.");
    const result = validateStoryAnalysisBundle({
      ...bundle,
      observations: [{ ...observation, action: "delete", status: "applied", delete: true }]
    });

    expect(result.valid).toBe(false);
    expect(result.issues.filter((entry) => entry.keyword === "additionalProperties")).toHaveLength(3);
  });

  test("rejects resolved entities outside the deterministic candidate set", () => {
    const bundle = storyAnalysisBundle();
    const observation = requireAt(bundle.observations, 0, "Expected an observation fixture.");
    const result = validateStoryAnalysisBundle({
      ...bundle,
      observations: [
        {
          ...observation,
          subject: { ...observation.subject, candidateAssetIds: [] }
        }
      ]
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({ keyword: "entityResolution" })
    );
  });

  test("requires run counters to match persisted observations", () => {
    const bundle = storyAnalysisBundle();
    const result = validateStoryAnalysisBundle({
      ...bundle,
      analysisRun: {
        ...bundle.analysisRun,
        validation: {
          ...bundle.analysisRun.validation,
          observationCount: 2,
          acceptedCount: 2
        }
      }
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "observationCount" })])
    );
  });
});

function requireAt<T>(values: readonly T[], index: number, message: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(message);
  return value;
}

export function storyAnalysisBundle(): StoryAnalysisBundle {
  const chapter = { chapterId: "ch_01", checksum: HASH_A } as const;
  const evidence = [{ start: 4, end: 12, excerptHash: HASH_B }] as const;
  const delta = patchDelta();
  return {
    schemaVersion: "1.1",
    analysisRun: {
      schemaVersion: "1.1",
      analysisRunId: RUN_ID,
      trigger: "manual",
      createdAt: "2026-07-31T00:00:00.000Z",
      startedAt: "2026-07-31T00:00:01.000Z",
      completedAt: "2026-07-31T00:00:02.000Z",
      chapter,
      contextSnapshot: {
        contextSnapshotId: `ctx_${"2".repeat(32)}`,
        checksum: HASH_C
      },
      recalledAssets: [
        {
          assetId: CHARACTER_ID,
          revision: 3,
          checksum: HASH_B,
          reason: "alias-match",
          truncated: false
        }
      ],
      runtime: {
        providerId: "configured-provider",
        modelId: "configured-model",
        promptVersion: "story-observer-v1",
        promptChecksum: HASH_A,
        extractorVersion: "story-fact-router-v1"
      },
      validation: {
        observationCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        errors: []
      },
      usage: {
        usageRecordId: `usage_${"3".repeat(32)}`,
        inputTokens: 120,
        outputTokens: 24,
        estimatedCost: null
      },
      status: "completed",
      failure: null
    },
    observations: [
      {
        schemaVersion: "1.1",
        observationId: OBSERVATION_ID,
        analysisRunId: RUN_ID,
        chapter,
        domain: "character.location",
        subject: {
          mention: "林默",
          expectedType: "character",
          candidateAssetIds: [CHARACTER_ID],
          resolvedAssetId: CHARACTER_ID
        },
        fact: {
          kind: "character_location",
          value: { locationId: `loc_${"4".repeat(32)}` }
        },
        evidence,
        epistemicStatus: "narrator_asserted",
        confidence: 0.96,
        reason: "Narration places the character at the station."
      }
    ],
    factDeltas: [delta],
    records: [
      {
        ...delta,
        suggestionId: SUGGESTION_ID,
        recordType: "change",
        status: "pending",
        revision: 1,
        createdAt: "2026-07-31T00:00:03.000Z",
        updatedAt: "2026-07-31T00:00:03.000Z"
      }
    ]
  };
}

function patchDelta(): StoryFactDelta {
  return {
    schemaVersion: "1.1",
    deltaId: DELTA_ID,
    analysisRunId: RUN_ID,
    observationIds: [OBSERVATION_ID],
    chapter: { chapterId: "ch_01", checksum: HASH_A },
    domain: "character.location",
    action: "patch",
    target: {
      assetId: CHARACTER_ID,
      baseRevision: 3,
      entryRef: null
    },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    dependencies: [
      {
        kind: "asset_fields",
        assetId: CHARACTER_ID,
        baseRevision: 3,
        selectors: ["/details/currentState/locationId"],
        valueChecksum: HASH_C
      },
      { kind: "chapter", chapterId: "ch_01", checksum: HASH_A }
    ],
    consistencyGroupId: CONSISTENCY_GROUP_ID,
    operations: [
      {
        op: "replace",
        path: "/details/currentState/locationId",
        beforeValueChecksum: HASH_C,
        value: `loc_${"4".repeat(32)}`
      }
    ],
    evidence: [{ start: 4, end: 12, excerptHash: HASH_B }],
    epistemicStatus: "narrator_asserted",
    confidence: 0.96,
    reason: "Update the character's objective location.",
    idempotencyKey: HASH_A
  };
}

function createDelta(): StoryFactDelta {
  return {
    ...patchDelta(),
    action: "create",
    target: null,
    proposedAssetType: "character",
    proposedAssetId: `chr_${"5".repeat(32)}`,
    createValue: {
      title: "顾岚",
      status: "active",
      summary: "",
      aliases: [],
      relations: [],
      details: {},
      extensions: {}
    },
    operations: []
  };
}

function reviewIssue(): StoryReviewIssue {
  return {
    schemaVersion: "1.1",
    issueId: ISSUE_ID,
    recordType: "review_issue",
    revision: 1,
    createdAt: "2026-07-31T00:00:03.000Z",
    updatedAt: "2026-07-31T00:00:03.000Z",
    analysisRunId: RUN_ID,
    chapter: { chapterId: "ch_01", checksum: HASH_A },
    issueType: "conflict",
    status: "open",
    claims: [
      {
        value: { locationId: `loc_${"4".repeat(32)}` },
        evidence: [{ start: 4, end: 12, excerptHash: HASH_B }]
      }
    ],
    affectedRefs: [`story_bible:${CHARACTER_ID}`],
    dependencies: [],
    idempotencyKey: HASH_C,
    resolution: null,
    dismissalReason: null,
    supersededByIssueId: null
  };
}
