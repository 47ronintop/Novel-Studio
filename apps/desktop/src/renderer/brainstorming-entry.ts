import type {
  AgentComposerQuickAction,
  AgentConversationWorkspaceShellProps
} from "@novel-studio/ui";
import { useCallback, useState } from "react";

export const BRAINSTORMING_REQUEST =
  "请引导我构思这本小说。你负责提问和整理，不要求我一次写完设定。每次只问一两个关键问题，优先了解作品类型、创作目标、主角、核心冲突和世界背景；我说“没想好”时，请给出不超过三个方向供我选择。信息足够后先总结目前共识，等我确认后再提议把明确内容写入大纲、人物或世界观资料；不要自行补全或持久化未经确认的设定。";
export const CONTINUE_WRITING_REQUEST = "请从当前章节末尾继续写作。";

export type WritingEntryKind = AgentComposerQuickAction["id"];

export function writingEntryDisabledReason(
  workspace: AgentConversationWorkspaceShellProps,
  kind: WritingEntryKind,
  activeChapterId?: string
): string | undefined {
  const sharedReason = sharedWritingEntryDisabledReason(workspace);
  if (sharedReason !== undefined) return sharedReason;
  if (kind === "continue" && activeChapterId === undefined) {
    return "请先创建或打开一个章节。";
  }
  return undefined;
}

export function brainstormingDisabledReason(
  workspace: AgentConversationWorkspaceShellProps
): string | undefined {
  return writingEntryDisabledReason(workspace, "brainstorm");
}

function sharedWritingEntryDisabledReason(
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

export function startWritingEntry(
  workspace: AgentConversationWorkspaceShellProps,
  kind: WritingEntryKind,
  activeChapterId?: string
): boolean {
  const composer = workspace.view.composer;
  if (
    composer === undefined ||
    writingEntryDisabledReason(workspace, kind, activeChapterId) !== undefined
  ) {
    return false;
  }
  composer.onContextModeChange("writing");
  composer.onOperationModeChange(kind === "brainstorm" ? "planning" : "execution");
  composer.onRequestChange(
    kind === "brainstorm" ? BRAINSTORMING_REQUEST : CONTINUE_WRITING_REQUEST
  );
  return true;
}

export function startBrainstorming(workspace: AgentConversationWorkspaceShellProps): boolean {
  return startWritingEntry(workspace, "brainstorm");
}

export function decorateWritingEntryWorkspace(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  input: {
    readonly activeProjectId: string | undefined;
    readonly activeChapterId: string | undefined;
    readonly focusRequestId: number | undefined;
    readonly onSelect: (kind: WritingEntryKind) => void;
  }
): AgentConversationWorkspaceShellProps | undefined {
  const composer = workspace?.view.composer;
  if (workspace === undefined || composer === undefined) return workspace;

  const {
    focusRequestId: _focusRequestId,
    quickActions: _quickActions,
    ...baseComposer
  } = composer;
  void _focusRequestId;
  void _quickActions;
  const projectedComposer =
    input.activeProjectId === undefined
      ? baseComposer
      : {
          ...baseComposer,
          ...(input.focusRequestId === undefined ? {} : { focusRequestId: input.focusRequestId }),
          quickActions: (["brainstorm", "continue"] as const).map((kind) => {
            const disabledReason = writingEntryDisabledReason(
              workspace,
              kind,
              input.activeChapterId
            );
            return {
              id: kind,
              label: kind === "brainstorm" ? "开始构思" : "继续写作",
              ...(disabledReason === undefined ? {} : { disabledReason }),
              onSelect: () => {
                if (disabledReason === undefined) input.onSelect(kind);
              }
            } satisfies AgentComposerQuickAction;
          })
        };

  return {
    ...workspace,
    view: {
      ...workspace.view,
      composer: projectedComposer
    }
  };
}

export function useWritingEntry(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  activeProjectId: string | undefined,
  activeChapterId: string | undefined
): {
  readonly workspace: AgentConversationWorkspaceShellProps | undefined;
  readonly onStart: () => void;
} {
  const [focusRequest, setFocusRequest] = useState<
    { readonly projectId: string; readonly requestId: number } | undefined
  >();
  const onSelect = useCallback(
    (kind: WritingEntryKind) => {
      if (
        workspace === undefined ||
        activeProjectId === undefined ||
        !startWritingEntry(workspace, kind, activeChapterId)
      ) {
        return;
      }
      setFocusRequest((current) => ({
        projectId: activeProjectId,
        requestId: (current?.requestId ?? 0) + 1
      }));
    },
    [activeChapterId, activeProjectId, workspace]
  );
  const onStart = useCallback(() => onSelect("brainstorm"), [onSelect]);
  const focusRequestId =
    focusRequest === undefined || focusRequest.projectId !== activeProjectId
      ? undefined
      : focusRequest.requestId;
  return {
    workspace: decorateWritingEntryWorkspace(workspace, {
      activeProjectId,
      activeChapterId,
      focusRequestId,
      onSelect
    }),
    onStart
  };
}
