import { describe, expect, it } from "vitest";

/**
 * Negative controls must prove that an invalid prerequisite is rejected. They
 * do not start an ordinary process and then mistake that for sandbox evidence.
 */
describe("AgentTaskSandbox negative controls", () => {
  it("rejects a missing native host binary", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = AgentTaskSandboxHost.forTesting({
      hostBinaryPath: "/this/does/not/exist/sandbox.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const result = await host.verifyHostBinary();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
  });

  it("rejects incomplete or forged qualification evidence", async () => {
    const { parseSandboxQualificationEvidence } =
      await import("../src/main/agent-sandbox-qualification.js");
    const parsed = parseSandboxQualificationEvidence({
      schemaVersion: "1.0",
      evidenceId: "forged",
      hostDigest: "a".repeat(64),
      probeDigest: "b".repeat(64),
      osVersion: "windows-x64",
      protocolVersion: "1.0",
      policyRevision: "policy",
      testVectorRevision: "vectors",
      generatedAt: new Date().toISOString(),
      capabilities: {
        fileIsolation: "verified",
        networkIsolation: "unavailable",
        jobObjectKillOnClose: "verified",
        appContainerOrLowBox: "verified"
      },
      adapterSaysReady: true
    });
    expect(parsed).toBeUndefined();
  });

  it("cannot issue an attestation from a caller-provided verification boolean", async () => {
    const { SandboxQualificationService } =
      await import("../src/main/agent-sandbox-qualification.js");
    const service = new SandboxQualificationService();
    const result = await service.qualify();
    expect(result.ok).toBe(false);
  });
});
