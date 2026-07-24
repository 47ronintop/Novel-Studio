/**
 * Task E.2 — Local stdio MCP runtime (desktop Main process).
 * Minimal MCP client over newline-delimited stdio JSON-RPC 2.0.
 * The process itself is launched by an INJECTED LocalMcpHostLauncher — this
 * file never imports node:child_process. agent-task-sandbox.ts remains the
 * only file allowed to spawn processes for task-related purposes; the real
 * wiring of LocalMcpHostLauncher to the verified native host happens during
 * integration, outside this file.
 * outcome_unknown is a first-class terminal state — never auto-retry.
 */
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { JsonObject } from "@novel-studio/shared";
import type { ExternalToolDispatchPort } from "@novel-studio/application";

// ── Injected process launcher (no node:child_process import here) ──────────

export interface LocalMcpProcessHandle {
  writeLine(line: string): void;
  onLine(handler: (line: string) => void): void;
  onExit(handler: (code: number | null) => void): void;
  kill(): void;
}

export interface LocalMcpHostLauncher {
  /**
   * Launches the given local server's stdio process inside the native host's
   * verified "MCP" profile. Returns UNAVAILABLE (never throws, never falls
   * back to a bare spawn) when the host/profile can't be verified.
   */
  launchLocalMcpServer(input: {
    readonly serverId: string;
    readonly signal: AbortSignal;
  }): Promise<Result<LocalMcpProcessHandle, UnifiedError>>;
}

// ── JSON-RPC 2.0 helpers ─────────────────────────────────────────────────────

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

const LOCAL_MCP_PROTOCOL_VERSION = "2024-11-05";
const LOCAL_MCP_HANDSHAKE_TIMEOUT_MS = 30_000;
const LOCAL_MCP_CALL_TIMEOUT_MS = 60_000;

type SendOutcome =
  | { readonly kind: "response"; readonly response: JsonRpcResponse }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" };

interface StdioJsonRpcClient {
  send(
    method: string,
    params: JsonObject,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<SendOutcome>;
  dispose(): void;
}

/**
 * Wraps a LocalMcpProcessHandle with request/response correlation over
 * newline-delimited JSON-RPC 2.0. Registers onLine/onExit exactly once for
 * the lifetime of the connection; every send() call gets its own numeric id.
 */
function createStdioJsonRpcClient(handle: LocalMcpProcessHandle): StdioJsonRpcClient {
  let nextId = 1;
  let exitedWith: { readonly code: number | null } | undefined;
  const pending = new Map<number, (outcome: SendOutcome) => void>();

  handle.onLine((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Malformed line: fail closed by ignoring it rather than crashing.
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;

    const obj = parsed as Record<string, unknown>;
    const id = obj["id"];
    // Unsolicited notifications (no numeric id, or id we never sent) are
    // ignored — the client never acts on unknown server-initiated messages.
    if (typeof id !== "number") return;

    const resolver = pending.get(id);
    if (resolver === undefined) return;
    pending.delete(id);
    resolver({ kind: "response", response: obj as unknown as JsonRpcResponse });
  });

  handle.onExit((code) => {
    exitedWith = { code };
    for (const resolver of pending.values()) {
      resolver({ kind: "exited", code });
    }
    pending.clear();
  });

  return {
    send(method, params, timeoutMs, signal) {
      return new Promise<SendOutcome>((resolve) => {
        if (signal.aborted) {
          resolve({ kind: "aborted" });
          return;
        }
        if (exitedWith !== undefined) {
          resolve({ kind: "exited", code: exitedWith.code });
          return;
        }

        const id = nextId;
        nextId += 1;
        let settled = false;

        const timer = setTimeout(() => {
          settle({ kind: "timeout" });
        }, timeoutMs);

        function onAbort(): void {
          settle({ kind: "aborted" });
        }
        signal.addEventListener("abort", onAbort);

        function settle(outcome: SendOutcome): void {
          if (settled) return;
          settled = true;
          pending.delete(id);
          signal.removeEventListener("abort", onAbort);
          clearTimeout(timer);
          resolve(outcome);
        }

        pending.set(id, settle);

        const request = { jsonrpc: "2.0" as const, id, method, params };
        try {
          handle.writeLine(JSON.stringify(request));
        } catch {
          settle({ kind: "exited", code: null });
        }
      });
    },
    dispose() {
      pending.clear();
    }
  };
}

function toHandshakeError(outcome: SendOutcome, code: string, phase: string): UnifiedError | undefined {
  if (outcome.kind === "response") return undefined;
  if (outcome.kind === "aborted") {
    return mcpError("MCP_CONNECT_ABORTED", `Local MCP ${phase} was aborted before completion.`);
  }
  if (outcome.kind === "exited") {
    return mcpError(
      code,
      `Local MCP server process exited (code ${String(outcome.code)}) during ${phase}.`
    );
  }
  return mcpError(code, `Local MCP ${phase} timed out.`);
}

// ── Tool schema validation (strict subset — mirrors remote-mcp-runtime.ts) ──

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

// ── Local MCP descriptor ─────────────────────────────────────────────────────

export interface LocalMcpToolDescriptor {
  /** Canonical ID in the form "mcp:<serverId>/<toolId>" */
  readonly canonicalId: string;
  readonly serverId: string;
  readonly toolId: string;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly effect: "external_action";
  readonly retrySemantics: "never_automatic";
  readonly source: "local_mcp";
}

export interface LocalMcpConnection {
  readonly serverId: string;
  readonly tools: readonly LocalMcpToolDescriptor[];
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
    suggestedAction: "Check the local MCP server configuration and retry.",
    traceId: "local-mcp-runtime"
  });
}

