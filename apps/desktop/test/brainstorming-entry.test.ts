import { describe, expect, test, vi } from "vitest";

import type { AgentComposerProps, AgentConversationWorkspaceShellProps } from "@novel-studio/ui";

import {
  BRAINSTORMING_REQUEST,
  brainstormingDisabledReason,
  startBrainstorming
} from "../src/renderer/brainstorming-entry.js";

describe("brainstorming entry", () => {
  test("prefills the fixed request without sending it", () => {
    const onRequestChange = vi.fn();
    const onSend = vi.fn();
    const workspace = agentWorkspace(composer({ onRequestChange, onSend }));

    expect(startBrainstorming(workspace)).toBe(true);
    expect(onRequestChange).toHaveBeenCalledWith(BRAINSTORMING_REQUEST);
    expect(onSend).not.toHaveBeenCalled();
  });

  test("protects a non-empty draft", () => {
    const onRequestChange = vi.fn();
    const workspace = agentWorkspace(composer({ request: "已有构思", onRequestChange }));

    expect(brainstormingDisabledReason(workspace)).toBe("请先发送或清空当前 Agent 草稿。");
    expect(startBrainstorming(workspace)).toBe(false);
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  test("reports loading, active-run, and unavailable states", () => {
    expect(brainstormingDisabledReason(agentWorkspace(composer(), { loading: true }))).toBe(
      "正在准备 Agent 会话…"
    );
    expect(brainstormingDisabledReason(agentWorkspace(composer({ active: true })))).toBe(
      "请等待当前 Agent 任务结束。"
    );
    expect(
      brainstormingDisabledReason(
        agentWorkspace(composer({ disabled: true, disabledReason: "模型未配置。" }))
      )
    ).toBe("模型未配置。");
  });
});

function composer(overrides: Partial<AgentComposerProps> = {}): AgentComposerProps {
  return {
    request: "",
    operationMode: "execution",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    executionWritePolicyDraft: "write_before_confirmation",
    active: false,
    onRequestChange: () => undefined,
    onOperationModeChange: () => undefined,
    onContextModeChange: () => undefined,
    onWritePolicyChange: () => undefined,
    onExecutionWritePolicyDraftChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    ...overrides
  };
}

function agentWorkspace(
  agentComposer: AgentComposerProps,
  overrides: { readonly loading?: boolean } = {}
): AgentConversationWorkspaceShellProps {
  return {
    navigator: {} as AgentConversationWorkspaceShellProps["navigator"],
    view: {
      conversation: {
        conversationId: "conversation_1",
        title: "新会话",
        status: "active",
        updatedAtLabel: "刚刚",
        runCount: 0,
        turns: []
      },
      composer: agentComposer,
      loading: overrides.loading ?? false,
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined
    }
  };
}
