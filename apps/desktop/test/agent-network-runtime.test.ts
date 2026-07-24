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
});
