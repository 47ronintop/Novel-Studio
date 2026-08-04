import {
  applyAgentRunDraftMutation,
  applyAgentRunDraftV20Mutation,
  applyContextDraftMutation,
  bindContextDraft,
  checksumAgentRunDraft,
  checksumAgentRunDraftV20,
  createAgentRunDraftV20,
  createContextDraft,
  normalizeAgentRunDraft,
  normalizeContextDraft,
  parseAgentRunDraftV20,
  refreshContextDraft,
  setContextDraftMode,
  type AgentContextMode,
  type AgentContextScope,
  type AgentOperationMode,
  type AgentReasoningEffort,
  type AgentRunDraft,
  type AgentRunDraftMutation,
  type AgentRunDraftV20,
  type AgentRunDraftV20Mutation,
  type AgentWritePolicy,
  type ContextDraft,
  type ContextDraftActiveResourceRef,
  type ContextDraftMutation,
  type ContextDraftRef
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import {
  createWritingTaskIntent,
  type WritingComposerAction,
  type WritingTaskIntent,
  type WritingTaskIntentKind
} from "./writing-task-intent.js";

export interface AgentRunDraftSessionRepository {
  writeRunDraft(draft: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readLatestRunDraft(conversationId: string): Promise<Result<JsonObject | undefined, UnifiedError>>;
  writeContextDraft(draft: JsonObject): Promise<Result<JsonObject, UnifiedError>>;
  readLatestContextDraft(
    conversationId: string
  ): Promise<Result<JsonObject | undefined, UnifiedError>>;
}

/** Defaults for a brand-new Conversation, applied only when no draft exists yet. */
export interface AgentRunDraftInitialization {
  readonly modelProfileId: string;
  readonly modelName?: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged?: boolean;
  /** Future Act choice only; planning always persists a read-only current policy. */
  readonly executionWritePolicyDraft?: AgentWritePolicy;
  readonly contextRefs?: readonly ContextDraftRef[];
  readonly activeResourceRef?: ContextDraftActiveResourceRef | null;
}

export interface ReadAgentRunDraftCommand {
  /** Legacy workspace-only identity; standalone commands omit it. */
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly initialize: AgentRunDraftInitialization;
}

export interface UpdateAgentRunDraftCommand {
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedDraftRevision: number;
  readonly mutation: AgentRunDraftV20Mutation;
}

export interface UpdateContextDraftCommand {
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
  readonly mutation: ContextDraftMutation;
}

export interface RefreshContextDraftCommand {
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
}

/** A start-time reference to an already-persisted run draft revision. Verified, never initialized. */
export interface ResolveStartDraftCommand {
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
}

/**
 * The renderer's pre-run intent — the user's own choices, never resolved facts. `prepareStart`
 * persists this as the current draft revision so the start command can carry a draft reference and
 * the server can resolve capabilities/content from it. Context refs are the exact set the run
 * should carry.
 */
export interface SyncStartDraftCommand {
  readonly projectId?: string;
  readonly scope?: AgentContextScope;
  readonly conversationId: string;
  readonly commandId: string;
  readonly userRequest: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  /** App-owned future Act policy; it does not authorize a planning run. */
  readonly executionWritePolicyDraft?: AgentWritePolicy;
  readonly modelProfileId: string;
  readonly modelName?: string;
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly contextRefs: readonly ContextDraftRef[];
  readonly activeResourceRef?: ContextDraftActiveResourceRef | null;
  /** App-owned composer affordance; project/tool/remote content has no slot in this contract. */
  readonly writingComposerAction?: WritingComposerAction;
  /** Fresh user decision resolving a mixed/unknown writing intent. */
  readonly writingUserConfirmedKind?: Exclude<WritingTaskIntentKind, "mixed" | "unknown">;
}

export interface AgentRunDraftView {
  readonly runDraft: PersistedAgentRunDraft;
  readonly contextDraft: ContextDraft;
}

export interface AgentRunStartDraftView extends AgentRunDraftView {
  readonly writingTaskIntent: WritingTaskIntent | null;
}

export type AgentRunDraftResult = Result<AgentRunDraftView, UnifiedError>;

type PersistedAgentRunDraft = AgentRunDraft | AgentRunDraftV20;

export interface AgentRunDraftSession {
  readAgentRunDraft(command: ReadAgentRunDraftCommand): Promise<AgentRunDraftResult>;
  updateAgentRunDraft(command: UpdateAgentRunDraftCommand): Promise<AgentRunDraftResult>;
  updateContextDraft(command: UpdateContextDraftCommand): Promise<AgentRunDraftResult>;
  refreshContextDraft(command: RefreshContextDraftCommand): Promise<AgentRunDraftResult>;
  resolveStartDraft(
    command: ResolveStartDraftCommand
  ): Promise<Result<AgentRunStartDraftView, UnifiedError>>;
  syncStartDraft(command: SyncStartDraftCommand): Promise<AgentRunDraftResult>;
}

export interface CreateAgentRunDraftSessionOptions {
  readonly repository: AgentRunDraftSessionRepository;
  readonly scope?: AgentContextScope;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export function createAgentRunDraftSession(
  options: CreateAgentRunDraftSessionOptions
): AgentRunDraftSession {
  const now = options.now ?? (() => new Date().toISOString());
  const createId = options.createId ?? createDefaultId;
  const receipts = new Map<string, AgentRunDraftResult>();
  const inFlight = new Map<string, Promise<AgentRunDraftResult>>();
  const writingTaskIntentByDraftChecksum = new Map<string, WritingTaskIntent>();
  const legacyWorkspaceKind =
    options.scope?.kind === "workspace" ? options.scope.workspaceKind : undefined;

  async function load(
    conversationId: string
  ): Promise<Result<AgentRunDraftView | undefined, UnifiedError>> {
    const [runDraft, contextDraft] = await Promise.all([
      options.repository.readLatestRunDraft(conversationId),
      options.repository.readLatestContextDraft(conversationId)
    ]);
    if (!runDraft.ok) return err(runDraft.error);
    if (!contextDraft.ok) return err(contextDraft.error);
    if (runDraft.value === undefined && contextDraft.value === undefined) return ok(undefined);
    if (runDraft.value === undefined || contextDraft.value === undefined) {
      return err(
        draftError(
          "AGENT_RUN_DRAFT_INCONSISTENT",
          "The Agent run draft and its context draft are out of sync."
        )
      );
    }
    try {
      const normalizedRunDraft = readPersistedRunDraft(runDraft.value, legacyWorkspaceKind);
      const normalizedContextDraft = normalizeContextDraft(contextDraft.value, legacyWorkspaceKind);
      if (scopeKey(normalizedRunDraft.scope) !== scopeKey(normalizedContextDraft.scope)) {
        return err(
          draftError(
            "AGENT_RUN_DRAFT_SCOPE_MISMATCH",
            "The Agent run draft and Context Draft belong to different scopes."
          )
        );
      }
      return ok({ runDraft: normalizedRunDraft, contextDraft: normalizedContextDraft });
    } catch {
      return err(
        draftError(
          "AGENT_RUN_DRAFT_VERSION_UNSUPPORTED",
          "The persisted Agent run draft version is not supported."
        )
      );
    }
  }

  async function persist(
    view: AgentRunDraftView
  ): Promise<Result<AgentRunDraftView, UnifiedError>> {
    if (!isAgentRunDraftV20(view.runDraft)) {
      return err(
        draftError(
          "AGENT_RUN_DRAFT_LEGACY_READ_ONLY",
          "A legacy Agent run draft must be handed off before it can be changed."
        )
      );
    }
    try {
      // Verify the checksum and all strict invariants immediately before the repository boundary.
      parseAgentRunDraftV20(view.runDraft);
    } catch {
      return err(
        draftError(
          "AGENT_RUN_DRAFT_V20_INVALID",
          "The Agent run draft cannot be persisted because its strict contract is invalid."
        )
      );
    }
    // Context draft first so a crash never leaves a run draft pointing at an unwritten context revision.
    const contextWritten = await options.repository.writeContextDraft(
      view.contextDraft as unknown as JsonObject
    );
    if (!contextWritten.ok) return err(contextWritten.error);
    const runWritten = await options.repository.writeRunDraft(
      view.runDraft as unknown as JsonObject
    );
    return runWritten.ok ? ok(view) : err(runWritten.error);
  }

  function initialize(
    command: ReadAgentRunDraftCommand,
    scope: AgentContextScope
  ): AgentRunDraftView {
    const timestamp = now();
    const init = command.initialize;
    const contextDraftId = createId();
    const refs =
      init.contextMode === "general_file"
        ? (init.contextRefs ?? []).filter(
            (ref) => ref.kind !== "chapter" && ref.kind !== "story_bible"
          )
        : (init.contextRefs ?? []);
    const contextDraft = createContextDraft({
      contextDraftId,
      conversationId: command.conversationId,
      scope,
      contextMode: init.contextMode,
      refs,
      activeResourceRef: init.activeResourceRef ?? null,
      updatedAt: timestamp
    });
    const runDraft = createAgentRunDraftV20({
      runDraftId: createId(),
      scope: contextDraft.scope,
      conversationId: command.conversationId,
      userRequest: "",
      operationMode: init.operationMode,
      contextMode: init.contextMode,
      writePolicy: init.writePolicy,
      writePolicyAcknowledged: init.writePolicyAcknowledged ?? false,
      executionWritePolicyDraft: init.executionWritePolicyDraft ?? init.writePolicy,
      modelProfileId: init.modelProfileId,
      ...(init.modelName === undefined ? {} : { modelName: init.modelName }),
      ...(init.reasoningEffort === undefined ? {} : { reasoningEffort: init.reasoningEffort }),
      contextDraftId,
      contextDraftRevision: contextDraft.revision,
      contextDraftChecksum: contextDraft.checksum,
      contextBudgetSnapshotId: null,
      updatedAt: timestamp
    });
    return { runDraft, contextDraft };
  }

  function runOnce(
    scope: AgentContextScope,
    conversationId: string,
    commandId: string,
    execute: () => Promise<AgentRunDraftResult>
  ): Promise<AgentRunDraftResult> {
    const key = `${scopeKey(scope)}:${conversationId}:${commandId}`;
    const cached = receipts.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const active = inFlight.get(key);
    if (active !== undefined) return active;
    const request = execute().then((result) => {
      receipts.set(key, result);
      return result;
    });
    inFlight.set(key, request);
    const clear = () => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    };
    void request.then(clear, clear);
    return request;
  }

  return {
    async readAgentRunDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return err(scope.error);
      const loaded = await load(command.conversationId);
      if (!loaded.ok) return err(loaded.error);
      if (loaded.value !== undefined) return validateDraftScope(loaded.value, scope.value);
      return persist(initialize(command, scope.value));
    },

    updateAgentRunDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return Promise.resolve(err(scope.error));
      return runOnce(scope.value, command.conversationId, command.commandId, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const scoped = validateDraftScope(loaded.value, scope.value);
        if (!scoped.ok) return scoped;
        const view = scoped.value;
        if (view.runDraft.revision !== command.expectedDraftRevision) {
          return err(revisionConflict(view));
        }
        const mutated = applyRunDraftMutation(view.runDraft, command.mutation, now());
        if (!mutated.ok) return err(mutated.error);
        // A context-mode switch must keep the context draft's mode in sync and re-point the run draft.
        if (command.mutation.kind === "set_context_mode") {
          const timestamp = now();
          const contextDraft = setContextDraftMode(
            view.contextDraft,
            command.mutation.contextMode,
            timestamp
          );
          const runDraft = bindRunDraftContext(
            mutated.value,
            {
              contextDraftId: contextDraft.contextDraftId,
              contextDraftRevision: contextDraft.revision,
              contextDraftChecksum: contextDraft.checksum
            },
            timestamp
          );
          return persist({ runDraft, contextDraft });
        }
        return persist({ runDraft: mutated.value, contextDraft: view.contextDraft });
      });
    },

    updateContextDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return Promise.resolve(err(scope.error));
      return runOnce(scope.value, command.conversationId, command.commandId, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const scoped = validateDraftScope(loaded.value, scope.value);
        if (!scoped.ok) return scoped;
        const view = scoped.value;
        if (view.contextDraft.contextDraftId !== command.contextDraftId) {
          return err(draftError("CONTEXT_DRAFT_NOT_FOUND", "The context draft does not exist."));
        }
        if (view.contextDraft.revision !== command.expectedDraftRevision) {
          return err(revisionConflict(view));
        }
        const mutated = applyContextDraftMutation(view.contextDraft, command.mutation, now());
        if (!mutated.ok) return err(mutated.error);
        return persist(rebind(view.runDraft, mutated.value, now()));
      });
    },

    refreshContextDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return Promise.resolve(err(scope.error));
      return runOnce(scope.value, command.conversationId, command.commandId, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const scoped = validateDraftScope(loaded.value, scope.value);
        if (!scoped.ok) return scoped;
        const view = scoped.value;
        if (view.contextDraft.contextDraftId !== command.contextDraftId) {
          return err(draftError("CONTEXT_DRAFT_NOT_FOUND", "The context draft does not exist."));
        }
        if (view.contextDraft.revision !== command.expectedDraftRevision) {
          return err(revisionConflict(view));
        }
        const refreshed = refreshContextDraft(view.contextDraft, now());
        return persist(rebind(view.runDraft, refreshed, now()));
      });
    },

    async resolveStartDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return err(scope.error);
      // Read-only: a run start references an already-persisted draft; it never initializes one.
      const loaded = await load(command.conversationId);
      if (!loaded.ok) return err(loaded.error);
      if (loaded.value === undefined || loaded.value.runDraft.runDraftId !== command.runDraftId) {
        return err(
          draftError(
            "AGENT_RUN_DRAFT_NOT_FOUND",
            "The referenced Agent run draft does not exist for this conversation."
          )
        );
      }
      const scoped = validateDraftScope(loaded.value, scope.value);
      if (!scoped.ok) return scoped;
      const view = scoped.value;
      if (view.runDraft.revision !== command.runDraftRevision) {
        return err(revisionConflict(view));
      }
      if (view.runDraft.checksum !== command.runDraftChecksum) {
        return err(
          draftError(
            "AGENT_RUN_DRAFT_CHECKSUM_MISMATCH",
            "The referenced Agent run draft checksum does not match the persisted draft."
          )
        );
      }
      const writingTaskIntent = writingTaskIntentByDraftChecksum.get(view.runDraft.checksum);
      if (view.runDraft.contextMode === "writing" && writingTaskIntent === undefined) {
        return err(
          draftError(
            "WRITING_TASK_INTENT_UNAVAILABLE",
            "The app-owned writing intent is not frozen for this draft; resync the composer before starting."
          )
        );
      }
      return ok({
        ...view,
        writingTaskIntent:
          view.runDraft.contextMode === "writing" ? (writingTaskIntent ?? null) : null
      });
    },

    syncStartDraft(command) {
      const scope = resolveDraftCommandScope(command, options.scope);
      if (!scope.ok) return Promise.resolve(err(scope.error));
      return runOnce(scope.value, command.conversationId, command.commandId, async () => {
        if (
          command.contextMode !== "writing" &&
          (command.writingComposerAction !== undefined ||
            command.writingUserConfirmedKind !== undefined)
        ) {
          return err(
            draftError(
              "WRITING_TASK_INTENT_INVALID",
              "Writing intent controls are only valid for the writing context."
            )
          );
        }
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        let nextView: AgentRunDraftView;
        if (loaded.value === undefined) {
          // No draft yet: initialize the whole state from the intent in one revision.
          const view = initialize(
            {
              scope: scope.value,
              conversationId: command.conversationId,
              initialize: {
                modelProfileId: command.modelProfileId,
                ...(command.modelName === undefined ? {} : { modelName: command.modelName }),
                ...(command.reasoningEffort === undefined
                  ? {}
                  : { reasoningEffort: command.reasoningEffort }),
                operationMode: command.operationMode,
                contextMode: command.contextMode,
                writePolicy: command.writePolicy,
                writePolicyAcknowledged: command.writePolicyAcknowledged,
                executionWritePolicyDraft: command.executionWritePolicyDraft ?? command.writePolicy,
                contextRefs: command.contextRefs,
                activeResourceRef: command.activeResourceRef ?? null
              }
            },
            scope.value
          );
          const withRequest = applyRunDraftMutation(
            view.runDraft,
            { kind: "set_request", request: command.userRequest },
            now()
          );
          if (!withRequest.ok) return err(withRequest.error);
          nextView = {
            runDraft: withRequest.value,
            contextDraft: view.contextDraft
          };
        } else {
          const scoped = validateDraftScope(loaded.value, scope.value);
          if (!scoped.ok) return scoped;
          nextView = syncToIntent(scoped.value, command, now);
        }
        let writingTaskIntent: WritingTaskIntent | undefined;
        try {
          writingTaskIntent =
            command.contextMode === "writing"
              ? createDraftWritingTaskIntent(nextView, command)
              : undefined;
        } catch {
          return err(
            draftError("WRITING_TASK_INTENT_INVALID", "The app-owned writing intent is invalid.")
          );
        }
        const persisted = await persist(nextView);
        if (!persisted.ok || writingTaskIntent === undefined) return persisted;
        writingTaskIntentByDraftChecksum.set(persisted.value.runDraft.checksum, writingTaskIntent);
        return persisted;
      });
    }
  };
}

