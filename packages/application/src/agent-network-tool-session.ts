/**
 * Task D.1 — Network tool executor implementation.
 * Implements AgentNetworkToolExecutor using the controlled fetch.
 * All results are wrapped in the `untrusted_remote_data` envelope.
 */
import { createHash } from "node:crypto";
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { AgentNetworkToolExecutor, AgentNetworkReadResult } from "./agent-tool-ports.js";
import {
  isHostAllowed,
  createControlledFetch,
  ControlledFetchError,
  type AgentNetworkPolicy,
  type AgentNetworkProviderProfile,
  type ControlledFetch
} from "./agent-network-policy.js";

export interface AgentNetworkToolSessionOptions {
  readonly policy: AgentNetworkPolicy;
  readonly searchProfile?: AgentNetworkProviderProfile;
  /** Generic, credential-free fetch used exclusively by fetch_url. */
  readonly controlledFetch?: ControlledFetch;
  /**
   * Main-owned provider fetch. It may contain an origin-bound credential and is
   * deliberately not reused for arbitrary fetch_url calls.
   */
  readonly providerFetch?: ControlledFetch;
  readonly now?: () => string;
}

/** Maximum search results returned per query. */
const MAX_SEARCH_RESULTS = 10;
/** Snippet budget per search result (characters). */
const MAX_SNIPPET_CHARS = 500;

function nowIso(options: AgentNetworkToolSessionOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

function digestText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function unavailableError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Check the Agent network settings and enable the required provider.",
    traceId: "agent-network-tool-session"
  });
}

function networkError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "retryable",
    suggestedAction: "Retry the request or check network connectivity.",
    traceId: "agent-network-tool-session"
  });
}

