import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary
} from "@novel-studio/shared";
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

export class HistoryRepository implements HistoryRepositoryPort, ChapterHistoryRepositoryPort {
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

  public async snapshotChapterVersion(
    input: ChapterVersionSnapshotInput
  ): Promise<Result<ChapterVersionSummary, UnifiedError>> {
    const snapshotResult = await this.snapshotTextAsset({
      assetType: "chapter",
      assetId: input.chapterId,
      reason: input.reason,
      content: input.body,
      ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
      ...(input.parentVersionId === undefined ? {} : { parentVersionId: input.parentVersionId })
    });

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    return ok({
      versionId: snapshotResult.value.versionId,
      reason: snapshotResult.value.reason,
      createdBy: snapshotResult.value.createdBy,
      createdAt: snapshotResult.value.createdAt,
      parentVersionId: snapshotResult.value.parentVersionId ?? null
    });
  }

  public async listChapterVersions(
    chapterId: string
  ): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>> {
    return this.listTextAssetSnapshots({
      assetType: "chapter",
      assetId: chapterId
    });
  }

  public async readChapterVersion(
    chapterId: string,
    versionId: string
  ): Promise<Result<ChapterVersionContent, UnifiedError>> {
    return this.readTextAssetSnapshot({
      assetType: "chapter",
      assetId: chapterId,
      versionId
    });
  }

  public async listTextAssetSnapshots(input: {
    assetType: "chapter";
    assetId: string;
  }): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>> {
    const historyDir = join(
      this.options.projectRoot,
      "history",
      `${input.assetType}s`,
      input.assetId
    );
    const recordDir = join(
      this.options.projectRoot,
      "history",
      `${input.assetType}s-records`,
      input.assetId
    );

    try {
      const entries = await readdir(recordDir, { withFileTypes: true });
      const versions = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const recordPath = join(recordDir, entry.name);
            const record = JSON.parse(await readFile(recordPath, "utf8")) as VersionRecord;
            return {
              versionId: record.versionId,
              reason: record.reason,
              createdBy: record.createdBy,
              createdAt: record.createdAt,
              parentVersionId: record.parentVersionId ?? null
            } satisfies ChapterVersionSummary;
          })
      );

      versions.sort((left, right) => {
        const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }

        return right.versionId.localeCompare(left.versionId);
      });

      return ok(versions);
    } catch (error) {
      if (isNodeMissingFileError(error)) {
        return ok([]);
      }

      return err(
        validationError({
          code: "VERSION_LIST_MISSING",
          message: "Chapter version list could not be read.",
          suggestedAction: "Create a chapter snapshot and retry.",
          traceId: this.traceId,
          redactedDetail: {
            historyDir,
            reason: error instanceof Error ? error.message : "Unknown history read error"
          }
        })
      );
    }
  }

  public async readTextAssetSnapshot(input: {
    assetType: "chapter";
    assetId: string;
    versionId: string;
  }): Promise<Result<ChapterVersionContent, UnifiedError>> {
    const snapshotPath = join(
      this.options.projectRoot,
      "history",
      `${input.assetType}s`,
      input.assetId,
      `${input.versionId}.md`
    );

    try {
      const content = await readFile(snapshotPath, "utf8");
      return ok({
        versionId: input.versionId,
        body: content,
        content
      });
    } catch (error) {
      return err(
        validationError({
          code: "VERSION_SNAPSHOT_MISSING",
          message: "Chapter version snapshot could not be read.",
          suggestedAction: "Restore the snapshot from history and retry.",
          traceId: this.traceId,
          redactedDetail: {
            snapshotPath,
            reason: error instanceof Error ? error.message : "Unknown snapshot read error"
          }
        })
      );
    }
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

function isNodeMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
