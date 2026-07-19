import type {
  NovelStudioApi,
  ProjectSearchResultItem,
  ProjectSearchResults
} from "@novel-studio/application";
import type { ProjectSearchProps } from "@novel-studio/ui";

import type { WorkspaceNavigation } from "./workspace-navigation.js";

export interface ProjectSearchBridge {
  getProps(): ProjectSearchProps;
  setQuery(query: string): ProjectSearchProps;
  beginSearch(): ProjectSearchProps;
  search(): Promise<ProjectSearchProps>;
  beginRebuildIndex(): ProjectSearchProps;
  rebuildIndex(): Promise<ProjectSearchProps>;
}

export function createProjectSearchBridge(api: NovelStudioApi): ProjectSearchBridge {
  let state: ProjectSearchProps = {
    query: "",
    status: "idle",
    results: [],
    onQueryChange: () => undefined,
    onSearch: () => undefined,
    onRebuildIndex: () => undefined
  };

  return {
    getProps: () => state,
    setQuery(query) {
      state = {
        ...withoutFeedback(state),
        query
      };
      return state;
    },
    beginSearch() {
      state = {
        ...withoutFeedback(state),
        status: "searching"
      };
      return state;
    },
    async search() {
      const result = await api.search.query({ query: state.query, limit: 20 });
      if (!result.ok) {
        state = {
          ...state,
          status: "error",
          results: [],
          feedback: {
            kind: "error",
            message: result.error.message
          }
        };
        return state;
      }

      state = toSearchProps(state.query, result.value);
      return state;
    },
    beginRebuildIndex() {
      state = {
        ...withoutFeedback(state),
        status: "indexing"
      };
      return state;
    },
    async rebuildIndex() {
      const result = await api.search.rebuildIndex();
      if (!result.ok) {
        state = {
          ...state,
          status: "error",
          results: [],
          feedback: {
            kind: "error",
            message: result.error.message
          }
        };
        return state;
      }

      state = {
        ...state,
        status: "idle",
        entryCount: result.value.entryCount,
        generatedAt: result.value.generatedAt,
        results: [],
        feedback: {
          kind: "info",
          message: `索引已重建，包含 ${result.value.entryCount} 个条目。`
        }
      };
      return state;
    }
  };
}

export async function openProjectSearchResult(
  navigation: Pick<WorkspaceNavigation, "navigateToChapter" | "navigateToStoryEntry">,
  result: ProjectSearchResultItem
): Promise<void> {
  if (result.sourceRef.kind === "chapter") {
    await navigation.navigateToChapter(result.sourceRef.id);
    return;
  }

  navigation.navigateToStoryEntry(result.sourceRef.id);
}

function withoutFeedback(props: ProjectSearchProps): Omit<ProjectSearchProps, "feedback"> {
  return {
    query: props.query,
    status: props.status,
    ...(props.entryCount === undefined ? {} : { entryCount: props.entryCount }),
    ...(props.generatedAt === undefined ? {} : { generatedAt: props.generatedAt }),
    results: props.results,
    onQueryChange: props.onQueryChange,
    onSearch: props.onSearch,
    onRebuildIndex: props.onRebuildIndex
  };
}

function toSearchProps(query: string, results: ProjectSearchResults): ProjectSearchProps {
  return {
    query,
    status: results.results.length === 0 ? "empty" : "results-ready",
    entryCount: results.entryCount,
    generatedAt: results.generatedAt,
    results: results.results,
    onQueryChange: () => undefined,
    onSearch: () => undefined,
    onRebuildIndex: () => undefined
  };
}
