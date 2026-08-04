import { Buffer } from "node:buffer";

import type { LlmRoundFinishReason } from "@novel-studio/llm-adapter";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import { validateFinishInput } from "@novel-studio/agent-engine";

export const MAX_TOOL_ARGUMENT_UTF8_BYTES = 1_048_576;

export interface AssembledToolCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly argumentsText: string;
  readonly providerMetadata?: JsonObject;
}

export interface ToolCallDelta {
  readonly toolCallId: string;
  readonly name?: string;
  readonly argumentsDelta?: string;
  readonly providerMetadata?: JsonObject;
}

export interface AssembledToolCallRound {
  readonly finishReason: LlmRoundFinishReason | undefined;
  readonly calls: readonly AssembledToolCall[];
}

export interface ToolCallAssembler {
  append(delta: ToolCallDelta): void;
  complete(finishReason: LlmRoundFinishReason): void;
  snapshot(): AssembledToolCallRound;
}

/** Collects provider deltas in first-seen call order and owns the round terminal state. */
export function createToolCallAssembler(): ToolCallAssembler {
  const calls = new Map<
    string,
    {
      toolCallId: string;
      name: string;
      argumentsText: string;
      providerMetadata?: JsonObject;
    }
  >();
  let finishReason: LlmRoundFinishReason | undefined;

  return {
    append(delta) {
      if (finishReason !== undefined) finishReason = "unknown";
      const existing = calls.get(delta.toolCallId) ?? {
        toolCallId: delta.toolCallId,
        name: "",
        argumentsText: ""
      };
      if (delta.name !== undefined) existing.name += delta.name;
      if (delta.argumentsDelta !== undefined) existing.argumentsText += delta.argumentsDelta;
      if (delta.providerMetadata !== undefined) {
        existing.providerMetadata = {
          ...(existing.providerMetadata ?? {}),
          ...delta.providerMetadata
        };
      }
      calls.set(delta.toolCallId, existing);
    },
    complete(nextFinishReason) {
      finishReason =
        finishReason === undefined || finishReason === nextFinishReason
          ? nextFinishReason
          : "unknown";
    },
    snapshot() {
      return {
        finishReason,
        calls: [...calls.values()].map((call) => ({ ...call }))
      };
    }
  };
}

export interface ToolCallDispatchFailure {
  readonly code: string;
  readonly message: string;
  readonly finishReason: LlmRoundFinishReason | undefined;
}

export type ToolCallDispatchResult<TOutcome> =
  | { readonly kind: "empty"; readonly outcomes: readonly TOutcome[] }
  | { readonly kind: "rejected"; readonly outcomes: readonly TOutcome[] }
  | { readonly kind: "dispatched"; readonly outcomes: readonly TOutcome[] }
  | { readonly kind: "interrupted"; readonly outcomes: readonly TOutcome[] };

/**
 * Enforces the round terminal-state gate before invoking any tool handler. Calls are always
 * processed in the model's source order. An effectful call therefore reaches its approval/pause
 * boundary before any later call can run; the dispatcher never reorders proposals ahead of reads.
 */
export async function dispatchAssembledToolCalls<TOutcome>(input: {
  readonly round: AssembledToolCallRound;
  readonly effectFor: (call: AssembledToolCall) => string | undefined;
  readonly reject: (call: AssembledToolCall, failure: ToolCallDispatchFailure) => Promise<TOutcome>;
  readonly skip: (call: AssembledToolCall, failure: ToolCallDispatchFailure) => Promise<void>;
  readonly dispatch: (call: AssembledToolCall) => Promise<TOutcome>;
  readonly mayContinue: (outcome: TOutcome) => boolean;
  readonly isActive: () => boolean;
  /** Optional strict per-tool argument gate. A failure is routed to `reject` before dispatch. */
  readonly validateCall?: (call: AssembledToolCall) => ToolCallDispatchFailure | undefined;
}): Promise<ToolCallDispatchResult<TOutcome>> {
  if (input.round.calls.length === 0) {
    return { kind: "empty", outcomes: [] };
  }

  if (input.round.finishReason !== "tool_calls") {
    const failure = incompleteRoundFailure(input.round.finishReason);
    return runCalls({
      kind: "rejected",
      calls: input.round.calls,
      invoke: (call) => input.reject(call, failure),
      skip: input.skip,
      mayContinue: input.mayContinue,
      isActive: input.isActive
    });
  }

  return runCalls({
    kind: "dispatched",
    calls: input.round.calls,
    invoke: async (call) => {
      const failure = input.validateCall?.(call);
      return failure === undefined ? input.dispatch(call) : input.reject(call, failure);
    },
    skip: input.skip,
    mayContinue: input.mayContinue,
    isActive: input.isActive
  });
}

