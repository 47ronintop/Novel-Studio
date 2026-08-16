import {
  createDesktopApplication,
  toProjectWorkspaceSnapshotDto,
  validateStoryAnalysisBundle
} from "@novel-studio/application";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type {
  AgentConversationSession,
  AgentContextSession,
  AgentPermissionSession,
  AgentRunDraftSession,
  AgentRunSession,
  AgentUsageQuery,
  ClearAgentUsageCommand,
  DecideContextShareApprovalCommand,
  AnswerAgentUserInputCommand,
  ApplicationIpcChannel,
  StoryAnalysisCompletionEvent,
  CompactContextCommand,
  CreativeProjectFileLifecycleCommand,
  CreativeProjectFileSession,
  CreativeProjectFileSessionIdentity,
  DesktopApplication,
  ProjectCreationPreviewDto,
  CreativeFolderConfirmationRequest,
  CreativeFolderCopyResult,
  CreativeFolderPreview,
  OpenCreativeDirectoryInspection,
  ProjectTextFileSelectionDto,
  WorkspaceActivationDto,
  EngineeringWorkspaceSnapshot,
  PreviewContextBudgetCommand,
  ReadAgentPermissionSummaryQuery,
  ReadAgentRunDraftCommand,
  RefreshContextDraftCommand,
  SyncStartDraftCommand,
  UpdateAgentRunDraftCommand,
  UpdateContextDraftCommand,
  EngineeringEditorStateReport,
  EngineeringEditorStateReportResult,
  WritingEditorStateReport,
  WritingEditorStateReportResult
} from "@novel-studio/application";
import type {
  AgentSendPreviewDtoV2,
  ConfirmAgentSendPreviewCommandV2
} from "@novel-studio/application";
import { isAgentContextScope } from "@novel-studio/agent-engine";
import type {
  AgentContextScope,
  AgentRunEvent,
  DecideChangeSetCommand,
  DecideToolApprovalCommand,
  DecideAgentPlanCommand,
  DecidePlanRevisionCommand,
  RefreshAgentContextCommand,
  ResumeAgentRunCommand,
  RetryAgentRunStepCommand,
  RetryRunTargetCommand,
  StartAgentRunCommand,
  StopAgentRunCommand,
  UndoRunCommand
} from "@novel-studio/agent-engine";
import { ok, type JsonObject, type JsonValue } from "@novel-studio/shared";
import type {
  AiWritingSuggestionStreamEvent,
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetType,
  ChangeAgentConversationStatusCommand,
  CreateStoryBibleAssetCommand,
  CreateAgentConversationCommand,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamPushEvent,
  AiWritingSuggestionStreamStartRequest,
  ModelProfile,
  ForeshadowAnalysisCandidateDto,
  ForeshadowAnalysisInput,
  ForeshadowAnalysisResultDto,
  ForeshadowAsset,
  MemoryRecord,
  ListAgentConversationsQuery,
  ReadAgentConversationQuery,
  SearchAgentConversationsQuery,
  ProjectSearchQuery,
  ProjectWorkspaceSnapshot,
  SaveStoryBibleAssetCandidateCommand,
  SaveStoryBibleStatusTransitionCommand,
  StoryBibleAsset,
  StoryBibleCreateValue,
  StoryBibleContextCandidateOptions,
  StoryBibleExplicitInverseSourceCommand,
  StoryBibleWriteCandidate,
  StoryAnalysisHistorySummary,
  StoryAnalysisApplicationPreviewDto,
  StoryAnalysisApplicationResultDto,
  StoryAnalysisRecordDto,
  StoryAnalysisReviewCommand,
  StoryAnalysisSettings,
  UserPreferencesSaveInput,
  WorkspaceModelSharingDefaults
} from "@novel-studio/application";
import type {
  AgentNetworkProviderProfile,
  AgentNetworkSettingsData,
  AgentNetworkSettingsSession
} from "@novel-studio/application";
import type { McpServerConfig, McpSettingsSession } from "@novel-studio/application";
import { DEFAULT_NETWORK_SETTINGS } from "@novel-studio/application";
import { DEFAULT_MCP_SETTINGS } from "@novel-studio/application";
import type {
  CreateChapterInput,
  ChapterStatus,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  Result,
  UnifiedError
} from "@novel-studio/shared";
import { createUnifiedError, err } from "@novel-studio/shared";
import type { ModelSecretStore } from "./model-runtime.js";
import type { DesktopAgentRuntimeManager } from "./agent-runtime-manager.js";
import type { WorkspaceActivationCoordinator } from "./workspace-activation.js";
import {
  parseWorkspaceContextSourcePreferenceMutation,
  type WorkspaceContextPolicyStore,
  type WorkspaceContextSourcePreferenceMutation
} from "./workspace-context-policy-store.js";
import type { CreativeGeneralActiveResourceProof } from "./creative-general-active-resource-proof.js";
import {
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  normalizeCreativeProjectFilePath,
  validateWithSchema
} from "@novel-studio/repository";
import {
  validateStoryBibleCreateValue,
  validateStoryBibleWriteCandidate
} from "@novel-studio/schemas";
import { createDesktopProjectConventionsFile } from "./project-conventions-file.js";
import {
  MAX_ENGINEERING_EDITOR_BUFFER_BYTES,
  type EngineeringEditorStateRegistry
} from "./engineering-editor-state-registry.js";
import {
  MAX_WRITING_EDITOR_BUFFER_BYTES,
  type WritingEditorStateRegistry
} from "./writing-editor-state-registry.js";
import type { EngineeringMutationRendererSyncCoordinatorV2 } from "./engineering-mutation-renderer-sync-v2.js";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export interface ApplicationIpcHandlerOptions {
  readonly chooseOpenProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseCreateProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseEngineeringDirectory?: () => Promise<string | undefined>;
  readonly chooseProjectTextFile?: (workspaceRoot: string) => Promise<string | undefined>;
  readonly workspaceActivationCoordinator?: WorkspaceActivationCoordinator;
  /** Main-owned ID source for projects created from ordinary creative folders. */
  readonly createImportedCreativeProjectId?: () => string;
  readonly modelSecretStore?: ModelSecretStore;
  readonly publishAiSuggestionStreamEvent?: (event: AiWritingSuggestionStreamPushEvent) => void;
  readonly agentRunSession?: AgentRunSession;
  readonly creativeProjectFileSession?: CreativeProjectFileSession;
  /** Main-owned proof that a creative Files-surface resource was freshly read and verified. */
  readonly creativeGeneralActiveResourceProof?: CreativeGeneralActiveResourceProof;
  readonly agentRuntimeManager?: DesktopAgentRuntimeManager;
  readonly workspaceContextPolicyStore?: WorkspaceContextPolicyStore;
  readonly publishAgentRunEvent?: (event: AgentRunEvent) => void;
  readonly publishStoryAnalysisCompletionEvent?: (event: StoryAnalysisCompletionEvent) => void;
  readonly agentWriteSaveCoordinator?: AgentWriteSaveCoordinator;
  /** Main-owned managed writing editor liveness registry. */
  readonly writingEditorStateRegistry?: WritingEditorStateRegistry;
  /** The only workspace permitted to report managed writing editor state. */
  readonly getActiveWritingEditorWorkspaceId?: () => string | undefined;
  /** Main-owned engineering editor registry; renderer input cannot create a root binding. */
  readonly engineeringEditorStateRegistry?: EngineeringEditorStateRegistry;
  /** The sole native root binding allowed to accept engineering editor state reports. */
  readonly getActiveEngineeringEditorRootBindingId?: () => string | undefined;
  /** Main-owned acknowledgement coordinator for committed Engineering V2 mutations. */
  readonly engineeringMutationRendererSync?: EngineeringMutationRendererSyncCoordinatorV2;
  /** Main-owned startup recovery gate. When present, ordinary engineering writes/transitions
   * remain blocked until the same root scan used by Agent mutation is clear. */
  readonly assertEngineeringRecoveryAllowed?: () => Promise<Result<void, UnifiedError>>;
  readonly agentNetworkSettingsSession?: AgentNetworkSettingsSession;
  readonly agentMcpSettingsSession?: McpSettingsSession;
  readonly agentTaskCatalogPort?: {
    listAuthorizedTasks(
      projectId: string
    ): Promise<
      import("@novel-studio/shared").Result<
        readonly import("@novel-studio/repository").AuthorizedTask[],
        import("@novel-studio/shared").UnifiedError
      >
    >;
    revokeTask(
      projectId: string,
      taskId: string
    ): Promise<
      import("@novel-studio/shared").Result<void, import("@novel-studio/shared").UnifiedError>
    >;
  };
  /** Rebuilds settings-backed capability state after a successful Agent settings mutation. */
  readonly onAgentSettingsChanged?: () => Promise<Result<void, UnifiedError>>;
}

export interface AgentWriteSaveCoordinator {
  pauseAutosave(relativePaths: readonly string[]): Promise<void>;
  resumeAutosave(relativePaths: readonly string[]): Promise<void>;
  beginSave(
    relativePath: string
  ): { readonly ok: false } | { readonly ok: true; readonly release: () => void };
  /**
   * Stops every renderer-originated engineering save for one Main-owned root and waits for any
   * already-started save on that root to finish. The root binding is never supplied by Renderer.
   */
  pauseAndDrainEngineeringRoot(rootBindingId: string): Promise<{ readonly release: () => void }>;
  /**
   * Starts a renderer-originated engineering save only while its Main-owned root is unpaused.
   * The relative identity is intentionally scoped beneath the opaque root binding.
   */
  beginEngineeringSave(
    rootBindingId: string,
    relativeIdentity: string
  ): { readonly ok: false } | { readonly ok: true; readonly release: () => void };
}

interface PrepareAgentSendPreviewCommand {
  readonly schemaVersion: "2.0";
  readonly commandId: string;
  readonly startCommand: StartAgentRunCommand;
}

interface PreviewCapableRuntimeServices {
  readonly prepareAgentSendPreview: (
    command: PrepareAgentSendPreviewCommand
  ) => Promise<Result<AgentSendPreviewDtoV2, UnifiedError>>;
  readonly confirmAgentSendPreview: (
    command: ConfirmAgentSendPreviewCommandV2
  ) => Promise<Result<unknown, UnifiedError>>;
  readonly readAgentSendLedger?: (runId: string) => Promise<Result<unknown, UnifiedError>>;
}

interface SavePathState {
  pauseCount: number;
  activeSaveCount: number;
  readonly drainWaiters: Set<() => void>;
}

interface EngineeringRootSaveState {
  pauseCount: number;
  activeSaveCount: number;
  readonly activeSaveCountByRelativeIdentity: Map<string, number>;
  readonly drainWaiters: Set<() => void>;
}

interface DirectorySelection {
  readonly path: string;
  readonly purpose: "creative-open" | "creative-create-parent" | "engineering-open";
  readonly displayName: string;
  readonly expiresAt: number;
}

interface CreativeFolderCandidateInternal {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly fileIdentity: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
  readonly modifiedAt: string;
  readonly sha256: string;
  readonly defaultTitle: string;
  readonly naturalOrder: number;
}

interface CreativeFolderInspectionState {
  readonly rootPath: string;
  readonly rootIdentity: string;
  readonly parentPath: string;
  readonly parentIdentity: string;
  readonly targetDisplayName: string;
  readonly candidates: readonly CreativeFolderCandidateInternal[];
}

const CREATIVE_FOLDER_TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const CREATIVE_FOLDER_MANAGED_MARKERS = new Set(
  [
    ...DEFAULT_CREATIVE_PROJECT_FILE_POLICY.managedFileNames,
    ...DEFAULT_CREATIVE_PROJECT_FILE_POLICY.managedPathSegments
  ].map((value) => value.toLocaleLowerCase())
);

export function createAgentWriteSaveCoordinator(): AgentWriteSaveCoordinator {
  const stateByPath = new Map<string, SavePathState>();
  const engineeringStateByRootBindingId = new Map<string, EngineeringRootSaveState>();
  const getState = (relativePath: string): SavePathState => {
    const current = stateByPath.get(relativePath);
    if (current !== undefined) return current;
    const created: SavePathState = {
      pauseCount: 0,
      activeSaveCount: 0,
      drainWaiters: new Set()
    };
    stateByPath.set(relativePath, created);
    return created;
  };
  const getEngineeringState = (rootBindingId: string): EngineeringRootSaveState => {
    const current = engineeringStateByRootBindingId.get(rootBindingId);
    if (current !== undefined) return current;
    const created: EngineeringRootSaveState = {
      pauseCount: 0,
      activeSaveCount: 0,
      activeSaveCountByRelativeIdentity: new Map(),
      drainWaiters: new Set()
    };
    engineeringStateByRootBindingId.set(rootBindingId, created);
    return created;
  };

  return {
    async pauseAutosave(relativePaths) {
      const uniquePaths = [...new Set(relativePaths)];
      const states = uniquePaths.map((relativePath) => {
        const state = getState(relativePath);
        state.pauseCount += 1;
        return state;
      });
      await Promise.all(
        states.map(
          (state) =>
            state.activeSaveCount === 0 ||
            new Promise<void>((resolve) => state.drainWaiters.add(resolve))
        )
      );
    },
    async resumeAutosave(relativePaths) {
      for (const relativePath of new Set(relativePaths)) {
        const state = stateByPath.get(relativePath);
        if (state === undefined) continue;
        state.pauseCount = Math.max(0, state.pauseCount - 1);
        if (state.pauseCount === 0 && state.activeSaveCount === 0) {
          stateByPath.delete(relativePath);
        }
      }
    },
    beginSave(relativePath) {
      const state = getState(relativePath);
      if (state.pauseCount > 0) return { ok: false };
      state.activeSaveCount += 1;
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          state.activeSaveCount -= 1;
          if (state.activeSaveCount === 0) {
            const waiters = [...state.drainWaiters];
            state.drainWaiters.clear();
            for (const resolve of waiters) resolve();
            if (state.pauseCount === 0) stateByPath.delete(relativePath);
          }
        }
      };
    },
    async pauseAndDrainEngineeringRoot(rootBindingId) {
      const state = getEngineeringState(rootBindingId);
      state.pauseCount += 1;
      if (state.activeSaveCount > 0) {
        await new Promise<void>((resolve) => state.drainWaiters.add(resolve));
      }
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          state.pauseCount = Math.max(0, state.pauseCount - 1);
          if (state.pauseCount === 0 && state.activeSaveCount === 0) {
            engineeringStateByRootBindingId.delete(rootBindingId);
          }
        }
      };
    },
    beginEngineeringSave(rootBindingId, relativeIdentity) {
      const state = getEngineeringState(rootBindingId);
      if (state.pauseCount > 0) return { ok: false };
      state.activeSaveCount += 1;
      state.activeSaveCountByRelativeIdentity.set(
        relativeIdentity,
        (state.activeSaveCountByRelativeIdentity.get(relativeIdentity) ?? 0) + 1
      );
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          state.activeSaveCount -= 1;
          const remainingForRelativeIdentity =
            (state.activeSaveCountByRelativeIdentity.get(relativeIdentity) ?? 1) - 1;
          if (remainingForRelativeIdentity === 0) {
            state.activeSaveCountByRelativeIdentity.delete(relativeIdentity);
          } else {
            state.activeSaveCountByRelativeIdentity.set(
              relativeIdentity,
              remainingForRelativeIdentity
            );
          }
          if (state.activeSaveCount === 0) {
            const waiters = [...state.drainWaiters];
            state.drainWaiters.clear();
            for (const resolve of waiters) resolve();
            if (state.pauseCount === 0) engineeringStateByRootBindingId.delete(rootBindingId);
          }
        }
      };
    }
  };
}

interface ActiveAiSuggestionStream {
  readonly abortController: AbortController;
  readonly iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
}

interface ActiveAiSuggestionPushStream {
  readonly abortController: AbortController;
  readonly iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
}

