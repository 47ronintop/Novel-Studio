import type { NovelStudioApi } from "@novel-studio/application";
import type {
  AgentComposerQuickAction,
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AgentRunPanelProps,
  AiWritingWorkflowProps,
  ChapterEditorProps,
  ChapterEditorSelection
} from "@novel-studio/ui";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import {
  createAgentConversationBridge,
  toAgentConversationWorkspaceProps
} from "./agent-conversation-bridge.js";
import type { AgentRunBridge, AgentRunBridgeContext } from "./agent-run-bridge.js";

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

export function useAgentRunWorkspaceEffects(input: {
  readonly agentRunBridge: AgentRunBridge | undefined;
  readonly projectId: string | undefined;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace" | "none";
  readonly conversationId: string | undefined;
  readonly activeChapterId: string | undefined;
  readonly chapterEditor: AgentRunBridgeContext["chapterEditor"];
  readonly fileEditor: AgentRunBridgeContext["fileEditor"];
  readonly settings: AgentRunBridgeContext["settings"];
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps | undefined) => void;
}): void {
  const {
    agentRunBridge,
    projectId,
    workspaceKind,
    conversationId,
    activeChapterId,
    chapterEditor,
    fileEditor,
    settings,
    onAgentRunChange
  } = input;

  useLayoutEffect(() => {
    if (agentRunBridge === undefined || projectId === undefined) {
      onAgentRunChange(undefined);
      return;
    }

    const next = agentRunBridge.syncContext({
      projectId,
      workspaceKind: workspaceKind === "engineeringWorkspace" ? workspaceKind : "creativeProject",
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(activeChapterId === undefined ? {} : { activeChapterId }),
      ...(chapterEditor === undefined ? {} : { chapterEditor }),
      ...(fileEditor === undefined ? {} : { fileEditor }),
      ...(settings === undefined ? {} : { settings })
    });
    onAgentRunChange(next);
  }, [
    activeChapterId,
    agentRunBridge,
    chapterEditor,
    conversationId,
    fileEditor,
    onAgentRunChange,
    projectId,
    settings,
    workspaceKind
  ]);

  useEffect(() => {
    if (agentRunBridge === undefined || projectId === undefined) return;
    return agentRunBridge.subscribe(() => {
      onAgentRunChange(agentRunBridge.getProps());
    });
  }, [agentRunBridge, onAgentRunChange, projectId]);

  useEffect(() => {
    if (agentRunBridge === undefined || projectId === undefined) return;
    void agentRunBridge.load(projectId).then(onAgentRunChange);
  }, [agentRunBridge, onAgentRunChange, projectId]);
}

export function decorateAgentConversationWorkspace(input: {
  readonly workspace: AgentConversationWorkspaceShellProps | undefined;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace" | "none";
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly chapterSelection: ChapterEditorSelection | undefined;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly onRewriteSelection: () => void;
  readonly onReviewSelectionStyle: () => void;
  readonly onApplySelection: () => void;
  readonly onRejectSelection: () => void;
  readonly onUndoSelection: () => void;
}): AgentConversationWorkspaceShellProps | undefined {
  const workspace = input.workspace;
  if (workspace === undefined) return undefined;

  const creative = input.workspaceKind === "creativeProject";
  const availableContextModes = creative
    ? (["writing", "general_file"] as const)
    : (["general_file"] as const);
  const selection = input.aiWritingWorkflow?.selectionReview;
  const hasSelection =
    input.chapterEditor !== undefined &&
    input.chapterSelection !== undefined &&
    input.chapterSelection.anchor !== input.chapterSelection.head;
  const quickActions: readonly AgentComposerQuickAction[] | undefined = creative
    ? [
        {
          id: "rewrite_selection",
          label: "改写当前选区",
          ...(hasSelection ? {} : { disabledReason: "请先在编辑器中选择文本。" }),
          onSelect: input.onRewriteSelection
        },
        {
          id: "review_style",
          label: "检查文风与一致性",
          ...(hasSelection ? {} : { disabledReason: "请先在编辑器中选择文本。" }),
          onSelect: input.onReviewSelectionStyle
        }
      ]
    : undefined;
  const selectionMainReview: AgentConversationMainReview | undefined =
    selection === undefined
      ? undefined
      : {
          kind: "selection",
          props: {
            ...selection,
            ...(input.aiWritingWorkflow?.styleReview === undefined
              ? {}
              : { styleReview: input.aiWritingWorkflow.styleReview }),
            ...(input.aiWritingWorkflow?.failure === undefined
              ? {}
              : { diagnostic: input.aiWritingWorkflow.failure }),
            onAccept: input.onApplySelection,
            onReject: input.onRejectSelection,
            onUndo: input.onUndoSelection,
            onRetry: input.onRewriteSelection
          }
        };
  const existingReview = workspace.mainReview;
  const mainReview =
    selectionMainReview !== undefined &&
    (existingReview === undefined || existingReview.kind === "plan")
      ? selectionMainReview
      : existingReview;
  const baseComposer = workspace.view.composer;
  const composer =
    baseComposer === undefined
      ? undefined
      : {
          ...baseComposer,
          contextMode: availableContextModes.some((mode) => mode === baseComposer.contextMode)
            ? baseComposer.contextMode
            : "general_file",
          availableContextModes,
          ...(quickActions === undefined ? {} : { quickActions })
        };
  const workflowNotice =
    selection === undefined ? input.aiWritingWorkflow?.failure?.message : undefined;
  return {
    ...workspace,
    ...(mainReview === undefined ? {} : { mainReview }),
    view: {
      ...workspace.view,
      ...(composer === undefined ? {} : { composer }),
      ...(mainReview === undefined ? {} : { mainReview }),
      ...(workflowNotice === undefined || workspace.view.errorMessage !== undefined
        ? {}
        : { errorMessage: workflowNotice })
    }
  };
}

export function resolveAgentConversationWorkspacePresentation(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  activeProjectId: string | undefined,
  pendingMainReview: PendingAgentConversationMainReview | undefined
): AgentConversationWorkspacePresentation {
  if (activeProjectId === undefined) {
    return {
      workspace: undefined,
      shouldClearPendingMainReview: pendingMainReview !== undefined
    };
  }
  if (pendingMainReview === undefined) {
    return { workspace, shouldClearPendingMainReview: false };
  }
  if (
    pendingMainReview.projectId !== activeProjectId ||
    workspace?.mainReview !== undefined
  ) {
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
  readonly projectId: string | undefined;
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps) => void;
  readonly onOpenMainReview: (review: AgentConversationMainReview) => void;
}): AgentConversationWorkspaceState {
  const { api, agentRunBridge, agentRun, projectId, onAgentRunChange, onOpenMainReview } = input;
  const bridge = useMemo(
    () =>
      api === undefined || agentRunBridge === undefined || projectId === undefined
        ? undefined
        : createAgentConversationBridge(api, {
            resetRunWriteAuthorization: () => agentRunBridge.resetWriteAuthorization()
          }),
    [agentRunBridge, api, projectId]
  );
  const [conversation, setConversation] = useState(() => bridge?.getProps());

  useEffect(() => {
    setConversation(bridge?.getProps());
    return () => bridge?.dispose();
  }, [bridge]);

  useEffect(() => {
    if (bridge === undefined || projectId === undefined) return;
    return bridge.subscribe(() => setConversation(bridge.getProps()));
  }, [bridge]);

  useEffect(() => {
    if (bridge === undefined || projectId === undefined) return;
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
        onDelete: (conversationId) =>
          apply(bridge?.delete(conversationId) ?? Promise.resolve(conversation)),
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
