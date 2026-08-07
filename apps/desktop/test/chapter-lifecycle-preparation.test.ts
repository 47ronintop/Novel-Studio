import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import {
  ChapterFileRepository,
  HistoryRepository,
  StoryBibleFileRepository
} from "@novel-studio/repository";

import { createDesktopChapterLifecyclePreparationPort } from "../src/main/chapter-lifecycle-preparation.js";

const roots: string[] = [];
const now = "2026-08-06T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop chapter lifecycle preparation", () => {
  test("prepares a serialized rename candidate without writing the chapter", async () => {
    const fixture = await createFixture();
    const result = await fixture.port.prepareRename({
      chapterId: fixture.chapterId,
      baseRevision: 1,
      title: "Renamed chapter"
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.operation).toBe("rename");
    expect(result.value.preparationProof).toMatchObject({
      proofId: expect.stringMatching(/^[a-f0-9]{64}$/u),
      proofChecksum: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(result.value.outline).toBeUndefined();
    expect(result.value.chapters).toHaveLength(1);
    expect(result.value.chapters[0]).toMatchObject({
      relativePath: `chapters/${fixture.chapterId}.md`,
      baseContent: fixture.chapterContent
    });
    expect(result.value.chapters[0]?.candidateContent).toContain("title: Renamed chapter");
    expect(result.value.chapters[0]?.candidateContent).toContain("revision: 2");
    await expect(readFile(fixture.chapterPath, "utf8")).resolves.toBe(fixture.chapterContent);
  });

  test("prepares delete and restore as complete chapter-plus-outline candidate groups", async () => {
    const fixture = await createFixture();
    const deleted = await fixture.port.prepareDelete({
      chapterId: fixture.chapterId,
      baseRevision: 1
    });
    expect(deleted).toMatchObject({ ok: true });
    if (!deleted.ok || deleted.value.outline === undefined || deleted.value.proof === undefined)
      return;
    const deletedChapter = deleted.value.chapters[0];
    if (deletedChapter === undefined) return;

    expect(deletedChapter.candidateContent).toContain("status: deleted");
    expect(deleted.value.outline.candidateContent).not.toContain(fixture.chapterId);
    expect(deleted.value.consistencyGroupId).toMatch(/^chapter-lifecycle-/u);
    await expect(readFile(fixture.chapterPath, "utf8")).resolves.toBe(fixture.chapterContent);
    await expect(readFile(fixture.outlinePath, "utf8")).resolves.toBe(fixture.outlineContent);

    // Simulate only the later approved mixed Change Set apply. Preparation itself has no write path.
    await writeFile(fixture.chapterPath, deletedChapter.candidateContent, "utf8");
    await writeFile(fixture.outlinePath, deleted.value.outline.candidateContent, "utf8");
    const history = await fixture.history.snapshotTextAsset({
      assetType: "chapter",
      assetId: fixture.chapterId,
      reason: "before-agent-write",
      content: deletedChapter.baseContent,
      candidateContent: deletedChapter.candidateContent,
      chapterStatusTransitionProof: deleted.value.proof
    });
    expect(history.ok).toBe(true);

    const restored = await fixture.port.prepareRestore({
      chapterId: fixture.chapterId,
      baseRevision: 2
    });
    expect(restored).toMatchObject({ ok: true });
    if (!restored.ok || restored.value.outline === undefined) return;
    expect(restored.value.operation).toBe("restore");
    expect(restored.value.consistencyGroupId).toMatch(/^chapter-lifecycle-/u);
    expect(restored.value.chapters[0]?.candidateContent).toContain("status: draft");
    expect(restored.value.outline.candidateContent).toContain(fixture.chapterId);
  });

  test("fails closed when the latest delete proof is missing or tampered", async () => {
    const fixture = await createFixture();
    const deleted = await fixture.port.prepareDelete({
      chapterId: fixture.chapterId,
      baseRevision: 1
    });
    if (!deleted.ok || deleted.value.outline === undefined || deleted.value.proof === undefined)
      throw new Error("Expected a delete preparation.");
    const deletedChapter = deleted.value.chapters[0];
    if (deletedChapter === undefined) throw new Error("Expected a deleted chapter candidate.");
    await writeFile(fixture.chapterPath, deletedChapter.candidateContent, "utf8");
    await writeFile(fixture.outlinePath, deleted.value.outline.candidateContent, "utf8");

    await expect(
      fixture.port.prepareRestore({ chapterId: fixture.chapterId, baseRevision: 2 })
    ).resolves.toMatchObject({ ok: false, error: { code: "CHAPTER_RESTORE_PROOF_UNAVAILABLE" } });

    const snapshot = await fixture.history.snapshotTextAsset({
      assetType: "chapter",
      assetId: fixture.chapterId,
      reason: "before-agent-write",
      content: deletedChapter.baseContent,
      candidateContent: deletedChapter.candidateContent,
      chapterStatusTransitionProof: deleted.value.proof
    });
    if (!snapshot.ok) throw new Error(snapshot.error.message);
    const recordPath = join(
      fixture.root,
      "history",
      "chapters-records",
      fixture.chapterId,
      `${snapshot.value.versionId}.json`
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      chapterStatusTransitionProof: { afterChecksum: string };
    };
    record.chapterStatusTransitionProof.afterChecksum = "0".repeat(64);
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

    await expect(
      fixture.port.prepareRestore({ chapterId: fixture.chapterId, baseRevision: 2 })
    ).resolves.toMatchObject({ ok: false, error: { code: "CHAPTER_RESTORE_PROOF_UNAVAILABLE" } });
  });

  test("binds apply to a durable one-shot Main preparation proof", async () => {
    const fixture = await createFixture();
    const prepared = await fixture.port.prepareRename({
      chapterId: fixture.chapterId,
      baseRevision: 1,
      title: "Renamed chapter"
    });
    if (!prepared.ok || prepared.value.preparationProof === undefined)
      throw new Error("Expected a durable lifecycle proof.");
    const file = prepared.value.chapters[0];
    if (file === undefined) throw new Error("Expected a chapter candidate.");
    const input = {
      consistencyGroupId: prepared.value.consistencyGroupId,
      preparationProof: prepared.value.preparationProof,
      files: [
        {
          relativePath: file.relativePath,
          assetType: "chapter" as const,
          contentMode: "serialized_chapter" as const,
          assetId: file.assetId,
          baseContent: file.baseContent,
          candidateContent: file.candidateContent,
          baseChecksum: file.baseChecksum,
          candidateChecksum: file.candidateChecksum
        }
      ]
    };
    await expect(fixture.port.validateAndConsumeLifecyclePreparation(input)).resolves.toEqual({
      ok: true,
      value: undefined
    });
    await expect(fixture.port.validateAndConsumeLifecyclePreparation(input)).resolves.toMatchObject(
      {
        ok: false,
        error: { code: "CHAPTER_LIFECYCLE_PREPARATION_PROOF_INVALID" }
      }
    );

    const second = await fixture.port.prepareRename({
      chapterId: fixture.chapterId,
      baseRevision: 1,
      title: "Another name"
    });
    if (!second.ok || second.value.preparationProof === undefined)
      throw new Error("Expected a durable lifecycle proof.");
    const secondFile = second.value.chapters[0];
    if (secondFile === undefined) throw new Error("Expected a chapter candidate.");
    await expect(
      fixture.port.validateAndConsumeLifecyclePreparation({
        consistencyGroupId: second.value.consistencyGroupId,
        preparationProof: second.value.preparationProof,
        files: [
          {
            relativePath: secondFile.relativePath,
            assetType: "chapter",
            assetId: secondFile.assetId,
            baseContent: secondFile.baseContent,
            candidateContent: `${secondFile.candidateContent}\nTampered`,
            baseChecksum: secondFile.baseChecksum,
            candidateChecksum: secondFile.candidateChecksum
          }
        ]
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAPTER_LIFECYCLE_PREPARATION_PROOF_INVALID" }
    });

    const third = await fixture.port.prepareRename({
      chapterId: fixture.chapterId,
      baseRevision: 1,
      title: "Third name"
    });
    if (!third.ok || third.value.preparationProof === undefined)
      throw new Error("Expected a durable lifecycle proof.");
    const proofPath = join(
      fixture.root,
      "agent-lifecycle-preparation-proofs",
      `${third.value.consistencyGroupId}.json`
    );
    const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
      files: { candidateContent: string }[];
      canonicalChecksum: string;
    };
    const firstProofFile = proof.files[0];
    if (firstProofFile === undefined) throw new Error("Expected a lifecycle proof file.");
    firstProofFile.candidateContent = "forged";
    proof.canonicalChecksum = createHash("sha256")
      .update(JSON.stringify(proof.files), "utf8")
      .digest("hex");
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
    await expect(
      fixture.port.validateAndConsumeLifecyclePreparation({
        consistencyGroupId: third.value.consistencyGroupId,
        preparationProof: third.value.preparationProof,
        files: []
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "CHAPTER_LIFECYCLE_PREPARATION_PROOF_INVALID" }
    });
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-chapter-lifecycle-"));
  roots.push(root);
  const chapterId = "ch_lifecycle";
  const chapterPath = join(root, "chapters", `${chapterId}.md`);
  const outlinePath = join(root, "outline", "outline.json");
  const chapterContent = chapterMarkdown(chapterId);
  const outlineContent = `${JSON.stringify({
    schemaVersion: "1.1",
    id: "outline_main",
    type: "outline",
    title: "Outline",
    status: "active",
    summary: "",
    aliases: [],
    relations: [],
    details: {
      volumes: [
        {
          volumeId: "vol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          entryRevision: 1,
          title: "Volume one",
          summary: "",
          goals: [],
          chapterIds: [chapterId]
        }
      ],
      chapterOutlines: []
    },
    extensions: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    revision: 1
  })}\n`;
  await mkdir(join(root, "chapters"), { recursive: true });
  await mkdir(join(root, "outline"), { recursive: true });
  await writeFile(chapterPath, chapterContent, "utf8");
  await writeFile(outlinePath, outlineContent, "utf8");
  const chapters = new ChapterFileRepository({ projectRoot: root, traceId: "lifecycle-test" });
  const storyBible = new StoryBibleFileRepository({ projectRoot: root, traceId: "lifecycle-test" });
  const history = new HistoryRepository({
    projectRoot: root,
    traceId: "lifecycle-test",
    now: () => now,
    createVersionId: () => "ver_lifecycle"
  });
  return {
    root,
    chapterId,
    chapterPath,
    outlinePath,
    chapterContent,
    outlineContent,
    history,
    storyBible,
    port: createDesktopChapterLifecyclePreparationPort({
      chapterRepository: chapters,
      storyBible,
      historyRepository: history,
      proofRoot: root,
      now: () => now,
      traceId: "lifecycle-test"
    })
  };
}

function chapterMarkdown(chapterId: string): string {
  return `---\nschemaVersion: "1.0"\nid: ${chapterId}\ntype: chapter\ntitle: Original\norder: 1\nstatus: draft\nvolumeId: vol_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nrevision: 1\ncreatedAt: "2026-08-01T00:00:00.000Z"\nupdatedAt: "2026-08-01T00:00:00.000Z"\n---\n\nBody\n`;
}
