import { describe, expect, test, vi } from "vitest";

import {
  createDesktopApplication,
  createProjectSearchSession,
  type MemoryRecord,
  type ProjectSearchIndex,
  type ProjectWorkspaceSession,
  type ProjectWorkspaceSnapshot,
  type StoryAnalysisApplicationResult,
  type StoryAnalysisApplicationSession,
  type StoryBibleAsset,
  type StoryBibleSession
} from "../src/index.js";
import { createUnifiedError, err, ok } from "@novel-studio/shared";

const now = "2026-07-05T00:00:00.000Z";
const emptyIndex: ProjectSearchIndex = {
  schemaVersion: "1.0",
  generatedAt: now,
  entryCount: 0,
  entries: []
};

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

  test("owns one search session per active project and replaces it on project switch", async () => {
    const roots: string[] = [];
    const workspaceSession = createProjectWorkspaceSessionStub("D:/Novel/M20");
    const application = createDesktopApplication({
      projectWorkspaceSession: workspaceSession,
      createProjectSearchSession: (projectRoot) => {
        roots.push(projectRoot);
        return createProjectSearchSession({
          repository: {
            async invalidate() {
              return ok(undefined);
            },
            async rebuildIndex() {
              return ok(emptyIndex);
            },
            async search(input) {
              return ok(emptySearchResults(input.query));
            }
          }
        });
      }
    });

    await application.searchProject({ query: "oath" });
    await application.searchProject({ query: "gate" });
    await application.rebuildProjectSearchIndex();

    expect(roots).toEqual(["D:/Novel/M20"]);

    const opened = await application.openProject("D:/Novel/M21");
    expect(opened.ok).toBe(true);
    await application.searchProject({ query: "bell" });

    expect(roots).toEqual(["D:/Novel/M20", "D:/Novel/M21"]);
  });

  test("ignores stale Agent notifications after project switch and close", async () => {
    const invalidations: string[] = [];
    const application = createDesktopApplication({
      createProjectWorkspaceSession: () => createProjectWorkspaceSessionStub("D:/Novel/Bootstrap"),
      createProjectSearchSession: (projectRoot) => ({
        getState: () => "clean" as const,
        async invalidate(reason) {
          invalidations.push(`${projectRoot}:${reason}`);
          return ok(undefined);
        },
        async rebuildIndex() {
          return ok(emptyIndex);
        },
        async search(input) {
          return ok(emptySearchResults(input.query));
        }
      })
    });

    const first = await application.prepareOpenCreativeProject("D:/Novel/M20");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    application.commitWorkspaceActivation(first.value.activationId);
    expect((await application.finalizeWorkspaceActivation(first.value.activationId)).ok).toBe(true);
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m20",
      reason: "agent-change-set-apply",
      relativePaths: ["characters/chr_hero.json"]
    });

    const second = await application.prepareOpenCreativeProject("D:/Novel/M21");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    application.commitWorkspaceActivation(second.value.activationId);
    expect((await application.finalizeWorkspaceActivation(second.value.activationId)).ok).toBe(
      true
    );
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m20",
      reason: "agent-run-undo",
      relativePaths: ["characters/chr_hero.json"]
    });
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m21",
      reason: "agent-change-set-apply",
      relativePaths: ["world/loc_gate.json"]
    });

    expect((await application.closeWorkspace()).ok).toBe(true);
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m21",
      reason: "agent-run-undo",
      relativePaths: ["world/loc_gate.json"]
    });

    expect(invalidations).toEqual([
      "D:/Novel/M20:agent-change-set-apply",
      "D:/Novel/M21:agent-change-set-apply"
    ]);
    await expect(application.searchProject({ query: "oath" })).resolves.toMatchObject({
      ok: false,
      error: { code: "PROJECT_SEARCH_UNAVAILABLE" }
    });
  });

  test("invalidates after successful Story Bible saves without turning cleanup failure into write failure", async () => {
    const invalidationReasons: string[] = [];
    let failAssetSave = false;
    let failInvalidation = false;
    const storyBibleSession = {
      getSnapshot: () => undefined,
      clearSnapshot: () => undefined,
      async loadStoryBible() {
        throw new Error("not used");
      },
      async saveStoryAsset(asset: StoryBibleAsset) {
        return failAssetSave ? err(testError("STORY_BIBLE_SAVE_FAILED")) : ok(asset);
      },
      async readStoryAssetForEditing() {
        throw new Error("not used");
      },
      async createStoryAsset() {
        return ok(characterAsset());
      },
      async saveStoryAssetCandidate() {
        return ok(characterAsset());
      },
      async saveMemory(memory: MemoryRecord) {
        return ok(memory);
      },
      async buildConsistencyReport() {
        throw new Error("not used");
      },
      async buildContextCandidates() {
        throw new Error("not used");
      }
    } satisfies StoryBibleSession;
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSessionStub("D:/Novel/M20"),
      storyBibleSession,
      createProjectSearchSession: () => ({
        getState: () => "clean" as const,
        async invalidate(reason) {
          invalidationReasons.push(reason);
          return failInvalidation
            ? err(testError("SEARCH_INDEX_INVALIDATE_FAILED"))
            : ok(undefined);
        },
        async rebuildIndex() {
          return ok(emptyIndex);
        },
        async search(input) {
          return ok(emptySearchResults(input.query));
        }
      })
    });

    const savedAsset = await application.saveStoryBibleAsset(characterAsset());
    const createdAsset = await application.createStoryBibleAsset({
      type: "character",
      value: { title: "Created hero" }
    });
    const savedCandidate = await application.saveStoryBibleAssetCandidate({
      candidate: {
        schemaVersion: "1.1",
        id: "chr_hero",
        type: "character",
        title: "Updated hero",
        status: "active",
        summary: "Updated summary.",
        aliases: [],
        relations: [],
        details: {},
        extensions: {},
        createdAt: "2026-07-05T00:00:00.000Z"
      },
      baseRevision: 0,
      baseChecksum: "a".repeat(64)
    });
    failInvalidation = true;
    const savedMemory = await application.saveStoryBibleMemory(memoryRecord());
    failAssetSave = true;
    const failedAsset = await application.saveStoryBibleAsset(characterAsset());

    expect(savedAsset.ok).toBe(true);
    expect(createdAsset.ok).toBe(true);
    expect(savedCandidate.ok).toBe(true);
    expect(savedMemory.ok).toBe(true);
    expect(failedAsset.ok).toBe(false);
    expect(invalidationReasons).toEqual([
      "story-bible-save",
      "story-bible-save",
      "story-bible-save",
      "story-bible-save"
    ]);
  });

  test("invalidates Agent changes only for the active project's managed Story Bible paths", async () => {
    const invalidationReasons: string[] = [];
    const application = createDesktopApplication({
      projectWorkspaceSession: createProjectWorkspaceSessionStub("D:/Novel/M20"),
      createProjectSearchSession: () => ({
        getState: () => "clean" as const,
        async invalidate(reason) {
          invalidationReasons.push(reason);
          return ok(undefined);
        },
        async rebuildIndex() {
          return ok(emptyIndex);
        },
        async search(input) {
          return ok(emptySearchResults(input.query));
        }
      })
    });

    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m20",
      reason: "agent-change-set-apply",
      relativePaths: ["chapters/ch_01.md"]
    });
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_other",
      reason: "agent-change-set-apply",
      relativePaths: ["characters/chr_other.json"]
    });
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m20",
      reason: "agent-change-set-apply",
      relativePaths: ["characters/chr_hero.json"]
    });
    await application.notifyProjectSearchSourcesChanged({
      projectId: "prj_m20",
      reason: "agent-run-undo",
      relativePaths: ["foreshadows/fsh_018f12a7b91c4a2f9437c3d764e9a120.json"]
    });

    expect(invalidationReasons).toEqual(["agent-change-set-apply", "agent-run-undo"]);
  });

  test.each(["applied", "partial_failure"] as const)(
    "keeps a durable %s Story Analysis result bound to the project where apply started",
    async (status) => {
      const firstRoot = "D:/Novel/M20";
      const secondRoot = "D:/Novel/M21";
      const invalidations = new Map<string, string[]>();
      const clearSnapshot = vi.fn();
      const pendingApply =
        deferred<Awaited<ReturnType<StoryAnalysisApplicationSession["applyApplication"]>>>();
      const applyApplication = vi.fn<StoryAnalysisApplicationSession["applyApplication"]>(
        () => pendingApply.promise
      );
      const application = createDesktopApplication({
        projectWorkspaceSession: createProjectWorkspaceSessionStub(firstRoot),
        storyBibleSession: { clearSnapshot } as unknown as StoryBibleSession,
        createStoryAnalysisApplicationSession: () =>
          ({ applyApplication }) as unknown as StoryAnalysisApplicationSession,
        createProjectSearchSession: (projectRoot) => ({
          getState: () => "clean" as const,
          async invalidate(reason) {
            const reasons = invalidations.get(projectRoot) ?? [];
            reasons.push(reason);
            invalidations.set(projectRoot, reasons);
            return ok(undefined);
          },
          async rebuildIndex() {
            return ok(emptyIndex);
          },
          async search(input) {
            return ok(emptySearchResults(input.query));
          }
        })
      });

      const applying = application.applyStoryAnalysisApplication({
        workflowRunId: `wfrun_story_${"a".repeat(32)}`,
        suggestionIds: [`sug_${"b".repeat(32)}`],
        changeSetId: "changes_story_analysis",
        revision: 1,
        checksum: "c".repeat(64)
      });
      expect(applyApplication).toHaveBeenCalledOnce();

      await expect(application.openProject(secondRoot)).resolves.toMatchObject({ ok: true });
      clearSnapshot.mockClear();
      pendingApply.resolve(ok(storyAnalysisApplicationResult(status)));

      await expect(applying).resolves.toMatchObject({
        ok: true,
        value: { batch: { groups: [{ status }] } }
      });
      expect(invalidations.get(firstRoot)).toEqual(["story-bible-save"]);
      expect(invalidations.get(secondRoot)).toBeUndefined();
      expect(clearSnapshot).not.toHaveBeenCalled();
    }
  );
});

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
  const suffix = projectRoot.split("/").at(-1)?.toLocaleLowerCase() ?? "project";
  return {
    projectRoot,
    project: {
      schemaVersion: "1.0",
      projectId: `prj_${suffix}`,
      title: suffix.toLocaleUpperCase(),
      projectType: "novel",
      language: "zh-CN",
      createdAt: now,
      updatedAt: now
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
      checkedAt: now,
      summary: { errorCount: 0, warningCount: 0, infoCount: 0 },
      issues: []
    }
  };
}

