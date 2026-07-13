import { createDesktopApplication } from "@novel-studio/application";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  AgentRunSession,
  AnswerAgentUserInputCommand,
  ApplicationIpcChannel,
  DesktopApplication
} from "@novel-studio/application";
import type {
  AgentRunEvent,
  StartAgentRunCommand,
  StopAgentRunCommand
} from "@novel-studio/agent-engine";
import { ok, type JsonObject, type JsonValue } from "@novel-studio/shared";
import { writeTextAtomically } from "@novel-studio/repository";
import type {
  AiWritingSuggestionStreamEvent,
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetType,
  CreateProjectInput,
  AiWritingSelectionPreviewRequest,
  AiWritingSuggestionRequest,
  AiWritingSuggestionStreamPushEvent,
  AiWritingSuggestionStreamStartRequest,
  ModelProfile,
  MemoryRecord,
  ProjectSearchQuery,
  ProjectDirectoryTreeItem,
  StoryBibleAsset,
  StoryBibleContextCandidateOptions,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type {
  CreateChapterInput,
  DeleteChapterInput,
  DuplicateChapterInput,
  RenameChapterInput,
  Result,
  UnifiedError
} from "@novel-studio/shared";
import { createUnifiedError, err } from "@novel-studio/shared";
import type { ModelSecretStore } from "./model-runtime.js";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export interface ApplicationIpcHandlerOptions {
  readonly chooseOpenProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseCreateProjectDirectory?: () => Promise<string | undefined>;
  readonly modelSecretStore?: ModelSecretStore;
  readonly publishAiSuggestionStreamEvent?: (event: AiWritingSuggestionStreamPushEvent) => void;
  readonly agentRunSession?: AgentRunSession;
  readonly publishAgentRunEvent?: (event: AgentRunEvent) => void;
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
  let nextAiSuggestionStreamId = 0;
  options.agentRunSession?.subscribe((event) => {
    try {
      options.publishAgentRunEvent?.(structuredClone(event));
    } catch {
      // AgentRunSession owns contract failure handling; never forward a non-cloneable payload.
    }
  });

  return {
    "application:get-shell-state": () => Promise.resolve(application.getShellState()),
    "application:list-commands": () => Promise.resolve(application.listCommands()),
    "application:execute-command": (commandId: unknown) => {
      if (typeof commandId !== "string") {
        return Promise.resolve(application.executeCommand(""));
      }

      return Promise.resolve(application.executeCommand(commandId));
    },
    "application:project:choose-open-directory": async () => {
      const projectRoot = await options.chooseOpenProjectDirectory?.();

      return ok(projectRoot === undefined ? { canceled: true } : { canceled: false, projectRoot });
    },
    "application:project:choose-create-directory": async () => {
      const projectRoot = await options.chooseCreateProjectDirectory?.();

      return ok(projectRoot === undefined ? { canceled: true } : { canceled: false, projectRoot });
    },
    "application:project:open": (projectRoot: unknown) => {
      if (typeof projectRoot !== "string") {
        return application.openProject("");
      }

      return application.openProject(projectRoot);
    },
    "application:project:read-directory": (projectRoot: unknown) => {
      if (typeof projectRoot !== "string") {
        return readProjectDirectory("");
      }

      return readProjectDirectory(projectRoot);
    },
    "application:file:read-text": (projectRoot: unknown, path: unknown) => {
      if (typeof projectRoot !== "string" || typeof path !== "string") {
        return readProjectTextFile("", "");
      }

      return readProjectTextFile(projectRoot, path);
    },
    "application:file:write-text": (projectRoot: unknown, path: unknown, content: unknown) => {
      if (
        typeof projectRoot !== "string" ||
        typeof path !== "string" ||
        typeof content !== "string"
      ) {
        return writeProjectTextFile("", "", "");
      }

      return writeProjectTextFile(projectRoot, path, content);
    },
    "application:project:create": (input: unknown) => {
      const createInput = toCreateProjectInput(input);
      if (createInput === undefined) {
        return application.createProject({
          projectRoot: "",
          projectId: "",
          title: "",
          language: ""
        });
      }

      return application.createProject(createInput);
    },
    "application:project:list-chapters": () => application.listProjectChapters(),
    "application:project:create-chapter": (input: unknown) => {
      const createInput = toCreateChapterInput(input);
      if (createInput === undefined) {
        return application.createProjectChapter({
          chapterId: "",
          title: ""
        });
      }

      return application.createProjectChapter(createInput);
    },
    "application:project:rename-chapter": (input: unknown) => {
      return application.renameProjectChapter(toRenameChapterInput(input));
    },
    "application:project:duplicate-chapter": (input: unknown) => {
      return application.duplicateProjectChapter(toDuplicateChapterInput(input));
    },
    "application:project:delete-chapter": (input: unknown) => {
      return application.deleteProjectChapter(toDeleteChapterInput(input));
    },
    "application:project:select-chapter": (chapterId: unknown) => {
      if (typeof chapterId !== "string") {
        return application.selectProjectChapter("");
      }

      return application.selectProjectChapter(chapterId);
    },
    "application:project:preview-recovery-draft": (sessionId: unknown) => {
      if (typeof sessionId !== "string") {
        return application.previewRecoveryDraft("");
      }

      return application.previewRecoveryDraft(sessionId);
    },
    "application:project:apply-recovery-draft": (sessionId: unknown) => {
      if (typeof sessionId !== "string") {
        return application.applyRecoveryDraft("");
      }

      return application.applyRecoveryDraft(sessionId);
    },
    "application:project:discard-recovery-draft": (sessionId: unknown) => {
      if (typeof sessionId !== "string") {
        return application.discardRecoveryDraft("");
      }

      return application.discardRecoveryDraft(sessionId);
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
    "application:agent-run:start": (command: unknown) => {
      const parsed = toStartAgentRunCommand(command);
      return parsed === undefined || options.agentRunSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : options.agentRunSession.startAgentRun(parsed);
    },
    "application:agent-run:stop": (command: unknown) => {
      const parsed = toStopAgentRunCommand(command);
      return parsed === undefined || options.agentRunSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : options.agentRunSession.stopAgentRun(parsed);
    },
    "application:agent-run:answer-user-input": (command: unknown) => {
      const parsed = toAnswerAgentUserInputCommand(command);
      return parsed === undefined || options.agentRunSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : options.agentRunSession.answerUserInput(parsed);
    },
    "application:agent-run:read": (runId: unknown) =>
      typeof runId !== "string" || options.agentRunSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : options.agentRunSession.readAgentRun(runId),
    "application:agent-run:list": (projectId: unknown) =>
      typeof projectId !== "string" || options.agentRunSession === undefined
        ? Promise.resolve(agentRunUnavailable())
        : options.agentRunSession.listAgentRuns(projectId),
    "application:chapter:load": () => application.loadActiveChapter(),
    "application:chapter:edit": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return application.editActiveChapter("");
      }

      return application.editActiveChapter(nextBody);
    },
    "application:chapter:save": () => application.saveActiveChapter(),
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
    "application:settings:list-model-profiles": () => application.listModelProfiles(),
    "application:settings:discover-models": (profileId: unknown) => {
      if (typeof profileId !== "string") {
        return application.discoverModelOptions("");
      }

      return application.discoverModelOptions(profileId);
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

      return options.modelSecretStore.saveSecret(secretRef, secret);
    },
    "application:settings:test-model-profile": (profileId: unknown) => {
      if (typeof profileId !== "string") {
        return application.testModelProfileConnection("");
      }

      return application.testModelProfileConnection(profileId);
    },
    "application:plugins:load-registry": () => application.loadPluginRegistry(),
    "application:plugins:set-enabled": (pluginId: unknown, enabled: unknown) => {
      if (typeof pluginId !== "string" || typeof enabled !== "boolean") {
        return application.setPluginEnabled("", false);
      }

      return application.setPluginEnabled(pluginId, enabled);
    },
    "application:story-bible:load": () => application.loadStoryBible(),
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
      application.saveUserPreferences(toUserPreferencesSaveInput(input))
  };
}

