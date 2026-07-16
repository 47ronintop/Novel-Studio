import {
  applyAgentRunDraftMutation,
  applyContextDraftMutation,
  bindContextDraft,
  createAgentRunDraft,
  createContextDraft,
  refreshContextDraft,
  setContextDraftMode,
  type AgentContextMode,
  type AgentOperationMode,
  type AgentReasoningEffort,
  type AgentRunDraft,
  type AgentRunDraftMutation,
  type AgentWritePolicy,
  type ContextDraft,
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
  readonly reasoningEffort?: AgentReasoningEffort;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged?: boolean;
  readonly contextRefs?: readonly ContextDraftRef[];
}

export interface ReadAgentRunDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly initialize: AgentRunDraftInitialization;
}

export interface UpdateAgentRunDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly expectedDraftRevision: number;
  readonly mutation: AgentRunDraftMutation;
}

export interface UpdateContextDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
  readonly mutation: ContextDraftMutation;
}

export interface RefreshContextDraftCommand {
  readonly projectId: string;
  readonly conversationId: string;
  readonly commandId: string;
  readonly contextDraftId: string;
  readonly expectedDraftRevision: number;
}

export interface AgentRunDraftView {
  readonly runDraft: AgentRunDraft;
  readonly contextDraft: ContextDraft;
}

export type AgentRunDraftResult = Result<AgentRunDraftView, UnifiedError>;

export interface AgentRunDraftSession {
  readAgentRunDraft(command: ReadAgentRunDraftCommand): Promise<AgentRunDraftResult>;
  updateAgentRunDraft(command: UpdateAgentRunDraftCommand): Promise<AgentRunDraftResult>;
  updateContextDraft(command: UpdateContextDraftCommand): Promise<AgentRunDraftResult>;
  refreshContextDraft(command: RefreshContextDraftCommand): Promise<AgentRunDraftResult>;
}

export interface CreateAgentRunDraftSessionOptions {
  readonly repository: AgentRunDraftSessionRepository;
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
    return ok({
      runDraft: runDraft.value as unknown as AgentRunDraft,
      contextDraft: contextDraft.value as unknown as ContextDraft
    });
  }

  async function persist(view: AgentRunDraftView): Promise<Result<AgentRunDraftView, UnifiedError>> {
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

  function initialize(command: ReadAgentRunDraftCommand): AgentRunDraftView {
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
      projectId: command.projectId,
      contextMode: init.contextMode,
      refs,
      updatedAt: timestamp
    });
    const runDraft = createAgentRunDraft({
      runDraftId: createId(),
      projectId: command.projectId,
      conversationId: command.conversationId,
      userRequest: "",
      operationMode: init.operationMode,
      contextMode: init.contextMode,
      writePolicy: init.writePolicy,
      writePolicyAcknowledged: init.writePolicyAcknowledged ?? false,
      modelProfileId: init.modelProfileId,
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
    command: { readonly projectId: string; readonly conversationId: string; readonly commandId: string },
    execute: () => Promise<AgentRunDraftResult>
  ): Promise<AgentRunDraftResult> {
    const key = `${command.projectId}:${command.conversationId}:${command.commandId}`;
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
      const loaded = await load(command.conversationId);
      if (!loaded.ok) return err(loaded.error);
      if (loaded.value !== undefined) return ok(loaded.value);
      return persist(initialize(command));
    },

    updateAgentRunDraft(command) {
      return runOnce(command, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const view = loaded.value;
        if (view.runDraft.revision !== command.expectedDraftRevision) {
          return err(revisionConflict(view));
        }
        const mutated = applyAgentRunDraftMutation(view.runDraft, command.mutation, now());
        if (!mutated.ok) return err(mutated.error);
        // A context-mode switch must keep the context draft's mode in sync and re-point the run draft.
        if (command.mutation.kind === "set_context_mode") {
          const timestamp = now();
          const contextDraft = setContextDraftMode(
            view.contextDraft,
            command.mutation.contextMode,
            timestamp
          );
          const runDraft = bindContextDraft(
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
      return runOnce(command, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const view = loaded.value;
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
      return runOnce(command, async () => {
        const loaded = await load(command.conversationId);
        if (!loaded.ok) return err(loaded.error);
        if (loaded.value === undefined) {
          return err(draftError("AGENT_RUN_DRAFT_NOT_FOUND", "No Agent run draft exists yet."));
        }
        const view = loaded.value;
        if (view.contextDraft.contextDraftId !== command.contextDraftId) {
          return err(draftError("CONTEXT_DRAFT_NOT_FOUND", "The context draft does not exist."));
        }
        if (view.contextDraft.revision !== command.expectedDraftRevision) {
          return err(revisionConflict(view));
        }
        const refreshed = refreshContextDraft(view.contextDraft, now());
        return persist(rebind(view.runDraft, refreshed, now()));
      });
    }
  };
}

function rebind(
  runDraft: AgentRunDraft,
  contextDraft: ContextDraft,
  updatedAt: string
): AgentRunDraftView {
  return {
    runDraft: bindContextDraft(
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
