import type {
  ActivityId,
  AgentContextMode,
  AgentOperationMode,
  AgentRunErrorRecord,
  AgentRunEvent,
  AgentRunRetryTarget,
  AgentRunStatusV11,
  AgentWritePolicy,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ModelDiscoverySnapshot,
  ModelReasoningStrengthValue,
  PermissionSummary,
  PlanArtifact,
  PlanExecutionRecord,
  ProjectSearchResultItem,
  ProjectWorkspaceHealth
} from "@novel-studio/application";
import type {
  ChapterSummary,
  CreativeNavigatorMode,
  UserAppearancePreferences,
  WorkbenchMode
} from "@novel-studio/shared";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { CommandPaletteFeedback } from "./command-palette.js";
import type { ChangeSetReviewProps, RollbackReviewProps } from "./change-set-review.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import type { EditorPreferences } from "./editor-toolbar.js";
import type { ModelSettingsPanelProps } from "./model-settings-panel.js";
import type { PlanArtifactReviewProps } from "./plan-artifact-review.js";
import type { EngineeringWorkspaceNavigatorProps } from "./engineering-workspace-navigator.js";

export interface WorkspaceShellProps {
  readonly appearancePreferences?: UserAppearancePreferences | undefined;
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly commandPaletteFeedback?: CommandPaletteFeedback | undefined;
  readonly commandPaletteQuery?: string | undefined;
  readonly commandPaletteSelectedCommandId?: ApplicationCommandId | undefined;
  readonly chapterEditor?: ChapterEditorProps;
  readonly fileEditor?: PlainFileEditorProps;
  readonly projectWorkflow?: ProjectWorkflowProps;
  readonly aiWritingWorkflow?: AiWritingWorkflowProps;
  readonly agentConversationWorkspace?: AgentConversationWorkspaceShellProps;
  readonly search?: ProjectSearchProps;
  readonly settings?: ModelSettingsPanelProps;
  readonly studio?: ConfigStudioPanelProps;
  readonly storyBible?: StoryBibleSummaryProps;
  readonly storyBibleEditor?: StoryBibleEditorProps;
  readonly creativeNavigator?: CreativeWorkspaceNavigatorProps;
  readonly engineeringNavigator?: EngineeringWorkspaceNavigatorProps;
  readonly onboarding?: OnboardingProps;
  readonly onCommandPaletteOpen?: () => void;
  readonly onCommandPaletteClose?: () => void;
  readonly onCommandPaletteQueryChange?: ((query: string) => void) | undefined;
  readonly onCommandPaletteActiveCommandChange?:
    ((commandId: ApplicationCommandId) => void) | undefined;
  readonly onCommandExecute?: (commandId: ApplicationCommandId) => void;
  readonly onBottomPanelTabSelect?: ((tab: string) => void) | undefined;
  readonly onSearchResultOpen?: ((result: ProjectSearchResultItem) => void) | undefined;
  readonly onTimelineEntryOpen?: ((entryId: string) => void) | undefined;
  readonly onActivitySelect?: (activityId: ActivityId) => void;
  readonly onWorkbenchSelect?: (mode: WorkbenchMode) => void;
  readonly onOpenEngineeringWorkspace?: () => void;
  readonly onSettingsClose?: (() => void) | undefined;
  readonly navigatorSearchQuery?: string | undefined;
  readonly onNavigatorSearchQueryChange?: ((query: string) => void) | undefined;
  readonly onNavigatorExpandedSectionIdsChange?:
    ((sectionIds: readonly string[]) => void) | undefined;
}

export interface CreativeWorkspaceNavigatorProps {
  readonly projectTitle: string;
  readonly projectWorkflow?: ProjectWorkflowProps | undefined;
  readonly mode: CreativeNavigatorMode;
  readonly searchQuery: string;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly dirtyChapterIds: readonly string[];
  readonly storyBible: StoryBibleEditorProps;
  readonly onModeSelect: (mode: CreativeNavigatorMode) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onCreateChapter: () => void;
  readonly onChapterOpen: (chapterId: string) => void;
  readonly onChapterRename: (chapterId: string, title: string) => void;
  readonly onChapterDuplicate: (chapterId: string) => void;
  readonly onChapterDelete: (chapterId: string) => void;
  readonly onStoryKindOpen: (kind: StoryBibleEditorKind) => void;
  readonly onStoryEntryOpen: (entryId: string) => void;
  readonly onStoryEntryCreate: (kind: StoryBibleEditorKind) => void;
}

