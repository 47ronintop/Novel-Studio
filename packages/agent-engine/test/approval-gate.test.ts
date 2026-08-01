import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  appendChangeSetProposal,
  createChangeSetRevision,
  decideChangeSetApproval,
  selectChangeSetRevision,
  type ChangeSet
} from "../src/index.js";

describe("Change Set approval gate", () => {
  test("approves only a human-confirmed exact revision and checksum binding", async () => {
    const changeSet = await validChangeSet();
    const result = decideChangeSetApproval({
      changeSet,
      decision: "apply_selected",
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      resolvedAt: "2026-07-13T02:00:00.000Z"
    });

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: "1.0",
        decision: "apply_selected",
        approvalSource: "human_confirmation",
        resolvedAt: "2026-07-13T02:00:00.000Z",
        binding: {
          changeSetId: changeSet.changeSetId,
          revision: changeSet.revision,
          checksum: changeSet.checksum,
          approvalToken: changeSet.approvalToken
        }
      }
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  test.each([
    ["changeSetId", "other-change-set"],
    ["revision", 99],
    ["checksum", "0".repeat(64)]
  ])("rejects a mismatched %s", async (field, value) => {
    const changeSet = await validChangeSet();
    const result = decideChangeSetApproval({
      changeSet,
      decision: "apply_selected",
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      resolvedAt: "2026-07-13T02:00:00.000Z",
      [field]: value
    });

    expect(result).toMatchObject({ ok: false, error: { code: "CHANGE_SET_BINDING_MISMATCH" } });
  });

  test("does not let a public gate caller mint an automatic approval source", async () => {
    const changeSet = await validChangeSet();
    const result = decideChangeSetApproval({
      changeSet,
      writePolicy: "user_preapproved_run",
      approvalSource: "user_preapproved_run",
      decision: "apply_selected",
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      resolvedAt: "2026-07-13T02:00:00.000Z"
    } as never);

    expect(result).toMatchObject({
      ok: true,
      value: {
        decision: "apply_selected",
        approvalSource: "human_confirmation",
        binding: {
          changeSetId: changeSet.changeSetId,
          revision: changeSet.revision,
          checksum: changeSet.checksum,
          approvalToken: changeSet.approvalToken
        }
      }
    });
  });

  test("blocks invalid or empty selections but permits rejecting them", async () => {
    const baseContent = '{"value":"old"}';
    const invalid = await createChangeSetRevision({
      changeSetId: "change-set-invalid",
      runId: "run-01",
      projectId: "project-01",
      checkpointId: "checkpoint-01",
      contextSnapshotId: "context-01",
      createdAt: "2026-07-13T01:00:00.000Z",
      proposal: {
        relativePath: "notes/data.json",
        assetType: "text",
        baseContent,
        baseChecksum: sha256(baseContent),
        range: { unit: "character", start: 0, end: 1 },
        replacement: "["
      }
    });
    expect(decide(invalid, "apply_selected")).toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_INVALID" }
    });

    const empty = await selectChangeSetRevision(await validChangeSet(), {
      createdAt: "2026-07-13T02:00:00.000Z",
      files: [{ relativePath: "notes/outline.md", selected: false }]
    });
    expect(decide(empty, "apply_selected")).toMatchObject({
      ok: false,
      error: { code: "CHANGE_SET_EMPTY_SELECTION" }
    });
    expect(decide(empty, "reject_all")).toMatchObject({
      ok: true,
      value: { decision: "reject_all", approvalSource: "human_confirmation" }
    });
  });

  test("approves an operation-only Change Set when a lifecycle operation is selected", async () => {
    const base = await validChangeSet();
    const operationOnly: ChangeSet = {
      ...base,
      schemaVersion: "1.1",
      files: [],
      operationsSchemaVersion: "1.1",
      operations: [
        {
          kind: "create_directory",
          operationId: "op-create-assets",
          relativePath: "assets",
          toolCallIdempotencyKey: "tool-create-assets",
          selected: true
        }
      ]
    };

    expect(decide(operationOnly, "apply_selected")).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        decision: "apply_selected",
        approvalSource: "human_confirmation"
      }
    });
  });

  test("keeps a status-proof Change Set approval on protocol 1.1", async () => {
    const baseContent = '{"status":"active"}';
    const changeSet = await createChangeSetRevision({
      changeSetId: "change-set-status-proof",
      runId: "run-01",
      projectId: "project-01",
      checkpointId: "checkpoint-01",
      contextSnapshotId: "context-01",
      createdAt: "2026-08-01T00:00:00.000Z",
      proposal: {
        relativePath: `characters/chr_${"a".repeat(32)}.json`,
        assetType: "text",
        assetId: `chr_${"a".repeat(32)}`,
        baseContent,
        baseChecksum: sha256(baseContent),
        range: { unit: "character", start: 0, end: baseContent.length },
        replacement: '{"status":"deleted"}',
        storyBibleStatusProof: {
          action: "delete",
          deletionImpactChecksum: "b".repeat(64)
        }
      }
    });

    expect(changeSet.schemaVersion).toBe("1.1");
    expect(decide(changeSet, "apply_selected")).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        binding: {
          checksum: changeSet.checksum,
          approvalToken: changeSet.approvalToken
        }
      }
    });
  });

  test("binds selected consistency groups and their checksum into approval", async () => {
    const base = await createChangeSetRevision({
      changeSetId: "change-set-grouped",
      runId: "run-01",
      projectId: "project-01",
      checkpointId: "checkpoint-01",
      contextSnapshotId: "context-01",
      createdAt: "2026-07-13T01:00:00.000Z",
      proposal: {
        relativePath: "characters/hero.json",
        assetType: "text",
        assetId: "chr_hero",
        baseContent: "{}",
        baseChecksum: sha256("{}"),
        range: { unit: "character", start: 0, end: 2 },
        replacement: '{"location":"dock"}',
        consistencyGroupId: "fact_location_01"
      }
    });
    const grouped = await appendChangeSetProposal(base, {
      createdAt: "2026-07-13T01:01:00.000Z",
      proposal: {
        relativePath: "timeline/main.json",
        assetType: "text",
        assetId: "timeline_main",
        baseContent: "{}",
        baseChecksum: sha256("{}"),
        range: { unit: "character", start: 0, end: 2 },
        replacement: '{"event":"arrival"}',
        consistencyGroupId: "fact_location_01"
      }
    });

    const result = decide(grouped, "apply_selected");

    expect(result).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "1.1",
        binding: {
          selectedConsistencyGroupIds: ["fact_location_01"],
          selectionChecksum: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      }
    });
  });
});

async function validChangeSet(): Promise<ChangeSet> {
  const baseContent = "Old\nSecond";
  return createChangeSetRevision({
    changeSetId: "change-set-01",
    runId: "run-01",
    projectId: "project-01",
    checkpointId: "checkpoint-01",
    contextSnapshotId: "context-01",
    createdAt: "2026-07-13T01:00:00.000Z",
    proposal: {
      relativePath: "notes/outline.md",
      assetType: "text",
      baseContent,
      baseChecksum: sha256(baseContent),
      range: { unit: "line", start: 0, end: 1 },
      replacement: "New"
    }
  });
}

function decide(changeSet: ChangeSet, decision: "apply_selected" | "reject_all") {
  return decideChangeSetApproval({
    changeSet,
    decision,
    changeSetId: changeSet.changeSetId,
    revision: changeSet.revision,
    checksum: changeSet.checksum,
    resolvedAt: "2026-07-13T02:00:00.000Z"
  });
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
