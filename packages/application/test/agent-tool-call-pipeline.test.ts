import { describe, expect, test, vi } from "vitest";

import {
  createToolCallAssembler,
  dispatchAssembledToolCalls,
  parseToolCallArguments,
  type AssembledToolCall,
  type AssembledToolCallRound
} from "../src/agent-tool-call-pipeline.js";

describe("Agent tool-call pipeline", () => {
  test("assembles interleaved deltas in first-seen source order", () => {
    const assembler = createToolCallAssembler();
    assembler.append({
      toolCallId: "call-one",
      name: "read_",
      argumentsDelta: '{"path":"one',
      providerMetadata: { thoughtSignature: "signature-one" }
    });
    assembler.append({
      toolCallId: "call-two",
      name: "read_project_text",
      argumentsDelta: '{"path":"two.md"}'
    });
    assembler.append({
      toolCallId: "call-one",
      name: "project_text",
      argumentsDelta: '.md"}'
    });
    assembler.complete("tool_calls");

    expect(assembler.snapshot()).toEqual({
      finishReason: "tool_calls",
      calls: [
        {
          toolCallId: "call-one",
          name: "read_project_text",
          argumentsText: '{"path":"one.md"}',
          providerMetadata: { thoughtSignature: "signature-one" }
        },
        {
          toolCallId: "call-two",
          name: "read_project_text",
          argumentsText: '{"path":"two.md"}'
        }
      ]
    });
  });

  test.each([
    ["stop", "AGENT_TOOL_CALL_INCOMPLETE"],
    ["length", "AGENT_TOOL_CALL_TRUNCATED"],
    ["content_filter", "AGENT_TOOL_CALL_CONTENT_FILTER"],
    ["aborted", "AGENT_TOOL_CALL_ABORTED"],
    ["error", "AGENT_TOOL_CALL_STREAM_ERROR"],
    ["unknown", "AGENT_TOOL_CALL_INCOMPLETE"],
    [undefined, "AGENT_TOOL_CALL_INCOMPLETE"]
  ] as const)(
    "rejects assembled calls without a tool_calls terminal state: %s",
    async (finishReason, expectedCode) => {
      const dispatch = vi.fn(async () => "continue" as const);
      const reject = vi.fn(async () => "continue" as const);
      const skip = vi.fn(async () => undefined);

      const result = await dispatchAssembledToolCalls({
        round: round(finishReason),
        effectFor: () => "read",
        reject,
        skip,
        dispatch,
        mayContinue: (outcome) => outcome === "continue",
        isActive: () => true
      });

      expect(result.kind).toBe("rejected");
      expect(dispatch).not.toHaveBeenCalled();
      expect(reject).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: "call-one" }),
        expect.objectContaining({ code: expectedCode, finishReason })
      );
    }
  );

  test("normalizes conflicting round completion events to unknown", () => {
    const assembler = createToolCallAssembler();
    assembler.append(call("call-one"));
    assembler.complete("tool_calls");
    assembler.complete("length");

    expect(assembler.snapshot().finishReason).toBe("unknown");
  });

  test("invalidates a tool_calls terminal state when another tool delta arrives afterward", () => {
    const assembler = createToolCallAssembler();
    assembler.append(call("call-one"));
    assembler.complete("tool_calls");
    assembler.append({ toolCallId: "call-one", argumentsDelta: " " });

    expect(assembler.snapshot().finishReason).toBe("unknown");
  });

  test("preserves source order and stops dispatch when an approval pauses the batch", async () => {
    const handled: string[] = [];

    const result = await dispatchAssembledToolCalls({
      round: {
        finishReason: "tool_calls",
        calls: [call("call-one"), call("call-two"), call("call-three")]
      },
      effectFor: () => "read",
      reject: async () => "continue" as const,
      skip: async (current) => {
        handled.push(`skipped:${current.toolCallId}`);
      },
      dispatch: async (current) => {
        handled.push(current.toolCallId);
        return current.toolCallId === "call-two" ? ("paused" as const) : ("continue" as const);
      },
      mayContinue: (outcome) => outcome === "continue",
      isActive: () => true
    });

    expect(result).toEqual({ kind: "dispatched", outcomes: ["continue", "paused"] });
    expect(handled).toEqual(["call-one", "call-two", "skipped:call-three"]);
  });

  test("preserves model source order and stops later calls at the first proposal boundary", async () => {
    const dispatched: string[] = [];
    const skipped: string[] = [];
    const proposal = { ...call("call-proposal"), name: "edit_text" };

    const result = await dispatchAssembledToolCalls({
      round: {
        finishReason: "tool_calls",
        calls: [call("call-read"), proposal, { ...call("call-finish"), name: "finish" }]
      },
      effectFor: (current) => (current.name === "edit_text" ? "propose" : "read"),
      reject: async () => "continue" as const,
      skip: async (current) => {
        skipped.push(current.toolCallId);
      },
      dispatch: async (current) => {
        dispatched.push(current.toolCallId);
        return current.name === "edit_text" ? ("staged" as const) : ("continue" as const);
      },
      mayContinue: (outcome) => outcome === "continue",
      isActive: () => true
    });

    expect(result).toEqual({ kind: "dispatched", outcomes: ["continue", "staged"] });
    expect(dispatched).toEqual(["call-read", "call-proposal"]);
    expect(skipped).toEqual(["call-finish"]);
  });

  test("does not launch another call after cancellation", async () => {
    const handled: string[] = [];
    let active = true;

    const result = await dispatchAssembledToolCalls({
      round: {
        finishReason: "tool_calls",
        calls: [call("call-one"), call("call-two")]
      },
      effectFor: () => "read",
      reject: async () => "continue" as const,
      skip: async () => undefined,
      dispatch: async (current) => {
        handled.push(current.toolCallId);
        active = false;
        return "continue" as const;
      },
      mayContinue: (outcome) => outcome === "continue",
      isActive: () => active
    });

    expect(result).toEqual({ kind: "interrupted", outcomes: ["continue"] });
    expect(handled).toEqual(["call-one"]);
  });

  test("rejects truncated JSON before schema or handler dispatch", () => {
    expect(parseToolCallArguments('{"path":')).toMatchObject({
      ok: false,
      error: {
        code: "AGENT_TOOL_ARGUMENTS_INVALID",
        message: "Tool arguments are incomplete JSON."
      }
    });
  });
});

function round(finishReason: AssembledToolCallRound["finishReason"]): AssembledToolCallRound {
  return { finishReason, calls: [call("call-one")] };
}

function call(toolCallId: string): AssembledToolCall {
  return {
    toolCallId,
    name: "read_project_text",
    argumentsText: '{"path":"notes.md"}'
  };
}
