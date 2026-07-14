import { describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";

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

  test("reloads a dirty editor only after an explicit rollback restore decision", async () => {
    const loadActiveChapter = vi.fn(async () => ({ ok: true }));
    const application = {
      readActiveChapterState: vi.fn(async () => ({
        ok: true,
        value: {
          state: {
            dirty: true,
            chapter: {
              frontmatter: { id: "chapter-explicit-rollback" },
              body: "reviewed dirty editor"
            }
          }
        }
      })),
      loadActiveChapter
    };

    await syncSavedEditorForPath(
      application as never,
      "chapters/chapter-explicit-rollback.md",
      { expectedDirtyChecksum: sha256("reviewed dirty editor") }
    );

    expect(loadActiveChapter).toHaveBeenCalledOnce();
  });

  test("refuses to reload when the dirty editor changed after rollback review", async () => {
    const loadActiveChapter = vi.fn(async () => ({ ok: true }));
    const application = {
      readActiveChapterState: vi.fn(async () => ({
        ok: true,
        value: {
          state: {
            dirty: true,
            chapter: {
              frontmatter: { id: "chapter-stale-rollback" },
              body: "dirty B"
            }
          }
        }
      })),
      loadActiveChapter
    };

    await expect(
      syncSavedEditorForPath(
        application as never,
        "chapters/chapter-stale-rollback.md",
        {
          expectedDirtyChecksum: sha256("dirty A")
        }
      )
    ).rejects.toMatchObject({
      code: "AGENT_WRITE_EDITOR_SYNC_STALE",
      recoverability: "user-action"
    });
    expect(loadActiveChapter).not.toHaveBeenCalled();
  });
});

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
