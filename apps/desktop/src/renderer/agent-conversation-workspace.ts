import type { NovelStudioApi } from "@novel-studio/application";
import type {
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AgentRunPanelProps
} from "@novel-studio/ui";
import { useEffect, useState } from "react";

import {
  createAgentConversationBridge,
  toAgentConversationWorkspaceProps
} from "./agent-conversation-bridge.js";
import type { AgentRunBridge } from "./agent-run-bridge.js";

export interface AgentConversationWorkspaceState {
  readonly selectedConversationId: string | undefined;
  readonly workspace: AgentConversationWorkspaceShellProps | undefined;
}

export interface PendingAgentConversationMainReview {
  readonly projectId: string;
  readonly review: AgentConversationMainReview;
}

export interface AgentConversationWorkspacePresentation {
  readonly workspace: AgentConversationWorkspaceShellProps | undefined;
  readonly shouldClearPendingMainReview: boolean;
}

export function resolveAgentConversationWorkspacePresentation(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  activeProjectId: string,
  pendingMainReview: PendingAgentConversationMainReview | undefined
): AgentConversationWorkspacePresentation {
  if (pendingMainReview === undefined) {
    return { workspace, shouldClearPendingMainReview: false };
  }
  if (pendingMainReview.projectId !== activeProjectId || workspace?.mainReview !== undefined) {
    return { workspace, shouldClearPendingMainReview: true };
  }
  if (workspace === undefined) {
    return { workspace, shouldClearPendingMainReview: false };
  }
  return {
    workspace: { ...workspace, mainReview: pendingMainReview.review },
    shouldClearPendingMainReview: false
  };
}

export function useAgentConversationWorkspace(input: {
  readonly api: NovelStudioApi | undefined;
  readonly agentRunBridge: AgentRunBridge | undefined;
  readonly agentRun: AgentRunPanelProps | undefined;
  readonly projectId: string;
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps) => void;
  readonly onOpenMainReview: (review: AgentConversationMainReview) => void;
}): AgentConversationWorkspaceState {
  const { api, agentRunBridge, agentRun, projectId, onAgentRunChange, onOpenMainReview } = input;
  const [bridge] = useState(() =>
    api === undefined || agentRunBridge === undefined
      ? undefined
      : createAgentConversationBridge(api, {
          resetRunWriteAuthorization: () => agentRunBridge.resetWriteAuthorization()
        })
  );
  const [conversation, setConversation] = useState(() => bridge?.getProps());

  useEffect(() => {
    if (bridge === undefined) return;
    return bridge.subscribe(() => setConversation(bridge.getProps()));
  }, [bridge]);

  useEffect(() => {
    if (bridge === undefined) return;
    void bridge.load(projectId).then(setConversation);
  }, [bridge, projectId]);

  useEffect(() => {
    if (agentRunBridge === undefined || conversation === undefined) return;
    void agentRunBridge
      .loadRun(conversation.selectedConversation?.lastRunId)
      .then(onAgentRunChange);
  }, [
    agentRunBridge,
    conversation?.selectedConversation?.lastRunId,
    conversation?.selectedConversationId,
    onAgentRunChange
  ]);

  if (conversation === undefined) {
    return { selectedConversationId: undefined, workspace: undefined };
  }

  const apply = (operation: Promise<typeof conversation>): void => {
    void operation.then(setConversation);
  };
  return {
    selectedConversationId: conversation.selectedConversationId,
    workspace: toAgentConversationWorkspaceProps(
      conversation,
      agentRun,
      agentRunBridge?.getComposerProps(),
      agentRunBridge?.getPlanReviewProps(),
      {
        onCreate: () => apply(bridge?.create() ?? Promise.resolve(conversation)),
        onSelect: (conversationId) =>
          apply(bridge?.select(conversationId) ?? Promise.resolve(conversation)),
        onArchive: (conversationId) =>
          apply(bridge?.archive(conversationId) ?? Promise.resolve(conversation)),
        onRestore: (conversationId) =>
          apply(bridge?.restore(conversationId) ?? Promise.resolve(conversation)),
        onSearchQueryChange: (query) =>
          apply(
            bridge?.search(query, conversation.includeArchived) ?? Promise.resolve(conversation)
          ),
        onFilterChange: (filter) =>
          apply(
            bridge?.search(conversation.searchQuery, filter === "archived") ??
              Promise.resolve(conversation)
          ),
        onReturnToActive: () => {
          if (conversation.activeConversationId !== undefined) {
            apply(
              bridge?.select(conversation.activeConversationId) ?? Promise.resolve(conversation)
            );
          }
        },
        onOpenMainReview
      }
    )
  };
}
