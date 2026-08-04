import type {
  ActivityId,
  AgentContextMode,
  AgentOperationMode,
  AgentRunErrorRecord,
  AgentRunEvent,
  AgentRunPackedContextHistory,
  AgentRunRetryTarget,
  AgentRunStatusV13,
  AgentWritePolicy,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ForeshadowAnalysisEvidenceDto,
  ForeshadowAnalysisResultDto,
  ModelDiscoverySnapshot,
  ModelReasoningStrengthValue,
  PermissionSummary,
  PlanArtifact,
  PlanExecutionRecord,
  ProjectSearchResultItem,
  ProjectWorkspaceHealth,
  StoryAnalysisCompletionMode,
  StoryBibleMaintenanceMode,
  StoryBibleAssetType,
  StoryBibleEntityStatus
} from "@novel-studio/application";
import type {
  ChapterSummary,
  CreativeNavigatorMode,
  ForeshadowDetails,
  ForeshadowTrackingStatus,
  JsonObject,
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
import type { ProjectFileTreeNode } from "./project-file-tree.js";

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
  /**
   * The creative-project-file surface is deliberately scoped to the creative
   * navigator. It exposes only project-relative identities and lifecycle
   * callbacks; root paths and engineering workspace capabilities never cross
   * this UI boundary.
   */
  readonly projectFiles?: CreativeProjectFilesNavigatorProps | undefined;
  readonly onModeSelect: (mode: CreativeNavigatorMode) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onCreateChapter: () => void;
  readonly onChapterOpen: (chapterId: string) => void;
  readonly onChapterRename: (chapterId: string, title: string) => void;
  readonly onChapterDuplicate: (chapterId: string) => void;
  readonly onChapterDelete: (chapterId: string) => void;
  readonly onStoryKindOpen: (kind: StoryBibleEditorKind) => void;
}

export interface CreativeProjectFilesNavigatorProps {
  readonly nodes: readonly ProjectFileTreeNode[];
  readonly expandedPathIds: readonly string[];
  readonly activeFilePath?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly truncated?: boolean | undefined;
  readonly errorMessage?: string | undefined;
  readonly onExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onFileOpen: (path: string) => void;
  readonly onRefresh: () => void;
  readonly onCreateTextFile: (path: string) => void;
  readonly onCreateDirectory: (path: string) => void;
  readonly onRenamePath: (sourcePath: string, targetPath: string) => void;
  readonly onDeletePath: (path: string) => void;
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
  /** App-owned choice for a future Act handoff; it never authorizes the current Plan run. */
  readonly executionWritePolicyDraft: AgentWritePolicy;
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
  readonly onExecutionWritePolicyDraftChange: (policy: AgentWritePolicy) => void;
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
  readonly suggested: readonly AgentComposerReferenceChip[];
  readonly onAdd: (refId: string) => void;
  readonly onRemove: (refId: string) => void;
  /** Opens the native project-file picker used by the + menu. */
  readonly onPickFile?: (() => void) | undefined;
}

export type AgentComposerContextState = "normal" | "heavy" | "needs_refresh" | "compaction_failed";

/** UI mirror of the packed-context selection policy. */
export type AgentComposerContextSelectionPolicy = "automatic" | "explicit" | "pinned";

/** Where an author-initiated source preference is persisted. */
export type AgentComposerContextPreferenceScope = "run" | "project";

/** Resolved origin of a source preference shown in the context inspector. */
export type AgentComposerContextSourcePreferenceScope =
  "automatic" | AgentComposerContextPreferenceScope;

export type AgentComposerContextSourceState = "active" | "stale" | "excluded";

export interface AgentComposerContextTruncationRange {
  readonly unit: "unicode_code_point";
  readonly start: number;
  readonly end: number;
  readonly originalEnd: number;
}

export interface AgentComposerContextTokenStats {
  readonly contextTokens: number;
  readonly pinnedTokens: number;
  readonly usedTokens: number;
  readonly safeInputBudget: number;
  readonly remainingTokens: number;
  readonly precision: AgentContextPrecision;
}

/**
 * Author-visible projection of one immutable packed-context block. Internal prompt roles,
 * provider metadata, and hidden instructions are intentionally absent from this UI contract.
 */
