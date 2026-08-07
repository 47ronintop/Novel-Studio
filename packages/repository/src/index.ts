export type { AtomicWriteFileSystem, AtomicWriteInput } from "./atomic-write.js";
export { writeTextAtomically } from "./atomic-write.js";
export { AgentWriteTransaction } from "./agent-write-transaction.js";
export {
  AUTHORIZATION_LEDGER_V2_SCHEMA_VERSION,
  ApprovalAuthorizationLedger,
  isLegacyAuthorizationLedgerRecord,
  projectAuthorizationLedgerRecordForDisplay,
  validateLedgerRecord,
  validateWal
} from "./approval-authorization-ledger.js";
export type {
  ApprovalAuthorizationLedgerPort,
  ApprovalAuthorizationLedgerOptions,
  ApprovalAuthorizationLedgerRecordV2,
  AuthorizationLedgerStateV2,
  AuthorizationReservationWalV2,
  AuthorizationReservationWalStateV2,
  IssueAuthorizationV2Input,
  ReconcileReservationV2Input,
  ReserveAuthorizationV2Input
} from "./approval-authorization-ledger.js";
export type {
  AgentWriteLifecycleMutation,
  AgentWriteLifecycleOperationPort,
  AgentWriteReplaceInput,
  AgentWriteTrustedCreativeLifecycleMutation,
  AgentWriteTrustedCreativeMutationPort,
  AgentWriteTrustedCreativeReplaceMutation,
  AgentWriteAuthorizationLedgerPort,
  AgentWriteTransactionOptions
} from "./agent-write-transaction.js";
export { CacheRepository } from "./cache-repository.js";
export { ChapterFileRepository, serializeChapterDocument } from "./chapter-repository.js";
export type {
  AgentChapterCreateOperationInput,
  PreparedAgentChapterCreateInput,
  SerializedChapterRead
} from "./chapter-repository.js";
export { ChapterWriteCoordinator, chapterLifecycleChecksum } from "./chapter-write-coordinator.js";
export type {
  ChapterDeleteInput,
  ChapterOutlineSnapshot,
  ChapterRestoreInput,
  ChapterReorderInput,
  ChapterStatusInput,
  ChapterWriteCoordinatorOptions,
  ChapterWriteCoordinatorRepository,
  ChapterWriteInverse,
  PreparedChapterWrite,
  ChapterWriteReceipt
} from "./chapter-write-coordinator.js";
export { ConfigAssetRepository } from "./config-asset-repository.js";
export type {
  ConfigAssetType,
  RestoreConfigAssetVersionInput,
  WriteConfigAssetInput
} from "./config-asset-repository.js";
export { HistoryRepository } from "./history-repository.js";
export { AgentRunFileRepository } from "./agent-run-repository.js";
export type { AgentRunFileRepositoryOptions } from "./agent-run-repository.js";
export {
  AGENT_SEND_LEDGER_SCHEMA_VERSION,
  AgentSendLedgerFileRepository,
  createAgentSendLedgerEntryV2,
  parseAgentSendLedgerEntryV2,
  parseAgentSendLedgerEntryV2Json,
  serializeAgentSendLedgerEntryV2
} from "./agent-send-ledger-repository.js";
export type {
  AgentSendLedgerAdditionKindV2,
  AgentSendLedgerAdditionV2,
  AgentSendLedgerEntryV2,
  AgentSendLedgerFileRepositoryOptions,
  AgentSendLedgerPreviewBindingV2,
  CreateAgentSendLedgerEntryV2Input,
  ProviderNativeSemanticProofV2
} from "./agent-send-ledger-repository.js";
export {
  AGENT_RUN_EVENT_SCHEMA_VERSION_V20,
  AGENT_RUN_SNAPSHOT_SCHEMA_VERSION_V20,
  parseAgentRunEventV20,
  parseAgentRunSnapshotV20,
  validateAgentRunEventV20,
  validateAgentRunHistoryV20,
  validateAgentRunSnapshotV20,
  validateAgentRunStatePairV20,
  validateAgentRunV20StartFacts
} from "./agent-run-v20.js";
export type {
  AgentRunAuthorityV20,
  AgentRunCapabilitiesV20,
  AgentRunCatalogV20,
  AgentRunEventTypeV20,
  AgentRunEventV20,
  AgentRunFinishV20,
  AgentRunPendingV20,
  AgentRunProtocolV20,
  AgentRunSnapshotV20,
  AgentRunStateCommitV20,
  AgentRunStatusV20,
  AgentRunV20StartFacts
} from "./agent-run-v20.js";
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
export { createEngineeringWorkspaceAccessPort } from "./engineering-workspace-access-port.js";
export type {
  EngineeringWorkspaceAccessBinding,
  EngineeringWorkspaceAccessDirectoryEntry,
  EngineeringWorkspaceAccessIndexEntry,
  EngineeringWorkspaceAccessNativeAddon,
  EngineeringWorkspaceAccessOpenRequest,
  EngineeringWorkspaceAccessPort,
  EngineeringWorkspaceAccessPortOptions,
  EngineeringWorkspaceAccessSearchMatch,
  EngineeringWorkspaceAccessSession,
  EngineeringWorkspaceAccessTextSnapshot
} from "./engineering-workspace-access-port.js";
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
  StoryAnalysisCompletionMode,
  StoryAnalysisSettings,
  StoryBibleMaintenanceMode,
  SnapshotReason,
  SnapshotTextAssetInput,
  StoryAnalysisHistoryRecord,
  StoryAnalysisHistoryRepositoryPort,
  StoryAnalysisHistorySummary,
  StoryBibleStatusTransitionRecord,
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
  ChapterCreateApplyReceipt,
  StoryBibleApplyReceipt,
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
  WorkflowRunUsageSummary,
  WriteStoryAnalysisHistoryInput
} from "./ports.js";
export type { StoryAnalysisBundle } from "@novel-studio/schemas";
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
  StoryBibleAgentAsset,
  StoryBibleAgentAssetRead,
  StoryBibleEntityStatus,
  StoryBibleFileRepositoryOptions,
  StoryBibleListInput,
  StoryBibleListItem,
  StoryBibleListPage,
  StoryBiblePassthroughSummary,
  StoryBibleReference,
  StoryBibleReferenceImpact,
  StoryBibleReferenceTargetKind,
  StoryBibleReferenceWarning,
  StoryBibleRegularAsset,
  StoryBibleRegularAssetType,
  StoryBibleRepositoryPort,
  StoryBibleSnapshot
} from "./story-bible-repository.js";
export {
  STORY_BIBLE_CANDIDATE_ROOT_FIELDS,
  adaptLegacyStoryBibleAsset,
  canonicalStoryBibleJson,
  checksumStoryBibleText,
  compatibleV11StoryBibleAsset,
  createStoryBibleAssetId,
  deriveRelatedEntityIds,
  isStoryBibleWriteCandidate
} from "./story-bible-v1-1.js";
export type {
  CreateStoryBibleAssetInput,
  PreparedStoryBibleCreate,
  PreparedStoryBibleWrite,
  SaveStoryBibleCandidateInput,
  SaveStoryBibleStatusTransitionInput,
  StoryBibleAdditionalReferenceTarget,
  StoryBibleCandidateGroupEntry,
  StoryBibleCompatibleAssetRead,
  StoryBibleCreateValue,
  StoryBiblePassthrough,
  StoryBibleRelation,
  StoryBibleSchemaVersion,
  StoryBibleStatusTransitionAuthorization,
  StoryBibleV11Asset,
  StoryBibleWriteCandidate,
  ValidateStoryBibleCandidateGroupInput
} from "./story-bible-v1-1.js";
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
  ChapterAgentCatalogItem,
  ChapterAgentRead,
  ChapterCatalogListInput,
  ChapterCatalogPage,
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterFrontmatter,
  ChapterHistoryRepositoryPort,
  ChapterOrderMigrationAffectedItem,
  ChapterOrderMigrationPlan,
  ChapterOrderMigrationPreparedFile,
  ChapterOrderMigrationPreview,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary,
  CreateAgentChapterInput,
  CreateAgentChapterResult
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
export { ApprovalDecisionProofFileRepository } from "./approval-decision-proof-repository.js";
export type { ApprovalDecisionProofFileRepositoryOptions } from "./approval-decision-proof-repository.js";
export {
  StoryBibleReferenceDependencyFileRepository,
  StoryBibleReferenceDependencyRepository
} from "./story-bible-reference-dependency-repository.js";
export type {
  StoryBibleReferenceDependencyBindingRecordV1,
  StoryBibleReferenceDependencyFileRepositoryOptions,
  StoryBibleReferenceDependencyRecordV1
} from "./story-bible-reference-dependency-repository.js";
