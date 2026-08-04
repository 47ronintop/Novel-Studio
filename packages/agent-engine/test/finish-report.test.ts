import { describe, expect, test } from "vitest";

import {
  finishInputSchemaV2,
  isFinishPendingState,
  validateFinishForRun,
  validateFinishInput,
  parseFinishEvidenceRef
} from "../src/finish-report.js";

const completed = {
  outcome: "completed" as const,
  report: {
    result: "The requested read-only work is complete.",
    appliedChanges: [],
    verification: ["No write was requested."],
    residualRisks: []
  },
  evidenceRefs: ["run-event/1/tool_completed/read-01"]
};

describe("finish report v2", () => {
  test("parses only app-owned canonical evidence references", () => {
    const checksum = "a".repeat(64);
    expect(
      parseFinishEvidenceRef(`run-event/7/write_applied/change-set-01/2/${checksum}`)
    ).toMatchObject({
      kind: "write_applied",
      sequence: 7,
      changeSetId: "change-set-01",
      revision: 2,
      checksum
    });
    expect(parseFinishEvidenceRef("run-event/8/tool_completed/read-01")).toEqual({
      kind: "tool_completed",
      sequence: 8,
      toolCallId: "read-01"
    });
    expect(
      parseFinishEvidenceRef("run-event/8/write_applied/change-set-01/2/not-a-checksum")
    ).toBeUndefined();
    expect(parseFinishEvidenceRef("test:evidence:completed")).toBeUndefined();
  });
  test("accepts completed reports only when verification and evidence are present", () => {
    const parsed = validateFinishInput(completed);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.schemaVersion).toBeUndefined();
  });

  test("rejects completed reports without verification", () => {
    const parsed = validateFinishInput({
      ...completed,
      report: { ...completed.report, verification: [] }
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("AGENT_FINISH_VERIFICATION_REQUIRED");
  });

  test("requires a next step for blocked reports", () => {
    const parsed = validateFinishInput({
      outcome: "blocked",
      report: {
        result: "The operation is waiting for a user decision.",
        appliedChanges: [],
        verification: ["The pending approval was persisted."],
        residualRisks: []
      },
      evidenceRefs: ["run-event/1/tool_failed/read-01"]
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("AGENT_FINISH_NEXT_STEP_REQUIRED");
  });

  test("fails closed on unknown fields and historical versions", () => {
    expect(validateFinishInput({ ...completed, unexpected: true }).ok).toBe(false);
    const versioned = validateFinishInput({ ...completed, schemaVersion: "1.0" });
    expect(versioned.ok).toBe(false);
    if (versioned.ok) return;
    expect(versioned.error.code).toBe("AGENT_FINISH_REPORT_VERSION_UNSUPPORTED");
    const malformedEvidence = validateFinishInput({ ...completed, evidenceRefs: ["forged"] });
    expect(malformedEvidence).toMatchObject({
      ok: false,
      error: { code: "AGENT_FINISH_REPORT_INVALID" }
    });
  });

  test("does not finish outside an active execution model state", () => {
    for (const status of [
      "awaiting_write_approval",
      "awaiting_context_share_approval",
      "awaiting_user_input",
      "awaiting_context_refresh",
      "context_stale",
      "awaiting_tool_approval",
      "awaiting_external_outcome_resolution",
      "recovery_required",
      "recovery_review",
      "context_compacting",
      "awaiting_plan_revision",
      "plan_ready",
      "awaiting_plan_decision",
      "staging_changes",
      "applying_changes",
      "stopping_after_transaction",
      "executing_read_tool"
    ]) {
      const pending = validateFinishForRun(completed, { status, recoveryState: "none" });
      expect(pending.ok).toBe(false);
      if (!pending.ok) expect(pending.error.code).toBe("AGENT_FINISH_PENDING");
    }

    const recovering = validateFinishForRun(completed, {
      status: "executing_model",
      recoveryState: "required"
    });
    expect(recovering.ok).toBe(false);
    if (recovering.ok) return;
    expect(recovering.error.code).toBe("AGENT_FINISH_RECOVERY_ACTIVE");
  });

  test("treats every reachable transition state as pending", () => {
    for (const status of [
      "created",
      "executing_read_tool",
      "staging_changes",
      "awaiting_write_approval",
      "applying_changes",
      "stopping_after_transaction",
      "awaiting_user_input",
      "awaiting_context_refresh",
      "plan_ready",
      "awaiting_plan_decision",
      "context_compacting",
      "awaiting_plan_revision",
      "awaiting_tool_approval",
      "awaiting_external_outcome_resolution"
    ]) {
      expect(isFinishPendingState({ status })).toBe(true);
    }
    expect(isFinishPendingState({ status: "executing_model", recoveryState: "none" })).toBe(false);
    expect(isFinishPendingState({ status: "planning_model", recoveryState: "none" })).toBe(false);
    expect(isFinishPendingState({ status: "executing_model", pendingToolApproval: {} })).toBe(true);
  });

  test("exposes a strict provider schema", () => {
    const schema = finishInputSchemaV2();
    expect(schema["additionalProperties"]).toBe(false);
    expect(schema["required"]).toEqual(["outcome", "report", "evidenceRefs"]);
  });
});
