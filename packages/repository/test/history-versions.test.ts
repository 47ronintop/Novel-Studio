import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
