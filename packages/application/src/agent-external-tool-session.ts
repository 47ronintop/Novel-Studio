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
      const args = input.toolArguments;
      if (!isCanonicalExternalToolId(input.canonicalToolId) || !isSafeJsonObject(args)) {
        return err(
          externalToolError(
            "EXTERNAL_TOOL_INPUT_INVALID",
            "The external tool id or arguments did not satisfy the local invocation contract."
          )
        );
      }
      if (input.idempotencyKey !== undefined && !isSafeIdentifier(input.idempotencyKey)) {
        return err(
          externalToolError(
            "EXTERNAL_TOOL_INPUT_INVALID",
            "The external tool idempotency key is malformed."
          )
        );
      }
      try {
        const outcome = await options.dispatch.callTool({
          canonicalToolId: input.canonicalToolId,
          toolArguments: structuredClone(args),
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          signal: input.signal
        });

        if (outcome.status === "completed") {
          if (!isSafeJsonObject(outcome.result)) {
            return err(
              externalToolError(
                "EXTERNAL_TOOL_RESULT_INVALID",
                "The external tool returned a non-object or oversized result."
              )
            );
          }
          return ok({
            status: "completed",
            result: structuredClone(outcome.result)
          });
        }

        if (outcome.status === "outcome_unknown") {
          if (
            typeof outcome.reason !== "string" ||
            outcome.reason.length === 0 ||
            outcome.reason.length > 1024
          ) {
            return err(
              externalToolError(
                "EXTERNAL_TOOL_RESULT_INVALID",
                "The external tool returned an invalid outcome-unknown reason."
              )
            );
          }
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

function isCanonicalExternalToolId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^(?:mcp|plugin):[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value)
  );
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value);
}

function isSafeJsonObject(
  value: unknown,
  depth = 0,
  nodes = { count: 0 }
): value is import("@novel-studio/shared").JsonObject {
  if (depth > 8 || !isRecord(value)) return false;
  nodes.count += 1;
  if (nodes.count > 512) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length > 128 ||
      // eslint-disable-next-line no-control-regex -- external JSON keys must reject ASCII controls.
      /[\u0000-\u001f\u007f]/u.test(key) ||
      !isSafeJsonValue(entry, depth + 1, nodes)
    ) {
      return false;
    }
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 262_144;
  } catch {
    return false;
  }
}

function isSafeJsonValue(value: unknown, depth: number, nodes: { count: number }): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return typeof value !== "string" || value.length <= 262_144;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (depth > 8) return false;
    for (const entry of value) {
      nodes.count += 1;
      if (nodes.count > 512 || !isSafeJsonValue(entry, depth + 1, nodes)) return false;
    }
    return true;
  }
  return isSafeJsonObject(value, depth, nodes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
