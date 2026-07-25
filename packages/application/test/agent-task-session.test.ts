import { describe, it, expect } from "vitest";
import { createAgentTaskSession } from "../src/agent-task-session.js";
import type { AuthorizedTask } from "@novel-studio/repository";

const baseTask: AuthorizedTask = {
  taskId: "task_build_001",
  candidateId: "cand_build",
  displayName: "Build",
  launcherTemplate: "node",
  argvTemplate: ["scripts/build.js", "--mode", "{{mode}}"],
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
  networkMode: "none",
  catalogRevision: "rev_001",
  authorizedAt: new Date().toISOString()
};

const workspaceIdentity = {
  workspaceRoot: "/workspace",
  identityDigest: "c".repeat(64)
};

const makeAttestation = (id: string) => ({
  attestationId: id,
  capabilities: {
    fileIsolation: "verified",
    networkIsolation: "verified",
    jobObjectKillOnClose: "verified",
    appContainerOrLowBox: "verified"
  }
});

describe("AgentTaskSession.prepareTaskExecution", () => {
  it("creates a snapshot for a valid authorized task", async () => {
    const attest = makeAttestation("attest_001");
    const session = createAgentTaskSession({
      projectId: "proj_001",
      getAuthorizedTask: async (taskId) => (taskId === "task_build_001" ? baseTask : undefined),
      attestationLookup: {
        getAttestation: () => attest,
        getAttestationById: (id) => (id === "attest_001" ? attest : undefined)
      },
      createSnapshotId: () => "snap_test_001"
    });

    const result = await session.prepareTaskExecution({
      runId: "run_001",
      taskId: "task_build_001",
      parameters: { mode: "production" },
      workspaceIdentity,
      attestationRef: "attest_001",
      catalogRevision: "rev_001"
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshotId).toBe("snap_test_001");
      expect(result.value.taskId).toBe("task_build_001");
      expect(result.value.normalizedArgv).toContain("production");
      expect(result.value.catalogRevision).toBe("rev_001");
      expect(Object.isFrozen(result.value)).toBe(true);
    }
  });

  it("rejects unknown taskId", async () => {
    const attest = makeAttestation("attest_001");
    const session = createAgentTaskSession({
      projectId: "proj_001",
      getAuthorizedTask: async () => undefined,
      attestationLookup: {
        getAttestation: () => attest,
        getAttestationById: () => attest
      }
    });

    const result = await session.prepareTaskExecution({
      runId: "run_001",
      taskId: "task_unknown",
      parameters: {},
      workspaceIdentity,
      attestationRef: "attest_001",
      catalogRevision: "rev_001"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_NOT_AUTHORIZED");
  });

  it("rejects if catalog revision mismatches", async () => {
    const attest = makeAttestation("attest_001");
    const session = createAgentTaskSession({
      projectId: "proj_001",
      getAuthorizedTask: async () => baseTask,
      attestationLookup: {
        getAttestation: () => attest,
        getAttestationById: () => attest
      }
    });

    const result = await session.prepareTaskExecution({
      runId: "run_001",
      taskId: "task_build_001",
      parameters: {},
      workspaceIdentity,
      attestationRef: "attest_001",
      catalogRevision: "rev_DIFFERENT"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_CATALOG_REVISION_MISMATCH");
  });

  it("rejects if attestation is missing", async () => {
    const session = createAgentTaskSession({
      projectId: "proj_001",
      getAuthorizedTask: async () => baseTask,
      attestationLookup: {
        getAttestation: () => undefined,
        getAttestationById: () => undefined
      }
    });

    const result = await session.prepareTaskExecution({
      runId: "run_001",
      taskId: "task_build_001",
      parameters: {},
      workspaceIdentity,
      attestationRef: "attest_expired",
      catalogRevision: "rev_001"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_ATTESTATION_INVALID");
  });

  it("rejects if attestation capabilities are not all verified", async () => {
    const attest = {
      attestationId: "attest_partial",
      capabilities: {
        fileIsolation: "verified",
        networkIsolation: "unavailable",
        jobObjectKillOnClose: "verified",
        appContainerOrLowBox: "verified"
      }
    };
    const session = createAgentTaskSession({
      projectId: "proj_001",
      getAuthorizedTask: async () => baseTask,
      attestationLookup: {
        getAttestation: () => attest,
        getAttestationById: (id) => (id === "attest_partial" ? attest : undefined)
      }
    });

    const result = await session.prepareTaskExecution({
      runId: "run_001",
      taskId: "task_build_001",
      parameters: {},
      workspaceIdentity,
      attestationRef: "attest_partial",
      catalogRevision: "rev_001"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_ATTESTATION_CAPABILITIES_INCOMPLETE");
    }
  });
});
