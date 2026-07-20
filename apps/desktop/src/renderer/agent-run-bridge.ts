import type {
  AgentContextSourceInput,
  AgentReasoningEffort,
  AgentRunCommandResult,
  AgentRunDraft,
  AgentRunDraftMutation,
  AgentRunErrorRecord,
  AgentRunEvent,
  AgentRunRetryTarget,
  AgentRunSnapshot,
  ChangeSet,
  ContextBudgetSnapshot,
  ContextDraft,
  ContextDraftRef,
  DecideChangeSetCommand,
  DecideAgentPlanCommand,
  DecidePlanRevisionCommand,
  PermissionSummary,
  PlanExecutionRecord,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  RetryRunTargetCommand,
  StartAgentRunCommand,
  StopAgentRunCommand
} from "@novel-studio/agent-engine";
import type {
  AgentContextMode,
  AgentOperationMode,
  AgentRunDraftInitialization,
  AgentWritePolicy,
  ModelReasoningStrengthControl,
  ModelReasoningStrengthValue,
  NovelStudioApi,
  PlanArtifact
} from "@novel-studio/application";
import type {
  AgentComposerContextStatusControl,
  AgentComposerModelControl,
  AgentComposerPermissionControl,
  AgentComposerReasoningControl,
  AgentComposerReferenceChip,
  AgentComposerReferenceControl,
  AgentComposerReferenceKind,
  AgentComposerProps,
  AgentContextPrecision,
  AgentPlanReviewProps,
  AgentPlanExecutionControl,
  AgentRunPanelProps,
  ChangeSetReviewModel,
  ChangeSetSelection,
  ChapterEditorProps,
  ModelSettingsPanelProps,
  PlainFileEditorProps,
  RollbackReviewDecision,
  RollbackReviewModel
} from "@novel-studio/ui";

type AgentPlanExecutionOptions = NonNullable<
  Parameters<AgentPlanReviewProps["onDecision"]>[1]
>;

export interface AgentRunBridgeContext {
  readonly projectId: string;
  readonly workspaceKind?: "creativeProject" | "engineeringWorkspace";
  readonly conversationId?: string;
  readonly activeChapterId?: string;
  readonly chapterEditor?: ChapterEditorProps;
  readonly fileEditor?: PlainFileEditorProps;
  readonly settings?: ModelSettingsPanelProps;
}

export interface AgentRunBridge {
  getProps(): AgentRunPanelProps | undefined;
  getComposerProps(): AgentComposerProps | undefined;
  getPlanReviewProps(): AgentPlanReviewProps | undefined;
  syncContext(context: AgentRunBridgeContext): AgentRunPanelProps;
  load(projectId: string): Promise<AgentRunPanelProps>;
  loadRun(runId: string | undefined): Promise<AgentRunPanelProps>;
  resetWriteAuthorization(): void;
  send(request: string): Promise<AgentRunPanelProps>;
  stop(): Promise<AgentRunPanelProps>;
  answerUserInput(answer: string): Promise<AgentRunPanelProps>;
  resume(): Promise<AgentRunPanelProps>;
  retryStep(): Promise<AgentRunPanelProps>;
  retryTarget(target: AgentRunRetryTarget): Promise<AgentRunPanelProps>;
  refreshContext(decision: "refresh" | "exclude" | "cancel"): Promise<AgentRunPanelProps>;
  decidePlan(
    decision: "approve" | "reject",
    execution?: AgentPlanExecutionOptions
  ): Promise<AgentRunPanelProps>;
  updateChangeSetSelection(selection: ChangeSetSelection): Promise<AgentRunPanelProps>;
  applyChangeSet(): Promise<AgentRunPanelProps>;
  rejectChangeSet(): Promise<AgentRunPanelProps>;
  undoRun(): Promise<AgentRunPanelProps>;
  subscribe(listener: () => void): () => void;
}

interface BridgeState {
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly userRequest: string;
  readonly snapshot: AgentRunSnapshot | undefined;
  readonly events: AgentRunEvent[];
  readonly assistantText: string;
  readonly pendingUserInput: AgentRunPanelProps["pendingUserInput"] | undefined;
  readonly diagnostic: AgentRunErrorRecord | undefined;
  readonly planArtifact: PlanArtifact | undefined;
  readonly changeSet: ChangeSet | undefined;
  readonly reviewOpen: boolean;
  readonly rollbackReview: RollbackReviewModel | undefined;
  readonly rollbackReviewOpen: boolean;
  readonly rollbackDecisions: Readonly<Record<string, RollbackReviewDecision>>;
  readonly selectionPending: boolean;
  readonly errorMessage: string | undefined;
  /** The persisted run draft backing the composer's model/reasoning choices (server-authoritative). */
  readonly runDraft: AgentRunDraft | undefined;
  /** The persisted context draft backing the composer's references. */
  readonly contextDraft: ContextDraft | undefined;
  /** The latest server-resolved budget preview for the current draft revision (never renderer-authored). */
  readonly budgetPreview: ContextBudgetSnapshot | undefined;
  readonly draftPending: boolean;
  readonly permissionSummary: PermissionSummary | undefined;
  readonly permissionPending: boolean;
  readonly permissionError: string | undefined;
  readonly planExecution: PlanExecutionRecord | undefined;
}

