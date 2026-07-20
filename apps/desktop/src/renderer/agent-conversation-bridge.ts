import type { AgentRunEvent, AgentRunSnapshot } from "@novel-studio/agent-engine";
import type {
  AgentConversationDiagnostic,
  AgentConversationListPage,
  AgentConversationReadResult,
  AgentConversationSearchPage,
  AgentConversationSummary,
  NovelStudioApi
} from "@novel-studio/application";
import type {
  AgentComposerProps,
  AgentConversationDetailProps,
  AgentConversationListItemProps,
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AgentPlanReviewProps,
  AgentRunPanelProps
} from "@novel-studio/ui";
import type { JsonObject } from "@novel-studio/shared";

export interface AgentConversationWorkspaceProps {
  readonly projectId: string;
  readonly conversations: readonly AgentConversationSummary[];
  readonly selectedConversationId?: string;
  readonly activeConversationId?: string;
  readonly selectedConversation?: AgentConversationReadResult;
  readonly searchQuery: string;
  readonly includeArchived: boolean;
  readonly loading: boolean;
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor?: string;
  readonly errorMessage?: string;
}

export interface AgentConversationBridgeOptions {
  readonly createCommandId?: (action: "create" | "archive" | "restore") => string;
  readonly resetRunWriteAuthorization?: () => void;
}

