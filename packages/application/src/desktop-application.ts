import { createUnifiedError, err, ok } from "@novel-studio/shared";
import type {
  ChapterVersionContent,
  ChapterVersionSummary,
  Result,
  UnifiedError
} from "@novel-studio/shared";

import {
  DEFAULT_APPLICATION_COMMANDS,
  findApplicationCommand,
  isSafeCommand
} from "./command-registry.js";
import type { ApplicationCommand, ApplicationCommandId } from "./command-registry.js";
import type {
  ChapterEditorSession,
  ChapterEditorSnapshot,
  ChapterEditorState,
  ChapterSuggestionDiffPreview
} from "./chapter-editor-session.js";
import type {
  ConfigAssetRestoreInput,
  ConfigAssetSaveInput,
  ConfigAssetSnapshot,
  ConfigAssetType,
  ConfigStudioSession,
  ConfigVersionSummary
} from "./config-studio-session.js";
import type {
  ModelConnectionResult,
  ModelProfile,
  ModelSettingsSession,
  ModelSettingsSnapshot
} from "./model-settings-session.js";

export type ActivityId = "workspace" | "search" | "timeline" | "ai" | "studio" | "settings";

export type SaveStatus = "Saved" | "Saving" | "Unsaved" | "Recovery available";

export interface NavigatorSection {
  readonly id: string;
  readonly title: string;
  readonly itemCount: number;
}

export interface DesktopShellState {
  readonly projectTitle: string;
  readonly activeActivity: ActivityId;
  readonly navigatorCollapsed: boolean;
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly commandPaletteOpen: boolean;
  readonly saveStatus: SaveStatus;
  readonly navigatorSections: readonly NavigatorSection[];
  readonly bottomPanelTabs: readonly string[];
}

