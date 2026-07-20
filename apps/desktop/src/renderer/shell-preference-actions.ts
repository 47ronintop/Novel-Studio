import type { DesktopShellState, UserPreferencesSaveInput } from "@novel-studio/application";
import type { CreativeNavigatorMode } from "@novel-studio/shared";
import { useCallback, type Dispatch, type SetStateAction } from "react";

import { shellPreferencesFromState } from "./app-shell-support.js";

export function useShellPreferenceActions(
  setShellState: Dispatch<SetStateAction<DesktopShellState>>,
  persistUserPreferences: (input: UserPreferencesSaveInput) => void
) {
  const handleCreativeNavigatorModeSelect = useCallback(
    (mode: CreativeNavigatorMode) => {
      setShellState((current) => {
        const next = { ...current, creativeNavigatorMode: mode };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences, setShellState]
  );

  const handleNavigatorExpandedSectionIdsChange = useCallback(
    (sectionIds: readonly string[]) => {
      setShellState((current) => {
        const next = { ...current, navigatorExpandedSectionIds: [...sectionIds] };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences, setShellState]
  );

  const handleEngineeringExpandedPathIdsChange = useCallback(
    (pathIds: readonly string[]) => {
      setShellState((current) => {
        const next = { ...current, engineeringExpandedPathIds: [...pathIds] };
        persistUserPreferences({ shell: shellPreferencesFromState(next) });
        return next;
      });
    },
    [persistUserPreferences, setShellState]
  );

  return {
    handleCreativeNavigatorModeSelect,
    handleNavigatorExpandedSectionIdsChange,
    handleEngineeringExpandedPathIdsChange
  };
}
