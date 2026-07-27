import type { JsonObject } from "@novel-studio/shared";
import type { AgentWorkspaceKind } from "./agent-tool-capabilities.js";

export type AgentContextScope =
  | { readonly kind: "standalone"; readonly scopeId: "standalone" }
  | {
      readonly kind: "workspace";
      readonly workspaceKind: AgentWorkspaceKind;
      readonly workspaceId: string;
    };

export type AgentContextProfileId = "standalone" | "writing" | "creative_general" | "engineering";

export const STANDALONE_AGENT_CONTEXT_SCOPE: AgentContextScope = Object.freeze({
  kind: "standalone",
  scopeId: "standalone"
});

export function isAgentContextScope(value: unknown): value is AgentContextScope {
  if (!isRecord(value)) return false;
  if (value["kind"] === "standalone") return value["scopeId"] === "standalone";
  return (
    value["kind"] === "workspace" &&
    (value["workspaceKind"] === "creativeProject" ||
      value["workspaceKind"] === "engineeringWorkspace") &&
    isSafeScopeId(value["workspaceId"])
  );
}

export function normalizeAgentContextScope(
  value: unknown,
  legacyProjectId?: unknown,
  legacyWorkspaceKind: AgentWorkspaceKind = "creativeProject"
): AgentContextScope {
  if (isAgentContextScope(value)) return deepFreeze(structuredClone(value));
  if (isSafeScopeId(legacyProjectId)) {
    return Object.freeze({
      kind: "workspace",
      workspaceKind: legacyWorkspaceKind,
      workspaceId: legacyProjectId
    });
  }
  throw new Error("AGENT_CONTEXT_SCOPE_INVALID");
}

export function agentContextScopeKey(scope: AgentContextScope): string {
  return scope.kind === "standalone"
    ? "standalone"
    : `workspace:${scope.workspaceKind}:${scope.workspaceId}`;
}

export function workspaceIdForAgentScope(scope: AgentContextScope): string | undefined {
  return scope.kind === "workspace" ? scope.workspaceId : undefined;
}

function isSafeScopeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