export type RecoveryReviewProps =
  | {
      readonly source: "chapter_autosave";
      readonly recovery: ProjectWorkflowRecoveryProps;
      readonly chapters: ProjectWorkflowProps["chapters"];
      readonly onPreview: (sessionId: string) => void;
      readonly onApply: (sessionId: string) => void;
      readonly onDiscard: (sessionId: string) => void;
    }
  | {
      readonly source: "agent_transaction";
      readonly runId: string;
      readonly versionGroupId?: string;
      readonly errorCode: string;
      readonly message: string;
      readonly failedHooks: readonly string[];
      readonly onOpenRollback?: () => void;
      readonly onRetry?: () => void;
    };

export type AgentConversationMainReview =
  | { readonly kind: "plan"; readonly props: PlanArtifactReviewProps }
  | { readonly kind: "change_set"; readonly props: ChangeSetReviewProps }
  | { readonly kind: "rollback"; readonly props: RollbackReviewProps }
  | { readonly kind: "recovery"; readonly props: RecoveryReviewProps }
  | { readonly kind: "selection"; readonly props: AiSelectionReviewProps };

export interface AgentConversationWorkspaceShellProps {
  readonly navigator: AgentConversationNavigatorProps;
  readonly view: AgentConversationViewProps;
  readonly mainReview?: AgentConversationMainReview;
}

export interface ProjectWorkflowProps {
  readonly projectId?: string;
  readonly projectTitleInput?: string;
  readonly projectFolderNameInput?: string;
  readonly selectedParentSelectionId?: string;
  readonly selectedParentDisplayName?: string;
  readonly creationPreview?: {
    readonly folderName: string;
    readonly parentDisplayName: string;
    readonly targetDisplayName: string;
  };
  readonly status?: ProjectWorkflowStatus;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly openChapterTabIds?: readonly string[];
  readonly dirtyChapterIds?: readonly string[];
  readonly recovery?: ProjectWorkflowRecoveryProps;
  readonly health?: ProjectWorkspaceHealth;
  readonly onProjectTitleChange?: ((title: string) => void) | undefined;
  readonly onProjectFolderNameChange?: ((folderName: string) => void) | undefined;
  readonly onChooseCreateParentDirectory?: (() => void) | undefined;
  readonly onOpenProject: () => void;
  readonly onCreateProject: () => void;
  readonly onCreateChapter: () => void;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly onRenameChapter?: (chapterId: string, title: string) => void;
  readonly onDuplicateChapter?: (chapterId: string) => void;
  readonly onDeleteChapter?: (chapterId: string) => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly onCloseChapterTab?: (chapterId: string) => void;
  readonly onPreviewRecoveryDraft?: (sessionId: string) => void;
  readonly onApplyRecoveryDraft?: (sessionId: string) => void;
  readonly onDiscardRecoveryDraft?: (sessionId: string) => void;
}

export interface PlainFileEditorProps {
  readonly path: string;
  readonly fileName: string;
  readonly content: string;
  readonly dirty: boolean;
  readonly saveStatus: "Saved" | "Saving" | "Unsaved";
  readonly readOnlyReason?: string;
  readonly feedback?: ProjectWorkflowFeedback | undefined;
  readonly conflict?: {
    readonly diskContent: string;
    readonly draftContent: string;
    readonly diskChecksum: string;
  };
  readonly editorPreferences?: EditorPreferences | undefined;
  readonly onContentChange?: ((content: string) => void) | undefined;
  readonly onSave?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly onReloadFromDisk?: (() => void) | undefined;
  readonly onKeepDraft?: (() => void) | undefined;
  readonly onEditorPreferencesChange?: ((preferences: EditorPreferences) => void) | undefined;
  readonly onFocusModeToggle?: (() => void) | undefined;
}

export interface ProjectFileTreeItemProps {
  readonly id: string;
  readonly name: string;
  readonly kind: "directory" | "file";
  readonly path: string;
  readonly children?: readonly ProjectFileTreeItemProps[];
}

export interface ProjectWorkflowRecoveryProps {
  readonly availableItems: readonly ProjectWorkflowRecoveryItemProps[];
  readonly review?: ProjectWorkflowRecoveryReviewProps;
}

