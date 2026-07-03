import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  CacheRepository,
  HistoryRepository,
  ProjectFileRepository,
  RecoveryRepository,
  writeTextAtomically,
  type AtomicWriteFileSystem,
  type RecoveryRecord
} from "../src/index.js";

const tempRoots: string[] = [];
const fixtureRoot = join(process.cwd(), "fixtures", "schemas", "valid");

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectFileRepository", () => {
  test("reads project and settings only after schema validation", async () => {
    const projectRoot = await createTempProject();
    await copySchemaFixture("project", projectRoot, "project.json");
    await copySchemaFixture("settings", projectRoot, "settings.json");
    const repository = new ProjectFileRepository({ projectRoot, traceId: "trace_project_open" });

    const result = await repository.openProject();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(result.value.project.projectId).toBe("prj_01JZ7P9QK2R6D4W8K3A1B5C9D0");
    expect(result.value.settings.models.defaultProfileId).toBe("model_default");
  });

  test("returns a diagnostic for missing project files without mutating the project", async () => {
    const projectRoot = await createTempProject();
    const repository = new ProjectFileRepository({ projectRoot, traceId: "trace_missing" });

    const result = await repository.openProject();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected missing project files to fail");
    }
    expect(result.error.code).toBe("PROJECT_FILE_MISSING");
    expect(await readdir(projectRoot)).toEqual([]);
  });

  test("returns schema diagnostics for invalid project files without rewriting them", async () => {
    const projectRoot = await createTempProject();
    await writeFile(join(projectRoot, "project.json"), '{"schemaVersion":"1.0"}', "utf8");
    await copySchemaFixture("settings", projectRoot, "settings.json");
    const repository = new ProjectFileRepository({ projectRoot, traceId: "trace_invalid" });

    const result = await repository.openProject();

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected invalid project files to fail");
    }
    expect(result.error.code).toBe("PROJECT_FILE_INVALID");
    expect(result.error.redactedDetail?.fileName).toBe("project.json");
    expect(await readFile(join(projectRoot, "project.json"), "utf8")).toBe(
      '{"schemaVersion":"1.0"}'
    );
  });
});

describe("atomic write", () => {
  test("writes through a temporary file and replaces the target content", async () => {
    const projectRoot = await createTempProject();
    const targetPath = join(projectRoot, "chapters", "ch_01.md");

    const result = await writeTextAtomically({ targetPath, content: "new chapter body" });

    expect(result.ok).toBe(true);
    expect(await readFile(targetPath, "utf8")).toBe("new chapter body");
  });

  test("keeps the previous target content when rename fails", async () => {
    const projectRoot = await createTempProject();
    const targetPath = join(projectRoot, "project.json");
    await writeFile(targetPath, "previous", "utf8");
    const fileSystem: AtomicWriteFileSystem = {
      async mkdir(path) {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path, { recursive: true });
      },
      async writeFile(path, data) {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(path, data, "utf8");
      },
      async rename() {
        throw new Error("simulated rename failure");
      },
      async rm(path) {
        const { rm } = await import("node:fs/promises");
        await rm(path, { force: true });
      }
    };

    const result = await writeTextAtomically({
      targetPath,
      content: "replacement",
      traceId: "trace_atomic_failure",
      fileSystem
    });

    expect(result.ok).toBe(false);
    expect(await readFile(targetPath, "utf8")).toBe("previous");
  });
});

describe("HistoryRepository", () => {
  test("creates before-ai-apply and before-rollback chapter snapshots under history", async () => {
    const projectRoot = await createTempProject();
    const history = new HistoryRepository({
      projectRoot,
      traceId: "trace_history",
      now: () => "2026-07-03T00:00:00.000Z",
      createVersionId: (() => {
        const ids = ["ver_ai_apply", "ver_rollback"];
        return () => ids.shift() ?? "ver_extra";
      })()
    });

    const beforeAi = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_01",
      reason: "before-ai-apply",
      content: "before AI"
    });
    const beforeRollback = await history.snapshotTextAsset({
      assetType: "chapter",
      assetId: "ch_01",
      reason: "before-rollback",
      content: "before rollback"
    });

    expect(beforeAi.ok).toBe(true);
    expect(beforeRollback.ok).toBe(true);
    expect(
      await readFile(join(projectRoot, "history", "chapters", "ch_01", "ver_ai_apply.md"), "utf8")
    ).toBe("before AI");
    expect(
      await readFile(join(projectRoot, "history", "chapters", "ch_01", "ver_rollback.md"), "utf8")
    ).toBe("before rollback");
  });
});

describe("RecoveryRepository and CacheRepository", () => {
  test("writes recovery records under history/recovery", async () => {
    const projectRoot = await createTempProject();
    const repository = new RecoveryRepository({ projectRoot, traceId: "trace_recovery" });
    const record: RecoveryRecord = {
      schemaVersion: "1.0",
      sessionId: "session_test",
      projectId: "prj_01",
      openAssetId: "ch_01",
      assetType: "chapter",
      dirty: true,
      draftContentRef: {
        strategy: "inline",
        content: "unsaved draft"
      },
      updatedAt: "2026-07-03T00:00:00.000Z"
    };

    const result = await repository.writeRecoveryRecord(record);

    expect(result.ok).toBe(true);
    expect(
      await readFile(join(projectRoot, "history", "recovery", "session_test.json"), "utf8")
    ).toContain("unsaved draft");
  });

  test("clears only cache data and preserves history and memories", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, "cache", "indexes"), { recursive: true });
    await mkdir(join(projectRoot, "history", "chapters", "ch_01"), { recursive: true });
    await mkdir(join(projectRoot, "memories", "long-term"), { recursive: true });
    await writeFile(join(projectRoot, "cache", "indexes", "search.json"), "cache", "utf8");
    await writeFile(
      join(projectRoot, "history", "chapters", "ch_01", "ver_keep.md"),
      "history",
      "utf8"
    );
    await writeFile(join(projectRoot, "memories", "long-term", "mem_keep.json"), "memory", "utf8");
    const repository = new CacheRepository({ projectRoot, traceId: "trace_cache_clear" });

    const result = await repository.clearCache();

    expect(result.ok).toBe(true);
    expect(await listRelativeFiles(join(projectRoot, "cache"))).toEqual([]);
    expect(
      await readFile(join(projectRoot, "history", "chapters", "ch_01", "ver_keep.md"), "utf8")
    ).toBe("history");
    expect(
      await readFile(join(projectRoot, "memories", "long-term", "mem_keep.json"), "utf8")
    ).toBe("memory");
  });
});

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-repository-"));
  tempRoots.push(root);
  return root;
}

async function copySchemaFixture(
  name: string,
  projectRoot: string,
  targetName: string
): Promise<void> {
  const content = await readFile(join(fixtureRoot, `${name}.json`), "utf8");
  await writeFile(join(projectRoot, targetName), content, "utf8");
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1))
    .sort();
}
