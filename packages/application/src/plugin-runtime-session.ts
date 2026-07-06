import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type { JsonObject, Result, UnifiedError } from "@novel-studio/shared";

import type { ApplicationCommand } from "./command-registry.js";
import type { PluginSettingsEntry, PluginSettingsSnapshot } from "./plugin-settings-session.js";

const PLUGIN_COMMAND_PREFIX = "plugin:";
const PROJECT_SCOPE = "project";

type PluginContributionKind = "command" | "workflow-step";
type PluginRuntimePermission = "project:read" | "workflow:invoke";
export type PluginSandboxTrustState = "trusted-local" | "signed" | "untrusted";
export type PluginSandboxDeniedCapability =
  "asset:write" | "network:access" | "model:invoke" | "shell:execute";

export interface PluginRuntimeCommandInput {
  readonly commandId: string;
  readonly traceId: string;
}

export interface PluginRuntimeWorkflowStepInput {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly input: JsonObject;
  readonly traceId: string;
}

export interface PluginRuntimeAdapterCommandInput {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly traceId: string;
}

export interface PluginRuntimeAdapterWorkflowStepInput {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly input: JsonObject;
  readonly traceId: string;
}

export interface PluginRuntimeAdapterResult {
  readonly output: unknown;
}

export interface PluginRuntimeResult {
  readonly output: JsonObject;
}

export interface PluginSandboxPolicyInput {
  readonly snapshot: PluginSettingsSnapshot;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly trustOverrides?: Readonly<Record<string, PluginSandboxTrustState>>;
}

export interface PluginSandboxPolicyDecision {
  readonly pluginId: string;
  readonly mode: "sandboxed-code";
  readonly allowed: boolean;
  readonly trustState: PluginSandboxTrustState;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly deniedCapabilities: readonly PluginSandboxDeniedCapability[];
  readonly reasons: readonly string[];
}

export interface PluginSandboxPolicyReport {
  readonly schemaVersion: "1.0";
  readonly decisions: readonly PluginSandboxPolicyDecision[];
}

export interface PluginRuntimeAdapter {
  executeHostCommand(
    input: PluginRuntimeAdapterCommandInput
  ): Result<PluginRuntimeAdapterResult, UnifiedError>;
  executeWorkflowStep(
    input: PluginRuntimeAdapterWorkflowStepInput
  ): Result<PluginRuntimeAdapterResult, UnifiedError>;
}

export interface PluginRuntimeSession {
  listCommands(): readonly ApplicationCommand[];
  canExecuteCommand(commandId: string): boolean;
  executeCommand(input: PluginRuntimeCommandInput): Result<PluginRuntimeResult, UnifiedError>;
  runWorkflowStep(input: PluginRuntimeWorkflowStepInput): Result<PluginRuntimeResult, UnifiedError>;
}

export interface PluginRuntimeSessionOptions {
  readonly snapshot: PluginSettingsSnapshot;
  readonly adapter: PluginRuntimeAdapter;
}

