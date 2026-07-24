import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProjectTaskCatalogRepository,
  type ProjectTaskCandidate
} from "../src/project-task-catalog-repository.js";

const baseCandidate: ProjectTaskCandidate = {
  candidateId: "cand_build_001",
  displayName: "Build TypeScript",
  launcherTemplate: "node",
  argvTemplate: ["scripts/build.js"],
  cwd: ".",
  fileProfile: "workspace_read_only",
  resourceQuota: {
    maxCpuMs: 30000,
    maxMemoryBytes: 512 * 1024 * 1024,
    maxWallClockMs: 60000,
    maxProcesses: 4,
    maxScratchBytes: 100 * 1024 * 1024
  },
  timeout: 60000,
  taskSourceDigest: "a".repeat(64),
  networkMode: "none"
};

describe("ProjectTaskCatalogRepository", () => {
  let tmpDir: string;
  let repo: ProjectTaskCatalogRepository;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "task-catalog-test-"));
    repo = new ProjectTaskCatalogRepository({ userDataRoot: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists empty catalog for new project", async () => {
    const list = await repo.listAuthorizedTasks("proj_001");
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("authorizes a valid task", async () => {
    const result = await repo.authorizeTask("proj_001", baseCandidate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toMatch(/^task_/);
      expect(result.value.networkMode).toBe("none");
      expect(result.value.catalogRevision).toBeTruthy();
      expect(result.value.authorizedAt).toBeTruthy();
    }
  });

  it("lists authorized tasks after authorization", async () => {
    await repo.authorizeTask("proj_001", baseCandidate);
    const list = await repo.listAuthorizedTasks("proj_001");
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
  });

  it("revokes a task", async () => {
    const authorized = await repo.authorizeTask("proj_001", baseCandidate);
    if (!authorized.ok) throw new Error("authorization failed");
    const revoked = await repo.revokeTask("proj_001", authorized.value.taskId);
    expect(revoked.ok).toBe(true);
    const list = await repo.listAuthorizedTasks("proj_001");
    if (list.ok) expect(list.value).toHaveLength(0);
  });

  it("getAuthorizedTask returns task by id", async () => {
    const authorized = await repo.authorizeTask("proj_001", baseCandidate);
    if (!authorized.ok) throw new Error("authorization failed");
    const found = await repo.getAuthorizedTask("proj_001", authorized.value.taskId);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.value?.taskId).toBe(authorized.value.taskId);
  });

  it("rejects candidate with network mode other than none", async () => {
    const bad = { ...baseCandidate, networkMode: "unrestricted" as "none" };
    const result = await repo.authorizeTask("proj_001", bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_CATALOG_NETWORK_FORBIDDEN");
  });

  it("rejects candidate with path traversal in cwd", async () => {
    const bad = { ...baseCandidate, cwd: "../../../etc" };
    const result = await repo.authorizeTask("proj_001", bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_CATALOG_PATH_INVALID");
  });

  it("rejects candidate with invalid timeout", async () => {
    const bad = { ...baseCandidate, timeout: 0 };
    const result = await repo.authorizeTask("proj_001", bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_CATALOG_TIMEOUT_INVALID");
  });

  it("persists catalog across repo instances", async () => {
    await repo.authorizeTask("proj_001", baseCandidate);
    const repo2 = new ProjectTaskCatalogRepository({ userDataRoot: tmpDir });
    const list = await repo2.listAuthorizedTasks("proj_001");
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
  });
});
