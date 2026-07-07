import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  UserEditorPreferences,
  UserPreferencesPort,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "@novel-studio/shared";

export type {
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

      const next: UserPreferencesSnapshot = {
        schemaVersion: "1.0",
        onboarding: {
          ...baseResult.value.onboarding,
          ...input.onboarding
        },
        editor: normalizeEditorPreferences({
          ...baseResult.value.editor,
          ...input.editor
        }),
        shell: {
          ...baseResult.value.shell,
          ...input.shell,
          workspaceLayout: {
            ...baseResult.value.shell.workspaceLayout,
            ...input.shell?.workspaceLayout
          }
        }
      };
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
      fontFamily: "mono",
      fontSize: 13,
      lineHeight: 1.7
    },
    shell: {
      navigatorCollapsed: false,
      inspectorCollapsed: true,
      bottomPanelVisible: false,
      activeBottomPanelTab: "工作流运行",
      focusMode: false,
      workspaceLayout: {
        splitView: false,
        navigatorWidth: 260,
        inspectorWidth: 320,
        bottomPanelHeight: 180
      }
    }
  };
}

function normalizeUserPreferences(preferences: UserPreferencesSnapshot): UserPreferencesSnapshot {
  const normalized: UserPreferencesSnapshot = {
    ...preferences,
    editor: normalizeEditorPreferences(preferences.editor ?? createDefaultUserPreferences().editor),
    shell: {
      ...preferences.shell,
      focusMode: preferences.shell.focusMode ?? false
    }
  };

  if (!isLegacyExpandedDefaultLayout(normalized.shell)) {
    return normalized;
  }

  return {
    ...normalized,
    shell: {
      ...normalized.shell,
      inspectorCollapsed: true,
      bottomPanelVisible: false,
      workspaceLayout: {
        ...normalized.shell.workspaceLayout,
        bottomPanelHeight: 180
      }
    }
  };
}

function normalizeEditorPreferences(preferences: UserEditorPreferences): UserEditorPreferences {
  return {
    fontFamily:
      preferences.fontFamily === "serif" || preferences.fontFamily === "sans"
        ? preferences.fontFamily
        : "mono",
    fontSize: clampNumber(preferences.fontSize, 12, 20),
    lineHeight: clampNumber(preferences.lineHeight, 1.4, 2)
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function isLegacyExpandedDefaultLayout(shell: UserPreferencesSnapshot["shell"]): boolean {
  return (
    shell.navigatorCollapsed === false &&
    shell.inspectorCollapsed === false &&
    shell.bottomPanelVisible === true &&
    shell.activeBottomPanelTab === "工作流运行" &&
    shell.workspaceLayout.splitView === false &&
    shell.workspaceLayout.navigatorWidth === 260 &&
    shell.workspaceLayout.inspectorWidth === 320 &&
    shell.workspaceLayout.bottomPanelHeight === 220
  );
}
