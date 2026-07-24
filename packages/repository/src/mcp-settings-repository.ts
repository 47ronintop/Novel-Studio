/**
 * Task E.2 — Local stdio MCP settings repository.
 *
 * App-local (userData-scoped, NOT project-scoped) store for local stdio MCP
 * server launch configurations. Project settings DTOs travel to the renderer
 * over IPC, so raw command/argv/cwd must never live there — this repository
 * is the only place the full launch config is persisted, and it only ever
 * exposes redacted summaries (serverId, displayName, enabled, transport) to
 * callers outside this file's Main/Repository boundary.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";

const SCHEMA_VERSION = "1.0";

/** Full local MCP server launch configuration. Never leaves the Main/Repository boundary. */
export interface LocalMcpServerLaunchConfig {
  readonly serverId: string;
  readonly displayName: string;
  readonly command: string;
  readonly argv: readonly string[];
  /** Must be project-relative or an explicit absolute allowlisted path; non-empty. */
  readonly cwd: string;
  /** Env var names only; actual secret values are resolved elsewhere via secret:// refs. */
  readonly envAllowlist: readonly string[];
  readonly enabled: boolean;
}

/** Redacted view of a local MCP server — safe to expose outside Main/Repository. */
export interface LocalMcpServerSummary {
  readonly serverId: string;
  readonly displayName: string;
  readonly transport: "local_stdio";
  readonly enabled: boolean;
}

export interface McpSettingsFileRepositoryOptions {
  readonly userDataRoot: string;
  readonly traceId?: string;
}

interface LocalMcpServersFile {
  readonly schemaVersion: "1.0";
  readonly servers: readonly LocalMcpServerLaunchConfig[];
}

/**
 * File-backed repository for local stdio MCP server launch configs.
 * Stored at `<userDataRoot>/agent-mcp/local-servers.json`.
 */
export class McpSettingsFileRepository {
  private readonly traceId: string;

  public constructor(private readonly options: McpSettingsFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_mcp_settings";
  }

  public async readLocalServers(): Promise<
    Result<readonly LocalMcpServerLaunchConfig[], UnifiedError>
  > {
    try {
      const parsed = JSON.parse(await readFile(this.filePath(), "utf8")) as unknown;
      const servers = parseLocalServersFile(parsed);
      if (servers === undefined) {
        // Corrupt file: fail closed to a clean empty default rather than throwing.
        return ok([]);
      }
      return ok(servers);
    } catch (error) {
      if (isMissingFileError(error)) {
        return ok([]);
      }
      // Corrupt/unreadable file returns a clean default rather than throwing.
      return ok([]);
    }
  }

