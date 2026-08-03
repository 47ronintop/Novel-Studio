import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
  DEFAULT_APPROVAL_RULE_SET_VERSION
} from "../src/approval-rule-registry.js";
import {
  approvalDecisionProofChecksum,
  buildApprovalDecisionProofRefV1,
  createMainOnlyApprovalDecisionProofV1,
  parseApprovalDecisionProofV1,
  parseApprovalDecisionProofV1Json,
  providerVisibleApprovalDecisionSummaryV1,
  resolveApprovalDecisionProofGroup,
  serializeApprovalDecisionProofV1,
  verifyApprovalDecisionProofBinding,
  type ApprovalDecisionProofBindingV1,
  type ApprovalDecisionProofEvidenceV1,
  type CreateMainOnlyApprovalDecisionProofV1Input
} from "../src/approval-decision-proof.js";

const CHECKSUM = "a".repeat(64);

describe("approval decision proof", () => {
  test("writes and parses only the strict canonical schema", () => {
    const proof = eligibleChapterProof();
    const serialized = serializeApprovalDecisionProofV1(proof);

    expect(parseApprovalDecisionProofV1Json(serialized)).toEqual(proof);
    expect(() => parseApprovalDecisionProofV1Json(`${serialized}\n`)).toThrow(
      "APPROVAL_DECISION_PROOF_INVALID"
    );
    expect(() =>
      parseApprovalDecisionProofV1Json(`${serialized.slice(0, -1)},"proofId":"proof_duplicate"}`)
    ).toThrow("APPROVAL_DECISION_PROOF_INVALID");
    expect(() =>
      createMainOnlyApprovalDecisionProofV1({
        ...eligibleChapterInput(),
        approvalRuleSetChecksum: "b".repeat(64)
      })
    ).toThrow("APPROVAL_DECISION_PROOF_INVALID");
    expect(() => parseApprovalDecisionProofV1({ ...proof, unexpected: true })).toThrow(
      "APPROVAL_DECISION_PROOF_INVALID"
    );

    const orderedHumanProof = createMainOnlyApprovalDecisionProofV1({
      ...eligibleChapterInput(),
      binding: { ...binding(), executionWritePolicy: "write_before_confirmation" },
      evidence: { ...chapterEvidence(), targetFreshness: "dirty" }
    });
    expect(() =>
      parseApprovalDecisionProofV1({
        ...orderedHumanProof,
        reasonCodes: [...orderedHumanProof.reasonCodes].reverse()
      })
    ).toThrow("APPROVAL_DECISION_PROOF_INVALID");
  });

  test("derives decision and stable reason codes from the registered rule and evidence", () => {
    expect(eligibleChapterProof()).toMatchObject({
      decision: "auto_review_eligible",
      reasonCodes: []
    });

    const policyBound = createMainOnlyApprovalDecisionProofV1({
      ...eligibleChapterInput(),
      binding: { ...binding(), executionWritePolicy: "write_before_confirmation" }
    });
    expect(policyBound).toMatchObject({
      decision: "human_confirmation",
      reasonCodes: ["run_policy_requires_confirmation"]
    });

    const dirty = createMainOnlyApprovalDecisionProofV1({
      ...eligibleChapterInput(),
      evidence: { ...chapterEvidence(), targetFreshness: "dirty" }
    });
    expect(dirty).toMatchObject({
      decision: "human_confirmation",
      reasonCodes: ["target_not_clean_or_stable"]
    });

    const denied = createMainOnlyApprovalDecisionProofV1({
      ...eligibleChapterInput(),
      evidence: { ...chapterEvidence(), pathClass: "hard_denied" }
    });
    expect(denied).toMatchObject({
      decision: "rejected",
      reasonCodes: ["operation_rejected"]
    });
  });

  test("enforces always-human and conditional effect-rule cross invariants", () => {
    const alwaysHuman = createMainOnlyApprovalDecisionProofV1({
      proofId: "proof_chapter_rename",
      approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
      approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
      operation: "chapter_rename",
      binding: binding(),
      evidence: chapterEvidence()
    });
    expect(alwaysHuman).toMatchObject({
      decision: "human_confirmation",
      reasonCodes: ["operation_always_human"]
    });
    expect("effectRuleId" in alwaysHuman).toBe(false);

    const withUnexpectedEffect = {
      ...alwaysHuman,
      effectRuleId: "clean_chapter_body_v1"
    };
    expect(() => parseApprovalDecisionProofV1Json(JSON.stringify(withUnexpectedEffect))).toThrow(
      "APPROVAL_DECISION_PROOF_INVALID"
    );
    const mismatchedEffect = {
      ...eligibleChapterProof(),
      effectRuleId: "bounded_chapter_create_v1"
    };
    expect(() => parseApprovalDecisionProofV1Json(JSON.stringify(mismatchedEffect))).toThrow(
      "APPROVAL_DECISION_PROOF_INVALID"
    );
  });

  test("binds canonical checksums, detects binding drift, and emits no Main-only facts", () => {
    const proof = eligibleChapterProof();
    const serialized = serializeApprovalDecisionProofV1(proof);
    const expectedChecksum = createHash("sha256").update(serialized, "utf8").digest("hex");
    expect(approvalDecisionProofChecksum(proof)).toBe(expectedChecksum);
    expect(buildApprovalDecisionProofRefV1(proof)).toEqual({
      proofId: proof.proofId,
      proofChecksum: expectedChecksum
    });

    const stale = verifyApprovalDecisionProofBinding(proof, {
      ...proof.binding,
      candidateManifestChecksum: "c".repeat(64)
    });
    expect(stale).toEqual({
      isCurrent: false,
      stale: true,
      mismatchedFields: ["candidateManifestChecksum"]
    });

    const summary = providerVisibleApprovalDecisionSummaryV1(proof);
    expect(Object.keys(summary).sort()).toEqual([
      "approvalRequirement",
      "operation",
      "proofChecksum",
      "reasonCodes",
      "schemaVersion"
    ]);
    expect(JSON.stringify(summary)).not.toContain(proof.proofId);
    expect(JSON.stringify(summary)).not.toContain(proof.binding.workspaceBindingId);
    expect(JSON.stringify(summary)).not.toContain(proof.binding.policyRevision);
  });

  test("downgrades mixed or incomplete consistency groups before auto review", () => {
    const proof = eligibleChapterProof();
    expect(resolveApprovalDecisionProofGroup([proof])).toEqual({
      decision: "human_confirmation",
      reasonCodes: ["mixed_or_incomplete_evidence"]
    });
    expect(
      resolveApprovalDecisionProofGroup({
        proofs: [proof],
        expectedProofCount: 1,
        complete: true
      })
    ).toEqual({
      decision: "auto_review_eligible",
      reasonCodes: []
    });
    expect(resolveApprovalDecisionProofGroup({ proofs: [proof], expectedProofCount: 2 })).toEqual({
      decision: "human_confirmation",
      reasonCodes: ["mixed_or_incomplete_evidence"]
    });
    expect(resolveApprovalDecisionProofGroup({ proofs: [proof], mixed: true })).toEqual({
      decision: "human_confirmation",
      reasonCodes: ["mixed_or_incomplete_evidence"]
    });
  });
});

