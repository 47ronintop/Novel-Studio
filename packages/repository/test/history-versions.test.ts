import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { HistoryRepository } from "../src/history-repository.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("HistoryRepository version browsing", () => {
  test("lists snapshots newest first and can read snapshot content", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-"));
    tempRoots.push(projectRoot);
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_history_versions",
      now: () => "2026-07-04T00:00:00.000Z",
      createVersionId: (() => {
        const ids = ["ver_01", "ver_02"];
        return () => ids.shift() ?? "ver_extra";
      })()
    });

    const first = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_01",
      reason: "manual-save",
      createdBy: "user",
      content: "first body\n"
    });
    const second = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_01",
      reason: "before-rollback",
      createdBy: "user",
      content: "second body\n"
    });

    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);

    const listed = await history.listChapterVersions("ch_01");

    expect(isOk(listed)).toBe(true);
    if (isErr(listed)) {
      throw new Error(listed.error.message);
    }

    expect(listed.value.map((entry) => entry.versionId)).toEqual(["ver_02", "ver_01"]);
    expect(listed.value[0]?.reason).toBe("before-rollback");

    const preview = await history.readChapterVersion("ch_01", "ver_01");

    expect(isOk(preview)).toBe(true);
    if (isErr(preview)) {
      throw new Error(preview.error.message);
    }

    expect(preview.value.content).toBe("first body\n");
  });

  test("rejects a version id that escapes the bound project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-outside-"));
    tempRoots.push(projectRoot, outsideRoot);
    await writeFile(join(outsideRoot, "secret.md"), "outside secret", "utf8");
    const history = new HistoryRepository({ projectRoot });

    const result = await history.readChapterVersion(
      "ch_01",
      `../../../../${basename(outsideRoot)}/secret`
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VERSION_ID_INVALID" }
    });
  });

  test("rejects a history junction that leaves the bound project root", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-project-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-outside-"));
    tempRoots.push(projectRoot, outsideRoot);
    await symlink(outsideRoot, join(projectRoot, "history"), "junction");
    const history = new HistoryRepository({ projectRoot });

    const result = await history.snapshotTextAsset({
      assetType: "text",
      assetId: "notes/one.md",
      reason: "before-agent-write",
      content: "before"
    });

    expect(result.ok).toBe(false);
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  test("rejects project-root retargeting after the repository is bound", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "novel-studio-history-root-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "novel-studio-history-root-b-"));
    const linkParent = await mkdtemp(join(tmpdir(), "novel-studio-history-link-"));
    tempRoots.push(rootA, rootB, linkParent);
    const projectRoot = join(linkParent, "project");
    await symlink(rootA, projectRoot, "junction");
    const history = new HistoryRepository({ projectRoot });
    const first = await history.snapshotTextAsset({
      assetType: "text",
      assetId: "notes/one.md",
      reason: "before-agent-write",
      content: "first"
    });
    expect(first.ok).toBe(true);
    await rm(projectRoot, { force: true, recursive: true });
    await symlink(rootB, projectRoot, "junction");

    const result = await history.snapshotTextAsset({
      assetType: "text",
      assetId: "notes/two.md",
      reason: "before-agent-write",
      content: "second"
    });

    expect(result.ok).toBe(false);
    expect(await readdir(rootB)).toEqual([]);
  });

  test("removes a snapshot body when its version record cannot be persisted", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-project-"));
    tempRoots.push(projectRoot);
    const assetId = "notes/one.md";
    const assetKey = `asset_${createHash("sha256").update(assetId, "utf8").digest("hex")}`;
    const blockedRecordParent = join(projectRoot, "history", "texts-records", assetKey);
    await mkdir(join(projectRoot, "history", "texts-records"), { recursive: true });
    await writeFile(blockedRecordParent, "not a directory", "utf8");
    const history = new HistoryRepository({
      projectRoot,
      createVersionId: () => "ver_orphan_test"
    });

    const result = await history.snapshotTextAsset({
      assetType: "text",
      assetId,
      reason: "before-agent-write",
      content: "before"
    });

    expect(result.ok).toBe(false);
    expect(await readdir(join(projectRoot, "history", "texts", assetKey))).toEqual([]);
  });

  test("retains the configured number of ordinary chapter versions and keeps protected versions", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-retention-"));
    tempRoots.push(projectRoot);
    let tick = 0;
    let sequence = 0;
    const history = new HistoryRepository({
      projectRoot,
      maxSnapshotsPerChapter: 2,
      now: () => `2026-07-04T00:00:0${tick++}.000Z`,
      createVersionId: () => `ver_${String(++sequence).padStart(2, "0")}`
    });

    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "one"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "before-ai-apply",
      body: "protected"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "two"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "three"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "four"
    });

    const listed = await history.listTextAssetSnapshotRecords({
      assetType: "chapter",
      assetId: "ch_01"
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error.message);
    expect(listed.value.map((record) => record.versionId)).toEqual(["ver_05", "ver_04", "ver_02"]);
    expect(listed.value.find((record) => record.reason === "before-ai-apply")?.versionId).toBe(
      "ver_02"
    );

    const removed = await history.readChapterVersion("ch_01", "ver_01");
    expect(removed.ok).toBe(false);
    const retained = await history.readChapterVersion("ch_01", "ver_04");
    expect(retained).toMatchObject({ ok: true, value: { content: "three" } });
  });

  test("does not prune when chapter retention is explicitly disabled", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-retention-disabled-"));
    tempRoots.push(projectRoot);
    let sequence = 0;
    const history = new HistoryRepository({
      projectRoot,
      maxSnapshotsPerChapter: null,
      now: (() => {
        let tick = 0;
        return () => `2026-07-04T00:00:0${tick++}.000Z`;
      })(),
      createVersionId: () => `ver_${String(++sequence).padStart(2, "0")}`
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "one"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "two"
    });
    await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "three"
    });
    const listed = await history.listChapterVersions("ch_01");
    expect(listed.ok && listed.value).toHaveLength(3);
  });

  test("uses the default retention for an explicit undefined value", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-retention-undefined-"));
    tempRoots.push(projectRoot);
    let sequence = 0;
    const history = new HistoryRepository({
      projectRoot,
      maxSnapshotsPerChapter: undefined,
      createVersionId: () => `ver_${String(++sequence).padStart(2, "0")}`
    });
    for (let index = 0; index < 11; index += 1) {
      await history.snapshotChapterVersion({
        chapterId: "ch_01",
        reason: "manual-save",
        body: `body-${index}`
      });
    }
    const listed = await history.listChapterVersions("ch_01");
    expect(listed.ok && listed.value).toHaveLength(10);
  });

  test("reuses a consecutive snapshot with the same checksum", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-dedupe-"));
    tempRoots.push(projectRoot);
    let sequence = 0;
    const history = new HistoryRepository({
      projectRoot,
      maxSnapshotsPerChapter: null,
      createVersionId: () => `ver_${String(++sequence).padStart(2, "0")}`
    });
    const first = await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "same"
    });
    const duplicate = await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "interval-snapshot",
      body: "same"
    });
    const changed = await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "changed"
    });
    expect(first).toMatchObject({ ok: true, value: { versionId: "ver_01" } });
    expect(duplicate).toMatchObject({ ok: true, value: { versionId: "ver_01" } });
    expect(changed).toMatchObject({ ok: true, value: { versionId: "ver_02" } });
    const listed = await history.listChapterVersions("ch_01");
    expect(listed.ok && listed.value.map((entry) => entry.versionId)).toEqual(["ver_02", "ver_01"]);
  });

  test("never deduplicates a protected snapshot", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "novel-studio-history-protected-dedupe-"));
    tempRoots.push(projectRoot);
    let sequence = 0;
    const history = new HistoryRepository({
      projectRoot,
      maxSnapshotsPerChapter: null,
      createVersionId: () => `ver_${String(++sequence).padStart(2, "0")}`
    });

    const first = await history.snapshotChapterVersion({
      chapterId: "ch_01",
      reason: "manual-save",
      body: "same"
    });
    const protectedSnapshot = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_01",
      reason: "before-agent-write",
      content: "same"
    });

    expect(first).toMatchObject({ ok: true, value: { versionId: "ver_01" } });
    expect(protectedSnapshot).toMatchObject({ ok: true, value: { versionId: "ver_02" } });
    const listed = await history.listChapterVersions("ch_01");
    expect(listed.ok && listed.value.map((entry) => entry.versionId)).toEqual(["ver_02", "ver_01"]);
  });
});
