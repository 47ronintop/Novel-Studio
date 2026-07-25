import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";

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
});
