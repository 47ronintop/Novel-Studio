import { describe, expect, test, vi } from "vitest";

import type { ChangeSet } from "@novel-studio/agent-engine";
import type { StoryChangeSuggestion } from "@novel-studio/schemas";
import {
  ok,
  type ChapterSummary,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { createAgentFileOperationSession } from "../src/agent-file-operation-session.js";
import { createStoryAnalysisChangeSetPreparationPort } from "../src/story-analysis-change-set-preparation.js";
import { checksumStoryBibleSelectorValue } from "../src/story-bible-patch.js";
import type {
  StoryBibleAgentToolAsset,
  StoryBibleAgentToolRepositoryPort
} from "../src/story-bible-agent-tool-session.js";

const WORKFLOW_RUN_ID = `workflow_${"1".repeat(32)}`;
const ANALYSIS_RUN_ID = `run_${"2".repeat(32)}`;
const CONTEXT_SNAPSHOT_ID = `ctx_${"3".repeat(32)}`;
const CHARACTER_ID = `chr_${"4".repeat(32)}`;
const LOCATION_ID = `loc_${"5".repeat(32)}`;
const TIMELINE_ID = "timeline_main";
const TIMELINE_EVENT_ID = `evt_${"7".repeat(32)}`;
const GROUP_ID = `cgrp_${"6".repeat(32)}`;
const NOW = "2026-07-31T00:00:00.000Z";
const BASE_CHECKSUM = "a".repeat(64);

describe("Story Analysis Change Set preparation", () => {
  test("merges compatible suggestions for one asset and consistency group", async () => {
    const asset = characterAsset();
    const repository = repositoryHarness(asset);
    const changeSets = changeSetHarness(GROUP_ID);
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository: repository.port,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession()
    });
    const suggestions = [
      patchSuggestion({
        suggestionId: `sug_${"1".repeat(32)}`,
        path: "/summary",
        before: asset.summary,
        value: "新的摘要"
      }),
      patchSuggestion({
        suggestionId: `sug_${"2".repeat(32)}`,
        path: "/details/currentState/emotional",
        before: "",
        value: "警觉"
      })
    ];

    const result = await preparation.prepareChangeSet(applicationInput(suggestions));

    expect(result).toMatchObject({ ok: true, value: { status: "awaiting_approval" } });
    expect(repository.prepareStoryAssetCandidateReadOnly).toHaveBeenCalledTimes(1);
    expect(repository.prepareStoryAssetCandidateReadOnly.mock.calls[0]?.[0]).toMatchObject({
      candidate: {
        id: CHARACTER_ID,
        summary: "新的摘要",
        details: { currentState: { emotional: "警觉" } }
      },
      baseRevision: 1,
      baseChecksum: BASE_CHECKSUM,
      deferProjectRelationPairValidation: true
    });
    expect(changeSets.proposeStoryBibleWrite).toHaveBeenCalledTimes(1);
    expect(changeSets.proposeStoryBibleWrite.mock.calls[0]?.[0]).toMatchObject({
      assetId: CHARACTER_ID,
      consistencyGroupId: GROUP_ID,
      repositoryPrepared: true
    });
  });

  test("stages a legacy-path migration through one atomic operation batch", async () => {
    const asset = characterAsset();
    const repository = repositoryHarness(asset, {
      currentRelativePath: `characters/legacy/${CHARACTER_ID}.json`
    });
    const changeSets = changeSetHarness(GROUP_ID);
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository: repository.port,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession()
    });

    const result = await preparation.prepareChangeSet(
      applicationInput([
        patchSuggestion({
          suggestionId: `sug_${"c".repeat(32)}`,
          path: "/summary",
          before: asset.summary,
          value: "迁移后的摘要"
        })
      ])
    );

    expect(result).toMatchObject({ ok: true });
    expect(changeSets.proposeOperation).not.toHaveBeenCalled();
    expect(changeSets.proposeOperationBatch).toHaveBeenCalledTimes(1);
    const batch = changeSets.proposeOperationBatch.mock.calls[0]?.[0] as {
      readonly operations: readonly {
        readonly toolCallId: string;
        readonly operation: {
          readonly kind: string;
          readonly operationId: string;
          readonly dependsOn?: readonly string[];
        };
      }[];
    };
    expect(batch.operations.map((item) => item.operation.kind)).toEqual([
      "create_file",
      "delete_file"
    ]);
    expect(batch.operations[1]?.operation.dependsOn).toEqual([
      batch.operations[0]?.operation.operationId
    ]);
  });

  test("rejects an existing Story Analysis Change Set with only half a legacy migration", async () => {
    const asset = characterAsset();
    const repository = repositoryHarness(asset);
    const changeSets = changeSetHarness(GROUP_ID);
    changeSets.readLatestChangeSet.mockResolvedValueOnce(
      ok({
        ...changeSet(GROUP_ID),
        files: [],
        operationsSchemaVersion: "1.1" as const,
        operations: [
          {
            kind: "create_file" as const,
            operationId: "op-incomplete-create",
            relativePath: `characters/${CHARACTER_ID}.json`,
            content: "{}\n",
            toolCallIdempotencyKey: "tool_incomplete_create",
            consistencyGroupId: GROUP_ID,
            selected: true
          }
        ]
      })
    );
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository: repository.port,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession()
    });

    const result = await preparation.prepareChangeSet(
      applicationInput([
        patchSuggestion({
          suggestionId: `sug_${"d".repeat(32)}`,
          path: "/summary",
          before: asset.summary,
          value: "不应继续"
        })
      ])
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_CHANGE_SET_INCOMPLETE" }
    });
    expect(repository.readCompatibleStoryAsset).not.toHaveBeenCalled();
    expect(changeSets.proposeOperationBatch).not.toHaveBeenCalled();
  });

  test("preserves a create suggestion reserved asset ID through repository and file staging", async () => {
    const asset = locationAsset();
    const listChapters = vi.fn(async () =>
      ok([chapterSummary("ch_02", 2), chapterSummary("ch_01", 1)])
    );
    const prepareCreateStoryAsset = vi.fn(async () =>
      ok({
        asset,
        relativePath: `world/${LOCATION_ID}.json`,
        content: serialize(asset)
      })
    );
    const repository = {
      readCompatibleStoryAsset: vi.fn(async () => {
        throw new Error("not used");
      }),
      prepareCreateStoryAsset,
      prepareStoryAssetCandidateReadOnly: vi.fn(async () => {
        throw new Error("not used");
      })
    } satisfies StoryBibleAgentToolRepositoryPort;
    const changeSets = changeSetHarness(GROUP_ID);
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession({
        createOperationId: () => `op_${"7".repeat(32)}`
      }),
      chapterCatalog: { listChapters }
    });
    const suggestion = createSuggestion();

    const result = await preparation.prepareChangeSet(applicationInput([suggestion]));

    expect(result).toMatchObject({ ok: true });
    expect(prepareCreateStoryAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "world.location",
        value: suggestion.createValue,
        reservedAssetId: LOCATION_ID,
        additionalKnownAssetIds: [LOCATION_ID],
        deferProjectRelationPairValidation: true,
        knownChapterIds: ["ch_02", "ch_01"]
      })
    );
    expect(listChapters).toHaveBeenCalledTimes(1);
    expect(changeSets.proposeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: `analysis_${suggestion.suggestionId}`,
        operation: expect.objectContaining({
          kind: "create_file",
          relativePath: `world/${LOCATION_ID}.json`,
          consistencyGroupId: GROUP_ID
        })
      })
    );
  });

  test("passes same-group timeline events as typed temporary reference targets", async () => {
    const character = characterAsset();
    const timeline = timelineAsset();
    const assets = new Map([
      [character.id, character],
      [timeline.id, timeline]
    ]);
    const prepareStoryAssetCandidateReadOnly = vi.fn(
      async (
        input: Parameters<
          StoryBibleAgentToolRepositoryPort["prepareStoryAssetCandidateReadOnly"]
        >[0]
      ) => {
        const asset = assets.get(String(input.candidate["id"]));
        if (asset === undefined) throw new Error("unexpected candidate");
        const preparedAsset = {
          ...input.candidate,
          updatedAt: NOW,
          revision: asset.revision + 1
        } as StoryBibleAgentToolAsset;
        return ok({
          asset: preparedAsset,
          current: { asset, checksum: BASE_CHECKSUM, revision: asset.revision },
          relativePath:
            asset.type === "timeline.events"
              ? "timeline/events.json"
              : `characters/${asset.id}.json`,
          content: serialize(preparedAsset),
          baseContent: serialize(asset),
          baseRevision: asset.revision,
          baseChecksum: BASE_CHECKSUM
        });
      }
    );
    const repository = {
      readCompatibleStoryAsset: vi.fn(async (assetId: string) => {
        const asset = assets.get(assetId);
        if (asset === undefined) throw new Error("unexpected asset");
        return ok({ asset, checksum: BASE_CHECKSUM, revision: asset.revision });
      }),
      prepareCreateStoryAsset: vi.fn(async () => {
        throw new Error("not used");
      }),
      prepareStoryAssetCandidateReadOnly
    } satisfies StoryBibleAgentToolRepositoryPort;
    const changeSets = changeSetHarness(GROUP_ID);
    const listChapters = vi.fn(async () =>
      ok([chapterSummary("ch_02", 2), chapterSummary("ch_01", 1)])
    );
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession(),
      chapterCatalog: { listChapters }
    });
    const stateHistory = [
      {
        stateHistoryId: `sth_${"8".repeat(32)}`,
        entryRevision: 1,
        timelineEventId: TIMELINE_EVENT_ID,
        chapterId: "ch_01",
        note: "状态变化"
      }
    ];
    const events = [
      {
        eventId: TIMELINE_EVENT_ID,
        entryRevision: 1,
        title: "第一章状态变化",
        sequence: 1,
        time: { mode: "sequence-only", label: "", uncertain: false },
        duration: null,
        summary: "状态变化",
        chapterIds: ["ch_01"],
        characterIds: [CHARACTER_ID],
        locationIds: [],
        parallelEventIds: [],
        causes: [],
        effects: [],
        stateChanges: []
      }
    ];
    const characterSuggestion: StoryChangeSuggestion = {
      ...suggestionBase(`sug_${"d".repeat(32)}`, GROUP_ID),
      action: "patch",
      target: { assetId: CHARACTER_ID, baseRevision: 1, entryRef: null },
      proposedAssetType: null,
      proposedAssetId: null,
      createValue: null,
      operations: [
        {
          op: "replace",
          path: "/details/stateHistory",
          beforeValueChecksum: checksumStoryBibleSelectorValue([]),
          value: stateHistory
        }
      ]
    };
    const timelineSuggestion: StoryChangeSuggestion = {
      ...suggestionBase(`sug_${"f".repeat(32)}`, GROUP_ID),
      domain: "timeline",
      action: "patch",
      target: { assetId: TIMELINE_ID, baseRevision: 1, entryRef: null },
      proposedAssetType: null,
      proposedAssetId: null,
      createValue: null,
      operations: [
        {
          op: "replace",
          path: "/details/events",
          beforeValueChecksum: checksumStoryBibleSelectorValue([]),
          value: events
        }
      ]
    };

    const result = await preparation.prepareChangeSet(
      applicationInput([characterSuggestion, timelineSuggestion])
    );

    expect(result).toMatchObject({ ok: true });
    expect(prepareStoryAssetCandidateReadOnly).toHaveBeenCalledTimes(2);
    for (const [input] of prepareStoryAssetCandidateReadOnly.mock.calls) {
      expect(input.additionalKnownReferenceTargets).toEqual([
        { targetId: TIMELINE_EVENT_ID, targetType: "timeline.event" }
      ]);
      expect(input.knownChapterIds).toEqual(["ch_02", "ch_01"]);
      expect(input.deferProjectRelationPairValidation).toBe(true);
    }
    expect(listChapters).toHaveBeenCalledTimes(1);
  });

  test("rejects independently selectable groups that target the same asset", async () => {
    const asset = characterAsset();
    const repository = repositoryHarness(asset);
    const changeSets = changeSetHarness(GROUP_ID);
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository: repository.port,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession()
    });
    const suggestions = [
      patchSuggestion({
        suggestionId: `sug_${"8".repeat(32)}`,
        consistencyGroupId: `cgrp_${"8".repeat(32)}`,
        path: "/summary",
        before: asset.summary,
        value: "摘要"
      }),
      patchSuggestion({
        suggestionId: `sug_${"9".repeat(32)}`,
        consistencyGroupId: `cgrp_${"9".repeat(32)}`,
        path: "/details/currentState/emotional",
        before: "",
        value: "平静"
      })
    ];

    const result = await preparation.prepareChangeSet(applicationInput(suggestions));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_TARGET_GROUP_CONFLICT" }
    });
    expect(repository.readCompatibleStoryAsset).not.toHaveBeenCalled();
    expect(changeSets.proposeStoryBibleWrite).not.toHaveBeenCalled();
  });

  test("rejects a patch when its field-level before checksum no longer matches", async () => {
    const asset = characterAsset();
    const repository = repositoryHarness(asset);
    const changeSets = changeSetHarness(GROUP_ID);
    const preparation = createStoryAnalysisChangeSetPreparationPort({
      projectId: "project-01",
      repository: repository.port,
      changeSets: changeSets.port,
      fileOperations: createAgentFileOperationSession()
    });
    const suggestion = patchSuggestion({
      suggestionId: `sug_${"a".repeat(32)}`,
      path: "/summary",
      before: "分析时已不是当前值",
      value: "新摘要"
    });

    const result = await preparation.prepareChangeSet(applicationInput([suggestion]));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_PATCH_BASE_CONFLICT" }
    });
    expect(repository.prepareStoryAssetCandidateReadOnly).not.toHaveBeenCalled();
    expect(changeSets.proposeStoryBibleWrite).not.toHaveBeenCalled();
  });
});

