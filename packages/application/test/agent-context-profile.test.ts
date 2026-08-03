import { describe, expect, it } from "vitest";

import {
  createStandaloneRuntimeFacts,
  parseAgentContextProfile,
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
  it("strictly parses canonical frozen profiles", () => {
    const standalone = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );
    const writing = resolveAgentContextProfile(creativeScope, "execution", "writing");

    expect(parseAgentContextProfile(structuredClone(standalone))).toEqual(standalone);
    expect(parseAgentContextProfile(structuredClone(writing))).toEqual(writing);
    expect(Object.isFrozen(parseAgentContextProfile(structuredClone(writing)))).toBe(true);
  });

  it("rejects unknown versions, extra fields, and non-canonical nested scopes", () => {
    const profile = resolveAgentContextProfile(creativeScope, "planning", "writing");

    expect(() => parseAgentContextProfile({ ...profile, profileVersion: "2.0" })).toThrow(
      "AGENT_CONTEXT_PROFILE_INVALID"
    );
    expect(() => parseAgentContextProfile({ ...profile, extra: true })).toThrow(
      "AGENT_CONTEXT_PROFILE_INVALID"
    );
    expect(() =>
      parseAgentContextProfile({ ...profile, scope: { ...profile.scope, extra: true } })
    ).toThrow("AGENT_CONTEXT_PROFILE_INVALID");
  });

  it("rejects profile fields that do not match the canonical scope and modes", () => {
    const profile = resolveAgentContextProfile(engineeringScope, "execution", "general_file");

    expect(() => parseAgentContextProfile({ ...profile, profileId: "creative_general" })).toThrow(
      "AGENT_CONTEXT_PROFILE_INVALID"
    );
    expect(() => parseAgentContextProfile({ ...profile, toolPolicy: "creative_file" })).toThrow(
      "AGENT_CONTEXT_PROFILE_INVALID"
    );
  });

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
