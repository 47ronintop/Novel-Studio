/**
 * Task E.1 — production PluginSandboxPort adapter.
 *
 * This adapter does NOT import node:child_process and does NOT talk to the native sandbox
 * host directly — apps/desktop/src/main/agent-task-sandbox.ts remains the only file allowed
 * to do that. Instead this adapter depends on an injected PluginSandboxHostLauncher port.
 * The real wiring of that launcher to the verified native host's "plugin" sandbox profile
 * happens later during integration (out of scope here, by design — see the module-level
 * comment in the design doc for Task E.1).
 *
 * Abort semantics mirror packages/application/src/agent-external-tool-session.ts: a signal
 * that is already aborted, or aborts mid-flight with no confirmed result, becomes
 * outcome_unknown — never auto-retried. Launcher UNAVAILABLE-style errors are propagated
 * unchanged; they are never downgraded to outcome_unknown or upgraded to completed.
 */
import { err, ok, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import type {
  PluginSandboxPort,
  PluginSandboxToolCallInput,
  PluginSandboxToolCallOutcome
} from "@novel-studio/application";

/** Applied when a plugin manifest tool declaration omits an explicit override. */
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MAX_OUTPUT_BYTES = 32768;

export interface PluginSandboxHostLauncherOutput {
  readonly stdout: string;
  readonly truncated: boolean;
}

export interface PluginSandboxHostLauncher {
  /**
   * Launches one plugin tool call inside the native host's verified "plugin" profile.
   * Returns UNAVAILABLE (never throws, never falls back) when the host/profile can't be
   * verified. Implementations should settle promptly on `signal` abort rather than hang.
   */
  launchPluginTool(input: {
    readonly pluginId: string;
    readonly toolId: string;
    readonly toolArgumentsJson: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly signal: AbortSignal;
  }): Promise<Result<PluginSandboxHostLauncherOutput, UnifiedError>>;
}

export function createPluginSandboxRuntime(options: {
  readonly launcher: PluginSandboxHostLauncher;
}): PluginSandboxPort {
  return {
    async callTool(
      input: PluginSandboxToolCallInput
    ): Promise<Result<PluginSandboxToolCallOutcome, UnifiedError>> {
      if (input.signal.aborted) {
        return ok(abortOutcome("cancelled before delivery could be confirmed"));
      }

      let launched: Result<PluginSandboxHostLauncherOutput, UnifiedError>;
      try {
        launched = await options.launcher.launchPluginTool({
          pluginId: input.pluginId,
          toolId: input.toolId,
          toolArgumentsJson: JSON.stringify(input.toolArguments),
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
          signal: input.signal
        });
      } catch (error) {
        if (input.signal.aborted) {
          return ok(abortOutcome("aborted before delivery could be confirmed"));
        }
        return err(
          sandboxError(
            "PLUGIN_SANDBOX_LAUNCHER_FAILED",
            error instanceof Error ? error.message : "Plugin sandbox launcher failed unexpectedly."
          )
        );
      }

      if (!launched.ok) {
        if (input.signal.aborted) {
          return ok(abortOutcome("aborted before delivery could be confirmed"));
        }
        // Propagate launcher UNAVAILABLE-style errors unchanged — never fabricate
        // outcome_unknown or completed here.
        return launched;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(launched.value.stdout);
      } catch {
        return err(
          sandboxError(
            "PLUGIN_SANDBOX_INVALID_OUTPUT",
            "Plugin sandbox host returned output that is not valid JSON."
          )
        );
      }

      if (!isJsonObject(parsed)) {
        return err(
          sandboxError(
            "PLUGIN_SANDBOX_INVALID_OUTPUT",
            "Plugin sandbox host returned JSON that is not a structured object."
          )
        );
      }

      const result: JsonObject = launched.value.truncated ? { ...parsed, truncated: true } : parsed;

      return ok({ status: "completed", result });
    }
  };
}

function abortOutcome(reasonSuffix: string): PluginSandboxToolCallOutcome {
  return {
    status: "outcome_unknown",
    reason: `The plugin tool call was ${reasonSuffix}. Manual recovery may be required.`
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sandboxError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "PluginError",
    message,
    recoverability: "user-action",
    suggestedAction: "Check the plugin sandbox host output and retry the tool call.",
    traceId: "plugin-sandbox-runtime"
  });
}