function repositoryHarness(
  asset: StoryBibleAgentToolAsset,
  options: { readonly currentRelativePath?: string } = {}
) {
  const prepareStoryAssetCandidateReadOnly = vi.fn(
    async (input: {
      readonly candidate: JsonObject;
      readonly baseRevision: number;
      readonly baseChecksum?: string;
      readonly additionalKnownAssetIds?: readonly string[];
    }) => {
      const preparedAsset = {
        ...input.candidate,
        updatedAt: NOW,
        revision: asset.revision + 1
      } as StoryBibleAgentToolAsset;
      return ok({
        asset: preparedAsset,
        current: { asset, checksum: BASE_CHECKSUM, revision: asset.revision },
        relativePath: `characters/${asset.id}.json`,
        ...(options.currentRelativePath === undefined
          ? {}
          : { currentRelativePath: options.currentRelativePath }),
        content: serialize(preparedAsset),
        baseContent: serialize(asset),
        baseRevision: asset.revision,
        baseChecksum: BASE_CHECKSUM
      });
    }
  );
  const readCompatibleStoryAsset = vi.fn(async () =>
    ok({
      asset,
      checksum: BASE_CHECKSUM,
      revision: asset.revision
    })
  );
  const port = {
    readCompatibleStoryAsset,
    prepareCreateStoryAsset: vi.fn(async () => {
      throw new Error("not used");
    }),
    prepareStoryAssetCandidateReadOnly
  } satisfies StoryBibleAgentToolRepositoryPort;
  return { port, readCompatibleStoryAsset, prepareStoryAssetCandidateReadOnly };
}