export function createApplicationIpcHandlers(
  application: DesktopApplication = createDesktopApplication(),
  options: ApplicationIpcHandlerOptions = {}
): ApplicationIpcHandlers {
  const activeAiSuggestionStreams = new Map<string, ActiveAiSuggestionStream>();
  const activeAiSuggestionPushStreams = new Map<string, ActiveAiSuggestionPushStream>();
  const directorySelections = new Map<string, DirectorySelection>();
  const creativeFolderInspections = new Map<string, CreativeFolderInspectionState>();
  let nextAiSuggestionStreamId = 0;
  const publishAgentRunEvent = (event: AgentRunEvent): void => {
    try {
      options.publishAgentRunEvent?.(structuredClone(event));
    } catch {
      // AgentRunSession owns contract failure handling; never forward a non-cloneable payload.
    }
  };
  const publishStoryAnalysisCompletionEvent = (event: StoryAnalysisCompletionEvent): void => {
    try {
      options.publishStoryAnalysisCompletionEvent?.(structuredClone(event));
    } catch {
      // Completion publication is best-effort and must never affect the durable analysis result.
    }
  };
  options.agentRunSession?.subscribe(publishAgentRunEvent);
  application.subscribeStoryAnalysisCompletion?.(publishStoryAnalysisCompletionEvent);
  options.agentRuntimeManager?.subscribeAgentRunEvents(publishAgentRunEvent);
  const activeAgentRuntime = () =>
    options.agentRuntimeManager?.active?.()?.runtime ?? options.agentRuntimeManager?.current?.();
  const currentAgentRunSession = (): AgentRunSession | undefined =>
    activeAgentRuntime()?.agentRunSession ?? options.agentRunSession;
  const notifyAgentSettingsChanged = async <T>(
    request: Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> => {
    const result = await request;
    if (result.ok) {
      try {
        await options.onAgentSettingsChanged?.();
      } catch {
        // The durable mutation is authoritative. Main revokes old capabilities before refresh, so
        // a refresh failure must not make the renderer retry an already-persisted operation.
      }
    }
    return result;
  };
  const currentAgentConversationSession = (): AgentConversationSession | undefined =>
    activeAgentRuntime()?.agentConversationSession;
  const currentAgentRunDraftSession = (): AgentRunDraftSession | undefined =>
    activeAgentRuntime()?.agentRunDraftSession;
  const currentAgentContextSession = (): AgentContextSession | undefined =>
    activeAgentRuntime()?.agentContextSession;
  const currentAgentPermissionSession = (): AgentPermissionSession | undefined =>
    activeAgentRuntime()?.agentPermissionSession;

  const verifyCreativeGeneralProof = async (
    identity: AgentScopeIdentity,
    reference?: {
      readonly refId: string;
      readonly relativePath: string;
      readonly label: string;
      readonly expectedChecksum?: string;
      readonly range?: unknown;
    } | null
  ): Promise<Result<void, UnifiedError> | undefined> => {
    const active = options.agentRuntimeManager?.active?.();
    if (active?.scope !== "workspace" || active.binding.kind !== "creativeProject") {
      return undefined;
    }
    const workspaceId =
      identity.scope?.kind === "workspace" ? identity.scope.workspaceId : identity.projectId;
    if (
      workspaceId === undefined ||
      workspaceId !== active.binding.workspaceId ||
      (identity.scope?.kind === "workspace" && identity.scope.workspaceKind !== "creativeProject")
    ) {
      return err(creativeGeneralActiveResourceUnavailable("workspace_identity_mismatch"));
    }
    const proof = options.creativeGeneralActiveResourceProof;
    const session = options.creativeProjectFileSession;
    if (proof === undefined || session === undefined) {
      return err(creativeGeneralActiveResourceUnavailable("proof_unavailable"));
    }
    const sessionIdentity = session.getActiveIdentity();
    if (
      sessionIdentity === undefined ||
      sessionIdentity.workspaceId !== active.binding.workspaceId
    ) {
      return err(creativeGeneralActiveResourceUnavailable("active_session_workspace_mismatch"));
    }
    const proofInput = {
      identity: sessionIdentity,
      session
    };
    return reference === undefined
      ? proof.verifyFilesSurface(proofInput)
      : proof.verifyReference({ ...proofInput, reference });
  };

  const verifyCreativePlanApprovalContext = async (
    command: DecideAgentPlanCommand,
    session: AgentRunSession
  ): Promise<Result<void, UnifiedError> | undefined> => {
    const active = options.agentRuntimeManager?.active?.();
    if (
      command.decision !== "approve" ||
      command.executionContextMode !== "general_file" ||
      active?.scope !== "workspace" ||
      active.binding.kind !== "creativeProject" ||
      command.projectId !== active.binding.workspaceId
    ) {
      return undefined;
    }
    const source = await session.readAgentRun(command.runId);
    if (!source.ok) return err(source.error);
    return source.value.snapshot.contextMode === "writing"
      ? err(agentContextRepreflightRequired())
      : undefined;
  };

  async function chooseDirectory(
    purpose: DirectorySelection["purpose"],
    choose: (() => Promise<string | undefined>) | undefined
  ): Promise<
    Result<
      {
        readonly canceled: boolean;
        readonly selectionId?: string;
        readonly displayName?: string;
      },
      UnifiedError
    >
  > {
    const now = Date.now();
    for (const [selectionId, selection] of directorySelections) {
      if (selection.expiresAt > now) continue;
      directorySelections.delete(selectionId);
      creativeFolderInspections.delete(selectionId);
    }
    const selected = await choose?.();
    if (selected === undefined) return ok({ canceled: true });
    try {
      const canonicalPath = await realpath(selected);
      const selectionId = `selection_${randomUUID().replaceAll("-", "")}`;
      const displayName = basename(canonicalPath);
      directorySelections.set(selectionId, {
        path: canonicalPath,
        purpose,
        displayName,
        expiresAt: Date.now() + 10 * 60 * 1000
      });
      return ok({ canceled: false, selectionId, displayName });
    } catch {
      return err(directorySelectionFailed());
    }
  }

  async function chooseProjectTextFile(): Promise<
    Result<ProjectTextFileSelectionDto, UnifiedError>
  > {
    const workspaceRoot = options.agentRuntimeManager?.currentWorkspace()?.contentRoot;
    if (workspaceRoot === undefined) {
      return err(
        createUnifiedError({
          code: "PROJECT_FILE_SELECTION_UNAVAILABLE",
          category: "UserError",
          message: "请先打开项目，再添加引用文件。",
          recoverability: "user-action",
          suggestedAction: "Open a project and retry the file selection.",
          traceId: "project-file-selection"
        })
      );
    }

    const selected = await options.chooseProjectTextFile?.(workspaceRoot);
    if (selected === undefined) return ok({ canceled: true });
    try {
      const [canonicalRoot, canonicalFile] = await Promise.all([
        realpath(workspaceRoot),
        realpath(selected)
      ]);
      const fileInfo = await stat(canonicalFile);
      const relativePath = relative(canonicalRoot, canonicalFile);
      const outsideWorkspace =
        relativePath.length === 0 ||
        isAbsolute(relativePath) ||
        /^\.\.([\\/]|$)/.test(relativePath);
      if (outsideWorkspace || !fileInfo.isFile()) {
        return err(projectTextFileSelectionInvalid());
      }
      return ok({
        canceled: false,
        relativePath: relativePath.replaceAll("\\", "/"),
        displayName: basename(canonicalFile)
      });
    } catch {
      return err(projectTextFileSelectionInvalid());
    }
  }

  function resolveDirectorySelection(
    selectionId: unknown,
    purpose: DirectorySelection["purpose"]
  ): Result<DirectorySelection, UnifiedError> {
    if (typeof selectionId !== "string") return err(directorySelectionInvalid());
    const selection = directorySelections.get(selectionId);
    if (
      selection === undefined ||
      selection.purpose !== purpose ||
      selection.expiresAt <= Date.now()
    ) {
      directorySelections.delete(selectionId);
      creativeFolderInspections.delete(selectionId);
      return err(directorySelectionInvalid());
    }
    return ok(selection);
  }

  async function inspectCreativeFolder(
    selectionId: unknown
  ): Promise<Result<OpenCreativeDirectoryInspection, UnifiedError>> {
    const selection = resolveDirectorySelection(selectionId, "creative-open");
    if (!selection.ok) return selection;
    const rootPath = selection.value.path;
    try {
      const [rootStats, entries] = await Promise.all([
        lstat(rootPath),
        readdir(rootPath, { withFileTypes: true })
      ]);
      if (!rootStats.isDirectory()) return err(creativeFolderInvalid("选择的路径不是目录。"));
      const projectPath = join(rootPath, "project.json");
      const settingsPath = join(rootPath, "settings.json");
      const [projectStat, settingsStat] = await Promise.all([
        lstatIfPresent(projectPath),
        lstatIfPresent(settingsPath)
      ]);
      const hasManagedMarker = entries.some((entry) =>
        CREATIVE_FOLDER_MANAGED_MARKERS.has(entry.name.toLocaleLowerCase())
      );
      if (projectStat !== undefined || settingsStat !== undefined) {
        if (
          !projectStat?.isFile() ||
          projectStat.isSymbolicLink() ||
          !settingsStat?.isFile() ||
          settingsStat.isSymbolicLink()
        ) {
          return err(creativeFolderInvalid("该目录包含不完整的山海项目元数据。"));
        }
        try {
          const [projectText, settingsText] = await Promise.all([
            readFile(projectPath, "utf8"),
            readFile(settingsPath, "utf8")
          ]);
          const project = JSON.parse(projectText) as unknown;
          const settings = JSON.parse(settingsText) as unknown;
          const [projectValidation, settingsValidation] = await Promise.all([
            validateWithSchema("project", project),
            validateWithSchema("settings", settings)
          ]);
          if (!projectValidation.valid || !settingsValidation.valid) {
            return err(creativeFolderInvalid("项目元数据格式无效，请先修复后再打开。"));
          }
          return ok({ kind: "existing-project" });
        } catch {
          return err(creativeFolderInvalid("项目元数据损坏，请先修复后再打开。"));
        }
      }
      if (hasManagedMarker) {
        return err(creativeFolderInvalid("该目录包含受管项目目录，但缺少完整项目元数据。"));
      }

      const textEntries = entries
        .filter(
          (entry) =>
            entry.isFile() &&
            CREATIVE_FOLDER_TEXT_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())
        )
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
      if (textEntries.length === 0)
        return err(creativeFolderInvalid("未找到根目录下的 .txt 或 .md 正文文件。"));
      if (textEntries.length > DEFAULT_CREATIVE_PROJECT_FILE_POLICY.maxItems)
        return err(creativeFolderInvalid("正文文件数量超过支持上限。"));

      const parentPath = dirname(rootPath);
      const targetDisplayName = `${basename(rootPath)} - ShanHai`;
      const targetPath = join(parentPath, targetDisplayName);
      if ((await lstatIfPresent(targetPath)) !== undefined) {
        return err(creativeFolderTargetConflict());
      }
      const candidates: CreativeFolderCandidateInternal[] = [];
      for (let index = 0; index < textEntries.length; index += 1) {
        const entry = textEntries[index];
        if (entry === undefined) continue;
        const absolutePath = join(rootPath, entry.name);
        if (absolutePath.length > 1024) {
          return err(creativeFolderInvalid("正文文件路径超过支持上限。"));
        }
        const fileStats = await lstat(absolutePath);
        if (
          !fileStats.isFile() ||
          fileStats.isSymbolicLink() ||
          fileStats.size > DEFAULT_CREATIVE_PROJECT_FILE_POLICY.maxTextBytes
        ) {
          return err(creativeFolderInvalid("正文文件不是受支持的普通 UTF-8 文本文件。"));
        }
        const bytes = await readFile(absolutePath);
        const defaultTitle = basename(entry.name, extname(entry.name)).trim();
        if (defaultTitle.length === 0) {
          return err(creativeFolderInvalid("正文文件名必须包含可用的章节标题。"));
        }
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (decoded.includes("\0")) {
            return err(creativeFolderInvalid("正文文件包含不受支持的空字符。"));
          }
        } catch {
          return err(creativeFolderInvalid("正文文件必须是合法 UTF-8 编码。"));
        }
        candidates.push({
          relativePath: entry.name.replaceAll("\\", "/"),
          absolutePath,
          fileIdentity: fileIdentity(fileStats),
          sizeBytes: bytes.byteLength,
          modifiedAtMs: fileStats.mtimeMs,
          modifiedAt: new Date(fileStats.mtimeMs).toISOString(),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          defaultTitle,
          naturalOrder: index
        });
      }
      const rootIdentity = fileIdentity(rootStats);
      const parentStats = await lstat(parentPath);
      const parentIdentity = fileIdentity(parentStats);
      creativeFolderInspections.set(selectionId as string, {
        rootPath,
        rootIdentity,
        parentPath,
        parentIdentity,
        targetDisplayName,
        candidates
      });
      const preview: CreativeFolderPreview = {
        schemaVersion: "1.0",
        sourceDisplayName: selection.value.displayName,
        targetDisplayName,
        defaultProjectTitle: basename(rootPath),
        language: "zh-CN",
        candidates: candidates.map((candidate) => ({
          relativePath: candidate.relativePath,
          sizeBytes: candidate.sizeBytes,
          modifiedAt: candidate.modifiedAt,
          sha256: candidate.sha256,
          defaultTitle: candidate.defaultTitle,
          naturalOrder: candidate.naturalOrder
        }))
      };
      return ok({ kind: "creative-folder", preview });
    } catch {
      return err(creativeFolderInvalid("无法读取所选目录。"));
    }
  }

  async function confirmCreativeFolder(
    input: unknown
  ): Promise<Result<CreativeFolderCopyResult, UnifiedError>> {
    const request = toCreativeFolderConfirmationRequest(input);
    if (request === undefined) return invalidWorkspaceRequest<CreativeFolderCopyResult>();
    const selection = resolveDirectorySelection(request.selectionId, "creative-open");
    if (!selection.ok) return selection;
    const inspection = creativeFolderInspections.get(request.selectionId);
    directorySelections.delete(request.selectionId);
    creativeFolderInspections.delete(request.selectionId);
    if (inspection === undefined) return err(directorySelectionInvalid());
    const recovery = await assertEngineeringRecovery(options, { allowWorkspaceExit: true });
    if (!recovery.ok) return recovery;
    try {
      const [rootStats, parentStats] = await Promise.all([
        lstat(inspection.rootPath),
        lstat(inspection.parentPath)
      ]);
      if (
        fileIdentity(rootStats) !== inspection.rootIdentity ||
        fileIdentity(parentStats) !== inspection.parentIdentity
      ) {
        return err(creativeFolderInvalid("源目录已发生变化，请重新选择。"));
      }
      const currentEntries = await readdir(inspection.rootPath, { withFileTypes: true });
      if (
        currentEntries.some((entry) =>
          CREATIVE_FOLDER_MANAGED_MARKERS.has(entry.name.toLocaleLowerCase())
        )
      ) {
        return err(creativeFolderInvalid("源目录已出现山海项目数据，请重新选择。"));
      }
      const unique = new Set(request.relativePaths);
      if (unique.size !== request.relativePaths.length)
        return err(creativeFolderInvalid("正文文件不能重复选择。"));
      const selected = inspection.candidates
        .filter((candidate) => unique.has(candidate.relativePath))
        .sort((left, right) => left.naturalOrder - right.naturalOrder);
      if (selected.some((candidate) => candidate === undefined) || selected.length === 0) {
        return err(creativeFolderInvalid("请选择至少一个有效正文文件。"));
      }
      if (selected.length !== request.relativePaths.length) {
        return err(creativeFolderInvalid("请选择至少一个有效正文文件。"));
      }
      const chapters = [];
      for (const candidate of selected) {
        const currentStats = await lstat(candidate.absolutePath);
        const bytes = await readFile(candidate.absolutePath);
        const currentHash = createHash("sha256").update(bytes).digest("hex");
        if (
          !currentStats.isFile() ||
          currentStats.isSymbolicLink() ||
          fileIdentity(currentStats) !== candidate.fileIdentity ||
          currentStats.size !== candidate.sizeBytes ||
          currentStats.mtimeMs !== candidate.modifiedAtMs ||
          currentHash !== candidate.sha256
        ) {
          return err(creativeFolderInvalid("正文文件已发生变化，请重新选择。"));
        }
        let body: string;
        try {
          body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (body.includes("\0")) {
            return err(creativeFolderInvalid("正文文件包含不受支持的空字符。"));
          }
        } catch {
          return err(creativeFolderInvalid("正文文件必须是合法 UTF-8 编码。"));
        }
        chapters.push({ title: candidate.defaultTitle, body });
      }
      const targetPath = join(inspection.parentPath, inspection.targetDisplayName);
      if ((await lstatIfPresent(targetPath)) !== undefined)
        return err(creativeFolderTargetConflict());
      if (options.workspaceActivationCoordinator?.importCreativeProject === undefined) {
        return workspaceActivationUnavailable<CreativeFolderCopyResult>();
      }
      const projectId =
        options.createImportedCreativeProjectId?.() ??
        `prj_import_${randomUUID().replaceAll("-", "")}`;
      if (!isSafeId(projectId)) {
        return err(creativeFolderInvalid("无法生成有效的山海项目标识。"));
      }
      const imported = await options.workspaceActivationCoordinator.importCreativeProject({
        parentDirectory: inspection.parentPath,
        folderName: inspection.targetDisplayName,
        projectId,
        title: basename(inspection.rootPath),
        language: "zh-CN",
        chapters
      });
      if (!imported.ok) return imported;
      return ok({
        schemaVersion: "1.0",
        projectId: imported.value.projectId,
        importedChapterIds: imported.value.importedChapterIds,
        lastImportedChapterId: imported.value.lastImportedChapterId,
        targetLocationLabel: inspection.targetDisplayName,
        activation: imported.value.activation
      });
    } catch {
      return err(creativeFolderInvalid("接入正文时读取源文件失败。"));
    }
  }

  return {
    "application:get-shell-state": () => Promise.resolve(application.getShellState()),
    "application:list-commands": () => Promise.resolve(application.listCommands()),
    "application:execute-command": async (commandId: unknown) => {
      if (typeof commandId !== "string") {
        return Promise.resolve(application.executeCommand(""));
      }

      if (commandId === "workspace.close-current") {
        const recovery = await assertEngineeringRecovery(options, { allowWorkspaceExit: true });
        if (!recovery.ok) return recovery;
        return (
          options.workspaceActivationCoordinator?.closeCurrentWorkspace() ??
          Promise.resolve(application.executeCommand(""))
        );
      }

      return Promise.resolve(application.executeCommand(commandId));
    },
    "application:project:choose-open-creative-directory": () =>
      chooseDirectory("creative-open", options.chooseOpenProjectDirectory),
    "application:project:inspect-open-creative-directory": (selectionId: unknown) =>
      inspectCreativeFolder(selectionId),
    "application:project:confirm-creative-folder": (input: unknown) => confirmCreativeFolder(input),
    "application:project:choose-create-parent-directory": () =>
      chooseDirectory("creative-create-parent", options.chooseCreateProjectDirectory),
    "application:project:get-active-workspace": () =>
      Promise.resolve(projectSnapshotResultToDto(application.getActiveProjectWorkspace())),
    "application:project:refresh-active-workspace": () =>
      application
        .refreshActiveProjectWorkspace()
        .then((result) => projectSnapshotResultToDto(result)),
    "application:project:open-creative-project": async (selectionId: unknown) => {
      const selection = resolveDirectorySelection(selectionId, "creative-open");
      if (!selection.ok) return selection;
      directorySelections.delete(selectionId as string);
      creativeFolderInspections.delete(selectionId as string);
      const recovery = await assertEngineeringRecovery(options, { allowWorkspaceExit: true });
      if (!recovery.ok) return recovery;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return options.workspaceActivationCoordinator.openCreativeProject(selection.value.path);
    },
    "application:project:preview-creative-project": async (input: unknown) => {
      const request = toCreativePreviewRequest(input);
      if (request === undefined) return invalidWorkspaceRequest<ProjectCreationPreviewDto>();
      const selection = resolveDirectorySelection(
        request.parentSelectionId,
        "creative-create-parent"
      );
      if (!selection.ok) return selection;
      return application.previewCreativeProject({
        parentDirectory: selection.value.path,
        folderName: request.folderName
      });
    },
    "application:project:create-creative-project": async (input: unknown) => {
      const recovery = await assertEngineeringRecovery(options, { allowWorkspaceExit: true });
      if (!recovery.ok) return recovery;
      const request = toCreateCreativeProjectRequest(input);
      if (request === undefined) return invalidWorkspaceRequest<WorkspaceActivationDto>();
      const selection = resolveDirectorySelection(
        request.parentSelectionId,
        "creative-create-parent"
      );
      if (!selection.ok) return selection;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return options.workspaceActivationCoordinator.createCreativeProject({
        parentDirectory: selection.value.path,
        folderName: request.folderName,
        projectId: request.projectId,
        title: request.title,
        language: request.language,
        ...(request.projectType === undefined ? {} : { projectType: request.projectType }),
        ...(request.targetWordCount === undefined
          ? {}
          : { targetWordCount: request.targetWordCount })
      });
    },
    "application:workspace:choose-engineering-directory": () =>
      chooseDirectory("engineering-open", options.chooseEngineeringDirectory),
    "application:workspace:choose-text-file": () => chooseProjectTextFile(),
    "application:workspace:open-engineering-workspace": async (selectionId: unknown) => {
      const recovery = await assertEngineeringRecovery(options);
      if (!recovery.ok) return recovery;
      const selection = resolveDirectorySelection(selectionId, "engineering-open");
      if (!selection.ok) return selection;
      if (options.workspaceActivationCoordinator === undefined) {
        return workspaceActivationUnavailable<WorkspaceActivationDto>();
      }
      return withActiveEngineeringRootBindingActivation(
        await options.workspaceActivationCoordinator.openEngineeringWorkspace(selection.value.path),
        options.getActiveEngineeringEditorRootBindingId?.()
      );
    },
    "application:workspace:attach-active-creative-project": async () => {
      const recovery = await assertEngineeringRecovery(options);
      if (!recovery.ok) return recovery;
      return withActiveEngineeringRootBindingSnapshot(
        await application.attachActiveCreativeProjectEngineeringWorkspace(),
        options.getActiveEngineeringEditorRootBindingId?.()
      );
    },
    "application:workspace:refresh-engineering-tree": async () =>
      withActiveEngineeringRootBindingSnapshot(
        await application.refreshEngineeringTree(),
        options.getActiveEngineeringEditorRootBindingId?.()
      ),
    "application:workspace:read-text-file": (path: unknown) =>
      typeof path === "string"
        ? application.readEngineeringTextFile(path)
        : Promise.resolve(invalidWorkspaceRequest()),
    "application:workspace:save-text-file": (input: unknown) => {
      const request = toEngineeringTextFileSaveRequest(input);
      return request === undefined
        ? Promise.resolve(invalidWorkspaceRequest())
        : saveEngineeringTextFileWithCoordinator(
            application,
            options.agentWriteSaveCoordinator,
            options.getActiveEngineeringEditorRootBindingId,
            request,
            options.assertEngineeringRecoveryAllowed
          );
    },
    "application:workspace:complete-engineering-mutation-sync": (input: unknown) =>
      Promise.resolve(
        options.engineeringMutationRendererSync?.complete(input) ??
          engineeringMutationRendererSyncUnavailable()
      ),
    "application:workspace:create-project-conventions": async () => {
      const manager = options.agentRuntimeManager;
      const active = manager?.active();
      if (manager === undefined || active?.scope !== "workspace") {
        return err(projectConventionsUnavailable());
      }
      const created = await createDesktopProjectConventionsFile({
        workspaceKind: active.binding.kind,
        projectRoot: active.binding.contentRoot
      });
      if (!created.ok || options.workspaceContextPolicyStore === undefined) return created;

      const enabled = await options.workspaceContextPolicyStore.enableTrustedConventions({
        workspaceKind: active.binding.kind,
        workspaceId: active.binding.workspaceId,
        contentRoot: active.binding.contentRoot
      });
      if (!enabled.ok) return enabled;
      const refreshed = await manager.refreshCurrentWorkspace();
      if (!refreshed.ok) {
        manager.revokeCurrentSettingsCapabilities();
        return refreshed;
      }
      return created;
    },
    "application:workspace:read-model-sharing-defaults": async () => {
      const manager = options.agentRuntimeManager;
      const active = manager?.active();
      const store = options.workspaceContextPolicyStore;
      if (manager === undefined || store === undefined || active?.scope !== "workspace") {
        return err(workspaceContextPolicyUnavailable());
      }
      const policy = await store.read({
        workspaceKind: active.binding.kind,
        workspaceId: active.binding.workspaceId,
        contentRoot: active.binding.contentRoot
      });
      return ok(policy.sharingDefaults);
    },
    "application:workspace:update-context-policy": async (input: unknown) => {
      const update = toWorkspaceContextPolicyAction(input);
      const manager = options.agentRuntimeManager;
      const active = manager?.active();
      const store = options.workspaceContextPolicyStore;
      if (update === undefined) return invalidWorkspaceRequest();
      if (manager === undefined || store === undefined || active?.scope !== "workspace") {
        return err(workspaceContextPolicyUnavailable());
      }
      const binding = {
        workspaceKind: active.binding.kind,
        workspaceId: active.binding.workspaceId,
        contentRoot: active.binding.contentRoot
      } as const;
      const changed =
        update.action === "set_source_preference"
          ? await store.setSourcePreference(binding, update.preference)
          : update.action === "set_sharing_defaults"
            ? await store.setSharingDefaults(binding, update.defaults)
            : update.action === "disable_conventions"
              ? await store.disableConventions(binding)
              : await store.revokeTrust(binding);
      if (!changed.ok) return changed;
      const refreshed = await manager.refreshCurrentWorkspace();
      if (!refreshed.ok) {
        manager.revokeCurrentSettingsCapabilities();
        return refreshed;
      }
      return ok(undefined);
    },
    "application:creative-project-files:refresh": async (input: unknown) => {
      const identity = toCreativeProjectFileIdentity(input);
      const session = options.creativeProjectFileSession;
      if (identity === undefined || session === undefined) return invalidWorkspaceRequest();
      const proof = options.creativeGeneralActiveResourceProof;
      return proof === undefined
        ? session.refresh(identity)
        : proof.attestFilesSurface({ identity, session });
    },
    "application:creative-project-files:read-text-file": async (input: unknown) => {
      const request = toCreativeProjectFileReadRequest(input);
      const session = options.creativeProjectFileSession;
      if (request === undefined || session === undefined) return invalidWorkspaceRequest();
      const read = await session.readTextFile(request);
      if (read.ok) {
        options.creativeGeneralActiveResourceProof?.recordResource({
          identity: { projectId: request.projectId, workspaceId: request.workspaceId },
          document: read.value
        });
      }
      return read;
    },
    "application:creative-project-files:save-text-file": async (input: unknown) => {
      const request = toCreativeProjectFileSaveRequest(input);
      const session = options.creativeProjectFileSession;
      if (request === undefined || session === undefined) return invalidWorkspaceRequest();
      const saved = await session.saveTextFile(request);
      if (saved.ok && saved.value.kind === "saved") {
        options.creativeGeneralActiveResourceProof?.recordResource({
          identity: { projectId: request.projectId, workspaceId: request.workspaceId },
          document: saved.value.document
        });
      }
      return saved;
    },
    "application:creative-project-files:execute-lifecycle": (input: unknown) => {
      const command = toCreativeProjectFileLifecycleCommand(input);
      return command === undefined ||
        options.creativeProjectFileSession === undefined ||
        !isCreativeProjectFileLifecycleAllowedByIpc(command, options.creativeProjectFileSession)
        ? Promise.resolve(invalidWorkspaceRequest())
        : options.creativeProjectFileSession.executeLifecycleCommand(command, "user");
    },
    "application:project:list-chapters": () => application.listProjectChapters(),
    "application:project:create-chapter": async (input: unknown) => {
      const createInput = toCreateChapterInput(input);
      if (createInput === undefined) {
        return projectSnapshotResultToDto(
          await application.createProjectChapter({
            chapterId: "",
            title: ""
          })
        );
      }

      return projectSnapshotResultToDto(await application.createProjectChapter(createInput));
    },
    "application:project:rename-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.renameProjectChapter(toRenameChapterInput(input))
      );
    },
    "application:project:duplicate-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.duplicateProjectChapter(toDuplicateChapterInput(input))
      );
    },
    "application:project:delete-chapter": async (input: unknown) => {
      return projectSnapshotResultToDto(
        await application.deleteProjectChapter(toDeleteChapterInput(input))
      );
    },
    "application:project:select-chapter": async (chapterId: unknown) => {
      if (typeof chapterId !== "string") {
        return projectSnapshotResultToDto(await application.selectProjectChapter(""));
      }

      return projectSnapshotResultToDto(await application.selectProjectChapter(chapterId));
    },
    "application:project:select-chapter-and-load": async (chapterId: unknown) => {
      const selected = await application.selectProjectChapterAndLoad(
        typeof chapterId === "string" ? chapterId : ""
      );
      return selected.ok
        ? ok({
            workspace: toProjectWorkspaceSnapshotDto(selected.value.workspace),
            chapterEditor: selected.value.chapterEditor
          })
        : selected;
    },
    "application:project:preview-recovery-draft": (sessionId: unknown) => {
      if (typeof sessionId !== "string") {
        return application.previewRecoveryDraft("");
      }

      return application.previewRecoveryDraft(sessionId);
    },
    "application:project:apply-recovery-draft": async (sessionId: unknown) => {
      const applied = await application.applyRecoveryDraft(
        typeof sessionId === "string" ? sessionId : ""
      );
      return applied.ok
        ? ok({
            workspace: toProjectWorkspaceSnapshotDto(applied.value.workspace),
            chapterEditor: applied.value.chapterEditor
          })
        : applied;
    },
    "application:project:discard-recovery-draft": async (sessionId: unknown) => {
      return projectSnapshotResultToDto(
        await application.discardRecoveryDraft(typeof sessionId === "string" ? sessionId : "")
      );
    },
    "application:search:rebuild-index": () => application.rebuildProjectSearchIndex(),
    "application:search:query": (input: unknown) => application.searchProject(toSearchQuery(input)),
    "application:ai:generate-chapter-suggestion": (request: unknown) => {
      return application.generateActiveChapterSuggestion(toAiWritingSuggestionRequest(request));
    },
    "application:ai:start-chapter-suggestion-stream": (request: unknown) => {
      const abortController = new AbortController();
      nextAiSuggestionStreamId += 1;
      const streamId = `ai_stream_${nextAiSuggestionStreamId}`;
      const suggestionStream = application.streamActiveChapterSuggestion({
        ...toAiWritingSuggestionRequest(request),
        abortSignal: abortController.signal
      });
      const iterator = suggestionStream[Symbol.asyncIterator]();
      activeAiSuggestionStreams.set(streamId, {
        abortController,
        iterator
      });

      return Promise.resolve(ok({ streamId }));
    },
    "application:ai:next-chapter-suggestion-stream": async (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionStreams.get(id);
      if (id === undefined || stream === undefined) {
        return streamNotFound();
      }

      let next: IteratorResult<Result<AiWritingSuggestionStreamEvent, UnifiedError>>;
      try {
        next = await stream.iterator.next();
      } catch (error) {
        activeAiSuggestionStreams.delete(id);
        return thrownAiStreamError(error);
      }
      if (next.done === true) {
        activeAiSuggestionStreams.delete(id);
        return ok({ done: true });
      }
      if (!next.value.ok) {
        activeAiSuggestionStreams.delete(id);
        return next.value;
      }

      return ok({
        done: false,
        event: next.value.value
      });
    },
    "application:ai:cancel-chapter-suggestion-stream": (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionStreams.get(id);
      if (id === undefined || stream === undefined) {
        return Promise.resolve(ok(undefined));
      }

      stream.abortController.abort();
      void stream.iterator.return?.();
      activeAiSuggestionStreams.delete(id);
      return Promise.resolve(ok(undefined));
    },
    "application:ai:start-chapter-suggestion-push-stream": (request: unknown) => {
      const parsed = toAiWritingSuggestionStreamStartRequest(request);
      if (parsed === undefined) {
        return Promise.resolve(
          err(
            createUnifiedError({
              code: "AI_STREAM_REQUEST_INVALID",
              category: "ValidationError",
              message: "The AI stream request is invalid.",
              recoverability: "user-action",
              suggestedAction: "Start the AI writing stream again.",
              traceId: "desktop-ipc-handlers"
            })
          )
        );
      }

      if (activeAiSuggestionPushStreams.has(parsed.streamId)) {
        return Promise.resolve(ok({ streamId: parsed.streamId }));
      }

      const abortController = new AbortController();
      const { streamId, ...normalizedRequest } = parsed;
      const suggestionStream = application.streamActiveChapterSuggestion({
        ...normalizedRequest,
        abortSignal: abortController.signal
      });
      const iterator = suggestionStream[Symbol.asyncIterator]();
      activeAiSuggestionPushStreams.set(streamId, { abortController, iterator });
      void pumpAiSuggestionPushStream(
        streamId,
        iterator,
        abortController,
        options.publishAiSuggestionStreamEvent,
        () => activeAiSuggestionPushStreams.delete(streamId)
      );
      return Promise.resolve(ok({ streamId }));
    },
    "application:ai:cancel-chapter-suggestion-push-stream": (streamId: unknown) => {
      const id = readStreamId(streamId);
      const stream = id === undefined ? undefined : activeAiSuggestionPushStreams.get(id);
      if (id === undefined || stream === undefined) {
        return Promise.resolve(ok(undefined));
      }

      stream.abortController.abort();
      void stream.iterator.return?.();
      activeAiSuggestionPushStreams.delete(id);
      return Promise.resolve(ok(undefined));
    },
    "application:ai:generate-selection-preview": (request: unknown) => {
      return application.generateActiveSelectionPreview(
        toAiWritingSelectionPreviewRequest(request)
      );
    },
    "application:ai:apply-selection-preview": (previewId: unknown) => {
      if (typeof previewId !== "string") {
        return application.applyActiveSelectionPreview("");
      }

      return application.applyActiveSelectionPreview(previewId);
    },
    "application:ai:apply-chapter-suggestion": (suggestionId: unknown) => {
      if (typeof suggestionId !== "string") {
        return application.applyActiveChapterSuggestion("");
      }

      return application.applyActiveChapterSuggestion(suggestionId);
    },
    "application:ai:list-workflow-runs": () => application.listWorkflowRuns(),
    "application:ai:read-workflow-run": (workflowRunId: unknown) => {
      if (typeof workflowRunId !== "string") {
        return application.readWorkflowRun("");
      }

      return application.readWorkflowRun(workflowRunId);
    },
    "application:agent-run:prepare-start": async (command: unknown) => {
      // Persist the renderer's pre-run intent (user choices only) as the current draft, returning a
      // reference the draft-only start command can carry. Server resolves capabilities/content later.
      const parsed = toSyncStartDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      if (parsed === undefined || draftSession === undefined) return agentRunUnavailable();
      if (parsed.contextMode === "general_file") {
        const verified = await verifyCreativeGeneralProof(
          parsed,
          parsed.activeResourceRef?.kind !== "project_file" ? undefined : parsed.activeResourceRef
        );
        if (verified !== undefined && !verified.ok) return verified;
      }
      return draftSession.syncStartDraft(parsed);
    },
    "application:agent-run:prepare-send-preview": async (command: unknown) => {
      const parsed = toPrepareAgentSendPreviewCommand(command);
      const previewRuntime = asPreviewCapableRuntime(activeAgentRuntime());
      if (parsed === undefined) return invalidAgentRunCommand();
      if (previewRuntime === undefined) return agentRunUnavailable();
      return previewRuntime.prepareAgentSendPreview(parsed);
    },
    "application:agent-run:confirm-send-preview": async (command: unknown) => {
      const parsed = toConfirmAgentSendPreviewCommand(command);
      const previewRuntime = asPreviewCapableRuntime(activeAgentRuntime());
      if (parsed === undefined) return invalidAgentRunCommand();
      if (previewRuntime === undefined) return agentRunUnavailable();
      const manager = options.agentRuntimeManager;
      if (manager === undefined) return previewRuntime.confirmAgentSendPreview(parsed);
      const lease = manager.acquireActiveRunStartLease();
      if (!lease.ok) return lease;
      try {
        return await previewRuntime.confirmAgentSendPreview(parsed);
      } finally {
        lease.value.release();
      }
    },
    "application:agent-run:read-send-ledger": async (runId: unknown) => {
      const parsed = toReadAgentSendLedgerRunId(runId);
      const previewRuntime = asPreviewCapableRuntime(activeAgentRuntime());
      if (parsed === undefined) return invalidAgentRunCommand();
      if (previewRuntime?.readAgentSendLedger === undefined) return agentRunUnavailable();
      return previewRuntime.readAgentSendLedger(parsed);
    },
    "application:agent-run:read-run-draft": (command: unknown) => {
      const parsed = toReadAgentRunDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.readAgentRunDraft(parsed);
    },
    "application:agent-run:update-run-draft": async (command: unknown) => {
      const parsed = toUpdateAgentRunDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      if (parsed === undefined || draftSession === undefined) return agentRunUnavailable();
      if (
        parsed.mutation.kind === "set_context_mode" &&
        parsed.mutation.contextMode === "general_file"
      ) {
        const verified = await verifyCreativeGeneralProof(parsed);
        if (verified !== undefined && !verified.ok) return verified;
      }
      const updated = await draftSession.updateAgentRunDraft(parsed);
      if (
        updated.ok &&
        parsed.mutation.kind === "set_context_mode" &&
        parsed.mutation.contextMode !== "general_file"
      ) {
        options.creativeGeneralActiveResourceProof?.clear();
      }
      return updated;
    },
    "application:agent-run:update-context-draft": async (command: unknown) => {
      const parsed = toUpdateContextDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      if (parsed === undefined || draftSession === undefined) return agentRunUnavailable();
      if (parsed.mutation.kind === "set_active_resource") {
        if (parsed.mutation.ref?.kind === "project_file") {
          const verified = await verifyCreativeGeneralProof(parsed, parsed.mutation.ref);
          if (verified !== undefined && !verified.ok) return verified;
        }
        if (parsed.mutation.ref === null)
          options.creativeGeneralActiveResourceProof?.clearResource();
      }
      return draftSession.updateContextDraft(parsed);
    },
    "application:agent-run:refresh-context-draft": (command: unknown) => {
      const parsed = toRefreshContextDraftCommand(command);
      const draftSession = currentAgentRunDraftSession();
      return parsed === undefined || draftSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : draftSession.refreshContextDraft(parsed);
    },
    "application:agent-run:preview-context-budget": (command: unknown) => {
      const parsed = toPreviewContextBudgetCommand(command);
      const contextSession = currentAgentContextSession();
      return parsed === undefined || contextSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : contextSession.previewContextBudget(parsed);
    },
    "application:agent-run:preview-packed-context": (command: unknown) => {
      const parsed = toPreviewContextBudgetCommand(command);
      const contextSession = currentAgentContextSession();
      return parsed === undefined || contextSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : contextSession.previewPackedContext(parsed);
    },
    "application:agent-run:compact-context": (command: unknown) => {
      const parsed = toCompactContextCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.compactContext(parsed);
    },
    "application:agent-run:start": (command: unknown) => {
      const parsed = toStartAgentRunCommand(command);
      const session = currentAgentRunSession();
      if (parsed === undefined || session === undefined) {
        return Promise.resolve(agentRunUnavailable());
      }
      if (asPreviewCapableRuntime(activeAgentRuntime()) !== undefined) {
        return Promise.resolve(agentSendPreviewRequired());
      }
      const manager = options.agentRuntimeManager;
      if (manager === undefined) return session.startAgentRun(parsed);

      const lease = manager.acquireActiveRunStartLease();
      if (!lease.ok) return Promise.resolve(lease);
      try {
        return lease.value.session.startAgentRun(parsed).finally(lease.value.release);
      } catch (error) {
        lease.value.release();
        return Promise.reject(error);
      }
    },
    "application:agent-run:stop": (command: unknown) => {
      const parsed = toStopAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.stopAgentRun(parsed);
    },
    "application:agent-run:answer-user-input": (command: unknown) => {
      const parsed = toAnswerAgentUserInputCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.answerUserInput(parsed);
    },
    "application:agent-run:resume": (command: unknown) => {
      const parsed = toResumeAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.resumeAgentRun(parsed);
    },
    "application:agent-run:retry-step": (command: unknown) => {
      const parsed = toRetryAgentRunStepCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.retryStep(parsed);
    },
    "application:agent-run:retry-target": (command: unknown) => {
      const parsed = toRetryRunTargetCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.retryRunTarget(parsed);
    },
    "application:agent-run:decide-plan": async (command: unknown) => {
      const parsed = toDecideAgentPlanCommand(command);
      const session = currentAgentRunSession();
      if (parsed === undefined || session === undefined) return agentRunUnavailable();
      const verified = await verifyCreativePlanApprovalContext(parsed, session);
      return verified === undefined || verified.ok ? session.decidePlan(parsed) : verified;
    },
    "application:agent-run:read-permission-summary": async (query: unknown) => {
      const parsed = toReadAgentPermissionSummaryQuery(query);
      const runtime = options.agentRuntimeManager?.current();
      const permissionSession = currentAgentPermissionSession();
      if (
        parsed === undefined ||
        runtime === undefined ||
        permissionSession === undefined ||
        parsed.projectId !== runtime.workspaceId
      ) {
        return invalidAgentRunCommand();
      }
      if (parsed.kind === "run") {
        return permissionSession.readForRun({
          runId: parsed.runId,
          permissionSummaryId: parsed.permissionSummaryId
        });
      }
      const draftSession = currentAgentRunDraftSession();
      if (draftSession === undefined) return agentRunUnavailable();
      const draft = await draftSession.resolveStartDraft({
        projectId: parsed.projectId,
        conversationId: parsed.conversationId,
        runDraftId: parsed.runDraftId,
        runDraftRevision: parsed.runDraftRevision,
        runDraftChecksum: parsed.runDraftChecksum
      });
      if (!draft.ok) return draft;
      return permissionSession.prepareForDraft({
        projectId: parsed.projectId,
        runDraftId: draft.value.runDraft.runDraftId,
        runDraftRevision: draft.value.runDraft.revision,
        operationMode: draft.value.runDraft.operationMode,
        contextMode: draft.value.runDraft.contextMode,
        writePolicy: draft.value.runDraft.writePolicy
      });
    },
    "application:agent-run:decide-plan-revision": (command: unknown) => {
      const parsed = toDecidePlanRevisionCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decidePlanRevision(parsed);
    },
    "application:agent-run:refresh-context": (command: unknown) => {
      const parsed = toRefreshAgentContextCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.refreshContext(parsed);
    },
    "application:agent-run:decide-change-set": (command: unknown) => {
      const parsed = toDecideChangeSetCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decideChangeSet(parsed);
    },
    "application:agent-run:decide-tool-approval": (command: unknown) => {
      const parsed = toDecideToolApprovalCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decideToolApproval(parsed);
    },
    "application:agent-run:decide-context-share-approval": (command: unknown) => {
      const parsed = toDecideContextShareApprovalCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.decideContextShareApproval(parsed);
    },
    "application:agent-run:undo": (command: unknown) => {
      const parsed = toUndoAgentRunCommand(command);
      const session = currentAgentRunSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(invalidAgentRunCommand())
        : session.undoRun(parsed);
    },
    "application:agent-run:read": (runId: unknown) => {
      const session = currentAgentRunSession();
      return typeof runId !== "string" || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.readAgentRun(runId);
    },
    "application:agent-run:list": (identity: unknown) => {
      const session = currentAgentRunSession();
      const scope = toAgentScopeIdentity(identity);
      return scope === undefined || session === undefined
        ? Promise.resolve(agentRunUnavailable())
        : session.listAgentRuns(scope.scope ?? scope.projectId ?? "");
    },
    "application:agent-conversation:create": (command: unknown) => {
      const parsed = toCreateAgentConversationCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.createConversation(parsed);
    },
    "application:agent-conversation:list": (query: unknown) => {
      const parsed = toListAgentConversationsQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.listConversations(parsed);
    },
    "application:agent-conversation:read": (query: unknown) => {
      const parsed = toReadAgentConversationQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.readConversation(parsed);
    },
    "application:agent-conversation:archive": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.archiveConversation(parsed);
    },
    "application:agent-conversation:restore": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.restoreConversation(parsed);
    },
    "application:agent-conversation:delete": (command: unknown) => {
      const parsed = toChangeAgentConversationStatusCommand(command);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.deleteConversation(parsed);
    },
    "application:agent-conversation:search": (query: unknown) => {
      const parsed = toSearchAgentConversationsQuery(query);
      const session = currentAgentConversationSession();
      return parsed === undefined || session === undefined
        ? Promise.resolve(err(agentConversationUnavailable()))
        : session.searchConversations(parsed);
    },
    "application:chapter:load": () => application.loadActiveChapter(),
    "application:chapter:edit": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return application.editActiveChapter("");
      }

      return application.editActiveChapter(nextBody);
    },
    "application:chapter:save": () =>
      saveActiveChapterWithCoordinator(application, options.agentWriteSaveCoordinator),
    "application:chapter:set-status": (status: unknown) => {
      const parsedStatus = toChapterStatusForIpc(status);
      return parsedStatus === undefined
        ? Promise.resolve(chapterStatusInputInvalid())
        : saveActiveChapterStatusWithCoordinator(
            application,
            options.agentWriteSaveCoordinator,
            parsedStatus
          );
    },
    "application:chapter:list-versions": () => application.listActiveChapterVersions(),
    "application:chapter:preview-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.previewActiveChapterVersion("");
      }

      return application.previewActiveChapterVersion(versionId);
    },
    "application:chapter:restore-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.restoreActiveChapterVersion("");
      }

      return application.restoreActiveChapterVersion(versionId);
    },
    "application:chapter:preview-suggestion-diff": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return Promise.resolve(application.previewActiveChapterSuggestionDiff(""));
      }

      return Promise.resolve(application.previewActiveChapterSuggestionDiff(nextBody));
    },
    "application:writing-editor:report-state": (input: unknown) => {
      const report = toWritingEditorStateReport(input);
      if (report === undefined) {
        return Promise.resolve(
          writingEditorStateError(
            "EDITOR_STATE_INPUT_INVALID",
            "Invalid writing editor state report."
          )
        );
      }
      const registry = options.writingEditorStateRegistry;
      const activeWorkspaceId = options.getActiveWritingEditorWorkspaceId?.();
      if (registry === undefined || activeWorkspaceId === undefined) {
        return Promise.resolve(
          writingEditorStateError(
            "EDITOR_STATE_UNAVAILABLE",
            "Writing editor state tracking is unavailable for this workspace."
          )
        );
      }
      if (report.workspaceId !== activeWorkspaceId) {
        return Promise.resolve(
          writingEditorStateError(
            "EDITOR_STATE_WORKSPACE_MISMATCH",
            "Writing editor state does not belong to the active workspace."
          )
        );
      }
      const updated = registry.report(report);
      if (!updated.ok) return Promise.resolve({ ok: false, error: updated.error });
      return Promise.resolve({
        ok: true,
        acknowledgement: {
          workspaceId: updated.state.workspaceId,
          resourceKind: updated.state.resourceKind,
          resourceId: updated.state.resourceId,
          editorInstanceId: updated.state.editorInstanceId,
          rendererRevision: updated.state.rendererRevision
        }
      } satisfies WritingEditorStateReportResult);
    },
    "application:engineering-editor:report-state": (input: unknown) => {
      const report = toEngineeringEditorStateReport(input);
      if (report === undefined) {
        return Promise.resolve(
          engineeringEditorStateError(
            "EDITOR_STATE_INPUT_INVALID",
            "Invalid engineering editor state report."
          )
        );
      }
      const registry = options.engineeringEditorStateRegistry;
      const activeRootBindingId = options.getActiveEngineeringEditorRootBindingId?.();
      if (registry === undefined || activeRootBindingId === undefined) {
        return Promise.resolve(
          engineeringEditorStateError(
            "EDITOR_STATE_UNAVAILABLE",
            "Engineering editor state tracking is unavailable for this workspace."
          )
        );
      }
      if (report.rootBindingId !== activeRootBindingId) {
        return Promise.resolve(
          engineeringEditorStateError(
            "EDITOR_STATE_ROOT_BINDING_MISMATCH",
            "Engineering editor state does not belong to the active workspace root."
          )
        );
      }
      const updated = registry.report(report);
      if (!updated.ok) return Promise.resolve({ ok: false, error: updated.error });
      return Promise.resolve({
        ok: true,
        acknowledgement: {
          rootBindingId: updated.state.rootBindingId,
          relativePath: updated.state.relativePath,
          editorInstanceId: updated.state.editorInstanceId,
          rendererRevision: updated.state.rendererRevision
        }
      } satisfies EngineeringEditorStateReportResult);
    },
    "application:settings:list-model-profiles": () => application.listModelProfiles(),
    "application:settings:discover-models": (
      profileId: unknown,
      options: unknown,
      profileOverride: unknown
    ) => {
      const discoveryOptions =
        isRecord(options) &&
        hasOnlyKeys(options, ["forceRefresh"]) &&
        (options["forceRefresh"] === undefined || typeof options["forceRefresh"] === "boolean")
          ? options
          : {};
      if (typeof profileId !== "string") {
        return application.discoverModelOptions(
          "",
          discoveryOptions,
          optionalModelProfileFromIpc(profileOverride)
        );
      }

      return application.discoverModelOptions(
        profileId,
        discoveryOptions,
        optionalModelProfileFromIpc(profileOverride)
      );
    },
    "application:settings:save-model-profile": (profile: unknown, options: unknown) => {
      const modelProfile = toModelProfile(profile);
      if (modelProfile === undefined) {
        return application.saveModelProfile(emptyModelProfile(), {});
      }

      return application.saveModelProfile(
        modelProfile,
        isSaveModelProfileOptions(options) ? options : {}
      );
    },
    "application:settings:save-model-secret": (secretRef: unknown, secret: unknown) => {
      if (options.modelSecretStore === undefined) {
        return Promise.resolve(
          err(
            createUnifiedError({
              code: "MODEL_SECRET_STORE_UNAVAILABLE",
              category: "StorageError",
              message: "No model secret store is configured.",
              recoverability: "user-action",
              suggestedAction: "Run the desktop app with Electron safeStorage enabled.",
              traceId: "desktop-ipc-handlers"
            })
          )
        );
      }
      if (typeof secretRef !== "string" || typeof secret !== "string") {
        return options.modelSecretStore.saveSecret("", "");
      }

      const saved = options.modelSecretStore.saveSecret(secretRef, secret);
      return secretRef.startsWith("secret://agent-network/")
        ? notifyAgentSettingsChanged(saved)
        : saved;
    },
    "application:settings:test-model-profile": (profileId: unknown, profileOverride: unknown) => {
      if (typeof profileId !== "string") {
        return application.testModelProfileConnection(
          "",
          optionalModelProfileFromIpc(profileOverride)
        );
      }

      return application.testModelProfileConnection(
        profileId,
        optionalModelProfileFromIpc(profileOverride)
      );
    },
    "application:settings:read-story-analysis": () => application.readStoryAnalysisSettings(),
    "application:settings:save-story-analysis": (value: unknown) => {
      const settings = toStoryAnalysisSettingsForIpc(value);
      return settings === undefined
        ? Promise.resolve(storyAnalysisSettingsInputInvalid())
        : application.saveStoryAnalysisSettings(settings);
    },
    "application:settings:list-agent-usage": (query: unknown) =>
      application.listAgentUsage(query as AgentUsageQuery),
    "application:settings:clear-agent-usage": (command: unknown) =>
      application.clearAgentUsage(command as ClearAgentUsageCommand),
    "application:plugins:load-registry": () => application.loadPluginRegistry(),
    "application:plugins:set-enabled": (pluginId: unknown, enabled: unknown) => {
      if (typeof pluginId !== "string" || typeof enabled !== "boolean") {
        return application.setPluginEnabled("", false);
      }

      return application.setPluginEnabled(pluginId, enabled);
    },
    "application:story-bible:load": () => application.loadStoryBible(),
    "application:story-bible:read-asset": (assetId: unknown) =>
      typeof assetId === "string" && assetId.length > 0 && assetId.trim() === assetId
        ? application.readStoryBibleAssetForEditing(assetId)
        : Promise.resolve(storyBibleIpcInputInvalid()),
    "application:story-bible:create-asset": (input: unknown) => {
      const command = toCreateStoryBibleAssetCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.createStoryBibleAsset(command);
    },
    "application:story-bible:save-asset-candidate": (input: unknown) => {
      const command = toSaveStoryBibleAssetCandidateCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.saveStoryBibleAssetCandidate(command);
    },
    "application:story-bible:prepare-explicit-inverse-change": (input: unknown) => {
      const command = toPrepareStoryBibleExplicitInverseCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.prepareStoryBibleExplicitInverseChange(command);
    },
    "application:story-bible:apply-explicit-inverse-change": (input: unknown) => {
      const command = toApplyStoryBibleExplicitInverseCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.applyStoryBibleExplicitInverseChange(command);
    },
    "application:story-bible:cancel-explicit-inverse-change": (input: unknown) => {
      const command = toExplicitInverseReceiptCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.cancelStoryBibleExplicitInverseChange(command);
    },
    "application:story-bible:save-status-transition": (input: unknown) => {
      const command = toSaveStoryBibleStatusTransitionCommand(input);
      return command === undefined
        ? Promise.resolve(storyBibleIpcInputInvalid())
        : application.saveStoryBibleStatusTransition(command);
    },
    "application:story-bible:get-references": (assetId: unknown) =>
      typeof assetId === "string" && assetId.length > 0 && assetId.trim() === assetId
        ? application.getStoryBibleReferences(assetId)
        : Promise.resolve(storyBibleIpcInputInvalid()),
    "application:story-bible:resolve-restore-status": (assetId: unknown) =>
      typeof assetId === "string" && assetId.length > 0 && assetId.trim() === assetId
        ? application.resolveStoryBibleRestoreStatus(assetId)
        : Promise.resolve(storyBibleIpcInputInvalid()),
    "application:story-bible:save-asset": (asset: unknown) => {
      const storyBibleAsset = toStoryBibleAsset(asset);
      if (storyBibleAsset === undefined) {
        return application.saveStoryBibleAsset(emptyStoryBibleAsset());
      }

      return application.saveStoryBibleAsset(storyBibleAsset);
    },
    "application:story-bible:save-memory": (memory: unknown) => {
      const storyBibleMemory = toMemoryRecord(memory);
      if (storyBibleMemory === undefined) {
        return application.saveStoryBibleMemory(emptyMemoryRecord());
      }

      return application.saveStoryBibleMemory(storyBibleMemory);
    },
    "application:story-bible:build-consistency-report": () =>
      application.buildStoryBibleConsistencyReport(),
    "application:story-bible:build-context-candidates": (options: unknown) =>
      application.buildStoryBibleContextCandidates(toStoryBibleContextCandidateOptions(options)),
    "application:story-bible:detect-foreshadows": async (input: unknown) => {
      const analysisInput = toForeshadowAnalysisInput(input);
      if (analysisInput === undefined) {
        return foreshadowScanInputInvalid();
      }

      let result: Awaited<ReturnType<DesktopApplication["detectForeshadows"]>>;
      try {
        result = await application.detectForeshadows(analysisInput);
      } catch {
        return foreshadowScanApplicationError(undefined);
      }
      if (!result.ok) {
        return foreshadowScanApplicationError(result.error);
      }
      const dto = toForeshadowAnalysisResultDto(result.value, analysisInput.chapterIds);
      return dto === undefined ? foreshadowScanIpcResultInvalid() : ok(dto);
    },
    "application:story-analysis:analyze": async (input: unknown) => {
      const analysisInput = toStoryAnalysisAnalyzeInput(input);
      if (analysisInput === undefined) return storyAnalysisInputInvalid();
      return storyAnalysisRecordIpcResult(() =>
        application.analyzeChapterStory({
          chapterId: analysisInput.chapterId,
          trigger: "manual"
        })
      );
    },
    "application:story-analysis:list": async (input: unknown = undefined) => {
      if (input !== undefined) return storyAnalysisInputInvalid();
      return storyAnalysisListIpcResult(() => application.listStoryAnalyses());
    },
    "application:story-analysis:read": async (workflowRunId: unknown) => {
      const parsedWorkflowRunId = toStoryAnalysisWorkflowRunId(workflowRunId);
      if (parsedWorkflowRunId === undefined) return storyAnalysisInputInvalid();
      return storyAnalysisRecordIpcResult(() => application.readStoryAnalysis(parsedWorkflowRunId));
    },
    "application:story-analysis:transition": async (input: unknown) => {
      const command = toStoryAnalysisReviewCommand(input);
      if (command === undefined) return storyAnalysisInputInvalid();
      const transition =
        command.transition.status === "resolved"
          ? {
              status: "resolved" as const,
              decision: command.transition.decision,
              changeSetId: null,
              actor: "author" as const
            }
          : command.transition;
      return storyAnalysisRecordIpcResult(() =>
        application.transitionStoryAnalysisRecord({
          workflowRunId: command.workflowRunId,
          recordId: command.recordId,
          expectedRevision: command.expectedRevision,
          transition
        })
      );
    },
    "application:story-analysis:refresh-staleness": async (workflowRunId: unknown) => {
      const parsedWorkflowRunId = toStoryAnalysisWorkflowRunId(workflowRunId);
      if (parsedWorkflowRunId === undefined) return storyAnalysisInputInvalid();
      return storyAnalysisRecordIpcResult(() =>
        application.refreshStoryAnalysisStaleness(parsedWorkflowRunId)
      );
    },
    "application:story-analysis:prepare-application": async (input: unknown) => {
      const command = toStoryAnalysisPrepareApplicationInput(input);
      if (command === undefined) return storyAnalysisInputInvalid();
      return storyAnalysisApplicationPreviewIpcResult(() =>
        application.prepareStoryAnalysisApplication(command)
      );
    },
    "application:story-analysis:apply-application": async (input: unknown) => {
      const command = toStoryAnalysisApplyApplicationInput(input);
      if (command === undefined) return storyAnalysisInputInvalid();
      return storyAnalysisApplicationResultIpcResult(() =>
        application.applyStoryAnalysisApplication(command)
      );
    },
    "application:studio:load-config-asset": (assetType: unknown, assetId: unknown) => {
      if (!isConfigAssetType(assetType) || typeof assetId !== "string") {
        return application.loadConfigAsset("prompt", "");
      }

      return application.loadConfigAsset(assetType, assetId);
    },
    "application:studio:save-config-asset": (input: unknown) => {
      const saveInput = toConfigAssetSaveInput(input);
      if (saveInput === undefined) {
        return application.saveConfigAsset({
          assetType: "prompt",
          assetId: "",
          content: {}
        });
      }

      return application.saveConfigAsset(saveInput);
    },
    "application:studio:restore-config-version": (input: unknown) => {
      const restoreInput = toConfigAssetRestoreInput(input);
      if (restoreInput === undefined) {
        return application.restoreConfigAssetVersion({
          assetType: "prompt",
          assetId: "",
          versionId: ""
        });
      }

      return application.restoreConfigAssetVersion(restoreInput);
    },
    "application:preferences:load": () => application.loadUserPreferences(),
    "application:preferences:save": (input: unknown) =>
      application.saveUserPreferences(toUserPreferencesSaveInput(input)),
    "application:agent-network:get-settings": () =>
      options.agentNetworkSettingsSession?.getNetworkSettings() ??
      Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS)),
    "application:agent-network:update-settings": (input: unknown) =>
      notifyAgentSettingsChanged(
        options.agentNetworkSettingsSession?.updateNetworkSettings(
          isRecord(input) ? (input as Partial<AgentNetworkSettingsData>) : {}
        ) ?? Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS))
      ),
    "application:agent-network:save-provider": (input: unknown) =>
      notifyAgentSettingsChanged(
        options.agentNetworkSettingsSession?.saveProviderProfile(
          (isRecord(input) ? input : {}) as Omit<AgentNetworkProviderProfile, "policyRevision">
        ) ?? Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS))
      ),
    "application:agent-network:remove-provider": (providerId: unknown) =>
      notifyAgentSettingsChanged(
        options.agentNetworkSettingsSession?.removeProviderProfile(
          typeof providerId === "string" ? providerId : ""
        ) ?? Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS))
      ),
    "application:agent-network:set-default-provider": (providerId: unknown) =>
      notifyAgentSettingsChanged(
        options.agentNetworkSettingsSession?.setDefaultProvider(
          typeof providerId === "string" ? providerId : ""
        ) ?? Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS))
      ),
    "application:agent-network:test-connection": (profileId: unknown) =>
      options.agentNetworkSettingsSession?.testConnection(
        typeof profileId === "string" ? profileId : ""
      ) ??
      Promise.resolve(
        err(
          createUnifiedError({
            code: "NETWORK_SETTINGS_UNAVAILABLE",
            category: "ValidationError",
            message: "Network settings are not available.",
            recoverability: "user-action",
            suggestedAction: "Enable agent network access in settings.",
            traceId: "ipc-handlers"
          })
        )
      ),
    "application:agent-network:revoke": () =>
      notifyAgentSettingsChanged(
        options.agentNetworkSettingsSession?.revokeNetworkAccess() ??
          Promise.resolve(ok(DEFAULT_NETWORK_SETTINGS))
      ),
    "application:agent-mcp:list-servers": () =>
      options.agentMcpSettingsSession?.listServers() ?? Promise.resolve(ok([])),
    "application:agent-mcp:add-server": (input: unknown) =>
      notifyAgentSettingsChanged(
        isRecord(input)
          ? (options.agentMcpSettingsSession?.addServer(input as unknown as McpServerConfig) ??
              Promise.resolve(ok(DEFAULT_MCP_SETTINGS)))
          : Promise.resolve(ok(DEFAULT_MCP_SETTINGS))
      ),
    "application:agent-mcp:remove-server": (serverId: unknown) =>
      notifyAgentSettingsChanged(
        options.agentMcpSettingsSession?.removeServer(
          typeof serverId === "string" ? serverId : ""
        ) ?? Promise.resolve(ok(DEFAULT_MCP_SETTINGS))
      ),
    "application:agent-mcp:test-connection": (serverId: unknown) =>
      options.agentMcpSettingsSession?.testConnection(
        typeof serverId === "string" ? serverId : ""
      ) ??
      Promise.resolve(
        err(
          createUnifiedError({
            code: "MCP_SETTINGS_UNAVAILABLE",
            category: "ValidationError",
            message: "MCP settings are not available.",
            recoverability: "user-action",
            suggestedAction: "Configure a remote MCP server first.",
            traceId: "ipc-handlers"
          })
        )
      ),
    "application:agent-mcp:revoke-server": (serverId: unknown) =>
      notifyAgentSettingsChanged(
        options.agentMcpSettingsSession?.revokeServer(
          typeof serverId === "string" ? serverId : ""
        ) ?? Promise.resolve(ok(DEFAULT_MCP_SETTINGS))
      ),
    "application:agent-tasks:list": (projectId: unknown) =>
      options.agentTaskCatalogPort?.listAuthorizedTasks(
        typeof projectId === "string" ? projectId : ""
      ) ?? Promise.resolve(ok([])),
    "application:agent-tasks:revoke": (input: unknown) => {
      if (
        isRecord(input) &&
        typeof input["projectId"] === "string" &&
        typeof input["taskId"] === "string"
      ) {
        return notifyAgentSettingsChanged(
          options.agentTaskCatalogPort?.revokeTask(input["projectId"], input["taskId"]) ??
            Promise.resolve(ok(undefined))
        );
      }
      return Promise.resolve(ok(undefined));
    }
  };
}

