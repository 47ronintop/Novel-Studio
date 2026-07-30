import { describe, expect, test } from "vitest";

import {
  createLlmAdapter,
  createMockProvider,
  type LlmProvider,
  type LlmRequest,
  type LlmUsage
} from "@novel-studio/llm-adapter";
import {
  createForeshadowEvidence,
  err,
  ok,
  type ChapterDocument,
  type ForeshadowDetails,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createForeshadowAnalysisSession,
  resolveDefaultForeshadowAnalysisRuntimeProfile,
  type ForeshadowAnalysisRuntimeProfile,
  type ProjectSettings,
  type StoryBibleSnapshot
} from "../src/index.js";

const NOW = "2026-07-30T00:00:00.000Z";
const ANALYSIS_IDENTITY = "0123456789abcdef0123456789abcdef";

const usage: LlmUsage = {
  inputTokens: 420,
  outputTokens: 180,
  totalTokens: 600,
  usageStatus: "actual",
  cost: {
    amount: 0.01,
    currency: "USD",
    status: "actual"
  }
};

describe("ForeshadowAnalysisSession", () => {
  test("returns validated new, progress, and payoff candidates from saved chapters", async () => {
    const harness = createHarness({
      response: JSON.stringify({
        candidates: [
          {
            kind: "new",
            evidence: {
              chapterId: "ch_01",
              excerpt: "  他把生锈的钥匙收进袖口。\r\n钥匙微微发热。  "
            },
            reason: "反常的钥匙状态适合作为后续谜底。",
            suggested: {
              title: "生锈钥匙的来源",
              summary: "钥匙的异常将在后文解释。",
              trackingStatus: "planted",
              plantedChapterId: "ch_01",
              plannedPayoffChapterId: "ch_05",
              notes: "留意钥匙再次发热。",
              relatedEntityIds: ["chr_hero"]
            }
          },
          {
            kind: "progress",
            targetForeshadowId: "fsh_existing",
            evidence: {
              chapterId: "ch_02",
              excerpt: "钥匙上的王室纹章与密信完全一致。"
            },
            reason: "新证据推进了既有钥匙伏笔。",
            suggested: {
              trackingStatus: "progressing",
              summary: "王室纹章把钥匙与密信联系起来。",
              notes: "下一次出现时可进入待回收状态。"
            }
          },
          {
            kind: "payoff",
            targetForeshadowId: "fsh_existing",
            evidence: {
              chapterId: "ch_02",
              excerpt: "门锁弹开，失踪多年的档案就在暗格里。"
            },
            reason: "钥匙已经打开目标暗格，完成回收。",
            suggested: {
              trackingStatus: "paid-off",
              actualPayoffChapterId: "ch_02",
              summary: "钥匙打开暗格并揭示档案。"
            }
          }
        ]
      }),
      chapters: [
        chapter("ch_01", 1, "第一章", "钥匙第一次出现。\n他把生锈的钥匙收进袖口。\n钥匙微微发热。"),
        chapter(
          "ch_02",
          2,
          "第二章",
          "钥匙打开暗格。\n钥匙上的王室纹章与密信完全一致。\n门锁弹开，失踪多年的档案就在暗格里。"
        )
      ],
      snapshot: snapshotWithForeshadows()
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01", "ch_02"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      analysisId: `fsa_${ANALYSIS_IDENTITY}`,
      chapterIds: ["ch_01", "ch_02"],
      usage,
      createdAt: NOW,
      candidates: [
        {
          candidateId: `fsc_${ANALYSIS_IDENTITY}_001`,
          kind: "new",
          evidence: {
            chapterId: "ch_01",
            excerpt: "他把生锈的钥匙收进袖口。\n钥匙微微发热。"
          },
          suggested: { trackingStatus: "planted", plantedChapterId: "ch_01" }
        },
        {
          candidateId: `fsc_${ANALYSIS_IDENTITY}_002`,
          kind: "progress",
          targetForeshadowId: "fsh_existing",
          suggested: { trackingStatus: "progressing" }
        },
        {
          candidateId: `fsc_${ANALYSIS_IDENTITY}_003`,
          kind: "payoff",
          targetForeshadowId: "fsh_existing",
          suggested: { trackingStatus: "paid-off", actualPayoffChapterId: "ch_02" }
        }
      ]
    });
    expect(result.value.candidates[0]?.evidence).toEqual(
      await createForeshadowEvidence("ch_01", "他把生锈的钥匙收进袖口。\n钥匙微微发热。")
    );
    expect(harness.chapterReads).toEqual(["ch_01", "ch_02"]);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toMatchObject({
      mode: "non-streaming",
      responseFormat: { type: "json_object" }
    });
    const serializedMessages = JSON.stringify(harness.requests[0]?.messages);
    expect(serializedMessages).toContain("钥匙第一次出现");
    expect(serializedMessages).toContain("钥匙打开暗格");
    expect(serializedMessages).toContain("fsh_existing");
    expect(serializedMessages).toContain("existing-source-hash");
    expect(serializedMessages).not.toContain("fsh_deleted");
  });

  test.each([
    ["empty", []],
    ["duplicate", ["ch_01", "ch_01"]],
    ["more than five", ["ch_01", "ch_02", "ch_03", "ch_04", "ch_05", "ch_06"]],
    ["unsafe id", ["ch_../settings"]]
  ])("rejects %s chapter selections before reading repositories", async (_label, chapterIds) => {
    const harness = createHarness({ response: JSON.stringify({ candidates: [] }) });

    const result = await harness.session.analyze({ chapterIds });

    expect(result).toMatchObject({ ok: false, error: { code: "FORESHADOW_SCAN_INPUT_INVALID" } });
    expect(harness.chapterReads).toEqual([]);
    expect(harness.storyBibleReads).toBe(0);
    expect(harness.requests).toEqual([]);
  });

  test("accepts exactly five saved chapters", async () => {
    const chapters = Array.from({ length: 5 }, (_, index) =>
      chapter(`ch_0${index + 1}`, index + 1, `第${index + 1}章`, `正文 ${index + 1}。`)
    );
    const chapterIds = chapters.map((entry) => entry.frontmatter.id);
    const harness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      chapters
    });

    const result = await harness.session.analyze({ chapterIds });

    expect(result).toMatchObject({ ok: true, value: { chapterIds } });
    expect(harness.chapterReads).toEqual(chapterIds);
    expect(harness.requests).toHaveLength(1);
  });

  test("propagates a missing saved chapter without reading the Story Bible", async () => {
    const harness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      chapters: []
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_missing"] });

    expect(result).toMatchObject({ ok: false, error: { code: "CHAPTER_NOT_FOUND" } });
    expect(harness.storyBibleReads).toBe(0);
    expect(harness.requests).toEqual([]);
  });

  test("fails before calling the provider when the complete request exceeds the model budget", async () => {
    const harness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      chapters: [chapter("ch_01", 1, "超长章节", "字".repeat(5_000))],
      runtimeProfile: runtimeProfile({ contextWindow: 1_000, maxTokens: 100 })
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_CONTEXT_TOO_LARGE" }
    });
    expect(harness.requests).toEqual([]);
  });

  test("reserves model output tokens at the exact context boundary", async () => {
    const exactHarness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      runtimeProfile: runtimeProfile({ contextWindow: 1_000, maxTokens: 100 }),
      estimatedPromptTokens: 900
    });
    const overHarness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      runtimeProfile: runtimeProfile({ contextWindow: 1_000, maxTokens: 100 }),
      estimatedPromptTokens: 901
    });

    await expect(exactHarness.session.analyze({ chapterIds: ["ch_01"] })).resolves.toMatchObject({
      ok: true
    });
    await expect(overHarness.session.analyze({ chapterIds: ["ch_01"] })).resolves.toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_CONTEXT_TOO_LARGE" }
    });
    expect(exactHarness.requests).toHaveLength(1);
    expect(overHarness.requests).toEqual([]);
  });

  test("rejects a model profile without a verified context window before calling the provider", async () => {
    const runtimeResult = resolveDefaultForeshadowAnalysisRuntimeProfile(
      projectSettings(undefined)
    );
    expect(runtimeResult).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_MODEL_CONTEXT_INVALID" }
    });
    const harness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      runtimeResult
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_MODEL_CONTEXT_INVALID" }
    });
    expect(harness.chapterReads).toEqual([]);
    expect(harness.storyBibleReads).toBe(0);
    expect(harness.requests).toEqual([]);
  });

  test("resolves a verified default profile for foreshadow analysis", () => {
    const result = resolveDefaultForeshadowAnalysisRuntimeProfile(projectSettings(32_000));

    expect(result).toMatchObject({
      ok: true,
      value: {
        contextWindow: 32_000,
        modelProfile: {
          id: "model_foreshadow_test",
          provider: "openai-compatible"
        },
        parameters: { maxTokens: 2_048 }
      }
    });
  });

  test("accepts structured JSON content after applying the same schema validation", async () => {
    const harness = createHarness({ response: { candidates: [] } });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({ ok: true, value: { candidates: [] } });
    expect(harness.requests).toHaveLength(1);
  });

  test("rejects invalid structured JSON content", async () => {
    const harness = createHarness({ response: { candidates: [{ kind: "unknown" }] } });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_OUTPUT_INVALID" }
    });
  });

  test("derives duplicate evidence hints from non-deleted foreshadows", async () => {
    const sourceRef = await createForeshadowEvidence("ch_01", "正文。");
    const harness = createHarness({
      response: JSON.stringify({
        candidates: [
          {
            kind: "new",
            evidence: { chapterId: "ch_01", excerpt: "正文。" },
            reason: "这条候选与既有来源重复。",
            suggested: {
              title: "重复候选",
              summary: "重复候选。",
              trackingStatus: "planted",
              plantedChapterId: "ch_01"
            }
          }
        ]
      }),
      snapshot: {
        ...emptySnapshot(),
        foreshadows: [
          foreshadow("fsh_duplicate", "active", {
            trackingStatus: "planted",
            sourceRefs: [sourceRef]
          }),
          foreshadow("fsh_deleted", "deleted", {
            trackingStatus: "abandoned",
            sourceRefs: [sourceRef]
          })
        ]
      }
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: true,
      value: {
        candidates: [{ duplicateForeshadowIds: ["fsh_duplicate"] }]
      }
    });
  });

  test.each([
    ["invalid JSON", "not-json"],
    [
      "invalid candidate schema",
      JSON.stringify({
        candidates: [
          {
            kind: "progress",
            targetForeshadowId: "fsh_missing",
            evidence: { chapterId: "ch_01", excerpt: "证据" },
            reason: "目标不存在。",
            suggested: { trackingStatus: "progressing" }
          }
        ]
      })
    ]
  ])("rejects %s without returning partial candidates", async (_label, response) => {
    const harness = createHarness({ response });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_OUTPUT_INVALID" }
    });
    expect(harness.requests).toHaveLength(1);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain(response);
    }
  });

  test("rejects the whole response when a valid candidate is followed by an invalid one", async () => {
    const response = JSON.stringify({
      candidates: [
        {
          kind: "new",
          evidence: { chapterId: "ch_01", excerpt: "正文。" },
          reason: "有效候选。",
          suggested: {
            title: "有效候选",
            summary: "有效候选。",
            trackingStatus: "planted",
            plantedChapterId: "ch_01"
          }
        },
        {
          kind: "progress",
          targetForeshadowId: "fsh_missing",
          evidence: { chapterId: "ch_01", excerpt: "正文。" },
          reason: "无效候选。",
          suggested: { trackingStatus: "progressing" }
        }
      ]
    });
    const harness = createHarness({ response });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_OUTPUT_INVALID" }
    });
  });

  test("rejects progress and payoff candidates that target a deleted foreshadow", async () => {
    const harness = createHarness({
      response: JSON.stringify({
        candidates: [
          {
            kind: "progress",
            targetForeshadowId: "fsh_deleted",
            evidence: { chapterId: "ch_01", excerpt: "正文。" },
            reason: "删除项不能作为目标。",
            suggested: { trackingStatus: "progressing" }
          }
        ]
      }),
      snapshot: snapshotWithForeshadows()
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_OUTPUT_INVALID" }
    });
  });

  test("rejects evidence that is not present in the selected saved chapter", async () => {
    const response = JSON.stringify({
      candidates: [
        {
          kind: "new",
          evidence: { chapterId: "ch_01", excerpt: "正文中不存在的句子。" },
          reason: "不能作为可信原文证据。",
          suggested: {
            title: "无来源证据",
            summary: "无来源证据。",
            trackingStatus: "planted",
            plantedChapterId: "ch_01"
          }
        }
      ]
    });
    const harness = createHarness({ response });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORESHADOW_SCAN_OUTPUT_INVALID" }
    });
  });

  test("bounds existing foreshadow context without truncating selected chapter bodies", async () => {
    const sourceRefs = Array.from({ length: 25 }, (_, index) => ({
      chapterId: `ch_source_${String(index).padStart(2, "0")}`,
      excerpt: `来源 ${index}`,
      excerptHash: `hash_${String(index).padStart(2, "0")}`
    }));
    const foreshadows = Array.from({ length: 101 }, (_, index) => {
      const asset = foreshadow(`fsh_${String(index).padStart(3, "0")}`, "active", {
        trackingStatus: "planted",
        ...(index === 0 ? { sourceRefs } : {})
      });
      return index === 0
        ? { ...asset, title: "题".repeat(200), summary: "摘".repeat(1_200) }
        : asset;
    });
    const body = `${"正文".repeat(200)}\nBODY_TAIL_MARKER`;
    const harness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      chapters: [chapter("ch_01", 1, "第一章", body)],
      snapshot: { ...emptySnapshot(), foreshadows },
      runtimeProfile: runtimeProfile({ contextWindow: 1_000_000 })
    });

    const result = await harness.session.analyze({ chapterIds: ["ch_01"] });

    expect(result.ok).toBe(true);
    const userMessage = harness.requests[0]?.messages.find((message) => message.role === "user");
    expect(userMessage).toBeDefined();
    const prompt = JSON.parse(userMessage?.content ?? "") as {
      chapters: { body: string }[];
      existingForeshadows: {
        id: string;
        title: string;
        summary: string;
        sourceRefs: unknown[];
      }[];
    };
    expect(prompt.chapters[0]?.body).toBe(body);
    expect(prompt.existingForeshadows).toHaveLength(100);
    expect(prompt.existingForeshadows[0]?.id).toBe("fsh_000");
    expect(prompt.existingForeshadows[99]?.id).toBe("fsh_099");
    expect(prompt.existingForeshadows.map((asset) => asset.id)).not.toContain("fsh_100");
    expect(Array.from(prompt.existingForeshadows[0]?.title ?? "")).toHaveLength(160);
    expect(Array.from(prompt.existingForeshadows[0]?.summary ?? "")).toHaveLength(1_000);
    expect(prompt.existingForeshadows[0]?.sourceRefs).toHaveLength(20);
  });

  test("propagates Story Bible and LLM errors without replacing their diagnostics", async () => {
    const storyBibleError = upstreamError("STORY_BIBLE_READ_FAILED", "StorageError");
    const storyHarness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      storyBibleResult: err(storyBibleError)
    });

    await expect(storyHarness.session.analyze({ chapterIds: ["ch_01"] })).resolves.toEqual(
      err(storyBibleError)
    );
    expect(storyHarness.requests).toEqual([]);

    const llmError = upstreamError("LLM_RATE_LIMITED", "LLMAdapterError");
    const llmHarness = createHarness({
      response: JSON.stringify({ candidates: [] }),
      llmError
    });

    await expect(llmHarness.session.analyze({ chapterIds: ["ch_01"] })).resolves.toEqual(
      err(llmError)
    );
    expect(llmHarness.requests).toHaveLength(1);
  });
});