export function createAgentRunBridge(api: NovelStudioApi): AgentRunBridge {
  let context: AgentRunBridgeContext | undefined;
  let state: BridgeState = {
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    userRequest: "",
    snapshot: undefined,
    events: [],
    assistantText: "",
    pendingUserInput: undefined,
    diagnostic: undefined,
    planArtifact: undefined,
    changeSet: undefined,
    reviewOpen: false,
    rollbackReview: undefined,
    rollbackReviewOpen: false,
    rollbackDecisions: {},
    selectionPending: false,
    errorMessage: undefined,
    runDraft: undefined,
    contextDraft: undefined,
    budgetPreview: undefined,
    draftPending: false,
    permissionSummary: undefined,
    permissionPending: false,
    permissionError: undefined,
    planExecution: undefined
  };
  const listeners = new Set<() => void>();
  let approvalInFlight: Promise<AgentRunPanelProps> | undefined;
  let selectionInFlight: Promise<AgentRunPanelProps> | undefined;
  let undoInFlight: Promise<AgentRunPanelProps> | undefined;
  let undoInFlightAction: "request" | "resolve" | "retry" | undefined;
  let draftInFlight: Promise<void> | undefined;
  let planDecisionInFlight: Promise<AgentRunPanelProps> | undefined;
  let retryTargetInFlight: Promise<AgentRunPanelProps> | undefined;
  let permissionSummaryRequested = false;
  // Increments on every conversation switch so a slow in-flight draft load for a previous
  // conversation can detect it is stale and drop its result instead of clobbering the new one.
  let draftToken = 0;
  // The Stage 5 draft/budget/compaction methods, viewed as optional: pre-Stage-5 hosts (and the
  // test fakes) do not implement them, so the composer degrades to its flat, non-draft-backed form.
  const draftApi = api.agentRuns as unknown as OptionalDraftApi;
  const stage5BApi = api.agentRuns as unknown as OptionalStage5BApi;

  api.agentRuns.onEvent((event) => {
    if (context?.projectId !== event.projectId) return;
    if (state.snapshot !== undefined && state.snapshot.runId !== event.runId) return;
    const nextSnapshot =
      state.snapshot === undefined
        ? state.snapshot
        : {
            ...state.snapshot,
            status: eventStatus(event.type) ?? state.snapshot.status,
            runRevision: event.runRevision,
            lastSequence: event.sequence,
            updatedAt: event.createdAt
          };
    state = {
      ...state,
      events: appendEvent(state.events, event),
      snapshot: nextSnapshot,
      ...(nextSnapshot !== undefined && isTerminalRunStatus(nextSnapshot.status)
        ? defaultNextRunWriteAuthorization()
        : {}),
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
        event.type === "run_failed" && event.detail?.["diagnosticPersistenceFailed"] === true
          ? "Agent run failed, and diagnostic details could not be saved."
          : event.type === "run_failed" || event.type === "tool_failed"
            ? undefined
          : state.errorMessage,
      planArtifact:
        event.type === "plan_ready" && event.detail !== undefined
          ? (event.detail as unknown as PlanArtifact)
          : state.planArtifact
    };
    notify();
    if (
      event.type === "change_set_ready" ||
      event.type === "approval_resolved" ||
      event.type === "write_applied" ||
      event.type === "write_failed" ||
      event.type === "permission_summary_ready" ||
      event.type === "plan_step_started" ||
      event.type === "plan_step_completed" ||
      event.type === "plan_step_blocked" ||
      event.type === "plan_step_skipped" ||
      event.type === "plan_deviation_recorded" ||
      event.type === "plan_revision_requested" ||
      event.type === "error_recorded" ||
      event.type === "plan_decision_resolved"
    ) {
      void hydrate(event.runId).then(notify);
    }
  });

  async function sendRun(request: string): Promise<AgentRunPanelProps> {
    state = { ...state, userRequest: request, errorMessage: undefined };
    // The draft is the source of truth for model/reasoning/refs when the composer is draft-backed;
    // otherwise fall back to the project's selected profile and the active chapter.
    const profileId = state.runDraft?.modelProfileId ?? selectedModelProfileId(context?.settings);
    if (profileId === undefined) {
      state = { ...state, errorMessage: "The selected provider/model cannot start an Agent run." };
      return toProps();
    }
    if (context === undefined) {
      state = { ...state, errorMessage: "项目尚未打开，无法启动 Agent。" };
      return toProps();
    }
    if (context.conversationId === undefined) {
      state = { ...state, errorMessage: "请先选择一个会话。" };
      return toProps();
    }
    // Server-authoritative start: persist the user's intent as a draft, then start by reference.
    // The renderer authors only choices (mode, model, request, context refs) — never provider,
    // capabilities, context window, or resolved document content.
    const writePolicy =
      state.operationMode === "planning" ? "write_before_confirmation" : state.writePolicy;
    const reasoningEffort = state.runDraft?.reasoningEffort;
    const contextRefs = state.contextDraft?.refs ?? contextDraftRefs(context);
    const prepared = await api.agentRuns.prepareStart({
      projectId: context.projectId,
      conversationId: context.conversationId,
      commandId: createCommandId("prepare"),
      userRequest: request,
      operationMode: state.operationMode,
      contextMode: state.contextMode,
      writePolicy,
      writePolicyAcknowledged:
        state.operationMode === "execution" &&
        state.writePolicy === "user_preapproved_run" &&
        state.writePolicyAcknowledged,
      modelProfileId: profileId,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      contextRefs
    });
    if (!prepared.ok) {
      state = { ...state, errorMessage: prepared.error.message };
      return toProps();
    }
    const command: StartAgentRunCommand = {
      projectId: context.projectId,
      conversationId: context.conversationId,
      commandId: createCommandId("start"),
      expectedRunRevision: 0,
      runDraftId: prepared.value.runDraft.runDraftId,
      runDraftRevision: prepared.value.runDraft.revision,
      runDraftChecksum: prepared.value.runDraft.checksum
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

  function retryTargetRun(target: AgentRunRetryTarget): Promise<AgentRunPanelProps> {
    if (retryTargetInFlight !== undefined) return retryTargetInFlight;
    const request = (async () => {
      const snapshot = requireSnapshot();
      const diagnostic = state.diagnostic;
      if (snapshot === undefined || diagnostic === undefined) return toProps();
      const persistedTarget = diagnostic.retryTargets.find(
        (candidate) => candidate.kind === target.kind && candidate.id === target.id
      );
      if (persistedTarget === undefined) {
        state = { ...state, errorMessage: "The selected retry target is no longer available." };
        return toProps();
      }
      await applyCommandResult(
        await api.agentRuns.retryTarget({
          runId: snapshot.runId,
          projectId: snapshot.projectId,
          commandId: createCommandId("retry_target"),
          expectedRunRevision: snapshot.runRevision,
          errorId: diagnostic.errorId,
          target: persistedTarget
        } satisfies RetryRunTargetCommand)
      );
      return toProps();
    })();
    retryTargetInFlight = request;
    const clear = () => {
      if (retryTargetInFlight === request) retryTargetInFlight = undefined;
    };
    void request.then(clear, clear);
    return request;
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

  async function decideRun(
    decision: "approve" | "reject",
    execution?: AgentPlanExecutionOptions
  ): Promise<AgentRunPanelProps> {
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
        ...(decision === "approve"
          ? {
              executionContextMode: execution?.executionContextMode ?? snapshot.contextMode,
              ...(execution?.executionWritePolicy === "user_preapproved_run" &&
              execution.executionWritePolicyAcknowledged === true
                ? {
                    executionWritePolicy: "user_preapproved_run" as const,
                    executionWritePolicyAcknowledged: true as const
                  }
                : {})
            }
          : {})
      } satisfies DecideAgentPlanCommand)
    );
    return toProps();
  }

  function updateChangeSetSelection(
    selection: ChangeSetSelection
  ): Promise<AgentRunPanelProps> {
    if (selectionInFlight !== undefined) return selectionInFlight;
    const snapshot = requireSnapshot();
    const changeSet = state.changeSet;
    if (snapshot === undefined || changeSet === undefined) return Promise.resolve(toProps());
    state = { ...state, selectionPending: true };
    notify();
    const command: DecideChangeSetCommand = {
      runId: snapshot.runId,
      projectId: snapshot.projectId,
      commandId: createCommandId("change-set-selection"),
      expectedRunRevision: snapshot.runRevision,
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      decision: "update_selection",
      files: selection.files
    };
    const request = (async () => {
      try {
        await applyCommandResult(
          await api.agentRuns.decideChangeSet(command)
        );
      } finally {
        state = { ...state, selectionPending: false };
        selectionInFlight = undefined;
        notify();
      }
      return toProps();
    })();
    selectionInFlight = request;
    return request;
  }

  function decideChangeSet(
    decision: "apply_selected" | "reject_all"
  ): Promise<AgentRunPanelProps> {
    if (approvalInFlight !== undefined) return approvalInFlight;
    const snapshot = requireSnapshot();
    const changeSet = state.changeSet;
    if (snapshot === undefined || changeSet === undefined) return Promise.resolve(toProps());
    const command: DecideChangeSetCommand = {
      runId: snapshot.runId,
      projectId: snapshot.projectId,
      commandId: createCommandId("change-set-decision"),
      expectedRunRevision: snapshot.runRevision,
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      decision
    };
    const request = (async () => {
      try {
        await applyCommandResult(await api.agentRuns.decideChangeSet(command));
      } finally {
        approvalInFlight = undefined;
        notify();
      }
      return toProps();
    })();
    approvalInFlight = request;
    notify();
    return request;
  }

  function undoAgentRun(): Promise<AgentRunPanelProps> {
    if (undoInFlight !== undefined) return undoInFlight;
    const snapshot = requireSnapshot();
    if (snapshot === undefined || !canUndoAppliedRun(state)) return Promise.resolve(toProps());
    if (state.rollbackReview !== undefined && !state.rollbackReviewOpen) {
      state = { ...state, rollbackReviewOpen: true };
      notify();
    }
    const request = (async () => {
      try {
        await applyCommandResult(
          await api.agentRuns.undoRun({
            action: "request",
            runId: snapshot.runId,
            projectId: snapshot.projectId,
            commandId: createCommandId("undo-run"),
            expectedRunRevision: snapshot.runRevision
          })
        );
      } finally {
        undoInFlight = undefined;
        undoInFlightAction = undefined;
        notify();
      }
      return toProps();
    })();
    undoInFlight = request;
    undoInFlightAction = "request";
    notify();
    return request;
  }

  function resolveRollbackReview(retryFailedOnly: boolean): Promise<AgentRunPanelProps> {
    const action = retryFailedOnly ? "retry" : "resolve";
    if (undoInFlight !== undefined) {
      if (undoInFlightAction === action) return undoInFlight;
      return undoInFlight.then(() => resolveRollbackReview(retryFailedOnly));
    }
    const snapshot = requireSnapshot();
    const review = state.rollbackReview;
    if (snapshot === undefined || review === undefined) return Promise.resolve(toProps());
    const decisions = Object.entries(state.rollbackDecisions).map(
      ([relativePath, decision]) => ({ relativePath, decision })
    );
    const request = (async () => {
      try {
        await applyCommandResult(
          await api.agentRuns.undoRun({
            action: "resolve",
            runId: snapshot.runId,
            projectId: snapshot.projectId,
            commandId: createCommandId("resolve-run-undo"),
            expectedRunRevision: snapshot.runRevision,
            reviewId: review.reviewId,
            ...(retryFailedOnly
              ? { retryFailedOnly: true }
              : decisions.length === 0
                ? {}
                : { decisions })
          })
        );
      } finally {
        undoInFlight = undefined;
        undoInFlightAction = undefined;
        notify();
      }
      return toProps();
    })();
    undoInFlight = request;
    undoInFlightAction = action;
    notify();
    return request;
  }

  async function applyCommandResult(result: AgentRunCommandResult): Promise<void> {
    if (!result.ok) {
      const errorMessage = result.error.message;
      state = {
        ...state,
        errorMessage,
        ...(result.latestSnapshot === undefined ? {} : { snapshot: result.latestSnapshot })
      };
      if (result.latestSnapshot !== undefined) {
        await hydrate(result.latestSnapshot.runId);
      }
      notify();
      return;
    }
    state = {
      ...state,
      snapshot: result.value,
      operationMode: result.value.operationMode,
      contextMode: result.value.contextMode,
      ...writeAuthorizationForSnapshot(result.value),
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
    const permission = await readBoundPermissionSummary(read.snapshot);
    const nextChangeSet = read.changeSet;
    const nextRollbackReview = rollbackReviewFromRead(read.rollbackReview);
    const sameRollbackReview = hasSameRollbackDecisionContext(
      state.rollbackReview,
      nextRollbackReview
    );
    state = {
      ...state,
      snapshot: read.snapshot,
      operationMode: read.snapshot.operationMode,
      contextMode: read.snapshot.contextMode,
      userRequest: read.snapshot.userRequest,
      ...writeAuthorizationForSnapshot(read.snapshot),
      events: [...read.events],
      assistantText: read.events
        .filter((event) => event.type === "assistant_text_delta")
        .map((event) => stringDetail(event.detail, "delta") ?? "")
        .join(""),
      pendingUserInput: read.pendingUserInput,
      diagnostic: read.diagnostic,
      errorMessage: read.diagnostic === undefined ? state.errorMessage : undefined,
      planArtifact: read.planArtifact,
      planExecution: read.planExecution,
      permissionSummary: permission.summary,
      permissionPending: false,
      permissionError: permission.errorMessage,
      changeSet: nextChangeSet,
      rollbackReview: nextRollbackReview,
      rollbackReviewOpen:
        nextRollbackReview === undefined
          ? false
          : sameRollbackReview
            ? state.rollbackReviewOpen
            : true,
      rollbackDecisions: sameRollbackReview ? state.rollbackDecisions : {},
      reviewOpen:
        nextChangeSet === undefined
          ? false
          : state.changeSet?.changeSetId !== nextChangeSet.changeSetId
            ? true
            : state.reviewOpen
    };
  }

  async function readBoundPermissionSummary(snapshot: AgentRunSnapshot): Promise<{
    readonly summary: PermissionSummary | undefined;
    readonly errorMessage: string | undefined;
  }> {
    if (snapshot.permissionSummaryId === null) {
      return { summary: undefined, errorMessage: undefined };
    }
    if (
      state.permissionSummary?.permissionSummaryId === snapshot.permissionSummaryId &&
      state.permissionSummary?.checksum === snapshot.permissionSummaryChecksum
    ) {
      return { summary: state.permissionSummary, errorMessage: undefined };
    }
    const readPermissionSummary = stage5BApi.readPermissionSummary;
    if (readPermissionSummary === undefined) {
      return { summary: undefined, errorMessage: undefined };
    }
    const result = await readPermissionSummary({
      kind: "run",
      projectId: snapshot.projectId,
      runId: snapshot.runId,
      permissionSummaryId: snapshot.permissionSummaryId
    });
    if (!result.ok) return { summary: undefined, errorMessage: result.error.message };
    if (result.value === undefined || result.value.checksum !== snapshot.permissionSummaryChecksum) {
      return {
        summary: undefined,
        errorMessage: "权限摘要与当前运行绑定不一致，请重新加载。"
      };
    }
    return { summary: result.value, errorMessage: undefined };
  }

  function requireSnapshot(): AgentRunSnapshot | undefined {
    if (state.snapshot === undefined) {
      state = { ...state, errorMessage: "当前没有可操作的 Agent 运行。" };
      notify();
    }
    return state.snapshot;
  }

  function planExecutionControl(): AgentPlanExecutionControl | undefined {
    if (state.planExecution === undefined) return undefined;
    const revisionRequest = pendingPlanRevisionRequest();
    return {
      record: state.planExecution,
      ...(state.planArtifact === undefined ? {} : { plan: state.planArtifact }),
      ...(revisionRequest === undefined ? {} : { revisionRequest }),
      deciding: planDecisionInFlight !== undefined,
      onDecideRevision: (decision) => void decidePendingPlanRevision(decision)
    };
  }

  function pendingPlanRevisionRequest(): AgentPlanExecutionControl["revisionRequest"] {
    if (state.snapshot?.status !== "awaiting_plan_revision" || state.planExecution === undefined) {
      return undefined;
    }
    const requested = [...state.events]
      .reverse()
      .find((event) => event.type === "plan_revision_requested");
    const detail = requested?.detail;
    const requestId = typeof detail?.["requestId"] === "string" ? detail["requestId"] : undefined;
    const planId = typeof detail?.["planId"] === "string" ? detail["planId"] : undefined;
    const planRevision = detail?.["planRevision"];
    const discovery = typeof detail?.["discovery"] === "string" ? detail["discovery"] : undefined;
    const proposal = typeof detail?.["proposal"] === "string" ? detail["proposal"] : undefined;
    const affectedStepIds = Array.isArray(detail?.["affectedStepIds"])
      ? detail["affectedStepIds"].filter((stepId): stepId is string => typeof stepId === "string")
      : [];
    if (
      requestId === undefined ||
      planId !== state.planExecution.planId ||
      !Number.isSafeInteger(planRevision) ||
      Number(planRevision) <= state.planExecution.planRevision ||
      discovery === undefined ||
      proposal === undefined ||
      affectedStepIds.length === 0
    ) {
      return undefined;
    }
    return {
      requestId,
      planExecutionId: state.planExecution.planExecutionId,
      planId,
      planRevision: Number(planRevision),
      originalPlan: state.planArtifact?.goal ?? `${planId} v${state.planExecution.planRevision}`,
      discovery,
      proposal,
      affectedStepIds
    };
  }

  function decidePendingPlanRevision(
    decision: "approve" | "reject"
  ): Promise<AgentRunPanelProps> {
    if (planDecisionInFlight !== undefined) return planDecisionInFlight;
    const snapshot = requireSnapshot();
    const request = pendingPlanRevisionRequest();
    const decidePlanRevision = stage5BApi.decidePlanRevision;
    if (snapshot === undefined || request === undefined || decidePlanRevision === undefined) {
      return Promise.resolve(toProps());
    }
    const command: DecidePlanRevisionCommand = {
      runId: snapshot.runId,
      projectId: snapshot.projectId,
      commandId: createCommandId("plan-revision"),
      expectedRunRevision: snapshot.runRevision,
      requestId: request.requestId,
      planId: request.planId,
      planRevision: request.planRevision,
      decision
    };
    const pending = (async () => {
      try {
        await applyCommandResult(await decidePlanRevision(command));
      } finally {
        planDecisionInFlight = undefined;
        notify();
      }
      return toProps();
    })();
    planDecisionInFlight = pending;
    notify();
    return pending;
  }

  function toProps(): AgentRunPanelProps {
    const planExecution = planExecutionControl();
    return {
      projectId: context?.projectId ?? state.snapshot?.projectId ?? "",
      ...(state.snapshot === undefined ? {} : { runId: state.snapshot.runId }),
      status: state.snapshot?.status ?? "idle",
      assistantText: state.assistantText,
      events: state.events,
      ...(state.pendingUserInput === undefined ? {} : { pendingUserInput: state.pendingUserInput }),
      ...(state.diagnostic === undefined ? {} : { diagnostic: state.diagnostic }),
      ...(state.changeSet === undefined
        ? {}
        : {
            changeSetReview: {
              changeSet: toChangeSetReviewModel(state.changeSet),
              runRevision: state.snapshot?.runRevision ?? 0,
              applying:
                state.snapshot?.status === "applying_changes" ||
                approvalInFlight !== undefined ||
                undoInFlight !== undefined,
              stale:
                state.changeSet.status === "stale" ||
                state.snapshot?.status === "awaiting_context_refresh",
              selectionPending: state.selectionPending,
              baseHashConflictPaths: conflictPaths(state.events, state.changeSet),
              dirtyTargetPaths: dirtyTargetPaths(context, state.changeSet),
              open: state.reviewOpen,
              onOpen: () => {
                state = { ...state, reviewOpen: true };
                notify();
              },
              onSelectionChange: (selection: ChangeSetSelection) => {
                void updateChangeSetSelection(selection);
              },
              onApply: () => {
                void decideChangeSet("apply_selected");
              },
              onReject: () => {
                void decideChangeSet("reject_all");
              },
              onReturn: () => {
                state = { ...state, reviewOpen: false };
                notify();
              },
              canUndoRun: canUndoAppliedRun(state),
              onUndoRun: () => {
                void undoAgentRun();
              }
            }
          }),
      ...(state.rollbackReview === undefined
        ? {}
        : {
            rollbackReview: {
              review: state.rollbackReview,
              applying: undoInFlight !== undefined,
              open: state.rollbackReviewOpen,
              onOpen: () => {
                state = { ...state, rollbackReviewOpen: true };
                notify();
              },
              decisions: state.rollbackDecisions,
              onDecisionChange: (relativePath, decision) => {
                state = {
                  ...state,
                  rollbackDecisions: { ...state.rollbackDecisions, [relativePath]: decision }
                };
                notify();
              },
              onApply: () => {
                void resolveRollbackReview(false);
              },
              onRetryFailed: () => {
                void resolveRollbackReview(true);
              },
              onReturn: () => {
                state = { ...state, rollbackReviewOpen: false };
                notify();
              }
            }
          }),
      ...(planExecution === undefined ? {} : { planExecution }),
      ...(state.operationMode === "execution"
        ? {
            canUndoRun: canUndoAppliedRun(state),
            onUndoRun: () => {
              void undoAgentRun();
            }
          }
        : {}),
      ...(state.errorMessage === undefined ? {} : { errorMessage: state.errorMessage }),
      ...providerLabel(state.snapshot, context?.settings),
      ...(context?.chapterEditor?.dirty === true
        ? { contextSourceNotice: "使用未保存编辑器内容 · editor_buffer / dirty" }
        : {}),
      onAnswerUserInput: (answer) => void answerRun(answer).then(notify),
      onResume: () => void resumeRun().then(notify),
      onRetryStep: () => void retryRun().then(notify),
      onRetryTarget: (target) => void retryTargetRun(target).then(notify),
      onRefreshContext: (decision) => void refreshRun(decision).then(notify)
    };
  }

  /**
   * Load (or lazily initialize) the persisted run/context draft for the current conversation so the
   * composer's model, reasoning, and reference controls are server-authoritative. No-ops when the
   * host does not implement the Stage 5 draft methods, when no conversation is selected, or when the
   * settings cannot name a model profile — the composer then keeps its flat, non-draft-backed form.
   */
  function loadDraft(): void {
    const readRunDraft = draftApi.readRunDraft;
    const ctx = context;
    if (readRunDraft === undefined || ctx?.conversationId === undefined) return;
    const modelProfileId = selectedModelProfileId(ctx.settings);
    if (modelProfileId === undefined) return;
    const projectId = ctx.projectId;
    const conversationId = ctx.conversationId;
    draftToken += 1;
    const token = draftToken;
    const initialize: AgentRunDraftInitialization = {
      modelProfileId,
      operationMode: state.operationMode,
      contextMode: state.contextMode,
      writePolicy: state.writePolicy,
      writePolicyAcknowledged: state.writePolicyAcknowledged,
      contextRefs: contextDraftRefs(ctx)
    };
    state = { ...state, draftPending: true };
    void (async () => {
      const result = await readRunDraft({ projectId, conversationId, initialize });
      if (token !== draftToken) return;
      if (!result.ok) {
        state = { ...state, draftPending: false };
        notify();
        return;
      }
      const normalizeForEngineering =
        ctx.workspaceKind === "engineeringWorkspace" &&
        result.value.runDraft.contextMode !== "general_file";
      state = {
        ...state,
        runDraft: result.value.runDraft,
        contextDraft: result.value.contextDraft,
        operationMode: result.value.runDraft.operationMode,
        contextMode: normalizeForEngineering ? "general_file" : result.value.runDraft.contextMode,
        writePolicy: result.value.runDraft.writePolicy,
        writePolicyAcknowledged: result.value.runDraft.writePolicyAcknowledged,
        permissionSummary: undefined,
        permissionError: undefined,
        draftPending: false
      };
      notify();
      if (normalizeForEngineering) {
        updateRunDraftChoice({ kind: "set_context_mode", contextMode: "general_file" }, true);
        return;
      }
      await previewBudget(token);
    })();
  }

  /** Refresh the server-resolved budget preview for the current draft revision. */
  async function previewBudget(token: number): Promise<void> {
    const previewContextBudget = draftApi.previewContextBudget;
    const ctx = context;
    const draft = state.runDraft;
    if (previewContextBudget === undefined || ctx?.conversationId === undefined || draft === undefined) {
      return;
    }
    const result = await previewContextBudget({
      projectId: ctx.projectId,
      conversationId: ctx.conversationId,
      commandId: createCommandId("preview-budget"),
      runDraftId: draft.runDraftId,
      expectedDraftRevision: draft.revision,
      runDraftChecksum: draft.checksum
    });
    if (token !== draftToken) return;
    state = {
      ...state,
      budgetPreview: result.ok ? result.value : undefined,
      ...(result.ok ? {} : { errorMessage: result.error.message })
    };
    notify();
  }

  /**
   * Serialize draft mutations so each one applies against the latest persisted revision (a stale
   * `expectedDraftRevision` is rejected server-side). Mirrors the `updateChangeSetSelection`
   * in-flight guard: concurrent edits queue rather than race.
   */
  function queueDraftMutation(execute: () => Promise<void>): Promise<void> {
    const previous = draftInFlight ?? Promise.resolve();
    const next = previous.then(execute).finally(() => {
      if (draftInFlight === next) {
        draftInFlight = undefined;
        state = { ...state, draftPending: false };
        notify();
      }
    });
    draftInFlight = next;
    state = { ...state, draftPending: true };
    notify();
    return next;
  }

  function updateRunDraftChoice(mutation: AgentRunDraftMutation, refreshBudget: boolean): void {
    const updateRunDraft = draftApi.updateRunDraft;
    if (updateRunDraft === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.runDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await updateRunDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-choice"),
        expectedDraftRevision: draft.revision,
        mutation
      });
      applyDraftResult(result, token);
      if (refreshBudget) await previewBudget(token);
    }).then(() => {
      if (permissionSummaryRequested) void loadPermissionSummary();
    });
  }

  function updateModelDraft(modelProfileId: string): void {
    const updateRunDraft = draftApi.updateRunDraft;
    if (updateRunDraft === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.runDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await updateRunDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-model"),
        expectedDraftRevision: draft.revision,
        // A model change invalidates the old budget; the session normalizes reasoning to the new
        // model's declared capabilities, so we deliberately send no reasoningEffort here.
        mutation: { kind: "set_model", modelProfileId }
      });
      applyDraftResult(result, token);
      // The new profile's context window changes the budget — re-preview against the new revision.
      await previewBudget(token);
    });
  }

  function updateReasoningDraft(reasoningEffort: ModelReasoningStrengthValue): void {
    const updateRunDraft = draftApi.updateRunDraft;
    if (updateRunDraft === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.runDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await updateRunDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-reasoning"),
        expectedDraftRevision: draft.revision,
        mutation: { kind: "set_reasoning", reasoningEffort: reasoningEffort as AgentReasoningEffort }
      });
      applyDraftResult(result, token);
    });
  }

  function addReferenceDraft(refId: string): void {
    const updateContextDraft = draftApi.updateContextDraft;
    if (updateContextDraft === undefined) return;
    const ref = availableReferenceRefs(context, state.contextDraft).find(
      (candidate) => candidate.refId === refId
    );
    if (ref === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.contextDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await updateContextDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-add-ref"),
        contextDraftId: draft.contextDraftId,
        expectedDraftRevision: draft.revision,
        mutation: { kind: "add_ref", ref }
      });
      applyDraftResult(result, token);
      await previewBudget(token);
    });
  }

  function removeReferenceDraft(refId: string): void {
    const updateContextDraft = draftApi.updateContextDraft;
    if (updateContextDraft === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.contextDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await updateContextDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-remove-ref"),
        contextDraftId: draft.contextDraftId,
        expectedDraftRevision: draft.revision,
        mutation: { kind: "remove_ref", refId }
      });
      applyDraftResult(result, token);
      await previewBudget(token);
    });
  }

  function refreshContextDraftSources(): void {
    const refreshContextDraft = draftApi.refreshContextDraft;
    if (refreshContextDraft === undefined) return;
    void queueDraftMutation(async () => {
      const ctx = context;
      const draft = state.contextDraft;
      const token = draftToken;
      if (ctx?.conversationId === undefined || draft === undefined) return;
      const result = await refreshContextDraft({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        commandId: createCommandId("draft-refresh"),
        contextDraftId: draft.contextDraftId,
        expectedDraftRevision: draft.revision
      });
      applyDraftResult(result, token);
      await previewBudget(token);
    });
  }

  /** Compact the live run's context. Only available while a run holds an active budget snapshot. */
  function compactActiveContext(): void {
    const compactContext = draftApi.compactContext;
    const snapshot = state.snapshot;
    if (
      compactContext === undefined ||
      snapshot === undefined ||
      snapshot.contextBudgetSnapshotId === null
    ) {
      return;
    }
    const budgetSnapshotId = snapshot.contextBudgetSnapshotId;
    void (async () => {
      const result = await compactContext({
        projectId: snapshot.projectId,
        runId: snapshot.runId,
        commandId: createCommandId("compact"),
        expectedRunRevision: snapshot.runRevision,
        contextBudgetSnapshotId: budgetSnapshotId,
        trigger: "manual"
      });
      if (!result.ok) {
        state = { ...state, errorMessage: result.error.message };
        notify();
        return;
      }
      await hydrate(snapshot.runId);
      notify();
    })();
  }

  function applyDraftResult(
    result: Awaited<ReturnType<NonNullable<OptionalDraftApi["updateRunDraft"]>>>,
    token: number
  ): void {
    if (token !== draftToken) return;
    if (!result.ok) {
      state = { ...state, errorMessage: result.error.message };
      return;
    }
    state = {
      ...state,
      runDraft: result.value.runDraft,
      contextDraft: result.value.contextDraft,
      operationMode: result.value.runDraft.operationMode,
      contextMode: result.value.runDraft.contextMode,
      writePolicy: result.value.runDraft.writePolicy,
      writePolicyAcknowledged: result.value.runDraft.writePolicyAcknowledged,
      permissionSummary: undefined,
      permissionPending: false,
      permissionError: undefined,
      errorMessage: undefined
    };
  }

  /**
   * Build the composer's grouped, draft-backed controls. Returns an empty object (so the composer
   * keeps its flat form) until a run draft is loaded — which only happens on hosts that implement
   * the Stage 5 draft methods.
   */
  function composerDraftGroups(): Pick<
    AgentComposerProps,
    "model" | "reasoning" | "references" | "contextStatus"
  > {
    const runDraft = state.runDraft;
    const contextDraft = state.contextDraft;
    if (runDraft === undefined || contextDraft === undefined) return {};
    const settings = context?.settings;
    const model: AgentComposerModelControl = {
      profiles: (settings?.profiles ?? []).map((profile) => ({
        id: profile.id,
        label: profile.displayName,
        provider: profile.provider
      })),
      selectedProfileId: runDraft.modelProfileId,
      onSelect: (profileId) => updateModelDraft(profileId)
    };
    const reasoning = reasoningControl(settings?.modelDiscovery?.reasoningStrength, runDraft);
    const references: AgentComposerReferenceControl = {
      chips: contextDraft.refs.map(refToChip),
      available: availableReferenceRefs(context, contextDraft).map(refToChip),
      onAdd: (refId) => addReferenceDraft(refId),
      onRemove: (refId) => removeReferenceDraft(refId)
    };
    const contextStatus = contextStatusControl(contextDraft);
    return { model, reasoning, references, contextStatus };
  }

  function reasoningControl(
    control: ModelReasoningStrengthControl | undefined,
    runDraft: AgentRunDraft
  ): AgentComposerReasoningControl {
    if (control === undefined || control.status !== "available") {
      return {
        visible: false,
        values: [],
        current: runDraft.reasoningEffort ?? "medium",
        onSelect: (value) => updateReasoningDraft(value)
      };
    }
    return {
      visible: true,
      values: control.allowedValues,
      current: runDraft.reasoningEffort ?? control.defaultValue,
      onSelect: (value) => updateReasoningDraft(value)
    };
  }

  function contextStatusControl(contextDraft: ContextDraft): AgentComposerContextStatusControl {
    const budget = state.budgetPreview;
    const snapshot = state.snapshot;
    const canCompact =
      draftApi.compactContext !== undefined &&
      snapshot !== undefined &&
      snapshot.contextBudgetSnapshotId !== null;
    return {
      state: contextStatusState(),
      usageLabel: budgetUsageLabel(budget),
      precision: (budget?.precision ?? "unknown") as AgentContextPrecision,
      sources: contextDraft.refs.map(refToSource),
      ...(canCompact ? { onCompact: () => compactActiveContext() } : {}),
      ...(draftApi.refreshContextDraft === undefined
        ? {}
        : { onRefresh: () => refreshContextDraftSources() }),
      busy: state.draftPending
    };
  }

  function contextStatusState(): AgentComposerContextStatusControl["state"] {
    if (latestCompactionFailed(state.events)) return "compaction_failed";
    if (
      state.snapshot?.status === "awaiting_context_refresh" ||
      hasPendingStaleContext(state.events)
    ) {
      return "needs_refresh";
    }
    const budget = state.budgetPreview;
    if (
      budget !== undefined &&
      budget.safeInputBudget > 0 &&
      budget.usedTokens / budget.safeInputBudget >= 0.8
    ) {
      return "heavy";
    }
    return "normal";
  }

  function permissionControl(): AgentComposerPermissionControl {
    return {
      ...(state.permissionSummary === undefined ? {} : { summary: state.permissionSummary }),
      loading: state.permissionPending,
      ...(state.permissionError === undefined ? {} : { errorMessage: state.permissionError }),
      approvalSource: permissionApprovalSource(),
      onOpen: () => void loadPermissionSummary()
    };
  }

  function permissionApprovalSource(): AgentComposerPermissionControl["approvalSource"] {
    if (state.operationMode === "planning") return "not_applicable";
    const resolved = [...state.events]
      .reverse()
      .find(
        (event) =>
          (event.type === "approval_resolved" || event.type === "change_set_auto_approved") &&
          typeof event.detail?.["approvalSource"] === "string"
      );
    const source = resolved?.detail?.["approvalSource"];
    return source === "human_confirmation" || source === "user_preapproved_run"
      ? source
      : "not_approved";
  }

  async function loadPermissionSummary(): Promise<void> {
    permissionSummaryRequested = true;
    const readPermissionSummary = stage5BApi.readPermissionSummary;
    if (readPermissionSummary === undefined) return;
    const snapshot = state.snapshot;
    if (snapshot !== undefined && typeof snapshot.permissionSummaryId === "string") {
      if (
        state.permissionSummary?.permissionSummaryId === snapshot.permissionSummaryId &&
        state.permissionSummary.checksum === snapshot.permissionSummaryChecksum
      ) {
        return;
      }
      state = { ...state, permissionPending: true, permissionError: undefined };
      notify();
      const permission = await readBoundPermissionSummary(snapshot);
      if (
        state.snapshot?.runId !== snapshot.runId ||
        state.snapshot.permissionSummaryId !== snapshot.permissionSummaryId
      ) {
        return;
      }
      state = {
        ...state,
        permissionPending: false,
        permissionSummary: permission.summary,
        permissionError: permission.errorMessage
      };
      notify();
      return;
    }
    if (draftInFlight !== undefined) await draftInFlight;
    if (state.permissionPending) return;
    const draft = state.runDraft;
    const ctx = context;
    if (draft === undefined || ctx?.conversationId === undefined) return;
    state = { ...state, permissionPending: true, permissionError: undefined };
    notify();
    const result = await readPermissionSummary({
      kind: "draft",
      projectId: ctx.projectId,
      conversationId: ctx.conversationId,
      runDraftId: draft.runDraftId,
      runDraftRevision: draft.revision,
      runDraftChecksum: draft.checksum
    });
    if (state.runDraft?.runDraftId !== draft.runDraftId || state.runDraft.revision !== draft.revision) {
      return;
    }
    state = {
      ...state,
      permissionPending: false,
      permissionSummary: result.ok ? result.value : undefined,
      permissionError: result.ok ? undefined : result.error.message
    };
    notify();
  }

  function toComposerProps(): AgentComposerProps {
    return {
      request: state.userRequest,
      operationMode: state.operationMode,
      contextMode: state.contextMode,
      writePolicy: state.writePolicy,
      writePolicyAcknowledged: state.writePolicyAcknowledged,
      active: state.snapshot !== undefined && !isTerminalRunStatus(state.snapshot.status),
      availableContextModes:
        context?.workspaceKind === "engineeringWorkspace"
          ? ["general_file"]
          : ["writing", "general_file"],
      ...composerDraftGroups(),
      ...(stage5BApi.readPermissionSummary === undefined && state.permissionSummary === undefined
        ? {}
        : { permission: permissionControl() }),
      onRequestChange: (request) => {
        state = { ...state, userRequest: request };
        notify();
      },
      onOperationModeChange: (mode) => {
        if (mode === "planning") permissionSummaryRequested = false;
        state = {
          ...state,
          operationMode: mode,
          ...(mode === "planning"
            ? {
                writePolicy: "write_before_confirmation",
                writePolicyAcknowledged: false,
                permissionSummary: undefined,
                permissionPending: false,
                permissionError: undefined
              }
            : {})
        };
        notify();
        updateRunDraftChoice({ kind: "set_operation_mode", operationMode: mode }, true);
      },
      onContextModeChange: (mode) => {
        state = { ...state, contextMode: mode };
        notify();
        updateRunDraftChoice({ kind: "set_context_mode", contextMode: mode }, true);
      },
      onWritePolicyChange: (writePolicy) => {
        if (state.operationMode !== "execution") return;
        state = {
          ...state,
          writePolicy,
          writePolicyAcknowledged:
            writePolicy === "user_preapproved_run" && state.writePolicyAcknowledged
        };
        notify();
        updateRunDraftChoice(
          {
            kind: "set_write_policy",
            writePolicy,
            acknowledged:
              writePolicy === "user_preapproved_run" && state.writePolicyAcknowledged
          },
          false
        );
      },
      onWritePolicyAcknowledgedChange: (writePolicyAcknowledged) => {
        if (
          state.operationMode !== "execution" ||
          state.writePolicy !== "user_preapproved_run"
        ) {
          return;
        }
        state = { ...state, writePolicyAcknowledged };
        notify();
        updateRunDraftChoice(
          {
            kind: "set_write_policy",
            writePolicy: state.writePolicy,
            acknowledged: writePolicyAcknowledged
          },
          false
        );
      },
      onSend: (request) => void sendRun(request).then(notify),
      onStop: () => void stopRun().then(notify)
    };
  }

  function toPlanReviewProps(): AgentPlanReviewProps | undefined {
    if (state.planArtifact === undefined) return undefined;
    return {
      contextMode: state.contextMode,
      plan: state.planArtifact,
      onDecision: (decision, execution) => void decideRun(decision, execution).then(notify)
    };
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  const bridge: AgentRunBridge = {
    getProps: () => (context === undefined ? undefined : toProps()),
    getComposerProps: () => (context === undefined ? undefined : toComposerProps()),
    getPlanReviewProps: () => (context === undefined ? undefined : toPlanReviewProps()),
    syncContext(nextContext) {
      const projectChanged = context?.projectId !== nextContext.projectId;
      const conversationChanged = context?.conversationId !== nextContext.conversationId;
      context = nextContext;
      if (
        conversationChanged ||
        (projectChanged && state.snapshot?.projectId !== nextContext.projectId)
      ) {
        permissionSummaryRequested = false;
        state = resetRunState(state);
      }
      if (nextContext.workspaceKind === "engineeringWorkspace" && state.contextMode !== "general_file") {
        state = { ...state, contextMode: "general_file" };
        if (state.runDraft !== undefined) {
          updateRunDraftChoice(
            { kind: "set_context_mode", contextMode: "general_file" },
            true
          );
        }
      }
      // Settings can arrive after the permanent conversation surface selects a conversation. Load
      // whenever that conversation still has no draft, while avoiding duplicate in-flight reads.
      if (
        nextContext.conversationId !== undefined &&
        state.runDraft === undefined &&
        !state.draftPending
      ) {
        loadDraft();
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
      const sorted = [...listed.value].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
      const latest =
        sorted.find((run) => !isTerminalRunStatus(run.status)) ??
        sorted.find(
          (run) =>
            isTerminalRunStatus(run.status) &&
            (typeof run.pendingChangeSetId === "string" || typeof run.versionGroupId === "string")
        );
      if (latest !== undefined) await hydrate(latest.runId);
      notify();
      return toProps();
    },
    async loadRun(runId) {
      if (runId === undefined) {
        permissionSummaryRequested = false;
        const currentDraft = {
          runDraft: state.runDraft,
          contextDraft: state.contextDraft,
          budgetPreview: state.budgetPreview,
          draftPending: state.draftPending
        };
        state = resetRunState(state);
        state = {
          ...state,
          ...(currentDraft.runDraft === undefined ? {} : { runDraft: currentDraft.runDraft }),
          ...(currentDraft.contextDraft === undefined
            ? {}
            : { contextDraft: currentDraft.contextDraft }),
          ...(currentDraft.budgetPreview === undefined
            ? {}
            : { budgetPreview: currentDraft.budgetPreview }),
          draftPending: currentDraft.draftPending
        };
        if (state.runDraft === undefined && !state.draftPending) loadDraft();
        notify();
        return toProps();
      }
      const result = await api.agentRuns.read(runId);
      if (!result.ok) {
        state = { ...state, errorMessage: result.error.message };
        notify();
        return toProps();
      }
      if (
        context === undefined ||
        result.value.snapshot.projectId !== context.projectId ||
        (context.conversationId !== undefined &&
          result.value.snapshot.conversationId !== context.conversationId)
      ) {
        state = { ...resetRunState(state), errorMessage: "The Agent run is outside the selected conversation." };
        notify();
        return toProps();
      }
      await hydrate(runId);
      notify();
      return toProps();
    },
    resetWriteAuthorization() {
      state = {
        ...state,
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false
      };
      notify();
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
    async retryTarget(target) {
      const next = await retryTargetRun(target);
      notify();
      return next;
    },
    async refreshContext(decision) {
      const next = await refreshRun(decision);
      notify();
      return next;
    },
    async decidePlan(decision, execution) {
      const next = await decideRun(decision, execution);
      notify();
      return next;
    },
    updateChangeSetSelection,
    applyChangeSet: () => decideChangeSet("apply_selected"),
    rejectChangeSet: () => decideChangeSet("reject_all"),
    undoRun: undoAgentRun,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return bridge;
}

function resetRunState(state: BridgeState): BridgeState {
  return {
    ...state,
    operationMode: "planning",
    contextMode: "writing",
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false,
    userRequest: "",
    snapshot: undefined,
    events: [],
    assistantText: "",
    pendingUserInput: undefined,
    diagnostic: undefined,
    planArtifact: undefined,
    changeSet: undefined,
    reviewOpen: false,
    rollbackReview: undefined,
    rollbackReviewOpen: false,
    rollbackDecisions: {},
    selectionPending: false,
    errorMessage: undefined,
    // The composer draft is re-loaded for the new conversation by syncContext.
    runDraft: undefined,
    contextDraft: undefined,
    budgetPreview: undefined,
    draftPending: false,
    permissionSummary: undefined,
    permissionPending: false,
    permissionError: undefined,
    planExecution: undefined
  };
}

function canUndoAppliedRun(state: BridgeState): boolean {
  return (
    state.snapshot?.operationMode === "execution" &&
    state.changeSet?.status === "applied" &&
    state.snapshot !== undefined &&
    isTerminalRunStatus(state.snapshot.status) &&
    typeof state.snapshot.versionGroupId === "string" &&
    !state.events.some((event) => event.type === "run_undone")
  );
}

function rollbackReviewFromRead(value: unknown): RollbackReviewModel | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { schemaVersion?: unknown }).schemaVersion !== "1.0" ||
    typeof (value as { reviewId?: unknown }).reviewId !== "string" ||
    typeof (value as { runId?: unknown }).runId !== "string" ||
    !Array.isArray((value as { files?: unknown }).files)
  ) {
    return undefined;
  }
  return value as RollbackReviewModel;
}