function toStartAgentRunCommand(value: unknown): StartAgentRunCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  // Draft-only by contract: the renderer may submit only a reference to a persisted run draft. Mode,
  // model, capabilities, the user request, and context sources are resolved server-side by the start
  // preflight — the renderer cannot author any of them. Reject the pre-Stage-5 wide field set.
  if (
    !hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "expectedRunRevision",
      "runDraftId",
      "runDraftRevision",
      "runDraftChecksum",
      "packedContextId",
      "packedContextPayloadChecksum",
      "limits",
      "sourcePlanId",
      "sourcePlanRevision"
    ]) ||
    identity === undefined ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    value["expectedRunRevision"] !== 0 ||
    !isSafeId(value["runDraftId"]) ||
    !isPositiveInteger(value["runDraftRevision"]) ||
    !isNonEmptyString(value["runDraftChecksum"]) ||
    !isSafeId(value["packedContextId"]) ||
    !isSha256Checksum(value["packedContextPayloadChecksum"]) ||
    (value["limits"] !== undefined && !isRecord(value["limits"])) ||
    (value["sourcePlanId"] !== undefined && !isSafeId(value["sourcePlanId"])) ||
    (value["sourcePlanRevision"] !== undefined && !isPositiveInteger(value["sourcePlanRevision"]))
  ) {
    return undefined;
  }
  return { ...value, ...identity } as unknown as StartAgentRunCommand;
}

