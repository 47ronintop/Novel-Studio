import type {
  JsonObject,
  JsonValue,
  Recoverability,
  Result,
  UnifiedError
} from "@novel-studio/shared";

export type {
  DraftContentRef,
  RecoveryCursor,
  RecoveryRecord,
  RecoveryRepositoryPort
} from "@novel-studio/shared";

export type ProjectType = "novel" | "screenplay" | "comic-script" | "game-narrative";
export type SnapshotReason =
  | "manual-save"
  | "autosave-snapshot"
  | "interval-snapshot"
  | "before-ai-apply"
  | "before-agent-write"
  | "before-agent-session-undo"
  | "before-rollback"
  | "migration";
export type AssetType = "chapter" | "text" | "prompt" | "agent" | "workflow";
export type CreatedBy = "user" | "system" | "migration";
export type WorkflowRunRecordStatus = "pending-confirmation" | "applied" | "failed";
export type WorkflowRunStepKind = "context" | "agent" | "confirmation";
export type WorkflowRunStepStatus =
  "pending" | "running" | "completed" | "waiting-confirmation" | "failed";

export interface ProjectStats extends JsonObject {
  targetWordCount?: number;
  currentWordCount?: number;
  chapterCount?: number;
}

export interface ProjectMetadata extends JsonObject {
  schemaVersion: "1.0";
  projectId: string;
  title: string;
  projectType: ProjectType;
  language: string;
  createdAt: string;
  updatedAt: string;
  defaultWorkflowId?: string;
  defaultModelProfileId?: string;
  stats?: ProjectStats;
}

export interface AutosaveSettings extends JsonObject {
  enabled: boolean;
  intervalMs: number;
  createHistorySnapshot?: boolean;
}

export interface HistorySettings extends JsonObject {
  snapshotPolicy: "manual-only" | "interval-only" | "manual-and-interval" | "on-save-and-manual";
  intervalMinutes?: number;
  maxSnapshotsPerChapter?: number | null;
}

