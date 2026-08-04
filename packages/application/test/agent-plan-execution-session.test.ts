import { describe, expect, test } from "vitest";

import * as applicationExports from "../src/index.js";

type JsonRecord = Record<string, unknown>;
type SessionApi = {
  startPlanExecution(input: JsonRecord): Promise<JsonRecord>;
  readPlanExecution(input: JsonRecord): Promise<JsonRecord>;
  transitionStep(input: JsonRecord): Promise<JsonRecord>;
  recordDeviation(input: JsonRecord): Promise<JsonRecord>;
  decidePlanRevision(input: JsonRecord): Promise<JsonRecord>;
  summarize(input: JsonRecord): Promise<JsonRecord>;
};

function createMemoryRepository() {
  const executions = new Map<string, JsonRecord>();
  const requests = new Map<string, JsonRecord>();
  const decisions = new Map<string, JsonRecord>();
  const receipts = new Map<string, JsonRecord>();
  const savedEvents: JsonRecord[] = [];

  return {
    savedEvents,
    async writePlanExecutionRecord(record: JsonRecord) {
      const key = `${String(record["planExecutionId"])}:${String(record["revision"])}`;
      const existing = executions.get(key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record)) {
        return { ok: false, error: { code: "AGENT_PLAN_EXECUTION_REVISION_CONFLICT" } };
      }
      executions.set(key, record);
      return { ok: true, value: record };
    },
    async readPlanExecutionRecord(runId: string, planExecutionId: string, revision?: number) {
      const matches = [...executions.values()].filter(
        (record) => record["runId"] === runId && record["planExecutionId"] === planExecutionId
      );
      const selected =
        revision === undefined
          ? matches.sort((left, right) => Number(right["revision"]) - Number(left["revision"]))[0]
          : matches.find((record) => record["revision"] === revision);
      return { ok: true, value: selected };
    },
    async writePlanRevisionRequest(request: JsonRecord) {
      requests.set(String(request["requestId"]), request);
      return { ok: true, value: request };
    },
    async readPlanRevisionRequest(_runId: string, requestId: string) {
      return { ok: true, value: requests.get(requestId) };
    },
    async writePlanRevisionDecision(decision: JsonRecord) {
      decisions.set(String(decision["requestId"]), decision);
      return { ok: true, value: decision };
    },
    async readPlanRevisionDecision(_runId: string, requestId: string) {
      return { ok: true, value: decisions.get(requestId) };
    },
    async writeCommandReceipt(_runId: string, commandId: string, receipt: JsonRecord) {
      receipts.set(commandId, receipt);
      return { ok: true, value: receipt };
    },
    async readCommandReceipt(_runId: string, commandId: string) {
      return { ok: true, value: receipts.get(commandId) };
    }
  };
}

const providerSemanticVersionSetChecksum = "a".repeat(64);

function handoffForPlanRevision(planRevision: number) {
  return {
    schemaVersion: "2.0",
    handoffId: `handoff_${planRevision}`,
    planId: "plan_01",
    planRevision,
    executionContextMode: "writing",
    executionWritePolicy: "write_before_confirmation",
    executionWritePolicyAcknowledged: false,
    providerSemanticVersionSetChecksum
  } as const;
}

const baseRecord = {
  schemaVersion: "2.0",
  planExecutionId: "execution_01",
  runId: "run_01",
  planId: "plan_01",
  planRevision: 1,
  handoffContextMode: "writing",
  handoffWritePolicy: "write_before_confirmation",
  executionWritePolicyAcknowledged: false,
  providerSemanticVersionSetChecksum,
  handoff: handoffForPlanRevision(1),
  revision: 1,
  steps: [
    {
      stepId: "step_01",
      title: "Read chapter",
      status: "pending",
      startedAt: null,
      completedAt: null,
      verification: [],
      deviationKind: "none",
      blockedReason: null,
      checkpointId: null,
      eventSequence: null
    },
    {
      stepId: "step_02",
      title: "Verify chapter",
      status: "pending",
      startedAt: null,
      completedAt: null,
      verification: [],
      deviationKind: "none",
      blockedReason: null,
      checkpointId: null,
      eventSequence: null
    }
  ]
};

const legacyRecord = {
  schemaVersion: "1.0",
  planExecutionId: "execution_legacy",
  runId: "run_legacy",
  planId: "plan_legacy",
  planRevision: 1,
  handoffContextMode: "writing",
  handoffWritePolicy: "user_preapproved_run",
  revision: 1,
  steps: [
    {
      stepId: "step_legacy",
      title: "Legacy execution",
      status: "pending",
      startedAt: null,
      completedAt: null,
      verification: [],
      deviationKind: "none",
      blockedReason: null,
      checkpointId: null,
      eventSequence: null
    }
  ]
};

