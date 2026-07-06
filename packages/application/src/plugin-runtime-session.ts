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

export interface PluginSandboxFixtureWorkerOutput {
  readonly output: JsonObject;
  readonly durationMs?: number;
}

export interface PluginSandboxFixtureWorkerOptions {
  readonly fixtures: Readonly<Record<string, PluginSandboxFixtureWorkerOutput>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface PluginIsolationWorkerPrototypeOptions {
  readonly plan: PluginSandboxIsolationPlan;
  readonly fixtures: Readonly<Record<string, PluginSandboxFixtureWorkerOutput>>;
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

export type PluginSandboxIsolationRuntimeKind = "worker-thread" | "utility-process";
export type PluginSandboxIsolationReadiness = "blocked" | "ready";
export type PluginSandboxIsolationSigning = "required" | "satisfied";

export interface PluginSandboxIsolationInput {
  readonly snapshot: PluginSettingsSnapshot;
  readonly runtimeKind?: PluginSandboxIsolationRuntimeKind;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signedPluginIds?: readonly string[];
}

export interface PluginSandboxIsolationWorkerPlan {
  readonly pluginId: string;
  readonly executable: boolean;
  readonly readiness: PluginSandboxIsolationReadiness;
  readonly signing: PluginSandboxIsolationSigning;
  readonly teardown: "required";
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly deniedCapabilities: readonly PluginSandboxDeniedCapability[];
  readonly reasons: readonly string[];
}

export interface PluginSandboxIsolationPlan {
  readonly schemaVersion: "1.0";
  readonly runtimeKind: PluginSandboxIsolationRuntimeKind;
  readonly workers: readonly PluginSandboxIsolationWorkerPlan[];
}

export interface PluginSecurityAuditEntry {
  readonly pluginId: string;
  readonly trustState: PluginSandboxTrustState;
  readonly signing: PluginSandboxIsolationSigning;
  readonly readiness: PluginSandboxIsolationReadiness;
  readonly executable: boolean;
  readonly deniedCapabilities: readonly PluginSandboxDeniedCapability[];
  readonly requestedPermissions: readonly string[];
  readonly grantedPermissions: readonly string[];
  readonly auditEvents: readonly string[];
}

export interface PluginSecurityAuditReport {
  readonly schemaVersion: "1.0";
  readonly plugins: readonly PluginSecurityAuditEntry[];
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

export function createPluginSandboxIsolationPlan(
  input: PluginSandboxIsolationInput
): PluginSandboxIsolationPlan {
  const runtimeKind = input.runtimeKind ?? "utility-process";
  const timeoutMs = input.timeoutMs ?? 2000;
  const maxOutputBytes = input.maxOutputBytes ?? 32768;
  const signedPluginIds = new Set(input.signedPluginIds ?? []);

  return {
    schemaVersion: "1.0",
    runtimeKind,
    workers: input.snapshot.plugins.map((entry) => {
      const deniedCapabilities = deniedSandboxCapabilities(entry);
      const signing: PluginSandboxIsolationSigning = signedPluginIds.has(entry.pluginId)
        ? "satisfied"
        : "required";
      const executable = signing === "satisfied" && deniedCapabilities.length === 0;
      const reasons = [
        ...(signing === "required"
          ? ["Plugin package must be signed or explicitly trusted before isolated execution."]
          : []),
        ...deniedCapabilities.map(
          (capability) => `Plugin requests denied sandbox capability ${capability}.`
        ),
        ...(executable ? [] : ["Real isolated worker execution is not enabled by this spike."])
      ];

      return {
        pluginId: entry.pluginId,
        executable,
        readiness: executable ? "ready" : "blocked",
        signing,
        teardown: "required",
        timeoutMs,
        maxOutputBytes,
        deniedCapabilities,
        reasons
      };
    })
  };
}

export function createPluginSecurityAuditReport(
  input: PluginSandboxIsolationInput
): PluginSecurityAuditReport {
  const isolationPlan = createPluginSandboxIsolationPlan(input);

  return {
    schemaVersion: "1.0",
    plugins: input.snapshot.plugins.map((entry) => {
      const workerPlan = isolationPlan.workers.find((worker) => worker.pluginId === entry.pluginId);
      return {
        pluginId: entry.pluginId,
        trustState: defaultTrustState(entry),
        signing: workerPlan?.signing ?? "required",
        readiness: workerPlan?.readiness ?? "blocked",
        executable: workerPlan?.executable ?? false,
        deniedCapabilities: workerPlan?.deniedCapabilities ?? [],
        requestedPermissions: permissionLabels(entry.manifest?.requestedPermissions ?? []),
        grantedPermissions: permissionLabels(entry.grantedPermissions),
        auditEvents: workerPlan?.reasons ?? ["Plugin isolation plan is unavailable."]
      };
    })
  };
}

export function createPluginIsolationWorkerPrototypeAdapter(
  options: PluginIsolationWorkerPrototypeOptions
): PluginRuntimeAdapter {
  return {
    executeHostCommand(input) {
      return runIsolationWorkerPrototype({
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        traceId: input.traceId,
        options
      });
    },
    executeWorkflowStep(input) {
      return runIsolationWorkerPrototype({
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        traceId: input.traceId,
        options
      });
    }
  };
}

export function createPluginSandboxFixtureWorkerAdapter(
  options: PluginSandboxFixtureWorkerOptions
): PluginRuntimeAdapter {
  return {
    executeHostCommand(input) {
      return runFixtureWorker({
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        traceId: input.traceId,
        options
      });
    },
    executeWorkflowStep(input) {
      return runFixtureWorker({
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        traceId: input.traceId,
        options
      });
    }
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

function permissionLabels(
  grants: readonly { readonly permission: string; readonly scopes: readonly string[] }[]
): readonly string[] {
  return grants.map((grant) => `${grant.permission}:${grant.scopes.join(",")}`);
}

function runFixtureWorker(input: {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly traceId: string;
  readonly options: PluginSandboxFixtureWorkerOptions;
}): Result<PluginRuntimeAdapterResult, UnifiedError> {
  const fixture = input.options.fixtures[fixtureKey(input.pluginId, input.contributionId)];
  if (fixture === undefined) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_UNAVAILABLE",
      message: "No sandbox fixture worker output is registered for this contribution.",
      suggestedAction: "Register a fixture worker output before running the plugin contribution.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        contributionId: input.contributionId
      }
    });
  }

  const durationMs = fixture.durationMs ?? 0;
  if (durationMs > input.options.timeoutMs) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_TIMEOUT",
      message: "Plugin sandbox fixture worker exceeded the configured timeout.",
      suggestedAction: "Reduce plugin work or increase the sandbox timeout after review.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        durationMs,
        timeoutMs: input.options.timeoutMs,
        teardown: "completed"
      }
    });
  }

  const outputBytes = jsonByteLength(fixture.output);
  if (outputBytes > input.options.maxOutputBytes) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_INVALID_OUTPUT",
      message: "Plugin sandbox fixture worker output exceeded the configured payload limit.",
      suggestedAction: "Return a smaller structured payload from the plugin contribution.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        contributionId: input.contributionId,
        outputBytes,
        maxOutputBytes: input.options.maxOutputBytes
      }
    });
  }

  return ok({ output: fixture.output });
}

