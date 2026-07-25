import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

export const SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION = "1.0";
export const SANDBOX_PROTOCOL_VERSION = "1.0";

export type SandboxArtifactKind = "host" | "probe";

export interface SandboxRuntimeArtifact {
  readonly kind: SandboxArtifactKind;
  readonly path: string;
  readonly digest: string;
}

export interface SandboxRuntimeManifest {
  readonly schemaVersion: typeof SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION;
  readonly status: "qualified" | "unavailable";
  readonly protocolVersion: typeof SANDBOX_PROTOCOL_VERSION;
  readonly policyRevision: string;
  readonly testVectorRevision: string;
  readonly artifacts: readonly SandboxRuntimeArtifact[];
}

export interface VerifiedSandboxRuntimeArtifact extends SandboxRuntimeArtifact {
  readonly absolutePath: string;
}

export interface VerifiedSandboxRuntimeBundle {
  readonly resourcesBase: string;
  readonly manifest: SandboxRuntimeManifest;
  readonly host: VerifiedSandboxRuntimeArtifact;
  readonly probe: VerifiedSandboxRuntimeArtifact;
}

/**
 * Loads the native sandbox bundle from Electron's resources directory.
 *
 * A source-tree placeholder is intentionally represented as status=unavailable.
 * It is never a usable runtime bundle, including on Windows.
 */
export async function loadVerifiedSandboxRuntimeBundle(
  resourcesBase: string
): Promise<Result<VerifiedSandboxRuntimeBundle, UnifiedError>> {
  const base = resolve(resourcesBase);
  const manifestPath = resolve(base, "native", "agent-task-sandbox", "manifest.json");
  if (!isContainedPath(base, manifestPath)) {
    return err(unavailableError("Sandbox manifest path escapes the resources directory."));
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return err(unavailableError("Sandbox runtime manifest is missing or malformed."));
  }

  const manifest = parseSandboxRuntimeManifest(manifestValue);
  if (manifest === undefined) {
    return err(unavailableError("Sandbox runtime manifest does not match the required schema."));
  }
  if (manifest.status !== "qualified") {
    return err(
      unavailableError(
        "Sandbox runtime is marked unavailable and cannot issue a production attestation."
      )
    );
  }

  let realBase: string;
  try {
    realBase = await realpath(base);
  } catch {
    return err(unavailableError("Cannot resolve the packaged resources directory."));
  }

  const verifiedArtifacts: Partial<Record<SandboxArtifactKind, VerifiedSandboxRuntimeArtifact>> =
    {};
  for (const artifact of manifest.artifacts) {
    const absolutePath = resolve(realBase, artifact.path);
    if (!isContainedPath(realBase, absolutePath)) {
      return err(
        unavailableError(`Sandbox ${artifact.kind} artifact path escapes packaged resources.`)
      );
    }

    let fileStat: Awaited<ReturnType<typeof lstat>>;
    try {
      fileStat = await lstat(absolutePath);
    } catch {
      return err(unavailableError(`Sandbox ${artifact.kind} artifact is missing.`));
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return err(unavailableError(`Sandbox ${artifact.kind} artifact is not a regular file.`));
    }

    let resolvedArtifact: string;
    try {
      resolvedArtifact = await realpath(absolutePath);
    } catch {
      return err(unavailableError(`Cannot resolve sandbox ${artifact.kind} artifact.`));
    }
    if (!isContainedPath(realBase, resolvedArtifact)) {
      return err(
        unavailableError(`Sandbox ${artifact.kind} artifact resolves outside packaged resources.`)
      );
    }

    const actualDigest = createHash("sha256")
      .update(await readFile(resolvedArtifact))
      .digest("hex");
    if (actualDigest !== artifact.digest) {
      return err(unavailableError(`Sandbox ${artifact.kind} artifact digest mismatch.`));
    }

    verifiedArtifacts[artifact.kind] = { ...artifact, absolutePath: resolvedArtifact };
  }

  const host = verifiedArtifacts.host;
  const probe = verifiedArtifacts.probe;
  if (host === undefined || probe === undefined) {
    return err(
      unavailableError("Sandbox bundle must contain exactly one host and one probe artifact.")
    );
  }

  return ok({ resourcesBase: realBase, manifest, host, probe });
}

export function parseSandboxRuntimeManifest(value: unknown): SandboxRuntimeManifest | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.schemaVersion !== SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION ||
    (value.status !== "qualified" && value.status !== "unavailable") ||
    value.protocolVersion !== SANDBOX_PROTOCOL_VERSION ||
    !isNonEmptyString(value.policyRevision) ||
    !isNonEmptyString(value.testVectorRevision) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 2
  ) {
    return undefined;
  }

  const artifacts: SandboxRuntimeArtifact[] = [];
  const kinds = new Set<SandboxArtifactKind>();
  for (const artifact of value.artifacts) {
    if (!isRecord(artifact)) return undefined;
    if ((artifact.kind !== "host" && artifact.kind !== "probe") || kinds.has(artifact.kind)) {
      return undefined;
    }
    if (!isSafeResourcePath(artifact.path) || !isSha256(artifact.digest)) return undefined;
    kinds.add(artifact.kind);
    artifacts.push({ kind: artifact.kind, path: artifact.path, digest: artifact.digest });
  }

  if (!kinds.has("host") || !kinds.has("probe")) return undefined;

  return {
    schemaVersion: SANDBOX_RUNTIME_MANIFEST_SCHEMA_VERSION,
    status: value.status,
    protocolVersion: SANDBOX_PROTOCOL_VERSION,
    policyRevision: value.policyRevision,
    testVectorRevision: value.testVectorRevision,
    artifacts
  };
}

export function isSafeResourcePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || value.includes("\0") || isAbsolute(value)) return false;
  if (/^[a-zA-Z]:/.test(value) || value.startsWith("\\\\") || value.startsWith("//")) return false;
  return value
    .split(/[\\/]+/)
    .every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":")
    );
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isContainedPath(base: string, candidate: string): boolean {
  const relativePath = relative(
    normalizePathForComparison(base),
    normalizePathForComparison(candidate)
  );
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !isAbsolute(relativePath)
  );
}

function normalizePathForComparison(path: string): string {
  const withoutDevicePrefix = path.startsWith("\\\\?\\UNC\\")
    ? `\\\\${path.slice("\\\\?\\UNC\\".length)}`
    : path.startsWith("\\\\?\\")
      ? path.slice("\\\\?\\".length)
      : path;
  return process.platform === "win32" ? withoutDevicePrefix.toLowerCase() : withoutDevicePrefix;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailableError(message: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_TASK_SANDBOX_UNAVAILABLE",
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction:
      "Install a production-qualified Windows sandbox bundle with a verified host and probe.",
    traceId: "agent-sandbox-runtime-manifest"
  });
}
