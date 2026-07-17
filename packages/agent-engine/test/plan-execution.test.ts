import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

type ExecutionRecord = {
  readonly revision: number;
  readonly planExecutionId: string;
  readonly handoffContextMode: string;
  readonly handoffWritePolicy: string;
  readonly steps: readonly {
    readonly stepId: string;
    readonly status: string;
    readonly verification: readonly string[];
    readonly deviationKind: string;
    readonly blockedReason: string | null;
    readonly checkpointId: string | null;
    readonly eventSequence: number | null;
  }[];
};

type ExecutionResult =
  | { readonly ok: true; readonly value: ExecutionRecord }
  | { readonly ok: false; readonly error: { readonly code: string } };

const plan = {
  planId: "plan_01",
  revision: 3,
  steps: [
    { stepId: "step_read", title: "Read chapter", verification: "Confirm current revision" },
    { stepId: "step_edit", title: "Edit chapter", verification: "Review the diff" },
    { stepId: "step_verify", title: "Verify result", verification: "Run focused tests" }
  ]
};

function api() {
  const exports = engineExports as unknown as Record<string, unknown>;
  const create = exports["createPlanExecutionRecord"];
  const transition = exports["transitionPlanExecutionStep"];
  const classify = exports["classifyPlanDeviation"];
  const recordDeviation = exports["recordPlanExecutionDeviation"];
  const summarize = exports["summarizePlanExecution"];

  expect(typeof create).toBe("function");
  expect(typeof transition).toBe("function");
  expect(typeof classify).toBe("function");
  expect(typeof recordDeviation).toBe("function");
  expect(typeof summarize).toBe("function");

  return {
    create: create as (input: Record<string, unknown>) => ExecutionRecord,
    transition: transition as (
      record: ExecutionRecord,
      input: Record<string, unknown>
    ) => ExecutionResult,
    classify: classify as (input: Record<string, unknown>) => "minor" | "material",
    recordDeviation: recordDeviation as (
      record: ExecutionRecord,
      input: Record<string, unknown>
    ) =>
      | {
          readonly ok: true;
          readonly value: {
            readonly record: ExecutionRecord;
            readonly kind: "minor" | "material";
            readonly requiresPlanRevision: boolean;
          };
        }
      | { readonly ok: false; readonly error: { readonly code: string } },
    summarize: summarize as (record: ExecutionRecord) => Record<string, unknown>
  };
}

function createRecord(): ExecutionRecord {
  return api().create({
    planExecutionId: "execution_01",
    runId: "run_01",
    plan,
    handoffContextMode: "general_file",
    handoffWritePolicy: "user_preapproved_run"
  });
}

