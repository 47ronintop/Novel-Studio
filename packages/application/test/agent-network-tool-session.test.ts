/**
 * Task D.1 — Network tool session tests.
 * Covers: webSearch and fetchUrl with mock controlled fetch.
 */
import { describe, it, expect, vi } from "vitest";
import { createAgentNetworkToolSession } from "../src/agent-network-tool-session.js";
import type { AgentNetworkPolicy, ControlledFetch, ControlledFetchResponse } from "../src/agent-network-policy.js";

function makePolicy(enabled = true): AgentNetworkPolicy {
  return {
    enabled,
    allowedHosts: ["api.example.com", "search.example.com"],
    dataEgressPolicy: "require_confirmation",
    revision: "v1.0-test"
  };
}

function makeSearchProfile() {
  return {
    providerId: "test-search",
    name: "Test Search",
    apiKeyRef: "secret://test-key",
    endpoint: "https://search.example.com/search",
    policyRevision: "v1.0-test"
  };
}

function makeControlledFetch(body: string, contentType = "text/plain"): ControlledFetch {
  return vi.fn().mockResolvedValue({
    url: "https://search.example.com/search",
    status: 200,
    contentType,
    body,
    truncated: false
  } satisfies ControlledFetchResponse);
}

const signal = new AbortController().signal;

describe("createAgentNetworkToolSession — webSearch", () => {
  it("returns NETWORK_POLICY_DISABLED when policy is disabled", async () => {
    const session = createAgentNetworkToolSession({
      policy: makePolicy(false),
      searchProfile: makeSearchProfile()
    });
    const result = await session.webSearch({ runId: "r1", query: "test", signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_POLICY_DISABLED");
  });

  it("returns NETWORK_SEARCH_PROVIDER_UNAVAILABLE when no profile", async () => {
    const session = createAgentNetworkToolSession({ policy: makePolicy() });
    const result = await session.webSearch({ runId: "r1", query: "test", signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_SEARCH_PROVIDER_UNAVAILABLE");
  });

  it("returns untrusted_remote_data envelope on success", async () => {
    const mockFetch = makeControlledFetch(
      JSON.stringify({
        results: [
          { title: "Result 1", url: "https://example.com/1", snippet: "Snippet 1" }
        ]
      }),
      "application/json"
    );
    const session = createAgentNetworkToolSession({
      policy: makePolicy(),
      searchProfile: makeSearchProfile(),
      controlledFetch: mockFetch
    });
    const result = await session.webSearch({ runId: "r1", query: "hello world", signal });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("untrusted_remote_data");
      expect(result.value.fetchedAt).toBeTruthy();
      expect(result.value.contentDigest).toBeTruthy();
    }
  });

  it("handles search API error gracefully", async () => {
    const mockFetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("SSRF rejected"), { code: "NETWORK_SSRF_REJECTED" })
    );
    const session = createAgentNetworkToolSession({
      policy: makePolicy(),
      searchProfile: makeSearchProfile(),
      controlledFetch: mockFetch as unknown as ControlledFetch
    });
    const result = await session.webSearch({ runId: "r1", query: "test", signal });
    expect(result.ok).toBe(false);
  });
});

describe("createAgentNetworkToolSession — fetchUrl", () => {
  it("returns NETWORK_POLICY_DISABLED when policy is disabled", async () => {
    const session = createAgentNetworkToolSession({ policy: makePolicy(false) });
    const result = await session.fetchUrl({
      runId: "r1",
      url: "https://api.example.com/data",
      signal
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_POLICY_DISABLED");
  });

  it("returns NETWORK_INVALID_URL for malformed URL", async () => {
    const session = createAgentNetworkToolSession({ policy: makePolicy() });
    const result = await session.fetchUrl({ runId: "r1", url: "not-a-url", signal });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_INVALID_URL");
  });

  it("returns NETWORK_HOST_NOT_ALLOWED for non-allowed host", async () => {
    const session = createAgentNetworkToolSession({ policy: makePolicy() });
    const result = await session.fetchUrl({
      runId: "r1",
      url: "https://notallowed.evil.com/",
      signal
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_HOST_NOT_ALLOWED");
  });

  it("returns untrusted_remote_data envelope on success", async () => {
    const mockFetch = makeControlledFetch("<html>hello</html>", "text/html");
    const session = createAgentNetworkToolSession({
      policy: makePolicy(),
      controlledFetch: mockFetch
    });
    const result = await session.fetchUrl({
      runId: "r1",
      url: "https://api.example.com/data",
      signal
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("untrusted_remote_data");
      expect(result.value.url).toBe("https://api.example.com/data");
    }
  });
});
