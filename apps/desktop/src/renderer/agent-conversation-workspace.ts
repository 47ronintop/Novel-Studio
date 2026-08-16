import type { NovelStudioApi, UserPreferencesSaveInput } from "@novel-studio/application";
import {
  STANDALONE_AGENT_CONTEXT_SCOPE,
  agentContextScopeKey,
  normalizeAgentContextScope,
  type AgentContextScope
} from "@novel-studio/agent-engine";
import type {
  AgentComposerProps,
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AgentRunPanelProps,
  AiWritingWorkflowProps,
  ChapterEditorProps,
  ChapterEditorSelection
} from "@novel-studio/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import {
  createAgentConversationBridge,
  toAgentConversationWorkspaceProps
} from "./agent-conversation-bridge.js";
import type { AgentRunBridge, AgentRunBridgeContext } from "./agent-run-bridge.js";

export interface AgentConversationWorkspaceState {
  readonly scope: AgentContextScope | undefined;
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

export interface StandaloneConversationSelection {
  readonly getSelectedConversationId: () => string | undefined;
  readonly onSelectedConversationIdChange: (conversationId: string | undefined) => void;
  readonly setSelectedConversationId: Dispatch<SetStateAction<string | undefined>>;
}

export function useStandaloneConversationSelection(
  persistUserPreferences: (input: UserPreferencesSaveInput) => void
): StandaloneConversationSelection {
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const selectedConversationIdRef = useRef<string | undefined>(undefined);
  selectedConversationIdRef.current = selectedConversationId;
  const getSelectedConversationId = useCallback(() => selectedConversationIdRef.current, []);
  const onSelectedConversationIdChange = useCallback(
    (conversationId: string | undefined) => {
      selectedConversationIdRef.current = conversationId;
      setSelectedConversationId(conversationId);
      persistUserPreferences({
        shell: { standaloneSelectedConversationId: conversationId ?? "" }
      });
    },
    [persistUserPreferences]
  );
  return {
    getSelectedConversationId,
    onSelectedConversationIdChange,
    setSelectedConversationId
  };
}

export function useAgentRunWorkspaceEffects(input: {
  readonly agentRunBridge: AgentRunBridge | undefined;
  readonly scope?: AgentContextScope;
  readonly projectId: string | undefined;
  readonly workspaceKind: "creativeProject" | "engineeringWorkspace" | "none";
  readonly surfaceContextMode?: AgentRunBridgeContext["surfaceContextMode"];
  readonly activeResourceRef?: AgentRunBridgeContext["activeResourceRef"];
  readonly beforeStart?: AgentRunBridgeContext["beforeStart"];
  readonly conversationId: string | undefined;
  readonly activeChapterId: string | undefined;
  readonly chapterEditor: AgentRunBridgeContext["chapterEditor"];
  readonly fileEditor: AgentRunBridgeContext["fileEditor"];
  readonly storyBibleSnapshotBinding: AgentRunBridgeContext["storyBibleSnapshotBinding"];
  readonly settings: AgentRunBridgeContext["settings"];
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps | undefined) => void;
}): void {
  const {
    agentRunBridge,
    scope: suppliedScope,
    projectId,
    workspaceKind,
    surfaceContextMode,
    activeResourceRef,
    beforeStart,
    conversationId,
    activeChapterId,
    chapterEditor,
    fileEditor,
    storyBibleSnapshotBinding,
    settings,
    onAgentRunChange
  } = input;
  const scope = resolveWorkspaceScope(suppliedScope, projectId, workspaceKind);
  const scopeKey = scope === undefined ? undefined : agentContextScopeKey(scope);
  const activeResourceKey =
    activeResourceRef === undefined ? undefined : JSON.stringify(activeResourceRef);

  useLayoutEffect(() => {
    if (agentRunBridge === undefined || scope === undefined) {
      onAgentRunChange(undefined);
      return;
    }

    const next = agentRunBridge.syncContext({
      scope,
      ...(scope.kind === "workspace" ? { projectId: scope.workspaceId } : {}),
      ...(scope.kind === "workspace" ? { workspaceKind: scope.workspaceKind } : {}),
      ...(scope.kind === "standalone" || surfaceContextMode === undefined
        ? {}
        : { surfaceContextMode }),
      ...(scope.kind === "standalone" ? {} : { activeResourceRef: activeResourceRef ?? null }),
      ...(scope.kind === "standalone" || beforeStart === undefined ? {} : { beforeStart }),
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(scope.kind === "standalone" || activeChapterId === undefined ? {} : { activeChapterId }),
      ...(scope.kind === "standalone" || chapterEditor === undefined ? {} : { chapterEditor }),
      ...(scope.kind === "standalone" || fileEditor === undefined ? {} : { fileEditor }),
      ...(scope.kind === "standalone" || storyBibleSnapshotBinding === undefined
        ? {}
        : { storyBibleSnapshotBinding }),
      ...(settings === undefined ? {} : { settings })
    });
    onAgentRunChange(next);
  }, [
    activeChapterId,
    agentRunBridge,
    chapterEditor,
    conversationId,
    fileEditor,
    storyBibleSnapshotBinding,
    activeResourceKey,
    beforeStart,
    onAgentRunChange,
    scopeKey,
    settings,
    surfaceContextMode,
    workspaceKind
  ]);

  useEffect(() => {
    if (agentRunBridge === undefined || scope === undefined) return;
    return agentRunBridge.subscribe(() => {
      onAgentRunChange(agentRunBridge.getProps());
    });
  }, [agentRunBridge, onAgentRunChange, scopeKey]);

  useEffect(() => {
    if (agentRunBridge === undefined || scope === undefined) return;
    void agentRunBridge.load(scope).then(onAgentRunChange);
  }, [agentRunBridge, onAgentRunChange, scopeKey]);
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
  readonly onOpenModelSharing?: (() => void) | undefined;
}): AgentConversationWorkspaceShellProps | undefined {
  const workspace = input.workspace;
  if (workspace === undefined) return undefined;

  const standalone = input.workspaceKind === "none";
  const creative = input.workspaceKind === "creativeProject";
  const availableContextModes = standalone
    ? (["standalone_chat"] as const)
    : creative
      ? (["writing", "general_file"] as const)
      : (["general_file"] as const);
  const selection = standalone ? undefined : input.aiWritingWorkflow?.selectionReview;
  const selectionMainReview: AgentConversationMainReview | undefined =
    selection === undefined
      ? undefined
      : {
          kind: "selection",
          props: {
            ...selection,
            ...(input.aiWritingWorkflow?.styleEvaluation !== undefined
              ? { styleEvaluation: input.aiWritingWorkflow.styleEvaluation }
              : input.aiWritingWorkflow?.styleReview === undefined
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
      : standalone
        ? standaloneComposer(baseComposer)
        : {
            ...baseComposer,
            contextMode: availableContextModes.some((mode) => mode === baseComposer.contextMode)
              ? baseComposer.contextMode
              : "general_file",
            availableContextModes,
            ...(input.onOpenModelSharing === undefined
              ? {}
              : { onOpenModelSharing: input.onOpenModelSharing })
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

function standaloneComposer(base: AgentComposerProps): AgentComposerProps {
  const {
    quickActions: _quickActions,
    references: _references,
    contextStatus: _contextStatus,
    permission: _permission,
    onOpenModelSharing: _onOpenModelSharing,
    ...rest
  } = base;
  void _quickActions;
  void _references;
  void _contextStatus;
  void _permission;
  void _onOpenModelSharing;
  return {
    ...rest,
    operationMode: "conversation",
    contextMode: "standalone_chat",
    availableContextModes: ["standalone_chat"],
    onOperationModeChange: () => undefined,
    onContextModeChange: () => undefined,
    onWritePolicyChange: () => undefined
  };
}

export function resolveAgentConversationWorkspacePresentation(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  activeProjectId: string | undefined,
  pendingMainReview: PendingAgentConversationMainReview | undefined,
  activeScope?: AgentContextScope
): AgentConversationWorkspacePresentation {
  if (activeProjectId === undefined) {
    return {
      workspace: activeScope?.kind === "standalone" ? workspace : undefined,
      shouldClearPendingMainReview: pendingMainReview !== undefined
    };
  }
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
  readonly scope?: AgentContextScope;
  readonly projectId: string | undefined;
  readonly workspaceKind?: "creativeProject" | "engineeringWorkspace" | "none";
  readonly onAgentRunChange: (agentRun: AgentRunPanelProps) => void;
  readonly onOpenMainReview: (review: AgentConversationMainReview) => void;
  readonly getStandaloneSelectedConversationId?: () => string | undefined;
  readonly onStandaloneSelectedConversationIdChange?: (
    conversationId: string | undefined
  ) => void | Promise<void>;
}): AgentConversationWorkspaceState {
  const {
    api,
    agentRunBridge,
    agentRun,
    scope: suppliedScope,
    projectId,
    workspaceKind,
    onAgentRunChange,
    onOpenMainReview,
    getStandaloneSelectedConversationId,
    onStandaloneSelectedConversationIdChange
  } = input;
  const scope = resolveWorkspaceScope(suppliedScope, projectId, workspaceKind);
  const scopeKey = scope === undefined ? undefined : agentContextScopeKey(scope);
  const bridge = useMemo(
    () =>
      api === undefined || agentRunBridge === undefined || scope === undefined
        ? undefined
        : createAgentConversationBridge(api, {
            resetRunWriteAuthorization: () => agentRunBridge.resetWriteAuthorization(),
            ...(getStandaloneSelectedConversationId === undefined
              ? {}
              : { getStandaloneSelectedConversationId }),
            ...(onStandaloneSelectedConversationIdChange === undefined
              ? {}
              : { onStandaloneSelectedConversationIdChange })
          }),
    [
      agentRunBridge,
      api,
      getStandaloneSelectedConversationId,
      onStandaloneSelectedConversationIdChange,
      scopeKey
    ]
  );
  const [conversation, setConversation] = useState(() => bridge?.getProps());

  useEffect(() => {
    setConversation(bridge?.getProps());
    return () => bridge?.dispose();
  }, [bridge]);

  useEffect(() => {
    if (bridge === undefined || scope === undefined) return;
    return bridge.subscribe(() => setConversation(bridge.getProps()));
  }, [bridge, scopeKey]);

  useEffect(() => {
    if (bridge === undefined || scope === undefined) return;
    void bridge.load(scope).then(setConversation);
  }, [bridge, scopeKey]);

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
    return { scope, selectedConversationId: undefined, workspace: undefined };
  }

  const apply = (operation: Promise<typeof conversation>): void => {
    void operation.then(setConversation);
  };
  return {
    scope,
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

function resolveWorkspaceScope(
  suppliedScope: AgentContextScope | undefined,
  projectId: string | undefined,
  workspaceKind: "creativeProject" | "engineeringWorkspace" | "none" | undefined
): AgentContextScope | undefined {
  if (suppliedScope !== undefined) {
    const scope = normalizeAgentContextScope(suppliedScope);
    if (scope.kind === "standalone") {
      if (projectId !== undefined || (workspaceKind !== undefined && workspaceKind !== "none")) {
        throw new Error("Standalone Agent scope must not include workspace identity.");
      }
      return scope;
    }
    if (projectId !== undefined && projectId !== scope.workspaceId) {
      throw new Error("Agent scope and projectId do not match.");
    }
    if (workspaceKind !== undefined && workspaceKind !== scope.workspaceKind) {
      throw new Error("Agent scope and workspace kind do not match.");
    }
    return scope;
  }
  if (projectId !== undefined) {
    return normalizeAgentContextScope(
      undefined,
      projectId,
      workspaceKind === "engineeringWorkspace" ? "engineeringWorkspace" : "creativeProject"
    );
  }
  return workspaceKind === "none" ? STANDALONE_AGENT_CONTEXT_SCOPE : undefined;
}