function changeSetHarness(consistencyGroupId: string) {
  const value = changeSet(consistencyGroupId);
  const proposeOperation = vi.fn(async (input: unknown) => {
    void input;
    return ok(value);
  });
  const proposeOperationBatch = vi.fn(async (input: unknown) => {
    void input;
    return ok(value);
  });
  const proposeStoryBibleWrite = vi.fn(async (input: unknown) => {
    void input;
    return ok(value);
  });
  const readLatestChangeSet = vi.fn(
    async (input: unknown): Promise<Result<ChangeSet | undefined, UnifiedError>> => {
      void input;
      return ok(undefined);
    }
  );
  return {
    port: { proposeOperation, proposeOperationBatch, proposeStoryBibleWrite, readLatestChangeSet },
    proposeOperation,
    proposeOperationBatch,
    proposeStoryBibleWrite,
    readLatestChangeSet
  };
}

function applicationInput(suggestions: readonly StoryChangeSuggestion[]) {
  return {
    workflowRunId: WORKFLOW_RUN_ID,
    analysisRunId: ANALYSIS_RUN_ID,
    contextSnapshotId: CONTEXT_SNAPSHOT_ID,
    suggestions
  };
}

function patchSuggestion(input: {
  readonly suggestionId: string;
  readonly path: string;
  readonly before: string;
  readonly value: string;
  readonly consistencyGroupId?: string;
}): StoryChangeSuggestion {
  return {
    ...suggestionBase(input.suggestionId, input.consistencyGroupId ?? GROUP_ID),
    action: "patch",
    target: { assetId: CHARACTER_ID, baseRevision: 1, entryRef: null },
    proposedAssetType: null,
    proposedAssetId: null,
    createValue: null,
    operations: [
      {
        op: "replace",
        path: input.path,
        beforeValueChecksum: checksumStoryBibleSelectorValue(input.before),
        value: input.value
      }
    ]
  };
}

