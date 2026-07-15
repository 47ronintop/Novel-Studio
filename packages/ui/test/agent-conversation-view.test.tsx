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

  test("renders a focused empty state that creates the first conversation", () => {
    const onCreate = vi.fn();
    const { host } = renderView({ conversation: undefined, onCreate });

    expect(host.querySelector('[aria-label="Agent 会话主视图"]')).not.toBeNull();
    expect(host.textContent).toContain("新建会话后开始规划或执行写作任务。");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')?.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
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
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    status: "idle",
    assistantText: "",
    events: [],
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined
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
    onWritePolicyAcknowledgedChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    ...overrides
  };
}