function toPrepareAgentSendPreviewCommand(
  value: unknown
): PrepareAgentSendPreviewCommand | undefined {
  if (!isRecord(value) || value["schemaVersion"] !== "2.0") return undefined;
  if (!hasOnlyKeys(value, ["schemaVersion", "commandId", "startCommand"])) return undefined;
  if (!isSafeId(value["commandId"])) return undefined;
  const startCommand = toStartAgentRunCommand(value["startCommand"]);
  return startCommand === undefined
    ? undefined
    : { schemaVersion: "2.0", commandId: value["commandId"], startCommand };
}

function toConfirmAgentSendPreviewCommand(
  value: unknown
): ConfirmAgentSendPreviewCommandV2 | undefined {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== "2.0" ||
    !hasOnlyKeys(value, ["schemaVersion", "previewId", "canonicalPayloadChecksum"]) ||
    !isSafeId(value["previewId"]) ||
    !isSha256Checksum(value["canonicalPayloadChecksum"])
  ) {
    return undefined;
  }
  return {
    schemaVersion: "2.0",
    previewId: value["previewId"],
    canonicalPayloadChecksum: value["canonicalPayloadChecksum"]
  };
}

function toReadAgentSendLedgerRunId(value: unknown): string | undefined {
  return isSafeId(value) ? value : undefined;
}

function asPreviewCapableRuntime(value: unknown): PreviewCapableRuntimeServices | undefined {
  if (!isRecord(value)) return undefined;
  const runtime = value as Partial<PreviewCapableRuntimeServices>;
  return typeof runtime.prepareAgentSendPreview === "function" &&
    typeof runtime.confirmAgentSendPreview === "function"
    ? (runtime as PreviewCapableRuntimeServices)
    : undefined;
}

function toSyncStartDraftCommand(value: unknown): SyncStartDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  // Intent = user choices only. Provider, model capabilities, context window, and document content
  // are never accepted here; the start preflight resolves them server-side from the persisted draft.
  if (
    !hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "userRequest",
      "operationMode",
      "contextMode",
      "writePolicy",
      "writePolicyAcknowledged",
      "executionWritePolicyDraft",
      "modelProfileId",
      "modelName",
      "reasoningEffort",
      "contextRefs",
      "activeResourceRef",
      "writingComposerAction",
      "writingUserConfirmedKind"
    ]) ||
    identity === undefined ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    typeof value["userRequest"] !== "string" ||
    (value["operationMode"] !== "conversation" &&
      value["operationMode"] !== "planning" &&
      value["operationMode"] !== "execution") ||
    (value["contextMode"] !== "standalone_chat" &&
      value["contextMode"] !== "writing" &&
      value["contextMode"] !== "general_file") ||
    value["writePolicy"] !== "write_before_confirmation" ||
    value["writePolicyAcknowledged"] !== false ||
    (value["executionWritePolicyDraft"] !== undefined &&
      value["executionWritePolicyDraft"] !== "write_before_confirmation" &&
      value["executionWritePolicyDraft"] !== "user_preapproved_run") ||
    !isNonEmptyString(value["modelProfileId"]) ||
    (value["modelName"] !== undefined && !isNonEmptyString(value["modelName"])) ||
    (value["reasoningEffort"] !== undefined && !isNonEmptyString(value["reasoningEffort"])) ||
    (value["writingComposerAction"] !== undefined &&
      value["writingComposerAction"] !== "analysis" &&
      value["writingComposerAction"] !== "brainstorm" &&
      value["writingComposerAction"] !== "continue" &&
      value["writingComposerAction"] !== "rewrite" &&
      value["writingComposerAction"] !== "story_bible") ||
    (value["writingUserConfirmedKind"] !== undefined &&
      value["writingUserConfirmedKind"] !== "analysis" &&
      value["writingUserConfirmedKind"] !== "brainstorm" &&
      value["writingUserConfirmedKind"] !== "continue" &&
      value["writingUserConfirmedKind"] !== "rewrite" &&
      value["writingUserConfirmedKind"] !== "story_bible") ||
    !Array.isArray(value["contextRefs"]) ||
    (value["activeResourceRef"] !== undefined &&
      value["activeResourceRef"] !== null &&
      !isActiveResourceContextRef(value["activeResourceRef"])) ||
    !activeResourceMatchesContextMode(value["activeResourceRef"], value["contextMode"])
  ) {
    return undefined;
  }
  if (!agentDraftModeMatchesScope(identity, value)) return undefined;
  return { ...value, ...identity } as unknown as SyncStartDraftCommand;
}

function toReadAgentRunDraftCommand(value: unknown): ReadAgentRunDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    !hasOnlyKeys(value, ["scope", "projectId", "conversationId", "initialize"]) ||
    identity === undefined ||
    !isSafeId(value["conversationId"]) ||
    !isRecord(value["initialize"])
  ) {
    return undefined;
  }
  const initialize = value["initialize"];
  if (
    !hasOnlyKeys(initialize, [
      "modelProfileId",
      "modelName",
      "reasoningEffort",
      "operationMode",
      "contextMode",
      "writePolicy",
      "writePolicyAcknowledged",
      "executionWritePolicyDraft",
      "contextRefs",
      "activeResourceRef"
    ]) ||
    !isNonEmptyString(initialize["modelProfileId"]) ||
    (initialize["modelName"] !== undefined && !isNonEmptyString(initialize["modelName"])) ||
    (initialize["reasoningEffort"] !== undefined &&
      !isNonEmptyString(initialize["reasoningEffort"])) ||
    (initialize["operationMode"] !== "conversation" &&
      initialize["operationMode"] !== "planning" &&
      initialize["operationMode"] !== "execution") ||
    (initialize["contextMode"] !== "standalone_chat" &&
      initialize["contextMode"] !== "writing" &&
      initialize["contextMode"] !== "general_file") ||
    initialize["writePolicy"] !== "write_before_confirmation" ||
    (initialize["writePolicyAcknowledged"] !== undefined &&
      initialize["writePolicyAcknowledged"] !== false) ||
    (initialize["executionWritePolicyDraft"] !== undefined &&
      initialize["executionWritePolicyDraft"] !== "write_before_confirmation" &&
      initialize["executionWritePolicyDraft"] !== "user_preapproved_run") ||
    (initialize["contextRefs"] !== undefined && !Array.isArray(initialize["contextRefs"])) ||
    (initialize["activeResourceRef"] !== undefined &&
      initialize["activeResourceRef"] !== null &&
      !isActiveResourceContextRef(initialize["activeResourceRef"])) ||
    !activeResourceMatchesContextMode(initialize["activeResourceRef"], initialize["contextMode"])
  ) {
    return undefined;
  }
  if (!agentDraftModeMatchesScope(identity, initialize)) return undefined;
  return { ...value, ...identity } as unknown as ReadAgentRunDraftCommand;
}

function toUpdateAgentRunDraftCommand(value: unknown): UpdateAgentRunDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    !hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "expectedDraftRevision",
      "mutation"
    ]) ||
    identity === undefined ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    !isPositiveInteger(value["expectedDraftRevision"]) ||
    !isAgentRunDraftMutation(value["mutation"])
  ) {
    return undefined;
  }
  if (identity.scope?.kind === "standalone" && !isStandaloneRunDraftMutation(value["mutation"])) {
    return undefined;
  }
  return { ...value, ...identity } as unknown as UpdateAgentRunDraftCommand;
}

function toUpdateContextDraftCommand(value: unknown): UpdateContextDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    !hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "contextDraftId",
      "expectedDraftRevision",
      "mutation"
    ]) ||
    identity === undefined ||
    !isSafeId(value["conversationId"]) ||
    !isSafeId(value["commandId"]) ||
    !isSafeId(value["contextDraftId"]) ||
    !isPositiveInteger(value["expectedDraftRevision"]) ||
    !isContextDraftMutation(value["mutation"])
  ) {
    return undefined;
  }
  if (identity.scope?.kind === "standalone") return undefined;
  return { ...value, ...identity } as unknown as UpdateContextDraftCommand;
}

function toRefreshContextDraftCommand(value: unknown): RefreshContextDraftCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity !== undefined &&
    identity.scope?.kind !== "standalone" &&
    hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "contextDraftId",
      "expectedDraftRevision"
    ]) &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["contextDraftId"]) &&
    isPositiveInteger(value["expectedDraftRevision"])
    ? ({ ...value, ...identity } as unknown as RefreshContextDraftCommand)
    : undefined;
}

function toPreviewContextBudgetCommand(value: unknown): PreviewContextBudgetCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return hasOnlyKeys(value, [
    "scope",
    "projectId",
    "conversationId",
    "commandId",
    "runDraftId",
    "expectedDraftRevision",
    "runDraftChecksum"
  ]) &&
    identity !== undefined &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["runDraftId"]) &&
    isPositiveInteger(value["expectedDraftRevision"]) &&
    isNonEmptyString(value["runDraftChecksum"])
    ? ({ ...value, ...identity } as unknown as PreviewContextBudgetCommand)
    : undefined;
}

function toCompactContextCommand(value: unknown): CompactContextCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return hasOnlyKeys(value, [
    "scope",
    "projectId",
    "runId",
    "commandId",
    "expectedRunRevision",
    "contextBudgetSnapshotId",
    "trigger"
  ]) &&
    identity !== undefined &&
    isNonEmptyString(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    isNonEmptyString(value["contextBudgetSnapshotId"]) &&
    (value["trigger"] === "manual" ||
      value["trigger"] === "automatic" ||
      value["trigger"] === "recovery")
    ? ({ ...value, ...identity } as unknown as CompactContextCommand)
    : undefined;
}

function isAgentRunDraftMutation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "set_request":
      return typeof value["request"] === "string" && hasOnlyKeys(value, ["kind", "request"]);
    case "set_operation_mode":
      return (
        (value["operationMode"] === "planning" || value["operationMode"] === "execution") &&
        hasOnlyKeys(value, ["kind", "operationMode"])
      );
    case "set_context_mode":
      return (
        (value["contextMode"] === "writing" || value["contextMode"] === "general_file") &&
        hasOnlyKeys(value, ["kind", "contextMode"])
      );
    case "set_write_policy":
      return (
        value["writePolicy"] === "write_before_confirmation" &&
        value["acknowledged"] === false &&
        hasOnlyKeys(value, ["kind", "writePolicy", "acknowledged"])
      );
    case "set_execution_write_policy_draft":
      return (
        (value["policy"] === "write_before_confirmation" ||
          value["policy"] === "user_preapproved_run") &&
        hasOnlyKeys(value, ["kind", "policy"])
      );
    case "set_model":
      return (
        isNonEmptyString(value["modelProfileId"]) &&
        (value["modelName"] === undefined || isNonEmptyString(value["modelName"])) &&
        (value["reasoningEffort"] === undefined || isNonEmptyString(value["reasoningEffort"])) &&
        hasOnlyKeys(value, ["kind", "modelProfileId", "modelName", "reasoningEffort"])
      );
    case "set_reasoning":
      return (
        isNonEmptyString(value["reasoningEffort"]) &&
        hasOnlyKeys(value, ["kind", "reasoningEffort"])
      );
    default:
      return false;
  }
}

function isContextDraftMutation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "add_ref":
      return isRecord(value["ref"]) && hasOnlyKeys(value, ["kind", "ref"]);
    case "remove_ref":
      return isNonEmptyString(value["refId"]) && hasOnlyKeys(value, ["kind", "refId"]);
    case "set_selection":
      return (
        (value["ref"] === null || isRecord(value["ref"])) && hasOnlyKeys(value, ["kind", "ref"])
      );
    case "set_active_resource":
      return (
        (value["ref"] === null || isActiveResourceContextRef(value["ref"])) &&
        hasOnlyKeys(value, ["kind", "ref"])
      );
    case "set_source_override": {
      if (!isNonEmptyString(value["refId"])) return false;
      if (value["decision"] === null || value["decision"] === "automatic") {
        return hasOnlyKeys(value, ["kind", "refId", "decision"]);
      }
      return (
        (value["decision"] === "pinned" || value["decision"] === "excluded") &&
        isNonNegativeInteger(value["priority"]) &&
        value["priority"] <= 100 &&
        hasOnlyKeys(value, ["kind", "refId", "decision", "priority"])
      );
    }
    default:
      return false;
  }
}

function isStandaloneRunDraftMutation(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value["kind"]) {
    case "set_request":
    case "set_model":
    case "set_reasoning":
      return true;
    case "set_operation_mode":
      return value["operationMode"] === "conversation";
    case "set_context_mode":
      return value["contextMode"] === "standalone_chat";
    case "set_write_policy":
      return (
        value["writePolicy"] === "write_before_confirmation" && value["acknowledged"] === false
      );
    default:
      return false;
  }
}

function agentDraftModeMatchesScope(
  identity: AgentScopeIdentity,
  value: Record<string, unknown>
): boolean {
  if (identity.scope?.kind === "standalone") {
    return (
      value["operationMode"] === "conversation" &&
      value["contextMode"] === "standalone_chat" &&
      value["writePolicy"] === "write_before_confirmation" &&
      (value["writePolicyAcknowledged"] === undefined ||
        value["writePolicyAcknowledged"] === false) &&
      (value["contextRefs"] === undefined ||
        (Array.isArray(value["contextRefs"]) && value["contextRefs"].length === 0)) &&
      (value["activeResourceRef"] === undefined || value["activeResourceRef"] === null)
    );
  }
  return value["operationMode"] !== "conversation" && value["contextMode"] !== "standalone_chat";
}

function isProjectFileContextRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["kind", "refId", "relativePath", "label", "range", "expectedChecksum"]) &&
    value["kind"] === "project_file" &&
    isNonEmptyString(value["refId"]) &&
    typeof value["relativePath"] === "string" &&
    normalizeCreativeProjectFilePath(value["relativePath"], "file").ok &&
    isNonEmptyString(value["label"]) &&
    (value["expectedChecksum"] === undefined ||
      (typeof value["expectedChecksum"] === "string" &&
        /^[a-f0-9]{64}$/u.test(value["expectedChecksum"])))
  );
}

function isStoryBibleContextRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["kind", "refId", "assetId", "label"]) &&
    value["kind"] === "story_bible" &&
    isNonEmptyString(value["assetId"]) &&
    value["refId"] === `story_bible:${value["assetId"]}` &&
    isNonEmptyString(value["label"])
  );
}

function isActiveResourceContextRef(value: unknown): boolean {
  return isProjectFileContextRef(value) || isStoryBibleContextRef(value);
}

function activeResourceMatchesContextMode(value: unknown, contextMode: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (contextMode === "writing" && isStoryBibleContextRef(value)) ||
    (contextMode === "general_file" && isProjectFileContextRef(value))
  );
}

function toCreateAgentConversationCommand(
  value: unknown
): CreateAgentConversationCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity !== undefined &&
    hasOnlyKeys(value, ["scope", "projectId", "commandId"]) &&
    isSafeId(value["commandId"])
    ? { ...identity, commandId: value["commandId"] }
    : undefined;
}

function toListAgentConversationsQuery(value: unknown): ListAgentConversationsQuery | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    !hasOnlyKeys(value, ["scope", "projectId", "includeArchived", "cursor", "limit"]) ||
    identity === undefined ||
    (value["includeArchived"] !== undefined && typeof value["includeArchived"] !== "boolean") ||
    (value["cursor"] !== undefined && !isCursor(value["cursor"])) ||
    (value["limit"] !== undefined &&
      (!isPositiveInteger(value["limit"]) || Number(value["limit"]) > 100))
  ) {
    return undefined;
  }
  return {
    ...identity,
    ...(value["includeArchived"] === undefined
      ? {}
      : { includeArchived: value["includeArchived"] }),
    ...(value["cursor"] === undefined ? {} : { cursor: value["cursor"] }),
    ...(value["limit"] === undefined ? {} : { limit: value["limit"] })
  };
}

function toReadAgentConversationQuery(value: unknown): ReadAgentConversationQuery | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity !== undefined &&
    hasOnlyKeys(value, ["scope", "projectId", "conversationId"]) &&
    isSafeId(value["conversationId"])
    ? { ...identity, conversationId: value["conversationId"] }
    : undefined;
}

