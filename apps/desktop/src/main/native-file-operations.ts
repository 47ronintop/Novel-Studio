/**
 * Main-process adapter for the Windows handle-based file lifecycle host.
 *
 * Node path operations cannot safely traverse a project root while rejecting
 * junction/reparse-point replacement races. This module only talks to the
 * signed, digest-verified native host over a bounded stdin/stdout protocol.
 * A missing or unqualified artifact is intentionally unavailable; callers must
 * not substitute node:fs mutations.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  AgentWriteLifecycleMutation,
  AgentWriteLifecycleOperationPort
} from "@novel-studio/repository";

export const NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION = "1.1";
export const NATIVE_FILE_OPERATIONS_MANIFEST_SCHEMA_VERSION = "1.0";

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const NATIVE_OPERATION_TIMEOUT_MS = 30_000;

export interface NativeFileOperationsManifest {
  readonly schemaVersion: typeof NATIVE_FILE_OPERATIONS_MANIFEST_SCHEMA_VERSION;
  readonly status: "qualified" | "unavailable";
  readonly protocolVersion: typeof NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION;
  readonly artifact: {
    readonly path: string;
    readonly digest: string;
  };
}

export interface NativeFileOperationsRootIdentity {
  readonly device: string;
  readonly inode: string;
}

interface VerifiedNativeFileOperationsArtifact {
  readonly absolutePath: string;
  readonly digest: string;
}

type NativeFileOperation = AgentWriteLifecycleMutation;

interface NativeFileOperationRequest {
  readonly schemaVersion: typeof NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION;
  readonly root: string;
  readonly rootIdentity: NativeFileOperationsRootIdentity;
  readonly operation: NativeFileOperation;
}

interface NativeFileOperationResponse {
  readonly schemaVersion: typeof NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION;
  readonly ok: boolean;
  readonly code?: string;
}

/** Test seam for the bounded native IPC transport. It is not exposed to renderer code. */
export interface NativeFileOperationsTransport {
  invoke(
    binaryPath: string,
    request: NativeFileOperationRequest
  ): Promise<NativeFileOperationResponse>;
}

interface NativeFileOperationsHostOptions {
  readonly artifact: VerifiedNativeFileOperationsArtifact;
  readonly transport?: NativeFileOperationsTransport;
  readonly skipArtifactVerificationForTesting?: boolean;
  readonly rootIdentityReader?: (
    root: string
  ) => Promise<Result<NativeFileOperationsRootIdentity, UnifiedError>>;
}

/**
 * Snapshot-bound lifecycle adapter for the trusted native process. The host
 * accepts no raw filesystem verbs: every mutation carries immutable before and
 * after snapshots from the approved Change Set.
 */
export class WindowsNativeFileOperations implements AgentWriteLifecycleOperationPort {
  private readonly transport: NativeFileOperationsTransport;
  private verifiedArtifact = false;

  private constructor(private readonly options: NativeFileOperationsHostOptions) {
    this.transport = options.transport ?? nativeFileOperationsTransport;
    this.verifiedArtifact = options.skipArtifactVerificationForTesting === true;
  }

  /** Production constructor. An unavailable source-tree manifest never enables the host. */
  static async fromPackagedResources(input: {
    readonly resourcesBase: string;
  }): Promise<Result<WindowsNativeFileOperations, UnifiedError>> {
    const verified = await loadVerifiedNativeFileOperationsArtifact(input.resourcesBase);
    return verified.ok
      ? ok(new WindowsNativeFileOperations({ artifact: verified.value }))
      : verified;
  }

  /**
   * Test-only constructor for protocol and error-mapping tests. Production code
   * must use fromPackagedResources so binary qualification cannot be skipped.
   */
  static forTesting(input: {
    readonly binaryPath?: string;
    readonly transport: NativeFileOperationsTransport;
    readonly rootIdentity?: NativeFileOperationsRootIdentity;
    readonly rootIdentityReader?: (
      root: string
    ) => Promise<Result<NativeFileOperationsRootIdentity, UnifiedError>>;
  }): WindowsNativeFileOperations {
    return new WindowsNativeFileOperations({
      artifact: {
        absolutePath: input.binaryPath ?? "native-file-operations-test-host",
        digest: "0".repeat(64)
      },
      transport: input.transport,
      skipArtifactVerificationForTesting: true,
      rootIdentityReader:
        input.rootIdentityReader ??
        (async () => ok(input.rootIdentity ?? { device: "1", inode: "2" }))
    });
  }

