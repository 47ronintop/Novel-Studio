import { describe, expect, test } from "vitest";

import {
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  buildApprovalDecisionProofRefV1,
  canonicalizeApprovalDecisionProofJson,
  checksumChangeSetText,
  createMainOnlyApprovalDecisionProofV1
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  createStoryBibleReferenceDependencyApplyGuard,
  createStoryBibleReferenceDependencyBinding,
  checksumStoryBibleReferenceDependencies,
  type StoryBibleReferenceDependencyBindingRepositoryPort,
  type StoryBibleReferenceDependencyBindingV1,
  type StoryBibleReferenceDependencyV1
} from "../src/story-bible-reference-dependency-guard.js";

const checksum = "a".repeat(64);
const proposalReferenceImpactChecksum = "d".repeat(64);
const dependency: StoryBibleReferenceDependencyV1 = {
  resourceKind: "story_bible",
  resourceId: "chr_dependent",
  revision: 7,
  checksum: "c".repeat(64)
};

describe("Story Bible reference dependency guard", () => {
  test("persists a canonical sidecar binding whose checksum includes the dependency revisions", () => {
    const { proofRef } = proofAndBinding([dependency]);
    const first = createStoryBibleReferenceDependencyBinding(bindingInput(proofRef, [dependency]));
    const reordered = createStoryBibleReferenceDependencyBinding(
      bindingInput(proofRef, [dependency])
    );
    const changed = createStoryBibleReferenceDependencyBinding(
      bindingInput(proofRef, [{ ...dependency, checksum: "e".repeat(64) }])
    );

    expect(first).toMatchObject({ ok: true, value: { proofId: proofRef.proofId } });
    expect(reordered).toMatchObject({
      ok: true,
      value: { bindingChecksum: first.ok ? first.value.bindingChecksum : "" }
    });
    expect(changed).toMatchObject({ ok: true });
    if (!first.ok || !changed.ok) return;
    expect(changed.value.dependencyChecksum).not.toBe(first.value.dependencyChecksum);
    expect(changed.value.bindingChecksum).not.toBe(first.value.bindingChecksum);
  });

  test.each([
    ["dirty", { state: "dirty" as const }, "TARGET_DIRTY"],
    ["unknown", { state: "unknown" as const }, "EDITOR_STATE_UNKNOWN"],
    [
      "stale",
      { state: "clean" as const, revision: 8, checksum: dependency.checksum },
      "STORY_BIBLE_REFERENCE_DEPENDENCY_STALE"
    ]
  ])("fails closed for a %s dependency", async (_label, state, code) => {
    const { binding, proof } = proofAndBinding([dependency]);
    const guard = createStoryBibleReferenceDependencyApplyGuard({
      repository: repositoryFor(binding),
      editorStates: {
        async readManagedResourceState() {
          return ok(state);
        }
      },
      proofs: proofReader(proof)
    });

    await expect(guard.verifyAndClaim(guardInput(binding))).resolves.toMatchObject({
      ok: false,
      error: { code }
    });
  });

  test("rejects a stale proof/change set and an already claimed sidecar", async () => {
    const { binding, proof } = proofAndBinding([dependency]);
    let claimed = false;
    const guard = createStoryBibleReferenceDependencyApplyGuard({
      repository: repositoryFor(binding, () => {
        if (claimed) return err(testError("STORY_BIBLE_REFERENCE_DEPENDENCY_REPLAY"));
        claimed = true;
        return ok(undefined);
      }),
      editorStates: {
        async readManagedResourceState() {
          return ok({
            state: "clean" as const,
            revision: dependency.revision,
            checksum: dependency.checksum
          });
        }
      },
      proofs: proofReader(proof)
    });

    await expect(
      guard.verifyAndClaim({ ...guardInput(binding), checksum: "f".repeat(64) })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_DEPENDENCY_BINDING_STALE" }
    });
    await expect(guard.verifyAndClaim(guardInput(binding))).resolves.toMatchObject({ ok: true });
    await expect(
      guard.verifyAndClaim({ ...guardInput(binding), applyAttemptId: "attempt_2" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_DEPENDENCY_REPLAY" }
    });
  });
});

