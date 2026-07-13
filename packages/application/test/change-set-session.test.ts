import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import type { ChangeSet } from "@novel-studio/agent-engine";
import type { Result, UnifiedError } from "@novel-studio/shared";

import {
  createChangeSetSession,
  type ChangeSetCandidateValidationPortInput,
  type ChangeSetSessionPort
} from "../src/change-set-session.js";

describe("Change Set application session", () => {
  test("proposes chapter and file writes through read-only ports without touching target bytes", async () => {
    const chapterBytes = "First.\n\nOld middle.\n\nLast.";
    const fileBytes = "alpha\nbeta";
    const persisted: ChangeSet[] = [];
    const session = createChangeSetSession({
      port: targetPort({
        chapter: () => chapterBytes,
        file: () => fileBytes,
        persisted
      }),
      createChangeSetId: () => "change-set-01",
      createHunkId: sequence("chapter-hunk", "file-hunk"),
      now: sequence("2026-07-13T03:00:00.000Z", "2026-07-13T03:01:00.000Z")
    });

    const chapter = await session.proposeChapterWrite({
      ...proposalBinding(),
      chapterId: "chapter-03",
      range: { unit: "paragraph", start: 1, end: 2 },
      baseHash: sha256(chapterBytes),
      replacement: "New middle."
    });
    const file = await session.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "line", start: 1, end: 2 },
      baseHash: sha256(fileBytes),
      replacement: "gamma"
    });

    expect(chapter).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        contextSnapshotId: "context-01",
        checkpointId: "checkpoint-01",
        files: [
          {
            relativePath: "chapters/chapter-03.md",
            candidateContent: "First.\n\nNew middle.\n\nLast."
          }
        ]
      }
    });
    expect(file).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        files: [
          { relativePath: "chapters/chapter-03.md" },
          { relativePath: "notes/outline.md", candidateContent: "alpha\ngamma" }
        ]
      }
    });
    expect(chapterBytes).toBe("First.\n\nOld middle.\n\nLast.");
    expect(fileBytes).toBe("alpha\nbeta");
    expect(persisted.map((item) => item.revision)).toEqual([1, 2]);
  });

  test.each([
    ["absolute path", "C:/outside.md", false, true, sha256("alpha"), "AGENT_PATH_REJECTED"],
    ["dirty target", "notes/outline.md", true, true, sha256("alpha"), "CHANGE_SET_DIRTY_TARGET"],
    [
      "unsupported target",
      "notes/outline.md",
      false,
      false,
      sha256("alpha"),
      "CHANGE_SET_UNSUPPORTED_TARGET"
    ],
    ["stale base", "notes/outline.md", false, true, sha256("stale"), "CHANGE_SET_BASE_MISMATCH"]
  ])(
    "rejects %s before staging a candidate",
    async (_name, path, dirty, supported, baseHash, code) => {
      const readFileTarget = vi.fn(async () => ({
        ok: true as const,
        value: {
          relativePath: "notes/outline.md",
          assetType: "text" as const,
          content: "alpha",
          checksum: sha256("alpha"),
          dirty,
          supported
        }
      }));
      const persistChangeSet = vi.fn(async (changeSet: ChangeSet) => ({
        ok: true as const,
        value: changeSet
      }));
      const session = createChangeSetSession({
        port: {
          readChapterTarget: vi.fn(async () => {
            throw new Error("not expected");
          }),
          readFileTarget,
          validateCandidate: async () => ({ ok: true, value: {} }),
          persistChangeSet
        }
      });

      const result = await session.proposeFileWrite({
        ...proposalBinding(),
        path,
        range: { unit: "character", start: 0, end: 1 },
        baseHash,
        replacement: "A"
      });

      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(persistChangeSet).not.toHaveBeenCalled();
      if (path === "C:/outside.md") expect(readFileTarget).not.toHaveBeenCalled();
    }
  );

  test("rejects an unsafe chapter id before reading any target", async () => {
    const readChapterTarget = vi.fn(async () => {
      throw new Error("unsafe chapter ids must not reach the repository");
    });
    const session = createChangeSetSession({
      port: {
        readChapterTarget,
        async readFileTarget() {
          throw new Error("unused");
        },
        async validateCandidate() {
          return { ok: true, value: {} } as const;
        },
        async persistChangeSet(changeSet) {
          return { ok: true, value: changeSet } as const;
        }
      }
    });

    const result = await session.proposeChapterWrite({
      ...proposalBinding(),
      chapterId: "../../outside",
      range: { unit: "character", start: 0, end: 1 },
      baseHash: sha256("outside"),
      replacement: "x"
    });

    expect(result).toMatchObject({ ok: false, error: { code: "CHANGE_SET_TARGET_INVALID" } });
    expect(readChapterTarget).not.toHaveBeenCalled();
  });

  test("creates immutable revisions for repeated proposals and selection, then reads old revisions", async () => {
    const persisted: ChangeSet[] = [];
    const validateCandidate = vi.fn(
      async ({ candidateContent }: ChangeSetCandidateValidationPortInput) => {
        const invalid = candidateContent.includes("forbidden");
        return {
          ok: true as const,
          value: {
            asset: invalid
              ? { status: "invalid" as const, message: "asset rule" }
              : { status: "valid" as const }
          }
        };
      }
    );
    const session = createChangeSetSession({
      port: {
        ...targetPort({ chapter: () => "unused", file: () => "one\ntwo\nthree", persisted }),
        validateCandidate
      },
      createChangeSetId: () => "change-set-01",
      createHunkId: sequence("hunk-01", "hunk-02"),
      now: sequence(
        "2026-07-13T03:00:00.000Z",
        "2026-07-13T03:01:00.000Z",
        "2026-07-13T03:02:00.000Z"
      )
    });
    const first = await session.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "line", start: 0, end: 1 },
      baseHash: sha256("one\ntwo\nthree"),
      replacement: "ONE"
    });
    const second = await session.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "line", start: 2, end: 3 },
      baseHash: sha256("one\ntwo\nthree"),
      replacement: "THREE"
    });
    const selected = await session.selectRevision({
      runId: "run-01",
      projectId: "project-01",
      changeSetId: "change-set-01",
      revision: 2,
      files: [
        {
          relativePath: "notes/outline.md",
          selected: true,
          selectedHunkIds: ["hunk-02"]
        }
      ]
    });

    const firstValue = expectOk(first);
    const secondValue = expectOk(second);
    const selectedValue = expectOk(selected);
    expect(firstValue).toMatchObject({
      revision: 1,
      files: [{ candidateContent: "ONE\ntwo\nthree" }]
    });
    expect(secondValue).toMatchObject({
      revision: 2,
      files: [{ candidateContent: "ONE\ntwo\nTHREE" }]
    });
    expect(selectedValue).toMatchObject({
      revision: 3,
      files: [{ candidateContent: "one\ntwo\nTHREE" }]
    });
    expect(expectOk(await session.readChangeSet("change-set-01", 1))).toEqual(firstValue);
    expect(expectOk(await session.readChangeSet("change-set-01"))).toEqual(selectedValue);
    expect(validateCandidate).toHaveBeenCalledTimes(3);
    expect(persisted.map((item) => item.revision)).toEqual([1, 2, 3]);
  });

  test("decides only the persisted exact revision and never exposes an apply method", async () => {
    const persisted: ChangeSet[] = [];
    const session = createChangeSetSession({
      port: targetPort({ chapter: () => "unused", file: () => "alpha", persisted }),
      createChangeSetId: () => "change-set-01",
      createHunkId: () => "hunk-01",
      now: sequence("2026-07-13T03:00:00.000Z", "2026-07-13T03:01:00.000Z")
    });
    const proposed = await session.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "character", start: 0, end: 5 },
      baseHash: sha256("alpha"),
      replacement: "beta"
    });
    const proposedValue = expectOk(proposed);
    const command = {
      runId: "run-01",
      projectId: "project-01",
      commandId: "decision-01",
      expectedRunRevision: 5,
      changeSetId: "change-set-01",
      revision: 1,
      checksum: proposedValue.checksum,
      decision: "apply_selected" as const
    };

    const first = await session.decide(command);
    const duplicate = await session.decide(command);
    const mismatch = await session.decide({
      ...command,
      commandId: "decision-02",
      checksum: "0".repeat(64)
    });

    expect(first).toMatchObject({
      ok: true,
      value: {
        decision: "apply_selected",
        binding: { changeSetId: "change-set-01", revision: 1, checksum: proposedValue.checksum }
      }
    });
    expect(duplicate).toEqual(first);
    expect(mismatch).toMatchObject({ ok: false, error: { code: "CHANGE_SET_BINDING_MISMATCH" } });
    const surface = session as unknown as Record<string, unknown>;
    expect(surface["apply"]).toBeUndefined();
    expect(surface["applyChangeSet"]).toBeUndefined();
  });

  test("continues the latest checkpoint revision after the application session is recreated", async () => {
    const persisted: ChangeSet[] = [];
    const basePort = targetPort({
      chapter: () => "unused",
      file: () => "one\ntwo",
      persisted
    });
    const port = {
      ...basePort,
      async readLatestChangeSet() {
        return { ok: true as const, value: persisted.at(-1) };
      }
    };
    const firstSession = createChangeSetSession({
      port,
      createChangeSetId: () => "change-set-persisted",
      createHunkId: () => "hunk-01",
      now: () => "2026-07-13T03:00:00.000Z"
    });
    const first = await firstSession.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "line", start: 0, end: 1 },
      baseHash: sha256("one\ntwo"),
      replacement: "ONE"
    });
    expect(expectOk(first)).toMatchObject({ changeSetId: "change-set-persisted", revision: 1 });

    const restoredSession = createChangeSetSession({
      port,
      createChangeSetId: () => "must-not-create-a-new-change-set",
      createHunkId: () => "hunk-02",
      now: () => "2026-07-13T03:01:00.000Z"
    });
    const second = await restoredSession.proposeFileWrite({
      ...proposalBinding(),
      path: "notes/outline.md",
      range: { unit: "line", start: 1, end: 2 },
      baseHash: sha256("one\ntwo"),
      replacement: "TWO"
    });

    expect(expectOk(second)).toMatchObject({
      changeSetId: "change-set-persisted",
      revision: 2,
      files: [{ candidateContent: "ONE\nTWO" }]
    });
  });

  test("routes update_selection decisions to a new immutable revision without approval", async () => {
    const persisted: ChangeSet[] = [];
    const session = createChangeSetSession({
      port: targetPort({ chapter: () => "unused", file: () => "alpha", persisted }),
      createChangeSetId: () => "change-set-selection",
      createHunkId: () => "hunk-01",
      now: sequence("2026-07-13T03:00:00.000Z", "2026-07-13T03:01:00.000Z")
    });
    const proposed = expectOk(
      await session.proposeFileWrite({
        ...proposalBinding(),
        path: "notes/outline.md",
        range: { unit: "character", start: 0, end: 5 },
        baseHash: sha256("alpha"),
        replacement: "beta"
      })
    );
    const command = {
      runId: "run-01",
      projectId: "project-01",
      commandId: "selection-01",
      expectedRunRevision: 5,
      changeSetId: proposed.changeSetId,
      revision: proposed.revision,
      checksum: proposed.checksum,
      decision: "update_selection" as const,
      files: [{ relativePath: "notes/outline.md", selected: false }]
    };

    const first = await session.decide(command);
    const duplicate = await session.decide(command);

    expect(expectOk(first)).toMatchObject({
      changeSetId: "change-set-selection",
      revision: 2,
      status: "awaiting_approval",
      files: [{ selected: false, candidateContent: "alpha" }]
    });
    expect(duplicate).toEqual(first);
    expect(persisted.map((revision) => revision.revision)).toEqual([1, 2]);
  });
});

function proposalBinding() {
  return {
    runId: "run-01",
    projectId: "project-01",
    checkpointId: "checkpoint-01",
    contextSnapshotId: "context-01"
  };
}

function targetPort(options: {
  chapter: () => string;
  file: () => string;
  persisted: ChangeSet[];
}): ChangeSetSessionPort {
  return {
    async readChapterTarget() {
      const content = options.chapter();
      return {
        ok: true,
        value: {
          relativePath: "chapters/chapter-03.md",
          assetType: "chapter",
          assetId: "chapter-03",
          content,
          checksum: sha256(content),
          dirty: false,
          supported: true
        }
      };
    },
    async readFileTarget() {
      const content = options.file();
      return {
        ok: true,
        value: {
          relativePath: "notes/outline.md",
          assetType: "text",
          content,
          checksum: sha256(content),
          dirty: false,
          supported: true
        }
      };
    },
    async validateCandidate() {
      return { ok: true, value: {} };
    },
    async persistChangeSet(changeSet: ChangeSet) {
      options.persisted.push(changeSet);
      return { ok: true, value: changeSet };
    }
  };
}

function expectOk<T>(result: Result<T, UnifiedError>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sequence<T>(...values: readonly T[]): () => T {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as T;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
