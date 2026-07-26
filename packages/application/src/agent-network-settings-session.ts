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
import {
  createControlledFetch,
  ControlledFetchError,
  isNetworkEndpointAllowed,
  validateNetworkPolicy
} from "./agent-network-policy.js";

export interface AgentNetworkSettingsData {
  readonly enabled: boolean;
  readonly providerProfiles: readonly AgentNetworkProviderProfile[];
  readonly defaultProviderId: string;
  readonly allowedHosts: readonly string[];
  readonly dataEgressPolicy: AgentNetworkPolicy["dataEgressPolicy"];
  readonly policyRevision: string;
}

export const DEFAULT_NETWORK_SETTINGS: AgentNetworkSettingsData = {
  enabled: false,
  providerProfiles: [],
  defaultProviderId: "",
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
  saveProviderProfile(
    profile: Omit<AgentNetworkProviderProfile, "policyRevision">
  ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  removeProviderProfile(
    providerId: string
  ): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
  setDefaultProvider(providerId: string): Promise<Result<AgentNetworkSettingsData, UnifiedError>>;
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

let lastRevisionTick = 0;

function bumpRevision(): string {
  lastRevisionTick = Math.max(Date.now(), lastRevisionTick + 1);
  return `v1.0-${String(lastRevisionTick)}`;
}

function validateAndBindSettings(
  value: Omit<AgentNetworkSettingsData, "policyRevision">,
  revision: string
): Result<AgentNetworkSettingsData, UnifiedError> {
  if (!hasNetworkSettingsShape(value)) {
    return err(settingsError("NETWORK_SETTINGS_INVALID", "Network settings are malformed."));
  }
  const policy: AgentNetworkPolicy = {
    enabled: true,
    allowedHosts: value.allowedHosts,
    dataEgressPolicy: value.dataEgressPolicy,
    revision
  };
  const policyValidation = validateNetworkPolicy(policy);
  if (!policyValidation.ok) {
    return err(
      settingsError(
        "NETWORK_POLICY_INVALID",
        `Invalid allowed host entries: ${policyValidation.invalidHosts.join(", ")}.`
      )
    );
  }

  const seenProviderIds = new Set<string>();
  const providerProfiles: AgentNetworkProviderProfile[] = [];
  for (const profile of value.providerProfiles) {
    const validation = validateProviderProfile(profile, policy);
    if (!validation.ok) return validation;
    if (seenProviderIds.has(profile.providerId)) {
      return err(
        settingsError(
          "NETWORK_PROFILE_DUPLICATE",
          `Network provider '${profile.providerId}' is duplicated.`
        )
      );
    }
    seenProviderIds.add(profile.providerId);
    providerProfiles.push({ ...profile, policyRevision: revision });
  }

  const defaultProviderId = value.defaultProviderId.trim();
  if (
    (providerProfiles.length === 0 && defaultProviderId.length > 0) ||
    (providerProfiles.length > 0 && !seenProviderIds.has(defaultProviderId))
  ) {
    return err(
      settingsError(
        "NETWORK_DEFAULT_PROFILE_INVALID",
        "The default network provider must reference a configured profile."
      )
    );
  }

  return ok({
    enabled: value.enabled,
    providerProfiles,
    defaultProviderId,
    allowedHosts: [...value.allowedHosts],
    dataEgressPolicy: value.dataEgressPolicy,
    policyRevision: revision
  });
}

function validateProviderProfile(
  profile: AgentNetworkProviderProfile,
  policy: AgentNetworkPolicy
): Result<void, UnifiedError> {
  if (!hasNetworkProviderProfileShape(profile)) {
    return err(settingsError("NETWORK_PROFILE_INVALID", "Network provider profile is malformed."));
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(profile.providerId)) {
    return err(settingsError("NETWORK_PROFILE_INVALID", "Network provider ID is invalid."));
  }
  if (profile.name.trim().length === 0 || profile.name.length > 256) {
    return err(settingsError("NETWORK_PROFILE_INVALID", "Network provider name is invalid."));
  }
  if (
    profile.apiKeyRef !== `secret://agent-network/${profile.providerId}/api_key` ||
    profile.apiKeyRef.length > 512
  ) {
    return err(
      settingsError(
        "NETWORK_PROFILE_SECRET_REF_INVALID",
        "Network provider credentials must use the provider-bound secret reference."
      )
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(profile.endpoint);
  } catch {
    return err(settingsError("NETWORK_PROFILE_ENDPOINT_INVALID", "Network endpoint is invalid."));
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== "" ||
    !isNetworkEndpointAllowed(policy, endpoint)
  ) {
    return err(
      settingsError(
        "NETWORK_PROFILE_ENDPOINT_INVALID",
        "Network endpoint must be an allowed credential-free HTTPS URL without a fragment."
      )
    );
  }
  return ok(undefined);
}

function hasNetworkSettingsShape(
  value: unknown
): value is Omit<AgentNetworkSettingsData, "policyRevision"> {
  if (!isRecord(value)) return false;
  return (
    typeof value["enabled"] === "boolean" &&
    Array.isArray(value["providerProfiles"]) &&
    typeof value["defaultProviderId"] === "string" &&
    Array.isArray(value["allowedHosts"]) &&
    value["allowedHosts"].every((host): host is string => typeof host === "string") &&
    (value["dataEgressPolicy"] === "require_confirmation" ||
      value["dataEgressPolicy"] === "auto_approve_search_queries")
  );
}

function hasNetworkProviderProfileShape(value: unknown): value is AgentNetworkProviderProfile {
  return (
    isRecord(value) &&
    typeof value["providerId"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["apiKeyRef"] === "string" &&
    typeof value["endpoint"] === "string" &&
    typeof value["policyRevision"] === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  ) => ControlledFetch | Promise<ControlledFetch>;
  readonly now?: () => string;
}): AgentNetworkSettingsSession {
  async function readSettings(): Promise<Result<AgentNetworkSettingsData, UnifiedError>> {
    const stored = await input.port.readNetworkSettings();
    if (!stored.ok) return stored;
    if (stored.value === undefined || stored.value === null) {
      return ok(DEFAULT_NETWORK_SETTINGS);
    }
    if (
      stored.value.providerProfiles.some(
        (profile) => profile.policyRevision !== stored.value.policyRevision
      )
    ) {
      return err(
        settingsError(
          "NETWORK_PROFILE_POLICY_STALE",
          "A stored network provider is not bound to the current policy revision."
        )
      );
    }
    return validateAndBindSettings(
      {
        enabled: stored.value.enabled,
        providerProfiles: stored.value.providerProfiles,
        defaultProviderId: stored.value.defaultProviderId,
        allowedHosts: stored.value.allowedHosts,
        dataEgressPolicy: stored.value.dataEgressPolicy
      },
      stored.value.policyRevision
    );
  }

  return {
    getNetworkSettings: readSettings,

    async updateNetworkSettings(partial) {
      const current = await readSettings();
      if (!current.ok) return current;
      const revision = bumpRevision();
      const next = validateAndBindSettings(
        {
          enabled: partial.enabled ?? current.value.enabled,
          providerProfiles: partial.providerProfiles ?? current.value.providerProfiles,
          defaultProviderId: partial.defaultProviderId ?? current.value.defaultProviderId,
          allowedHosts: partial.allowedHosts ?? current.value.allowedHosts,
          dataEgressPolicy: partial.dataEgressPolicy ?? current.value.dataEgressPolicy
        },
        revision
      );
      if (!next.ok) return next;
      return input.port.writeNetworkSettings(next.value);
    },

    async saveProviderProfile(profile) {
      const current = await readSettings();
      if (!current.ok) return current;
      const existing = current.value.providerProfiles.some(
        (entry) => entry.providerId === profile.providerId
      );
      const providerProfiles = existing
        ? current.value.providerProfiles.map((entry) =>
            entry.providerId === profile.providerId
              ? { ...profile, policyRevision: "pending" }
              : entry
          )
        : [...current.value.providerProfiles, { ...profile, policyRevision: "pending" }];
      const revision = bumpRevision();
      const next = validateAndBindSettings(
        {
          enabled: current.value.enabled,
          providerProfiles,
          defaultProviderId:
            current.value.defaultProviderId.length === 0
              ? profile.providerId
              : current.value.defaultProviderId,
          allowedHosts: current.value.allowedHosts,
          dataEgressPolicy: current.value.dataEgressPolicy
        },
        revision
      );
      if (!next.ok) return next;
      return input.port.writeNetworkSettings(next.value);
    },

    async removeProviderProfile(providerId) {
      const current = await readSettings();
      if (!current.ok) return current;
      const providerProfiles = current.value.providerProfiles.filter(
        (entry) => entry.providerId !== providerId
      );
      if (providerProfiles.length === current.value.providerProfiles.length) {
        return err(
          settingsError(
            "NETWORK_PROFILE_NOT_FOUND",
            `No provider profile found with id '${providerId}'.`
          )
        );
      }
      const revision = bumpRevision();
      const next = validateAndBindSettings(
        {
          enabled: current.value.enabled,
          providerProfiles,
          defaultProviderId:
            current.value.defaultProviderId === providerId
              ? (providerProfiles[0]?.providerId ?? "")
              : current.value.defaultProviderId,
          allowedHosts: current.value.allowedHosts,
          dataEgressPolicy: current.value.dataEgressPolicy
        },
        revision
      );
      if (!next.ok) return next;
      return input.port.writeNetworkSettings(next.value);
    },

    async setDefaultProvider(providerId) {
      const current = await readSettings();
      if (!current.ok) return current;
      const revision = bumpRevision();
      const next = validateAndBindSettings(
        {
          enabled: current.value.enabled,
          providerProfiles: current.value.providerProfiles,
          defaultProviderId: providerId,
          allowedHosts: current.value.allowedHosts,
          dataEgressPolicy: current.value.dataEgressPolicy
        },
        revision
      );
      if (!next.ok) return next;
      return input.port.writeNetworkSettings(next.value);
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
        const controlled = await Promise.resolve(
          input.createControlledFetch?.(policy, profile) ?? createControlledFetch(policy)
        );
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
