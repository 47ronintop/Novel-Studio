import type { JsonObject, JsonValue, Result, UnifiedError } from "@novel-studio/shared";

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

export interface DraftContentRef extends JsonObject {
  strategy: "inline" | "file-ref";
  content?: string;
  path?: string;
}

export interface RecoveryCursor extends JsonObject {
  line?: number;
  column?: number;
}

export interface RecoveryRecord extends JsonObject {
  schemaVersion: "1.0";
  sessionId: string;
  projectId: string;
  openAssetId: string;
  assetType: AssetType;
  dirty: boolean;
  draftContentRef: DraftContentRef;
  updatedAt: string;
  lastPersistedVersionId?: string;
  cursor?: RecoveryCursor;
}

export interface ProjectRepositoryPort {
  openProject(): Promise<Result<ProjectSnapshot, UnifiedError>>;
  createProject(input: CreateProjectInput): Promise<Result<ProjectSnapshot, UnifiedError>>;
}

export interface HistoryRepositoryPort {
  snapshotTextAsset(input: SnapshotTextAssetInput): Promise<Result<VersionRecord, UnifiedError>>;
}

export interface RecoveryRepositoryPort {
  writeRecoveryRecord(record: RecoveryRecord): Promise<Result<RecoveryRecord, UnifiedError>>;
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