function toStartAgentRunCommand(value: unknown): StartAgentRunCommand | undefined {
  return isRecord(value) ? (value as unknown as StartAgentRunCommand) : undefined;
}

function toStopAgentRunCommand(value: unknown): StopAgentRunCommand | undefined {
  return isRecord(value) ? (value as unknown as StopAgentRunCommand) : undefined;
}

function toAnswerAgentUserInputCommand(value: unknown): AnswerAgentUserInputCommand | undefined {
  return isRecord(value) ? (value as unknown as AnswerAgentUserInputCommand) : undefined;
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

const DIRECTORY_READ_MAX_DEPTH = 4;
const DIRECTORY_READ_MAX_ITEMS = 300;
const TEXT_FILE_READ_MAX_BYTES = 5 * 1024 * 1024;
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules", "dist", "release"]);

async function readProjectDirectory(
  projectRoot: string
): Promise<Result<ProjectDirectoryTreeItem[], UnifiedError>> {
  if (projectRoot.trim().length === 0) {
    return err(
      createUnifiedError({
        code: "PROJECT_DIRECTORY_READ_FAILED",
        category: "StorageError",
        message: "Project directory could not be read.",
        recoverability: "user-action",
        suggestedAction: "Choose a folder that exists on this computer.",
        traceId: "project-directory-tree"
      })
    );
  }

  try {
    let count = 0;
    const items = await readDirectoryChildren(projectRoot, projectRoot, 0, () => {
      count += 1;
      return count <= DIRECTORY_READ_MAX_ITEMS;
    });
    return ok(items);
  } catch (error) {
    return err(
      createUnifiedError({
        code: "PROJECT_DIRECTORY_READ_FAILED",
        category: "StorageError",
        message: "Project directory could not be read.",
        recoverability: "user-action",
        suggestedAction: "Choose a folder that exists on this computer.",
        traceId: "project-directory-tree",
        redactedDetail: {
          reason: error instanceof Error ? error.message : "Unknown directory read error"
        }
      })
    );
  }
}

async function readDirectoryChildren(
  root: string,
  directory: string,
  depth: number,
  canReadMore: () => boolean
): Promise<ProjectDirectoryTreeItem[]> {
  if (depth > DIRECTORY_READ_MAX_DEPTH || !canReadMore()) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith(".") || entry.name === ".novel-studio")
    .filter((entry) => !(entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  const items: ProjectDirectoryTreeItem[] = [];
  for (const entry of visibleEntries) {
    if (!canReadMore()) {
      break;
    }

    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      items.push({
        id: `folder:${relativePath}`,
        name: entry.name,
        kind: "directory",
        path: relativePath,
        children: await readDirectoryChildren(root, absolutePath, depth + 1, canReadMore)
      });
      continue;
    }

    if (entry.isFile()) {
      items.push({
        id: `file:${relativePath}`,
        name: entry.name,
        kind: "file",
        path: relativePath
      });
    }
  }

  return items;
}

async function readProjectTextFile(
  projectRoot: string,
  filePath: string
): Promise<Result<{ readonly path: string; readonly content: string }, UnifiedError>> {
  const resolved = resolveProjectFilePath(projectRoot, filePath);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const fileStats = await stat(resolved.value.absolutePath);
    if (!fileStats.isFile()) {
      return fileOperationFailed({
        code: "FILE_READ_FAILED",
        message: "Text file could not be read.",
        suggestedAction: "Choose a text file inside the opened folder.",
        reason: "Target path is not a file."
      });
    }
    if (fileStats.size > TEXT_FILE_READ_MAX_BYTES) {
      return fileOperationFailed({
        code: "FILE_TOO_LARGE",
        message: "Text file is too large to open in the editor.",
        suggestedAction: "Open a smaller text file.",
        reason: `File size ${fileStats.size} exceeds ${TEXT_FILE_READ_MAX_BYTES} bytes.`
      });
    }

    return ok({
      path: resolved.value.relativePath,
      content: await readFile(resolved.value.absolutePath, "utf8")
    });
  } catch (error) {
    return fileOperationFailed({
      code: "FILE_READ_FAILED",
      message: "Text file could not be read.",
      suggestedAction: "Choose a readable text file inside the opened folder.",
      reason: error instanceof Error ? error.message : "Unknown file read error"
    });
  }
}