export interface AgentConversationBridge {
  getProps(): AgentConversationWorkspaceProps | undefined;
  load(projectId: string): Promise<AgentConversationWorkspaceProps>;
  create(): Promise<AgentConversationWorkspaceProps>;
  select(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  archive(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  restore(conversationId: string): Promise<AgentConversationWorkspaceProps>;
  search(query: string, includeArchived?: boolean): Promise<AgentConversationWorkspaceProps>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface AgentConversationWorkspaceActions {
  readonly onCreate: () => void;
  readonly onSelect: (conversationId: string) => void;
  readonly onArchive: (conversationId: string) => void;
  readonly onRestore: (conversationId: string) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onFilterChange: (filter: "active" | "archived") => void;
  readonly onReturnToActive: () => void;
  readonly onOpenMainReview?: ((review: AgentConversationMainReview) => void) | undefined;
}

interface BridgeState {
  readonly projectId: string | undefined;
  readonly conversations: readonly AgentConversationSummary[];
  readonly selectedConversationId: string | undefined;
  readonly activeConversationId: string | undefined;
  readonly selectedConversation: AgentConversationReadResult | undefined;
  readonly searchQuery: string;
  readonly includeArchived: boolean;
  readonly loading: boolean;
  readonly diagnostics: readonly AgentConversationDiagnostic[];
  readonly nextCursor: string | undefined;
  readonly errorMessage: string | undefined;
}

const DEFAULT_PAGE_LIMIT = 30;

export function createAgentConversationBridge(
  api: NovelStudioApi,
  options: AgentConversationBridgeOptions = {}
): AgentConversationBridge {
  const createCommandId = options.createCommandId ?? defaultCommandId;
  const listeners = new Set<() => void>();
  const runConversationIds = new Map<string, string>();
  const knownConversations = new Map<string, AgentConversationSummary>();
  let state: BridgeState = emptyState();

  const unsubscribeRunEvents = api.agentRuns.onEvent((event) => {
    void routeRunEvent(event);
  });

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function setLoading(loading: boolean): void {
    state = { ...state, loading, ...(loading ? { errorMessage: undefined } : {}) };
    notify();
  }

  function rememberSummary(summary: AgentConversationSummary): void {
    knownConversations.set(summary.conversationId, summary);
    if (summary.lastRunId !== undefined) {
      runConversationIds.set(summary.lastRunId, summary.conversationId);
    }
  }

  function applyListPage(page: AgentConversationListPage | AgentConversationSearchPage): void {
    for (const summary of page.items) rememberSummary(summary);
    state = {
      ...state,
      conversations: page.items,
      diagnostics: page.diagnostics,
      nextCursor: page.nextCursor,
      activeConversationId: findActiveConversation(knownConversations.values())
    };
  }

  function mergeSummary(summary: AgentConversationSummary): void {
    rememberSummary(summary);
    const conversations = [
      summary,
      ...state.conversations.filter((entry) => entry.conversationId !== summary.conversationId)
    ].sort(compareConversations);
    state = {
      ...state,
      conversations,
      activeConversationId: findActiveConversation(knownConversations.values())
    };
  }

  function rememberRuns(detail: AgentConversationReadResult): void {
    for (const run of detail.runs) {
      if (typeof run["runId"] === "string") {
        runConversationIds.set(run["runId"], detail.conversationId);
      }
    }
  }

  function resetSelection(): void {
    if (state.selectedConversationId !== undefined) options.resetRunWriteAuthorization?.();
    state = {
      ...state,
      selectedConversationId: undefined,
      selectedConversation: undefined
    };
  }

  async function hydrateSelection(
    conversationId: string | undefined
  ): Promise<AgentConversationReadResult | undefined> {
    const projectId = state.projectId;
    if (projectId === undefined || conversationId === undefined) {
      resetSelection();
      return undefined;
    }
    const read = await api.agentConversations.read({ projectId, conversationId });
    if (!read.ok) {
      state = { ...state, errorMessage: read.error.message };
      return undefined;
    }
    if (state.selectedConversationId !== conversationId) {
      options.resetRunWriteAuthorization?.();
    }
    rememberSummary(read.value);
    rememberRuns(read.value);
    state = {
      ...state,
      selectedConversationId: conversationId,
      selectedConversation: read.value,
      errorMessage: undefined
    };
    return read.value;
  }

  async function refreshList(): Promise<boolean> {
    const projectId = state.projectId;
    if (projectId === undefined) return false;
    const listed = await api.agentConversations.list({
      projectId,
      includeArchived: state.includeArchived,
      limit: DEFAULT_PAGE_LIMIT
    });
    if (!listed.ok) {
      state = { ...state, errorMessage: listed.error.message };
      return false;
    }
    applyListPage(listed.value);
    return true;
  }

  async function routeRunEvent(event: AgentRunEvent): Promise<void> {
    if (state.projectId !== event.projectId) return;
    let conversationId = runConversationIds.get(event.runId);
    let snapshot: AgentRunSnapshot | undefined;
    if (conversationId === undefined) {
      const read = await api.agentRuns.read(event.runId);
      if (!read.ok || read.value.snapshot.projectId !== state.projectId) return;
      snapshot = read.value.snapshot;
      conversationId = snapshot.conversationId ?? undefined;
      if (conversationId === undefined) return;
      runConversationIds.set(event.runId, conversationId);
    }

    let summary = knownConversations.get(conversationId);
    if (summary === undefined) {
      const read = await api.agentConversations.read({
        projectId: event.projectId,
        conversationId
      });
      if (!read.ok) return;
      summary = read.value;
      rememberSummary(summary);
      rememberRuns(read.value);
    }

    const status = snapshot?.status ?? statusForEvent(event.type, summary.lastRunStatus);
    const isNewRun = summary.lastRunId !== event.runId;
    const updatedSummary: AgentConversationSummary = {
      ...summary,
      updatedAt: laterTimestamp(summary.updatedAt, event.createdAt),
      lastRunId: event.runId,
      ...(status === undefined ? {} : { lastRunStatus: status }),
      ...(isNewRun ? { runCount: summary.runCount + 1 } : {})
    };
    rememberSummary(updatedSummary);
    state = {
      ...state,
      conversations: state.conversations.map((entry) =>
        entry.conversationId === conversationId ? updatedSummary : entry
      ),
      activeConversationId: findActiveConversation(knownConversations.values()),
      ...(state.selectedConversationId === conversationId &&
      state.selectedConversation !== undefined
        ? {
            selectedConversation: updateSelectedConversation(
              state.selectedConversation,
              updatedSummary,
              event,
              status,
              snapshot
            )
          }
        : {})
    };
    notify();
  }

  async function runStatusCommand(
    conversationId: string,
    action: "archive" | "restore"
  ): Promise<AgentConversationWorkspaceProps> {
    const projectId = state.projectId;
    const summary = knownConversations.get(conversationId);
    if (projectId === undefined || summary === undefined) {
      state = { ...state, errorMessage: "The Agent conversation is not available." };
      return requireProps();
    }
    setLoading(true);
    const command = {
      projectId,
      conversationId,
      commandId: createCommandId(action),
      expectedConversationRevision: summary.revision
    };
    const result =
      action === "archive"
        ? await api.agentConversations.archive(command)
        : await api.agentConversations.restore(command);
    if (!result.ok) {
      if (result.latestConversation !== undefined) mergeSummary(result.latestConversation);
      state = { ...state, loading: false, errorMessage: result.error.message };
      notify();
      return requireProps();
    }

    mergeSummary(result.value);
    await refreshList();
    if (action === "restore") {
      await hydrateSelection(conversationId);
    } else if (!state.includeArchived && state.selectedConversationId === conversationId) {
      await hydrateSelection(preferredConversationId(state.conversations));
    } else if (state.selectedConversationId === conversationId) {
      await hydrateSelection(conversationId);
    }
    state = { ...state, loading: false };
    notify();
    return requireProps();
  }

  const bridge: AgentConversationBridge = {
    getProps: () => (state.projectId === undefined ? undefined : toProps(state)),
    async load(projectId) {
      const projectChanged = state.projectId !== projectId;
      if (projectChanged) {
        if (state.projectId !== undefined) options.resetRunWriteAuthorization?.();
        runConversationIds.clear();
        knownConversations.clear();
        state = { ...emptyState(), projectId, loading: true };
      } else {
        setLoading(true);
      }
      const listed = await api.agentConversations.list({
        projectId,
        includeArchived: false,
        limit: DEFAULT_PAGE_LIMIT
      });
      if (!listed.ok) {
        state = { ...state, loading: false, errorMessage: listed.error.message };
        notify();
        return requireProps();
      }
      applyListPage(listed.value);
      const preferred = preferredConversationId(state.conversations);
      if (preferred === undefined) resetSelection();
      else await hydrateSelection(preferred);
      state = { ...state, loading: false };
      notify();
      return requireProps();
    },
    async create() {
      const projectId = state.projectId;
      if (projectId === undefined) return requireProps();
      setLoading(true);
      const created = await api.agentConversations.create({
        projectId,
        commandId: createCommandId("create")
      });
      if (!created.ok) {
        state = { ...state, loading: false, errorMessage: created.error.message };
        notify();
        return requireProps();
      }
      mergeSummary(created.value);
      await refreshList();
      await hydrateSelection(created.value.conversationId);
      state = { ...state, loading: false };
      notify();
      return requireProps();
    },
    async select(conversationId) {
      setLoading(true);
      await hydrateSelection(conversationId);
      state = { ...state, loading: false };
      notify();
      return requireProps();
    },
    archive: (conversationId) => runStatusCommand(conversationId, "archive"),
    restore: (conversationId) => runStatusCommand(conversationId, "restore"),
    async search(query, includeArchived = state.includeArchived) {
      const projectId = state.projectId;
      if (projectId === undefined) return requireProps();
      state = { ...state, searchQuery: query, includeArchived };
      setLoading(true);
      if (query.trim().length === 0) {
        await refreshList();
      } else {
        const searched = await api.agentConversations.search({
          projectId,
          query,
          includeArchived,
          limit: DEFAULT_PAGE_LIMIT
        });
        if (!searched.ok) {
          state = { ...state, loading: false, errorMessage: searched.error.message };
          notify();
          return requireProps();
        }
        applyListPage(searched.value);
      }
      state = { ...state, loading: false };
      notify();
      return requireProps();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      unsubscribeRunEvents();
      listeners.clear();
    }
  };

  return bridge;

  function requireProps(): AgentConversationWorkspaceProps {
    if (state.projectId === undefined) {
      throw new Error("AgentConversationBridge must be loaded before use.");
    }
    return toProps(state);
  }
}

function emptyState(): BridgeState {
  return {
    projectId: undefined,
    conversations: [],
    selectedConversationId: undefined,
    activeConversationId: undefined,
    selectedConversation: undefined,
    searchQuery: "",
    includeArchived: false,
    loading: false,
    diagnostics: [],
    nextCursor: undefined,
    errorMessage: undefined
  };
}

function toProps(state: BridgeState): AgentConversationWorkspaceProps {
  if (state.projectId === undefined) throw new Error("Agent conversation project is missing.");
  return {
    projectId: state.projectId,
    conversations: state.conversations,
    ...(state.selectedConversationId === undefined
      ? {}
      : { selectedConversationId: state.selectedConversationId }),
    ...(state.activeConversationId === undefined
      ? {}
      : { activeConversationId: state.activeConversationId }),
    ...(state.selectedConversation === undefined
      ? {}
      : { selectedConversation: state.selectedConversation }),
    searchQuery: state.searchQuery,
    includeArchived: state.includeArchived,
    loading: state.loading,
    diagnostics: state.diagnostics,
    ...(state.nextCursor === undefined ? {} : { nextCursor: state.nextCursor }),
    ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage })
  };
}

export function toAgentConversationWorkspaceProps(
  state: AgentConversationWorkspaceProps,
  agentRun: AgentRunPanelProps | undefined,
  composer: AgentComposerProps | undefined,
  planReview: AgentPlanReviewProps | undefined,
  actions: AgentConversationWorkspaceActions
): AgentConversationWorkspaceShellProps {
  const openPlanReview = planReview?.plan.status === "ready" ? planReview : undefined;
  const selectedRunIds = new Set(
    state.selectedConversation?.runs.flatMap((run) => {
      const runId = readRunString(run, "runId");
      return runId === undefined ? [] : [runId];
    }) ?? []
  );
  if (state.selectedConversation?.lastRunId !== undefined) {
    selectedRunIds.add(state.selectedConversation.lastRunId);
  }
  const selectedAgentRun =
    agentRun?.runId === undefined
      ? agentRun?.errorMessage !== undefined &&
        agentRun.projectId === state.projectId &&
        state.selectedConversation !== undefined
        ? agentRun
        : undefined
      : selectedRunIds.has(agentRun.runId)
        ? agentRun
        : undefined;
  const selectedPlanReview =
    openPlanReview !== undefined && selectedRunIds.has(openPlanReview.plan.sourceRunId)
      ? openPlanReview
      : undefined;
  const conversations = state.conversations.map((conversation) =>
    toConversationListItem(conversation, state.activeConversationId)
  );
  const conversation =
    state.selectedConversation === undefined
      ? undefined
      : toConversationDetail(
          state.selectedConversation,
          state.activeConversationId,
          liveAgentRunId(selectedAgentRun, selectedPlanReview)
        );
  const activeConversationTitle = state.conversations.find(
    (candidate) => candidate.conversationId === state.activeConversationId
  )?.title;

  const liveAgentRun =
    selectedAgentRun?.runId === undefined && selectedAgentRun?.errorMessage !== undefined
      ? selectedAgentRun
      : liveAgentRunId(selectedAgentRun, selectedPlanReview) === undefined
        ? undefined
        : selectedAgentRun;
  const navigableAgentRun = withMainReviewOpenActions(liveAgentRun, actions.onOpenMainReview);
  const mainReview = toAgentConversationMainReview(navigableAgentRun, selectedPlanReview);

  return {
    ...(mainReview === undefined ? {} : { mainReview }),
    navigator: {
      conversations,
      ...(state.selectedConversationId === undefined
        ? {}
        : { selectedConversationId: state.selectedConversationId }),
      ...(state.activeConversationId === undefined
        ? {}
        : { activeConversationId: state.activeConversationId }),
      searchQuery: state.searchQuery,
      filter: state.includeArchived ? "archived" : "active",
      loading: state.loading,
      ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
      onSearchQueryChange: actions.onSearchQueryChange,
      onFilterChange: actions.onFilterChange,
      onCreate: actions.onCreate,
      onSelect: actions.onSelect,
      onArchive: actions.onArchive,
      onRestore: actions.onRestore
    },
    view: {
      ...(conversation === undefined ? {} : { conversation }),
      ...(state.activeConversationId === undefined
        ? {}
        : { activeConversationId: state.activeConversationId }),
      ...(activeConversationTitle === undefined ? {} : { activeConversationTitle }),
      ...(navigableAgentRun === undefined ? {} : { agentRun: navigableAgentRun }),
      ...(composer === undefined ? {} : { composer }),
      ...(actions.onOpenMainReview === undefined
        ? {}
        : { onOpenMainReview: actions.onOpenMainReview }),
      loading: state.loading,
      ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
      onCreate: actions.onCreate,
      onArchive: actions.onArchive,
      onRestore: actions.onRestore,
      onReturnToActive: actions.onReturnToActive
    }
  };
}

function withMainReviewOpenActions(
  agentRun: AgentRunPanelProps | undefined,
  onOpenMainReview: ((review: AgentConversationMainReview) => void) | undefined
): AgentRunPanelProps | undefined {
  if (agentRun === undefined || onOpenMainReview === undefined) {
    return agentRun;
  }

  const changeSetReview = agentRun.changeSetReview;
  const rollbackReview = agentRun.rollbackReview;
  return {
    ...agentRun,
    ...(changeSetReview === undefined
      ? {}
      : {
          changeSetReview: {
            ...changeSetReview,
            onOpen: () => {
              changeSetReview.onOpen?.();
              onOpenMainReview({
                kind: "change_set",
                props: { ...changeSetReview, open: true }
              });
            }
          }
        }),
    ...(rollbackReview === undefined
      ? {}
      : {
          rollbackReview: {
            ...rollbackReview,
            onOpen: () => {
              rollbackReview.onOpen?.();
              onOpenMainReview({
                kind: "rollback",
                props: { ...rollbackReview, open: true }
              });
            }
          }
        })
  };
}

function toConversationListItem(
  conversation: AgentConversationSummary,
  activeConversationId: string | undefined
): AgentConversationListItemProps {
  const archiveBlocked = conversation.conversationId === activeConversationId;
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    status: conversation.status,
    updatedAtLabel: conversation.updatedAt,
    runCount: conversation.runCount,
    ...(conversation.lastRunStatus === undefined
      ? {}
      : { lastRunStatusLabel: conversation.lastRunStatus }),
    ...(conversation.preview === undefined ? {} : { preview: conversation.preview }),
    ...(conversation.virtual === true ? { virtual: true as const } : {}),
    canArchive: conversation.virtual !== true && !archiveBlocked,
    ...(archiveBlocked
      ? { archiveDisabledReason: "Stop the active run before archiving this conversation." }
      : {})
  };
}

