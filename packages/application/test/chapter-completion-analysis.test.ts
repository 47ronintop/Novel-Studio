import { describe, expect, test, vi } from "vitest";

import { ok, type ChapterDocument } from "@novel-studio/shared";

import {
  createChapterEditorSession,
  createDesktopApplication,
  type ChapterEditorSession,
  type ModelSettingsSession,
  type ProjectWorkspaceSession,
  type ProjectWorkspaceSnapshot,
  type StoryAnalysisSession,
  type StoryAnalysisSettings
} from "../src/index.js";

const NOW = "2026-07-31T10:00:00.000Z";
const CHAPTER_ID = "ch_completion_analysis";

describe("DesktopApplication chapter completion analysis", () => {
  test("does not inspect settings or run analysis for an ordinary chapter save", async () => {
    const fixture = createFixture("background-review");
    await fixture.application.loadActiveChapter();
    await fixture.application.editActiveChapter("Revised body.\n");

    await expect(fixture.application.saveActiveChapter()).resolves.toMatchObject({
      ok: true,
      value: { state: { chapter: { frontmatter: { status: "draft" } } } }
    });
    expect(fixture.readSettings).not.toHaveBeenCalled();
    expect(fixture.createAnalysisSession).not.toHaveBeenCalled();
    expect(fixture.analyzeChapter).not.toHaveBeenCalled();
  });

  test.each([
    ["off", "disabled"],
    ["prompt", "prompt"],
    ["background-review", "scheduled"]
  ] as const)("handles the %s completion mode", async (mode, expectedStatus) => {
    const fixture = createFixture(mode);
    await fixture.application.loadActiveChapter();

    await expect(fixture.application.saveActiveChapterStatus("done")).resolves.toMatchObject({
      ok: true,
      value: {
        chapter: { state: { chapter: { frontmatter: { status: "done" } } } },
        completionAnalysis: { status: expectedStatus }
      }
    });
    expect(fixture.readSettings).toHaveBeenCalledTimes(1);
    expect(fixture.createAnalysisSession).toHaveBeenCalledTimes(mode === "background-review" ? 1 : 0);
    expect(fixture.analyzeChapter).toHaveBeenCalledTimes(mode === "background-review" ? 1 : 0);
    if (mode === "background-review") {
      expect(fixture.analyzeChapter).toHaveBeenCalledWith({
        chapterId: CHAPTER_ID,
        trigger: "chapter_completed"
      });
    }
  });

  test("does not trigger analysis again when an already completed chapter is saved as done", async () => {
    const fixture = createFixture("prompt");
    await fixture.application.loadActiveChapter();

    await fixture.application.saveActiveChapterStatus("done");
    await expect(fixture.application.saveActiveChapterStatus("done")).resolves.toMatchObject({
      ok: true,
      value: { completionAnalysis: { status: "not-triggered" } }
    });
    expect(fixture.readSettings).toHaveBeenCalledTimes(1);
    expect(fixture.writes).toHaveLength(1);
  });

  test("keeps the completed chapter saved when background analysis rejects", async () => {
    const fixture = createFixture("background-review", true);
    await fixture.application.loadActiveChapter();

    await expect(fixture.application.saveActiveChapterStatus("done")).resolves.toMatchObject({
      ok: true,
      value: { completionAnalysis: { status: "scheduled" } }
    });
    await Promise.resolve();
    expect(fixture.persisted().frontmatter.status).toBe("done");
    expect(fixture.writes).toHaveLength(1);
  });
});

function createFixture(mode: StoryAnalysisSettings["completionMode"], rejectAnalysis = false) {
  const writes: ChapterDocument[] = [];
  let persisted = createChapter();
  const chapterEditorSession = createChapterEditorSession({
    chapterId: CHAPTER_ID,
    repository: {
      async readChapter() {
        return ok(structuredClone(persisted));
      },
      async writeChapter(chapter) {
        persisted = structuredClone(chapter);
        writes.push(structuredClone(chapter));
        return ok(chapter);
      }
    },
    now: () => NOW
  });
  const readSettings = vi.fn(async () => ok({ completionMode: mode }));
  const analyzeChapter = vi.fn<StoryAnalysisSession["analyzeChapter"]>(async () => {
    if (rejectAnalysis) throw new Error("observer unavailable");
    throw new Error("The test does not need a completed analysis record.");
  });
  const analysisSession = createStoryAnalysisSessionStub(analyzeChapter);
  const createAnalysisSession = vi.fn(() => analysisSession);
  const application = createDesktopApplication({
    chapterEditorSession,
    projectWorkspaceSession: createProjectWorkspaceSessionStub(chapterEditorSession),
    modelSettingsSession: createModelSettingsSessionStub(readSettings),
    createStoryAnalysisSession: createAnalysisSession
  });

  return {
    application,
    analyzeChapter,
    createAnalysisSession,
    persisted: () => persisted,
    readSettings,
    writes
  };
}

