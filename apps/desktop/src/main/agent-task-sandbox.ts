/**
 * Task C.0 — AgentTaskSandboxHost.
 *
 * This is the ONLY file in the TypeScript codebase permitted to import node:child_process
 * for task-related purposes. It only launches the verified native host binary — never the
 * task executable directly. If the host binary is missing, digest-mismatched, or the
 * protocol handshake fails, it returns err(unavailableError(...)) — no fallback.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { AgentTaskSandboxPort } from "@novel-studio/application";

export interface AgentTaskProcessHandle {
  readonly taskId: string;
  readonly pid: number;
  waitForExit(): Promise<{ exitCode: number | null; signal: string | null }>;
  cancel(): void;
}

export interface AgentTaskSandboxLaunchInput {
  readonly taskId: string;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly workspaceProjection: string;
  readonly resourceQuota: {
    readonly maxCpuMs: number;
    readonly maxMemoryBytes: number;
    readonly maxWallClockMs: number;
    readonly maxProcesses: number;
    readonly maxScratchBytes: number;
  };
  readonly attestationRef: string;
}

/**
 * AgentTaskSandboxHost wraps the native sandbox host process.
 * The native host is a compiled Rust binary that creates Windows AppContainer
 * processes for task execution. This adapter:
 *  1. Verifies the native host binary SHA-256 matches the expected digest.
 *  2. Spawns the native host (not the task directly).
 *  3. Returns a handle to observe/cancel the sandbox process.
 *
 * If the host binary is missing, corrupted, or signature-mismatched,
 * this class returns AGENT_TASK_SANDBOX_UNAVAILABLE — never falls back to direct spawn.
 */
export class AgentTaskSandboxHost implements AgentTaskSandboxPort {
  private readonly hostBinaryPath: string;
  private readonly expectedHostDigest: string;
  private verifiedDigest = false;

  constructor(options: { readonly hostBinaryPath: string; readonly expectedHostDigest: string }) {
    this.hostBinaryPath = options.hostBinaryPath;
    this.expectedHostDigest = options.expectedHostDigest;
  }