function eligibleChapterProof() {
  return createMainOnlyApprovalDecisionProofV1(eligibleChapterInput());
}

function eligibleChapterInput(): CreateMainOnlyApprovalDecisionProofV1Input {
  return {
    proofId: "proof_chapter_replace",
    approvalRuleSetVersion: DEFAULT_APPROVAL_RULE_SET_VERSION,
    approvalRuleSetChecksum: DEFAULT_APPROVAL_RULE_SET_CHECKSUM,
    operation: "chapter_replace",
    effectRuleId: "clean_chapter_body_v1",
    binding: binding(),
    evidence: chapterEvidence()
  };
}

function binding(): ApprovalDecisionProofBindingV1 {
  return {
    workspaceBindingId: "workspace_01",
    rootBindingId: "root_01",
    runId: "run_01",
    changeSetId: "change_set_01",
    changeSetRevision: 1,
    changeSetChecksum: CHECKSUM,
    consistencyGroupChecksum: "b".repeat(64),
    proposalPayloadChecksum: "c".repeat(64),
    baseManifestChecksum: "d".repeat(64),
    candidateManifestChecksum: "e".repeat(64),
    referenceImpactChecksum: "f".repeat(64),
    executionWritePolicy: "user_preapproved_run",
    policyRevision: "policy_01",
    capabilityRevision: "capability_01"
  };
}

function chapterEvidence(): ApprovalDecisionProofEvidenceV1 {
  return {
    pathClass: "not_applicable",
    targetFreshness: "clean_stable",
    createOnly: "not_applicable",
    referenceImpact: "not_applicable",
    limits: "within",
    stateBoundary: "ordinary"
  };
}
