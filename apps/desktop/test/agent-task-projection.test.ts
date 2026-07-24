import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTaskProjection } from "../src/main/agent-task-projection.js";

describe("buildTaskProjection", () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let outputRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "projection-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    outputRoot = join(tmpDir, "output");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(outputRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty projection for empty allowedPaths", async () => {
    const result = await buildTaskProjection({
      taskId: "task_001",
      snapshotId: "snap_001",
      workspaceRoot,
      allowedRelativePaths: [],
      outputRoot
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(0);
      expect(result.value.taskId).toBe("task_001");
      expect(result.value.snapshotId).toBe("snap_001");
    }
  });

  it("rejects path traversal", async () => {
    const result = await buildTaskProjection({
      taskId: "task_001",
      snapshotId: "snap_001",
      workspaceRoot,
      allowedRelativePaths: ["../../etc/passwd"],
      outputRoot
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["AGENT_TASK_PROJECTION_PATH_INVALID", "AGENT_TASK_PROJECTION_PATH_ESCAPE"]).toContain(
        result.error.code
      );
    }
  });

  it("rejects absolute paths", async () => {
    const result = await buildTaskProjection({
      taskId: "task_001",
      snapshotId: "snap_001",
      workspaceRoot,
      allowedRelativePaths: ["/etc/passwd"],
      outputRoot
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_PROJECTION_PATH_INVALID");
    }
  });

  it("rejects non-existent file", async () => {
    const result = await buildTaskProjection({
      taskId: "task_001",
      snapshotId: "snap_001",
      workspaceRoot,
      allowedRelativePaths: ["nonexistent.ts"],
      outputRoot
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_PROJECTION_FILE_NOT_FOUND");
    }
  });

  it("projects an existing file and returns manifest with checksum", async () => {
    const srcDir = join(workspaceRoot, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "build.ts"), "export const x = 1;");

    const result = await buildTaskProjection({
      taskId: "task_001",
      snapshotId: "snap_001",
      workspaceRoot,
      allowedRelativePaths: ["src/build.ts"],
      outputRoot
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files).toHaveLength(1);
      expect(result.value.files[0].relativePath).toBe("src/build.ts");
      expect(result.value.files[0].sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
      expect(result.value.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