export interface AgentComposerContextPreviewBlock {
  readonly blockId: string;
  readonly refId: string;
  readonly label: string;
  readonly content: string;
  readonly order: number;
  readonly tokenCount: number;
  readonly precision: AgentContextPrecision;
  readonly checksum: string;
  readonly truncationRange?: AgentComposerContextTruncationRange | null;
}

export interface AgentComposerSendPreviewSource {
  readonly sourceRef: string;
  readonly label: string;
  readonly kind:
    | "disk_file"
    | "editor_buffer"
    | "story_bible_asset"
    | "project_conventions"
    | "workspace_outline"
    | "conversation_summary"
    | "compaction_summary"
    | "active_resource"
    | "explicit_reference";
  readonly content: string;
  readonly tokenCount: number | null;
  readonly tokenPrecision: AgentContextPrecision;
  readonly dirty: boolean;
  readonly truncated: boolean;
  readonly selectionState: "automatic" | "pinned" | "explicit" | "excluded";
  readonly grantSource: "not_applicable" | "workspace_default" | "run_grant" | "user_explicit";
}

export interface AgentComposerSendPreview {
  readonly schemaVersion: "2.0";
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly canonicalPayloadChecksum: string;
  readonly target: {
    readonly providerLabel: string;
    readonly modelLabel: string;
    readonly connectionLabel: string;
    readonly adapterPolicyLabel: string;
  };
  readonly guidance: {
    readonly version: string;
    readonly profileId: string;
    readonly runtimeFacts: JsonObject;
    readonly content: string;
  };
  readonly tools: readonly {
    readonly name: string;
    readonly description: string | null;
    readonly inputSchema: JsonObject;
  }[];
  readonly sources: readonly AgentComposerSendPreviewSource[];
  readonly retainedLocalProvenanceKinds: readonly (
    | "workspace_identity"
    | "canonical_root_identity"
    | "absolute_path"
    | "artifact_identity"
    | "provider_account_identity"
    | "transport_secret"
    | "cache_resource_handle"
  )[];
  readonly providerNativeSemanticChecksum: string | null;
}

export interface AgentComposerContextSourceRow {
  readonly refId: string;
  readonly label: string;
  readonly detail?: string;
  readonly sourceKind?:
    | "disk_file"
    | "editor_buffer"
    | "story_bible_asset"
    | "project_conventions"
    | "workspace_outline"
    | "compaction_summary"
    | "system_guidance";
  readonly relativePath?: string;
  readonly layerLabel?: string;
  readonly metadata?: readonly string[];
  readonly selectionReason?: string;
  readonly selectionPolicy?: AgentComposerContextSelectionPolicy;
  readonly preferenceScope?: AgentComposerContextSourcePreferenceScope;
  readonly priority?: number;
  readonly state?: AgentComposerContextSourceState;
  readonly tokenCount?: number | null;
  readonly precision?: AgentContextPrecision;
  readonly sourceChecksum?: string;
  readonly sourceRevision?: number;
  readonly truncationRange?: AgentComposerContextTruncationRange | null;
  readonly materializationOrder?: number;
  readonly busy?: boolean;
  readonly onPin?: (() => void) | undefined;
  readonly onExclude?: (() => void) | undefined;
  readonly onRestore?: (() => void) | undefined;
  readonly onPriorityChange?: ((priority: number) => void) | undefined;
}

export interface AgentComposerConventionsControl {
  readonly relativePath: "AGENTS.md" | "conventions/writing.md";
  readonly status: "unknown" | "created" | "existing" | "available";
  readonly busy?: boolean;
  readonly errorMessage?: string;
  readonly onCreate?: (() => void) | undefined;
  readonly onDisable?: (() => void) | undefined;
  readonly onRevokeTrust?: (() => void) | undefined;
}

