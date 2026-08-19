import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTrustedCreativeFileOperationsPort,
  type AgentOperationPathSnapshot,
  type AgentWriteTrustedCreativeLifecycleMutation,
  type AgentWriteTrustedCreativeReplaceMutation
} from "@novel-studio/repository";

import {
  CREATIVE_FILE_OPERATION_BACKEND_ID,
  type CreativeFileOperation,
  type CreativeFileOperationCandidateEvidence,
  type CreativeFileOperationCandidateInspector
} from "./creative-file-operation-qualification.js";

const PROBE_SCHEMA_VERSION = "1.0" as const;
const PROBE_LIFETIME_MS = 60 * 60 * 1000;
const ORIGINAL = "creative-probe-original\n";
const CANDIDATE = "creative-probe-candidate\n";

interface CreativeFileOperationProbeReportV1 {
  readonly schemaVersion: typeof PROBE_SCHEMA_VERSION;
  readonly backendId: typeof CREATIVE_FILE_OPERATION_BACKEND_ID;
  readonly packageIdentityChecksum: string;
  readonly checkedAt: string;
  readonly operationStatus: Readonly<Record<CreativeFileOperation, "passed">>;
  readonly negativeControls: Readonly<{
    readonly managedPathRejected: "passed";
    readonly staleBaseRejected: "passed";
  }>;
  readonly reportChecksum: string;
}

/**
 * Main-owned probe for the standard trusted creative backend. It exercises every
 * operation against a fresh temporary project and never accepts renderer/model input.
 */
export function createMainOwnedCreativeFileOperationCandidateInspector(options?: {
  readonly packageIdentityChecksum: string;
  readonly now?: () => string;
}): CreativeFileOperationCandidateInspector {
  const now = options?.now ?? (() => new Date().toISOString());
  let reportPromise: Promise<CreativeFileOperationProbeReportV1> | undefined;

  return Object.freeze({
    async inspect(
      operation: CreativeFileOperation
    ): Promise<CreativeFileOperationCandidateEvidence> {
      reportPromise ??= runCreativeFileOperationProbe(options?.packageIdentityChecksum, now);
      try {
        const report = await reportPromise;
        const evidenceChecksum = sha256(
          stableSerialize({
            operation,
            reportChecksum: report.reportChecksum,
            schemaVersion: report.schemaVersion
          })
        );
        return {
          status: "qualified",
          evidenceChecksum,
          issuedAt: report.checkedAt,
          expiresAt: new Date(Date.parse(report.checkedAt) + PROBE_LIFETIME_MS).toISOString()
        };
      } catch {
        return { status: "unavailable", failureReasons: ["probe_failed"] as const };
      }
    }
  });
}

