/**
 * Task D.1 — Desktop network runtime tests.
 * Covers: executor creation from settings, key injection.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createDesktopNetworkToolExecutor,
  createDesktopNetworkSettingsSession
} from "../src/main/agent-network-runtime.js";
import type { AgentNetworkSettingsPort } from "@novel-studio/application";
import { DEFAULT_NETWORK_SETTINGS } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";
import type { PinnedNetworkDispatcher } from "../src/main/agent-network-dialer.js";

function makePort(enabled: boolean = false): AgentNetworkSettingsPort {
  const settings = {
    ...DEFAULT_NETWORK_SETTINGS,
    enabled,
    allowedHosts: enabled ? ["api.example.com"] : [],
    policyRevision: "v1.0-test"
  };
  return {
    readNetworkSettings: vi.fn(() => Promise.resolve(ok(settings))),
    writeNetworkSettings: vi.fn((s) => Promise.resolve(ok(s)))
  };
}

describe("createDesktopNetworkToolExecutor", () => {
  it("returns a disabled executor when policy is disabled", async () => {
    const port = makePort(false);
    const result = await createDesktopNetworkToolExecutor({
      resolveSecret: () => undefined,
      settingsPort: port
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Calling webSearch should return NETWORK_POLICY_DISABLED
    const searchResult = await result.value.webSearch({
      runId: "r1",
      query: "test",
      signal: new AbortController().signal
    });
    expect(searchResult.ok).toBe(false);
    if (!searchResult.ok) expect(searchResult.error.code).toBe("NETWORK_POLICY_DISABLED");
  });

  it("returns enabled executor when policy is enabled", async () => {
    const port = makePort(true);
    const result = await createDesktopNetworkToolExecutor({
      resolveSecret: () => "api-key-value",
      settingsPort: port
    });
    expect(result.ok).toBe(true);
  });

  it("forwards storage errors", async () => {
    const port: AgentNetworkSettingsPort = {
      readNetworkSettings: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          error: {
            code: "STORAGE_UNAVAILABLE",
            message: "disk error",
            category: "StorageError",
            recoverability: "user-action",
            suggestedAction: "retry",
            traceId: "test",
            errorId: "e1",
            createdAt: new Date().toISOString()
          }
        })
      ),
      writeNetworkSettings: vi.fn()
    };
    const result = await createDesktopNetworkToolExecutor({
      resolveSecret: () => undefined,
      settingsPort: port
    });
    expect(result.ok).toBe(false);
  });

  it("keeps a provider key out of fetchUrl while using it for webSearch", async () => {
    const settings = {
      ...DEFAULT_NETWORK_SETTINGS,
      enabled: true,
      allowedHosts: ["api.example.com", "search.example.com"],
      policyRevision: "v1.0-test",
      providerProfiles: [
        {
          providerId: "search",
          name: "Search",
          apiKeyRef: "secret://search",
          endpoint: "https://search.example.com/search",
          policyRevision: "v1.0-test"
        }
      ]
    };
    const port: AgentNetworkSettingsPort = {
      readNetworkSettings: vi.fn(() => Promise.resolve(ok(settings))),
      writeNetworkSettings: vi.fn((next) => Promise.resolve(ok(next)))
    };
    const headers: Array<Readonly<Record<string, string>>> = [];
    const dispatch: PinnedNetworkDispatcher = async (request) => {
      headers.push(request.headers);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: (async function* () {
          yield new TextEncoder().encode('{"results":[]}');
        })()
      };
    };
    const result = await createDesktopNetworkToolExecutor({
      resolveSecret: () => "provider-key-canary",
      settingsPort: port,
      dialerOptions: {
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        dispatch
      }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.value.webSearch({
      runId: "r1",
      query: "public terms",
      signal: new AbortController().signal
    });
    await result.value.fetchUrl({
      runId: "r1",
      url: "https://api.example.com/data",
      signal: new AbortController().signal
    });

    expect(headers[0]?.["authorization"]).toBe("Bearer provider-key-canary");
    expect(headers[1]?.["authorization"]).toBeUndefined();
    expect(JSON.stringify(headers[1])).not.toContain("provider-key-canary");
  });
});

describe("createDesktopNetworkSettingsSession", () => {
  it("delegates to createAgentNetworkSettingsSession", async () => {
    const port = makePort(false);
    const session = createDesktopNetworkSettingsSession({
      resolveSecret: () => undefined,
      settingsPort: port
    });
    const settings = await session.getNetworkSettings();
    expect(settings.ok).toBe(true);
    if (settings.ok) {
      expect(settings.value.enabled).toBe(false);
    }
  });

  it("runs connection tests through the Main pinned dialer", async () => {
    const settings = {
      ...DEFAULT_NETWORK_SETTINGS,
      enabled: true,
      allowedHosts: ["search.example.com"],
      policyRevision: "v1.0-test",
      providerProfiles: [
        {
          providerId: "search",
          name: "Search",
          apiKeyRef: "secret://search",
          endpoint: "https://search.example.com/health",
          policyRevision: "v1.0-test"
        }
      ]
    };
    const port: AgentNetworkSettingsPort = {
      readNetworkSettings: vi.fn(() => Promise.resolve(ok(settings))),
      writeNetworkSettings: vi.fn((next) => Promise.resolve(ok(next)))
    };
    const dispatch = vi.fn<PinnedNetworkDispatcher>(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: (async function* () {
        yield new TextEncoder().encode("{}");
      })()
    }));
    const session = createDesktopNetworkSettingsSession({
      resolveSecret: () => undefined,
      settingsPort: port,
      dialerOptions: {
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        dispatch
      }
    });

    const tested = await session.testConnection("search");
    expect(tested.ok ? "connected" : `${tested.error.code}: ${tested.error.message}`).toBe(
      "connected"
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.objectContaining({ hostname: "search.example.com" }),
        address: { address: "93.184.216.34", family: 4 },
        method: "GET"
      })
    );
  });
});
