/**
 * Task D.1 — Network settings session.
 * Reads/writes agentNetwork settings; testConnection does a minimal controlled fetch.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  AgentNetworkPolicy,
  AgentNetworkProviderProfile,
  ControlledFetch
} from "./agent-network-policy.js";
import { createControlledFetch, ControlledFetchError } from "./agent-network-policy.js";

export interface AgentNetworkSettingsData {
  readonly enabled: boolean;
  readonly providerProfiles: readonly AgentNetworkProviderProfile[];
  readonly allowedHosts: readonly string[];
  readonly dataEgressPolicy: AgentNetworkPolicy["dataEgressPolicy"];
  readonly policyRevision: string;
}

export const DEFAULT_NETWORK_SETTINGS: AgentNetworkSettingsData = {
  enabled: false,
  providerProfiles: [],
  allowedHosts: [],
  dataEgressPolicy: "require_confirmation",
  policyRevision: "v1.0-default"
};

export interface AgentNetworkSettingsPort {
  readNetworkSettings(): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  writeNetworkSettings(
    settings: AgentNetworkSettingsData
  ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
}

export interface AgentNetworkSettingsSession {
  getNetworkSettings(): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  updateNetworkSettings(
    partial: Partial<AgentNetworkSettingsData>
  ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  testConnection(profileId: string): Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
  revokeNetworkAccess(): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  getEffectivePolicy(): Promise<Result<AgentNetworkPolicy, UnifiedError>>;
}

function settingsError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError" as const,
    message,
    recoverability: "user-action",
    suggestedAction: "Review the network settings and retry.",
    traceId: "agent-network-settings-session"
  });
}

function bumpRevision(): string {
  return `v1.0-${Date.now()}`;
}

export function createAgentNetworkSettingsSession(input: {
  readonly port: AgentNetworkSettingsPort;
  /**
   * Main supplies the pinned dialer (and, if needed, an origin-bound provider
   * credential) for connection tests. Application never handles plaintext keys.
   */
  readonly createControlledFetch?: (
    policy: AgentNetworkPolicy,
    profile: AgentNetworkProviderProfile
  ) => ControlledFetch;
  readonly now?: () => string;
}): AgentNetworkSettingsSession {
  async function readSettings(): Promise<Result<AgentNetworkSettingsData, UnifiedError>> {
    const stored = await input.port.readNetworkSettings();
    if (!stored.ok) return stored;
    if (stored.value === undefined || stored.value === null) {
      return ok(DEFAULT_NETWORK_SETTINGS);
    }
    return ok(stored.value);
  }

  return {
    getNetworkSettings: readSettings,

    async updateNetworkSettings(partial) {
      const current = await readSettings();
      if (!current.ok) return current;
      const next: AgentNetworkSettingsData = {
        ...current.value,
        ...partial,
        policyRevision: bumpRevision()
      };
      return input.port.writeNetworkSettings(next);
    },

    async testConnection(profileId) {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const profile = settings.value.providerProfiles.find((p) => p.providerId === profileId);
      if (!profile) {
        return err(
          settingsError(
            "NETWORK_PROFILE_NOT_FOUND",
            `No provider profile found with id '${profileId}'.`
          )
        );
      }
      const policy: AgentNetworkPolicy = {
        enabled: settings.value.enabled,
        allowedHosts: settings.value.allowedHosts,
        dataEgressPolicy: settings.value.dataEgressPolicy,
        revision: settings.value.policyRevision
      };
      const start = Date.now();
      try {
        const controlled =
          input.createControlledFetch?.(policy, profile) ?? createControlledFetch(policy);
        await controlled({
          url: profile.endpoint
        });
        return ok({ latencyMs: Date.now() - start });
      } catch (error) {
        const code = error instanceof ControlledFetchError ? error.code : "NETWORK_TEST_FAILED";
        const msg = error instanceof Error ? error.message : "Connection test failed.";
        return err(settingsError(code, msg));
      }
    },

    async revokeNetworkAccess() {
      const revoked: AgentNetworkSettingsData = {
        ...DEFAULT_NETWORK_SETTINGS,
        policyRevision: bumpRevision()
      };
      return input.port.writeNetworkSettings(revoked);
    },

    async getEffectivePolicy() {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const policy: AgentNetworkPolicy = {
        enabled: settings.value.enabled,
        allowedHosts: settings.value.allowedHosts,
        dataEgressPolicy: settings.value.dataEgressPolicy,
        revision: settings.value.policyRevision
      };
      return ok(policy);
    }
  };
}
