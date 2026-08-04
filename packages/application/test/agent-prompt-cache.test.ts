import { describe, expect, test } from "vitest";

import type { AgentPromptCacheCapabilitySnapshot } from "@novel-studio/agent-engine";
import type { JsonObject } from "@novel-studio/shared";

import {
  createAgentPromptCacheIdentityArtifact,
  createAgentPromptCacheIdentityArtifactV2,
  parseAgentPromptCacheIdentityArtifact
} from "../src/agent-prompt-cache.js";

const capability: AgentPromptCacheCapabilitySnapshot = {
  mode: "explicit_breakpoints",
  policyVersion: "anthropic-ephemeral@1.0",
  minimumCacheableTokens: 1_024,
  ttlSeconds: 300,
  inputTokenSemantics: "excluded_from_input",
  reportsCacheReadTokens: true,
  reportsCacheWriteTokens: true
};

const baseInput = {
  runBindingId: "command_cache_01",
  provider: "anthropic",
  modelName: "claude-3-5-sonnet",
  connectionIdentityChecksum: "a".repeat(64),
  accountIsolationChecksum: "b".repeat(64),
  capability,
  scope: {
    kind: "workspace",
    workspaceKind: "creativeProject",
    workspaceId: "project_01"
  },
  contextProfileId: "writing",
  profileVersion: "2.0",
  guidanceTemplateChecksum: "c".repeat(64),
  toolCatalogRevision: "catalog_v2_01",
  logicalPrefixChecksum: "d".repeat(64),
  stablePrefixMessageCount: 3,
  eligibleInputTokens: 2_048,
  createdAt: "2026-07-28T00:00:00.000Z"
} as const;

const baseV2Input = {
  ...baseInput,
  providerSemanticVersionSetChecksum: "1".repeat(64),
  canonicalRootIdentityChecksum: "6".repeat(64),
  effectiveCapabilityStateChecksum: "2".repeat(64),
  sharingDefaultsRevision: "3".repeat(64),
  sharingGrantRevision: "4".repeat(64),
  policyRevision: "policy_01",
  providerToolProjectionChecksum: "5".repeat(64)
} as const;

