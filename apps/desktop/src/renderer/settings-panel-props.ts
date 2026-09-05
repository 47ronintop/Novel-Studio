import type { UserAppearancePreferences } from "@novel-studio/shared";
import type { ModelSettingsPanelProps } from "@novel-studio/ui";

type AgentUsageSettingsActions = Pick<
  NonNullable<ModelSettingsPanelProps["usage"]>,
  "onRangePresetChange" | "onFiltersChange" | "onSelectDay" | "onClear"
>;
type SettingsPanelActions = {
  readonly network: Pick<
    NonNullable<ModelSettingsPanelProps["network"]>,
    | "onUpdateSettings"
    | "onTestConnection"
    | "onSaveProvider"
    | "onRemoveProvider"
    | "onSetDefaultProvider"
    | "onRevoke"
  >;
  readonly toolSources: Pick<
    NonNullable<ModelSettingsPanelProps["toolSources"]>,
    "onAddServer" | "onRemoveServer" | "onSetEnabled" | "onTestConnection" | "onRevokeServer"
  >;
};

interface InteractiveSettingsInput {
  readonly settings: ModelSettingsPanelProps | undefined;
  readonly appearanceFeedback: ModelSettingsPanelProps["appearanceFeedback"];
  readonly editorPreferences: NonNullable<ModelSettingsPanelProps["editorPreferences"]>;
  readonly appearancePreferences: UserAppearancePreferences;
  readonly onAppearancePreferencesChange: NonNullable<
    ModelSettingsPanelProps["onAppearancePreferencesChange"]
  >;
  readonly onEditorPreferencesChange: NonNullable<
    ModelSettingsPanelProps["onEditorPreferencesChange"]
  >;
  readonly agentUsageSettingsActions: AgentUsageSettingsActions;
  readonly settingsPanelActions: SettingsPanelActions;
}

export function createInteractiveSettings(
  input: InteractiveSettingsInput
): ModelSettingsPanelProps | undefined {
  const { settings } = input;
  if (settings === undefined) return undefined;

  return {
    ...settings,
    appearanceFeedback: input.appearanceFeedback,
    editorPreferences: input.editorPreferences,
    appearancePreferences: {
      ...input.appearancePreferences,
      editor: input.editorPreferences
    },
    onAppearancePreferencesChange: input.onAppearancePreferencesChange,
    onEditorPreferencesChange: input.onEditorPreferencesChange,
    usage:
      settings.usage === undefined
        ? undefined
        : { ...settings.usage, ...input.agentUsageSettingsActions },
    network:
      settings.network === undefined
        ? undefined
        : { ...settings.network, ...input.settingsPanelActions.network },
    toolSources:
      settings.toolSources === undefined
        ? undefined
        : { ...settings.toolSources, ...input.settingsPanelActions.toolSources }
  };
}
