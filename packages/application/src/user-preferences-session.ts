import {
  DEFAULT_USER_SHELL_PREFERENCES,
  ok,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type {
  UserAppearancePreferences,
  UserEditorPreferences,
  UserPreferencesPort,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "@novel-studio/shared";
import type { ConversationPanelMode } from "@novel-studio/shared";

export type {
  UserAppearancePreferences,
  UserEditorPreferences,
  UserOnboardingPreferences,
  UserPreferencesPort,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot,
  UserShellPreferences,
  UserWorkspaceLayoutPreferences
} from "@novel-studio/shared";

export interface UserPreferencesSession {
  load(): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
  save(input: UserPreferencesSaveInput): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
}

export interface UserPreferencesSessionOptions {
  readonly preferencesPort: UserPreferencesPort;
}

type AppearancePreferenceInput = Partial<UserAppearancePreferences> & {
  readonly density?: unknown;
};

type WorkspaceLayoutPreferenceInput = Partial<
  UserPreferencesSnapshot["shell"]["workspaceLayout"]
> & {
  readonly splitView?: unknown;
};

export function createUserPreferencesSession(
  options: UserPreferencesSessionOptions
): UserPreferencesSession {
  let current: UserPreferencesSnapshot | undefined;

  return {
    async load() {
      const loaded = await options.preferencesPort.readUserPreferences();
      if (!loaded.ok) {
        return loaded;
      }

      current = normalizeUserPreferences(loaded.value ?? createDefaultUserPreferences());
      return ok(current);
    },
    async save(input) {
      const baseResult = current === undefined ? await loadBase() : ok(current);
      if (!baseResult.ok) {
        return baseResult;
      }

      const next = normalizeUserPreferences({
        schemaVersion: "1.2",
        onboarding: {
          ...baseResult.value.onboarding,
          ...input.onboarding
        },
        editor: normalizeEditorPreferences({
          ...baseResult.value.editor,
          ...input.editor
        }),
        appearance: normalizeAppearancePreferences({
          ...baseResult.value.appearance,
          ...input.appearance
        }),
        shell: {
          ...baseResult.value.shell,
          ...input.shell,
          workspaceLayout: {
            ...baseResult.value.shell.workspaceLayout,
            ...input.shell?.workspaceLayout
          }
        }
      });
      const written = await options.preferencesPort.writeUserPreferences(next);
      if (!written.ok) {
        return written;
      }

      current = written.value;
      return ok(current);
    }
  };

  async function loadBase(): Promise<Result<UserPreferencesSnapshot, UnifiedError>> {
    const loaded = await options.preferencesPort.readUserPreferences();
    if (!loaded.ok) {
      return loaded;
    }

    return ok(normalizeUserPreferences(loaded.value ?? createDefaultUserPreferences()));
  }
}

export function createDefaultUserPreferences(): UserPreferencesSnapshot {
  return {
    schemaVersion: "1.2",
    onboarding: {
      dismissed: false
    },
    editor: {
      fontFamily: "serif",
      fontSize: 16,
      lineHeight: 1.8
    },
    appearance: {
      theme: "dark",
      accentColor: "teal"
    },
    shell: DEFAULT_USER_SHELL_PREFERENCES
  };
}

function normalizeUserPreferences(preferences: UserPreferencesSnapshot): UserPreferencesSnapshot {
  const shell = preferences.shell as UserPreferencesSnapshot["shell"] | undefined;
  return {
    ...preferences,
    schemaVersion: "1.2",
    editor: normalizeEditorPreferences(preferences.editor ?? createDefaultUserPreferences().editor),
    appearance: normalizeAppearancePreferences(preferences.appearance as AppearancePreferenceInput),
    shell: normalizeShellPreferences(shell)
  };
}

function normalizeShellPreferences(
  preferences: UserPreferencesSnapshot["shell"] | undefined
): UserPreferencesSnapshot["shell"] {
  const legacyShell =
    preferences === undefined ||
    !Object.prototype.hasOwnProperty.call(preferences, "workbenchMode");
  const standaloneSelectedConversationId = normalizeStandaloneSelectedConversationId(
    preferences?.standaloneSelectedConversationId
  );

  return {
    workbenchMode: normalizeWorkbenchMode(preferences?.workbenchMode),
    creativeNavigatorMode: normalizeCreativeNavigatorMode(preferences?.creativeNavigatorMode),
    creativeFileExpandedPathIds: normalizeStringArray(preferences?.creativeFileExpandedPathIds),
    engineeringExpandedPathIds: normalizeStringArray(preferences?.engineeringExpandedPathIds),
    ...(standaloneSelectedConversationId === undefined ? {} : { standaloneSelectedConversationId }),
    navigatorCollapsed:
      preferences?.navigatorCollapsed ?? DEFAULT_USER_SHELL_PREFERENCES.navigatorCollapsed,
    navigatorExpandedSectionIds: normalizeStringArray(preferences?.navigatorExpandedSectionIds),
    inspectorCollapsed:
      normalizeConversationPanelMode(
        preferences?.workspaceLayout,
        legacyShell ? false : preferences?.inspectorCollapsed
      ) === "collapsed",
    bottomPanelVisible:
      preferences?.bottomPanelVisible ?? DEFAULT_USER_SHELL_PREFERENCES.bottomPanelVisible,
    activeBottomPanelTab:
      preferences?.activeBottomPanelTab === "问题"
        ? "问题"
        : DEFAULT_USER_SHELL_PREFERENCES.activeBottomPanelTab,
    // Focus mode was removed from the shell UI. Normalize legacy saved values
    // so an old session cannot reopen with its panels hidden.
    focusMode: DEFAULT_USER_SHELL_PREFERENCES.focusMode,
    workspaceLayout: normalizeWorkspaceLayoutPreferences(
      preferences?.workspaceLayout,
      legacyShell ? false : preferences?.inspectorCollapsed
    )
  };
}

function normalizeWorkspaceLayoutPreferences(
  layout: WorkspaceLayoutPreferenceInput | undefined,
  legacyInspectorCollapsed?: boolean
): UserPreferencesSnapshot["shell"]["workspaceLayout"] {
  return {
    conversationPanelMode: normalizeConversationPanelMode(layout, legacyInspectorCollapsed),
    navigatorWidth:
      layout?.navigatorWidth ?? DEFAULT_USER_SHELL_PREFERENCES.workspaceLayout.navigatorWidth,
    inspectorWidth:
      layout?.inspectorWidth ?? DEFAULT_USER_SHELL_PREFERENCES.workspaceLayout.inspectorWidth,
    bottomPanelHeight:
      layout?.bottomPanelHeight ?? DEFAULT_USER_SHELL_PREFERENCES.workspaceLayout.bottomPanelHeight
  };
}

function normalizeConversationPanelMode(
  layout: WorkspaceLayoutPreferenceInput | undefined,
  legacyInspectorCollapsed?: boolean
): ConversationPanelMode {
  const mode = layout?.conversationPanelMode;
  if (mode === "docked" || mode === "collapsed" || mode === "expanded") {
    return mode;
  }
  return legacyInspectorCollapsed === true ? "collapsed" : "docked";
}

function normalizeWorkbenchMode(value: unknown): UserPreferencesSnapshot["shell"]["workbenchMode"] {
  return value === "engineering" ? "engineering" : "creative";
}

function normalizeCreativeNavigatorMode(
  value: unknown
): UserPreferencesSnapshot["shell"]["creativeNavigatorMode"] {
  return value === "story" ? value : "writing";
}

function normalizeAppearancePreferences(
  preferences: AppearancePreferenceInput | undefined
): UserAppearancePreferences {
  return {
    theme:
      preferences?.theme === "light" ||
      preferences?.theme === "system" ||
      preferences?.theme === "ink-gold"
        ? preferences.theme
        : "dark",
    accentColor:
      preferences?.accentColor === "blue" || preferences?.accentColor === "amber"
        ? preferences.accentColor
        : "teal"
  };
}

function normalizeEditorPreferences(preferences: UserEditorPreferences): UserEditorPreferences {
  return {
    fontFamily:
      preferences.fontFamily === "mono" ||
      preferences.fontFamily === "serif" ||
      preferences.fontFamily === "sans"
        ? preferences.fontFamily
        : "serif",
    fontSize: clampNumber(preferences.fontSize, 12, 20),
    lineHeight: clampNumber(preferences.lineHeight, 1.4, 2)
  };
}

function normalizeStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function normalizeStandaloneSelectedConversationId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