function createHarness(options: {
  readonly response: string | JsonObject;
  readonly chapters?: readonly ChapterDocument[];
  readonly snapshot?: StoryBibleSnapshot;
  readonly runtimeProfile?: ForeshadowAnalysisRuntimeProfile;
  readonly runtimeResult?: Result<ForeshadowAnalysisRuntimeProfile, UnifiedError>;
  readonly storyBibleResult?: Result<StoryBibleSnapshot, UnifiedError>;
  readonly llmError?: UnifiedError;
  readonly estimatedPromptTokens?: number;
}) {
  const requests: LlmRequest[] = [];
  const chapterReads: string[] = [];
  let storyBibleReads = 0;
  const llmError = options.llmError;
  const estimatedPromptTokens = options.estimatedPromptTokens;
  const chapters = options.chapters ?? [chapter("ch_01", 1, "第一章", "正文。")];
  const provider = capturingMockProvider(requests, options.response);
  const session = createForeshadowAnalysisSession({
    chapterRepository: {
      async readChapter(chapterId) {
        chapterReads.push(chapterId);
        const found = chapters.find((candidate) => candidate.frontmatter.id === chapterId);
        return found === undefined ? missingChapter(chapterId) : ok(found);
      }
    },
    storyBibleRepository: {
      async readStoryBible() {
        storyBibleReads += 1;
        return options.storyBibleResult ?? ok(options.snapshot ?? emptySnapshot());
      }
    },
    resolveModelRuntimeProfile: async () =>
      options.runtimeResult ??
      ok(options.runtimeProfile ?? runtimeProfile({ contextWindow: 32_000 })),
    llmAdapter:
      llmError === undefined
        ? createLlmAdapter({ provider, clock: () => NOW })
        : {
            async complete(request) {
              requests.push(request);
              return err(llmError);
            }
          },
    ...(estimatedPromptTokens === undefined
      ? {}
      : {
          estimator: {
            count() {
              return { tokens: estimatedPromptTokens, precision: "estimated" };
            }
          }
        }),
    now: () => NOW,
    createAnalysisIdentity: () => ANALYSIS_IDENTITY
  });

  return {
    session,
    requests,
    chapterReads,
    get storyBibleReads() {
      return storyBibleReads;
    }
  };
}