function toConversationDetail(
  conversation: AgentConversationReadResult,
  activeConversationId: string | undefined,
  excludedRunId?: string
): AgentConversationDetailProps {
  return {
    ...toConversationListItem(conversation, activeConversationId),
    ...(conversation.contextSummary === undefined
      ? {}
      : { contextSummary: conversation.contextSummary }),
    turns: conversation.runs.flatMap((run) => {
      const runId = readRunString(run, "runId");
      const userRequest = readRunString(run, "userRequest");
      if (runId === undefined || userRequest === undefined) return [];
      if (runId === excludedRunId) return [];
      const assistantText = readRunString(run, "assistantText");
      const events = readRunEvents(run);
      return [
        {
          runId,
          userRequest,
          ...(assistantText === undefined ? {} : { assistantText }),
          ...(events.length === 0 ? {} : { events }),
          statusLabel: readRunString(run, "status") ?? "unknown",
          updatedAtLabel: readRunString(run, "updatedAt") ?? conversation.updatedAt
        }
      ];
    })
  };
}

function liveAgentRunId(
  agentRun: AgentRunPanelProps | undefined,
  planReview: AgentPlanReviewProps | undefined
): string | undefined {
  if (agentRun === undefined || agentRun.runId === undefined) return undefined;
  const runId = agentRun.runId;
  if (toAgentRecoveryReview(agentRun) !== undefined) return runId;
  if (!isTerminalRunStatus(agentRun.status)) return runId;
  if (
    agentRun.rollbackReview !== undefined &&
    agentRun.rollbackReview.review.status !== "completed"
  ) {
    return runId;
  }
  if (
    agentRun.changeSetReview !== undefined &&
    !["rejected", "applied", "abandoned"].includes(agentRun.changeSetReview.changeSet.status)
  ) {
    return runId;
  }
  if (agentRun.canUndoRun === true) return runId;
  if (planReview?.plan.sourceRunId === runId) return runId;
  if (agentRun.events.at(-1)?.type === "tool_failed") return runId;
  return undefined;
}

