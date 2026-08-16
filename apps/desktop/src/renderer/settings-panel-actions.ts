import type { AgentNetworkSettingsData, McpServerConfig } from "@novel-studio/application";
import type {
  AgentNetworkSettingsPanelProps,
  AgentToolSourcePanelProps,
  ModelSettingsDraft,
  ModelSettingsPanelProps,
  SettingsPanelSection
} from "@novel-studio/ui";
import { useCallback } from "react";

import type { SettingsBridge } from "./settings-bridge.js";

type NetworkActions = Pick<
  AgentNetworkSettingsPanelProps,
  | "onUpdateSettings"
  | "onTestConnection"
  | "onSaveProvider"
  | "onRemoveProvider"
  | "onSetDefaultProvider"
  | "onRevoke"
>;
type ToolSourceActions = Pick<
  AgentToolSourcePanelProps,
  "onAddServer" | "onRemoveServer" | "onSetEnabled" | "onTestConnection" | "onRevokeServer"
>;

export function useModelSettingsActions(
  settingsBridge: SettingsBridge | undefined,
  setSettings: (settings: ModelSettingsPanelProps) => void
) {
  const handleSettingsProfileSelect = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) return;
      setSettings(settingsBridge.selectProfile(profileId));
      const pending = settingsBridge.discoverModelOptions(profileId);
      setSettings(settingsBridge.getProps());
      void pending.then(setSettings);
    },
    [settingsBridge, setSettings]
  );

  const handleDiscoverSettingsModelOptions = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) return;
      const pending = settingsBridge.discoverModelOptions(profileId);
      setSettings(settingsBridge.getProps());
      void pending.then(setSettings);
    },
    [settingsBridge, setSettings]
  );

  const handleSettingsSectionSelect = useCallback(
    (section: SettingsPanelSection) => {
      if (settingsBridge === undefined) return;
      setSettings(settingsBridge.selectSection(section));

      const pending =
        section === "usage"
          ? settingsBridge.loadAgentUsage()
          : section === "network"
            ? settingsBridge.loadNetworkSettings()
            : section === "mcp"
              ? settingsBridge.loadMcpServers()
              : undefined;
      if (pending !== undefined) {
        setSettings(settingsBridge.getProps());
        void pending.then(setSettings);
      }
    },
    [settingsBridge, setSettings]
  );

  const handleSettingsDraftChange = useCallback(
    (draft: Partial<ModelSettingsDraft>) => {
      if (settingsBridge !== undefined) setSettings(settingsBridge.updateDraft(draft));
    },
    [settingsBridge, setSettings]
  );

  const handleNewSettingsProfile = useCallback(() => {
    if (settingsBridge !== undefined) setSettings(settingsBridge.newProfile());
  }, [settingsBridge, setSettings]);

  const handleSaveSettingsProfile = useCallback(() => {
    if (settingsBridge === undefined) return;
    setSettings(settingsBridge.beginSave());
    void settingsBridge.saveDraft().then(setSettings);
  }, [settingsBridge, setSettings]);

  const handleTestSettingsConnection = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) return;
      setSettings(settingsBridge.beginTestConnection(profileId));
      void settingsBridge.testConnection(profileId).then(setSettings);
    },
    [settingsBridge, setSettings]
  );

  const handleMakeSettingsDefault = useCallback(
    (profileId: string) => {
      if (settingsBridge === undefined) return;
      setSettings(settingsBridge.beginSave());
      void settingsBridge.makeDefault(profileId).then(setSettings);
    },
    [settingsBridge, setSettings]
  );

  const handleRefreshPluginRegistry = useCallback(() => {
    if (settingsBridge !== undefined) void settingsBridge.loadPlugins().then(setSettings);
  }, [settingsBridge, setSettings]);

  const handleSetPluginEnabled = useCallback(
    (pluginId: string, enabled: boolean) => {
      if (settingsBridge !== undefined) {
        void settingsBridge.setPluginEnabled(pluginId, enabled).then(setSettings);
      }
    },
    [settingsBridge, setSettings]
  );

  return {
    handleSettingsProfileSelect,
    handleDiscoverSettingsModelOptions,
    handleSettingsSectionSelect,
    handleSettingsDraftChange,
    handleNewSettingsProfile,
    handleSaveSettingsProfile,
    handleTestSettingsConnection,
    handleMakeSettingsDefault,
    handleRefreshPluginRegistry,
    handleSetPluginEnabled
  };
}

export function useSettingsPanelActions(
  settingsBridge: SettingsBridge | undefined,
  setSettings: (settings: ModelSettingsPanelProps) => void
): { readonly network: NetworkActions; readonly toolSources: ToolSourceActions } {
  const run = useCallback(
    async <T>(action: (bridge: SettingsBridge) => Promise<T>): Promise<T> => {
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
      async onSaveProvider(profile, secret) {
        await run((bridge) => bridge.saveNetworkProvider(profile, secret));
      },
      async onRemoveProvider(profileId) {
        await run((bridge) => bridge.removeNetworkProvider(profileId));
      },
      async onSetDefaultProvider(profileId) {
        await run((bridge) => bridge.setDefaultNetworkProvider(profileId));
      },
      async onRevoke() {
        await run((bridge) => bridge.revokeNetworkAccess());
      }
    },
    toolSources: {
      async onAddServer(config: McpServerConfig, secret?: string) {
        await run((bridge) => bridge.addMcpServer(config, secret));
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