  async mutate(input: AgentWriteLifecycleMutation): Promise<Result<void, UnifiedError>> {
    void input;
    // The unbound host must never be passed to a transaction. A root-bound
    // facade is created by withProjectRoot, keeping root authority in Main.
    return err(lifecycleError("HOST_UNAVAILABLE"));
  }

  /** Binds this host to one immutable project root before it is given to a transaction. */
  async withProjectRoot(
    root: string
  ): Promise<Result<AgentWriteLifecycleOperationPort, UnifiedError>> {
    const identity = await (this.options.rootIdentityReader ?? readRootIdentity)(root);
    return identity.ok
      ? ok(new ProjectRootNativeFileOperations(this, root, identity.value))
      : identity;
  }

  async mutateAtRoot(
    root: string,
    rootIdentity: NativeFileOperationsRootIdentity,
    input: AgentWriteLifecycleMutation
  ): Promise<Result<void, UnifiedError>> {
    const response = await this.invoke({
      schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
      root,
      rootIdentity,
      operation: input
    });
    return response.ok ? ok(undefined) : err(lifecycleError(response.code));
  }

  private async invoke(request: NativeFileOperationRequest): Promise<NativeFileOperationResponse> {
    if (!(await this.verifyArtifact())) {
      return {
        schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
        ok: false,
        code: "HOST_UNAVAILABLE"
      };
    }
    try {
      return await this.transport.invoke(this.options.artifact.absolutePath, request);
    } catch {
      return {
        schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
        ok: false,
        code: "HOST_UNAVAILABLE"
      };
    }
  }

  private async verifyArtifact(): Promise<boolean> {
    if (this.verifiedArtifact) return true;
    const verified = await verifyRegularFileDigest(
      this.options.artifact.absolutePath,
      this.options.artifact.digest
    );
    if (verified) this.verifiedArtifact = true;
    return verified;
  }
}

class ProjectRootNativeFileOperations implements AgentWriteLifecycleOperationPort {
  public constructor(
    private readonly host: WindowsNativeFileOperations,
    private readonly root: string,
    private readonly rootIdentity: NativeFileOperationsRootIdentity
  ) {}

  mutate(input: AgentWriteLifecycleMutation): Promise<Result<void, UnifiedError>> {
    return this.host.mutateAtRoot(this.root, this.rootIdentity, input);
  }
}

async function readRootIdentity(
  root: string
): Promise<Result<NativeFileOperationsRootIdentity, UnifiedError>> {
  try {
    const stats = await lstat(root, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return err(lifecycleError("ROOT_IDENTITY_MISMATCH"));
    }
    return ok({ device: stats.dev.toString(), inode: stats.ino.toString() });
  } catch {
    return err(lifecycleError("ROOT_IDENTITY_MISMATCH"));
  }
}

