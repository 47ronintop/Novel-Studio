import {
  CheckCircle,
  Eye,
  FilePlus,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  Shield,
  Star
} from "lucide-react";
import { createContext, useContext, useState, type MouseEvent, type ReactNode } from "react";
import type { ModelDiscoverySnapshot } from "@novel-studio/application";
import type { EditorPreferences } from "./editor-toolbar.js";
import {
  SettingsPanelTabs,
  type SettingsPanelActiveSection,
  type SettingsPanelSection
} from "./settings-panel-tabs.js";

const SettingsSearchQueryContext = createContext("");

export interface ModelSettingsProfile {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly modelName: string;
  readonly apiKeyRef: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly topP?: number;
  readonly reasoningEffortEnabled?: boolean;
  readonly timeoutMs: number;
}

export type ModelConnectionStatusValue = "idle" | "testing" | "success" | "failed";
export type ModelSettingsSaveStatus = "idle" | "saving" | "saved" | "error";

export interface ModelSettingsDraft {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelName: string;
  readonly apiKeyRefInput: string;
  readonly temperature: string;
  readonly maxTokens: string;
  readonly topP: string;
  readonly reasoningEffortEnabled: boolean;
  readonly timeoutMs: string;
}

export interface ModelProviderOption {
  readonly id: string;
  readonly label: string;
}

export interface ModelConnectionStatus {
  readonly profileId: string;
  readonly status: ModelConnectionStatusValue;
  readonly detail?: string;
}

export type PluginSettingsStatus = "idle" | "loading" | "loaded" | "error";

export interface PluginSettingsPermissionGrant {
  readonly permission: string;
  readonly scopes: readonly string[];
}

export interface PluginSettingsEntry {
  readonly pluginId: string;
  readonly enabled: boolean;
  readonly manifestPath: string;
  readonly grantedPermissions: readonly PluginSettingsPermissionGrant[];
  readonly manifestStatus: "valid" | "missing" | "invalid";
  readonly security?: PluginSecuritySummary;
  readonly manifest?: {
    readonly displayName: string;
    readonly version: string;
    readonly entryKind: "local-process" | "webview" | "none";
    readonly compatibleAppVersion: {
      readonly min: string;
      readonly max?: string;
    };
    readonly capabilities: readonly {
      readonly type: "command" | "workflow-step" | "asset-view";
      readonly id: string;
      readonly title: string;
    }[];
    readonly requestedPermissions: readonly PluginSettingsPermissionGrant[];
    readonly contributes: {
      readonly commands: readonly {
        readonly id: string;
        readonly title: string;
      }[];
      readonly workflowSteps: readonly {
        readonly id: string;
        readonly title: string;
      }[];
    };
  };
  readonly manifestError?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface PluginSecuritySummary {
  readonly trustState: "trusted-local" | "signed" | "untrusted";
  readonly signing: "required" | "satisfied";
  readonly readiness: "blocked" | "ready";
  readonly executable: boolean;
  readonly deniedCapabilities: readonly string[];
  readonly requestedPermissions: readonly string[];
  readonly grantedPermissions: readonly string[];
  readonly auditEvents: readonly string[];
}

export interface PluginSettingsPanelProps {
  readonly status: PluginSettingsStatus;
  readonly entries: readonly PluginSettingsEntry[];
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string };
  readonly onRefresh?: () => void;
  readonly onSetEnabled?: (pluginId: string, enabled: boolean) => void;
}

export interface ModelSettingsAppearancePreferences {
  readonly theme: "dark" | "system";
  readonly density: "compact" | "comfortable";
  readonly editor?: {
    readonly fontFamily: "mono" | "serif" | "sans";
    readonly fontSize: number;
    readonly lineHeight: number;
  };
}

export interface ModelSettingsWritingPreferences {
  readonly autosaveEnabled: boolean;
  readonly historyPolicy: string;
  readonly styleRules: {
    readonly enabled: boolean;
    readonly strength: "light" | "standard" | "strict";
    readonly customCautionTerms: readonly string[];
  };
}

