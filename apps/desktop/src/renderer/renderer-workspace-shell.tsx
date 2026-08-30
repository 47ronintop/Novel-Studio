import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type { CreativeNavigatorMode, UserAppearancePreferences } from "@novel-studio/shared";
import type {
  AiWritingWorkflowProps,
  AgentComposerProps,
  AgentConversationWorkspaceShellProps,
  ChapterEditorProps,
  CommandPaletteFeedback,
  CreativeProjectFilesNavigatorProps,
  CreativeWorkspaceNavigatorProps,
  ModelSettingsPanelProps,
  ProjectSearchProps,
  ProjectWorkflowFeedback,
  ProjectWorkflowProps,
  PlainFileEditorProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps,
  WorkspaceShellProps
} from "@novel-studio/ui";
import { WorkspaceShell } from "@novel-studio/ui";
import type { EngineeringWorkspaceSnapshot } from "@novel-studio/application";

import type { WorkspaceNavigation } from "./workspace-navigation.js";
import { brainstormingDisabledReason } from "./brainstorming-entry.js";

export interface RendererWorkspaceShellProps {
  readonly appearancePreferences?: UserAppearancePreferences | undefined;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly agentConversationWorkspace: AgentConversationWorkspaceShellProps | undefined;
  readonly agentComposer: AgentComposerProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly projectSearch: ProjectSearchProps | undefined;
  readonly workspaceTransitionFeedback?: ProjectWorkflowFeedback | undefined;
  readonly settings: ModelSettingsPanelProps | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly fileEditor: PlainFileEditorProps | undefined;
  readonly fileEditorScope: "creativeProjectFile" | "engineeringWorkspaceFile" | undefined;
  readonly creativeProjectFiles: CreativeProjectFilesNavigatorProps | undefined;
  readonly engineeringWorkspace: EngineeringWorkspaceSnapshot | undefined;
  readonly onboarding: WorkspaceShellProps["onboarding"];
  readonly storyBible: StoryBibleSummaryProps | undefined;
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly commandPaletteFeedback: CommandPaletteFeedback | undefined;
  readonly commandPaletteQuery: string;
  readonly commandPaletteSelectedCommandId: ApplicationCommandId | undefined;
  readonly onAiInstructionChange: AiWritingWorkflowProps["onInstructionChange"];
  readonly onGenerateAiSuggestion: AiWritingWorkflowProps["onGenerateSuggestion"];
  readonly onApplyAiSuggestion: AiWritingWorkflowProps["onApplySuggestion"];
  readonly onAiModelSelect: NonNullable<AiWritingWorkflowProps["onModelSelect"]>;
  readonly onAiReasoningEffortSelect: NonNullable<
    AiWritingWorkflowProps["onReasoningEffortSelect"]
  >;
  readonly onRejectSelectionReview: NonNullable<AiWritingWorkflowProps["onRejectSelectionReview"]>;
  readonly onUndoSelectionReview: NonNullable<AiWritingWorkflowProps["onUndoSelectionReview"]>;
  readonly onCancelAiStreaming: AiWritingWorkflowProps["onCancelStreaming"];
  readonly onProjectTitleChange: ProjectWorkflowProps["onProjectTitleChange"];
  readonly onProjectFolderNameChange: ProjectWorkflowProps["onProjectFolderNameChange"];
  readonly onChooseCreateParentDirectory: NonNullable<
    ProjectWorkflowProps["onChooseCreateParentDirectory"]
  >;
  readonly onCreateChapter: ProjectWorkflowProps["onCreateChapter"];
  readonly onStartBrainstorming: () => void;
  readonly onRenameChapter: NonNullable<ProjectWorkflowProps["onRenameChapter"]>;
  readonly onDuplicateChapter: NonNullable<ProjectWorkflowProps["onDuplicateChapter"]>;
  readonly onDeleteChapter: NonNullable<ProjectWorkflowProps["onDeleteChapter"]>;
  readonly onCloseChapterTab: NonNullable<ProjectWorkflowProps["onCloseChapterTab"]>;
  readonly onPreviewRecoveryDraft: NonNullable<ProjectWorkflowProps["onPreviewRecoveryDraft"]>;
  readonly onApplyRecoveryDraft: NonNullable<ProjectWorkflowProps["onApplyRecoveryDraft"]>;
  readonly onDiscardRecoveryDraft: NonNullable<ProjectWorkflowProps["onDiscardRecoveryDraft"]>;
  readonly onSearchQueryChange: ProjectSearchProps["onQueryChange"];
  readonly onProjectSearch: ProjectSearchProps["onSearch"];
  readonly onRebuildSearchIndex: ProjectSearchProps["onRebuildIndex"];
  readonly onSettingsProfileSelect: NonNullable<ModelSettingsPanelProps["onSelectProfile"]>;
  readonly onSettingsSectionSelect: NonNullable<ModelSettingsPanelProps["onSectionSelect"]>;
  readonly onSettingsDraftChange: NonNullable<ModelSettingsPanelProps["onDraftChange"]>;
  readonly onNewSettingsProfile: NonNullable<ModelSettingsPanelProps["onNewProfile"]>;
  readonly onSaveSettingsProfile: NonNullable<ModelSettingsPanelProps["onSaveProfile"]>;
  readonly onTestSettingsConnection: NonNullable<ModelSettingsPanelProps["onTestConnection"]>;
  readonly onMakeSettingsDefault: NonNullable<ModelSettingsPanelProps["onMakeDefault"]>;
  readonly onDiscoverSettingsModelOptions: NonNullable<
    ModelSettingsPanelProps["onDiscoverModelOptions"]
  >;
  readonly onRefreshPluginRegistry: NonNullable<
    NonNullable<ModelSettingsPanelProps["plugins"]>["onRefresh"]
  >;
  readonly onSetPluginEnabled: NonNullable<
    NonNullable<ModelSettingsPanelProps["plugins"]>["onSetEnabled"]
  >;
  readonly onStoryBibleDraftChange: StoryBibleEditorProps["onDraftChange"];
  readonly onStoryBibleFiltersChange: StoryBibleEditorProps["onFiltersChange"];
  readonly onStoryBibleStatusActionRequest: NonNullable<
    StoryBibleEditorProps["onStatusActionRequest"]
  >;
  readonly onStoryBibleStatusActionCancel: NonNullable<
    StoryBibleEditorProps["onStatusActionCancel"]
  >;
  readonly onStoryBibleStatusActionConfirm: NonNullable<
    StoryBibleEditorProps["onStatusActionConfirm"]
  >;
  readonly onCreativeNavigatorModeSelect: (mode: CreativeNavigatorMode) => void;
  readonly onEngineeringExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onRefreshEngineeringTree: () => void;
  readonly onWorkbenchSelect: NonNullable<WorkspaceShellProps["onWorkbenchSelect"]>;
  readonly onOpenEngineeringWorkspace: NonNullable<
    WorkspaceShellProps["onOpenEngineeringWorkspace"]
  >;
  readonly onSaveStoryBibleDraft: (chapterIds: readonly string[]) => void;
  readonly onStoryBibleExternalUpdateReload: StoryBibleEditorProps["onExternalUpdateReload"];
  readonly onStoryBibleExternalUpdateContinue: StoryBibleEditorProps["onExternalUpdateContinue"];
  readonly onForeshadowAnalysisOpen: StoryBibleEditorProps["onForeshadowAnalysisOpen"];
  readonly onForeshadowAnalysisChapterToggle: StoryBibleEditorProps["onForeshadowAnalysisChapterToggle"];
  readonly onForeshadowAnalysisStart: StoryBibleEditorProps["onForeshadowAnalysisStart"];
  readonly onForeshadowAnalysisCandidateToggle: StoryBibleEditorProps["onForeshadowAnalysisCandidateToggle"];
  readonly onForeshadowAnalysisPreview: StoryBibleEditorProps["onForeshadowAnalysisPreview"];
  readonly onForeshadowAnalysisBack: StoryBibleEditorProps["onForeshadowAnalysisBack"];
  readonly onForeshadowAnalysisConfirm: StoryBibleEditorProps["onForeshadowAnalysisConfirm"];
  readonly onForeshadowAnalysisRetryFailed: StoryBibleEditorProps["onForeshadowAnalysisRetryFailed"];
  readonly onForeshadowAnalysisClose: StoryBibleEditorProps["onForeshadowAnalysisClose"];
  readonly onCommandExecute: NonNullable<WorkspaceShellProps["onCommandExecute"]>;
  readonly onCommandPaletteActiveCommandChange: NonNullable<
    WorkspaceShellProps["onCommandPaletteActiveCommandChange"]
  >;
  readonly onCommandPaletteOpen: NonNullable<WorkspaceShellProps["onCommandPaletteOpen"]>;
  readonly onCommandPaletteClose: NonNullable<WorkspaceShellProps["onCommandPaletteClose"]>;
  readonly onCommandPaletteQueryChange: NonNullable<
    WorkspaceShellProps["onCommandPaletteQueryChange"]
  >;
  readonly onBottomPanelTabSelect: NonNullable<WorkspaceShellProps["onBottomPanelTabSelect"]>;
  readonly onSearchResultOpen: (result: ProjectSearchResultItem) => void;
  readonly onActivitySelect: (activityId: ActivityId) => void;
  readonly onSettingsClose: NonNullable<WorkspaceShellProps["onSettingsClose"]>;
  readonly navigatorSearchQuery: string;
  readonly onNavigatorSearchQueryChange: NonNullable<
    WorkspaceShellProps["onNavigatorSearchQueryChange"]
  >;
  readonly onNavigatorExpandedSectionIdsChange: NonNullable<
    WorkspaceShellProps["onNavigatorExpandedSectionIdsChange"]
  >;
  readonly navigation: WorkspaceNavigation;
}

