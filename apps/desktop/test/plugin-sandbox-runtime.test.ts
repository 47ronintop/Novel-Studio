/**
 * Task E.1 — Plugin sandbox runtime tests.
 * Covers: success path, launcher UNAVAILABLE, pre-aborted signal,
 * abort mid-flight, malformed JSON stdout, truncated output.
 */
import { describe, it, expect } from "vitest";
import { createPluginSandboxRuntime } from "../src/main/plugin-sandbox-runtime.js";
import type { PluginSandboxHostLauncher } from "../src/main/plugin-sandbox-runtime.js";
import { ok, err, createUnifiedError } from "@novel-studio/shared";

function makeUnavailableError(code = "PLUGIN_SANDBOX_UNAVAILABLE") {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: "Native sandbox host unavailable.",
    recoverability: "user-action",
    suggestedAction: "Ensure the packaged sandbox host binary is present.",
    traceId: "plugin-sandbox-runtime-test"
  });
}

function makeLauncher(
  factory: (input: { readonly signal: AbortSignal }) => Promise<
    ReturnType<PluginSandboxHostLauncher["launchPluginTool"]>
  >
): PluginSandboxHostLauncher {
  return {
    launchPluginTool: (input) => factory({ signal: input.signal })
  };
}

const CALL_INPUT = {
  pluginId: "com.example.summarise",
  toolId: "summarise",
  toolArguments: { text: "hello" },
  signal: new AbortController().signal
};

describe("createPluginSandboxRuntime — success", () => {
  it("parses JSON stdout into a completed result", async () => {
    const launcher = makeLauncher(() =>
      Promise.resolve(ok({ stdout: JSON.stringify({ summary: "ok" }), truncated: false }))
    );
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool(CALL_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("completed");
      if (result.value.status === "completed") {
        expect(result.value.result["summary"]).toBe("ok");
      }
    }
  });

  it("surfaces truncated flag when stdout was capped", async () => {
    const launcher = makeLauncher(() =>
      Promise.resolve(ok({ stdout: JSON.stringify({ x: 1 }), truncated: true }))
    );
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool(CALL_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.status === "completed") {
      expect(result.value.result["truncated"]).toBe(true);
    }
  });
});

describe("createPluginSandboxRuntime — failure paths", () => {
  it("propagates launcher UNAVAILABLE error as-is", async () => {
    const unavailable = makeUnavailableError();
    const launcher = makeLauncher(() => Promise.resolve(err(unavailable)));
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool(CALL_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_SANDBOX_UNAVAILABLE");
    }
  });

  it("returns PLUGIN_SANDBOX_INVALID_OUTPUT for malformed JSON stdout", async () => {
    const launcher = makeLauncher(() =>
      Promise.resolve(ok({ stdout: "not-json{{", truncated: false }))
    );
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool(CALL_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_SANDBOX_INVALID_OUTPUT");
    }
  });

  it("returns PLUGIN_SANDBOX_INVALID_OUTPUT for non-object JSON", async () => {
    const launcher = makeLauncher(() =>
      Promise.resolve(ok({ stdout: '"just a string"', truncated: false }))
    );
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool(CALL_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLUGIN_SANDBOX_INVALID_OUTPUT");
    }
  });

  it("returns outcome_unknown when signal is pre-aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const launcher = makeLauncher(() => Promise.resolve(ok({ stdout: "{}", truncated: false })));
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool({ ...CALL_INPUT, signal: ctrl.signal });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("outcome_unknown");
    }
  });

  it("returns outcome_unknown when signal aborts during launch", async () => {
    const ctrl = new AbortController();
    const launcher = makeLauncher(async ({ signal }) => {
      // Simulate abort during launcher execution
      ctrl.abort();
      // If signal is already aborted at the time the caller checks, caller detects it
      if (signal.aborted) {
        return err(makeUnavailableError("ABORTED_DURING_LAUNCH"));
      }
      return ok({ stdout: "{}", truncated: false });
    });
    const runtime = createPluginSandboxRuntime({ launcher });
    const result = await runtime.callTool({ ...CALL_INPUT, signal: ctrl.signal });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("outcome_unknown");
    }
  });
});
