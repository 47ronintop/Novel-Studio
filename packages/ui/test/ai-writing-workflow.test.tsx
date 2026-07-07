import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "../src/index.js";

describe("AI writing workflow UI", () => {
  test("renders workflow controls and suggestion trace", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "failed",
          instruction: "续写当前场景",
          summary: "补写了主角推门后的动作。",
          contextTraceLabel: "1 source / 4 tokens",
          observability: {
            workflowRunId: "wfrun_m24",
            workflowTitle: "Continue Chapter",
            contextLabel: "1 source / 4 tokens",
            modelLabel: "Default Model / example-model",
            usageLabel: "24 tokens · estimated",
            costLabel: "USD 0.000000 · estimated",
            generatedAtLabel: "2026-07-05 09:30",
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
          },
          history: {
            runs: [
              {
                workflowRunId: "wfrun_m25",
                workflowTitle: "Continue Chapter",
                statusLabel: "待确认",
                updatedAtLabel: "2026-07-05 09:30",
                modelLabel: "Default Model / example-model",
                usageLabel: "24 tokens · estimated",
                costLabel: "USD 0.000000 · estimated"
              },
              {
                workflowRunId: "wfrun_m26_failed",
                workflowTitle: "Continue Chapter",
                statusLabel: "失败",
                updatedAtLabel: "2026-07-05 09:31",
                modelLabel: "Default Model / example-model",
                usageLabel: "0 tokens · missing",
                costLabel: "USD 0.000000 · unknown"
              }
            ],
            selectedRun: {
              workflowRunId: "wfrun_m26_failed",
              workflowTitle: "Continue Chapter",
              statusLabel: "失败",
              updatedAtLabel: "2026-07-05 09:31",
              contextLabel: "1 source / 4 tokens",
              modelLabel: "Default Model / example-model",
              usageLabel: "0 tokens · missing",
              costLabel: "USD 0.000000 · unknown",
              errorLabel: "AGENT_MODEL_CALL_FAILED · The agent model call failed.",
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
            }
          },
          failure: {
            title: "工作流失败",
            code: "AGENT_MODEL_CALL_FAILED",
            message: "The agent model call failed.",
            recoverabilityLabel: "可重试",
            suggestedAction: "Inspect the model profile and retry the workflow step."
          },
          retryPolicy: {
            modeLabel: "手动重试",
            maxAttemptsLabel: "最多 1 次",
            backoffLabel: "用户手动重试",
            retryableCodesLabel: "LLM_TIMEOUT / LLM_RATE_LIMITED / LLM_PROVIDER_ERROR"
          },
          modelDiscovery: {
            profileId: "model_default",
            provider: "openai-compatible",
            status: "loaded",
            models: [
              {
                id: "example-model",
                displayName: "example-model",
                provider: "openai-compatible"
              },
              {
                id: "gpt-5",
                displayName: "gpt-5",
                provider: "openai-compatible",
                reasoningStrength: {
                  status: "available",
                  providerParamName: "reasoning_effort",
                  allowedValues: ["low", "medium", "high"],
                  defaultValue: "medium"
                }
              }
            ],
            reasoningStrength: {
              status: "hidden",
              reason: "Select a whitelisted reasoning model before exposing reasoning controls."
            }
          },
          selectedModelName: "gpt-5",
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onModelSelect: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="AI 写作工作流"');
    expect(html).toContain('aria-label="AI 写作指令"');
    expect(html).toContain('aria-label="生成 AI 建议"');
    expect(html).toContain('aria-label="应用 AI 建议"');
    expect(html).toContain("补写了主角推门后的动作。");
    expect(html).toContain("1 source / 4 tokens");
    expect(html).toContain('aria-label="AI 工作流运行观测"');
    expect(html).toContain("Continue Chapter");
    expect(html).toContain("Default Model / example-model");
    expect(html).toContain('aria-label="AI model selector"');
    expect(html).toContain('value="gpt-5" selected=""');
    expect(html).toContain('aria-label="Reasoning effort"');
    expect(html).toContain("reasoning_effort");
    expect(html).toContain("24 tokens · estimated");
    expect(html).toContain("USD 0.000000 · estimated");
    expect(html).toContain("构建上下文");
    expect(html).toContain("运行写作 Agent");
    expect(html).toContain("等待用户确认");
    expect(html).toContain('aria-label="工作流运行历史"');
    expect(html).toContain("待确认");
    expect(html).toContain('aria-label="失败诊断"');
    expect(html).toContain("AGENT_MODEL_CALL_FAILED");
    expect(html).toContain("可重试");
    expect(html).toContain("Inspect the model profile and retry the workflow step.");
    expect(html).toContain('aria-label="重试策略"');
    expect(html).toContain("手动重试");
    expect(html).toContain("最多 1 次");
    expect(html).toContain("LLM_TIMEOUT / LLM_RATE_LIMITED / LLM_PROVIDER_ERROR");
    expect(html).toContain('aria-label="重试 AI 工作流"');
    expect(html).toContain("失败");
  });

  test("renders streaming preview and cancel control", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "streaming",
          instruction: "Continue the scene.",
          streamPreview: "The city answered",
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain("The city answered");
    expect(html).toContain('aria-label="取消 AI 流式输出"');
    expect(html).toContain("流式输出中");
  });

  test("renders persisted chat messages from the active AI session", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "suggestion-ready",
          instruction: "",
          summary: "Second answer shortens the prior continuation.",
          conversationMessages: [
            {
              messageId: "msg_user_1",
              role: "user",
              content: "续写这段。",
              createdAtLabel: "2026-07-05 00:00"
            },
            {
              messageId: "msg_assistant_1",
              role: "assistant",
              content: "First answer keeps the scene moving.",
              createdAtLabel: "2026-07-05 00:00"
            },
            {
              messageId: "msg_user_2",
              role: "user",
              content: "再短一点。",
              createdAtLabel: "2026-07-05 00:01"
            },
            {
              messageId: "msg_assistant_2",
              role: "assistant",
              content: "Second answer shortens the prior continuation.",
              createdAtLabel: "2026-07-05 00:01"
            }
          ],
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain("续写这段。");
    expect(html).toContain("First answer keeps the scene moving.");
    expect(html).toContain("再短一点。");
    expect(html).toContain("Second answer shortens the prior continuation.");
    expect(html).toContain("2026-07-05 00:01");
  });
});
