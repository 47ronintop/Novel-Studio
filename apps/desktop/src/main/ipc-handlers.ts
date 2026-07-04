import { createDesktopApplication } from "@novel-studio/application";
import type { ApplicationIpcChannel, DesktopApplication } from "@novel-studio/application";
import type { JsonObject, JsonValue } from "@novel-studio/shared";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetType,
  CreateProjectInput,
  ModelProfile
} from "@novel-studio/application";
import type { CreateChapterInput } from "@novel-studio/shared";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export function createApplicationIpcHandlers(
  application: DesktopApplication = createDesktopApplication()
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
