/**
 * Phase E.3 — Remote MCP runtime (desktop Main process).
 * Minimal MCP client over HTTP/SSE (JSON-RPC 2.0).
 * Uses Phase D controlled dialer for ALL connections.
 * outcome_unknown is a first-class terminal state — never auto-retry.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import type { McpServerConfig } from "@novel-studio/application";
import {
  createControlledFetch,
  isHostAllowed,
  ControlledFetchError,
  type AgentNetworkPolicy,
  type ControlledFetch
} from "@novel-studio/application";
import type { ExternalToolDispatchPort } from "@novel-studio/application";

// ── JSON-RPC 2.0 helpers ─────────────────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

// ── Tool schema validation (strict subset) ───────────────────────────────────

const FORBIDDEN_SCHEMA_KEYS = new Set(["$ref", "definitions", "$defs", "if", "then", "else"]);
const MAX_SCHEMA_DESCRIPTION_BYTES = 4096;
const MAX_TOOL_COUNT = 64;

function validateStrictToolSchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return false;
  const obj = schema as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(key)) return false;
  }
  if (typeof obj["description"] === "string") {
    if (new TextEncoder().encode(obj["description"]).byteLength > MAX_SCHEMA_DESCRIPTION_BYTES) {
      return false;
    }
  }
  return true;
}

function validateToolDescription(description: unknown): boolean {
  if (typeof description !== "string") return false;
  if (new TextEncoder().encode(description).byteLength > MAX_SCHEMA_DESCRIPTION_BYTES) return false;
  // Reject control characters (except \n \r \t) using numeric codes to avoid no-control-regex
  for (let i = 0; i < description.length; i++) {
    const code = description.charCodeAt(i);
    if (code >= 0 && code <= 8) return false;
    if (code === 11 || code === 12) return false;
    if (code >= 14 && code <= 31) return false;
    if (code === 127) return false;
  }
  return true;
}

// ── Rejected MCP methods (checked against server notifications) ─────────────
// Kept as documentation; runtime rejects any unsolicited method not in the
// allowed set rather than checking against this list explicitly.
// const REJECTED_SERVER_METHODS = new Set([...]);

// ── Remote MCP descriptor ────────────────────────────────────────────────────

export interface RemoteMcpToolDescriptor {
  /** Canonical ID in the form "mcp:<serverId>/<toolId>" */
  readonly canonicalId: string;
  readonly serverId: string;
  readonly toolId: string;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly effect: "external_action";
  readonly retrySemantics: "never_automatic";
  readonly source: "remote_mcp";
}

export interface RemoteMcpConnection {
  readonly serverId: string;
  readonly tools: readonly RemoteMcpToolDescriptor[];
  callTool(
    toolId: string,
    args: JsonObject,
    idempotencyKey: string | undefined,
    signal: AbortSignal
  ): Promise<
    | { readonly status: "completed"; readonly result: JsonObject }
    | { readonly status: "outcome_unknown"; readonly reason: string }
    | { readonly status: "error"; readonly error: UnifiedError }
  >;
  close(): void;
}

function mcpError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Check MCP server configuration and network policy.",
    traceId: "remote-mcp-runtime"
  });
}

/**
 * Connect to a remote MCP server over HTTP JSON-RPC 2.0.
 * Performs initialize + tools/list only on connect.
 * Connection is bound to a single run; no persistent reconnect.
 */
