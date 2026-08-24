import type { UnifiedError } from "./errors.js";
import type { Result } from "./result.js";
import type { CreativeNavigatorMode, WorkbenchMode } from "./workspace-context.js";

export type ConversationPanelMode = "docked" | "collapsed" | "expanded";

export interface UserWorkspaceLayoutPreferences {
  readonly conversationPanelMode: ConversationPanelMode;
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

export type UserThemePreference = "dark" | "light" | "system" | "ink-gold";
export type UserAccentColorPreference = "teal" | "blue" | "amber";

export interface UserAppearancePreferences {
  readonly theme: UserThemePreference;
  readonly accentColor: UserAccentColorPreference;
}

export interface UserShellPreferences {
  readonly workbenchMode: WorkbenchMode;
  readonly creativeNavigatorMode: CreativeNavigatorMode;
  readonly creativeFileExpandedPathIds: readonly string[];
  readonly engineeringExpandedPathIds: readonly string[];
  /** Absolute path of the most recently opened creative project, if any. */
  readonly lastOpenedProjectRoot?: string;
  readonly standaloneSelectedConversationId?: string;
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
  creativeFileExpandedPathIds: [],
  engineeringExpandedPathIds: [],
  navigatorCollapsed: false,
  navigatorExpandedSectionIds: [],
  inspectorCollapsed: false,
  bottomPanelVisible: false,
  activeBottomPanelTab: "工作流运行",
  focusMode: false,
  workspaceLayout: {
    conversationPanelMode: "docked",
    navigatorWidth: 260,
    inspectorWidth: 320,
    bottomPanelHeight: 180
  }
};

export interface UserPreferencesSnapshot {
  readonly schemaVersion: "1.0" | "1.1" | "1.2";
  readonly onboarding: UserOnboardingPreferences;
  readonly editor: UserEditorPreferences;
  readonly appearance: UserAppearancePreferences;
  readonly shell: UserShellPreferences;
}

export type UserPreferencesSaveInput = Partial<{
  readonly onboarding: Partial<UserOnboardingPreferences>;
  readonly editor: Partial<UserEditorPreferences>;
  readonly appearance: Partial<UserAppearancePreferences>;
  readonly shell: Omit<Partial<UserShellPreferences>, "workspaceLayout"> & {
    readonly workspaceLayout?: Partial<UserWorkspaceLayoutPreferences> & {
      /** Legacy input accepted for one migration cycle; normalized preferences do not write it. */
      readonly splitView?: boolean;
    };
  };
}>;

export interface UserPreferencesPort {
  readUserPreferences(): Promise<Result<UserPreferencesSnapshot | undefined, UnifiedError>>;
  writeUserPreferences(
    preferences: UserPreferencesSnapshot
  ): Promise<Result<UserPreferencesSnapshot, UnifiedError>>;
}
