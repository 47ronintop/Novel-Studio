// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication, type DesktopShellState } from "@novel-studio/application";
import {
  WorkspaceShell,
  type AgentConversationMainReview,
  type AgentConversationTurnProps,
  type AgentConversationWorkspaceShellProps,
  type AiWritingWorkflowProps
} from "../src/index.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AI writing workflow compatibility UI", () => {
  test("projects selection review and workflow history without a legacy assistant surface", () => {
    const application = createDesktopApplication();
    const mainReview: AgentConversationMainReview = {
      kind: "selection",
      props: {
        status: "pending",
        originalText: "冷冷的风像雨一样落下。",
        proposedText: "风压低檐角，雨线随之倾斜。",
        rangeLabel: "0-13",
        compareLabel: "原选区 -> 建议文本",
        canUndo: true,
        styleReview: {
          status: "attention",
          hitCount: 2,
          hits: [
            {
              ruleId: "mechanical-emotion",
              title: "模板化情绪词",
              severity: "notice",
              matchedText: "冷冷",
              positionLabel: "第 1 字附近",
              suggestion: "改成可观察的动作、语气或环境反应。"
            },
            {
              ruleId: "stacked-simile",
              title: "连续比喻",
              severity: "notice",
              matchedText: "像雨",
              positionLabel: "第 6 字附近",
              suggestion: "保留一个更准确的比喻。"
            }
          ]
        },
        diagnostic: {
          title: "工作流失败",
          code: "AGENT_MODEL_CALL_FAILED",
          message: "The agent model call failed.",
          recoverabilityLabel: "可重试",
          suggestedAction: "Inspect the model profile and retry the workflow step."
        },
        onAccept: () => undefined,
        onReject: () => undefined,
        onUndo: () => undefined,
        onRetry: () => undefined
      }
    };
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={agentWorkspace({ mainReview })}
        aiWritingWorkflow={compatibilityWorkflow({
          status: "failed",
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
                  stepId: "write_suggestion",
                  label: "运行写作 Agent",
                  kind: "agent",
                  status: "failed"
                }
              ]
            }
          }
        })}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={creativeShellState(application, {
          activeBottomPanelTab: "工作流运行",
          bottomPanelVisible: true
        })}
      />
    );

    expect(html).toContain('aria-label="Selection AI review"');
    expect(html).toContain('aria-label="AI 文风规则检查"');
    expect(html).toContain("文风规则命中 2 处");
    expect(html).toContain("AGENT_MODEL_CALL_FAILED");
    expect(html).toContain("可重试");
    expect(html).toContain('aria-label="Retry selection AI preview"');
    expect(html).toContain('aria-label="工作流运行历史"');
    expect(html).toContain("Continue Chapter");
    expect(html.match(/<textarea[^>]*aria-label="Agent 请求"/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('aria-label="AI 写作工作流"');
    expect(html).not.toContain('aria-label="AI 写作指令"');
  });

  test("keeps the combined model/reasoning control and send slot inside one Agent Composer", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={agentWorkspace({
          turns: [
            {
              runId: "run-one",
              userRequest: "续写当前场景",
              assistantText: "建议已生成。",
              statusLabel: "已完成",
              updatedAtLabel: "10:00"
            }
          ]
        })}
        aiWritingWorkflow={compatibilityWorkflow({
          modelDiscovery: {
            profileId: "model_default",
            provider: "openai-compatible",
            status: "loaded",
            models: [],
            reasoningStrength: {
              status: "hidden",
              reason: "Compatibility controls no longer own the Composer."
            }
          }
        })}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={creativeShellState(application)}
      />
    );

    const conversationIndex = html.indexOf('aria-label="会话运行历史"');
    const composerIndex = html.indexOf('class="ns-agent-conversation-composer ns-agent-composer"');
    const modelAndReasoningIndex = html.indexOf('aria-label="模型与推理：gpt-5 · 中"');
    const sendIndex = html.indexOf('aria-label="启动 Agent 运行"');

    expect(conversationIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(conversationIndex);
    expect(modelAndReasoningIndex).toBeGreaterThan(composerIndex);
    expect(sendIndex).toBeGreaterThan(modelAndReasoningIndex);
    expect(html.match(/ns-agent-composer-model-trigger/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("ns-agent-composer-reasoning-trigger");
    expect(html.match(/aria-label="启动 Agent 运行"/g) ?? []).toHaveLength(1);
    expect(html).not.toContain('class="ns-ai-composer ns-ai-vscode-composer"');
    expect(html).not.toContain('aria-label="AI model controls"');
  });

  test("keeps Agent model ownership when compatibility discovery falls back", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={agentWorkspace({ modelLabel: "manual-proxy-model" })}
        aiWritingWorkflow={compatibilityWorkflow({
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
          selectedModelName: "legacy-model"
        })}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={creativeShellState(application)}
      />
    );

    expect(html).toContain('aria-label="模型与推理：manual-proxy-model · 中"');
    expect(html.match(/ns-agent-composer-model-trigger/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("fetch failed");
    expect(html).not.toContain("legacy-model");
    expect(html).not.toContain('aria-label="AI model selector"');
  });

  test("projects streaming status to the Bottom Panel without a second cancel surface", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={agentWorkspace()}
        aiWritingWorkflow={compatibilityWorkflow({
          status: "streaming",
          streamPreview: "The city answered"
        })}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={creativeShellState(application, {
          activeBottomPanelTab: "工作流运行",
          bottomPanelVisible: true
        })}
      />
    );

    expect(html).toContain("当前状态 流式生成");
    expect(html).not.toContain("The city answered");
    expect(html).not.toContain('aria-label="取消 AI 流式输出"');
    expect(html.match(/<textarea[^>]*aria-label="Agent 请求"/g) ?? []).toHaveLength(1);
  });

  test("calls reasoning effort selection from the Agent Composer", async () => {
    const calls: string[] = [];
    const application = createDesktopApplication();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <WorkspaceShell
          agentConversationWorkspace={agentWorkspace({
            onReasoningSelect: (value) => calls.push(value)
          })}
          aiWritingWorkflow={compatibilityWorkflow()}
          commandPaletteOpen={false}
          commands={application.listCommands()}
          shellState={creativeShellState(application)}
        />
      );
    });

    const modelAndReasoningTrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="模型与推理：gpt-5 · 中"]'
    );
    expect(modelAndReasoningTrigger).not.toBeNull();
    await act(async () => {
      modelAndReasoningTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-model-menu="reasoning"]')?.click();
    });
    const highReasoningOption = host.querySelector<HTMLButtonElement>(
      '[data-reasoning-option="high"]'
    );
    expect(highReasoningOption).not.toBeNull();
    await act(async () => {
      highReasoningOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(calls).toEqual(["high"]);
    await act(async () => root.unmount());
    host.remove();
  });

  test("renders persisted Agent turns without duplicating compatibility chat messages", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={agentWorkspace({
          turns: [
            {
              runId: "run-agent-history",
              userRequest: "续写这段。",
              assistantText: "Agent answer keeps the scene moving.",
              statusLabel: "已完成",
              updatedAtLabel: "2026-07-05 00:01"
            }
          ]
        })}
        aiWritingWorkflow={compatibilityWorkflow({
          status: "suggestion-ready",
          conversationMessages: [
            {
              messageId: "legacy-user",
              role: "user",
              content: "Legacy workflow request",
              createdAtLabel: "2026-07-05 00:00"
            },
            {
              messageId: "legacy-assistant",
              role: "assistant",
              content: "Legacy workflow answer",
              createdAtLabel: "2026-07-05 00:00"
            }
          ]
        })}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={creativeShellState(application)}
      />
    );

    expect(html).toContain("续写这段。");
    expect(html).toContain("Agent answer keeps the scene moving.");
    expect(html).toContain("2026-07-05 00:01");
    expect(html).not.toContain("Legacy workflow request");
    expect(html).not.toContain("Legacy workflow answer");
    expect(html.match(/aria-label="会话输入区"/g) ?? []).toHaveLength(1);
  });
});

