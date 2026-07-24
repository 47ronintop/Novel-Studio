/**
 * Task D.1 — Desktop Main network runtime.
 * Provides the AgentNetworkToolExecutor backed by Node.js fetch.
 * API keys are resolved from safeStorage here — never exposed to renderer.
 */
import { createAgentNetworkToolSession } from "@novel-studio/application";
import { createAgentNetworkSettingsSession } from "@novel-studio/application";
import {
  createControlledFetch,
  DEFAULT_NETWORK_POLICY,
  type AgentNetworkPolicy
} from "@novel-studio/application";
import type { AgentNetworkToolExecutor } from "@novel-studio/application";
import type {
  AgentNetworkSettingsSession,
  AgentNetworkSettingsPort
} from "@novel-studio/application";
import { ok, type Result, type UnifiedError } from "@novel-studio/shared";

export interface DesktopNetworkRuntimeOptions {
  /** Resolves a secret:// ref to the plaintext value from Electron safeStorage. */
  readonly resolveSecret: (secretRef: string) => string | undefined;
  /** Resolve/store network settings. */
  readonly settingsPort: AgentNetworkSettingsPort;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
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

  // Resolve first available provider profile
  const activeProfile = settings.providerProfiles[0];
  if (activeProfile !== undefined) {
    const apiKey = options.resolveSecret(activeProfile.apiKeyRef);
    const controlledFetch = createControlledFetch(policy, options.fetchImpl ?? globalThis.fetch);
    return ok(createAgentNetworkToolSession({
      policy,
      searchProfile: activeProfile,
      controlledFetch: async (req: Parameters<typeof controlledFetch>[0]) => {
        const headers: Record<string, string> = { ...(req.headers ?? {}) };
        if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
        return controlledFetch({ ...req, headers });
      }
    }));
  }

  return ok(
    createAgentNetworkToolSession({
      policy,
      controlledFetch: createControlledFetch(policy, options.fetchImpl ?? globalThis.fetch)
    })
  );
}

export function createDesktopNetworkSettingsSession(
  options: DesktopNetworkRuntimeOptions
): AgentNetworkSettingsSession {
  return createAgentNetworkSettingsSession({
    port: options.settingsPort,
    resolveApiKey: options.resolveSecret
  });
}
