import { describe, expect, test } from "vitest";

import {
  FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
  ok,
  type ChapterSummary,
  type JsonObject
} from "@novel-studio/shared";

import {
  createStoryBibleAgentToolSession,
  type StoryBibleAgentToolAsset,
  type StoryBibleAgentToolRepositoryPort
} from "../src/index.js";

const checksum = "a".repeat(64);
const deletionImpactChecksum = "d".repeat(64);
const historyAuthorizationChecksum = "b".repeat(64);

describe("Story Bible Agent tool session", () => {
  test("prepares a validated field patch without writing the repository", async () => {
    const asset = characterAsset();
    const baseRepository = repositoryFor(asset);
    const candidateInputs: unknown[] = [];
    const repository: StoryBibleAgentToolRepositoryPort = {
      ...baseRepository,
      async prepareStoryAssetCandidateReadOnly(input) {
        candidateInputs.push(input);
        return baseRepository.prepareStoryAssetCandidateReadOnly(input);
      }
    };
    const session = createStoryBibleAgentToolSession({ repository });

    const prepared = await session.prepare({
      toolName: "patch_story_bible",
      arguments: {
        assetId: asset.id,
        baseRevision: 1,
        baseChecksum: checksum,
        consistencyGroupId: "cgrp_location_update",
        operations: [{ op: "replace", path: "/summary", value: "调查旧港失踪案" }]
      }
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        kind: "replace",
        action: "patch",
        assetId: asset.id,
        baseRevision: 1,
        nextRevision: 2,
        consistencyGroupId: "cgrp_location_update",
        changedPaths: ["/summary"],
        fieldDiffs: [
          {
            path: "/summary",
            beforeValue: "",
            afterValue: "调查旧港失踪案"
          }
        ],
        approvalProof: {
          operation: "story_bible_patch",
          effectRuleId: "no_reference_impact_story_bible_patch_v1",
          evidence: {
            createOnly: "not_applicable",
            referenceImpact: "none",
            limits: "within",
            stateBoundary: "ordinary"
          },
          reviewRequirement: "conditional_candidate"
        }
      }
    });
    expect(candidateInputs).toEqual([
      expect.objectContaining({ deferProjectRelationPairValidation: true })
    ]);
  });

  test("defers relation-pair validation for a grouped create proposal", async () => {
    const asset = characterAsset();
    const baseRepository = repositoryFor(asset);
    const createInputs: unknown[] = [];
    const repository: StoryBibleAgentToolRepositoryPort = {
      ...baseRepository,
      async prepareCreateStoryAsset(input) {
        createInputs.push(input);
        return baseRepository.prepareCreateStoryAsset(input);
      }
    };
    const session = createStoryBibleAgentToolSession({ repository });

    const prepared = await session.prepare({
      toolName: "create_story_bible",
      arguments: {
        type: "character",
        value: { title: "顾岚" },
        consistencyGroupId: "cgrp_relation_pair"
      }
    });

    expect(prepared.ok).toBe(true);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          schemaVersion: "1.0",
          policyId: "bounded-story-bible-proposal@1.0",
          operation: "story_bible_create",
          effectRuleId: "bounded_story_bible_create_v1",
          measurements: { relationCount: 0 },
          thresholds: {
            maxFieldCount: 128,
            maxRelationCount: 16,
            maxTotalBytes: 65_536
          },
          evidence: {
            createOnly: "proven",
            referenceImpact: "none",
            limits: "within",
            stateBoundary: "ordinary"
          },
          reviewRequirement: "conditional_candidate",
          referenceImpactChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
        }
      }
    });
    expect(createInputs).toEqual([
      expect.objectContaining({ deferProjectRelationPairValidation: true })
    ]);
  });

  test("passes authoritative chapter IDs to create, patch, and reference-impact preparation", async () => {
    const asset = characterAsset();
    const baseRepository = repositoryFor(asset);
    const createInputs: unknown[] = [];
    const candidateInputs: unknown[] = [];
    const referenceInputs: unknown[] = [];
    const repository: StoryBibleAgentToolRepositoryPort = {
      ...baseRepository,
      async prepareCreateStoryAsset(input) {
        createInputs.push(input);
        return baseRepository.prepareCreateStoryAsset(input);
      },
      async prepareStoryAssetCandidateReadOnly(input) {
        candidateInputs.push(input);
        return baseRepository.prepareStoryAssetCandidateReadOnly(input);
      },
      async getStoryBibleReferences(assetId, knownChapterIds) {
        referenceInputs.push({ assetId, knownChapterIds });
        return ok({
          assetId,
          deletionImpactChecksum,
          incoming: [],
          outgoing: [],
          canSetDeleted: true,
          deletionImpact: {
            affectedReferenceCount: 0,
            affectedAssetIds: [],
            cascades: false
          }
        });
      }
    };
    const session = createStoryBibleAgentToolSession({
      repository,
      chapterCatalog: chapterCatalog(["ch_02", "ch_01"])
    });

    const created = await session.prepare({
      toolName: "create_story_bible",
      arguments: { type: "character", value: { title: "Mira" } }
    });
    const patched = await session.prepare({
      toolName: "patch_story_bible",
      arguments: {
        assetId: asset.id,
        baseRevision: 1,
        baseChecksum: checksum,
        operations: [{ op: "replace", path: "/summary", value: "Updated" }]
      }
    });
    const deleted = await session.prepare({
      toolName: "set_story_bible_status",
      arguments: {
        assetId: asset.id,
        baseRevision: 1,
        baseChecksum: checksum,
        status: "deleted"
      }
    });

    expect(created.ok).toBe(true);
    expect(patched.ok).toBe(true);
    expect(deleted.ok).toBe(true);
    expect(createInputs).toEqual([
      expect.objectContaining({ knownChapterIds: ["ch_02", "ch_01"] })
    ]);
    expect(candidateInputs).toHaveLength(2);
    expect(candidateInputs).toEqual(
      expect.arrayContaining([expect.objectContaining({ knownChapterIds: ["ch_02", "ch_01"] })])
    );
    for (const input of candidateInputs) {
      expect(input).toMatchObject({ knownChapterIds: ["ch_02", "ch_01"] });
    }
    expect(referenceInputs).toHaveLength(1);
    for (const input of referenceInputs) {
      expect(input).toEqual({
        assetId: asset.id,
        knownChapterIds: ["ch_02", "ch_01"]
      });
    }
  });

  test("rejects legacy status changes until a regular patch migrates the asset", async () => {
    const asset = characterAsset();
    const baseRepository = repositoryFor(asset);
    const repository: StoryBibleAgentToolRepositoryPort = {
      ...baseRepository,
      async prepareStoryAssetCandidateReadOnly(input) {
        const prepared = await baseRepository.prepareStoryAssetCandidateReadOnly(input);
        return prepared.ok
          ? ok({ ...prepared.value, currentRelativePath: "characters/legacy/character.json" })
          : prepared;
      }
    };
    const session = createStoryBibleAgentToolSession({ repository });

    await expect(
      session.prepare({
        toolName: "set_story_bible_status",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          status: "archived"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_LEGACY_STATUS_MIGRATION_UNSUPPORTED" }
    });
  });

  test("rejects an invalid consistency group before preparing a write", async () => {
    const asset = characterAsset();
    const repository = repositoryFor(asset);
    const session = createStoryBibleAgentToolSession({ repository });

    const prepared = await session.prepare({
      toolName: "patch_story_bible",
      arguments: {
        assetId: asset.id,
        baseRevision: 1,
        consistencyGroupId: "group with spaces",
        operations: [{ op: "replace", path: "/summary", value: "new" }]
      }
    });

    expect(prepared).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_TOOL_ARGUMENTS_INVALID" }
    });
  });

  test("includes reference impact in a soft-delete proposal", async () => {
    const asset = characterAsset();
    const repository = repositoryFor(asset, {
      assetId: asset.id,
      deletionImpactChecksum,
      incoming: [{ sourceAssetId: "outline_main", targetAssetId: asset.id }],
      outgoing: [],
      canSetDeleted: true,
      deletionImpact: {
        affectedReferenceCount: 1,
        affectedAssetIds: ["outline_main"],
        cascades: false
      }
    });
    const session = createStoryBibleAgentToolSession({ repository });

    const prepared = await session.prepare({
      toolName: "set_story_bible_status",
      arguments: { assetId: asset.id, baseRevision: 1, baseChecksum: checksum, status: "deleted" }
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        action: "status",
        changedPaths: ["/status"],
        referenceImpact: {
          deletionImpact: { affectedReferenceCount: 1, cascades: false }
        },
        storyBibleStatusProof: {
          action: "delete",
          deletionImpactChecksum
        },
        approvalProof: {
          operation: "story_bible_status",
          evidence: {
            referenceImpact: "present",
            stateBoundary: "delete"
          },
          reviewRequirement: "always_human"
        }
      }
    });
  });

  test("rejects deleted-boundary reference evidence for another asset", async () => {
    const asset = characterAsset();
    const repository = repositoryFor(asset, {
      assetId: "chr_other",
      deletionImpactChecksum,
      incoming: [],
      outgoing: [],
      canSetDeleted: true,
      deletionImpact: {
        affectedReferenceCount: 0,
        affectedAssetIds: [],
        cascades: false
      }
    });
    const session = createStoryBibleAgentToolSession({ repository });

    await expect(
      session.prepare({
        toolName: "set_story_bible_status",
        arguments: { assetId: asset.id, baseRevision: 1, baseChecksum: checksum, status: "deleted" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_REFERENCE_IMPACT_INVALID" }
    });
  });

  test("refuses to soft-delete outline and timeline singletons", async () => {
    const asset = outlineAsset();
    const repository = repositoryFor(asset, {
      assetId: asset.id,
      deletionImpactChecksum,
      incoming: [],
      outgoing: [],
      canSetDeleted: false,
      deletionImpact: { affectedReferenceCount: 0, affectedAssetIds: [], cascades: false }
    });
    const session = createStoryBibleAgentToolSession({ repository });

    const prepared = await session.prepare({
      toolName: "set_story_bible_status",
      arguments: { assetId: asset.id, baseRevision: 1, baseChecksum: checksum, status: "deleted" }
    });

    expect(prepared).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_SINGLETON_DELETE_FORBIDDEN" }
    });
  });

  test("restores the status resolved from deletion history", async () => {
    const asset = { ...characterAsset(), status: "deleted" as const, revision: 2 };
    const repository = repositoryFor(asset);
    const session = createStoryBibleAgentToolSession({
      repository,
      resolveRestoreAuthorization: async () => ok({ status: "draft", historyAuthorizationChecksum })
    });

    const prepared = await session.prepare({
      toolName: "restore_story_bible",
      arguments: { assetId: asset.id, baseRevision: 2, baseChecksum: checksum }
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        action: "restore",
        fieldDiffs: [{ beforeValue: "deleted", afterValue: "draft" }],
        storyBibleStatusProof: {
          action: "restore",
          expectedStatus: "draft",
          historyAuthorizationChecksum
        },
        approvalProof: {
          operation: "story_bible_restore",
          evidence: { stateBoundary: "restore" },
          reviewRequirement: "always_human"
        }
      }
    });
  });

  test("marks both directions across the archive boundary for human review", async () => {
    const asset = characterAsset({ status: "archived" });
    const session = createStoryBibleAgentToolSession({ repository: repositoryFor(asset) });

    await expect(
      session.prepare({
        toolName: "set_story_bible_status",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          status: "active"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          evidence: { stateBoundary: "archive" },
          reviewRequirement: "always_human"
        }
      }
    });
  });

  test("requires dedicated tools for every transition across deleted", async () => {
    const active = characterAsset();
    const activeSession = createStoryBibleAgentToolSession({ repository: repositoryFor(active) });
    const patchedStatus = await activeSession.prepare({
      toolName: "patch_story_bible",
      arguments: {
        assetId: active.id,
        baseRevision: active.revision,
        baseChecksum: checksum,
        operations: [{ op: "replace", path: "/status", value: "deleted" }]
      }
    });
    expect(patchedStatus).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_STATUS_TRANSITION_COMMAND_REQUIRED" }
    });

    const deleted = { ...active, status: "deleted" as const, revision: 2 };
    const deletedSession = createStoryBibleAgentToolSession({
      repository: repositoryFor(deleted)
    });
    const statusRestore = await deletedSession.prepare({
      toolName: "set_story_bible_status",
      arguments: {
        assetId: deleted.id,
        baseRevision: deleted.revision,
        baseChecksum: checksum,
        status: "active"
      }
    });
    expect(statusRestore).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_COMMAND_REQUIRED" }
    });
  });

  test("requires and rechecks a fresh checksum for patch, status, and restore", async () => {
    const active = characterAsset();
    const activeSession = createStoryBibleAgentToolSession({ repository: repositoryFor(active) });
    await expect(
      activeSession.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: active.id,
          baseRevision: active.revision,
          operations: [{ op: "replace", path: "/summary", value: "Updated" }]
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_TOOL_ARGUMENTS_INVALID" }
    });
    await expect(
      activeSession.prepare({
        toolName: "set_story_bible_status",
        arguments: { assetId: active.id, baseRevision: active.revision, status: "archived" }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_TOOL_ARGUMENTS_INVALID" }
    });
    await expect(
      activeSession.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: active.id,
          baseRevision: active.revision,
          baseChecksum: "c".repeat(64),
          operations: [{ op: "replace", path: "/summary", value: "Updated" }]
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_CHECKSUM_CONFLICT" }
    });

    const deleted = { ...active, status: "deleted" as const, revision: 2 };
    const deletedSession = createStoryBibleAgentToolSession({
      repository: repositoryFor(deleted),
      resolveRestoreAuthorization: async () =>
        ok({ status: "active", historyAuthorizationChecksum })
    });
    await expect(
      deletedSession.prepare({
        toolName: "restore_story_bible",
        arguments: { assetId: deleted.id, baseRevision: deleted.revision }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_TOOL_ARGUMENTS_INVALID" }
    });
  });

  test("freezes reference impact for reference-bearing patches", async () => {
    const asset = characterAsset();
    const session = createStoryBibleAgentToolSession({ repository: repositoryFor(asset) });

    await expect(
      session.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          operations: [{ op: "replace", path: "/relations", value: [] }]
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        referenceImpact: {
          assetId: asset.id,
          deletionImpactChecksum
        }
      }
    });
  });

  test("classifies changed relations as reference impact and malformed impact as unknown", async () => {
    const asset = characterAsset();
    const relation = characterRelation("rel_22222222222222222222222222222222");
    const referencePatch = createStoryBibleAgentToolSession({ repository: repositoryFor(asset) });

    await expect(
      referencePatch.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          operations: [{ op: "replace", path: "/relations", value: [relation] }]
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          evidence: { referenceImpact: "present" },
          reviewRequirement: "always_human",
          referenceImpactChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
        }
      }
    });

    const unknownImpactPatch = createStoryBibleAgentToolSession({
      repository: repositoryFor(asset, {})
    });
    await expect(
      unknownImpactPatch.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          operations: [{ op: "replace", path: "/details", value: asset.details }]
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          evidence: { referenceImpact: "unknown" },
          reviewRequirement: "always_human"
        }
      }
    });

    const mismatchedImpactPatch = createStoryBibleAgentToolSession({
      repository: repositoryFor(asset, {
        assetId: "chr_other",
        deletionImpactChecksum,
        incoming: [],
        outgoing: [],
        canSetDeleted: true,
        deletionImpact: {
          affectedReferenceCount: 0,
          affectedAssetIds: [],
          cascades: false
        }
      })
    });
    await expect(
      mismatchedImpactPatch.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          operations: [{ op: "replace", path: "/details", value: asset.details }]
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          evidence: { referenceImpact: "unknown" },
          reviewRequirement: "always_human"
        }
      }
    });
  });

  test("binds exact create measurements and marks every exceeded safety threshold", async () => {
    const base = characterAsset();
    const oversized = characterAsset({
      summary: "x".repeat(66_000),
      relations: Array.from({ length: 17 }, (_, index) =>
        characterRelation(`rel_${String(index).padStart(32, "0")}`)
      ),
      details: Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [`field_${index}`, index])
      )
    });
    const baseRepository = repositoryFor(base);
    const repository: StoryBibleAgentToolRepositoryPort = {
      ...baseRepository,
      async prepareCreateStoryAsset() {
        return ok({
          asset: oversized,
          relativePath: `characters/${oversized.id}.json`,
          content: `${JSON.stringify(oversized)}\n`
        });
      }
    };
    const session = createStoryBibleAgentToolSession({ repository });
    const prepared = await session.prepare({
      toolName: "create_story_bible",
      arguments: { type: "character", value: { title: "Oversized" } }
    });

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        approvalProof: {
          measurements: {
            fieldCount: 134,
            relationCount: 17,
            totalBytes: expect.any(Number)
          },
          evidence: {
            referenceImpact: "present",
            limits: "exceeded"
          },
          reviewRequirement: "always_human"
        }
      }
    });
    if (!prepared.ok) return;
    expect(prepared.value.approvalProof.measurements.totalBytes).toBeGreaterThan(65_536);
  });

  test("produces identical approval proof inputs for identical frozen proposals", async () => {
    const asset = characterAsset();
    const session = createStoryBibleAgentToolSession({ repository: repositoryFor(asset) });
    const input = {
      toolName: "patch_story_bible" as const,
      arguments: {
        assetId: asset.id,
        baseRevision: asset.revision,
        baseChecksum: checksum,
        operations: [{ op: "replace", path: "/summary", value: "Deterministic" }]
      }
    };

    const first = await session.prepare(input);
    const second = await session.prepare(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.approvalProof).toEqual(second.value.approvalProof);
    expect(Object.isFrozen(first.value.approvalProof)).toBe(true);
    expect(Object.isFrozen(first.value.approvalProof.measurements)).toBe(true);
  });

  test("carries the shared paid-off warning in structured proposals", async () => {
    const asset = foreshadowAsset();
    const session = createStoryBibleAgentToolSession({ repository: repositoryFor(asset) });

    await expect(
      session.prepare({
        toolName: "patch_story_bible",
        arguments: {
          assetId: asset.id,
          baseRevision: asset.revision,
          baseChecksum: checksum,
          operations: [{ op: "replace", path: "/summary", value: "Updated" }]
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        warnings: [
          {
            code: FORESHADOW_PAID_OFF_ACTUAL_CHAPTER_MISSING,
            severity: "warning"
          }
        ]
      }
    });
  });
});