describe("Agent prompt cache identity artifact", () => {
  test("is deterministic, immutable, versioned, and round-trippable", () => {
    const first = createAgentPromptCacheIdentityArtifact(baseInput);
    const second = createAgentPromptCacheIdentityArtifact(baseInput);

    expect(second).toEqual(first);
    expect(first.identityChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.expiresAt).toBe("2026-07-28T00:05:00.000Z");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.capability)).toBe(true);
    expect(
      parseAgentPromptCacheIdentityArtifact(structuredClone(first) as unknown as JsonObject)
    ).toEqual(first);
  });

  test("invalidates provider, account, model, scope, policy, tools, trust-bearing prefix, and adapter", () => {
    const original = createAgentPromptCacheIdentityArtifact(baseInput).identityChecksum;
    const variants = [
      { ...baseInput, provider: "openai" },
      { ...baseInput, connectionIdentityChecksum: "e".repeat(64) },
      { ...baseInput, accountIsolationChecksum: "f".repeat(64) },
      { ...baseInput, modelName: "claude-other" },
      {
        ...baseInput,
        scope: {
          kind: "workspace" as const,
          workspaceKind: "creativeProject" as const,
          workspaceId: "project_02"
        },
        logicalPrefixChecksum: "2".repeat(64)
      },
      {
        ...baseInput,
        capability: { ...capability, policyVersion: "anthropic-ephemeral@2.0" }
      },
      {
        ...baseInput,
        toolCatalogRevision: "catalog_v2_02",
        logicalPrefixChecksum: "3".repeat(64)
      },
      { ...baseInput, logicalPrefixChecksum: "1".repeat(64) },
      { ...baseInput, adapterVersion: "c5@2.0" }
    ];

    for (const variant of variants) {
      expect(createAgentPromptCacheIdentityArtifact(variant).identityChecksum).not.toBe(original);
    }
  });

  test("never shares standalone and workspace identities", () => {
    const workspace = createAgentPromptCacheIdentityArtifact(baseInput);
    const standalone = createAgentPromptCacheIdentityArtifact({
      ...baseInput,
      scope: { kind: "standalone", scopeId: "standalone" },
      contextProfileId: "standalone",
      logicalPrefixChecksum: "4".repeat(64)
    });

    expect(standalone.identityChecksum).not.toBe(workspace.identityChecksum);
  });

  test("fails closed for unknown versions and tampering", () => {
    const artifact = createAgentPromptCacheIdentityArtifact(baseInput);
    expect(() =>
      parseAgentPromptCacheIdentityArtifact({
        ...artifact,
        schemaVersion: "9.0"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_CACHE_ARTIFACT_VERSION_UNSUPPORTED");
    expect(() =>
      parseAgentPromptCacheIdentityArtifact({
        ...artifact,
        identityChecksum: "0".repeat(64)
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
    expect(() =>
      parseAgentPromptCacheIdentityArtifact({
        ...artifact,
        unrecognizedIdentityInput: "ignored-by-old-readers"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
  });

  test("v2 binds the complete semantic, capability, sharing, profile, scope, and tool projection", () => {
    const original = createAgentPromptCacheIdentityArtifactV2(baseV2Input);
    expect(original.schemaVersion).toBe("2.0");
    expect(
      parseAgentPromptCacheIdentityArtifact(structuredClone(original) as unknown as JsonObject)
    ).toEqual(original);

    const variants = [
      { ...baseV2Input, providerSemanticVersionSetChecksum: "0".repeat(64) },
      { ...baseV2Input, canonicalRootIdentityChecksum: "1".repeat(64) },
      { ...baseV2Input, effectiveCapabilityStateChecksum: "7".repeat(64) },
      { ...baseV2Input, sharingDefaultsRevision: "8".repeat(64) },
      { ...baseV2Input, sharingGrantRevision: "9".repeat(64) },
      { ...baseV2Input, policyRevision: "policy_02" },
      { ...baseV2Input, providerToolProjectionChecksum: "a".repeat(64) },
      { ...baseV2Input, contextProfileId: "creative_general" as const },
      { ...baseV2Input, profileVersion: "3.0" },
      { ...baseV2Input, guidanceTemplateChecksum: "b".repeat(64) },
      { ...baseV2Input, toolCatalogRevision: "catalog_v2_02" },
      {
        ...baseV2Input,
        scope: {
          kind: "workspace" as const,
          workspaceKind: "creativeProject" as const,
          workspaceId: "project_02"
        },
        contextProfileId: "writing" as const
      }
    ];
    for (const variant of variants) {
      expect(createAgentPromptCacheIdentityArtifactV2(variant).identityChecksum).not.toBe(
        original.identityChecksum
      );
    }
  });

  test("v2 normalizes sharing as not applicable only for standalone", () => {
    expect(() =>
      createAgentPromptCacheIdentityArtifactV2({
        ...baseV2Input,
        sharingDefaultsRevision: "not_applicable"
      })
    ).toThrow("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");
    expect(() =>
      createAgentPromptCacheIdentityArtifactV2({
        ...baseV2Input,
        canonicalRootIdentityChecksum: "not_applicable"
      })
    ).toThrow("AGENT_PROMPT_CACHE_ARTIFACT_INVALID");

    const standalone = createAgentPromptCacheIdentityArtifactV2({
      ...baseV2Input,
      scope: { kind: "standalone", scopeId: "standalone" },
      contextProfileId: "standalone",
      canonicalRootIdentityChecksum: "not_applicable",
      sharingDefaultsRevision: "not_applicable",
      sharingGrantRevision: "not_applicable"
    });
    expect(standalone.sharingDefaultsRevision).toBe("not_applicable");
  });
});
