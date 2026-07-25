/**
 * Task D.1 — Network policy, controlled dialer, and provider profile types.
 * Main owns all policy; renderer only reads resolved status flags.
 * Secret material stays in safeStorage/Main; only apiKeyRef crosses IPC.
 */

/**
 * Host/port allowlist entry. Supports an exact hostname or explicit wildcard
 * subdomain (`*.example.com`), optionally followed by a port (`:443`).
 * Entries without a port are limited to the scheme default port.
 */
export type AllowedHostPattern = string;

export interface AgentNetworkPolicy {
  readonly enabled: boolean;
  /** Exact hostnames or wildcard subdomain patterns (e.g. "*.example.com"). */
  readonly allowedHosts: readonly AllowedHostPattern[];
  /**
   * "require_confirmation" — every fetch/search requires explicit egress grant.
   * "auto_approve_search_queries" — structured search queries are auto-approved;
   *   explicit URL fetches still require confirmation.
   */
  readonly dataEgressPolicy: "require_confirmation" | "auto_approve_search_queries";
  /** Monotonically-increasing revision token; changes whenever policy mutates. */
  readonly revision: string;
}

/** A named provider profile for network tools (search provider, fetch endpoint). */
export interface AgentNetworkProviderProfile {
  readonly providerId: string;
  readonly name: string;
  /** Reference into safeStorage — never the plaintext secret. */
  readonly apiKeyRef: string;
  readonly endpoint: string;
  /** The policy revision this profile was bound against. */
  readonly policyRevision: string;
}

/** Default policy: disabled, empty host list, require_confirmation egress. */
export const DEFAULT_NETWORK_POLICY: Readonly<AgentNetworkPolicy> = Object.freeze({
  enabled: false,
  allowedHosts: [],
  dataEgressPolicy: "require_confirmation",
  revision: "v1.0-default"
} satisfies AgentNetworkPolicy);

// ── Validation ───────────────────────────────────────────────────────────────

const LOOPBACK_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback"
]);
const METADATA_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.aws.internal",
  "instance-data"
]);
const RAW_IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^(\[.*\]|[0-9a-f:]+)$/i;

function normaliseHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

/**
 * Return true for host spellings that must never reach DNS. The Main dialer
 * performs the authoritative address-level check after resolving every DNS
 * candidate; this protects the policy layer from obvious local targets.
 */
