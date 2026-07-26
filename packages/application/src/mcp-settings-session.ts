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
      /**
       * When true, a missing secret prevents the runtime from connecting.
       * Omitted for backward compatibility with configurations saved before
       * API keys could be explicitly marked optional.
       */
      readonly apiKeyRequired?: boolean;
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

let lastRevisionTick = 0;

function bumpRevision(): string {
  lastRevisionTick = Math.max(Date.now(), lastRevisionTick + 1);
  return `v1.0-${String(lastRevisionTick)}`;
}

function hasDisallowedControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
  }
  return false;
}

function validateServerConfig(config: McpServerConfig): Result<void, UnifiedError> {
  if (!hasMcpServerConfigShape(config)) {
    return err(mcpError("MCP_SERVER_CONFIG_INVALID", "MCP server configuration is malformed."));
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.serverId)) {
    return err(
      mcpError("MCP_SERVER_ID_INVALID", "MCP serverId must be 1-128 safe identifier characters.")
    );
  }
  if (
    config.displayName.length === 0 ||
    config.displayName.length > 256 ||
    hasDisallowedControlCharacters(config.displayName)
  ) {
    return err(mcpError("MCP_SERVER_DISPLAY_NAME_INVALID", "MCP server displayName is invalid."));
  }
  if (config.transport === "local_stdio") return ok(undefined);

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpointUrl);
  } catch {
    return err(mcpError("MCP_REMOTE_ENDPOINT_INVALID", "Remote MCP endpointUrl is invalid."));
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== ""
  ) {
    return err(
      mcpError(
        "MCP_REMOTE_ENDPOINT_INVALID",
        "Remote MCP endpointUrl must be credential-free HTTPS without a fragment."
      )
    );
  }
  if (
    config.apiKeyRef !== `secret://remote-mcp/${config.serverId}/api_key` ||
    hasDisallowedControlCharacters(config.apiKeyRef) ||
    config.apiKeyRef.length > 512
  ) {
    return err(
      mcpError(
        "MCP_REMOTE_API_KEY_REF_INVALID",
        "Remote MCP apiKeyRef must be bound to its server ID."
      )
    );
  }
  if (
    config.tlsFingerprint !== undefined &&
    (config.tlsFingerprint.length === 0 ||
      config.tlsFingerprint.length > 512 ||
      hasDisallowedControlCharacters(config.tlsFingerprint))
  ) {
    return err(
      mcpError("MCP_REMOTE_TLS_FINGERPRINT_INVALID", "Remote MCP TLS fingerprint is invalid.")
    );
  }
  return ok(undefined);
}

function hasMcpServerConfigShape(value: unknown): value is McpServerConfig {
  if (
    !isRecord(value) ||
    typeof value["serverId"] !== "string" ||
    typeof value["displayName"] !== "string" ||
    typeof value["enabled"] !== "boolean"
  ) {
    return false;
  }
  if (value["transport"] === "local_stdio") return true;
  return (
    value["transport"] === "remote_http" &&
    typeof value["endpointUrl"] === "string" &&
    typeof value["apiKeyRef"] === "string" &&
    (value["apiKeyRequired"] === undefined || typeof value["apiKeyRequired"] === "boolean") &&
    (value["tlsFingerprint"] === undefined || typeof value["tlsFingerprint"] === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const seenServerIds = new Set<string>();
    for (const config of stored.value.servers) {
      const valid = validateServerConfig(config);
      if (!valid.ok) return valid;
      if (seenServerIds.has(config.serverId)) {
        return err(
          mcpError("MCP_SERVER_ID_DUPLICATE", `MCP server '${config.serverId}' is duplicated.`)
        );
      }
      seenServerIds.add(config.serverId);
    }
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
      const valid = validateServerConfig(config);
      if (!valid.ok) return valid;
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
