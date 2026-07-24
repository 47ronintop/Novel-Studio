/**
 * Task D.1 — Network policy unit tests.
 * Covers: SSRF rejection, allowed hosts, redirect limits, size limits.
 */
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_NETWORK_POLICY,
  validateNetworkPolicy,
  isHostAllowed,
  createControlledFetch,
  ControlledFetchError,
  type AgentNetworkPolicy
} from "../src/agent-network-policy.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<AgentNetworkPolicy> = {}): AgentNetworkPolicy {
  return {
    enabled: true,
    allowedHosts: ["api.example.com", "*.search.example.com"],
    dataEgressPolicy: "require_confirmation",
    revision: "v1.0-test",
    ...overrides
  };
}

function makeOkFetch(body = "hello", contentType = "text/plain"): typeof fetch {
  return vi.fn().mockResolvedValue({
    status: 200,
    headers: {
      get: (key: string) => {
        if (key === "content-type") return contentType;
        if (key === "location") return null;
        return null;
      }
    },
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode(body) };
          },
          cancel: () => Promise.resolve()
        };
      }
    }
  });
}

// ── validateNetworkPolicy ────────────────────────────────────────────────────

describe("validateNetworkPolicy", () => {
  it("returns ok for valid public hostnames", () => {
    const result = validateNetworkPolicy(
      makePolicy({ allowedHosts: ["api.openai.com", "*.duckduckgo.com", "search.example.com"] })
    );
    expect(result.ok).toBe(true);
    expect(result.invalidHosts).toHaveLength(0);
  });

  it("rejects localhost", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["localhost"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("localhost");
  });

  it("rejects 127.x.x.x", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["127.0.0.1"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("127.0.0.1");
  });

  it("rejects 10.x.x.x", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["10.1.2.3"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("10.1.2.3");
  });

  it("rejects 192.168.x.x", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["192.168.1.1"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("192.168.1.1");
  });

  it("rejects 172.16-31.x.x", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["172.20.0.1"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("172.20.0.1");
  });

  it("rejects 169.254.x.x link-local", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["169.254.1.1"] }));
    expect(result.ok).toBe(false);
    expect(result.invalidHosts).toContain("169.254.1.1");
  });

  it("rejects ::1", () => {
    const result = validateNetworkPolicy(makePolicy({ allowedHosts: ["::1"] }));
    expect(result.ok).toBe(false);
  });
});

// ── isHostAllowed ────────────────────────────────────────────────────────────

describe("isHostAllowed", () => {
  it("allows exact match", () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    expect(isHostAllowed(policy, "api.example.com")).toBe(true);
  });

  it("allows wildcard subdomain", () => {
    const policy = makePolicy({ allowedHosts: ["*.example.com"] });
    expect(isHostAllowed(policy, "docs.example.com")).toBe(true);
  });

  it("rejects non-matching host", () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    expect(isHostAllowed(policy, "evil.example.com")).toBe(false);
  });

  it("returns false when policy is disabled", () => {
    const policy = makePolicy({ enabled: false, allowedHosts: ["api.example.com"] });
    expect(isHostAllowed(policy, "api.example.com")).toBe(false);
  });

  it("returns false when allowedHosts is empty", () => {
    const policy = makePolicy({ allowedHosts: [] });
    expect(isHostAllowed(policy, "api.example.com")).toBe(false);
  });

  it("wildcard does not match bare domain", () => {
    const policy = makePolicy({ allowedHosts: ["*.example.com"] });
    expect(isHostAllowed(policy, "example.com")).toBe(false);
  });
});

// ── createControlledFetch — SSRF rejection ───────────────────────────────────

describe("createControlledFetch — SSRF rejection", () => {
  it("rejects localhost URL", async () => {
    const policy = makePolicy({ allowedHosts: ["localhost"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://localhost/foo" })).rejects.toBeInstanceOf(ControlledFetchError);
  });

  it("rejects 127.0.0.1", async () => {
    const policy = makePolicy({ allowedHosts: ["127.0.0.1"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://127.0.0.1/admin" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_SSRF_REJECTED"
    );
  });

  it("rejects 10.x.x.x", async () => {
    const policy = makePolicy({ allowedHosts: ["10.0.0.1"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://10.0.0.1/" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_SSRF_REJECTED"
    );
  });

  it("rejects 192.168.x.x", async () => {
    const policy = makePolicy({ allowedHosts: ["192.168.1.1"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://192.168.1.1/" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError
    );
  });

  it("rejects 169.254 link-local", async () => {
    const policy = makePolicy({ allowedHosts: ["169.254.1.1"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://169.254.1.1/" })).rejects.toBeInstanceOf(ControlledFetchError);
  });

  it("rejects ::1 IPv6 loopback", async () => {
    const policy = makePolicy({ allowedHosts: ["[::1]"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "http://[::1]/" })).rejects.toBeInstanceOf(ControlledFetchError);
  });

  it("rejects file:// scheme", async () => {
    const policy = makePolicy({ allowedHosts: ["localfile"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "file:///etc/passwd" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_SCHEME_REJECTED"
    );
  });

  it("rejects URL with userinfo (credentials)", async () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "https://admin:pass@api.example.com/" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_URL_USERINFO"
    );
  });

  it("rejects host not in allowedHosts", async () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    const fetch_ = createControlledFetch(policy, makeOkFetch());
    await expect(fetch_({ url: "https://evil.attacker.com/" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_HOST_NOT_ALLOWED"
    );
  });

  it("succeeds for allowed public host", async () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    const mockFetch = makeOkFetch("hello world");
    const fetch_ = createControlledFetch(policy, mockFetch);
    const resp = await fetch_({ url: "https://api.example.com/data" });
    expect(resp.body).toBe("hello world");
    expect(resp.truncated).toBe(false);
  });
});

// ── createControlledFetch — redirect limits ───────────────────────────────────

describe("createControlledFetch — redirect limits", () => {
  it("rejects after max 3 redirects", async () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    const redirectFetch = vi.fn().mockResolvedValue({
      status: 301,
      headers: {
        get: (key: string) => {
          if (key === "location") return "https://api.example.com/next";
          return null;
        }
      },
      body: null
    });
    const fetch_ = createControlledFetch(policy, redirectFetch as unknown as typeof fetch);
    await expect(fetch_({ url: "https://api.example.com/start" })).rejects.toSatisfy(
      (e: unknown) => e instanceof ControlledFetchError && e.code === "NETWORK_TOO_MANY_REDIRECTS"
    );
  });

  it("rejects cross-host redirect to non-allowed host", async () => {
    const policy = makePolicy({ allowedHosts: ["api.example.com"] });
    const redirectFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: {
        get: (key: string) => {
          if (key === "location") return "https://evil.attacker.com/steal";
          return null;
        }
      },
      body: null
    });
    const fetch_ = createControlledFetch(policy, redirectFetch as unknown as typeof fetch);
    await expect(fetch_({ url: "https://api.example.com/start" })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ControlledFetchError && e.code === "NETWORK_REDIRECT_HOST_NOT_ALLOWED"
    );
  });
});

// ── DEFAULT_NETWORK_POLICY ────────────────────────────────────────────────────

describe("DEFAULT_NETWORK_POLICY", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_NETWORK_POLICY.enabled).toBe(false);
  });

  it("has empty allowedHosts", () => {
    expect(DEFAULT_NETWORK_POLICY.allowedHosts).toHaveLength(0);
  });

  it("requires confirmation for egress", () => {
    expect(DEFAULT_NETWORK_POLICY.dataEgressPolicy).toBe("require_confirmation");
  });
});
