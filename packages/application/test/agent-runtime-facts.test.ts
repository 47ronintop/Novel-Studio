import {
  createApprovalRuleSetProjection,
  createDefaultCapabilitySnapshot,
  createEffectiveCapabilityState,
  DEFAULT_APPROVAL_RULE_SET_VERSION,
  listAgentTools
} from "@novel-studio/agent-engine";
import { describe, expect, it } from "vitest";

import { resolveAgentContextProfile } from "../src/agent-context-profile.js";
import {
  createProviderVisibleAgentRuntimeFacts,
  parseProviderVisibleAgentRuntimeFacts,
  providerVisibleAgentRuntimeFactsChecksum
} from "../src/agent-runtime-facts.js";

function workspaceProfile(
  kind: "creativeProject" | "engineeringWorkspace",
  operationMode: "planning" | "execution",
  contextMode: "writing" | "general_file"
) {
  return resolveAgentContextProfile(
    { kind: "workspace", workspaceKind: kind, workspaceId: "workspace-1" },
    operationMode,
    contextMode
  );
}

describe("Provider-visible Agent runtime facts 1.0", () => {
  it("forces planning to a read-only canonical fact set", () => {
    const profile = workspaceProfile("creativeProject", "planning", "writing");
    const capability = createDefaultCapabilitySnapshot("creativeProject");
    const facts = createProviderVisibleAgentRuntimeFacts({
      profile,
      toolDescriptors: listAgentTools({
        facadeVersion: "v2",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "user_preapproved_run",
        capabilitySnapshot: capability
      }),
      effectiveCapabilityState: createEffectiveCapabilityState(capability),
      executionWritePolicy: "user_preapproved_run",
      activeResourceKind: "chapter"
    });

    expect(facts).toMatchObject({
      schemaVersion: "1.0",
      writeCapability: "none",
      writingOperations: [],
      workspaceFileOperations: [],
      writeApprovalPolicy: "not_applicable",
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable",
      approvalRules: []
    });
  });

  it("derives the exact execution operation subset from the final tool projection", () => {
    const profile = workspaceProfile("creativeProject", "execution", "writing");
    const capability = {
      ...createDefaultCapabilitySnapshot("creativeProject"),
      storyBibleStructuredToolsEnabled: true,
      writingOperations: [
        "chapter_replace",
        "story_bible_create",
        "story_bible_patch",
        "story_bible_status",
        "story_bible_restore"
      ] as const,
      featureFlagRevision: "story-bible-on"
    };
    const facts = createProviderVisibleAgentRuntimeFacts({
      profile,
      toolDescriptors: listAgentTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: capability
      }),
      effectiveCapabilityState: createEffectiveCapabilityState(capability),
      executionWritePolicy: "write_before_confirmation",
      activeResourceKind: "story_bible"
    });

    expect(facts.writingOperations).toEqual([
      "chapter_replace",
      "story_bible_create",
      "story_bible_patch",
      "story_bible_status",
      "story_bible_restore"
    ]);
    expect(facts.workspaceFileOperations).toEqual([]);
    expect(facts.writeApprovalPolicy).toBe("confirm_each_change_set");
    const expectedRules = createApprovalRuleSetProjection(
      facts.writingOperations,
      DEFAULT_APPROVAL_RULE_SET_VERSION
    );
    expect(facts.approvalRuleSetVersion).toBe(DEFAULT_APPROVAL_RULE_SET_VERSION);
    expect(facts.approvalRuleSetChecksum).toBe(expectedRules.checksum);
    expect(facts.approvalRules).toEqual(expectedRules.rules);
    expect(providerVisibleAgentRuntimeFactsChecksum(facts)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps limited preapproval closed until the trusted surface is qualified", () => {
    const profile = workspaceProfile("creativeProject", "execution", "general_file");
    const capability = {
      ...createDefaultCapabilitySnapshot("creativeProject"),
      workspaceFileOperations: ["replace_file"] as const,
      featureFlagRevision: "replace-qualified"
    };
    const tools = listAgentTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "user_preapproved_run",
      capabilitySnapshot: capability
    });

    expect(() =>
      createProviderVisibleAgentRuntimeFacts({
        profile,
        toolDescriptors: tools,
        effectiveCapabilityState: createEffectiveCapabilityState(capability),
        executionWritePolicy: "user_preapproved_run",
        executionWritePolicyAcknowledged: true,
        activeResourceKind: "project_file"
      })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_PREAPPROVAL_UNQUALIFIED");
  });

  it("fails closed when a frozen proposal operation is no longer effective", () => {
    const profile = workspaceProfile("creativeProject", "execution", "writing");
    const qualified = {
      ...createDefaultCapabilitySnapshot("creativeProject"),
      writingOperations: ["chapter_replace"] as const,
      featureFlagRevision: "chapter-write-qualified"
    };
    const tools = listAgentTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: qualified
    });
    const revoked = {
      ...createDefaultCapabilitySnapshot("creativeProject"),
      featureFlagRevision: "chapter-write-revoked"
    };

    expect(() =>
      createProviderVisibleAgentRuntimeFacts({
        profile,
        toolDescriptors: tools,
        effectiveCapabilityState: createEffectiveCapabilityState(revoked),
        executionWritePolicy: "write_before_confirmation",
        activeResourceKind: "chapter"
      })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  });

  it("rejects extra fields, non-canonical arrays, and proposal-proof leakage", () => {
    const profile = workspaceProfile("engineeringWorkspace", "execution", "general_file");
    const capability = createDefaultCapabilitySnapshot("engineeringWorkspace");
    const facts = createProviderVisibleAgentRuntimeFacts({
      profile,
      toolDescriptors: [],
      effectiveCapabilityState: createEffectiveCapabilityState(capability),
      executionWritePolicy: "write_before_confirmation",
      activeResourceKind: "none"
    });

    expect(parseProviderVisibleAgentRuntimeFacts(facts)).toEqual(facts);
    expect(() =>
      parseProviderVisibleAgentRuntimeFacts({ ...facts, proofChecksum: "a".repeat(64) })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
    expect(() =>
      parseProviderVisibleAgentRuntimeFacts({
        ...facts,
        workspaceFileOperations: ["create_file", "replace_file"]
      })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  });

  it("rejects a persisted approval rule projection that does not match its operation set", () => {
    const profile = workspaceProfile("creativeProject", "execution", "general_file");
    const capability = {
      ...createDefaultCapabilitySnapshot("creativeProject"),
      workspaceFileOperations: ["replace_file"] as const,
      featureFlagRevision: "replace-qualified"
    };
    const facts = createProviderVisibleAgentRuntimeFacts({
      profile,
      toolDescriptors: listAgentTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: capability
      }),
      effectiveCapabilityState: createEffectiveCapabilityState(capability),
      executionWritePolicy: "write_before_confirmation",
      activeResourceKind: "project_file"
    });

    expect(() =>
      parseProviderVisibleAgentRuntimeFacts({
        ...facts,
        approvalRuleSetChecksum: "0".repeat(64)
      })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_INVALID");
  });

  it("rejects task, Git, and plugin tools from a Guidance 3.0 directory", () => {
    const profile = workspaceProfile("engineeringWorkspace", "execution", "general_file");
    const capability = createDefaultCapabilitySnapshot("engineeringWorkspace");
    const base = {
      kind: "command_tool" as const,
      effect: "execute" as const,
      inputSchema: { type: "object" }
    };

    expect(() =>
      createProviderVisibleAgentRuntimeFacts({
        profile,
        toolDescriptors: [{ ...base, id: "run_project_task", name: "run_project_task" }],
        effectiveCapabilityState: createEffectiveCapabilityState(capability),
        executionWritePolicy: "write_before_confirmation",
        activeResourceKind: "project_file"
      })
    ).toThrow("PROVIDER_VISIBLE_RUNTIME_FACTS_UNSUPPORTED_TOOL");
  });
});