function emptySearchResults(query: string) {
  return {
    query,
    generatedAt: now,
    entryCount: 0,
    results: []
  };
}

function characterAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "chr_hero",
    type: "character",
    title: "Hero",
    status: "active",
    summary: "The protagonist.",
    createdAt: now,
    updatedAt: now
  };
}

function memoryRecord(): MemoryRecord {
  return {
    schemaVersion: "1.0",
    id: "mem_oath",
    type: "memory.long-term",
    title: "Oath",
    status: "active",
    origin: "user-confirmed-ai",
    confidence: "confirmed",
    content: "The oath remains active.",
    createdAt: now,
    updatedAt: now
  };
}

function testError(code: string) {
  return createUnifiedError({
    code,
    category: "StorageError",
    message: "Test operation failed.",
    recoverability: "retryable",
    suggestedAction: "Retry.",
    traceId: "desktop-project-search-test"
  });
}

function storyAnalysisApplicationResult(
  status: "applied" | "partial_failure"
): StoryAnalysisApplicationResult {
  return {
    schemaVersion: "1.0",
    analysis: {
      workflowRun: { workflowRunId: `wfrun_story_${"a".repeat(32)}` }
    } as StoryAnalysisApplicationResult["analysis"],
    batch: {
      schemaVersion: "1.0",
      applyBatchId: "apply_story_analysis",
      changeSetId: "changes_story_analysis",
      selectionChecksum: "d".repeat(64),
      groups: [{ consistencyGroupId: "cgrp_story_analysis", status }]
    }
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