function repositoryFor(
  asset: StoryBibleAgentToolAsset,
  references: JsonObject = {
    assetId: asset.id,
    deletionImpactChecksum,
    incoming: [],
    outgoing: [],
    canSetDeleted: true,
    deletionImpact: { affectedReferenceCount: 0, affectedAssetIds: [], cascades: false }
  }
): StoryBibleAgentToolRepositoryPort {
  return {
    async readCompatibleStoryAsset() {
      return ok({ asset, checksum, revision: asset.revision });
    },
    async prepareCreateStoryAsset(input) {
      const created = characterAsset({
        type: input.type,
        title: String(input.value["title"] ?? "Created")
      });
      return ok({
        asset: created,
        relativePath: `characters/${created.id}.json`,
        content: `${JSON.stringify(created, null, 2)}\n`
      });
    },
    async prepareStoryAssetCandidateReadOnly(input) {
      const candidate = input.candidate;
      const prepared = {
        ...candidate,
        updatedAt: "2026-07-31T01:00:00.000Z",
        revision: asset.revision + 1
      } as StoryBibleAgentToolAsset;
      return ok({
        asset: prepared,
        current: { asset, checksum, revision: asset.revision },
        relativePath: `characters/${asset.id}.json`,
        content: `${JSON.stringify(prepared, null, 2)}\n`,
        baseContent: `${JSON.stringify(asset, null, 2)}\n`,
        baseRevision: asset.revision,
        baseChecksum: checksum
      });
    },
    async getStoryBibleReferences() {
      return ok(references);
    }
  };
}

