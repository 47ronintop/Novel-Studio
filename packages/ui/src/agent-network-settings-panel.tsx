/**
 * Task D.1 — Network settings UI panel.
 * Minimal UI for enabling/disabling agent network access, managing allowed hosts,
 * API key status (by ref only — no plaintext), egress policy, and test connection.
 */
import React, { useState, useCallback } from "react";
import type {
  AgentNetworkSettingsData,
  AgentNetworkProviderProfile
} from "@novel-studio/application";

export interface AgentNetworkSettingsPanelProps {
  readonly settings: AgentNetworkSettingsData;
  readonly onUpdateSettings: (partial: Partial<AgentNetworkSettingsData>) => Promise<void>;
  readonly onTestConnection: (profileId: string) => Promise<{ readonly latencyMs: number }>;
  readonly onRevoke: () => Promise<void>;
  /** Whether the panel is in a loading state. */
  readonly loading?: boolean;
}

export function AgentNetworkSettingsPanel(
  props: AgentNetworkSettingsPanelProps
): React.ReactElement {
  const { settings, onUpdateSettings, onTestConnection, onRevoke, loading = false } = props;
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "testing" | "ok" | "error">>(
    {}
  );
  const [newHost, setNewHost] = useState("");

  const handleToggleEnabled = useCallback(async () => {
    await onUpdateSettings({ enabled: !settings.enabled });
  }, [settings.enabled, onUpdateSettings]);

  const handleAddHost = useCallback(async () => {
    const trimmed = newHost.trim();
    if (!trimmed) return;
    const updated = [...settings.allowedHosts, trimmed];
    await onUpdateSettings({ allowedHosts: updated });
    setNewHost("");
  }, [newHost, settings.allowedHosts, onUpdateSettings]);

  const handleRemoveHost = useCallback(
    async (host: string) => {
      await onUpdateSettings({ allowedHosts: settings.allowedHosts.filter((h) => h !== host) });
    },
    [settings.allowedHosts, onUpdateSettings]
  );

  const handleEgressPolicyChange = useCallback(
    async (policy: AgentNetworkSettingsData["dataEgressPolicy"]) => {
      await onUpdateSettings({ dataEgressPolicy: policy });
    },
    [onUpdateSettings]
  );

  const handleTestConnection = useCallback(
    async (profileId: string) => {
      setTestStatus((prev) => ({ ...prev, [profileId]: "testing" }));
      try {
        await onTestConnection(profileId);
        setTestStatus((prev) => ({ ...prev, [profileId]: "ok" }));
      } catch {
        setTestStatus((prev) => ({ ...prev, [profileId]: "error" }));
      }
    },
    [onTestConnection]
  );

  const hasKey = (profile: AgentNetworkProviderProfile): boolean =>
    profile.apiKeyRef.startsWith("secret://") && profile.apiKeyRef.length > "secret://".length;

  return (
    <div data-testid="agent-network-settings-panel" style={{ padding: "16px" }}>
      <h2>Agent 网络访问</h2>

      {/* Enable/disable toggle */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={handleToggleEnabled}
            disabled={loading}
            aria-label="启用 Agent 网络访问"
          />
          <span>启用 Agent 网络访问</span>
        </label>
        {!settings.enabled && (
          <p style={{ color: "#888", fontSize: "12px", marginTop: "4px" }}>
            网络访问已关闭。Agent 工具 web_search 和 fetch_url 不可用。
          </p>
        )}
      </div>

      {/* Egress policy */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
          数据外发策略
        </label>
        <select
          value={settings.dataEgressPolicy}
          onChange={(e) =>
            handleEgressPolicyChange(e.target.value as AgentNetworkSettingsData["dataEgressPolicy"])
          }
          disabled={loading || !settings.enabled}
          aria-label="数据外发策略"
        >
          <option value="require_confirmation">每次请求确认</option>
          <option value="auto_approve_search_queries">搜索查询自动通过</option>
        </select>
      </div>

      {/* Allowed hosts */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
          允许的主机名
        </label>
        {settings.allowedHosts.length === 0 ? (
          <p style={{ color: "#888", fontSize: "12px" }}>
            尚无允许的主机名。添加公共主机名以启用网络访问。
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {settings.allowedHosts.map((host) => (
              <li
                key={host}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 0"
                }}
              >
                <code>{host}</code>
                <button
                  onClick={() => handleRemoveHost(host)}
                  disabled={loading}
                  aria-label={`删除主机 ${host}`}
                  style={{ fontSize: "12px" }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
          <input
            type="text"
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder="例如: api.example.com 或 *.example.com"
            disabled={loading || !settings.enabled}
            aria-label="新主机名"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddHost();
            }}
          />
          <button
            onClick={handleAddHost}
            disabled={loading || !settings.enabled || !newHost.trim()}
            aria-label="添加主机名"
          >
            添加
          </button>
        </div>
      </div>

      {/* Provider profiles */}
      {settings.providerProfiles.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", marginBottom: "4px", fontWeight: "bold" }}>
            Provider 配置
          </label>
          {settings.providerProfiles.map((profile) => (
            <div
              key={profile.providerId}
              data-testid={`provider-profile-${profile.providerId}`}
              style={{
                border: "1px solid #ddd",
                borderRadius: "4px",
                padding: "8px",
                marginBottom: "8px"
              }}
            >
              <strong>{profile.name}</strong>
              <div style={{ fontSize: "12px", color: "#555", marginTop: "4px" }}>
                端点: {profile.endpoint}
              </div>
              <div
                style={{ fontSize: "12px", marginTop: "4px" }}
                data-testid={`api-key-status-${profile.providerId}`}
              >
                API Key 状态:{" "}
                <span style={{ color: hasKey(profile) ? "green" : "orange" }}>
                  {hasKey(profile) ? "已设置" : "未配置"}
                </span>
              </div>
              <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                <button
                  onClick={() => handleTestConnection(profile.providerId)}
                  disabled={loading || testStatus[profile.providerId] === "testing"}
                  aria-label={`测试连接 ${profile.name}`}
                >
                  {testStatus[profile.providerId] === "testing" ? "测试中..." : "测试连接"}
                </button>
                {testStatus[profile.providerId] === "ok" && (
                  <span style={{ color: "green", fontSize: "12px" }}>连接成功</span>
                )}
                {testStatus[profile.providerId] === "error" && (
                  <span style={{ color: "red", fontSize: "12px" }}>连接失败</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revoke button */}
      <div style={{ marginTop: "24px", borderTop: "1px solid #eee", paddingTop: "16px" }}>
        <button
          onClick={onRevoke}
          disabled={loading}
          aria-label="撤销所有网络访问"
          style={{ color: "red" }}
        >
          撤销所有网络访问
        </button>
        <p style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
          将禁用网络访问并清除所有设置。
        </p>
      </div>
    </div>
  );
}
