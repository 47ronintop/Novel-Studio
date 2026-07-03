import { join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { writeTextAtomically } from "./atomic-write.js";
import { validationError } from "./errors.js";
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
}
