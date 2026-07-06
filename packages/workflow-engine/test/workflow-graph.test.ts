import { describe, expect, test } from "vitest";

import {
  applyWorkflowNodeInspectorEdit,
  buildWorkflowGraphViewModel,
  validateWorkflowGraph,
  type WorkflowDefinition
} from "../src/index.js";
import { isErr, isOk } from "@novel-studio/shared";

const graphWorkflow: WorkflowDefinition = {
  schemaVersion: "1.0",
  id: "wf_graph",
  type: "workflow.definition",
  title: "Graph workflow",
  status: "active",
  entryStepId: "context",
  steps: [
    {
      id: "context",
      kind: "context",
      nextStepId: "branch"
    },
    {
      id: "branch",
      kind: "branch",
      branches: [
        {
          id: "revise",
          label: "Revise",
          condition: "needs revision",
          nextStepId: "writer"
        },
        {
          id: "plugin",
          label: "Plugin",
          condition: "needs plugin scoring",
          nextStepId: "plugin_score"
        }
      ],
      defaultNextStepId: "save"
    },
    {
      id: "writer",
      kind: "agent",
      agentId: "agent_writer",
      nextStepId: "save"
    },
    {
      id: "plugin_score",
      kind: "plugin",
      pluginId: "novel.structure-tools",
      contributionId: "outline.score",
      nextStepId: "save"
    },
    {
      id: "save",
      kind: "save"
    }
  ],
  createdAt: "2026-07-06T00:00:00.000Z",
  updatedAt: "2026-07-06T00:00:00.000Z"
};

describe("Workflow graph projection", () => {
  test("projects workflow steps into graph nodes and edges", () => {
    const graph = buildWorkflowGraphViewModel(graphWorkflow);

    expect(graph.workflowId).toBe("wf_graph");
    expect(graph.entryNodeId).toBe("context");
    expect(graph.nodes).toEqual([
      {
        id: "context",
        stepId: "context",
        kind: "context",
        label: "context",
        metadata: {}
      },
      {
        id: "branch",
        stepId: "branch",
        kind: "branch",
        label: "branch",
        metadata: { branchCount: 2, defaultNextStepId: "save" }
      },
      {
        id: "writer",
        stepId: "writer",
        kind: "agent",
        label: "writer",
        metadata: { agentId: "agent_writer" }
      },
      {
        id: "plugin_score",
        stepId: "plugin_score",
        kind: "plugin",
        label: "plugin_score",
        metadata: {
          pluginId: "novel.structure-tools",
          contributionId: "outline.score"
        }
      },
      {
        id: "save",
        stepId: "save",
        kind: "save",
        label: "save",
        metadata: {}
      }
    ]);
    expect(graph.edges).toEqual([
      {
        id: "context:next:branch",
        fromNodeId: "context",
        toNodeId: "branch",
        kind: "next"
      },
      {
        id: "branch:branch:revise",
        fromNodeId: "branch",
        toNodeId: "writer",
        kind: "branch",
        label: "Revise",
        branchId: "revise",
        condition: "needs revision"
      },
      {
        id: "branch:branch:plugin",
        fromNodeId: "branch",
        toNodeId: "plugin_score",
        kind: "branch",
        label: "Plugin",
        branchId: "plugin",
        condition: "needs plugin scoring"
      },
      {
        id: "branch:default:save",
        fromNodeId: "branch",
        toNodeId: "save",
        kind: "default"
      },
      {
        id: "writer:next:save",
        fromNodeId: "writer",
        toNodeId: "save",
        kind: "next"
      },
      {
        id: "plugin_score:next:save",
        fromNodeId: "plugin_score",
        toNodeId: "save",
        kind: "next"
      }
    ]);
  });

  test("validates a structurally healthy graph", () => {
    expect(validateWorkflowGraph(graphWorkflow)).toEqual({
      status: "valid",
      issues: []
    });
  });

  test("reports invalid edges, unreachable nodes, and missing required metadata", () => {
    const invalidWorkflow: WorkflowDefinition = {
      ...graphWorkflow,
      steps: [
        {
          id: "context",
          kind: "context",
          nextStepId: "missing"
        },
        {
          id: "agent_missing",
          kind: "agent"
        },
        {
          id: "branch_empty",
          kind: "branch",
          branches: []
        },
        {
          id: "plugin_missing",
          kind: "plugin",
          pluginId: "novel.structure-tools"
        }
      ]
    };

    expect(validateWorkflowGraph(invalidWorkflow)).toEqual({
      status: "invalid",
      issues: [
        {
          code: "WORKFLOW_GRAPH_EDGE_TARGET_MISSING",
          severity: "error",
          stepId: "context",
          message: "Workflow edge points to a missing step.",
          targetStepId: "missing"
        },
        {
          code: "WORKFLOW_GRAPH_NODE_UNREACHABLE",
          severity: "error",
          stepId: "agent_missing",
          message: "Workflow step is not reachable from the entry step."
        },
        {
          code: "WORKFLOW_GRAPH_AGENT_MISSING",
          severity: "error",
          stepId: "agent_missing",
          message: "Agent workflow node is missing agentId."
        },
        {
          code: "WORKFLOW_GRAPH_NODE_UNREACHABLE",
          severity: "error",
          stepId: "branch_empty",
          message: "Workflow step is not reachable from the entry step."
        },
        {
          code: "WORKFLOW_GRAPH_BRANCH_EMPTY",
          severity: "error",
          stepId: "branch_empty",
          message: "Branch workflow node must declare at least one branch."
        },
        {
          code: "WORKFLOW_GRAPH_NODE_UNREACHABLE",
          severity: "error",
          stepId: "plugin_missing",
          message: "Workflow step is not reachable from the entry step."
        },
        {
          code: "WORKFLOW_GRAPH_PLUGIN_MISSING",
          severity: "error",
          stepId: "plugin_missing",
          message: "Plugin workflow node is missing pluginId or contributionId."
        }
      ]
    });
  });

  test("applies structured inspector edits to workflow nodes without executing the workflow", () => {
    const edited = applyWorkflowNodeInspectorEdit(graphWorkflow, {
      stepId: "writer",
      agentId: "agent_reviewer",
      nextStepId: "plugin_score",
      updatedAt: "2026-07-06T01:00:00.000Z"
    });

    expect(isOk(edited)).toBe(true);
    if (!edited.ok) {
      return;
    }
    expect(edited.value.updatedAt).toBe("2026-07-06T01:00:00.000Z");
    expect(edited.value.steps.find((step) => step.id === "writer")).toEqual({
      id: "writer",
      kind: "agent",
      agentId: "agent_reviewer",
      nextStepId: "plugin_score"
    });
    expect(validateWorkflowGraph(edited.value).status).toBe("valid");
  });

  test("returns a stable error when inspector edits target a missing node", () => {
    const edited = applyWorkflowNodeInspectorEdit(graphWorkflow, {
      stepId: "missing",
      agentId: "agent_reviewer",
      updatedAt: "2026-07-06T01:00:00.000Z"
    });

    expect(isErr(edited)).toBe(true);
    if (edited.ok) {
      return;
    }
    expect(edited.error.code).toBe("WORKFLOW_STEP_NOT_FOUND");
  });
});
