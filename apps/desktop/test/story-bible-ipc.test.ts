import { describe, expect, test, vi } from "vitest";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ApplicationCommand,
  DesktopApplication,
  DesktopShellState,
  ForeshadowAnalysisResult,
  ForeshadowAsset,
  MemoryRecord,
  StoryBibleAsset,
  StoryBibleConsistencyReport,
  StoryBibleContextCandidate,
  StoryBibleSnapshot
} from "@novel-studio/application";

import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";
import { createNovelStudioApi } from "../src/preload/api.js";

const now = "2026-07-05T00:00:00.000Z";

const shellState: DesktopShellState = {
  projectTitle: "M16",
  activeActivity: "workspace",
  navigatorCollapsed: false,
  inspectorCollapsed: false,
  bottomPanelVisible: true,
  commandPaletteOpen: false,
  saveStatus: "Saved",
  navigatorSections: [],
  bottomPanelTabs: []
};

const snapshot: StoryBibleSnapshot = {
  characters: [characterAsset()],
  worldAssets: [worldAsset()],
  foreshadows: [foreshadowAsset()],
  memories: [memoryRecord()]
};

describe("M16 Story Bible IPC", () => {
  test("exposes Story Bible commands through preload without renderer filesystem access", async () => {
    const calls: string[] = [];
    const api = createNovelStudioApi({
      async invoke(channel, ...args) {
        calls.push(`${channel}:${args.length}`);
        if (channel === "application:story-bible:build-context-candidates") {
          return ok(contextCandidates());
        }
        if (channel === "application:story-bible:build-consistency-report") {
          return ok(consistencyReport());
        }
        if (channel === "application:story-bible:detect-foreshadows") {
          return ok(analysisResult());
        }
        if (channel === "application:story-bible:save-asset") {
          return ok(characterAsset());
        }
        if (channel === "application:story-bible:save-memory") {
          return ok(memoryRecord());
        }
        return ok(snapshot);
      }
    });

    await api.storyBible.load();
    await api.storyBible.saveAsset(characterAsset());
    await api.storyBible.saveMemory(memoryRecord());
    await api.storyBible.buildConsistencyReport();
    await api.storyBible.buildContextCandidates({ includeStatuses: ["active"] });
    await api.storyBible.detectForeshadows({ chapterIds: ["ch_opening"] });

    expect(calls).toEqual([
      "application:story-bible:load:0",
      "application:story-bible:save-asset:1",
      "application:story-bible:save-memory:1",
      "application:story-bible:build-consistency-report:0",
      "application:story-bible:build-context-candidates:1",
      "application:story-bible:detect-foreshadows:1"
    ]);
  });

  test("routes Story Bible IPC channels to the Application layer", async () => {
    const handlers = createApplicationIpcHandlers(createFakeApplication());

    await expect(handlers["application:story-bible:load"]()).resolves.toEqual(ok(snapshot));
    await expect(handlers["application:story-bible:save-asset"](characterAsset())).resolves.toEqual(
      ok(characterAsset())
    );
    await expect(handlers["application:story-bible:save-memory"](memoryRecord())).resolves.toEqual(
      ok(memoryRecord())
    );
    await expect(handlers["application:story-bible:build-consistency-report"]()).resolves.toEqual(
      ok(consistencyReport())
    );
    await expect(
      handlers["application:story-bible:build-context-candidates"]({ includeStatuses: ["active"] })
    ).resolves.toEqual(ok(contextCandidates()));
    await expect(
      handlers["application:story-bible:detect-foreshadows"]({ chapterIds: ["ch_opening"] })
    ).resolves.toEqual(ok(analysisResult()));
  });

  test("validates foreshadow scan input before routing to the Application layer", async () => {
    const detectForeshadows = vi.fn<DesktopApplication["detectForeshadows"]>(async () =>
      ok(analysisResult())
    );
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows
    });

    await handlers["application:story-bible:detect-foreshadows"]({
      chapterIds: ["ch_opening", "ch_payoff-02"]
    });

    expect(detectForeshadows).toHaveBeenCalledTimes(1);
    expect(detectForeshadows).toHaveBeenCalledWith({
      chapterIds: ["ch_opening", "ch_payoff-02"]
    });
  });

  test("rejects malformed foreshadow scan input without calling the Application layer", async () => {
    const detectForeshadows = vi.fn<DesktopApplication["detectForeshadows"]>(async () =>
      ok(analysisResult())
    );
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows
    });
    const invalidInputs: readonly unknown[] = [
      undefined,
      null,
      {},
      { chapterIds: [] },
      { chapterIds: ["ch_01", "ch_02", "ch_03", "ch_04", "ch_05", "ch_06"] },
      { chapterIds: ["ch_duplicate", "ch_duplicate"] },
      { chapterIds: ["chapter_01"] },
      { chapterIds: ["ch_valid"], unexpected: true },
      Object.create({ chapterIds: ["ch_inherited"] }) as unknown,
      { chapterIds: Array(1) }
    ];

    for (const input of invalidInputs) {
      await expect(
        handlers["application:story-bible:detect-foreshadows"](input)
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "FORESHADOW_SCAN_INPUT_INVALID" }
      });
    }

    expect(detectForeshadows).not.toHaveBeenCalled();
  });

  test("projects foreshadow scan results onto the renderer-safe DTO allowlist", async () => {
    const base = analysisResult();
    const unsafeResult = {
      ...base,
      apiKeyRef: "secret://model_default/api_key",
      path: "D:/private/project/chapters/ch_opening.md",
      modelProfile: { id: "model_default", modelName: "private-model" },
      rawResponse: "provider-private-response",
      usage: {
        ...base.usage,
        cachedTokens: 7,
        reasoningTokens: 11,
        cachePhysicalPrefixChecksum: "private-cache-checksum"
      },
      candidates: base.candidates.map((candidate) => ({
        ...candidate,
        path: "foreshadows/private.json",
        modelProfile: { id: "private-profile" },
        evidence: {
          ...candidate.evidence,
          path: "chapters/private.md"
        },
        suggested: {
          ...candidate.suggested,
          apiKeyRef: "secret://candidate/key",
          rawResponse: "candidate-private-response"
        }
      }))
    } as unknown as ForeshadowAnalysisResult;
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows: async () => ok(unsafeResult)
    });

    await expect(
      handlers["application:story-bible:detect-foreshadows"]({ chapterIds: ["ch_opening"] })
    ).resolves.toEqual(ok(base));
  });

  test("rejects an invalid successful foreshadow scan result at the IPC boundary", async () => {
    const invalidResult = {
      ...analysisResult(),
      candidates: [
        {
          candidateId: "fsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_001",
          kind: "unknown",
          reason: "Invalid discriminator."
        }
      ]
    } as unknown as ForeshadowAnalysisResult;
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows: async () => ok(invalidResult)
    });

    await expect(
      handlers["application:story-bible:detect-foreshadows"]({ chapterIds: ["ch_opening"] })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_IPC_RESULT_INVALID" }
    });
  });

  test("rejects sparse arrays in a successful foreshadow scan result", async () => {
    const base = analysisResult();
    const invalidResult = {
      ...base,
      candidates: [
        {
          ...base.candidates[0],
          duplicateForeshadowIds: Array(1)
        }
      ]
    } as unknown as ForeshadowAnalysisResult;
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows: async () => ok(invalidResult)
    });

    await expect(
      handlers["application:story-bible:detect-foreshadows"]({ chapterIds: ["ch_opening"] })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_IPC_RESULT_INVALID" }
    });
  });

  test("removes internal error details before returning a foreshadow scan failure", async () => {
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows: async () =>
        err(
          createUnifiedError({
            code: "CHAPTER_FILE_MISSING",
            category: "StorageError",
            message: "D:/private/project/chapters/ch_opening.md contains sk-private-key.",
            recoverability: "user-action",
            suggestedAction: "Read D:/private/project/settings.json.",
            traceId: "trace_private_project",
            redactedDetail: {
              filePath: "D:/private/project/chapters/ch_opening.md",
              apiKeyRef: "secret://model_default/api_key"
            }
          })
        )
    });

    const result = await handlers["application:story-bible:detect-foreshadows"]({
      chapterIds: ["ch_opening"]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "CHAPTER_FILE_MISSING" }
    });
    expect(JSON.stringify(result)).not.toContain("D:/private/project");
    expect(JSON.stringify(result)).not.toContain("sk-private-key");
    expect(JSON.stringify(result)).not.toContain("secret://model_default/api_key");
  });

  test("converts a thrown foreshadow scan failure into a fixed renderer-safe error", async () => {
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      detectForeshadows: async () => {
        throw new Error("D:/private/project leaked sk-private-key");
      }
    });

    const result = await handlers["application:story-bible:detect-foreshadows"]({
      chapterIds: ["ch_opening"]
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_FAILED" }
    });
    expect(JSON.stringify(result)).not.toContain("D:/private/project");
    expect(JSON.stringify(result)).not.toContain("sk-private-key");
  });

  test("preserves unknown foreshadow fields and emits canonical field order through IPC", async () => {
    const asset: ForeshadowAsset = {
      futureRootField: { enabled: true },
      ...foreshadowAsset(),
      details: {
        ...foreshadowAsset().details,
        futureDetailField: ["kept"]
      }
    };
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await expect(handlers["application:story-bible:save-asset"](asset)).resolves.toEqual(ok(asset));
    expect(saveStoryBibleAsset).toHaveBeenCalledWith(asset);
    expect(Object.keys(saveStoryBibleAsset.mock.calls[0]?.[0] ?? {})).toEqual([
      "schemaVersion",
      "id",
      "type",
      "title",
      "status",
      "summary",
      "details",
      "createdAt",
      "updatedAt",
      "futureRootField"
    ]);
  });

  test("rejects unsupported Story Bible schema versions at the IPC boundary", async () => {
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await handlers["application:story-bible:save-asset"]({
      ...characterAsset(),
      schemaVersion: "2.0"
    });

    expect(saveStoryBibleAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "", type: "character" })
    );
    expect(saveStoryBibleAsset).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "chr_hero" })
    );
  });

  test("does not pass structurally invalid foreshadow details through IPC", async () => {
    const saveStoryBibleAsset = vi.fn(async (input: StoryBibleAsset) => ok(input));
    const handlers = createApplicationIpcHandlers({
      ...createFakeApplication(),
      saveStoryBibleAsset
    });

    await handlers["application:story-bible:save-asset"]({
      ...foreshadowAsset(),
      details: {}
    });

    expect(saveStoryBibleAsset).toHaveBeenCalledWith(
      expect.objectContaining({ id: "", type: "character" })
    );
    expect(saveStoryBibleAsset).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "foreshadow" })
    );
  });
});