export interface AgentComposerContextStatusControl {
  readonly state: AgentComposerContextState;
  readonly usageLabel: string;
  readonly precision: AgentContextPrecision;
  readonly sources: readonly AgentComposerContextSourceRow[];
  readonly preferenceScope?: AgentComposerContextPreferenceScope;
  readonly onPreferenceScopeChange?:
    ((scope: AgentComposerContextPreferenceScope) => void) | undefined;
  readonly previewBlocks?: readonly AgentComposerContextPreviewBlock[];
  readonly previewPayloadChecksum?: string;
  readonly previewUnavailableReason?: string;
  /** Exact Main-owned first-round projection. The legacy block preview is not a send authority. */
  readonly sendPreview?: AgentComposerSendPreview;
  readonly tokenStats?: AgentComposerContextTokenStats;
  readonly fixedBudgetExceeded?: boolean;
  readonly fixedBudgetMessage?: string;
  readonly conventions?: AgentComposerConventionsControl;
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
  /** Conversation that owns this live or pending run. */
  readonly conversationId?: string;
  readonly runId?: string;
  /** The request currently being started; shown immediately before a persisted run exists. */
  readonly userRequest?: string;
  readonly status: AgentRunStatusV13 | "idle";
  readonly assistantText: string;
  readonly events: readonly AgentRunEvent[];
  /** Historical provider-bound context; unavailable/stale is explicit rather than silently empty. */
  readonly packedContextHistory?: AgentRunPackedContextHistory;
  readonly sendLedger?: readonly AgentSendLedgerEntryDisplay[];
  readonly pendingUserInput?: AgentRunPendingUserInputProps;
  readonly pendingToolApproval?: AgentRunPendingToolApprovalProps;
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
  readonly onDecideToolApproval?: (decision: "approve" | "reject") => void;
}

export interface AgentSendLedgerEntryDisplay {
  readonly entryId: string;
  readonly roundNumber: number;
  readonly roundKind: "first_send" | "subsequent_send";
  readonly canonicalPayloadChecksum: string;
  readonly canonicalRoundManifestChecksum: string;
  readonly previewId: string | null;
  readonly sentAtLabel: string;
  readonly additions: readonly {
    readonly additionId: string;
    readonly kind:
      | "assistant"
      | "tool_result"
      | "remote_result"
      | "user_control"
      | "jit_context"
      | "context_refresh"
      | "recovery";
    readonly content: string;
    readonly contentChecksum: string;
  }[];
}

