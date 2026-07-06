import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { UserPreferencesFileRepository } from "../src/user-preferences-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("UserPreferencesFileRepository", () => {
  test("returns undefined when the preferences file does not exist", async () => {
    const root = await createTempRoot();
    const repository = new UserPreferencesFileRepository({ userDataRoot: root });

    const result = await repository.readUserPreferences();

    expect(result).toEqual({ ok: true, value: undefined });
  });

  test("writes and reads user preferences without project content", async () => {
    const root = await createTempRoot();
    const repository = new UserPreferencesFileRepository({ userDataRoot: root });

    const written = await repository.writeUserPreferences({
      schemaVersion: "1.0",
      onboarding: { dismissed: true },
      shell: {
        navigatorCollapsed: true,
        inspectorCollapsed: false,
        bottomPanelVisible: true,
        activeBottomPanelTab: "问题",
        workspaceLayout: {
          splitView: true,
          navigatorWidth: 300,
          inspectorWidth: 280,
          bottomPanelHeight: 220
        }
      }
    });
    const readBack = await repository.readUserPreferences();
    const raw = await readFile(join(root, "user-preferences.json"), "utf8");

    expect(written.ok).toBe(true);
    expect(readBack).toEqual(written);
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("正文");
  });
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-user-prefs-"));
  tempRoots.push(root);
  return root;
}
