export type {
  ErrorCategory,
  JsonObject,
  JsonValue,
  Recoverability,
  UnifiedError,
  UnifiedErrorInput
} from "./errors.js";
export { createUnifiedError } from "./errors.js";
export type {
  ForeshadowDetails,
  ForeshadowContractWarning,
  ForeshadowOrigin,
  ForeshadowSourceRef,
  ForeshadowTrackingStatus
} from "./foreshadow.js";
export {
  FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
  collectForeshadowContractWarnings,
  createForeshadowEvidence,
  hashForeshadowEvidence,
  normalizeForeshadowEvidence
} from "./foreshadow.js";
export type {
  ChapterHistoryRepositoryPort,
  ChapterCatalogRepositoryPort,
  ChapterCatalogListInput,
  ChapterCatalogPage,
  ChapterAgentCatalogItem,
  ChapterAgentRead,
  CreateAgentChapterInput,
  CreateAgentChapterResult,
  ChapterOrderMigrationAffectedItem,
  ChapterOrderMigrationPlan,
  ChapterOrderMigrationPreparedFile,
  ChapterOrderMigrationPreview,
  ChapterDocument,
  ChapterDraftRepositoryPort,
  ChapterMaintenanceRepositoryPort,
  ChapterSummary,
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary,
  CreatedBy,
  ChapterFrontmatter,
  ChapterStatus,
  SnapshotReason
} from "./chapter.js";
export type {
  DraftContentRef,
  RecoveryAssetType,
  RecoveryCursor,
  RecoveryRecord,
  RecoveryRepositoryPort
} from "./recovery.js";
export type {
  UserAppearancePreferences,
  UserEditorPreferences,
  UserOnboardingPreferences,
  UserPreferencesPort,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot,
  UserShellPreferences,
  UserWorkspaceLayoutPreferences
} from "./user-preferences.js";
export { DEFAULT_USER_SHELL_PREFERENCES } from "./user-preferences.js";
export type {
  CreativeNavigatorMode,
  WorkbenchMode,
  WorkspaceCapability,
  WorkspaceContextDto
} from "./workspace-context.js";
export { EMPTY_WORKSPACE_CONTEXT, resolveWorkbenchModeForContext } from "./workspace-context.js";
export type { Err, Ok, Result } from "./result.js";
export { err, isErr, isOk, ok, unwrapOr } from "./result.js";
