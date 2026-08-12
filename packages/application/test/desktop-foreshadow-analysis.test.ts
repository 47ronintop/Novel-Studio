import { describe, expect, test, vi } from "vitest";

import { ok } from "@novel-studio/shared";

import {
  createDesktopApplication,
  type EngineeringWorkspaceSession,
  type ForeshadowAnalysisInput,
  type ForeshadowAnalysisResult,
  type ForeshadowAnalysisSession,
  type ProjectWorkspaceSession,
  type ProjectWorkspaceSnapshot,
  type StoryBibleSession
} from "../src/index.js";

const NOW = "2026-07-30T00:00:00.000Z";
const CHAPTER_ID = "ch_01";

describe("DesktopApplication foreshadow analysis", () => {
  test("creates a session for the creative project root captured by each request", async () => {
    const roots: string[] = [];
    const inputs: ForeshadowAnalysisInput[] = [];
    const workspace = createProjectWorkspaceSessionStub("D:/Novel/M20");
    const application = createDesktopApplication({
      projectWorkspaceSession: workspace,
      createForeshadowAnalysisSession: (projectRoot: string) => {
        roots.push(projectRoot);
        return createAnalysisSession(inputs);
      }
    });

    await expect(application.detectForeshadows({ chapterIds: [CHAPTER_ID] })).resolves.toEqual(
      ok(analysisResult([CHAPTER_ID]))
    );

    await workspace.openProject("D:/Novel/M21");
    await expect(application.detectForeshadows({ chapterIds: [CHAPTER_ID] })).resolves.toEqual(
      ok(analysisResult([CHAPTER_ID]))
    );

    expect(roots).toEqual(["D:/Novel/M20", "D:/Novel/M21"]);
    expect(inputs).toEqual([{ chapterIds: [CHAPTER_ID] }, { chapterIds: [CHAPTER_ID] }]);
  });

  test("rejects analysis before creating a session when no creative project is active", async () => {
    const createSession = vi.fn<(projectRoot: string) => ForeshadowAnalysisSession>();
    const application = createDesktopApplication({
      createForeshadowAnalysisSession: createSession
    });

    await expect(
      application.detectForeshadows({ chapterIds: [CHAPTER_ID] })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_UNAVAILABLE" }
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  test("rejects analysis before creating or running a session in engineering mode", async () => {
    const analyze = vi.fn<ForeshadowAnalysisSession["analyze"]>();
    const createSession = vi.fn<(projectRoot: string) => ForeshadowAnalysisSession>(() => ({
      analyze
    }));
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSessionStub("D:/Novel/M20"),
      engineeringWorkspaceSession: createEngineeringWorkspaceSessionStub(),
      createForeshadowAnalysisSession: createSession
    });

    await expect(
      application.detectForeshadows({ chapterIds: [CHAPTER_ID] })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_UNAVAILABLE" }
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
  });

  test("returns successful candidates without saving Story Bible data or invalidating search", async () => {
    const saveStoryAsset = vi.fn<StoryBibleSession["saveStoryAsset"]>(async (asset) => ok(asset));
    const saveMemory = vi.fn<StoryBibleSession["saveMemory"]>(async (memory) => ok(memory));
    const invalidateSearch = vi.fn(async () => ok(undefined));
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSessionStub("D:/Novel/M20"),
      storyBibleSession: createStoryBibleSessionStub({ saveStoryAsset, saveMemory }),
      createProjectSearchSession: () => ({
        getState: () => "clean" as const,
        invalidate: invalidateSearch,
        async rebuildIndex() {
          throw new Error("not used");
        },
        async search() {
          throw new Error("not used");
        }
      }),
      createForeshadowAnalysisSession: () => createAnalysisSession([])
    });

    await expect(application.detectForeshadows({ chapterIds: [CHAPTER_ID] })).resolves.toEqual(
      ok(analysisResult([CHAPTER_ID]))
    );

    expect(saveStoryAsset).not.toHaveBeenCalled();
    expect(saveMemory).not.toHaveBeenCalled();
    expect(invalidateSearch).not.toHaveBeenCalled();
  });

  test("discards a completed analysis after the active project changes", async () => {
    const completed = createDeferred<Awaited<ReturnType<ForeshadowAnalysisSession["analyze"]>>>();
    const workspace = createProjectWorkspaceSessionStub("D:/Novel/M20");
    const application = createDesktopApplication({
      projectWorkspaceSession: workspace,
      createForeshadowAnalysisSession: () => ({
        analyze: () => completed.promise
      })
    });

    const pending = application.detectForeshadows({ chapterIds: [CHAPTER_ID] });
    await expect(application.openProject("D:/Novel/M21")).resolves.toMatchObject({ ok: true });
    completed.resolve(ok(analysisResult([CHAPTER_ID])));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_WORKSPACE_CHANGED" }
    });
  });
});

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function createAnalysisSession(inputs: ForeshadowAnalysisInput[]): ForeshadowAnalysisSession {
  return {
    async analyze(input) {
      inputs.push(input);
      return ok(analysisResult(input.chapterIds));
    }
  };
}

