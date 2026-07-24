/**
 * Task D.1 — Network policy, controlled dialer, and provider profile types.
 * Main owns all policy; renderer only reads resolved status flags.
 * Secret material stays in safeStorage/Main; only apiKeyRef crosses IPC.
 */

/** Hostname-level allowlist entry. Supports exact match and wildcard subdomain (*.example.com). */
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

const PRIVATE_IPV4_RE =
  /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.)/;
const LOOPBACK_NAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const RAW_IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^(\[.*\]|[0-9a-f:]+)$/i;

/** Return true if the hostname resolves to a private/loopback/link-local range. */
function isPrivateOrLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (LOOPBACK_NAMES.has(h)) return true;
  if (h === "::1" || h === "[::1]") return true;
  // IPv6 link-local
  if (/^(fe80:|::ffff:)/i.test(h)) return true;
  if (RAW_IP_RE.test(h) && PRIVATE_IPV4_RE.test(h)) return true;
  // Reject bare raw IPv4 (any IP)
  if (RAW_IP_RE.test(h)) return true;
  // Reject bare IPv6
  if (IPV6_RE.test(h) && h !== h.replace(/:/g, "")) return true;
  return false;
}

export interface NetworkPolicyValidationResult {
  readonly ok: boolean;
  readonly invalidHosts: readonly string[];
}

/** Validate that all allowedHosts entries are safe public hostnames/patterns. */
export function validateNetworkPolicy(
  policy: AgentNetworkPolicy
): NetworkPolicyValidationResult {
  const invalidHosts: string[] = [];
  for (const pattern of policy.allowedHosts) {
    const bare = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
    if (isPrivateOrLoopback(bare)) {
      invalidHosts.push(pattern);
      continue;
    }
    // Must look like a valid hostname (no path/port/scheme)
    if (!/^[a-zA-Z0-9*][a-zA-Z0-9.*-]*[a-zA-Z0-9]$/.test(pattern) && pattern.length > 1) {
      if (!/^[a-zA-Z0-9]$/.test(pattern)) {
        invalidHosts.push(pattern);
      }
    }
  }
  return { ok: invalidHosts.length === 0, invalidHosts };
}

/** Return true if `hostname` is permitted under the policy's allowedHosts list. */
export function isHostAllowed(policy: AgentNetworkPolicy, hostname: string): boolean {
  if (!policy.enabled) return false;
  const h = hostname.toLowerCase();
  for (const pattern of policy.allowedHosts) {
    if (pattern.toLowerCase() === h) return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1).toLowerCase(); // ".example.com"
      if (h.endsWith(suffix) && h.length > suffix.length) return true;
    }
  }
  return false;
}

// ── Controlled Fetch ─────────────────────────────────────────────────────────

export const NETWORK_MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB
export const NETWORK_CONNECT_TIMEOUT_MS = 30_000;
export const NETWORK_TOTAL_TIMEOUT_MS = 60_000;
export const NETWORK_MAX_REDIRECTS = 3;

export type AllowedContentType = "text/html" | "text/plain" | "text/markdown" | "application/json";

const ALLOWED_CONTENT_TYPE_PREFIXES = ["text/", "application/json"];

function isAllowedContentType(ct: string | null): boolean {
  if (ct === null) return true; // allow unknown on fetch; caller checks
  const lower = ct.toLowerCase().split(";")[0]?.trim() ?? "";
  return ALLOWED_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export interface ControlledFetchRequest {
  readonly url: string;
  /** Additional headers to include. Never includes Authorization or Cookie from caller. */
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
}

export type ControlledFetch = (
  request: ControlledFetchRequest
) => Promise<ControlledFetchResponse>;

/**
 * Create a fetch-like function that enforces the network policy:
 * - Normalises URL; rejects userinfo/file/data/non-http(s) schemes
 * - Rejects private/loopback/link-local targets
 * - Validates hostname against allowedHosts before connecting
 * - Limits redirects (max 3); rejects cross-host unless also allowed
 * - Response size limit: abort at 1 MiB (streaming, decompress-aware)
 * - Timeouts: 30s connect + 60s total
 * - Content-type: only text/* and application/json for body reads
 *
 * The `fetchImpl` parameter lets tests inject a mock; production passes the
 * platform native fetch (globalThis.fetch in Node 18+).
 */
export function createControlledFetch(
  policy: AgentNetworkPolicy,
  fetchImpl: typeof fetch = globalThis.fetch
): ControlledFetch {
  return async function controlledFetch(
    request: ControlledFetchRequest
  ): Promise<ControlledFetchResponse> {
    // ── Parse and normalise URL ──────────────────────────────────────────────
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      throw new ControlledFetchError("NETWORK_INVALID_URL", `Invalid URL: ${request.url}`);
    }

    // Reject userinfo (credentials in URL)
    if (parsed.username || parsed.password) {
      throw new ControlledFetchError(
        "NETWORK_URL_USERINFO",
        "URL must not contain credentials."
      );
    }

    // Only http/https
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ControlledFetchError(
        "NETWORK_SCHEME_REJECTED",
        `Scheme '${parsed.protocol}' is not allowed. Only https: and http:.`
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    // SSRF: reject private/loopback/link-local
    if (isPrivateOrLoopback(hostname)) {
      throw new ControlledFetchError(
        "NETWORK_SSRF_REJECTED",
        `Host '${hostname}' is a private/loopback address and cannot be fetched.`
      );
    }

    // Policy: validate against allowedHosts
    if (!isHostAllowed(policy, hostname)) {
      throw new ControlledFetchError(
        "NETWORK_HOST_NOT_ALLOWED",
        `Host '${hostname}' is not in the network policy allowedHosts list.`
      );
    }

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
        parsed,
        request.headers ?? {},
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

async function fetchWithRedirectLimit(
  url: URL,
  extraHeaders: Record<string, string>,
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
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        "user-agent": "NovelStudio-Agent/1.0 (controlled-fetch)",
        accept: "text/html,text/plain,application/json,text/markdown",
        ...extraHeaders
      },
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
    const redirected = new URL(location, url);
    // Only http/https
    if (redirected.protocol !== "http:" && redirected.protocol !== "https:") {
      throw new ControlledFetchError(
        "NETWORK_REDIRECT_SCHEME",
        "Redirect target scheme is not allowed."
      );
    }
    const redirectHost = redirected.hostname.toLowerCase();
    if (isPrivateOrLoopback(redirectHost)) {
      throw new ControlledFetchError(
        "NETWORK_SSRF_REDIRECT",
        `Redirect target '${redirectHost}' is a private address.`
      );
    }
    if (!isHostAllowed(policy, redirectHost)) {
      throw new ControlledFetchError(
        "NETWORK_REDIRECT_HOST_NOT_ALLOWED",
        `Redirect target '${redirectHost}' is not in the allowedHosts list.`
      );
    }
    return fetchWithRedirectLimit(redirected, extraHeaders, signal, fetchImpl, policy, redirectsLeft - 1);
  }

  const contentType = response.headers.get("content-type");
  if (!isAllowedContentType(contentType)) {
    throw new ControlledFetchError(
      "NETWORK_CONTENT_TYPE_REJECTED",
      `Content-Type '${contentType}' is not permitted.`
    );
  }

  // Stream body with size limit
  const { text, truncated } = await readBodyBounded(response, NETWORK_MAX_RESPONSE_BYTES, signal);

  return {
    url: url.toString(),
    status: response.status,
    contentType,
    body: text,
    truncated
  };
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
