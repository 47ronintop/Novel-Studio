import { describe, it, expect } from "vitest";

/**
 * Fail-closed tests: missing or corrupt native sandbox host → unavailable, never fallback.
 */
describe("AgentTaskSandboxHost fail-closed behavior", () => {
  it("returns AGENT_TASK_SANDBOX_UNAVAILABLE when host binary is missing", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/nonexistent/path/agent-task-sandbox-host.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const result = await host.verifyHostBinary();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });

  it("returns AGENT_TASK_SANDBOX_UNAVAILABLE when host binary digest mismatches", async () => {
    // Use a file that exists but with wrong expected digest
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    // package.json definitely exists, but we give a wrong digest
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "package.json",
      expectedHostDigest: "0".repeat(64)
    });
    const result = await host.verifyHostBinary();
    // On Windows the binary may not be executable; on other platforms it may
    // At minimum it should fail (digest mismatch or not executable)
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
    // If somehow it's ok (shouldn't happen with wrong digest), fail the test
    if (result.ok) {
      expect.fail("Expected digest mismatch to cause unavailable error");
    }
  });

  it("launch returns AGENT_TASK_SANDBOX_UNAVAILABLE when host binary is missing", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/nonexistent/sandbox-host.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const ctrl = new AbortController();
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

  it("does NOT fall back to running tasks directly when host is unavailable", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/missing/host.exe",
      expectedHostDigest: "b".repeat(64)
    });
    // After verifyHostBinary fails, any subsequent launch must also fail
    await host.verifyHostBinary();
    const ctrl = new AbortController();
    const result = await host.launch({
      taskId: "task_001",
      attestationId: "attest_001",
      executionSnapshotId: "snap_001",
      signal: ctrl.signal
    });
    expect(result.ok).toBe(false);
    // Confirm no process was spawned: we can't check OS PIDs directly
    // but the error code confirms no task was executed
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });
});
