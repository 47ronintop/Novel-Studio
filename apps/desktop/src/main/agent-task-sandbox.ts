/**
 * The only task-related TypeScript module allowed to create a child process.
 * It starts a verified native host or probe, never a project executable directly.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { ok, err, createUnifiedError, type Result, type UnifiedError } from "@novel-studio/shared";
import type { AgentTaskSandboxPort } from "@novel-studio/application";
import {
  loadVerifiedSandboxRuntimeBundle,
  isSha256,
  type VerifiedSandboxRuntimeBundle
} from "./agent-sandbox-runtime-manifest.js";
import {
  parseSandboxQualificationEvidence,
  type SandboxQualificationBinding,
  type SandboxQualificationEvidence,
  type SandboxQualificationProbe
} from "./agent-sandbox-qualification.js";

const MAX_NATIVE_OUTPUT_BYTES = 1_048_576;
const QUALIFICATION_TIMEOUT_MS = 30_000;

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

export interface SandboxAttestationVerifier {
  isAttestationValid(attestationId: string): boolean | Promise<boolean>;
}

interface DirectTestHostOptions {
  readonly hostBinaryPath: string;
  readonly expectedHostDigest: string;
  readonly attestationVerifier?: SandboxAttestationVerifier;
}

interface PackagedHostOptions {
  readonly runtimeBundle: VerifiedSandboxRuntimeBundle;
  readonly attestationVerifier?: SandboxAttestationVerifier;
}

type AgentTaskSandboxHostOptions = DirectTestHostOptions | PackagedHostOptions;

/**
 * Adapter for the native Windows AppContainer host.
 *
 * `fromPackagedResources` is the production construction path. The direct-path
 * form exists for failure-injection tests only and cannot qualify a runtime because
 * it has no independently verified probe bundle.
 */
export class AgentTaskSandboxHost implements AgentTaskSandboxPort, SandboxQualificationProbe {
  private readonly hostBinaryPath: string;
  private readonly expectedHostDigest: string;
  private readonly runtimeBundle: VerifiedSandboxRuntimeBundle | undefined;
  private readonly attestationVerifier: SandboxAttestationVerifier | undefined;
  private verifiedDigest = false;

  private constructor(options: AgentTaskSandboxHostOptions) {
    this.runtimeBundle = "runtimeBundle" in options ? options.runtimeBundle : undefined;
    this.hostBinaryPath =
      "runtimeBundle" in options ? options.runtimeBundle.host.absolutePath : options.hostBinaryPath;
    this.expectedHostDigest =
      "runtimeBundle" in options ? options.runtimeBundle.host.digest : options.expectedHostDigest;
    this.attestationVerifier = options.attestationVerifier;
  }

  static async fromPackagedResources(options: {
    readonly resourcesBase: string;
    readonly attestationVerifier?: SandboxAttestationVerifier;
  }): Promise<Result<AgentTaskSandboxHost, UnifiedError>> {
    const runtimeBundle = await loadVerifiedSandboxRuntimeBundle(options.resourcesBase);
    if (!runtimeBundle.ok) return runtimeBundle;
    return ok(
      new AgentTaskSandboxHost({
        runtimeBundle: runtimeBundle.value,
        ...(options.attestationVerifier === undefined
          ? {}
          : { attestationVerifier: options.attestationVerifier })
      })
    );
  }

  /** Failure-injection factory. It has no bundled probe and can never launch a task. */
  static forTesting(options: DirectTestHostOptions): AgentTaskSandboxHost {
    return new AgentTaskSandboxHost(options);
  }

  /** Binding that a qualification service must match against native probe evidence. */
  getQualificationBinding(): SandboxQualificationBinding | undefined {
    if (this.runtimeBundle === undefined) return undefined;
    return {
      hostDigest: this.runtimeBundle.host.digest,
      probeDigest: this.runtimeBundle.probe.digest,
      protocolVersion: this.runtimeBundle.manifest.protocolVersion,
      policyRevision: this.runtimeBundle.manifest.policyRevision,
      testVectorRevision: this.runtimeBundle.manifest.testVectorRevision
    };
  }

  /** Verify the native host artifact again before every launch epoch. */
  async verifyHostBinary(): Promise<Result<string, UnifiedError>> {
    if (this.verifiedDigest) return ok(this.expectedHostDigest);
    if (!isSha256(this.expectedHostDigest)) {
      return err(
        unavailableError("Native sandbox host digest is absent, malformed, or a placeholder.")
      );
    }

    const verified = await verifyRegularFileDigest(
      this.hostBinaryPath,
      this.expectedHostDigest,
      "Native sandbox host"
    );
    if (!verified.ok) return verified;

    this.verifiedDigest = true;
    return ok(this.expectedHostDigest);
  }