export function isUnsafeNetworkHostname(hostname: string): boolean {
  const h = normaliseHostname(hostname);
  if (LOOPBACK_NAMES.has(h) || METADATA_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // Raw literals are intentionally unsupported. Allowing public literals here
  // would bypass the all-candidate DNS validation performed by Main.
  if (RAW_IP_RE.test(h)) return true;
  if (IPV6_RE.test(h) && h.includes(":")) return true;
  return false;
}

interface ParsedAllowedHostPattern {
  readonly hostPattern: string;
  readonly port?: number;
}

function parseAllowedHostPattern(pattern: string): ParsedAllowedHostPattern | undefined {
  if (pattern.length === 0 || pattern !== pattern.trim()) return undefined;

  const separator = pattern.lastIndexOf(":");
  const hostPart = separator === -1 ? pattern : pattern.slice(0, separator);
  const portPart = separator === -1 ? undefined : pattern.slice(separator + 1);

  // IPv6 literals are not permitted policy entries, so a second colon is
  // always invalid rather than a host/port separator.
  if (hostPart.includes(":")) return undefined;
  if (portPart !== undefined && !/^\d{1,5}$/.test(portPart)) return undefined;

  const hostPattern = normaliseHostname(hostPart);
  const wildcard = hostPattern.startsWith("*.");
  const bareHost = wildcard ? hostPattern.slice(2) : hostPattern;
  if (
    bareHost.length === 0 ||
    isUnsafeNetworkHostname(bareHost) ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(bareHost) ||
    bareHost.includes("..") ||
    (!wildcard && hostPattern.includes("*")) ||
    (wildcard && hostPattern.indexOf("*") !== 0)
  ) {
    return undefined;
  }

  if (portPart === undefined) return { hostPattern };
  const port = Number(portPart);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return { hostPattern, port };
}

export interface NetworkPolicyValidationResult {
  readonly ok: boolean;
  readonly invalidHosts: readonly string[];
}

/** Validate that all allowedHosts entries are safe public hostnames/patterns. */
export function validateNetworkPolicy(policy: AgentNetworkPolicy): NetworkPolicyValidationResult {
  const invalidHosts: string[] = [];
  for (const pattern of policy.allowedHosts) {
    if (parseAllowedHostPattern(pattern) === undefined) invalidHosts.push(pattern);
  }
  return { ok: invalidHosts.length === 0, invalidHosts };
}

/** Return true if `hostname` is permitted under the policy's allowedHosts list. */
export function isHostAllowed(policy: AgentNetworkPolicy, hostname: string): boolean {
  if (!policy.enabled) return false;
  const h = normaliseHostname(hostname);
  if (isUnsafeNetworkHostname(h)) return false;
  for (const pattern of policy.allowedHosts) {
    const parsed = parseAllowedHostPattern(pattern);
    if (parsed === undefined) continue;
    if (parsed.hostPattern === h) return true;
    if (parsed.hostPattern.startsWith("*.")) {
      const suffix = parsed.hostPattern.slice(1); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    }
  }
  return false;
}

function defaultPortForProtocol(protocol: string): number | undefined {
  if (protocol === "http:") return 80;
  if (protocol === "https:") return 443;
  return undefined;
}

/**
 * Check the endpoint rather than only the hostname. A portless allowlist entry
 * deliberately permits only the default port for its scheme; non-default ports
 * must be opted into with an explicit `host:port` rule.
 */
export function isNetworkEndpointAllowed(policy: AgentNetworkPolicy, url: URL): boolean {
  if (!policy.enabled || isUnsafeNetworkHostname(url.hostname)) return false;
  const defaultPort = defaultPortForProtocol(url.protocol);
  if (defaultPort === undefined) return false;
  const effectivePort = url.port === "" ? defaultPort : Number(url.port);
  if (!Number.isInteger(effectivePort) || effectivePort < 1 || effectivePort > 65_535) return false;

  const hostname = normaliseHostname(url.hostname);
  for (const pattern of policy.allowedHosts) {
    const parsed = parseAllowedHostPattern(pattern);
    if (parsed === undefined) continue;
    const matchesHost =
      parsed.hostPattern === hostname ||
      (parsed.hostPattern.startsWith("*.") &&
        hostname.endsWith(parsed.hostPattern.slice(1)) &&
        hostname.length > parsed.hostPattern.length - 1);
    if (!matchesHost) continue;
    if (parsed.port === undefined) return effectivePort === defaultPort;
    if (parsed.port === effectivePort) return true;
  }
  return false;
}

// ── Controlled Fetch ─────────────────────────────────────────────────────────

export const NETWORK_MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB
export const NETWORK_MAX_REQUEST_BYTES = 1_048_576; // 1 MiB
export const NETWORK_CONNECT_TIMEOUT_MS = 30_000;
export const NETWORK_TOTAL_TIMEOUT_MS = 60_000;
export const NETWORK_MAX_REDIRECTS = 3;

export type AllowedContentType = "text/html" | "text/plain" | "text/markdown" | "application/json";

const ALLOWED_CONTENT_TYPE_PREFIXES = ["text/", "application/json"];

export function isAllowedNetworkContentType(ct: string | null): boolean {
  if (ct === null) return true; // allow unknown on fetch; caller checks
  const lower = ct.toLowerCase().split(";")[0]?.trim() ?? "";
  return ALLOWED_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export interface ControlledFetchRequest {
  readonly url: string;
  /** Only GET and POST are supported. GET is the default. */
  readonly method?: "GET" | "POST";
  /** POST payload, bounded before it is sent. GET requests cannot carry a body. */
  readonly body?: string | Uint8Array;
  /**
   * Additional protocol headers. Authorization, Cookie, Host, proxy, and
   * connection-management headers are always rejected at this boundary.
   */
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

export interface ControlledFetchResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string | null;
  /** Bounded text body (at most NETWORK_MAX_RESPONSE_BYTES decoded). */
  readonly body: string;
  readonly truncated: boolean;
  /** Lower-case response headers, present when the transport exposes them. */
  readonly headers?: Readonly<Record<string, string>>;
}

export type ControlledFetch = (request: ControlledFetchRequest) => Promise<ControlledFetchResponse>;

/**
 * Create a policy-enforcing fetch-like compatibility implementation.
 *
 * This function is useful in Application tests and for deterministic injected
 * transports. It does not own DNS resolution and therefore is not a production
 * SSRF boundary. Desktop Main must use its pinned-IP controlled dialer.
 *
 * It enforces the request contract:
 * - Normalises URL; rejects userinfo/file/data/non-http(s) schemes
 * - Rejects local/raw-IP targets and validates host/port allowlist entries
 * - Limits redirects (max 3); rejects cross-host unless also allowed
 * - Response size limit: abort at 1 MiB (streaming, decompress-aware)
 * - Timeouts: 30s connect + 60s total
 * - Content-type: only text/* and application/json for body reads
 */
export function createControlledFetch(
  policy: AgentNetworkPolicy,
  fetchImpl: typeof fetch = globalThis.fetch
): ControlledFetch {
  return async function controlledFetch(
    request: ControlledFetchRequest
  ): Promise<ControlledFetchResponse> {
    const parsed = validateControlledFetchUrl(policy, request.url);
    const initialRequest = normalizeControlledFetchRequest(request, parsed);

    const totalController = new AbortController();
    const totalTimeoutId = setTimeout(
      () => totalController.abort(new Error("NETWORK_TOTAL_TIMEOUT")),
      NETWORK_TOTAL_TIMEOUT_MS
    );

    const combinedSignal = request.signal
      ? anyAborted([request.signal, totalController.signal])
      : totalController.signal;

    try {
      return await fetchWithRedirectLimit(
        initialRequest,
        combinedSignal,
        fetchImpl,
        policy,
        NETWORK_MAX_REDIRECTS
      );
    } finally {
      clearTimeout(totalTimeoutId);
      totalController.abort();
    }
  };
}

/** Parse and validate a URL before DNS resolution or transport creation. */
export function validateControlledFetchUrl(policy: AgentNetworkPolicy, rawUrl: string): URL {
  if (!policy.enabled) {
    throw new ControlledFetchError("NETWORK_POLICY_DISABLED", "Agent network access is disabled.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ControlledFetchError("NETWORK_INVALID_URL", `Invalid URL: ${rawUrl}`);
  }

  if (parsed.username || parsed.password) {
    throw new ControlledFetchError("NETWORK_URL_USERINFO", "URL must not contain credentials.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ControlledFetchError(
      "NETWORK_SCHEME_REJECTED",
      `Scheme '${parsed.protocol}' is not allowed. Only https: and http:.`
    );
  }

  const hostname = normaliseHostname(parsed.hostname);
  if (isUnsafeNetworkHostname(hostname)) {
    throw new ControlledFetchError(
      "NETWORK_SSRF_REJECTED",
      `Host '${hostname}' is a local, metadata, or raw-IP address and cannot be fetched.`
    );
  }
  if (!isHostAllowed(policy, hostname)) {
    throw new ControlledFetchError(
      "NETWORK_HOST_NOT_ALLOWED",
      `Host '${hostname}' is not in the network policy allowedHosts list.`
    );
  }
  if (!isNetworkEndpointAllowed(policy, parsed)) {
    throw new ControlledFetchError(
      "NETWORK_PORT_NOT_ALLOWED",
      `Endpoint '${parsed.host}' is not permitted by the network policy.`
    );
  }
  return parsed;
}

export interface NormalizedControlledFetchRequest {
  readonly url: URL;
  readonly method: "GET" | "POST";
  readonly body?: string | Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

const FORBIDDEN_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "proxy-connection",
  "transfer-encoding",
  "content-length",
  "upgrade"
]);

export function normalizeControlledFetchRequest(
  request: ControlledFetchRequest,
  url: URL
): NormalizedControlledFetchRequest {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "POST") {
    throw new ControlledFetchError("NETWORK_METHOD_REJECTED", `Method '${method}' is not allowed.`);
  }
  if (method === "GET" && request.body !== undefined) {
    throw new ControlledFetchError(
      "NETWORK_GET_BODY_REJECTED",
      "GET requests cannot include a body."
    );
  }
  if (request.body !== undefined && requestBodyBytes(request.body) > NETWORK_MAX_REQUEST_BYTES) {
    throw new ControlledFetchError(
      "NETWORK_REQUEST_TOO_LARGE",
      `Request body exceeds ${NETWORK_MAX_REQUEST_BYTES} bytes.`
    );
  }

  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(request.headers ?? {})) {
    const name = rawName.toLowerCase();
    if (
      FORBIDDEN_REQUEST_HEADERS.has(name) ||
      name.startsWith("proxy-") ||
      /[\r\n]/.test(rawName) ||
      /[\r\n]/.test(rawValue)
    ) {
      throw new ControlledFetchError(
        "NETWORK_REQUEST_HEADER_REJECTED",
        `Header '${rawName}' is not permitted for controlled network requests.`
      );
    }
    headers[name] = rawValue;
  }

  return {
    url,
    method,
    ...(request.body === undefined ? {} : { body: request.body }),
    headers
  };
}

