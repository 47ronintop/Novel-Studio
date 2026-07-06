import { createDesktopApplication } from "@novel-studio/application";
import type { ApplicationIpcChannel, DesktopApplication } from "@novel-studio/application";
import { ok, type JsonObject, type JsonValue } from "@novel-studio/shared";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetType,
  CreateProjectInput,
  AiWritingSuggestionRequest,
  ModelProfile,
  MemoryRecord,
  ProjectSearchQuery,
  StoryBibleAsset,
  StoryBibleContextCandidateOptions
} from "@novel-studio/application";
import type { CreateChapterInput } from "@novel-studio/shared";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export interface ApplicationIpcHandlerOptions {
  readonly chooseOpenProjectDirectory?: () => Promise<string | undefined>;
  readonly chooseCreateProjectDirectory?: () => Promise<string | undefined>;
}

export function createApplicationIpcHandlers(
  application: DesktopApplication = createDesktopApplication(),
  options: ApplicationIpcHandlerOptions = {}
): ApplicationIpcHandlers {
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
    }
  };
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

function toAiWritingSuggestionRequest(value: unknown): AiWritingSuggestionRequest {
  if (!isRecord(value) || typeof value.instruction !== "string") {
    return { instruction: "" };
  }

  return {
    instruction: value.instruction
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