export interface ProjectWorkflowRecoveryItemProps {
  readonly sessionId: string;
  readonly chapterId: string;
  readonly updatedAt: string;
}

export interface ProjectWorkflowRecoveryReviewProps {
  readonly status: "idle" | "previewing" | "applying" | "discarding";
  readonly selectedDraft?: ProjectWorkflowRecoveryDraftPreviewProps;
}

export interface ProjectWorkflowRecoveryDraftPreviewProps {
  readonly sessionId: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly updatedAt: string;
  readonly body: string;
}

export type ProjectWorkflowStatus = "idle" | "opening" | "creating" | "ready";

export interface ProjectWorkflowFeedback {
  readonly kind: "info" | "error";
  readonly message: string;
}

export interface OnboardingProps {
  readonly visible: boolean;
  readonly dismissed: boolean;
  readonly steps: readonly OnboardingStepProps[];
  readonly onCreateExampleProject: () => void;
  readonly onCreateProject: () => void;
  readonly onOpenProject: () => void;
  readonly onCreateFirstChapter: () => void;
  readonly onDismiss: () => void;
}

export interface OnboardingStepProps {
  readonly id: string;
  readonly label: string;
  readonly completed: boolean;
}

export type AiWritingWorkflowStatus =
  "idle" | "generating" | "streaming" | "suggestion-ready" | "applied" | "failed" | "cancelled";

export interface AiWritingWorkflowProps {
  readonly status: AiWritingWorkflowStatus;
  readonly instruction: string;
  readonly conversationMessages?: readonly AiWritingConversationMessageProps[];
  readonly summary?: string;
  readonly runtimeNotice?: string;
  readonly streamPreview?: string;
  readonly contextTraceLabel?: string;
  readonly observability?: AiWorkflowObservabilityProps;
  readonly history?: AiWorkflowRunHistoryProps;
  readonly failure?: AiWorkflowFailureDiagnosticProps;
  readonly retryPolicy?: AiWorkflowRetryPolicyProps;
  readonly diffPreview?: ChapterEditorProps["diffPreview"];
  readonly selectionReview?: AiSelectionReviewProps;
  readonly styleReview?: AiWritingStyleReviewProps;
  readonly modelDiscovery?: ModelDiscoverySnapshot;
  readonly selectedModelName?: string;
  readonly selectedReasoningEffort?: ModelReasoningStrengthValue;
  readonly agentRun?: AgentRunPanelProps;
  readonly onInstructionChange: (instruction: string) => void;
  readonly onGenerateSuggestion: () => void;
  readonly onApplySuggestion: () => void;
  readonly onModelSelect?: (modelName: string) => void;
  readonly onReasoningEffortSelect?: (value: ModelReasoningStrengthValue) => void;
  readonly onRejectSelectionReview?: () => void;
  readonly onUndoSelectionReview?: () => void;
  readonly onRetrySuggestion: () => void;
  readonly onCancelStreaming: () => void;
}

export interface AgentComposerProps {
  readonly request: string;
  readonly operationMode: AgentOperationMode;
  readonly contextMode: AgentContextMode;
  readonly writePolicy: AgentWritePolicy;
  readonly writePolicyAcknowledged: boolean;
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** Presentation-only context filtering; the underlying Stage 5 enum remains unchanged. */
  readonly availableContextModes?: readonly AgentContextMode[];
  /** Optional selection/style actions rendered in the existing Composer toolbar. */
  readonly quickActions?: readonly AgentComposerQuickAction[];
  /** Model profile selector (right toolbar). Populated from the Settings snapshot, written to the draft. */
  readonly model?: AgentComposerModelControl;
  /** Reasoning-effort selector (right toolbar). Hidden when the selected model does not expose it. */
  readonly reasoning?: AgentComposerReasoningControl;
  /** Context references (`+` menu + removable chips, left toolbar), backed by the Context Draft. */
  readonly references?: AgentComposerReferenceControl;
  /** Quiet context-status button; surfaces heavy/stale/failed states and the compact command. */
  readonly contextStatus?: AgentComposerContextStatusControl;
  /** Server-owned capability facts and the execution-only Change Set approval policy. */
  readonly permission?: AgentComposerPermissionControl;
  readonly onRequestChange: (request: string) => void;
  readonly onOperationModeChange: (mode: AgentOperationMode) => void;
  readonly onContextModeChange: (mode: AgentContextMode) => void;
  readonly onWritePolicyChange: (policy: AgentWritePolicy) => void;
  readonly onSend: (request: string) => void;
  readonly onStop: () => void;
}

