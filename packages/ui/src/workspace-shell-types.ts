import type {
  ActivityId,
  ApplicationCommand,
  ApplicationCommandId,
  DesktopShellState,
  ProjectSearchResultItem,
  ProjectWorkspaceHealth
} from "@novel-studio/application";
import type { ChapterSummary } from "@novel-studio/shared";
import type { ChapterEditorProps } from "./chapter-editor.js";
import type { CommandPaletteFeedback } from "./command-palette.js";
import type { ConfigStudioPanelProps } from "./config-studio-panel.js";
import type { ModelSettingsPanelProps } from "./model-settings-panel.js";

export interface WorkspaceShellProps {
  readonly shellState: DesktopShellState;
  readonly commands: readonly ApplicationCommand[];
  readonly commandPaletteOpen: boolean;
  readonly commandPaletteFeedback?: CommandPaletteFeedback | undefined;
  readonly commandPaletteQuery?: string | undefined;
  readonly commandPaletteSelectedCommandId?: ApplicationCommandId | undefined;
  readonly chapterEditor?: ChapterEditorProps;
  readonly projectWorkflow?: ProjectWorkflowProps;
  readonly aiWritingWorkflow?: AiWritingWorkflowProps;
  readonly search?: ProjectSearchProps;
  readonly settings?: ModelSettingsPanelProps;
  readonly studio?: ConfigStudioPanelProps;
  readonly storyBible?: StoryBibleSummaryProps;
  readonly storyBibleEditor?: StoryBibleEditorProps;
  readonly onboarding?: OnboardingProps;
  readonly onCommandPaletteOpen?: () => void;
  readonly onCommandPaletteQueryChange?: ((query: string) => void) | undefined;
  readonly onCommandPaletteActiveCommandChange?:
    ((commandId: ApplicationCommandId) => void) | undefined;
  readonly onCommandExecute?: (commandId: ApplicationCommandId) => void;
  readonly onBottomPanelTabSelect?: ((tab: string) => void) | undefined;
  readonly onSearchResultOpen?: ((result: ProjectSearchResultItem) => void) | undefined;
  readonly onTimelineEntryOpen?: ((entryId: string) => void) | undefined;
  readonly onActivitySelect?: (activityId: ActivityId) => void;
}

export interface ProjectWorkflowProps {
  readonly projectRootInput: string;
  readonly status?: ProjectWorkflowStatus;
  readonly feedback?: ProjectWorkflowFeedback;
  readonly chapters: readonly ChapterSummary[];
  readonly activeChapterId?: string;
  readonly openChapterTabIds?: readonly string[];
  readonly dirtyChapterIds?: readonly string[];
  readonly recovery?: ProjectWorkflowRecoveryProps;
  readonly health?: ProjectWorkspaceHealth;
  readonly onProjectRootChange: (projectRoot: string) => void;
  readonly onOpenProject: () => void;
  readonly onCreateProject: () => void;
  readonly onCreateChapter: () => void;
  readonly onSelectChapter: (chapterId: string) => void;
  readonly onCloseChapterTab?: (chapterId: string) => void;
  readonly onPreviewRecoveryDraft?: (sessionId: string) => void;
  readonly onApplyRecoveryDraft?: (sessionId: string) => void;
  readonly onDiscardRecoveryDraft?: (sessionId: string) => void;
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

export type ProjectWorkflowStatus = "idle" | "opening" | "creating";

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
  readonly onInstructionChange: (instruction: string) => void;
  readonly onGenerateSuggestion: () => void;
  readonly onApplySuggestion: () => void;
  readonly onRejectSelectionReview?: () => void;
  readonly onUndoSelectionReview?: () => void;
  readonly onRetrySuggestion: () => void;
  readonly onCancelStreaming: () => void;
}

export interface AiWritingConversationMessageProps {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAtLabel: string;
}

export interface AiSelectionReviewProps {
  readonly status: "pending" | "rejected" | "applied";
  readonly originalText: string;
  readonly proposedText: string;
  readonly rangeLabel: string;
  readonly compareLabel: string;
  readonly canUndo: boolean;
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
