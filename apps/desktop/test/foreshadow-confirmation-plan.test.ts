import { describe, expect, test } from "vitest";

import type { ForeshadowAnalysisCandidateDto, ForeshadowAsset } from "@novel-studio/application";
import { createForeshadowEvidence } from "@novel-studio/shared";
import { createForeshadowConfirmationPlan } from "../src/renderer/foreshadow-confirmation-plan.js";

const NOW = "2026-07-30T12:00:00.000Z";

describe("foreshadow confirmation plan", () => {
  test("materializes a new AI-confirmed foreshadow with one stable asset id", async () => {
    const candidate: ForeshadowAnalysisCandidateDto = {
      candidateId: "candidate-new",
      kind: "new",
      evidence: {
        chapterId: "ch_01",
        excerpt: "  生锈的钥匙\r\n再次发热。  ",
        excerptHash: "0".repeat(64)
      },
      reason: "钥匙被反复强调。",
      duplicateForeshadowIds: [],
      suggested: {
        title: "发热的钥匙",
        summary: "钥匙会打开旧档案室。",
        trackingStatus: "planted",
        plantedChapterId: "ch_01",
        plannedPayoffChapterId: "ch_03",
        notes: "留意温度变化。",
        relatedEntityIds: ["chr_hero"]
      }
    };
    const identities: string[] = [];

    const result = await createForeshadowConfirmationPlan({
      candidates: [candidate],
      selectedCandidateIds: [candidate.candidateId],
      foreshadows: [],
      chapterIdsInOrder: ["ch_01", "ch_02", "ch_03"],
      createAssetIdentity: () => {
        identities.push("created");
        return "a".repeat(32);
      },
      now: () => NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(identities).toEqual(["created"]);
    expect(result.value.operations).toHaveLength(1);
    expect(result.value.referencedChapterIds).toEqual(["ch_01", "ch_03"]);
    expect(result.value.operations[0]).toMatchObject({
      changeId: "new:candidate-new",
      sourceCandidateIds: ["candidate-new"],
      asset: {
        schemaVersion: "1.0",
        id: `fsh_${"a".repeat(32)}`,
        type: "foreshadow",
        title: "发热的钥匙",
        status: "active",
        summary: "钥匙会打开旧档案室。",
        aliases: [],
        relatedEntityIds: ["chr_hero"],
        createdAt: NOW,
        updatedAt: NOW,
        details: {
          trackingStatus: "planted",
          plantedChapterId: "ch_01",
          plannedPayoffChapterId: "ch_03",
          origin: "ai-confirmed",
          notes: "留意温度变化。"
        }
      },
      preview: {
        operation: "create",
        status: "pending",
        title: "发热的钥匙"
      }
    });
    expect(result.value.operations[0]?.asset.details.sourceRefs).toEqual([
      await createForeshadowEvidence("ch_01", "生锈的钥匙\n再次发热。")
    ]);
  });

  test("merges one target by chapter order and preserves unknown asset fields", async () => {
    const existingEvidence = await createForeshadowEvidence("ch_01", "钥匙第一次发热。 ");
    const target = {
      schemaVersion: "1.0",
      id: `fsh_${"b".repeat(32)}`,
      type: "foreshadow",
      title: "生锈的钥匙",
      status: "active",
      summary: "旧摘要",
      aliases: ["铁钥匙"],
      relatedEntityIds: ["chr_hero"],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      customRoot: { keep: true },
      details: {
        trackingStatus: "planted",
        plantedChapterId: "ch_01",
        sourceRefs: [existingEvidence],
        origin: "manual",
        customDetail: "keep"
      }
    } satisfies ForeshadowAsset;
    const candidates: ForeshadowAnalysisCandidateDto[] = [
      payoffCandidate("candidate-payoff-late", target.id, "ch_03", "第三章完成回收。", {
        summary: "最终摘要"
      }),
      progressCandidate("candidate-progress", target.id, "ch_01", "钥匙第一次发热。", {
        trackingStatus: "ready-to-payoff",
        summary: "推进摘要"
      }),
      payoffCandidate("candidate-payoff-middle", target.id, "ch_02", "第二章似乎已经回收。", {
        notes: "保留这条显式备注"
      })
    ];

    const result = await createForeshadowConfirmationPlan({
      candidates,
      selectedCandidateIds: candidates.map((candidate) => candidate.candidateId),
      foreshadows: [target],
      chapterIdsInOrder: ["ch_01", "ch_02", "ch_03"],
      createAssetIdentity: () => "c".repeat(32),
      now: () => NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations).toHaveLength(1);
    const operation = result.value.operations[0];
    expect(operation?.sourceCandidateIds).toEqual([
      "candidate-progress",
      "candidate-payoff-middle",
      "candidate-payoff-late"
    ]);
    expect(operation?.asset).toMatchObject({
      id: target.id,
      title: target.title,
      aliases: ["铁钥匙"],
      relatedEntityIds: ["chr_hero"],
      createdAt: target.createdAt,
      updatedAt: NOW,
      customRoot: { keep: true },
      summary: "最终摘要",
      details: {
        trackingStatus: "paid-off",
        actualPayoffChapterId: "ch_03",
        origin: "manual",
        notes: "保留这条显式备注",
        customDetail: "keep"
      }
    });
    expect(operation?.asset.details.sourceRefs).toEqual([
      existingEvidence,
      await createForeshadowEvidence("ch_02", "第二章似乎已经回收。"),
      await createForeshadowEvidence("ch_03", "第三章完成回收。")
    ]);
    expect(operation?.preview).toMatchObject({
      changeId: `update:${target.id}`,
      operation: "update",
      sourceCandidateIds: [
        "candidate-progress",
        "candidate-payoff-middle",
        "candidate-payoff-late"
      ],
      status: "pending"
    });
    expect(operation?.preview.fields).toEqual(
      expect.arrayContaining([
        { field: "summary", before: "旧摘要", after: "最终摘要" },
        { field: "trackingStatus", before: "planted", after: "paid-off" },
        { field: "actualPayoffChapterId", after: "ch_03" },
        { field: "notes", after: "保留这条显式备注" }
      ])
    );
    expect(operation?.preview.evidenceAdditions.map((evidence) => evidence.chapterId)).toEqual([
      "ch_02",
      "ch_03"
    ]);
  });

  test("rejects stale targets and candidates whose chapter is no longer ordered", async () => {
    const missingTarget = progressCandidate(
      "candidate-missing",
      `fsh_${"d".repeat(32)}`,
      "ch_01",
      "线索推进。",
      { trackingStatus: "progressing" }
    );
    const missingTargetResult = await createForeshadowConfirmationPlan({
      candidates: [missingTarget],
      selectedCandidateIds: [missingTarget.candidateId],
      foreshadows: [],
      chapterIdsInOrder: ["ch_01"],
      createAssetIdentity: () => "e".repeat(32),
      now: () => NOW
    });
    expect(missingTargetResult).toEqual({
      ok: false,
      message: "目标伏笔已不存在，请返回候选并重新识别。"
    });

    const missingChapter = await createForeshadowConfirmationPlan({
      candidates: [newCandidate("candidate-missing-chapter", "ch_deleted", "已删除章节中的线索。")],
      selectedCandidateIds: ["candidate-missing-chapter"],
      foreshadows: [],
      chapterIdsInOrder: ["ch_01"],
      createAssetIdentity: () => "f".repeat(32),
      now: () => NOW
    });
    expect(missingChapter).toEqual({
      ok: false,
      message: "候选引用的章节已不存在，请返回候选并重新识别。"
    });
  });

  test("retries generated identities that collide with an existing foreshadow", async () => {
    const existing = foreshadowAsset(`fsh_${"a".repeat(32)}`);
    const identities = ["a".repeat(32), "b".repeat(32)];
    const candidate = newCandidate("candidate-new", "ch_01", "一枚无人认领的徽章。 ");

    const result = await createForeshadowConfirmationPlan({
      candidates: [candidate],
      selectedCandidateIds: [candidate.candidateId],
      foreshadows: [existing],
      chapterIdsInOrder: ["ch_01"],
      createAssetIdentity: () => identities.shift() ?? "c".repeat(32),
      now: () => NOW
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.operations[0]?.asset.id).toBe(`fsh_${"b".repeat(32)}`);
    expect(identities).toEqual([]);
  });

  test("rejects evidence duplicated across existing assets or new operations", async () => {
    const evidence = await createForeshadowEvidence("ch_01", "窗台上的徽章闪了一下。");
    const candidate = newCandidate(
      "candidate-existing-duplicate",
      "ch_01",
      "  窗台上的徽章闪了一下。  "
    );
    const duplicateExisting = await createForeshadowConfirmationPlan({
      candidates: [candidate],
      selectedCandidateIds: [candidate.candidateId],
      foreshadows: [foreshadowAsset(`fsh_${"c".repeat(32)}`, evidence)],
      chapterIdsInOrder: ["ch_01"],
      createAssetIdentity: () => "d".repeat(32),
      now: () => NOW
    });
    expect(duplicateExisting).toEqual({
      ok: false,
      message: "所选候选与现有伏笔包含重复或无效的原文证据，请返回候选重新选择。"
    });

    const batchCandidates = [
      newCandidate("candidate-batch-a", "ch_01", "同一处划痕。"),
      newCandidate("candidate-batch-b", "ch_01", " 同一处划痕。 ")
    ];
    const identities = ["e".repeat(32), "f".repeat(32)];
    const duplicateBatch = await createForeshadowConfirmationPlan({
      candidates: batchCandidates,
      selectedCandidateIds: batchCandidates.map((item) => item.candidateId),
      foreshadows: [],
      chapterIdsInOrder: ["ch_01"],
      createAssetIdentity: () => identities.shift() ?? "0".repeat(32),
      now: () => NOW
    });
    expect(duplicateBatch).toEqual({
      ok: false,
      message: "所选候选与现有伏笔包含重复或无效的原文证据，请返回候选重新选择。"
    });
  });
});

function newCandidate(
  candidateId: string,
  chapterId: string,
  excerpt: string
): ForeshadowAnalysisCandidateDto {
  return {
    candidateId,
    kind: "new",
    evidence: { chapterId, excerpt, excerptHash: "0".repeat(64) },
    reason: "新线索。",
    duplicateForeshadowIds: [],
    suggested: {
      title: candidateId,
      summary: "摘要",
      trackingStatus: "planted",
      plantedChapterId: chapterId
    }
  };
}

function progressCandidate(
  candidateId: string,
  targetForeshadowId: string,
  chapterId: string,
  excerpt: string,
  suggested: Extract<ForeshadowAnalysisCandidateDto, { kind: "progress" }>["suggested"]
): ForeshadowAnalysisCandidateDto {
  return {
    candidateId,
    kind: "progress",
    targetForeshadowId,
    evidence: { chapterId, excerpt, excerptHash: "0".repeat(64) },
    reason: "线索推进。",
    duplicateForeshadowIds: [],
    suggested
  };
}

function payoffCandidate(
  candidateId: string,
  targetForeshadowId: string,
  chapterId: string,
  excerpt: string,
  optional: { readonly summary?: string; readonly notes?: string }
): ForeshadowAnalysisCandidateDto {
  return {
    candidateId,
    kind: "payoff",
    targetForeshadowId,
    evidence: { chapterId, excerpt, excerptHash: "0".repeat(64) },
    reason: "线索回收。",
    duplicateForeshadowIds: [],
    suggested: {
      trackingStatus: "paid-off",
      actualPayoffChapterId: chapterId,
      ...optional
    }
  };
}

function foreshadowAsset(
  id: string,
  evidence?: ForeshadowAsset["details"]["sourceRefs"][number]
): ForeshadowAsset {
  return {
    schemaVersion: "1.0",
    id,
    type: "foreshadow",
    title: id,
    status: "active",
    summary: "",
    aliases: [],
    relatedEntityIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    details: {
      trackingStatus: "planted",
      plantedChapterId: "ch_01",
      sourceRefs: evidence === undefined ? [] : [evidence],
      origin: "manual"
    }
  };
}