function createDraftWritingTaskIntent(
  view: AgentRunDraftView,
  signals: Pick<SyncStartDraftCommand, "writingComposerAction" | "writingUserConfirmedKind"> = {}
): WritingTaskIntent {
  return createWritingTaskIntent({
    currentRequest: view.runDraft.userRequest,
    hasExplicitSelection: view.contextDraft.refs.some((ref) => ref.kind === "editor_selection"),
    ...(signals.writingComposerAction === undefined
      ? {}
      : { composerAction: signals.writingComposerAction }),
    ...(signals.writingUserConfirmedKind === undefined
      ? {}
      : { userConfirmedKind: signals.writingUserConfirmedKind })
  });
}

/**
 * Fold the renderer intent onto an existing draft pair, producing the next revisions. Model/mode/
 * write-policy/request are synced (they must be server-authoritative at start); the context draft is
 * re-pointed so the run draft's checksum stays consistent. Live ref editing is Task 1.6.
 */
function syncToIntent(
  view: AgentRunDraftView,
  command: SyncStartDraftCommand,
  now: () => string
): AgentRunDraftView {
  let contextDraft = view.contextDraft;
  if (contextDraft.contextMode !== command.contextMode) {
    contextDraft = setContextDraftMode(contextDraft, command.contextMode, now());
  }
  const activeResourceRef = command.activeResourceRef ?? null;
  if (!sameActiveResource(contextDraft.activeResourceRef, activeResourceRef)) {
    const updated = applyContextDraftMutation(
      contextDraft,
      { kind: "set_active_resource", ref: activeResourceRef },
      now()
    );
    if (updated.ok) contextDraft = updated.value;
  }
  let runDraft = view.runDraft;
  const mutations: AgentRunDraftV20Mutation[] = [
    { kind: "set_operation_mode", operationMode: command.operationMode },
    { kind: "set_context_mode", contextMode: command.contextMode },
    {
      kind: "set_execution_write_policy_draft",
      policy: command.executionWritePolicyDraft ?? command.writePolicy
    },
    {
      kind: "set_model",
      modelProfileId: command.modelProfileId,
      ...(command.modelName === undefined ? {} : { modelName: command.modelName }),
      ...(command.reasoningEffort === undefined ? {} : { reasoningEffort: command.reasoningEffort })
    },
    ...(command.operationMode === "execution"
      ? [
          {
            kind: "set_write_policy" as const,
            writePolicy: command.writePolicy,
            acknowledged: command.writePolicyAcknowledged
          }
        ]
      : []),
    { kind: "set_request", request: command.userRequest }
  ];
  for (const mutation of mutations) {
    const next = applyRunDraftMutation(runDraft, mutation, now());
    if (next.ok) runDraft = next.value;
  }
  return rebind(runDraft, contextDraft, now());
}

