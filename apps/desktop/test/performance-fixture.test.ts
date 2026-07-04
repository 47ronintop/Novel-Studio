import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

import { ProjectFileRepository } from "@novel-studio/repository";

describe("M9 performance fixture generator", () => {
  test("creates a synthetic large project fixture without secrets", async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), "novel-studio-perf-"));

    try {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/create-performance-fixture.mjs",
          targetRoot,
          "--target-character-count",
          "10000",
          "--chapter-count",
          "4"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );

      expect(result.status, result.stderr).toBe(0);

      const projectJson = JSON.parse(await readFile(join(targetRoot, "project.json"), "utf8")) as {
        readonly stats: { readonly targetWordCount: number; readonly currentWordCount: number };
      };
      const settingsJson = await readFile(join(targetRoot, "settings.json"), "utf8");
      const firstChapter = await readFile(join(targetRoot, "chapters", "ch_perf_0001.md"), "utf8");
      const manifest = JSON.parse(
        await readFile(join(targetRoot, "performance-fixture.json"), "utf8")
      ) as {
        readonly targetCharacterCount: number;
        readonly chapterCount: number;
      };

      expect(projectJson.stats.targetWordCount).toBe(10000);
      expect(projectJson.stats.currentWordCount).toBe(10000);
      expect(manifest).toEqual({
        targetCharacterCount: 10000,
        chapterCount: 4
      });
      expect(firstChapter).toContain('schemaVersion: "1.0"');
      expect(firstChapter).toContain('id: "ch_perf_0001"');
      expect(firstChapter).toContain("Performance fixture paragraph");
      expect(settingsJson).toContain("secret://model_performance/api_key");
      expect(`${settingsJson}\n${firstChapter}`).not.toMatch(/\bsk-[A-Za-z0-9]/);
    } finally {
      await rm(targetRoot, { recursive: true, force: true });
    }
  });

  test("opens a one million character synthetic project through Repository baseline path", async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), "novel-studio-perf-large-"));

    try {
      const generateResult = spawnSync(
        process.execPath,
        [
          "scripts/create-performance-fixture.mjs",
          targetRoot,
          "--target-character-count",
          "1000000",
          "--chapter-count",
          "20"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );
      expect(generateResult.status, generateResult.stderr).toBe(0);

      const repository = new ProjectFileRepository({
        projectRoot: targetRoot,
        traceId: "trace_m9_performance"
      });
      const startedAt = performance.now();
      const result = await repository.openProject();
      const elapsedMs = performance.now() - startedAt;

      expect(result.ok).toBe(true);
      expect(elapsedMs).toBeLessThan(1500);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      expect(result.value.project.stats.currentWordCount).toBe(1000000);
    } finally {
      await rm(targetRoot, { recursive: true, force: true });
    }
  });
});
