import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Plan Artifact", () => {
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
