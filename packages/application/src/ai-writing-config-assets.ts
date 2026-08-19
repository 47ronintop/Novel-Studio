import type { AgentConfig } from "@novel-studio/agent-engine";
import { ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";
import type { WorkflowDefinition } from "@novel-studio/workflow-engine";

import { aiWorkflowError } from "./ai-writing-workflow-validation.js";
import type { AiWritingWorkflowSessionOptions } from "./ai-writing-workflow-types.js";

export interface PromptTemplateConfig {
  readonly id: string;
  readonly template: string;
}

export interface ResolvedWritingAssets {
  readonly workflow: WorkflowDefinition;
  readonly selectionWorkflow: WorkflowDefinition;
  readonly chapterAgent: AgentConfig;
  readonly chapterPrompt: PromptTemplateConfig;
  readonly selectionAgent: AgentConfig;
  readonly selectionPrompt: PromptTemplateConfig;
}

const defaultWorkflowDefinition: WorkflowDefinition = {
  schemaVersion: "1.0",
  id: "wf_ai_continue_chapter",
  type: "workflow.definition",
  title: "Continue Chapter",
  status: "active",
  entryStepId: "build_context",
  steps: [
    { id: "build_context", kind: "context", nextStepId: "write_suggestion" },
    {
      id: "write_suggestion",
      kind: "agent",
      agentId: "agent_chapter_writer",
      nextStepId: "confirm_apply"
    },
    { id: "confirm_apply", kind: "confirmation" }
  ],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const defaultSelectionWorkflowDefinition: WorkflowDefinition = {
  schemaVersion: "1.0",
  id: "wf_ai_rewrite_selection",
  type: "workflow.definition",
  title: "Rewrite Selection",
  status: "active",
  entryStepId: "build_context",
  steps: [
    { id: "build_context", kind: "context", nextStepId: "rewrite_selection" },
    {
      id: "rewrite_selection",
      kind: "agent",
      agentId: "agent_selection_rewriter",
      nextStepId: "confirm_apply"
    },
    { id: "confirm_apply", kind: "confirmation" }
  ],
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const defaultChapterAgent: AgentConfig = {
  schemaVersion: "1.0",
  id: "agent_chapter_writer",
  type: "agent.config",
  title: "Chapter Writer",
  status: "active",
  agentRole: "writer",
  promptTemplateId: "prompt_continue_chapter",
  inputSchemaId: "schema.ai-writing.input.v1",
  outputSchemaId: "schema.ai-writing.output.v1",
  modelProfileId: "mock_m14",
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const defaultSelectionAgent: AgentConfig = {
  ...defaultChapterAgent,
  id: "agent_selection_rewriter",
  title: "Selection Rewriter",
  promptTemplateId: "prompt_rewrite_selection",
  inputSchemaId: "schema.ai-selection-preview.input.v1",
  outputSchemaId: "schema.ai-selection-preview.output.v1"
};

export async function resolveWritingAssets(
  options: AiWritingWorkflowSessionOptions
): Promise<Result<ResolvedWritingAssets, UnifiedError>> {
  const loader = options.configAssetLoader;
  if (loader === undefined) {
    return ok({
      workflow: defaultWorkflowDefinition,
      selectionWorkflow: defaultSelectionWorkflowDefinition,
      chapterAgent: defaultChapterAgent,
      chapterPrompt: {
        id: defaultChapterAgent.promptTemplateId,
        template: "Return JSON with proposedBody and summary for a chapter writing suggestion."
      },
      selectionAgent: defaultSelectionAgent,
      selectionPrompt: {
        id: defaultSelectionAgent.promptTemplateId,
        template: "Return JSON with proposedText and summary for a selected text rewrite."
      }
    });
  }

  const ids = options.configAssetIds;
  if (ids === undefined) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_CONFIG_ASSET_IDS_MISSING",
      message: "AI writing config asset ids are not configured.",
      suggestedAction: "Configure AI writing asset ids and retry."
    });
  }

  const workflow = await loadConfigAsset(loader, "workflow", ids.workflowId);
  if (!workflow.ok) return workflow;
  const selectionWorkflowId = ids.selectionWorkflowId;
  const selectionWorkflow = await loadConfigAsset(loader, "workflow", selectionWorkflowId);
  if (!selectionWorkflow.ok) return selectionWorkflow;
  const chapterAgent = await loadConfigAsset(loader, "agent", ids.chapterAgentId);
  if (!chapterAgent.ok) return chapterAgent;
  const chapterPrompt = await loadConfigAsset(loader, "prompt", ids.chapterPromptId);
  if (!chapterPrompt.ok) return chapterPrompt;
  const selectionAgent = await loadConfigAsset(loader, "agent", ids.selectionAgentId);
  if (!selectionAgent.ok) return selectionAgent;
  const selectionPrompt = await loadConfigAsset(loader, "prompt", ids.selectionPromptId);
  if (!selectionPrompt.ok) return selectionPrompt;

  const parsedWorkflow = parseAssetWorkflow(workflow.value);
  if (!parsedWorkflow.ok) return parsedWorkflow;
  const parsedSelectionWorkflow = parseAssetWorkflow(selectionWorkflow.value);
  if (!parsedSelectionWorkflow.ok) return parsedSelectionWorkflow;
  const parsedChapterAgent = parseAssetAgent(chapterAgent.value);
  if (!parsedChapterAgent.ok) return parsedChapterAgent;
  const parsedSelectionAgent = parseAssetAgent(selectionAgent.value);
  if (!parsedSelectionAgent.ok) return parsedSelectionAgent;
  const parsedChapterPrompt = parseAssetPrompt(chapterPrompt.value);
  if (!parsedChapterPrompt.ok) return parsedChapterPrompt;
  const parsedSelectionPrompt = parseAssetPrompt(selectionPrompt.value);
  if (!parsedSelectionPrompt.ok) return parsedSelectionPrompt;

  if (
    parsedWorkflow.value.id !== ids.workflowId ||
    parsedSelectionWorkflow.value.id !== selectionWorkflowId ||
    parsedChapterAgent.value.id !== ids.chapterAgentId ||
    parsedChapterPrompt.value.id !== ids.chapterPromptId ||
    parsedSelectionAgent.value.id !== ids.selectionAgentId ||
    parsedSelectionPrompt.value.id !== ids.selectionPromptId ||
    parsedChapterAgent.value.promptTemplateId !== parsedChapterPrompt.value.id ||
    parsedSelectionAgent.value.promptTemplateId !== parsedSelectionPrompt.value.id ||
    !parsedWorkflow.value.steps.some(
      (step) => step.kind === "agent" && step.agentId === parsedChapterAgent.value.id
    ) ||
    !parsedSelectionWorkflow.value.steps.some(
      (step) => step.kind === "agent" && step.agentId === parsedSelectionAgent.value.id
    )
  ) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_CONFIG_ASSET_INVALID",
      message: "Configured AI writing assets are not linked to their requested ids.",
      suggestedAction: "Align the workflow, agent, and prompt asset ids before retrying."
    });
  }

  return ok({
    workflow: parsedWorkflow.value,
    selectionWorkflow: parsedSelectionWorkflow.value,
    chapterAgent: parsedChapterAgent.value,
    chapterPrompt: parsedChapterPrompt.value,
    selectionAgent: parsedSelectionAgent.value,
    selectionPrompt: parsedSelectionPrompt.value
  });
}