export interface ModelSettingsPanelProps {
  readonly activeSection?: SettingsPanelSection;
  readonly appearancePreferences?: ModelSettingsAppearancePreferences;
  readonly writingPreferences?: ModelSettingsWritingPreferences;
  readonly editorPreferences?: EditorPreferences;
  readonly defaultProfileId: string;
  readonly selectedProfileId?: string;
  readonly profiles: readonly ModelSettingsProfile[];
  readonly draft: ModelSettingsDraft;
  readonly saveStatus: ModelSettingsSaveStatus;
  readonly connectionStatus?: ModelConnectionStatus;
  readonly providerOptions?: readonly ModelProviderOption[];
  readonly modelDiscovery?: ModelDiscoverySnapshot;
  readonly plugins?: PluginSettingsPanelProps;
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string };
  readonly onSelectProfile?: (profileId: string) => void;
  readonly onDraftChange?: (draft: Partial<ModelSettingsDraft>) => void;
  readonly onNewProfile?: () => void;
  readonly onSaveProfile?: () => void;
  readonly onTestConnection?: (profileId: string) => void;
  readonly onMakeDefault?: (profileId: string) => void;
  readonly onDiscoverModelOptions?: (profileId: string) => void;
  readonly onEditorPreferencesChange?: (preferences: EditorPreferences) => void;
  readonly onSectionSelect?: (section: SettingsPanelSection) => void;
}

export function ModelSettingsPanel({
  activeSection,
  appearancePreferences,
  writingPreferences,
  editorPreferences,
  defaultProfileId,
  selectedProfileId,
  profiles,
  draft,
  saveStatus,
  connectionStatus,
  providerOptions,
  modelDiscovery,
  plugins,
  feedback,
  onSelectProfile,
  onDraftChange,
  onNewProfile,
  onSaveProfile,
  onTestConnection,
  onMakeDefault,
  onDiscoverModelOptions,
  onEditorPreferencesChange,
  onSectionSelect
}: ModelSettingsPanelProps) {
  const effectiveSection: SettingsPanelActiveSection = activeSection ?? "overview";
  const [settingsSearchQuery, setSettingsSearchQuery] = useState("");
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const resolvedEditorPreferences = editorPreferences ??
    appearancePreferences?.editor ?? {
      fontFamily: "mono" as const,
      fontSize: 13,
      lineHeight: 1.7
    };
  const canSave =
    saveStatus !== "saving" &&
    draft.id.trim().length > 0 &&
    draft.displayName.trim().length > 0 &&
    draft.modelName.trim().length > 0;

  return (
    <section className="model-settings-panel" aria-label="设置" data-settings-layout="vscode">
      <header className="model-settings-header">
        <div>
          <h1>设置</h1>
          <p>管理项目级模型配置、连接测试、自动保存策略和隐私边界。</p>
        </div>
        <button className="ns-icon-text-button" onClick={onNewProfile} type="button">
          <FilePlus aria-hidden="true" size={14} />
          新建模型
        </button>
      </header>

      <div className="model-settings-grid">
        <SettingsPanelTabs activeSection={effectiveSection} onSectionSelect={onSectionSelect} />

        <div className="model-settings-main">
          <label className="model-settings-search">
            <span>搜索设置</span>
            <input
              aria-label="搜索设置"
              className="ns-search-input"
              onChange={(event) => setSettingsSearchQuery(event.currentTarget.value)}
              placeholder="搜索设置"
              value={settingsSearchQuery}
            />
          </label>
          <SettingsSearchQueryContext.Provider value={settingsSearchQuery}>
            {effectiveSection === "overview" || effectiveSection === "models" ? (
              <ModelProfileSettingsSection
                canSave={canSave}
                connectionStatus={connectionStatus}
                defaultProfileId={defaultProfileId}
                draft={draft}
                feedback={feedback}
                modelDiscovery={modelDiscovery}
                onDraftChange={onDraftChange}
                onMakeDefault={onMakeDefault}
                onSaveProfile={onSaveProfile}
                onSelectProfile={onSelectProfile}
                onTestConnection={onTestConnection}
                onDiscoverModelOptions={onDiscoverModelOptions}
                profiles={profiles}
                providerOptions={providerOptions}
                saveStatus={saveStatus}
                selectedProfile={selectedProfile}
                selectedProfileId={selectedProfileId}
              />
            ) : null}

            {effectiveSection === "overview" ? <LegacyWritingSummarySection /> : null}

            {effectiveSection === "overview" || effectiveSection === "editor" ? (
              <EditorSettingsSection
                onPreferencesChange={onEditorPreferencesChange}
                preferences={resolvedEditorPreferences}
              />
            ) : null}

            {effectiveSection === "writing" ? (
              <WritingSettingsSection preferences={writingPreferences} />
            ) : null}

            {effectiveSection === "appearance" ? (
              <AppearanceSettingsSection preferences={appearancePreferences} />
            ) : null}

            {effectiveSection === "overview" || effectiveSection === "plugins" ? (
              <PluginSettingsSection plugins={plugins} />
            ) : null}

            {effectiveSection === "overview" || effectiveSection === "advanced" ? (
              <AdvancedSettingsSection />
            ) : null}
          </SettingsSearchQueryContext.Provider>
        </div>
      </div>
    </section>
  );
}

