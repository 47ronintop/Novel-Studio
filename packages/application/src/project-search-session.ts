import { createUnifiedError, err, type Result, type UnifiedError } from "@novel-studio/shared";

export type ProjectSearchEntryType =
  | "chapter"
  | "story.character"
  | "story.world"
  | "story.outline"
  | "story.timeline"
  | "story.foreshadow"
  | "memory";

export interface ProjectSearchSourceRef {
  readonly kind: "chapter" | "story-asset" | "memory";
  readonly id: string;
  readonly relativePath: string;
}

export interface ProjectSearchIndexEntry {
  readonly id: string;
  readonly type: ProjectSearchEntryType;
  readonly title: string;
  readonly text: string;
  readonly updatedAt: string;
  readonly sourceRef: ProjectSearchSourceRef;
}

export interface ProjectSearchIndex {
  readonly schemaVersion: "1.0";
  readonly generatedAt: string;
  readonly entryCount: number;
  readonly entries: readonly ProjectSearchIndexEntry[];
}

export interface ProjectSearchQuery {
  readonly query: string;
  readonly limit?: number;
}

export interface ProjectSearchResultItem {
  readonly id: string;
  readonly type: ProjectSearchEntryType;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly sourceRef: ProjectSearchSourceRef;
}

export interface ProjectSearchResults {
  readonly query: string;
  readonly generatedAt: string;
  readonly entryCount: number;
  readonly results: readonly ProjectSearchResultItem[];
}

export interface ProjectSearchRepositoryPort {
  invalidate(): Promise<Result<void, UnifiedError>>;
  rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  search(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
}

export type ProjectSearchSessionState = "clean" | "dirty";

export interface ProjectSearchSession {
  getState(): ProjectSearchSessionState;
  invalidate(reason: string): Promise<Result<void, UnifiedError>>;
  rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  search(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
}

export interface ProjectSearchSessionOptions {
  readonly repository: ProjectSearchRepositoryPort;
}

export type ProjectSearchInvalidationReason =
  "story-bible-save" | "agent-change-set-apply" | "agent-run-undo";

export interface ProjectSearchSourcesChangedInput {
  readonly projectId: string;
  readonly reason: ProjectSearchInvalidationReason;
  readonly relativePaths: readonly string[];
}

export function createProjectSearchSession(
  options: ProjectSearchSessionOptions
): ProjectSearchSession {
  let state: ProjectSearchSessionState = "clean";
  let generation = 0;
  let rebuildInFlight: Promise<Result<ProjectSearchIndex, UnifiedError>> | undefined;
  let invalidationTail: Promise<void> = Promise.resolve();

  const rebuildOnce = (): Promise<Result<ProjectSearchIndex, UnifiedError>> => {
    if (rebuildInFlight !== undefined) {
      return rebuildInFlight;
    }

    const rebuildGeneration = generation;
    const rebuild = options.repository.rebuildIndex().then((result) => {
      if (result.ok && generation === rebuildGeneration) {
        state = "clean";
      }
      return result;
    });
    rebuildInFlight = rebuild;
    const clearRebuild = () => {
      if (rebuildInFlight === rebuild) {
        rebuildInFlight = undefined;
      }
    };
    void rebuild.then(clearRebuild, clearRebuild);
    return rebuild;
  };

  return {
    getState: () => state,
    invalidate() {
      state = "dirty";
      generation += 1;
      const previousInvalidation = invalidationTail;
      const invalidation = (async () => {
        await previousInvalidation;
        const activeRebuild = rebuildInFlight;
        if (activeRebuild !== undefined) {
          try {
            await activeRebuild;
          } catch {
            // Repository ports return Result, but invalidation must still run if a port rejects.
          }
        }
        return options.repository.invalidate();
      })();
      invalidationTail = invalidation.then(
        () => undefined,
        () => undefined
      );
      return invalidation;
    },
    async rebuildIndex() {
      await invalidationTail;
      return rebuildOnce();
    },
    async search(input) {
      const query = input.query.trim();
      if (query.length === 0) {
        return err(
          createUnifiedError({
            code: "PROJECT_SEARCH_QUERY_EMPTY",
            category: "UserError",
            message: "Search query is empty.",
            recoverability: "user-action",
            suggestedAction: "Enter a search keyword before running project search.",
            traceId: "project-search-session"
          })
        );
      }

      await invalidationTail;
      if (state === "dirty") {
        const rebuilt = await rebuildOnce();
        if (!rebuilt.ok) {
          return rebuilt;
        }
      }

      return options.repository.search({
        query,
        ...(input.limit === undefined ? {} : { limit: input.limit })
      });
    }
  };
}
