/**
 * Durable Main-owned receipt storage for creative file lifecycle commands. Receipts are scoped to
 * the workspace state root and contain the repository's command fingerprint, making retries safe
 * across process restarts while command-id reuse with a different payload remains fail-closed.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import {
  writeTextAtomically,
  type CreativeProjectFileLifecycleReceipt,
  type CreativeProjectFileReceiptStore
} from "@novel-studio/repository";
import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

const RECEIPT_DIRECTORY = join("agent", "creative-project-file-receipts");
const SCHEMA_VERSION = "1.0" as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CHECKSUM = /^[a-f0-9]{64}$/u;
const writeTails = new Map<string, Promise<void>>();

interface StoredReceiptFile {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly receipts: Record<string, CreativeProjectFileLifecycleReceipt>;
}

export function createDesktopCreativeProjectFileReceiptStore(input: {
  readonly stateRoot: string;
  readonly projectId: string;
  readonly workspaceId: string;
}): CreativeProjectFileReceiptStore {
  const targetPath = receiptFilePath(input);

  return {
    async readReceipt(commandId) {
      if (!isSafeId(commandId) || targetPath === undefined) {
        return err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID"));
      }
      await (writeTails.get(targetPath) ?? Promise.resolve()).catch(() => undefined);
      const stored = await readReceiptFile(targetPath, input);
      if (!stored.ok) return stored;
      const receipt = stored.value?.receipts[commandId];
      return receipt === undefined ? ok(undefined) : ok(receipt);
    },
    writeReceipt(receipt) {
      if (targetPath === undefined || !isReceiptForScope(receipt, input)) {
        return Promise.resolve(err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID")));
      }
      return enqueueWrite(targetPath, async () => {
        const current = await readReceiptFile(targetPath, input);
        if (!current.ok) return current;
        const existing = current.value?.receipts[receipt.commandId];
        if (existing !== undefined) {
          return sameReceipt(existing, receipt)
            ? ok(existing)
            : err(receiptStoreError("CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT"));
        }
        const next: StoredReceiptFile = {
          schemaVersion: SCHEMA_VERSION,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          receipts: {
            ...(current.value?.receipts ?? {}),
            [receipt.commandId]: receipt
          }
        };
        const written = await writeReceiptFile(targetPath, next);
        return written.ok ? ok(receipt) : written;
      });
    }
  };
}

function receiptFilePath(input: {
  readonly stateRoot: string;
  readonly projectId: string;
  readonly workspaceId: string;
}): string | undefined {
  if (!isAbsolute(input.stateRoot) || !isSafeId(input.projectId) || !isSafeId(input.workspaceId)) {
    return undefined;
  }
  const workspaceKey = checksum(`${input.projectId}\n${input.workspaceId}`);
  return join(input.stateRoot, RECEIPT_DIRECTORY, `${workspaceKey}.json`);
}

function enqueueWrite<T>(
  targetPath: string,
  operation: () => Promise<Result<T, UnifiedError>>
): Promise<Result<T, UnifiedError>> {
  const prior = writeTails.get(targetPath) ?? Promise.resolve();
  const result = prior.catch(() => undefined).then(operation);
  writeTails.set(
    targetPath,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

async function readReceiptFile(
  targetPath: string,
  identity: { readonly projectId: string; readonly workspaceId: string }
): Promise<Result<StoredReceiptFile | undefined, UnifiedError>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(targetPath, "utf8")) as unknown;
  } catch (error) {
    return isMissingFileError(error)
      ? ok(undefined)
      : err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID"));
  }
  const validated = parseReceiptFile(parsed, identity);
  return validated === undefined
    ? err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID"))
    : ok(validated);
}

async function writeReceiptFile(
  targetPath: string,
  contents: StoredReceiptFile
): Promise<Result<void, UnifiedError>> {
  try {
    await mkdir(dirname(targetPath), { recursive: true });
  } catch {
    return err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_WRITE_FAILED"));
  }
  const written = await writeTextAtomically({
    targetPath,
    content: `${JSON.stringify(contents, null, 2)}\n`,
    traceId: "desktop-creative-project-file-receipts"
  });
  return written.ok
    ? ok(undefined)
    : err(receiptStoreError("CREATIVE_PROJECT_FILE_RECEIPT_STORE_WRITE_FAILED"));
}

function parseReceiptFile(
  value: unknown,
  expected: { readonly projectId: string; readonly workspaceId: string }
): StoredReceiptFile | undefined {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== SCHEMA_VERSION ||
    value["projectId"] !== expected.projectId ||
    value["workspaceId"] !== expected.workspaceId ||
    !isRecord(value["receipts"])
  ) {
    return undefined;
  }
  const receipts: Record<string, CreativeProjectFileLifecycleReceipt> = {};
  for (const [commandId, receipt] of Object.entries(value["receipts"])) {
    if (!isSafeId(commandId) || !isReceiptForScope(receipt, expected) || receipt.commandId !== commandId) {
      return undefined;
    }
    receipts[commandId] = receipt;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: expected.projectId,
    workspaceId: expected.workspaceId,
    receipts
  };
}

function isReceiptForScope(
  value: unknown,
  expected: { readonly projectId: string; readonly workspaceId: string }
): value is CreativeProjectFileLifecycleReceipt {
  return (
    isRecord(value) &&
    value["schemaVersion"] === SCHEMA_VERSION &&
    isSafeId(value["commandId"]) &&
    (value["commandKind"] === "createTextFile" ||
      value["commandKind"] === "createDirectory" ||
      value["commandKind"] === "renamePath" ||
      value["commandKind"] === "deleteFile" ||
      value["commandKind"] === "deleteEmptyDirectory") &&
    typeof value["commandFingerprint"] === "string" &&
    CHECKSUM.test(value["commandFingerprint"]) &&
    value["projectId"] === expected.projectId &&
    value["workspaceId"] === expected.workspaceId &&
    typeof value["treeRevision"] === "string" &&
    value["treeRevision"].length > 0 &&
    Array.isArray(value["affectedPaths"]) &&
    value["affectedPaths"].every((path) => typeof path === "string")
  );
}

function sameReceipt(
  left: CreativeProjectFileLifecycleReceipt,
  right: CreativeProjectFileLifecycleReceipt
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.commandId === right.commandId &&
    left.commandKind === right.commandKind &&
    left.commandFingerprint === right.commandFingerprint &&
    left.projectId === right.projectId &&
    left.workspaceId === right.workspaceId &&
    left.treeRevision === right.treeRevision &&
    left.affectedPaths.length === right.affectedPaths.length &&
    left.affectedPaths.every((path, index) => path === right.affectedPaths[index])
  );
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function receiptStoreError(
  code:
    | "CREATIVE_PROJECT_FILE_RECEIPT_STORE_INVALID"
    | "CREATIVE_PROJECT_FILE_RECEIPT_STORE_WRITE_FAILED"
    | "CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT"
): UnifiedError {
  return createUnifiedError({
    code,
    category: code === "CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT" ? "ValidationError" : "StorageError",
    message:
      code === "CREATIVE_PROJECT_FILE_COMMAND_ID_CONFLICT"
        ? "A creative file lifecycle command ID was reused with different contents."
        : "Creative file lifecycle receipt storage is unavailable or invalid.",
    recoverability: "user-action",
    suggestedAction: "Reopen the workspace and retry the file operation.",
    traceId: "desktop-creative-project-file-receipts"
  });
}
