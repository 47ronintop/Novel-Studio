import { createUnifiedError, err, type Result, type UnifiedError } from "@novel-studio/shared";

export type ProjectSearchEntryType =
  "chapter" | "story.character" | "story.world" | "story.outline" | "story.timeline" | "memory";

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
  rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  search(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
}

export interface ProjectSearchSession {
  rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
  search(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
}

export interface ProjectSearchSessionOptions {
  readonly repository: ProjectSearchRepositoryPort;
}

export function createProjectSearchSession(
  options: ProjectSearchSessionOptions
): ProjectSearchSession {
  return {
    rebuildIndex: () => options.repository.rebuildIndex(),
    search(input) {
      const query = input.query.trim();
      if (query.length === 0) {
        return Promise.resolve(
          err(
            createUnifiedError({
              code: "PROJECT_SEARCH_QUERY_EMPTY",
              category: "UserError",
              message: "Search query is empty.",
              recoverability: "user-action",
              suggestedAction: "Enter a search keyword before running project search.",
              traceId: "project-search-session"
            })
          )
        );
      }

      return options.repository.search({
        query,
        ...(input.limit === undefined ? {} : { limit: input.limit })
      });
    }
  };
}