function sameActiveResource(
  left: ContextDraftActiveResourceRef | null,
  right: ContextDraftActiveResourceRef | null
): boolean {
  if (left === null || right === null) return left === right;
  if (left.refId !== right.refId || left.label !== right.label) {
    return false;
  }
  if (left.kind === "story_bible") {
    return right.kind === "story_bible" && left.assetId === right.assetId;
  }
  return (
    right.kind === "project_file" &&
    left.relativePath === right.relativePath &&
    left.expectedChecksum === right.expectedChecksum
  );
}

function rebind(
  runDraft: PersistedAgentRunDraft,
  contextDraft: ContextDraft,
  updatedAt: string
): AgentRunDraftView {
  return {
    runDraft: bindRunDraftContext(
      runDraft,
      {
        contextDraftId: contextDraft.contextDraftId,
        contextDraftRevision: contextDraft.revision,
        contextDraftChecksum: contextDraft.checksum
      },
      updatedAt
    ),
    contextDraft
  };
}

function readPersistedRunDraft(
  value: JsonObject,
  legacyWorkspaceKind: Parameters<typeof normalizeAgentRunDraft>[1]
): PersistedAgentRunDraft {
  if (value["schemaVersion"] === "2.0") return parseAgentRunDraftV20(value);
  return normalizeLegacyRunDraft(value, legacyWorkspaceKind);
}

