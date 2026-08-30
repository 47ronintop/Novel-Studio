import { describe, expect, test } from "vitest";

import { createAgentBackedAiWritingWorkflowSession } from "../src/ai-writing-workflow-session.js";
import type { WorkflowRunRecord } from "../src/ai-writing-workflow-session.js";
import { createChapterEditorSession } from "../src/chapter-editor-session.js";
import { createLlmAdapter, createMockProvider } from "@novel-studio/llm-adapter";
import type { LlmProvider, LlmRequest } from "@novel-studio/llm-adapter";
import { isErr, isOk, ok, type ChapterDocument, type JsonObject } from "@novel-studio/shared";
import type { ChapterVersionSnapshotInput } from "@novel-studio/shared";
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
        tokenEstimate: 3
      }
    ]);
    expect(generated.value.observability).toMatchObject({
      workflowRunId: "wfrun_m14",
      workflowTitle: "Continue Chapter",
      context: {
        sourceCount: 1,
        tokenEstimate: 3,
        budgetMaxTokens: 1024,
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
          tokenEstimate: 3,
          budgetMaxTokens: 1024,
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

    const applied = await aiWorkflow.applyChapterSuggestion("sug_m14");

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
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "Current chapter body:\nOpening line."
    );
  });

  test("injects writing style rules into chapter requests and reviews returned text locally", async () => {
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
        provider: createCapturingProvider(requests, {
          proposedBody: "Opening line.\n她冷冷地望着门口，像雪落下来像刀锋贴近。\n",
          summary: "Adds a tense continuation."
        }),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_style_m14",
      createSuggestionId: () => "sug_style_m14",
      createAgentRunId: () => "agentrun_style_m14",
      createHandoffId: () => "handoff_style_m14"
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "续写，但减少模板化表达。"
    });

    expect(isOk(generated)).toBe(true);
    if (isErr(generated)) {
      throw new Error(generated.error.message);
    }
    const requestText = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(requestText).toContain("文风规则");
    expect(requestText).toContain("连续比喻");
    expect(requestText).toContain("解释性对照");
    expect(requestText).not.toMatch(/过检测|绕检测|检测分数|AI检测|检测平台/);
    expect(generated.value.styleReview).toMatchObject({
      status: "attention",
      hitCount: 2,
      hits: expect.arrayContaining([
        expect.objectContaining({
          ruleId: "mechanical-emotion",
          matchedText: "冷冷"
        }),
        expect.objectContaining({
          ruleId: "stacked-simile"
        })
      ])
    });
    expect(generated.value.styleEvaluation).toMatchObject({
      enforcement: "advisory",
      status: "attention",
      hitCount: 1,
      hits: [
        expect.objectContaining({
          ruleId: "stacked-simile",
          changeKind: "introduced",
          confidence: "medium"
        })
      ]
    });
  });

  test("keeps single-session chat history and sends prior turns to the next model request", async () => {
    const requests: LlmRequest[] = [];
    let responseIndex = 0;
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
        provider: {
          id: "mock",
          async complete(request) {
            requests.push(request);
            responseIndex += 1;
            return {
              content: {
                type: "json",
                value: {
                  proposedBody:
                    responseIndex === 1
                      ? "Opening line.\nFirst continuation.\n"
                      : "Opening line.\nShorter continuation.\n",
                  summary:
                    responseIndex === 1
                      ? "First answer keeps the scene moving."
                      : "Second answer shortens the prior continuation."
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
        },
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: createSequence("wfrun_chat"),
      createSuggestionId: createSequence("sug_chat"),
      createAgentRunId: createSequence("agentrun_chat"),
      createHandoffId: createSequence("handoff_chat")
    });

    const first = await aiWorkflow.generateChapterSuggestion({
      instruction: "续写这段。"
    });
    const second = await aiWorkflow.generateChapterSuggestion({
      instruction: "再短一点。"
    });

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (isErr(first) || isErr(second)) {
      throw new Error("Expected both chat turns to generate suggestions.");
    }

    expect(first.value.conversationMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "续写这段。"
      }),
      expect.objectContaining({
        role: "assistant",
        content: "First answer keeps the scene moving.",
        suggestionId: "sug_chat_1",
        workflowRunId: "wfrun_chat_1"
      })
    ]);
    expect(second.value.conversationMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "续写这段。"
      }),
      expect.objectContaining({
        role: "assistant",
        content: "First answer keeps the scene moving."
      }),
      expect.objectContaining({
        role: "user",
        content: "再短一点。"
      }),
      expect.objectContaining({
        role: "assistant",
        content: "Second answer shortens the prior continuation.",
        suggestionId: "sug_chat_2",
        workflowRunId: "wfrun_chat_2"
      })
    ]);
    expect(requests[1]?.messages.map((message) => message.content).join("\n")).toContain(
      "Previous conversation:"
    );
    expect(requests[1]?.messages.map((message) => message.content).join("\n")).toContain(
      "User: 续写这段。"
    );
    expect(requests[1]?.messages.map((message) => message.content).join("\n")).toContain(
      "Assistant: First answer keeps the scene moving."
    );
  });

  test("streams a chapter suggestion and forwards the abort signal to the LLM request", async () => {
    const requests: LlmRequest[] = [];
    const controller = new AbortController();
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
        provider: createStreamingJsonProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      configAssetIds: {
        workflowId: "wf_ai_continue_chapter",
        selectionWorkflowId: "wf_ai_rewrite_selection",
        chapterAgentId: "agent_chapter_writer",
        chapterPromptId: "prompt_continue_chapter",
        selectionAgentId: "agent_selection_rewriter",
        selectionPromptId: "prompt_rewrite_selection"
      },
      configAssetLoader: createDefaultWritingAssetLoader("STREAM CONFIGURED PROMPT"),
      contextCandidateProvider: async () =>
        ok([
          {
            refType: "world",
            refId: "world_stream",
            content: "STREAM CONFIGURED CONTEXT",
            priority: 10,
            sourceRefs: [{ entityType: "world.rule", entityId: "world_stream" }]
          }
        ]),
      contextBudgetTokens: 64,
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: createSequence("wfrun_stream"),
      createSuggestionId: createSequence("sug_stream"),
      createAgentRunId: createSequence("agentrun_stream"),
      createHandoffId: createSequence("handoff_stream")
    });

    const events = [];
    for await (const event of aiWorkflow.streamChapterSuggestion({
      instruction: "Continue.",
      abortSignal: controller.signal
    })) {
      events.push(event);
    }

    expect(requests[0]?.mode).toBe("streaming");
    expect(requests[0]?.abortSignal).toBe(controller.signal);
    const requestText = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(requestText).toContain("STREAM CONFIGURED PROMPT");
    expect(requestText).toContain("STREAM CONFIGURED CONTEXT");
    expect(events[0]).toEqual(ok({ type: "delta", value: '{"proposedBody":' }));
    expect(events[1]).toEqual(
      ok({ type: "delta", value: '"Opening line.\\nAI continuation.\\n"' })
    );
    expect(events[2]).toEqual(
      ok({ type: "delta", value: ',"summary":"Continues the current scene."}' })
    );
    expect(events[3]).toMatchObject({
      ok: true,
      value: {
        type: "suggestion",
        suggestion: {
          suggestionId: "sug_stream_1",
          workflowRunId: "wfrun_stream_1",
          proposedBody,
          summary: "Continues the current scene.",
          observability: {
            context: { sourceCount: 2, budgetMaxTokens: 64 }
          }
        }
      }
    });
  });

  test("forwards requested reasoning effort to streaming LLM requests", async () => {
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
        provider: createStreamingJsonProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      parameters: {
        temperature: 0.4,
        maxTokens: 2048
      },
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: createSequence("wfrun_reasoning_stream"),
      createSuggestionId: createSequence("sug_reasoning_stream"),
      createAgentRunId: createSequence("agentrun_reasoning_stream"),
      createHandoffId: createSequence("handoff_reasoning_stream")
    });

    for await (const event of aiWorkflow.streamChapterSuggestion({
      instruction: "Continue.",
      reasoningEffort: "high"
    })) {
      void event;
      // Drain the stream so the provider receives the request.
    }

    expect(requests[0]?.parameters).toEqual({
      temperature: 0.4,
      maxTokens: 2048,
      reasoningEffort: "high"
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
          tokenEstimate: 3,
          budgetMaxTokens: 1024,
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

  test("generates a selection-aware preview without writing chapter content", async () => {
    const requests: LlmRequest[] = [];
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
        provider: createSelectionPreviewProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_selection_m74",
      createSuggestionId: () => "sug_selection_m74",
      createAgentRunId: () => "agentrun_selection_m74",
      createHandoffId: () => "handoff_selection_m74",
      workflowRunHistory: {
        async recordWorkflowRun(record) {
          workflowRunRecords.push(record);
          return ok(record);
        }
      }
    });

    const preview = await aiWorkflow.generateSelectionPreview({
      instruction: "Rewrite the selected sentence with more tension.",
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      }
    });

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }
    expect(preview.value).toMatchObject({
      previewId: "sug_selection_m74",
      workflowRunId: "wfrun_selection_m74",
      previewOnly: true,
      observability: { workflowTitle: "Rewrite Selection" },
      proposedText: "The opening line tightened.",
      summary: "Rewrites only the selected sentence.",
      review: {
        status: "pending",
        originalText: "Opening line.",
        proposedText: "The opening line tightened.",
        rangeLabel: "0-13",
        compareLabel: "Opening line. -> The opening line tightened."
      },
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      },
      diffPreview: {
        title: "Selection AI preview",
        changes: [
          {
            kind: "replace",
            value: "The opening line tightened.\n"
          }
        ]
      }
    });
    expect(requests[0]?.messages[1]?.content).toContain("Opening line.");
    expect(requests[0]?.messages[1]?.content).toContain("Rewrite the selected sentence");
    expect(chapterSession.getState()?.chapter.body).toBe("Opening line.\n");
    expect(chapterSession.getState()?.dirty).toBe(false);
    expect(writes).toEqual([]);
    expect(workflowRunRecords).toEqual([
      expect.objectContaining({
        workflowId: "wf_ai_rewrite_selection",
        workflowTitle: "Rewrite Selection",
        status: "pending-confirmation"
      })
    ]);
  });

  test("injects writing style rules into selection requests and reviews returned text locally", async () => {
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
        provider: createSelectionPreviewProvider(requests, {
          proposedText: "她冷冷地说，不是害怕，是终于明白该离开了。",
          summary: "Rewrites the selected sentence with less direct exposition."
        }),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_selection_style_m74",
      createSuggestionId: () => "sug_selection_style_m74",
      createAgentRunId: () => "agentrun_selection_style_m74",
      createHandoffId: () => "handoff_selection_style_m74"
    });

    const preview = await aiWorkflow.generateSelectionPreview({
      instruction: "Rewrite the selected sentence with more tension.",
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      }
    });

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }
    const requestText = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(requestText).toContain("文风规则");
    expect(requestText).toContain("模板化情绪");
    expect(requestText).not.toMatch(/过检测|绕检测|检测分数|AI检测|检测平台/);
    expect(preview.value.styleReview).toMatchObject({
      status: "attention",
      hitCount: 3,
      hits: expect.arrayContaining([
        expect.objectContaining({
          ruleId: "mechanical-emotion",
          matchedText: "冷冷"
        }),
        expect.objectContaining({
          ruleId: "explanatory-contrast"
        }),
        expect.objectContaining({
          ruleId: "direct-realization"
        })
      ])
    });
    expect(preview.value.styleEvaluation).toMatchObject({
      enforcement: "advisory",
      status: "attention",
      hitCount: 2,
      hits: expect.arrayContaining([
        expect.objectContaining({
          ruleId: "explanatory-contrast",
          changeKind: "introduced"
        }),
        expect.objectContaining({
          ruleId: "direct-realization",
          changeKind: "introduced"
        })
      ])
    });
  });

  test("uses configured selection workflow assets and records their identity", async () => {
    const requests: LlmRequest[] = [];
    const workflowRunRecords: WorkflowRunRecord[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_selection_assets",
      repository: createRepository([]),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) throw new Error(loaded.error.message);

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createSelectionPreviewProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      configAssetIds: {
        workflowId: "wf_ai_continue_chapter",
        selectionWorkflowId: "wf_ai_rewrite_selection",
        chapterAgentId: "agent_chapter_writer",
        chapterPromptId: "prompt_continue_chapter",
        selectionAgentId: "agent_selection_rewriter",
        selectionPromptId: "prompt_rewrite_selection"
      },
      configAssetLoader: createDefaultWritingAssetLoader("CHAPTER PROMPT"),
      workflowRunHistory: {
        async recordWorkflowRun(record) {
          workflowRunRecords.push(record);
          return ok(record);
        }
      },
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_selection_assets",
      createSuggestionId: () => "sug_selection_assets",
      createAgentRunId: () => "agentrun_selection_assets",
      createHandoffId: () => "handoff_selection_assets"
    });

    const preview = await aiWorkflow.generateSelectionPreview({
      instruction: "Rewrite the selected sentence.",
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      }
    });

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) throw new Error(preview.error.message);
    expect(preview.value.observability.workflowTitle).toBe("Configured Rewrite Selection");
    expect(requests[0]?.messages.map((message) => message.content).join("\n")).toContain(
      "Return JSON with proposedText"
    );
    expect(workflowRunRecords).toEqual([
      expect.objectContaining({
        workflowId: "wf_ai_rewrite_selection",
        workflowTitle: "Configured Rewrite Selection"
      })
    ]);
  });

  test("applies a stored selection preview only after confirmation", async () => {
    const writes: ChapterDocument[] = [];
    const snapshots: ChapterVersionSnapshotInput[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository(writes),
      historyRepository: createHistoryRepository(snapshots),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createSelectionPreviewProvider([]),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_selection_apply_m76",
      createSuggestionId: () => "sug_selection_apply_m76",
      createAgentRunId: () => "agentrun_selection_apply_m76",
      createHandoffId: () => "handoff_selection_apply_m76"
    });

    const preview = await aiWorkflow.generateSelectionPreview({
      instruction: "Rewrite the selected sentence.",
      selection: {
        startOffset: 0,
        endOffset: 13,
        selectedText: "Opening line."
      }
    });
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }

    expect(chapterSession.getState()?.chapter.body).toBe("Opening line.\n");
    const applied = await aiWorkflow.applySelectionPreview(preview.value.previewId);

    expect(isOk(applied)).toBe(true);
    if (isErr(applied)) {
      throw new Error(applied.error.message);
    }
    expect(applied.value.state.chapter.body).toBe("The opening line tightened.\n");
    expect(applied.value.state.dirty).toBe(true);
    expect(applied.value.state.saveStatus).toBe("Unsaved");
    expect(writes).toEqual([]);
    expect(snapshots).toEqual([
      {
        chapterId: "ch_m14",
        body: "Opening line.\n",
        reason: "before-ai-apply",
        createdBy: "user",
        parentVersionId: null
      }
    ]);
  });
  test("loads configured workflow, agent, and prompt assets", async () => {
    const requests: LlmRequest[] = [];
    const workflowRunRecords: WorkflowRunRecord[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_assets",
      repository: createRepository([]),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) throw new Error(loaded.error.message);
    const assets = {
      workflow: {
        schemaVersion: "1.0",
        id: "wf_custom",
        type: "workflow.definition",
        title: "Custom",
        status: "active",
        entryStepId: "build_context",
        steps: [
          { id: "build_context", kind: "context", nextStepId: "write_suggestion" },
          {
            id: "write_suggestion",
            kind: "agent",
            agentId: "agent_custom",
            nextStepId: "confirm_apply"
          },
          { id: "confirm_apply", kind: "confirmation" }
        ],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      agent: {
        schemaVersion: "1.0",
        id: "agent_custom",
        type: "agent.config",
        title: "Custom",
        status: "active",
        agentRole: "writer",
        promptTemplateId: "prompt_custom",
        inputSchemaId: "schema.ai-writing.input.v1",
        outputSchemaId: "schema.ai-writing.output.v1",
        modelProfileId: "mock_m14",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      },
      prompt: {
        schemaVersion: "1.0",
        id: "prompt_custom",
        type: "prompt.template",
        title: "Custom",
        status: "active",
        promptRole: "writer",
        template: "CUSTOM PROMPT",
        variables: [],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      }
    } as const;
    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createCapturingProvider(requests),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      configAssetIds: {
        workflowId: "wf_custom",
        selectionWorkflowId: "wf_custom",
        chapterAgentId: "agent_custom",
        chapterPromptId: "prompt_custom",
        selectionAgentId: "agent_custom",
        selectionPromptId: "prompt_custom"
      },
      configAssetLoader: {
        async loadConfigAsset(type) {
          if (type === "workflow") return ok(assets.workflow as unknown as JsonObject);
          if (type === "agent") return ok(assets.agent as unknown as JsonObject);
          return ok(assets.prompt as unknown as JsonObject);
        }
      },
      contextCandidateProvider: async () =>
        ok([
          {
            refType: "character",
            refId: "chr_custom",
            content: "CUSTOM STORY BIBLE CONTEXT",
            priority: 10,
            sourceRefs: [{ entityType: "character", entityId: "chr_custom" }]
          },
          {
            refType: "memory",
            refId: "mem_custom",
            content: "CUSTOM CONFIRMED MEMORY",
            priority: 20,
            memoryConfidence: "confirmed",
            sourceRefs: [{ entityType: "memory", entityId: "mem_custom" }]
          },
          {
            refType: "chapter",
            refId: "ch_search_result",
            content: "CUSTOM SEARCH RESULT",
            priority: 30,
            sourceRefs: [{ entityType: "chapter", entityId: "ch_search_result" }]
          }
        ]),
      contextBudgetTokens: 128,
      workflowRunHistory: {
        async recordWorkflowRun(record) {
          workflowRunRecords.push(record);
          return ok(record);
        }
      },
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const result = await aiWorkflow.generateChapterSuggestion({ instruction: "Continue." });
    expect(isOk(result)).toBe(true);
    if (isErr(result)) throw new Error(result.error.message);
    expect(result.value.workflowRunId).toBeTruthy();
    expect(result.value.observability).toMatchObject({
      workflowTitle: "Custom",
      context: { sourceCount: 4, budgetMaxTokens: 128 }
    });
    const requestText = requests[0]?.messages.map((message) => message.content).join("\n") ?? "";
    expect(requestText).toContain("CUSTOM PROMPT");
    expect(requestText).toContain("CUSTOM STORY BIBLE CONTEXT");
    expect(requestText).toContain("CUSTOM CONFIRMED MEMORY");
    expect(requestText).toContain("CUSTOM SEARCH RESULT");
    expect(workflowRunRecords[0]).toMatchObject({
      workflowId: "wf_custom",
      context: { sourceCount: 4, budgetMaxTokens: 128 }
    });
  });

  test("rejects configured agents that are not linked to their prompt asset", async () => {
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_unlinked",
      repository: createRepository([])
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) throw new Error(loaded.error.message);
    const workflow = {
      schemaVersion: "1.0",
      id: "wf_unlinked",
      type: "workflow.definition",
      title: "Unlinked",
      status: "active",
      entryStepId: "build_context",
      steps: [
        { id: "build_context", kind: "context", nextStepId: "write_suggestion" },
        {
          id: "write_suggestion",
          kind: "agent",
          agentId: "agent_unlinked",
          nextStepId: "confirm_apply"
        },
        { id: "confirm_apply", kind: "confirmation" }
      ],
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z"
    } as const;
    const agent = {
      schemaVersion: "1.0",
      id: "agent_unlinked",
      type: "agent.config",
      title: "Unlinked",
      status: "active",
      agentRole: "writer",
      promptTemplateId: "prompt_other",
      inputSchemaId: "schema.ai-writing.input.v1",
      outputSchemaId: "schema.ai-writing.output.v1",
      modelProfileId: "mock_m14",
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:00.000Z"
    } as const;
    const prompt = { id: "prompt_unlinked", template: "PROMPT" } as const;
    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({ provider: createCapturingProvider([]) }),
      configAssetIds: {
        workflowId: workflow.id,
        selectionWorkflowId: workflow.id,
        chapterAgentId: agent.id,
        chapterPromptId: prompt.id,
        selectionAgentId: agent.id,
        selectionPromptId: prompt.id
      },
      configAssetLoader: {
        async loadConfigAsset(type) {
          if (type === "workflow") return ok(workflow as unknown as JsonObject);
          if (type === "agent") return ok(agent as unknown as JsonObject);
          return ok(prompt as unknown as JsonObject);
        }
      }
    });

    const result = await aiWorkflow.generateChapterSuggestion({ instruction: "Continue." });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AI_WORKFLOW_CONFIG_ASSET_INVALID" }
    });
  });

  test("returns a typed error when configured assets are missing", async () => {
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_missing",
      repository: createRepository([])
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) throw new Error(loaded.error.message);
    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({ provider: createCapturingProvider([]) }),
      configAssetIds: {
        workflowId: "wf_missing",
        selectionWorkflowId: "wf_missing",
        chapterAgentId: "agent_missing",
        chapterPromptId: "prompt_missing",
        selectionAgentId: "agent_missing",
        selectionPromptId: "prompt_missing"
      },
      configAssetLoader: {
        async loadConfigAsset() {
          return {
            ok: false,
            error: { code: "CONFIG_ASSET_MISSING", message: "missing" }
          } as never;
        }
      }
    });
    const result = await aiWorkflow.generateChapterSuggestion({ instruction: "Continue." });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AI_WORKFLOW_CONFIG_ASSET_MISSING" }
    });
  });

  test("fails before the provider when the full chapter request exceeds the model window", async () => {
    const requests: LlmRequest[] = [];
    const body = "A".repeat(600);
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_budget",
      repository: {
        async readChapter() {
          return ok({ ...originalChapter, body });
        },
        async writeChapter(chapter) {
          return ok(chapter);
        }
      },
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) throw new Error(loaded.error.message);

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({ provider: createCapturingProvider(requests) }),
      resolveModelRuntimeProfile: async () =>
        ok({
          contextWindow: 256,
          modelProfile: {
            id: "model_budget",
            provider: "openai-compatible",
            displayName: "Budget model",
            modelName: "budget-model"
          },
          parameters: { maxTokens: 64 }
        }),
      now: () => "2026-07-04T00:00:00.000Z"
    });

    const result = await aiWorkflow.generateChapterSuggestion({ instruction: "Continue." });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AI_WORKFLOW_CONTEXT_BUDGET_EXCEEDED" }
    });
    expect(requests).toHaveLength(0);
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