function analysisResult(chapterIds: readonly string[]): ForeshadowAnalysisResult {
  return {
    analysisId: "fsa_0123456789abcdef0123456789abcdef",
    chapterIds,
    candidates: [],
    usage: {
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      usageStatus: "actual",
      cost: { amount: 0.01, currency: "USD", status: "actual" }
    },
    createdAt: NOW
  };
}

function createProjectWorkspaceSessionStub(initialProjectRoot: string): ProjectWorkspaceSession {
  let snapshot = projectSnapshot(initialProjectRoot);
  return {
    getSnapshot: () => snapshot,
    getActiveChapterEditorSession: () => undefined,
    async openProject(projectRoot) {
      snapshot = projectSnapshot(projectRoot);
      return ok(snapshot);
    },
    async createProject() {
      throw new Error("not used");
    },
    async createProjectInParent() {
      throw new Error("not used");
    },
    async importProjectInParent() {
      throw new Error("not used");
    },
    async refreshFromRepository() {
      return ok(snapshot);
    },
    async listChapters() {
      return ok([]);
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
      throw new Error("not used");
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

function projectSnapshot(projectRoot: string): ProjectWorkspaceSnapshot {
  return {
    projectRoot,
    project: {
      schemaVersion: "1.0",
      projectId: "prj_foreshadow_test",
      title: "Foreshadow Test",
      projectType: "novel",
      language: "zh-CN",
      createdAt: NOW,
      updatedAt: NOW
    },
    settings: {
      schemaVersion: "1.0",
      autosave: {},
      history: {},
      models: {}
    },
    chapters: [],
    recovery: { availableItems: [] },
    health: {
      status: "healthy",
      checkedAt: NOW,
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
      issues: []
    }
  };
}

function createStoryBibleSessionStub(
  overrides: Pick<StoryBibleSession, "saveStoryAsset" | "saveMemory">
): StoryBibleSession {
  return {
    getSnapshot: () => undefined,
    clearSnapshot: () => undefined,
    async loadStoryBible() {
      throw new Error("not used");
    },
    saveStoryAsset: overrides.saveStoryAsset,
    saveMemory: overrides.saveMemory,
    async buildConsistencyReport() {
      throw new Error("not used");
    },
    async buildContextCandidates() {
      throw new Error("not used");
    }
  };
}

function createEngineeringWorkspaceSessionStub(): EngineeringWorkspaceSession {
  return {
    getActivation: () => undefined,
    getSnapshot: () => undefined,
    async openEngineeringWorkspace() {
      throw new Error("not used");
    },
    async attachCreativeProject() {
      throw new Error("not used");
    },
    async refreshWorkspace() {
      throw new Error("not used");
    },
    async readTextFile() {
      throw new Error("not used");
    },
    async saveTextFile() {
      throw new Error("not used");
    },
    async releaseWorkspaceLock() {
      return ok(undefined);
    }
  };
}
