import type { ModelSettingsPanelProps } from "@novel-studio/ui";
import { useCallback } from "react";

import type { SettingsBridge } from "./settings-bridge.js";

export function useAgentUsageSettingsActions(
  settingsBridge: SettingsBridge | undefined,
  setSettings: (settings: ModelSettingsPanelProps) => void
) {
  const run = useCallback(
    (action: (bridge: SettingsBridge) => Promise<ModelSettingsPanelProps>) => {
      if (settingsBridge === undefined) return;
      const pending = action(settingsBridge);
      setSettings(settingsBridge.getProps());
      void pending.then(setSettings);
    },
    [settingsBridge, setSettings]
  );

  return {
    onRangePresetChange: useCallback(
      (preset: "today" | "7d" | "30d") => run((bridge) => bridge.setAgentUsageRange(preset)),
      [run]
    ),
    onFiltersChange: useCallback(
      (filters: {
        readonly provider?: string;
        readonly model?: string;
        readonly projectId?: string;
      }) => run((bridge) => bridge.setAgentUsageFilters(filters)),
      [run]
    ),
    onSelectDay: useCallback(
      (localDate: string) => run((bridge) => bridge.selectAgentUsageDay(localDate)),
      [run]
    ),
    onClear: useCallback(() => run((bridge) => bridge.clearAgentUsage()), [run])
  };
}
