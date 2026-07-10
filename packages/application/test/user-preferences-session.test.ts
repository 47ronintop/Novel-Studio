import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";
import { createUserPreferencesSession } from "../src/user-preferences-session.js";
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
          navigatorExpandedSectionIds: [
            "chapters",
            "characters",
            "world",
            "outline",
            "timeline",
            "memories",
            "prompts",
            "agents",
            "workflows"
          ],
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
      })
    );
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
    const persisted: UserPreferencesSnapshot = {
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
    };
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () => ok(persisted),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toEqual(
      ok({
        ...persisted,
        appearance: {
          theme: "system",
          accentColor: "teal"
        }
      })
    );
  });

  test("migrates the legacy expanded default layout to the calmer writing default", async () => {
    const session = createUserPreferencesSession({
      preferencesPort: {
        readUserPreferences: async () =>
          ok({
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
              inspectorCollapsed: false,
              bottomPanelVisible: true,
              activeBottomPanelTab: "工作流运行",
              focusMode: false,
              workspaceLayout: {
                splitView: false,
                navigatorWidth: 260,
                inspectorWidth: 320,
                bottomPanelHeight: 220
              }
            }
          }),
        writeUserPreferences: async (preferences) => ok(preferences)
      }
    });

    const loaded = await session.load();

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        shell: {
          navigatorCollapsed: false,
          inspectorCollapsed: true,
          bottomPanelVisible: false,
          workspaceLayout: {
            bottomPanelHeight: 180
          }
        }
      }
    });
  });
});
