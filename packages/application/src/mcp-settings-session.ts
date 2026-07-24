/**
 * Phase E.3 — MCP settings session.
 * Manages remote MCP server configurations; secrets stored by ref only.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";

export interface McpServerConfig {
  readonly serverId: string;
  readonly displayName: string;
  readonly transport: "remote_http";
  readonly endpointUrl: string;
  /** Reference into safeStorage — never the plaintext secret. */
  readonly apiKeyRef: string;
  /** Optional TLS certificate fingerprint for connection identity pinning. */
  readonly tlsFingerprint?: string;
  readonly enabled: boolean;
}

export interface McpSettingsData {
  readonly servers: readonly McpServerConfig[];
  readonly revision: string;
}

export const DEFAULT_MCP_SETTINGS: McpSettingsData = {
  servers: [],
  revision: "v1.0-default"
};

export interface McpSettingsPort {
  readMcpSettings(): Promise<Result<McpSettingsData, UnifiedError>>;
  writeMcpSettings(settings: McpSettingsData): Promise<Result<McpSettingsData, UnifiedError>>;
}

export interface McpSettingsSession {
  listServers(): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
  addServer(config: McpServerConfig): Promise<Result<McpSettingsData, UnifiedError>>;
  removeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
  testConnection(serverId: string): Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
  revokeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
  getMcpSettings(): Promise<Result<McpSettingsData, UnifiedError>>;
}

function mcpError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError" as const,
    message,
    recoverability: "user-action",
    suggestedAction: "Check the MCP server configuration and retry.",
    traceId: "mcp-settings-session"
  });
}

function bumpRevision(): string {
  return `v1.0-${Date.now()}`;
}

export function createMcpSettingsSession(input: {
  readonly port: McpSettingsPort;
  readonly testRemoteConnection?: (
    config: McpServerConfig
  ) => Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
}): McpSettingsSession {
  async function readSettings(): Promise<Result<McpSettingsData, UnifiedError>> {
    const stored = await input.port.readMcpSettings();
    if (!stored.ok) return stored;
    if (!stored.value) return ok(DEFAULT_MCP_SETTINGS);
    return ok(stored.value);
  }

  return {
    async listServers() {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      return ok(settings.value.servers);
    },

    async addServer(config) {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const existing = settings.value.servers.findIndex((s) => s.serverId === config.serverId);
      const updated =
        existing === -1
          ? [...settings.value.servers, config]
          : settings.value.servers.map((s) => (s.serverId === config.serverId ? config : s));
      const next: McpSettingsData = { servers: updated, revision: bumpRevision() };
      return input.port.writeMcpSettings(next);
    },

    async removeServer(serverId) {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const updated = settings.value.servers.filter((s) => s.serverId !== serverId);
      const next: McpSettingsData = { servers: updated, revision: bumpRevision() };
      return input.port.writeMcpSettings(next);
    },

    async testConnection(serverId) {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const config = settings.value.servers.find((s) => s.serverId === serverId);
      if (!config) {
        return err(mcpError("MCP_SERVER_NOT_FOUND", `No MCP server found with id '${serverId}'.`));
      }
      if (input.testRemoteConnection === undefined) {
        return err(
          mcpError("MCP_TEST_UNAVAILABLE", "Remote MCP connection test is not available.")
        );
      }
      return input.testRemoteConnection(config);
    },

    async revokeServer(serverId) {
      const settings = await readSettings();
      if (!settings.ok) return settings;
      const updated = settings.value.servers.map((s) =>
        s.serverId === serverId ? { ...s, enabled: false } : s
      );
      const next: McpSettingsData = { servers: updated, revision: bumpRevision() };
      return input.port.writeMcpSettings(next);
    },

    getMcpSettings: readSettings
  };
}
