import { describe, expect, test } from "vitest";

import {
  checksumProviderPayload,
  isSha256Checksum,
  resolveLlmPromptCacheRequest,
  type LlmPromptCacheRequest,
  type LlmRequest
} from "../src/index.js";

const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

const request = {
  schemaVersion: "1.0",
  requestId: "llmreq_cache_contract",
  traceId: "trace_cache_contract",
  mode: "non-streaming",
  modelProfile: {
    id: "model_cache_contract",
    provider: "anthropic",
    displayName: "Cache contract fixture",
    modelName: "cache-fixture"
  },
  messages: [
    { role: "system", content: "System guidance." },
    { role: "user", content: "Stable project context." },
    { role: "user", content: "Dynamic request." }
  ],
  parameters: {}
} satisfies LlmRequest;

function cacheConfig(overrides: Partial<LlmPromptCacheRequest> = {}): LlmPromptCacheRequest {
  return {
    mode: "explicit_breakpoints",
    policyVersion: "anthropic-explicit@1.0",
    identityChecksum: CHECKSUM_A,
    logicalPrefixChecksum: CHECKSUM_B,
    stablePrefixMessageCount: 2,
    minimumCacheableTokens: 1,
    eligibleInputTokens: 128,
    ttlSeconds: 300,
    ...overrides
  };
}

describe("LLM prompt cache request resolution", () => {
  test("activates only a fully verified provider mode", () => {
    expect(
      resolveLlmPromptCacheRequest(
        { ...request, promptCache: cacheConfig() },
        "explicit_breakpoints"
      )
    ).toEqual({ active: true, config: cacheConfig() });

    expect(
      resolveLlmPromptCacheRequest({ ...request, promptCache: cacheConfig() }, "automatic_prefix")
    ).toMatchObject({ active: false, bypassReason: "unsupported_provider" });
  });

  test("fails closed for invalid identity, boundaries, and token policy", () => {
    for (const config of [
      cacheConfig({ identityChecksum: "not-a-checksum" }),
      cacheConfig({ stablePrefixMessageCount: 0 }),
      cacheConfig({ stablePrefixMessageCount: request.messages.length + 1 }),
      cacheConfig({ minimumCacheableTokens: -1 }),
      cacheConfig({ ttlSeconds: 0 })
    ]) {
      expect(
        resolveLlmPromptCacheRequest({ ...request, promptCache: config }, "explicit_breakpoints")
      ).toMatchObject({ active: false, bypassReason: "identity_unverified" });
    }
  });

  test("honors policy bypass, minimum tokens, and explicit resource requirements", () => {
    expect(
      resolveLlmPromptCacheRequest(
        {
          ...request,
          promptCache: cacheConfig({ eligibleInputTokens: 63, minimumCacheableTokens: 64 })
        },
        "explicit_breakpoints"
      )
    ).toMatchObject({ active: false, bypassReason: "below_minimum_tokens" });

    expect(
      resolveLlmPromptCacheRequest(
        {
          ...request,
          promptCache: cacheConfig({ bypassReason: "resource_expired" })
        },
        "explicit_breakpoints"
      )
    ).toMatchObject({ active: false, bypassReason: "resource_expired" });

    expect(
      resolveLlmPromptCacheRequest(
        {
          ...request,
          promptCache: cacheConfig({ mode: "explicit_resource" })
        },
        "explicit_resource"
      )
    ).toMatchObject({ active: false, bypassReason: "resource_unavailable" });
  });

  test("hashes provider-native payloads deterministically", () => {
    const first = checksumProviderPayload({ messages: [{ role: "system", content: "A" }] });
    const second = checksumProviderPayload({ messages: [{ role: "system", content: "A" }] });
    const changed = checksumProviderPayload({ messages: [{ role: "system", content: "B" }] });

    expect(isSha256Checksum(first)).toBe(true);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });
});