/**
 * Connect to a local stdio MCP server via an injected LocalMcpHostLauncher.
 * Performs initialize + tools/list only on connect. Connection is bound to a
 * single run; no persistent reconnect. On any handshake failure the launched
 * process is killed before returning the error.
 */
export async function connectLocalMcp(input: {
  readonly serverId: string;
  readonly launcher: LocalMcpHostLauncher;
  readonly signal?: AbortSignal;
}): Promise<Result<LocalMcpConnection, UnifiedError>> {
  const signal = input.signal ?? new AbortController().signal;

  if (signal.aborted) {
    return err(mcpError("MCP_CONNECT_ABORTED", "Local MCP connection was aborted before launch."));
  }

  const launched = await input.launcher.launchLocalMcpServer({
    serverId: input.serverId,
    signal
  });
  if (!launched.ok) return launched;

  const handle = launched.value;
  const client = createStdioJsonRpcClient(handle);

  // ── initialize handshake ─────────────────────────────────────────────────
  const initOutcome = await client.send(
    "initialize",
    {
      protocolVersion: LOCAL_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "novel-studio-agent", version: "1.0" }
    },
    LOCAL_MCP_HANDSHAKE_TIMEOUT_MS,
    signal
  );
  const initHandshakeError = toHandshakeError(initOutcome, "MCP_CONNECT_FAILED", "initialize");
  if (initHandshakeError !== undefined) {
    handle.kill();
    return err(initHandshakeError);
  }
  const initResponse = (initOutcome as { readonly kind: "response"; readonly response: JsonRpcResponse })
    .response;
  if (initResponse.error !== undefined) {
    handle.kill();
    return err(
      mcpError("MCP_INIT_FAILED", `Local MCP server returned error: ${initResponse.error.message}`)
    );
  }
  const serverVersion = (initResponse.result as Record<string, unknown> | undefined)?.[
    "protocolVersion"
  ];
  if (typeof serverVersion !== "string") {
    handle.kill();
    return err(
      mcpError("MCP_PROTOCOL_MISMATCH", "Local MCP server did not return a protocol version.")
    );
  }

  // ── tools/list ──────────────────────────────────────────────────────────
  const toolsOutcome = await client.send("tools/list", {}, LOCAL_MCP_HANDSHAKE_TIMEOUT_MS, signal);
  const toolsHandshakeError = toHandshakeError(toolsOutcome, "MCP_TOOLS_LIST_FAILED", "tools/list");
  if (toolsHandshakeError !== undefined) {
    handle.kill();
    return err(toolsHandshakeError);
  }
  const toolsResponse = (
    toolsOutcome as { readonly kind: "response"; readonly response: JsonRpcResponse }
  ).response;
  if (toolsResponse.error !== undefined) {
    handle.kill();
    return err(
      mcpError("MCP_TOOLS_LIST_ERROR", `Local MCP tools/list error: ${toolsResponse.error.message}`)
    );
  }

  const rawTools = (
    (toolsResponse.result as Record<string, unknown> | undefined)?.["tools"] ?? []
  ) as unknown[];

  if (rawTools.length > MAX_TOOL_COUNT) {
    handle.kill();
    return err(
      mcpError(
        "MCP_TOO_MANY_TOOLS",
        `Local MCP server advertised ${rawTools.length} tools, exceeding limit of ${MAX_TOOL_COUNT}.`
      )
    );
  }

  const tools: LocalMcpToolDescriptor[] = [];
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
      canonicalId: `mcp:${input.serverId}/${toolId}`,
      serverId: input.serverId,
      toolId,
      displayName: typeof tool["title"] === "string" ? tool["title"] : toolId,
      description: String(description),
      inputSchema: inputSchema as JsonObject,
      effect: "external_action",
      retrySemantics: "never_automatic",
      source: "local_mcp"
    });
  }

  let closed = false;

  const connection: LocalMcpConnection = {
    serverId: input.serverId,
    tools,

    async callTool(toolId, args, idempotencyKey, callSignal) {
      // Check for pre-aborted signal before writing anything to the process.
      if (callSignal.aborted) {
        return {
          status: "outcome_unknown" as const,
          reason:
            "The local MCP tool call was cancelled before delivery could be confirmed. Manual recovery may be required."
        };
      }

      if (closed) {
        return {
          status: "outcome_unknown" as const,
          reason:
            "The local MCP connection was already closed before delivery could be confirmed. Manual recovery may be required."
        };
      }

      const outcome = await client.send(
        "tools/call",
        {
          name: toolId,
          arguments: args,
          ...(idempotencyKey !== undefined ? { idempotencyKey } : {})
        },
        LOCAL_MCP_CALL_TIMEOUT_MS,
        callSignal
      );

      if (outcome.kind === "aborted") {
        return {
          status: "outcome_unknown",
          reason:
            "The local MCP tool call was aborted before delivery could be confirmed. Manual recovery may be required."
        };
      }
      if (outcome.kind === "exited") {
        return {
          status: "outcome_unknown",
          reason: `The local MCP server process exited (code ${String(outcome.code)}) before confirming delivery. Delivery unconfirmed — do not auto-retry.`
        };
      }
      if (outcome.kind === "timeout") {
        return {
          status: "outcome_unknown",
          reason:
            "The local MCP tool call timed out before confirming delivery. Delivery unconfirmed — do not auto-retry."
        };
      }

      const response = outcome.response;
      if (response.error !== undefined) {
        return {
          status: "error",
          error: mcpError(
            "MCP_TOOL_CALL_ERROR",
            `Local MCP tool '${toolId}' returned error: ${response.error.message}`
          )
        };
      }

      return {
        status: "completed",
        result: (response.result ?? {}) as JsonObject
      };
    },

    close() {
      closed = true;
      client.dispose();
      handle.kill();
    }
  };

  return ok(connection);
}

/**
 * Create a dispatch port backed by a LocalMcpConnection.
 * Implements ExternalToolDispatchPort for use with createAgentExternalToolSession.
 * Mirrors createRemoteMcpDispatch's prefix-stripping logic exactly.
 */
export function createLocalMcpDispatch(connection: LocalMcpConnection): ExternalToolDispatchPort {
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
