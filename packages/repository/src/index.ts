export type { AtomicWriteFileSystem, AtomicWriteInput } from "./atomic-write.js";
export { writeTextAtomically } from "./atomic-write.js";
export { CacheRepository } from "./cache-repository.js";
export { ChapterFileRepository } from "./chapter-repository.js";
export { ConfigAssetRepository } from "./config-asset-repository.js";
export type {
  ConfigAssetType,
  RestoreConfigAssetVersionInput,
  WriteConfigAssetInput
} from "./config-asset-repository.js";
export { HistoryRepository } from "./history-repository.js";
export type {
  AssetType,
  CacheRepositoryPort,
  CreatedBy,
  DraftContentRef,
  HistoryRepositoryPort,
  ModelProfile,
  ModelSettings,
  ProjectMetadata,
  ProjectRepositoryPort,
  ProjectSettings,
  ProjectSnapshot,
  ProjectStats,
  ProjectType,
  RecoveryCursor,
  RecoveryRecord,
  RecoveryRepositoryPort,
  SnapshotReason,
  SnapshotTextAssetInput,
  VersionRecord
} from "./ports.js";
export { ProjectFileRepository } from "./project-repository.js";
export { RecoveryRepository } from "./recovery-repository.js";
export { ProjectSettingsRepository } from "./settings-repository.js";
export type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterFrontmatter,
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary
} from "@novel-studio/shared";
