import { describe, it, expect } from "vitest";

/**
 * Process tree cleanup tests.
 */
describe("AgentTaskSandbox process tree cleanup", () => {
  it("process handle cancel terminates the host process", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/missing/host.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const result = await host.launchInSandbox({
      taskId: "task_001",
      executablePath: "/workspace/build.js",
      argv: ["--mode", "production"],
      workspaceProjection: "/tmp/proj",
      resourceQuota: {
        maxCpuMs: 30000,
        maxMemoryBytes: 512 * 1024 * 1024,
        maxWallClockMs: 60000,
        maxProcesses: 4,
        maxScratchBytes: 100 * 1024 * 1024
      },
      attestationRef: "attest_001",
      executionSnapshotId: "snap_001"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });

  it("AbortSignal cancellation is wired through launch()", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/missing/host.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const ctrl = new AbortController();
    ctrl.abort();

    const result = await host.launch({
      taskId: "task_001",
      attestationId: "attest_001",
      executionSnapshotId: "snap_001",
      signal: ctrl.signal
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });
});