function toAgentConversationMainReview(
  agentRun: AgentRunPanelProps | undefined,
  planReview: AgentPlanReviewProps | undefined
): AgentConversationWorkspaceShellProps["mainReview"] {
  const recovery = toAgentRecoveryReview(agentRun);
  if (recovery !== undefined) return { kind: "recovery", props: recovery };
  if (agentRun?.rollbackReview !== undefined && agentRun.rollbackReview.open !== false) {
    return { kind: "rollback", props: agentRun.rollbackReview };
  }
  if (agentRun?.changeSetReview !== undefined && agentRun.changeSetReview.open !== false) {
    return { kind: "change_set", props: agentRun.changeSetReview };
  }
  if (planReview !== undefined) return { kind: "plan", props: planReview };
  return undefined;
}

function toAgentRecoveryReview(
  agentRun: AgentRunPanelProps | undefined
): Extract<AgentConversationMainReview, { readonly kind: "recovery" }>["props"] | undefined {
  if (agentRun?.runId === undefined) return undefined;
  const diagnostic = agentRun.diagnostic;
  const synchronizationEvent = [...agentRun.events]
    .reverse()
    .find(
      (event) =>
        event.type === "write_applied" &&
        event.detail?.["synchronizationStatus"] === "recovery_required"
    );
  if (diagnostic?.recoveryState !== "recovery_review" && synchronizationEvent === undefined) {
    return undefined;
  }

  const recoveryJournal = readObject(diagnostic?.redactedDetail["recoveryJournal"]);
  const versionGroupId =
    readString(recoveryJournal?.["versionGroupId"]) ??
    readString(synchronizationEvent?.detail?.["versionGroupId"]);
  const failedHooks = readStringArray(
    synchronizationEvent?.detail?.["synchronizationFailedHooks"] ??
      recoveryJournal?.["failedHooks"] ??
      diagnostic?.redactedDetail["failedHooks"]
  );
  const rollback = agentRun.rollbackReview?.onOpen;
  const retryTarget = diagnostic?.retryTargets[0];
  return {
    source: "agent_transaction",
    runId: agentRun.runId,
    ...(versionGroupId === undefined ? {} : { versionGroupId }),
    errorCode: diagnostic?.code ?? "AGENT_POST_COMMIT_SYNC_FAILED",
    message: diagnostic?.message ?? "事务已提交，但工作区同步需要恢复审阅。",
    failedHooks,
    ...(rollback === undefined ? {} : { onOpenRollback: rollback }),
    ...(retryTarget === undefined || agentRun.onRetryTarget === undefined
      ? {}
      : { onRetry: () => agentRun.onRetryTarget?.(retryTarget) })
  };
}

