import { createPluginSecurityAuditReport, MODEL_PROVIDER_CATALOG } from "@novel-studio/application";
import type {
  AgentNetworkSettingsData,
  AgentNetworkProviderProfile,
  AgentUsageQuery,
  McpServerConfig,
  ModelDiscoverySnapshot,
  ModelProfile,
  NovelStudioApi,
  PluginSecurityAuditEntry,
  PluginSettingsSnapshot
} from "@novel-studio/application";
import type {
  AgentNetworkSettingsPanelProps,
  AgentToolSourceEntry,
  AgentToolSourcePanelProps,
  ModelSettingsDraft,
  ModelSettingsPanelProps,
  PluginSettingsPanelProps,
  SettingsPanelSection
} from "@novel-studio/ui";

export interface SettingsBridgeOptions {
  readonly createProfileId?: () => string;
  readonly todayLocalDate?: () => string;
  readonly createUsageCommandId?: () => string;
}

type UsageProps = NonNullable<ModelSettingsPanelProps["usage"]>;

export interface SettingsBridge {
  getProps(): ModelSettingsPanelProps;
  load(): Promise<ModelSettingsPanelProps>;
  loadPlugins(): Promise<ModelSettingsPanelProps>;
  loadAgentUsage(): Promise<ModelSettingsPanelProps>;
  setAgentUsageRange(preset: UsageProps["rangePreset"]): Promise<ModelSettingsPanelProps>;
  setAgentUsageFilters(filters: Partial<UsageProps["filters"]>): Promise<ModelSettingsPanelProps>;
  selectAgentUsageDay(localDate: string): Promise<ModelSettingsPanelProps>;
  clearAgentUsage(): Promise<ModelSettingsPanelProps>;
  setPluginEnabled(pluginId: string, enabled: boolean): Promise<ModelSettingsPanelProps>;
  selectSection(section: SettingsPanelSection): ModelSettingsPanelProps;
  selectProfile(profileId: string): ModelSettingsPanelProps;
  discoverModelOptions(profileId: string): Promise<ModelSettingsPanelProps>;
  updateDraft(draft: Partial<ModelSettingsDraft>): ModelSettingsPanelProps;
  newProfile(): ModelSettingsPanelProps;
  beginSave(): ModelSettingsPanelProps;
  saveDraft(options?: { readonly makeDefault?: boolean }): Promise<ModelSettingsPanelProps>;
  makeDefault(profileId: string): Promise<ModelSettingsPanelProps>;
  beginTestConnection(profileId: string): ModelSettingsPanelProps;
  testConnection(profileId: string): Promise<ModelSettingsPanelProps>;
  /** Phase D — load current network settings into the panel. */
  loadNetworkSettings(): Promise<ModelSettingsPanelProps>;
  /** Phase D — update network settings and immediately revoke old runtime capabilities. */
  updateNetworkSettings(
    partial: Partial<AgentNetworkSettingsData>
  ): Promise<ModelSettingsPanelProps>;
  /** Phase D — test a specific provider connection. */
  testNetworkConnection(profileId: string): Promise<ModelSettingsPanelProps>;
  saveNetworkProvider(
    profile: Omit<AgentNetworkProviderProfile, "policyRevision">,
    secret?: string
  ): Promise<ModelSettingsPanelProps>;
  removeNetworkProvider(profileId: string): Promise<ModelSettingsPanelProps>;
  setDefaultNetworkProvider(profileId: string): Promise<ModelSettingsPanelProps>;
  /** Phase D — revoke all network access. */
  revokeNetworkAccess(): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — load MCP server list. */
  loadMcpServers(): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — add a new MCP server. */
  addMcpServer(config: McpServerConfig, secret?: string): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — remove an MCP server. */
  removeMcpServer(serverId: string): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — enable or disable an MCP server. */
  setMcpServerEnabled(serverId: string, enabled: boolean): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — test a remote MCP server connection. */
  testMcpConnection(serverId: string): Promise<ModelSettingsPanelProps>;
  /** Phase E.4 — revoke a specific MCP server. */
  revokeMcpServer(serverId: string): Promise<ModelSettingsPanelProps>;
}

