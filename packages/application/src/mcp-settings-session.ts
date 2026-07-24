/**
 * Phase E.3 + E.2 — MCP settings session.
 * Manages remote MCP server configurations (remote_http) and local stdio
 * server summaries (local_stdio). Secrets stored by ref only.
 *
 * SECURITY: raw command/argv/cwd must never live in McpServerConfig — those
 * stay inside the McpSettingsFileRepository/Main boundary. This session only
 * carries redacted identity fields for the local_stdio variant.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";

export type McpServerConfig =
  | {
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
  | {
      readonly serverId: string;
      readonly displayName: string;
      readonly transport: "local_stdio";
      readonly enabled: boolean;
    };

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

/**
 * Port for local stdio MCP server management. The concrete implementation is
 * backed by McpSettingsFileRepository from @novel-studio/repository, injected
 * by the caller — application layer stays transport-agnostic and never
 * imports the concrete repository class.
 */
export interface LocalMcpSettingsPort {
  /** Returns all local servers as McpServerConfig (local_stdio variant) — no command/argv. */
  listLocalServers(): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
  /** Enables or disables a local server by id. Returns the updated redacted list. */
  setLocalServerEnabled(
    serverId: string,
    enabled: boolean
  ): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
}

export interface McpSettingsSession {
  listServers(): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
  addServer(config: McpServerConfig): Promise<Result<McpSettingsData, UnifiedError>>;
  removeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
  testConnection(serverId: string): Promise<Result<{ readonly latencyMs: number }, UnifiedError>>;
  revokeServer(serverId: string): Promise<Result<McpSettingsData, UnifiedError>>;
  getMcpSettings(): Promise<Result<McpSettingsData, UnifiedError>>;

  // ── local_stdio (Task E.2) ───────────────────────────────────────────────
  /**
   * Lists all local stdio servers (redacted — no command/argv/cwd/env).
   * Returns a clean MCP_LOCAL_UNAVAILABLE error (never throws) when no
   * localPort was supplied at session creation time.
   */
  listLocalServers(): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
  /**
   * Enables or disables a local stdio server by id.
   * Returns a clean MCP_LOCAL_UNAVAILABLE error (never throws) when no
   * localPort was supplied at session creation time.
   */
  setLocalServerEnabled(
    serverId: string,
    enabled: boolean
  ): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
  /**
   * Alias for setLocalServerEnabled(serverId, false) — disables without removing.
   * Returns a clean MCP_LOCAL_UNAVAILABLE error (never throws) when no
   * localPort was supplied at session creation time.
   */
  revokeLocalServer(serverId: string): Promise<Result<readonly McpServerConfig[], UnifiedError>>;
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
  /**
   * Optional: inject a LocalMcpSettingsPort for local stdio server management.
   * When absent, all local-stdio methods return a clean MCP_LOCAL_UNAVAILABLE
   * error rather than throwing, so existing remote-only callers/tests keep
   * working unchanged.
   */
  readonly localPort?: LocalMcpSettingsPort;
}): McpSettingsSession {
  async function readSettings(): Promise<Result<McpSettingsData, UnifiedError>> {
    const stored = await input.port.readMcpSettings();
    if (!stored.ok) return stored;
    if (!stored.value) return ok(DEFAULT_MCP_SETTINGS);
    return ok(stored.value);
  }

  function localUnavailable(): UnifiedError {
    return mcpError(
      "MCP_LOCAL_UNAVAILABLE",
      "Local stdio MCP support is not configured in this session."
    );
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

    getMcpSettings: readSettings,

    async listLocalServers() {
      if (input.localPort === undefined) {
        return err(localUnavailable());
      }
      return input.localPort.listLocalServers();
    },

    async setLocalServerEnabled(serverId, enabled) {
      if (input.localPort === undefined) {
        return err(localUnavailable());
      }
      return input.localPort.setLocalServerEnabled(serverId, enabled);
    },

    async revokeLocalServer(serverId) {
      if (input.localPort === undefined) {
        return err(localUnavailable());
      }
      return input.localPort.setLocalServerEnabled(serverId, false);
    }
  };
}