function createSuggestion(): StoryChangeSuggestion {
  const suggestionId = `sug_${"b".repeat(32)}`;
  return {
    ...suggestionBase(suggestionId, GROUP_ID),
    action: "create",
    target: null,
    proposedAssetType: "world.location",
    proposedAssetId: LOCATION_ID,
    createValue: { title: "北站" },
    operations: []
  };
}

function suggestionBase(suggestionId: string, consistencyGroupId: string) {
  return {
    schemaVersion: "1.1" as const,
    deltaId: `dlt_${suggestionId.slice(4)}`,
    suggestionId,
    recordType: "change" as const,
    status: "accepted" as const,
    revision: 2,
    createdAt: NOW,
    updatedAt: NOW,
    analysisRunId: ANALYSIS_RUN_ID,
    observationIds: [`obs_${"c".repeat(32)}`],
    chapter: { chapterId: "ch_01", checksum: "d".repeat(64) },
    domain: "character.location" as const,
    dependencies: [],
    consistencyGroupId,
    evidence: [],
    epistemicStatus: "narrator_asserted" as const,
    confidence: 0.99,
    reason: "test",
    idempotencyKey: "e".repeat(64)
  };
}

function characterAsset(): StoryBibleAgentToolAsset {
  return {
    schemaVersion: "1.1",
    id: CHARACTER_ID,
    type: "character",
    title: "林默",
    status: "active",
    summary: "旧摘要",
    aliases: [],
    relations: [],
    details: {
      currentState: {
        locationId: null,
        physical: "",
        emotional: "",
        heldItemIds: [],
        asOfChapterId: null,
        asOfEventId: null
      },
      knowledgeStates: [],
      stateHistory: []
    },
    extensions: {},
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1
  };
}

