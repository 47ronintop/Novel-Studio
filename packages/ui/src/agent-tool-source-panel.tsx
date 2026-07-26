/**
 * Phase E.4 — Tool source management panel.
 * Allows users to view, add, test, enable/disable, and remove remote MCP servers.
 *
 * Security invariants:
 * - API keys are displayed as ref status only (never plaintext).
 * - All mutations go through the Main-owned IPC boundary.
 * - Renderer cannot submit capability revision, attestation, or secret values.
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
  readonly onAddServer: (config: RemoteMcpServerConfig) => Promise<void>;
  readonly onRemoveServer: (serverId: string) => Promise<void>;
  readonly onSetEnabled: (serverId: string, enabled: boolean) => Promise<void>;
  readonly onTestConnection: (serverId: string) => Promise<{ readonly latencyMs: number }>;
  readonly onRevokeServer: (serverId: string) => Promise<void>;
}

type ServerFormState = {
  readonly displayName: string;
  readonly endpointUrl: string;
  readonly apiKeyRef: string;
  readonly tlsFingerprint: string;
};

const emptyForm: ServerFormState = {
  displayName: "",
  endpointUrl: "",
  apiKeyRef: "",
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
    const config: RemoteMcpServerConfig = {
      serverId,
      displayName: form.displayName.trim(),
      transport: "remote_http",
      endpointUrl: form.endpointUrl.trim(),
      apiKeyRef: form.apiKeyRef.trim() || `secret://${serverId}/api_key`,
      ...(form.tlsFingerprint.trim() ? { tlsFingerprint: form.tlsFingerprint.trim() } : {}),
      enabled: false
    };

    try {
      await onAddServer(config);
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
    <div data-testid="agent-tool-source-panel" style={{ padding: "16px" }}>
      <h2>工具来源管理</h2>
      <p style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
        管理 MCP 服务器连接。来源只在运行开始时冻结；运行中安装或启用不会影响当前运行。
      </p>

      {/* Server list */}
      {servers.length === 0 && !showAddForm && (
        <div
          data-testid="tool-source-empty-state"
          style={{ color: "#888", fontSize: "13px", marginBottom: "16px" }}
        >
          暂无工具来源。添加一个 MCP 服务器以扩展 Agent 工具集。
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
        {servers.map(({ config }) => (
          <div
            key={config.serverId}
            data-testid={`tool-source-entry-${config.serverId}`}
            style={{
              border: "1px solid #333",
              borderRadius: "6px",
              padding: "12px",
              background: "#1a1a1a"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <strong style={{ flex: 1 }}>{config.displayName}</strong>
              <span
                data-testid={`tool-source-transport-${config.serverId}`}
                style={{
                  fontSize: "11px",
                  color: "#aaa",
                  background: "#2a2a2a",
                  borderRadius: "4px",
                  padding: "2px 6px"
                }}
              >
                远程 HTTP
              </span>
              <span
                data-testid={`tool-source-enabled-${config.serverId}`}
                style={{
                  fontSize: "11px",
                  color: config.enabled ? "#4caf50" : "#f44336"
                }}
              >
                {config.enabled ? "已启用" : "已禁用"}
              </span>
            </div>

            <div style={{ fontSize: "12px", color: "#888", marginTop: "4px" }}>
              端点: {config.endpointUrl}
            </div>

            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
              {/* Enable/disable */}
              <button
                onClick={() => onSetEnabled(config.serverId, !config.enabled)}
                disabled={loading}
                aria-label={
                  config.enabled ? `禁用 ${config.displayName}` : `启用 ${config.displayName}`
                }
                style={{ fontSize: "12px" }}
                data-testid={`tool-source-toggle-${config.serverId}`}
              >
                {config.enabled ? "禁用" : "启用"}
              </button>

              <button
                onClick={() => handleTestConnection(config.serverId)}
                disabled={loading || testStatus[config.serverId] === "testing"}
                aria-label={`测试连接 ${config.displayName}`}
                style={{ fontSize: "12px" }}
                data-testid={`tool-source-test-${config.serverId}`}
              >
                {testStatus[config.serverId] === "testing" ? "测试中..." : "测试连接"}
              </button>
              {testStatus[config.serverId] === "ok" && (
                <span style={{ color: "#4caf50", fontSize: "11px", alignSelf: "center" }}>
                  连接成功
                </span>
              )}
              {testStatus[config.serverId] === "error" && (
                <span style={{ color: "#f44336", fontSize: "11px", alignSelf: "center" }}>
                  连接失败
                </span>
              )}

              {/* Remove */}
              <button
                onClick={() => onRemoveServer(config.serverId)}
                disabled={loading}
                aria-label={`删除 ${config.displayName}`}
                style={{ fontSize: "12px" }}
                data-testid={`tool-source-remove-${config.serverId}`}
              >
                删除
              </button>

              {/* Revoke (with confirmation) */}
              <button
                onClick={() => handleRevoke(config.serverId)}
                disabled={loading}
                aria-label={
                  revokeConfirm === config.serverId
                    ? `确认撤销 ${config.displayName} 的访问权限`
                    : `撤销 ${config.displayName} 的访问权限`
                }
                style={{
                  fontSize: "12px",
                  color: revokeConfirm === config.serverId ? "#f44336" : undefined
                }}
                data-testid={`tool-source-revoke-${config.serverId}`}
              >
                {revokeConfirm === config.serverId ? "确认撤销" : "撤销访问"}
              </button>
              {revokeConfirm === config.serverId && (
                <button
                  onClick={() => setRevokeConfirm(undefined)}
                  style={{ fontSize: "12px" }}
                  aria-label="取消撤销"
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
        <div
          data-testid="tool-source-add-form"
          style={{
            border: "1px solid #555",
            borderRadius: "6px",
            padding: "12px",
            marginBottom: "12px",
            background: "#111"
          }}
        >
          <h3 style={{ margin: "0 0 10px" }}>添加 MCP 服务器</h3>

          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
              显示名称 <span style={{ color: "#f44336" }}>*</span>
            </label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => handleFormChange("displayName", e.target.value)}
              placeholder="我的 MCP 服务器"
              aria-label="显示名称"
              style={{ width: "100%", boxSizing: "border-box" }}
              data-testid="tool-source-add-name"
            />
          </div>

          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
              端点 URL <span style={{ color: "#f44336" }}>*</span>
            </label>
            <input
              type="url"
              value={form.endpointUrl}
              onChange={(e) => handleFormChange("endpointUrl", e.target.value)}
              placeholder="https://mcp.example.com/api"
              aria-label="端点 URL"
              style={{ width: "100%", boxSizing: "border-box" }}
              data-testid="tool-source-add-endpoint"
            />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
              TLS 证书指纹（可选）
            </label>
            <input
              type="text"
              value={form.tlsFingerprint}
              onChange={(e) => handleFormChange("tlsFingerprint", e.target.value)}
              placeholder="sha256:..."
              aria-label="TLS 证书指纹"
              style={{ width: "100%", boxSizing: "border-box" }}
              data-testid="tool-source-add-tls"
            />
          </div>
          <div style={{ marginBottom: "8px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
              API Key 引用（留空则由系统生成）
            </label>
            <input
              type="text"
              value={form.apiKeyRef}
              onChange={(e) => handleFormChange("apiKeyRef", e.target.value)}
              placeholder="secret://my-server/api_key（不接受明文密钥）"
              aria-label="API Key 引用"
              style={{ width: "100%", boxSizing: "border-box" }}
              data-testid="tool-source-add-apikey"
            />
            <p style={{ fontSize: "11px", color: "#888", margin: "4px 0 0" }}>
              明文 API Key 不会存储在此字段中。请通过密钥管理器保存后使用 secret:// 引用。
            </p>
          </div>

          {addError && (
            <p
              data-testid="tool-source-add-error"
              style={{ color: "#f44336", fontSize: "12px", margin: "8px 0" }}
            >
              {addError}
            </p>
          )}

          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button
              onClick={handleAddServer}
              disabled={loading}
              aria-label="确认添加服务器"
              data-testid="tool-source-add-confirm"
            >
              添加
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setForm(emptyForm);
                setAddError(undefined);
              }}
              aria-label="取消添加"
              data-testid="tool-source-add-cancel"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {!showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          disabled={loading}
          aria-label="添加 MCP 服务器"
          data-testid="tool-source-add-button"
          style={{ marginTop: "8px" }}
        >
          + 添加工具来源
        </button>
      )}

      <div
        style={{
          marginTop: "24px",
          borderTop: "1px solid #333",
          paddingTop: "12px",
          fontSize: "11px",
          color: "#666"
        }}
      >
        <p>工具来源只在运行开始前冻结。运行中修改设置将在下次运行时生效，当前运行不受影响。</p>
      </div>
    </div>
  );
}
