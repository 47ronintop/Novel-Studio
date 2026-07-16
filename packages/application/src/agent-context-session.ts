import {
  aggregateContextPrecision,
  calculateContextBudget,
  createDeterministicTokenEstimator,
  type AgentContextPrecision,
  type AgentRunDraft,
  type AgentTokenEstimator,
  type ContextBudgetSnapshot,
  type ContextDraft,
  type PreviewContextBudgetCommand
} from "@novel-studio/agent-engine";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { AgentRunDraftSession, AgentRunDraftView } from "./agent-run-draft-session.js";

/**
 * The provider-aware facts a budget is calculated from. Resolved server-side from the draft's
 * `modelProfileId` — never authored by the renderer. `toolReserve`/`systemReserve` are token counts,
 * not text; the guidance/tool-schema text they represent is measured where it is authored.
 */
export interface AgentContextBudgetModelFacts {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly requiredContextTokens: number;
}

/** One resolved piece of input content the budget should account for (a referenced source's text). */
export interface AgentContextBudgetContent {
  readonly refId: string;
  readonly content: string;
}

export interface AgentContextBudgetInputs {
  readonly model: AgentContextBudgetModelFacts;
  readonly contents: readonly AgentContextBudgetContent[];
}

/**
 * The port that turns a resolved draft into the concrete budget facts: the model window/reserves and
 * the resolved content of every context reference. This is where content reading lives, so the
 * session stays pure arithmetic + estimation over already-resolved material.
 */
export interface AgentContextBudgetInputsPort {
  resolveBudgetInputs(input: {
    readonly projectId: string;
    readonly conversationId: string;
    readonly draft: AgentRunDraft;
    readonly contextDraft: ContextDraft;
  }): Promise<Result<AgentContextBudgetInputs, UnifiedError>>;
}

export interface AgentContextSession {
  previewContextBudget(
    command: PreviewContextBudgetCommand
  ): Promise<Result<ContextBudgetSnapshot, UnifiedError>>;
}

export interface CreateAgentContextSessionOptions {
  readonly draftSession: Pick<AgentRunDraftSession, "resolveStartDraft">;
  readonly budgetInputs: AgentContextBudgetInputsPort;
  readonly estimator?: AgentTokenEstimator;
  readonly createBudgetSnapshotId?: () => string;
  readonly now?: () => string;
}

export function createAgentContextSession(
  options: CreateAgentContextSessionOptions
): AgentContextSession {
  const estimator = options.estimator ?? createDeterministicTokenEstimator();
  const now = options.now ?? (() => new Date().toISOString());
  const createBudgetSnapshotId = options.createBudgetSnapshotId ?? createDefaultBudgetSnapshotId;
  const receipts = new Map<string, Result<ContextBudgetSnapshot, UnifiedError>>();

  return {
    async previewContextBudget(command) {
      const key = `${command.projectId}:${command.conversationId}:${command.commandId}`;
      const cached = receipts.get(key);
      if (cached !== undefined) return cached;
      const result = await preview(command);
      receipts.set(key, result);
      return result;
    }
  };

  async function preview(
    command: PreviewContextBudgetCommand
  ): Promise<Result<ContextBudgetSnapshot, UnifiedError>> {
    // Read-only: verify the referenced draft revision + checksum before trusting anything on it.
    const resolved = await options.draftSession.resolveStartDraft({
      projectId: command.projectId,
      conversationId: command.conversationId,
      runDraftId: command.runDraftId,
      runDraftRevision: command.expectedDraftRevision,
      runDraftChecksum: command.runDraftChecksum
    });
    if (!resolved.ok) return err(resolved.error);
    const view: AgentRunDraftView = resolved.value;
    const inputs = await options.budgetInputs.resolveBudgetInputs({
      projectId: command.projectId,
      conversationId: command.conversationId,
      draft: view.runDraft,
      contextDraft: view.contextDraft
    });
    if (!inputs.ok) return err(inputs.error);

    const profileId = view.runDraft.modelProfileId;
    const counts = [
      estimator.count(view.runDraft.userRequest, profileId),
      ...inputs.value.contents.map((content) => estimator.count(content.content, profileId))
    ];
    const usedTokens = counts.reduce((total, count) => total + count.tokens, 0);
    const precision: AgentContextPrecision = aggregateContextPrecision(
      counts.map((count) => count.precision)
    );

    return calculateContextBudget({
      contextBudgetSnapshotId: createBudgetSnapshotId(),
      provider: inputs.value.model.provider,
      model: inputs.value.model.model,
      contextWindow: inputs.value.model.contextWindow,
      ...(inputs.value.model.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: inputs.value.model.maxOutputTokens }),
      toolReserve: inputs.value.model.toolReserve,
      systemReserve: inputs.value.model.systemReserve,
      requiredContextTokens: inputs.value.model.requiredContextTokens,
      usedTokens,
      precision,
      calculatedAt: now()
    });
  }
}

function createDefaultBudgetSnapshotId(): string {
  return `budget_${Math.random().toString(36).slice(2, 10)}`;
}
