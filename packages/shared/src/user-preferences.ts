import type { UnifiedError } from "./errors.js";
import type { Result } from "./result.js";

export interface UserWorkspaceLayoutPreferences {
  readonly splitView: boolean;
  readonly navigatorWidth: number;
  readonly inspectorWidth: number;
  readonly bottomPanelHeight: number;
}

export interface UserOnboardingPreferences {
  readonly dismissed: boolean;
}

export interface UserEditorPreferences {
  readonly fontFamily: "mono" | "serif" | "sans";
  readonly fontSize: number;
  readonly lineHeight: number;
}

export interface UserShellPreferences {
  readonly navigatorCollapsed: boolean;
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly activeBottomPanelTab: string;
  readonly focusMode: boolean;
  readonly workspaceLayout: UserWorkspaceLayoutPreferences;
}

export interface UserPreferencesSnapshot {
  readonly schemaVersion: "1.0";
  readonly onboarding: UserOnboardingPreferences;
  readonly editor: UserEditorPreferences;
  readonly shell: UserShellPreferences;
}

export type UserPreferencesSaveInput = Partial<{
  readonly onboarding: Partial<UserOnboardingPreferences>;
  readonly editor: Partial<UserEditorPreferences>;
  readonly shell: Partial<UserShellPreferences> & {
    readonly workspaceLayout?: Partial<UserWorkspaceLayoutPreferences>;
  };
}>;

export interface UserPreferencesPort {
  readUserPreferences(): Promise<Result<UserPreferencesSnapshot | undefined, UnifiedError>>;
  writeUserPreferences(
    preferences: UserPreferencesSnapshot
  ): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
}
