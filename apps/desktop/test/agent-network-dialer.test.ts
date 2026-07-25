import { describe, expect, it, vi } from "vitest";

import type { AgentNetworkPolicy } from "@novel-studio/application";
import { ControlledFetchError } from "@novel-studio/application";
import {
  createMainControlledFetch,
  createOriginScopedControlledFetch,
  createTlsPeerIdentityVerifier,
  isBlockedNetworkAddress,
  type PinnedNetworkDispatcher,
  type PinnedNetworkResponse
} from "../src/main/agent-network-dialer.js";

function makePolicy(overrides: Partial<AgentNetworkPolicy> = {}): AgentNetworkPolicy {
  return {
    enabled: true,
    allowedHosts: ["api.example.com", "search.example.com", "redirect.example.com"],
    dataEgressPolicy: "require_confirmation",
    revision: "v1.0-test",
    ...overrides
  };
}

function response(
  status = 200,
  headers: Readonly<Record<string, string>> = { "content-type": "text/plain" },
  text = "ok"
): PinnedNetworkResponse {
  return {
    status,
    headers,
    body: chunks(text)
  };
}

async function* chunks(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

const RFC6052_TEST_PREFIXES = [
  { length: 32, bytes: [0x20, 0x01, 0x0d, 0xb8] },
  { length: 40, bytes: [0x20, 0x01, 0x0d, 0xb8, 0x01] },
  { length: 48, bytes: [0x20, 0x01, 0x0d, 0xb8, 0x02, 0x03] },
  { length: 56, bytes: [0x20, 0x01, 0x0d, 0xb8, 0x04, 0x05, 0x06] },
  { length: 64, bytes: [0x20, 0x01, 0x0d, 0xb8, 0x07, 0x08, 0x09, 0x0a] },
  {
    length: 96,
    bytes: [0x20, 0x01, 0x0d, 0xb8, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12]
  }
] as const;

function encodeRfc6052TestAddress(
  prefix: (typeof RFC6052_TEST_PREFIXES)[number],
  ipv4: string
): string {
  const [first, second, third, fourth] = ipv4.split(".").map(Number) as [
    number,
    number,
    number,
    number
  ];
  const bytes = new Uint8Array(16);
  bytes.set(prefix.bytes);
  switch (prefix.length) {
    case 32:
      bytes.set([first, second, third, fourth], 4);
      break;
    case 40:
      bytes.set([first, second, third], 5);
      bytes[9] = fourth;
      break;
    case 48:
      bytes.set([first, second], 6);
      bytes.set([third, fourth], 9);
      break;
    case 56:
      bytes[7] = first;
      bytes.set([second, third, fourth], 9);
      break;
    case 64:
      bytes.set([first, second, third, fourth], 9);
      break;
    case 96:
      bytes.set([first, second, third, fourth], 12);
      break;
  }
  return Array.from({ length: 8 }, (_, index) => {
    const offset = index * 2;
    return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)).toString(16);
  }).join(":");
}

function noDns64Discovery() {
  return {
    ipv4onlyArpaAddresses: [
      { address: "192.0.0.170", family: 4 as const },
      { address: "192.0.0.171", family: 4 as const }
    ]
  };
}

function nat64Discovery(prefix: (typeof RFC6052_TEST_PREFIXES)[number]) {
  return {
    ipv4onlyArpaAddresses: [
      ...noDns64Discovery().ipv4onlyArpaAddresses,
      { address: encodeRfc6052TestAddress(prefix, "192.0.0.170"), family: 6 as const },
      { address: encodeRfc6052TestAddress(prefix, "192.0.0.171"), family: 6 as const }
    ]
  };
}

async function* waitForAbort(signal: AbortSignal): AsyncIterable<Uint8Array> {
  // Start body consumption before waiting so the test exercises post-header aborts.
  yield new Uint8Array();
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", resolve, { once: true });
  });
  throw signal.reason ?? new Error("Expected request abort.");
}

