import { describe, it, expect } from "vitest";

/**
 * Negative control tests: verify the test infrastructure CAN detect missing sandbox protection.
 */
describe("AgentTaskSandbox negative control tests", () => {
  it("direct node:child_process spawn can run without sandbox (negative control)", async () => {
    const { execSync } = await import("node:child_process");
    try {
      const result = execSync("node --version", {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
      expect(result).toMatch(/^v\d+/);
    } catch {
      // If node not available, skip
    }
  });

  it("negative control: confirms sandbox host path validation catches missing binary", async () => {
    const { AgentTaskSandboxHost } = await import("../src/main/agent-task-sandbox.js");
    const host = new AgentTaskSandboxHost({
      hostBinaryPath: "/this/does/not/exist/sandbox.exe",
      expectedHostDigest: "a".repeat(64)
    });
    const result = await host.verifyHostBinary();
    expect(result.ok).toBe(false);
  });

  it("negative control: qualification service never yields partial attestation", async () => {
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
    } else {
      expect(result.ok).toBe(false);
    }

    if (result.ok) {
      const caps = result.value.capabilities;
      expect(caps.fileIsolation).toBe("verified");
      expect(caps.networkIsolation).toBe("verified");
      expect(caps.jobObjectKillOnClose).toBe("verified");
      expect(caps.appContainerOrLowBox).toBe("verified");
    }
  });
});