export function createSettingsBridge(
  api: NovelStudioApi,
  options: SettingsBridgeOptions = {}
): SettingsBridge {
  const createProfileId = options.createProfileId ?? (() => `model_${Date.now().toString(36)}`);
  const todayLocalDate = options.todayLocalDate ?? localDateToday;
  let usageCommandSequence = 0;
  const createUsageCommandId =
    options.createUsageCommandId ??
    (() => {
      usageCommandSequence += 1;
      return `clear_usage_${Date.now().toString(36)}_${usageCommandSequence.toString(36)}`;
    });
  let defaultProfileId = "";
  let profiles: readonly ModelProfile[] = [];
  let selectedProfileId: string | undefined;
  let draft: ModelSettingsDraft = newDraft(createProfileId());
  let saveStatus: ModelSettingsPanelProps["saveStatus"] = "idle";
  let connectionStatus: ModelSettingsPanelProps["connectionStatus"] | undefined;
  let modelDiscovery: ModelDiscoverySnapshot | undefined;
  let modelDiscoveryProfile: ModelProfile | undefined;
  let modelDiscoveryRequestGeneration = 0;
  let activeSection: SettingsPanelSection = "models";
  let plugins: PluginSettingsPanelProps = {
    status: "idle",
    entries: [],
    feedback: { kind: "info", message: "插件注册表尚未加载。" }
  };
  let feedback: ModelSettingsPanelProps["feedback"] | undefined;
  let usage: UsageProps = {
    status: "idle",
    rangePreset: "7d",
    filters: { provider: "", model: "", projectId: "" }
  };
  let usageGeneration = 0;
  let usageQueryPending = false;
  let clearInFlight: Promise<ModelSettingsPanelProps> | undefined;

  // Phase D — network settings state
  let networkSettings: AgentNetworkSettingsData = {
    enabled: false,
    providerProfiles: [],
    defaultProviderId: "",
    allowedHosts: [],
    dataEgressPolicy: "require_confirmation",
    policyRevision: "v1.0-default"
  };
  let networkLoading = false;
  type NetworkTestStatus = "idle" | "testing" | "ok" | "error";
  let networkTestStatuses: Record<string, NetworkTestStatus> = {};

  // Phase E.4 — MCP server state
  let mcpServers: readonly McpServerConfig[] = [];
  let mcpLoading = false;
  let mcpTestStatuses: Record<string, NetworkTestStatus> = {};

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
      const selected = profiles.find((profile) => profile.id === defaultProfileId);
      selectedProfileId = selected?.id;
      draft = selected === undefined ? newDraft(createProfileId()) : draftFromProfile(selected);
      modelDiscovery = undefined;
      modelDiscoveryProfile = undefined;
      if (selected !== undefined) {
        await discoverModels(selected.id);
      }
      saveStatus = "idle";
      feedback =
        selected === undefined && profiles.length > 0
          ? {
              kind: "error",
              message: "默认模型配置不存在。请明确选择一个模型并将其设为默认模型。"
            }
          : { kind: "info", message: "模型配置已加载。" };
      return toProps();
    },
    async loadPlugins() {
      await loadPlugins();
      return toProps();
    },
    async loadAgentUsage() {
      return loadUsage();
    },
    async setAgentUsageRange(preset) {
      usage = { ...usage, rangePreset: preset };
      return loadUsage();
    },
    async setAgentUsageFilters(filters) {
      usage = { ...usage, filters: { ...usage.filters, ...filters } };
      return loadUsage();
    },
    async selectAgentUsageDay(localDate) {
      return loadUsage(localDate);
    },
    clearAgentUsage() {
      if (clearInFlight !== undefined) return clearInFlight;
      const pending = clearUsage();
      clearInFlight = pending;
      void pending.finally(() => {
        if (clearInFlight === pending) clearInFlight = undefined;
      });
      return pending;
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
    selectSection(section) {
      activeSection = section;
      return toProps();
    },
    selectProfile(profileId) {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (profile === undefined) {
        feedback = { kind: "error", message: "没有找到这个模型配置。" };
        return toProps();
      }

      modelDiscoveryRequestGeneration += 1;
      selectedProfileId = profile.id;
      draft = draftFromProfile(profile);
      modelDiscovery = undefined;
      modelDiscoveryProfile = undefined;
      saveStatus = "idle";
      feedback = undefined;
      return toProps();
    },
    async discoverModelOptions(profileId) {
      await discoverModels(profileId, true);
      return toProps();
    },
    updateDraft(nextDraft) {
      modelDiscoveryRequestGeneration += 1;
      const next = { ...draft, ...nextDraft };
      const apiKeyChanged =
        nextDraft.apiKeyRefInput !== undefined &&
        nextDraft.apiKeyRefInput.trim() !== draft.apiKeyRefInput.trim();
      const discoveryInvalidated =
        modelDiscovery !== undefined &&
        (modelDiscoveryProfile === undefined ||
          apiKeyChanged ||
          !isModelDiscoveryDraft(next, modelDiscoveryProfile));
      draft = next;
      if (discoveryInvalidated) {
        modelDiscovery = undefined;
        modelDiscoveryProfile = undefined;
      }
      saveStatus = "idle";
      feedback = undefined;
      return toProps();
    },
    newProfile() {
      modelDiscoveryRequestGeneration += 1;
      selectedProfileId = undefined;
      draft = newDraft(createProfileId());
      modelDiscovery = undefined;
      modelDiscoveryProfile = undefined;
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
      const actionProfile = profileForAction(profileId);
      if (actionProfile === undefined) {
        const message = "模型配置字段格式不正确，请检查模型 ID、数字和 API Key。";
        connectionStatus = { profileId, status: "failed", detail: message };
        feedback = { kind: "error", message };
        return toProps();
      }
      if (actionProfile.usesDraft) {
        const secretSaved = await saveDraftSecret(actionProfile.profile, draft);
        if (!secretSaved.ok) {
          const message = redactSettingsDetail(secretSaved.error.message);
          connectionStatus = { profileId, status: "failed", detail: message };
          feedback = { kind: "error", message };
          return toProps();
        }
      }

      const result = await api.settings.testModelProfileConnection(
        profileId,
        actionProfile.profile
      );
      if (!result.ok) {
        const message = redactSettingsDetail(result.error.message);
        connectionStatus = {
          profileId,
          status: "failed",
          detail: message
        };
        feedback = { kind: "error", message };
        return toProps();
      }

      const detail = redactSettingsDetail(result.value.detail);
      connectionStatus = {
        profileId,
        status: result.value.ok ? "success" : "failed",
        detail
      };
      feedback = {
        kind: result.value.ok ? "info" : "error",
        message: detail
      };
      return toProps();
    },

    // ── Phase D: Network settings ──────────────────────────────────────────────

    async loadNetworkSettings() {
      networkLoading = true;
      const result = await api.agentNetwork.getSettings();
      networkLoading = false;
      if (result.ok) {
        networkSettings = result.value;
      }
      return toProps();
    },

    async updateNetworkSettings(partial) {
      networkLoading = true;
      const result = await api.agentNetwork.updateSettings(partial);
      networkLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      networkSettings = result.value;
      networkTestStatuses = {};
      return toProps();
    },

    async testNetworkConnection(profileId) {
      networkTestStatuses = { ...networkTestStatuses, [profileId]: "testing" };
      const r = await api.agentNetwork.testConnection(profileId);
      networkTestStatuses = {
        ...networkTestStatuses,
        [profileId]: r.ok ? "ok" : "error"
      };
      if (!r.ok) throw new Error(r.error.message);
      return toProps();
    },

    async saveNetworkProvider(profile, secret) {
      networkLoading = true;
      const result = await api.agentNetwork.saveProvider(profile);
      if (!result.ok) {
        networkLoading = false;
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      networkSettings = result.value;
      if (secret !== undefined && secret.trim().length > 0) {
        const savedSecret = await api.settings.saveModelSecret(profile.apiKeyRef, secret.trim());
        if (!savedSecret.ok) {
          networkLoading = false;
          feedback = { kind: "error", message: savedSecret.error.message };
          throw new Error(savedSecret.error.message);
        }
      }
      networkLoading = false;
      networkTestStatuses = {};
      return toProps();
    },

    async removeNetworkProvider(profileId) {
      networkLoading = true;
      const result = await api.agentNetwork.removeProvider(profileId);
      networkLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      networkSettings = result.value;
      networkTestStatuses = omitKey(networkTestStatuses, profileId);
      return toProps();
    },

    async setDefaultNetworkProvider(profileId) {
      networkLoading = true;
      const result = await api.agentNetwork.setDefaultProvider(profileId);
      networkLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      networkSettings = result.value;
      return toProps();
    },

    async revokeNetworkAccess() {
      networkLoading = true;
      const result = await api.agentNetwork.revoke();
      networkLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      networkSettings = result.value;
      networkTestStatuses = {};
      return toProps();
    },

    // ── Phase E.4: MCP source management ──────────────────────────────────────

    async loadMcpServers() {
      mcpLoading = true;
      const result = await api.agentMcp.listServers();
      mcpLoading = false;
      if (result.ok) {
        mcpServers = result.value;
      }
      return toProps();
    },

    async addMcpServer(config, secret) {
      mcpLoading = true;
      if (config.transport === "remote_http" && secret !== undefined && secret.trim().length > 0) {
        const savedSecret = await api.settings.saveModelSecret(config.apiKeyRef, secret.trim());
        if (!savedSecret.ok) {
          mcpLoading = false;
          feedback = { kind: "error", message: savedSecret.error.message };
          throw new Error(savedSecret.error.message);
        }
      }
      const result = await api.agentMcp.addServer(config);
      mcpLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      mcpServers = result.value.servers;
      return toProps();
    },

    async removeMcpServer(serverId) {
      mcpLoading = true;
      const result = await api.agentMcp.removeServer(serverId);
      mcpLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      mcpServers = result.value.servers;
      mcpTestStatuses = omitKey(mcpTestStatuses, serverId);
      return toProps();
    },

    async setMcpServerEnabled(serverId, enabled) {
      mcpLoading = true;
      const existing = mcpServers.find((s) => s.serverId === serverId);
      if (existing !== undefined) {
        const updated = { ...existing, enabled };
        const result = await api.agentMcp.addServer(updated);
        if (!result.ok) {
          mcpLoading = false;
          feedback = { kind: "error", message: result.error.message };
          throw new Error(result.error.message);
        }
        mcpServers = result.value.servers;
        mcpTestStatuses = omitKey(mcpTestStatuses, serverId);
      }
      mcpLoading = false;
      return toProps();
    },

    async testMcpConnection(serverId) {
      mcpTestStatuses = { ...mcpTestStatuses, [serverId]: "testing" };
      const r = await api.agentMcp.testConnection(serverId);
      mcpTestStatuses = {
        ...mcpTestStatuses,
        [serverId]: r.ok ? "ok" : "error"
      };
      if (!r.ok) throw new Error(r.error.message);
      return toProps();
    },

    async revokeMcpServer(serverId) {
      mcpLoading = true;
      const result = await api.agentMcp.revokeServer(serverId);
      mcpLoading = false;
      if (!result.ok) {
        feedback = { kind: "error", message: result.error.message };
        throw new Error(result.error.message);
      }
      mcpServers = result.value.servers;
      mcpTestStatuses = omitKey(mcpTestStatuses, serverId);
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
    modelDiscoveryRequestGeneration += 1;
    saveStatus = "saving";
    const profile = profileFromDraft(draft);
    if (profile === undefined) {
      saveStatus = "error";
      feedback = { kind: "error", message: "模型配置字段格式不正确，请检查数字和密钥引用。" };
      return toProps();
    }

    const secretSaved = await saveDraftSecret(profile, draft);
    if (!secretSaved.ok) {
      saveStatus = "error";
      feedback = { kind: "error", message: secretSaved.error.message };
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
    await discoverModels(profile.id);
    saveStatus = "saved";
    feedback = { kind: "info", message: "模型配置已保存。" };
    return toProps();
  }

  function profileFromDraft(nextDraft: ModelSettingsDraft): ModelProfile | undefined {
    const temperature = parseNumber(nextDraft.temperature);
    const maxTokens =
      nextDraft.maxTokens.trim().length === 0
        ? undefined
        : parsePositiveInteger(nextDraft.maxTokens);
    const contextWindow =
      nextDraft.contextWindow.trim().length === 0
        ? undefined
        : parsePositiveInteger(nextDraft.contextWindow);
    const topP = nextDraft.topP.trim().length === 0 ? undefined : parseNumber(nextDraft.topP);
    const timeoutMs = parseInteger(nextDraft.timeoutMs);
    if (
      temperature === undefined ||
      (nextDraft.maxTokens.trim().length > 0 && maxTokens === undefined) ||
      timeoutMs === undefined ||
      (nextDraft.contextWindow.trim().length > 0 && contextWindow === undefined) ||
      (nextDraft.topP.trim().length > 0 && topP === undefined)
    ) {
      return undefined;
    }

    const existingProfile = profiles.find((entry) => entry.id === nextDraft.id.trim());
    const apiKeyRef = apiKeyRefFromDraft(nextDraft, existingProfile?.apiKeyRef);
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
      timeoutMs,
      ...(maxTokens === undefined ? {} : { maxTokens })
    };

    return {
      ...baseProfile,
      ...(nextDraft.baseUrl.trim().length === 0 ? {} : { baseUrl: nextDraft.baseUrl.trim() }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(topP === undefined ? {} : { topP }),
      ...(nextDraft.reasoningEffortEnabled ? { reasoningEffortEnabled: true } : {})
    };
  }

  async function saveDraftSecret(profile: ModelProfile, nextDraft: ModelSettingsDraft) {
    const secretInput = nextDraft.apiKeyRefInput.trim();
    if (secretInput.length === 0 || secretInput.startsWith("secret://")) {
      return { ok: true as const, value: undefined };
    }

    return api.settings.saveModelSecret(profile.apiKeyRef, secretInput);
  }

  function toProps(): ModelSettingsPanelProps {
    const networkProps: AgentNetworkSettingsPanelProps = {
      settings: networkSettings,
      loading: networkLoading,
      onUpdateSettings: () => Promise.resolve(),
      onTestConnection: () => Promise.resolve({ latencyMs: 0 }),
      onSaveProvider: () => Promise.resolve(),
      onRemoveProvider: () => Promise.resolve(),
      onSetDefaultProvider: () => Promise.resolve(),
      onRevoke: () => Promise.resolve()
    };

    const toolSourceEntries: AgentToolSourceEntry[] = mcpServers
      .filter(
        (config): config is Extract<McpServerConfig, { readonly transport: "remote_http" }> =>
          config.transport === "remote_http"
      )
      .map((config) => {
        const testStatus = mcpTestStatuses[config.serverId];
        return {
          config,
          ...(testStatus !== undefined ? { connectionStatus: testStatus } : {})
        };
      });

    const toolSourcesProps: AgentToolSourcePanelProps = {
      servers: toolSourceEntries,
      loading: mcpLoading,
      onAddServer: () => Promise.resolve(),
      onRemoveServer: () => Promise.resolve(),
      onSetEnabled: () => Promise.resolve(),
      onTestConnection: () => Promise.resolve({ latencyMs: 0 }),
      onRevokeServer: () => Promise.resolve()
    };

    return {
      defaultProfileId,
      activeSection,
      ...(selectedProfileId === undefined ? {} : { selectedProfileId }),
      profiles,
      draft,
      saveStatus,
      ...(connectionStatus === undefined ? {} : { connectionStatus }),
      providerOptions: MODEL_PROVIDER_CATALOG.map((provider) => ({
        id: provider.id,
        label: provider.label,
        defaultModelName: provider.defaultModelName,
        ...(provider.defaultBaseUrl === undefined
          ? {}
          : { defaultBaseUrl: provider.defaultBaseUrl }),
        agentAdapter: provider.agentAdapter,
        agentSupport: provider.agentSupport,
        agentSupportNote: provider.agentSupportNote
      })),
      ...(modelDiscovery === undefined ? {} : { modelDiscovery }),
      plugins: {
        ...plugins,
        onRefresh: () => undefined,
        onSetEnabled: () => undefined
      },
      usage: {
        ...usage,
        onRangePresetChange: () => undefined,
        onFiltersChange: () => undefined,
        onSelectDay: () => undefined,
        onClear: () => undefined
      },
      network: networkProps,
      toolSources: toolSourcesProps,
      ...(feedback === undefined ? {} : { feedback }),
      onSelectProfile: () => undefined,
      onDraftChange: () => undefined,
      onNewProfile: () => undefined,
      onSaveProfile: () => undefined,
      onTestConnection: () => undefined,
      onMakeDefault: () => undefined,
      onDiscoverModelOptions: () => undefined,
      onSectionSelect: () => undefined
    };
  }

  async function discoverModels(profileId: string, forceRefresh = false): Promise<void> {
    const requestGeneration = ++modelDiscoveryRequestGeneration;
    const actionProfile = profileForAction(profileId);
    if (actionProfile === undefined) {
      modelDiscovery = undefined;
      modelDiscoveryProfile = undefined;
      feedback = {
        kind: "error",
        message: "模型配置字段格式不正确，请检查模型 ID、数字和 API Key。"
      };
      return;
    }
    const { profile } = actionProfile;
    const requestApiKeyInput = actionProfile.usesDraft ? draft.apiKeyRefInput.trim() : undefined;
    modelDiscovery = undefined;
    modelDiscoveryProfile = undefined;
    feedback = { kind: "info", message: "正在获取模型列表..." };
    if (actionProfile.usesDraft) {
      const secretSaved = await saveDraftSecret(profile, draft);
      if (!secretSaved.ok) {
        modelDiscovery = undefined;
        modelDiscoveryProfile = undefined;
        feedback = { kind: "error", message: redactSettingsDetail(secretSaved.error.message) };
        return;
      }
    }

    const result = await api.settings.discoverModelOptions(
      profileId,
      forceRefresh ? { forceRefresh: true } : undefined,
      profile
    );
    if (
      requestGeneration !== modelDiscoveryRequestGeneration ||
      !isModelDiscoveryActionCurrent(profile, actionProfile.usesDraft, requestApiKeyInput)
    ) {
      return;
    }
    if (!result.ok) {
      modelDiscovery = undefined;
      modelDiscoveryProfile = undefined;
      feedback = { kind: "error", message: result.error.message };
      return;
    }

    modelDiscovery =
      result.value.profileId === profileId && result.value.provider === profile.provider
        ? result.value
        : undefined;
    modelDiscoveryProfile = modelDiscovery === undefined ? undefined : profile;
    if (modelDiscovery === undefined) {
      feedback = { kind: "error", message: "模型列表与当前配置不匹配，请重新获取。" };
    } else if (modelDiscovery.status === "loaded") {
      feedback = {
        kind: "info",
        message: `已获取 ${modelDiscovery.models.length} 个模型。`
      };
    } else {
      feedback = { kind: "info", message: "无法自动获取模型列表，可继续手动填写模型名称。" };
    }
  }

  function profileForAction(
    profileId: string
  ): { readonly profile: ModelProfile; readonly usesDraft: boolean } | undefined {
    if (draft.id.trim() === profileId) {
      const profile = profileFromDraft(draft);
      return profile === undefined ? undefined : { profile, usesDraft: true };
    }
    const profile = profiles.find((entry) => entry.id === profileId);
    return profile === undefined ? undefined : { profile, usesDraft: false };
  }

  function isModelDiscoveryActionCurrent(
    profile: ModelProfile,
    usesDraft: boolean,
    requestApiKeyInput: string | undefined
  ): boolean {
    if (!usesDraft) {
      return profiles.some((entry) => sameModelDiscoveryProfile(entry, profile));
    }
    return (
      draft.apiKeyRefInput.trim() === requestApiKeyInput && isModelDiscoveryDraft(draft, profile)
    );
  }

  async function loadUsage(detailLocalDate?: string): Promise<ModelSettingsPanelProps> {
    const generation = ++usageGeneration;
    usageQueryPending = true;
    const rangePreset = usage.rangePreset;
    const filters = usage.filters;
    usage = {
      status: "loading",
      rangePreset,
      filters,
      feedback: { kind: "info", message: "正在读取 Agent 用量..." }
    };
    const range = rangeForPreset(rangePreset, todayLocalDate());
    // Keep the request list bounded to one day while making cache details visible on first load.
    const effectiveDetailLocalDate = detailLocalDate ?? range.toLocalDate;
    const query: AgentUsageQuery = {
      range,
      ...(filters.provider.trim() === "" ? {} : { provider: filters.provider.trim() }),
      ...(filters.model.trim() === "" ? {} : { model: filters.model.trim() }),
      ...(filters.projectId.trim() === "" ? {} : { projectId: filters.projectId.trim() }),
      ...(effectiveDetailLocalDate === undefined
        ? {}
        : { detailLocalDate: effectiveDetailLocalDate }),
      includeModelBreakdown: true
    };
    const result = await api.settings.listAgentUsage(query);
    if (generation !== usageGeneration) return toProps();
    usageQueryPending = false;
    usage = result.ok
      ? { ...usage, status: "loaded", report: result.value, feedback: undefined }
      : { ...usage, status: "error", feedback: { kind: "error", message: result.error.message } };
    return toProps();
  }

  async function clearUsage(): Promise<ModelSettingsPanelProps> {
    if (usageQueryPending) {
      usage = {
        ...usage,
        feedback: { kind: "error", message: "请等待当前 Agent 用量查询完成后再清除。" }
      };
      return toProps();
    }
    const range = usage.report?.query.range;
    if (range === undefined) {
      usage = {
        ...usage,
        status: "error",
        feedback: { kind: "error", message: "请先加载 Agent 用量。" }
      };
      return toProps();
    }
    const generation = ++usageGeneration;
    usage = {
      ...usage,
      status: "loading",
      feedback: { kind: "info", message: "正在清除所选范围用量..." }
    };
    const result = await api.settings.clearAgentUsage({
      commandId: createUsageCommandId(),
      range
    });
    if (generation !== usageGeneration) return toProps();
    usage = result.ok
      ? {
          status: "loaded",
          rangePreset: presetForRange(result.value.query.range) ?? usage.rangePreset,
          filters: { provider: "", model: "", projectId: "" },
          report: result.value,
          feedback: { kind: "info", message: "所选范围用量已清除。" }
        }
      : { ...usage, status: "error", feedback: { kind: "error", message: result.error.message } };
    return toProps();
  }
}

function rangeForPreset(preset: UsageProps["rangePreset"], today: string) {
  const days = preset === "today" ? 1 : preset === "7d" ? 7 : 30;
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return { fromLocalDate: date.toISOString().slice(0, 10), toLocalDate: today };
}

function presetForRange(range: AgentUsageQuery["range"]): UsageProps["rangePreset"] | undefined {
  const from = Date.parse(`${range.fromLocalDate}T00:00:00.000Z`);
  const to = Date.parse(`${range.toLocalDate}T00:00:00.000Z`);
  const days = Math.floor((to - from) / 86_400_000) + 1;
  return days === 1 ? "today" : days === 7 ? "7d" : days === 30 ? "30d" : undefined;
}

function localDateToday(): string {
  const current = new Date();
  return `${current.getFullYear().toString().padStart(4, "0")}-${(current.getMonth() + 1).toString().padStart(2, "0")}-${current.getDate().toString().padStart(2, "0")}`;
}

function toPluginProps(
  snapshot: PluginSettingsSnapshot,
  message: string
): PluginSettingsPanelProps {
  const securityByPluginId = new Map(
    createPluginSecurityAuditReport({ snapshot }).plugins.map((entry) => [entry.pluginId, entry])
  );

  return {
    status: "loaded",
    entries: snapshot.plugins.map((plugin) => ({
      pluginId: plugin.pluginId,
      enabled: plugin.enabled,
      manifestPath: plugin.manifestPath,
      grantedPermissions: plugin.grantedPermissions,
      manifestStatus: plugin.manifestStatus,
      ...securityProps(securityByPluginId.get(plugin.pluginId)),
      ...(plugin.manifest === undefined ? {} : { manifest: plugin.manifest }),
      ...(plugin.manifestError === undefined ? {} : { manifestError: plugin.manifestError })
    })),
    feedback: { kind: "info", message }
  };
}

function securityProps(
  security: PluginSecurityAuditEntry | undefined
): Pick<PluginSettingsPanelProps["entries"][number], "security"> | Record<string, never> {
  if (security === undefined) {
    return {};
  }

  return {
    security: {
      trustState: security.trustState,
      signing: security.signing,
      readiness: security.readiness,
      executable: security.executable,
      deniedCapabilities: security.deniedCapabilities,
      requestedPermissions: security.requestedPermissions,
      grantedPermissions: security.grantedPermissions,
      auditEvents: security.auditEvents
    }
  };
}

function draftFromProfile(profile: ModelProfile): ModelSettingsDraft {
  return {
    id: profile.id,
    provider: profile.provider,
    displayName: profile.displayName,
    baseUrl: profile.baseUrl ?? "",
    modelName: profile.modelName,
    contextWindow: profile.contextWindow === undefined ? "" : String(profile.contextWindow),
    apiKeyRefInput: "",
    temperature: String(profile.temperature),
    maxTokens: profile.maxTokens === undefined ? "" : String(profile.maxTokens),
    topP: profile.topP === undefined ? "" : String(profile.topP),
    reasoningEffortEnabled: profile.reasoningEffortEnabled === true,
    timeoutMs: String(profile.timeoutMs)
  };
}

function isModelDiscoveryDraft(draft: ModelSettingsDraft, profile: ModelProfile): boolean {
  const apiKeyInput = draft.apiKeyRefInput.trim();
  return (
    draft.id.trim() === profile.id &&
    draft.provider.trim() === profile.provider &&
    draft.baseUrl.trim() === (profile.baseUrl ?? "").trim() &&
    (!apiKeyInput.startsWith("secret://") || apiKeyInput === profile.apiKeyRef)
  );
}

function sameModelDiscoveryProfile(left: ModelProfile, right: ModelProfile): boolean {
  return (
    left.id === right.id &&
    left.provider === right.provider &&
    (left.baseUrl ?? "").trim() === (right.baseUrl ?? "").trim() &&
    left.apiKeyRef === right.apiKeyRef
  );
}

function newDraft(profileId: string): ModelSettingsDraft {
  return {
    id: profileId,
    provider: "openai-compatible",
    displayName: "新模型配置",
    baseUrl: "",
    modelName: "",
    contextWindow: "",
    apiKeyRefInput: "",
    temperature: "0.7",
    maxTokens: "",
    topP: "1",
    reasoningEffortEnabled: false,
    timeoutMs: "60000"
  };
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function apiKeyRefFromDraft(
  nextDraft: ModelSettingsDraft,
  existingApiKeyRef: string | undefined
): string | undefined {
  const input = nextDraft.apiKeyRefInput.trim();
  if (input.startsWith("secret://")) {
    return input;
  }
  if (input.length > 0) {
    return existingApiKeyRef ?? `secret://${nextDraft.id.trim()}/api_key`;
  }
  return existingApiKeyRef;
}

function parseInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = parseInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function redactSettingsDetail(detail: string): string {
  return detail
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted-secret]")
    .replace(/secret:\/\/[^\s"'<>]+/g, "[redacted-secret-ref]");
}

/** Returns a new object with `key` omitted — avoids dynamic delete. */
function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
}
