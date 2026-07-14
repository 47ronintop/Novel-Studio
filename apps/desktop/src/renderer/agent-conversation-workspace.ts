import type { NovelStudioApi } from "@novel-studio/application";
import type {
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

export function useAgentConversationWorkspace(input: {
  readonly api: NovelStudioApi | undefined;
  readonly agentRunBridge: AgentRunBridge | undefined;
  readonly agentRun: AgentRunPanelProps | undefined;
  readonly projectId: string;
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps) => void;
}): AgentConversationWorkspaceState {
  const { api, agentRunBridge, agentRun, projectId, onAgentRunChange } = input;
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
    workspace: toAgentConversationWorkspaceProps(conversation, agentRun, {
      onCreate: () => apply(bridge?.create() ?? Promise.resolve(conversation)),
      onSelect: (conversationId) =>
        apply(bridge?.select(conversationId) ?? Promise.resolve(conversation)),
      onArchive: (conversationId) =>
        apply(bridge?.archive(conversationId) ?? Promise.resolve(conversation)),
      onRestore: (conversationId) =>
        apply(bridge?.restore(conversationId) ?? Promise.resolve(conversation)),
      onSearchQueryChange: (query) =>
        apply(bridge?.search(query, conversation.includeArchived) ?? Promise.resolve(conversation)),
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
      onSend: (request) => {
        if (agentRunBridge !== undefined) void agentRunBridge.send(request).then(onAgentRunChange);
      }
    })
  };
}
