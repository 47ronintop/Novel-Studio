import type {
  AgentContextSourceInput,
  AgentProviderCapabilitySnapshot,
  AgentRunCommandResult,
  AgentRunEvent,
  AgentRunSnapshot,
  DecideAgentPlanCommand,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  StartAgentRunCommand,
  StopAgentRunCommand
} from "@novel-studio/agent-engine";
import type { NovelStudioApi } from "@novel-studio/application";
import type {
  AgentRunPanelProps,
  ChapterEditorProps,
  ModelSettingsPanelProps
} from "@novel-studio/ui";

export interface AgentRunBridgeContext {
  readonly projectId: string;
  readonly activeChapterId?: string;
  readonly chapterEditor?: ChapterEditorProps;
  readonly settings?: ModelSettingsPanelProps;
}

export interface AgentRunBridge {
  getProps(): AgentRunPanelProps | undefined;
  syncContext(context: AgentRunBridgeContext): AgentRunPanelProps;
  load(projectId: string): Promise<AgentRunPanelProps>;
  send(request: string): Promise<AgentRunPanelProps>;
  stop(): Promise<AgentRunPanelProps>;
  answerUserInput(answer: string): Promise<AgentRunPanelProps>;
  resume(): Promise<AgentRunPanelProps>;
  retryStep(): Promise<AgentRunPanelProps>;
  refreshContext(decision: "refresh" | "exclude" | "cancel"): Promise<AgentRunPanelProps>;
  decidePlan(decision: "approve" | "reject"): Promise<AgentRunPanelProps>;
  subscribe(listener: () => void): () => void;
}

interface BridgeState {
  readonly operationMode: AgentRunPanelProps["operationMode"];
  readonly contextMode: AgentRunPanelProps["contextMode"];
  readonly userRequest: string;
  readonly snapshot: AgentRunSnapshot | undefined;
  readonly events: AgentRunEvent[];
  readonly assistantText: string;
  readonly pendingUserInput: AgentRunPanelProps["pendingUserInput"] | undefined;
  readonly planArtifact: AgentRunPanelProps["planArtifact"] | undefined;
  readonly errorMessage: string | undefined;
}