function ModelProfileSettingsSection({
  canSave,
  connectionStatus,
  defaultProfileId,
  draft,
  feedback,
  modelDiscovery,
  onDraftChange,
  onMakeDefault,
  onSaveProfile,
  onSelectProfile,
  onTestConnection,
  onDiscoverModelOptions,
  profiles,
  providerOptions,
  saveStatus,
  selectedProfile,
  selectedProfileId
}: {
  readonly canSave: boolean;
  readonly connectionStatus: ModelConnectionStatus | undefined;
  readonly defaultProfileId: string;
  readonly draft: ModelSettingsDraft;
  readonly feedback: ModelSettingsPanelProps["feedback"];
  readonly modelDiscovery: ModelDiscoverySnapshot | undefined;
  readonly onDraftChange: ModelSettingsPanelProps["onDraftChange"];
  readonly onMakeDefault: ModelSettingsPanelProps["onMakeDefault"];
  readonly onSaveProfile: ModelSettingsPanelProps["onSaveProfile"];
  readonly onSelectProfile: ModelSettingsPanelProps["onSelectProfile"];
  readonly onTestConnection: ModelSettingsPanelProps["onTestConnection"];
  readonly onDiscoverModelOptions: ModelSettingsPanelProps["onDiscoverModelOptions"];
  readonly profiles: readonly ModelSettingsProfile[];
  readonly providerOptions: readonly ModelProviderOption[] | undefined;
  readonly saveStatus: ModelSettingsSaveStatus;
  readonly selectedProfile: ModelSettingsProfile | undefined;
  readonly selectedProfileId: string | undefined;
}) {
  const activeProfileId = selectedProfileId ?? draft.id;
  const canRunProfileAction = activeProfileId.trim().length > 0;

  return (
    <section className="model-settings-section" aria-label="模型配置">
      <div className="model-settings-section-header">
        <div>
          <h2>模型配置</h2>
          <p>配置 OpenAI Compatible、OpenAI 或 Ollama profile。保存前仍由 Application 层校验。</p>
        </div>
        {feedback === undefined ? null : (
          <p className="ns-project-feedback" data-kind={feedback.kind} role="status">
            {feedback.message}
          </p>
        )}
      </div>

      <div className="model-profile-layout">
        <div className="model-profile-list" aria-label="模型 Profile 列表">
          {profiles.map((profile) => {
            const isDefault = profile.id === defaultProfileId;
            const isSelected = profile.id === selectedProfileId;
            const status =
              connectionStatus?.profileId === profile.id ? connectionStatus.status : "idle";
            return (
              <article className="model-profile-row" data-selected={isSelected} key={profile.id}>
                <button
                  aria-label={`编辑模型 ${profile.displayName}`}
                  className="model-profile-select"
                  onClick={() => onSelectProfile?.(profile.id)}
                  type="button"
                >
                  <span>{profile.displayName}</span>
                  <span>
                    {profile.provider} · {profile.modelName}
                  </span>
                  <span>已保存密钥引用</span>
                  <span>{profile.timeoutMs}ms 超时</span>
                </button>
                <div className="model-profile-actions">
                  {isDefault ? (
                    <span className="default-profile-badge">
                      <CheckCircle aria-hidden="true" size={14} /> 默认
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`设为默认模型 ${profile.displayName}`}
                      onClick={() => onMakeDefault?.(profile.id)}
                    >
                      <Star aria-hidden="true" size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`测试连接 ${profile.displayName}`}
                    onClick={() => onTestConnection?.(profile.id)}
                  >
                    <PlugZap aria-hidden="true" size={14} />
                  </button>
                  <span>{statusLabel(status)}</span>
                </div>
              </article>
            );
          })}
        </div>

        <form
          className="model-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSaveProfile?.();
          }}
        >
          <div className="model-profile-form-grid" data-field-layout="stacked">
            <ModelField label="Profile ID" note="当前模型配置在项目中的稳定标识。">
              <input
                aria-label="模型 Profile ID"
                aria-description="粘贴真实 API Key，保存后会加密存储；留空则沿用已保存 API Key。"
                className="ns-search-input"
                onChange={(event) => onDraftChange?.({ id: event.currentTarget.value })}
                value={draft.id}
              />
            </ModelField>
            <ModelField label="显示名称" note="显示在模型选择器和设置列表中的名称。">
              <input
                aria-label="模型显示名称"
                className="ns-search-input"
                onChange={(event) => onDraftChange?.({ displayName: event.currentTarget.value })}
                value={draft.displayName}
              />
            </ModelField>
            <ModelField label="Provider" note="选择请求适配器类型。">
              <select
                aria-label="模型 Provider"
                className="model-settings-select"
                onChange={(event) => onDraftChange?.({ provider: event.currentTarget.value })}
                value={draft.provider}
              >
                {(providerOptions ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </ModelField>
            <ModelField
              actions={
                <button
                  aria-label="获取模型列表"
                  className="model-settings-field-button"
                  disabled={!canRunProfileAction}
                  onClick={() => onDiscoverModelOptions?.(activeProfileId)}
                  type="button"
                >
                  <RefreshCw aria-hidden="true" size={13} />
                  获取模型列表
                </button>
              }
              label="模型名称"
              note="写入请求体的模型 ID；模型发现失败时可手动填写。"
            >
              {modelDiscovery?.status === "loaded" && modelDiscovery.models.length > 0 ? (
                <select
                  aria-label="Discovered model name"
                  className="model-settings-select"
                  onChange={(event) => onDraftChange?.({ modelName: event.currentTarget.value })}
                  value={draft.modelName}
                >
                  {modelDiscovery.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    aria-label="模型名称"
                    className="ns-search-input"
                    onChange={(event) => onDraftChange?.({ modelName: event.currentTarget.value })}
                    value={draft.modelName}
                  />
                  {modelDiscovery?.status === "fallback" ? (
                    <small className="model-discovery-fallback">
                      {modelDiscovery.fallbackReason}
                    </small>
                  ) : null}
                </>
              )}
            </ModelField>
            <ModelField
              actions={
                <>
                  <label className="model-settings-switch">
                    <input aria-label="完整 URL" defaultChecked type="checkbox" />
                    <span>完整 URL</span>
                  </label>
                  <button
                    aria-label="管理与测速"
                    className="model-settings-link-button"
                    disabled={!canRunProfileAction}
                    onClick={() => onTestConnection?.(activeProfileId)}
                    type="button"
                  >
                    管理与测速
                  </button>
                </>
              }
              label="API 请求地址"
              note="请填写兼容 OpenAI 格式的服务端点地址，例如 https://api.example.com/v1。"
            >
              <input
                aria-label="模型 Base URL"
                className="ns-search-input"
                onChange={(event) => onDraftChange?.({ baseUrl: event.currentTarget.value })}
                value={draft.baseUrl}
              />
            </ModelField>
            <ModelField
              label="API Key"
              note="真实密钥只会写入桌面端安全存储；留空会沿用已保存密钥。"
            >
              <div className="model-settings-input-with-action">
                <input
                  aria-label="密钥引用"
                  className="ns-search-input"
                  onChange={(event) =>
                    onDraftChange?.({ apiKeyRefInput: event.currentTarget.value })
                  }
                  placeholder={
                    selectedProfile === undefined
                      ? "粘贴真实 API Key，保存后会加密存储"
                      : "留空则沿用已保存密钥引用"
                  }
                  type="password"
                  value={draft.apiKeyRefInput}
                />
                <button
                  aria-label="显示或隐藏 API Key"
                  className="model-settings-input-action"
                  onClick={toggleApiKeyVisibility}
                  type="button"
                >
                  <Eye aria-hidden="true" size={14} />
                </button>
              </div>
            </ModelField>
            <ModelField label="Temperature" note="控制生成结果的随机性。">
              <input
                aria-label="Temperature"
                className="ns-search-input"
                inputMode="decimal"
                onChange={(event) => onDraftChange?.({ temperature: event.currentTarget.value })}
                value={draft.temperature}
              />
            </ModelField>
            <ModelField label="Max Tokens" note="限制单次响应可生成的最大 token 数。">
              <input
                aria-label="Max Tokens"
                className="ns-search-input"
                inputMode="numeric"
                onChange={(event) => onDraftChange?.({ maxTokens: event.currentTarget.value })}
                value={draft.maxTokens}
              />
            </ModelField>
            <ModelField label="Top P" note="控制 nucleus sampling 的采样范围。">
              <input
                aria-label="Top P"
                className="ns-search-input"
                inputMode="decimal"
                onChange={(event) => onDraftChange?.({ topP: event.currentTarget.value })}
                value={draft.topP}
              />
            </ModelField>
            <ModelField label="推理强度" note="声明该端点是否支持 reasoning_effort 参数。">
              <label className="model-settings-checkbox">
                <input
                  aria-label="确认该端点支持 reasoning_effort"
                  checked={draft.reasoningEffortEnabled}
                  onChange={(event) =>
                    onDraftChange?.({ reasoningEffortEnabled: event.currentTarget.checked })
                  }
                  type="checkbox"
                />
                <span>该第三方端点支持 reasoning_effort</span>
              </label>
            </ModelField>
            <ModelField label="Timeout" note="请求超时时间，单位毫秒。">
              <input
                aria-label="Timeout"
                className="ns-search-input"
                inputMode="numeric"
                onChange={(event) => onDraftChange?.({ timeoutMs: event.currentTarget.value })}
                value={draft.timeoutMs}
              />
            </ModelField>
          </div>
          <div className="model-profile-form-actions">
            <button className="ns-icon-text-button" disabled={!canSave} type="submit">
              <Save aria-hidden="true" size={14} />
              {saveStatus === "saving" ? "保存中" : "保存模型配置"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function LegacyWritingSummarySection() {
  return (
    <section className="model-settings-section" aria-label="自动保存与历史">
      <h2>自动保存与历史</h2>
      <p>
        当前版本沿用项目 settings.json 中的 autosave/history
        策略。后续可在这里补齐间隔、快照策略和恢复草稿提示。
      </p>
    </section>
  );
}

function WritingSettingsSection({
  preferences
}: {
  readonly preferences: ModelSettingsWritingPreferences | undefined;
}) {
  const resolved = preferences ?? {
    autosaveEnabled: false,
    historyPolicy: "manual",
    styleRules: {
      enabled: false,
      strength: "standard" as const,
      customCautionTerms: []
    }
  };

  return (
    <section className="model-settings-section" aria-label="写作设置">
      <div className="model-settings-section-header">
        <div>
          <h2>写作设置</h2>
          <p>调整默认保存行为、历史策略和项目级文风规则。</p>
        </div>
      </div>
      <dl className="settings-summary-grid">
        <div>
          <dt>自动保存</dt>
          <dd>{resolved.autosaveEnabled ? "自动保存已启用" : "自动保存未启用"}</dd>
        </div>
        <div>
          <dt>历史策略</dt>
          <dd>{resolved.historyPolicy}</dd>
        </div>
        <div>
          <dt>写作质量</dt>
          <dd>
            {resolved.styleRules.enabled ? "文风规则已启用" : "文风规则未启用"} ·{" "}
            {resolved.styleRules.strength}
          </dd>
        </div>
        <div>
          <dt>项目语气</dt>
          <dd>
            {resolved.styleRules.customCautionTerms.length === 0
              ? "未配置慎用表达"
              : resolved.styleRules.customCautionTerms.join("、")}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function EditorSettingsSection({
  onPreferencesChange,
  preferences
}: {
  readonly onPreferencesChange: ((preferences: EditorPreferences) => void) | undefined;
  readonly preferences: EditorPreferences;
}) {
  return (
    <section className="model-settings-section" aria-label="编辑器设置">
      <div className="model-settings-section-header">
        <div>
          <h2>编辑器设置</h2>
          <p>调整章节编辑器的字体、字号和行高。</p>
        </div>
      </div>
      <div className="model-profile-form-grid" data-field-layout="stacked">
        <ModelField category="编辑器" label="字体" note="控制章节正文编辑器使用的字体族。">
          <select
            aria-label="编辑器字体"
            className="model-settings-select"
            onChange={(event) =>
              onPreferencesChange?.({
                ...preferences,
                fontFamily: event.currentTarget.value as EditorPreferences["fontFamily"]
              })
            }
            value={preferences.fontFamily}
          >
            <option value="mono">Mono</option>
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
          </select>
        </ModelField>
        <ModelField category="编辑器" label="字号" note="控制章节正文编辑区的基础字号。">
          <input
            aria-label="编辑器字号"
            className="ns-search-input"
            inputMode="numeric"
            min={11}
            max={22}
            onChange={(event) =>
              onPreferencesChange?.({
                ...preferences,
                fontSize: Number(event.currentTarget.value)
              })
            }
            type="number"
            value={preferences.fontSize}
          />
        </ModelField>
        <ModelField category="编辑器" label="行高" note="控制章节正文编辑区的行间距。">
          <select
            aria-label="编辑器行高"
            className="model-settings-select"
            onChange={(event) =>
              onPreferencesChange?.({
                ...preferences,
                lineHeight: Number(event.currentTarget.value)
              })
            }
            value={preferences.lineHeight}
          >
            <option value={1.5}>1.5</option>
            <option value={1.7}>1.7</option>
            <option value={1.8}>1.8</option>
            <option value={2}>2.0</option>
          </select>
        </ModelField>
      </div>
    </section>
  );
}

function AppearanceSettingsSection({
  preferences
}: {
  readonly preferences: ModelSettingsAppearancePreferences | undefined;
}) {
  const resolved = preferences ?? {
    theme: "dark" as const,
    density: "compact" as const
  };

  return (
    <section className="model-settings-section" aria-label="外观设置">
      <div className="model-settings-section-header">
        <div>
          <h2>外观设置</h2>
          <p>管理主题和界面密度。编辑器排版请在编辑器分类中调整。</p>
        </div>
      </div>
      <dl className="settings-summary-grid">
        <div>
          <dt>主题</dt>
          <dd>{themeLabel(resolved.theme)}</dd>
        </div>
        <div>
          <dt>密度</dt>
          <dd>{densityLabel(resolved.density)}</dd>
        </div>
      </dl>
    </section>
  );
}

function AdvancedSettingsSection() {
  return (
    <section className="model-settings-section" aria-label="隐私与安全">
      <h2>隐私与安全</h2>
      <div className="model-security-note">
        <Shield aria-hidden="true" size={16} />
        <p>
          API Key 不会以明文写入 settings.json，也不会显示在列表、错误或日志中。这里仅接受 secret://
          引用，真实密钥由桌面端安全存储能力管理。
        </p>
      </div>
    </section>
  );
}

function PluginSettingsSection({
  plugins
}: {
  readonly plugins: PluginSettingsPanelProps | undefined;
}) {
  const entries = plugins?.entries ?? [];

  return (
    <section className="model-settings-section" aria-label="插件管理">
      <div className="model-settings-section-header">
        <div>
          <h2>插件管理</h2>
          <p>查看当前项目插件注册表。这里不安装、不下载、不执行第三方插件代码。</p>
        </div>
        <button
          aria-label="刷新插件注册表"
          className="ns-icon-text-button"
          disabled={plugins?.status === "loading"}
          onClick={plugins?.onRefresh}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          {plugins?.status === "loading" ? "刷新中" : "刷新"}
        </button>
      </div>

      {plugins?.feedback === undefined ? null : (
        <p className="ns-project-feedback" data-kind={plugins.feedback.kind} role="status">
          {plugins.feedback.message}
        </p>
      )}

      {entries.length === 0 ? (
        <div className="plugin-settings-empty">当前项目还没有注册插件。</div>
      ) : (
        <ol className="plugin-settings-list" aria-label="插件注册表">
          {entries.map((plugin) => (
            <li className="plugin-settings-row" key={plugin.pluginId}>
              <div className="plugin-settings-title">
                <div>
                  <strong>{plugin.manifest?.displayName ?? plugin.pluginId}</strong>
                  <span>{plugin.pluginId}</span>
                </div>
                <span>{plugin.enabled ? "已启用" : "已禁用"}</span>
              </div>
              <div className="plugin-settings-meta">
                <span>Manifest: {plugin.manifestStatus}</span>
                <span>{plugin.manifestPath}</span>
                <span>Granted {permissionSummary(plugin.grantedPermissions)}</span>
                {plugin.manifest === undefined ? null : (
                  <>
                    <span>Version {plugin.manifest.version}</span>
                    <span>Entry {plugin.manifest.entryKind}</span>
                    <span>
                      App {plugin.manifest.compatibleAppVersion.min}
                      {plugin.manifest.compatibleAppVersion.max === undefined
                        ? "+"
                        : ` - ${plugin.manifest.compatibleAppVersion.max}`}
                    </span>
                  </>
                )}
                {plugin.manifestError === undefined ? null : (
                  <span>{`${plugin.manifestError.code}: ${plugin.manifestError.message}`}</span>
                )}
              </div>
              {plugin.manifest === undefined ? null : (
                <div className="plugin-settings-detail">
                  <span>Requested {permissionSummary(plugin.manifest.requestedPermissions)}</span>
                  <span>
                    Capabilities{" "}
                    {plugin.manifest.capabilities
                      .map((capability) => `${capability.id} (${capability.type})`)
                      .join(", ")}
                  </span>
                  <span>
                    Commands{" "}
                    {plugin.manifest.contributes.commands.length === 0
                      ? "none"
                      : plugin.manifest.contributes.commands
                          .map((command) => command.id)
                          .join(", ")}
                  </span>
                  <span>
                    Workflow steps{" "}
                    {plugin.manifest.contributes.workflowSteps.length === 0
                      ? "none"
                      : plugin.manifest.contributes.workflowSteps.map((step) => step.id).join(", ")}
                  </span>
                </div>
              )}
              {plugin.security === undefined ? null : (
                <div
                  className="plugin-settings-detail"
                  aria-label={`Plugin security ${plugin.pluginId}`}
                >
                  <span>Trust {plugin.security.trustState}</span>
                  <span>Signing {plugin.security.signing}</span>
                  <span>Readiness {plugin.security.readiness}</span>
                  <span>Executable {plugin.security.executable ? "yes" : "no"}</span>
                  <span>
                    Denied{" "}
                    {plugin.security.deniedCapabilities.length === 0
                      ? "none"
                      : plugin.security.deniedCapabilities.join(", ")}
                  </span>
                  <span>Requested {plugin.security.requestedPermissions.join(", ")}</span>
                  <span>Granted {plugin.security.grantedPermissions.join(", ")}</span>
                  <span>Audit {plugin.security.auditEvents.join(" | ")}</span>
                </div>
              )}
              <button
                aria-label={`${plugin.enabled ? "Disable" : "Enable"} plugin ${
                  plugin.manifest?.displayName ?? plugin.pluginId
                }`}
                className="ns-icon-text-button"
                onClick={() => plugins?.onSetEnabled?.(plugin.pluginId, !plugin.enabled)}
                type="button"
              >
                <Power aria-hidden="true" size={14} />
                {plugin.enabled ? "Disable" : "Enable"}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function permissionSummary(grants: readonly PluginSettingsPermissionGrant[]): string {
  if (grants.length === 0) {
    return "未授权权限";
  }

  return grants.map((grant) => `${grant.permission} · ${grant.scopes.join(", ")}`).join("；");
}

function ModelField({
  actions,
  category = "模型",
  children,
  label,
  keywords,
  note
}: {
  readonly actions?: ReactNode;
  readonly category?: string;
  readonly children: ReactNode;
  readonly keywords?: readonly string[];
  readonly label: string;
  readonly note?: string;
}) {
  const searchQuery = useContext(SettingsSearchQueryContext);
  const title = `${category}: ${label}`;

  if (!matchesSettingsQuery(searchQuery, [title, category, label, note, ...(keywords ?? [])])) {
    return null;
  }

  return (
    <section className="model-settings-item model-settings-field" data-setting-title={title}>
      <div className="model-settings-item-heading model-settings-field-header">
        <div className="model-settings-item-copy">
          <h3 className="model-settings-field-label">{title}</h3>
          {note === undefined ? null : <p className="model-settings-item-description">{note}</p>}
        </div>
        {actions === undefined ? null : (
          <div className="model-settings-field-actions">{actions}</div>
        )}
      </div>
      <div className="model-settings-item-control">{children}</div>
    </section>
  );
}

function matchesSettingsQuery(query: string, values: readonly (string | undefined)[]): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (normalizedQuery.length === 0) {
    return true;
  }

  return values.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function toggleApiKeyVisibility(event: MouseEvent<HTMLButtonElement>): void {
  const input = event.currentTarget.previousElementSibling;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  input.type = input.type === "password" ? "text" : "password";
}

function statusLabel(status: ModelConnectionStatusValue): string {
  switch (status) {
    case "idle":
      return "未测试";
    case "testing":
      return "测试中";
    case "success":
      return "已连接";
    case "failed":
      return "失败";
  }
}

function themeLabel(theme: ModelSettingsAppearancePreferences["theme"]): string {
  return theme === "system" ? "跟随系统" : "深色";
}

function densityLabel(density: ModelSettingsAppearancePreferences["density"]): string {
  return density === "comfortable" ? "舒适" : "紧凑";
}