export interface AgentComposerQuickAction {
  readonly id: "rewrite_selection" | "review_style";
  readonly label: string;
  readonly disabledReason?: string;
  readonly onSelect: () => void;
}

/** Local mirror of `agent-engine`'s AgentContextPrecision (UI cannot import agent-engine directly). */
export type AgentContextPrecision = "reported" | "estimated" | "unknown";

export interface AgentComposerModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
}

export interface AgentComposerModelControl {
  readonly profiles: readonly AgentComposerModelOption[];
  readonly selectedProfileId: string;
  readonly onSelect: (profileId: string) => void;
}

export interface AgentComposerReasoningControl {
  readonly visible: boolean;
  readonly values: readonly ModelReasoningStrengthValue[];
  readonly current: ModelReasoningStrengthValue;
  readonly onSelect: (value: ModelReasoningStrengthValue) => void;
}

export type AgentComposerReferenceKind =
  "chapter" | "story_bible" | "project_file" | "editor_selection";

export interface AgentComposerReferenceChip {
  readonly refId: string;
  readonly label: string;
  readonly kind: AgentComposerReferenceKind;
}

export interface AgentComposerReferenceControl {
  readonly chips: readonly AgentComposerReferenceChip[];
  readonly available: readonly AgentComposerReferenceChip[];
  readonly onAdd: (refId: string) => void;
  readonly onRemove: (refId: string) => void;
}

export type AgentComposerContextState = "normal" | "heavy" | "needs_refresh" | "compaction_failed";

export interface AgentComposerContextSourceRow {
  readonly refId: string;
  readonly label: string;
  readonly detail: string;
}

export interface AgentComposerContextStatusControl {
  readonly state: AgentComposerContextState;
  readonly usageLabel: string;
  readonly precision: AgentContextPrecision;
  readonly sources: readonly AgentComposerContextSourceRow[];
  readonly onCompact?: (() => void) | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
}

export interface AgentComposerPermissionControl {
  readonly summary?: PermissionSummary;
  readonly loading: boolean;
  readonly errorMessage?: string;
  readonly approvalSource:
    "not_applicable" | "not_approved" | "human_confirmation" | "user_preapproved_run";
  readonly onOpen: () => void;
}

export type AgentPlanReviewProps = PlanArtifactReviewProps;

export interface AgentRunPanelProps {
  readonly projectId: string;
  readonly runId?: string;
  readonly status: AgentRunStatusV11 | "idle";
  readonly assistantText: string;
  readonly events: readonly AgentRunEvent[];
  readonly pendingUserInput?: AgentRunPendingUserInputProps;
  readonly diagnostic?: AgentRunErrorRecord;
  readonly errorMessage?: string;
  readonly providerLabel?: string;
  readonly contextSourceNotice?: string;
  readonly changeSetReview?: ChangeSetReviewProps;
  readonly rollbackReview?: RollbackReviewProps;
  readonly planExecution?: AgentPlanExecutionControl;
  readonly canUndoRun?: boolean;
  readonly onUndoRun?: () => void;
  readonly onAnswerUserInput: (answer: string) => void;
  readonly onResume: () => void;
  readonly onRetryStep: () => void;
  readonly onRetryTarget?: (target: AgentRunRetryTarget) => void;
  readonly onRefreshContext: (decision: "refresh" | "exclude" | "cancel") => void;
}

export interface AgentPlanRevisionRequestView {
  readonly requestId: string;
  readonly planExecutionId: string;
  readonly planId: string;
  readonly planRevision: number;
  readonly originalPlan: string;
  readonly discovery: string;
  readonly proposal: string;
  readonly affectedStepIds: readonly string[];
}

export interface AgentPlanExecutionControl {
  readonly record: PlanExecutionRecord;
  readonly plan?: PlanArtifact;
  readonly revisionRequest?: AgentPlanRevisionRequestView;
  readonly deciding?: boolean;
  readonly onDecideRevision: (decision: "approve" | "reject") => void;
}

export interface AgentPlanExecutionOptions {
  readonly executionContextMode: AgentContextMode;
  readonly executionWritePolicy: AgentWritePolicy;
  readonly executionWritePolicyAcknowledged?: true;
}