export async function loadVerifiedNativeFileOperationsArtifact(
  resourcesBase: string
): Promise<Result<VerifiedNativeFileOperationsArtifact, UnifiedError>> {
  if (process.platform !== "win32") return err(unavailableError());
  const base = resolve(resourcesBase);
  const manifestPath = resolve(base, "native", "agent-file-operations", "manifest.json");
  if (!isContainedPath(base, manifestPath)) return err(unavailableError());

  let manifest: NativeFileOperationsManifest | undefined;
  try {
    manifest = parseNativeFileOperationsManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch {
    return err(unavailableError());
  }
  if (manifest === undefined || manifest.status !== "qualified") return err(unavailableError());

  let realBase: string;
  try {
    realBase = await realpath(base);
  } catch {
    return err(unavailableError());
  }
  const candidate = resolve(realBase, manifest.artifact.path);
  if (!isContainedPath(realBase, candidate)) return err(unavailableError());

  let stat: Awaited<ReturnType<typeof lstat>>;
  try {
    stat = await lstat(candidate);
  } catch {
    return err(unavailableError());
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return err(unavailableError());

  let absolutePath: string;
  try {
    absolutePath = await realpath(candidate);
  } catch {
    return err(unavailableError());
  }
  if (!isContainedPath(realBase, absolutePath)) return err(unavailableError());

  if (!(await verifyRegularFileDigest(absolutePath, manifest.artifact.digest))) {
    return err(unavailableError());
  }
  return ok({ absolutePath, digest: manifest.artifact.digest });
}

export function parseNativeFileOperationsManifest(
  value: unknown
): NativeFileOperationsManifest | undefined {
  if (!isRecord(value)) return undefined;
  const artifact = isRecord(value.artifact) ? value.artifact : undefined;
  const artifactPath = artifact?.path;
  const artifactDigest = artifact?.digest;
  const expectedKeys = new Set(["schemaVersion", "status", "protocolVersion", "artifact"]);
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key)) ||
    value.schemaVersion !== NATIVE_FILE_OPERATIONS_MANIFEST_SCHEMA_VERSION ||
    (value.status !== "qualified" && value.status !== "unavailable") ||
    value.protocolVersion !== NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION ||
    artifact === undefined ||
    Object.keys(artifact).length !== 2 ||
    !isSafeResourcePath(artifactPath) ||
    typeof artifactDigest !== "string" ||
    (value.status === "qualified" && !isSha256(artifactDigest)) ||
    (value.status === "unavailable" &&
      artifactDigest !== "placeholder" &&
      !isSha256(artifactDigest))
  ) {
    return undefined;
  }
  return {
    schemaVersion: NATIVE_FILE_OPERATIONS_MANIFEST_SCHEMA_VERSION,
    status: value.status,
    protocolVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
    artifact: { path: artifactPath, digest: artifactDigest }
  };
}

const nativeFileOperationsTransport: NativeFileOperationsTransport = {
  async invoke(binaryPath, request): Promise<NativeFileOperationResponse> {
    const encoded = Buffer.from(JSON.stringify(request), "utf8");
    if (encoded.byteLength > MAX_REQUEST_BYTES) {
      return nativeFailure("REQUEST_TOO_LARGE");
    }
    return new Promise((resolveResponse) => {
      let child: ChildProcess;
      try {
        child = spawn(binaryPath, [], {
          cwd: undefined,
          env: nativeHostEnvironment(),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
      } catch {
        resolveResponse(nativeFailure("HOST_UNAVAILABLE"));
        return;
      }

      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let stderrBytes = 0;
      let settled = false;
      const finish = (result: NativeFileOperationResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResponse(result);
      };
      const append = (
        current: Buffer<ArrayBufferLike>,
        chunk: Buffer<ArrayBufferLike>
      ): Buffer<ArrayBufferLike> | undefined => {
        const next = Buffer.concat([current, chunk]);
        return next.byteLength <= MAX_RESPONSE_BYTES ? next : undefined;
      };
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(nativeFailure("HOST_TIMEOUT"));
      }, NATIVE_OPERATION_TIMEOUT_MS);

      child.once("error", () => finish(nativeFailure("HOST_UNAVAILABLE")));
      child.stdin?.once("error", () => finish(nativeFailure("HOST_UNAVAILABLE")));
      child.stdout?.on("data", (chunk: Buffer<ArrayBufferLike>) => {
        const next = append(stdout, chunk);
        if (next === undefined) {
          child.kill("SIGTERM");
          finish(nativeFailure("HOST_OUTPUT_LIMIT"));
          return;
        }
        stdout = next;
      });
      child.stderr?.on("data", (chunk: Buffer<ArrayBufferLike>) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > MAX_RESPONSE_BYTES) {
          child.kill("SIGTERM");
          finish(nativeFailure("HOST_OUTPUT_LIMIT"));
          return;
        }
      });
      child.once("close", (exitCode) => {
        if (exitCode !== 0) {
          finish(parseNativeResponse(stdout) ?? nativeFailure("HOST_OPERATION_FAILED"));
          return;
        }
        finish(parseNativeResponse(stdout) ?? nativeFailure("HOST_PROTOCOL_INVALID"));
      });
      child.stdin?.end(encoded);
    });
  }
};

