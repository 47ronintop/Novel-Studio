import type {
  ActivityId,
  ApplicationCommand,
  DesktopShellState,
  NovelStudioApi,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import {
  DEFAULT_USER_SHELL_PREFERENCES,
  EMPTY_WORKSPACE_CONTEXT,
  type UserAppearancePreferences
} from "@novel-studio/shared";
import type {
  ChapterEditorProps,
  ChapterEditorRuntimeProps,
  ChapterEditorSelection,
  OnboardingProps,
  ProjectWorkflowProps
} from "@novel-studio/ui";

import {
  createChapterEditorRuntimeProps,
  createEditorSelectionCommand,
  resolveEditorRuntimeAdapter,
  type EditorRuntimeResolverOptions
} from "./editor-runtime.js";

declare global {
  interface Window {
    novelStudio?: NovelStudioApi;
  }
}

export const rendererShellState: DesktopShellState = {
  projectTitle: "未打开项目",
  activeActivity: "workspace",
  workspaceContext: EMPTY_WORKSPACE_CONTEXT,
  ...DEFAULT_USER_SHELL_PREFERENCES,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [
    { id: "chapters", title: "章节", itemCount: 0 },
    { id: "characters", title: "人物", itemCount: 0 },
    { id: "world", title: "世界观", itemCount: 0 },
    { id: "outline", title: "大纲", itemCount: 0 },
    { id: "timeline", title: "时间线", itemCount: 0 },
    { id: "memories", title: "记忆", itemCount: 0 },
    { id: "prompts", title: "提示词", itemCount: 0 },
    { id: "agents", title: "Agent", itemCount: 0 },
    { id: "workflows", title: "工作流", itemCount: 0 }
  ],
  bottomPanelTabs: ["工作流运行", "问题", "搜索", "日志"]
};

export const rendererCommands: readonly ApplicationCommand[] = [
  {
    id: "workspace.open-command-palette",
    title: "打开命令面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+K"
  },
  {
    id: "workspace.toggle-navigator",
    title: "切换项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+B"
  },
  {
    id: "workspace.toggle-inspector",
    title: "切换检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+I"
  },
  {
    id: "workspace.toggle-bottom-panel",
    title: "切换底部面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+J"
  },
  {
    id: "workspace.toggle-split-view",
    title: "切换拆分视图",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+\\"
  },
  {
    id: "workspace.toggle-focus-mode",
    title: "切换专注模式",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+F"
  },
  {
    id: "workspace.narrow-navigator",
    title: "收窄项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+["
  },
  {
    id: "workspace.widen-navigator",
    title: "加宽项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+]"
  },
  {
    id: "workspace.narrow-inspector",
    title: "收窄检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+["
  },
  {
    id: "workspace.widen-inspector",
    title: "加宽检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+]"
  }
];

export function getNovelStudioApi(): NovelStudioApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.novelStudio;
}

export async function persistAppearancePreferences(
  preferencesApi: NovelStudioApi["preferences"] | undefined,
  preferences: UserAppearancePreferences
): Promise<{ readonly kind: "error"; readonly message: string } | undefined> {
  if (preferencesApi === undefined) {
    return {
      kind: "error",
      message: "外观已在本次会话生效，但无法写入用户偏好。"
    };
  }

  try {
    const result = await preferencesApi.save({ appearance: preferences });
    return result.ok
      ? undefined
      : {
          kind: "error",
          message: "外观已在本次会话生效，但未能保存到本地。"
        };
  } catch {
    return {
      kind: "error",
      message: "外观已在本次会话生效，但未能保存到本地。"
    };
  }
}

export function resolveActivityTransition(
  currentActivity: ActivityId,
  lastNonSettingsActivity: ActivityId,
  nextActivity: ActivityId
): { readonly activeActivity: ActivityId; readonly lastNonSettingsActivity: ActivityId } {
  if (nextActivity === "settings") {
    return {
      activeActivity: nextActivity,
      lastNonSettingsActivity:
        currentActivity === "settings" ? lastNonSettingsActivity : currentActivity
    };
  }

  return {
    activeActivity: nextActivity,
    lastNonSettingsActivity: nextActivity
  };
}

