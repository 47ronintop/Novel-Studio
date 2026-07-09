import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
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
          styleReview: {
            status: "attention",
            hitCount: 2,
            hits: [
              {
                ruleId: "mechanical-emotion",
                title: "模板化情绪词",
                severity: "notice",
                matchedText: "冷冷",
                positionLabel: "第 16 字附近",
                suggestion: "改成可观察的动作、语气或环境反应。"
              },
              {
                ruleId: "stacked-simile",
                title: "连续比喻",
                severity: "notice",
                matchedText: "像风像雨",
                positionLabel: "第 28 字附近",
                suggestion: "保留一个更准确的比喻，另一个改成动作或感官细节。"
              }
            ]
          },
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
    expect(html).not.toContain('aria-label="应用 AI 建议"');
    expect(html).toContain("补写了主角推门后的动作。");
    expect(html).toContain('aria-label="AI 文风规则检查"');
    expect(html).toContain("文风规则命中 2 处");
    expect(html).toContain("冷冷");
    expect(html).toContain("连续比喻");
    expect(html).not.toMatch(/过检测|绕检测|检测分数|AI检测|检测平台/);
    expect(html).toContain("1 source / 4 tokens");
    expect(html).toContain('aria-label="AI 工作流运行观测"');
    expect(html).toContain("Continue Chapter");
    expect(html).toContain("Default Model / example-model");
    expect(html).toContain('aria-label="AI model controls"');
    expect(html).toContain('class="ns-ai-model-trigger"');
    expect(html).toContain('class="ns-ai-model-trigger-item"');
    expect(html).toContain('data-placement="top"');
    expect(html).toContain("gpt-5");
    expect(html).toContain("模型");
    expect(html).toContain("推理");
    expect(html).not.toContain('aria-label="AI model selector"');
    expect(html).toContain('aria-label="Reasoning effort"');
    expect(html).toContain("reasoning_effort");
    expect(html).toContain('class="ns-ai-model-popover-layer"');
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

  test("keeps model controls and actions attached to the composer below the chat log", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "failed",
          instruction: "续写当前场景",
          failure: {
            title: "工作流失败",
            code: "AGENT_MODEL_CALL_FAILED",
            message: "The agent model call failed.",
            recoverabilityLabel: "可重试",
            suggestedAction: "Inspect the model profile and retry the workflow step."
          },
          modelDiscovery: {
            profileId: "model_default",
            provider: "openai-compatible",
            status: "loaded",
            models: [
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

    const chatIndex = html.indexOf('class="ns-ai-chat-log"');
    const composerIndex = html.indexOf('class="ns-ai-composer ns-ai-vscode-composer"');
    const composerEndIndex = html.indexOf("</section>", composerIndex);
    const modelIndex = html.indexOf('aria-label="AI model controls"');
    const toolbarIndex = html.indexOf('class="ns-ai-composer-toolbar"');
    const sendIndex = html.indexOf('class="ns-ai-send-button"');
    const legacyActionsIndex = html.indexOf('class="ns-ai-actions"');
    const failureIndex = html.indexOf('aria-label="失败诊断"');

    expect(chatIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(chatIndex);
    expect(failureIndex).toBeGreaterThan(chatIndex);
    expect(composerIndex).toBeGreaterThan(failureIndex);
    expect(modelIndex).toBeGreaterThan(composerIndex);
    expect(modelIndex).toBeLessThan(composerEndIndex);
    expect(toolbarIndex).toBeGreaterThan(composerIndex);
    expect(toolbarIndex).toBeLessThan(composerEndIndex);
    expect(modelIndex).toBeGreaterThan(toolbarIndex);
    expect(modelIndex).toBeLessThan(sendIndex);
    expect(html).toContain('data-placement="top"');
    expect(sendIndex).toBeGreaterThan(toolbarIndex);
    expect(sendIndex).toBeLessThan(composerEndIndex);
    expect(legacyActionsIndex).toBe(-1);
  });

  test("keeps model controls visible when model discovery falls back", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "idle",
          instruction: "Continue the scene.",
          modelDiscovery: {
            profileId: "model_custom",
            provider: "openai-compatible",
            status: "fallback",
            models: [],
            fallbackReason: "fetch failed",
            reasoningStrength: {
              status: "hidden",
              reason: "Discovery failed for this endpoint."
            }
          },
          selectedModelName: "manual-proxy-model",
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onModelSelect: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="AI model controls"');
    expect(html).toContain('class="ns-ai-model-trigger"');
    expect(html).toContain('class="ns-ai-model-trigger-item"');
    expect(html).toContain('data-placement="top"');
    expect(html).toContain("manual-proxy-model");
    expect(html).toContain("fetch failed");
    expect(html).toContain("更多模型");
    expect(html).not.toContain('aria-label="AI model selector"');
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

  test("calls reasoning effort selection from the model controls", () => {
    const calls: string[] = [];
    const application = createDesktopApplication();
    const tree = (
      <WorkspaceShell
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "idle",
          instruction: "Continue the scene.",
          modelDiscovery: {
            profileId: "model_default",
            provider: "openai-compatible",
            status: "loaded",
            models: [
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
          selectedReasoningEffort: "medium",
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onModelSelect: () => undefined,
          onReasoningEffortSelect: (value) => calls.push(value),
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    findElementByAriaLabel(tree, "Set reasoning effort high")?.props.onClick?.();

    expect(calls).toEqual(["high"]);
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

function findElementByAriaLabel(
  node: ReactNode,
  ariaLabel: string
): ReactElement<UiTestElementProps> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByAriaLabel(child, ariaLabel);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  const element = node as ReactElement<UiTestElementProps>;
  if (element.props["aria-label"] === ariaLabel) {
    return element;
  }

  if (typeof element.type === "function") {
    const renderComponent = element.type as (props: UiTestElementProps) => ReactNode;
    const found = findElementByAriaLabel(renderComponent(element.props), ariaLabel);
    if (found !== undefined) {
      return found;
    }
  }

  const children = element.props.children as ReactNode;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElementByAriaLabel(child, ariaLabel);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  return findElementByAriaLabel(children, ariaLabel);
}

interface UiTestElementProps {
  readonly [key: string]: unknown;
  readonly children?: ReactNode;
  readonly onClick?: () => void;
}
