import { checksumChangeSetText, type ChangeSet } from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type UnifiedError
} from "@novel-studio/shared";
import { describe, expect, test } from "vitest";

import { createChangeSetSession } from "../src/change-set-session.js";
import {
  createStoryBibleExplicitInverseSession,
  type StoryBibleExplicitInverseCompatibleRead,
  type StoryBibleExplicitInversePersistedAsset,
  type StoryBibleExplicitInversePreparedWrite
} from "../src/story-bible-explicit-inverse-session.js";
import type { StoryBibleRelation, StoryBibleWriteCandidate } from "../src/story-bible-session.js";

describe("StoryBibleExplicitInverseSession", () => {
  test("prepares both endpoints in one group and applies with a Main-owned human approval", async () => {
    const fixture = createFixture();
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(fixture.source.asset),
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.affectedAssetIds).toEqual(["chr_source", "chr_target"]);
    expect(preview.value.changeSet.files).toHaveLength(2);
    expect(new Set(preview.value.changeSet.files.map((file) => file.consistencyGroupId)).size).toBe(
      1
    );
    const sourceAfter = parseAsset(
      preview.value.changeSet.files.find((file) => file.assetId === "chr_source")?.candidateContent
    );
    const targetAfter = parseAsset(
      preview.value.changeSet.files.find((file) => file.assetId === "chr_target")?.candidateContent
    );
    const sourceRelation = sourceAfter.relations[0];
    const inverse = targetAfter.relations[0];
    expect(sourceRelation?.inverseRelationId).toMatch(/^rel_[a-f0-9]{32}$/u);
    expect(inverse).toMatchObject({
      relationId: sourceRelation?.inverseRelationId,
      sourceId: "chr_target",
      targetId: "chr_source",
      relationType: "character.ally",
      inversePolicy: "explicit",
      inverseRelationId: "rel_11111111111111111111111111111111"
    });
    expect(targetAfter.title).toBe("Target title is preserved");
    expect(targetAfter.details).toEqual({ role: "target-role" });

    const applied = await fixture.session.applyStoryBibleExplicitInverseChange({
      previewId: preview.value.previewId,
      revision: preview.value.changeSet.revision,
      checksum: preview.value.changeSet.checksum
    });
    expect(applied).toMatchObject({ ok: true, value: { applied: true } });
    expect(fixture.approvals).toEqual(["human_confirmation"]);
    expect(fixture.batchCalls).toBe(1);

    const reused = await fixture.session.applyStoryBibleExplicitInverseChange({
      previewId: preview.value.previewId,
      revision: preview.value.changeSet.revision,
      checksum: preview.value.changeSet.checksum
    });
    expect(reused).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });
    expect(fixture.batchCalls).toBe(1);
  });

  test("claims a preview receipt before asynchronous apply work so concurrent confirms cannot reuse it", async () => {
    const fixture = createFixture();
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(fixture.source.asset),
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });
    if (!preview.ok) throw preview.error;
    const command = {
      previewId: preview.value.previewId,
      revision: preview.value.changeSet.revision,
      checksum: preview.value.changeSet.checksum
    };

    const [first, second] = await Promise.all([
      fixture.session.applyStoryBibleExplicitInverseChange(command),
      fixture.session.applyStoryBibleExplicitInverseChange(command)
    ]);

    expect(first).toMatchObject({ ok: true, value: { applied: true } });
    expect(second).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });
    expect(fixture.batchCalls).toBe(1);
  });

  test("updates, moves, and removes an existing pair while preserving inverse-specific content", async () => {
    const fixture = createFixture({ existingPair: true, includeSecondTarget: true });
    const previous = fixture.source.asset.relations[0];
    if (previous === undefined) throw new Error("Expected the existing source relation.");
    const movedCandidate: StoryBibleWriteCandidate = {
      ...authorCandidate(fixture.source.asset),
      relations: [
        {
          ...previous,
          targetId: "chr_second",
          status: "ended",
          validToChapterId: "ch_02"
        }
      ]
    };
    const moved = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: movedCandidate,
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.affectedAssetIds).toEqual(["chr_source", "chr_second", "chr_target"]);
    const oldTarget = parseAsset(
      moved.value.changeSet.files.find((file) => file.assetId === "chr_target")?.candidateContent
    );
    const newTarget = parseAsset(
      moved.value.changeSet.files.find((file) => file.assetId === "chr_second")?.candidateContent
    );
    expect(oldTarget.relations).toEqual([]);
    expect(newTarget.relations[0]).toMatchObject({
      relationId: "rel_22222222222222222222222222222222",
      relationType: "character.protected-by",
      note: "inverse-specific-note",
      sourceId: "chr_second",
      targetId: "chr_source",
      status: "ended",
      validToChapterId: "ch_02"
    });

    const deleteFixture = createFixture({ existingPair: true });
    const removed = await deleteFixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: { ...authorCandidate(deleteFixture.source.asset), relations: [] },
        baseRevision: deleteFixture.source.revision,
        baseChecksum: deleteFixture.source.checksum
      }
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const removedTarget = parseAsset(
      removed.value.changeSet.files.find((file) => file.assetId === "chr_target")?.candidateContent
    );
    expect(removedTarget.relations).toEqual([]);
  });

  test("rejects tampered preview bindings and returns zero writes when a baseline drifts", async () => {
    const fixture = createFixture();
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(fixture.source.asset),
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });
    if (!preview.ok) throw preview.error;

    const tampered = await fixture.session.applyStoryBibleExplicitInverseChange({
      previewId: preview.value.previewId,
      revision: preview.value.changeSet.revision,
      checksum: "f".repeat(64)
    });
    expect(tampered).toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_BINDING_MISMATCH" }
    });
    expect(fixture.batchCalls).toBe(0);

    fixture.driftTarget();
    const drifted = await fixture.session.applyStoryBibleExplicitInverseChange({
      previewId: preview.value.previewId,
      revision: preview.value.changeSet.revision,
      checksum: preview.value.changeSet.checksum
    });
    expect(drifted).toMatchObject({ ok: false, error: { code: "TEST_BASELINE_DRIFT" } });
    expect(fixture.writes).toBe(0);
  });

  test("revokes a canceled Main-owned receipt before it can be applied", async () => {
    const fixture = createFixture();
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(fixture.source.asset),
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });
    if (!preview.ok) throw preview.error;
    const command = previewReceiptCommand(preview.value);

    await expect(fixture.session.cancelStoryBibleExplicitInverseChange(command)).resolves.toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        previewId: preview.value.previewId,
        canceled: true
      }
    });
    await expect(
      fixture.session.applyStoryBibleExplicitInverseChange(command)
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });
    expect(fixture.batchCalls).toBe(0);
  });

  test("fails closed after TTL expiry, clear, or session recreation", async () => {
    const expiredFixture = createFixture({ previewTtlMs: 1_000 });
    const expiredPreview = await expiredFixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(expiredFixture.source.asset),
        baseRevision: expiredFixture.source.revision,
        baseChecksum: expiredFixture.source.checksum
      }
    });
    if (!expiredPreview.ok) throw expiredPreview.error;
    expiredFixture.advanceTime(1_000);
    await expect(
      expiredFixture.session.applyStoryBibleExplicitInverseChange(
        previewReceiptCommand(expiredPreview.value)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });

    const clearedFixture = createFixture();
    const clearedPreview = await clearedFixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(clearedFixture.source.asset),
        baseRevision: clearedFixture.source.revision,
        baseChecksum: clearedFixture.source.checksum
      }
    });
    if (!clearedPreview.ok) throw clearedPreview.error;
    clearedFixture.session.clearPreviews();
    await expect(
      clearedFixture.session.applyStoryBibleExplicitInverseChange(
        previewReceiptCommand(clearedPreview.value)
      )
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });
    await expect(
      clearedFixture
        .recreateSession()
        .applyStoryBibleExplicitInverseChange(previewReceiptCommand(clearedPreview.value))
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STORY_BIBLE_EXPLICIT_INVERSE_PREVIEW_INVALID" }
    });
    expect(expiredFixture.batchCalls).toBe(0);
    expect(clearedFixture.batchCalls).toBe(0);
  });

  test("stages a legacy endpoint as one create-delete migration inside the relation group", async () => {
    const fixture = createFixture({ legacyAssetIds: ["chr_source"] });
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: candidateWithNewExplicitRelation(fixture.source.asset),
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.affectedAssetIds).toEqual(["chr_source", "chr_target"]);
    expect(preview.value.changeSet.files.map((file) => file.assetId)).toEqual(["chr_target"]);
    expect(preview.value.changeSet.operations).toMatchObject([
      {
        kind: "create_file",
        relativePath: "story/characters/chr_source.json",
        selected: true
      },
      {
        kind: "delete_file",
        relativePath: "characters/chr_source.json",
        baseChecksum: fixture.source.checksum,
        selected: true
      }
    ]);
    const operations = preview.value.changeSet.operations ?? [];
    expect(operations[1]?.dependsOn).toEqual([operations[0]?.operationId]);
    expect(
      new Set([
        ...preview.value.changeSet.files.map((file) => file.consistencyGroupId),
        ...operations.map((operation) => operation.consistencyGroupId)
      ]).size
    ).toBe(1);
  });

  test("updates an existing same-target pair while preserving inverse-authored fields", async () => {
    const fixture = createFixture({ existingPair: true });
    const previous = fixture.source.asset.relations[0];
    if (previous === undefined) throw new Error("Expected the existing source relation.");
    const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
      source: {
        candidate: {
          ...authorCandidate(fixture.source.asset),
          relations: [
            {
              ...previous,
              relationType: "character.guards",
              status: "ended",
              validToChapterId: "ch_02"
            }
          ]
        },
        baseRevision: fixture.source.revision,
        baseChecksum: fixture.source.checksum
      }
    });

    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const targetAfter = parseAsset(
      preview.value.changeSet.files.find((file) => file.assetId === "chr_target")?.candidateContent
    );
    expect(targetAfter.relations[0]).toMatchObject({
      relationType: "character.protected-by",
      note: "inverse-specific-note",
      evidence: [{ chapterId: "ch_01", start: 0, end: 1, excerptHash: "a".repeat(64) }],
      status: "ended",
      validToChapterId: "ch_02"
    });
  });

  test.each(["derived", "none"] as const)(
    "removes the stored inverse when explicit is downgraded to %s",
    async (inversePolicy) => {
      const fixture = createFixture({ existingPair: true });
      const previous = fixture.source.asset.relations[0];
      if (previous === undefined) throw new Error("Expected the existing source relation.");
      const preview = await fixture.session.prepareStoryBibleExplicitInverseChange({
        source: {
          candidate: {
            ...authorCandidate(fixture.source.asset),
            relations: [{ ...previous, inversePolicy, inverseRelationId: null }]
          },
          baseRevision: fixture.source.revision,
          baseChecksum: fixture.source.checksum
        }
      });

      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      const targetAfter = parseAsset(
        preview.value.changeSet.files.find((file) => file.assetId === "chr_target")
          ?.candidateContent
      );
      expect(targetAfter.relations).toEqual([]);
    }
  );
});

