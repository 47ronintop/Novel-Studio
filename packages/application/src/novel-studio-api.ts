import type {
  ChapterSummary,
  CreateChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import type { ApplicationCommand } from "./command-registry.js";
import type {
  AiWritingSuggestion,
  AiWritingSuggestionRequest,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "./ai-writing-workflow-session.js";
import type {
  ChapterEditorSnapshot,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigVersionSummary
} from "./config-studio-session.js";
import type { DesktopShellState } from "./desktop-application.js";
import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot
} from "./model-settings-session.js";
import type { CreateProjectInput, ProjectWorkspaceSnapshot } from "./project-workspace-session.js";
import type {
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults
} from "./project-search-session.js";
import type {
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot
} from "./story-bible-session.js";

export interface NovelStudioApi {
  getShellState(): Promise<DesktopShellState>;
  commands: {
    list(): Promise<readonly ApplicationCommand[]>;
    execute(commandId: string): Promise<Result<DesktopShellState, UnifiedError>>;
  };
  project: {
    chooseOpenDirectory(): Promise<Result<ProjectDirectorySelection, UnifiedError>>;
    chooseCreateDirectory(): Promise<Result<ProjectDirectorySelection, UnifiedError>>;
    open(projectRoot: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    create(input: CreateProjectInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
    createChapter(
      input: CreateChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    selectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  };
  ai: {
    generateChapterSuggestion(
      request: AiWritingSuggestionRequest
    ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
    applyChapterSuggestion(
      suggestionId: string
    ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>>;
    readWorkflowRun(workflowRunId: string): Promise<Result<WorkflowRunRecord, UnifiedError>>;
  };
  search: {
    rebuildIndex(): Promise<Result<ProjectSearchIndex, UnifiedError>>;
    query(input: ProjectSearchQuery): Promise<Result<ProjectSearchResults, UnifiedError>>;
  };
  chapter: {
    load(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    edit(nextBody: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    save(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    listVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
    previewVersion(versionId: string): Promise<Result<ChapterVersionContent, UnifiedError>>;
    restoreVersion(versionId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
    previewSuggestionDiff(
      nextBody: string
    ): Promise<Result<ChapterSuggestionDiffPreview, UnifiedError>>;
  };
  settings: {
    listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
    saveModelProfile(
      profile: ModelProfile,
      options?: { readonly makeDefault?: boolean }
    ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
    testModelProfileConnection(
      profileId: string
    ): Promise<Result<ModelConnectionResult, UnifiedError>>;
  };
  storyBible: {
    load(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
    saveAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
    saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
    buildContextCandidates(
      options?: StoryBibleContextCandidateOptions
    ): Promise<Result<readonly StoryBibleContextCandidate[], UnifiedError>>;
  };
  studio: {
    loadConfigAsset(
      assetType: ConfigAssetType,
      assetId: string
    ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
    saveConfigAsset(
      input: ConfigAssetSaveInput
    ): Promise<Result<ConfigVersionSummary, UnifiedError>>;
    restoreConfigAssetVersion(
      input: ConfigAssetRestoreInput
    ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  };
}

export interface ProjectDirectorySelection {
  readonly canceled: boolean;
  readonly projectRoot?: string;
}
