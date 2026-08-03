import {
  agentContextScopeKey,
  isAgentContextScope,
  type AgentContextMode,
  type AgentContextScope,
  type AgentOperationMode
} from "@novel-studio/agent-engine";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export type AgentContextProfileId = "standalone" | "writing" | "creative_general" | "engineering";

export const AGENT_CONTEXT_PROFILE_VERSION = "1.0";

export interface AgentContextProfile {
  readonly profileId: AgentContextProfileId;
  readonly profileVersion: typeof AGENT_CONTEXT_PROFILE_VERSION;
  readonly scope: AgentContextScope;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly workspaceBound: boolean;
  readonly toolPolicy: "empty" | "writing" | "creative_file" | "engineering";
}

export type AgentContextRuntimeFacts =
  | {
      readonly schemaVersion: "1.0";
      readonly scope: Extract<AgentContextScope, { readonly kind: "standalone" }>;
      readonly profileId: "standalone";
      readonly profileVersion: typeof AGENT_CONTEXT_PROFILE_VERSION;
      readonly workspaceBound: false;
      readonly cwd: null;
      readonly projectRoot: null;
      readonly trust: "not_applicable";
      readonly writeApproval: "not_applicable";
      readonly controlledExecutionEnabled: false;
      readonly gitReadEnabled: false;
      readonly networkEnabled: false;
      readonly mcpEnabled: false;
      readonly toolCatalogRevision: string;
      readonly provider: string;
      readonly modelName: string;
    }
  | {
      readonly schemaVersion: "1.0";
      readonly scope: Extract<AgentContextScope, { readonly kind: "workspace" }>;
      readonly profileId: Exclude<AgentContextProfileId, "standalone">;
      readonly profileVersion: typeof AGENT_CONTEXT_PROFILE_VERSION;
      readonly workspaceBound: true;
      readonly cwd: string;
      readonly projectRoot: string;
      readonly trust: "trusted" | "untrusted";
      readonly writeApproval: "required" | "preapproved";
      readonly controlledExecutionEnabled: boolean;
      readonly gitReadEnabled: boolean;
      readonly networkEnabled: boolean;
      readonly mcpEnabled: boolean;
      readonly toolCatalogRevision: string;
      readonly provider: string;
      readonly modelName: string;
      readonly activeResourceRef: string | null;
    };

export function resolveAgentContextProfile(
  scope: AgentContextScope,
  operationMode: AgentOperationMode,
  contextMode: AgentContextMode
): AgentContextProfile {
  const resolved = tryResolveAgentContextProfile(scope, operationMode, contextMode);
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}

export function tryResolveAgentContextProfile(
  scope: AgentContextScope,
  operationMode: AgentOperationMode,
  contextMode: AgentContextMode
): Result<AgentContextProfile, UnifiedError> {
  if (
    !isStrictAgentContextScope(scope) ||
    !isAgentOperationMode(operationMode) ||
    !isAgentContextMode(contextMode)
  ) {
    return invalidProfile(scope, operationMode, contextMode);
  }
  if (scope.kind === "standalone") {
    return operationMode === "conversation" && contextMode === "standalone_chat"
      ? ok(profile("standalone", scope, operationMode, contextMode, false, "empty"))
      : invalidProfile(scope, operationMode, contextMode);
  }
  if (operationMode === "conversation" || contextMode === "standalone_chat") {
    return invalidProfile(scope, operationMode, contextMode);
  }
  if (scope.workspaceKind === "engineeringWorkspace") {
    return contextMode === "general_file"
      ? ok(profile("engineering", scope, operationMode, contextMode, true, "engineering"))
      : invalidProfile(scope, operationMode, contextMode);
  }
  return contextMode === "writing"
    ? ok(profile("writing", scope, operationMode, contextMode, true, "writing"))
    : ok(profile("creative_general", scope, operationMode, contextMode, true, "creative_file"));
}

