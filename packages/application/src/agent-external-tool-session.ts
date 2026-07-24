/**
 * Phase E / Task 0.3 — External tool session.
 * Handles dynamic tool invocation for remote MCP tools.
 * outcome_unknown is a first-class terminal state; no auto-retry.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { AgentExternalToolExecutor, AgentExternalToolOutcome } from "./agent-tool-ports.js";

export interface ExternalToolDispatchPort {
  /** Resolve and call the remote/plugin tool by canonical ID. */
  callTool(input: {
    readonly canonicalToolId: string;
    readonly toolArguments: Record<string, unknown>;
    readonly idempotencyKey?: string;
    readonly signal: AbortSignal;
  }): Promise<
    | { readonly status: "completed"; readonly result: Record<string, unknown> }
    | { readonly status: "outcome_unknown"; readonly reason: string }
    | { readonly status: "error"; readonly error: UnifiedError }
  >;
}

export interface CreateAgentExternalToolSessionOptions {
  readonly dispatch: ExternalToolDispatchPort;
}

function externalToolError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "AgentError" as const,
    message,
    recoverability: "user-action",
    suggestedAction: "Check the external tool configuration and retry.",
    traceId: "agent-external-tool-session"
  });
}

export function createAgentExternalToolSession(
  options: CreateAgentExternalToolSessionOptions
): AgentExternalToolExecutor {
  return {
    async callTool(input): Promise<Result<AgentExternalToolOutcome, UnifiedError>> {
      const args = input.toolArguments as Record<string, unknown>;
      try {
        const outcome = await options.dispatch.callTool({
          canonicalToolId: input.canonicalToolId,
          toolArguments: args,
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          signal: input.signal
        });

        if (outcome.status === "completed") {
          return ok({
            status: "completed",
            result: outcome.result as import("@novel-studio/shared").JsonObject
          });
        }

        if (outcome.status === "outcome_unknown") {
          // outcome_unknown is a terminal state — never auto-retry
          return ok({ status: "outcome_unknown", reason: outcome.reason });
        }

        // status === "error"
        return err(outcome.error);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          // Signal-aborted calls that didn't confirm delivery → outcome_unknown
          return ok({
            status: "outcome_unknown",
            reason:
              "The external tool call was aborted before delivery could be confirmed. Manual recovery may be required."
          });
        }
        const msg = error instanceof Error ? error.message : "External tool call failed.";
        return err(externalToolError("EXTERNAL_TOOL_CALL_FAILED", msg));
      }
    }
  };
}
