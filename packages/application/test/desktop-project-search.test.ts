import { describe, expect, test } from "vitest";

import { createDesktopApplication, createProjectSearchSession } from "../src/index.js";
import { ok } from "@novel-studio/shared";

describe("DesktopApplication project search", () => {
  test("returns a stable error when no project is open", async () => {
    const application = createDesktopApplication();

    const result = await application.searchProject({ query: "oath" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("PROJECT_SEARCH_UNAVAILABLE");
    expect(result.error.redactedDetail).toBeUndefined();
  });

  test("creates a project-bound search session from the active workspace root", async () => {
    const roots: string[] = [];
    const application = createDesktopApplication({
      projectWorkspaceSession: {
        getSnapshot: () => ({
          projectRoot: "D:/Novel/M20",
          project: {
            schemaVersion: "1.0",
            projectId: "prj_m20",
            title: "M20",
            projectType: "novel",
            language: "zh-CN",
            createdAt: "2026-07-05T00:00:00.000Z",
            updatedAt: "2026-07-05T00:00:00.000Z"
          },
          settings: {
            schemaVersion: "1.0",
            autosave: {},
            history: {},
            models: {}
          },
          chapters: [],
          recovery: {
            availableItems: []
          },
          health: {
            status: "healthy",
            checkedAt: "2026-07-05T00:00:00.000Z",
            summary: {
              errorCount: 0,
              warningCount: 0,
              infoCount: 0
            },
            issues: []
          }
        }),
        getActiveChapterEditorSession: () => undefined,
        openProject: async () => {
          throw new Error("not used");
        },
        createProject: async () => {
          throw new Error("not used");
        },
        listChapters: async () => ok([]),
        createChapter: async () => {
          throw new Error("not used");
        },
        selectChapter: async () => {
          throw new Error("not used");
        },
        releaseProjectLock: async () => {
          return ok(undefined);
        }
      },
      createProjectSearchSession: (projectRoot) => {
        roots.push(projectRoot);
        return createProjectSearchSession({
          repository: {
            async rebuildIndex() {
              throw new Error("not used");
            },
            async search(input) {
              return ok({
                query: input.query,
                generatedAt: "2026-07-05T00:00:00.000Z",
                entryCount: 0,
                results: []
              });
            }
          }
        });
      }
    });

    const result = await application.searchProject({ query: "oath" });

    expect(result.ok).toBe(true);
    expect(roots).toEqual(["D:/Novel/M20"]);
  });
});
