import { join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import type { RecoveryRecord, RecoveryRepositoryPort } from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface RecoveryRepositoryOptions {
  projectRoot: string;
  traceId?: string;
}

export class RecoveryRepository implements RecoveryRepositoryPort {
  private readonly traceId: string;

  public constructor(private readonly options: RecoveryRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_recovery";
  }

  public async writeRecoveryRecord(
    record: RecoveryRecord
  ): Promise<Result<RecoveryRecord, UnifiedError>> {
    const validation = await validateWithSchema("recovery-record", record);
    if (!validation.valid) {
      return err(
        validationError({
          code: "RECOVERY_RECORD_INVALID",
          message: "Recovery record failed schema validation.",
          suggestedAction: "Fix recovery metadata before writing it.",
          traceId: this.traceId,
          redactedDetail: {
            sessionId: record.sessionId,
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }

    const writeResult = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, "history", "recovery", `${record.sessionId}.json`),
      content: `${JSON.stringify(record, null, 2)}\n`,
      traceId: this.traceId
    });

    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(record);
  }

  public async listRecoveryRecords(): Promise<Result<readonly RecoveryRecord[], UnifiedError>> {
    const recoveryDirectory = join(this.options.projectRoot, "history", "recovery");
    let entries: readonly string[];

    try {
      entries = await readdir(recoveryDirectory);
    } catch (error) {
      if (isMissingDirectoryError(error)) {
        return ok([]);
      }

      return err(
        storageError({
          code: "RECOVERY_DIRECTORY_READ_FAILED",
          message: "Recovery records could not be read.",
          suggestedAction: "Check project folder permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown readdir error"
          }
        })
      );
    }

    const records: RecoveryRecord[] = [];
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      const filePath = join(recoveryDirectory, entry);
      let parsed: unknown;

      try {
        parsed = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        return err(
          storageError({
            code: "RECOVERY_RECORD_READ_FAILED",
            message: "A recovery record could not be read.",
            suggestedAction: "Inspect the recovery record or restore it from backup.",
            traceId: this.traceId,
            redactedDetail: {
              fileName: entry,
              reason: error instanceof Error ? error.message : "Unknown read error"
            }
          })
        );
      }

      const validation = await validateWithSchema("recovery-record", parsed);
      if (!validation.valid) {
        return err(
          validationError({
            code: "RECOVERY_RECORD_INVALID",
            message: "Recovery record failed schema validation.",
            suggestedAction: "Fix recovery metadata before reading it.",
            traceId: this.traceId,
            redactedDetail: {
              fileName: entry,
              issues: validation.issues.map((issue) => ({
                instancePath: issue.instancePath,
                schemaPath: issue.schemaPath,
                keyword: issue.keyword,
                message: issue.message
              }))
            }
          })
        );
      }

      records.push(parsed as RecoveryRecord);
    }

    return ok(records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
