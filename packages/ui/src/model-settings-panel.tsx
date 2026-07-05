import { CheckCircle, FilePlus, PlugZap, Save, Shield, Star } from "lucide-react";
import type { ReactNode } from "react";

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
  readonly timeoutMs: string;
}

export interface ModelConnectionStatus {
  readonly profileId: string;
  readonly status: ModelConnectionStatusValue;
  readonly detail?: string;
}

export interface ModelSettingsPanelProps {
  readonly defaultProfileId: string;
  readonly selectedProfileId?: string;
  readonly profiles: readonly ModelSettingsProfile[];
  readonly draft: ModelSettingsDraft;
  readonly saveStatus: ModelSettingsSaveStatus;
  readonly connectionStatus?: ModelConnectionStatus;
  readonly feedback?: { readonly kind: "info" | "error"; readonly message: string };
  readonly onSelectProfile?: (profileId: string) => void;
  readonly onDraftChange?: (draft: Partial<ModelSettingsDraft>) => void;
  readonly onNewProfile?: () => void;
  readonly onSaveProfile?: () => void;
  readonly onTestConnection?: (profileId: string) => void;
  readonly onMakeDefault?: (profileId: string) => void;
}

export function ModelSettingsPanel({
  defaultProfileId,
  selectedProfileId,
  profiles,
  draft,
  saveStatus,
  connectionStatus,
  feedback,
  onSelectProfile,
  onDraftChange,
  onNewProfile,
  onSaveProfile,
  onTestConnection,
  onMakeDefault
}: ModelSettingsPanelProps) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const canSave =
    saveStatus !== "saving" &&
    draft.id.trim().length > 0 &&
    draft.displayName.trim().length > 0 &&
    draft.modelName.trim().length > 0;

  return (
    <section className="model-settings-panel" aria-label="设置">
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
        <aside className="model-settings-nav" aria-label="设置分区">
          <span aria-current="page">模型配置</span>
          <span>自动保存与历史</span>
          <span>隐私与安全</span>
          <span>插件</span>
          <span>高级</span>
        </aside>

        <div className="model-settings-main">
          <section className="model-settings-card" aria-label="模型配置">
            <div className="model-settings-section-header">
              <div>
                <h2>模型配置</h2>
                <p>
                  配置 OpenAI Compatible、OpenAI 或 Ollama profile。保存前仍由 Application 层校验。
                </p>
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
                    <article
                      className="model-profile-row"
                      data-selected={isSelected}
                      key={profile.id}
                    >
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
                <div className="model-profile-form-grid">
                  <ModelField label="Profile ID">
                    <input
                      aria-label="模型 Profile ID"
                      className="ns-search-input"
                      onChange={(event) => onDraftChange?.({ id: event.currentTarget.value })}
                      value={draft.id}
                    />
                  </ModelField>
                  <ModelField label="显示名称">
                    <input
                      aria-label="模型显示名称"
                      className="ns-search-input"
                      onChange={(event) =>
                        onDraftChange?.({ displayName: event.currentTarget.value })
                      }
                      value={draft.displayName}
                    />
                  </ModelField>
                  <ModelField label="Provider">
                    <select
                      aria-label="模型 Provider"
                      className="model-settings-select"
                      onChange={(event) => onDraftChange?.({ provider: event.currentTarget.value })}
                      value={draft.provider}
                    >
                      <option value="openai-compatible">openai-compatible</option>
                      <option value="openai">openai</option>
                      <option value="ollama">ollama</option>
                    </select>
                  </ModelField>
                  <ModelField label="模型名称">
                    <input
                      aria-label="模型名称"
                      className="ns-search-input"
                      onChange={(event) =>
                        onDraftChange?.({ modelName: event.currentTarget.value })
                      }
                      value={draft.modelName}
                    />
                  </ModelField>
                  <ModelField label="Base URL">
                    <input
                      aria-label="模型 Base URL"
                      className="ns-search-input"
                      onChange={(event) => onDraftChange?.({ baseUrl: event.currentTarget.value })}
                      value={draft.baseUrl}
                    />
                  </ModelField>
                  <ModelField label="密钥引用">
                    <input
                      aria-label="密钥引用"
                      className="ns-search-input"
                      onChange={(event) =>
                        onDraftChange?.({ apiKeyRefInput: event.currentTarget.value })
                      }
                      placeholder={
                        selectedProfile === undefined
                          ? "secret://model_id/api_key"
                          : "留空则沿用已保存密钥引用"
                      }
                      value={draft.apiKeyRefInput}
                    />
                  </ModelField>
                  <ModelField label="Temperature">
                    <input
                      aria-label="Temperature"
                      className="ns-search-input"
                      inputMode="decimal"
                      onChange={(event) =>
                        onDraftChange?.({ temperature: event.currentTarget.value })
                      }
                      value={draft.temperature}
                    />
                  </ModelField>
                  <ModelField label="Max Tokens">
                    <input
                      aria-label="Max Tokens"
                      className="ns-search-input"
                      inputMode="numeric"
                      onChange={(event) =>
                        onDraftChange?.({ maxTokens: event.currentTarget.value })
                      }
                      value={draft.maxTokens}
                    />
                  </ModelField>
                  <ModelField label="Top P">
                    <input
                      aria-label="Top P"
                      className="ns-search-input"
                      inputMode="decimal"
                      onChange={(event) => onDraftChange?.({ topP: event.currentTarget.value })}
                      value={draft.topP}
                    />
                  </ModelField>
                  <ModelField label="Timeout">
                    <input
                      aria-label="Timeout"
                      className="ns-search-input"
                      inputMode="numeric"
                      onChange={(event) =>
                        onDraftChange?.({ timeoutMs: event.currentTarget.value })
                      }
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

          <section className="model-settings-card" aria-label="自动保存与历史">
            <h2>自动保存与历史</h2>
            <p>
              当前版本沿用项目 settings.json 中的 autosave/history
              策略。后续可在这里补齐间隔、快照策略和恢复草稿提示。
            </p>
          </section>

          <section className="model-settings-card" aria-label="隐私与安全">
            <h2>隐私与安全</h2>
            <div className="model-security-note">
              <Shield aria-hidden="true" size={16} />
              <p>
                API Key 不会以明文写入 settings.json，也不会显示在列表、错误或日志中。这里仅接受
                secret:// 引用，真实密钥由桌面端安全存储能力管理。
              </p>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function ModelField({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="model-settings-field">
      <span>{label}</span>
      {children}
    </label>
  );
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
