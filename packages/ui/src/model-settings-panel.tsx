import { CheckCircle, PlugZap, Star } from "lucide-react";

export interface ModelSettingsProfile {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly modelName: string;
  readonly apiKeyRef: string;
  readonly timeoutMs: number;
}

export type ModelConnectionStatusValue = "idle" | "testing" | "success" | "failed";

export interface ModelConnectionStatus {
  readonly profileId: string;
  readonly status: ModelConnectionStatusValue;
  readonly detail?: string;
}

export interface ModelSettingsPanelProps {
  readonly defaultProfileId: string;
  readonly profiles: readonly ModelSettingsProfile[];
  readonly connectionStatus?: ModelConnectionStatus;
  readonly onTestConnection?: (profileId: string) => void;
  readonly onMakeDefault?: (profileId: string) => void;
}

export function ModelSettingsPanel({
  defaultProfileId,
  profiles,
  connectionStatus,
  onTestConnection,
  onMakeDefault
}: ModelSettingsPanelProps) {
  return (
    <section className="model-settings-panel" aria-label="模型 Profile 设置">
      <header className="panel-header">
        <h2>模型 Profile</h2>
      </header>
      <div className="model-profile-list">
        {profiles.map((profile) => {
          const isDefault = profile.id === defaultProfileId;
          const status =
            connectionStatus?.profileId === profile.id ? connectionStatus.status : "idle";
          return (
            <article className="model-profile-row" key={profile.id}>
              <div>
                <h3>{profile.displayName}</h3>
                <p>
                  {profile.provider} · {profile.modelName}
                </p>
                <p>已保存密钥引用</p>
                <p>{profile.timeoutMs}ms 超时</p>
              </div>
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
    </section>
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
