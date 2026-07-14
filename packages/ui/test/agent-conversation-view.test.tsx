// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentConversationView } from "../src/agent-conversation-view.js";
import type {
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

  test("renders a focused empty state that creates the first conversation", () => {
    const onCreate = vi.fn();
    const { host } = renderView({ conversation: undefined, onCreate });

    expect(host.querySelector('[aria-label="Agent 会话主视图"]')).not.toBeNull();
    expect(host.textContent).toContain("新建会话后开始规划或执行写作任务。");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')?.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("renders turn history and one current Agent run surface", () => {
    const { host } = renderView();

    expect(host.querySelectorAll('[aria-label="Agentic Writing Loop"]')).toHaveLength(1);
    expect(host.textContent).toContain("检查灯塔场景的角色动机");
    expect(host.textContent).toContain("动机成立，但可以延后揭示。");
    expect(host.textContent).toContain("近期上下文已恢复。");
    expect(
      host.querySelector(".ns-agent-conversation-run-panel .ns-agent-composer")
    ).not.toBeNull();
    expect(host.querySelector('[aria-label="会话输入区"]')).not.toBeNull();
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

  test("submits a trimmed request from the conversation composer", () => {
    const onSend = vi.fn();
    const { host } = renderView({ onSend });
    const composer = host.querySelector('[aria-label="会话输入区"]');
    const input = composer?.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]');

    act(() => {
      if (input !== null && input !== undefined) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(input, "  继续检查下一场  ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    act(() =>
      composer?.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.click()
    );

    expect(onSend).toHaveBeenCalledWith("继续检查下一场");
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
      loading: false,
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined,
      onSend: () => undefined,
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
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    status: "idle",
    userRequest: "",
    assistantText: "",
    events: [],
    onOperationModeChange: () => undefined,
    onContextModeChange: () => undefined,
    onWritePolicyChange: () => undefined,
    onWritePolicyAcknowledgedChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined,
    onDecidePlan: () => undefined
  };
}
