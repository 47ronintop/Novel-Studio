import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

function catalogPath(root: string, projectId: string): string {
  const digest = createHash("sha256").update(projectId, "utf8").digest("hex");
  return join(root, "agent-task-catalog", `project-${digest}.json`);
}

function persistedTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    taskId: "task_0123456789abcdef",
    ...baseCandidate,
    catalogRevision: "0123456789abcdef",
    authorizedAt: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

async function writeCatalog(
  root: string,
  projectId: string,
  task: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const path = catalogPath(root, projectId);
  await mkdir(join(root, "agent-task-catalog"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: "1.0",
      projectId,
      updatedAt: "2026-07-25T00:00:00.000Z",
      tasks: [task],
      ...extra
    }),
    "utf8"
  );
}

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

  it("rejects malformed or unknown persisted catalog fields instead of treating them as authorized", async () => {
    await writeCatalog(tmpDir, "proj_001", persistedTask(), { unexpected: true });

    const list = await repo.listAuthorizedTasks("proj_001");

    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.error.code).toBe("AGENT_TASK_CATALOG_INVALID");
  });

  it("rejects persisted task records with unknown fields or invalid source definitions", async () => {
    await writeCatalog(tmpDir, "proj_001", persistedTask({ unexpected: true }));
    const unknownField = await repo.listAuthorizedTasks("proj_001");
    expect(unknownField.ok).toBe(false);

    await writeCatalog(
      tmpDir,
      "proj_001",
      persistedTask({ launcherTemplate: "C:\\\\Windows\\\\System32\\\\cmd.exe" })
    );
    const absoluteLauncher = await repo.listAuthorizedTasks("proj_001");
    expect(absoluteLauncher.ok).toBe(false);

    await writeCatalog(tmpDir, "proj_001", persistedTask({ argvTemplate: ["..\\\\outside"] }));
    const traversalArgument = await repo.listAuthorizedTasks("proj_001");
    expect(traversalArgument.ok).toBe(false);

    await writeCatalog(tmpDir, "proj_001", persistedTask({ taskSourceDigest: "A".repeat(64) }));
    const invalidDigest = await repo.listAuthorizedTasks("proj_001");
    expect(invalidDigest.ok).toBe(false);

    await writeCatalog(
      tmpDir,
      "proj_001",
      persistedTask({ resourceQuota: { ...baseCandidate.resourceQuota, maxProcesses: 0 } })
    );
    const invalidQuota = await repo.listAuthorizedTasks("proj_001");
    expect(invalidQuota.ok).toBe(false);
  });

  it.each([
    ["absolute launcher", { launcherTemplate: "C:\\\\node.exe" }],
    ["UNC launcher", { launcherTemplate: "\\\\\\\\server\\\\node.exe" }],
    ["device cwd", { cwd: "\\\\?\\\\C:\\\\workspace" }],
    ["ADS cwd", { cwd: "work:stream" }],
    ["path escape argv", { argvTemplate: ["scripts/../secret.js"] }],
    ["control character argv", { argvTemplate: ["safe\u0000arg"] }],
    ["invalid digest", { taskSourceDigest: "b".repeat(63) }],
    ["inconsistent quota", { resourceQuota: { ...baseCandidate.resourceQuota, maxCpuMs: 300001 } }],
    ["timeout exceeds wall clock", { timeout: 60001 }]
  ])("rejects candidate with %s", async (_label, overrides) => {
    const candidate = { ...baseCandidate, ...overrides } as ProjectTaskCandidate;
    const result = await repo.authorizeTask("proj_001", candidate);
    expect(result.ok).toBe(false);
  });

  it("uses a full project digest so sanitized project IDs cannot collide", async () => {
    const first = await repo.authorizeTask("billing/a", baseCandidate);
    const second = await repo.authorizeTask("billing:a", {
      ...baseCandidate,
      candidateId: "cand_build_002"
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const firstList = await repo.listAuthorizedTasks("billing/a");
    const secondList = await repo.listAuthorizedTasks("billing:a");
    expect(firstList.ok && firstList.value).toHaveLength(1);
    expect(secondList.ok && secondList.value).toHaveLength(1);
    if (firstList.ok && secondList.ok) {
      expect(firstList.value[0]?.candidateId).toBe("cand_build_001");
      expect(secondList.value[0]?.candidateId).toBe("cand_build_002");
    }
  });

  it("does not retain mutable caller-owned candidate fields and returns frozen tasks", async () => {
    const argv = ["scripts/build.js"];
    const quota = { ...baseCandidate.resourceQuota };
    const mutableCandidate: ProjectTaskCandidate = {
      ...baseCandidate,
      argvTemplate: argv,
      resourceQuota: quota
    };

    const authorized = await repo.authorizeTask("proj_001", mutableCandidate);
    expect(authorized.ok).toBe(true);
    argv[0] = "..\\\\escaped.js";
    quota.maxCpuMs = 1;

    const listed = await repo.listAuthorizedTasks("proj_001");
    expect(listed.ok).toBe(true);
    if (authorized.ok && listed.ok) {
      expect(authorized.value.argvTemplate[0]).toBe("scripts/build.js");
      expect(authorized.value.resourceQuota.maxCpuMs).toBe(30000);
      expect(listed.value[0]?.argvTemplate[0]).toBe("scripts/build.js");
      expect(Object.isFrozen(authorized.value)).toBe(true);
      expect(Object.isFrozen(authorized.value.argvTemplate)).toBe(true);
      expect(Object.isFrozen(authorized.value.resourceQuota)).toBe(true);
      expect(Reflect.set(authorized.value.resourceQuota, "maxCpuMs", 1)).toBe(false);
    }
  });
});