  /**
   * Runs the independent native qualification probe. A direct test host never
   * has a probe and therefore cannot produce an attestation.
   */
  async run(): Promise<Result<SandboxQualificationEvidence, UnifiedError>> {
    if (this.runtimeBundle === undefined) {
      return err(
        unavailableError(
          "Sandbox qualification requires a verified packaged host and probe bundle."
        )
      );
    }

    const hostVerification = await this.verifyHostBinary();
    if (!hostVerification.ok) return hostVerification;

    const probeVerification = await verifyRegularFileDigest(
      this.runtimeBundle.probe.absolutePath,
      this.runtimeBundle.probe.digest,
      "Native sandbox qualification probe"
    );
    if (!probeVerification.ok) return probeVerification;

    const probeResult = await runNativeProcess(
      this.runtimeBundle.probe.absolutePath,
      [
        "--protocol-version",
        this.runtimeBundle.manifest.protocolVersion,
        "--mode",
        "qualification"
      ],
      QUALIFICATION_TIMEOUT_MS
    );
    if (!probeResult.ok) return probeResult;
    if (probeResult.value.exitCode !== 0 || probeResult.value.truncated) {
      return err(
        unavailableError("Native sandbox qualification probe did not complete successfully.")
      );
    }

    let rawEvidence: unknown;
    try {
      rawEvidence = JSON.parse(probeResult.value.stdout);
    } catch {
      return err(
        unavailableError("Native sandbox qualification probe returned malformed evidence.")
      );
    }

    const evidence = parseSandboxQualificationEvidence(rawEvidence);
    if (evidence === undefined) {
      return err(
        unavailableError("Native sandbox qualification probe returned an invalid evidence schema.")
      );
    }
    if (
      evidence.hostDigest !== this.runtimeBundle.host.digest ||
      evidence.probeDigest !== this.runtimeBundle.probe.digest ||
      evidence.protocolVersion !== this.runtimeBundle.manifest.protocolVersion ||
      evidence.policyRevision !== this.runtimeBundle.manifest.policyRevision ||
      evidence.testVectorRevision !== this.runtimeBundle.manifest.testVectorRevision
    ) {
      return err(
        unavailableError(
          "Native sandbox qualification evidence does not match the packaged bundle."
        )
      );
    }

    return ok(evidence);
  }

  async launch(input: {
    readonly taskId: string;
    readonly attestationId: string;
    readonly executionSnapshotId: string;
    readonly signal: AbortSignal;
  }): Promise<Result<import("@novel-studio/application").AgentTaskExecutionOutput, UnifiedError>> {
    const verified = await this.verifyHostBinary();
    if (!verified.ok) return verified;
    if (!(await this.hasValidAttestation(input.attestationId))) {
      return err(unavailableError("Task launch requires a current verified sandbox attestation."));
    }
    if (input.signal.aborted) {
      return err(unavailableError("Task launch was aborted before the native host started."));
    }

    const startMs = Date.now();
    const childResult = await startNativeHost(
      this.hostBinaryPath,
      [
        "--attestation-id",
        input.attestationId,
        "--execution-snapshot-id",
        input.executionSnapshotId,
        "--task-id",
        input.taskId
      ],
      input.signal
    );
    if (!childResult.ok) return childResult;

    const result = childResult.value;
    const durationMs = Date.now() - startMs;
    if (result.startError !== undefined) {
      return err(unavailableError("Failed to start the verified native sandbox host process."));
    }
    if (input.signal.aborted) {
      return ok({
        exitCode: result.exitCode ?? -1,
        stdoutSummary: result.stdout.slice(0, 4096),
        stderrSummary: result.stderr.slice(0, 4096),
        truncated: result.truncated || result.stdout.length > 4096 || result.stderr.length > 4096,
        durationMs,
        terminationReason: "cancelled"
      });
    }

    return ok({
      exitCode: result.exitCode ?? -1,
      stdoutSummary: result.stdout.slice(0, 4096),
      stderrSummary: result.stderr.slice(0, 4096),
      truncated: result.truncated || result.stdout.length > 4096 || result.stderr.length > 4096,
      durationMs,
      terminationReason: "completed"
    });
  }

  async launchInSandbox(
    input: AgentTaskSandboxLaunchInput
  ): Promise<Result<AgentTaskProcessHandle, UnifiedError>> {
    const verified = await this.verifyHostBinary();
    if (!verified.ok) return verified;
    if (!(await this.hasValidAttestation(input.attestationRef))) {
      return err(unavailableError("Task launch requires a current verified sandbox attestation."));
    }

    return new Promise<Result<AgentTaskProcessHandle, UnifiedError>>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(
          this.hostBinaryPath,
          [
            "--task-id",
            input.taskId,
            "--executable",
            input.executablePath,
            "--workspace-projection",
            input.workspaceProjection,
            "--attestation-ref",
            input.attestationRef,
            "--",
            ...input.argv
          ],
          nativeHostSpawnOptions()
        );
      } catch {
        resolve(err(unavailableError("Failed to start the verified native sandbox host process.")));
        return;
      }

      let exited = false;
      let exitCode: number | null = null;
      let exitSignal: string | null = null;
      const exitPromise = new Promise<{ exitCode: number | null; signal: string | null }>(
        (done) => {
          child.once("close", (code, signal) => {
            exited = true;
            exitCode = code;
            exitSignal = signal;
            done({ exitCode: code, signal });
          });
        }
      );

