import { describe, expect, test } from "vitest";

import {
  checksumChangeSetText,
  createChangeSetRevisionBatchV2,
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  type ChangeSet,
  type MainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createStoryBibleApprovalProofSession,
  type FinalizeStoryBibleApprovalProofInput
} from "../src/story-bible-approval-proof-session.js";
import type { StoryBibleProposalApprovalProof } from "../src/story-bible-agent-tool-session.js";
import type { StoryBibleReferenceDependencyBindingV1 } from "../src/story-bible-reference-dependency-guard.js";

describe("Story Bible approval proof finalization", () => {
  test("persists one deterministic Main-only proof and exposes only its sanitized summary", async () => {
    const changeSet = await storyBibleChangeSet();
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const session = createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      createProofId: () => "proof_story_bible_clean"
    });

    const result = await session.finalize(finalizationInput(changeSet, [proposal("create")]));

    expect(result).toMatchObject({
      ok: true,
      value: {
        proofRef: { proofId: "proof_story_bible_clean" },
        providerSummary: {
          operation: "story_bible_create",
          approvalRequirement: "auto_review_eligible",
          reasonCodes: []
        }
      }
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      operation: "story_bible_create",
      effectRuleId: "bounded_story_bible_create_v1",
      binding: {
        runId: changeSet.runId,
        changeSetId: changeSet.changeSetId,
        changeSetRevision: changeSet.revision,
        changeSetChecksum: changeSet.checksum,
        executionWritePolicy: "user_preapproved_run"
      },
      evidence: {
        createOnly: "proven",
        referenceImpact: "none",
        limits: "within",
        stateBoundary: "ordinary"
      }
    });
    if (!result.ok) return;
    expect(JSON.stringify(result.value.providerSummary)).not.toContain("proof_story_bible_clean");
    expect(JSON.stringify(result.value.providerSummary)).not.toContain("workspace_private");
  });

  test.each([
    ["reference impact", proposal("patch", { referenceImpact: "present" })],
    ["unknown impact", proposal("patch", { referenceImpact: "unknown" })],
    ["limit exceeded", proposal("patch", { limits: "exceeded" })],
    ["state boundary", proposal("status", { stateBoundary: "delete" })]
  ])("forces human confirmation for %s", async (_label, candidate) => {
    const changeSet = await storyBibleChangeSet({ writePolicy: "user_preapproved_run" });
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const result = await createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      createProofId: () => "proof_story_bible_human"
    }).finalize(finalizationInput(changeSet, [candidate]));

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerSummary: { approvalRequirement: "human_confirmation" }
      }
    });
    expect(stored).toHaveLength(1);
  });

  test("treats an explicit inverse pair as reference-impacting and never auto-reviewable", async () => {
    const changeSet = await storyBibleChangeSet({ grouped: true });
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const result = await createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      createProofId: () => "proof_story_bible_inverse"
    }).finalize({
      ...finalizationInput(changeSet, [proposal("patch"), proposal("patch")]),
      consistencyGroupId: "inverse_group",
      groupKind: "explicit_inverse"
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerSummary: {
          operation: "story_bible_patch",
          approvalRequirement: "human_confirmation",
          reasonCodes: expect.arrayContaining(["reference_impact"])
        }
      }
    });
    expect(stored[0]?.evidence.referenceImpact).toBe("present");
  });

  test("keeps reference dependency IDs in a Main-only sidecar and binds their checksum into the proof", async () => {
    const changeSet = await storyBibleChangeSet();
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const sidecars: StoryBibleReferenceDependencyBindingV1[] = [];
    const result = await createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      referenceDependencyRepository: {
        async writeStoryBibleReferenceDependencyBinding(binding) {
          sidecars.push(binding);
          return ok(binding);
        }
      },
      createProofId: () => "proof_story_bible_dependency"
    }).finalize({
      ...finalizationInput(changeSet, [proposal("patch")]),
      referenceDependencies: [
        {
          resourceKind: "story_bible",
          resourceId: "chr_private_dependency",
          revision: 4,
          checksum: "f".repeat(64)
        }
      ]
    });

    expect(result).toMatchObject({ ok: true });
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0]).toMatchObject({
      proofId: "proof_story_bible_dependency",
      runId: changeSet.runId,
      changeSetId: changeSet.changeSetId,
      changeSetRevision: changeSet.revision
    });
    expect(stored[0]?.binding.referenceImpactChecksum).not.toBe("c".repeat(64));
    expect(JSON.stringify(result)).not.toContain("chr_private_dependency");
  });

  test("fails closed when the durable dependency sidecar is configured but snapshots are omitted", async () => {
    const changeSet = await storyBibleChangeSet();
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const sidecars: StoryBibleReferenceDependencyBindingV1[] = [];
    const result = await createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      referenceDependencyRepository: {
        async writeStoryBibleReferenceDependencyBinding(binding) {
          sidecars.push(binding);
          return ok(binding);
        }
      },
      createProofId: () => "proof_story_bible_missing_dependency"
    }).finalize(finalizationInput(changeSet, [proposal("patch")]));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_REQUIRED" }
    });
    expect(stored).toEqual([]);
    expect(sidecars).toEqual([]);
  });

  test("fails closed when the Change Set revision/checksum or selected group no longer matches", async () => {
    const changeSet = await storyBibleChangeSet({ grouped: true });
    const stored: MainOnlyApprovalDecisionProofV1[] = [];
    const session = createStoryBibleApprovalProofSession({
      changeSets: changeSetPort(changeSet, stored),
      createProofId: () => "proof_unused"
    });

    await expect(
      session.finalize({
        ...finalizationInput(changeSet, [proposal("patch")]),
        checksum: "0".repeat(64),
        consistencyGroupId: "inverse_group"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_APPROVAL_PROOF_CHANGE_SET_STALE" }
    });
    await expect(
      session.finalize({
        ...finalizationInput(changeSet, [proposal("patch")]),
        consistencyGroupId: "other_group"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_APPROVAL_PROOF_SELECTION_MISMATCH" }
    });
    expect(stored).toEqual([]);
  });
});