function capturingMockProvider(requests: LlmRequest[], response: string | JsonObject): LlmProvider {
  const mock = createMockProvider({
    completions: [
      {
        type: "success",
        content:
          typeof response === "string"
            ? { type: "text", value: response }
            : { type: "json", value: response },
        usage
      }
    ]
  });
  return {
    id: "mock",
    complete(request) {
      requests.push(request);
      return mock.complete(request);
    },
    stream(request) {
      return mock.stream(request);
    }
  };
}

function runtimeProfile(input: {
  readonly contextWindow: number;
  readonly maxTokens?: number;
}): ForeshadowAnalysisRuntimeProfile {
  return {
    contextWindow: input.contextWindow,
    modelProfile: {
      id: "model_foreshadow_test",
      provider: "mock",
      displayName: "Foreshadow test model",
      modelName: "mock-foreshadow"
    },
    parameters: {
      temperature: 0.2,
      maxTokens: input.maxTokens ?? 2_048
    }
  };
}

function projectSettings(contextWindow: number | undefined): ProjectSettings {
  return {
    schemaVersion: "1.0",
    autosave: { enabled: true, intervalMs: 30_000 },
    history: { snapshotPolicy: "manual-only" },
    models: {
      defaultProfileId: "model_foreshadow_test",
      profiles: [
        {
          id: "model_foreshadow_test",
          provider: "openai-compatible",
          displayName: "Foreshadow test model",
          apiKeyRef: "secret://model_foreshadow_test/api_key",
          modelName: "mock-foreshadow",
          ...(contextWindow === undefined ? {} : { contextWindow }),
          temperature: 0.2,
          maxTokens: 2_048,
          timeoutMs: 60_000
        }
      ]
    }
  };
}

