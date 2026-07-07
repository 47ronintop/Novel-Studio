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
  ChapterHistoryRepositoryPort,
  ChapterCatalogRepositoryPort,
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
export type { Err, Ok, Result } from "./result.js";
export { err, isErr, isOk, ok, unwrapOr } from "./result.js";