export function createPluginRuntimeSession(
  options: PluginRuntimeSessionOptions
): PluginRuntimeSession {
  return {
    listCommands() {
      return options.snapshot.plugins.flatMap((entry) => {
        const commands = entry.manifest?.contributes.commands ?? [];
        return commands.map((command) => {
          const disabledReason = disabledReasonForContribution({
            entry,
            contributionId: command.id,
            kind: "command",
            permission: "project:read"
          });
          const baseCommand: ApplicationCommand = {
            id: toPluginCommandId(entry.pluginId, command.id),
            title: command.title,
            scope: "plugin",
            riskLevel: "safe",
            defaultShortcut: "",
            source: {
              kind: "plugin",
              pluginId: entry.pluginId,
              contributionId: command.id
            }
          };

          return disabledReason === undefined
            ? baseCommand
            : {
                ...baseCommand,
                disabledReason
              };
        });
      });
    },
    canExecuteCommand(commandId) {
      return parsePluginCommandId(commandId) !== undefined;
    },
    executeCommand(input) {
      const parsed = parsePluginCommandId(input.commandId);
      if (parsed === undefined) {
        return runtimeError({
          code: "PLUGIN_RUNTIME_UNSUPPORTED_MODE",
          message: "Command id is not a plugin runtime command.",
          suggestedAction: "Choose a plugin command from the command palette.",
          traceId: input.traceId
        });
      }

      const policy = validateContribution({
        snapshot: options.snapshot,
        pluginId: parsed.pluginId,
        contributionId: parsed.contributionId,
        kind: "command",
        permission: "project:read",
        traceId: input.traceId
      });
      if (!policy.ok) {
        return policy;
      }

      return normalizeAdapterResult(
        options.adapter.executeHostCommand({
          pluginId: parsed.pluginId,
          contributionId: parsed.contributionId,
          traceId: input.traceId
        }),
        input.traceId
      );
    },
    runWorkflowStep(input) {
      const policy = validateContribution({
        snapshot: options.snapshot,
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        kind: "workflow-step",
        permission: "workflow:invoke",
        traceId: input.traceId
      });
      if (!policy.ok) {
        return policy;
      }

      return normalizeAdapterResult(
        options.adapter.executeWorkflowStep({
          pluginId: input.pluginId,
          contributionId: input.contributionId,
          input: input.input,
          traceId: input.traceId
        }),
        input.traceId
      );
    }
  };
}

export function createPluginSandboxPolicyReport(
  input: PluginSandboxPolicyInput
): PluginSandboxPolicyReport {
  const timeoutMs = input.timeoutMs ?? 2000;
  const maxOutputBytes = input.maxOutputBytes ?? 32768;

  return {
    schemaVersion: "1.0",
    decisions: input.snapshot.plugins.map((entry) => {
      const trustState = input.trustOverrides?.[entry.pluginId] ?? defaultTrustState(entry);
      const deniedCapabilities = deniedSandboxCapabilities(entry);
      const reasons = [
        "Sandboxed code execution is disabled until an isolated worker is implemented.",
        ...(trustState === "untrusted"
          ? ["Plugin package is not trusted for code execution."]
          : []),
        ...deniedCapabilities.map(
          (capability) => `Plugin requests denied sandbox capability ${capability}.`
        )
      ];

      return {
        pluginId: entry.pluginId,
        mode: "sandboxed-code",
        allowed: false,
        trustState,
        timeoutMs,
        maxOutputBytes,
        deniedCapabilities,
        reasons
      };
    })
  };
}

function toPluginCommandId(pluginId: string, contributionId: string): string {
  return `${PLUGIN_COMMAND_PREFIX}${pluginId}:${contributionId}`;
}

function parsePluginCommandId(
  commandId: string
): { readonly pluginId: string; readonly contributionId: string } | undefined {
  if (!commandId.startsWith(PLUGIN_COMMAND_PREFIX)) {
    return undefined;
  }

  const body = commandId.slice(PLUGIN_COMMAND_PREFIX.length);
  const separatorIndex = body.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === body.length - 1) {
    return undefined;
  }

  return {
    pluginId: body.slice(0, separatorIndex),
    contributionId: body.slice(separatorIndex + 1)
  };
}

function validateContribution(input: {
  readonly snapshot: PluginSettingsSnapshot;
  readonly pluginId: string;
  readonly contributionId: string;
  readonly kind: PluginContributionKind;
  readonly permission: PluginRuntimePermission;
  readonly traceId: string;
}): Result<true, UnifiedError> {
  const entry = input.snapshot.plugins.find((plugin) => plugin.pluginId === input.pluginId);
  if (entry === undefined) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_UNSUPPORTED_MODE",
      message: "Plugin contribution is not registered.",
      suggestedAction: "Refresh the plugin registry and choose an available contribution.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        contributionId: input.contributionId
      }
    });
  }

  const disabledReason = disabledReasonForContribution({
    entry,
    contributionId: input.contributionId,
    kind: input.kind,
    permission: input.permission
  });
  if (disabledReason !== undefined) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_PERMISSION_DENIED",
      message: disabledReason,
      suggestedAction: "Enable the plugin and grant the requested permission before running it.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        kind: input.kind
      }
    });
  }

  return ok(true);
}