function runIsolationWorkerPrototype(input: {
  readonly pluginId: string;
  readonly contributionId: string;
  readonly traceId: string;
  readonly options: PluginIsolationWorkerPrototypeOptions;
}): Result<PluginRuntimeAdapterResult, UnifiedError> {
  const workerPlan = input.options.plan.workers.find(
    (worker) => worker.pluginId === input.pluginId
  );
  if (workerPlan === undefined) {
    return runtimeError({
      code: "PLUGIN_RUNTIME_UNAVAILABLE",
      message: "No isolated worker plan is registered for this plugin.",
      suggestedAction: "Refresh the plugin sandbox isolation plan before running this plugin.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        runtimeKind: input.options.plan.runtimeKind
      }
    });
  }

  if (!workerPlan.executable || workerPlan.readiness !== "ready") {
    return runtimeError({
      code: "PLUGIN_RUNTIME_PERMISSION_DENIED",
      message: "Plugin isolated worker execution is blocked by the sandbox plan.",
      suggestedAction: "Satisfy plugin signing and remove denied capabilities before execution.",
      traceId: input.traceId,
      redactedDetail: {
        pluginId: input.pluginId,
        readiness: workerPlan.readiness,
        signing: workerPlan.signing,
        deniedCapabilities: [...workerPlan.deniedCapabilities]
      }
    });
  }

  return runFixtureWorker({
    pluginId: input.pluginId,
    contributionId: input.contributionId,
    traceId: input.traceId,
    options: {
      fixtures: input.options.fixtures,
      timeoutMs: workerPlan.timeoutMs,
      maxOutputBytes: workerPlan.maxOutputBytes
    }
  });
}

function fixtureKey(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`;
}

function jsonByteLength(value: JsonObject): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
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
