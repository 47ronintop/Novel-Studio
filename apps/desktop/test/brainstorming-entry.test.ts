import { describe, expect, test, vi } from "vitest";

import type { AgentComposerProps, AgentConversationWorkspaceShellProps } from "@novel-studio/ui";

import {
  BRAINSTORMING_REQUEST,
  CONTINUE_WRITING_REQUEST,
  brainstormingDisabledReason,
  decorateWritingEntryWorkspace,
  startBrainstorming,
  startWritingEntry,
  writingEntryDisabledReason
} from "../src/renderer/brainstorming-entry.js";

describe("writing entries", () => {
  test("configures brainstorming as writing planning without sending", () => {
    const onRequestChange = vi.fn();
    const onContextModeChange = vi.fn();
    const onOperationModeChange = vi.fn();
    const onSend = vi.fn();
    const workspace = agentWorkspace(
      composer({ onContextModeChange, onOperationModeChange, onRequestChange, onSend })
    );

    expect(startBrainstorming(workspace)).toBe(true);
    expect(onContextModeChange).toHaveBeenCalledWith("writing");
    expect(onOperationModeChange).toHaveBeenCalledWith("planning");
    expect(onRequestChange).toHaveBeenCalledWith(BRAINSTORMING_REQUEST);
    expect(onSend).not.toHaveBeenCalled();
  });

  test("configures continuation as writing execution without sending", () => {
    const onRequestChange = vi.fn();
    const onContextModeChange = vi.fn();
    const onOperationModeChange = vi.fn();
    const onSend = vi.fn();
    const workspace = agentWorkspace(
      composer({ onContextModeChange, onOperationModeChange, onRequestChange, onSend })
    );

    expect(startWritingEntry(workspace, "continue", "chapter_1")).toBe(true);
    expect(onContextModeChange).toHaveBeenCalledWith("writing");
    expect(onOperationModeChange).toHaveBeenCalledWith("execution");
    expect(onRequestChange).toHaveBeenCalledWith(CONTINUE_WRITING_REQUEST);
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

  test("requires an active chapter only for continuation", () => {
    const onRequestChange = vi.fn();
    const workspace = agentWorkspace(composer({ onRequestChange }));

    expect(writingEntryDisabledReason(workspace, "brainstorm")).toBeUndefined();
    expect(writingEntryDisabledReason(workspace, "continue")).toBe("请先创建或打开一个章节。");
    expect(startWritingEntry(workspace, "continue")).toBe(false);
    expect(onRequestChange).not.toHaveBeenCalled();
  });

  test("keeps the composer focused without projecting redundant creative action buttons", () => {
    const onSelect = vi.fn();
    const workspace = agentWorkspace(composer());

    const projected = decorateWritingEntryWorkspace(workspace, {
      activeProjectId: "project_1",
      activeChapterId: "chapter_1",
      focusRequestId: 3,
      onSelect
    });
    expect(projected?.view.composer?.quickActions).toBeUndefined();
    expect(projected?.view.composer?.focusRequestId).toBe(3);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("keeps quick actions out of standalone and engineering projections", () => {
    const workspace = agentWorkspace(
      composer({
        focusRequestId: 2,
        quickActions: [{ id: "brainstorm", label: "开始构思", onSelect: vi.fn() }]
      })
    );

    const projected = decorateWritingEntryWorkspace(workspace, {
      activeProjectId: undefined,
      activeChapterId: undefined,
      focusRequestId: undefined,
      onSelect: vi.fn()
    });

    expect(projected?.view.composer?.quickActions).toBeUndefined();
    expect(projected?.view.composer?.focusRequestId).toBeUndefined();
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