function previewReceiptCommand(preview: {
  readonly previewId: string;
  readonly changeSet: Pick<ChangeSet, "revision" | "checksum">;
}) {
  return {
    previewId: preview.previewId,
    revision: preview.changeSet.revision,
    checksum: preview.changeSet.checksum
  };
}

function createFixture(
  options: {
    readonly existingPair?: boolean;
    readonly includeSecondTarget?: boolean;
    readonly legacyAssetIds?: readonly string[];
    readonly previewTtlMs?: number;
  } = {}
) {
  const sourceRelation = options.existingPair ? explicitSourceRelation() : undefined;
  const inverseRelation = options.existingPair ? explicitTargetRelation() : undefined;
  const source = compatibleRead(
    asset("chr_source", "Source", sourceRelation === undefined ? [] : [sourceRelation])
  );
  const target = compatibleRead(
    asset(
      "chr_target",
      "Target title is preserved",
      inverseRelation === undefined ? [] : [inverseRelation],
      { role: "target-role" }
    )
  );
  const second = compatibleRead(asset("chr_second", "Second", []));
  const reads = new Map([
    [source.asset.id, source],
    [target.asset.id, target],
    ...(options.includeSecondTarget ? [[second.asset.id, second] as const] : [])
  ]);
  const persistedChangeSets = new Map<string, ChangeSet>();
  const latestByCheckpoint = new Map<string, ChangeSet>();
  const changeSets = createChangeSetSession({
    createChangeSetId: () => "change_set_explicit_inverse",
    createHunkId: (() => {
      let index = 0;
      return () => `hunk_${++index}`;
    })(),
    now: () => "2026-08-01T00:00:00.000Z",
    port: {
      readChapterTarget: async () => err(testError("TEST_UNEXPECTED_CHAPTER")),
      readFileTarget: async () => err(testError("TEST_UNEXPECTED_FILE")),
      async readStoryBibleTarget({ assetId }) {
        const read = reads.get(assetId);
        return read === undefined
          ? err(testError("TEST_ASSET_MISSING"))
          : ok({
              relativePath: read.relativePath,
              assetType: "text" as const,
              assetId,
              content: canonical(read.asset),
              checksum: read.checksum,
              dirty: false,
              supported: true
            });
      },
      validateCandidate: async () =>
        ok({
          schema: { status: "valid" as const },
          asset: { status: "valid" as const }
        }),
      async persistChangeSet(changeSet) {
        persistedChangeSets.set(changeSet.changeSetId, changeSet);
        latestByCheckpoint.set(
          `${changeSet.runId}:${changeSet.projectId}:${changeSet.checkpointId}`,
          changeSet
        );
        return ok(changeSet);
      },
      async readChangeSet(changeSetId, revision) {
        const value = persistedChangeSets.get(changeSetId);
        return ok(
          value !== undefined && (revision === undefined || value.revision === revision)
            ? value
            : undefined
        );
      },
      async readLatestChangeSet(input) {
        return ok(
          latestByCheckpoint.get(`${input.runId}:${input.projectId}:${input.checkpointId}`)
        );
      }
    }
  });
  let sequence = 0;
  let drifted = false;
  let writes = 0;
  let batchCalls = 0;
  let nowMs = Date.parse("2026-08-01T00:00:00.000Z");
  const approvals: string[] = [];
  const recreateSession = () =>
    createStoryBibleExplicitInverseSession({
      projectId: "project_story",
      repository: {
        async readCompatibleStoryAsset(assetId) {
          const read = reads.get(assetId);
          return read === undefined ? err(testError("TEST_ASSET_MISSING")) : ok(read);
        },
        async prepareStoryAssetCandidateReadOnly(input) {
          const read = reads.get(input.candidate.id);
          if (
            read === undefined ||
            read.revision !== input.baseRevision ||
            read.checksum !== input.baseChecksum
          ) {
            return err(testError("TEST_PREPARE_CONFLICT"));
          }
          const preparedAsset: StoryBibleExplicitInversePersistedAsset = {
            ...input.candidate,
            updatedAt: "2026-08-01T00:00:01.000Z",
            revision: read.revision + 1
          };
          return ok<StoryBibleExplicitInversePreparedWrite>({
            asset: preparedAsset,
            current: read,
            relativePath: `story/characters/${read.asset.id}.json`,
            content: canonical(preparedAsset),
            baseContent: canonical(read.asset),
            baseRevision: read.revision,
            baseChecksum: read.checksum
          });
        },
        async validateStoryBibleCandidateGroup(input) {
          const assets = input.candidates.map((candidate) =>
            parseAsset(candidate.candidateContent)
          );
          const relations = assets.flatMap((candidate) => candidate.relations);
          const explicit = relations.filter((relation) => relation.inversePolicy === "explicit");
          return explicit.every((relation) =>
            explicit.some(
              (inverse) =>
                inverse.relationId === relation.inverseRelationId &&
                inverse.inverseRelationId === relation.relationId &&
                inverse.sourceId === relation.targetId &&
                inverse.targetId === relation.sourceId &&
                inverse.status === relation.status &&
                inverse.validFromChapterId === relation.validFromChapterId &&
                inverse.validToChapterId === relation.validToChapterId
            )
          )
            ? ok(undefined)
            : err(testError("TEST_GROUP_INVALID"));
        }
      },
      changeSets,
      versionGroups: {
        async applyApprovedBatch(input) {
          batchCalls += 1;
          approvals.push(input.approval.approvalSource);
          if (drifted) return err(testError("TEST_BASELINE_DRIFT"));
          writes += input.changeSet.files.length + (input.changeSet.operations?.length ?? 0);
          const consistencyGroupId =
            input.changeSet.files[0]?.consistencyGroupId ??
            input.changeSet.operations?.[0]?.consistencyGroupId ??
            "missing";
          return ok({
            schemaVersion: "1.0",
            applyBatchId: input.applyBatchId,
            changeSetId: input.changeSet.changeSetId,
            selectionChecksum: input.approval.binding.selectionChecksum ?? "selection",
            groups: [{ consistencyGroupId, status: "applied" }]
          });
        }
      },
      createId(kind) {
        sequence += 1;
        if (kind === "relation") return "rel_1234567890abcdef1234567890abcdef";
        return `${kind}_${sequence}`;
      },
      now: () => new Date(nowMs).toISOString(),
      ...(options.previewTtlMs === undefined ? {} : { previewTtlMs: options.previewTtlMs })
    });
  for (const assetId of options.legacyAssetIds ?? []) {
    const read = reads.get(assetId);
    if (read !== undefined) {
      reads.set(assetId, { ...read, relativePath: `characters/${assetId}.json` });
    }
  }
  const session = recreateSession();
  return {
    source,
    target,
    session,
    approvals,
    recreateSession,
    advanceTime(milliseconds: number) {
      nowMs += milliseconds;
    },
    get batchCalls() {
      return batchCalls;
    },
    get writes() {
      return writes;
    },
    driftTarget() {
      drifted = true;
    }
  };
}