async function writeProjectTextFile(
  projectRoot: string,
  filePath: string,
  content: string
): Promise<Result<{ readonly path: string }, UnifiedError>> {
  const resolved = resolveProjectFilePath(projectRoot, filePath);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const fileStats = await stat(resolved.value.absolutePath);
    if (!fileStats.isFile()) {
      return fileOperationFailed({
        code: "FILE_WRITE_FAILED",
        message: "Text file could not be written.",
        suggestedAction: "Choose a text file inside the opened folder.",
        reason: "Target path is not a file."
      });
    }
  } catch (error) {
    return fileOperationFailed({
      code: "FILE_WRITE_FAILED",
      message: "Text file could not be written.",
      suggestedAction: "Choose an existing writable text file inside the opened folder.",
      reason: error instanceof Error ? error.message : "Unknown file stat error"
    });
  }

  const written = await writeTextAtomically({
    targetPath: resolved.value.absolutePath,
    content,
    traceId: "project-text-file"
  });
  if (!written.ok) {
    return written;
  }

  return ok({ path: resolved.value.relativePath });
}

function resolveProjectFilePath(
  projectRoot: string,
  filePath: string
): Result<{ readonly absolutePath: string; readonly relativePath: string }, UnifiedError> {
  const trimmedRoot = projectRoot.trim();
  const trimmedPath = filePath.trim();
  if (trimmedRoot.length === 0 || trimmedPath.length === 0 || isAbsolute(trimmedPath)) {
    return filePathOutsideProject(filePath);
  }

  const root = resolve(trimmedRoot);
  const absolutePath = resolve(root, trimmedPath);
  const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return filePathOutsideProject(filePath);
  }

  return ok({ absolutePath, relativePath });
}

