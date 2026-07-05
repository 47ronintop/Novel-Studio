import { describe, expect, test } from "vitest";

import { createAgentBackedAiWritingWorkflowSession } from "../src/ai-writing-workflow-session.js";
import type { WorkflowRunRecord } from "../src/ai-writing-workflow-session.js";
import { createChapterEditorSession } from "../src/chapter-editor-session.js";
import { createLlmAdapter, createMockProvider } from "@novel-studio/llm-adapter";
import type { LlmProvider, LlmRequest } from "@novel-studio/llm-adapter";
import { isErr, isOk, ok, type ChapterDocument } from "@novel-studio/shared";
import type { ChapterDraftRepositoryPort } from "../src/chapter-editor-session.js";

const originalChapter = {
  frontmatter: {
    schemaVersion: "1.0",
    id: "ch_m14",
    type: "chapter",
    title: "M14",
    order: 1,
    status: "draft",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z"
  },
  body: "Opening line.\n"
} satisfies ChapterDocument;

const proposedBody = "Opening line.\nAI continuation.\n";

describe("M14 AI writing workflow session", () => {
  test("generates a preview-only suggestion and applies it only after confirmation", async () => {
    const writes: ChapterDocument[] = [];
    const workflowRunRecords: WorkflowRunRecord[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository(writes),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createMockProvider({
          completions: [
            {
              type: "success",
              content: {
                type: "json",
                value: {
                  proposedBody,
                  summary: "Continues the current scene."
                }
              }
            }
          ]
        }),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_m14",
      createSuggestionId: () => "sug_m14",
      createAgentRunId: () => "agentrun_m14",
      createHandoffId: () => "handoff_m14",
      workflowRunHistory: {
        async recordWorkflowRun(record) {
          workflowRunRecords.push(record);
          return ok(record);
        }
      }
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "Continue the chapter."
    });

    expect(isOk(generated)).toBe(true);
    if (isErr(generated)) {
      throw new Error(generated.error.message);
    }
    expect(generated.value).toMatchObject({
      suggestionId: "sug_m14",
      workflowRunId: "wfrun_m14",
      status: "pending-confirmation",
      proposedBody,
      summary: "Continues the current scene."
    });
    expect(generated.value.diffPreview.changes).toEqual([
      {
        kind: "replace",
        value: proposedBody
      }
    ]);
    expect(generated.value.contextTrace.includedRefs).toEqual([
      {
        refType: "chapter",
        refId: "ch_m14",
        tokenEstimate: 4
      }
    ]);
    expect(generated.value.observability).toMatchObject({
      workflowRunId: "wfrun_m14",
      workflowTitle: "Continue Chapter",
      context: {
        sourceCount: 1,
        tokenEstimate: 4,
        selectionReason: "Continue the chapter."
      },
      model: {
        profileId: "mock_m14",
        provider: "mock",
        modelName: "mock-writer"
      },
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        usageStatus: "missing"
      },
      steps: [
        {
          stepId: "build_context",
          label: "构建上下文",
          kind: "context",
          status: "completed"
        },
        {
          stepId: "write_suggestion",
          label: "运行写作 Agent",
          kind: "agent",
          status: "completed"
        },
        {
          stepId: "confirm_apply",
          label: "等待用户确认",
          kind: "confirmation",
          status: "waiting-confirmation"
        }
      ]
    });
    expect(chapterSession.getState()?.chapter.body).toBe("Opening line.\n");
    expect(chapterSession.getState()?.dirty).toBe(false);
    expect(writes).toEqual([]);
    expect(workflowRunRecords).toEqual([
      expect.objectContaining({
        schemaVersion: "1.0",
        workflowRunId: "wfrun_m14",
        workflowId: "wf_ai_continue_chapter",
        workflowTitle: "Continue Chapter",
        status: "pending-confirmation",
        startedAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z",
        context: {
          sourceCount: 1,
          tokenEstimate: 4,
          selectionReason: "Continue the chapter."
        },
        model: {
          profileId: "mock_m14",
          displayName: "M14 Mock Writer",
          provider: "mock",
          modelName: "mock-writer"
        },
        usage: expect.objectContaining({
          totalTokens: 0,
          usageStatus: "missing"
        }),
        steps: expect.arrayContaining([
          expect.objectContaining({
            stepId: "confirm_apply",
            status: "waiting-confirmation"
          })
        ])
      })
    ]);

    const applied = aiWorkflow.applyChapterSuggestion("sug_m14");

    expect(isOk(applied)).toBe(true);
    if (isErr(applied)) {
      throw new Error(applied.error.message);
    }
    expect(applied.value.state.chapter.body).toBe(proposedBody);
    expect(applied.value.state.dirty).toBe(true);
    expect(applied.value.state.saveStatus).toBe("Unsaved");
    expect(writes).toEqual([]);
  });

  test("uses the configured default model profile for the agent LLM request", async () => {
    const requests: LlmRequest[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository([]),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createCapturingProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      modelProfile: {
        id: "model_openai_compatible",
        provider: "openai-compatible",
        displayName: "OpenAI Compatible",
        baseUrl: "https://api.example.com/v1",
        apiKeyRef: "secret://model_openai_compatible/api_key",
        modelName: "example-model",
        timeoutMs: 60000,
        tokenPricing: {
          inputPerMillion: 2,
          outputPerMillion: 8,
          currency: "USD"
        }
      },
      parameters: {
        temperature: 0.4,
        maxTokens: 2048,
        topP: 0.9
      },
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_m15",
      createSuggestionId: () => "sug_m15",
      createAgentRunId: () => "agentrun_m15",
      createHandoffId: () => "handoff_m15"
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "Continue with the selected profile."
    });

    expect(isOk(generated)).toBe(true);
    expect(requests[0]?.modelProfile).toEqual({
      id: "model_openai_compatible",
      provider: "openai-compatible",
      displayName: "OpenAI Compatible",
      baseUrl: "https://api.example.com/v1",
      apiKeyRef: "secret://model_openai_compatible/api_key",
      modelName: "example-model",
      timeoutMs: 60000,
      tokenPricing: {
        inputPerMillion: 2,
        outputPerMillion: 8,
        currency: "USD"
      }
    });
    expect(requests[0]?.parameters).toEqual({
      temperature: 0.4,
      maxTokens: 2048,
      topP: 0.9
    });
  });

  test("resolves the runtime model profile when generating a suggestion", async () => {
    const requests: LlmRequest[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository([]),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createCapturingProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      resolveModelRuntimeProfile: async () =>
        ok({
          modelProfile: {
            id: "model_ollama",
            provider: "ollama",
            displayName: "Local Ollama",
            baseUrl: "http://localhost:11434/v1",
            apiKeyRef: "secret://model_ollama/api_key",
            modelName: "llama3.1",
            timeoutMs: 30000
          },
          parameters: {
            temperature: 0.2,
            maxTokens: 1024
          }
        }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_m15_resolved",
      createSuggestionId: () => "sug_m15_resolved",
      createAgentRunId: () => "agentrun_m15_resolved",
      createHandoffId: () => "handoff_m15_resolved"
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "Continue with resolved profile."
    });

    expect(isOk(generated)).toBe(true);
    expect(requests[0]?.modelProfile.id).toBe("model_ollama");
    if (isErr(generated)) {
      throw new Error(generated.error.message);
    }
    expect(generated.value.observability.model).toEqual({
      profileId: "model_ollama",
      displayName: "Local Ollama",
      provider: "ollama",
      modelName: "llama3.1"
    });
    expect(requests[0]?.parameters).toEqual({
      temperature: 0.2,
      maxTokens: 1024
    });
  });

  test("records a failed workflow run with redacted diagnostics when the model call fails", async () => {
    const workflowRunRecords: WorkflowRunRecord[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository([]),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createMockProvider({
          completions: [
            {
              type: "error",
              code: "LLM_RATE_LIMITED",
              message: "Provider rejected Authorization Bearer sk-live-secret.",
              retryable: true,
              redactedDetail: {
                providerCode: "rate_limit"
              }
            }
          ]
        }),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_failed_m26",
      createSuggestionId: () => "sug_failed_m26",
      createAgentRunId: () => "agentrun_failed_m26",
      createHandoffId: () => "handoff_failed_m26",
      workflowRunHistory: {
        async recordWorkflowRun(record) {
          workflowRunRecords.push(record);
          return ok(record);
        }
      }
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "Continue after a temporary provider failure."
    });

    expect(isErr(generated)).toBe(true);
    if (isOk(generated)) {
      throw new Error("Expected AI workflow generation to fail.");
    }
    expect(generated.error.code).toBe("AGENT_MODEL_CALL_FAILED");
    expect(workflowRunRecords).toEqual([
      expect.objectContaining({
        workflowRunId: "wfrun_failed_m26",
        status: "failed",
        context: {
          sourceCount: 1,
          tokenEstimate: 4,
          selectionReason: "Continue after a temporary provider failure."
        },
        error: {
          code: "AGENT_MODEL_CALL_FAILED",
          message: "The agent model call failed.",
          recoverability: "retryable",
          suggestedAction: "Inspect the model profile and retry the workflow step.",
          retryable: true
        },
        retryPolicy: {
          mode: "manual",
          maxAttempts: 1,
          backoffLabel: "用户手动重试",
          retryableCodes: ["LLM_TIMEOUT", "LLM_RATE_LIMITED", "LLM_PROVIDER_ERROR"]
        },
        steps: [
          {
            stepId: "build_context",
            label: "构建上下文",
            kind: "context",
            status: "completed"
          },
          {
            stepId: "write_suggestion",
            label: "运行写作 Agent",
            kind: "agent",
            status: "failed"
          },
          {
            stepId: "confirm_apply",
            label: "等待用户确认",
            kind: "confirmation",
            status: "pending"
          }
        ]
      })
    ]);
    expect(JSON.stringify(workflowRunRecords)).not.toContain("sk-live-secret");
    expect(chapterSession.getState()?.chapter.body).toBe("Opening line.\n");
  });
});

function createRepository(writes: ChapterDocument[]): ChapterDraftRepositoryPort {
  return {
    async readChapter() {
      return ok(originalChapter);
    },
    async writeChapter(chapter) {
      writes.push(chapter);
      return ok(chapter);
    }
  };
}

function createCapturingProvider(requests: LlmRequest[]): LlmProvider {
  return {
    id: "openai-compatible",
    async complete(request) {
      requests.push(request);
      return {
        content: {
          type: "json",
          value: {
            proposedBody,
            summary: "Continues the current scene."
          }
        }
      };
    },
    async *stream() {
      yield {
        type: "delta",
        value: ""
      };
    }
  };
}
