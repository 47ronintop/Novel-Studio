/**
 * Phase E.3 - Remote Streamable HTTP MCP runtime (desktop Main process).
 *
 * Every request is delegated to a Main-process controlled dialer. This module
 * never uses the platform fetch directly; its default transport disables
 * redirects and binds any configured TLS pin to every socket handshake.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import {
  TOOL_DESCRIPTION_MAX_BYTES,
  TOOL_DIRECTORY_MAX_TOTAL_BYTES,
  TOOL_DISPLAY_NAME_MAX_BYTES,
  computeToolDirectoryBytes,
  validateStrictToolSchema,
  validateToolText
} from "@novel-studio/agent-engine";
import type { McpServerConfig } from "@novel-studio/application";
import {
  isHostAllowed,
  ControlledFetchError,
  type AgentNetworkPolicy,
  type ControlledFetch,
  type ControlledFetchResponse
} from "@novel-studio/application";
import type { ExternalToolDispatchPort } from "@novel-studio/application";
import {
  createMainControlledFetch,
  createOriginScopedControlledFetch,
  hasMainControlledFetchSecurity,
  normalizeTlsFingerprint
} from "./agent-network-dialer.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MAX_TOOL_COUNT = 64;
const MAX_SESSION_ID_BYTES = 512;
let nextConnectionSerial = 1;

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

/** A request crossed the transport boundary, so its side effect is uncertain. */
class McpRequestDeliveryAttemptedError extends Error {
  constructor(readonly original: unknown) {
    super("MCP request delivery was attempted.");
    this.name = "McpRequestDeliveryAttemptedError";
  }
}

interface RemoteMcpSettingsSnapshot {
  readonly revision: string;
  readonly config: McpServerConfig | undefined;
}

export interface RemoteMcpToolDescriptor {
  /** Canonical ID in the form "mcp:<serverId>/<toolId>". */
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
    suggestedAction: "Check the MCP server configuration and network policy.",
    traceId: "remote-mcp-runtime"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function endpointIdentity(endpointUrl: string): string | undefined {
  try {
    return new URL(endpointUrl).href;
  } catch {
    return undefined;
  }
}

function sameRemoteConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.transport !== "remote_http" || b.transport !== "remote_http") return false;
  return (
    a.serverId === b.serverId &&
    a.enabled === b.enabled &&
    endpointIdentity(a.endpointUrl) === endpointIdentity(b.endpointUrl) &&
    a.apiKeyRef === b.apiKeyRef &&
    a.tlsFingerprint === b.tlsFingerprint
  );
}

function validateJsonRpcResponse(body: string, expectedId: string): JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw mcpError("MCP_INVALID_JSON", "MCP server returned invalid JSON.");
  }
  if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0" || parsed["id"] !== expectedId) {
    throw mcpError(
      "MCP_INVALID_RESPONSE",
      "MCP server returned an invalid or mismatched JSON-RPC response."
    );
  }

  const hasResult = Object.hasOwn(parsed, "result");
  const hasError = Object.hasOwn(parsed, "error");
  if (hasResult === hasError) {
    throw mcpError(
      "MCP_INVALID_RESPONSE",
      "MCP response must contain exactly one of result or error."
    );
  }
  if (hasError) {
    const error = parsed["error"];
    if (
      !isRecord(error) ||
      typeof error["code"] !== "number" ||
      typeof error["message"] !== "string"
    ) {
      throw mcpError("MCP_INVALID_RESPONSE", "MCP server returned an invalid JSON-RPC error.");
    }
  }
  return parsed as unknown as JsonRpcResponse;
}

function validateStreamableRpcResponse(
  response: ControlledFetchResponse,
  expectedId: string
): JsonRpcResponse {
  const contentType = response.contentType?.toLowerCase().split(";", 1)[0]?.trim();
  if (contentType === "application/json") return validateJsonRpcResponse(response.body, expectedId);
  if (contentType !== "text/event-stream") {
    throw mcpError(
      "MCP_INVALID_CONTENT_TYPE",
      "MCP responses must use application/json or text/event-stream."
    );
  }

  const events = response.body.replace(/\r\n/g, "\n").split("\n\n");
  for (const event of events) {
    if (event.length === 0 || event.startsWith(":")) continue;
    const lines = event.split("\n");
    const eventName = lines
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if ((eventName !== undefined && eventName !== "message") || data.length === 0) {
      throw mcpError("MCP_INVALID_RESPONSE", "MCP stream contained an unsupported event.");
    }
    return validateJsonRpcResponse(data, expectedId);
  }
  throw mcpError("MCP_INVALID_RESPONSE", "MCP stream did not contain a JSON-RPC response.");
}

