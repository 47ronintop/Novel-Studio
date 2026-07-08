import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ProjectSearchResultItem
} from "@novel-studio/application";
import type {
  AiWritingWorkflowProps,
  ChapterEditorProps,
  CommandPaletteFeedback,
  ConfigStudioPanelProps,
  ModelSettingsPanelProps,
  ProjectSearchProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps,
  WorkspaceShellProps
} from "@novel-studio/ui";
import { WorkspaceShell } from "@novel-studio/ui";

export interface RendererWorkspaceShellProps {
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly projectSearch: ProjectSearchProps | undefined;
  readonly settings: ModelSettingsPanelProps | undefined;
  readonly studio: ConfigStudioPanelProps | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
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
  readonly onRejectSelectionReview: NonNullable<AiWritingWorkflowProps["onRejectSelectionReview"]>;
  readonly onUndoSelectionReview: NonNullable<AiWritingWorkflowProps["onUndoSelectionReview"]>;
  readonly onCancelAiStreaming: AiWritingWorkflowProps["onCancelStreaming"];
  readonly onProjectRootChange: ProjectWorkflowProps["onProjectRootChange"];
  readonly onOpenProject: ProjectWorkflowProps["onOpenProject"];
  readonly onCreateProject: ProjectWorkflowProps["onCreateProject"];
  readonly onCreateChapter: ProjectWorkflowProps["onCreateChapter"];
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
  readonly navigatorSearchQuery: string;
  readonly onNavigatorSearchQueryChange: NonNullable<
    WorkspaceShellProps["onNavigatorSearchQueryChange"]
  >;
  readonly onNavigatorExpandedSectionIdsChange: NonNullable<
    WorkspaceShellProps["onNavigatorExpandedSectionIdsChange"]
  >;
}

export function RendererWorkspaceShell(props: RendererWorkspaceShellProps) {
  return (
    <WorkspaceShell
      {...(props.aiWritingWorkflow === undefined
        ? {}
        : {
            aiWritingWorkflow: {
              ...props.aiWritingWorkflow,
              onInstructionChange: props.onAiInstructionChange,
              onGenerateSuggestion: props.onGenerateAiSuggestion,
              onApplySuggestion: props.onApplyAiSuggestion,
              onModelSelect: props.onAiModelSelect,
              onRejectSelectionReview: props.onRejectSelectionReview,
              onUndoSelectionReview: props.onUndoSelectionReview,
              onRetrySuggestion: props.onGenerateAiSuggestion,
              onCancelStreaming: props.onCancelAiStreaming
            } satisfies AiWritingWorkflowProps
          })}
      {...(props.projectWorkflow === undefined
        ? {}
        : {
            projectWorkflow: {
              ...props.projectWorkflow,
              onProjectRootChange: props.onProjectRootChange,
              onOpenProject: props.onOpenProject,
              onCreateProject: props.onCreateProject,
              onCreateChapter: props.onCreateChapter,
              onRenameChapter: props.onRenameChapter,
              onDuplicateChapter: props.onDuplicateChapter,
              onDeleteChapter: props.onDeleteChapter,
              onSelectChapter: props.onSelectChapter,
              onCloseChapterTab: props.onCloseChapterTab,
              onPreviewRecoveryDraft: props.onPreviewRecoveryDraft,
              onApplyRecoveryDraft: props.onApplyRecoveryDraft,
              onDiscardRecoveryDraft: props.onDiscardRecoveryDraft
            }
          })}
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
      {...(props.onboarding === undefined ? {} : { onboarding: props.onboarding })}
      {...(props.storyBible === undefined ? {} : { storyBible: props.storyBible })}
      {...(props.storyBibleEditor === undefined
        ? {}
        : {
            storyBibleEditor: {
              ...props.storyBibleEditor,
              onKindSelect: props.onStoryBibleKindSelect,
              onEntrySelect: props.onStoryBibleEntrySelect,
              onDraftChange: props.onStoryBibleDraftChange,
              onNewDraft: props.onNewStoryBibleDraft,
              onSave: props.onSaveStoryBibleDraft
            } satisfies StoryBibleEditorProps
          })}
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
      navigatorSearchQuery={props.navigatorSearchQuery}
      onNavigatorSearchQueryChange={props.onNavigatorSearchQueryChange}
      onNavigatorExpandedSectionIdsChange={props.onNavigatorExpandedSectionIdsChange}
    />
  );
}