function characterAsset(
  overrides: Partial<StoryBibleAgentToolAsset> = {}
): StoryBibleAgentToolAsset {
  return {
    schemaVersion: "1.1",
    id: "chr_11111111111111111111111111111111",
    type: "character",
    title: "林砚",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: { knowledgeStates: [], stateHistory: [] },
    extensions: {},
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    revision: 1,
    ...overrides
  };
}

function outlineAsset(): StoryBibleAgentToolAsset {
  return {
    ...characterAsset(),
    id: "outline_main",
    type: "outline",
    title: "主大纲",
    details: { volumes: [], chapterOutlines: [] }
  };
}

function foreshadowAsset(): StoryBibleAgentToolAsset {
  return {
    ...characterAsset(),
    id: "fsh_11111111111111111111111111111111",
    type: "foreshadow",
    title: "Unresolved signal",
    details: {
      trackingStatus: "paid-off",
      milestones: [
        {
          milestoneId: "fsm_11111111111111111111111111111111",
          entryRevision: 1,
          kind: "payoff",
          chapterId: "ch_01",
          evidence: { start: 0, end: 1, excerptHash: "e".repeat(64) },
          note: ""
        }
      ]
    }
  };
}

function characterRelation(relationId: string): JsonObject {
  return {
    relationId,
    sourceId: "chr_11111111111111111111111111111111",
    targetId: "chr_22222222222222222222222222222222",
    relationType: "character.ally",
    direction: "directed",
    status: "active",
    validFromChapterId: null,
    validToChapterId: null,
    inversePolicy: "none",
    inverseRelationId: null,
    evidence: [],
    note: ""
  };
}

function chapterCatalog(chapterIds: readonly string[]) {
  return {
    async listChapters() {
      return ok(
        chapterIds.map((id, index): ChapterSummary => ({
          id,
          title: id,
          order: index + 1,
          status: "draft",
          updatedAt: "2026-07-31T00:00:00.000Z"
        }))
      );
    }
  };
}