function readObject(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
}

function isTerminalRunStatus(status: AgentRunPanelProps["status"]): boolean {
  return ["completed", "cancelled", "failed", "limit_reached", "idle"].includes(status);
}

function readRunString(run: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = run[key];
  return typeof value === "string" ? value : undefined;
}

function preferredConversationId(
  conversations: readonly AgentConversationSummary[]
): string | undefined {
  return (
    conversations.find((conversation) => isActiveRunStatus(conversation.lastRunStatus)) ??
    conversations[0]
  )?.conversationId;
}

function findActiveConversation(
  conversations: Iterable<AgentConversationSummary>
): string | undefined {
  return [...conversations].find((conversation) => isActiveRunStatus(conversation.lastRunStatus))
    ?.conversationId;
}

function isActiveRunStatus(status: string | undefined): boolean {
  return (
    status !== undefined && !["completed", "cancelled", "failed", "limit_reached"].includes(status)
  );
}

function compareConversations(
  left: AgentConversationSummary,
  right: AgentConversationSummary
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.conversationId.localeCompare(right.conversationId)
  );
}

function statusForEvent(
  type: AgentRunEvent["type"],
  fallback: string | undefined
): string | undefined {
  switch (type) {
    case "tool_started":
      return "executing_read_tool";
    case "change_set_ready":
      return "awaiting_write_approval";
    case "write_started":
      return "applying_changes";
    case "user_input_requested":
      return "awaiting_user_input";
    case "context_stale":
      return "awaiting_context_refresh";
    case "plan_ready":
      return "plan_ready";
    case "plan_revision_requested":
      return "awaiting_plan_revision";
    case "run_completed":
      return "completed";
    case "run_cancelled":
      return "cancelled";
    case "run_failed":
      return "failed";
    case "run_limit_reached":
      return "limit_reached";
    default:
      return fallback;
  }
}