/** Legacy records are view-only and can never recover a previous preapproval acknowledgement. */
function normalizeLegacyRunDraft(
  value: JsonObject,
  legacyWorkspaceKind: Parameters<typeof normalizeAgentRunDraft>[1]
): AgentRunDraft {
  const draft = normalizeAgentRunDraft(value, legacyWorkspaceKind);
  const { checksum: _checksum, ...withoutChecksum } = draft;
  void _checksum;
  const safeDraft: Omit<AgentRunDraft, "checksum"> = {
    ...withoutChecksum,
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false
  };
  return Object.freeze({ ...safeDraft, checksum: checksumAgentRunDraft(safeDraft) });
}

function isAgentRunDraftV20(draft: PersistedAgentRunDraft): draft is AgentRunDraftV20 {
  return draft.schemaVersion === "2.0";
}

function applyRunDraftMutation(
  draft: PersistedAgentRunDraft,
  mutation: AgentRunDraftV20Mutation,
  updatedAt: string
): Result<PersistedAgentRunDraft, UnifiedError> {
  if (!isAgentRunDraftV20(draft)) {
    if (mutation.kind === "set_execution_write_policy_draft") {
      return err(
        draftError(
          "AGENT_RUN_DRAFT_LEGACY_READ_ONLY",
          "A legacy Agent run draft must be handed off before its execution policy can change."
        )
      );
    }
    return applyAgentRunDraftMutation(draft, mutation as AgentRunDraftMutation, updatedAt);
  }
  const mutated = applyAgentRunDraftV20Mutation(draft, mutation, updatedAt);
  if (!mutated.ok) return mutated;
  return ok(normalizeV20ReadOnlyPolicy(mutated.value));
}