/** Strictly validate the arguments of a `finish` protocol call before invoking its handler. */
export function validateFinishToolCall(
  call: AssembledToolCall
): ToolCallDispatchFailure | undefined {
  if (call.name !== "finish") return undefined;
  const parsed = parseToolCallArguments(call.argumentsText);
  if (!parsed.ok) {
    return {
      code: parsed.error.code,
      message: parsed.error.message,
      finishReason: "tool_calls"
    };
  }
  const validated = validateFinishInput(parsed.value);
  if (validated.ok) return undefined;
  return {
    code: validated.error.code,
    message: validated.error.message,
    finishReason: "tool_calls"
  };
}

export function parseToolCallArguments(value: string): Result<JsonObject, UnifiedError> {
  if (Buffer.byteLength(value, "utf8") > MAX_TOOL_ARGUMENT_UTF8_BYTES) {
    return err(
      toolCallError(
        "AGENT_TOOL_ARGUMENTS_TOO_LARGE",
        "Tool arguments exceed the 1 MiB UTF-8 limit."
      )
    );
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed)
      ? ok(parsed)
      : err(toolCallError("AGENT_TOOL_ARGUMENTS_INVALID", "Tool arguments must be an object."));
  } catch {
    return err(
      toolCallError("AGENT_TOOL_ARGUMENTS_INVALID", "Tool arguments are incomplete JSON.")
    );
  }
}

async function runCalls<TOutcome>(input: {
  readonly kind: "rejected" | "dispatched";
  readonly calls: readonly AssembledToolCall[];
  readonly invoke: (call: AssembledToolCall) => Promise<TOutcome>;
  readonly skip: (call: AssembledToolCall, failure: ToolCallDispatchFailure) => Promise<void>;
  readonly mayContinue: (outcome: TOutcome) => boolean;
  readonly isActive: () => boolean;
}): Promise<ToolCallDispatchResult<TOutcome>> {
  const outcomes: TOutcome[] = [];
  for (const [index, call] of input.calls.entries()) {
    if (!input.isActive()) return { kind: "interrupted", outcomes };
    const outcome = await input.invoke(call);
    outcomes.push(outcome);
    if (!input.mayContinue(outcome)) {
      if (input.isActive()) {
        await skipCalls(input.calls.slice(index + 1), input.skip);
      }
      return { kind: input.kind, outcomes };
    }
  }
  return { kind: input.kind, outcomes };
}

async function skipCalls(
  calls: readonly AssembledToolCall[],
  skip: (call: AssembledToolCall, failure: ToolCallDispatchFailure) => Promise<void>
): Promise<void> {
  const failure: ToolCallDispatchFailure = {
    code: "AGENT_TOOL_CALL_SKIPPED_IN_EFFECTFUL_BATCH",
    message:
      "The tool call was not executed because another call in the same batch requires a serialized approval boundary.",
    finishReason: "tool_calls"
  };
  for (const call of calls) await skip(call, failure);
}

function incompleteRoundFailure(
  finishReason: LlmRoundFinishReason | undefined
): ToolCallDispatchFailure {
  const code =
    finishReason === "length"
      ? "AGENT_TOOL_CALL_TRUNCATED"
      : finishReason === "content_filter"
        ? "AGENT_TOOL_CALL_CONTENT_FILTER"
        : finishReason === "aborted"
          ? "AGENT_TOOL_CALL_ABORTED"
          : finishReason === "error"
            ? "AGENT_TOOL_CALL_STREAM_ERROR"
            : "AGENT_TOOL_CALL_INCOMPLETE";
  return {
    code,
    message: `Tool calls cannot be executed: model round ended with finish_reason=${String(finishReason ?? "missing")}.`,
    finishReason
  };
}

function toolCallError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError",
    message,
    recoverability: "user-action",
    suggestedAction: "Retry the model round with a complete tool call.",
    traceId: "agent-tool-call-pipeline"
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