      child.once("error", () => {
        resolve(err(unavailableError("Failed to start the verified native sandbox host process.")));
      });

      queueMicrotask(() => {
        if (child.pid === undefined || exited) {
          resolve(err(unavailableError("Native sandbox host did not remain running.")));
          return;
        }
        resolve(
          ok({
            taskId: input.taskId,
            pid: child.pid,
            waitForExit() {
              return exited ? Promise.resolve({ exitCode, signal: exitSignal }) : exitPromise;
            },
            cancel() {
              // The native host owns a KILL_ON_JOB_CLOSE Job Object. Killing only the host
              // is intentional: the Job Object tears down the complete process tree.
              child.kill("SIGTERM");
            }
          })
        );
      });
    });
  }

  private async hasValidAttestation(attestationId: string): Promise<boolean> {
    if (
      this.runtimeBundle === undefined ||
      !attestationId ||
      this.attestationVerifier === undefined
    ) {
      return false;
    }
    try {
      return await this.attestationVerifier.isAttestationValid(attestationId);
    } catch {
      return false;
    }
  }
}

async function verifyRegularFileDigest(
  filePath: string,
  expectedDigest: string,
  label: string
): Promise<Result<string, UnifiedError>> {
  let fileStat: Awaited<ReturnType<typeof lstat>>;
  try {
    fileStat = await lstat(filePath);
  } catch {
    return err(unavailableError(`${label} binary is missing.`));
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    return err(unavailableError(`${label} must be a regular file, not a link.`));
  }

  let resolvedPath: string;
  try {
    resolvedPath = await realpath(filePath);
  } catch {
    return err(unavailableError(`Cannot resolve ${label} binary path.`));
  }

  let content: Buffer;
  try {
    content = await readFile(resolvedPath);
  } catch {
    return err(unavailableError(`Cannot read ${label} binary.`));
  }
  const actualDigest = createHash("sha256").update(content).digest("hex");
  if (actualDigest !== expectedDigest) {
    return err(unavailableError(`${label} digest mismatch.`));
  }
  return ok(actualDigest);
}

function nativeHostSpawnOptions(): SpawnOptions {
  return {
    shell: false,
    env: { AGENT_TASK_SANDBOX_PROTOCOL: "1.0" },
    stdio: ["ignore", "pipe", "pipe"]
  };
}

async function runNativeProcess(
  executable: string,
  argv: readonly string[],
  timeoutMs: number
): Promise<
  Result<
    { stdout: string; stderr: string; exitCode: number | null; truncated: boolean },
    UnifiedError
  >
> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, argv, nativeHostSpawnOptions());
    } catch {
      resolve(err(unavailableError("Failed to start the native sandbox qualification probe.")));
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    const finish = (
      result: Result<
        { stdout: string; stderr: string; exitCode: number | null; truncated: boolean },
        UnifiedError
      >
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const append = (current: string, chunk: Buffer): string => {
      if (truncated) return current;
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") <= MAX_NATIVE_OUTPUT_BYTES) return next;
      truncated = true;
      child.kill("SIGTERM");
      return next.slice(0, MAX_NATIVE_OUTPUT_BYTES);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(err(unavailableError("Native sandbox qualification probe timed out.")));
    }, timeoutMs);

    child.once("error", () =>
      finish(err(unavailableError("Failed to start the native sandbox qualification probe.")))
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("close", (exitCode) => finish(ok({ stdout, stderr, exitCode, truncated })));
  });
}

async function startNativeHost(
  executable: string,
  argv: readonly string[],
  signal: AbortSignal
): Promise<
  Result<
    {
      stdout: string;
      stderr: string;
      exitCode: number | null;
      truncated: boolean;
      startError?: true;
    },
    UnifiedError
  >
> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, argv, nativeHostSpawnOptions());
    } catch {
      resolve(err(unavailableError("Failed to start the verified native sandbox host process.")));
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    const finish = (
      result: Result<
        {
          stdout: string;
          stderr: string;
          exitCode: number | null;
          truncated: boolean;
          startError?: true;
        },
        UnifiedError
      >
    ) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      resolve(result);
    };
    const append = (current: string, chunk: Buffer): string => {
      if (truncated) return current;
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") <= MAX_NATIVE_OUTPUT_BYTES) return next;
      truncated = true;
      child.kill("SIGTERM");
      return next.slice(0, MAX_NATIVE_OUTPUT_BYTES);
    };
    const abort = () => child.kill("SIGTERM");

    signal.addEventListener("abort", abort, { once: true });
    child.once("error", () =>
      finish(ok({ stdout, stderr, exitCode: null, truncated, startError: true }))
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("close", (exitCode) => finish(ok({ stdout, stderr, exitCode, truncated })));
  });
}

function unavailableError(message: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_TASK_SANDBOX_UNAVAILABLE",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Install a production-qualified Windows sandbox bundle and re-run sandbox qualification.",
    traceId: "agent-task-sandbox"
  });
}