  public async writeLocalServers(
    servers: readonly LocalMcpServerLaunchConfig[]
  ): Promise<Result<readonly LocalMcpServerLaunchConfig[], UnifiedError>> {
    const validated = validateLocalServers(servers, this.traceId);
    if (!validated.ok) return validated;

    const targetPath = this.filePath();
    try {
      await mkdir(dirname(targetPath), { recursive: true });
    } catch (error) {
      return err(
        storageError({
          code: "MCP_LOCAL_SETTINGS_WRITE_FAILED",
          message: "The local MCP settings directory could not be created.",
          suggestedAction: "Check local application data permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    const file: LocalMcpServersFile = { schemaVersion: SCHEMA_VERSION, servers };
    const written = await writeTextAtomically({
      targetPath,
      content: `${JSON.stringify(file, null, 2)}\n`,
      traceId: this.traceId
    });
    if (!written.ok) return written;

    return ok(servers);
  }

  public async listLocalServerSummaries(): Promise<
    Result<readonly LocalMcpServerSummary[], UnifiedError>
  > {
    const servers = await this.readLocalServers();
    if (!servers.ok) return servers;
    return ok(servers.value.map(toSummary));
  }

  private filePath(): string {
    return join(this.options.userDataRoot, "agent-mcp", "local-servers.json");
  }
}

function toSummary(config: LocalMcpServerLaunchConfig): LocalMcpServerSummary {
  return {
    serverId: config.serverId,
    displayName: config.displayName,
    transport: "local_stdio",
    enabled: config.enabled
  };
}

function parseLocalServersFile(value: unknown): readonly LocalMcpServerLaunchConfig[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== SCHEMA_VERSION) return undefined;
  if (!Array.isArray(record["servers"])) return undefined;

  const servers: LocalMcpServerLaunchConfig[] = [];
  for (const entry of record["servers"]) {
    const config = parseLaunchConfig(entry);
    if (config === undefined) return undefined;
    servers.push(config);
  }
  return servers;
}

function parseLaunchConfig(value: unknown): LocalMcpServerLaunchConfig | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { serverId, displayName, command, cwd, enabled } = record;
  const argv = record["argv"];
  const envAllowlist = record["envAllowlist"];

  if (
    typeof serverId !== "string" ||
    typeof displayName !== "string" ||
    typeof command !== "string" ||
    typeof cwd !== "string" ||
    typeof enabled !== "boolean" ||
    !Array.isArray(argv) ||
    !argv.every((item): item is string => typeof item === "string") ||
    !Array.isArray(envAllowlist) ||
    !envAllowlist.every((item): item is string => typeof item === "string")
  ) {
    return undefined;
  }

  return { serverId, displayName, command, argv, cwd, envAllowlist, enabled };
}

/**
 * Validates on write: serverId non-empty and unique, command non-empty, argv items
 * are strings, cwd non-empty. Also rejects shell metacharacters in `command` as
 * defense-in-depth — the actual non-shell exec happens at launch time, not here.
 */
function validateLocalServers(
  servers: readonly LocalMcpServerLaunchConfig[],
  traceId: string
): Result<readonly LocalMcpServerLaunchConfig[], UnifiedError> {
  const seenIds = new Set<string>();

  for (const server of servers) {
    if (server.serverId.length === 0) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_ID_EMPTY",
          message: "A local MCP server config has an empty serverId.",
          suggestedAction: "Assign a non-empty, unique serverId to each local MCP server.",
          traceId
        })
      );
    }

    if (seenIds.has(server.serverId)) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_ID_DUPLICATE",
          message: `Duplicate local MCP server id '${server.serverId}'.`,
          suggestedAction: "Use a unique serverId for each local MCP server.",
          traceId,
          redactedDetail: { serverId: server.serverId }
        })
      );
    }
    seenIds.add(server.serverId);

    if (server.command.length === 0) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_COMMAND_EMPTY",
          message: `Local MCP server '${server.serverId}' has an empty command.`,
          suggestedAction: "Provide a non-empty launch command.",
          traceId,
          redactedDetail: { serverId: server.serverId }
        })
      );
    }

    if (containsShellMetacharacters(server.command)) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_COMMAND_INVALID",
          message: `Local MCP server '${server.serverId}' command contains shell metacharacters.`,
          suggestedAction:
            "The command is executed directly (not via a shell); remove shell metacharacters.",
          traceId,
          redactedDetail: { serverId: server.serverId }
        })
      );
    }

    if (!server.argv.every((item) => typeof item === "string")) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_ARGV_INVALID",
          message: `Local MCP server '${server.serverId}' has a non-string argv entry.`,
          suggestedAction: "Ensure all argv entries are strings.",
          traceId,
          redactedDetail: { serverId: server.serverId }
        })
      );
    }

    if (server.cwd.length === 0) {
      return err(
        validationError({
          code: "MCP_LOCAL_SERVER_CWD_EMPTY",
          message: `Local MCP server '${server.serverId}' has an empty cwd.`,
          suggestedAction:
            "Provide a project-relative path or an explicit absolute allowlisted path.",
          traceId,
          redactedDetail: { serverId: server.serverId }
        })
      );
    }
  }

  return ok(servers);
}

const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

function containsShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTERS.test(command);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
