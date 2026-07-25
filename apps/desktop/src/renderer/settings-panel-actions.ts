import type { AgentNetworkSettingsData, McpServerConfig } from "@novel-studio/application";
import type {
  AgentNetworkSettingsPanelProps,
  AgentToolSourcePanelProps,
  ModelSettingsPanelProps
} from "@novel-studio/ui";
import { useCallback } from "react";

import type { SettingsBridge } from "./settings-bridge.js";

type NetworkActions = Pick<
  AgentNetworkSettingsPanelProps,
  "onUpdateSettings" | "onTestConnection" | "onRevoke"
>;
type ToolSourceActions = Pick<
  AgentToolSourcePanelProps,
  "onAddServer" | "onRemoveServer" | "onSetEnabled" | "onTestConnection" | "onRevokeServer"
>;

export function useSettingsPanelActions(
  settingsBridge: SettingsBridge | undefined,
  setSettings: (settings: ModelSettingsPanelProps) => void
): { readonly network: NetworkActions; readonly toolSources: ToolSourceActions } {
  const run = useCallback(
    async <T,>(action: (bridge: SettingsBridge) => Promise<T>): Promise<T> => {
      if (settingsBridge === undefined) throw new Error("Settings are unavailable.");
      const pending = action(settingsBridge);
      setSettings(settingsBridge.getProps());
      try {
        return await pending;
      } finally {
        setSettings(settingsBridge.getProps());
      }
    },
    [settingsBridge, setSettings]
  );

  return {
    network: {
      async onUpdateSettings(partial: Partial<AgentNetworkSettingsData>) {
        await run((bridge) => bridge.updateNetworkSettings(partial));
      },
      async onTestConnection(profileId: string) {
        await run((bridge) => bridge.testNetworkConnection(profileId));
        return { latencyMs: 0 };
      },
      async onRevoke() {
        await run((bridge) => bridge.revokeNetworkAccess());
      }
    },
    toolSources: {
      async onAddServer(config: McpServerConfig) {
        await run((bridge) => bridge.addMcpServer(config));
      },
      async onRemoveServer(serverId: string) {
        await run((bridge) => bridge.removeMcpServer(serverId));
      },
      async onSetEnabled(serverId: string, enabled: boolean) {
        await run((bridge) => bridge.setMcpServerEnabled(serverId, enabled));
      },
      async onTestConnection(serverId: string) {
        await run((bridge) => bridge.testMcpConnection(serverId));
        return { latencyMs: 0 };
      },
      async onRevokeServer(serverId: string) {
        await run((bridge) => bridge.revokeMcpServer(serverId));
      }
    }
  };
}
