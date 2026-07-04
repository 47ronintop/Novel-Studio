import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import {
  completeWorkflowStep,
  confirmWorkflowStep,
  evaluateNextWorkflowAction,
  parseWorkflowDefinition,
  startWorkflowRun
} from "../src/index.js";

const workflow = {
  schemaVersion: "1.0",
  id: "wf_review_chapter",
  type: "workflow.definition",
  title: "Review current chapter",
  status: "active",
  entryStepId: "step_build_context",
  steps: [
    {
      id: "step_build_context",
      kind: "context",
      nextStepId: "step_review"
    },
    {
      id: "step_review",
      kind: "agent",
      agentId: "agent_reviewer_default",
      nextStepId: "step_confirm"
    },
    {
      id: "step_confirm",
      kind: "confirmation",
      nextStepId: "step_save"
    },
    {
      id: "step_save",
      kind: "save"
    }
  ],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const runInput = {
  workflowRunId: "wfrun_01",
  traceId: "trace_workflow_01",
  now: () => "2026-07-04T00:00:00.000Z"
};

describe("Workflow Engine", () => {
  test("parses a valid workflow definition", () => {
    const result = parseWorkflowDefinition(workflow, { traceId: "trace_parse_01" });

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.id).toBe("wf_review_chapter");
    expect(result.value.steps.map((step) => step.id)).toEqual([
      "step_build_context",
      "step_review",
      "step_confirm",
      "step_save"
    ]);
  });

  test("rejects invalid entry step references", () => {
    const result = parseWorkflowDefinition(
      {
        ...workflow,
        entryStepId: "step_missing"
      },
      { traceId: "trace_parse_02" }
    );

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("WORKFLOW_STEP_NOT_FOUND");
    expect(result.error.category).toBe("WorkflowError");
  });

  test("rejects duplicate step ids and agent steps without agent ids", () => {
    const duplicateResult = parseWorkflowDefinition(
      {
        ...workflow,
        steps: [
          {
            id: "step_duplicate",
            kind: "context"
          },
          {
            id: "step_duplicate",
            kind: "save"
          }
        ]
      },
      { traceId: "trace_parse_03" }
    );
    const missingAgentResult = parseWorkflowDefinition(
      {
        ...workflow,
        steps: [
          {
            id: "step_agent",
            kind: "agent"
          }
        ],
        entryStepId: "step_agent"
      },
      { traceId: "trace_parse_04" }
    );

    expect(isErr(duplicateResult)).toBe(true);
    expect(isErr(missingAgentResult)).toBe(true);
    if (!duplicateResult.ok) {
      expect(duplicateResult.error.code).toBe("WORKFLOW_DUPLICATE_STEP");
    }
    if (!missingAgentResult.ok) {
      expect(missingAgentResult.error.code).toBe("WORKFLOW_AGENT_STEP_MISSING_AGENT");
    }
  });

  test("evaluates context and agent next actions without executing them", () => {
    const parsed = parseWorkflowDefinition(workflow, { traceId: "trace_parse_05" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const run = startWorkflowRun(parsed.value, runInput);
    const contextAction = evaluateNextWorkflowAction(parsed.value, run);
    const afterContext = completeWorkflowStep(parsed.value, run, {
      stepId: "step_build_context",
      traceId: "trace_complete_01",
      now: runInput.now
    });
    expect(afterContext.ok).toBe(true);
    if (!afterContext.ok) {
      return;
    }
    const agentAction = evaluateNextWorkflowAction(parsed.value, afterContext.value);

    expect(contextAction).toEqual({
      ok: true,
      value: {
        kind: "build-context",
        workflowRunId: "wfrun_01",
        stepId: "step_build_context",
        nextStepId: "step_review"
      }
    });
    expect(agentAction).toEqual({
      ok: true,
      value: {
        kind: "run-agent",
        workflowRunId: "wfrun_01",
        stepId: "step_review",
        agentId: "agent_reviewer_default",
        nextStepId: "step_confirm"
      }
    });
  });

  test("enforces confirmation before save can run", () => {
    const parsed = parseWorkflowDefinition(workflow, { traceId: "trace_parse_06" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const run = startWorkflowRun(parsed.value, runInput);
    const afterContext = completeWorkflowStep(parsed.value, run, {
      stepId: "step_build_context",
      traceId: "trace_complete_02",
      now: runInput.now
    });
    expect(afterContext.ok).toBe(true);
    if (!afterContext.ok) {
      return;
    }
    const afterAgent = completeWorkflowStep(parsed.value, afterContext.value, {
      stepId: "step_review",
      traceId: "trace_complete_03",
      now: runInput.now
    });
    expect(afterAgent.ok).toBe(true);
    if (!afterAgent.ok) {
      return;
    }

    const confirmationAction = evaluateNextWorkflowAction(parsed.value, afterAgent.value);
    const blocked = completeWorkflowStep(parsed.value, afterAgent.value, {
      stepId: "step_confirm",
      traceId: "trace_complete_04",
      now: runInput.now
    });
    const confirmed = confirmWorkflowStep(parsed.value, afterAgent.value, {
      stepId: "step_confirm",
      traceId: "trace_confirm_01",
      now: runInput.now
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    const afterConfirmation = completeWorkflowStep(parsed.value, confirmed.value, {
      stepId: "step_confirm",
      traceId: "trace_complete_05",
      now: runInput.now
    });

    expect(confirmationAction).toEqual({
      ok: true,
      value: {
        kind: "wait-for-confirmation",
        workflowRunId: "wfrun_01",
        stepId: "step_confirm",
        nextStepId: "step_save"
      }
    });
    expect(isErr(blocked)).toBe(true);
    if (!blocked.ok) {
      expect(blocked.error.code).toBe("WORKFLOW_CONFIRMATION_REQUIRED");
    }
    expect(afterConfirmation).toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        workflowRunId: "wfrun_01",
        workflowId: "wf_review_chapter",
        status: "running",
        currentStepId: "step_save",
        completedStepIds: ["step_build_context", "step_review", "step_confirm"],
        confirmedStepIds: ["step_confirm"],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    });
  });

  test("completes the workflow after the final save step", () => {
    const parsed = parseWorkflowDefinition(
      {
        ...workflow,
        entryStepId: "step_save",
        steps: [
          {
            id: "step_save",
            kind: "save"
          }
        ]
      },
      { traceId: "trace_parse_07" }
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const run = startWorkflowRun(parsed.value, runInput);
    const saveAction = evaluateNextWorkflowAction(parsed.value, run);
    const completed = completeWorkflowStep(parsed.value, run, {
      stepId: "step_save",
      traceId: "trace_complete_06",
      now: runInput.now
    });

    expect(saveAction).toEqual({
      ok: true,
      value: {
        kind: "save",
        workflowRunId: "wfrun_01",
        stepId: "step_save",
        nextStepId: null
      }
    });
    expect(completed).toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        workflowRunId: "wfrun_01",
        workflowId: "wf_review_chapter",
        status: "completed",
        currentStepId: null,
        completedStepIds: ["step_save"],
        confirmedStepIds: [],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    });
  });

  test("does not depend on Agent, Context, LLM Adapter, or Repository packages", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies ?? {}).toEqual({
      "@novel-studio/shared": "0.1.0"
    });
  });
});