function createFakeApplication(): DesktopApplication {
  return {
    getShellState: () => shellState,
    listCommands: (): readonly ApplicationCommand[] => [],
    executeCommand: () => ok(shellState),
    openProject: unsupported,
    createProject: unsupported,
    listProjectChapters: unsupported,
    createProjectChapter: unsupported,
    selectProjectChapter: unsupported,
    loadStoryBible: async () => ok(snapshot),
    saveStoryBibleAsset: async () => ok(characterAsset()),
    saveStoryBibleMemory: async () => ok(memoryRecord()),
    buildStoryBibleConsistencyReport: async () => ok(consistencyReport()),
    buildStoryBibleContextCandidates: async () => ok(contextCandidates()),
    detectForeshadows: async () => ok(analysisResult()),
    generateActiveChapterSuggestion: unsupported,
    applyActiveChapterSuggestion: unsupported,
    loadActiveChapter: unsupported,
    editActiveChapter: unsupported,
    saveActiveChapter: unsupported,
    listActiveChapterVersions: unsupported,
    previewActiveChapterVersion: unsupported,
    restoreActiveChapterVersion: unsupported,
    previewActiveChapterSuggestionDiff: () => ok({ title: "AI suggestion", changes: [] }),
    listModelProfiles: unsupported,
    saveModelProfile: unsupported,
    testModelProfileConnection: unsupported,
    loadConfigAsset: unsupported,
    saveConfigAsset: unsupported,
    restoreConfigAssetVersion: unsupported
  };
}