function toChangeAgentConversationStatusCommand(
  value: unknown
): ChangeAgentConversationStatusCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity !== undefined &&
    hasOnlyKeys(value, [
      "scope",
      "projectId",
      "conversationId",
      "commandId",
      "expectedConversationRevision"
    ]) &&
    isSafeId(value["conversationId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedConversationRevision"])
    ? {
        ...identity,
        conversationId: value["conversationId"],
        commandId: value["commandId"],
        expectedConversationRevision: value["expectedConversationRevision"]
      }
    : undefined;
}

function toSearchAgentConversationsQuery(
  value: unknown
): SearchAgentConversationsQuery | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["scope", "projectId", "query", "includeArchived", "cursor", "limit"]) ||
    typeof value["query"] !== "string" ||
    value["query"].length > 512
  ) {
    return undefined;
  }
  const list = toListAgentConversationsQuery({
    ...(value["scope"] === undefined ? {} : { scope: value["scope"] }),
    ...(value["projectId"] === undefined ? {} : { projectId: value["projectId"] }),
    ...(value["includeArchived"] === undefined
      ? {}
      : { includeArchived: value["includeArchived"] }),
    ...(value["cursor"] === undefined ? {} : { cursor: value["cursor"] }),
    ...(value["limit"] === undefined ? {} : { limit: value["limit"] })
  });
  return list === undefined ? undefined : { ...list, query: value["query"] };
}

function toStopAgentRunCommand(value: unknown): StopAgentRunCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity !== undefined &&
    hasOnlyKeys(value, ["runId", "scope", "projectId", "commandId", "expectedRunRevision"]) &&
    isNonEmptyString(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"])
    ? ({ ...value, ...identity } as unknown as StopAgentRunCommand)
    : undefined;
}

function toAnswerAgentUserInputCommand(value: unknown): AnswerAgentUserInputCommand | undefined {
  return isRecord(value) ? (value as unknown as AnswerAgentUserInputCommand) : undefined;
}

function toResumeAgentRunCommand(value: unknown): ResumeAgentRunCommand | undefined {
  return isRecord(value) ? (value as unknown as ResumeAgentRunCommand) : undefined;
}

function toRetryAgentRunStepCommand(value: unknown): RetryAgentRunStepCommand | undefined {
  return isRecord(value) ? (value as unknown as RetryAgentRunStepCommand) : undefined;
}

function toRetryRunTargetCommand(value: unknown): RetryRunTargetCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    identity?.projectId === undefined ||
    !hasOnlyKeys(value, [
      "runId",
      "scope",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "errorId",
      "target"
    ]) ||
    !isSafeId(value["runId"]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["commandId"]) ||
    !Number.isSafeInteger(value["expectedRunRevision"]) ||
    Number(value["expectedRunRevision"]) < 0 ||
    !isSafeId(value["errorId"]) ||
    !isRecord(value["target"]) ||
    !hasOnlyKeys(value["target"], ["kind", "id"]) ||
    !isOpaqueRetryTargetId(value["target"]["id"]) ||
    (value["target"]["kind"] !== "model_round" &&
      value["target"]["kind"] !== "tool_call" &&
      value["target"]["kind"] !== "checkpoint" &&
      value["target"]["kind"] !== "plan_step")
  ) {
    return undefined;
  }
  return { ...value, ...identity } as unknown as RetryRunTargetCommand;
}

function toDecideAgentPlanCommand(value: unknown): DecideAgentPlanCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  const projectId =
    identity?.projectId ??
    (identity?.scope?.kind === "workspace" ? identity.scope.workspaceId : undefined);
  if (
    identity === undefined ||
    projectId === undefined ||
    !hasOnlyKeys(value, [
      "scope",
      "projectId",
      "runId",
      "commandId",
      "expectedRunRevision",
      "planId",
      "planRevision",
      "decision",
      "executionContextMode"
    ]) ||
    !isSafeId(value["runId"]) ||
    !isSafeId(value["commandId"]) ||
    !isNonNegativeInteger(value["expectedRunRevision"]) ||
    !isSafeId(value["planId"]) ||
    !isPositiveInteger(value["planRevision"]) ||
    (value["decision"] !== "approve" && value["decision"] !== "reject") ||
    (value["executionContextMode"] !== undefined &&
      value["executionContextMode"] !== "writing" &&
      value["executionContextMode"] !== "general_file")
  ) {
    return undefined;
  }
  return {
    ...(identity.scope === undefined ? {} : { scope: identity.scope }),
    projectId,
    runId: value["runId"],
    commandId: value["commandId"],
    expectedRunRevision: value["expectedRunRevision"],
    planId: value["planId"],
    planRevision: value["planRevision"],
    decision: value["decision"],
    ...(value["executionContextMode"] === undefined
      ? {}
      : { executionContextMode: value["executionContextMode"] })
  } as DecideAgentPlanCommand;
}

function toReadAgentPermissionSummaryQuery(
  value: unknown
): ReadAgentPermissionSummaryQuery | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  const projectId =
    identity?.projectId ??
    (identity?.scope?.kind === "workspace" ? identity.scope.workspaceId : undefined);
  if (identity === undefined || projectId === undefined) return undefined;
  if (value["kind"] === "draft") {
    return hasOnlyKeys(value, [
      "kind",
      "scope",
      "projectId",
      "conversationId",
      "runDraftId",
      "runDraftRevision",
      "runDraftChecksum"
    ]) &&
      isSafeId(value["conversationId"]) &&
      isSafeId(value["runDraftId"]) &&
      isPositiveInteger(value["runDraftRevision"]) &&
      isNonEmptyString(value["runDraftChecksum"])
      ? ({ ...value, ...identity, projectId } as unknown as ReadAgentPermissionSummaryQuery)
      : undefined;
  }
  if (value["kind"] === "run") {
    return hasOnlyKeys(value, ["kind", "scope", "projectId", "runId", "permissionSummaryId"]) &&
      isSafeId(value["runId"]) &&
      isSafeId(value["permissionSummaryId"])
      ? ({ ...value, ...identity, projectId } as unknown as ReadAgentPermissionSummaryQuery)
      : undefined;
  }
  return undefined;
}

function toDecidePlanRevisionCommand(value: unknown): DecidePlanRevisionCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity?.projectId !== undefined &&
    hasOnlyKeys(value, [
      "runId",
      "scope",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "requestId",
      "planId",
      "planRevision",
      "decision"
    ]) &&
    isSafeId(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    isSafeId(value["requestId"]) &&
    isSafeId(value["planId"]) &&
    isPositiveInteger(value["planRevision"]) &&
    (value["decision"] === "approve" || value["decision"] === "reject")
    ? ({ ...value, ...identity } as unknown as DecidePlanRevisionCommand)
    : undefined;
}

function toRefreshAgentContextCommand(value: unknown): RefreshAgentContextCommand | undefined {
  return isRecord(value) ? (value as unknown as RefreshAgentContextCommand) : undefined;
}

function toDecideChangeSetCommand(value: unknown): DecideChangeSetCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (identity?.projectId === undefined) return undefined;
  const decision = value["decision"];
  const allowedKeys = new Set([
    "runId",
    "scope",
    "projectId",
    "commandId",
    "expectedRunRevision",
    "changeSetId",
    "revision",
    "checksum",
    "decision",
    "files",
    "operations"
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;
  if (
    !isNonEmptyString(value["runId"]) ||
    !isNonEmptyString(value["commandId"]) ||
    !isNonNegativeInteger(value["expectedRunRevision"]) ||
    !isNonEmptyString(value["changeSetId"]) ||
    !isPositiveInteger(value["revision"]) ||
    !isNonEmptyString(value["checksum"]) ||
    (decision !== "update_selection" && decision !== "apply_selected" && decision !== "reject_all")
  ) {
    return undefined;
  }
  if (
    decision !== "update_selection" &&
    (value["files"] !== undefined || value["operations"] !== undefined)
  ) {
    return undefined;
  }
  const files =
    decision === "update_selection" ? toChangeSetFileSelections(value["files"]) : undefined;
  const operations =
    decision === "update_selection"
      ? toChangeSetOperationSelections(value["operations"])
      : undefined;
  if (decision === "update_selection" && files === undefined) return undefined;
  const base = {
    ...identity,
    runId: value["runId"],
    projectId: identity.projectId,
    commandId: value["commandId"],
    expectedRunRevision: value["expectedRunRevision"],
    changeSetId: value["changeSetId"],
    revision: value["revision"],
    checksum: value["checksum"]
  };
  return decision === "update_selection"
    ? { ...base, decision, files: files ?? [], ...(operations === undefined ? {} : { operations }) }
    : { ...base, decision };
}

function toChangeSetOperationSelections(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const selections: Array<{ readonly operationId: string; readonly selected: boolean }> = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["operationId", "selected"]) ||
      !isNonEmptyString(entry["operationId"]) ||
      typeof entry["selected"] !== "boolean" ||
      seen.has(entry["operationId"])
    ) {
      return undefined;
    }
    seen.add(entry["operationId"]);
    selections.push({ operationId: entry["operationId"], selected: entry["selected"] });
  }
  return selections;
}

function toDecideToolApprovalCommand(value: unknown): DecideToolApprovalCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity?.projectId !== undefined &&
    hasOnlyKeys(value, [
      "runId",
      "scope",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "bindingId",
      "decision"
    ]) &&
    isSafeId(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["bindingId"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    (value["decision"] === "approve" || value["decision"] === "reject")
    ? ({ ...value, ...identity } as unknown as DecideToolApprovalCommand)
    : undefined;
}

function toDecideContextShareApprovalCommand(
  value: unknown
): DecideContextShareApprovalCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  return identity?.projectId !== undefined &&
    hasOnlyKeys(value, [
      "runId",
      "scope",
      "projectId",
      "commandId",
      "expectedRunRevision",
      "requestId",
      "approvalBinding",
      "decision"
    ]) &&
    isSafeId(value["runId"]) &&
    isSafeId(value["commandId"]) &&
    isSafeId(value["requestId"]) &&
    typeof value["approvalBinding"] === "string" &&
    /^[a-f0-9]{64}$/u.test(value["approvalBinding"]) &&
    isNonNegativeInteger(value["expectedRunRevision"]) &&
    (value["decision"] === "approve" || value["decision"] === "deny")
    ? ({ ...value, ...identity } as unknown as DecideContextShareApprovalCommand)
    : undefined;
}

function toChangeSetFileSelections(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const selections: Array<{
    readonly relativePath: string;
    readonly selected: boolean;
    readonly selectedHunkIds?: readonly string[];
  }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    if (
      Object.keys(entry).some(
        (key) => !["relativePath", "selected", "selectedHunkIds"].includes(key)
      )
    ) {
      return undefined;
    }
    const selectedHunkIds = entry["selectedHunkIds"];
    if (
      !isNonEmptyString(entry["relativePath"]) ||
      typeof entry["selected"] !== "boolean" ||
      (selectedHunkIds !== undefined &&
        (!Array.isArray(selectedHunkIds) || !selectedHunkIds.every(isNonEmptyString)))
    ) {
      return undefined;
    }
    selections.push({
      relativePath: entry["relativePath"],
      selected: entry["selected"],
      ...(selectedHunkIds === undefined ? {} : { selectedHunkIds })
    });
  }
  return selections;
}

function toUndoAgentRunCommand(value: unknown): UndoRunCommand | undefined {
  if (!isRecord(value)) return undefined;
  const identity = parseAgentScopeIdentity(value);
  if (
    identity?.projectId === undefined ||
    !isNonEmptyString(value["runId"]) ||
    !isNonEmptyString(value["commandId"]) ||
    !isNonNegativeInteger(value["expectedRunRevision"]) ||
    (value["action"] !== "request" && value["action"] !== "resolve")
  ) {
    return undefined;
  }
  const base = {
    ...identity,
    runId: value["runId"],
    projectId: identity.projectId,
    commandId: value["commandId"],
    expectedRunRevision: value["expectedRunRevision"]
  };
  if (value["action"] === "request") {
    return Object.keys(value).some(
      (key) =>
        !["action", "runId", "scope", "projectId", "commandId", "expectedRunRevision"].includes(key)
    )
      ? undefined
      : { ...base, action: "request" };
  }
  if (
    Object.keys(value).some(
      (key) =>
        ![
          "action",
          "runId",
          "scope",
          "projectId",
          "commandId",
          "expectedRunRevision",
          "reviewId",
          "decisions",
          "retryFailedOnly"
        ].includes(key)
    ) ||
    !isNonEmptyString(value["reviewId"]) ||
    (value["retryFailedOnly"] !== undefined && value["retryFailedOnly"] !== true)
  ) {
    return undefined;
  }
  const decisions = toRollbackReviewDecisions(value["decisions"]);
  if (decisions === undefined || (decisions.length === 0 && value["retryFailedOnly"] !== true)) {
    return undefined;
  }
  return {
    ...base,
    action: "resolve",
    reviewId: value["reviewId"],
    ...(decisions.length === 0 ? {} : { decisions }),
    ...(value["retryFailedOnly"] === true ? { retryFailedOnly: true } : {})
  };
}

function toRollbackReviewDecisions(
  value: unknown
):
  | { readonly relativePath: string; readonly decision: "keep_current" | "restore_baseline" }[]
  | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const decisions: {
    relativePath: string;
    decision: "keep_current" | "restore_baseline";
  }[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some((key) => !["relativePath", "decision"].includes(key)) ||
      !isNonEmptyString(entry["relativePath"]) ||
      (entry["decision"] !== "keep_current" && entry["decision"] !== "restore_baseline")
    ) {
      return undefined;
    }
    decisions.push({ relativePath: entry["relativePath"], decision: entry["decision"] });
  }
  return new Set(decisions.map((decision) => decision.relativePath)).size === decisions.length
    ? decisions
    : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

interface AgentScopeIdentity {
  readonly scope?: AgentContextScope;
  readonly projectId?: string;
}

function toAgentScopeIdentity(value: unknown): AgentScopeIdentity | undefined {
  if (typeof value === "string") return isSafeId(value) ? { projectId: value } : undefined;
  if (isExactAgentContextScope(value)) {
    return {
      scope:
        value.kind === "standalone"
          ? { kind: "standalone", scopeId: "standalone" }
          : {
              kind: "workspace",
              workspaceKind: value.workspaceKind,
              workspaceId: value.workspaceId
            }
    };
  }
  return isRecord(value) && hasOnlyKeys(value, ["scope", "projectId"])
    ? parseAgentScopeIdentity(value)
    : undefined;
}

function parseAgentScopeIdentity(value: Record<string, unknown>): AgentScopeIdentity | undefined {
  const rawScope = value["scope"];
  const rawProjectId = value["projectId"];
  if (rawScope === undefined && rawProjectId === undefined) return undefined;
  if (rawProjectId !== undefined && !isSafeId(rawProjectId)) return undefined;
  if (rawScope === undefined) return { projectId: rawProjectId as string };
  if (!isExactAgentContextScope(rawScope)) return undefined;

  const scope: AgentContextScope =
    rawScope.kind === "standalone"
      ? { kind: "standalone", scopeId: "standalone" }
      : {
          kind: "workspace",
          workspaceKind: rawScope.workspaceKind,
          workspaceId: rawScope.workspaceId
        };
  if (
    rawProjectId !== undefined &&
    (scope.kind !== "workspace" || scope.workspaceId !== rawProjectId)
  ) {
    return undefined;
  }
  return {
    scope,
    ...(rawProjectId === undefined ? {} : { projectId: rawProjectId })
  };
}

function isExactAgentContextScope(value: unknown): value is AgentContextScope {
  if (!isAgentContextScope(value) || !isRecord(value)) return false;
  return value["kind"] === "standalone"
    ? hasOnlyKeys(value, ["kind", "scopeId"])
    : hasOnlyKeys(value, ["kind", "workspaceKind", "workspaceId"]);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function isSha256Checksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function toWritingEditorStateReport(value: unknown): WritingEditorStateReport | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "workspaceId",
      "resourceKind",
      "resourceId",
      "editorInstanceId",
      "connection",
      "rendererRevision",
      "acknowledgedRevision",
      "dirty",
      "bufferChecksum",
      "bufferContent"
    ]) ||
    !isCanonicalWritingEditorIdentityPart(value["workspaceId"]) ||
    !isCanonicalWritingEditorIdentityPart(value["resourceId"]) ||
    !isCanonicalWritingEditorIdentityPart(value["editorInstanceId"]) ||
    (value["resourceKind"] !== "chapter" && value["resourceKind"] !== "story_bible") ||
    (value["connection"] !== "connected" &&
      value["connection"] !== "disconnected" &&
      value["connection"] !== "unknown") ||
    !isNonNegativeInteger(value["rendererRevision"]) ||
    !isNonNegativeInteger(value["acknowledgedRevision"]) ||
    value["acknowledgedRevision"] > value["rendererRevision"] ||
    typeof value["dirty"] !== "boolean" ||
    !isSha256Checksum(value["bufferChecksum"]) ||
    typeof value["bufferContent"] !== "string" ||
    Buffer.byteLength(value["bufferContent"], "utf8") > MAX_WRITING_EDITOR_BUFFER_BYTES
  ) {
    return undefined;
  }
  return {
    workspaceId: value["workspaceId"],
    resourceKind: value["resourceKind"],
    resourceId: value["resourceId"],
    editorInstanceId: value["editorInstanceId"],
    connection: value["connection"],
    rendererRevision: value["rendererRevision"],
    acknowledgedRevision: value["acknowledgedRevision"],
    dirty: value["dirty"],
    bufferChecksum: value["bufferChecksum"],
    bufferContent: value["bufferContent"]
  };
}

function toEngineeringEditorStateReport(value: unknown): EngineeringEditorStateReport | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "rootBindingId",
      "relativePath",
      "editorInstanceId",
      "connection",
      "rendererRevision",
      "acknowledgedRevision",
      "dirty",
      "bufferChecksum",
      "bufferContent"
    ]) ||
    !isCanonicalEngineeringEditorIdentityPart(value["rootBindingId"]) ||
    !isCanonicalEngineeringEditorIdentityPart(value["relativePath"]) ||
    !isCanonicalEngineeringEditorIdentityPart(value["editorInstanceId"]) ||
    (value["connection"] !== "connected" &&
      value["connection"] !== "disconnected" &&
      value["connection"] !== "unknown") ||
    !isNonNegativeInteger(value["rendererRevision"]) ||
    !isNonNegativeInteger(value["acknowledgedRevision"]) ||
    value["acknowledgedRevision"] > value["rendererRevision"] ||
    typeof value["dirty"] !== "boolean" ||
    !isSha256Checksum(value["bufferChecksum"]) ||
    typeof value["bufferContent"] !== "string" ||
    Buffer.byteLength(value["bufferContent"], "utf8") > MAX_ENGINEERING_EDITOR_BUFFER_BYTES
  ) {
    return undefined;
  }
  return {
    rootBindingId: value["rootBindingId"],
    relativePath: value["relativePath"],
    editorInstanceId: value["editorInstanceId"],
    connection: value["connection"],
    rendererRevision: value["rendererRevision"],
    acknowledgedRevision: value["acknowledgedRevision"],
    dirty: value["dirty"],
    bufferChecksum: value["bufferChecksum"],
    bufferContent: value["bufferContent"]
  };
}

function isCanonicalWritingEditorIdentityPart(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && value.trim().length > 0;
}

function isCanonicalEngineeringEditorIdentityPart(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && value.trim().length > 0;
}

function writingEditorStateError(
  code: Extract<WritingEditorStateReportResult, { readonly ok: false }>["error"]["code"],
  message: string
): WritingEditorStateReportResult {
  return { ok: false, error: { code, message } };
}

function engineeringEditorStateError(
  code: Extract<EngineeringEditorStateReportResult, { readonly ok: false }>["error"]["code"],
  message: string
): EngineeringEditorStateReportResult {
  return { ok: false, error: { code, message } };
}

function isOpaqueRetryTargetId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isCursor(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,2048}$/u.test(value);
}

function projectSnapshotResultToDto(
  result: Result<ProjectWorkspaceSnapshot, UnifiedError>
): Result<ReturnType<typeof toProjectWorkspaceSnapshotDto>, UnifiedError> {
  return result.ok ? ok(toProjectWorkspaceSnapshotDto(result.value)) : result;
}

function agentConversationUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONVERSATION_IPC_UNAVAILABLE",
    category: "AgentError",
    message: "The Agent Conversation service is unavailable.",
    recoverability: "user-action",
    suggestedAction: "Open a project and retry.",
    traceId: "desktop-agent-conversation-ipc"
  });
}

function agentRunUnavailable(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_RUN_IPC_UNAVAILABLE",
      category: "AgentError",
      message: "The Agent Run service is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Open a project and retry the Agent run.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

function invalidAgentRunCommand(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_RUN_IPC_INVALID_COMMAND",
      category: "ValidationError",
      message: "The Agent Run command payload is invalid.",
      recoverability: "user-action",
      suggestedAction: "Refresh the Agent Run and retry the command.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

function agentSendPreviewRequired(): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AGENT_SEND_PREVIEW_REQUIRED",
      category: "ValidationError",
      message: "A current send preview is required before this Agent request can start.",
      recoverability: "user-action",
      suggestedAction: "Prepare and confirm the send preview, then retry the Agent request.",
      traceId: "desktop-agent-run-ipc"
    })
  );
}

function agentContextRepreflightRequired(): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_REPREFLIGHT_REQUIRED",
    category: "ValidationError",
    message: "Changing the execution context mode requires a newly preflighted Agent run.",
    recoverability: "user-action",
    suggestedAction: "Start a new Agent run with the desired context mode.",
    traceId: "desktop-agent-run-ipc"
  });
}

function toUserPreferencesSaveInput(value: unknown): UserPreferencesSaveInput {
  if (!isRecord(value)) {
    return {};
  }

  return value as UserPreferencesSaveInput;
}

async function pumpAiSuggestionPushStream(
  streamId: string,
  iterator: AsyncIterator<Result<AiWritingSuggestionStreamEvent, UnifiedError>>,
  abortController: AbortController,
  publish: ((event: AiWritingSuggestionStreamPushEvent) => void) | undefined,
  onDone: () => void
): Promise<void> {
  let sequence = 0;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done === true) {
        break;
      }
      sequence += 1;
      if (next.value.ok) {
        const event: AiWritingSuggestionStreamPushEvent = {
          streamId,
          sequence,
          type: "event",
          event: next.value.value
        };
        if (!publishCloneSafeAiSuggestionEvent(event, publish)) {
          publishCloneSafeAiSuggestionEvent(
            {
              streamId,
              sequence,
              type: "error",
              error: createUnifiedError({
                code: "AI_STREAM_PAYLOAD_NOT_CLONEABLE",
                category: "ValidationError",
                message: "The AI stream produced an invalid IPC payload.",
                recoverability: "retryable",
                suggestedAction: "Retry the request and inspect the stream contract diagnostics.",
                traceId: "desktop-ipc-handlers"
              })
            },
            publish
          );
          break;
        }
      } else {
        publishCloneSafeAiSuggestionEvent(
          {
            streamId,
            sequence,
            type: "error",
            error: next.value.error
          },
          publish
        );
        break;
      }
      if (abortController.signal.aborted) {
        break;
      }
    }
  } catch (error) {
    sequence += 1;
    const failure = thrownAiStreamError(error);
    publishCloneSafeAiSuggestionEvent(
      {
        streamId,
        sequence,
        type: "error",
        error: failure.ok
          ? createUnifiedError({
              code: "AI_STREAM_FAILED",
              category: "LLMAdapterError",
              message: "AI streaming failed.",
              recoverability: "retryable",
              suggestedAction: "Check the model provider response and retry.",
              traceId: "desktop-ipc-handlers"
            })
          : failure.error
      },
      publish
    );
  } finally {
    sequence += 1;
    publishCloneSafeAiSuggestionEvent({ streamId, sequence, type: "completed" }, publish);
    onDone();
  }
}

function publishCloneSafeAiSuggestionEvent(
  event: AiWritingSuggestionStreamPushEvent,
  publish: ((event: AiWritingSuggestionStreamPushEvent) => void) | undefined
): boolean {
  if (publish === undefined) {
    return true;
  }
  try {
    publish(structuredClone(event));
    return true;
  } catch {
    return false;
  }
}

function readStreamId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function streamNotFound<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AI_STREAM_NOT_FOUND",
      category: "UserError",
      message: "The AI stream is no longer active.",
      recoverability: "user-action",
      suggestedAction: "Start a new AI writing stream.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