export interface ModelProfile extends JsonObject {
  id: string;
  provider: string;
  displayName: string;
  baseUrl?: string;
  apiKeyRef: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  topP?: number;
  timeoutMs: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface ModelSettings extends JsonObject {
  defaultProfileId: string;
  profiles: ModelProfile[];
}

export interface ProjectSettings extends JsonObject {
  schemaVersion: "1.0";
  autosave: AutosaveSettings;
  history: HistorySettings;
  models: ModelSettings;
}

export interface ProjectSnapshot {
  project: ProjectMetadata;
  settings: ProjectSettings;
}

export interface VersionRecord extends JsonObject {
  schemaVersion: "1.0";
  versionId: string;
  assetType: AssetType;
  assetId: string;
  reason: SnapshotReason;
  createdBy: CreatedBy;
  createdAt: string;
  checksum: string;
  parentVersionId?: string | null;
  snapshot?: JsonValue;
  runId?: string;
  checkpointId?: string;
  writeId?: string;
  targetRelativePath?: string;
}

export interface WorkflowRunContextSummary extends JsonObject {
  sourceCount: number;
  tokenEstimate: number;
  selectionReason: string;
}

export interface WorkflowRunModelSummary extends JsonObject {
  profileId: string;
  displayName: string;
  provider: string;
  modelName: string;
}

export interface WorkflowRunCostSummary extends JsonObject {
  amount: number;
  currency: string;
  status: "unknown" | "estimated" | "actual";
}

export interface WorkflowRunUsageSummary extends JsonObject {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageStatus: "missing" | "estimated" | "actual";
  cost: WorkflowRunCostSummary;
}

export interface WorkflowRunStepRecord extends JsonObject {
  stepId: string;
  label: string;
  kind: WorkflowRunStepKind;
  status: WorkflowRunStepStatus;
}

export interface WorkflowRunErrorSummary extends JsonObject {
  code: string;
  message: string;
  recoverability?: Recoverability;
  suggestedAction?: string;
  retryable?: boolean;
}

export interface WorkflowRunRetryPolicySummary extends JsonObject {
  mode: "manual";
  maxAttempts: number;
  backoffLabel: string;
  retryableCodes: string[];
}

export interface WorkflowRunRecord extends JsonObject {
  schemaVersion: "1.0";
  workflowRunId: string;
  workflowId: string;
  workflowTitle: string;
  status: WorkflowRunRecordStatus;
  startedAt: string;
  updatedAt: string;
  context: WorkflowRunContextSummary;
  model: WorkflowRunModelSummary;
  usage: WorkflowRunUsageSummary;
  steps: WorkflowRunStepRecord[];
  error?: WorkflowRunErrorSummary;
  retryPolicy?: WorkflowRunRetryPolicySummary;
}

export interface WorkflowRunSummary extends JsonObject {
  workflowRunId: string;
  workflowTitle: string;
  status: WorkflowRunRecordStatus;
  updatedAt: string;
  modelLabel: string;
  usageLabel: string;
  costLabel: string;
}

export interface ProjectRepositoryPort {
  openProject(): Promise<Result<ProjectSnapshot, UnifiedError>>;
  createProject(input: CreateProjectInput): Promise<Result<ProjectSnapshot, UnifiedError>>;
}

export interface HistoryRepositoryPort {
  snapshotTextAsset(input: SnapshotTextAssetInput): Promise<Result<VersionRecord, UnifiedError>>;
  recordWorkflowRun(record: WorkflowRunRecord): Promise<Result<WorkflowRunRecord, UnifiedError>>;
  listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>>;
  readWorkflowRun(workflowRunId: string): Promise<Result<WorkflowRunRecord, UnifiedError>>;
}

export type AgentWriteAssetType = "chapter" | "text";
export type VersionGroupTransactionStatus =
  "failed" | "applied" | "rolled_back" | "partial_failure" | "awaiting_review";
export type VersionGroupFailureKind =
  "preflight_failure" | "write_failure" | "partial_failure" | "undo_conflict" | "undo_failure";
export type VersionGroupWriteStatus =
  | "pending"
  | "applied"
  | "rolled_back"
  | "rollback_failed"
  | "conflict"
  | "completed"
  | "kept"
  | "stale";
export type VersionGroupUndoStatus =
  | "available"
  | "not_available"
  | "completed"
  | "conflict"
  | "partial_failure"
  | "review_required";

export type RollbackReviewDecisionRecord = "keep_current" | "restore_baseline";
export type RollbackReviewFileStatusRecord =
  | "ready"
  | "conflict"
  | "stale"
  | "failed"
  | "completed"
  | "kept";
export type RollbackReviewStatusRecord = "pending" | "partial_failure" | "completed";

export interface RollbackReviewDiffRecord {
  readonly currentToLastWrite: string;
  readonly currentToBaseline: string;
  readonly lastWriteToBaseline: string;
}

export interface RollbackReviewFileRecord {
  readonly relativePath: string;
  readonly assetType: AgentWriteAssetType;
  readonly assetId?: string;
  readonly baselineContent: string;
  readonly baselineChecksum: string;
  readonly baselineHistoryContent?: string;
  readonly baselineVersionId: string;
  readonly runLastWriteContent: string;
  readonly runLastWriteChecksum: string;
  readonly runLastWriteHistoryContent?: string;
  readonly reviewedCurrentContent: string;
  readonly reviewedCurrentChecksum: string;
  readonly reviewedCurrentHistoryContent?: string;
  readonly reviewedEditorChecksum?: string;
  readonly diff: RollbackReviewDiffRecord;
  readonly decision?: RollbackReviewDecisionRecord;
  readonly status: RollbackReviewFileStatusRecord;
  readonly snapshotVersionId?: string;
  readonly errorCode?: string;
}

export interface RollbackReviewRecord {
  readonly schemaVersion: "1.0";
  readonly reviewId: string;
  readonly runId: string;
  readonly status: RollbackReviewStatusRecord;
  readonly sourceVersionGroupIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly processedCommandIds: readonly string[];
  readonly files: readonly RollbackReviewFileRecord[];
}

export interface AgentWriteTransactionFile {
  readonly relativePath: string;
  readonly assetType: AgentWriteAssetType;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseContent: string;
  readonly candidateContent: string;
  readonly assetId?: string;
  readonly historyBaseContent?: string;
  readonly historyCandidateContent?: string;
}

export interface AgentWriteTransactionInput {
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly revision: number;
  readonly checksum: string;
  readonly writePolicy: "write_before_confirmation" | "user_preapproved_run";
  readonly approvalSource: "human_confirmation" | "user_preapproved_run";
  readonly approvalToken: string;
  readonly files: readonly AgentWriteTransactionFile[];
}

export interface VersionGroupWriteRecord {
  readonly writeId: string;
  readonly relativePath: string;
  readonly assetType: AgentWriteAssetType;
  readonly beforeChecksum: string;
  readonly afterChecksum: string;
  readonly beforeVersionId: string;
  readonly status: VersionGroupWriteStatus;
  readonly errorCode?: string;
}

export interface VersionGroupBaselineRecord {
  readonly relativePath: string;
  readonly checksum: string;
  readonly beforeVersionId: string;
}

export interface VersionGroupUndoMetadataRecord {
  readonly runId: string;
  readonly versionGroupId: string;
  readonly baselineVersionIds: Readonly<Record<string, string>>;
  readonly lastWriteChecksums: Readonly<Record<string, string>>;
  readonly undoOfVersionGroupIds?: readonly string[];
}

export interface VersionGroupRecord {
  readonly schemaVersion: "1.0";
  readonly versionGroupId: string;
  readonly runId: string;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: "write_before_confirmation" | "user_preapproved_run";
  readonly approvalSource?: "human_confirmation" | "user_preapproved_run";
  readonly createdAt: string;
  readonly writes: readonly VersionGroupWriteRecord[];
  readonly baselineByPath: Readonly<Record<string, VersionGroupBaselineRecord>>;
  readonly transactionStatus: VersionGroupTransactionStatus;
  readonly undoStatus: VersionGroupUndoStatus;
  readonly undoMetadata: VersionGroupUndoMetadataRecord;
  readonly rollbackReview?: RollbackReviewRecord;
  readonly failureKind?: VersionGroupFailureKind;
}

export type AgentTransactionJournalKind = "apply" | "version_group_undo" | "run_undo";
export type AgentTransactionJournalStatus =
  "prepared" | "applying" | "compensating" | "applied" | "rolled_back" | "partial_failure";
export type AgentTransactionJournalEntryStatus =
  "pending" | "applied" | "rolled_back" | "rollback_failed";

export interface AgentTransactionJournalEntry {
  readonly writeId: string;
  readonly relativePath: string;
  readonly assetType: AgentWriteAssetType;
  readonly assetId?: string;
  readonly beforeChecksum: string;
  readonly candidateChecksum: string;
  readonly beforeContent: string;
  readonly candidateContent: string;
  readonly historyBaseContent?: string;
  readonly historyCandidateContent?: string;
  readonly beforeVersionId: string;
  readonly status: AgentTransactionJournalEntryStatus;
  readonly errorCode?: string;
}

export interface AgentTransactionJournal {
  readonly schemaVersion: "1.0";
  readonly transactionId: string;
  readonly versionGroupId: string;
  readonly kind: AgentTransactionJournalKind;
  readonly runId: string;
  readonly runSequence: number;
  readonly checkpointId: string;
  readonly changeSetId: string;
  readonly changeSetRevision: number;
  readonly changeSetChecksum: string;
  readonly writePolicy?: "write_before_confirmation" | "user_preapproved_run";
  readonly approvalSource?: "human_confirmation" | "user_preapproved_run";
  readonly approvalToken?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly transactionStatus: AgentTransactionJournalStatus;
  readonly entries: readonly AgentTransactionJournalEntry[];
  readonly undoOfVersionGroupIds?: readonly string[];
}

export interface AgentWriteHistoryPort {
  snapshotTextAsset(input: SnapshotTextAssetInput): Promise<Result<VersionRecord, UnifiedError>>;
}

export interface AgentWriteRecoveryPort {
  writeAgentTransactionJournal(
    journal: AgentTransactionJournal
  ): Promise<Result<AgentTransactionJournal, UnifiedError>>;
  readAgentTransactionJournal(
    transactionId: string
  ): Promise<Result<AgentTransactionJournal, UnifiedError>>;
  listAgentTransactionJournals(): Promise<Result<readonly AgentTransactionJournal[], UnifiedError>>;
  writeRollbackReview?(
    review: RollbackReviewRecord
  ): Promise<Result<RollbackReviewRecord, UnifiedError>>;
  readRollbackReview?(
    runId: string
  ): Promise<Result<RollbackReviewRecord | undefined, UnifiedError>>;
}

export interface AgentWriteProjectLockPort {
  verifyProjectLockOwnership(): Promise<Result<void, UnifiedError>>;
}

export interface CacheRepositoryPort {
  clearCache(): Promise<Result<void, UnifiedError>>;
}

export interface SnapshotTextAssetInput {
  assetType: AssetType;
  assetId: string;
  reason: SnapshotReason;
  content: string;
  createdBy?: CreatedBy;
  parentVersionId?: string | null;
  relativePath?: string;
  runId?: string;
  checkpointId?: string;
  writeId?: string;
}

export interface CreateProjectInput {
  projectId: string;
  title: string;
  language: string;
  projectType?: ProjectType;
  targetWordCount?: number;
}
