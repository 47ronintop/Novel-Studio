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
  AgentConversationWorkspaceShellProps,
  ChapterEditorProps,
  CommandPaletteFeedback,
  ConfigStudioPanelProps,
  CreativeWorkspaceNavigatorProps,
  ModelSettingsPanelProps,
  ProjectSearchProps,
  ProjectWorkflowProps,
  PlainFileEditorProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps,
  WorkspaceShellProps
} from "@novel-studio/ui";
import { WorkspaceShell } from "@novel-studio/ui";

export interface RendererWorkspaceShellProps {
  readonly appearancePreferences?: UserAppearancePreferences | undefined;
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly agentConversationWorkspace: AgentConversationWorkspaceShellProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly projectSearch: ProjectSearchProps | undefined;
  readonly settings: ModelSettingsPanelProps | undefined;
  readonly studio: ConfigStudioPanelProps | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly fileEditor: PlainFileEditorProps | undefined;
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
  readonly onOpenProject: ProjectWorkflowProps["onOpenProject"];
  readonly onCreateProject: ProjectWorkflowProps["onCreateProject"];
  readonly onCreateChapter: ProjectWorkflowProps["onCreateChapter"];
  readonly onOpenFile: NonNullable<ProjectWorkflowProps["onOpenFile"]>;
  readonly onRenameChapter: NonNullable<ProjectWorkflowProps["onRenameChapter"]>;
  readonly onDuplicateChapter: NonNullable<ProjectWorkflowProps["onDuplicateChapter"]>;
  readonly onDeleteChapter: NonNullable<ProjectWorkflowProps["onDeleteChapter"]>;
  readonly onSelectChapter: ProjectWorkflowProps["onSelectChapter"];
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
  readonly onStudioAssetSelect: NonNullable<ConfigStudioPanelProps["onAssetSelect"]>;
  readonly onStudioContentChange: NonNullable<ConfigStudioPanelProps["onContentChange"]>;
  readonly onStudioWorkflowNodeSelect: NonNullable<ConfigStudioPanelProps["onWorkflowNodeSelect"]>;
  readonly onStudioWorkflowEdgeSelect: NonNullable<ConfigStudioPanelProps["onWorkflowEdgeSelect"]>;
  readonly onStudioWorkflowNodeEdit: NonNullable<ConfigStudioPanelProps["onWorkflowNodeEdit"]>;
  readonly onStudioWorkflowSemanticEdit: NonNullable<
    ConfigStudioPanelProps["onWorkflowSemanticEdit"]
  >;
  readonly onStudioWorkflowLayoutChange: NonNullable<
    ConfigStudioPanelProps["onWorkflowLayoutChange"]
  >;
  readonly onStudioWorkflowNodeDragCommit: NonNullable<
    ConfigStudioPanelProps["onWorkflowNodeDragCommit"]
  >;
  readonly onStudioSave: NonNullable<ConfigStudioPanelProps["onSave"]>;
  readonly onStudioRestoreVersion: NonNullable<ConfigStudioPanelProps["onRestoreVersion"]>;
  readonly onStoryBibleKindSelect: StoryBibleEditorProps["onKindSelect"];
  readonly onStoryBibleEntrySelect: StoryBibleEditorProps["onEntrySelect"];
  readonly onStoryBibleDraftChange: StoryBibleEditorProps["onDraftChange"];
  readonly onNewStoryBibleDraft: StoryBibleEditorProps["onNewDraft"];
  readonly onCreativeNavigatorModeSelect: (mode: CreativeNavigatorMode) => void;
  readonly onSaveStoryBibleDraft: StoryBibleEditorProps["onSave"];
  readonly onCommandExecute: NonNullable<WorkspaceShellProps["onCommandExecute"]>;
  readonly onCommandPaletteActiveCommandChange: NonNullable<
    WorkspaceShellProps["onCommandPaletteActiveCommandChange"]
  >;
  readonly onCommandPaletteOpen: NonNullable<WorkspaceShellProps["onCommandPaletteOpen"]>;
  readonly onCommandPaletteQueryChange: NonNullable<
    WorkspaceShellProps["onCommandPaletteQueryChange"]
  >;
  readonly onBottomPanelTabSelect: NonNullable<WorkspaceShellProps["onBottomPanelTabSelect"]>;
  readonly onSearchResultOpen: (result: ProjectSearchResultItem) => void;
  readonly onTimelineEntryOpen: (entryId: string) => void;
  readonly onActivitySelect: (activityId: ActivityId) => void;
  readonly onSettingsClose: NonNullable<WorkspaceShellProps["onSettingsClose"]>;
  readonly navigatorSearchQuery: string;
  readonly onNavigatorSearchQueryChange: NonNullable<
    WorkspaceShellProps["onNavigatorSearchQueryChange"]
  >;
  readonly onNavigatorExpandedSectionIdsChange: NonNullable<
    WorkspaceShellProps["onNavigatorExpandedSectionIdsChange"]
  >;
}