/** Strict persisted/frozen profile parser; unknown versions and extra fields fail closed. */
export function parseAgentContextProfile(value: unknown): AgentContextProfile {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactlyFields(value as Record<string, unknown>, [
      "profileId",
      "profileVersion",
      "scope",
      "operationMode",
      "contextMode",
      "workspaceBound",
      "toolPolicy"
    ])
  ) {
    throw new Error("AGENT_CONTEXT_PROFILE_INVALID");
  }
  const record = value as Record<string, unknown>;
  const scope = record["scope"];
  const operationMode = record["operationMode"];
  const contextMode = record["contextMode"];
  if (
    record["profileVersion"] !== AGENT_CONTEXT_PROFILE_VERSION ||
    !isStrictAgentContextScope(scope) ||
    !isAgentOperationMode(operationMode) ||
    !isAgentContextMode(contextMode)
  ) {
    throw new Error("AGENT_CONTEXT_PROFILE_INVALID");
  }
  const resolved = resolveAgentContextProfile(scope, operationMode, contextMode);
  if (
    record["profileId"] !== resolved.profileId ||
    record["workspaceBound"] !== resolved.workspaceBound ||
    record["toolPolicy"] !== resolved.toolPolicy
  ) {
    throw new Error("AGENT_CONTEXT_PROFILE_INVALID");
  }
  return resolved;
}

export function createStandaloneRuntimeFacts(input: {
  readonly provider: string;
  readonly modelName: string;
  readonly emptyToolCatalogRevision: string;
}): AgentContextRuntimeFacts {
  return deepFreeze({
    schemaVersion: "1.0",
    scope: { kind: "standalone", scopeId: "standalone" },
    profileId: "standalone",
    profileVersion: AGENT_CONTEXT_PROFILE_VERSION,
    workspaceBound: false,
    cwd: null,
    projectRoot: null,
    trust: "not_applicable",
    writeApproval: "not_applicable",
    controlledExecutionEnabled: false,
    gitReadEnabled: false,
    networkEnabled: false,
    mcpEnabled: false,
    toolCatalogRevision: input.emptyToolCatalogRevision,
    provider: input.provider,
    modelName: input.modelName
  });
}

function profile(
  profileId: AgentContextProfileId,
  scope: AgentContextScope,
  operationMode: AgentOperationMode,
  contextMode: AgentContextMode,
  workspaceBound: boolean,
  toolPolicy: AgentContextProfile["toolPolicy"]
): AgentContextProfile {
  return deepFreeze({
    profileId,
    profileVersion: AGENT_CONTEXT_PROFILE_VERSION,
    scope: structuredClone(scope),
    operationMode,
    contextMode,
    workspaceBound,
    toolPolicy
  });
}

function invalidProfile(
  scope: unknown,
  operationMode: unknown,
  contextMode: unknown
): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_CONTEXT_PROFILE_INVALID",
      category: "ValidationError",
      message: "The requested Agent context scope and modes do not form a supported profile.",
      recoverability: "user-action",
      suggestedAction: "Return to the active workspace surface and retry.",
      traceId: "agent-context-profile",
      redactedDetail: {
        scope: isAgentContextScope(scope) ? agentContextScopeKey(scope) : "invalid",
        operationMode: typeof operationMode === "string" ? operationMode : "invalid",
        contextMode: typeof contextMode === "string" ? contextMode : "invalid"
      }
    })
  );
}

function isAgentOperationMode(value: unknown): value is AgentOperationMode {
  return value === "conversation" || value === "planning" || value === "execution";
}

function isAgentContextMode(value: unknown): value is AgentContextMode {
  return value === "standalone_chat" || value === "writing" || value === "general_file";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isStrictAgentContextScope(value: unknown): value is AgentContextScope {
  if (!isAgentContextScope(value)) return false;
  return value.kind === "standalone"
    ? hasExactlyFields(value, ["kind", "scopeId"])
    : hasExactlyFields(value, ["kind", "workspaceKind", "workspaceId"]);
}