export function createAgentNetworkToolSession(
  options: AgentNetworkToolSessionOptions
): AgentNetworkToolExecutor {
  const genericFetch = options.controlledFetch ?? createControlledFetch(options.policy);
  const providerFetch = options.providerFetch ?? genericFetch;

  return {
    async webSearch(input): Promise<Result<AgentNetworkReadResult, UnifiedError>> {
      if (!options.policy.enabled) {
        return err(
          unavailableError("NETWORK_POLICY_DISABLED", "Agent network access is disabled.")
        );
      }
      if (options.searchProfile === undefined) {
        return err(
          unavailableError(
            "NETWORK_SEARCH_PROVIDER_UNAVAILABLE",
            "No search provider is configured."
          )
        );
      }

      const provider = options.searchProfile;
      const providerHostname = (() => {
        try {
          return new URL(provider.endpoint).hostname;
        } catch {
          return "";
        }
      })();

      if (!isHostAllowed(options.policy, providerHostname)) {
        return err(
          unavailableError(
            "NETWORK_SEARCH_HOST_NOT_ALLOWED",
            `Search provider host '${providerHostname}' is not in the allowedHosts list.`
          )
        );
      }

      try {
        // Build search URL — DuckDuckGo-style JSON API or configurable endpoint
        const searchUrl = new URL(provider.endpoint);
        searchUrl.searchParams.set("q", input.query);
        searchUrl.searchParams.set("format", "json");
        searchUrl.searchParams.set("no_redirect", "1");
        searchUrl.searchParams.set("no_html", "1");
        if (typeof (input as { maxResults?: number }).maxResults === "number") {
          searchUrl.searchParams.set(
            "count",
            String(
              Math.min(
                (input as { maxResults?: number }).maxResults ?? MAX_SEARCH_RESULTS,
                MAX_SEARCH_RESULTS
              )
            )
          );
        }

        const response = await providerFetch({
          url: searchUrl.toString(),
          headers: {
            accept: "application/json",
            ...(provider.apiKeyRef.startsWith("secret://")
              ? {} // key resolved by runtime before passing to this layer
              : {})
          },
          signal: input.signal
        });

        const queryDigest = digestText(input.query);
        const bodyDigest = digestText(response.body);
        const fetchedAt = nowIso(options);

        // Parse search results — normalise to a bounded text summary
        let summary: string;
        let truncated = response.truncated;
        try {
          const parsed = JSON.parse(response.body) as Record<string, unknown>;
          const results = extractSearchResults(parsed);
          summary = results
            .slice(0, MAX_SEARCH_RESULTS)
            .map(
              (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet.slice(0, MAX_SNIPPET_CHARS)}`
            )
            .join("\n\n");
          if (results.length > MAX_SEARCH_RESULTS) truncated = true;
        } catch {
          summary = response.body.slice(0, 2000);
          if (response.body.length > 2000) truncated = true;
        }

        const result: AgentNetworkReadResult = {
          kind: "untrusted_remote_data",
          url: searchUrl.origin + searchUrl.pathname,
          fetchedAt,
          contentDigest: bodyDigest,
          contentSummary: `Web search for "${queryDigest}" — ${summary.length} chars`,
          truncated,
          sourceLabel: `web_search:${queryDigest}`
        };

        // Attach the actual search results in the summary for model use
        const resultWithData = {
          ...result,
          contentSummary: summary || "(no results)",
          truncated
        } as AgentNetworkReadResult;

        return ok(resultWithData);
      } catch (error) {
        if (error instanceof ControlledFetchError) {
          return err(networkError(error.code, error.message));
        }
        const msg = error instanceof Error ? error.message : "Web search failed.";
        return err(networkError("NETWORK_SEARCH_FAILED", msg));
      }
    },

    async fetchUrl(input): Promise<Result<AgentNetworkReadResult, UnifiedError>> {
      if (!options.policy.enabled) {
        return err(
          unavailableError("NETWORK_POLICY_DISABLED", "Agent network access is disabled.")
        );
      }

      let hostname: string;
      try {
        hostname = new URL(input.url).hostname.toLowerCase();
      } catch {
        return err(unavailableError("NETWORK_INVALID_URL", `Invalid URL: ${input.url}`));
      }

      if (!isHostAllowed(options.policy, hostname)) {
        return err(
          unavailableError(
            "NETWORK_HOST_NOT_ALLOWED",
            `Host '${hostname}' is not in the network policy allowedHosts list.`
          )
        );
      }

      try {
        // fetch_url must always use the credential-free transport. Provider
        // credentials are scoped to webSearch in Desktop Main.
        const response = await genericFetch({ url: input.url, signal: input.signal });
        const fetchedAt = nowIso(options);
        const bodyDigest = digestText(response.body);
        const urlDigest = digestText(input.url);

        const result: AgentNetworkReadResult = {
          kind: "untrusted_remote_data",
          url: input.url,
          fetchedAt,
          contentDigest: bodyDigest,
          contentSummary: response.body.slice(0, 4096),
          truncated: response.truncated,
          sourceLabel: `fetch_url:${urlDigest}`
        };

        return ok(result);
      } catch (error) {
        if (error instanceof ControlledFetchError) {
          return err(networkError(error.code, error.message));
        }
        const msg = error instanceof Error ? error.message : "URL fetch failed.";
        return err(networkError("NETWORK_FETCH_FAILED", msg));
      }
    }
  };
}

interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

function extractSearchResults(parsed: Record<string, unknown>): SearchResultItem[] {
  // DuckDuckGo JSON API shape
  if (Array.isArray(parsed["RelatedTopics"])) {
    return (parsed["RelatedTopics"] as unknown[])
      .filter(isRecord)
      .map((item) => ({
        title: String(item["Text"] ?? "").split(" - ")[0] ?? "",
        url: String(item["FirstURL"] ?? ""),
        snippet: String(item["Text"] ?? "").slice(0, MAX_SNIPPET_CHARS)
      }))
      .filter((item) => item.url.length > 0);
  }
  // Generic results array
  if (Array.isArray(parsed["results"])) {
    return (parsed["results"] as unknown[])
      .filter(isRecord)
      .map((item) => ({
        title: String(item["title"] ?? ""),
        url: String(item["url"] ?? item["link"] ?? ""),
        snippet: String(item["snippet"] ?? item["description"] ?? "").slice(0, MAX_SNIPPET_CHARS)
      }))
      .filter((item) => item.url.length > 0);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