export async function runCreativeFileOperationProbe(
  packageIdentityChecksum: string | undefined,
  now: () => string = () => new Date().toISOString()
): Promise<CreativeFileOperationProbeReportV1> {
  const checkedAt = now();
  if (!isSha256(packageIdentityChecksum) || !isCanonicalUtcTimestamp(checkedAt)) {
    throw new Error("CREATIVE_FILE_OPERATION_PROBE_INVALID_IDENTITY");
  }

  const root = await mkdtemp(join(tmpdir(), "novel-studio-creative-operation-probe-"));
  try {
    await mkdir(join(root, "notes"));
    const port = createTrustedCreativeFileOperationsPort({
      workspaceKind: "creativeProject",
      projectRoot: root
    });
    if (port.mutate === undefined) {
      throw new Error("CREATIVE_FILE_OPERATION_PROBE_LIFECYCLE_UNAVAILABLE");
    }

    await writeFile(join(root, "notes", "replace.md"), ORIGINAL, "utf8");
    assertProbeResult(
      await port.replace(replaceMutation("notes/replace.md", ORIGINAL, CANDIDATE)),
      "replace_file"
    );
    assertText(await readFile(join(root, "notes", "replace.md"), "utf8"), CANDIDATE);

    assertProbeResult(
      await port.mutate(createFileMutation("notes/create.md", CANDIDATE)),
      "create_file"
    );
    assertText(await readFile(join(root, "notes", "create.md"), "utf8"), CANDIDATE);

    await writeFile(join(root, "notes", "move-source.md"), ORIGINAL, "utf8");
    assertProbeResult(
      await port.mutate(moveFileMutation("notes/move-source.md", "notes/move-target.md", ORIGINAL)),
      "move_file"
    );
    assertText(await readFile(join(root, "notes", "move-target.md"), "utf8"), ORIGINAL);

    assertProbeResult(
      await port.mutate(deleteFileMutation("notes/move-target.md", ORIGINAL)),
      "delete_file"
    );

    assertProbeResult(await port.mutate(createDirectoryMutation("drafts")), "create_directory");

    assertProbeRejection(
      await port.mutate(createFileMutation(".git/config.md", CANDIDATE)),
      "managed_path"
    );
    await writeFile(join(root, "notes", "stale.md"), CANDIDATE, "utf8");
    assertProbeRejection(
      await port.replace(replaceMutation("notes/stale.md", ORIGINAL, CANDIDATE)),
      "stale_base"
    );
    assertText(await readFile(join(root, "notes", "stale.md"), "utf8"), CANDIDATE);

    const operationStatus = Object.freeze({
      replace_file: "passed" as const,
      create_file: "passed" as const,
      move_file: "passed" as const,
      delete_file: "passed" as const,
      create_directory: "passed" as const
    });
    const unsigned = {
      schemaVersion: PROBE_SCHEMA_VERSION,
      backendId: CREATIVE_FILE_OPERATION_BACKEND_ID,
      packageIdentityChecksum,
      checkedAt,
      operationStatus,
      negativeControls: Object.freeze({
        managedPathRejected: "passed" as const,
        staleBaseRejected: "passed" as const
      })
    };
    return Object.freeze({
      ...unsigned,
      reportChecksum: sha256(stableSerialize(unsigned))
    });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
}

function replaceMutation(
  relativePath: string,
  before: string,
  after: string
): AgentWriteTrustedCreativeReplaceMutation {
  return {
    kind: "replace_file",
    phase: "apply",
    relativePath,
    content: after,
    before: [fileSnapshot(relativePath, before)],
    after: [fileSnapshot(relativePath, after)]
  };
}

function createFileMutation(
  relativePath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "create_file",
    relativePath,
    content,
    before: [missingSnapshot(relativePath)],
    after: [fileSnapshot(relativePath, content)]
  };
}

function moveFileMutation(
  sourcePath: string,
  targetPath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "move_file",
    sourcePath,
    targetPath,
    before: [fileSnapshot(sourcePath, content), missingSnapshot(targetPath)],
    after: [missingSnapshot(sourcePath), fileSnapshot(targetPath, content)]
  };
}

function deleteFileMutation(
  relativePath: string,
  content: string
): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "delete_file",
    relativePath,
    before: [fileSnapshot(relativePath, content)],
    after: [missingSnapshot(relativePath)]
  };
}

function createDirectoryMutation(relativePath: string): AgentWriteTrustedCreativeLifecycleMutation {
  return {
    kind: "create_directory",
    relativePath,
    before: [missingSnapshot(relativePath)],
    after: [{ kind: "directory", relativePath }]
  };
}

function fileSnapshot(relativePath: string, content: string): AgentOperationPathSnapshot {
  return {
    kind: "file",
    relativePath,
    content,
    checksum: sha256(content)
  };
}

function missingSnapshot(relativePath: string): AgentOperationPathSnapshot {
  return { kind: "missing", relativePath };
}

function assertProbeResult(
  result: { readonly ok: boolean; readonly error?: unknown },
  operation: CreativeFileOperation
): asserts result is { readonly ok: true } {
  if (!result.ok) {
    throw new Error(`CREATIVE_FILE_OPERATION_PROBE_${operation.toUpperCase()}_FAILED`);
  }
}

function assertProbeRejection(
  result: { readonly ok: boolean },
  control: "managed_path" | "stale_base"
): void {
  if (result.ok) {
    throw new Error(`CREATIVE_FILE_OPERATION_PROBE_${control.toUpperCase()}_NOT_REJECTED`);
  }
}

function assertText(actual: string, expected: string): void {
  if (actual !== expected) throw new Error("CREATIVE_FILE_OPERATION_PROBE_READBACK_FAILED");
}

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("CREATIVE_FILE_OPERATION_PROBE_NOT_SERIALIZABLE");
  return serialized;
}
