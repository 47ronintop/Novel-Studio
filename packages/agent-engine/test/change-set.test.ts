import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import {
  appendChangeSetProposal,
  createChangeSetRevision,
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
        "title = \"old\"\n",
        0,
        "title = \"old\"\n".length,
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
        "title = \"old\"\n",
        0,
        "title = \"old\"\n".length,
        "title = \"new\"\n"
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
