import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { createUnifiedError, isErr, isOk } from "@novel-studio/shared";
import {
  createLlmAdapter,
  createMockProvider,
  type LlmAdapter,
  type LlmRequest
} from "@novel-studio/llm-adapter";
import type { ContextBundle } from "@novel-studio/context-engine";

import { runAgent, type AgentConfig, type AgentSchemaValidator } from "../src/index.js";

const agent = {
  schemaVersion: "1.0",
  id: "agent_reviewer_default",
  type: "agent.config",
  title: "Default Reviewer Agent",
  status: "active",
  agentRole: "reviewer",
  promptTemplateId: "prompt_reviewer_default",
  inputSchemaId: "schema.agent.reviewer.input.v1",
  outputSchemaId: "schema.agent.reviewer.output.v1",
  modelProfileId: "model_default",
  createdAt: "2026-07-04T00:00:00.000Z",
  updatedAt: "2026-07-04T00:00:00.000Z"
} satisfies AgentConfig;

const contextBundle = {
  schemaVersion: "1.0",
  contextBundleId: "ctx_agent_01",
  workflowRunId: "wfrun_01",
  budget: {
    maxTokens: 1000,
    estimatedTokens: 12
  },
  items: [
    {
      refType: "chapter",
      refId: "ch_01",
      content: "The rain kept its own counsel.",
      tokenEstimate: 8,
      sourceRefs: [
        {
          entityType: "chapter",
          entityId: "ch_01",
          range: {
            startLine: 1,
            endLine: 2
          }
        }
      ]
    }
  ],
  trace: {
    selectionReason: "review current chapter",
    includedRefs: [{ refType: "chapter", refId: "ch_01", tokenEstimate: 8 }],
    excludedRefs: []
  }
} satisfies ContextBundle;

const llmRequest = {
  schemaVersion: "1.0",
  requestId: "llmreq_agent_01",
  traceId: "trace_agent_01",
  mode: "non-streaming",
  modelProfile: {
    id: "model_mock",
    provider: "mock",
    displayName: "Mock Model",
    modelName: "mock-agent"
  },
  messages: [
    {
      role: "system",
      content: "Use the configured reviewer prompt."
    },
    {
      role: "user",
      content: "Return structured review JSON."
    }
  ],
  parameters: {
    temperature: 0.2,
    maxTokens: 256,
    topP: 1
  },
  responseFormat: {
    type: "json_object"
  }
} satisfies LlmRequest;

const validInput = {
  chapterId: "ch_01",
  goal: "Review current chapter"
};

const validOutput = {
  summary: "Continuity is stable.",
  severity: "low"
};

const acceptingValidator: AgentSchemaValidator = () => {
  return { valid: true };
};

