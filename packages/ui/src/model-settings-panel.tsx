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
    <section className="model-settings-panel" aria-label="Model profile settings">
      <header className="panel-header">
        <h2>Model Profiles</h2>
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
                <p>Stored secret reference</p>
                <p>{profile.timeoutMs}ms timeout</p>
              </div>
              <div className="model-profile-actions">
                {isDefault ? (
                  <span className="default-profile-badge">
                    <CheckCircle aria-hidden="true" size={14} /> Default
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Make ${profile.displayName} default`}
                    onClick={() => onMakeDefault?.(profile.id)}
                  >
                    <Star aria-hidden="true" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Test connection for ${profile.displayName}`}
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
      return "Not tested";
    case "testing":
      return "Testing";
    case "success":
      return "Connected";
    case "failed":
      return "Failed";
  }
}