export function RendererWorkspaceShell(props: RendererWorkspaceShellProps) {
  const brainstorming = resolveBrainstormingEntry(
    props.agentConversationWorkspace,
    props.onStartBrainstorming
  );
  const projectWorkflow =
    props.projectWorkflow === undefined
      ? undefined
      : ({
          ...props.projectWorkflow,
          onProjectTitleChange: props.onProjectTitleChange,
          onProjectFolderNameChange: props.onProjectFolderNameChange,
          onChooseCreateParentDirectory: props.onChooseCreateParentDirectory,
          onOpenProject: props.navigation.openCreativeProject,
          onCreateProject: props.navigation.createCreativeProject,
          onCreateChapter: props.onCreateChapter,
          ...(brainstorming === undefined ? {} : { brainstorming }),
          onOpenFile: (path) => {
            void props.navigation.navigateToFile(path);
          },
          onRenameChapter: props.onRenameChapter,
          onDuplicateChapter: props.onDuplicateChapter,
          onDeleteChapter: props.onDeleteChapter,
          onSelectChapter: (chapterId) => {
            void props.navigation.navigateToChapter(chapterId);
          },
          onCloseChapterTab: props.onCloseChapterTab,
          onPreviewRecoveryDraft: props.onPreviewRecoveryDraft,
          onApplyRecoveryDraft: props.onApplyRecoveryDraft,
          onDiscardRecoveryDraft: props.onDiscardRecoveryDraft
        } satisfies ProjectWorkflowProps);
  const sourceStoryBibleEditor = props.storyBibleEditor;
  const storyBibleChapterOptions = (projectWorkflow?.chapters ?? [])
    .map(({ id, title, order, status }) => ({ id, title, order, status }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const storyBibleCurrentChapterId =
    projectWorkflow?.activeChapterId ?? props.chapterEditor?.chapter.frontmatter.id;
  const storyBibleEditor =
    sourceStoryBibleEditor === undefined
      ? undefined
      : ({
          ...sourceStoryBibleEditor,
          ...(sourceStoryBibleEditor.analysisReview === undefined
            ? {}
            : {
                analysisReview: {
                  ...sourceStoryBibleEditor.analysisReview,
                  onOpen: props.navigation.navigateToStoryAnalysis,
                  onOpenEntry: props.navigation.navigateToStoryEntry
                }
              }),
          onKindSelect: (kind) => {
            if (props.shellState.activeActivity === "timeline" && kind === "timeline") {
              props.navigation.navigateToTimeline();
              return;
            }
            props.navigation.navigateToStoryKind(kind);
          },
          onEntrySelect: props.navigation.navigateToStoryEntry,
          onDraftChange: props.onStoryBibleDraftChange,
          onFiltersChange: props.onStoryBibleFiltersChange,
          onStatusActionRequest: props.onStoryBibleStatusActionRequest,
          onStatusActionCancel: props.onStoryBibleStatusActionCancel,
          onStatusActionConfirm: props.onStoryBibleStatusActionConfirm,
          onNewDraft: (assetType) =>
            props.navigation.createStoryEntry(sourceStoryBibleEditor.activeKind, assetType),
          onCancelDraft: props.navigation.cancelStoryDraft,
          onExplicitInversePreviewCancel: props.navigation.cancelStoryExplicitInversePreview,
          onForeshadowAnalysisOpen: props.onForeshadowAnalysisOpen,
          onForeshadowAnalysisChapterToggle: props.onForeshadowAnalysisChapterToggle,
          onForeshadowAnalysisStart: props.onForeshadowAnalysisStart,
          onForeshadowAnalysisCandidateToggle: props.onForeshadowAnalysisCandidateToggle,
          onForeshadowAnalysisPreview: props.onForeshadowAnalysisPreview,
          onForeshadowAnalysisBack: props.onForeshadowAnalysisBack,
          onForeshadowAnalysisConfirm: props.onForeshadowAnalysisConfirm,
          onForeshadowAnalysisRetryFailed: props.onForeshadowAnalysisRetryFailed,
          onForeshadowAnalysisClose: props.onForeshadowAnalysisClose,
          chapterOptions: storyBibleChapterOptions,
          ...(storyBibleCurrentChapterId === undefined
            ? {}
            : { currentChapterId: storyBibleCurrentChapterId }),
          onSave: () =>
            props.onSaveStoryBibleDraft(storyBibleChapterOptions.map((chapter) => chapter.id)),
          onExternalUpdateReload: props.onStoryBibleExternalUpdateReload,
          onExternalUpdateContinue: props.onStoryBibleExternalUpdateContinue
        } satisfies StoryBibleEditorProps);
  const creativeNavigator =
    props.shellState.workspaceContext.kind === "creativeProject" && projectWorkflow !== undefined
      ? ({
          projectTitle: props.shellState.workspaceContext.displayName,
          projectWorkflow,
          mode: props.shellState.creativeNavigatorMode,
          searchQuery: props.navigatorSearchQuery,
          chapters: projectWorkflow.chapters,
          ...(projectWorkflow.activeChapterId === undefined
            ? {}
            : { activeChapterId: projectWorkflow.activeChapterId }),
          dirtyChapterIds: projectWorkflow.dirtyChapterIds ?? [],
          ...(storyBibleEditor === undefined ? {} : { storyBible: storyBibleEditor }),
          ...(props.creativeProjectFiles === undefined
            ? {}
            : { projectFiles: props.creativeProjectFiles }),
          onModeSelect: props.onCreativeNavigatorModeSelect,
          onSearchQueryChange: props.onNavigatorSearchQueryChange,
          onCreateChapter: props.onCreateChapter,
          onChapterOpen: (chapterId) => {
            void props.navigation.navigateToChapter(chapterId);
          },
          onChapterRename: props.onRenameChapter,
          onChapterDuplicate: props.onDuplicateChapter,
          onChapterDelete: props.onDeleteChapter,
          onStoryKindOpen: props.navigation.navigateToStoryKind
        } satisfies CreativeWorkspaceNavigatorProps)
      : undefined;
  const engineeringNavigator =
    props.engineeringWorkspace === undefined
      ? undefined
      : {
          displayName: props.engineeringWorkspace.displayName,
          tree: props.engineeringWorkspace.tree,
          expandedPathIds: props.shellState.engineeringExpandedPathIds,
          ...(props.fileEditor?.path === undefined ||
          props.fileEditorScope !== "engineeringWorkspaceFile"
            ? {}
            : { activeFilePath: props.fileEditor.path }),
          onExpandedPathIdsChange: props.onEngineeringExpandedPathIdsChange,
          onFileOpen: (path: string) => {
            void props.navigation.navigateToFile(path);
          },
          onRefresh: props.onRefreshEngineeringTree
        };

  return (
    <WorkspaceShell
      appearancePreferences={props.appearancePreferences}
      {...(creativeNavigator === undefined ? {} : { creativeNavigator })}
      {...(engineeringNavigator === undefined ? {} : { engineeringNavigator })}
      {...(props.aiWritingWorkflow === undefined
        ? {}
        : {
            aiWritingWorkflow: {
              ...props.aiWritingWorkflow,
              onInstructionChange: props.onAiInstructionChange,
              onGenerateSuggestion: props.onGenerateAiSuggestion,
              onApplySuggestion: props.onApplyAiSuggestion,
              onModelSelect: props.onAiModelSelect,
              onReasoningEffortSelect: props.onAiReasoningEffortSelect,
              onRejectSelectionReview: props.onRejectSelectionReview,
              onUndoSelectionReview: props.onUndoSelectionReview,
              onRetrySuggestion: props.onGenerateAiSuggestion,
              onCancelStreaming: props.onCancelAiStreaming
            } satisfies AiWritingWorkflowProps
          })}
      {...(props.agentConversationWorkspace === undefined
        ? {}
        : { agentConversationWorkspace: props.agentConversationWorkspace })}
      {...(props.agentComposer === undefined ? {} : { agentComposer: props.agentComposer })}
      {...(projectWorkflow === undefined ? {} : { projectWorkflow })}
      {...(props.projectSearch === undefined
        ? {}
        : {
            search: {
              ...props.projectSearch,
              onQueryChange: props.onSearchQueryChange,
              onSearch: props.onProjectSearch,
              onRebuildIndex: props.onRebuildSearchIndex
            } satisfies ProjectSearchProps
          })}
      {...(props.workspaceTransitionFeedback === undefined
        ? {}
        : { workspaceTransitionFeedback: props.workspaceTransitionFeedback })}
      {...(props.settings === undefined
        ? {}
        : {
            settings: {
              ...props.settings,
              onSelectProfile: props.onSettingsProfileSelect,
              onSectionSelect: props.onSettingsSectionSelect,
              onDraftChange: props.onSettingsDraftChange,
              onNewProfile: props.onNewSettingsProfile,
              onSaveProfile: props.onSaveSettingsProfile,
              onTestConnection: props.onTestSettingsConnection,
              onMakeDefault: props.onMakeSettingsDefault,
              onDiscoverModelOptions: props.onDiscoverSettingsModelOptions,
              ...(props.settings.plugins === undefined
                ? {}
                : {
                    plugins: {
                      ...props.settings.plugins,
                      onRefresh: props.onRefreshPluginRegistry,
                      onSetEnabled: props.onSetPluginEnabled
                    }
                  })
            } satisfies ModelSettingsPanelProps
          })}
      {...(props.chapterEditor === undefined ? {} : { chapterEditor: props.chapterEditor })}
      {...(props.fileEditor === undefined ? {} : { fileEditor: props.fileEditor })}
      {...(props.onboarding === undefined ? {} : { onboarding: props.onboarding })}
      {...(props.storyBible === undefined ? {} : { storyBible: props.storyBible })}
      {...(storyBibleEditor === undefined ? {} : { storyBibleEditor })}
      shellState={props.shellState}
      commands={props.commands}
      commandPaletteOpen={props.commandPaletteOpen}
      commandPaletteFeedback={props.commandPaletteFeedback}
      commandPaletteQuery={props.commandPaletteQuery}
      commandPaletteSelectedCommandId={props.commandPaletteSelectedCommandId}
      onCommandExecute={props.onCommandExecute}
      onCommandPaletteActiveCommandChange={props.onCommandPaletteActiveCommandChange}
      onCommandPaletteOpen={props.onCommandPaletteOpen}
      onCommandPaletteClose={props.onCommandPaletteClose}
      onCommandPaletteQueryChange={props.onCommandPaletteQueryChange}
      onBottomPanelTabSelect={props.onBottomPanelTabSelect}
      onSearchResultOpen={props.onSearchResultOpen}
      onTimelineEntryOpen={props.navigation.navigateToTimelineEntry}
      onActivitySelect={props.onActivitySelect}
      onWorkbenchSelect={props.onWorkbenchSelect}
      onOpenEngineeringWorkspace={props.onOpenEngineeringWorkspace}
      onSettingsClose={props.onSettingsClose}
      navigatorSearchQuery={props.navigatorSearchQuery}
      onNavigatorSearchQueryChange={props.onNavigatorSearchQueryChange}
      onNavigatorExpandedSectionIdsChange={props.onNavigatorExpandedSectionIdsChange}
    />
  );
}

export function resolveBrainstormingEntry(
  workspace: AgentConversationWorkspaceShellProps | undefined,
  onStart: () => void
): ProjectWorkflowProps["brainstorming"] | undefined {
  if (workspace?.view.composer === undefined) return undefined;

  const disabledReason = brainstormingDisabledReason(workspace);
  return {
    ...(disabledReason === undefined ? {} : { disabledReason }),
    onStart
  };
}