function sessionApi(repository: ReturnType<typeof createMemoryRepository>) {
  const create = (applicationExports as unknown as Record<string, unknown>)[
    "createAgentPlanExecutionSession"
  ];
  expect(typeof create).toBe("function");
  if (typeof create !== "function") throw new Error("createAgentPlanExecutionSession is missing");
  return (create as (options: Record<string, unknown>) => SessionApi)({
    repository,
    onEvent: (event: JsonRecord) => {
      repository.savedEvents.push(event);
    }
  });
}

describe("Agent plan execution session", () => {
  test("persists strict 2.0 execution revisions and reloads the latest record", async () => {
    const repository = createMemoryRepository();
    const session = sessionApi(repository);
    const started = await session.startPlanExecution({ record: baseRecord });
    expect(started).toMatchObject({
      ok: true,
      value: { schemaVersion: "2.0", revision: 1, planExecutionId: "execution_01" }
    });

    const transitioned = await session.transitionStep({
      runId: "run_01",
      planExecutionId: "execution_01",
      stepId: "step_01",
      status: "running",
      at: "2026-07-17T02:00:00.000Z",
      checkpointId: "checkpoint_01",
      eventSequence: 10
    });
    expect(transitioned).toMatchObject({ ok: true, value: { revision: 2 } });

    const reloaded = sessionApi(repository);
    expect(
      await reloaded.readPlanExecution({ runId: "run_01", planExecutionId: "execution_01" })
    ).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        steps: expect.arrayContaining([
          expect.objectContaining({ stepId: "step_01", status: "running" })
        ])
      }
    });
    expect(
      await reloaded.readPlanExecution({
        runId: "run_01",
        planExecutionId: "execution_01",
        revision: 1
      })
    ).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        steps: expect.arrayContaining([
          expect.objectContaining({ stepId: "step_01", status: "pending" })
        ])
      }
    });
  });

  test("keeps the flag-off legacy pipeline active while stripping inherited preapproval", async () => {
    const repository = createMemoryRepository();
    await repository.writePlanExecutionRecord(legacyRecord);
    const session = sessionApi(repository);

    const hydrated = await session.readPlanExecution({
      runId: "run_legacy",
      planExecutionId: "execution_legacy"
    });
    expect(hydrated).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.0",
        handoffWritePolicy: "write_before_confirmation"
      }
    });
    expect(Object.isFrozen(hydrated.value)).toBe(true);
    expect(Object.isFrozen((hydrated.value as JsonRecord)["steps"])).toBe(true);
    await expect(
      session.summarize({ runId: "run_legacy", planExecutionId: "execution_legacy" })
    ).resolves.toMatchObject({ ok: true, value: { status: "active" } });

    await expect(
      session.startPlanExecution({
        record: {
          ...legacyRecord,
          runId: "run_legacy_fresh",
          planExecutionId: "execution_legacy_fresh"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.0",
        handoffWritePolicy: "write_before_confirmation"
      }
    });
    await expect(
      session.transitionStep({
        runId: "run_legacy",
        planExecutionId: "execution_legacy",
        stepId: "step_legacy",
        status: "running",
        at: "2026-08-04T00:00:00.000Z",
        checkpointId: "checkpoint_legacy",
        eventSequence: 1
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.0",
        handoffWritePolicy: "write_before_confirmation",
        steps: [expect.objectContaining({ stepId: "step_legacy", status: "running" })]
      }
    });
  });

  test("rejects legacy records with unknown top-level fields", async () => {
    const repository = createMemoryRepository();
    await repository.writePlanExecutionRecord({ ...legacyRecord, forgedAcknowledgement: true });
    const session = sessionApi(repository);

    await expect(
      session.readPlanExecution({ runId: "run_legacy", planExecutionId: "execution_legacy" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_EXECUTION_RECORD_INVALID" }
    });
  });

  test("fails closed when a persisted 2.0 record has a malformed or mismatched handoff", async () => {
    const repository = createMemoryRepository();
    await repository.writePlanExecutionRecord({
      ...baseRecord,
      handoff: {
        ...baseRecord.handoff,
        executionWritePolicy: "user_preapproved_run"
      }
    });
    const session = sessionApi(repository);

    await expect(
      session.readPlanExecution({ runId: "run_01", planExecutionId: "execution_01" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_EXECUTION_RECORD_INVALID" }
    });
  });

  test("rejects an unknown execution-record version instead of treating it as legacy", async () => {
    const repository = createMemoryRepository();
    await repository.writePlanExecutionRecord({ ...baseRecord, schemaVersion: "2.1" });
    const session = sessionApi(repository);

    await expect(
      session.readPlanExecution({ runId: "run_01", planExecutionId: "execution_01" })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_EXECUTION_RECORD_INVALID" }
    });
  });

  test("keeps minor read-order deviations active and pauses material deviations for revision", async () => {
    const repository = createMemoryRepository();
    const session = sessionApi(repository);
    await session.startPlanExecution({ record: baseRecord });

    const minor = await session.recordDeviation({
      runId: "run_01",
      planExecutionId: "execution_01",
      stepId: "step_01",
      requestId: "request_minor",
      change: "read_order_changed",
      summary: "Read the Story Bible first.",
      eventSequence: 10
    });
    expect(minor).toMatchObject({
      ok: true,
      value: {
        state: "active",
        kind: "minor",
        requiresPlanRevision: false,
        record: { revision: 2 }
      }
    });

    const material = await session.recordDeviation({
      runId: "run_01",
      planExecutionId: "execution_01",
      stepId: "step_01",
      requestId: "request_material",
      planRevision: 2,
      change: "new_target",
      summary: "Chapter 4 must also change.",
      discovery: "The target chapter references the same contradiction.",
      proposal: "Extend the plan to chapter 4.",
      eventSequence: 11
    });
    expect(material).toMatchObject({
      ok: true,
      value: {
        state: "awaiting_plan_revision",
        kind: "material",
        requiresPlanRevision: true,
        request: {
          requestId: "request_material",
          planId: "plan_01",
          planRevision: 2,
          affectedStepIds: ["step_01"]
        }
      }
    });
    expect(repository.savedEvents.map((event) => event["type"])).toEqual([
      "plan_deviation_recorded",
      "plan_deviation_recorded",
      "plan_revision_requested"
    ]);
  });

  test("approves or rejects a revision request and deduplicates the command receipt after reload", async () => {
    const repository = createMemoryRepository();
    const session = sessionApi(repository);
    await session.startPlanExecution({ record: baseRecord });
    await session.recordDeviation({
      runId: "run_01",
      planExecutionId: "execution_01",
      stepId: "step_01",
      requestId: "request_approve",
      planRevision: 2,
      change: "write_policy_changed",
      summary: "The user explicitly changed the write policy.",
      discovery: "Approval was recorded in the conversation.",
      proposal: "Continue with plan revision 2.",
      eventSequence: 10
    });

    const reloaded = sessionApi(repository);
    const approved = await reloaded.decidePlanRevision({
      runId: "run_01",
      planExecutionId: "execution_01",
      commandId: "decide_approve",
      expectedRunRevision: 2,
      requestId: "request_approve",
      planId: "plan_01",
      planRevision: 2,
      decision: "approve",
      handoff: handoffForPlanRevision(2)
    });
    expect(approved).toMatchObject({
      ok: true,
      value: { decision: "approve", state: "active", record: { revision: 3, planRevision: 2 } }
    });
    expect(
      await reloaded.decidePlanRevision({
        runId: "run_01",
        planExecutionId: "execution_01",
        commandId: "decide_approve",
        expectedRunRevision: 2,
        requestId: "request_approve",
        planId: "plan_01",
        planRevision: 2,
        decision: "approve",
        handoff: handoffForPlanRevision(2)
      })
    ).toEqual(approved);
    const afterDecisionReload = sessionApi(repository);
    expect(
      await afterDecisionReload.decidePlanRevision({
        runId: "run_01",
        planExecutionId: "execution_01",
        commandId: "decide_again",
        expectedRunRevision: 3,
        requestId: "request_approve",
        planId: "plan_01",
        planRevision: 2,
        decision: "reject"
      })
    ).toMatchObject({
      ok: false,
      error: { code: "AGENT_PLAN_REVISION_ALREADY_DECIDED" }
    });

    await reloaded.recordDeviation({
      runId: "run_01",
      planExecutionId: "execution_01",
      stepId: "step_01",
      requestId: "request_reject",
      planRevision: 3,
      change: "new_target",
      summary: "Another target appeared.",
      discovery: "The target is out of scope.",
      proposal: "Stop the run.",
      eventSequence: 20
    });
    const rejected = await reloaded.decidePlanRevision({
      runId: "run_01",
      planExecutionId: "execution_01",
      commandId: "decide_reject",
      expectedRunRevision: 4,
      requestId: "request_reject",
      planId: "plan_01",
      planRevision: 3,
      decision: "reject"
    });
    expect(rejected).toMatchObject({
      ok: true,
      value: { decision: "reject", state: "stopped", record: { revision: 4, planRevision: 2 } }
    });
  });
});