function candidateWithNewExplicitRelation(
  source: StoryBibleExplicitInversePersistedAsset
): StoryBibleWriteCandidate {
  return {
    ...authorCandidate(source),
    relations: [
      {
        relationId: "rel_11111111111111111111111111111111",
        sourceId: source.id,
        targetId: "chr_target",
        relationType: "character.ally",
        direction: "directed",
        status: "active",
        validFromChapterId: null,
        validToChapterId: null,
        inversePolicy: "explicit",
        inverseRelationId: null,
        evidence: [],
        note: ""
      }
    ]
  };
}

function explicitSourceRelation(): StoryBibleRelation {
  return {
    relationId: "rel_11111111111111111111111111111111",
    sourceId: "chr_source",
    targetId: "chr_target",
    relationType: "character.protects",
    direction: "directed",
    status: "active",
    validFromChapterId: null,
    validToChapterId: null,
    inversePolicy: "explicit",
    inverseRelationId: "rel_22222222222222222222222222222222",
    evidence: [],
    note: "source-note"
  };
}

function explicitTargetRelation(): StoryBibleRelation {
  return {
    relationId: "rel_22222222222222222222222222222222",
    sourceId: "chr_target",
    targetId: "chr_source",
    relationType: "character.protected-by",
    direction: "directed",
    status: "active",
    validFromChapterId: null,
    validToChapterId: null,
    inversePolicy: "explicit",
    inverseRelationId: "rel_11111111111111111111111111111111",
    evidence: [{ chapterId: "ch_01", start: 0, end: 1, excerptHash: "a".repeat(64) }],
    note: "inverse-specific-note"
  };
}