async function saveActiveChapterWithCoordinator(
  application: DesktopApplication,
  coordinator: AgentWriteSaveCoordinator | undefined
): Promise<unknown> {
  if (coordinator === undefined) return application.saveActiveChapter();
  const activeChapter = await application.readActiveChapterState();
  if (!activeChapter.ok) return activeChapter;
  const chapterId = activeChapter.value.state.chapter.frontmatter.id;
  const permit = coordinator.beginSave(`chapters/${chapterId}.md`);
  if (!permit.ok) return chapterSavePausedForAgentWrite();
  try {
    return await application.saveActiveChapter();
  } finally {
    permit.release();
  }
}

async function saveActiveChapterStatusWithCoordinator(
  application: DesktopApplication,
  coordinator: AgentWriteSaveCoordinator | undefined,
  status: Exclude<ChapterStatus, "deleted">
): Promise<unknown> {
  if (coordinator === undefined) return application.saveActiveChapterStatus(status);
  const activeChapter = await application.readActiveChapterState();
  if (!activeChapter.ok) return activeChapter;
  const chapterId = activeChapter.value.state.chapter.frontmatter.id;
  const permit = coordinator.beginSave(`chapters/${chapterId}.md`);
  if (!permit.ok) return chapterSavePausedForAgentWrite();
  try {
    return await application.saveActiveChapterStatus(status);
  } finally {
    permit.release();
  }
}

function chapterSavePausedForAgentWrite<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_SAVE_PAUSED_FOR_AGENT_WRITE",
      category: "UserError",
      message: "Chapter saving is temporarily paused while Agent changes are applied.",
      recoverability: "user-action",
      suggestedAction: "Wait for the Agent transaction to finish, then save again.",
      traceId: "desktop-ipc-handlers"
    })
  );
}

async function saveEngineeringTextFileWithCoordinator(
  application: DesktopApplication,
  coordinator: AgentWriteSaveCoordinator | undefined,
  getActiveRootBindingId: (() => string | undefined) | undefined,
  request: { readonly path: string; readonly content: string; readonly expectedChecksum: string },
  assertRecoveryAllowed: (() => Promise<Result<void, UnifiedError>>) | undefined
): Promise<unknown> {
  const readActiveRootBindingId = getActiveRootBindingId;
  if (coordinator === undefined || readActiveRootBindingId === undefined) {
    return engineeringSaveCoordinatorUnavailable();
  }
  const rootBindingId = readActiveRootBindingId();
  if (rootBindingId === undefined) {
    return engineeringSaveCoordinatorUnavailable();
  }
  if (assertRecoveryAllowed === undefined) return engineeringRecoveryGateUnavailable();
  const recovery = await safelyAssertEngineeringRecovery(assertRecoveryAllowed);
  if (!recovery.ok) return recovery;
  const permit = coordinator.beginEngineeringSave(rootBindingId, request.path);
  if (!permit.ok) return engineeringSavePausedForAgentWrite();
  try {
    // The active root may change while Main is handling an IPC turn. Re-read the Main-owned
    // authority immediately before dispatch so a save never follows a stale renderer view.
    if (readActiveRootBindingId() !== rootBindingId) return engineeringSaveRootBindingChanged();
    return await application.saveEngineeringTextFile(request);
  } finally {
    permit.release();
  }
}

async function assertEngineeringRecovery(
  options: ApplicationIpcHandlerOptions,
  transition: { readonly allowWorkspaceExit?: boolean } = {}
): Promise<Result<void, UnifiedError>> {
  // Creative and standalone lifecycle remains governed by their existing coordinators. The
  // recovery gate is required only while the active Main runtime is an engineering workspace.
  // Leaving that workspace is teardown, so it remains available even when the engineering
  // recovery authority is unavailable. Engineering writes and entering another engineering
  // workspace continue to require the gate.
  const manager = options.agentRuntimeManager;
  const active = manager?.active();
  if (active?.scope !== "workspace" || active.binding.kind !== "engineeringWorkspace") {
    return ok(undefined);
  }
  if (transition.allowWorkspaceExit === true) return ok(undefined);
  const assertAllowed = options.assertEngineeringRecoveryAllowed;
  if (assertAllowed !== undefined) return safelyAssertEngineeringRecovery(assertAllowed);
  return options.getActiveEngineeringEditorRootBindingId?.() === undefined
    ? ok(undefined)
    : engineeringRecoveryGateUnavailable();
}

async function safelyAssertEngineeringRecovery(
  assertAllowed: () => Promise<Result<void, UnifiedError>>
): Promise<Result<void, UnifiedError>> {
  try {
    return await assertAllowed();
  } catch {
    return engineeringRecoveryGateUnavailable();
  }
}

function engineeringRecoveryGateUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_RECOVERY_GATE_UNAVAILABLE",
      category: "StorageError",
      message: "Engineering workspace changes are blocked until recovery is complete.",
      recoverability: "user-action",
      suggestedAction: "Review the recovery state before saving or changing this workspace.",
      traceId: "desktop-engineering-recovery-gate-ipc"
    })
  );
}

function engineeringSaveCoordinatorUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_SAVE_COORDINATOR_UNAVAILABLE",
      category: "StorageError",
      message: "Engineering saving is unavailable until its active workspace root is verified.",
      recoverability: "retryable",
      suggestedAction: "Reopen the engineering workspace and try saving again.",
      traceId: "desktop-engineering-save-ipc"
    })
  );
}

function engineeringSavePausedForAgentWrite<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_SAVE_PAUSED_FOR_AGENT_WRITE",
      category: "UserError",
      message: "Engineering saving is temporarily paused while Agent changes are applied.",
      recoverability: "user-action",
      suggestedAction: "Wait for the Agent transaction to finish, then save again.",
      traceId: "desktop-engineering-save-ipc"
    })
  );
}

function engineeringSaveRootBindingChanged<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_SAVE_ROOT_BINDING_CHANGED",
      category: "StorageError",
      message: "The active engineering workspace changed before the save could start.",
      recoverability: "retryable",
      suggestedAction: "Reload the file from the active workspace and save again.",
      traceId: "desktop-engineering-save-ipc"
    })
  );
}

function engineeringMutationRendererSyncUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "ENGINEERING_MUTATION_RENDERER_SYNC_UNAVAILABLE",
      category: "StorageError",
      message: "Engineering mutation synchronization is unavailable.",
      recoverability: "user-action",
      suggestedAction: "Keep Engineering mutation disabled until Main synchronization is ready.",
      traceId: "desktop-engineering-mutation-sync-ipc"
    })
  );
}

function thrownAiStreamError<T>(error: unknown): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "AI_STREAM_FAILED",
      category: "LLMAdapterError",
      message: readErrorMessage(error, "AI streaming failed."),
      recoverability: "retryable",
      suggestedAction: "Check the model provider response and retry.",
      traceId: "desktop-ipc-handlers",
      redactedDetail: readThrownStreamErrorDetail(error)
    })
  );
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

function readThrownStreamErrorDetail(error: unknown): JsonObject {
  if (!isRecord(error)) {
    return {};
  }

  const detail: JsonObject = {};
  if (typeof error.status === "number") {
    detail.status = error.status;
  }
  if (isJsonValue(error.body)) {
    detail.body = error.body;
  }
  if (isJsonObject(error.headers)) {
    detail.headers = error.headers;
  }

  return detail;
}

const STORY_ANALYSIS_CHAPTER_ID_PATTERN = /^ch_[A-Za-z0-9_-]+$/u;
const STORY_ANALYSIS_WORKFLOW_RUN_ID_PATTERN = /^wfrun_story_[a-f0-9]{32}$/u;
const STORY_ANALYSIS_RECORD_ID_PATTERN = /^(?:sug|issue)_[a-f0-9]{32}$/u;
const STORY_ANALYSIS_CHECKSUM_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_STORY_ANALYSIS_HISTORY_ITEMS = 10_000;
const MAX_STORY_ANALYSIS_IPC_BYTES = 16 * 1024 * 1024;

function toChapterStatusForIpc(value: unknown): Exclude<ChapterStatus, "deleted"> | undefined {
  return value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived"
    ? value
    : undefined;
}

function toStoryAnalysisSettingsForIpc(value: unknown): StoryAnalysisSettings | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["completionMode", "storyBibleMaintenanceMode"])) {
    return undefined;
  }
  const completionMode = value["completionMode"];
  const storyBibleMaintenanceMode = value["storyBibleMaintenanceMode"];
  return (completionMode === "off" ||
    completionMode === "prompt" ||
    completionMode === "background-review") &&
    (storyBibleMaintenanceMode === "review" || storyBibleMaintenanceMode === "safe-auto")
    ? { completionMode, storyBibleMaintenanceMode }
    : undefined;
}

function chapterStatusInputInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_STATUS_INPUT_INVALID",
      category: "ValidationError",
      message: "The chapter status is invalid.",
      recoverability: "user-action",
      suggestedAction: "Choose draft, revision, review, done, or archived.",
      traceId: "desktop-chapter-ipc"
    })
  );
}

function storyAnalysisSettingsInputInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_ANALYSIS_SETTINGS_INPUT_INVALID",
      category: "ValidationError",
      message: "The Story Analysis settings are invalid.",
      recoverability: "user-action",
      suggestedAction: "Choose off, prompt, or background review.",
      traceId: "desktop-story-analysis-settings-ipc"
    })
  );
}

function toStoryAnalysisAnalyzeInput(value: unknown): { readonly chapterId: string } | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["chapterId"])) return undefined;
  const chapterId = value["chapterId"];
  return typeof chapterId === "string" && STORY_ANALYSIS_CHAPTER_ID_PATTERN.test(chapterId)
    ? { chapterId }
    : undefined;
}

function toStoryAnalysisWorkflowRunId(value: unknown): string | undefined {
  return typeof value === "string" && STORY_ANALYSIS_WORKFLOW_RUN_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function toStoryAnalysisReviewCommand(value: unknown): StoryAnalysisReviewCommand | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["workflowRunId", "recordId", "expectedRevision", "transition"])
  ) {
    return undefined;
  }
  const workflowRunId = toStoryAnalysisWorkflowRunId(value["workflowRunId"]);
  const recordId = value["recordId"];
  const expectedRevision = value["expectedRevision"];
  const transition = toStoryAnalysisAuthorTransition(value["transition"]);
  if (
    workflowRunId === undefined ||
    typeof recordId !== "string" ||
    !STORY_ANALYSIS_RECORD_ID_PATTERN.test(recordId) ||
    !Number.isSafeInteger(expectedRevision) ||
    Number(expectedRevision) < 1 ||
    transition === undefined
  ) {
    return undefined;
  }
  return {
    workflowRunId,
    recordId,
    expectedRevision: Number(expectedRevision),
    transition
  };
}

function toStoryAnalysisAuthorTransition(
  value: unknown
): StoryAnalysisReviewCommand["transition"] | undefined {
  if (!isRecord(value) || typeof value["status"] !== "string") return undefined;
  if (
    (value["status"] === "accepted" || value["status"] === "rejected") &&
    hasOnlyKeys(value, ["status"])
  ) {
    return { status: value["status"] };
  }
  if (value["status"] === "resolved" && hasOnlyKeys(value, ["status", "decision"])) {
    const decision = boundedText(value["decision"], 1, 10_000);
    return decision === undefined ? undefined : { status: "resolved", decision };
  }
  if (value["status"] === "dismissed" && hasOnlyKeys(value, ["status", "reason"])) {
    const reason = boundedText(value["reason"], 1, 10_000);
    return reason === undefined ? undefined : { status: "dismissed", reason };
  }
  return undefined;
}

function toStoryAnalysisPrepareApplicationInput(value: unknown):
  | {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
    }
  | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["workflowRunId", "suggestionIds"])) {
    return undefined;
  }
  const workflowRunId = toStoryAnalysisWorkflowRunId(value["workflowRunId"]);
  const suggestionIds = toStoryAnalysisSuggestionIds(value["suggestionIds"]);
  return workflowRunId === undefined || suggestionIds === undefined
    ? undefined
    : { workflowRunId, suggestionIds };
}

function toStoryAnalysisApplyApplicationInput(value: unknown):
  | {
      readonly workflowRunId: string;
      readonly suggestionIds: readonly string[];
      readonly changeSetId: string;
      readonly revision: number;
      readonly checksum: string;
    }
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["workflowRunId", "suggestionIds", "changeSetId", "revision", "checksum"])
  ) {
    return undefined;
  }
  const prepared = toStoryAnalysisPrepareApplicationInput({
    workflowRunId: value["workflowRunId"],
    suggestionIds: value["suggestionIds"]
  });
  const changeSetId = value["changeSetId"];
  const revision = value["revision"];
  const checksum = value["checksum"];
  if (
    prepared === undefined ||
    typeof changeSetId !== "string" ||
    !/^change_set_[A-Za-z0-9_-]{1,128}$/u.test(changeSetId) ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 1 ||
    typeof checksum !== "string" ||
    !STORY_ANALYSIS_CHECKSUM_PATTERN.test(checksum)
  ) {
    return undefined;
  }
  return { ...prepared, changeSetId, revision: Number(revision), checksum };
}

function toStoryAnalysisSuggestionIds(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    !isDenseArray(value) ||
    value.length === 0 ||
    value.length > 1_000 ||
    value.some((entry) => typeof entry !== "string" || !/^sug_[a-f0-9]{32}$/u.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return value as string[];
}

async function storyAnalysisRecordIpcResult(
  operation: () => ReturnType<DesktopApplication["readStoryAnalysis"]>
): Promise<Result<StoryAnalysisRecordDto, UnifiedError>> {
  try {
    const result = await operation();
    if (!result.ok) return storyAnalysisApplicationError(result.error);
    const dto = toStoryAnalysisRecordDto(result.value);
    return dto === undefined ? storyAnalysisIpcResultInvalid() : ok(dto);
  } catch {
    return storyAnalysisApplicationError(undefined);
  }
}

async function storyAnalysisApplicationPreviewIpcResult(
  operation: () => ReturnType<DesktopApplication["prepareStoryAnalysisApplication"]>
): Promise<Result<StoryAnalysisApplicationPreviewDto, UnifiedError>> {
  try {
    const result = await operation();
    if (!result.ok) return storyAnalysisApplicationError(result.error);
    const analysis = toStoryAnalysisRecordDto(result.value.analysis);
    const changeSet = toBoundedStoryAnalysisChangeSet(result.value.changeSet);
    const suggestionIdsByGroup = toStoryAnalysisSuggestionIdsByGroup(
      result.value.suggestionIdsByGroup
    );
    return analysis === undefined || changeSet === undefined || suggestionIdsByGroup === undefined
      ? storyAnalysisIpcResultInvalid()
      : ok({
          schemaVersion: "1.0",
          analysis,
          changeSet,
          suggestionIdsByGroup
        });
  } catch {
    return storyAnalysisApplicationError(undefined);
  }
}

async function storyAnalysisApplicationResultIpcResult(
  operation: () => ReturnType<DesktopApplication["applyStoryAnalysisApplication"]>
): Promise<Result<StoryAnalysisApplicationResultDto, UnifiedError>> {
  try {
    const result = await operation();
    if (!result.ok) return storyAnalysisApplicationError(result.error);
    const analysis = toStoryAnalysisRecordDto(result.value.analysis);
    const batch = toBoundedStoryAnalysisApplyBatch(result.value.batch);
    const recordSyncWarning = toStoryAnalysisRecordSyncWarning(result.value.recordSyncWarning);
    return analysis === undefined ||
      batch === undefined ||
      (result.value.recordSyncWarning !== undefined && recordSyncWarning === undefined)
      ? storyAnalysisIpcResultInvalid()
      : ok({
          schemaVersion: "1.0",
          analysis,
          batch,
          ...(recordSyncWarning === undefined ? {} : { recordSyncWarning })
        });
  } catch {
    return storyAnalysisApplicationError(undefined);
  }
}

function toBoundedStoryAnalysisChangeSet(
  value: unknown
): StoryAnalysisApplicationPreviewDto["changeSet"] | undefined {
  if (
    !isJsonObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "changeSetId",
      "revision",
      "runId",
      "projectId",
      "checkpointId",
      "contextSnapshotId",
      "writePolicy",
      "status",
      "checksum",
      "approvalToken",
      "files",
      "operations",
      "createdAt"
    ]) ||
    (value["schemaVersion"] !== "1.0" && value["schemaVersion"] !== "1.1") ||
    typeof value["changeSetId"] !== "string" ||
    !/^change_set_[A-Za-z0-9_-]{1,128}$/u.test(value["changeSetId"]) ||
    !Number.isSafeInteger(value["revision"]) ||
    !Array.isArray(value["files"]) ||
    value["files"].length > 1_000 ||
    (value["operations"] !== undefined &&
      (!Array.isArray(value["operations"]) || value["operations"].length > 1_000)) ||
    !isBoundedStoryAnalysisJson(value)
  ) {
    return undefined;
  }
  return value as unknown as StoryAnalysisApplicationPreviewDto["changeSet"];
}

function toStoryAnalysisSuggestionIdsByGroup(
  value: unknown
): Readonly<Record<string, readonly string[]>> | undefined {
  if (!isJsonObject(value) || Object.keys(value).length > 1_000) return undefined;
  const result: Record<string, readonly string[]> = {};
  for (const [groupId, suggestionIds] of Object.entries(value)) {
    const parsed = toStoryAnalysisSuggestionIds(suggestionIds);
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(groupId) || parsed === undefined) return undefined;
    result[groupId] = parsed;
  }
  return result;
}

function toBoundedStoryAnalysisApplyBatch(
  value: unknown
): StoryAnalysisApplicationResultDto["batch"] | undefined {
  if (
    !isJsonObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "applyBatchId",
      "changeSetId",
      "selectionChecksum",
      "groups"
    ]) ||
    value["schemaVersion"] !== "1.0" ||
    typeof value["applyBatchId"] !== "string" ||
    !/^apply_[A-Za-z0-9_-]{1,128}$/u.test(value["applyBatchId"]) ||
    !Array.isArray(value["groups"]) ||
    value["groups"].length === 0 ||
    value["groups"].length > 1_000 ||
    !isBoundedStoryAnalysisJson(value)
  ) {
    return undefined;
  }
  return value as unknown as StoryAnalysisApplicationResultDto["batch"];
}

function toStoryAnalysisRecordSyncWarning(
  value: unknown
): StoryAnalysisApplicationResultDto["recordSyncWarning"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const code = value["code"];
  const message = value["message"];
  if (
    typeof code !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,127}$/u.test(code) ||
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 1_000
  ) {
    return undefined;
  }
  return { code, message };
}

function isBoundedStoryAnalysisJson(value: JsonValue): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_STORY_ANALYSIS_IPC_BYTES;
  } catch {
    return false;
  }
}

async function storyAnalysisListIpcResult(
  operation: () => ReturnType<DesktopApplication["listStoryAnalyses"]>
): Promise<Result<readonly StoryAnalysisHistorySummary[], UnifiedError>> {
  try {
    const result = await operation();
    if (!result.ok) return storyAnalysisApplicationError(result.error);
    const dto = toStoryAnalysisHistorySummaries(result.value);
    return dto === undefined ? storyAnalysisIpcResultInvalid() : ok(dto);
  } catch {
    return storyAnalysisApplicationError(undefined);
  }
}

function toStoryAnalysisRecordDto(value: unknown): StoryAnalysisRecordDto | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["workflowRun", "storyAnalysis", "checksum"]) ||
    !isRecord(value["workflowRun"])
  ) {
    return undefined;
  }
  const workflowRun = value["workflowRun"];
  const workflowRunId = toStoryAnalysisWorkflowRunId(workflowRun["workflowRunId"]);
  const workflowStatus = workflowRun["status"];
  const updatedAt = workflowRun["updatedAt"];
  const checksum = value["checksum"];
  const storyAnalysis = toBoundedStoryAnalysisBundle(value["storyAnalysis"]);
  if (
    workflowRunId === undefined ||
    (workflowStatus !== "pending-confirmation" &&
      workflowStatus !== "applied" &&
      workflowStatus !== "failed") ||
    typeof updatedAt !== "string" ||
    !isCanonicalIsoDateTime(updatedAt) ||
    typeof checksum !== "string" ||
    !STORY_ANALYSIS_CHECKSUM_PATTERN.test(checksum) ||
    storyAnalysis === undefined
  ) {
    return undefined;
  }
  return { workflowRunId, workflowStatus, updatedAt, checksum, storyAnalysis };
}

function toStoryAnalysisHistorySummaries(
  value: unknown
): readonly StoryAnalysisHistorySummary[] | undefined {
  if (
    !Array.isArray(value) ||
    !isDenseArray(value) ||
    value.length > MAX_STORY_ANALYSIS_HISTORY_ITEMS
  ) {
    return undefined;
  }
  const summaries: StoryAnalysisHistorySummary[] = [];
  for (const entry of value) {
    const summary = toStoryAnalysisHistorySummary(entry);
    if (summary === undefined) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

function toStoryAnalysisHistorySummary(value: unknown): StoryAnalysisHistorySummary | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "workflowRunId",
      "analysisRunId",
      "chapterId",
      "status",
      "updatedAt",
      "pendingSuggestionCount",
      "openIssueCount",
      "checksum"
    ])
  ) {
    return undefined;
  }
  const workflowRunId = toStoryAnalysisWorkflowRunId(value["workflowRunId"]);
  const analysisRunId = value["analysisRunId"];
  const chapterId = value["chapterId"];
  const status = value["status"];
  const updatedAt = value["updatedAt"];
  const pendingSuggestionCount = value["pendingSuggestionCount"];
  const openIssueCount = value["openIssueCount"];
  const checksum = value["checksum"];
  if (
    workflowRunId === undefined ||
    typeof analysisRunId !== "string" ||
    !/^run_[a-f0-9]{32}$/u.test(analysisRunId) ||
    typeof chapterId !== "string" ||
    !STORY_ANALYSIS_CHAPTER_ID_PATTERN.test(chapterId) ||
    !isStoryAnalysisRunStatus(status) ||
    typeof updatedAt !== "string" ||
    !isCanonicalIsoDateTime(updatedAt) ||
    !isNonNegativeSafeInteger(pendingSuggestionCount) ||
    !isNonNegativeSafeInteger(openIssueCount) ||
    typeof checksum !== "string" ||
    !STORY_ANALYSIS_CHECKSUM_PATTERN.test(checksum)
  ) {
    return undefined;
  }
  return {
    workflowRunId,
    analysisRunId,
    chapterId,
    status,
    updatedAt,
    pendingSuggestionCount,
    openIssueCount,
    checksum
  };
}

function toBoundedStoryAnalysisBundle(
  value: unknown
): StoryAnalysisRecordDto["storyAnalysis"] | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized, "utf8") > MAX_STORY_ANALYSIS_IPC_BYTES
    ) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(serialized);
    const validation = validateStoryAnalysisBundle(parsed);
    return validation.valid ? (parsed as StoryAnalysisRecordDto["storyAnalysis"]) : undefined;
  } catch {
    return undefined;
  }
}

function isStoryAnalysisRunStatus(value: unknown): value is StoryAnalysisHistorySummary["status"] {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "partial" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function storyAnalysisInputInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_ANALYSIS_IPC_INPUT_INVALID",
      category: "ValidationError",
      message: "The Story Analysis request is invalid.",
      recoverability: "user-action",
      suggestedAction: "Reload the analysis view and retry the action.",
      traceId: "desktop-story-analysis-ipc"
    })
  );
}

function storyAnalysisIpcResultInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_ANALYSIS_IPC_RESULT_INVALID",
      category: "WorkflowError",
      message: "The Story Analysis result could not be verified.",
      recoverability: "retryable",
      suggestedAction: "Retry the Story Analysis action.",
      traceId: "desktop-story-analysis-ipc"
    })
  );
}

function storyAnalysisApplicationError<T>(value: unknown): Result<T, UnifiedError> {
  const code =
    isRecord(value) &&
    typeof value["code"] === "string" &&
    /^[A-Z][A-Z0-9_]{0,127}$/u.test(value["code"])
      ? value["code"]
      : "STORY_ANALYSIS_APPLICATION_FAILED";
  return err(
    createUnifiedError({
      code,
      category: code === "STORY_ANALYSIS_APPLICATION_FAILED" ? "WorkflowError" : "UserError",
      message: "The Story Analysis action could not be completed.",
      recoverability: code === "STORY_ANALYSIS_APPLICATION_FAILED" ? "retryable" : "user-action",
      suggestedAction: "Reload the analysis view and retry the action.",
      traceId: "desktop-story-analysis-ipc"
    })
  );
}

