import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
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
    const result = decideChangeSetApproval(
      {
        changeSet,
        writePolicy: "user_preapproved_run",
        approvalSource: "user_preapproved_run",
        decision: "apply_selected",
        changeSetId: changeSet.changeSetId,
        revision: changeSet.revision,
        checksum: changeSet.checksum,
        resolvedAt: "2026-07-13T02:00:00.000Z"
      } as never
    );

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
