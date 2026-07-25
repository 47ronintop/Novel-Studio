/**
 * Main-only persistence for Agent network and remote-MCP settings. Renderer payloads only contain
 * secret references, never plaintext credentials. Malformed or missing files fail closed to the
 * disabled defaults rather than widening any Agent capability.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DEFAULT_MCP_SETTINGS,
  DEFAULT_NETWORK_SETTINGS,
  type AgentNetworkSettingsData,
  type AgentNetworkSettingsPort,
  type McpSettingsData,
  type McpSettingsPort
} from "@novel-studio/application";
import { writeTextAtomically } from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const SETTINGS_DIRECTORY = "agent-tool-settings";
const NETWORK_SETTINGS_FILE = "network.json";
const MCP_SETTINGS_FILE = "remote-mcp.json";

export function createDesktopAgentNetworkSettingsPort(input: {
  readonly userDataRoot: string;
}): AgentNetworkSettingsPort {
  const targetPath = join(input.userDataRoot, SETTINGS_DIRECTORY, NETWORK_SETTINGS_FILE);
  return {
    async readNetworkSettings() {
      const stored = await readSettingsFile(targetPath, DEFAULT_NETWORK_SETTINGS);
      return stored.ok ? ok(parseNetworkSettings(stored.value)) : stored;
    },
    async writeNetworkSettings(settings) {
      return writeSettingsFile(targetPath, settings);
    }
  };
}

export function createDesktopMcpSettingsPort(input: {
  readonly userDataRoot: string;
}): McpSettingsPort {
  const targetPath = join(input.userDataRoot, SETTINGS_DIRECTORY, MCP_SETTINGS_FILE);
  return {
    async readMcpSettings() {
      const stored = await readSettingsFile(targetPath, DEFAULT_MCP_SETTINGS);
      return stored.ok ? ok(parseMcpSettings(stored.value)) : stored;
    },
    async writeMcpSettings(settings) {
      return writeSettingsFile(targetPath, settings);
    }
  };
}

async function readSettingsFile<T>(
  targetPath: string,
  fallback: T
): Promise<Result<unknown, UnifiedError>> {
  try {
    return ok(JSON.parse(await readFile(targetPath, "utf8")) as unknown);
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return ok(fallback);
    return err(
      settingsStoreError(
        "AGENT_TOOL_SETTINGS_READ_FAILED",
        "Agent tool settings could not be read."
      )
    );
  }
}

async function writeSettingsFile<T>(
  targetPath: string,
  settings: T
): Promise<Result<T, UnifiedError>> {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
  } catch {
    return err(
      settingsStoreError(
        "AGENT_TOOL_SETTINGS_WRITE_FAILED",
        "Agent tool settings directory could not be created."
      )
    );
  }
  const written = await writeTextAtomically({
    targetPath,
    content: `${JSON.stringify(settings, null, 2)}\n`,
    traceId: "desktop-agent-tool-settings"
  });
  return written.ok ? ok(settings) : written;
}

function parseNetworkSettings(value: unknown): AgentNetworkSettingsData {
  if (!isRecord(value)) return DEFAULT_NETWORK_SETTINGS;
  const { enabled, providerProfiles, allowedHosts, dataEgressPolicy, policyRevision } = value;
  if (
    typeof enabled !== "boolean" ||
    !Array.isArray(providerProfiles) ||
    !providerProfiles.every(isNetworkProviderProfile) ||
    !Array.isArray(allowedHosts) ||
    !allowedHosts.every((host): host is string => typeof host === "string") ||
    (dataEgressPolicy !== "require_confirmation" &&
      dataEgressPolicy !== "auto_approve_search_queries") ||
    typeof policyRevision !== "string"
  ) {
    return DEFAULT_NETWORK_SETTINGS;
  }
  return value as unknown as AgentNetworkSettingsData;
}

function isNetworkProviderProfile(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value["providerId"] === "string" &&
    typeof value["name"] === "string" &&
    typeof value["apiKeyRef"] === "string" &&
    typeof value["endpoint"] === "string" &&
    typeof value["policyRevision"] === "string"
  );
}

function parseMcpSettings(value: unknown): McpSettingsData {
  if (
    !isRecord(value) ||
    !Array.isArray(value["servers"]) ||
    typeof value["revision"] !== "string"
  ) {
    return DEFAULT_MCP_SETTINGS;
  }
  return value as unknown as McpSettingsData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function settingsStoreError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message,
    recoverability: "user-action",
    suggestedAction: "Check the application data directory and retry.",
    traceId: "desktop-agent-tool-settings"
  });
}
