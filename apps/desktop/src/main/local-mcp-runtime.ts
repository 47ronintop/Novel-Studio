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
import {
  TOOL_DESCRIPTION_MAX_BYTES,
  TOOL_DIRECTORY_MAX_TOTAL_BYTES,
  TOOL_DISPLAY_NAME_MAX_BYTES,
  computeToolDirectoryBytes,
  validateStrictToolSchema,
  validateToolText
} from "@novel-studio/agent-engine";
import type { ExternalToolDispatchPort } from "@novel-studio/application";

// ── Injected process launcher (no node:child_process import here) ──────────

export interface LocalMcpProcessHandle {
  writeLine(line: string): void;
  onLine(handler: (line: string) => void): void;
  /** Receives decoded stderr chunks from the verified native host. */
  onStderr(handler: (chunk: string) => void): void;
  onExit(handler: (code: number | null) => void): void;
  /** Must terminate the entire sandboxed process tree before resolving. */
  kill(): void | Promise<void>;
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
const LOCAL_MCP_TERMINATION_TIMEOUT_MS = 5_000;
const LOCAL_MCP_MAX_LINE_BYTES = 512 * 1024;
const LOCAL_MCP_MAX_OUTPUT_BYTES = 1024 * 1024;
const LOCAL_MCP_MAX_RESULT_BYTES = 512 * 1024;

type SendOutcome =
  | { readonly kind: "response"; readonly response: JsonRpcResponse }
  | { readonly kind: "exited"; readonly code: number | null }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" }
  | { readonly kind: "malformed" }
  | { readonly kind: "disposed" };

type NotifyOutcome =
  Exclude<SendOutcome, { readonly kind: "response" }> | { readonly kind: "sent" };

interface StdioJsonRpcClient {
  send(
    method: string,
    params: JsonObject,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<SendOutcome>;
  notify(method: string, params: JsonObject, signal: AbortSignal): Promise<NotifyOutcome>;
  dispose(): Promise<void>;
}

/**
 * Wraps a LocalMcpProcessHandle with request/response correlation over
 * newline-delimited JSON-RPC 2.0. Registers onLine/onExit exactly once for
 * the lifetime of the connection; every send() call gets its own numeric id.
 */
function createStdioJsonRpcClient(handle: LocalMcpProcessHandle): StdioJsonRpcClient {
  let nextId = 1;
  let exitedWith: { readonly code: number | null } | undefined;
  let disposed = false;
  let quarantined = false;
  let termination: Promise<boolean> | undefined;
  let outputBytes = 0;
  const pending = new Map<number, (outcome: SendOutcome) => void>();

  function settleAll(outcome: SendOutcome): void {
    const resolvers = [...pending.values()];
    pending.clear();
    for (const resolver of resolvers) resolver(outcome);
  }

  function isValidResponse(obj: Record<string, unknown>, id: number): boolean {
    if (obj["jsonrpc"] !== "2.0" || obj["id"] !== id) return false;
    const hasResult = Object.hasOwn(obj, "result");
    const hasError = Object.hasOwn(obj, "error");
    if (hasResult === hasError) return false;
    if (!hasError) {
      try {
        return (
          Buffer.byteLength(JSON.stringify(obj["result"]), "utf8") <= LOCAL_MCP_MAX_RESULT_BYTES
        );
      } catch {
        return false;
      }
    }
    const error = obj["error"];
    return (
      isRecord(error) && typeof error["code"] === "number" && typeof error["message"] === "string"
    );
  }

  function awaitWithDeadline(promise: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), LOCAL_MCP_TERMINATION_TIMEOUT_MS);
      void promise.then(
        () => {
          clearTimeout(timer);
          resolve(true);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        }
      );
    });
  }

  function terminateTree(): Promise<boolean> {
    if (termination !== undefined) return termination;
    let killed: void | Promise<void>;
    try {
      killed = handle.kill();
    } catch {
      quarantined = true;
      termination = Promise.resolve(false);
      return termination;
    }
    termination = awaitWithDeadline(Promise.resolve(killed)).then((confirmed) => {
      if (!confirmed) quarantined = true;
      return confirmed;
    });
    return termination;
  }

  function quarantine(outcome: SendOutcome): void {
    quarantined = true;
    disposed = true;
    settleAll(outcome);
    void terminateTree();
  }

  function terminateMalformed(): void {
    quarantine({ kind: "malformed" });
  }

  function recordOutput(chunk: string): boolean {
    const bytes = Buffer.byteLength(chunk, "utf8");
    if (bytes > LOCAL_MCP_MAX_LINE_BYTES || outputBytes + bytes > LOCAL_MCP_MAX_OUTPUT_BYTES) {
      terminateMalformed();
      return false;
    }
    outputBytes += bytes;
    return true;
  }

  handle.onLine((line) => {
    if (disposed || !recordOutput(line)) return;
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      terminateMalformed();
      return;
    }
    if (!isRecord(parsed)) {
      terminateMalformed();
      return;
    }

    const obj = parsed;
    const id = obj["id"];
    // Well-formed server notifications have no id and are deliberately ignored.
    if (id === undefined && obj["jsonrpc"] === "2.0" && typeof obj["method"] === "string") return;
    if (typeof id !== "number") {
      terminateMalformed();
      return;
    }

    const resolver = pending.get(id);
    if (resolver === undefined) return;
    if (!isValidResponse(obj, id)) {
      terminateMalformed();
      return;
    }
    pending.delete(id);
    resolver({ kind: "response", response: obj as unknown as JsonRpcResponse });
  });

  handle.onStderr((chunk) => {
    if (disposed) return;
    // Stderr is diagnostic-only, but it remains untrusted process output and
    // shares the connection-wide byte budget with stdout.
    recordOutput(chunk);
  });

  handle.onExit((code) => {
    exitedWith = { code };
    settleAll({ kind: "exited", code });
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
        if (disposed || quarantined) {
          resolve({ kind: "disposed" });
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
    async notify(method, params, signal) {
      if (signal.aborted) return { kind: "aborted" };
      if (exitedWith !== undefined) return { kind: "exited", code: exitedWith.code };
      if (disposed || quarantined) return { kind: "disposed" };
      try {
        handle.writeLine(JSON.stringify({ jsonrpc: "2.0", method, params }));
        return { kind: "sent" };
      } catch {
        return { kind: "exited", code: null };
      }
    },
    async dispose() {
      if (disposed) {
        if (termination !== undefined) {
          const terminated = await termination;
          if (!terminated) quarantined = true;
        }
        return;
      }
      disposed = true;
      settleAll({ kind: "disposed" });
      const terminated = await terminateTree();
      if (!terminated) quarantined = true;
    }
  };
}

function toHandshakeError(
  outcome: SendOutcome,
  code: string,
  phase: string
): UnifiedError | undefined {
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
  if (outcome.kind === "malformed") {
    return mcpError(code, `Local MCP server sent a malformed JSON-RPC response during ${phase}.`);
  }
  if (outcome.kind === "disposed") {
    return mcpError(code, `Local MCP connection was disposed during ${phase}.`);
  }
  return mcpError(code, `Local MCP ${phase} timed out.`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLocalTools(
  rawTools: unknown,
  serverId: string
): Result<readonly LocalMcpToolDescriptor[], UnifiedError> {
  if (!Array.isArray(rawTools)) {
    return err(
      mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tools/list result did not contain a tools array.")
    );
  }
  if (rawTools.length > 64) {
    return err(mcpError("MCP_TOO_MANY_TOOLS", "Local MCP server advertised more than 64 tools."));
  }

  const seenIds = new Set<string>();
  const tools: LocalMcpToolDescriptor[] = [];
  for (const raw of rawTools) {
    if (!isRecord(raw))
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", "MCP tool descriptor must be an object."));
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
    if (seenIds.has(toolId))
      return err(mcpError("MCP_TOOL_SOURCE_INVALID", `MCP tool '${toolId}' is duplicated.`));
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
      canonicalId: `mcp:${serverId}/${toolId}`,
      serverId,
      toolId,
      displayName,
      description,
      inputSchema: inputSchema as JsonObject,
      effect: "external_action",
      retrySemantics: "never_automatic",
      source: "local_mcp"
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
    await client.dispose();
    return err(initHandshakeError);
  }
  const initResponse = (
    initOutcome as { readonly kind: "response"; readonly response: JsonRpcResponse }
  ).response;
  if (initResponse.error !== undefined) {
    await client.dispose();
    return err(
      mcpError("MCP_INIT_FAILED", `Local MCP server returned error: ${initResponse.error.message}`)
    );
  }
  const serverVersion = (initResponse.result as Record<string, unknown> | undefined)?.[
    "protocolVersion"
  ];
  if (serverVersion !== LOCAL_MCP_PROTOCOL_VERSION) {
    await client.dispose();
    return err(
      mcpError(
        "MCP_PROTOCOL_MISMATCH",
        "Local MCP server did not select the requested protocol version."
      )
    );
  }

  const initialized = await client.notify("notifications/initialized", {}, signal);
  if (initialized.kind !== "sent") {
    await client.dispose();
    return err(
      toHandshakeError(
        initialized,
        "MCP_INITIALIZED_NOTIFICATION_FAILED",
        "initialized notification"
      ) ??
        mcpError(
          "MCP_INITIALIZED_NOTIFICATION_FAILED",
          "Local MCP initialized notification failed."
        )
    );
  }

  // ── tools/list ──────────────────────────────────────────────────────────
  const toolsOutcome = await client.send("tools/list", {}, LOCAL_MCP_HANDSHAKE_TIMEOUT_MS, signal);
  const toolsHandshakeError = toHandshakeError(toolsOutcome, "MCP_TOOLS_LIST_FAILED", "tools/list");
  if (toolsHandshakeError !== undefined) {
    await client.dispose();
    return err(toolsHandshakeError);
  }
  const toolsResponse = (
    toolsOutcome as { readonly kind: "response"; readonly response: JsonRpcResponse }
  ).response;
  if (toolsResponse.error !== undefined) {
    await client.dispose();
    return err(
      mcpError("MCP_TOOLS_LIST_ERROR", `Local MCP tools/list error: ${toolsResponse.error.message}`)
    );
  }

  const rawTools = isRecord(toolsResponse.result) ? toolsResponse.result["tools"] : undefined;
  const validatedTools = validateLocalTools(rawTools, input.serverId);
  if (!validatedTools.ok) {
    await client.dispose();
    return validatedTools;
  }
  const tools = validatedTools.value;

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
        closed = true;
        await client.dispose();
        return {
          status: "outcome_unknown",
          reason:
            "The local MCP tool call was aborted before delivery could be confirmed. Manual recovery may be required."
        };
      }
      if (outcome.kind === "exited") {
        closed = true;
        await client.dispose();
        return {
          status: "outcome_unknown",
          reason: `The local MCP server process exited (code ${String(outcome.code)}) before confirming delivery. Delivery unconfirmed — do not auto-retry.`
        };
      }
      if (outcome.kind === "timeout") {
        closed = true;
        await client.dispose();
        return {
          status: "outcome_unknown",
          reason:
            "The local MCP tool call timed out before confirming delivery. Delivery unconfirmed — do not auto-retry."
        };
      }
      if (outcome.kind === "malformed" || outcome.kind === "disposed") {
        closed = true;
        await client.dispose();
        return {
          status: "outcome_unknown",
          reason:
            "The local MCP connection became invalid before delivery could be confirmed. Delivery unconfirmed — do not auto-retry."
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

      if (!isRecord(response.result)) {
        return {
          status: "error",
          error: mcpError("MCP_INVALID_RESPONSE", "Local MCP tool result must be an object.")
        };
      }

      return {
        status: "completed",
        result: response.result as JsonObject
      };
    },

    close() {
      closed = true;
      void client.dispose();
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
