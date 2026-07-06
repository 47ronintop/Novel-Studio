import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  UserPreferencesPort,
  UserPreferencesSaveInput,
  UserPreferencesSnapshot
} from "@novel-studio/shared";

export type {
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

      current = loaded.value ?? createDefaultUserPreferences();
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

    return ok(loaded.value ?? createDefaultUserPreferences());
  }
}

export function createDefaultUserPreferences(): UserPreferencesSnapshot {
  return {
    schemaVersion: "1.0",
    onboarding: {
      dismissed: false
    },
    shell: {
      navigatorCollapsed: false,
      inspectorCollapsed: false,
      bottomPanelVisible: true,
      activeBottomPanelTab: "工作流运行",
      workspaceLayout: {
        splitView: false,
        navigatorWidth: 260,
        inspectorWidth: 320,
        bottomPanelHeight: 220
      }
    }
  };
}
