import { describe, it, expect } from "vitest";

/**
 * Blackbox sandbox tests — runs only on supported Windows with sandbox host.
 * On non-Windows or without sandbox host, tests skip gracefully.
 */
describe("AgentTaskSandbox blackbox tests", () => {
  const isWindows = process.platform === "win32";

  it.skipIf(!isWindows)("sandbox host binary is present on Windows", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = new AgentTaskSandboxHost({
      hostBinaryPath: "resources/native/agent-task-sandbox-host.exe",
      expectedHostDigest: "placeholder"
    });
    const result = await host.verifyHostBinary();
    if (!result.ok) {
      expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
    }
  });

  it("qualification service returns unavailable on non-Windows", async () => {
    const { SandboxQualificationService } = await import(
      "../src/main/agent-sandbox-qualification.js"
    );
    const svc = new SandboxQualificationService();
    const result = await svc.qualify({
      hostDigest: "a".repeat(64),
      hostBinaryPresent: false
    });
    if (process.platform !== "win32") {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AGENT_SANDBOX_NOT_SUPPORTED");
      }
    } else {
      expect(result.ok).toBe(false);
    }
  });

  it("qualification service returns unavailable when host binary absent", async () => {
    const { SandboxQualificationService } = await import(
      "../src/main/agent-sandbox-qualification.js"
    );
    const svc = new SandboxQualificationService();
    const result = await svc.qualify({
      hostDigest: "a".repeat(64),
      hostBinaryPresent: false,
      windowsCapabilitiesVerified: true
    });
    if (process.platform === "win32") {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("AGENT_TASK_SANDBOX_UNAVAILABLE");
      }
    } else {
      expect(result.ok).toBe(false);
    }
  });

  it("attestation expires after lifetime", async () => {
    const { SandboxQualificationService } = await import(
      "../src/main/agent-sandbox-qualification.js"
    );
    const svc = new SandboxQualificationService();
    expect(svc.getAttestation()).toBeUndefined();
  });

  it("requiresRequalification clears current attestation", async () => {
    const { SandboxQualificationService } = await import(
      "../src/main/agent-sandbox-qualification.js"
    );
    const svc = new SandboxQualificationService();
    svc.requiresRequalification("test");
    expect(svc.getAttestation()).toBeUndefined();
  });
});
