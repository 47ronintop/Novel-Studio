/**
 * Task D.1 — Desktop Main network runtime.
 * Provides the AgentNetworkToolExecutor backed by Main's pinned-IP dialer.
 * API keys are resolved from safeStorage here — never exposed to renderer.
 */
import { createAgentNetworkToolSession } from "@novel-studio/application";
import { createAgentNetworkSettingsSession } from "@novel-studio/application";
import {
  ControlledFetchError,
  DEFAULT_NETWORK_POLICY,
  type AgentNetworkPolicy
} from "@novel-studio/application";
import type { AgentNetworkToolExecutor } from "@novel-studio/application";
import type {
  AgentNetworkSettingsSession,
  AgentNetworkSettingsPort
} from "@novel-studio/application";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import {
  createMainControlledFetch,
  createOriginScopedControlledFetch,
  type MainControlledFetchOptions
} from "./agent-network-dialer.js";

export interface DesktopNetworkRuntimeOptions {
  /** Resolves a secret:// ref to the plaintext value from Electron safeStorage. */
  readonly resolveSecret: (secretRef: string) => string | undefined | Promise<string | undefined>;
  /** Resolve/store network settings. */
  readonly settingsPort: AgentNetworkSettingsPort;
  /** Injectable deterministic Main dialer dependencies for tests. */
  readonly dialerOptions?: Omit<MainControlledFetchOptions, "authorization">;
}

/**
 * Build the live AgentNetworkToolExecutor for a run.
 * Reads current policy and resolves the active search profile's API key
 * from safeStorage. The resolved key is passed into the session but never
 * crosses IPC; only the secretRef travels across that boundary.
 */
export async function createDesktopNetworkToolExecutor(
  options: DesktopNetworkRuntimeOptions
): Promise<Result<AgentNetworkToolExecutor, UnifiedError>> {
  const settingsSession = createDesktopNetworkSettingsSession(options);
  const settingsResult = await settingsSession.getNetworkSettings();
  if (!settingsResult.ok) return settingsResult;

  const settings = settingsResult.value;
  if (!settings.enabled) {
    // Return a disabled executor that always returns NETWORK_POLICY_DISABLED
    return ok(
      createAgentNetworkToolSession({
        policy: DEFAULT_NETWORK_POLICY
      })
    );
  }

  const policy: AgentNetworkPolicy = {
    enabled: settings.enabled,
    allowedHosts: settings.allowedHosts,
    dataEgressPolicy: settings.dataEgressPolicy,
    revision: settings.policyRevision
  };
  const genericFetch = createMainControlledFetch(policy, options.dialerOptions);

  const activeProfile = settings.providerProfiles.find(
    (profile) => profile.providerId === settings.defaultProviderId
  );
  if (activeProfile !== undefined) {
    let providerEndpoint: URL;
    try {
      providerEndpoint = new URL(activeProfile.endpoint);
    } catch {
      return err(
        networkRuntimeError(
          "NETWORK_PROVIDER_ENDPOINT_INVALID",
          "Search provider endpoint is invalid."
        )
      );
    }
    if (providerEndpoint.protocol !== "https:") {
      return err(
        networkRuntimeError(
          "NETWORK_PROVIDER_ENDPOINT_INSECURE",
          "Search provider credentials require an HTTPS endpoint."
        )
      );
    }
    if (activeProfile.policyRevision !== policy.revision) {
      return err(
        networkRuntimeError(
          "NETWORK_PROVIDER_POLICY_STALE",
          "Search provider profile must be rebound after the network policy changes."
        )
      );
    }
    const apiKey = await options.resolveSecret(activeProfile.apiKeyRef);
    if (apiKey === undefined) {
      return err(
        networkRuntimeError(
          "NETWORK_PROVIDER_SECRET_UNAVAILABLE",
          "The default search provider credential is unavailable."
        )
      );
    }
    const providerFetch = createOriginScopedControlledFetch(
      policy,
      {
        origin: providerEndpoint.origin,
        authorization: `Bearer ${apiKey}`
      },
      options.dialerOptions
    );
    return ok(
      createAgentNetworkToolSession({
        policy,
        searchProfile: activeProfile,
        controlledFetch: genericFetch,
        providerFetch
      })
    );
  }

  return ok(
    createAgentNetworkToolSession({
      policy,
      controlledFetch: genericFetch
    })
  );
}

export function createDesktopNetworkSettingsSession(
  options: DesktopNetworkRuntimeOptions
): AgentNetworkSettingsSession {
  return createAgentNetworkSettingsSession({
    port: options.settingsPort,
    createControlledFetch: async (policy, profile) => {
      const apiKey = await options.resolveSecret(profile.apiKeyRef);
      let endpoint: URL;
      try {
        endpoint = new URL(profile.endpoint);
      } catch {
        return createMainControlledFetch(policy, options.dialerOptions);
      }
      if (apiKey === undefined) {
        throw new ControlledFetchError(
          "NETWORK_PROVIDER_SECRET_UNAVAILABLE",
          "The network provider credential is unavailable."
        );
      }
      return createOriginScopedControlledFetch(
        policy,
        { origin: endpoint.origin, authorization: `Bearer ${apiKey}` },
        options.dialerOptions
      );
    }
  });
}

function networkRuntimeError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Review the Agent network provider configuration.",
    traceId: "desktop-agent-network-runtime"
  });
}
