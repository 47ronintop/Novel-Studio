import type { LlmContent } from "@novel-studio/llm-adapter";
import {
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { agentError } from "./errors.js";
import type { AgentHandoff, AgentRunInput } from "./types.js";

export async function runAgent(input: AgentRunInput): Promise<Result<AgentHandoff, UnifiedError>> {
  if (input.agent.status !== "active") {
    return err(
      agentError({
        code: "AGENT_CONFIG_INVALID",
        message: "Only active agents can run.",
        suggestedAction: "Activate the agent configuration before running it.",
        traceId: input.traceId,
        redactedDetail: { agentId: input.agent.id, status: input.agent.status }
      })
    );
  }

  const inputValidation = input.validateSchema({
    schemaId: input.agent.inputSchemaId,
    value: input.input,
    traceId: input.traceId
  });
  if (!inputValidation.valid) {
    return err(
      agentError({
        code: "AGENT_INPUT_INVALID",
        message: "Agent input did not satisfy the configured input schema.",
        suggestedAction: "Fix the agent input payload before running this agent.",
        traceId: input.traceId,
        redactedDetail: mergeDetail(
          { schemaId: input.agent.inputSchemaId },
          inputValidation.redactedDetail
        )
      })
    );
  }

  const llmResult = await input.llmAdapter.complete(input.llmRequest);
  if (!llmResult.ok) {
    return err(
      agentError({
        code: "AGENT_MODEL_CALL_FAILED",
        message: "The agent model call failed.",
        suggestedAction: "Inspect the model profile and retry the workflow step.",
        traceId: input.traceId,
        redactedDetail: { llmCode: llmResult.error.code }
      })
    );
  }

  const outputResult = extractStructuredOutput(llmResult.value.content, input.traceId);
  if (!outputResult.ok) {
    return outputResult;
  }

  const outputValidation = input.validateSchema({
    schemaId: input.agent.outputSchemaId,
    value: outputResult.value,
    traceId: input.traceId
  });
  if (!outputValidation.valid) {
    return err(
      agentError({
        code: "AGENT_OUTPUT_INVALID",
        message: "Agent output did not satisfy the configured output schema.",
        suggestedAction: "Retry the agent or adjust the output schema and prompt configuration.",
        traceId: input.traceId,
        redactedDetail: mergeDetail(
          { schemaId: input.agent.outputSchemaId },
          outputValidation.redactedDetail
        )
      })
    );
  }

  return ok({
    schemaVersion: "1.0",
    handoffId: input.handoffId,
    fromAgentId: input.agent.id,
    toAgentId: input.toAgentId,
    workflowRunId: input.workflowRunId,
    payloadType: input.agent.outputSchemaId,
    payload: outputResult.value,
    model: {
      provider: llmResult.value.provider,
      modelName: llmResult.value.modelName
    },
    usage: llmResult.value.usage,
    ...(llmResult.value.warnings === undefined ? {} : { warnings: llmResult.value.warnings }),
    createdAt: input.now()
  });
}

function extractStructuredOutput(
  content: LlmContent,
  traceId: string
): Result<JsonObject, UnifiedError> {
  if (content.type === "json") {
    return isJsonObject(content.value)
      ? ok(content.value)
      : err(malformedOutput(traceId, "Model JSON output must be an object."));
  }

  try {
    const parsed = JSON.parse(content.value) as JsonValue;
    return isJsonObject(parsed)
      ? ok(parsed)
      : err(malformedOutput(traceId, "Model text output JSON must be an object."));
  } catch {
    return err(malformedOutput(traceId, "Model text output was not valid JSON."));
  }
}

function malformedOutput(traceId: string, message: string): UnifiedError {
  return agentError({
    code: "AGENT_OUTPUT_MALFORMED",
    message,
    suggestedAction: "Retry the agent with a structured output capable model profile.",
    traceId
  });
}

function mergeDetail(base: JsonObject, detail: JsonObject | undefined): JsonObject {
  return detail === undefined ? base : { ...base, ...detail };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
