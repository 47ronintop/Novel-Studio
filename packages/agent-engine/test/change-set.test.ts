import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  appendChangeSetProposal,
  appendChangeSetOperation,
  createDirectoryOperation,
  createChangeSetRevision,
  createFileOperation,
  createOperationsChangeSetRevision,
  deleteFileOperation,
  moveFileOperation,
  preflightChangeSetOperations,
  selectChangeSetRevision,
  type ChangeSetProposal
} from "../src/index.js";

const baseBinding = {
  changeSetId: "change-set-01",
  runId: "run-01",
  projectId: "project-01",
  checkpointId: "checkpoint-01",
  contextSnapshotId: "context-01",
  createdAt: "2026-07-13T01:00:00.000Z"
};

describe("immutable Change Set revisions", () => {
  test("creates an all-selected chapter paragraph proposal without mutating its base", async () => {
    const baseContent = "Opening.\n\nOld middle.\n\nEnding.";
    const validateCandidate = vi.fn(async () => ({
      schema: { status: "valid" as const },
      asset: { status: "valid" as const }
    }));

    const changeSet = await createChangeSetRevision(
      {
        ...baseBinding,
        proposal: {
          relativePath: "chapters/chapter-03.md",
          assetType: "chapter",
          assetId: "chapter-03",
          baseContent,
          baseChecksum: sha256(baseContent),
          range: { unit: "paragraph", start: 1, end: 2 },
          replacement: "New middle."
        }
      },
      { createHunkId: () => "hunk-01", validateCandidate }
    );

    expect(baseContent).toBe("Opening.\n\nOld middle.\n\nEnding.");
    expect(changeSet).toMatchObject({
      ...baseBinding,
      schemaVersion: "1.0",
      revision: 1,
      status: "awaiting_approval",
      files: [
        {
          relativePath: "chapters/chapter-03.md",
          assetType: "chapter",
          assetId: "chapter-03",
          baseContent,
          baseChecksum: sha256(baseContent),
          candidateContent: "Opening.\n\nNew middle.\n\nEnding.",
          candidateChecksum: sha256("Opening.\n\nNew middle.\n\nEnding."),
          selected: true,
          validation: { valid: true },
          hunks: [
            {
              hunkId: "hunk-01",
              selected: true,
              range: { unit: "paragraph", start: 1, end: 2 },
              baseContent: "Old middle.",
              replacement: "New middle."
            }
          ]
        }
      ]
    });
    expect(changeSet.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(changeSet.approvalToken).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(changeSet)).toBe(true);
    expect(Object.isFrozen(changeSet.files)).toBe(true);
    expect(Object.isFrozen(changeSet.files[0])).toBe(true);
    expect(Object.isFrozen(changeSet.files[0]?.hunks[0])).toBe(true);
    expect(validateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: "chapters/chapter-03.md",
        candidateContent: "Opening.\n\nNew middle.\n\nEnding."
      })
    );
  });

  test("merges repeated proposals into a new revision and leaves the shown revision unchanged", async () => {
    const baseContent = "One\nTwo\nThree";
    const first = await createChangeSetRevision(
      {
        ...baseBinding,
        proposal: fileProposal(baseContent, 0, 1, "First")
      },
      { createHunkId: () => "hunk-01" }
    );

    const revised = await appendChangeSetProposal(
      first,
      {
        proposal: fileProposal(baseContent, 2, 3, "Third"),
        createdAt: "2026-07-13T01:01:00.000Z"
      },
      { createHunkId: () => "hunk-02" }
    );

    expect(first).toMatchObject({
      revision: 1,
      files: [{ candidateContent: "First\nTwo\nThree", hunks: [{ hunkId: "hunk-01" }] }]
    });
    expect(revised).toMatchObject({
      revision: 2,
      createdAt: "2026-07-13T01:01:00.000Z",
      files: [
        {
          candidateContent: "First\nTwo\nThird",
          hunks: [
            { hunkId: "hunk-01", selected: true },
            { hunkId: "hunk-02", selected: true }
          ]
        }
      ]
    });
    expect(revised.checksum).not.toBe(first.checksum);
    expect(revised.approvalToken).not.toBe(first.approvalToken);
  });

  test("partial hunk selection creates a new revision and reruns syntax validation", async () => {
    const baseContent = '{"value":"old"}';
    const first = await createChangeSetRevision(
      {
        ...baseBinding,
        proposal: characterProposal("notes/data.json", baseContent, 0, 9, '["value",')
      },
      { createHunkId: () => "open-array" }
    );
    const complete = await appendChangeSetProposal(
      first,
      {
        proposal: characterProposal(
          "notes/data.json",
          baseContent,
          baseContent.length - 1,
          baseContent.length,
          "]"
        ),
        createdAt: "2026-07-13T01:01:00.000Z"
      },
      { createHunkId: () => "close-array" }
    );
    expect(complete.files[0]?.validation).toMatchObject({
      valid: true,
      syntax: { status: "valid" }
    });

    const partiallySelected = await selectChangeSetRevision(complete, {
      createdAt: "2026-07-13T01:02:00.000Z",
      files: [
        {
          relativePath: "notes/data.json",
          selected: true,
          selectedHunkIds: ["open-array"]
        }
      ]
    });

    expect(partiallySelected).toMatchObject({
      revision: 3,
      files: [
        {
          candidateContent: '["value","old"}',
          selected: true,
          validation: { valid: false, syntax: { status: "invalid" } },
          hunks: [
            { hunkId: "open-array", selected: true },
            { hunkId: "close-array", selected: false }
          ]
        }
      ]
    });
    expect(partiallySelected.checksum).not.toBe(complete.checksum);
    expect(complete.files[0]?.candidateContent).toBe('["value","old"]');
  });

  test("rejects stale bases, unsupported paths, invalid ranges, and malformed Unicode", async () => {
    const baseContent = "alpha";

    await expect(
      createChangeSetRevision({
        ...baseBinding,
        proposal: {
          ...fileProposal(baseContent, 0, 1, "beta"),
          relativePath: "../outside.md"
        }
      })
    ).rejects.toMatchObject({ code: "AGENT_PATH_REJECTED" });
    await expect(
      createChangeSetRevision({
        ...baseBinding,
        proposal: {
          ...fileProposal(baseContent, 0, 1, "beta"),
          baseChecksum: sha256("stale")
        }
      })
    ).rejects.toMatchObject({ code: "CHANGE_SET_BASE_MISMATCH" });
    await expect(
      createChangeSetRevision({
        ...baseBinding,
        proposal: fileProposal(baseContent, 4, 2, "beta")
      })
    ).rejects.toMatchObject({ code: "CHANGE_SET_RANGE_INVALID" });

    const malformed = await createChangeSetRevision({
      ...baseBinding,
      proposal: fileProposal(baseContent, 0, 1, String.fromCharCode(0xd800))
    });
    expect(malformed.files[0]?.validation).toMatchObject({
      valid: false,
      utf8: { status: "invalid" }
    });
  });

  test("validates YAML and TOML syntax for permitted document extensions", async () => {
    const yaml = await createChangeSetRevision({
      ...baseBinding,
      proposal: characterProposal(
        "notes/settings.yaml",
        "title: old\n",
        0,
        "title: old\n".length,
        "title: [\n"
      )
    });
    expect(yaml.files[0]?.validation).toMatchObject({
      valid: false,
      syntax: { status: "invalid" }
    });

    const toml = await createChangeSetRevision({
      ...baseBinding,
      proposal: characterProposal(
        "notes/settings.toml",
        'title = "old"\n',
        0,
        'title = "old"\n'.length,
        "title = [\n"
      )
    });
    expect(toml.files[0]?.validation).toMatchObject({
      valid: false,
      syntax: { status: "invalid" }
    });
  });

  test("marks valid YAML and TOML candidates as syntactically valid", async () => {
    const yaml = await createChangeSetRevision({
      ...baseBinding,
      proposal: characterProposal(
        "notes/settings.yml",
        "title: old\n",
        0,
        "title: old\n".length,
        "title: new\n"
      )
    });
    expect(yaml.files[0]?.validation).toMatchObject({
      valid: true,
      syntax: { status: "valid" }
    });

    const toml = await createChangeSetRevision({
      ...baseBinding,
      proposal: characterProposal(
        "notes/settings.toml",
        'title = "old"\n',
        0,
        'title = "old"\n'.length,
        'title = "new"\n'
      )
    });
    expect(toml.files[0]?.validation).toMatchObject({
      valid: true,
      syntax: { status: "valid" }
    });
  });

  test("leaves ordinary text validation not applicable without an external validator", async () => {
    const text = await createChangeSetRevision({
      ...baseBinding,
      proposal: characterProposal("notes/plain.txt", "old", 0, 3, "not: [yaml")
    });

    expect(text.files[0]?.validation).toMatchObject({
      valid: true,
      syntax: { status: "not_applicable" },
      schema: { status: "not_applicable" },
      asset: { status: "not_applicable" }
    });
  });

  test("records lifecycle operation metadata in a v1.1 Change Set and binds it into approval", async () => {
    const created = createOperationsChangeSetRevision({
      ...baseBinding,
      writePolicy: "user_preapproved_run",
      operation: createFileOperation({
        operationId: "create-outline",
        relativePath: "notes/outline.md",
        content: "New outline",
        toolCallIdempotencyKey: "tool-call-01"
      })
    });

    expect(created).toMatchObject({
      schemaVersion: "1.1",
      operationsSchemaVersion: "1.1",
      writePolicy: "user_preapproved_run",
      files: [],
      operations: [
        {
          operationId: "create-outline",
          kind: "create_file",
          relativePath: "notes/outline.md",
          content: "New outline",
          toolCallIdempotencyKey: "tool-call-01",
          selected: true
        }
      ]
    });
    expect(Object.isFrozen(created.operations?.[0])).toBe(true);

    const changedContent = createOperationsChangeSetRevision({
      ...baseBinding,
      operation: createFileOperation({
        operationId: "create-outline",
        relativePath: "notes/outline.md",
        content: "Changed outline",
        toolCallIdempotencyKey: "tool-call-01"
      })
    });
    expect(changedContent.approvalToken).not.toBe(created.approvalToken);

    const withTextProposal = await appendChangeSetProposal(created, {
      createdAt: "2026-07-13T01:01:00.000Z",
      proposal: characterProposal("notes/other.md", "old", 0, 3, "new")
    });
    expect(withTextProposal).toMatchObject({
      schemaVersion: "1.1",
      operations: [{ operationId: "create-outline" }],
      files: [{ relativePath: "notes/other.md", candidateContent: "new" }]
    });
  });

  test("forces destructive lifecycle operations to require human confirmation", () => {
    const moved = createOperationsChangeSetRevision({
      ...baseBinding,
      writePolicy: "user_preapproved_run",
      operation: moveFileOperation({
        operationId: "move-outline",
        sourcePath: "notes/outline.md",
        targetPath: "notes/outline-renamed.md",
        sourceChecksum: sha256("outline"),
        toolCallIdempotencyKey: "tool-call-02"
      })
    });
    expect(moved.writePolicy).toBe("write_before_confirmation");

    const created = createOperationsChangeSetRevision({
      ...baseBinding,
      writePolicy: "user_preapproved_run",
      operation: createFileOperation({
        operationId: "create-file",
        relativePath: "notes/new.md",
        content: "new",
        toolCallIdempotencyKey: "tool-call-03"
      })
    });
    const withDirectory = appendChangeSetOperation(created, {
      createdAt: "2026-07-13T01:01:00.000Z",
      operation: createDirectoryOperation({
        operationId: "mkdir-assets",
        relativePath: "assets",
        toolCallIdempotencyKey: "tool-call-04"
      })
    });
    expect(withDirectory.writePolicy).toBe("write_before_confirmation");
  });

  test("requires selected lifecycle operations to include their dependency closure", async () => {
    const directory = createDirectoryOperation({
      operationId: "mkdir-notes",
      relativePath: "notes",
      toolCallIdempotencyKey: "tool-call-05"
    });
    const changeSet = appendChangeSetOperation(
      createOperationsChangeSetRevision({ ...baseBinding, operation: directory }),
      {
        createdAt: "2026-07-13T01:01:00.000Z",
        operation: createFileOperation({
          operationId: "create-note",
          relativePath: "notes/new.md",
          content: "new",
          toolCallIdempotencyKey: "tool-call-06",
          dependsOn: ["mkdir-notes"]
        })
      }
    );

    await expect(
      selectChangeSetRevision(changeSet, {
        createdAt: "2026-07-13T01:02:00.000Z",
        files: [],
        operations: [
          { operationId: "mkdir-notes", selected: false },
          { operationId: "create-note", selected: true }
        ]
      })
    ).rejects.toMatchObject({ code: "CHANGE_SET_SELECTION_DEPENDENCY_MISSING" });

    const selected = await selectChangeSetRevision(changeSet, {
      createdAt: "2026-07-13T01:02:00.000Z",
      files: [],
      operations: [
        { operationId: "mkdir-notes", selected: true },
        { operationId: "create-note", selected: true }
      ]
    });
    expect(selected.operations?.every((operation) => operation.selected)).toBe(true);
  });

  test("rejects complete move source and target conflicts before a Change Set is created", () => {
    const firstMove = moveFileOperation({
      operationId: "move-a-b",
      sourcePath: "notes/a.md",
      targetPath: "notes/b.md",
      sourceChecksum: sha256("a"),
      toolCallIdempotencyKey: "tool-call-07"
    });
    const swapMove = moveFileOperation({
      operationId: "move-b-a",
      sourcePath: "notes/b.md",
      targetPath: "notes/a.md",
      sourceChecksum: sha256("b"),
      toolCallIdempotencyKey: "tool-call-08",
      dependsOn: ["move-a-b"]
    });
    expect(preflightChangeSetOperations([firstMove, swapMove])).toMatchObject({ ok: false });

    const sameTarget = moveFileOperation({
      operationId: "move-c-b",
      sourcePath: "notes/c.md",
      targetPath: "notes/b.md",
      sourceChecksum: sha256("c"),
      toolCallIdempotencyKey: "tool-call-09"
    });
    expect(preflightChangeSetOperations([firstMove, sameTarget])).toMatchObject({ ok: false });

    const deletion = deleteFileOperation({
      operationId: "delete-a",
      relativePath: "notes/a.md",
      baseChecksum: sha256("a"),
      toolCallIdempotencyKey: "tool-call-10"
    });
    expect(preflightChangeSetOperations([firstMove, deletion])).toMatchObject({ ok: false });
  });
});

function fileProposal(
  baseContent: string,
  start: number,
  end: number,
  replacement: string
): ChangeSetProposal {
  return {
    relativePath: "notes/outline.md",
    assetType: "text",
    baseContent,
    baseChecksum: sha256(baseContent),
    range: { unit: "line", start, end },
    replacement
  };
}

function characterProposal(
  relativePath: string,
  baseContent: string,
  start: number,
  end: number,
  replacement: string
): ChangeSetProposal {
  return {
    relativePath,
    assetType: "text",
    baseContent,
    baseChecksum: sha256(baseContent),
    range: { unit: "character", start, end },
    replacement
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
