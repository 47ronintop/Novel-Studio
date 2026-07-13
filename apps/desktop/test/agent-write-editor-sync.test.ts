import { describe, expect, test, vi } from "vitest";

import { syncSavedEditorForPath } from "../src/main/index.js";

describe("desktop Agent write editor synchronization", () => {
  test("reloads the currently active chapter after a matching Agent write", async () => {
    const loadActiveChapter = vi.fn(async () => ({ ok: true }));
    const application = {
      readActiveChapterState: vi.fn(async () => ({
        ok: true,
        value: {
          state: {
            dirty: false,
            chapter: {
              frontmatter: { id: "chapter-after-switch" }
            }
          }
        }
      })),
      loadActiveChapter
    };

    await syncSavedEditorForPath(application as never, "chapters/chapter-after-switch.md");

    expect(loadActiveChapter).toHaveBeenCalledOnce();
  });

  test("preserves a dirty active editor and reports synchronization failure", async () => {
    const loadActiveChapter = vi.fn(async () => ({ ok: true }));
    const application = {
      readActiveChapterState: vi.fn(async () => ({
        ok: true,
        value: {
          state: {
            dirty: true,
            chapter: {
              frontmatter: { id: "chapter-dirty-after-agent-write" }
            }
          }
        }
      })),
      loadActiveChapter
    };

    await expect(
      syncSavedEditorForPath(application as never, "chapters/chapter-dirty-after-agent-write.md")
    ).rejects.toMatchObject({
      code: "AGENT_WRITE_EDITOR_SYNC_DIRTY",
      recoverability: "user-action"
    });
    expect(loadActiveChapter).not.toHaveBeenCalled();
  });
});