describe("Agent Engine", () => {
  test("validates input, calls the LLM Adapter, validates output, and returns handoff JSON", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "json",
              value: validOutput
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });
    const validatedSchemaIds: string[] = [];
    const validator: AgentSchemaValidator = (input) => {
      validatedSchemaIds.push(input.schemaId);
      return { valid: true };
    };

    const result = await runAgent({
      schemaVersion: "1.0",
      agentRunId: "agentrun_01",
      handoffId: "handoff_agent_01",
      workflowRunId: "wfrun_01",
      traceId: "trace_agent_01",
      agent,
      toAgentId: "agent_writer_default",
      input: validInput,
      contextBundle,
      llmRequest,
      llmAdapter: adapter,
      validateSchema: validator,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(validatedSchemaIds).toEqual([
      "schema.agent.reviewer.input.v1",
      "schema.agent.reviewer.output.v1"
    ]);
    expect(result.value).toEqual({
      schemaVersion: "1.0",
      handoffId: "handoff_agent_01",
      fromAgentId: "agent_reviewer_default",
      toAgentId: "agent_writer_default",
      workflowRunId: "wfrun_01",
      payloadType: "schema.agent.reviewer.output.v1",
      payload: validOutput,
      createdAt: "2026-07-04T00:00:00.000Z"
    });
  });

  test("stops before model call when agent input validation fails", async () => {
    let calls = 0;
    const adapter: LlmAdapter = {
      async complete() {
        calls += 1;
        return {
          ok: false,
          error: createUnifiedError({
            code: "LLM_PROVIDER_ERROR",
            category: "LLMAdapterError",
            message: "unused",
            recoverability: "retryable",
            suggestedAction: "unused",
            traceId: "trace_agent_02"
          })
        };
      },
      stream() {
        throw new Error("stream unused");
      }
    };

    const result = await runAgent({
      schemaVersion: "1.0",
      agentRunId: "agentrun_02",
      handoffId: "handoff_agent_02",
      workflowRunId: "wfrun_01",
      traceId: "trace_agent_02",
      agent,
      toAgentId: "agent_writer_default",
      input: validInput,
      contextBundle,
      llmRequest,
      llmAdapter: adapter,
      validateSchema: () => ({ valid: false }),
      now: () => "2026-07-04T00:00:00.000Z"
    });

    expect(calls).toBe(0);
    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("AGENT_INPUT_INVALID");
    expect(result.error.category).toBe("AgentError");
  });

  test("normalizes LLM Adapter failures as agent model call failures", async () => {
    const adapter: LlmAdapter = {
      async complete() {
        return {
          ok: false,
          error: createUnifiedError({
            code: "LLM_RATE_LIMITED",
            category: "LLMAdapterError",
            message: "Rate limited.",
            recoverability: "retryable",
            suggestedAction: "Retry later.",
            traceId: "trace_agent_03"
          })
        };
      },
      stream() {
        throw new Error("stream unused");
      }
    };

    const result = await runAgent({
      schemaVersion: "1.0",
      agentRunId: "agentrun_03",
      handoffId: "handoff_agent_03",
      workflowRunId: "wfrun_01",
      traceId: "trace_agent_03",
      agent,
      toAgentId: "agent_writer_default",
      input: validInput,
      contextBundle,
      llmRequest,
      llmAdapter: adapter,
      validateSchema: acceptingValidator,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("AGENT_MODEL_CALL_FAILED");
    expect(result.error.redactedDetail).toEqual({
      llmCode: "LLM_RATE_LIMITED"
    });
  });

  test("fails safely when the model returns malformed JSON text", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "text",
              value: "{not-json"
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await runAgent({
      schemaVersion: "1.0",
      agentRunId: "agentrun_04",
      handoffId: "handoff_agent_04",
      workflowRunId: "wfrun_01",
      traceId: "trace_agent_04",
      agent,
      toAgentId: "agent_writer_default",
      input: validInput,
      contextBundle,
      llmRequest,
      llmAdapter: adapter,
      validateSchema: acceptingValidator,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("AGENT_OUTPUT_MALFORMED");
    expect(JSON.stringify(result.error)).not.toContain("{not-json");
  });

  test("rejects model output that fails the output schema validator", async () => {
    const adapter = createLlmAdapter({
      provider: createMockProvider({
        completions: [
          {
            type: "success",
            content: {
              type: "json",
              value: validOutput
            }
          }
        ]
      }),
      clock: () => "2026-07-04T00:00:00.000Z"
    });
    const validator: AgentSchemaValidator = (input) => {
      if (input.schemaId === agent.outputSchemaId) {
        return {
          valid: false,
          redactedDetail: {
            missingField: "patches"
          }
        };
      }
      return { valid: true };
    };

    const result = await runAgent({
      schemaVersion: "1.0",
      agentRunId: "agentrun_05",
      handoffId: "handoff_agent_05",
      workflowRunId: "wfrun_01",
      traceId: "trace_agent_05",
      agent,
      toAgentId: "agent_writer_default",
      input: validInput,
      contextBundle,
      llmRequest,
      llmAdapter: adapter,
      validateSchema: validator,
      now: () => "2026-07-04T00:00:00.000Z"
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("AGENT_OUTPUT_INVALID");
    expect(result.error.redactedDetail).toEqual({
      schemaId: "schema.agent.reviewer.output.v1",
      missingField: "patches"
    });
  });

  test("does not depend on Repository, UI, Electron, Application, or Service packages", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = packageJson.dependencies ?? {};

    expect(dependencies).toEqual({
      "@novel-studio/context-engine": "0.1.0",
      "@novel-studio/llm-adapter": "0.1.0",
      "@novel-studio/shared": "0.1.0"
    });
    expect(Object.keys(dependencies)).not.toContain("@novel-studio/repository");
    expect(Object.keys(dependencies)).not.toContain("@novel-studio/ui");
    expect(Object.keys(dependencies)).not.toContain("@novel-studio/application");
  });
});
