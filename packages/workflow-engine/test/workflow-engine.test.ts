import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import {
  chooseWorkflowBranch,
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

  test("evaluates branch actions and advances through the selected branch", () => {
    const branchedWorkflow = {
      ...workflow,
      entryStepId: "step_build_context",
      steps: [
        {
          id: "step_build_context",
          kind: "context",
          nextStepId: "step_branch"
        },
        {
          id: "step_branch",
          kind: "branch",
          branches: [
            {
              id: "needs_revision",
              label: "Needs revision",
              condition: "review.severity >= medium",
              nextStepId: "step_rewrite"
            },
            {
              id: "ready_to_save",
              label: "Ready to save",
              condition: "review.severity < medium",
              nextStepId: "step_save"
            }
          ],
          defaultNextStepId: "step_save"
        },
        {
          id: "step_rewrite",
          kind: "agent",
          agentId: "agent_writer_default",
          nextStepId: "step_save"
        },
        {
          id: "step_save",
          kind: "save"
        }
      ]
    };
    const parsed = parseWorkflowDefinition(branchedWorkflow, { traceId: "trace_branch_01" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const run = startWorkflowRun(parsed.value, runInput);
    const afterContext = completeWorkflowStep(parsed.value, run, {
      stepId: "step_build_context",
      traceId: "trace_branch_02",
      now: runInput.now
    });
    expect(afterContext.ok).toBe(true);
    if (!afterContext.ok) {
      return;
    }

    const branchAction = evaluateNextWorkflowAction(parsed.value, afterContext.value);
    const afterBranch = chooseWorkflowBranch(parsed.value, afterContext.value, {
      stepId: "step_branch",
      branchId: "needs_revision",
      traceId: "trace_branch_03",
      now: runInput.now
    });

    expect(branchAction).toEqual({
      ok: true,
      value: {
        kind: "choose-branch",
        workflowRunId: "wfrun_01",
        stepId: "step_branch",
        branches: [
          {
            id: "needs_revision",
            label: "Needs revision",
            condition: "review.severity >= medium",
            nextStepId: "step_rewrite"
          },
          {
            id: "ready_to_save",
            label: "Ready to save",
            condition: "review.severity < medium",
            nextStepId: "step_save"
          }
        ],
        defaultNextStepId: "step_save"
      }
    });
    expect(afterBranch).toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        workflowRunId: "wfrun_01",
        workflowId: "wf_review_chapter",
        status: "running",
        currentStepId: "step_rewrite",
        completedStepIds: ["step_build_context", "step_branch"],
        confirmedStepIds: [],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    });
  });

  test("rejects branch steps with missing branch targets", () => {
    const parsed = parseWorkflowDefinition(
      {
        ...workflow,
        entryStepId: "step_branch",
        steps: [
          {
            id: "step_branch",
            kind: "branch",
            branches: [
              {
                id: "missing_target",
                label: "Missing target",
                condition: "always",
                nextStepId: "step_missing"
              }
            ]
          }
        ]
      },
      { traceId: "trace_branch_04" }
    );

    expect(isErr(parsed)).toBe(true);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("WORKFLOW_STEP_NOT_FOUND");
    }
  });

  test("rejects direct completion of branch steps without branch selection", () => {
    const parsed = parseWorkflowDefinition(
      {
        ...workflow,
        entryStepId: "step_branch",
        steps: [
          {
            id: "step_branch",
            kind: "branch",
            branches: [
              {
                id: "save",
                label: "Save",
                condition: "always",
                nextStepId: "step_save"
              }
            ]
          },
          {
            id: "step_save",
            kind: "save"
          }
        ]
      },
      { traceId: "trace_branch_05" }
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const run = startWorkflowRun(parsed.value, runInput);
    const completed = completeWorkflowStep(parsed.value, run, {
      stepId: "step_branch",
      traceId: "trace_branch_06",
      now: runInput.now
    });

    expect(isErr(completed)).toBe(true);
    if (!completed.ok) {
      expect(completed.error.code).toBe("WORKFLOW_BRANCH_CHOICE_REQUIRED");
    }
  });

  test("evaluates plugin workflow steps without executing plugin code", () => {
    const pluginWorkflow = {
      ...workflow,
      entryStepId: "step_plugin",
      steps: [
        {
          id: "step_plugin",
          kind: "plugin",
          pluginId: "novel.structure-tools",
          contributionId: "outline.score",
          nextStepId: "step_save"
        },
        {
          id: "step_save",
          kind: "save"
        }
      ]
    };
    const parsed = parseWorkflowDefinition(pluginWorkflow, { traceId: "trace_plugin_01" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }

    const run = startWorkflowRun(parsed.value, runInput);
    const pluginAction = evaluateNextWorkflowAction(parsed.value, run);
    const afterPlugin = completeWorkflowStep(parsed.value, run, {
      stepId: "step_plugin",
      traceId: "trace_plugin_02",
      now: runInput.now
    });

    expect(pluginAction).toEqual({
      ok: true,
      value: {
        kind: "run-plugin-step",
        workflowRunId: "wfrun_01",
        stepId: "step_plugin",
        pluginId: "novel.structure-tools",
        contributionId: "outline.score",
        nextStepId: "step_save"
      }
    });
    expect(afterPlugin).toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        workflowRunId: "wfrun_01",
        workflowId: "wf_review_chapter",
        status: "running",
        currentStepId: "step_save",
        completedStepIds: ["step_plugin"],
        confirmedStepIds: [],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    });
  });

  test("rejects plugin workflow steps without plugin contribution identifiers", () => {
    const parsed = parseWorkflowDefinition(
      {
        ...workflow,
        entryStepId: "step_plugin",
        steps: [
          {
            id: "step_plugin",
            kind: "plugin",
            pluginId: "novel.structure-tools"
          }
        ]
      },
      { traceId: "trace_plugin_03" }
    );

    expect(isErr(parsed)).toBe(true);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("WORKFLOW_PLUGIN_STEP_INVALID");
    }
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
