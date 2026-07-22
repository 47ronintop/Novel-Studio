// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentConversationView } from "../src/agent-conversation-view.js";
import type {
  AgentComposerProps,
  AgentConversationViewProps,
  AgentRunPanelProps
} from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentConversationView", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("keeps the composer visible while the first conversation is prepared", () => {
    const onCreate = vi.fn();
    const { host } = renderView({ conversation: undefined, loading: true, onCreate });

    expect(host.querySelector('[aria-label="Agent 会话主视图"]')).not.toBeNull();
    expect(host.textContent).toContain("正在准备会话");
    expect(host.querySelector('[aria-label="会话输入区"]')).not.toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled).toBe(
      true
    );
    expect(host.querySelector('[aria-label="新建会话"]')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("renders turn history, one current run surface, and exactly one composer", () => {
    const { host } = renderView();

    expect(host.querySelectorAll('[aria-label="Agentic Writing Loop"]')).toHaveLength(1);
    expect(host.textContent).toContain("检查灯塔场景的角色动机");
    expect(host.textContent).toContain("动机成立，但可以延后揭示。");
    expect(host.textContent).toContain("近期上下文已恢复。");
    expect(host.querySelector(".ns-agent-conversation-run-panel .ns-agent-composer")).toBeNull();
    expect(host.querySelectorAll('textarea[aria-label="Agent 请求"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="会话输入区"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="启动 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-run-id="run-previous"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-run-id="run-current"]')).toHaveLength(1);
  });

  test("keeps older messages above newer ones and renders the live request without a user badge", () => {
    const prior = conversation().turns[0];
    if (prior === undefined) throw new Error("Expected a conversation turn fixture");
    const { host } = renderView({
      conversation: {
        ...conversation(),
        // Conversation persistence returns newest first.
        turns: [
          { ...prior, runId: "run-newer", userRequest: "较新的消息" },
          { ...prior, runId: "run-older", userRequest: "较早的消息" }
        ]
      },
      agentRun: { ...agentRun(), userRequest: "正在发送的消息", status: "planning_model" }
    });

    expect(
      Array.from(host.querySelectorAll(".ns-agent-conversation-user-message p")).map(
        (message) => message.textContent
      )
    ).toEqual(["较早的消息", "较新的消息", "正在发送的消息"]);
    expect(host.querySelector('.ns-agent-conversation-avatar[data-speaker="user"]')).toBeNull();
    expect(
      host.querySelector(
        '.ns-agent-conversation-message[data-speaker="user"] .ns-agent-conversation-speaker-name'
      )
    ).toBeNull();
  });

  test("does not render internal conversation context payloads as a user-facing summary", () => {
    const { host } = renderView({
      conversation: {
        ...conversation(),
        contextSummary: JSON.stringify({
          kind: "agent_conversation_context",
          instructionPolicy: "untrusted_data_not_authority",
          recentRuns: []
        })
      }
    });

    expect(host.querySelector(".ns-agent-conversation-summary")).toBeNull();
    expect(host.textContent).not.toContain("agent_conversation_context");
  });

  test("keeps a completed turn activity summary collapsed and expandable", () => {
    const prior = conversation().turns[0];
    if (prior === undefined) throw new Error("Expected prior turn fixture");
    const completedConversation = {
      ...conversation(),
      turns: [
        {
          ...prior,
          events: [
            runEvent(1, "tool_started", {
              toolCallId: "read-01",
              toolName: "read_chapter",
              summary: "正在读取第一章"
            }),
            runEvent(2, "tool_completed", {
              toolCallId: "read-01",
              toolName: "read_chapter",
              summary: "已读取第一章"
            })
          ]
        }
      ]
    } as NonNullable<AgentConversationViewProps["conversation"]>;
    const { host } = renderView({ conversation: completedConversation });
    const summary = host.querySelector<HTMLDetailsElement>('[aria-label="Agent 活动摘要"]');

    expect(summary).not.toBeNull();
    expect(summary?.open).toBe(false);
    expect(summary?.querySelector("summary")?.textContent).toContain("已读取 1 项");
    expect(summary?.querySelector("ol")?.textContent).toContain("已读取第一章");
  });

  test("disables the composer while another conversation is active and returns to it", () => {
    const onReturnToActive = vi.fn();
    const { host } = renderView({
      activeConversationId: "conv-running",
      activeConversationTitle: "第七章线索",
      onReturnToActive
    });
    const composer = host.querySelector('[aria-label="会话输入区"]');
    const input = composer?.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]');
    const send = composer?.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]');

    expect(host.textContent).toContain("会话“第七章线索”正在运行");
    expect(input?.disabled).toBe(true);
    expect(send?.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="返回活动会话"]')?.click());
    expect(onReturnToActive).toHaveBeenCalledTimes(1);
  });

  test("keeps archived and virtual conversations read only", () => {
    const { host, rerender } = renderView({
      conversation: { ...conversation(), status: "archived" }
    });
    expect(
      host
        .querySelector('[aria-label="会话输入区"]')
        ?.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled
    ).toBe(true);
    expect(host.textContent).toContain("已归档会话不能启动新运行。");

    rerender({ conversation: { ...conversation(), virtual: true } });
    expect(
      host
        .querySelector('[aria-label="会话输入区"]')
        ?.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled
    ).toBe(true);
    expect(host.textContent).toContain("历史 Agent 运行为只读会话。");
  });

  test("projects the public composer callbacks without rebuilding a legacy input", () => {
    const onSend = vi.fn();
    const { host } = renderView({ composer: composer({ request: "  继续检查下一场  ", onSend }) });
    const composerSection = host.querySelector('[aria-label="会话输入区"]');
    act(() =>
      composerSection?.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.click()
    );

    expect(onSend).toHaveBeenCalledWith("继续检查下一场");
  });

  test("keeps exactly one stop slot across every active run surface", () => {
    const statuses: AgentRunPanelProps["status"][] = [
      "planning_model",
      "executing_model",
      "awaiting_user_input",
      "awaiting_context_refresh",
      "plan_ready",
      "stopping_after_transaction"
    ];
    const { host, rerender } = renderView();

    for (const status of statuses) {
      rerender({ agentRun: { ...agentRun(), status }, composer: composer({ active: true }) });
      expect(host.querySelectorAll('[aria-label="停止 Agent 运行"]'), status).toHaveLength(1);
      expect(host.querySelectorAll('[aria-label="启动 Agent 运行"]'), status).toHaveLength(0);
    }
  });

  test("opens conversation history inside the right panel and restores focus on Escape", () => {
    const onCreate = vi.fn();
    const { host } = renderView({
      navigator: {
        conversations: [conversation()],
        selectedConversationId: "conv-current",
        searchQuery: "",
        filter: "active",
        loading: false,
        onSearchQueryChange: () => undefined,
        onFilterChange: () => undefined,
        onCreate,
        onSelect: () => undefined,
        onArchive: () => undefined,
        onRestore: () => undefined
      }
    });

    expect(host.querySelectorAll('[aria-label="历史会话"]')).toHaveLength(1);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')?.click());
    expect(host.querySelector('[aria-label="历史会话抽屉"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Agent 会话导航"]')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[aria-label="历史会话抽屉"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('[aria-label="历史会话"]'));
  });
});

