import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import * as ipcExports from "../src/main/ipc-handlers.js";

describe("Agent write chapter-save coordination", () => {
  test("waits for an active save, rejects saves while paused, and allows saving after resume", async () => {
    const createCoordinator = (ipcExports as unknown as Record<string, unknown>)[
      "createAgentWriteSaveCoordinator"
    ];
    expect(typeof createCoordinator).toBe("function");
    if (typeof createCoordinator !== "function") return;

    const chapterId = "chapter-save-guard";
    const relativePath = `chapters/${chapterId}.md`;
    let finishFirstSave: (() => void) | undefined;
    const firstSave = new Promise<ReturnType<typeof savedSnapshot>>((resolve) => {
      finishFirstSave = () => resolve(savedSnapshot(chapterId));
    });
    const saveActiveChapter = vi
      .fn()
      .mockImplementationOnce(async () => firstSave)
      .mockResolvedValue(savedSnapshot(chapterId));
    const application = {
      readActiveChapterState: vi.fn(async () => savedSnapshot(chapterId)),
      saveActiveChapter
    };
    const coordinator = (
      createCoordinator as () => {
        pauseAutosave(relativePaths: readonly string[]): Promise<void>;
        resumeAutosave(relativePaths: readonly string[]): Promise<void>;
      }
    )();
    const createHandlers = ipcExports.createApplicationIpcHandlers as unknown as (
      application: Record<string, unknown>,
      options: Record<string, unknown>
    ) => Record<string, () => Promise<unknown>>;
    const handlers = createHandlers(application, { agentWriteSaveCoordinator: coordinator });

    const activeSave = handlers["application:chapter:save"]?.();
    await vi.waitFor(() => expect(saveActiveChapter).toHaveBeenCalledTimes(1));
    let pauseFinished = false;
    const pause = coordinator.pauseAutosave([relativePath]).then(() => {
      pauseFinished = true;
    });
    await Promise.resolve();
    expect(pauseFinished).toBe(false);

    finishFirstSave?.();
    await activeSave;
    await pause;

    const blocked = await handlers["application:chapter:save"]?.();
    expect(blocked).toMatchObject({
      ok: false,
      error: {
        code: "CHAPTER_SAVE_PAUSED_FOR_AGENT_WRITE",
        category: "UserError",
        recoverability: "user-action"
      }
    });
    expect(() => structuredClone(blocked)).not.toThrow();
    expect(saveActiveChapter).toHaveBeenCalledTimes(1);

    await coordinator.resumeAutosave([relativePath]);
    await expect(handlers["application:chapter:save"]?.()).resolves.toMatchObject({ ok: true });
    expect(saveActiveChapter).toHaveBeenCalledTimes(2);
  });
});

function savedSnapshot(chapterId: string) {
  return ok({
    state: {
      dirty: false,
      chapter: {
        frontmatter: { id: chapterId }
      }
    }
  });
}