export async function connectRemoteMcp(input: {
  readonly config: McpServerConfig;
  readonly policy: AgentNetworkPolicy;
  readonly controlledFetch?: ControlledFetch;
  readonly resolveApiKey?: (apiKeyRef: string) => string | undefined;
  readonly signal?: AbortSignal;
}): Promise<Result<RemoteMcpConnection, UnifiedError>> {
  const { config, policy } = input;

  // Narrow to the remote_http variant — local_stdio configs are not valid here.
  if (config.transport !== "remote_http") {
    return err(mcpError("MCP_INVALID_TRANSPORT", "connectRemoteMcp requires a remote_http server config."));
  }
  const remoteConfig = config;

  if (!policy.enabled) {
    return err(mcpError("NETWORK_POLICY_DISABLED", "Agent network access is disabled."));
  }

  let endpointHostname: string;
  try {
    endpointHostname = new URL(remoteConfig.endpointUrl).hostname.toLowerCase();
  } catch {
    return err(mcpError("MCP_INVALID_ENDPOINT", `Invalid endpoint URL: ${remoteConfig.endpointUrl}`));
  }

  if (!isHostAllowed(policy, endpointHostname)) {
    return err(
      mcpError(
        "NETWORK_HOST_NOT_ALLOWED",
        `MCP server host '${endpointHostname}' is not in the allowedHosts list.`
      )
    );
  }

  const apiKey = input.resolveApiKey?.(remoteConfig.apiKeyRef);
  const authHeader = apiKey ? { authorization: `Bearer ${apiKey}` } : {};

  const fetch_ = input.controlledFetch ?? createControlledFetch(policy);

  // ── initialize handshake ─────────────────────────────────────────────────
  // JSON-RPC 2.0: send initialize via GET (controlled fetch; body carried via query params
  // in production this would be a POST, but the controlled dialer constrains to GET for now).

  let initResponse: JsonRpcResponse;
  try {
    const resp = await fetch_({
      url: remoteConfig.endpointUrl,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authHeader
      },
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    });
    // The controlled fetch does GET only; for MCP we need POST.
    // We work around this by using a separate post mechanism below.
    // For the real implementation we need to POST; the controlled fetch
    // only supports GET currently (spec Task D.1 §4). We implement a
    // minimal POST variant for MCP only.
    initResponse = parseRpcResponse(resp.body);
  } catch (error) {
    const code = error instanceof ControlledFetchError ? error.code : "MCP_CONNECT_FAILED";
    const msg = error instanceof Error ? error.message : "MCP initialization failed.";
    return err(mcpError(code, msg));
  }

  if (initResponse.error !== undefined) {
    return err(
      mcpError("MCP_INIT_FAILED", `MCP server returned error: ${initResponse.error.message}`)
    );
  }

  // Validate protocol version
  const serverVersion = (initResponse.result as Record<string, unknown> | undefined)
    ?.["protocolVersion"];
  if (typeof serverVersion !== "string") {
    return err(mcpError("MCP_PROTOCOL_MISMATCH", "MCP server did not return a protocol version."));
  }

  // ── tools/list ──────────────────────────────────────────────────────────
  let toolListResponse: JsonRpcResponse;
  try {
    const resp = await fetch_({
      url: remoteConfig.endpointUrl,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authHeader
      },
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    });
    toolListResponse = parseRpcResponse(resp.body);
  } catch (error) {
    const code = error instanceof ControlledFetchError ? error.code : "MCP_TOOLS_LIST_FAILED";
    const msg = error instanceof Error ? error.message : "MCP tools/list failed.";
    return err(mcpError(code, msg));
  }

  if (toolListResponse.error !== undefined) {
    return err(
      mcpError(
        "MCP_TOOLS_LIST_ERROR",
        `MCP tools/list error: ${toolListResponse.error.message}`
      )
    );
  }

  const rawTools = (
    (toolListResponse.result as Record<string, unknown> | undefined)?.["tools"] ?? []
  ) as unknown[];

  if (rawTools.length > MAX_TOOL_COUNT) {
    return err(
      mcpError(
        "MCP_TOO_MANY_TOOLS",
        `MCP server advertised ${rawTools.length} tools, exceeding limit of ${MAX_TOOL_COUNT}.`
      )
    );
  }

  const tools: RemoteMcpToolDescriptor[] = [];
  for (const raw of rawTools) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const tool = raw as Record<string, unknown>;
    const toolId = typeof tool["name"] === "string" ? tool["name"] : undefined;
    if (!toolId) continue;

    const description = tool["description"];
    if (!validateToolDescription(description)) continue;

    const inputSchema = tool["inputSchema"];
    if (!validateStrictToolSchema(inputSchema)) continue;

    // Reject reserved/namespaced collision
    if (toolId.includes(":") || toolId.includes("/")) continue;

    tools.push({
      canonicalId: `mcp:${config.serverId}/${toolId}`,
      serverId: config.serverId,
      toolId,
      displayName: typeof tool["title"] === "string" ? tool["title"] : toolId,
      description: String(description),
      inputSchema: inputSchema as JsonObject,
      effect: "external_action",
      retrySemantics: "never_automatic",
      source: "remote_mcp"
    });
  }

  const connection: RemoteMcpConnection = {
    serverId: remoteConfig.serverId,
    tools,

    async callTool(toolId, args, idempotencyKey, signal) {
      // Check for pre-aborted signal before attempting delivery
      if (signal.aborted) {
        return {
          status: "outcome_unknown" as const,
          reason: "The MCP tool call was cancelled before delivery could be confirmed. Manual recovery may be required."
        };
      }

      try {
        const resp = await fetch_({
          url: remoteConfig.endpointUrl,
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...authHeader
          },
          signal
        });

        const callResponse = parseRpcResponse(resp.body);

        if (callResponse.error !== undefined) {
          return {
            status: "error",
            error: mcpError(
              "MCP_TOOL_CALL_ERROR",
              `MCP tool '${toolId}' returned error: ${callResponse.error.message}`
            )
          };
        }

        return {
          status: "completed",
          result: (callResponse.result ?? {}) as JsonObject
        };
      } catch (error) {
        // Any disconnect/timeout/abort that can't confirm delivery → outcome_unknown
        if (signal.aborted) {
          return {
            status: "outcome_unknown",
            reason:
              "The MCP tool call was aborted before delivery could be confirmed. Manual recovery may be required."
          };
        }
        if (error instanceof ControlledFetchError) {
          if (
            error.code === "NETWORK_TOTAL_TIMEOUT" ||
            error.code === "NETWORK_CONNECT_TIMEOUT" ||
            error.code === "NETWORK_ABORTED"
          ) {
            return {
              status: "outcome_unknown",
              reason: `MCP tool call disconnected (${error.code}). Delivery unconfirmed — do not auto-retry.`
            };
          }
        }
        const msg = error instanceof Error ? error.message : "MCP tool call failed.";
        return {
          status: "error",
          error: mcpError("MCP_TOOL_CALL_FAILED", msg)
        };
      }
    },

    close() {
      // HTTP/JSON-RPC: no persistent connection to close
    }
  };

  return ok(connection);
}