export function RendererWorkspaceShell(props: RendererWorkspaceShellProps) {
  const projectWorkflow =
    props.projectWorkflow === undefined
      ? undefined
      : ({
          ...props.projectWorkflow,
          onProjectTitleChange: props.onProjectTitleChange,
          onProjectFolderNameChange: props.onProjectFolderNameChange,
          onChooseCreateParentDirectory: props.onChooseCreateParentDirectory,
          onOpenProject: props.onOpenProject,
          onCreateProject: props.onCreateProject,
          onCreateChapter: props.onCreateChapter,
          onOpenFile: props.onOpenFile,
          onRenameChapter: props.onRenameChapter,
          onDuplicateChapter: props.onDuplicateChapter,
          onDeleteChapter: props.onDeleteChapter,
          onSelectChapter: props.onSelectChapter,
          onCloseChapterTab: props.onCloseChapterTab,
          onPreviewRecoveryDraft: props.onPreviewRecoveryDraft,
          onApplyRecoveryDraft: props.onApplyRecoveryDraft,
          onDiscardRecoveryDraft: props.onDiscardRecoveryDraft
        } satisfies ProjectWorkflowProps);
  const storyBibleEditor =
    props.storyBibleEditor === undefined
      ? undefined
      : ({
          ...props.storyBibleEditor,
          onKindSelect: props.onStoryBibleKindSelect,
          onEntrySelect: props.onStoryBibleEntrySelect,
          onDraftChange: props.onStoryBibleDraftChange,
          onNewDraft: props.onNewStoryBibleDraft,
          onSave: props.onSaveStoryBibleDraft
        } satisfies StoryBibleEditorProps);
  const creativeNavigator =
    props.shellState.workspaceContext.kind === "creativeProject" &&
    projectWorkflow !== undefined &&
    storyBibleEditor !== undefined
      ? ({
          projectTitle: props.shellState.workspaceContext.displayName,
          mode: props.shellState.creativeNavigatorMode,
          searchQuery: props.navigatorSearchQuery,
          chapters: projectWorkflow.chapters,
          ...(projectWorkflow.activeChapterId === undefined
            ? {}
            : { activeChapterId: projectWorkflow.activeChapterId }),
          dirtyChapterIds: projectWorkflow.dirtyChapterIds ?? [],
          storyBible: storyBibleEditor,
          onModeSelect: props.onCreativeNavigatorModeSelect,
          onSearchQueryChange: props.onNavigatorSearchQueryChange,
          onCreateChapter: props.onCreateChapter,
          onChapterOpen: props.onSelectChapter,
          onChapterRename: props.onRenameChapter,
          onChapterDuplicate: props.onDuplicateChapter,
          onChapterDelete: props.onDeleteChapter,
          onStoryKindOpen: (kind) => {
            props.onActivitySelect("storyBible");
            props.onStoryBibleKindSelect(kind);
          },
          onStoryEntryOpen: (entryId) => {
            props.onActivitySelect("storyBible");
            props.onStoryBibleEntrySelect(entryId);
          },
          onStoryEntryCreate: (kind) => {
            props.onActivitySelect("storyBible");
            props.onStoryBibleKindSelect(kind);
          }
        } satisfies CreativeWorkspaceNavigatorProps)
      : undefined;

  return (
    <WorkspaceShell
      appearancePreferences={props.appearancePreferences}
      {...(creativeNavigator === undefined ? {} : { creativeNavigator })}
      {...(props.aiWritingWorkflow === undefined ||
      (props.shellState.activeActivity === "ai" && props.agentConversationWorkspace !== undefined)
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
      {...(props.studio === undefined
        ? {}
        : {
            studio: {
              ...props.studio,
              onAssetSelect: props.onStudioAssetSelect,
              onContentChange: props.onStudioContentChange,
              onWorkflowNodeSelect: props.onStudioWorkflowNodeSelect,
              onWorkflowEdgeSelect: props.onStudioWorkflowEdgeSelect,
              onWorkflowNodeEdit: props.onStudioWorkflowNodeEdit,
              onWorkflowSemanticEdit: props.onStudioWorkflowSemanticEdit,
              onWorkflowLayoutChange: props.onStudioWorkflowLayoutChange,
              onWorkflowNodeDragCommit: props.onStudioWorkflowNodeDragCommit,
              onSave: props.onStudioSave,
              onRestoreVersion: props.onStudioRestoreVersion
            } satisfies ConfigStudioPanelProps
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
      onCommandPaletteQueryChange={props.onCommandPaletteQueryChange}
      onBottomPanelTabSelect={props.onBottomPanelTabSelect}
      onSearchResultOpen={props.onSearchResultOpen}
      onTimelineEntryOpen={props.onTimelineEntryOpen}
      onActivitySelect={props.onActivitySelect}
      onSettingsClose={props.onSettingsClose}
      navigatorSearchQuery={props.navigatorSearchQuery}
      onNavigatorSearchQueryChange={props.onNavigatorSearchQueryChange}
      onNavigatorExpandedSectionIdsChange={props.onNavigatorExpandedSectionIdsChange}
    />
  );
}
