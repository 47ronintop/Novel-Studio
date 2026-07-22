import { describe, expect, test } from "vitest";

import { DEFAULT_USER_SHELL_PREFERENCES, ok } from "@novel-studio/shared";
import {
  createDefaultUserPreferences,
  createUserPreferencesSession
} from "../src/user-preferences-session.js";
import type {
  UserPreferencesSnapshot,
  UserPreferencesPort
} from "../src/user-preferences-session.js";

describe("UserPreferencesSession", () => {
  test("loads defaults when no preferences have been saved", async () => {
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(undefined),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toEqual(
      ok({
        schemaVersion: "1.0",
        onboarding: { dismissed: false },
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
      })
    );
    expect(createDefaultUserPreferences().shell).toEqual(DEFAULT_USER_SHELL_PREFERENCES);
    expect(createDefaultUserPreferences().shell).toMatchObject({
      workbenchMode: "creative",
      creativeNavigatorMode: "writing",
      engineeringExpandedPathIds: [],
      inspectorCollapsed: false
    });
  });

  test("preserves explicit empty expansion state when preferences round-trip", async () => {
    let saved: UserPreferencesSnapshot | undefined;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(saved),
        writeUserPreferences: async (preferences) => {
          saved = preferences;
          return ok(preferences);
        }
      }
    });

    const saveResult = await session.save({
      shell: {
        engineeringExpandedPathIds: [],
        navigatorExpandedSectionIds: []
      }
    });
    const loaded = await session.load();

    expect(saveResult).toMatchObject({
      ok: true,
      value: {
        shell: {
          engineeringExpandedPathIds: [],
          navigatorExpandedSectionIds: []
        }
      }
    });
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          engineeringExpandedPathIds: [],
          navigatorExpandedSectionIds: []
        }
      }
    });
  });

  test("saves and returns user preferences through the injected port", async () => {
    let saved: UserPreferencesSnapshot | undefined;
    const preferencesPort: UserPreferencesPort = {
      readUserPreferences: async () => ok(saved),
      writeUserPreferences: async (preferences) => {
        saved = preferences;
        return ok(preferences);
      }
    };
    const session = createUserPreferencesSession({ preferencesPort });

    const saveResult = await session.save({
      onboarding: { dismissed: true },
      shell: {
        navigatorCollapsed: true,
        navigatorExpandedSectionIds: ["chapters", "prompts"],
        inspectorCollapsed: true,
        bottomPanelVisible: false,
        activeBottomPanelTab: "搜索",
        workspaceLayout: {
          splitView: true,
          navigatorWidth: 300,
          inspectorWidth: 280,
          bottomPanelHeight: 180
        }
      },
      editor: {
        fontFamily: "serif",
        fontSize: 16,
        lineHeight: 1.8
      },
      appearance: {
        theme: "light",
        accentColor: "blue"
      }
    });
    const loaded = await session.load();

    expect(saveResult.ok).toBe(true);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.onboarding.dismissed).toBe(true);
      expect(loaded.value.shell.workspaceLayout.splitView).toBe(true);
      expect(loaded.value.shell.activeBottomPanelTab).toBe("搜索");
      expect(loaded.value.shell.navigatorExpandedSectionIds).toEqual(["chapters", "prompts"]);
      expect(loaded.value.editor).toEqual({
        fontFamily: "serif",
        fontSize: 16,
        lineHeight: 1.8
      });
      expect(loaded.value.appearance).toEqual({
        theme: "light",
        accentColor: "blue"
      });
    }
  });

  test("normalizes legacy density preferences without changing editor or shell values", async () => {
    const persisted = {
      schemaVersion: "1.0",
      onboarding: { dismissed: true },
      editor: {
        fontFamily: "sans",
        fontSize: 18,
        lineHeight: 1.5
      },
      appearance: {
        theme: "system",
        density: "comfortable"
      } as unknown as UserPreferencesSnapshot["appearance"],
      shell: {
        navigatorCollapsed: true,
        navigatorExpandedSectionIds: ["characters", "timeline"],
        inspectorCollapsed: false,
        bottomPanelVisible: true,
        activeBottomPanelTab: "搜索",
        focusMode: true,
        workspaceLayout: {
          splitView: true,
          navigatorWidth: 300,
          inspectorWidth: 280,
          bottomPanelHeight: 220
        }
      }
    } as unknown as UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        onboarding: persisted.onboarding,
        editor: persisted.editor,
        appearance: {
          theme: "system",
          accentColor: "teal"
        },
        shell: {
          navigatorCollapsed: true,
          navigatorExpandedSectionIds: ["characters", "timeline"],
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          activeBottomPanelTab: "搜索",
          focusMode: true,
          workspaceLayout: persisted.shell.workspaceLayout
        }
      }
    });
  });

  test("fills appearance defaults when the entire legacy appearance field is missing", async () => {
    const persisted = {
      schemaVersion: "1.0",
      onboarding: { dismissed: true },
      editor: {
        fontFamily: "mono",
        fontSize: 13,
        lineHeight: 1.7
      },
      shell: {
        navigatorCollapsed: false,
        navigatorExpandedSectionIds: ["chapters"],
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
    } as unknown as UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        appearance: {
          theme: "dark",
          accentColor: "teal"
        }
      }
    });
  });

  test("makes the Agent panel visible when loading legacy shell preferences", async () => {
    const persisted = {
      schemaVersion: "1.0",
      onboarding: { dismissed: false },
      editor: {
        fontFamily: "mono",
        fontSize: 13,
        lineHeight: 1.7
      },
      appearance: {
        theme: "dark",
        accentColor: "teal"
      },
      shell: {
        navigatorCollapsed: false,
        navigatorExpandedSectionIds: ["chapters"],
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
    } as unknown as UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          navigatorCollapsed: false,
          workbenchMode: "creative",
          creativeNavigatorMode: "writing",
          engineeringExpandedPathIds: [],
          inspectorCollapsed: false,
          bottomPanelVisible: false,
          workspaceLayout: {
            bottomPanelHeight: 180
          }
        }
      }
    });
  });

  test("preserves an explicitly collapsed Agent panel in modern preferences", async () => {
    const defaults = createDefaultUserPreferences();
    const persisted = {
      ...defaults,
      shell: {
        ...defaults.shell,
        workbenchMode: "creative",
        creativeNavigatorMode: "writing",
        engineeringExpandedPathIds: [],
        inspectorCollapsed: true
      }
    } as UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          workbenchMode: "creative",
          inspectorCollapsed: true
        }
      }
    });
  });

  test("preserves explicit layout choices in modern preferences", async () => {
    const defaults = createDefaultUserPreferences();
    const persisted = {
      ...defaults,
      shell: {
        ...defaults.shell,
        workbenchMode: "creative",
        inspectorCollapsed: false,
        bottomPanelVisible: true,
        workspaceLayout: {
          ...defaults.shell.workspaceLayout,
          bottomPanelHeight: 220
        }
      }
    } satisfies UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          workbenchMode: "creative",
          inspectorCollapsed: false,
          bottomPanelVisible: true,
          workspaceLayout: {
            bottomPanelHeight: 220
          }
        }
      }
    });
  });

  test("normalizes unknown modes and de-duplicates expansion state", async () => {
    const defaults = createDefaultUserPreferences();
    const persisted = {
      ...defaults,
      shell: {
        ...defaults.shell,
        workbenchMode: "unknown",
        creativeNavigatorMode: "unknown",
        engineeringExpandedPathIds: ["src", "src", 42],
        navigatorExpandedSectionIds: ["chapters", "chapters", 42]
      }
    } as unknown as UserPreferencesSnapshot;
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          workbenchMode: "creative",
          creativeNavigatorMode: "writing",
          engineeringExpandedPathIds: ["src"],
          navigatorExpandedSectionIds: ["chapters"]
        }
      }
    });
  });
});
