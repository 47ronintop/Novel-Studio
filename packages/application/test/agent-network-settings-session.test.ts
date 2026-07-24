/**
 * Task D.1 — Network settings session tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createAgentNetworkSettingsSession,
  DEFAULT_NETWORK_SETTINGS,
  type AgentNetworkSettingsData,
  type AgentNetworkSettingsPort
} from "../src/agent-network-settings-session.js";
import { ok, err } from "@novel-studio/shared";

function makePort(initial: AgentNetworkSettingsData = DEFAULT_NETWORK_SETTINGS): AgentNetworkSettingsPort {
  let stored = initial;
  return {
    readNetworkSettings: vi.fn(() => Promise.resolve(ok(stored))),
    writeNetworkSettings: vi.fn((settings) => {
      stored = settings;
      return Promise.resolve(ok(settings));
    })
  };
}

describe("createAgentNetworkSettingsSession", () => {
  it("returns default settings when nothing stored", async () => {
    const port = makePort();
    const session = createAgentNetworkSettingsSession({ port });
    const result = await session.getNetworkSettings();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
      expect(result.value.allowedHosts).toHaveLength(0);
    }
  });

  it("updates settings with partial", async () => {
    const port = makePort();
    const session = createAgentNetworkSettingsSession({ port });
    const result = await session.updateNetworkSettings({
      enabled: true,
      allowedHosts: ["api.example.com"]
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(true);
      expect(result.value.allowedHosts).toContain("api.example.com");
      // Revision should be bumped
      expect(result.value.policyRevision).not.toBe(DEFAULT_NETWORK_SETTINGS.policyRevision);
    }
  });

  it("revokeNetworkAccess disables and clears settings", async () => {
    const port = makePort({
      ...DEFAULT_NETWORK_SETTINGS,
      enabled: true,
      allowedHosts: ["api.example.com"]
    });
    const session = createAgentNetworkSettingsSession({ port });
    const result = await session.revokeNetworkAccess();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(false);
      expect(result.value.allowedHosts).toHaveLength(0);
    }
  });

  it("returns error when port read fails", async () => {
    const port: AgentNetworkSettingsPort = {
      readNetworkSettings: vi.fn(() =>
        Promise.resolve(
          err({ code: "STORAGE_READ_FAILED", message: "disk error", category: "StorageError" } as import("@novel-studio/shared").UnifiedError)
        )
      ),
      writeNetworkSettings: vi.fn(() => Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS)))
    };
    const session = createAgentNetworkSettingsSession({ port });
    const result = await session.getNetworkSettings();
    expect(result.ok).toBe(false);
  });

  it("testConnection returns error for unknown profileId", async () => {
    const port = makePort();
    const session = createAgentNetworkSettingsSession({ port });
    const result = await session.testConnection("unknown-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_PROFILE_NOT_FOUND");
  });

  it("getEffectivePolicy maps settings to policy shape", async () => {
    const port = makePort({
      ...DEFAULT_NETWORK_SETTINGS,
      enabled: true,
      allowedHosts: ["api.example.com"],
      dataEgressPolicy: "auto_approve_search_queries",
      policyRevision: "v1.0-custom"
    });
    const session = createAgentNetworkSettingsSession({ port });
    const policy = await session.getEffectivePolicy();
    expect(policy.ok).toBe(true);
    if (policy.ok) {
      expect(policy.value.enabled).toBe(true);
      expect(policy.value.allowedHosts).toContain("api.example.com");
      expect(policy.value.dataEgressPolicy).toBe("auto_approve_search_queries");
      expect(policy.value.revision).toBe("v1.0-custom");
    }
  });
});