export interface DesktopApplication {
  getShellState(): DesktopShellState;
  listCommands(): readonly ApplicationCommand[];
  executeCommand(commandId: string): Result<DesktopShellState, UnifiedError>;
  loadActiveChapter(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  editActiveChapter(nextBody: string): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  saveActiveChapter(): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  listActiveChapterVersions(): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>>;
  previewActiveChapterVersion(
    versionId: string
  ): Promise<Result<ChapterVersionContent, UnifiedError>>;
  restoreActiveChapterVersion(
    versionId: string
  ): Promise<Result<ChapterEditorSnapshot, UnifiedError>>;
  previewActiveChapterSuggestionDiff(
    nextBody: string
  ): Result<ChapterSuggestionDiffPreview, UnifiedError>;
  listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  saveModelProfile(
    profile: ModelProfile,
    options?: { readonly makeDefault?: boolean }
  ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  testModelProfileConnection(
    profileId: string
  ): Promise<Result<ModelConnectionResult, UnifiedError>>;
  loadConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
  saveConfigAsset(input: ConfigAssetSaveInput): Promise<Result<ConfigVersionSummary, UnifiedError>>;
  restoreConfigAssetVersion(
    input: ConfigAssetRestoreInput
  ): Promise<Result<ConfigAssetSnapshot, UnifiedError>>;
}

export interface DesktopApplicationOptions {
  readonly chapterEditorSession?: ChapterEditorSession;
  readonly modelSettingsSession?: ModelSettingsSession;
  readonly configStudioSession?: ConfigStudioSession;
  readonly projectTitle?: string;
  readonly navigatorSections?: readonly NavigatorSection[];
}

const DEFAULT_SHELL_STATE: DesktopShellState = {
  projectTitle: "No project open",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [
    { id: "chapters", title: "Chapters", itemCount: 0 },
    { id: "characters", title: "Characters", itemCount: 0 },
    { id: "world", title: "World", itemCount: 0 },
    { id: "outline", title: "Outline", itemCount: 0 },
    { id: "timeline", title: "Timeline", itemCount: 0 },
    { id: "memories", title: "Memories", itemCount: 0 },
    { id: "prompts", title: "Prompts", itemCount: 0 },
    { id: "agents", title: "Agents", itemCount: 0 },
    { id: "workflows", title: "Workflows", itemCount: 0 }
  ],
  bottomPanelTabs: ["Workflow Run", "Problems", "Search", "Logs"]
};

export function createDesktopApplication(
  options: DesktopApplicationOptions = {}
): DesktopApplication {
  const chapterEditorSession = options.chapterEditorSession;
  const modelSettingsSession = options.modelSettingsSession;
  const configStudioSession = options.configStudioSession;
  let shellState = createInitialShellState(options);

  return {
    getShellState: () => withChapterSaveStatus(shellState, chapterEditorSession?.getState()),
    listCommands: () => DEFAULT_APPLICATION_COMMANDS,
    executeCommand: (commandId: string) => {
      const command = findApplicationCommand(commandId);

      if (command === undefined || !isSafeCommand(command)) {
        return err(
          createUnifiedError({
            code: "APPLICATION_COMMAND_NOT_ALLOWED",
            category: "UserError",
            message: "The requested command is not available in the desktop shell.",
            recoverability: "user-action",
            suggestedAction: "Choose an available command from the command palette.",
            traceId: "application-command-bridge"
          })
        );
      }

      shellState = reduceShellState(shellState, command.id);

      return ok(shellState);
    },
    async loadActiveChapter() {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const loaded = await chapterEditorSession.load();
      if (!loaded.ok) {
        return loaded;
      }

      return createChapterSnapshot(chapterEditorSession, loaded.value);
    },
    async editActiveChapter(nextBody: string) {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const edited = chapterEditorSession.edit(nextBody);
      if (!edited.ok) {
        return edited;
      }

      return createChapterSnapshot(chapterEditorSession, edited.value);
    },
    async saveActiveChapter() {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const saved = await chapterEditorSession.save();
      if (!saved.ok) {
        return saved;
      }

      return createChapterSnapshot(chapterEditorSession, saved.value);
    },
    async listActiveChapterVersions() {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return chapterEditorSession.listVersions();
    },
    async previewActiveChapterVersion(versionId: string) {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return chapterEditorSession.previewVersion(versionId);
    },
    async restoreActiveChapterVersion(versionId: string) {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      const restored = await chapterEditorSession.restoreVersion(versionId);
      if (!restored.ok) {
        return restored;
      }

      return createChapterSnapshot(chapterEditorSession, restored.value);
    },
    previewActiveChapterSuggestionDiff(nextBody: string) {
      if (chapterEditorSession === undefined) {
        return chapterEditorUnavailable();
      }

      return ok(chapterEditorSession.previewSuggestionDiff(nextBody));
    },
    async listModelProfiles() {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.listModelProfiles();
    },
    async saveModelProfile(profile, saveOptions) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.saveModelProfile(profile, saveOptions);
    },
    async testModelProfileConnection(profileId) {
      if (modelSettingsSession === undefined) {
        return modelSettingsUnavailable();
      }

      return modelSettingsSession.testModelProfileConnection(profileId);
    },
    async loadConfigAsset(assetType, assetId) {
      if (configStudioSession === undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.loadConfigAsset(assetType, assetId);
    },
    async saveConfigAsset(input) {
      if (configStudioSession === undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.saveConfigAsset(input);
    },
    async restoreConfigAssetVersion(input) {
      if (configStudioSession === undefined) {
        return configStudioUnavailable();
      }

      return configStudioSession.restoreConfigAssetVersion(input);
    }
  };
}

function createInitialShellState(options: DesktopApplicationOptions): DesktopShellState {
  return {
    ...DEFAULT_SHELL_STATE,
    ...(options.projectTitle === undefined ? {} : { projectTitle: options.projectTitle }),
    ...(options.navigatorSections === undefined
      ? {}
      : { navigatorSections: options.navigatorSections })
  };
}

function withChapterSaveStatus(
  shellState: DesktopShellState,
  chapterState: ChapterEditorState | undefined
): DesktopShellState {
  if (chapterState === undefined) {
    return shellState;
  }

  return {
    ...shellState,
    saveStatus: chapterState.saveStatus
  };
}

async function createChapterSnapshot(
  session: ChapterEditorSession,
  state: ChapterEditorState
): Promise<Result<ChapterEditorSnapshot, UnifiedError>> {
  const versions = await session.listVersions();
  if (!versions.ok) {
    return versions;
  }

  return ok({
    state,
    versions: versions.value
  });
}

function chapterEditorUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CHAPTER_EDITOR_UNAVAILABLE",
      category: "UserError",
      message: "No chapter editor session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project chapter before using editor commands.",
      traceId: "application-chapter-editor"
    })
  );
}

function modelSettingsUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "MODEL_SETTINGS_UNAVAILABLE",
      category: "UserError",
      message: "No model settings session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project with settings support before editing model profiles.",
      traceId: "application-model-settings"
    })
  );
}

function configStudioUnavailable<T>(): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: "CONFIG_STUDIO_UNAVAILABLE",
      category: "UserError",
      message: "No config studio session is available.",
      recoverability: "user-action",
      suggestedAction: "Open a project with Studio support before editing configuration assets.",
      traceId: "application-config-studio"
    })
  );
}

function reduceShellState(
  shellState: DesktopShellState,
  commandId: ApplicationCommandId
): DesktopShellState {
  switch (commandId) {
    case "workspace.open-command-palette":
      return { ...shellState, commandPaletteOpen: true };
    case "workspace.toggle-navigator":
      return { ...shellState, navigatorCollapsed: !shellState.navigatorCollapsed };
    case "workspace.toggle-inspector":
      return { ...shellState, inspectorCollapsed: !shellState.inspectorCollapsed };
    case "workspace.toggle-bottom-panel":
      return { ...shellState, bottomPanelVisible: !shellState.bottomPanelVisible };
  }
}
