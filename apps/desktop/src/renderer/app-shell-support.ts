import type {
  ActivityId,
  ApplicationCommand,
  DesktopShellState,
  NovelStudioApi,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type { AgentContextScope } from "@novel-studio/agent-engine";
import {
  DEFAULT_USER_SHELL_PREFERENCES,
  EMPTY_WORKSPACE_CONTEXT,
  resolveWorkbenchModeForContext,
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

export function agentScopeFromWorkspaceContext(
  context: DesktopShellState["workspaceContext"]
): AgentContextScope {
  return context.kind === "none"
    ? { kind: "standalone", scopeId: "standalone" }
    : {
        kind: "workspace",
        workspaceKind: context.kind,
        workspaceId: context.workspaceId
      };
}

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
    title: "切换会话面板布局",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+\\"
  },
  {
    id: "workspace.set-conversation-panel-docked",
    title: "停靠会话面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: ""
  },
  {
    id: "workspace.set-conversation-panel-collapsed",
    title: "收起会话面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: ""
  },
  {
    id: "workspace.set-conversation-panel-expanded",
    title: "展开会话面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: ""
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
  const creativeSurfaceAvailable =
    input.shellState.workbenchMode === "creative" &&
    input.shellState.workspaceContext.kind !== "engineeringWorkspace";
  const hasProject =
    input.shellState.workspaceContext.kind === "creativeProject" ||
    input.projectWorkflow?.projectId !== undefined;
  const hasChapter =
    input.chapterEditor !== undefined || (input.projectWorkflow?.chapters.length ?? 0) > 0;

  return {
    visible: creativeSurfaceAvailable && !input.dismissed && (!hasProject || !hasChapter),
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
  const conversationPanelMode = shellState.workspaceLayout.conversationPanelMode;
  return {
    workbenchMode: shellState.workbenchMode,
    creativeNavigatorMode: shellState.creativeNavigatorMode,
    creativeFileExpandedPathIds: shellState.creativeFileExpandedPathIds,
    engineeringExpandedPathIds: shellState.engineeringExpandedPathIds,
    navigatorCollapsed: shellState.navigatorCollapsed,
    navigatorExpandedSectionIds:
      shellState.navigatorExpandedSectionIds ??
      DEFAULT_USER_SHELL_PREFERENCES.navigatorExpandedSectionIds ??
      [],
    inspectorCollapsed: shellState.inspectorCollapsed,
    bottomPanelVisible: shellState.bottomPanelVisible,
    activeBottomPanelTab: shellState.activeBottomPanelTab,
    // Focus mode no longer has a user-facing entry point; persist the safe default
    // so legacy preferences are cleared on the next normal shell save.
    focusMode: false,
    workspaceLayout: {
      conversationPanelMode,
      navigatorWidth: shellState.workspaceLayout.navigatorWidth,
      inspectorWidth: shellState.workspaceLayout.inspectorWidth,
      bottomPanelHeight: shellState.workspaceLayout.bottomPanelHeight
    }
  };
}

export function applyShellPreferences(
  shellState: DesktopShellState,
  preferences: NonNullable<UserPreferencesSaveInput["shell"]>
): DesktopShellState {
  const preferredWorkbenchMode = preferences.workbenchMode ?? shellState.workbenchMode;
  const conversationPanelMode =
    preferences.workspaceLayout?.conversationPanelMode ??
    shellState.workspaceLayout.conversationPanelMode;
  return {
    ...shellState,
    workbenchMode: resolveWorkbenchModeForContext(
      preferredWorkbenchMode,
      shellState.workspaceContext
    ),
    ...(preferences.creativeNavigatorMode === undefined
      ? {}
      : { creativeNavigatorMode: preferences.creativeNavigatorMode }),
    ...(preferences.creativeFileExpandedPathIds === undefined
      ? {}
      : { creativeFileExpandedPathIds: preferences.creativeFileExpandedPathIds }),
    ...(preferences.engineeringExpandedPathIds === undefined
      ? {}
      : { engineeringExpandedPathIds: preferences.engineeringExpandedPathIds }),
    ...(preferences.navigatorCollapsed === undefined
      ? {}
      : { navigatorCollapsed: preferences.navigatorCollapsed }),
    ...(preferences.navigatorExpandedSectionIds === undefined
      ? {}
      : { navigatorExpandedSectionIds: preferences.navigatorExpandedSectionIds }),
    inspectorCollapsed: conversationPanelMode === "collapsed",
    ...(preferences.bottomPanelVisible === undefined
      ? {}
      : { bottomPanelVisible: preferences.bottomPanelVisible }),
    ...(preferences.activeBottomPanelTab === undefined
      ? {}
      : { activeBottomPanelTab: preferences.activeBottomPanelTab }),
    focusMode: false,
    workspaceLayout: {
      navigatorWidth:
        preferences.workspaceLayout?.navigatorWidth ?? shellState.workspaceLayout.navigatorWidth,
      inspectorWidth:
        preferences.workspaceLayout?.inspectorWidth ?? shellState.workspaceLayout.inspectorWidth,
      bottomPanelHeight:
        preferences.workspaceLayout?.bottomPanelHeight ??
        shellState.workspaceLayout.bottomPanelHeight,
      conversationPanelMode
    }
  };
}

export function ensureCreativeWorkspaceContext(
  shellState: DesktopShellState,
  projectId?: string
): DesktopShellState {
  if (shellState.workspaceContext.kind !== "none" || shellState.projectTitle === "未打开项目") {
    return shellState;
  }
  if (projectId === undefined) return shellState;
  const id = projectId;
  return {
    ...shellState,
    workspaceContext: {
      kind: "creativeProject",
      workspaceId: id,
      projectId: id,
      displayName: shellState.projectTitle,
      capabilities: ["creativeWorkbench", "writingContext", "creativeSearch", "creativeStudio"]
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
