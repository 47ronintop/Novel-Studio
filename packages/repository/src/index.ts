export type { AtomicWriteFileSystem, AtomicWriteInput } from "./atomic-write.js";
export { writeTextAtomically } from "./atomic-write.js";
export { AgentWriteTransaction } from "./agent-write-transaction.js";
export type {
  AgentWriteLifecycleMutation,
  AgentWriteLifecycleOperationPort,
  AgentWriteReplaceInput,
  AgentWriteTrustedCreativeLifecycleMutation,
  AgentWriteTrustedCreativeMutationPort,
  AgentWriteTrustedCreativeReplaceMutation,
  AgentWriteTransactionOptions
} from "./agent-write-transaction.js";
export { CacheRepository } from "./cache-repository.js";
export { ChapterFileRepository } from "./chapter-repository.js";
export { ConfigAssetRepository } from "./config-asset-repository.js";
export type {
  ConfigAssetType,
  RestoreConfigAssetVersionInput,
  WriteConfigAssetInput
} from "./config-asset-repository.js";
export { HistoryRepository } from "./history-repository.js";
export { AgentRunFileRepository } from "./agent-run-repository.js";
export type { AgentRunFileRepositoryOptions } from "./agent-run-repository.js";
export { AgentUsageFileRepository } from "./agent-usage-repository.js";
export type {
  AgentUsageFileRepositoryOptions,
  AgentUsageRepositoryCostTotal,
  AgentUsageRepositoryDailyBucket,
  AgentUsageRepositoryDateRange,
  AgentUsageRepositoryQuery,
  AgentUsageRepositoryRunSummary,
  ClearAgentUsageRepositoryCommand
} from "./agent-usage-repository.js";
export {
  AgentConversationFileRepository,
  normalizeConversationRecord
} from "./agent-conversation-repository.js";
export type {
  AgentConversationFileRepositoryOptions,
  AgentConversationListDiagnostic,
  AgentConversationListPage,
  AgentConversationRecord,
  AgentConversationRecordV10,
  AgentConversationRecordV11,
  AgentConversationRecordWrite,
  AgentConversationRecordStatus,
  AgentConversationSummaryRevision,
  UpdateAgentConversationRecordInput
} from "./agent-conversation-repository.js";
export { AgentProjectReadRepository } from "./agent-project-read-repository.js";
export type {
  AgentProjectEntry,
  AgentProjectReadRepositoryOptions,
  AgentProjectTextReadResult
} from "./agent-project-read-repository.js";
export { EngineeringWorkspaceFileRepository } from "./engineering-workspace-repository.js";
export type { EngineeringWorkspaceFileRepositoryOptions } from "./engineering-workspace-repository.js";
export {
  CREATIVE_PROJECT_FILE_LIFECYCLE_VERSION,
  CREATIVE_PROJECT_FILE_POLICY_VERSION,
  CREATIVE_PROJECT_FILE_TREE_SNAPSHOT_VERSION,
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  CreativeProjectFileRepository,
  normalizeCreativeProjectFilePath,
  normalizeCreativeProjectFilePolicy
} from "./creative-project-file-repository.js";
export type {
  CreativeProjectFileDocument,
  CreativeProjectFileLifecycleCommand,
  CreativeProjectFileLifecycleReceipt,
  CreativeProjectFilePolicy,
  CreativeProjectFileReceiptStore,
  CreativeProjectFileRepositoryOptions,
  CreativeProjectFileSaveResult,
  CreativeProjectFileTreeNode,
  CreativeProjectFileTreeSnapshot
} from "./creative-project-file-repository.js";
export type {
  AssetType,
  AgentTransactionJournal,
  AgentTransactionJournalEntry,
  AgentTransactionJournalEntryStatus,
  AgentTransactionJournalMutationRecord,
  AgentTransactionJournalOperationEntry,
  AgentTransactionJournalKind,
  AgentTransactionJournalStatus,
  AgentOperationPathSnapshot,
  AgentWriteAssetType,
  AgentWriteHistoryPort,
  AgentWriteProjectLockPort,
  AgentWriteRecoveryPort,
  AgentWriteTransactionFile,
  AgentWriteTransactionInput,
  AgentWriteTransactionOperation,
  AgentWriteRemoveDirectoryOperation,
  CacheRepositoryPort,
  CreatedBy,
  HistoryRepositoryPort,
  ModelProfile,
  ModelSettings,
  ProjectMetadata,
  ProjectRepositoryPort,
  ProjectSettings,
  ProjectSnapshot,
  ProjectStats,
  ProjectType,
  SnapshotReason,
  SnapshotTextAssetInput,
  VersionRecord,
  VersionGroupBaselineRecord,
  VersionGroupFailureKind,
  VersionGroupRecord,
  VersionGroupOperationRecord,
  VersionGroupTransactionStatus,
  VersionGroupUndoMetadataRecord,
  VersionGroupUndoStatus,
  VersionGroupWriteRecord,
  VersionGroupWriteStatus,
  WorkflowRunContextSummary,
  WorkflowRunCostSummary,
  WorkflowRunErrorSummary,
  WorkflowRunModelSummary,
  WorkflowRunRecord,
  WorkflowRunRecordStatus,
  WorkflowRunRetryPolicySummary,
  WorkflowRunStepKind,
  WorkflowRunStepRecord,
  WorkflowRunStepStatus,
  WorkflowRunSummary,
  WorkflowRunUsageSummary
} from "./ports.js";
export type {
  DraftContentRef,
  RecoveryCursor,
  RecoveryRecord,
  RecoveryRepositoryPort
} from "@novel-studio/shared";
export { ProjectFileRepository } from "./project-repository.js";
export { ProjectCreationFileRepository } from "./project-creation-repository.js";
export { ProjectLockFileRepository } from "./project-lock-repository.js";
export type {
  ProjectLockFileRepositoryOptions,
  ProjectLockRecord
} from "./project-lock-repository.js";
export { PluginRegistryFileRepository } from "./plugin-registry-repository.js";
export type {
  PluginRegistryEntry,
  PluginRegistryFileRepositoryOptions,
  PluginManifestCapability,
  PluginManifestContribution,
  PluginManifestPermission,
  PluginManifestSummary,
  PluginRegistryPermissionGrant,
  PluginRegistrySnapshot,
  PluginSettingsEntry,
  PluginSettingsSnapshot
} from "./plugin-registry-repository.js";
export { RecoveryRepository } from "./recovery-repository.js";
export { ProjectSettingsRepository } from "./settings-repository.js";
export { StoryBibleFileRepository } from "./story-bible-repository.js";
export type {
  ForeshadowAsset,
  MemoryConfidence,
  MemoryOrigin,
  MemoryRecord,
  MemoryRecordType,
  StoryBibleAsset,
  StoryBibleAssetType,
  StoryBibleEntityStatus,
  StoryBibleFileRepositoryOptions,
  StoryBibleRegularAsset,
  StoryBibleRegularAssetType,
  StoryBibleRepositoryPort,
  StoryBibleSnapshot
} from "./story-bible-repository.js";
export { WorkspaceStateFileRepository } from "./workspace-state-repository.js";
export type { WorkspaceStateFileRepositoryOptions } from "./workspace-state-repository.js";
export { SearchIndexFileRepository } from "./search-index-repository.js";
export { validateWithSchema } from "./schema-validation.js";
export { UserPreferencesFileRepository } from "./user-preferences-repository.js";
export type { UserPreferencesFileRepositoryOptions } from "./user-preferences-repository.js";
export type {
  SearchIndexEntry,
  SearchIndexEntryType,
  SearchIndexFileRepositoryOptions,
  SearchIndexSnapshot,
  SearchQueryInput,
  SearchResultItem,
  SearchResults,
  SearchSourceRef
} from "./search-index-repository.js";
export type {
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterFrontmatter,
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary
} from "@novel-studio/shared";
export { ProjectTaskCatalogRepository } from "./project-task-catalog-repository.js";
export type { AuthorizedTask, ProjectTaskCandidate } from "./project-task-catalog-repository.js";
export { AgentProjectSearchRepository } from "./agent-project-search-repository.js";
export type {
  AgentProjectSearchRepositoryOptions,
  AgentSearchResult,
  AgentSearchResultRange,
  AgentSearchResults
} from "./agent-project-search-repository.js";
export {
  WORKSPACE_OUTLINE_ENGINEERING_MAX_DEPTH,
  WORKSPACE_OUTLINE_ENGINEERING_MAX_ENTRIES,
  WORKSPACE_OUTLINE_INDEX_REPOSITORY_VERSION,
  WorkspaceOutlineIndexRepository,
  WorkspaceOutlineProjectEntryRepository,
  WorkspaceOutlineProjectMetadataRepository,
  buildCreativeProjectFileTreeOutlineIndex,
  normalizeWorkspaceOutlineIndexLimits
} from "./workspace-outline-index-repository.js";
export type {
  WorkspaceOutlineChapterIndexEntry,
  WorkspaceOutlineChapterIndexSnapshot,
  WorkspaceOutlineCreativeFileTreeIndex,
  WorkspaceOutlineEngineeringIndex,
  WorkspaceOutlineGuardedEntryReadLimits,
  WorkspaceOutlineGuardedEntryReadResult,
  WorkspaceOutlineGuardedEntryReader,
  WorkspaceOutlineIndexEntry,
  WorkspaceOutlineIndexLimits,
  WorkspaceOutlineIndexRepositoryOptions,
  WorkspaceOutlineIndexTruncationReason,
  WorkspaceOutlineProjectEntryRepositoryOptions,
  WorkspaceOutlineProjectMetadataRepositoryOptions,
  WorkspaceOutlineStoryBibleIndexEntry,
  WorkspaceOutlineStoryBibleIndexSnapshot,
  WorkspaceOutlineWritingIndex,
  WorkspaceOutlineWritingMetadataReadLimits,
  WorkspaceOutlineWritingMetadataReader
} from "./workspace-outline-index-repository.js";
export { NoFollowFileOperations } from "./no-follow-file-operations.js";
export type {
  NoFollowFileError,
  NoFollowNativeFileOperationPort,
  NoFollowWriteFileOptions
} from "./no-follow-file-operations.js";
export { McpSettingsFileRepository } from "./mcp-settings-repository.js";
export type {
  LocalMcpServerLaunchConfig,
  LocalMcpServerSummary,
  McpSettingsFileRepositoryOptions
} from "./mcp-settings-repository.js";
export { createTrustedCreativeFileOperationsPort } from "./trusted-creative-file-operations.js";
export type {
  TrustedCreativeFileHandle,
  TrustedCreativeFileOperationsOptions,
  TrustedCreativeFileSystem,
  TrustedCreativePathStats
} from "./trusted-creative-file-operations.js";