function transition(record: ExecutionRecord, input: Record<string, unknown>): ExecutionRecord {
  const result = api().transition(record, input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe("Plan execution records", () => {
  test("creates immutable revision 1 from stable plan step ids and treats handoff choices as facts", () => {
    const record = createRecord();

    expect(record).toMatchObject({
      schemaVersion: "1.0",
      planExecutionId: "execution_01",
      runId: "run_01",
      planId: "plan_01",
      planRevision: 3,
      handoffContextMode: "general_file",
      handoffWritePolicy: "user_preapproved_run",
      revision: 1
    });
    expect(record.steps.map((step) => step.stepId)).toEqual([
      "step_read",
      "step_edit",
      "step_verify"
    ]);
    expect(record.steps).toEqual(
      plan.steps.map((step) => ({
        stepId: step.stepId,
        title: step.title,
        status: "pending",
        startedAt: null,
        completedAt: null,
        verification: [],
        deviationKind: "none",
        blockedReason: null,
        checkpointId: null,
        eventSequence: null
      }))
    );
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.steps)).toBe(true);
    expect(Object.isFrozen(record.steps[0])).toBe(true);
  });

  test("advances pending steps through running to completed, blocked, or skipped revisions", () => {
    const original = createRecord();
    const readRunning = transition(original, {
      stepId: "step_read",
      status: "running",
      at: "2026-07-17T01:00:00.000Z",
      checkpointId: "checkpoint_read",
      eventSequence: 10
    });
    const readCompleted = transition(readRunning, {
      stepId: "step_read",
      status: "completed",
      at: "2026-07-17T01:01:00.000Z",
      verification: ["Read revision chapter_03@7"],
      eventSequence: 11
    });
    const editRunning = transition(readCompleted, {
      stepId: "step_edit",
      status: "running",
      at: "2026-07-17T01:02:00.000Z",
      checkpointId: "checkpoint_edit",
      eventSequence: 12
    });
    const editBlocked = transition(editRunning, {
      stepId: "step_edit",
      status: "blocked",
      at: "2026-07-17T01:03:00.000Z",
      blockedReason: "Target changed on disk",
      eventSequence: 13
    });
    const verifyRunning = transition(editBlocked, {
      stepId: "step_verify",
      status: "running",
      at: "2026-07-17T01:04:00.000Z",
      checkpointId: "checkpoint_verify",
      eventSequence: 14
    });
    const verifySkipped = transition(verifyRunning, {
      stepId: "step_verify",
      status: "skipped",
      at: "2026-07-17T01:05:00.000Z",
      blockedReason: "User rejected the material revision",
      eventSequence: 15
    });

    expect(original.revision).toBe(1);
    expect(original.steps.every((step) => step.status === "pending")).toBe(true);
    expect(verifySkipped.revision).toBe(7);
    expect(verifySkipped.steps).toMatchObject([
      {
        stepId: "step_read",
        status: "completed",
        verification: ["Read revision chapter_03@7"],
        checkpointId: "checkpoint_read",
        eventSequence: 11
      },
      {
        stepId: "step_edit",
        status: "blocked",
        blockedReason: "Target changed on disk",
        eventSequence: 13
      },
      {
        stepId: "step_verify",
        status: "skipped",
        blockedReason: "User rejected the material revision",
        eventSequence: 15
      }
    ]);
  });

  test("rejects illegal transitions and completed steps without verification evidence", () => {
    const record = createRecord();
    const skippedRunning = api().transition(record, {
      stepId: "step_read",
      status: "completed",
      at: "2026-07-17T01:00:00.000Z",
      verification: ["not reachable"],
      eventSequence: 10
    });
    expect(skippedRunning).toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_STEP_TRANSITION_INVALID" }
    });

    const running = transition(record, {
      stepId: "step_read",
      status: "running",
      at: "2026-07-17T01:00:00.000Z",
      checkpointId: "checkpoint_read",
      eventSequence: 10
    });
    expect(
      api().transition(running, {
        stepId: "step_read",
        status: "completed",
        at: "2026-07-17T01:01:00.000Z",
        verification: [],
        eventSequence: 11
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_STEP_VERIFICATION_REQUIRED" }
    });
  });

  test("classifies read-order changes as minor and new targets or policy changes as material", () => {
    const { classify, recordDeviation } = api();
    expect(classify({ change: "read_order_changed" })).toBe("minor");
    expect(classify({ change: "related_source_read" })).toBe("minor");
    expect(classify({ change: "read_retry" })).toBe("minor");
    expect(classify({ change: "new_target" })).toBe("material");
    expect(classify({ change: "write_policy_changed" })).toBe("material");

    const original = createRecord();
    const minor = recordDeviation(original, {
      stepId: "step_read",
      change: "read_order_changed",
      summary: "Read the Story Bible before the chapter.",
      eventSequence: 10
    });
    expect(minor).toMatchObject({
      ok: true,
      value: {
        kind: "minor",
        requiresPlanRevision: false,
        record: {
          revision: 2,
          steps: expect.arrayContaining([
            expect.objectContaining({
              stepId: "step_read",
              deviationKind: "minor",
              eventSequence: 10
            })
          ])
        }
      }
    });
    if (!minor.ok) return;

    const material = recordDeviation(minor.value.record, {
      stepId: "step_edit",
      change: "new_target",
      summary: "The fix also needs chapter 4.",
      eventSequence: 11
    });
    expect(material).toMatchObject({
      ok: true,
      value: {
        kind: "material",
        requiresPlanRevision: true,
        record: {
          revision: 3,
          steps: expect.arrayContaining([
            expect.objectContaining({ stepId: "step_read", deviationKind: "minor" }),
            expect.objectContaining({
              stepId: "step_edit",
              deviationKind: "material",
              eventSequence: 11
            })
          ])
        }
      }
    });
  });

  test("summarizes terminal statuses, deviations, and verification evidence", () => {
    let record = createRecord();
    record = transition(record, {
      stepId: "step_read",
      status: "running",
      at: "2026-07-17T01:00:00.000Z",
      checkpointId: "checkpoint_read",
      eventSequence: 10
    });
    const deviation = api().recordDeviation(record, {
      stepId: "step_read",
      change: "read_order_changed",
      summary: "Read references first.",
      eventSequence: 11
    });
    if (!deviation.ok) throw new Error(deviation.error.code);
    record = transition(deviation.value.record, {
      stepId: "step_read",
      status: "completed",
      at: "2026-07-17T01:01:00.000Z",
      verification: ["chapter_03@7"],
      eventSequence: 12
    });
    record = transition(record, {
      stepId: "step_edit",
      status: "running",
      at: "2026-07-17T01:02:00.000Z",
      checkpointId: "checkpoint_edit",
      eventSequence: 13
    });
    record = transition(record, {
      stepId: "step_edit",
      status: "blocked",
      at: "2026-07-17T01:03:00.000Z",
      blockedReason: "Needs a plan revision",
      eventSequence: 14
    });
    record = transition(record, {
      stepId: "step_verify",
      status: "running",
      at: "2026-07-17T01:04:00.000Z",
      checkpointId: "checkpoint_verify",
      eventSequence: 15
    });
    record = transition(record, {
      stepId: "step_verify",
      status: "skipped",
      at: "2026-07-17T01:05:00.000Z",
      blockedReason: "Blocked edit left nothing to verify",
      eventSequence: 16
    });

    expect(api().summarize(record)).toEqual({
      status: "blocked",
      completedAsPlannedStepIds: [],
      minorDeviationStepIds: ["step_read"],
      materialDeviationStepIds: [],
      blockedStepIds: ["step_edit"],
      skippedStepIds: ["step_verify"],
      verification: [{ stepId: "step_read", evidence: ["chapter_03@7"] }]
    });
  });
});