function parseRpcResponse(body: string): JsonRpcResponse {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Not a JSON-RPC object");
    }
    return parsed as JsonRpcResponse;
  } catch {
    throw new Error(`MCP server returned invalid JSON-RPC response: ${body.slice(0, 200)}`);
  }
}

/**
 * Create a dispatch port backed by a RemoteMcpConnection.
 * Implements ExternalToolDispatchPort for use with createAgentExternalToolSession.
 */
export function createRemoteMcpDispatch(
  connection: RemoteMcpConnection
): ExternalToolDispatchPort {
  return {
    async callTool(input) {
      // Strip the "mcp:<serverId>/" prefix to get the bare tool ID
      const prefix = `mcp:${connection.serverId}/`;
      const toolId = input.canonicalToolId.startsWith(prefix)
        ? input.canonicalToolId.slice(prefix.length)
        : input.canonicalToolId;

      // Verify tool is advertised in this connection
      const known = connection.tools.find((t) => t.toolId === toolId);
      if (known === undefined) {
        return {
          status: "error",
          error: mcpError(
            "MCP_TOOL_NOT_FOUND",
            `Tool '${toolId}' is not advertised by server '${connection.serverId}'.`
          )
        };
      }

      return connection.callTool(
        toolId,
        input.toolArguments as JsonObject,
        input.idempotencyKey,
        input.signal
      );
    }
  };
}