function creativeShellState(
  application: ReturnType<typeof createDesktopApplication>,
  overrides: Partial<DesktopShellState> = {}
): DesktopShellState {
  return {
    ...application.getShellState(),
    ...overrides,
    workspaceContext: {
      kind: "creativeProject",
      workspaceId: "project-ai-writing-compatibility",
      projectId: "project-ai-writing-compatibility",
      displayName: "AI Writing Compatibility",
      capabilities: ["creativeWorkbench", "writingContext"]
    }
  };
}

function compatibilityWorkflow(
  overrides: Partial<AiWritingWorkflowProps> = {}
): AiWritingWorkflowProps {
  return {
    status: "idle",
    instruction: "",
    onInstructionChange: () => undefined,
    onGenerateSuggestion: () => undefined,
    onApplySuggestion: () => undefined,
    onRetrySuggestion: () => undefined,
    onCancelStreaming: () => undefined,
    ...overrides
  };
}

function agentWorkspace(
  options: {
    readonly mainReview?: AgentConversationMainReview;
    readonly modelLabel?: string;
    readonly onReasoningSelect?: (value: string) => void;
    readonly turns?: readonly AgentConversationTurnProps[];
  } = {}
): AgentConversationWorkspaceShellProps {
  const turns = options.turns ?? [];
  const modelLabel = options.modelLabel ?? "gpt-5";
  const conversation = {
    conversationId: "conversation-ai-writing-compatibility",
    title: "写作 Agent",
    status: "active" as const,
    updatedAtLabel: "10:00",
    runCount: turns.length,
    turns
  };
  return {
    navigator: {
      conversations: [conversation],
      selectedConversationId: conversation.conversationId,
      searchQuery: "",
      filter: "active",
      loading: false,
      onSearchQueryChange: () => undefined,
      onFilterChange: () => undefined,
      onCreate: () => undefined,
      onSelect: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined
    },
    view: {
      conversation,
      loading: false,
      composer: {
        request: "续写当前场景",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        active: false,
        availableContextModes: ["writing", "general_file"],
        model: {
          profiles: [
            {
              id: modelLabel,
              label: modelLabel,
              provider: "openai-compatible"
            }
          ],
          selectedProfileId: modelLabel,
          onSelect: () => undefined
        },
        reasoning: {
          visible: true,
          values: ["low", "medium", "high"],
          current: "medium",
          onSelect: (value) => options.onReasoningSelect?.(value)
        },
        onRequestChange: () => undefined,
        onOperationModeChange: () => undefined,
        onContextModeChange: () => undefined,
        onWritePolicyChange: () => undefined,
        onSend: () => undefined,
        onStop: () => undefined
      },
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined
    },
    ...(options.mainReview === undefined ? {} : { mainReview: options.mainReview })
  };
}
