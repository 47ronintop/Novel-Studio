import { createHash } from "node:crypto";
import { join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { writeTextAtomically } from "./atomic-write.js";
import { validationError } from "./errors.js";
import type { HistoryRepositoryPort, SnapshotTextAssetInput, VersionRecord } from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface HistoryRepositoryOptions {
  projectRoot: string;
  traceId?: string;
  now?: () => string;
  createVersionId?: () => string;
}

export class HistoryRepository implements HistoryRepositoryPort {
  private readonly traceId: string;
  private readonly now: () => string;
  private readonly createVersionId: () => string;

  public constructor(private readonly options: HistoryRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_history";
    this.now = options.now ?? (() => new Date().toISOString());
    this.createVersionId = options.createVersionId ?? (() => `ver_${Date.now()}`);
  }

  public async snapshotTextAsset(
    input: SnapshotTextAssetInput
  ): Promise<Result<VersionRecord, UnifiedError>> {
    const versionId = this.createVersionId();
    const record: VersionRecord = {
      schemaVersion: "1.0",
      versionId,
      assetType: input.assetType,
      assetId: input.assetId,
      reason: input.reason,
      createdBy: input.createdBy ?? "system",
      createdAt: this.now(),
      checksum: `sha256:${createHash("sha256").update(input.content).digest("hex")}`,
      snapshot: {
        kind: "text",
        path: this.snapshotRelativePath(input.assetType, input.assetId, versionId)
      }
    };

    if (input.parentVersionId !== undefined) {
      record.parentVersionId = input.parentVersionId;
    }

    const validation = await validateWithSchema("version-record", record);
    if (!validation.valid) {
      return err(
        validationError({
          code: "VERSION_RECORD_INVALID",
          message: "Version record failed schema validation.",
          suggestedAction: "Check snapshot metadata generation and retry.",
          traceId: this.traceId,
          redactedDetail: {
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

    const snapshotWrite = await writeTextAtomically({
      targetPath: join(
        this.options.projectRoot,
        this.snapshotRelativePath(input.assetType, input.assetId, versionId)
      ),
      content: input.content,
      traceId: this.traceId
    });
    if (!snapshotWrite.ok) {
      return snapshotWrite;
    }

    const recordWrite = await writeTextAtomically({
      targetPath: join(
        this.options.projectRoot,
        "history",
        `${this.assetHistoryDirectory(input.assetType)}-records`,
        input.assetId,
        `${versionId}.json`
      ),
      content: `${JSON.stringify(record, null, 2)}\n`,
      traceId: this.traceId
    });
    if (!recordWrite.ok) {
      return recordWrite;
    }

    return ok(record);
  }

  private snapshotRelativePath(assetType: string, assetId: string, versionId: string): string {
    const extension = assetType === "chapter" ? "md" : "json";
    return join(
      "history",
      this.assetHistoryDirectory(assetType),
      assetId,
      `${versionId}.${extension}`
    );
  }

  private assetHistoryDirectory(assetType: string): string {
    return assetType === "workflow" ? "workflow" : `${assetType}s`;
  }
}
