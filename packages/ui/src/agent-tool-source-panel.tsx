/**
 * Phase E.4 — Tool source management panel.
 * Allows users to view, add, test, enable/disable, and remove remote MCP servers.
 *
 * Security invariants:
 * - API keys are displayed as ref status only (never plaintext).
 * - All mutations go through the Main-owned IPC boundary.
 * - Plaintext keys only travel through the dedicated Main secret-save action and are never returned.
 */
import React, { useState, useCallback } from "react";
import type { McpServerConfig } from "@novel-studio/application";

type RemoteMcpServerConfig = Extract<McpServerConfig, { readonly transport: "remote_http" }>;

export interface AgentToolSourceEntry {
  readonly config: RemoteMcpServerConfig;
  readonly connectionStatus?: "idle" | "testing" | "ok" | "error";
}

export interface AgentToolSourcePanelProps {
  readonly servers: readonly AgentToolSourceEntry[];
  readonly loading?: boolean;
  readonly onAddServer: (config: RemoteMcpServerConfig, secret?: string) => Promise<void>;
  readonly onRemoveServer: (serverId: string) => Promise<void>;
  readonly onSetEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  readonly onTestConnection: (serverId: string) => Promise<{ readonly latencyMs: number }>;
  readonly onRevokeServer: (serverId: string) => Promise<void>;
}

type ServerFormState = {
  readonly displayName: string;
  readonly endpointUrl: string;
  readonly apiKey: string;
  readonly tlsFingerprint: string;
};

const emptyForm: ServerFormState = {
  displayName: "",
  endpointUrl: "",
  apiKey: "",
  tlsFingerprint: ""
};