export function createAgentRunBridge(api: NovelStudioApi): AgentRunBridge {
  let context: AgentRunBridgeContext | undefined;
  let state: BridgeState = {
    operationMode: "planning",
    contextMode: "writing",
    userRequest: "",
    snapshot: undefined,
    events: [],
    assistantText: "",
    pendingUserInput: undefined,
    planArtifact: undefined,
    errorMessage: undefined
  };
  const listeners = new Set<() => void>();

  api.agentRuns.onEvent((event) => {
    if (context?.projectId !== event.projectId) return;
    if (state.snapshot !== undefined && state.snapshot.runId !== event.runId) return;
    state = {
      ...state,
      events: appendEvent(state.events, event),
      snapshot:
        state.snapshot === undefined
          ? state.snapshot
          : {
              ...state.snapshot,
              status: eventStatus(event.type) ?? state.snapshot.status,
              runRevision: event.runRevision,
              lastSequence: event.sequence,
              updatedAt: event.createdAt
            },
      assistantText:
        event.type === "assistant_text_delta"
          ? `${state.assistantText}${stringDetail(event.detail, "delta") ?? ""}`
          : state.assistantText,
      pendingUserInput:
        event.type === "user_input_requested"
          ? pendingInputFromDetail(event.detail)
          : event.type === "user_input_resolved"
            ? undefined
            : state.pendingUserInput,
      errorMessage:
        event.type === "run_failed" || event.type === "tool_failed"
          ? stringDetail(event.detail, "message") ?? "Agent run failed."
          : state.errorMessage,
      planArtifact:
        event.type === "plan_ready" && event.detail !== undefined
          ? (event.detail as unknown as AgentRunPanelProps["planArtifact"])
          : state.planArtifact
    };
    notify();
  });

  async function sendRun(request: string): Promise<AgentRunPanelProps> {
    state = { ...state, userRequest: request, errorMessage: undefined };
    const capability = buildCapabilitySnapshot(context?.settings);
    if (!capability.ok) {
      state = { ...state, errorMessage: capability.error.message };
      return toProps();
    }
    if (context === undefined) {
      state = { ...state, errorMessage: "项目尚未打开，无法启动 Agent。" };
      return toProps();
    }
    const command: StartAgentRunCommand = {
      projectId: context.projectId,
      commandId: createCommandId("start"),
      expectedRunRevision: 0,
      operationMode: state.operationMode,
      contextMode: state.contextMode,
      writePolicy: "write_before_confirmation",
      userRequest: request,
      providerCapabilitySnapshot: capability.value,
      initialContextSources: contextSources(context)
    };
    await applyCommandResult(await api.agentRuns.start(command));
    return toProps();
  }

  async function stopRun(): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    if (snapshot === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.stop({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("stop"),
        expectedRunRevision: snapshot.runRevision
      } satisfies StopAgentRunCommand)
    );
    return toProps();
  }

  async function answerRun(answer: string): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    const questionId = state.pendingUserInput?.questionId;
    if (snapshot === undefined || questionId === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.answerUserInput({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("answer"),
        expectedRunRevision: snapshot.runRevision,
        questionId,
        answer
      })
    );
    return toProps();
  }

  async function resumeRun(): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    if (snapshot === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.resume({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("resume"),
        expectedRunRevision: snapshot.runRevision
      } satisfies ResumeAgentRunCommand)
    );
    return toProps();
  }

  async function retryRun(): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    if (snapshot === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.retryStep({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("retry"),
        expectedRunRevision: snapshot.runRevision
      } satisfies RetryAgentRunStepCommand)
    );
    return toProps();
  }

  async function refreshRun(
    decision: "refresh" | "exclude" | "cancel"
  ): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    if (snapshot === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.refreshContext({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("context"),
        expectedRunRevision: snapshot.runRevision,
        decision,
        sourceRefs: contextSources(context).map((source) => source.refId),
        currentSources: contextSources(context)
      } satisfies RefreshAgentContextCommand)
    );
    return toProps();
  }

  async function decideRun(decision: "approve" | "reject"): Promise<AgentRunPanelProps> {
    const snapshot = requireSnapshot();
    const plan = state.planArtifact;
    if (snapshot === undefined || plan === undefined) return toProps();
    await applyCommandResult(
      await api.agentRuns.decidePlan({
        runId: snapshot.runId,
        projectId: snapshot.projectId,
        commandId: createCommandId("plan"),
        expectedRunRevision: snapshot.runRevision,
        planId: plan.planId,
        planRevision: plan.revision,
        decision,
        executionWritePolicy: "write_before_confirmation"
      } satisfies DecideAgentPlanCommand)
    );
    return toProps();
  }

  async function applyCommandResult(result: AgentRunCommandResult): Promise<void> {
    if (!result.ok) {
      state = {
        ...state,
        errorMessage: result.error.message,
        ...(result.latestSnapshot === undefined ? {} : { snapshot: result.latestSnapshot })
      };
      notify();
      return;
    }
    state = {
      ...state,
      snapshot: result.value,
      operationMode: result.value.operationMode,
      contextMode: result.value.contextMode,
      errorMessage: undefined
    };
    await hydrate(result.value.runId);
    notify();
  }

  async function hydrate(runId: string): Promise<void> {
    const result = await api.agentRuns.read(runId);
    if (!result.ok) {
      state = { ...state, errorMessage: result.error.message };
      return;
    }
    const read = result.value;
    state = {
      ...state,
      snapshot: read.snapshot,
      operationMode: read.snapshot.operationMode,
      contextMode: read.snapshot.contextMode,
      events: [...read.events],
      assistantText: read.events
        .filter((event) => event.type === "assistant_text_delta")
        .map((event) => stringDetail(event.detail, "delta") ?? "")
        .join(""),
      pendingUserInput: read.pendingUserInput,
      planArtifact: read.planArtifact
    };
  }

  function requireSnapshot(): AgentRunSnapshot | undefined {
    if (state.snapshot === undefined) {
      state = { ...state, errorMessage: "当前没有可操作的 Agent 运行。" };
      notify();
    }
    return state.snapshot;
  }

  function toProps(): AgentRunPanelProps {
    return {
      projectId: context?.projectId ?? state.snapshot?.projectId ?? "",
      ...(state.snapshot === undefined ? {} : { runId: state.snapshot.runId }),
      operationMode: state.operationMode,
      contextMode: state.contextMode,
      status: state.snapshot?.status ?? "idle",
      userRequest: state.userRequest,
      assistantText: state.assistantText,
      events: state.events,
      ...(state.pendingUserInput === undefined ? {} : { pendingUserInput: state.pendingUserInput }),
      ...(state.planArtifact === undefined ? {} : { planArtifact: state.planArtifact }),
      ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
      ...providerLabel(state.snapshot, context?.settings),
      ...(context?.chapterEditor?.dirty === true
        ? { contextSourceNotice: "使用未保存编辑器内容 · editor_buffer / dirty" }
        : {}),
      onOperationModeChange: (mode) => {
        state = { ...state, operationMode: mode };
        notify();
      },
      onContextModeChange: (mode) => {
        state = { ...state, contextMode: mode };
        notify();
      },
      onSend: (request) => void sendRun(request).then(notify),
      onStop: () => void stopRun().then(notify),
      onAnswerUserInput: (answer) => void answerRun(answer).then(notify),
      onResume: () => void resumeRun().then(notify),
      onRetryStep: () => void retryRun().then(notify),
      onRefreshContext: (decision) => void refreshRun(decision).then(notify),
      onDecidePlan: (decision) => void decideRun(decision).then(notify)
    };
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  const bridge: AgentRunBridge = {
    getProps: () => (context === undefined ? undefined : toProps()),
    syncContext(nextContext) {
      const projectChanged = context?.projectId !== nextContext.projectId;
      context = nextContext;
      if (projectChanged && state.snapshot?.projectId !== nextContext.projectId) {
        state = {
          ...state,
          snapshot: undefined,
          events: [],
          assistantText: "",
          pendingUserInput: undefined,
          planArtifact: undefined,
          errorMessage: undefined
        };
      }
      return toProps();
    },
    async load(projectId) {
      if (context === undefined || context.projectId !== projectId) {
        context = { projectId };
      }
      const listed = await api.agentRuns.list(projectId);
      if (!listed.ok) {
        state = { ...state, errorMessage: listed.error.message };
        return toProps();
      }
      const latest = [...listed.value]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .find((run) => run.status !== "completed" && run.status !== "cancelled");
      if (latest !== undefined) await hydrate(latest.runId);
      notify();
      return toProps();
    },
    async send(request) {
      const next = await sendRun(request);
      notify();
      return next;
    },
    async stop() {
      const next = await stopRun();
      notify();
      return next;
    },
    async answerUserInput(answer) {
      const next = await answerRun(answer);
      notify();
      return next;
    },
    async resume() {
      const next = await resumeRun();
      notify();
      return next;
    },
    async retryStep() {
      const next = await retryRun();
      notify();
      return next;
    },
    async refreshContext(decision) {
      const next = await refreshRun(decision);
      notify();
      return next;
    },
    async decidePlan(decision) {
      const next = await decideRun(decision);
      notify();
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return bridge;
}

function contextSources(context: AgentRunBridgeContext | undefined): AgentContextSourceInput[] {
  if (context?.activeChapterId === undefined || context.chapterEditor === undefined) return [];
  return [
    {
      refId: `chapter:${context.activeChapterId}`,
      sourceKind: context.chapterEditor.dirty ? "editor_buffer" : "disk_file",
      relativePath: `chapters/${context.activeChapterId}.md`,
      content: context.chapterEditor.chapter.body,
      dirty: context.chapterEditor.dirty
    }
  ];
}

function buildCapabilitySnapshot(
  settings: ModelSettingsPanelProps | undefined
):
  | { readonly ok: true; readonly value: AgentProviderCapabilitySnapshot }
  | { readonly ok: false; readonly error: { readonly message: string } } {
  const profile = settings?.profiles.find(
    (entry) => entry.id === (settings.selectedProfileId ?? settings.defaultProfileId)
  );
  if (profile === undefined) {
    return unsupportedCapability();
  }
  const discovered = settings?.modelDiscovery?.models.find((model) => model.id === profile.modelName);
  const contextWindow = discovered?.contextWindow ?? (profile.provider === "demo" ? 128000 : undefined);
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow < 8000) {
    return unsupportedCapability();
  }
  return {
    ok: true,
    value: {
      profileId: profile.id,
      provider: profile.provider,
      modelName: profile.modelName,
      streaming: true,
      toolCalling: true,
      structuredArguments: true,
      contextWindow,
      requiredContextTokens: 8000
    }
  };
}

function unsupportedCapability() {
  return {
    ok: false as const,
    error: { message: "The selected provider/model cannot start an Agent run." }
  };
}

function appendEvent(events: readonly AgentRunEvent[], event: AgentRunEvent): AgentRunEvent[] {
  return events.some((entry) => entry.sequence === event.sequence)
    ? [...events]
    : [...events, event].sort((left, right) => left.sequence - right.sequence);
}

function eventStatus(eventType: AgentRunEvent["type"]): AgentRunSnapshot["status"] | undefined {
  switch (eventType) {
    case "user_input_requested":
      return "awaiting_user_input";
    case "context_stale":
      return "awaiting_context_refresh";
    case "plan_ready":
      return "plan_ready";
    case "plan_execution_started":
      return "executing_model";
    case "run_completed":
      return "completed";
    case "run_cancelled":
      return "cancelled";
    case "run_failed":
      return "failed";
    case "run_limit_reached":
      return "limit_reached";
    case "run_started":
    case "run_resumed":
    case "user_input_resolved":
    case "context_refreshed":
    case "context_excluded":
    case "context_refresh_cancelled":
    case "plan_decision_resolved":
    case "tool_started":
    case "tool_completed":
    case "tool_failed":
    case "tool_retry_requested":
    case "assistant_text_delta":
    case "assistant_text_completed":
      return undefined;
  }
}

function pendingInputFromDetail(
  detail: AgentRunEvent["detail"]
): AgentRunPanelProps["pendingUserInput"] {
  if (detail === undefined) return undefined;
  const questionId = stringDetail(detail, "questionId");
  const prompt = stringDetail(detail, "prompt");
  const reason = stringDetail(detail, "reason");
  if (questionId === undefined || prompt === undefined || reason === undefined) return undefined;
  const rawOptions = detail["options"];
  const options = Array.isArray(rawOptions) ? rawOptions.filter(isOption) : [];
  return {
    questionId,
    prompt,
    reason,
    options,
    allowFreeText: detail["allowFreeText"] === true
  };
}

function isOption(value: unknown): value is { readonly id: string; readonly label: string } {
  if (typeof value !== "object" || value === null) return false;
  const option = value as { readonly id?: unknown; readonly label?: unknown };
  return typeof option.id === "string" && typeof option.label === "string";
}

function stringDetail(detail: AgentRunEvent["detail"], key: string): string | undefined {
  const value = detail?.[key];
  return typeof value === "string" ? value : undefined;
}

function createCommandId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
}

function providerLabel(
  snapshot: AgentRunSnapshot | undefined,
  settings: ModelSettingsPanelProps | undefined
): { readonly providerLabel: string } | object {
  const capability = snapshot?.providerCapabilitySnapshot;
  if (capability !== undefined) {
    return {
      providerLabel:
        capability.provider === "demo"
          ? `Demo · ${capability.modelName}`
          : `${capability.provider} · ${capability.modelName}`
    };
  }
  const profile = settings?.profiles.find(
    (entry) => entry.id === (settings.selectedProfileId ?? settings.defaultProfileId)
  );
  return profile === undefined
    ? {}
    : {
        providerLabel:
          profile.provider === "demo"
            ? `Demo · ${profile.modelName}`
            : `${profile.provider} · ${profile.modelName}`
      };
}