export interface AgentRunPendingUserInputProps {
  readonly questionId: string;
  readonly prompt: string;
  readonly reason: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly allowFreeText: boolean;
}

export interface AiWritingConversationMessageProps {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAtLabel: string;
}

export type AgentConversationFilter = "active" | "archived";

export interface AgentConversationListItemProps {
  readonly conversationId: string;
  readonly title: string;
  readonly status: AgentConversationFilter;
  readonly updatedAtLabel: string;
  readonly runCount: number;
  readonly lastRunStatusLabel?: string;
  readonly preview?: string;
  readonly virtual?: true;
  readonly canArchive?: boolean;
  readonly archiveDisabledReason?: string;
}

export interface AgentConversationTurnProps {
  readonly runId: string;
  readonly userRequest: string;
  readonly assistantText?: string;
  readonly events?: readonly AgentRunEvent[];
  readonly statusLabel: string;
  readonly updatedAtLabel: string;
}

export interface AgentConversationDetailProps extends AgentConversationListItemProps {
  readonly contextSummary?: string;
  readonly turns: readonly AgentConversationTurnProps[];
}

export interface AgentConversationNavigatorProps {
  readonly conversations: readonly AgentConversationListItemProps[];
  readonly selectedConversationId?: string;
  readonly activeConversationId?: string;
  readonly searchQuery: string;
  readonly filter: AgentConversationFilter;
  readonly loading: boolean;
  readonly busyConversationId?: string;
  readonly errorMessage?: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onFilterChange: (filter: AgentConversationFilter) => void;
  readonly onCreate: () => void;
  readonly onSelect: (conversationId: string) => void;
  readonly onArchive: (conversationId: string) => void;
  readonly onRestore: (conversationId: string) => void;
  readonly onDelete?: ((conversationId: string) => void) | undefined;
}

export interface AgentConversationViewProps {
  readonly conversation?: AgentConversationDetailProps | undefined;
  readonly activeConversationId?: string;
  readonly activeConversationTitle?: string;
  readonly agentRun?: AgentRunPanelProps;
  readonly composer?: AgentComposerProps;
  readonly navigator?: AgentConversationNavigatorProps;
  readonly mainReview?: AgentConversationMainReview;
  readonly onOpenMainReview?: (review: AgentConversationMainReview) => void;
  readonly loading: boolean;
  readonly createDisabled?: boolean;
  readonly errorMessage?: string;
  readonly onCreate: () => void;
  readonly onArchive: (conversationId: string) => void;
  readonly onRestore: (conversationId: string) => void;
  readonly onReturnToActive: () => void;
}

export interface AiSelectionReviewProps {
  readonly status: "pending" | "rejected" | "applied";
  readonly originalText: string;
  readonly proposedText: string;
  readonly rangeLabel: string;
  readonly compareLabel: string;
  readonly canUndo: boolean;
  readonly styleReview?: AiWritingStyleReviewProps;
  readonly diagnostic?: AiWorkflowFailureDiagnosticProps;
  readonly onAccept?: () => void;
  readonly onReject?: () => void;
  readonly onUndo?: () => void;
  readonly onRetry?: () => void;
}

export interface AiWritingStyleReviewProps {
  readonly status: "clean" | "attention";
  readonly hitCount: number;
  readonly hits: readonly AiWritingStyleHitProps[];
}

export interface AiWritingStyleHitProps {
  readonly ruleId: string;
  readonly title: string;
  readonly severity: "notice" | "warning";
  readonly matchedText: string;
  readonly positionLabel: string;
  readonly suggestion: string;
}

export interface AiWorkflowFailureDiagnosticProps {
  readonly title: string;
  readonly code: string;
  readonly message: string;
  readonly recoverabilityLabel: string;
  readonly suggestedAction: string;
}

export interface AiWorkflowRetryPolicyProps {
  readonly modeLabel: string;
  readonly maxAttemptsLabel: string;
  readonly backoffLabel: string;
  readonly retryableCodesLabel: string;
}

export type AiWorkflowObservedStepKind = "context" | "agent" | "confirmation" | "branch";
export type AiWorkflowObservedStepStatus =
  "pending" | "running" | "completed" | "waiting-confirmation" | "failed";

export interface AiWorkflowBranchChoiceProps {
  readonly branchId: string;
  readonly label: string;
  readonly conditionLabel?: string;
}

