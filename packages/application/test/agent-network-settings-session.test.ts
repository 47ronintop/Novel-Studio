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

function makePort(
  initial: AgentNetworkSettingsData = DEFAULT_NETWORK_SETTINGS
): AgentNetworkSettingsPort {
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
          err({
            code: "STORAGE_READ_FAILED",
            message: "disk error",
            category: "StorageError"
          } as import("@novel-studio/shared").UnifiedError)
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

  it("returns validation errors for malformed renderer input instead of throwing", async () => {
    const session = createAgentNetworkSettingsSession({ port: makePort() });

    await expect(
      session.updateNetworkSettings({
        allowedHosts: 42
      } as unknown as Partial<AgentNetworkSettingsData>)
    ).resolves.toMatchObject({ ok: false, error: { code: "NETWORK_SETTINGS_INVALID" } });
    await expect(
      session.saveProviderProfile({
        providerId: "search"
      } as unknown as Parameters<typeof session.saveProviderProfile>[0])
    ).resolves.toMatchObject({ ok: false, error: { code: "NETWORK_PROFILE_INVALID" } });
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

  it("creates, edits, selects, and removes validated provider profiles", async () => {
    const session = createAgentNetworkSettingsSession({ port: makePort() });
    const policy = await session.updateNetworkSettings({
      enabled: true,
      allowedHosts: ["search.example.com", "backup.example.com"]
    });
    expect(policy.ok).toBe(true);

    const first = await session.saveProviderProfile({
      providerId: "primary",
      name: "Primary Search",
      endpoint: "https://search.example.com/query",
      apiKeyRef: "secret://agent-network/primary/api_key"
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.defaultProviderId).toBe("primary");
    expect(first.value.providerProfiles[0]?.policyRevision).toBe(first.value.policyRevision);

    const second = await session.saveProviderProfile({
      providerId: "backup",
      name: "Backup Search",
      endpoint: "https://backup.example.com/query",
      apiKeyRef: "secret://agent-network/backup/api_key"
    });
    expect(second.ok).toBe(true);
    const selected = await session.setDefaultProvider("backup");
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value.defaultProviderId).toBe("backup");

    const removed = await session.removeProviderProfile("backup");
    expect(removed.ok).toBe(true);
    if (removed.ok) {
      expect(removed.value.defaultProviderId).toBe("primary");
      expect(removed.value.providerProfiles.map((profile) => profile.providerId)).toEqual([
        "primary"
      ]);
    }
  });

  it.each([
    ["plain key", "api-key", "https://search.example.com/query"],
    ["HTTP endpoint", "secret://agent-network/search/api_key", "http://search.example.com/query"],
    [
      "credential URL",
      "secret://agent-network/search/api_key",
      "https://user@search.example.com/query"
    ],
    ["unlisted host", "secret://agent-network/search/api_key", "https://other.example.com/query"]
  ])("rejects an invalid provider profile: %s", async (_label, apiKeyRef, endpoint) => {
    const session = createAgentNetworkSettingsSession({ port: makePort() });
    await session.updateNetworkSettings({
      enabled: true,
      allowedHosts: ["search.example.com"]
    });

    const result = await session.saveProviderProfile({
      providerId: "search",
      name: "Search",
      endpoint,
      apiKeyRef
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a provider that references another secret namespace", async () => {
    const session = createAgentNetworkSettingsSession({ port: makePort() });
    await session.updateNetworkSettings({
      enabled: true,
      allowedHosts: ["search.example.com"]
    });

    await expect(
      session.saveProviderProfile({
        providerId: "search",
        name: "Search",
        endpoint: "https://search.example.com/query",
        apiKeyRef: "secret://model-profile/victim/api_key"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "NETWORK_PROFILE_SECRET_REF_INVALID" }
    });
  });

  it("rebinds every provider when the policy revision changes", async () => {
    const session = createAgentNetworkSettingsSession({ port: makePort() });
    await session.updateNetworkSettings({
      enabled: true,
      allowedHosts: ["search.example.com"]
    });
    const saved = await session.saveProviderProfile({
      providerId: "search",
      name: "Search",
      endpoint: "https://search.example.com/query",
      apiKeyRef: "secret://agent-network/search/api_key"
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const updated = await session.updateNetworkSettings({
      dataEgressPolicy: "auto_approve_search_queries"
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.policyRevision).not.toBe(saved.value.policyRevision);
    expect(updated.value.providerProfiles[0]?.policyRevision).toBe(updated.value.policyRevision);
  });
});