function parseNativeResponse(
  value: Buffer<ArrayBufferLike>
): NativeFileOperationResponse | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION) {
    return undefined;
  }
  if (parsed.ok === true) {
    return Object.keys(parsed).length === 2
      ? { schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION, ok: true }
      : undefined;
  }
  if (parsed.ok !== false || !isNativeErrorCode(parsed.code) || Object.keys(parsed).length !== 3) {
    return undefined;
  }
  return {
    schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION,
    ok: false,
    code: parsed.code
  };
}

function nativeFailure(code: string): NativeFileOperationResponse {
  return { schemaVersion: NATIVE_FILE_OPERATIONS_PROTOCOL_VERSION, ok: false, code };
}

function isNativeErrorCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9_]{1,80}$/u.test(value);
}

function nativeHostEnvironment(): NodeJS.ProcessEnv {
  const systemRoot = process.env["SystemRoot"] ?? process.env["WINDIR"];
  return systemRoot === undefined ? {} : { SystemRoot: systemRoot, WINDIR: systemRoot };
}

async function verifyRegularFileDigest(filePath: string, expectedDigest: string): Promise<boolean> {
  if (!isSha256(expectedDigest)) return false;
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const resolved = await realpath(filePath);
    const content = await readFile(resolved);
    return createHash("sha256").update(content).digest("hex") === expectedDigest;
  } catch {
    return false;
  }
}

function lifecycleError(nativeCode: string | undefined): UnifiedError {
  if (nativeCode === "PRECONDITION_FAILED") {
    return nativeError(
      "AGENT_WRITE_BASE_CONFLICT",
      "Agent file state changed before the protected operation could run.",
      "Review the latest file content before retrying."
    );
  }
  if (
    nativeCode === "PATH_REJECTED" ||
    nativeCode === "REPARSE_POINT_REJECTED" ||
    nativeCode === "HARDLINK_REJECTED" ||
    nativeCode === "ROOT_IDENTITY_MISMATCH"
  ) {
    return nativeError(
      "AGENT_WRITE_PATH_REJECTED",
      "The protected native file operation rejected this project path.",
      "Use an allowed project-relative path without links or reparse points."
    );
  }
  if (nativeCode === "ATOMIC_REPLACE_UNSUPPORTED" || nativeCode === "HOST_UNAVAILABLE") {
    return nativeError(
      "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED",
      "A qualified native file operation host is unavailable.",
      "Install a qualified Windows native file operation host and retry."
    );
  }
  return nativeError(
    "AGENT_WRITE_NATIVE_FILE_OPERATION_FAILED",
    "The protected native file operation did not complete.",
    "Review the file state and retry from the approved Change Set."
  );
}

function nativeError(code: string, message: string, suggestedAction: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "StorageError",
    message,
    recoverability: "user-action",
    suggestedAction,
    traceId: "native-file-operations"
  });
}

function unavailableError(): UnifiedError {
  return nativeError(
    "AGENT_WRITE_NATIVE_FILE_OPERATIONS_REQUIRED",
    "A qualified native file operation host is unavailable.",
    "Install a verified Windows native file operation artifact and retry."
  );
}

function isSafeResourcePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    isAbsolute(value)
  ) {
    return false;
  }
  if (/^[a-zA-Z]:/u.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return false;
  return value
    .split(/[\\/]+/u)
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":")
    );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function isContainedPath(base: string, candidate: string): boolean {
  const relativePath = relative(normalizePath(base), normalizePath(candidate));
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

function normalizePath(value: string): string {
  const normalized = value.startsWith("\\\\?\\UNC\\")
    ? `\\\\${value.slice("\\\\?\\UNC\\".length)}`
    : value.startsWith("\\\\?\\")
      ? value.slice("\\\\?\\".length)
      : value;
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
