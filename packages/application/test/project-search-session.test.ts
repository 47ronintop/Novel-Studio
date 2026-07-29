import { describe, expect, test, vi } from "vitest";

import {
  createProjectSearchSession,
  type ProjectSearchIndex,
  type ProjectSearchRepositoryPort
} from "../src/index.js";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const snapshot = {
  schemaVersion: "1.0",
  generatedAt: "2026-07-05T00:00:00.000Z",
  entryCount: 1,
  entries: [
    {
      id: "chapter:ch_opening",
      type: "chapter",
      title: "开篇",
      text: "The hero keeps a hidden oath.",
      updatedAt: "2026-07-05T00:00:00.000Z",
      sourceRef: {
        kind: "chapter",
        id: "ch_opening",
        relativePath: "chapters/ch_opening.md"
      }
    }
  ]
} as const;

describe("ProjectSearchSession", () => {
  test("rebuilds and searches through the repository port", async () => {
    const calls: string[] = [];
    const session = createProjectSearchSession({
      repository: createRepository(calls)
    });

    const rebuilt = await session.rebuildIndex();
    const searched = await session.search({ query: "oath" });

    expect(rebuilt).toEqual(ok(snapshot));
    expect(searched.ok).toBe(true);
    expect(calls).toEqual(["rebuildIndex", "search:oath"]);
  });

  test("coalesces concurrent dirty searches into one rebuild", async () => {
    const rebuild = deferred<Result<ProjectSearchIndex, UnifiedError>>();
    let rebuildCount = 0;
    let searchCount = 0;
    const session = createProjectSearchSession({
      repository: {
        async invalidate() {
          return ok(undefined);
        },
        async rebuildIndex() {
          rebuildCount += 1;
          return rebuild.promise;
        },
        async search(input) {
          searchCount += 1;
          return ok(searchResults(input.query));
        }
      }
    });

    expect(await session.invalidate("story-bible-save")).toEqual(ok(undefined));
    const first = session.search({ query: "oath" });
    const second = session.search({ query: "gate" });

    await vi.waitFor(() => expect(rebuildCount).toBe(1));
    rebuild.resolve(ok(snapshot));

    await expect(first).resolves.toEqual(ok(searchResults("oath")));
    await expect(second).resolves.toEqual(ok(searchResults("gate")));
    expect(searchCount).toBe(2);
    expect(session.getState()).toBe("clean");
  });

  test("serializes invalidation after an old rebuild and rebuilds again before searching", async () => {
    const firstRebuild = deferred<Result<ProjectSearchIndex, UnifiedError>>();
    const secondRebuild = deferred<Result<ProjectSearchIndex, UnifiedError>>();
    const rebuilds = [firstRebuild, secondRebuild];
    const calls: string[] = [];
    let rebuildIndex = 0;
    const session = createProjectSearchSession({
      repository: {
        async invalidate() {
          calls.push("invalidate");
          return ok(undefined);
        },
        async rebuildIndex() {
          rebuildIndex += 1;
          calls.push(`rebuild:${rebuildIndex}`);
          return rebuilds[rebuildIndex - 1]?.promise ?? ok(snapshot);
        },
        async search(input) {
          calls.push(`search:${input.query}`);
          return ok(searchResults(input.query));
        }
      }
    });

    const oldRebuild = session.rebuildIndex();
    await vi.waitFor(() => expect(calls).toEqual(["rebuild:1"]));

    const invalidated = session.invalidate("agent-change-set-apply");
    const searched = session.search({ query: "oath" });
    expect(session.getState()).toBe("dirty");
    expect(calls).toEqual(["rebuild:1"]);

    firstRebuild.resolve(ok(snapshot));
    await expect(oldRebuild).resolves.toEqual(ok(snapshot));
    await expect(invalidated).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(calls).toEqual(["rebuild:1", "invalidate", "rebuild:2"]));

    secondRebuild.resolve(ok(snapshot));
    await expect(searched).resolves.toEqual(ok(searchResults("oath")));
    expect(calls).toEqual(["rebuild:1", "invalidate", "rebuild:2", "search:oath"]);
    expect(session.getState()).toBe("clean");
  });

  test("keeps the session dirty after invalidation failure and recovers on the next search", async () => {
    const session = createProjectSearchSession({
      repository: {
        async invalidate() {
          return err(searchError("SEARCH_INDEX_INVALIDATE_FAILED"));
        },
        async rebuildIndex() {
          return ok(snapshot);
        },
        async search(input) {
          return ok(searchResults(input.query));
        }
      }
    });

    const invalidated = await session.invalidate("story-bible-save");

    expect(invalidated.ok).toBe(false);
    expect(session.getState()).toBe("dirty");
    await expect(session.search({ query: "oath" })).resolves.toEqual(ok(searchResults("oath")));
    expect(session.getState()).toBe("clean");
  });
});

function createRepository(calls: string[]): ProjectSearchRepositoryPort {
  return {
    async invalidate() {
      calls.push("invalidate");
      return ok(undefined);
    },
    async rebuildIndex() {
      calls.push("rebuildIndex");
      return ok(snapshot);
    },
    async search(input) {
      calls.push(`search:${input.query}`);
      return ok({
        query: input.query,
        generatedAt: snapshot.generatedAt,
        entryCount: snapshot.entryCount,
        results: [
          {
            id: "chapter:ch_opening",
            type: "chapter",
            title: "开篇",
            snippet: "The hero keeps a hidden oath.",
            score: 2,
            sourceRef: snapshot.entries[0].sourceRef
          }
        ]
      });
    }
  };
}

function searchResults(query: string) {
  return {
    query,
    generatedAt: snapshot.generatedAt,
    entryCount: snapshot.entryCount,
    results: [
      {
        id: "chapter:ch_opening",
        type: "chapter" as const,
        title: "开篇",
        snippet: "The hero keeps a hidden oath.",
        score: 2,
        sourceRef: snapshot.entries[0].sourceRef
      }
    ]
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    }
  };
}

function searchError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: "Search index operation failed.",
    recoverability: "retryable",
    suggestedAction: "Retry project search.",
    traceId: "project-search-session-test"
  });
}
