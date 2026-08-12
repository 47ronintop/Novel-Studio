import type { AgentConversationWorkspaceShellProps } from "@novel-studio/ui";
import { useCallback, useState } from "react";

export const BRAINSTORMING_REQUEST =
  "请引导我构思这本小说。你负责提问和整理，不要求我一次写完设定。每次只问一两个关键问题，优先了解作品类型、创作目标、主角、核心冲突和世界背景；我说“没想好”时，请给出不超过三个方向供我选择。信息足够后先总结目前共识，等我确认后再提议把明确内容写入大纲、人物或世界观资料；不要自行补全或持久化未经确认的设定。";

export function brainstormingDisabledReason(
  workspace: AgentConversationWorkspaceShellProps
): string | undefined {
  const composer = workspace.view.composer;
  if (composer === undefined) return "Agent 暂时不可用。";
  if (composer.request.trim().length > 0) return "请先发送或清空当前 Agent 草稿。";
  if (workspace.view.loading || workspace.view.conversation === undefined) {
    return "正在准备 Agent 会话…";
  }
  if (composer.active) return "请等待当前 Agent 任务结束。";
  if (composer.disabled) return composer.disabledReason ?? "Agent 暂时不可用。";
  return undefined;
}

export function startBrainstorming(workspace: AgentConversationWorkspaceShellProps): boolean {
  const composer = workspace.view.composer;
  if (composer === undefined || brainstormingDisabledReason(workspace) !== undefined) return false;
  composer.onRequestChange(BRAINSTORMING_REQUEST);
  return true;
}

export function useBrainstormingEntry(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  activeProjectId: string | undefined
): {
  readonly workspace: AgentConversationWorkspaceShellProps | undefined;
  readonly onStart: () => void;
} {
  const [focusRequest, setFocusRequest] = useState<
    { readonly projectId: string; readonly requestId: number } | undefined
  >();
  const onStart = useCallback(() => {
    if (workspace !== undefined && activeProjectId !== undefined && startBrainstorming(workspace)) {
      setFocusRequest((current) => ({
        projectId: activeProjectId,
        requestId: (current?.requestId ?? 0) + 1
      }));
    }
  }, [activeProjectId, workspace]);
  const focusRequestId =
    focusRequest === undefined || focusRequest.projectId !== activeProjectId
      ? undefined
      : focusRequest.requestId;
  const composer = workspace?.view.composer;
  if (workspace === undefined || composer === undefined) {
    return { workspace, onStart };
  }
  return {
    workspace: {
      ...workspace,
      view: {
        ...workspace.view,
        composer: {
          ...composer,
          ...(focusRequestId === undefined ? {} : { focusRequestId })
        }
      }
    },
    onStart
  };
}