function bindingInput(
  proofRef: { readonly proofId: string; readonly proofChecksum: string },
  dependencies: readonly StoryBibleReferenceDependencyV1[]
) {
  return {
    proofRef,
    runId: "run_story_bible",
    changeSetId: "changes_story_bible",
    changeSetRevision: 3,
    changeSetChecksum: checksum,
    proposalReferenceImpactChecksums: [proposalReferenceImpactChecksum],
    dependencies
  };
}

function proofAndBinding(dependencies: readonly StoryBibleReferenceDependencyV1[]): {
  readonly binding: StoryBibleReferenceDependencyBindingV1;
  readonly proof: ReturnType<typeof createMainOnlyApprovalDecisionProofV1>;
  readonly proofRef: { readonly proofId: string; readonly proofChecksum: string };
} {
  const dependencyChecksum = checksumStoryBibleReferenceDependencies(dependencies);
  if (dependencyChecksum === undefined) throw new Error("Expected valid dependencies.");
  const referenceImpactChecksum = checksumChangeSetText(
    canonicalizeApprovalDecisionProofJson({
      proposalReferenceImpactChecksums: [proposalReferenceImpactChecksum],
      dependencyChecksum
    })
  );
  const proof = createMainOnlyApprovalDecisionProofV1({
    proofId: "proof_story_bible",
    approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
    operation: "story_bible_patch",
    effectRuleId: "no_reference_impact_story_bible_patch_v1",
    binding: {
      workspaceBindingId: "workspace_01",
      runId: "run_story_bible",
      changeSetId: "changes_story_bible",
      changeSetRevision: 3,
      changeSetChecksum: checksum,
      consistencyGroupChecksum: "b".repeat(64),
      proposalPayloadChecksum: "c".repeat(64),
      referenceImpactChecksum,
      executionWritePolicy: "write_before_confirmation",
      policyRevision: "policy_01",
      capabilityRevision: "capability_01"
    },
    evidence: {
      pathClass: "not_applicable",
      targetFreshness: "clean_stable",
      createOnly: "not_applicable",
      referenceImpact: "none",
      limits: "within",
      stateBoundary: "ordinary"
    }
  });
  const proofRef = buildApprovalDecisionProofRefV1(proof);
  const result = createStoryBibleReferenceDependencyBinding(bindingInput(proofRef, dependencies));
  if (!result.ok) throw new Error(result.error.message);
  return { binding: result.value, proof, proofRef };
}

function guardInput(binding: StoryBibleReferenceDependencyBindingV1) {
  return {
    proofRef: { proofId: binding.proofId, proofChecksum: binding.proofChecksum },
    runId: "run_story_bible",
    changeSetId: "changes_story_bible",
    revision: 3,
    checksum,
    applyAttemptId: "attempt_1"
  };
}

function proofReader(proof: ReturnType<typeof createMainOnlyApprovalDecisionProofV1>) {
  return {
    async readApprovalDecisionProof() {
      return ok(proof);
    }
  };
}

function repositoryFor(
  binding: StoryBibleReferenceDependencyBindingV1,
  claim: () => Promise<Result<void, UnifiedError>> | Result<void, UnifiedError> = () =>
    ok(undefined)
): StoryBibleReferenceDependencyBindingRepositoryPort {
  return {
    async writeStoryBibleReferenceDependencyBinding(input) {
      return ok(input);
    },
    async readStoryBibleReferenceDependencyBinding() {
      return ok(binding);
    },
    async claimStoryBibleReferenceDependencyBinding() {
      return claim();
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
    traceId: "story-bible-reference-dependency-guard-test"
  });
}