const FORESHADOW_CHAPTER_ID_PATTERN = /^ch_[A-Za-z0-9_-]+$/u;
const FORESHADOW_ANALYSIS_ID_PATTERN = /^fsa_([a-f0-9]{32})$/u;
const FORESHADOW_ID_PATTERN = /^fsh_[a-f0-9]{32}$/u;
const FORESHADOW_EVIDENCE_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_FORESHADOW_SCAN_CHAPTERS = 5;
const MAX_FORESHADOW_SCAN_CANDIDATES = 100;

function toForeshadowAnalysisInput(value: unknown): ForeshadowAnalysisInput | undefined {
  if (
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, "chapterIds") ||
    !hasOnlyKeys(value, ["chapterIds"])
  ) {
    return undefined;
  }
  const chapterIds = value["chapterIds"];
  if (
    !Array.isArray(chapterIds) ||
    !isDenseArray(chapterIds) ||
    chapterIds.length < 1 ||
    chapterIds.length > MAX_FORESHADOW_SCAN_CHAPTERS ||
    !chapterIds.every(
      (chapterId): chapterId is string =>
        typeof chapterId === "string" && FORESHADOW_CHAPTER_ID_PATTERN.test(chapterId)
    ) ||
    new Set(chapterIds).size !== chapterIds.length
  ) {
    return undefined;
  }
  return { chapterIds: [...chapterIds] };
}

function toForeshadowAnalysisResultDto(
  value: unknown,
  expectedChapterIds: readonly string[]
): ForeshadowAnalysisResultDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const analysisId = value["analysisId"];
  if (typeof analysisId !== "string") {
    return undefined;
  }
  const analysisMatch = FORESHADOW_ANALYSIS_ID_PATTERN.exec(analysisId);
  const chapterIds = value["chapterIds"];
  const candidates = value["candidates"];
  const createdAt = value["createdAt"];
  if (
    analysisMatch === null ||
    !Array.isArray(chapterIds) ||
    !isDenseArray(chapterIds) ||
    chapterIds.length !== expectedChapterIds.length ||
    !chapterIds.every((chapterId, index) => chapterId === expectedChapterIds[index]) ||
    !Array.isArray(candidates) ||
    !isDenseArray(candidates) ||
    candidates.length > MAX_FORESHADOW_SCAN_CANDIDATES ||
    typeof createdAt !== "string" ||
    !isCanonicalIsoDateTime(createdAt)
  ) {
    return undefined;
  }

  const selectedChapterIds = new Set(expectedChapterIds);
  const candidateDtos: ForeshadowAnalysisCandidateDto[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const candidateDto = toForeshadowAnalysisCandidateDto(
      candidate,
      analysisMatch[1] ?? "",
      index,
      selectedChapterIds
    );
    if (candidateDto === undefined) {
      return undefined;
    }
    candidateDtos.push(candidateDto);
  }

  const usage = toForeshadowAnalysisUsageDto(value["usage"]);
  if (usage === undefined) {
    return undefined;
  }
  return {
    analysisId,
    chapterIds: [...expectedChapterIds],
    candidates: candidateDtos,
    usage,
    createdAt
  };
}

function toForeshadowAnalysisCandidateDto(
  value: unknown,
  analysisIdentity: string,
  index: number,
  selectedChapterIds: ReadonlySet<string>
): ForeshadowAnalysisCandidateDto | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const expectedCandidateId = `fsc_${analysisIdentity}_${String(index + 1).padStart(3, "0")}`;
  const candidateId = value["candidateId"];
  const reason = boundedText(value["reason"], 1, 2_000);
  const evidence = toForeshadowAnalysisEvidenceDto(value["evidence"], selectedChapterIds);
  const duplicateForeshadowIds = toForeshadowIdArray(value["duplicateForeshadowIds"]);
  if (
    candidateId !== expectedCandidateId ||
    reason === undefined ||
    evidence === undefined ||
    duplicateForeshadowIds === undefined
  ) {
    return undefined;
  }

  const base = { candidateId, evidence, reason, duplicateForeshadowIds };
  if (value["kind"] === "new") {
    const suggested = toForeshadowNewSuggestionDto(value["suggested"], evidence.chapterId);
    return suggested === undefined ? undefined : { ...base, kind: "new", suggested };
  }
  if (value["kind"] === "progress") {
    const targetForeshadowId = value["targetForeshadowId"];
    const suggested = toForeshadowProgressSuggestionDto(value["suggested"]);
    return typeof targetForeshadowId !== "string" ||
      !FORESHADOW_ID_PATTERN.test(targetForeshadowId) ||
      suggested === undefined
      ? undefined
      : { ...base, kind: "progress", targetForeshadowId, suggested };
  }
  if (value["kind"] === "payoff") {
    const targetForeshadowId = value["targetForeshadowId"];
    const suggested = toForeshadowPayoffSuggestionDto(value["suggested"], evidence.chapterId);
    return typeof targetForeshadowId !== "string" ||
      !FORESHADOW_ID_PATTERN.test(targetForeshadowId) ||
      suggested === undefined
      ? undefined
      : { ...base, kind: "payoff", targetForeshadowId, suggested };
  }
  return undefined;
}

function toForeshadowAnalysisEvidenceDto(
  value: unknown,
  selectedChapterIds: ReadonlySet<string>
): ForeshadowAnalysisResultDto["candidates"][number]["evidence"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const chapterId = value["chapterId"];
  const excerpt = boundedText(value["excerpt"], 1, 2_000);
  const excerptHash = value["excerptHash"];
  if (
    typeof chapterId !== "string" ||
    !selectedChapterIds.has(chapterId) ||
    excerpt === undefined ||
    typeof excerptHash !== "string" ||
    !FORESHADOW_EVIDENCE_HASH_PATTERN.test(excerptHash)
  ) {
    return undefined;
  }
  return { chapterId, excerpt, excerptHash };
}

function toForeshadowNewSuggestionDto(
  value: unknown,
  evidenceChapterId: string
): Extract<ForeshadowAnalysisCandidateDto, { readonly kind: "new" }>["suggested"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const title = boundedText(value["title"], 1, 160);
  const summary = boundedText(value["summary"], 0, 1_000);
  const plannedPayoffChapterId = optionalChapterId(value["plannedPayoffChapterId"]);
  const notes = optionalBoundedText(value["notes"], 2_000);
  const relatedEntityIds = optionalUniqueTextArray(value["relatedEntityIds"], 100);
  if (
    title === undefined ||
    summary === undefined ||
    value["trackingStatus"] !== "planted" ||
    value["plantedChapterId"] !== evidenceChapterId ||
    plannedPayoffChapterId === false ||
    notes === false ||
    relatedEntityIds === false
  ) {
    return undefined;
  }
  return {
    title,
    summary,
    trackingStatus: "planted",
    plantedChapterId: evidenceChapterId,
    ...(plannedPayoffChapterId === undefined ? {} : { plannedPayoffChapterId }),
    ...(notes === undefined ? {} : { notes }),
    ...(relatedEntityIds === undefined ? {} : { relatedEntityIds })
  };
}

function toForeshadowProgressSuggestionDto(
  value: unknown
): Extract<ForeshadowAnalysisCandidateDto, { readonly kind: "progress" }>["suggested"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const trackingStatus = value["trackingStatus"];
  const summary = optionalBoundedText(value["summary"], 1_000);
  const notes = optionalBoundedText(value["notes"], 2_000);
  if (
    (trackingStatus !== "progressing" && trackingStatus !== "ready-to-payoff") ||
    summary === false ||
    notes === false
  ) {
    return undefined;
  }
  return {
    trackingStatus,
    ...(summary === undefined ? {} : { summary }),
    ...(notes === undefined ? {} : { notes })
  };
}

function toForeshadowPayoffSuggestionDto(
  value: unknown,
  evidenceChapterId: string
): Extract<ForeshadowAnalysisCandidateDto, { readonly kind: "payoff" }>["suggested"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const summary = optionalBoundedText(value["summary"], 1_000);
  const notes = optionalBoundedText(value["notes"], 2_000);
  if (
    value["trackingStatus"] !== "paid-off" ||
    value["actualPayoffChapterId"] !== evidenceChapterId ||
    summary === false ||
    notes === false
  ) {
    return undefined;
  }
  return {
    trackingStatus: "paid-off",
    actualPayoffChapterId: evidenceChapterId,
    ...(summary === undefined ? {} : { summary }),
    ...(notes === undefined ? {} : { notes })
  };
}

function toForeshadowAnalysisUsageDto(
  value: unknown
): ForeshadowAnalysisResultDto["usage"] | undefined {
  if (!isRecord(value) || !isRecord(value["cost"])) {
    return undefined;
  }
  const inputTokens = value["inputTokens"];
  const outputTokens = value["outputTokens"];
  const totalTokens = value["totalTokens"];
  const usageStatus = value["usageStatus"];
  const cost = value["cost"];
  const amount = cost["amount"];
  const currency = cost["currency"];
  const costStatus = cost["status"];
  if (
    !isNonNegativeSafeInteger(inputTokens) ||
    !isNonNegativeSafeInteger(outputTokens) ||
    !isNonNegativeSafeInteger(totalTokens) ||
    (usageStatus !== "missing" && usageStatus !== "estimated" && usageStatus !== "actual") ||
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof currency !== "string" ||
    !/^(?:[A-Z]{3})?$/u.test(currency) ||
    (costStatus !== "unknown" && costStatus !== "estimated" && costStatus !== "actual")
  ) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    usageStatus,
    cost: { amount, currency, status: costStatus }
  };
}

function toForeshadowIdArray(value: unknown): readonly string[] | undefined {
  if (
    !Array.isArray(value) ||
    !isDenseArray(value) ||
    value.length > MAX_FORESHADOW_SCAN_CANDIDATES ||
    !value.every(
      (foreshadowId): foreshadowId is string =>
        typeof foreshadowId === "string" && FORESHADOW_ID_PATTERN.test(foreshadowId)
    ) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return [...value];
}

function optionalChapterId(value: unknown): string | undefined | false {
  return value === undefined
    ? undefined
    : typeof value === "string" && FORESHADOW_CHAPTER_ID_PATTERN.test(value)
      ? value
      : false;
}

function optionalBoundedText(value: unknown, maxLength: number): string | undefined | false {
  return value === undefined ? undefined : (boundedText(value, 0, maxLength) ?? false);
}

function optionalUniqueTextArray(
  value: unknown,
  maxItems: number
): readonly string[] | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !isDenseArray(value) ||
    value.length > maxItems ||
    !value.every(
      (entry): entry is string =>
        typeof entry === "string" &&
        boundedText(entry, 1, 512) !== undefined &&
        entry === entry.trim()
    ) ||
    new Set(value).size !== value.length
  ) {
    return false;
  }
  return [...value];
}

function boundedText(value: unknown, minLength: number, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if (normalized !== value) {
    return undefined;
  }
  const length = Array.from(normalized).length;
  return length >= minLength && length <= maxLength ? value : undefined;
}

function isCanonicalIsoDateTime(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDenseArray(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      return false;
    }
  }
  return true;
}

function foreshadowScanInputInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "FORESHADOW_SCAN_INPUT_INVALID",
      category: "ValidationError",
      message: "Choose between one and five unique saved chapters.",
      recoverability: "user-action",
      suggestedAction: "Choose one to five valid saved chapter IDs and retry.",
      traceId: "desktop-foreshadow-analysis-ipc"
    })
  );
}

function foreshadowScanIpcResultInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "FORESHADOW_SCAN_IPC_RESULT_INVALID",
      category: "AgentError",
      message: "The foreshadow analysis result could not be verified.",
      recoverability: "retryable",
      suggestedAction: "Retry the foreshadow analysis.",
      traceId: "desktop-foreshadow-analysis-ipc"
    })
  );
}

function foreshadowScanApplicationError<T>(value: unknown): Result<T, UnifiedError> {
  const error = isRecord(value) ? value : {};
  const rawCode = error["code"];
  const code =
    typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(rawCode)
      ? rawCode
      : "FORESHADOW_SCAN_FAILED";
  const descriptor = foreshadowScanErrorDescriptor(code);
  return err(
    createUnifiedError({
      code,
      category: toSafeErrorCategory(error["category"]),
      message: descriptor.message,
      recoverability: toSafeRecoverability(error["recoverability"]),
      suggestedAction: descriptor.suggestedAction,
      traceId: "desktop-foreshadow-analysis-ipc"
    })
  );
}

function foreshadowScanErrorDescriptor(code: string): {
  readonly message: string;
  readonly suggestedAction: string;
} {
  switch (code) {
    case "FORESHADOW_SCAN_INPUT_INVALID":
      return {
        message: "The selected chapters are not valid for foreshadow analysis.",
        suggestedAction: "Refresh the chapter list, select one to five chapters, and retry."
      };
    case "FORESHADOW_SCAN_MODEL_CONTEXT_INVALID":
      return {
        message: "The selected model does not have a verified context window.",
        suggestedAction: "Configure the model context window and retry."
      };
    case "FORESHADOW_SCAN_CONTEXT_TOO_LARGE":
      return {
        message: "The selected chapters exceed the model context budget.",
        suggestedAction: "Select fewer or shorter chapters, or choose a larger-context model."
      };
    case "FORESHADOW_SCAN_WORKSPACE_CHANGED":
      return {
        message: "The active workspace changed before foreshadow analysis finished.",
        suggestedAction: "Run the analysis again in the current project."
      };
    case "CHAPTER_FILE_MISSING":
      return {
        message: "A selected chapter could not be read.",
        suggestedAction: "Refresh the chapter list, select saved chapters, and retry."
      };
    default:
      return {
        message: "Foreshadow analysis could not be completed.",
        suggestedAction: "Check the selected chapters and model settings, then retry."
      };
  }
}

function toSafeErrorCategory(value: unknown): UnifiedError["category"] {
  return value === "UserError" ||
    value === "ValidationError" ||
    value === "StorageError" ||
    value === "ModelProviderError" ||
    value === "LLMAdapterError" ||
    value === "WorkflowError" ||
    value === "AgentError" ||
    value === "PluginError"
    ? value
    : "AgentError";
}

function toSafeRecoverability(value: unknown): UnifiedError["recoverability"] {
  return value === "retryable" ||
    value === "user-action" ||
    value === "fatal" ||
    value === "unknown"
    ? value
    : "unknown";
}

const STORY_BIBLE_ASSET_CANONICAL_FIELDS = new Set([
  "schemaVersion",
  "id",
  "type",
  "title",
  "status",
  "summary",
  "aliases",
  "details",
  "relatedEntityIds",
  "createdAt",
  "updatedAt"
]);

function toStoryBibleAsset(value: unknown): StoryBibleAsset | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  if (
    value.schemaVersion !== "1.0" ||
    typeof value.id !== "string" ||
    !isStoryBibleAssetType(value.type) ||
    typeof value.title !== "string" ||
    !isStoryBibleEntityStatus(value.status) ||
    typeof value.summary !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isOptionalStringArray(value.aliases) ||
    !isOptionalJsonObject(value.details) ||
    !isOptionalStringArray(value.relatedEntityIds)
  ) {
    return undefined;
  }

  const additionalFields = storyBibleAssetAdditionalFields(value);

  if (value.type === "foreshadow") {
    if (!isForeshadowDetails(value.details)) {
      return undefined;
    }

    return {
      schemaVersion: "1.0",
      id: value.id,
      type: "foreshadow",
      title: value.title,
      status: value.status,
      summary: value.summary,
      ...(value.aliases === undefined ? {} : { aliases: value.aliases }),
      details: value.details,
      ...(value.relatedEntityIds === undefined ? {} : { relatedEntityIds: value.relatedEntityIds }),
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...additionalFields
    };
  }

  return {
    schemaVersion: "1.0",
    id: value.id,
    type: value.type,
    title: value.title,
    status: value.status,
    summary: value.summary,
    ...(value.aliases === undefined ? {} : { aliases: value.aliases }),
    ...(value.details === undefined ? {} : { details: value.details }),
    ...(value.relatedEntityIds === undefined ? {} : { relatedEntityIds: value.relatedEntityIds }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...additionalFields
  };
}

function toCreateStoryBibleAssetCommand(value: unknown): CreateStoryBibleAssetCommand | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, ["type", "value"])) return undefined;
  if (!isStoryBibleAssetType(value["type"]) || !isJsonObject(value["value"])) return undefined;
  const createValue = value["value"];
  if (!validateStoryBibleCreateValue(value["type"], createValue).valid) return undefined;
  return {
    type: value["type"],
    value: createValue as StoryBibleCreateValue
  };
}

function toSaveStoryBibleAssetCandidateCommand(
  value: unknown
): SaveStoryBibleAssetCandidateCommand | undefined {
  if (
    !isJsonObject(value) ||
    !hasOnlyKeys(value, ["candidate", "baseRevision", "baseChecksum"]) ||
    !isJsonObject(value["candidate"]) ||
    !Number.isInteger(value["baseRevision"]) ||
    (value["baseRevision"] as number) < 0 ||
    (value["baseChecksum"] !== undefined &&
      (typeof value["baseChecksum"] !== "string" || !/^[a-f0-9]{64}$/u.test(value["baseChecksum"])))
  ) {
    return undefined;
  }
  const candidate = value["candidate"];
  const type = candidate["type"];
  const baseRevision = value["baseRevision"] as number;
  if (
    !isStoryBibleAssetType(type) ||
    !validateStoryBibleWriteCandidate(candidate, {
      assetType: type,
      allowLegacyId: true
    }).valid
  ) {
    return undefined;
  }
  return {
    candidate: candidate as StoryBibleWriteCandidate,
    baseRevision,
    ...(value["baseChecksum"] === undefined
      ? {}
      : { baseChecksum: value["baseChecksum"] as string })
  };
}

function toPrepareStoryBibleExplicitInverseCommand(
  value: unknown
): { readonly source: StoryBibleExplicitInverseSourceCommand } | undefined {
  if (!isJsonObject(value) || !hasOnlyKeys(value, ["source"]) || !isJsonObject(value["source"])) {
    return undefined;
  }
  const source = value["source"];
  if (!hasOnlyKeys(source, ["candidate", "baseRevision", "baseChecksum"])) return undefined;
  if (
    typeof source["baseChecksum"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(source["baseChecksum"])
  ) {
    return undefined;
  }
  const direct = toSaveStoryBibleAssetCandidateCommand(source);
  if (direct !== undefined && direct.baseChecksum !== undefined) {
    return { source: { ...direct, baseChecksum: direct.baseChecksum } };
  }
  if (!isJsonObject(source["candidate"])) {
    return undefined;
  }
  const candidate = source["candidate"];
  const relations = candidate["relations"];
  if (!Array.isArray(relations)) return undefined;
  const normalizedRelations = relations.map((relation, index) =>
    isJsonObject(relation) &&
    relation["inversePolicy"] === "explicit" &&
    relation["inverseRelationId"] === null
      ? {
          ...relation,
          inverseRelationId: `rel_${(index + 1).toString(16).padStart(32, "f")}`
        }
      : relation
  );
  const normalized = toSaveStoryBibleAssetCandidateCommand({
    ...source,
    candidate: { ...candidate, relations: normalizedRelations }
  });
  return normalized === undefined || normalized.baseChecksum === undefined
    ? undefined
    : {
        source: {
          ...normalized,
          baseChecksum: normalized.baseChecksum,
          candidate: candidate as StoryBibleWriteCandidate
        }
      };
}

function toApplyStoryBibleExplicitInverseCommand(
  value: unknown
):
  { readonly previewId: string; readonly revision: number; readonly checksum: string } | undefined {
  return toExplicitInverseReceiptCommand(value);
}

function toExplicitInverseReceiptCommand(
  value: unknown
):
  { readonly previewId: string; readonly revision: number; readonly checksum: string } | undefined {
  if (
    !isJsonObject(value) ||
    !hasOnlyKeys(value, ["previewId", "revision", "checksum"]) ||
    typeof value["previewId"] !== "string" ||
    !/^preview_[A-Za-z0-9_-]{1,120}$/u.test(value["previewId"]) ||
    !Number.isInteger(value["revision"]) ||
    (value["revision"] as number) < 1 ||
    typeof value["checksum"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value["checksum"])
  ) {
    return undefined;
  }
  return {
    previewId: value["previewId"],
    revision: value["revision"] as number,
    checksum: value["checksum"]
  };
}

function toSaveStoryBibleStatusTransitionCommand(
  value: unknown
): SaveStoryBibleStatusTransitionCommand | undefined {
  if (!isJsonObject(value)) return undefined;
  const action = value["action"];
  const allowedKeys =
    action === "move-to-deleted"
      ? ["action", "candidate", "baseRevision", "baseChecksum", "expectedDeletionImpactChecksum"]
      : action === "restore"
        ? ["action", "candidate", "baseRevision", "baseChecksum"]
        : [];
  if (allowedKeys.length === 0 || !hasOnlyKeys(value, allowedKeys)) return undefined;
  const base = toSaveStoryBibleAssetCandidateCommand({
    candidate: value["candidate"],
    baseRevision: value["baseRevision"],
    ...(value["baseChecksum"] === undefined ? {} : { baseChecksum: value["baseChecksum"] })
  });
  if (base === undefined) return undefined;
  if (action === "restore") return { ...base, action };
  if (action !== "move-to-deleted") return undefined;
  const expectedDeletionImpactChecksum = value["expectedDeletionImpactChecksum"];
  return typeof expectedDeletionImpactChecksum === "string" &&
    /^[a-f0-9]{64}$/u.test(expectedDeletionImpactChecksum)
    ? { ...base, action, expectedDeletionImpactChecksum }
    : undefined;
}

function storyBibleIpcInputInvalid<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "STORY_BIBLE_IPC_INPUT_INVALID",
      category: "ValidationError",
      message: "The Story Bible request is invalid.",
      recoverability: "user-action",
      suggestedAction: "Reload the Story Bible entry and retry.",
      traceId: "desktop-story-bible-ipc"
    })
  );
}

function storyBibleAssetAdditionalFields(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !STORY_BIBLE_ASSET_CANONICAL_FIELDS.has(key))
  );
}

function toMemoryRecord(value: unknown): MemoryRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.schemaVersion !== "string" ||
    typeof value.id !== "string" ||
    !isMemoryRecordType(value.type) ||
    typeof value.title !== "string" ||
    !isStoryBibleEntityStatus(value.status) ||
    !isMemoryOrigin(value.origin) ||
    !isMemoryConfidence(value.confidence) ||
    typeof value.content !== "string" ||
    !isOptionalJsonObjectArray(value.sourceRefs) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return undefined;
  }

  return {
    schemaVersion: "1.0",
    id: value.id,
    type: value.type,
    title: value.title,
    status: value.status,
    origin: value.origin,
    confidence: value.confidence,
    content: value.content,
    ...(value.sourceRefs === undefined ? {} : { sourceRefs: value.sourceRefs }),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function toStoryBibleContextCandidateOptions(
  value: unknown
): StoryBibleContextCandidateOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (!isOptionalStoryBibleStatusArray(value.includeStatuses)) {
    return undefined;
  }

  return {
    ...(value.includeStatuses === undefined ? {} : { includeStatuses: value.includeStatuses })
  };
}

function toCreativePreviewRequest(
  value: unknown
): { readonly parentSelectionId: string; readonly folderName: string } | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["parentSelectionId", "folderName"]) ||
    !isNonEmptyString(value["parentSelectionId"]) ||
    !isNonEmptyString(value["folderName"])
  ) {
    return undefined;
  }
  return {
    parentSelectionId: value["parentSelectionId"],
    folderName: value["folderName"]
  };
}

function toCreativeFolderConfirmationRequest(
  value: unknown
): CreativeFolderConfirmationRequest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["selectionId", "relativePaths"]) ||
    !isNonEmptyString(value["selectionId"]) ||
    !Array.isArray(value["relativePaths"]) ||
    value["relativePaths"].length === 0 ||
    value["relativePaths"].length > DEFAULT_CREATIVE_PROJECT_FILE_POLICY.maxItems ||
    !value["relativePaths"].every(
      (path): path is string =>
        typeof path === "string" &&
        path.length > 0 &&
        path.length <= DEFAULT_CREATIVE_PROJECT_FILE_POLICY.maxPathLength &&
        !isAbsolute(path) &&
        !path.includes("/") &&
        !path.includes("\\") &&
        path !== "." &&
        path !== ".."
    )
  ) {
    return undefined;
  }
  return { selectionId: value["selectionId"], relativePaths: value["relativePaths"] };
}