function responseHeader(response: ControlledFetchResponse, name: string): string | undefined {
  const headers = (
    response as ControlledFetchResponse & {
      readonly headers?: Readonly<Record<string, string>>;
    }
  ).headers;
  if (headers === undefined) return undefined;
  return headers[name.toLowerCase()];
}

function hasDisallowedControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function sessionIdFrom(
  response: ControlledFetchResponse,
  existing: string | undefined
): string | undefined {
  const received = responseHeader(response, "mcp-session-id");
  if (received === undefined) {
    if (existing !== undefined) {
      throw mcpError(
        "MCP_SESSION_MISMATCH",
        "MCP server unexpectedly omitted its session identifier."
      );
    }
    return undefined;
  }
  const byteLength = new TextEncoder().encode(received).byteLength;
  if (
    received.length === 0 ||
    byteLength > MAX_SESSION_ID_BYTES ||
    hasDisallowedControlCharacters(received)
  ) {
    throw mcpError("MCP_INVALID_SESSION", "MCP server returned an invalid session identifier.");
  }
  if (existing !== undefined && existing !== received) {
    throw mcpError(
      "MCP_SESSION_MISMATCH",
      "MCP server changed its session identifier during a connection."
    );
  }
  return received;
}

function validateHttpResponse(
  response: ControlledFetchResponse,
  endpointUrl: string,
  expectedSessionId: string | undefined
): string | undefined {
  if (response.truncated) {
    throw mcpError(
      "MCP_RESPONSE_TRUNCATED",
      "MCP server response exceeded the configured response limit."
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw mcpError("MCP_HTTP_STATUS", `MCP server returned HTTP ${String(response.status)}.`);
  }
  if (endpointIdentity(response.url) !== endpointUrl) {
    throw mcpError(
      "MCP_ENDPOINT_IDENTITY_MISMATCH",
      "MCP request was redirected or reached a different endpoint."
    );
  }
  return sessionIdFrom(response, expectedSessionId);
}

function validateTools(
  rawTools: unknown,
  config: McpServerConfig
): Result<readonly RemoteMcpToolDescriptor[], UnifiedError> {
  if (!Array.isArray(rawTools)) {
    return err(
      mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tools/list result did not contain a tools array.")
    );
  }
  if (rawTools.length > MAX_TOOL_COUNT) {
    return err(
      mcpError(
        "MCP_TOO_MANY_TOOLS",
        `MCP server advertised ${rawTools.length} tools, exceeding limit of ${MAX_TOOL_COUNT}.`
      )
    );
  }

  const seenIds = new Set<string>();
  const tools: RemoteMcpToolDescriptor[] = [];
  for (const raw of rawTools) {
    if (!isRecord(raw)) {
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tool descriptor must be an object."));
    }
    const toolId = raw["name"];
    const description = raw["description"];
    const inputSchema = raw["inputSchema"];
    const title = raw["title"];
    if (
      typeof toolId !== "string" ||
      toolId.length === 0 ||
      toolId.includes(":") ||
      toolId.includes("/")
    ) {
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tool has an invalid or reserved name."));
    }
    if (seenIds.has(toolId)) {
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", `MCP tool '${toolId}' is duplicated.`));
    }
    seenIds.add(toolId);
    const nameCheck = validateToolText(toolId, TOOL_DISPLAY_NAME_MAX_BYTES, "Tool name");
    if (!nameCheck.ok) return err(mcpError("MCP_TOOL_SOURCE_INVALID", nameCheck.reason));
    if (typeof description !== "string") {
      return err(
        mcpError("MCP_TOOL_SOURCE_INVALID", `MCP tool '${toolId}' is missing a description.`)
      );
    }
    const descriptionCheck = validateToolText(
      description,
      TOOL_DESCRIPTION_MAX_BYTES,
      "Tool description"
    );
    if (!descriptionCheck.ok)
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", descriptionCheck.reason));
    if (title !== undefined && typeof title !== "string") {
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", `MCP tool '${toolId}' has an invalid title.`));
    }
    const displayName = typeof title === "string" ? title : toolId;
    const titleCheck = validateToolText(displayName, TOOL_DISPLAY_NAME_MAX_BYTES, "Tool title");
    if (!titleCheck.ok) return err(mcpError("MCP_TOOL_SOURCE_INVALID", titleCheck.reason));
    if (!isRecord(inputSchema)) {
      return err(
        mcpError("MCP_TOOL_SOURCE_INVALID", `MCP tool '${toolId}' has no object inputSchema.`)
      );
    }
    const schemaCheck = validateStrictToolSchema(inputSchema);
    if (!schemaCheck.ok) return err(mcpError("MCP_TOOL_SOURCE_INVALID", schemaCheck.reason));

    tools.push({
      canonicalId: `mcp:${config.serverId}/${toolId}`,
      serverId: config.serverId,
      toolId,
      displayName,
      description,
      inputSchema: inputSchema as JsonObject,
      effect: "external_action",
      retrySemantics: "never_automatic",
      source: "remote_mcp"
    });
  }

  const totalBytes = computeToolDirectoryBytes(
    tools.map((tool) => ({
      name: tool.toolId,
      inputSchema: tool.inputSchema,
      description: tool.description,
      displayName: tool.displayName
    }))
  );
  if (totalBytes > TOOL_DIRECTORY_MAX_TOTAL_BYTES) {
    return err(
      mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tool directory exceeds the configured byte budget.")
    );
  }
  return ok(tools);
}

/**
 * Connect to a remote MCP server over the Streamable HTTP transport.
 * `controlledFetch` must be a verified Main-process dialer. It is deliberately
 * mandatory so this module cannot accidentally fall back to browser/Node DNS.
 */
export async function connectRemoteMcp(input: {
  readonly config: McpServerConfig;
  readonly policy: AgentNetworkPolicy;
  readonly controlledFetch?: ControlledFetch;
  readonly resolveApiKey?: (apiKeyRef: string) => string | undefined;
  readonly signal?: AbortSignal;
  /** Settings revision captured when this run was created. */
  readonly configRevision?: string;
  /** Reads the current config so calls fail closed after settings change. */
  readonly readCurrentConfig?: () => Promise<Result<RemoteMcpSettingsSnapshot, UnifiedError>>;
}): Promise<Result<RemoteMcpConnection, UnifiedError>> {
  const { config, policy } = input;
  if (config.transport !== "remote_http") {
    return err(
      mcpError("MCP_INVALID_TRANSPORT", "connectRemoteMcp requires a remote_http server config.")
    );
  }
  if (!config.enabled) {
    return err(mcpError("MCP_SERVER_DISABLED", `MCP server '${config.serverId}' is disabled.`));
  }
  if (!policy.enabled) {
    return err(mcpError("NETWORK_POLICY_DISABLED", "Agent network access is disabled."));
  }
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpointUrl);
  } catch {
    return err(mcpError("MCP_INVALID_ENDPOINT", `Invalid endpoint URL: ${config.endpointUrl}`));
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.hash !== ""
  ) {
    return err(
      mcpError(
        "MCP_INVALID_ENDPOINT",
        "Remote MCP endpoints must be credential-free HTTPS URLs without fragments."
      )
    );
  }
  if (!isHostAllowed(policy, endpoint.hostname.toLowerCase())) {
    return err(
      mcpError(
        "NETWORK_HOST_NOT_ALLOWED",
        `MCP server host '${endpoint.hostname}' is not in the allowedHosts list.`
      )
    );
  }
  if (input.configRevision !== undefined && input.readCurrentConfig === undefined) {
    return err(
      mcpError(
        "MCP_CONFIG_SNAPSHOT_REQUIRED",
        "A config revision requires a current settings snapshot reader."
      )
    );
  }
  const tlsFingerprint =
    config.tlsFingerprint === undefined
      ? undefined
      : normalizeTlsFingerprint(config.tlsFingerprint);
  if (config.tlsFingerprint !== undefined && tlsFingerprint === undefined) {
    return err(
      mcpError(
        "MCP_INVALID_TLS_FINGERPRINT",
        "MCP TLS fingerprint must be a SHA-256 certificate fingerprint."
      )
    );
  }

  const endpointUrl = endpoint.href;
  const apiKey = input.resolveApiKey?.(config.apiKeyRef);
  // The Main-owned dialer checks a configured certificate pin in its actual
  // HTTPS handshake on every request. An opaque injected fetcher cannot make
  // that assertion, so pinned servers fail closed rather than relying on a
  // one-time, drift-prone preflight probe.
  if (
    input.controlledFetch !== undefined &&
    tlsFingerprint !== undefined &&
    !hasMainControlledFetchSecurity(input.controlledFetch, {
      tlsFingerprint,
      rejectRedirects: true
    })
  ) {
    return err(
      mcpError(
        "MCP_TLS_IDENTITY_UNVERIFIED",
        "A pinned MCP server requires a Main-owned TLS-pinned transport."
      )
    );
  }
  // Secrets are bound inside the Main-owned dialer, never placed in a generic
  // request header. Remote MCP forbids redirects even without a credential.
  const remoteDialerOptions = {
    rejectRedirects: true,
    ...(tlsFingerprint === undefined ? {} : { tlsFingerprint })
  };
  const fetch_ =
    input.controlledFetch ??
    (apiKey === undefined
      ? createMainControlledFetch(policy, remoteDialerOptions)
      : createOriginScopedControlledFetch(
          policy,
          {
            origin: endpoint.origin,
            authorization: `Bearer ${apiKey}`,
            rejectRedirects: true
          },
          remoteDialerOptions
        ));
  const connectionId = `mcp-${Date.now().toString(36)}-${String(nextConnectionSerial++)}`;
  let requestSequence = 0;
  let sessionId: string | undefined;
  let closed = false;

  async function assertCurrentConfig(): Promise<Result<void, UnifiedError>> {
    if (closed)
      return err(mcpError("MCP_CONNECTION_CLOSED", "The MCP connection is already closed."));
    if (input.readCurrentConfig === undefined) return ok(undefined);
    const current = await input.readCurrentConfig();
    if (!current.ok) return current;
    if (
      current.value.config === undefined ||
      !sameRemoteConfig(config, current.value.config) ||
      (input.configRevision !== undefined && current.value.revision !== input.configRevision)
    ) {
      return err(
        mcpError("MCP_CONFIG_CHANGED", "MCP configuration changed after this run was created.")
      );
    }
    return ok(undefined);
  }

  async function sendRequest(
    method: string,
    params: JsonObject,
    signal?: AbortSignal
  ): Promise<JsonRpcResponse> {
    const current = await assertCurrentConfig();
    if (!current.ok) throw current.error;
    if (signal?.aborted)
      throw mcpError("MCP_REQUEST_ABORTED", "MCP request was aborted before delivery.");
    const id = `${connectionId}-${String(++requestSequence)}`;
    try {
      // From this point onward an HTTP request may have reached the server.
      // Preserve that fact for tools/call rather than classifying malformed or
      // non-2xx responses as safely retryable failures.
      const response = await fetch_({
        url: endpointUrl,
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId })
        },
        ...(signal === undefined ? {} : { signal })
      });
      const nextSession = validateHttpResponse(response, endpointUrl, sessionId);
      sessionId = nextSession;
      return validateStreamableRpcResponse(response, id);
    } catch (error) {
      throw new McpRequestDeliveryAttemptedError(error);
    }
  }

  async function sendNotification(
    method: string,
    params: JsonObject,
    signal?: AbortSignal
  ): Promise<void> {
    const current = await assertCurrentConfig();
    if (!current.ok) throw current.error;
    if (signal?.aborted)
      throw mcpError("MCP_REQUEST_ABORTED", "MCP notification was aborted before delivery.");
    const response = await fetch_({
      url: endpointUrl,
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId })
      },
      ...(signal === undefined ? {} : { signal })
    });
    sessionId = validateHttpResponse(response, endpointUrl, sessionId);
  }

  let initResponse: JsonRpcResponse;
  try {
    initResponse = await sendRequest(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "novel-studio-agent", version: "1.0" }
      },
      input.signal
    );
  } catch (error) {
    return err(toMcpConnectionError(error, "MCP_CONNECT_FAILED", "MCP initialization failed."));
  }
  if (initResponse.error !== undefined) {
    return err(
      mcpError("MCP_INIT_FAILED", `MCP server returned error: ${initResponse.error.message}`)
    );
  }
  const initResult = initResponse.result;
  if (!isRecord(initResult) || initResult["protocolVersion"] !== MCP_PROTOCOL_VERSION) {
    return err(
      mcpError("MCP_PROTOCOL_MISMATCH", "MCP server did not select the requested protocol version.")
    );
  }

  try {
    await sendNotification("notifications/initialized", {}, input.signal);
  } catch (error) {
    return err(
      toMcpConnectionError(
        error,
        "MCP_INITIALIZED_NOTIFICATION_FAILED",
        "MCP initialized notification failed."
      )
    );
  }

  let toolsListResponse: JsonRpcResponse;
  try {
    toolsListResponse = await sendRequest("tools/list", {}, input.signal);
  } catch (error) {
    return err(toMcpConnectionError(error, "MCP_TOOLS_LIST_FAILED", "MCP tools/list failed."));
  }
  if (toolsListResponse.error !== undefined) {
    return err(
      mcpError("MCP_TOOLS_LIST_ERROR", `MCP tools/list error: ${toolsListResponse.error.message}`)
    );
  }
  if (!isRecord(toolsListResponse.result)) {
    return err(mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tools/list result must be an object."));
  }
  const tools = validateTools(toolsListResponse.result["tools"], config);
  if (!tools.ok) return tools;

  return ok({
    serverId: config.serverId,
    tools: tools.value,
    async callTool(toolId, args, idempotencyKey, signal) {
      if (signal.aborted) {
        return unknownOutcome(
          "The MCP tool call was cancelled before delivery could be confirmed. Manual recovery may be required."
        );
      }
      if (closed) {
        return unknownOutcome(
          "The MCP connection was already closed before delivery could be confirmed. Manual recovery may be required."
        );
      }
      try {
        const response = await sendRequest(
          "tools/call",
          {
            name: toolId,
            arguments: args,
            ...(idempotencyKey === undefined
              ? {}
              : { _meta: { "novel-studio/idempotencyKey": idempotencyKey } })
          },
          signal
        );
        if (response.error !== undefined) {
          return {
            status: "error" as const,
            error: mcpError(
              "MCP_TOOL_CALL_ERROR",
              `MCP tool '${toolId}' returned error: ${response.error.message}`
            )
          };
        }
        if (!isRecord(response.result)) {
          closed = true;
          return unknownOutcome(
            "MCP tool delivery was acknowledged, but its result was invalid. Do not retry automatically."
          );
        }
        return { status: "completed" as const, result: response.result as JsonObject };
      } catch (error) {
        if (
          signal.aborted ||
          error instanceof McpRequestDeliveryAttemptedError ||
          isUncertainDelivery(error)
        ) {
          closed = true;
          return unknownOutcome(
            "MCP tool delivery could not be confirmed. Do not retry automatically."
          );
        }
        return {
          status: "error" as const,
          error: toMcpConnectionError(error, "MCP_TOOL_CALL_FAILED", "MCP tool call failed.")
        };
      }
    },
    close() {
      closed = true;
    }
  });
}

