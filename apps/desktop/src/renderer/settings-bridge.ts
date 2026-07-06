import { MODEL_PROVIDER_CATALOG } from "@novel-studio/application";
import type {
  ModelProfile,
  NovelStudioApi,
  PluginSettingsSnapshot
} from "@novel-studio/application";
import type {
  ModelSettingsDraft,
  ModelSettingsPanelProps,
  PluginSettingsPanelProps
} from "@novel-studio/ui";

export interface SettingsBridgeOptions {
  readonly createProfileId?: () => string;
}

export interface SettingsBridge {
  getProps(): ModelSettingsPanelProps;
  load(): Promise<ModelSettingsPanelProps>;
  loadPlugins(): Promise<ModelSettingsPanelProps>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ModelSettingsPanelProps>;
  selectProfile(profileId: string): ModelSettingsPanelProps;
  updateDraft(draft: Partial<ModelSettingsDraft>): ModelSettingsPanelProps;
  newProfile(): ModelSettingsPanelProps;
  beginSave(): ModelSettingsPanelProps;
  saveDraft(options?: { readonly makeDefault?: boolean }): Promise<ModelSettingsPanelProps>;
  makeDefault(profileId: string): Promise<ModelSettingsPanelProps>;
  beginTestConnection(profileId: string): ModelSettingsPanelProps;
  testConnection(profileId: string): Promise<ModelSettingsPanelProps>;
}

export function createSettingsBridge(
  api: NovelStudioApi,
  options: SettingsBridgeOptions = {}
): SettingsBridge {
  const createProfileId = options.createProfileId ?? (() => `model_${Date.now().toString(36)}`);
  let defaultProfileId = "";
  let profiles: readonly ModelProfile[] = [];
  let selectedProfileId: string | undefined;
  let draft: ModelSettingsDraft = newDraft(createProfileId());
  let saveStatus: ModelSettingsPanelProps["saveStatus"] = "idle";
  let connectionStatus: ModelSettingsPanelProps["connectionStatus"] | undefined;
  let plugins: PluginSettingsPanelProps = {
    status: "idle",
    entries: [],
    feedback: { kind: "info", message: "插件注册表尚未加载。" }
  };
  let feedback: ModelSettingsPanelProps["feedback"] | undefined;

  return {
    getProps: () => toProps(),
    async load() {
      const [result] = await Promise.all([api.settings.listModelProfiles(), loadPlugins()]);
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        return toProps();
      }

      defaultProfileId = result.value.defaultProfileId;
      profiles = result.value.profiles;
      const selected = profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0];
      selectedProfileId = selected?.id;
      draft = selected === undefined ? newDraft(createProfileId()) : draftFromProfile(selected);
      saveStatus = "idle";
      feedback = { kind: "info", message: "模型配置已加载。" };
      return toProps();
    },
    async loadPlugins() {
      await loadPlugins();
      return toProps();
    },
    async setPluginEnabled(pluginId, enabled) {
      plugins = {
        ...plugins,
        status: "loading",
        feedback: { kind: "info", message: "正在更新插件状态..." }
      };
      const result = await api.plugins.setEnabled(pluginId, enabled);
      if (!result.ok) {
        plugins = {
          ...plugins,
          status: "error",
          feedback: { kind: "error", message: result.error.message }
        };
        return toProps();
      }

      plugins = toPluginProps(result.value, "插件状态已更新。");
      return toProps();
    },
    selectProfile(profileId) {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (profile === undefined) {
        feedback = { kind: "error", message: "没有找到这个模型配置。" };
        return toProps();
      }

      selectedProfileId = profile.id;
      draft = draftFromProfile(profile);
      saveStatus = "idle";
      feedback = undefined;
      return toProps();
    },
    updateDraft(nextDraft) {
      draft = { ...draft, ...nextDraft };
      saveStatus = "idle";
      feedback = undefined;
      return toProps();
    },
    newProfile() {
      selectedProfileId = undefined;
      draft = newDraft(createProfileId());
      saveStatus = "idle";
      feedback = { kind: "info", message: "正在创建新的模型配置。" };
      return toProps();
    },
    beginSave() {
      saveStatus = "saving";
      feedback = { kind: "info", message: "正在保存模型配置..." };
      return toProps();
    },
    async saveDraft(saveOptions = {}) {
      return saveCurrentDraft(saveOptions);
    },
    async makeDefault(profileId) {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (profile === undefined) {
        feedback = { kind: "error", message: "没有找到这个模型配置。" };
        return toProps();
      }

      selectedProfileId = profile.id;
      draft = draftFromProfile(profile);
      return saveCurrentDraft({ makeDefault: true });
    },
    beginTestConnection(profileId) {
      connectionStatus = {
        profileId,
        status: "testing",
        detail: "正在测试连接..."
      };
      return toProps();
    },
    async testConnection(profileId) {
      const result = await api.settings.testModelProfileConnection(profileId);
      if (!result.ok) {
        connectionStatus = {
          profileId,
          status: "failed",
          detail: result.error.message
        };
        feedback = { kind: "error", message: result.error.message };
        return toProps();
      }

      connectionStatus = {
        profileId,
        status: result.value.ok ? "success" : "failed",
        detail: result.value.detail
      };
      feedback = {
        kind: result.value.ok ? "info" : "error",
        message: result.value.detail
      };
      return toProps();
    }
  };

  async function loadPlugins(): Promise<PluginSettingsPanelProps> {
    plugins = {
      ...plugins,
      status: "loading",
      feedback: { kind: "info", message: "正在读取插件注册表..." }
    };
    const result = await api.plugins.loadRegistry();
    if (!result.ok) {
      plugins = {
        status: "error",
        entries: [],
        feedback: { kind: "error", message: result.error.message }
      };
      return plugins;
    }

    plugins = toPluginProps(result.value, "插件注册表已加载。");
    return plugins;
  }

  async function saveCurrentDraft(saveOptions: {
    readonly makeDefault?: boolean;
  }): Promise<ModelSettingsPanelProps> {
    saveStatus = "saving";
    const profile = profileFromDraft(draft);
    if (profile === undefined) {
      saveStatus = "error";
      feedback = { kind: "error", message: "模型配置字段格式不正确，请检查数字和密钥引用。" };
      return toProps();
    }

    const result = await api.settings.saveModelProfile(profile, saveOptions);
    if (!result.ok) {
      saveStatus = "error";
      feedback = { kind: "error", message: result.error.message };
      return toProps();
    }

    defaultProfileId = result.value.defaultProfileId;
    profiles = result.value.profiles;
    selectedProfileId = profile.id;
    draft = draftFromProfile(profile);
    saveStatus = "saved";
    feedback = { kind: "info", message: "模型配置已保存。" };
    return toProps();
  }

  function profileFromDraft(nextDraft: ModelSettingsDraft): ModelProfile | undefined {
    const temperature = parseNumber(nextDraft.temperature);
    const maxTokens = parseInteger(nextDraft.maxTokens);
    const topP = nextDraft.topP.trim().length === 0 ? undefined : parseNumber(nextDraft.topP);
    const timeoutMs = parseInteger(nextDraft.timeoutMs);
    if (
      temperature === undefined ||
      maxTokens === undefined ||
      timeoutMs === undefined ||
      (nextDraft.topP.trim().length > 0 && topP === undefined)
    ) {
      return undefined;
    }

    const existingProfile = profiles.find((entry) => entry.id === selectedProfileId);
    const apiKeyRef = nextDraft.apiKeyRefInput.trim() || existingProfile?.apiKeyRef;
    if (apiKeyRef === undefined || !apiKeyRef.startsWith("secret://")) {
      return undefined;
    }

    const baseProfile: ModelProfile = {
      id: nextDraft.id.trim(),
      provider: nextDraft.provider,
      displayName: nextDraft.displayName.trim(),
      apiKeyRef,
      modelName: nextDraft.modelName.trim(),
      temperature,
      maxTokens,
      timeoutMs
    };

    return {
      ...baseProfile,
      ...(nextDraft.baseUrl.trim().length === 0 ? {} : { baseUrl: nextDraft.baseUrl.trim() }),
      ...(topP === undefined ? {} : { topP })
    };
  }

  function toProps(): ModelSettingsPanelProps {
    return {
      defaultProfileId,
      ...(selectedProfileId === undefined ? {} : { selectedProfileId }),
      profiles,
      draft,
      saveStatus,
      ...(connectionStatus === undefined ? {} : { connectionStatus }),
      providerOptions: MODEL_PROVIDER_CATALOG.map((provider) => ({
        id: provider.id,
        label: provider.label
      })),
      plugins: {
        ...plugins,
        onRefresh: () => undefined,
        onSetEnabled: () => undefined
      },
      ...(feedback === undefined ? {} : { feedback }),
      onSelectProfile: () => undefined,
      onDraftChange: () => undefined,
      onNewProfile: () => undefined,
      onSaveProfile: () => undefined,
      onTestConnection: () => undefined,
      onMakeDefault: () => undefined
    };
  }
}

