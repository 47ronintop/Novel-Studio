import type { JsonObject } from "./errors.js";
import type { Result } from "./result.js";
import type { UnifiedError } from "./errors.js";

export type RecoveryAssetType = "chapter" | "prompt" | "agent" | "workflow";

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
  assetType: RecoveryAssetType;
  dirty: boolean;
  draftContentRef: DraftContentRef;
  updatedAt: string;
  lastPersistedVersionId?: string;
  cursor?: RecoveryCursor;
}

export interface RecoveryRepositoryPort {
  writeRecoveryRecord(record: RecoveryRecord): Promise<Result<RecoveryRecord, UnifiedError>>;
  listRecoveryRecords(): Promise<Result<readonly RecoveryRecord[], UnifiedError>>;
}