export function createOnboardingProps(input: {
  readonly dismissed: boolean;
  readonly shellState: DesktopShellState;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
  readonly onCreateExampleProject: () => void;
  readonly onCreateProject: () => void;
  readonly onOpenProject: () => void;
  readonly onCreateFirstChapter: () => void;
  readonly onDismiss: () => void;
}): OnboardingProps {
  const hasProject =
    input.shellState.projectTitle !== "未打开项目" ||
    input.projectWorkflow?.projectId !== undefined;
  const hasChapter =
    input.chapterEditor !== undefined || (input.projectWorkflow?.chapters.length ?? 0) > 0;

  return {
    visible: !input.dismissed && (!hasProject || !hasChapter),
    dismissed: input.dismissed,
    steps: [
      {
        id: "project",
        label: "创建或打开项目",
        completed: hasProject
      },
      {
        id: "chapter",
        label: "新建第一章",
        completed: hasChapter
      },
      {
        id: "ai",
        label: "用 AI 生成建议",
        completed: false
      }
    ],
    onCreateExampleProject: input.onCreateExampleProject,
    onCreateProject: input.onCreateProject,
    onOpenProject: input.onOpenProject,
    onCreateFirstChapter: input.onCreateFirstChapter,
    onDismiss: input.onDismiss
  };
}

export function shellPreferencesFromState(
  shellState: DesktopShellState
): NonNullable<UserPreferencesSaveInput["shell"]> {
  return {
    workbenchMode: shellState.workbenchMode,
    creativeNavigatorMode: shellState.creativeNavigatorMode,
    engineeringExpandedPathIds: shellState.engineeringExpandedPathIds,
    navigatorCollapsed: shellState.navigatorCollapsed,
    navigatorExpandedSectionIds:
      shellState.navigatorExpandedSectionIds ??
      DEFAULT_USER_SHELL_PREFERENCES.navigatorExpandedSectionIds ??
      [],
    inspectorCollapsed: shellState.inspectorCollapsed,
    bottomPanelVisible: shellState.bottomPanelVisible,
    activeBottomPanelTab: shellState.activeBottomPanelTab,
    focusMode: shellState.focusMode,
    workspaceLayout: shellState.workspaceLayout
  };
}

export function applyShellPreferences(
  shellState: DesktopShellState,
  preferences: NonNullable<UserPreferencesSaveInput["shell"]>
): DesktopShellState {
  return {
    ...shellState,
    ...(preferences.workbenchMode === undefined
      ? {}
      : { workbenchMode: preferences.workbenchMode }),
    ...(preferences.creativeNavigatorMode === undefined
      ? {}
      : { creativeNavigatorMode: preferences.creativeNavigatorMode }),
    ...(preferences.engineeringExpandedPathIds === undefined
      ? {}
      : { engineeringExpandedPathIds: preferences.engineeringExpandedPathIds }),
    ...(preferences.navigatorCollapsed === undefined
      ? {}
      : { navigatorCollapsed: preferences.navigatorCollapsed }),
    ...(preferences.navigatorExpandedSectionIds === undefined
      ? {}
      : { navigatorExpandedSectionIds: preferences.navigatorExpandedSectionIds }),
    ...(preferences.inspectorCollapsed === undefined
      ? {}
      : { inspectorCollapsed: preferences.inspectorCollapsed }),
    ...(preferences.bottomPanelVisible === undefined
      ? {}
      : { bottomPanelVisible: preferences.bottomPanelVisible }),
    ...(preferences.activeBottomPanelTab === undefined
      ? {}
      : { activeBottomPanelTab: preferences.activeBottomPanelTab }),
    ...(preferences.focusMode === undefined ? {} : { focusMode: preferences.focusMode }),
    workspaceLayout: {
      ...shellState.workspaceLayout,
      ...preferences.workspaceLayout
    }
  };
}

export function createChapterEditorRuntime(
  chapterEditor: ChapterEditorProps,
  selection: ChapterEditorSelection | undefined,
  options: EditorRuntimeResolverOptions = {}
): ChapterEditorRuntimeProps {
  return createChapterEditorRuntimeProps({
    body: chapterEditor.chapter.body,
    saveStatus: chapterEditor.saveStatus,
    ...(selection === undefined ? {} : { selection }),
    ...(chapterEditor.diffPreview === undefined ? {} : { diffPreview: chapterEditor.diffPreview }),
    ...options
  });
}

export function createChapterEditorSelectionCommand(
  chapterEditor: ChapterEditorProps,
  input: {
    readonly commandId: string;
    readonly selection: ChapterEditorSelection;
  },
  options: EditorRuntimeResolverOptions = {}
) {
  const handle = resolveEditorRuntimeAdapter(options).mount({
    body: chapterEditor.chapter.body,
    saveStatus: chapterEditor.saveStatus
  });
  handle.updateSelection(input.selection);
  return createEditorSelectionCommand(handle.getSnapshot(), input.commandId);
}