function updateSelectedConversation(
  selected: AgentConversationReadResult,
  summary: AgentConversationSummary,
  event: AgentRunEvent,
  status: string | undefined,
  snapshot: AgentRunSnapshot | undefined
): AgentConversationReadResult {
  const existing = selected.runs.find((run) => run["runId"] === event.runId);
  const updatedRun = {
    ...(existing ?? runSummaryFromSnapshot(snapshot, event)),
    runRevision: event.runRevision,
    lastSequence: event.sequence,
    updatedAt: event.createdAt,
    ...(status === undefined ? {} : { status }),
    ...activityEventsPatch(existing, event),
    ...assistantTextPatch(event)
  };
  const runs =
    existing === undefined
      ? [updatedRun, ...selected.runs]
      : selected.runs.map((run) => (run["runId"] === event.runId ? updatedRun : run));
  return {
    ...selected,
    ...summary,
    runs
  };
}

function runSummaryFromSnapshot(
  snapshot: AgentRunSnapshot | undefined,
  event: AgentRunEvent
): Readonly<Record<string, unknown>> {
  return {
    runId: event.runId,
    projectId: event.projectId,
    ...(snapshot?.conversationId === undefined ? {} : { conversationId: snapshot.conversationId }),
    userRequest: snapshot?.userRequest ?? "Agent request",
    status: snapshot?.status ?? statusForEvent(event.type, "created") ?? "created",
    runRevision: event.runRevision,
    lastSequence: event.sequence,
    startedAt: snapshot?.startedAt ?? event.createdAt,
    updatedAt: event.createdAt
  };
}

