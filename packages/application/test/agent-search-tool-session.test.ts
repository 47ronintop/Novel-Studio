import { describe, expect, test } from "vitest";

import { createAgentSearchToolSession } from "../src/agent-search-tool-session.js";
import type { AgentSearchToolResult } from "../src/agent-tool-ports.js";

function makeMockSearchRepository(overrides?: {
  searchText?: (input: unknown) => Promise<unknown>;
  findReferences?: (input: unknown) => Promise<unknown>;
}) {
  return {
    searchText:
      overrides?.searchText ??
      (async () => ({
        ok: true,
        value: {
          kind: "search_results",
          items: [
            {
              relativePath: "src/app.ts",
              stableRef: "src/app.ts",
              range: { unit: "line_column", start: 1, end: 3 },
              snippet: "hello world",
              sourceChecksum: "a".repeat(64),
              resultDigest: "b".repeat(64),
              truncated: false
            }
          ],
          totalHits: 1,
          truncated: false,
          indexVersion: "1.1"
        }
      })),
    findReferences:
      overrides?.findReferences ??
      (async () => ({
        ok: true,
        value: {
          kind: "search_results",
          items: [],
          totalHits: 0,
          truncated: false,
          indexVersion: "1.1"
        }
      }))
  } as unknown as Parameters<typeof createAgentSearchToolSession>[0]["searchRepository"];
}

describe("AgentSearchToolSession", () => {
  test("wraps searchText and returns untrusted_project_data envelope", async () => {
    const session = createAgentSearchToolSession({
      searchRepository: makeMockSearchRepository()
    });

    const result = await session.searchText({
      runId: "run-01",
      projectId: "proj-01",
      query: "hello",
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as AgentSearchToolResult;
    expect(value.kind).toBe("untrusted_project_data");
    expect(value.items.length).toBe(1);
    expect(value.items[0]?.relativePath).toBe("src/app.ts");
    expect(value.items[0]?.snippet).toBe("hello world");
    expect(value.totalHits).toBe(1);
    expect(value.truncated).toBe(false);
  });

  test("wraps findReferences and returns untrusted_project_data envelope", async () => {
    const session = createAgentSearchToolSession({
      searchRepository: makeMockSearchRepository()
    });

    const result = await session.findReferences({
      runId: "run-01",
      projectId: "proj-01",
      stableRef: "src/app.ts",
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("untrusted_project_data");
    expect(result.value.totalHits).toBe(0);
  });

  test("propagates errors from the search repository", async () => {
    const session = createAgentSearchToolSession({
      searchRepository: makeMockSearchRepository({
        searchText: async () => ({
          ok: false,
          error: {
            schemaVersion: "1.0",
            errorId: "err-01",
            code: "AGENT_SEARCH_QUERY_INVALID",
            category: "ValidationError",
            message: "Query too long.",
            recoverability: "user-action",
            suggestedAction: "Shorten the query.",
            traceId: "test"
          }
        })
      })
    });

    const result = await session.searchText({
      runId: "run-01",
      projectId: "proj-01",
      query: "x".repeat(2000),
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AGENT_SEARCH_QUERY_INVALID");
  });

  test("maps range unit from repository result", async () => {
    const session = createAgentSearchToolSession({
      searchRepository: makeMockSearchRepository({
        searchText: async () => ({
          ok: true,
          value: {
            kind: "search_results",
            items: [
              {
                relativePath: "notes.md",
                stableRef: "notes.md",
                range: { unit: "utf16_offset", start: 10, end: 20 },
                snippet: "test",
                sourceChecksum: "c".repeat(64),
                resultDigest: "d".repeat(64),
                truncated: false
              }
            ],
            totalHits: 1,
            truncated: false,
            indexVersion: "1.0"
          }
        })
      })
    });

    const result = await session.searchText({
      runId: "run-01",
      projectId: "proj-01",
      query: "test",
      signal: new AbortController().signal
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.rangeUnit).toBe("utf16_offset");
    expect(result.value.items[0]?.rangeStart).toBe(10);
    expect(result.value.items[0]?.rangeEnd).toBe(20);
  });
});
