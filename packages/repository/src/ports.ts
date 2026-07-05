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
  | "before-rollback"
  | "migration";
export type AssetType = "chapter" | "prompt" | "agent" | "workflow";
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
}

export interface CreateProjectInput {
  projectId: string;
  title: string;
  language: string;
  projectType?: ProjectType;
  targetWordCount?: number;
}