async function loadConfigAsset(
  loader: NonNullable<AiWritingWorkflowSessionOptions["configAssetLoader"]>,
  assetType: "prompt" | "agent" | "workflow",
  assetId: string
): Promise<Result<JsonObject, UnifiedError>> {
  const loaded = await loader.loadConfigAsset(assetType, assetId);
  return loaded.ok
    ? loaded
    : aiWorkflowError({
        code: "AI_WORKFLOW_CONFIG_ASSET_MISSING",
        message: `AI writing ${assetType} asset could not be loaded.`,
        suggestedAction: "Restore the configured AI writing assets and retry."
      });
}

function parseAssetWorkflow(value: JsonObject): Result<WorkflowDefinition, UnifiedError> {
  return isRecordWithStrings(value, [
    "schemaVersion",
    "id",
    "type",
    "title",
    "status",
    "entryStepId",
    "createdAt",
    "updatedAt"
  ]) && Array.isArray(value.steps)
    ? ok(value as unknown as WorkflowDefinition)
    : aiWorkflowError({
        code: "AI_WORKFLOW_CONFIG_ASSET_INVALID",
        message: "Configured workflow asset is invalid.",
        suggestedAction: "Fix the workflow asset and retry."
      });
}

function parseAssetAgent(value: JsonObject): Result<AgentConfig, UnifiedError> {
  return isRecordWithStrings(value, [
    "schemaVersion",
    "id",
    "type",
    "title",
    "status",
    "agentRole",
    "promptTemplateId",
    "inputSchemaId",
    "outputSchemaId",
    "modelProfileId",
    "createdAt",
    "updatedAt"
  ])
    ? ok(value as unknown as AgentConfig)
    : aiWorkflowError({
        code: "AI_WORKFLOW_CONFIG_ASSET_INVALID",
        message: "Configured agent asset is invalid.",
        suggestedAction: "Fix the agent asset and retry."
      });
}

function parseAssetPrompt(value: JsonObject): Result<PromptTemplateConfig, UnifiedError> {
  return isRecordWithStrings(value, ["id", "template"])
    ? ok({ id: value.id as string, template: value.template as string })
    : aiWorkflowError({
        code: "AI_WORKFLOW_CONFIG_ASSET_INVALID",
        message: "Configured prompt asset is invalid.",
        suggestedAction: "Fix the prompt asset and retry."
      });
}

function isRecordWithStrings(value: JsonObject, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}