function createChapter(): ChapterDocument {
  return {
    frontmatter: {
      schemaVersion: "1.0",
      id: CHAPTER_ID,
      type: "chapter",
      title: "Completion analysis",
      order: 1,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW
    },
    body: "Chapter body.\n"
  };
}

function createModelSettingsSessionStub(
  readStoryAnalysisSettings: ModelSettingsSession["readStoryAnalysisSettings"]
): ModelSettingsSession {
  return {
    readStoryAnalysisSettings,
    async saveStoryAnalysisSettings(settings) {
      return ok(settings);
    },
    async listModelProfiles() {
      return ok({ defaultProfileId: "", profiles: [] });
    },
    async saveModelProfile() {
      return ok({ defaultProfileId: "", profiles: [] });
    },
    async testModelProfileConnection() {
      return ok({ ok: true, provider: "mock", modelName: "mock", detail: "ok" });
    },
    async discoverModelOptions(profileId) {
      return ok({
        profileId,
        provider: "mock",
        status: "fallback",
        models: [],
        fallbackReason: "not configured",
        reasoningStrength: { status: "hidden", reason: "not configured" }
      });
    }
  };
}

function createStoryAnalysisSessionStub(
  analyzeChapter: StoryAnalysisSession["analyzeChapter"]
): StoryAnalysisSession {
  return {
    analyzeChapter,
    async transitionRecord() {
      throw new Error("not used");
    },
    async transitionRecords() {
      throw new Error("not used");
    },
    async refreshStaleness() {
      throw new Error("not used");
    },
    async listAnalyses() {
      return ok([]);
    },
    async readAnalysis() {
      throw new Error("not used");
    }
  };
}

function createProjectWorkspaceSessionStub(
  chapterEditorSession: ChapterEditorSession
): ProjectWorkspaceSession {
  const snapshot = projectSnapshot();
  return {
    getSnapshot: () => snapshot,
    getActiveChapterEditorSession: () => chapterEditorSession,
    async openProject() {
      return ok(snapshot);
    },
    async createProject() {
      throw new Error("not used");
    },
    async createProjectInParent() {
      throw new Error("not used");
    },
    async listChapters() {
      return ok(snapshot.chapters);
    },
    async createChapter() {
      throw new Error("not used");
    },
    async renameChapter() {
      throw new Error("not used");
    },
    async duplicateChapter() {
      throw new Error("not used");
    },
    async deleteChapter() {
      throw new Error("not used");
    },
    async selectChapter() {
      return ok(snapshot);
    },
    async selectChapterAndLoad() {
      throw new Error("not used");
    },
    async previewRecoveryDraft() {
      throw new Error("not used");
    },
    async applyRecoveryDraft() {
      throw new Error("not used");
    },
    async discardRecoveryDraft() {
      throw new Error("not used");
    },
    async releaseProjectLock() {
      return ok(undefined);
    }
  };
}

function projectSnapshot(): ProjectWorkspaceSnapshot {
  return {
    projectRoot: "D:/Novel/CompletionAnalysis",
    project: {
      schemaVersion: "1.0",
      projectId: "prj_completion_analysis",
      title: "Completion analysis",
      projectType: "novel",
      language: "zh-CN",
      createdAt: NOW,
      updatedAt: NOW
    },
    settings: { schemaVersion: "1.0", autosave: {}, history: {}, models: {} },
    chapters: [
      {
        id: CHAPTER_ID,
        title: "Completion analysis",
        order: 1,
        status: "draft",
        updatedAt: NOW
      }
    ],
    recovery: { availableItems: [] },
    health: {
      status: "healthy",
      checkedAt: NOW,
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
      issues: []
    },
    activeChapterId: CHAPTER_ID
  };
}