function asset(
  id: string,
  title: string,
  relations: StoryBibleRelation[],
  details: JsonObject = {}
): StoryBibleExplicitInversePersistedAsset {
  return {
    schemaVersion: "1.1",
    id,
    type: "character",
    title,
    status: "active",
    summary: `${title} summary`,
    aliases: [],
    relations,
    details,
    extensions: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    revision: 1
  };
}

function compatibleRead(
  value: StoryBibleExplicitInversePersistedAsset
): StoryBibleExplicitInverseCompatibleRead {
  const content = canonical(value);
  return {
    asset: value,
    persistedSchemaVersion: "1.1",
    relativePath: `story/characters/${value.id}.json`,
    checksum: checksumChangeSetText(content),
    revision: value.revision,
    passthroughPresent: false,
    passthroughFieldCount: 0
  };
}

function authorCandidate(value: StoryBibleExplicitInversePersistedAsset): StoryBibleWriteCandidate {
  return {
    schemaVersion: "1.1",
    id: value.id,
    type: value.type,
    title: value.title,
    status: value.status,
    summary: value.summary,
    aliases: [...value.aliases],
    relations: value.relations.map((relation) => ({ ...relation })),
    details: value.details,
    extensions: value.extensions,
    createdAt: value.createdAt
  };
}

function parseAsset(content: string | undefined): StoryBibleExplicitInversePersistedAsset {
  if (content === undefined) throw new Error("Expected Story Bible candidate content.");
  return JSON.parse(content) as StoryBibleExplicitInversePersistedAsset;
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function testError(code: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message: code,
    recoverability: "user-action",
    suggestedAction: "Retry the test.",
    traceId: "story-bible-explicit-inverse-test"
  });
}