function chapter(id: string, order: number, title: string, body: string): ChapterDocument {
  return {
    frontmatter: {
      schemaVersion: "1.0",
      id,
      type: "chapter",
      title,
      order,
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW
    },
    body
  };
}

function snapshotWithForeshadows(): StoryBibleSnapshot {
  return {
    ...emptySnapshot(),
    foreshadows: [
      foreshadow("fsh_existing", "active", {
        trackingStatus: "planted",
        sourceRefs: [
          {
            chapterId: "ch_01",
            excerpt: "旧证据",
            excerptHash: "existing-source-hash"
          }
        ]
      }),
      foreshadow("fsh_deleted", "deleted", { trackingStatus: "abandoned" })
    ]
  };
}

function foreshadow(
  id: string,
  status: "active" | "deleted",
  details: ForeshadowDetails
): StoryBibleSnapshot["foreshadows"][number] {
  return {
    schemaVersion: "1.0",
    id,
    type: "foreshadow",
    title: `${id} title`,
    status,
    summary: `${id} summary`,
    details,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function emptySnapshot(): StoryBibleSnapshot {
  return {
    characters: [],
    worldAssets: [],
    foreshadows: [],
    memories: []
  };
}

function missingChapter(chapterId: string): Result<never, UnifiedError> {
  return {
    ok: false,
    error: {
      schemaVersion: "1.0",
      errorId: `err_${chapterId}`,
      code: "CHAPTER_NOT_FOUND",
      category: "UserError",
      message: "Chapter not found.",
      recoverability: "user-action",
      suggestedAction: "Choose an existing chapter.",
      traceId: "foreshadow-analysis-test",
      createdAt: NOW
    }
  };
}

function upstreamError(code: string, category: UnifiedError["category"]): UnifiedError {
  return {
    schemaVersion: "1.0",
    errorId: `err_${code.toLowerCase()}`,
    code,
    category,
    message: `${code} message`,
    recoverability: "retryable",
    suggestedAction: "Retry.",
    traceId: "foreshadow-analysis-test",
    createdAt: NOW
  };
}