function toPluginProps(
  snapshot: PluginSettingsSnapshot,
  message: string
): PluginSettingsPanelProps {
  return {
    status: "loaded",
    entries: snapshot.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      enabled: plugin.enabled,
      manifestPath: plugin.manifestPath,
      grantedPermissions: plugin.grantedPermissions,
      manifestStatus: plugin.manifestStatus,
      ...(plugin.manifest === undefined ? {} : { manifest: plugin.manifest }),
      ...(plugin.manifestError === undefined ? {} : { manifestError: plugin.manifestError })
    })),
    feedback: { kind: "info", message }
  };
}

function draftFromProfile(profile: ModelProfile): ModelSettingsDraft {
  return {
    id: profile.id,
    provider: profile.provider,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl ?? "",
    modelName: profile.modelName,
    apiKeyRefInput: "",
    temperature: String(profile.temperature),
    maxTokens: String(profile.maxTokens),
    topP: profile.topP === undefined ? "" : String(profile.topP),
    timeoutMs: String(profile.timeoutMs)
  };
}

function newDraft(profileId: string): ModelSettingsDraft {
  return {
    id: profileId,
    provider: "openai-compatible",
    displayName: "新模型配置",
    baseUrl: "",
    modelName: "",
    apiKeyRefInput: `secret://${profileId}/api_key`,
    temperature: "0.7",
    maxTokens: "4096",
    topP: "1",
    timeoutMs: "60000"
  };
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