function requestBodyBytes(body: string | Uint8Array): number {
  return typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
}

function fetchRequestBody(body: string | Uint8Array): string | Uint8Array<ArrayBuffer> {
  if (typeof body === "string") return body;
  // DOM's BodyInit only accepts an ArrayBuffer-backed view. Copying also keeps
  // caller-owned SharedArrayBuffer memory out of the asynchronous transport.
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy;
}

async function fetchWithRedirectLimit(
  request: NormalizedControlledFetchRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  policy: AgentNetworkPolicy,
  redirectsLeft: number
): Promise<ControlledFetchResponse> {
  const connectController = new AbortController();
  const connectTimeoutId = setTimeout(
    () => connectController.abort(new Error("NETWORK_CONNECT_TIMEOUT")),
    NETWORK_CONNECT_TIMEOUT_MS
  );
  const mergedSignal = anyAborted([signal, connectController.signal]);

  let response: Response;
  try {
    response = await fetchImpl(request.url.toString(), {
      method: request.method,
      headers: {
        "user-agent": "NovelStudio-Agent/1.0 (controlled-fetch)",
        accept: "text/html,text/plain,application/json,text/markdown",
        "accept-encoding": "identity",
        ...request.headers
      },
      ...(request.body === undefined ? {} : { body: fetchRequestBody(request.body) }),
      redirect: "manual",
      signal: mergedSignal
    });
  } finally {
    clearTimeout(connectTimeoutId);
  }

  // Handle redirects manually
  if (response.status >= 300 && response.status < 400) {
    if (redirectsLeft <= 0) {
      throw new ControlledFetchError(
        "NETWORK_TOO_MANY_REDIRECTS",
        "Exceeded maximum redirect limit."
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new ControlledFetchError("NETWORK_REDIRECT_NO_LOCATION", "Redirect had no Location.");
    }
    const redirected = new URL(location, request.url);
    if (request.url.protocol === "https:" && redirected.protocol === "http:") {
      throw new ControlledFetchError(
        "NETWORK_HTTPS_DOWNGRADE_REJECTED",
        "HTTPS redirects cannot downgrade to HTTP."
      );
    }
    let redirectedUrl: URL;
    try {
      redirectedUrl = validateControlledFetchUrl(policy, redirected.toString());
    } catch (error) {
      if (error instanceof ControlledFetchError) {
        throw new ControlledFetchError(redirectValidationErrorCode(error.code), error.message);
      }
      throw error;
    }
    const redirectedRequest = redirectRequestForResponse(request, redirectedUrl, response.status);
    return fetchWithRedirectLimit(redirectedRequest, signal, fetchImpl, policy, redirectsLeft - 1);
  }

  const contentType = response.headers.get("content-type");
  if (!isAllowedNetworkContentType(contentType)) {
    throw new ControlledFetchError(
      "NETWORK_CONTENT_TYPE_REJECTED",
      `Content-Type '${contentType}' is not permitted.`
    );
  }

  // Stream body with size limit
  const { text, truncated } = await readBodyBounded(response, NETWORK_MAX_RESPONSE_BYTES, signal);

  return {
    url: request.url.toString(),
    status: response.status,
    contentType,
    body: text,
    truncated,
    headers: responseHeaders(response.headers)
  };
}

function redirectValidationErrorCode(code: string): string {
  if (code === "NETWORK_HOST_NOT_ALLOWED") return "NETWORK_REDIRECT_HOST_NOT_ALLOWED";
  if (code === "NETWORK_SSRF_REJECTED") return "NETWORK_SSRF_REDIRECT";
  if (code === "NETWORK_SCHEME_REJECTED") return "NETWORK_REDIRECT_SCHEME";
  if (code === "NETWORK_PORT_NOT_ALLOWED") return "NETWORK_REDIRECT_PORT_NOT_ALLOWED";
  return `NETWORK_REDIRECT_${code}`;
}

function redirectRequestForResponse(
  request: NormalizedControlledFetchRequest,
  redirectedUrl: URL,
  status: number
): NormalizedControlledFetchRequest {
  const sameOrigin = request.url.origin === redirectedUrl.origin;
  if (!sameOrigin && request.body !== undefined) {
    throw new ControlledFetchError(
      "NETWORK_REDIRECT_BODY_CROSS_ORIGIN",
      "A request body cannot be forwarded to a different origin."
    );
  }

  if (request.method === "POST" && (status === 301 || status === 302 || status === 303)) {
    const headers = { ...request.headers };
    delete headers["content-type"];
    return { url: redirectedUrl, method: "GET", headers };
  }

  return { ...request, url: redirectedUrl };
}

function responseHeaders(headers: Headers): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  // Deterministic unit-test transports may only implement `get`; native Fetch
  // always provides `forEach`.
  if (typeof headers.forEach !== "function") return result;
  headers.forEach((value, name) => {
    result[name.toLowerCase()] = value;
  });
  return result;
}

async function readBodyBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      if (signal.aborted) {
        throw new ControlledFetchError("NETWORK_ABORTED", "Fetch was aborted.");
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = maxBytes - totalBytes;
        if (value.byteLength >= remaining) {
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
          truncated = true;
          break;
        }
        chunks.push(value);
        totalBytes += value.byteLength;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { text: decoder.decode(combined), truncated };
}

function anyAborted(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export class ControlledFetchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ControlledFetchError";
  }
}