export function AgentToolSourcePanel(props: AgentToolSourcePanelProps): React.ReactElement {
  const {
    servers,
    loading = false,
    onAddServer,
    onRemoveServer,
    onSetEnabled,
    onTestConnection,
    onRevokeServer
  } = props;
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<ServerFormState>(emptyForm);
  const [addError, setAddError] = useState<string | undefined>();
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "testing" | "ok" | "error">>(
    {}
  );
  const [revokeConfirm, setRevokeConfirm] = useState<string | undefined>();

  const handleFormChange = useCallback((field: keyof ServerFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleAddServer = useCallback(async () => {
    setAddError(undefined);
    if (!form.displayName.trim()) {
      setAddError("显示名称不能为空。");
      return;
    }
    if (!form.endpointUrl.trim()) {
      setAddError("远程 HTTP 服务器需要端点 URL。");
      return;
    }
    try {
      const url = new URL(form.endpointUrl.trim());
      if (url.protocol !== "https:") {
        setAddError("远程 MCP 服务器端点必须使用 HTTPS。");
        return;
      }
    } catch {
      setAddError("端点 URL 格式无效。");
      return;
    }

    const serverId = `mcp_${Date.now().toString(36)}`;
    const secret = form.apiKey.trim();
    const config: RemoteMcpServerConfig = {
      serverId,
      displayName: form.displayName.trim(),
      transport: "remote_http",
      endpointUrl: form.endpointUrl.trim(),
      apiKeyRef: `secret://remote-mcp/${serverId}/api_key`,
      apiKeyRequired: secret.length > 0,
      ...(form.tlsFingerprint.trim() ? { tlsFingerprint: form.tlsFingerprint.trim() } : {}),
      enabled: false
    };

    try {
      if (secret.length === 0) await onAddServer(config);
      else await onAddServer(config, secret);
      setForm(emptyForm);
      setShowAddForm(false);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "添加服务器失败。");
    }
  }, [form, onAddServer]);

  const handleTestConnection = useCallback(
    async (serverId: string) => {
      setTestStatus((prev) => ({ ...prev, [serverId]: "testing" }));
      try {
        await onTestConnection(serverId);
        setTestStatus((prev) => ({ ...prev, [serverId]: "ok" }));
      } catch {
        setTestStatus((prev) => ({ ...prev, [serverId]: "error" }));
      }
    },
    [onTestConnection]
  );

  const handleRevoke = useCallback(
    async (serverId: string) => {
      if (revokeConfirm !== serverId) {
        setRevokeConfirm(serverId);
        return;
      }
      setRevokeConfirm(undefined);
      await onRevokeServer(serverId);
    },
    [revokeConfirm, onRevokeServer]
  );

  return (
    <section
      aria-labelledby="agent-tool-source-heading"
      className="model-settings-section agent-tool-source-settings"
      data-testid="agent-tool-source-panel"
    >
      <header className="model-settings-section-header">
        <div>
          <h2 id="agent-tool-source-heading">工具来源管理</h2>
          <p>管理 MCP 服务器连接。运行中安装或启用的来源将在下次运行时生效。</p>
        </div>
        {!showAddForm && (
          <button
            aria-label="添加 MCP 服务器"
            className="ns-icon-text-button"
            data-testid="tool-source-add-button"
            disabled={loading}
            onClick={() => setShowAddForm(true)}
            type="button"
          >
            + 添加工具来源
          </button>
        )}
      </header>

      {/* Server list */}
      {servers.length === 0 && !showAddForm && (
        <div className="agent-tool-source-empty" data-testid="tool-source-empty-state">
          暂无工具来源。添加一个 MCP 服务器以扩展 Agent 工具集。
        </div>
      )}

      <div className="agent-tool-source-list">
        {servers.map(({ config }) => (
          <div
            className="agent-tool-source-card"
            key={config.serverId}
            data-testid={`tool-source-entry-${config.serverId}`}
          >
            <div className="agent-tool-source-card-header">
              <div className="agent-tool-source-identity">
                <strong>{config.displayName}</strong>
                <span>端点：{config.endpointUrl}</span>
              </div>
              <div className="agent-tool-source-badges">
                <span
                  className="agent-tool-source-badge"
                  data-testid={`tool-source-transport-${config.serverId}`}
                >
                  远程 HTTP
                </span>
                <span
                  className="agent-tool-source-status"
                  data-enabled={config.enabled}
                  data-testid={`tool-source-enabled-${config.serverId}`}
                >
                  {config.enabled ? "已启用" : "已禁用"}
                </span>
              </div>
            </div>

            <div className="agent-tool-source-actions">
              {/* Enable/disable */}
              <button
                className="ns-icon-text-button"
                onClick={() => onSetEnabled(config.serverId, !config.enabled)}
                disabled={loading}
                aria-label={
                  config.enabled ? `禁用 ${config.displayName}` : `启用 ${config.displayName}`
                }
                data-testid={`tool-source-toggle-${config.serverId}`}
                type="button"
              >
                {config.enabled ? "禁用" : "启用"}
              </button>

              <button
                className="ns-icon-text-button"
                onClick={() => handleTestConnection(config.serverId)}
                disabled={loading || testStatus[config.serverId] === "testing"}
                aria-label={`测试连接 ${config.displayName}`}
                data-testid={`tool-source-test-${config.serverId}`}
                type="button"
              >
                {testStatus[config.serverId] === "testing" ? "测试中..." : "测试连接"}
              </button>
              {testStatus[config.serverId] === "ok" && (
                <span className="agent-tool-source-result" data-kind="success">
                  连接成功
                </span>
              )}
              {testStatus[config.serverId] === "error" && (
                <span className="agent-tool-source-result" data-kind="error">
                  连接失败
                </span>
              )}

              {/* Remove */}
              <button
                className="ns-icon-text-button"
                onClick={() => onRemoveServer(config.serverId)}
                disabled={loading}
                aria-label={`删除 ${config.displayName}`}
                data-testid={`tool-source-remove-${config.serverId}`}
                type="button"
              >
                删除
              </button>

              {/* Revoke (with confirmation) */}
              <button
                className="ns-icon-text-button"
                onClick={() => handleRevoke(config.serverId)}
                disabled={loading}
                aria-label={
                  revokeConfirm === config.serverId
                    ? `确认撤销 ${config.displayName} 的访问权限`
                    : `撤销 ${config.displayName} 的访问权限`
                }
                data-danger={revokeConfirm === config.serverId}
                data-testid={`tool-source-revoke-${config.serverId}`}
                type="button"
              >
                {revokeConfirm === config.serverId ? "确认撤销" : "撤销访问"}
              </button>
              {revokeConfirm === config.serverId && (
                <button
                  className="ns-icon-text-button"
                  onClick={() => setRevokeConfirm(undefined)}
                  aria-label="取消撤销"
                  type="button"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="agent-tool-source-form" data-testid="tool-source-add-form">
          <h3>添加 MCP 服务器</h3>

          <div className="agent-tool-source-form-grid">
            <label className="agent-tool-source-field">
              <span>
                显示名称{" "}
                <span aria-hidden="true" className="agent-tool-source-required">
                  *
                </span>
              </span>
              <input
                aria-label="显示名称"
                className="ns-search-input"
                data-testid="tool-source-add-name"
                onChange={(e) => handleFormChange("displayName", e.target.value)}
                placeholder="我的 MCP 服务器"
                type="text"
                value={form.displayName}
              />
            </label>
            <label className="agent-tool-source-field">
              <span>
                端点 URL{" "}
                <span aria-hidden="true" className="agent-tool-source-required">
                  *
                </span>
              </span>
              <input
                aria-label="端点 URL"
                className="ns-search-input"
                data-testid="tool-source-add-endpoint"
                onChange={(e) => handleFormChange("endpointUrl", e.target.value)}
                placeholder="https://mcp.example.com/api"
                type="url"
                value={form.endpointUrl}
              />
            </label>
            <label className="agent-tool-source-field">
              <span>TLS 证书指纹（可选）</span>
              <input
                aria-label="TLS 证书指纹"
                className="ns-search-input"
                data-testid="tool-source-add-tls"
                onChange={(e) => handleFormChange("tlsFingerprint", e.target.value)}
                placeholder="sha256:..."
                type="text"
                value={form.tlsFingerprint}
              />
            </label>
            <label className="agent-tool-source-field">
              <span>API Key（可选）</span>
              <input
                aria-label="MCP API Key"
                autoComplete="off"
                className="ns-search-input"
                data-testid="tool-source-add-apikey"
                onChange={(e) => handleFormChange("apiKey", e.target.value)}
                placeholder="留空表示无鉴权"
                type="password"
                value={form.apiKey}
              />
              <small>保存后写入桌面安全存储，MCP 配置文件只保留 secret:// 引用。</small>
            </label>
          </div>

          {addError && (
            <p className="agent-tool-source-error" data-testid="tool-source-add-error" role="alert">
              {addError}
            </p>
          )}

          <div className="agent-tool-source-form-actions">
            <button
              className="ns-icon-text-button"
              onClick={handleAddServer}
              disabled={loading}
              aria-label="确认添加服务器"
              data-testid="tool-source-add-confirm"
              type="button"
            >
              添加
            </button>
            <button
              className="ns-icon-text-button"
              onClick={() => {
                setShowAddForm(false);
                setForm(emptyForm);
                setAddError(undefined);
              }}
              aria-label="取消添加"
              data-testid="tool-source-add-cancel"
              type="button"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <footer className="agent-tool-source-note">
        <p>工具来源只在运行开始前冻结。运行中修改设置将在下次运行时生效，当前运行不受影响。</p>
      </footer>
    </section>
  );
}