function bindRunDraftContext(
  draft: PersistedAgentRunDraft,
  binding: {
    readonly contextDraftId: string;
    readonly contextDraftRevision: number;
    readonly contextDraftChecksum: string;
  },
  updatedAt: string
): PersistedAgentRunDraft {
  if (!isAgentRunDraftV20(draft)) return bindContextDraft(draft, binding, updatedAt);
  const { checksum: _checksum, ...withoutChecksum } = draft;
  void _checksum;
  const next: Omit<AgentRunDraftV20, "checksum"> = {
    ...withoutChecksum,
    ...binding,
    revision: draft.revision + 1,
    updatedAt
  };
  return parseAgentRunDraftV20({
    ...next,
    checksum: checksumAgentRunDraftV20(next)
  });
}

function normalizeV20ReadOnlyPolicy(draft: AgentRunDraftV20): AgentRunDraftV20 {
  if (
    draft.operationMode === "execution" ||
    (draft.writePolicy === "write_before_confirmation" && draft.writePolicyAcknowledged === false)
  ) {
    return draft;
  }
  const { checksum: _checksum, ...withoutChecksum } = draft;
  void _checksum;
  const safeDraft: Omit<AgentRunDraftV20, "checksum"> = {
    ...withoutChecksum,
    writePolicy: "write_before_confirmation",
    writePolicyAcknowledged: false
  };
  return parseAgentRunDraftV20({
    ...safeDraft,
    checksum: checksumAgentRunDraftV20(safeDraft)
  });
}