function disabledReasonForContribution(input: {
  readonly entry: PluginSettingsEntry;
  readonly contributionId: string;
  readonly kind: PluginContributionKind;
  readonly permission: PluginRuntimePermission;
}): string | undefined {
  if (input.entry.manifestStatus !== "valid" || input.entry.manifest === undefined) {
    return "Plugin manifest is not valid.";
  }
  if (!input.entry.enabled) {
    return "Plugin is disabled.";
  }

  const contributions =
    input.kind === "command"
      ? input.entry.manifest.contributes.commands
      : input.entry.manifest.contributes.workflowSteps;
  if (!contributions.some((contribution) => contribution.id === input.contributionId)) {
    return `Plugin ${input.kind} contribution is missing.`;
  }
  if (
    !input.entry.manifest.capabilities.some(
      (capability) => capability.type === input.kind && capability.id === input.contributionId
    )
  ) {
    return `Plugin ${input.kind} capability is missing.`;
  }
  if (
    !hasPermission(input.entry.manifest.requestedPermissions, input.permission, PROJECT_SCOPE) ||
    !hasPermission(input.entry.grantedPermissions, input.permission, PROJECT_SCOPE)
  ) {
    return `Plugin is missing ${input.permission} permission for project scope.`;
  }

  return undefined;
}

function hasPermission(
  grants: readonly { readonly permission: string; readonly scopes: readonly string[] }[],
  permission: PluginRuntimePermission,
  scope: string
): boolean {
  return grants.some((grant) => grant.permission === permission && grant.scopes.includes(scope));
}

function defaultTrustState(entry: PluginSettingsEntry): PluginSandboxTrustState {
  return entry.manifestStatus === "valid" && entry.enabled ? "trusted-local" : "untrusted";
}

function deniedSandboxCapabilities(
  entry: PluginSettingsEntry
): readonly PluginSandboxDeniedCapability[] {
  const denied = new Set<PluginSandboxDeniedCapability>();

  for (const grant of entry.manifest?.requestedPermissions ?? []) {
    if (isDeniedSandboxCapability(grant.permission)) {
      denied.add(grant.permission);
    }
  }

  return [...denied];
}

function isDeniedSandboxCapability(value: string): value is PluginSandboxDeniedCapability {
  return (
    value === "asset:write" ||
    value === "network:access" ||
    value === "model:invoke" ||
    value === "shell:execute"
  );
}

function normalizeAdapterResult(
  result: Result<PluginRuntimeAdapterResult, UnifiedError>,
  traceId: string
): Result<PluginRuntimeResult, UnifiedError> {
  if (!result.ok) {
    return result;
  }
  if (!isJsonObject(result.value.output)) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_INVALID_OUTPUT",
      message: "Plugin runtime adapter returned non-structured output.",
      suggestedAction: "Fix the plugin adapter to return a JSON object.",
      traceId
    });
  }

  return ok({ output: result.value.output });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeError(input: {
  readonly code:
    | "PLUGIN_RUNTIME_UNAVAILABLE"
    | "PLUGIN_RUNTIME_PERMISSION_DENIED"
    | "PLUGIN_RUNTIME_TIMEOUT"
    | "PLUGIN_RUNTIME_INVALID_INPUT"
    | "PLUGIN_RUNTIME_INVALID_OUTPUT"
    | "PLUGIN_RUNTIME_ADAPTER_FAILED"
    | "PLUGIN_RUNTIME_UNSUPPORTED_MODE";
  readonly message: string;
  readonly suggestedAction: string;
  readonly traceId: string;
  readonly redactedDetail?: JsonObject;
}): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "PluginError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: input.traceId,
      ...(input.redactedDetail === undefined ? {} : { redactedDetail: input.redactedDetail })
    })
  );
}