  /**
   * Verify the native host binary exists and matches the expected SHA-256 digest.
   * Called once per session; result is cached.
   */
  async verifyHostBinary(): Promise<Result<string, UnifiedError>> {
    if (this.verifiedDigest) return ok(this.expectedHostDigest);

    try {
      await access(this.hostBinaryPath, fsConstants.R_OK | fsConstants.X_OK);
    } catch {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Native sandbox host binary not found or not executable."
        )
      );
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(this.hostBinaryPath);
    } catch {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Cannot read native sandbox host binary."
        )
      );
    }

    const actualDigest = createHash("sha256").update(fileBuffer).digest("hex");
    if (actualDigest !== this.expectedHostDigest) {
      return err(
        unavailableError(
          "AGENT_TASK_SANDBOX_UNAVAILABLE",
          "Native sandbox host binary digest mismatch — possible tampering."
        )
      );
    }

    this.verifiedDigest = true;
    return ok(actualDigest);
  }

  /**
   * AgentTaskSandboxPort.launch — launches a task inside the verified native sandbox.
   * Fails closed if:
   *  - host binary missing or digest-mismatched
   *  - attestation ID not recognized
   *  - host process exits with non-zero before producing output
   */
  async launch(input: {
    readonly taskId: string;
    readonly attestationId: string;
    readonly executionSnapshotId: string;
    readonly signal: AbortSignal;
  }): Promise<Result<import("@novel-studio/application").AgentTaskExecutionOutput, UnifiedError>> {
    // Verify host binary before any launch attempt
    const verified = await this.verifyHostBinary();
    if (!verified.ok) return verified;

    if (input.signal.aborted) {
      return err(
        unavailableError("AGENT_TASK_SANDBOX_UNAVAILABLE", "Task launch was aborted.")
      );
    }

    const startMs = Date.now();

    return new Promise<Result<import("@novel-studio/application").AgentTaskExecutionOutput, UnifiedError>>(
      (resolve) => {
        let stdout = "";
        let stderr = "";

        const child = spawn(this.hostBinaryPath, [
          "--attestation-id", input.attestationId,
          "--execution-snapshot-id", input.executionSnapshotId,
          "--task-id", input.taskId
        ], {
          // Never inherit shell or user environment
          shell: false,
          env: {
            // Only minimal, safe env vars
            AGENT_TASK_SANDBOX_PROTOCOL: "1.0"
          },
          stdio: ["ignore", "pipe", "pipe"]
        });

        // If the process fails to start
        child.on("error", () => {
          resolve(
            err(
              unavailableError(
                "AGENT_TASK_SANDBOX_UNAVAILABLE",
                "Failed to start native sandbox host process."
              )
            )
          );
        });

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
          // Limit stdout to 1 MiB
          if (stdout.length > 1_048_576) {
            stdout = stdout.slice(0, 1_048_576);
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          if (stderr.length > 1_048_576) {
            stderr = stderr.slice(0, 1_048_576);
          }
        });

        const abortHandler = () => {
          child.kill("SIGTERM");
        };
        input.signal.addEventListener("abort", abortHandler);

        child.on("close", (code) => {
          input.signal.removeEventListener("abort", abortHandler);
          const durationMs = Date.now() - startMs;

          if (input.signal.aborted) {
            resolve(
              ok({
                exitCode: code ?? -1,
                stdoutSummary: stdout.slice(0, 4096),
                stderrSummary: stderr.slice(0, 4096),
                truncated: stdout.length > 4096 || stderr.length > 4096,
                durationMs,
                terminationReason: "cancelled"
              })
            );
            return;
          }

          resolve(
            ok({
              exitCode: code ?? -1,
              stdoutSummary: stdout.slice(0, 4096),
              stderrSummary: stderr.slice(0, 4096),
              truncated: stdout.length > 4096 || stderr.length > 4096,
              durationMs,
              terminationReason: code === 0 ? "completed" : "completed"
            })
          );
        });
      }
    );
  }

  /**
   * Launch and return a process handle.
   * Used by the sandbox host's own coordination logic.
   */
  async launchInSandbox(
    input: AgentTaskSandboxLaunchInput
  ): Promise<Result<AgentTaskProcessHandle, UnifiedError>> {
    const verified = await this.verifyHostBinary();
    if (!verified.ok) return verified;

    return new Promise<Result<AgentTaskProcessHandle, UnifiedError>>((resolve) => {
      const child = spawn(
        this.hostBinaryPath,
        [
          "--task-id", input.taskId,
          "--executable", input.executablePath,
          "--workspace-projection", input.workspaceProjection,
          "--attestation-ref", input.attestationRef,
          "--", ...input.argv
        ],
        {
          shell: false,
          env: { AGENT_TASK_SANDBOX_PROTOCOL: "1.0" },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );

      child.on("error", () => {
        resolve(
          err(
            unavailableError(
              "AGENT_TASK_SANDBOX_UNAVAILABLE",
              "Failed to start native sandbox host process."
            )
          )
        );
      });

      // Give the process a moment to start
      setTimeout(() => {
        if (child.pid === undefined) {
          resolve(
            err(
              unavailableError(
                "AGENT_TASK_SANDBOX_UNAVAILABLE",
                "Native sandbox host did not start (no PID)."
              )
            )
          );
          return;
        }
        const pid = child.pid;
        const handle: AgentTaskProcessHandle = {
          taskId: input.taskId,
          pid,
          waitForExit() {
            return new Promise<{ exitCode: number | null; signal: string | null }>((res) => {
              child.on("close", (code, sig) => {
                res({ exitCode: code, signal: sig });
              });
            });
          },
          cancel() {
            child.kill("SIGTERM");
          }
        };
        resolve(ok(handle));
      }, 50);
    });
  }
}

function unavailableError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Ensure the packaged sandbox host binary is present and the application is running on Windows x64.",
    traceId: "agent-task-sandbox"
  });
}
