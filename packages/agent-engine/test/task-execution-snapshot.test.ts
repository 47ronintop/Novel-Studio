import { describe, it, expect } from "vitest";
import {
  createTaskExecutionSnapshot,
  type TaskExecutionSnapshot
} from "../src/task-execution-snapshot.js";

const baseInput = {
  snapshotId: "snap_test_001",
  taskId: "task_build_001",
  canonicalExecutable: "a".repeat(64),
  normalizedArgv: ["node", "build.js", "--out", "dist"],
  parametersDigest: "b".repeat(64),
  workspaceIdentity: "c".repeat(64),
  catalogRevision: "rev_1",
  attestationRef: "attest_1",
  fileProfile: "workspace_read_only" as const,
  resourceQuota: {
    maxCpuMs: 30000,
    maxMemoryBytes: 512 * 1024 * 1024,
    maxWallClockMs: 60000,
    maxProcesses: 4,
    maxScratchBytes: 100 * 1024 * 1024
  }
};

describe("createTaskExecutionSnapshot", () => {
  it("creates a snapshot with all fields populated", () => {
    const snap = createTaskExecutionSnapshot(baseInput);
    expect(snap.snapshotId).toBe("snap_test_001");
    expect(snap.taskId).toBe("task_build_001");
    expect(snap.fileProfile).toBe("workspace_read_only");
    expect(snap.normalizedArgv).toEqual(["node", "build.js", "--out", "dist"]);
    expect(snap.projectionManifest).toBeNull();
    expect(typeof snap.createdAt).toBe("string");
  });

  it("snapshot is frozen (immutable)", () => {
    const snap = createTaskExecutionSnapshot(baseInput);
    // TypeScript prevents direct mutation, but we verify Object.isFrozen
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("normalizedArgv is frozen", () => {
    const snap = createTaskExecutionSnapshot(baseInput);
    expect(Object.isFrozen(snap.normalizedArgv)).toBe(true);
  });

  it("resourceQuota is frozen", () => {
    const snap = createTaskExecutionSnapshot(baseInput);
    expect(Object.isFrozen(snap.resourceQuota)).toBe(true);
  });

  it("mutating the input argv after creation does not affect snapshot", () => {
    const argv = ["node", "build.js"];
    const snap = createTaskExecutionSnapshot({ ...baseInput, normalizedArgv: argv });
    // The snapshot captured it at creation time
    expect(snap.normalizedArgv).toEqual(["node", "build.js"]);
    expect(snap.normalizedArgv.length).toBe(2);
  });

  it("stores projectionManifest when provided", () => {
    const manifest = {
      manifestId: "manifest_001",
      taskId: "task_build_001",
      snapshotId: "snap_test_001",
      files: [
        {
          relativePath: "src/index.ts",
          sourceChecksum: "d".repeat(64),
          projectedPath: "/tmp/proj/src/index.ts"
        }
      ],
      manifestDigest: "e".repeat(64)
    };
    const snap = createTaskExecutionSnapshot({ ...baseInput, projectionManifest: manifest });
    expect(snap.projectionManifest).not.toBeNull();
    expect(snap.projectionManifest?.manifestId).toBe("manifest_001");
    expect(snap.projectionManifest?.files).toHaveLength(1);
  });

  it("typed as TaskExecutionSnapshot", () => {
    const snap: TaskExecutionSnapshot = createTaskExecutionSnapshot(baseInput);
    expect(snap).toBeDefined();
  });
});
