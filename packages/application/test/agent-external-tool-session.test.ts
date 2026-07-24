/**
 * Phase E / Task 0.3 — Agent external tool session tests.
 * Covers: completed result, outcome_unknown (abort + disconnect), error propagation.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createAgentExternalToolSession,
  type ExternalToolDispatchPort
} from "../src/agent-external-tool-session.js";
import { createUnifiedError } from "@novel-studio/shared";

const signal = new AbortController().signal;

function makeDispatch(
  outcome:
    | { readonly status: "completed"; readonly result: Record<string, unknown> }
    | { readonly status: "outcome_unknown"; readonly reason: string }
    | { readonly status: "error"; readonly error: ReturnType<typeof createUnifiedError> }
    | "throw_abort"
): ExternalToolDispatchPort {
  return {
    callTool: vi.fn(async () => {
      if (outcome === "throw_abort") {
        const err_ = new Error("AbortError");
        err_.name = "AbortError";
        throw err_;
      }
      if (outcome.status === "error") {
        return {
          status: "error" as const,
          error: outcome.error
        };
      }
      return outcome;
    })
  };
}

describe("createAgentExternalToolSession", () => {
  it("returns completed result when dispatch succeeds", async () => {
    const dispatch = makeDispatch({ status: "completed", result: { answer: "42" } });
    const session = createAgentExternalToolSession({ dispatch });
    const result = await session.callTool({
      runId: "r1",
      canonicalToolId: "mcp:server/tool",
      toolArguments: { q: "hello" },
      signal
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
    }
  });

  it("returns outcome_unknown when dispatch returns outcome_unknown", async () => {
    const dispatch = makeDispatch({
      status: "outcome_unknown",
      reason: "connection dropped"
    });
    const session = createAgentExternalToolSession({ dispatch });
    const result = await session.callTool({
      runId: "r1",
      canonicalToolId: "mcp:server/tool",
      toolArguments: {},
      signal
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("outcome_unknown");
      if (result.value.status === "outcome_unknown") {
        expect(result.value.reason).toContain("connection dropped");
      }
    }
  });

  it("returns error when dispatch returns error", async () => {
    const errorVal = createUnifiedError({
      code: "EXTERNAL_TOOL_ERROR",
      category: "AgentError",
      message: "tool failed",
      recoverability: "user-action",
      suggestedAction: "retry",
      traceId: "test"
    });
    const dispatch = makeDispatch({ status: "error", error: errorVal });
    const session = createAgentExternalToolSession({ dispatch });
    const result = await session.callTool({
      runId: "r1",
      canonicalToolId: "mcp:server/tool",
      toolArguments: {},
      signal
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EXTERNAL_TOOL_ERROR");
  });

  it("returns outcome_unknown when dispatch throws AbortError (unconfirmed delivery)", async () => {
    const dispatch = makeDispatch("throw_abort");
    const session = createAgentExternalToolSession({ dispatch });
    const result = await session.callTool({
      runId: "r1",
      canonicalToolId: "mcp:server/tool",
      toolArguments: {},
      signal
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("outcome_unknown");
    }
  });

  it("outcome_unknown is never an error result — never throw", async () => {
    // outcome_unknown should not cause ok:false — it is a valid terminal state
    const dispatch = makeDispatch({ status: "outcome_unknown", reason: "timeout" });
    const session = createAgentExternalToolSession({ dispatch });
    const result = await session.callTool({
      runId: "r1",
      canonicalToolId: "mcp:server/tool",
      toolArguments: {},
      signal
    });
    // Must be ok:true (not an error) even when outcome_unknown
    expect(result.ok).toBe(true);
  });
});