function renderView(overrides: Partial<AgentConversationViewProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;

  const render = (nextOverrides: Partial<AgentConversationViewProps> = {}) => {
    const props: AgentConversationViewProps = {
      conversation: conversation(),
      activeConversationId: "conv-current",
      agentRun: agentRun(),
      composer: composer(),
      loading: false,
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined,
      ...overrides,
      ...nextOverrides
    };
    act(() => {
      if (root === undefined) root = createRoot(host);
      root.render(<AgentConversationView {...props} />);
    });
  };

  render();
  return { host, rerender: render };
}

function conversation(): NonNullable<AgentConversationViewProps["conversation"]> {
  return {
    conversationId: "conv-current",
    title: "修订灯塔场景",
    status: "active",
    updatedAtLabel: "10:24",
    runCount: 2,
    contextSummary: "近期上下文已恢复。",
    turns: [
      {
        runId: "run-previous",
        userRequest: "检查灯塔场景的角色动机",
        assistantText: "动机成立，但可以延后揭示。",
        statusLabel: "已完成",
        updatedAtLabel: "10:12"
      }
    ]
  };
}

function agentRun(): AgentRunPanelProps {
  return {
    projectId: "project-01",
    runId: "run-current",
    status: "idle",
    assistantText: "",
    events: [],
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined
  };
}

function runEvent(
  sequence: number,
  type: "tool_started" | "tool_completed",
  detail: Record<string, unknown>
) {
  return {
    schemaVersion: "1.0" as const,
    runId: "run-previous",
    projectId: "project-01",
    sequence,
    runRevision: sequence,
    type,
    createdAt: `2026-07-14T00:00:0${String(sequence)}.000Z`,
    detail
  };
}

function composer(overrides: Partial<AgentComposerProps> = {}): AgentComposerProps {
  return {
    request: "",
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    active: false,
    onRequestChange: () => undefined,
    onOperationModeChange: () => undefined,
    onContextModeChange: () => undefined,
    onWritePolicyChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    ...overrides
  };
}