function hasSameRollbackDecisionContext(
  current: RollbackReviewModel | undefined,
  next: RollbackReviewModel | undefined
): boolean {
  if (
    current === undefined ||
    next === undefined ||
    current.reviewId !== next.reviewId ||
    current.updatedAt !== next.updatedAt ||
    current.files.length !== next.files.length
  ) {
    return false;
  }
  return next.files.every((nextFile) => {
    const currentFile = current.files.find(
      (candidate) => candidate.relativePath === nextFile.relativePath
    );
    return (
      currentFile !== undefined &&
      currentFile.baselineChecksum === nextFile.baselineChecksum &&
      currentFile.runLastWriteChecksum === nextFile.runLastWriteChecksum &&
      currentFile.reviewedCurrentChecksum === nextFile.reviewedCurrentChecksum &&
      currentFile.status === nextFile.status &&
      currentFile.decision === nextFile.decision
    );
  });
}

function isTerminalRunStatus(status: AgentRunSnapshot["status"]): boolean {
  return ["completed", "cancelled", "failed", "limit_reached"].includes(status);
}

function defaultNextRunWriteAuthorization(): Pick<
  BridgeState,
  "writePolicy" | "writePolicyAcknowledged"
> {
  return {
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false
  };
}

function writeAuthorizationForSnapshot(
  snapshot: AgentRunSnapshot
): Pick<BridgeState, "writePolicy" | "writePolicyAcknowledged"> {
  if (snapshot.operationMode === "planning" || isTerminalRunStatus(snapshot.status)) {
    return defaultNextRunWriteAuthorization();
  }
  return {
    writePolicy: snapshot.writePolicy,
    writePolicyAcknowledged: snapshot.writePolicy === "user_preapproved_run"
  };
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

/** The user's selected model profile id — the only model choice the renderer authors. */
function selectedModelProfileId(
  settings: ModelSettingsPanelProps | undefined
): string | undefined {
  const profile = settings?.profiles.find(
    (entry) => entry.id === (settings.selectedProfileId ?? settings.defaultProfileId)
  );
  return profile?.id;
}

/** The active chapter as the single Context Draft ref; server reads its content at start. */
function contextDraftRefs(context: AgentRunBridgeContext | undefined): ContextDraftRef[] {
  if (context?.activeChapterId === undefined || context.chapterEditor === undefined) return [];
  return [
    {
      kind: "chapter",
      refId: `chapter:${context.activeChapterId}`,
      chapterId: context.activeChapterId,
      label: context.chapterEditor.chapter.frontmatter.title
    }
  ];
}

/** The Stage 5 draft/budget/compaction API, viewed as optional for pre-Stage-5 hosts and test fakes. */
interface OptionalDraftApi {
  readRunDraft?: NovelStudioApi["agentRuns"]["readRunDraft"];
  updateRunDraft?: NovelStudioApi["agentRuns"]["updateRunDraft"];
  updateContextDraft?: NovelStudioApi["agentRuns"]["updateContextDraft"];
  refreshContextDraft?: NovelStudioApi["agentRuns"]["refreshContextDraft"];
  previewContextBudget?: NovelStudioApi["agentRuns"]["previewContextBudget"];
  compactContext?: NovelStudioApi["agentRuns"]["compactContext"];
}

interface OptionalStage5BApi {
  readPermissionSummary?: NovelStudioApi["agentRuns"]["readPermissionSummary"];
  decidePlanRevision?: NovelStudioApi["agentRuns"]["decidePlanRevision"];
}

const REFERENCE_KIND_LABEL: Record<AgentComposerReferenceKind, string> = {
  chapter: "章节",
  story_bible: "设定",
  project_file: "文件",
  editor_selection: "选区"
};

function refToChip(ref: ContextDraftRef): AgentComposerReferenceChip {
  return { refId: ref.refId, label: ref.label, kind: ref.kind };
}

function refToSource(ref: ContextDraftRef): { refId: string; label: string; detail: string } {
  return { refId: ref.refId, label: ref.label, detail: REFERENCE_KIND_LABEL[ref.kind] };
}

/**
 * The references the user can still add: the open chapter and the open plain file, minus anything
 * already in the draft. General-file mode drops chapter/Story-Bible candidates (writing-mode only),
 * matching the Context Draft's own validation so the menu never offers a ref the server would reject.
 */
function availableReferenceRefs(
  context: AgentRunBridgeContext | undefined,
  contextDraft: ContextDraft | undefined
): ContextDraftRef[] {
  if (contextDraft === undefined) return [];
  const present = new Set(contextDraft.refs.map((ref) => ref.refId));
  const candidates: ContextDraftRef[] = [];
  if (context?.activeChapterId !== undefined && context.chapterEditor !== undefined) {
    candidates.push({
      kind: "chapter",
      refId: `chapter:${context.activeChapterId}`,
      chapterId: context.activeChapterId,
      label: context.chapterEditor.chapter.frontmatter.title
    });
  }
  if (context?.fileEditor !== undefined) {
    candidates.push({
      kind: "project_file",
      refId: `file:${context.fileEditor.path}`,
      relativePath: context.fileEditor.path,
      label: context.fileEditor.fileName
    });
  }
  const allowed =
    contextDraft.contextMode === "general_file"
      ? candidates.filter((ref) => ref.kind !== "chapter" && ref.kind !== "story_bible")
      : candidates;
  return allowed.filter((ref) => !present.has(ref.refId));
}

/** True when the latest compaction event for the run is a failure (no success has superseded it). */
function latestCompactionFailed(events: readonly AgentRunEvent[]): boolean {
  for (const event of [...events].reverse()) {
    if (event.type === "context_compaction_failed") return true;
    if (event.type === "context_compaction_completed") return false;
  }
  return false;
}

/** True when a context source went stale and has not yet been refreshed or excluded. */
function hasPendingStaleContext(events: readonly AgentRunEvent[]): boolean {
  for (const event of [...events].reverse()) {
    if (event.type === "context_stale") return true;
    if (
      event.type === "context_refreshed" ||
      event.type === "context_excluded" ||
      event.type === "context_refresh_cancelled"
    ) {
      return false;
    }
  }
  return false;
}

function budgetUsageLabel(budget: ContextBudgetSnapshot | undefined): string {
  if (budget === undefined) return "上下文用量未知";
  return `${formatTokenCount(budget.usedTokens)} / ${formatTokenCount(budget.safeInputBudget)}`;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/u, "")}k`;
  }
  return `${tokens}`;
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
    case "plan_revision_requested":
      return "awaiting_plan_revision";
    case "plan_decision_resolved":
      return "executing_model";
    case "change_set_ready":
      return "awaiting_write_approval";
    case "write_started":
    case "run_undo_started":
      return "applying_changes";
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
    case "permission_summary_ready":
    case "plan_step_started":
    case "plan_step_completed":
    case "plan_step_blocked":
    case "plan_step_skipped":
    case "plan_deviation_recorded":
    case "approval_resolved":
    case "write_applied":
    case "write_failed":
    case "run_undone":
    case "run_undo_failed":
    case "tool_started":
    case "tool_completed":
    case "tool_failed":
    case "tool_retry_requested":
    case "assistant_text_delta":
    case "assistant_text_completed":
      return undefined;
  }
}

function toChangeSetReviewModel(changeSet: ChangeSet): ChangeSetReviewModel {
  return {
    changeSetId: changeSet.changeSetId,
    revision: changeSet.revision,
    checksum: changeSet.checksum,
    status: changeSet.status,
    files: changeSet.files.map((file) => ({
      relativePath: file.relativePath,
      assetType: file.assetType,
      baseChecksum: file.baseChecksum,
      candidateChecksum: file.candidateChecksum,
      selected: file.selected,
      validation: {
        valid: file.validation.valid,
        issues: Object.values(file.validation)
          .filter(
            (check): check is { readonly status: "invalid"; readonly message?: string } =>
              typeof check === "object" && check !== null && check.status === "invalid"
          )
          .map((check) => check.message ?? "校验失败")
      },
      hunks: file.hunks.map((hunk) => ({
        hunkId: hunk.hunkId,
        label: rangeLabel(hunk.range.unit, hunk.range.start, hunk.range.end),
        baseText: hunk.baseContent,
        candidateText: hunk.replacement,
        baseRange: { start: hunk.range.start, end: hunk.range.end },
        candidateRange: { start: hunk.range.start, end: hunk.range.end },
        selected: hunk.selected,
        additions: diffUnitCount(hunk.replacement),
        deletions: diffUnitCount(hunk.baseContent)
      }))
    }))
  };
}

function rangeLabel(unit: string, start: number, end: number): string {
  const unitLabel = unit === "paragraph" ? "段" : unit === "line" ? "行" : "字符";
  return start === end ? `第 ${start} ${unitLabel}` : `${unitLabel} ${start}-${end}`;
}

function diffUnitCount(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r?\n/u).length;
}

function conflictPaths(events: readonly AgentRunEvent[], changeSet: ChangeSet): string[] {
  const targetPaths = new Set(changeSet.files.map((file) => file.relativePath));
  for (const event of [...events].reverse()) {
    const raw = event.detail?.["baseHashConflictPaths"];
    if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === "string");
    if (
      typeof event.detail?.["code"] === "string" &&
      event.detail["code"].includes("BASE_CONFLICT") &&
      typeof event.detail["relativePath"] === "string"
    ) {
      return targetPaths.has(event.detail["relativePath"])
        ? [event.detail["relativePath"]]
        : [];
    }
    if (event.type === "context_stale" && Array.isArray(event.detail?.["staleRefs"])) {
      const staleTargetPaths = event.detail["staleRefs"]
        .flatMap(contextRefPath)
        .filter((relativePath) => targetPaths.has(relativePath));
      if (staleTargetPaths.length > 0) return [...new Set(staleTargetPaths)];
    }
    if (event.type === "change_set_ready") return [];
  }
  return [];
}

function contextRefPath(refId: unknown): string[] {
  if (typeof refId !== "string") return [];
  if (refId.startsWith("chapter:")) return [`chapters/${refId.slice("chapter:".length)}.md`];
  if (refId.startsWith("file:")) return [refId.slice("file:".length)];
  return [];
}

function dirtyTargetPaths(
  context: AgentRunBridgeContext | undefined,
  changeSet: ChangeSet
): string[] {
  const paths = new Set<string>();
  if (context?.chapterEditor?.dirty === true && context.activeChapterId !== undefined) {
    paths.add(`chapters/${context.activeChapterId}.md`);
  }
  if (context?.fileEditor?.dirty === true) paths.add(context.fileEditor.path);
  return changeSet.files
    .map((file) => file.relativePath)
    .filter((relativePath) => paths.has(relativePath));
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