function revisionConflict(view: AgentRunDraftView): UnifiedError {
  return createUnifiedError({
    code: "AGENT_RUN_DRAFT_REVISION_CONFLICT",
    category: "AgentError",
    message: "The Agent run draft revision is stale.",
    recoverability: "user-action",
    suggestedAction: "Reload the composer and retry.",
    traceId: "agent-run-draft-session",
    redactedDetail: {
      runDraftRevision: view.runDraft.revision,
      contextDraftRevision: view.contextDraft.revision
    }
  });
}

function draftError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction: "Reload the composer and retry.",
    traceId: "agent-run-draft-session"
  });
}

function createDefaultId(): string {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveDraftCommandScope(
  identity: { readonly scope?: AgentContextScope; readonly projectId?: string },
  boundScope?: AgentContextScope
): Result<AgentContextScope, UnifiedError> {
  const requested =
    identity.scope ??
    (identity.projectId === undefined
      ? boundScope
      : boundScope?.kind === "workspace" && boundScope.workspaceId === identity.projectId
        ? boundScope
        : {
            kind: "workspace" as const,
            workspaceKind: "creativeProject" as const,
            workspaceId: identity.projectId
          });
  if (
    requested === undefined ||
    (identity.projectId !== undefined &&
      (requested.kind !== "workspace" || requested.workspaceId !== identity.projectId)) ||
    (boundScope !== undefined && scopeKey(requested) !== scopeKey(boundScope))
  ) {
    return err(
      draftError("AGENT_RUN_DRAFT_SCOPE_MISMATCH", "The Agent run draft scope is not active.")
    );
  }
  return ok(boundScope ?? requested);
}

function validateDraftScope(
  view: AgentRunDraftView,
  scope: AgentContextScope
): AgentRunDraftResult {
  return scopeKey(view.runDraft.scope) === scopeKey(scope) &&
    scopeKey(view.contextDraft.scope) === scopeKey(scope)
    ? ok(view)
    : err(draftError("AGENT_RUN_DRAFT_SCOPE_MISMATCH", "The Agent run draft scope is not active."));
}

function scopeKey(scope: AgentContextScope): string {
  return scope.kind === "standalone" ? "standalone" : `${scope.workspaceKind}:${scope.workspaceId}`;
}