function unknownOutcome(reason: string): {
  readonly status: "outcome_unknown";
  readonly reason: string;
} {
  return { status: "outcome_unknown", reason };
}

function isUncertainDelivery(error: unknown): boolean {
  return (
    error instanceof ControlledFetchError &&
    (error.code === "NETWORK_TOTAL_TIMEOUT" ||
      error.code === "NETWORK_CONNECT_TIMEOUT" ||
      error.code === "NETWORK_ABORTED")
  );
}

function toMcpConnectionError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): UnifiedError {
  if (error instanceof McpRequestDeliveryAttemptedError) {
    return toMcpConnectionError(error.original, fallbackCode, fallbackMessage);
  }
  if (
    isRecord(error) &&
    typeof error["code"] === "string" &&
    typeof error["message"] === "string"
  ) {
    return error as unknown as UnifiedError;
  }
  if (error instanceof ControlledFetchError) return mcpError(error.code, error.message);
  return mcpError(fallbackCode, error instanceof Error ? error.message : fallbackMessage);
}

/** Create an ExternalToolDispatchPort backed by one RemoteMcpConnection. */
export function createRemoteMcpDispatch(connection: RemoteMcpConnection): ExternalToolDispatchPort {
  return {
    async callTool(input) {
      const prefix = `mcp:${connection.serverId}/`;
      const toolId = input.canonicalToolId.startsWith(prefix)
        ? input.canonicalToolId.slice(prefix.length)
        : input.canonicalToolId;
      if (!connection.tools.some((tool) => tool.toolId === toolId)) {
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
