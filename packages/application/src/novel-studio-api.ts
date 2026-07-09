import type {
  ChapterSummary,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import type { ApplicationCommand } from "./command-registry.js";
import type {
  AiWritingSuggestion,
  AiWritingSelectionPreview,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamEvent,
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
import type { ModelDiscoverySnapshot } from "./model-discovery-session.js";
import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSnapshot
} from "./model-settings-session.js";
import type { PluginSettingsSnapshot } from "./plugin-settings-session.js";
import type {
  CreateProjectInput,
  ProjectRecoveryApplyResult,
  ProjectRecoveryDraftPreview,
  ProjectWorkspaceSnapshot
} from "./project-workspace-session.js";
import type {
  ProjectSearchIndex,
  ProjectSearchQuery,
  ProjectSearchResults
} from "./project-search-session.js";
import type {
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleContextCandidateOptions,
  StoryBibleSnapshot
} from "./story-bible-session.js";
import type {
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "./user-preferences-session.js";

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
    readDirectory(projectRoot: string): Promise<Result<ProjectDirectoryTreeItem[], UnifiedError>>;
    create(input: CreateProjectInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    listChapters(): Promise<Result<readonly ChapterSummary[], UnifiedError>>;
    createChapter(
      input: CreateChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    renameChapter(input: RenameChapterInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    duplicateChapter(
      input: DuplicateChapterInput
    ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    deleteChapter(input: DeleteChapterInput): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    selectChapter(chapterId: string): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
    previewRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectRecoveryDraftPreview, UnifiedError>>;
    applyRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectRecoveryApplyResult, UnifiedError>>;
    discardRecoveryDraft(
      sessionId: string
    ): Promise<Result<ProjectWorkspaceSnapshot, UnifiedError>>;
  };
  file: {
    readText(
      projectRoot: string,
      path: string
    ): Promise<Result<ProjectTextFileReadResult, UnifiedError>>;
    writeText(
      projectRoot: string,
      path: string,
      content: string
    ): Promise<Result<ProjectTextFileWriteResult, UnifiedError>>;
  };
  ai: {
    generateChapterSuggestion(
      request: AiWritingSuggestionRequest
    ): Promise<Result<AiWritingSuggestion, UnifiedError>>;
    streamChapterSuggestion(
      request: AiWritingSuggestionRequest,
      options?: AiWritingSuggestionStreamOptions
    ): AsyncIterable<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
    generateSelectionPreview(
      request: AiWritingSelectionPreviewRequest
    ): Promise<Result<AiWritingSelectionPreview, UnifiedError>>;
    applySelectionPreview(previewId: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
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
    discoverModelOptions(profileId: string): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
    saveModelProfile(
      profile: ModelProfile,
      options?: { readonly makeDefault?: boolean }
    ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
    saveModelSecret(secretRef: string, secret: string): Promise<Result<void, UnifiedError>>;
    testModelProfileConnection(
      profileId: string
    ): Promise<Result<ModelConnectionResult, UnifiedError>>;
  };
  plugins: {
    loadRegistry(): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
    setEnabled(
      pluginId: string,
      enabled: boolean
    ): Promise<Result<PluginSettingsSnapshot, UnifiedError>>;
  };
  storyBible: {
    load(): Promise<Result<StoryBibleSnapshot, UnifiedError>>;
    saveAsset(asset: StoryBibleAsset): Promise<Result<StoryBibleAsset, UnifiedError>>;
    saveMemory(memory: MemoryRecord): Promise<Result<MemoryRecord, UnifiedError>>;
    buildConsistencyReport(): Promise<Result<StoryBibleConsistencyReport, UnifiedError>>;
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
  preferences: {
    load(): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
    save(input: UserPreferencesSaveInput): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
  };
}

export interface AiWritingSuggestionStreamOptions {
  readonly signal?: AbortSignal;
}

export interface ProjectDirectorySelection {
  readonly canceled: boolean;
  readonly projectRoot?: string;
}

export interface ProjectDirectoryTreeItem {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly children?: ProjectDirectoryTreeItem[];
}

export interface ProjectTextFileReadResult {
  readonly path: string;
  readonly content: string;
}

export interface ProjectTextFileWriteResult {
  readonly path: string;
}
