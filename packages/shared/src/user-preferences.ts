import type { UnifiedError } from "./errors.js";
import type { Result } from "./result.js";
import type { CreativeNavigatorMode, WorkbenchMode } from "./workspace-context.js";

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

export type UserThemePreference = "dark" | "light" | "system";
export type UserAccentColorPreference = "teal" | "blue" | "amber";

export interface UserAppearancePreferences {
  readonly theme: UserThemePreference;
  readonly accentColor: UserAccentColorPreference;
}

export interface UserShellPreferences {
  readonly workbenchMode: WorkbenchMode;
  readonly creativeNavigatorMode: CreativeNavigatorMode;
  readonly engineeringExpandedPathIds: readonly string[];
  readonly navigatorCollapsed: boolean;
  readonly navigatorExpandedSectionIds?: readonly string[];
  readonly inspectorCollapsed: boolean;
  readonly bottomPanelVisible: boolean;
  readonly activeBottomPanelTab: string;
  readonly focusMode: boolean;
  readonly workspaceLayout: UserWorkspaceLayoutPreferences;
}

export const DEFAULT_USER_SHELL_PREFERENCES: UserShellPreferences = {
  workbenchMode: "creative",
  creativeNavigatorMode: "writing",
  engineeringExpandedPathIds: [],
  navigatorCollapsed: false,
  navigatorExpandedSectionIds: [],
  inspectorCollapsed: false,
  bottomPanelVisible: false,
  activeBottomPanelTab: "工作流运行",
  focusMode: false,
  workspaceLayout: {
    splitView: false,
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 180
  }
};

export interface UserPreferencesSnapshot {
  readonly schemaVersion: "1.0";
  readonly onboarding: UserOnboardingPreferences;
  readonly editor: UserEditorPreferences;
  readonly appearance: UserAppearancePreferences;
  readonly shell: UserShellPreferences;
}

export type UserPreferencesSaveInput = Partial<{
  readonly onboarding: Partial<UserOnboardingPreferences>;
  readonly editor: Partial<UserEditorPreferences>;
  readonly appearance: Partial<UserAppearancePreferences>;
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