function filePathOutsideProject<T>(filePath: string): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "FILE_PATH_OUTSIDE_PROJECT",
      category: "StorageError",
      message: "File path is outside the opened folder.",
      recoverability: "user-action",
      suggestedAction: "Choose a file from the opened folder tree.",
      traceId: "project-text-file",
      redactedDetail: {
        path: filePath
      }
    })
  );
}

function fileOperationFailed<T>(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
  readonly reason: string;
}): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "StorageError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: "project-text-file",
      redactedDetail: {
        reason: input.reason
      }
    })
  );
}

function toStoryBibleAsset(value: unknown): StoryBibleAsset | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.schemaVersion !== "string" ||
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
    updatedAt: value.updatedAt
  };
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
    !isOptionalNumber(value.topP) ||
    !isOptionalNumber(value.frequencyPenalty) ||
    !isOptionalNumber(value.presencePenalty)
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
    temperature: value.temperature,
    maxTokens: value.maxTokens,
    ...(value.topP === undefined ? {} : { topP: value.topP }),
    timeoutMs: value.timeoutMs,
    ...(value.frequencyPenalty === undefined ? {} : { frequencyPenalty: value.frequencyPenalty }),
    ...(value.presencePenalty === undefined ? {} : { presencePenalty: value.presencePenalty })
  };
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

function toCreateProjectInput(value: unknown): CreateProjectInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.projectRoot !== "string" ||
    typeof value.projectId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.language !== "string" ||
    !isOptionalString(value.projectType) ||
    !isOptionalNumber(value.targetWordCount)
  ) {
    return undefined;
  }

  return {
    projectRoot: value.projectRoot,
    projectId: value.projectId,
    title: value.title,
    language: value.language,
    ...(value.projectType === undefined ? {} : { projectType: value.projectType }),
    ...(value.targetWordCount === undefined ? {} : { targetWordCount: value.targetWordCount })
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
  return (
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
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
    value === "outline" ||
    value === "timeline.events"
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