async function storyBibleChangeSet(
  options: {
    readonly grouped?: boolean;
    readonly writePolicy?: "write_before_confirmation" | "user_preapproved_run";
  } = {}
): Promise<ChangeSet> {
  const group = options.grouped ? { consistencyGroupId: "inverse_group" } : {};
  return createChangeSetRevisionBatchV2({
    changeSetId: "change_set_story_bible",
    runId: "run_story_bible",
    projectId: "project_story_bible",
    checkpointId: "checkpoint_story_bible",
    contextSnapshotId: "context_story_bible",
    writePolicy: options.writePolicy ?? "user_preapproved_run",
    providerSemanticVersionSetChecksum: "a".repeat(64),
    createdAt: "2026-08-06T00:00:00.000Z",
    proposals: [
      {
        relativePath: "story/characters/chr_source.json",
        assetType: "text",
        assetId: "chr_source",
        baseContent: '{"revision":1}',
        baseChecksum: checksumChangeSetText('{"revision":1}'),
        range: { unit: "character", start: 0, end: 14 },
        replacement: '{"revision":2}',
        ...group
      },
      ...(options.grouped
        ? [
            {
              relativePath: "story/characters/chr_target.json",
              assetType: "text" as const,
              assetId: "chr_target",
              baseContent: '{"revision":1}',
              baseChecksum: checksumChangeSetText('{"revision":1}'),
              range: { unit: "character" as const, start: 0, end: 14 },
              replacement: '{"revision":2}',
              consistencyGroupId: "inverse_group"
            }
          ]
        : [])
    ]
  });
}

function finalizationInput(
  changeSet: ChangeSet,
  proposals: readonly StoryBibleProposalApprovalProof[]
): FinalizeStoryBibleApprovalProofInput {
  return {
    runId: changeSet.runId,
    changeSetId: changeSet.changeSetId,
    revision: changeSet.revision,
    checksum: changeSet.checksum,
    proposals,
    approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
    providerSemanticVersionSetChecksum: "a".repeat(64),
    workspaceBindingId: "workspace_private",
    rootBindingId: "root_private",
    policyRevision: "policy_01",
    capabilityRevision: "catalog_01",
    pathClass: "ordinary",
    targetFreshness: "clean_stable"
  };
}

function proposal(
  action: "create" | "patch" | "status",
  override: Partial<StoryBibleProposalApprovalProof["evidence"]> = {}
): StoryBibleProposalApprovalProof {
  const operation =
    action === "create"
      ? "story_bible_create"
      : action === "patch"
        ? "story_bible_patch"
        : "story_bible_status";
  const evidence = {
    createOnly: action === "create" ? ("proven" as const) : ("not_applicable" as const),
    referenceImpact: "none" as const,
    limits: "within" as const,
    stateBoundary: "ordinary" as const,
    ...override
  };
  return {
    schemaVersion: "1.0",
    policyId: "bounded-story-bible-proposal@1.0",
    operation,
    ...(action === "create"
      ? { effectRuleId: "bounded_story_bible_create_v1" as const }
      : action === "patch"
        ? { effectRuleId: "no_reference_impact_story_bible_patch_v1" as const }
        : {}),
    measurements: { fieldCount: 2, relationCount: 0, totalBytes: 128 },
    thresholds: { maxFieldCount: 128, maxRelationCount: 16, maxTotalBytes: 65_536 },
    evidence,
    reviewRequirement: "conditional_candidate",
    referenceImpactChecksum: "c".repeat(64)
  };
}

function changeSetPort(
  changeSet: ChangeSet,
  stored: MainOnlyApprovalDecisionProofV1[]
): {
  readChangeSet(changeSetId: string, revision?: number): Promise<Result<ChangeSet, UnifiedError>>;
  persistApprovalDecisionProof(input: {
    readonly changeSetId: string;
    readonly revision: number;
    readonly proof: MainOnlyApprovalDecisionProofV1;
  }): Promise<Result<{ readonly proofId: string; readonly proofChecksum: string }, UnifiedError>>;
} {
  return {
    async readChangeSet(changeSetId, revision) {
      return changeSetId === changeSet.changeSetId && revision === changeSet.revision
        ? ok(changeSet)
        : err(testError("CHANGE_SET_MISSING"));
    },
    async persistApprovalDecisionProof(input) {
      stored.push(input.proof);
      return ok({ proofId: input.proof.proofId, proofChecksum: "e".repeat(64) });
    }
  };
}

function testError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry.",
    traceId: "story-bible-approval-proof-test"
  });
}