function consistencyReport(): StoryBibleConsistencyReport {
  return {
    status: "healthy",
    checkedAt: now,
    issues: []
  };
}

function contextCandidates(): readonly StoryBibleContextCandidate[] {
  return [
    {
      refType: "character",
      refId: "chr_hero",
      content: "A procedural protagonist with a hidden oath.",
      priority: 100,
      sourceRefs: [{ entityType: "character", entityId: "chr_hero" }]
    }
  ];
}

function analysisResult(): ForeshadowAnalysisResult {
  return {
    analysisId: "fsa_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    chapterIds: ["ch_opening"],
    candidates: [
      {
        candidateId: "fsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_001",
        kind: "new",
        evidence: {
          chapterId: "ch_opening",
          excerpt: "The old key was warm in her hand.",
          excerptHash: "b".repeat(64)
        },
        reason: "The key is emphasized without an immediate explanation.",
        duplicateForeshadowIds: [],
        suggested: {
          title: "The warm old key",
          summary: "The old key points toward the sealed archive.",
          trackingStatus: "planted",
          plantedChapterId: "ch_opening",
          notes: "Track the key before the archive opens.",
          relatedEntityIds: ["chr_hero"]
        }
      },
      {
        candidateId: "fsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_002",
        kind: "progress",
        targetForeshadowId: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidence: {
          chapterId: "ch_opening",
          excerpt: "The archive seal answered the old key.",
          excerptHash: "c".repeat(64)
        },
        reason: "The existing clue advances toward the archive reveal.",
        duplicateForeshadowIds: [],
        suggested: {
          trackingStatus: "progressing",
          summary: "The key now reacts to the archive seal.",
          notes: "Keep the identity of the seal's maker hidden."
        }
      },
      {
        candidateId: "fsc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_003",
        kind: "payoff",
        targetForeshadowId: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidence: {
          chapterId: "ch_opening",
          excerpt: "The key opened the archive at last.",
          excerptHash: "d".repeat(64)
        },
        reason: "The chapter explicitly resolves the key clue.",
        duplicateForeshadowIds: ["fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        suggested: {
          trackingStatus: "paid-off",
          actualPayoffChapterId: "ch_opening",
          summary: "The old key opens the sealed archive."
        }
      }
    ],
    usage: {
      inputTokens: 320,
      outputTokens: 96,
      totalTokens: 416,
      usageStatus: "actual",
      cost: {
        amount: 0.0012,
        currency: "USD",
        status: "actual"
      }
    },
    createdAt: now
  };
}

function characterAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "chr_hero",
    type: "character",
    title: "Hero",
    status: "active",
    summary: "A procedural protagonist with a hidden oath.",
    createdAt: now,
    updatedAt: now
  };
}

function worldAsset(): StoryBibleAsset {
  return {
    schemaVersion: "1.0",
    id: "loc_capital",
    type: "world.location",
    title: "Capital",
    status: "active",
    summary: "The capital bans open flame after midnight.",
    createdAt: now,
    updatedAt: now
  };
}

function foreshadowAsset(): ForeshadowAsset {
  return {
    schemaVersion: "1.0",
    id: "fsh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    type: "foreshadow",
    title: "Old key",
    status: "active",
    summary: "The key will reveal who sealed the archive.",
    details: {
      trackingStatus: "planned",
      plannedPayoffChapterId: "ch_05",
      origin: "manual"
    },
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
    content: "The hero never reveals the old oath aloud.",
    createdAt: now,
    updatedAt: now
  };
}

async function unsupported<T>(): Promise<Result<T, UnifiedError>> {
  throw new Error("Not used by this test.");
}
