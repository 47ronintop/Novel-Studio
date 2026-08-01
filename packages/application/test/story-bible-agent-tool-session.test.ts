import { describe, expect, test } from "vitest";

import { ok, type ChapterSummary, type JsonObject } from "@novel-studio/shared";

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
      async prepareStoryAssetCandidate(input) {
        candidateInputs.push(input);
        return baseRepository.prepareStoryAssetCandidate(input);
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
        ]
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
      async prepareStoryAssetCandidate(input) {
        candidateInputs.push(input);
        return baseRepository.prepareStoryAssetCandidate(input);
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
        }
      }
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
      arguments: { assetId: asset.id, baseRevision: 1, status: "deleted" }
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
      resolveRestoreAuthorization: async () =>
        ok({ status: "draft", historyAuthorizationChecksum })
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
      arguments: { assetId: deleted.id, baseRevision: deleted.revision, status: "active" }
    });
    expect(statusRestore).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_RESTORE_COMMAND_REQUIRED" }
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
    async prepareStoryAssetCandidate(input) {
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
