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
        schemaVersion: "1.0",
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
    schemaVersion: "1.0",
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

  return {
    workbenchMode: normalizeWorkbenchMode(preferences?.workbenchMode),
    creativeNavigatorMode: normalizeCreativeNavigatorMode(preferences?.creativeNavigatorMode),
    engineeringExpandedPathIds: normalizeStringArray(preferences?.engineeringExpandedPathIds),
    navigatorCollapsed:
      preferences?.navigatorCollapsed ?? DEFAULT_USER_SHELL_PREFERENCES.navigatorCollapsed,
    navigatorExpandedSectionIds: normalizeStringArray(preferences?.navigatorExpandedSectionIds),
    inspectorCollapsed: legacyShell
      ? false
      : (preferences.inspectorCollapsed ?? DEFAULT_USER_SHELL_PREFERENCES.inspectorCollapsed),
    bottomPanelVisible:
      preferences?.bottomPanelVisible ?? DEFAULT_USER_SHELL_PREFERENCES.bottomPanelVisible,
    activeBottomPanelTab:
      preferences?.activeBottomPanelTab ?? DEFAULT_USER_SHELL_PREFERENCES.activeBottomPanelTab,
    focusMode: preferences?.focusMode ?? DEFAULT_USER_SHELL_PREFERENCES.focusMode,
    workspaceLayout: {
      ...DEFAULT_USER_SHELL_PREFERENCES.workspaceLayout,
      ...preferences?.workspaceLayout
    }
  };
}

function normalizeWorkbenchMode(value: unknown): UserPreferencesSnapshot["shell"]["workbenchMode"] {
  return value === "engineering" ? "engineering" : "creative";
}

function normalizeCreativeNavigatorMode(
  value: unknown
): UserPreferencesSnapshot["shell"]["creativeNavigatorMode"] {
  return value === "story" ? "story" : "writing";
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