export interface AgentRunPendingToolApprovalProps {
  readonly bindingId: string;
  readonly canonicalToolId: string;
  readonly kind: "network" | "external" | "task";
  readonly argumentsText: string;
  readonly destination?: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly deciding: boolean;
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

export type StoryBibleEditorKind = "character" | "world" | "outline" | "foreshadow" | "timeline";
export type StoryBibleWorldAssetType = Extract<StoryBibleAssetType, `world.${string}`>;
export type StoryBibleEditorViewMode = "list" | "detail";
export type StoryBibleEditorStatus = "idle" | "saving" | "saved" | "error";

export interface StoryBibleExplicitInversePreviewFile {
  readonly assetId: string;
  readonly title: string;
  readonly side: "source" | "inverse";
  readonly hunkCount: number;
}

export type StoryBibleExplicitInversePreviewState =
  | {
      readonly status: "confirmation" | "applying";
      readonly previewId: string;
      readonly revision: number;
      readonly checksum: string;
      readonly expiresAt: string;
      readonly files: readonly StoryBibleExplicitInversePreviewFile[];
    }
  | undefined;

export interface StoryBibleEditorRelation extends JsonObject {
  readonly relationId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationType: string;
  readonly direction: "directed" | "symmetric";
  readonly status: "active" | "ended" | "uncertain";
  readonly validFromChapterId: string | null;
  readonly validToChapterId: string | null;
  readonly inversePolicy: "derived" | "explicit" | "none";
  readonly inverseRelationId: string | null;
  readonly evidence: JsonObject[];
  readonly note: string;
}

interface StoryBibleEditorEntryBase<
  K extends StoryBibleEditorKind,
  A extends StoryBibleAssetType,
  D extends JsonObject = JsonObject
> {
  readonly id: string;
  readonly kind: K;
  readonly assetType: A;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases: readonly string[];
  readonly relations?: readonly StoryBibleEditorRelation[];
  readonly relatedEntityIds: readonly string[];
  readonly details: D;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type StoryBibleEditorEntry =
  | StoryBibleEditorEntryBase<"character", "character">
  | StoryBibleEditorEntryBase<"world", StoryBibleWorldAssetType>
  | StoryBibleEditorEntryBase<"outline", "outline">
  | StoryBibleEditorEntryBase<"foreshadow", "foreshadow", ForeshadowDetails>
  | (StoryBibleEditorEntryBase<"timeline", "timeline.events"> & {
      readonly timelineEvents: readonly StoryTimelineEvent[];
    });

export interface StoryTimelineEvent {
  readonly id: string;
  readonly parentEntryId?: string;
  readonly sequence: number;
  readonly title: string;
  readonly status: string;
  readonly timeLabel: string;
  readonly summary: string;
  readonly chapterIds: readonly string[];
  readonly characterIds: readonly string[];
  readonly locationIds: readonly string[];
  readonly causes: readonly string[];
  readonly effects: readonly string[];
}

interface StoryBibleEditorDraftBase<
  K extends StoryBibleEditorKind,
  A extends StoryBibleAssetType,
  D extends JsonObject = JsonObject
> {
  readonly id?: string;
  readonly kind: K;
  readonly assetType: A;
  readonly title: string;
  readonly status: StoryBibleEntityStatus;
  readonly summary: string;
  readonly aliases: readonly string[];
  readonly relations?: readonly StoryBibleEditorRelation[];
  readonly relatedEntityIds: readonly string[];
  readonly details: D;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type StoryBibleEditorDraft =
  | StoryBibleEditorDraftBase<"character", "character">
  | StoryBibleEditorDraftBase<"world", StoryBibleWorldAssetType>
  | StoryBibleEditorDraftBase<"outline", "outline">
  | StoryBibleEditorDraftBase<"foreshadow", "foreshadow", ForeshadowDetails>
  | StoryBibleEditorDraftBase<"timeline", "timeline.events">;

export type StoryBibleEditorDraftFor<K extends StoryBibleEditorKind> = Extract<
  StoryBibleEditorDraft,
  { readonly kind: K }
>;

export interface StoryBibleChapterOption {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly status: ChapterSummary["status"];
}

export type StoryBibleForeshadowChangeField =
  | "title"
  | "summary"
  | "trackingStatus"
  | "plantedChapterId"
  | "plannedPayoffChapterId"
  | "actualPayoffChapterId"
  | "notes"
  | "relatedEntityIds";

export interface StoryBibleForeshadowFieldChange {
  readonly field: StoryBibleForeshadowChangeField;
  readonly before?: string;
  readonly after: string;
}

export interface StoryBibleForeshadowChangeItem {
  readonly changeId: string;
  readonly operation: "create" | "update";
  readonly assetId: string;
  readonly title: string;
  readonly sourceCandidateIds: readonly string[];
  readonly fields: readonly StoryBibleForeshadowFieldChange[];
  readonly evidenceAdditions: readonly ForeshadowAnalysisEvidenceDto[];
  readonly status: "pending" | "applying" | "succeeded" | "failed";
  readonly errorMessage?: string;
}

export type StoryBibleForeshadowReviewState =
  | {
      readonly step: "candidates";
      readonly selectedCandidateIds: readonly string[];
      readonly message?: string;
    }
  | {
      readonly step: "preparing";
      readonly selectedCandidateIds: readonly string[];
    }
  | {
      readonly step: "confirmation" | "applying";
      readonly selectedCandidateIds: readonly string[];
      readonly changes: readonly StoryBibleForeshadowChangeItem[];
    }
  | {
      readonly step: "results";
      readonly selectedCandidateIds: readonly string[];
      readonly changes: readonly StoryBibleForeshadowChangeItem[];
      readonly outcome: "completed" | "partial_failure";
      readonly message?: string;
    };

export type StoryBibleForeshadowAnalysisState =
  | {
      readonly status: "closed" | "selecting" | "preparing" | "scanning";
      readonly selectedChapterIds: readonly string[];
    }
  | {
      readonly status: "review";
      readonly selectedChapterIds: readonly string[];
      readonly result: ForeshadowAnalysisResultDto;
      readonly review: StoryBibleForeshadowReviewState;
    }
  | {
      readonly status: "error";
      readonly selectedChapterIds: readonly string[];
      readonly message: string;
    };

export interface StoryBibleEditorFilters {
  readonly query: string;
  readonly status: StoryBibleEntityStatus | "available" | "all";
  readonly worldAssetType: StoryBibleWorldAssetType | "all";
  readonly foreshadowTrackingStatus: ForeshadowTrackingStatus | "all";
}

export type StoryBibleExternalUpdateState =
  | { readonly status: "none" }
  | {
      readonly status: "available";
      readonly message: string;
      readonly affectedEntryIds: readonly string[];
      readonly versionGroupId?: string;
    };

export interface StoryBibleIncomingReferenceImpactProps {
  readonly sourceAssetId: string;
  readonly sourceTitle: string;
  readonly sourceType: StoryBibleAssetType;
  readonly sourceStatus: StoryBibleEntityStatus;
  readonly path: string;
  readonly kind: "detail" | "relation";
  readonly integrity: "valid" | "deleted" | "missing" | "type-mismatch";
  readonly relationType?: string;
}

export type StoryBibleStatusAction = "move-to-deleted" | "restore";

export type StoryBibleStatusActionState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly action: StoryBibleStatusAction;
      readonly assetId: string;
      readonly assetTitle: string;
    }
  | {
      readonly status: "confirmation";
      readonly action: "move-to-deleted";
      readonly assetId: string;
      readonly assetTitle: string;
      readonly deletionImpactChecksum: string;
      readonly canSetDeleted: boolean;
      readonly affectedReferenceCount: number;
      readonly affectedAssetIds: readonly string[];
      readonly incoming: readonly StoryBibleIncomingReferenceImpactProps[];
    }
  | {
      readonly status: "confirmation";
      readonly action: "restore";
      readonly assetId: string;
      readonly assetTitle: string;
    }
  | {
      readonly status: "error";
      readonly action: StoryBibleStatusAction;
      readonly assetId: string;
      readonly assetTitle: string;
      readonly message: string;
    };

export interface StoryAnalysisReviewSummaryProps {
  readonly workflowRunId: string;
  readonly chapterId: string;
  readonly status: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
  readonly updatedAt: string;
  readonly pendingSuggestionCount: number;
  readonly openIssueCount: number;
}

export interface StoryAnalysisEvidenceProps {
  readonly start: number;
  readonly end: number;
  readonly excerptHash: string;
}

export interface StoryAnalysisOperationProps {
  readonly op: "add" | "replace" | "remove";
  readonly path: string;
  readonly beforePresent: boolean;
  readonly beforeValue?: unknown;
  readonly afterValue?: unknown;
}

export interface StoryAnalysisSuggestionProps {
  readonly suggestionId: string;
  readonly consistencyGroupId: string;
  readonly groupSize: number;
  readonly status: "pending" | "accepted" | "applied" | "rejected" | "stale" | "failed";
  readonly revision: number;
  readonly domain: string;
  readonly action: "create" | "patch";
  readonly targetAssetId?: string;
  readonly proposedAssetType?: StoryBibleAssetType;
  readonly proposedTitle?: string;
  readonly operations: readonly StoryAnalysisOperationProps[];
  readonly evidence: readonly StoryAnalysisEvidenceProps[];
  readonly epistemicStatus: string;
  readonly confidence: number;
  readonly reason: string;
}

export interface StoryAnalysisIssueProps {
  readonly issueId: string;
  readonly revision: number;
  readonly issueType: "conflict" | "ambiguity" | "unresolved_entity" | "overdue_foreshadow";
  readonly status: "open" | "resolved" | "dismissed" | "stale";
  readonly claims: readonly {
    readonly value: unknown;
    readonly evidence: readonly StoryAnalysisEvidenceProps[];
  }[];
  readonly affectedRefs: readonly string[];
}

export interface StoryAnalysisApplicationPreviewProps {
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly files: readonly {
    readonly relativePath: string;
    readonly assetId?: string;
    readonly consistencyGroupId?: string;
    readonly valid: boolean;
    readonly hunkCount: number;
  }[];
  readonly operations: readonly {
    readonly operationId: string;
    readonly kind: string;
    readonly relativePath?: string;
    readonly consistencyGroupId?: string;
  }[];
}

export interface StoryAnalysisApplicationResultProps {
  readonly applyBatchId: string;
  readonly recordSyncWarning?: {
    readonly code: string;
    readonly message: string;
  };
  readonly groups: readonly {
    readonly consistencyGroupId: string;
    readonly status: string;
    readonly versionGroupId?: string;
    readonly suggestionIds: readonly string[];
    readonly errorMessage?: string;
  }[];
}

export interface StoryAnalysisReviewFilters {
  readonly recordType: "all" | "change" | "review_issue";
  readonly status: string;
  readonly domain: string;
}

export interface StoryAnalysisReviewProps {
  readonly open: boolean;
  readonly status:
    | "idle"
    | "loading"
    | "ready"
    | "analyzing"
    | "transitioning"
    | "preparing"
    | "applying"
    | "saving-settings"
    | "error";
  readonly completionMode: StoryAnalysisCompletionMode;
  readonly maintenanceMode: StoryBibleMaintenanceMode;
  readonly pendingCount: number;
  readonly openIssueCount: number;
  readonly summaries: readonly StoryAnalysisReviewSummaryProps[];
  readonly activeWorkflowRunId?: string;
  readonly activeChapterId?: string;
  readonly selectedSuggestionIds: readonly string[];
  readonly filters: StoryAnalysisReviewFilters;
  readonly suggestions: readonly StoryAnalysisSuggestionProps[];
  readonly issues: readonly StoryAnalysisIssueProps[];
  readonly preview?: StoryAnalysisApplicationPreviewProps;
  readonly result?: StoryAnalysisApplicationResultProps;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onRunSelect: (workflowRunId: string) => void;
  readonly onFiltersChange: (filters: Partial<StoryAnalysisReviewFilters>) => void;
  readonly onSuggestionToggle: (suggestionId: string) => void;
  readonly onAcceptSelected: () => void;
  readonly onRejectSelected: () => void;
  readonly onPrepareSelected: () => void;
  readonly onApplyPrepared: () => void;
  readonly onRefreshStaleness: () => void;
  readonly onResolveIssue: (issueId: string, decision: string) => void;
  readonly onDismissIssue: (issueId: string, reason: string) => void;
  readonly onReanalyze: () => void;
  readonly onCompletionModeChange: (mode: StoryAnalysisCompletionMode) => void;
  readonly onMaintenanceModeChange: (mode: StoryBibleMaintenanceMode) => void;
}

export interface StoryBibleEditorProps {
  readonly activeKind: StoryBibleEditorKind;
  readonly activeTimelineEventId?: string;
  readonly viewMode: StoryBibleEditorViewMode;
  readonly status: StoryBibleEditorStatus;
  readonly dirty: boolean;
  readonly entries: readonly StoryBibleEditorEntry[];
  readonly chapterOptions: readonly StoryBibleChapterOption[];
  readonly currentChapterId?: string;
  readonly foreshadowAnalysis: StoryBibleForeshadowAnalysisState;
  readonly filters: StoryBibleEditorFilters;
  readonly externalUpdate: StoryBibleExternalUpdateState;
  readonly statusAction?: StoryBibleStatusActionState;
  readonly explicitInversePreview?: StoryBibleExplicitInversePreviewState;
  readonly analysisReview?: StoryAnalysisReviewProps;
  readonly consistency?: StoryBibleConsistencyProps;
  readonly draft: StoryBibleEditorDraft;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly onKindSelect: (kind: StoryBibleEditorKind) => void;
  readonly onEntrySelect: (entryId: string) => void;
  readonly onDraftChange: <K extends StoryBibleEditorKind>(
    kind: K,
    draft: Partial<StoryBibleEditorDraftFor<K>>
  ) => void;
  readonly onFiltersChange: (filters: Partial<StoryBibleEditorFilters>) => void;
  readonly onNewDraft: (assetType?: StoryBibleWorldAssetType) => void;
  readonly onCancelDraft: () => void;
  readonly onSave: () => void;
  readonly onExplicitInversePreviewCancel?: (() => void) | undefined;
  readonly onExternalUpdateReload: () => void;
  readonly onExternalUpdateContinue: () => void;
  readonly onStatusActionRequest?: ((action: StoryBibleStatusAction) => void) | undefined;
  readonly onStatusActionCancel?: (() => void) | undefined;
  readonly onStatusActionConfirm?: (() => void) | undefined;
  readonly onForeshadowAnalysisOpen: () => void;
  readonly onForeshadowAnalysisChapterToggle: (chapterId: string) => void;
  readonly onForeshadowAnalysisStart: () => void;
  readonly onForeshadowAnalysisCandidateToggle: (candidateId: string) => void;
  readonly onForeshadowAnalysisPreview: () => void;
  readonly onForeshadowAnalysisBack: () => void;
  readonly onForeshadowAnalysisConfirm: () => void;
  readonly onForeshadowAnalysisRetryFailed: () => void;
  readonly onForeshadowAnalysisClose: () => void;
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
