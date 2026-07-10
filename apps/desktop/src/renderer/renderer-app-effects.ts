import type {
  ApplicationCommand,
  DesktopShellState,
  NovelStudioApi
} from "@novel-studio/application";
import type { UserAppearancePreferences } from "@novel-studio/shared";
import type {
  AiWritingWorkflowProps,
  ChapterEditorProps,
  EditorPreferences,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import type { AiWritingWorkflowBridge } from "./ai-writing-workflow-bridge.js";
import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { SettingsBridge } from "./settings-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";
import type { StudioBridge } from "./studio-bridge.js";
import { applyShellPreferences } from "./app-shell-support.js";
import { reduceRendererShortcut } from "./shortcuts.js";

export interface RendererAppEffectsInput {
  readonly api: NovelStudioApi | undefined;
  readonly aiWritingWorkflowBridge: AiWritingWorkflowBridge | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly settingsBridge: SettingsBridge | undefined;
  readonly studioBridge: StudioBridge | undefined;
  readonly shortcutState: { readonly commandPaletteOpen: boolean };
  readonly setShortcutState: Dispatch<SetStateAction<{ commandPaletteOpen: boolean }>>;
  readonly setShellState: Dispatch<SetStateAction<DesktopShellState>>;
  readonly setCommands: Dispatch<SetStateAction<readonly ApplicationCommand[]>>;
  readonly setOnboardingDismissed: Dispatch<SetStateAction<boolean>>;
  readonly setEditorPreferences: Dispatch<SetStateAction<EditorPreferences>>;
  readonly setAppearancePreferences: Dispatch<SetStateAction<UserAppearancePreferences>>;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly setAiWritingWorkflow: Dispatch<SetStateAction<AiWritingWorkflowProps | undefined>>;
  readonly setStoryBible: Dispatch<SetStateAction<StoryBibleSummaryProps | undefined>>;
  readonly setStoryBibleEditor: Dispatch<SetStateAction<StoryBibleEditorProps | undefined>>;
  readonly setSettings: Dispatch<
    SetStateAction<ReturnType<SettingsBridge["getProps"]> | undefined>
  >;
  readonly setStudio: Dispatch<SetStateAction<ReturnType<StudioBridge["getProps"]> | undefined>>;
}

export function useRendererAppEffects(input: RendererAppEffectsInput): void {
  const {
    api,
    aiWritingWorkflowBridge,
    chapterBridge,
    settingsBridge,
    shortcutState,
    storyBibleBridge,
    studioBridge,
    setChapterEditor,
    setAiWritingWorkflow,
    setCommands,
    setEditorPreferences,
    setAppearancePreferences,
    setOnboardingDismissed,
    setSettings,
    setShellState,
    setShortcutState,
    setStoryBible,
    setStoryBibleEditor,
    setStudio
  } = input;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const result = reduceRendererShortcut(shortcutState, event);

      if (result.handled) {
        event.preventDefault();
        setShortcutState(result.state);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcutState, setShortcutState]);

  useEffect(() => {
    if (api === undefined) {
      return;
    }

    let active = true;

    void api.getShellState().then((nextShellState) => {
      if (active) {
        setShellState(nextShellState);
      }
    });
    void api.commands.list().then((nextCommands) => {
      if (active) {
        setCommands(nextCommands);
      }
    });
    void api.preferences.load().then((result) => {
      if (!active || !result.ok) {
        return;
      }

      setOnboardingDismissed(result.value.onboarding.dismissed);
      setEditorPreferences(result.value.editor);
      setAppearancePreferences(result.value.appearance);
      setShellState((current) => applyShellPreferences(current, result.value.shell));
    });

    return () => {
      active = false;
    };
  }, [
    api,
    setAppearancePreferences,
    setCommands,
    setEditorPreferences,
    setOnboardingDismissed,
    setShellState
  ]);

  useEffect(() => {
    if (aiWritingWorkflowBridge === undefined) {
      return;
    }

    let active = true;

    void aiWritingWorkflowBridge.loadModelDiscovery().then((nextAiWritingWorkflow) => {
      if (active) {
        setAiWritingWorkflow(nextAiWritingWorkflow);
      }
    });

    return () => {
      active = false;
    };
  }, [aiWritingWorkflowBridge, setAiWritingWorkflow]);

  useEffect(() => {
    if (chapterBridge === undefined) {
      return;
    }

    let active = true;

    void chapterBridge.load().then((nextChapterEditor) => {
      if (active) {
        setChapterEditor(nextChapterEditor);
      }
    });

    return () => {
      active = false;
    };
  }, [chapterBridge, setChapterEditor]);

  useEffect(() => {
    if (storyBibleBridge === undefined) {
      return;
    }

    let active = true;

    void storyBibleBridge.load().then((nextStoryBible) => {
      if (active) {
        setStoryBible(nextStoryBible);
        setStoryBibleEditor(storyBibleBridge.getEditorProps());
      }
    });

    return () => {
      active = false;
    };
  }, [setStoryBible, setStoryBibleEditor, storyBibleBridge]);

  useEffect(() => {
    if (settingsBridge === undefined) {
      return;
    }

    let active = true;

    void settingsBridge.load().then((nextSettings) => {
      if (active) {
        setSettings(nextSettings);
      }
    });

    return () => {
      active = false;
    };
  }, [settingsBridge, setSettings]);

  useEffect(() => {
    if (studioBridge === undefined) {
      return;
    }

    let active = true;

    void studioBridge.load().then((nextStudio) => {
      if (active) {
        setStudio(nextStudio);
      }
    });

    return () => {
      active = false;
    };
  }, [studioBridge, setStudio]);
}
