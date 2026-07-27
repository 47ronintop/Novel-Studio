import { describe, expect, it } from "vitest";

import {
  createStandaloneRuntimeFacts,
  resolveAgentContextProfile,
  tryResolveAgentContextProfile
} from "../src/agent-context-profile.js";

const creativeScope = {
  kind: "workspace",
  workspaceKind: "creativeProject",
  workspaceId: "project_1"
} as const;
const engineeringScope = {
  kind: "workspace",
  workspaceKind: "engineeringWorkspace",
  workspaceId: "workspace_1"
} as const;

describe("Agent context profile", () => {
  it.each([
    [
      { kind: "standalone", scopeId: "standalone" } as const,
      "conversation",
      "standalone_chat",
      "standalone"
    ],
    [creativeScope, "planning", "writing", "writing"],
    [creativeScope, "execution", "general_file", "creative_general"],
    [engineeringScope, "planning", "general_file", "engineering"]
  ] as const)("resolves %s", (scope, operationMode, contextMode, expected) => {
    expect(resolveAgentContextProfile(scope, operationMode, contextMode).profileId).toBe(expected);
  });

  it.each([
    [{ kind: "standalone", scopeId: "standalone" } as const, "planning", "general_file"],
    [creativeScope, "conversation", "standalone_chat"],
    [engineeringScope, "execution", "writing"]
  ] as const)("rejects an illegal combination", (scope, operationMode, contextMode) => {
    const result = tryResolveAgentContextProfile(scope, operationMode, contextMode);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_CONTEXT_PROFILE_INVALID");
  });

  it("rejects malformed runtime mode values instead of falling through to creative_general", () => {
    const result = tryResolveAgentContextProfile(
      creativeScope,
      "unexpected" as never,
      "unknown" as never
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_CONTEXT_PROFILE_INVALID" }
    });
  });

  it("freezes standalone runtime facts without a project identity or tools", () => {
    expect(
      createStandaloneRuntimeFacts({
        provider: "mock",
        modelName: "text-only",
        emptyToolCatalogRevision: "empty_catalog"
      })
    ).toEqual(
      expect.objectContaining({
        workspaceBound: false,
        cwd: null,
        projectRoot: null,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkEnabled: false,
        mcpEnabled: false,
        toolCatalogRevision: "empty_catalog"
      })
    );
  });
});