function locationAsset(): StoryBibleAgentToolAsset {
  return {
    schemaVersion: "1.1",
    id: LOCATION_ID,
    type: "world.location",
    title: "北站",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: {},
    extensions: {},
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1
  };
}

function timelineAsset(): StoryBibleAgentToolAsset {
  return {
    schemaVersion: "1.1",
    id: TIMELINE_ID,
    type: "timeline.events",
    title: "时间线",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: { events: [] },
    extensions: {},
    createdAt: NOW,
    updatedAt: NOW,
    revision: 1
  };
}

function changeSet(consistencyGroupId: string): ChangeSet {
  return {
    schemaVersion: "1.1",
    changeSetId: `change_set_${"f".repeat(32)}`,
    revision: 1,
    runId: WORKFLOW_RUN_ID,
    projectId: "project-01",
    checkpointId: `checkpoint_${"1".repeat(32)}`,
    contextSnapshotId: CONTEXT_SNAPSHOT_ID,
    writePolicy: "write_before_confirmation",
    status: "awaiting_approval",
    checksum: "1".repeat(64),
    approvalToken: "2".repeat(64),
    files: [
      {
        relativePath: `characters/${CHARACTER_ID}.json`,
        assetType: "text",
        assetId: CHARACTER_ID,
        baseChecksum: "3".repeat(64),
        candidateChecksum: "4".repeat(64),
        baseContent: "{}",
        candidateContent: "{}",
        hunks: [],
        validation: {
          valid: true,
          utf8: { status: "valid" },
          syntax: { status: "not_applicable" },
          schema: { status: "valid" },
          asset: { status: "valid" }
        },
        selected: true,
        consistencyGroupId
      }
    ],
    createdAt: NOW
  };
}

function serialize(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function chapterSummary(id: string, order: number): ChapterSummary {
  return {
    id,
    title: id,
    order,
    status: "draft",
    updatedAt: NOW
  };
}