describe("isBlockedNetworkAddress", () => {
  it("blocks the complete deprecated IPv6 site-local range without widening it", () => {
    expect(isBlockedNetworkAddress("fec0::1")).toBe(true);
    expect(isBlockedNetworkAddress("feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(true);
    // febf::/16 is the upper edge of the separately blocked link-local range.
    expect(isBlockedNetworkAddress("febf:0:0:0:0:0:0:1")).toBe(true);
    expect(isBlockedNetworkAddress("fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(false);
    expect(isBlockedNetworkAddress("2001:4860:4860::8888")).toBe(false);
  });

  it("checks both Teredo IPv4 endpoints", () => {
    // The server field is bytes 4-7; the client field is one's-complemented
    // in bytes 12-15. A public client must not mask a metadata server.
    expect(isBlockedNetworkAddress("2001:0:a9fe:a9fe:0:0:a247:27dd")).toBe(true);
    expect(isBlockedNetworkAddress("2001:0:5db8:d822:0:0:f7f7:f7f7")).toBe(false);
  });

  it.each([
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "::a9fe:a9fe",
    "0:0:0:0:0:0:a9fe:a9fe",
    "0:0:0:0:ffff:0:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1:a9fe:a9:fe00::",
    "2002:a9fe:a9fe::",
    "2001:0::5601:5601"
  ])("blocks private or metadata IPv4 encoded as %s", (address) => {
    expect(isBlockedNetworkAddress(address)).toBe(true);
  });

  it.each(["::ffff:5db8:d822", "64:ff9b::5db8:d822", "2002:5db8:d822::"])(
    "allows a transition address only when its embedded IPv4 target is public: %s",
    (address) => {
      expect(isBlockedNetworkAddress(address)).toBe(false);
    }
  );
});

describe("createMainControlledFetch", () => {
  it("pins the socket to the validated address instead of resolving the hostname again", async () => {
    const resolveHostname = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const dispatch = vi.fn().mockResolvedValue(response());
    const fetch_ = createMainControlledFetch(makePolicy(), { resolveHostname, dispatch });

    await expect(fetch_({ url: "https://api.example.com/data" })).resolves.toMatchObject({
      body: "ok"
    });
    expect(resolveHostname).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        address: { address: "93.184.216.34", family: 4 },
        headers: expect.objectContaining({ host: "api.example.com" })
      })
    );
  });

  it("keeps the response body alive after the connection timeout is cleared", async () => {
    const dispatch: PinnedNetworkDispatcher = async (request) => ({
      status: 200,
      headers: { "content-type": "text/plain" },
      body: (async function* () {
        await Promise.resolve();
        if (request.signal.aborted) throw new Error("response body signal was aborted");
        yield new TextEncoder().encode("complete body");
      })()
    });
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).resolves.toMatchObject({
      body: "complete body",
      truncated: false
    });
  });

  it("propagates a caller abort after response headers arrive", async () => {
    let headersArrived!: () => void;
    const headers = new Promise<void>((resolve) => {
      headersArrived = resolve;
    });
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      headersArrived();
      return {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: waitForAbort(request.signal)
      };
    };
    const controller = new AbortController();
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch
    });

    const pending = fetch_({ url: "https://api.example.com/data", signal: controller.signal });
    await headers;
    controller.abort(new Error("caller cancelled"));

    await expect(pending).rejects.toSatisfy(
      (error: unknown) => error instanceof ControlledFetchError && error.code === "NETWORK_ABORTED"
    );
  });

  it("propagates the total-timeout reason after response headers arrive", async () => {
    let headersArrived!: () => void;
    const headers = new Promise<void>((resolve) => {
      headersArrived = resolve;
    });
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      headersArrived();
      return {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: waitForAbort(request.signal)
      };
    };
    const controller = new AbortController();
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch
    });

    const pending = fetch_({ url: "https://api.example.com/data", signal: controller.signal });
    await headers;
    controller.abort(new Error("NETWORK_TOTAL_TIMEOUT"));

    await expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError && error.code === "NETWORK_TOTAL_TIMEOUT"
    );
  });

  it("removes listeners from a reused caller abort signal after a completed request", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch: vi.fn().mockResolvedValue(response())
    });

    await fetch_({ url: "https://api.example.com/data", signal: controller.signal });

    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("uses a verified public A record instead of dialing an unsupported AAAA candidate", async () => {
    const dispatch = vi.fn().mockResolvedValue(response());
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "fd00:ec2::254", family: 6 }
      ],
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).resolves.toMatchObject({
      body: "ok"
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ address: { address: "93.184.216.34", family: 4 } })
    );
  });

  it.each(RFC6052_TEST_PREFIXES)(
    "blocks metadata encoded through a discovered RFC 6052 /$length prefix",
    async (prefix) => {
      const dispatch = vi.fn().mockResolvedValue(response());
      const fetch_ = createMainControlledFetch(makePolicy(), {
        resolveHostname: async () => ({
          addresses: [
            { address: encodeRfc6052TestAddress(prefix, "169.254.169.254"), family: 6 as const }
          ],
          nat64Discovery: nat64Discovery(prefix)
        }),
        dispatch
      });

      await expect(fetch_({ url: "https://api.example.com/data" })).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ControlledFetchError && error.code === "NETWORK_DNS_SSRF_REJECTED"
      );
      expect(dispatch).not.toHaveBeenCalled();
    }
  );

  it.each(RFC6052_TEST_PREFIXES)(
    "allows a public IPv4 target encoded through a discovered RFC 6052 /$length prefix",
    async (prefix) => {
      const encoded = encodeRfc6052TestAddress(prefix, "93.184.216.34");
      const dispatch = vi.fn().mockResolvedValue(response());
      const fetch_ = createMainControlledFetch(makePolicy(), {
        resolveHostname: async () => ({
          addresses: [{ address: encoded, family: 6 as const }],
          nat64Discovery: nat64Discovery(prefix)
        }),
        dispatch
      });

      await expect(fetch_({ url: "https://api.example.com/data" })).resolves.toMatchObject({
        body: "ok"
      });
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ address: { address: encoded, family: 6 } })
      );
    }
  );

  it("uses a public A record for an authoritative no-DNS64 dual-stack answer", async () => {
    const dispatch = vi.fn().mockResolvedValue(response());
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => ({
        addresses: [
          { address: "2001:4860:4860:0:a9fe:a9fe:0:1", family: 6 as const },
          { address: "93.184.216.34", family: 4 as const }
        ],
        nat64Discovery: noDns64Discovery()
      }),
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).resolves.toMatchObject({
      body: "ok"
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ address: { address: "93.184.216.34", family: 4 } })
    );
  });

  it("fails closed for an IPv6-only host when RFC 7050 discovery is malformed", async () => {
    const dispatch = vi.fn().mockResolvedValue(response());
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => ({
        addresses: [{ address: "2001:4860:4860::8888", family: 6 as const }],
        nat64Discovery: {
          ipv4onlyArpaAddresses: [
            ...noDns64Discovery().ipv4onlyArpaAddresses,
            { address: "2001:4860:4860::8888", family: 6 as const }
          ]
        }
      }),
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError &&
        error.code === "NETWORK_DNS_NAT64_DISCOVERY_REJECTED"
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed for an IPv6-only host when RFC 7050 discovery is contradictory", async () => {
    const first = RFC6052_TEST_PREFIXES[0];
    const second = RFC6052_TEST_PREFIXES[1];
    if (first === undefined || second === undefined)
      throw new Error("Missing NAT64 test prefixes.");
    const dispatch = vi.fn().mockResolvedValue(response());
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => ({
        addresses: [{ address: "2001:4860:4860::8888", family: 6 as const }],
        nat64Discovery: {
          ipv4onlyArpaAddresses: [
            ...noDns64Discovery().ipv4onlyArpaAddresses,
            ...nat64Discovery(first).ipv4onlyArpaAddresses.slice(2),
            ...nat64Discovery(second).ipv4onlyArpaAddresses.slice(2)
          ]
        }
      }),
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError &&
        error.code === "NETWORK_DNS_NAT64_DISCOVERY_REJECTED"
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("fails closed for a native IPv6-only target without a verified NAT64 mapping", async () => {
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => ({
        addresses: [{ address: "2001:4860:4860::8888", family: 6 as const }],
        nat64Discovery: noDns64Discovery()
      }),
      dispatch: vi.fn().mockResolvedValue(response())
    });

    await expect(fetch_({ url: "https://api.example.com/data" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError &&
        error.code === "NETWORK_DNS_NAT64_DISCOVERY_REJECTED"
    );
  });

  it("revalidates DNS and policy on every redirect hop", async () => {
    const calls: string[] = [];
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      calls.push(`${request.url.hostname}:${request.address.address}`);
      if (request.url.hostname === "api.example.com") {
        return response(302, { location: "https://redirect.example.com/next" }, "");
      }
      return response();
    };
    const resolveHostname = vi.fn(async (hostname: string) => [
      hostname === "api.example.com"
        ? { address: "93.184.216.34", family: 4 as const }
        : { address: "203.0.113.20", family: 4 as const }
    ]);
    const fetch_ = createMainControlledFetch(makePolicy(), { resolveHostname, dispatch });

    await expect(fetch_({ url: "https://api.example.com/start" })).resolves.toMatchObject({
      url: "https://redirect.example.com/next"
    });
    expect(calls).toEqual(["api.example.com:93.184.216.34", "redirect.example.com:203.0.113.20"]);
    expect(resolveHostname).toHaveBeenCalledTimes(2);
  });

  it("rejects HTTPS-to-HTTP redirects before a second connection", async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValue(response(302, { location: "http://api.example.com/plain" }, ""));
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch
    });

    await expect(fetch_({ url: "https://api.example.com/start" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError && error.code === "NETWORK_HTTPS_DOWNGRADE_REJECTED"
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("keeps a provider key out of generic fetch_url traffic and rejects scope escapes", async () => {
    const requests: Array<Readonly<Record<string, string>>> = [];
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      requests.push(request.headers);
      return response();
    };
    const options = {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 as const }],
      dispatch
    };
    const policy = makePolicy();
    const genericFetch = createMainControlledFetch(policy, options);
    const providerFetch = createOriginScopedControlledFetch(
      policy,
      { origin: "https://search.example.com", authorization: "Bearer key-canary" },
      options
    );

    await providerFetch({ url: "https://search.example.com/search?q=term" });
    await genericFetch({ url: "https://api.example.com/data" });
    await expect(providerFetch({ url: "https://api.example.com/data" })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ControlledFetchError && error.code === "NETWORK_CREDENTIAL_ORIGIN_MISMATCH"
    );

    expect(requests[0]?.["authorization"]).toBe("Bearer key-canary");
    expect(requests[1]?.["authorization"]).toBeUndefined();
    expect(JSON.stringify(requests[1])).not.toContain("key-canary");
  });

  it("allows POST only through the controlled request contract", async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValue(response(200, { "content-type": "application/json" }, "{}"));
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch
    });

    await fetch_({
      url: "https://api.example.com/rpc",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0"}'
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", body: '{"jsonrpc":"2.0"}' })
    );
  });

  it("checks the pinned certificate on every dispatched TLS request and rejects drift", async () => {
    const expected = "AA".repeat(32);
    const changed = "BB".repeat(32);
    let attempts = 0;
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      expect(request.tlsFingerprint).toBe(expected.toLowerCase());
      const verifyTlsPeer = request.verifyTlsPeer;
      expect(verifyTlsPeer).toBeDefined();
      const peerFingerprint = attempts++ === 0 ? expected : changed;
      const verificationError = verifyTlsPeer?.({ fingerprint256: peerFingerprint });
      if (verificationError !== undefined) throw verificationError;
      return response();
    };
    const fetch_ = createMainControlledFetch(makePolicy(), {
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      dispatch,
      tlsFingerprint: expected
    });

    await expect(fetch_({ url: "https://api.example.com/first" })).resolves.toMatchObject({
      body: "ok"
    });
    await expect(fetch_({ url: "https://api.example.com/second" })).rejects.toThrow(
      "Pinned TLS certificate fingerprint did not match."
    );
    expect(attempts).toBe(2);
  });

  it("normalizes certificate fingerprints before comparing them", () => {
    const expected = Array.from({ length: 32 }, () => "AA").join(":");
    const verify = createTlsPeerIdentityVerifier(expected);
    expect(verify({ fingerprint256: "aa".repeat(32) })).toBeUndefined();
    expect(verify({ fingerprint256: "BB".repeat(32) })?.message).toMatch(/did not match/);
  });
});