function toCreateCreativeProjectRequest(value: unknown):
  | {
      readonly parentSelectionId: string;
      readonly folderName: string;
      readonly projectId: string;
      readonly title: string;
      readonly language: string;
      readonly projectType?: string;
      readonly targetWordCount?: number;
    }
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "parentSelectionId",
      "folderName",
      "projectId",
      "title",
      "language",
      "projectType",
      "targetWordCount"
    ]) ||
    !isNonEmptyString(value["parentSelectionId"]) ||
    !isNonEmptyString(value["folderName"]) ||
    !isSafeId(value["projectId"]) ||
    !isNonEmptyString(value["title"]) ||
    !isNonEmptyString(value["language"]) ||
    (value["projectType"] !== undefined && !isNonEmptyString(value["projectType"])) ||
    (value["targetWordCount"] !== undefined && !isNonNegativeInteger(value["targetWordCount"]))
  ) {
    return undefined;
  }
  return {
    parentSelectionId: value["parentSelectionId"],
    folderName: value["folderName"],
    projectId: value["projectId"],
    title: value["title"],
    language: value["language"],
    ...(value["projectType"] === undefined ? {} : { projectType: value["projectType"] }),
    ...(value["targetWordCount"] === undefined ? {} : { targetWordCount: value["targetWordCount"] })
  };
}

function toEngineeringTextFileSaveRequest(
  value: unknown
):
  | { readonly path: string; readonly content: string; readonly expectedChecksum: string }
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "content", "expectedChecksum"]) ||
    !isNonEmptyString(value["path"]) ||
    typeof value["content"] !== "string" ||
    !isNonEmptyString(value["expectedChecksum"])
  ) {
    return undefined;
  }
  return {
    path: value["path"],
    content: value["content"],
    expectedChecksum: value["expectedChecksum"]
  };
}

function toCreativeProjectFileIdentity(
  value: unknown
): CreativeProjectFileSessionIdentity | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["projectId", "workspaceId"]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["workspaceId"])
  ) {
    return undefined;
  }
  return { projectId: value["projectId"], workspaceId: value["workspaceId"] };
}

function toCreativeProjectFileReadRequest(
  value: unknown
): (CreativeProjectFileSessionIdentity & { readonly path: string }) | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["projectId", "workspaceId", "path"])) {
    return undefined;
  }
  const identity = toCreativeProjectFileIdentity({
    projectId: value["projectId"],
    workspaceId: value["workspaceId"]
  });
  if (
    identity === undefined ||
    typeof value["path"] !== "string" ||
    !normalizeCreativeProjectFilePath(value["path"], "file").ok
  ) {
    return undefined;
  }
  return { ...identity, path: value["path"] };
}

function toCreativeProjectFileSaveRequest(value: unknown):
  | (CreativeProjectFileSessionIdentity & {
      readonly path: string;
      readonly content: string;
      readonly expectedTreeRevision: string;
      readonly expectedNodeRevision: string;
      readonly expectedChecksum: string;
    })
  | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "projectId",
      "workspaceId",
      "path",
      "content",
      "expectedTreeRevision",
      "expectedNodeRevision",
      "expectedChecksum"
    ])
  ) {
    return undefined;
  }
  const read = toCreativeProjectFileReadRequest({
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
    path: value["path"]
  });
  if (
    read === undefined ||
    typeof value["content"] !== "string" ||
    !isNonEmptyString(value["expectedTreeRevision"]) ||
    !isNonEmptyString(value["expectedNodeRevision"]) ||
    !isNonEmptyString(value["expectedChecksum"])
  ) {
    return undefined;
  }
  return {
    ...read,
    content: value["content"],
    expectedTreeRevision: value["expectedTreeRevision"],
    expectedNodeRevision: value["expectedNodeRevision"],
    expectedChecksum: value["expectedChecksum"]
  };
}

function toCreativeProjectFileLifecycleCommand(
  value: unknown
): CreativeProjectFileLifecycleCommand | undefined {
  if (!isRecord(value)) return undefined;
  const baseKeys = [
    "schemaVersion",
    "commandId",
    "kind",
    "projectId",
    "workspaceId",
    "expectedTreeRevision"
  ];
  if (
    value["schemaVersion"] !== "1.0" ||
    !isSafeId(value["commandId"]) ||
    !isSafeId(value["projectId"]) ||
    !isSafeId(value["workspaceId"]) ||
    !isNonEmptyString(value["expectedTreeRevision"])
  ) {
    return undefined;
  }
  const base = {
    schemaVersion: "1.0" as const,
    commandId: value["commandId"],
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
    expectedTreeRevision: value["expectedTreeRevision"]
  };
  if (
    value["kind"] === "createTextFile" &&
    hasOnlyKeys(value, [...baseKeys, "path", "content"]) &&
    typeof value["path"] === "string" &&
    normalizeCreativeProjectFilePath(value["path"], "file").ok &&
    typeof value["content"] === "string"
  ) {
    return { ...base, kind: "createTextFile", path: value["path"], content: value["content"] };
  }
  if (
    value["kind"] === "createDirectory" &&
    hasOnlyKeys(value, [...baseKeys, "path"]) &&
    typeof value["path"] === "string" &&
    normalizeCreativeProjectFilePath(value["path"], "directory").ok
  ) {
    return { ...base, kind: "createDirectory", path: value["path"] };
  }
  if (
    value["kind"] === "renamePath" &&
    hasOnlyKeys(value, [...baseKeys, "sourcePath", "targetPath", "expectedSourceRevision"]) &&
    typeof value["sourcePath"] === "string" &&
    typeof value["targetPath"] === "string" &&
    normalizeCreativeProjectFilePath(value["sourcePath"], "any").ok &&
    normalizeCreativeProjectFilePath(value["targetPath"], "any").ok &&
    isNonEmptyString(value["expectedSourceRevision"])
  ) {
    return {
      ...base,
      kind: "renamePath",
      sourcePath: value["sourcePath"],
      targetPath: value["targetPath"],
      expectedSourceRevision: value["expectedSourceRevision"]
    };
  }
  if (
    value["kind"] === "deleteFile" &&
    hasOnlyKeys(value, [...baseKeys, "path", "expectedSourceRevision", "confirmed"]) &&
    typeof value["path"] === "string" &&
    normalizeCreativeProjectFilePath(value["path"], "file").ok &&
    isNonEmptyString(value["expectedSourceRevision"]) &&
    value["confirmed"] === true
  ) {
    return {
      ...base,
      kind: "deleteFile",
      path: value["path"],
      expectedSourceRevision: value["expectedSourceRevision"],
      confirmed: true
    };
  }
  if (
    value["kind"] === "deleteEmptyDirectory" &&
    hasOnlyKeys(value, [...baseKeys, "path", "expectedSourceRevision", "confirmed"]) &&
    typeof value["path"] === "string" &&
    normalizeCreativeProjectFilePath(value["path"], "directory").ok &&
    isNonEmptyString(value["expectedSourceRevision"]) &&
    value["confirmed"] === true
  ) {
    return {
      ...base,
      kind: "deleteEmptyDirectory",
      path: value["path"],
      expectedSourceRevision: value["expectedSourceRevision"],
      confirmed: true
    };
  }
  return undefined;
}

function isCreativeProjectFileLifecycleAllowedByIpc(
  command: CreativeProjectFileLifecycleCommand,
  session: CreativeProjectFileSession
): boolean {
  if (command.kind !== "renamePath") return true;
  const snapshot = session.getSnapshot();
  const source =
    snapshot === undefined
      ? undefined
      : findCreativeProjectFileTreeNode(snapshot.nodes, command.sourcePath);
  return (
    source !== undefined && normalizeCreativeProjectFilePath(command.targetPath, source.kind).ok
  );
}

function findCreativeProjectFileTreeNode(
  nodes: readonly import("@novel-studio/application").CreativeProjectFileTreeNode[],
  path: string
): import("@novel-studio/application").CreativeProjectFileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findCreativeProjectFileTreeNode(node.children ?? [], path);
    if (child !== undefined) return child;
  }
  return undefined;
}

function invalidWorkspaceRequest<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_REQUEST_INVALID",
      category: "ValidationError",
      message: "The workspace request is invalid.",
      recoverability: "user-action",
      suggestedAction: "Review the workspace selection and try again.",
      traceId: "desktop-workspace-ipc"
    })
  );
}

function withActiveEngineeringRootBindingActivation(
  result: Result<WorkspaceActivationDto, UnifiedError>,
  rootBindingId: string | undefined
): Result<WorkspaceActivationDto, UnifiedError> {
  if (!result.ok || rootBindingId === undefined || !("engineeringWorkspace" in result.value)) {
    return result;
  }
  return ok({
    ...result.value,
    engineeringWorkspace: {
      ...result.value.engineeringWorkspace,
      rootBindingId
    }
  });
}

function withActiveEngineeringRootBindingSnapshot(
  result: Result<EngineeringWorkspaceSnapshot, UnifiedError>,
  rootBindingId: string | undefined
): Result<EngineeringWorkspaceSnapshot, UnifiedError> {
  if (!result.ok || rootBindingId === undefined) return result;
  return ok({ ...result.value, rootBindingId });
}

function workspaceActivationUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "WORKSPACE_ACTIVATION_UNAVAILABLE",
      category: "StorageError",
      message: "Workspace activation is unavailable.",
      recoverability: "retryable",
      suggestedAction: "Restart Novel Studio and try again.",
      traceId: "desktop-workspace-ipc"
    })
  );
}

function projectConventionsUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "PROJECT_CONVENTIONS_UNAVAILABLE",
    category: "UserError",
    message: "Project conventions require an active workspace.",
    recoverability: "user-action",
    suggestedAction: "Open a creative project or engineering workspace and try again.",
    traceId: "desktop-project-conventions-file"
  });
}

function workspaceContextPolicyUnavailable(): UnifiedError {
  return createUnifiedError({
    code: "WORKSPACE_CONTEXT_POLICY_UNAVAILABLE",
    category: "UserError",
    message: "Workspace context policy requires an active workspace.",
    recoverability: "user-action",
    suggestedAction: "Open a creative project or engineering workspace and try again.",
    traceId: "desktop-workspace-context-policy"
  });
}

function creativeGeneralActiveResourceUnavailable(reason: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CREATIVE_GENERAL_ACTIVE_RESOURCE_UNVERIFIED",
    category: "ValidationError",
    message: "A verified active creative project file is required for general file context.",
    recoverability: "user-action",
    suggestedAction: "Open the file from the project Files surface and retry.",
    traceId: "desktop-creative-general-active-resource-ipc",
    redactedDetail: { reason }
  });
}

function toWorkspaceContextPolicyAction(value: unknown):
  | { readonly action: "disable_conventions" | "revoke_workspace_trust" }
  | {
      readonly action: "set_source_preference";
      readonly preference: WorkspaceContextSourcePreferenceMutation;
    }
  | {
      readonly action: "set_sharing_defaults";
      readonly defaults: WorkspaceModelSharingDefaults | null;
    }
  | undefined {
  if (!isRecord(value)) return undefined;
  if (value["action"] === "disable_conventions" || value["action"] === "revoke_workspace_trust") {
    return { action: value["action"] };
  }
  if (value["action"] === "set_sharing_defaults") {
    if (!hasOnlyKeys(value, ["action", "defaults"])) return undefined;
    const defaults = value["defaults"];
    if (defaults !== null && !isWorkspaceModelSharingDefaults(defaults)) return undefined;
    return { action: "set_sharing_defaults", defaults };
  }
  if (
    value["action"] !== "set_source_preference" ||
    !hasOnlyKeys(value, ["action", "preference"])
  ) {
    return undefined;
  }
  const preference = parseWorkspaceContextSourcePreferenceMutation(value["preference"]);
  return preference === undefined ? undefined : { action: "set_source_preference", preference };
}

function isWorkspaceModelSharingDefaults(value: unknown): value is WorkspaceModelSharingDefaults {
  if (!isRecord(value)) return false;
  return (
    (value["outlineMetadata"] === "off" || value["outlineMetadata"] === "automatic") &&
    (value["activeResource"] === "off" || value["activeResource"] === "automatic") &&
    (value["conversationSummary"] === "allow" ||
      value["conversationSummary"] === "ask" ||
      value["conversationSummary"] === "deny") &&
    (value["toolReadResults"] === "allow" ||
      value["toolReadResults"] === "ask" ||
      value["toolReadResults"] === "deny")
  );
}

function directorySelectionFailed(): UnifiedError {
  return createUnifiedError({
    code: "DIRECTORY_SELECTION_FAILED",
    category: "StorageError",
    message: "The selected directory could not be resolved.",
    recoverability: "user-action",
    suggestedAction: "Choose an existing directory and try again.",
    traceId: "desktop-directory-selection"
  });
}

function directorySelectionInvalid(): UnifiedError {
  return createUnifiedError({
    code: "DIRECTORY_SELECTION_INVALID",
    category: "ValidationError",
    message: "The directory selection has expired or is invalid.",
    recoverability: "user-action",
    suggestedAction: "Choose the directory again.",
    traceId: "desktop-directory-selection"
  });
}

function creativeFolderInvalid(message: string): UnifiedError {
  return createUnifiedError({
    code: "CREATIVE_FOLDER_INVALID",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "修复目录内容或重新选择一个普通正文文件夹。",
    traceId: "desktop-creative-folder-import"
  });
}

function creativeFolderTargetConflict(): UnifiedError {
  return createUnifiedError({
    code: "CREATIVE_FOLDER_TARGET_CONFLICT",
    category: "UserError",
    message: "同级目标项目目录已存在。",
    recoverability: "user-action",
    suggestedAction: "移走已有目标目录后重试。",
    traceId: "desktop-creative-folder-import"
  });
}

function fileIdentity(stats: Awaited<ReturnType<typeof lstat>>): string {
  return `${stats.dev}:${stats.ino}`;
}

async function lstatIfPresent(
  path: string
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function projectTextFileSelectionInvalid(): UnifiedError {
  return createUnifiedError({
    code: "PROJECT_FILE_SELECTION_INVALID",
    category: "ValidationError",
    message: "只能添加当前项目目录内的现有文件。",
    recoverability: "user-action",
    suggestedAction: "Choose a file inside the active workspace and try again.",
    traceId: "project-file-selection"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConfigAssetType(value: unknown): value is ConfigAssetType {
  return value === "prompt" || value === "agent" || value === "workflow";
}

function toModelProfile(value: unknown): ModelProfile | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.apiKeyRef !== "string" ||
    typeof value.modelName !== "string" ||
    typeof value.temperature !== "number" ||
    typeof value.maxTokens !== "number" ||
    typeof value.timeoutMs !== "number"
  ) {
    return undefined;
  }
  if (
    !isOptionalString(value.baseUrl) ||
    !isOptionalPositiveSafeInteger(value.contextWindow) ||
    !isOptionalNumber(value.topP) ||
    !isOptionalNumber(value.frequencyPenalty) ||
    !isOptionalNumber(value.presencePenalty) ||
    !isOptionalBoolean(value.reasoningEffortEnabled)
  ) {
    return undefined;
  }

  return {
    id: value.id,
    provider: value.provider,
    displayName: value.displayName,
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl }),
    apiKeyRef: value.apiKeyRef,
    modelName: value.modelName,
    ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
    temperature: value.temperature,
    maxTokens: value.maxTokens,
    ...(value.topP === undefined ? {} : { topP: value.topP }),
    timeoutMs: value.timeoutMs,
    ...(value.frequencyPenalty === undefined ? {} : { frequencyPenalty: value.frequencyPenalty }),
    ...(value.presencePenalty === undefined ? {} : { presencePenalty: value.presencePenalty }),
    ...(value.reasoningEffortEnabled === undefined
      ? {}
      : { reasoningEffortEnabled: value.reasoningEffortEnabled })
  };
}

function optionalModelProfileFromIpc(value: unknown): ModelProfile | undefined {
  if (value === undefined) return undefined;
  return toModelProfile(value) ?? emptyModelProfile();
}

function isSaveModelProfileOptions(value: unknown): value is { readonly makeDefault?: boolean } {
  if (!isRecord(value)) {
    return false;
  }
  return value.makeDefault === undefined || typeof value.makeDefault === "boolean";
}

function toConfigAssetSaveInput(value: unknown): ConfigAssetSaveInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isConfigAssetType(value.assetType) ||
    typeof value.assetId !== "string" ||
    !isJsonObject(value.content) ||
    !isOptionalConfigCreatedBy(value.createdBy)
  ) {
    return undefined;
  }

  return {
    assetType: value.assetType,
    assetId: value.assetId,
    content: value.content,
    ...(value.createdBy === undefined ? {} : { createdBy: value.createdBy })
  };
}

function toCreateChapterInput(value: unknown): CreateChapterInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.chapterId !== "string" ||
    typeof value.title !== "string" ||
    !isOptionalString(value.body) ||
    !isOptionalNumber(value.order) ||
    !isOptionalChapterStatus(value.status)
  ) {
    return undefined;
  }

  return {
    chapterId: value.chapterId,
    title: value.title,
    ...(value.body === undefined ? {} : { body: value.body }),
    ...(value.order === undefined ? {} : { order: value.order }),
    ...(value.status === undefined ? {} : { status: value.status })
  };
}

function toRenameChapterInput(value: unknown): RenameChapterInput {
  if (!isRecord(value) || typeof value.chapterId !== "string" || typeof value.title !== "string") {
    return { chapterId: "", title: "" };
  }

  return {
    chapterId: value.chapterId,
    title: value.title
  };
}

function toDuplicateChapterInput(value: unknown): DuplicateChapterInput {
  if (
    !isRecord(value) ||
    typeof value.sourceChapterId !== "string" ||
    typeof value.chapterId !== "string" ||
    typeof value.title !== "string"
  ) {
    return { sourceChapterId: "", chapterId: "", title: "" };
  }

  return {
    sourceChapterId: value.sourceChapterId,
    chapterId: value.chapterId,
    title: value.title
  };
}

function toDeleteChapterInput(value: unknown): DeleteChapterInput {
  if (!isRecord(value) || typeof value.chapterId !== "string") {
    return { chapterId: "" };
  }

  return {
    chapterId: value.chapterId
  };
}

function toAiWritingSuggestionRequest(value: unknown): AiWritingSuggestionRequest {
  if (!isRecord(value) || typeof value.instruction !== "string") {
    return { instruction: "" };
  }

  return {
    instruction: value.instruction,
    ...(isLlmReasoningEffort(value.reasoningEffort)
      ? { reasoningEffort: value.reasoningEffort }
      : {})
  };
}

function toAiWritingSuggestionStreamStartRequest(
  value: unknown
): AiWritingSuggestionStreamStartRequest | undefined {
  if (!isRecord(value) || typeof value.streamId !== "string" || value.streamId.length === 0) {
    return undefined;
  }
  const request = toAiWritingSuggestionRequest(value);
  if (request.instruction.length === 0) {
    return undefined;
  }
  return {
    streamId: value.streamId,
    ...request
  };
}

function isLlmReasoningEffort(
  value: unknown
): value is NonNullable<AiWritingSuggestionRequest["reasoningEffort"]> {
  return isNonEmptyString(value);
}

function toAiWritingSelectionPreviewRequest(value: unknown): AiWritingSelectionPreviewRequest {
  if (
    !isRecord(value) ||
    typeof value.instruction !== "string" ||
    !isRecord(value.selection) ||
    typeof value.selection.startOffset !== "number" ||
    typeof value.selection.endOffset !== "number" ||
    typeof value.selection.selectedText !== "string"
  ) {
    return {
      instruction: "",
      selection: {
        startOffset: 0,
        endOffset: 0,
        selectedText: ""
      }
    };
  }

  return {
    instruction: value.instruction,
    selection: {
      startOffset: value.selection.startOffset,
      endOffset: value.selection.endOffset,
      selectedText: value.selection.selectedText
    }
  };
}

function toSearchQuery(value: unknown): ProjectSearchQuery {
  if (!isRecord(value) || typeof value.query !== "string") {
    return { query: "" };
  }

  return {
    query: value.query,
    ...(typeof value.limit === "number" ? { limit: value.limit } : {})
  };
}

function toConfigAssetRestoreInput(value: unknown): ConfigAssetRestoreInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    !isConfigAssetType(value.assetType) ||
    typeof value.assetId !== "string" ||
    typeof value.versionId !== "string" ||
    !isOptionalConfigCreatedBy(value.createdBy)
  ) {
    return undefined;
  }

  return {
    assetType: value.assetType,
    assetId: value.assetId,
    versionId: value.versionId,
    ...(value.createdBy === undefined ? {} : { createdBy: value.createdBy })
  };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((entry) => typeof entry === "string"))
  );
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isOptionalPositiveSafeInteger(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isOptionalChapterStatus(value: unknown): value is CreateChapterInput["status"] {
  return (
    value === undefined ||
    value === "draft" ||
    value === "revision" ||
    value === "review" ||
    value === "done" ||
    value === "archived" ||
    value === "deleted"
  );
}

function isOptionalConfigCreatedBy(value: unknown): value is ConfigAssetSaveInput["createdBy"] {
  return value === undefined || value === "user" || value === "system" || value === "migration";
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isOptionalJsonObject(value: unknown): value is JsonObject | undefined {
  return value === undefined || isJsonObject(value);
}

function isOptionalJsonObjectArray(value: unknown): value is JsonObject[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isJsonObject));
}

function isStoryBibleAssetType(value: unknown): value is StoryBibleAsset["type"] {
  return (
    value === "character" ||
    value === "world.location" ||
    value === "world.faction" ||
    value === "world.rule" ||
    value === "world.glossary" ||
    value === "world.item" ||
    value === "world.lore" ||
    value === "outline" ||
    value === "foreshadow" ||
    value === "timeline.events"
  );
}

function isForeshadowDetails(value: unknown): value is ForeshadowAsset["details"] {
  return (
    isJsonObject(value) &&
    isForeshadowTrackingStatus(value.trackingStatus) &&
    isOptionalString(value.plantedChapterId) &&
    isOptionalString(value.plannedPayoffChapterId) &&
    isOptionalString(value.actualPayoffChapterId) &&
    (value.sourceRefs === undefined ||
      (Array.isArray(value.sourceRefs) && value.sourceRefs.every(isForeshadowSourceRef))) &&
    (value.origin === undefined || value.origin === "manual" || value.origin === "ai-confirmed") &&
    isOptionalString(value.notes)
  );
}

function isForeshadowTrackingStatus(
  value: unknown
): value is ForeshadowAsset["details"]["trackingStatus"] {
  return (
    value === "planned" ||
    value === "planted" ||
    value === "progressing" ||
    value === "ready-to-payoff" ||
    value === "paid-off" ||
    value === "abandoned"
  );
}

function isForeshadowSourceRef(value: unknown): boolean {
  return (
    isJsonObject(value) &&
    typeof value.chapterId === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.excerptHash === "string"
  );
}

function isStoryBibleEntityStatus(value: unknown): value is StoryBibleAsset["status"] {
  return value === "active" || value === "draft" || value === "archived" || value === "deleted";
}

function isOptionalStoryBibleStatusArray(
  value: unknown
): value is StoryBibleAsset["status"][] | undefined {
  return value === undefined || (Array.isArray(value) && value.every(isStoryBibleEntityStatus));
}

function isMemoryRecordType(value: unknown): value is MemoryRecord["type"] {
  return value === "memory.long-term" || value === "memory.style" || value === "memory.summary";
}

function isMemoryOrigin(value: unknown): value is MemoryRecord["origin"] {
  return value === "user" || value === "user-confirmed-ai" || value === "ai-unconfirmed";
}

function isMemoryConfidence(value: unknown): value is MemoryRecord["confidence"] {
  return value === "confirmed" || value === "needs-review" || value === "deprecated";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

function emptyModelProfile(): ModelProfile {
  return {
    id: "",
    provider: "",
    displayName: "",
    apiKeyRef: "secret://invalid",
    modelName: "",
    temperature: 0,
    maxTokens: 1,
    timeoutMs: 1000
  };
}

function emptyStoryBibleAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "",
    type: "character",
    title: "",
    status: "draft",
    summary: "",
    createdAt: "",
    updatedAt: ""
  };
}

function emptyMemoryRecord(): MemoryRecord {
  return {
    schemaVersion: "1.0",
    id: "",
    type: "memory.long-term",
    title: "",
    status: "draft",
    origin: "user",
    confidence: "needs-review",
    content: "",
    createdAt: "",
    updatedAt: ""
  };
}