function assistantTextPatch(event: AgentRunEvent): Readonly<Record<string, string>> {
  if (event.type === "assistant_text_completed") {
    const text = event.detail?.["text"];
    return typeof text === "string" && text.length > 0 ? { assistantText: text } : {};
  }
  if (event.type === "run_completed") {
    const summary = event.detail?.["summary"];
    return typeof summary === "string" && summary.length > 0 ? { assistantText: summary } : {};
  }
  return {};
}

function activityEventsPatch(
  run: Readonly<Record<string, unknown>> | undefined,
  event: AgentRunEvent
): Readonly<Record<string, JsonObject[]>> {
  if (!CONVERSATION_ACTIVITY_EVENT_TYPES.has(event.type)) return {};
  const existing = run === undefined ? [] : readRunEventRecords(run);
  const projected = toConversationActivityEventRecord(event);
  return {
    events: [
      ...existing.filter((candidate) => candidate["sequence"] !== event.sequence),
      projected
    ].sort((left, right) => Number(left["sequence"]) - Number(right["sequence"]))
  };
}

const CONVERSATION_ACTIVITY_EVENT_TYPES = new Set<AgentRunEvent["type"]>([
  "tool_started",
  "tool_completed",
  "tool_failed",
  "change_set_ready"
]);

function toConversationActivityEventRecord(event: AgentRunEvent): JsonObject {
  return {
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    projectId: event.projectId,
    sequence: event.sequence,
    runRevision: event.runRevision,
    type: event.type,
    createdAt: event.createdAt,
    ...(event.detail === undefined ? {} : { detail: event.detail as JsonObject })
  };
}

function readRunEventRecords(run: Readonly<Record<string, unknown>>): JsonObject[] {
  const events = run["events"];
  return Array.isArray(events) ? events.filter(isJsonObject) : [];
}

function readRunEvents(run: Readonly<Record<string, unknown>>): AgentRunEvent[] {
  return readRunEventRecords(run).filter(isAgentRunEventRecord) as unknown as AgentRunEvent[];
}

function isAgentRunEventRecord(event: JsonObject): boolean {
  return (
    typeof event["schemaVersion"] === "string" &&
    typeof event["runId"] === "string" &&
    typeof event["projectId"] === "string" &&
    Number.isSafeInteger(event["sequence"]) &&
    Number.isSafeInteger(event["runRevision"]) &&
    typeof event["type"] === "string" &&
    typeof event["createdAt"] === "string"
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function laterTimestamp(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

let commandSequence = 0;

function defaultCommandId(action: "create" | "archive" | "restore"): string {
  commandSequence += 1;
  return `agent_conversation_${action}_${Date.now().toString(36)}_${commandSequence.toString(36)}`;
}
