import { describe, expect, it } from "vitest";

/**
 * These are boundary tests, not a qualification claim. A real qualification
 * suite runs separately on a Windows runner with a signed native bundle. The
 * source-tree stub must always fail closed and may not be skipped.
 */
describe("AgentTaskSandbox qualification boundary", () => {
  it("does not treat the source-tree sandbox placeholder as a qualified host", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const result = await AgentTaskSandboxHost.fromPackagedResources({
      resourcesBase: "apps/desktop/resources"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });

  it("does not issue an attestation without an independent package-bound probe", async () => {
    const { SandboxQualificationService } =
      await import("../src/main/agent-sandbox-qualification.js");
    const result = await new SandboxQualificationService().qualify();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["AGENT_SANDBOX_NOT_SUPPORTED", "AGENT_TASK_SANDBOX_UNAVAILABLE"]).toContain(
        result.error.code
      );
    }
  });

  it("clears the in-memory attestation on requalification demand", async () => {
    const { SandboxQualificationService } =
      await import("../src/main/agent-sandbox-qualification.js");
    const service = new SandboxQualificationService();
    service.requiresRequalification("test");
    expect(service.getAttestation()).toBeUndefined();
  });
});
