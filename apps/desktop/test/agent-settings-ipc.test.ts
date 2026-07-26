import { describe, expect, test } from "vitest";

import { createUnifiedError, err, ok } from "@novel-studio/shared";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

describe("Agent settings IPC", () => {
  test("revokes Main-owned capabilities before refreshing after a network mutation", async () => {
    const calls: string[] = [];
    const handlers = createApplicationIpcHandlers(undefined, {
      agentNetworkSettingsSession: {
        async updateNetworkSettings() {
          calls.push("persist");
          return ok({
            enabled: true,
            providerProfiles: [],
            defaultProviderId: "",
            allowedHosts: ["api.example.test"],
            dataEgressPolicy: "require_confirmation",
            policyRevision: "v1.0-test"
          });
        }
      },
      onAgentSettingsChanged: async () => {
        calls.push("revoke");
        await Promise.resolve();
        calls.push("refresh");
        return ok(undefined);
      }
    } as never) as unknown as Record<string, (input?: unknown) => Promise<unknown>>;

    const update = handlers["application:agent-network:update-settings"];
    expect(update).toBeDefined();
    await update?.({ enabled: true, allowedHosts: ["api.example.test"] });

    expect(calls).toEqual(["persist", "revoke", "refresh"]);
  });

  test("returns the persisted settings when the runtime refresh fails", async () => {
    const persisted = {
      enabled: true,
      providerProfiles: [],
      defaultProviderId: "",
      allowedHosts: ["api.example.test"],
      dataEgressPolicy: "require_confirmation" as const,
      policyRevision: "v1.0-persisted"
    };
    const handlers = createApplicationIpcHandlers(undefined, {
      agentNetworkSettingsSession: {
        async updateNetworkSettings() {
          return ok(persisted);
        }
      },
      onAgentSettingsChanged: async () =>
        err(
          createUnifiedError({
            code: "AGENT_RUNTIME_SETTINGS_REFRESH_FAILED",
            message: "Runtime refresh failed."
          })
        )
    } as never) as unknown as Record<string, (input?: unknown) => Promise<unknown>>;

    await expect(
      handlers["application:agent-network:update-settings"]?.({ enabled: true })
    ).resolves.toEqual(ok(persisted));
  });

  test("refreshes the runtime after a network provider secret is persisted", async () => {
    const calls: string[] = [];
    const handlers = createApplicationIpcHandlers(undefined, {
      modelSecretStore: {
        async saveSecret() {
          calls.push("persist-secret");
          return ok(undefined);
        }
      },
      onAgentSettingsChanged: async () => {
        calls.push("refresh-runtime");
        return ok(undefined);
      }
    } as never) as unknown as Record<string, (...input: readonly unknown[]) => Promise<unknown>>;

    await expect(
      handlers["application:settings:save-model-secret"]?.(
        "secret://agent-network/search/api_key",
        "replacement-key"
      )
    ).resolves.toEqual(ok(undefined));
    expect(calls).toEqual(["persist-secret", "refresh-runtime"]);
  });
});