function createHistoryRepository(snapshots: ChapterVersionSnapshotInput[]) {
  return {
    async snapshotChapterVersion(input: ChapterVersionSnapshotInput) {
      snapshots.push(input);
      return ok({
        versionId: `ver_${snapshots.length}`,
        reason: input.reason,
        createdBy: input.createdBy ?? "user",
        createdAt: "2026-07-04T00:00:00.000Z",
        parentVersionId: input.parentVersionId ?? null
      });
    },
    async listChapterVersions() {
      return ok([]);
    },
    async readChapterVersion() {
      return ok({
        versionId: "ver_01",
        body: "Opening line.\n"
      });
    }
  };
}

function createCapturingProvider(
  requests: LlmRequest[],
  output: { readonly proposedBody: string; readonly summary: string } = {
    proposedBody,
    summary: "Continues the current scene."
  }
): LlmProvider {
  return {
    id: "openai-compatible",
    async complete(request) {
      requests.push(request);
      return {
        content: {
          type: "json",
          value: output
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

function createStreamingJsonProvider(requests: LlmRequest[]): LlmProvider {
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
    async *stream(request) {
      requests.push(request);
      yield {
        type: "delta",
        value: '{"proposedBody":'
      };
      yield {
        type: "delta",
        value: '"Opening line.\\nAI continuation.\\n"'
      };
      yield {
        type: "delta",
        value: ',"summary":"Continues the current scene."}'
      };
    }
  };
}

function createSelectionPreviewProvider(
  requests: LlmRequest[],
  output: { readonly proposedText: string; readonly summary: string } = {
    proposedText: "The opening line tightened.",
    summary: "Rewrites only the selected sentence."
  }
): LlmProvider {
  return {
    id: "mock",
    async complete(request) {
      requests.push(request);
      return {
        content: {
          type: "json",
          value: output
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

function createDefaultWritingAssetLoader(chapterPromptTemplate: string) {
  return {
    async loadConfigAsset(type: "prompt" | "agent" | "workflow", assetId: string) {
      if (type === "workflow") {
        const selection = assetId === "wf_ai_rewrite_selection";
        return ok({
          schemaVersion: "1.0",
          id: selection ? "wf_ai_rewrite_selection" : "wf_ai_continue_chapter",
          type: "workflow.definition",
          title: selection ? "Configured Rewrite Selection" : "Configured Continue Chapter",
          status: "active",
          entryStepId: "build_context",
          steps: [
            {
              id: "build_context",
              kind: "context",
              nextStepId: selection ? "rewrite_selection" : "write_suggestion"
            },
            {
              id: selection ? "rewrite_selection" : "write_suggestion",
              kind: "agent",
              agentId: selection ? "agent_selection_rewriter" : "agent_chapter_writer",
              nextStepId: "confirm_apply"
            },
            { id: "confirm_apply", kind: "confirmation" }
          ],
          createdAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z"
        });
      }
      if (type === "agent") {
        const selection = assetId === "agent_selection_rewriter";
        return ok({
          schemaVersion: "1.0",
          id: selection ? "agent_selection_rewriter" : "agent_chapter_writer",
          type: "agent.config",
          title: selection ? "Selection Rewriter" : "Chapter Writer",
          status: "active",
          agentRole: "writer",
          promptTemplateId: selection ? "prompt_rewrite_selection" : "prompt_continue_chapter",
          inputSchemaId: selection
            ? "schema.ai-selection-preview.input.v1"
            : "schema.ai-writing.input.v1",
          outputSchemaId: selection
            ? "schema.ai-selection-preview.output.v1"
            : "schema.ai-writing.output.v1",
          modelProfileId: "mock_m14",
          createdAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z"
        });
      }
      return ok({
        schemaVersion: "1.0",
        id: assetId,
        type: "prompt.template",
        title: "Configured Prompt",
        status: "active",
        promptRole: "writer",
        template:
          assetId === "prompt_continue_chapter"
            ? chapterPromptTemplate
            : "Return JSON with proposedText and summary for a selected text rewrite.",
        variables: [],
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:00.000Z"
      });
    }
  };
}

function createSequence(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}_${next}`;
  };
}
