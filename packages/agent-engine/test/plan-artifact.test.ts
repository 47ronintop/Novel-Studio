import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";
import {
  createPlanActHandoffV20,
  createPlanArtifactRevisionV20,
  parsePlanActHandoffV20,
  parsePlanArtifactV20,
  validatePlanActHandoffV20
} from "../src/plan-artifact.js";

describe("Plan Artifact", () => {
  test("keeps the future policy on the plan but fails closed without a qualified Act surface", () => {
    const plan = createPlanArtifactRevisionV20({
      planId: "plan_v20",
      sourceRunId: "run_v20",
      operationMode: "planning",
      contextMode: "writing",
      goal: "Align chapter motivation.",
      successCriteria: ["Motivation is consistent"],
      nonGoals: ["Do not rewrite the ending"],
      facts: ["Chapter 3 contradicts the Story Bible"],
      assumptions: [],
      openQuestions: [],
      targetRefs: [{ refId: "chapter_03", intent: "Correct the motivation trigger" }],
      steps: [{ stepId: "step_01", title: "Read chapter 3", verification: "Re-read diff" }],
      risks: ["Continuity drift"],
      verification: ["Compare against Story Bible"],
      sourceRefs: ["chapter_03"],
      createdAt: "2026-08-04T00:00:00.000Z",
      executionWritePolicyDraft: "user_preapproved_run"
    });
    expect(plan).toMatchObject({
      schemaVersion: "2.0",
      operationMode: "planning",
      executionWritePolicyDraft: "user_preapproved_run"
    });
    expect(parsePlanArtifactV20(plan)).toBe(plan);

    expect(() =>
      createPlanActHandoffV20(plan, {
        handoffId: "handoff_v20",
        planId: plan.planId,
        planRevision: plan.revision,
        executionContextMode: "writing",
        executionWritePolicy: "user_preapproved_run",
        providerSemanticVersionSetChecksum: "a".repeat(64)
      })
    ).toThrow("AGENT_PLAN_HANDOFF_TRUST_REQUIRED");

    expect(() =>
      createPlanActHandoffV20(plan, {
        handoffId: "handoff_v20_forged",
        planId: plan.planId,
        planRevision: plan.revision,
        executionContextMode: "writing",
        executionWritePolicy: "user_preapproved_run",
        executionWritePolicyAcknowledged: true,
        providerSemanticVersionSetChecksum: "a".repeat(64)
      })
    ).toThrow("AGENT_PLAN_HANDOFF_TRUST_REQUIRED");

    const handoff = createPlanActHandoffV20(plan, {
      handoffId: "handoff_v20",
      planId: plan.planId,
      planRevision: plan.revision,
      executionContextMode: "writing",
      executionWritePolicy: "write_before_confirmation",
      providerSemanticVersionSetChecksum: "a".repeat(64)
    });
    expect(parsePlanActHandoffV20(handoff)).toBe(handoff);
    expect(handoff.executionWritePolicyAcknowledged).toBe(false);
  });

  test("rejects forged handoff acknowledgement, stale plan revision, and unknown fields", () => {
    const valid = {
      schemaVersion: "2.0",
      handoffId: "handoff_v20",
      planId: "plan_v20",
      planRevision: 1,
      executionContextMode: "writing",
      executionWritePolicy: "write_before_confirmation",
      executionWritePolicyAcknowledged: false,
      providerSemanticVersionSetChecksum: "a".repeat(64)
    } as const;
    expect(
      validatePlanActHandoffV20({ ...valid, executionWritePolicyAcknowledged: true })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_HANDOFF_ACKNOWLEDGEMENT_INVALID" }
    });
    expect(validatePlanActHandoffV20({ ...valid, extra: true })).toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_HANDOFF_INVALID" }
    });
    expect(
      validatePlanActHandoffV20({
        ...valid,
        executionWritePolicy: "user_preapproved_run",
        executionWritePolicyAcknowledged: true,
        confirmationSource: "main_owned_isolated_modal_v1"
      })
    ).toMatchObject({ ok: false });
    const plan = {
      planId: "plan_v20",
      revision: 2
    } as const;
    expect(() =>
      createPlanActHandoffV20(plan, {
        ...valid,
        planRevision: 1
      })
    ).toThrow("AGENT_PLAN_HANDOFF_PLAN_REVISION_MISMATCH");
  });

  test("freezes revisions and blocks execution until blocking questions are resolved", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createPlan = exports["createPlanArtifactRevision"];
    const revisePlan = exports["revisePlanArtifact"];
    const canExecute = exports["canExecutePlanArtifact"];
    expect(typeof createPlan).toBe("function");
    expect(typeof revisePlan).toBe("function");
    expect(typeof canExecute).toBe("function");
    if (
      typeof createPlan !== "function" ||
      typeof revisePlan !== "function" ||
      typeof canExecute !== "function"
    )
      return;

    const plan = createPlan({
      planId: "plan_01",
      sourceRunId: "run_01",
      operationMode: "planning",
      contextMode: "writing",
      goal: "Align chapter motivation.",
      successCriteria: ["Motivation is consistent"],
      nonGoals: ["Do not rewrite the ending"],
      facts: ["Chapter 3 contradicts the Story Bible"],
      assumptions: [],
      openQuestions: [
        {
          questionId: "question_01",
          prompt: "Keep the existing reveal timing?",
          blocking: true
        }
      ],
      targetRefs: [{ refId: "chapter_03", intent: "Correct the motivation trigger" }],
      steps: [{ stepId: "step_01", title: "Read chapter 3", verification: "Re-read diff" }],
      risks: ["Continuity drift"],
      verification: ["Compare against Story Bible"],
      sourceRefs: ["chapter_03", "story_bible_character_hero"],
      createdAt: "2026-07-13T00:00:00.000Z"
    }) as Record<string, unknown>;
    expect(plan).toMatchObject({ revision: 1, status: "ready" });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(canExecute(plan)).toBe(false);

    const revised = revisePlan(plan, {
      resolvedQuestions: [
        {
          questionId: "question_01",
          resolution: "Keep the reveal timing.",
          resolvedBy: "user"
        }
      ],
      createdAt: "2026-07-13T00:01:00.000Z"
    }) as Record<string, unknown>;
    expect(revised).toMatchObject({ revision: 2, status: "ready" });
    expect(canExecute(revised)).toBe(true);
    expect(plan).toMatchObject({ revision: 1 });
  });
});