export interface AiWorkflowObservedStepProps {
  readonly stepId: string;
  readonly label: string;
  readonly kind: AiWorkflowObservedStepKind;
  readonly status: AiWorkflowObservedStepStatus;
  readonly description?: string;
  readonly branchChoices?: readonly AiWorkflowBranchChoiceProps[];
  readonly selectedBranchId?: string;
}

export interface AiWorkflowObservabilityProps {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly contextLabel: string;
  readonly modelLabel: string;
  readonly usageLabel: string;
  readonly costLabel: string;
  readonly generatedAtLabel: string;
  readonly steps: readonly AiWorkflowObservedStepProps[];
}

export interface AiWorkflowRunHistoryProps {
  readonly runs: readonly AiWorkflowRunHistoryItemProps[];
  readonly selectedRun?: AiWorkflowRunHistoryDetailProps;
}

export interface AiWorkflowRunHistoryItemProps {
  readonly workflowRunId: string;
  readonly workflowTitle: string;
  readonly statusLabel: string;
  readonly updatedAtLabel: string;
  readonly modelLabel: string;
  readonly usageLabel: string;
  readonly costLabel: string;
}

export interface AiWorkflowRunHistoryDetailProps extends AiWorkflowRunHistoryItemProps {
  readonly contextLabel: string;
  readonly steps: readonly AiWorkflowObservedStepProps[];
  readonly errorLabel?: string;
}

export interface StoryBibleSummaryProps {
  readonly assets: readonly StoryBibleSummaryAsset[];
}

export type ProjectSearchStatus =
  "idle" | "indexing" | "searching" | "results-ready" | "empty" | "error";

export interface ProjectSearchProps {
  readonly query: string;
  readonly status: ProjectSearchStatus;
  readonly entryCount?: number;
  readonly generatedAt?: string;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly results: readonly ProjectSearchResultItem[];
  readonly onQueryChange: (query: string) => void;
  readonly onSearch: () => void;
  readonly onRebuildIndex: () => void;
  readonly onResultOpen?: ((result: ProjectSearchResultItem) => void) | undefined;
}

export interface StoryBibleSummaryAsset {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly summary: string;
  readonly contextEligible?: boolean;
}

export type StoryBibleEditorKind = "character" | "world" | "outline" | "timeline" | "memory";
export type StoryBibleEditorStatus = "idle" | "saving" | "saved" | "error";

export interface StoryBibleEditorEntry {
  readonly id: string;
  readonly kind: StoryBibleEditorKind;
  readonly title: string;
  readonly status: string;
  readonly body: string;
  readonly timelineEvents?: readonly StoryTimelineEvent[];
}

export interface StoryTimelineEvent {
  readonly id: string;
  readonly parentEntryId?: string;
  readonly sequence: number;
  readonly title: string;
  readonly status: string;
  readonly summary: string;
  readonly chapterIds: readonly string[];
}

export interface StoryBibleEditorDraft {
  readonly id?: string;
  readonly kind: StoryBibleEditorKind;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface StoryBibleEditorProps {
  readonly activeKind: StoryBibleEditorKind;
  readonly status: StoryBibleEditorStatus;
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly consistency?: StoryBibleConsistencyProps;
  readonly draft: StoryBibleEditorDraft;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly onKindSelect: (kind: StoryBibleEditorKind) => void;
  readonly onEntrySelect: (entryId: string) => void;
  readonly onDraftChange: (draft: Partial<StoryBibleEditorDraft>) => void;
  readonly onNewDraft: () => void;
  readonly onSave: () => void;
}

export type StoryBibleConsistencyStatus = "healthy" | "attention";

export interface StoryBibleConsistencyProps {
  readonly status: StoryBibleConsistencyStatus;
  readonly checkedAt: string;
  readonly issues: readonly StoryBibleConsistencyIssueProps[];
}

export interface StoryBibleConsistencyIssueProps {
  readonly id: string;
  readonly severity: "warning";
  readonly title: string;
  readonly message: string;
  readonly sourceRef: StoryBibleConsistencyRefProps;
  readonly targetRef: StoryBibleConsistencyRefProps;
  readonly suggestedAction: string;
}

export interface StoryBibleConsistencyRefProps {
  readonly kind: StoryBibleEditorKind;
  readonly id: string;
  readonly title: string;
}
