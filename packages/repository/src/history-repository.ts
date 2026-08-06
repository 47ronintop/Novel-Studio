import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { parseChapterStatusTransitionProof } from "@novel-studio/agent-engine";
import {
  isStoryBibleV11AssetType,
  validateStoryAnalysisBundle,
  type StoryAnalysisBundle,
  type ValidationIssue
} from "@novel-studio/schemas";
import type {
  ChapterHistoryRepositoryPort,
  ChapterVersionContent,
  ChapterVersionSnapshotInput,
  ChapterVersionSummary
} from "@novel-studio/shared";
import {
  createProjectPathGuard,
  verifyProjectStoragePath,
  withProjectFileLock,
  writeTextAtomically,
  type ProjectPathGuard
} from "./atomic-write.js";
import { validationError } from "./errors.js";
import type {
  HistoryRepositoryPort,
  SnapshotTextAssetInput,
  StoryAnalysisHistoryRecord,
  StoryAnalysisHistoryRepositoryPort,
  StoryAnalysisHistorySummary,
  StoryBibleStatusTransitionRecord,
  VersionRecord,
  WriteStoryAnalysisHistoryInput,
  WorkflowRunRecord,
  WorkflowRunSummary
} from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface HistoryRepositoryOptions {
  projectRoot: string;
  traceId?: string;
  now?: () => string;
  createVersionId?: () => string;
  storyAnalysisLock?: {
    readonly staleAfterMs?: number;
    readonly waitTimeoutMs?: number;
    readonly retryDelayMs?: number;
  };
}

export class HistoryRepository
  implements HistoryRepositoryPort, StoryAnalysisHistoryRepositoryPort, ChapterHistoryRepositoryPort
{
  private readonly traceId: string;
  private readonly now: () => string;
  private readonly createVersionId: () => string;
  private readonly pathGuard: ProjectPathGuard;

  public constructor(private readonly options: HistoryRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_history";
    this.now = options.now ?? (() => new Date().toISOString());
    this.createVersionId =
      options.createVersionId ?? (() => `ver_${randomUUID().replaceAll("-", "")}`);
    this.pathGuard = createProjectPathGuard(options.projectRoot);
  }

  public async snapshotTextAsset(
    input: SnapshotTextAssetInput
  ): Promise<Result<VersionRecord, UnifiedError>> {
    const assetValidation = validateHistoryAssetId(input.assetType, input.assetId);
    if (!assetValidation.ok) {
      return assetValidation;
    }
    let chapterStatusTransitionProof: VersionRecord["chapterStatusTransitionProof"];
    if (input.chapterStatusTransitionProof !== undefined) {
      try {
        const proof = parseChapterStatusTransitionProof(input.chapterStatusTransitionProof);
        if (
          input.assetType !== "chapter" ||
          input.assetId !== proof.chapterId ||
          proof.stableRef !== `chapter:${proof.chapterId}`
        ) {
          throw new Error("Chapter transition proof target mismatch.");
        }
        chapterStatusTransitionProof = proof as VersionRecord["chapterStatusTransitionProof"];
      } catch {
        return err(
          validationError({
            code: "CHAPTER_STATUS_TRANSITION_PROOF_INVALID",
            message: "Chapter transition history proof failed validation.",
            suggestedAction: "Regenerate the chapter lifecycle proposal and retry.",
            traceId: this.traceId
          })
        );
      }
    }
    const versionId = this.createVersionId();
    const storyBibleStatusTransition = createStoryBibleStatusTransition(
      input.assetId,
      input.content,
      input.candidateContent
    );
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
      },
      ...(storyBibleStatusTransition === undefined ? {} : { storyBibleStatusTransition }),
      ...(chapterStatusTransitionProof === undefined ? {} : { chapterStatusTransitionProof })
    };

    if (input.parentVersionId !== undefined) {
      record.parentVersionId = input.parentVersionId;
    }
    if (input.runId !== undefined) record.runId = input.runId;
    if (input.checkpointId !== undefined) record.checkpointId = input.checkpointId;
    if (input.writeId !== undefined) record.writeId = input.writeId;
    if (input.relativePath !== undefined) record.targetRelativePath = input.relativePath;

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

    const snapshotPath = join(
      this.options.projectRoot,
      this.snapshotRelativePath(input.assetType, input.assetId, versionId)
    );
    const snapshotWrite = await writeTextAtomically({
      targetPath: snapshotPath,
      content: input.content,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    if (!snapshotWrite.ok) {
      return snapshotWrite;
    }

    const recordWrite = await writeTextAtomically({
      targetPath: join(
        this.options.projectRoot,
        "history",
        `${this.assetHistoryDirectory(input.assetType)}-records`,
        this.historyAssetKey(input.assetType, input.assetId),
        `${versionId}.json`
      ),
      content: `${JSON.stringify(record, null, 2)}\n`,
      traceId: this.traceId,
      pathGuard: this.pathGuard
    });
    if (!recordWrite.ok) {
      const cleanupPath = await verifyProjectStoragePath(
        this.pathGuard,
        snapshotPath,
        this.traceId
      );
      if (cleanupPath.ok) {
        try {
          await rm(snapshotPath, { force: true });
        } catch {
          // Preserve the record failure; an unlisted snapshot is never treated as a valid version.
        }
      }
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
      reason: input.reason,
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

  public async recordWorkflowRun(
    record: WorkflowRunRecord
  ): Promise<Result<WorkflowRunRecord, UnifiedError>> {
    const idValidation = validateWorkflowRunId(record.workflowRunId);
    if (!idValidation.ok) {
      return idValidation;
    }

    const issues = await validateWorkflowRunRecord(record);
    if (issues.length > 0) {
      return err(
        validationError({
          code: "WORKFLOW_RUN_RECORD_INVALID",
          message: "Workflow run record failed schema validation.",
          suggestedAction: "Check workflow run history metadata generation and retry.",
          traceId: this.traceId,
          redactedDetail: {
            issues: issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          }
        })
      );
    }
    if (hasStoryAnalysis(record)) {
      return err(storyAnalysisCasRequired(this.traceId));
    }

    const targetPath = this.workflowRunPath(record.workflowRunId);
    return withProjectFileLock(
      this.storyAnalysisWorkflowLockInput(record.workflowRunId),
      async () => {
        const existing = await this.readWorkflowRunIfPresent(targetPath);
        if (!existing.ok) return existing;
        if (existing.value !== undefined && hasStoryAnalysis(existing.value)) {
          return err(storyAnalysisCasRequired(this.traceId));
        }
        const write = await writeTextAtomically({
          targetPath,
          content: `${JSON.stringify(record, null, 2)}\n`,
          traceId: this.traceId,
          pathGuard: this.pathGuard
        });
        return write.ok ? ok(record) : write;
      }
    );
  }

  public async writeStoryAnalysis(
    input: WriteStoryAnalysisHistoryInput
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>> {
    const workflowRun = input.workflowRun;
    const idValidation = validateWorkflowRunId(workflowRun.workflowRunId);
    if (!idValidation.ok) return idValidation;
    if (
      !hasStoryAnalysis(workflowRun) ||
      (input.expectedChecksum !== null && !isChecksum(input.expectedChecksum))
    ) {
      return err(
        validationError({
          code: "STORY_ANALYSIS_WRITE_INVALID",
          message: "Story analysis history write input is invalid.",
          suggestedAction: "Provide a validated Story Analysis payload and its current checksum.",
          traceId: this.traceId
        })
      );
    }

    const issues = await validateWorkflowRunRecord(workflowRun);
    if (issues.length > 0) {
      return err(
        validationError({
          code: "STORY_ANALYSIS_RECORD_INVALID",
          message: "Story analysis failed workflow history validation.",
          suggestedAction: "Validate the analysis bundle before saving it.",
          traceId: this.traceId,
          redactedDetail: { issues: issues.map(toRedactedValidationIssue) }
        })
      );
    }

    const targetPath = this.workflowRunPath(workflowRun.workflowRunId);
    return withProjectFileLock(
      this.storyAnalysisWorkflowLockInput(workflowRun.workflowRunId),
      async () => {
        const initialCas = await this.verifyStoryAnalysisChecksum(
          targetPath,
          input.expectedChecksum
        );
        if (!initialCas.ok) return initialCas;

        const write = await writeTextAtomically({
          targetPath,
          content: `${JSON.stringify(workflowRun, null, 2)}\n`,
          traceId: this.traceId,
          pathGuard: this.pathGuard,
          beforeReplace: () => this.verifyStoryAnalysisChecksum(targetPath, input.expectedChecksum)
        });
        return write.ok ? ok(toStoryAnalysisHistoryRecord(workflowRun)) : write;
      }
    );
  }

  public async coordinateStoryAnalysisChapter<T>(
    chapterId: string,
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    if (!/^ch_[A-Za-z0-9_-]+$/u.test(chapterId)) {
      return err(
        validationError({
          code: "STORY_ANALYSIS_CHAPTER_ID_INVALID",
          message: "Story Analysis chapter coordination requires a valid chapter ID.",
          suggestedAction: "Reload the chapter and retry its analysis.",
          traceId: this.traceId
        })
      );
    }
    return withProjectFileLock(
      {
        lockPath: this.storyAnalysisLockPath("chapter", chapterId),
        pathGuard: this.pathGuard,
        traceId: this.traceId,
        staleAfterMs: this.options.storyAnalysisLock?.staleAfterMs ?? 2 * 60 * 60 * 1_000,
        waitTimeoutMs: this.options.storyAnalysisLock?.waitTimeoutMs ?? 10 * 60 * 1_000,
        retryDelayMs: this.options.storyAnalysisLock?.retryDelayMs ?? 50
      },
      operation
    );
  }

  public async listStoryAnalyses(): Promise<Result<StoryAnalysisHistorySummary[], UnifiedError>> {
    const runsDir = this.workflowRunsDirectory();
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, runsDir, this.traceId);
    if (!pathValidation.ok) return pathValidation;

    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => this.readWorkflowRunRecordFromPath(join(runsDir, entry.name)))
      );
      const summaries = records
        .filter(hasStoryAnalysis)
        .map(toStoryAnalysisHistorySummary)
        .sort((left, right) => {
          const updatedAtDiff = right.updatedAt.localeCompare(left.updatedAt);
          return updatedAtDiff === 0
            ? right.workflowRunId.localeCompare(left.workflowRunId)
            : updatedAtDiff;
        });
      return ok(summaries);
    } catch (error) {
      if (isNodeMissingFileError(error)) return ok([]);
      return err(
        validationError({
          code: "STORY_ANALYSIS_HISTORY_LIST_FAILED",
          message: "Story analysis history could not be read.",
          suggestedAction: "Retry or inspect the workflow run history files.",
          traceId: this.traceId,
          redactedDetail: {
            runsDir,
            reason: error instanceof Error ? error.message : "Unknown Story Analysis history error"
          }
        })
      );
    }
  }

  public async readStoryAnalysis(
    workflowRunId: string
  ): Promise<Result<StoryAnalysisHistoryRecord, UnifiedError>> {
    const idValidation = validateWorkflowRunId(workflowRunId);
    if (!idValidation.ok) return idValidation;

    try {
      const workflowRun = await this.readWorkflowRunRecordFromPath(
        this.workflowRunPath(workflowRunId)
      );
      if (!hasStoryAnalysis(workflowRun))
        throw new Error("Workflow run has no Story Analysis payload.");
      return ok(toStoryAnalysisHistoryRecord(workflowRun));
    } catch (error) {
      return err(
        validationError({
          code: "STORY_ANALYSIS_RECORD_MISSING",
          message: "Story analysis record could not be read.",
          suggestedAction: "Select an available Story Analysis run and retry.",
          traceId: this.traceId,
          redactedDetail: {
            workflowRunId,
            reason: error instanceof Error ? error.message : "Unknown Story Analysis read error"
          }
        })
      );
    }
  }

  public async listWorkflowRuns(): Promise<Result<WorkflowRunSummary[], UnifiedError>> {
    const runsDir = this.workflowRunsDirectory();
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, runsDir, this.traceId);
    if (!pathValidation.ok) return pathValidation;

    try {
      const entries = await readdir(runsDir, { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => this.readWorkflowRunRecordFromPath(join(runsDir, entry.name)))
      );

      const summaries = records.map(toWorkflowRunSummary);
      summaries.sort((left, right) => {
        const updatedAtDiff = right.updatedAt.localeCompare(left.updatedAt);
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }

        return right.workflowRunId.localeCompare(left.workflowRunId);
      });

      return ok(summaries);
    } catch (error) {
      if (isNodeMissingFileError(error)) {
        return ok([]);
      }

      return err(
        validationError({
          code: "WORKFLOW_RUN_HISTORY_LIST_FAILED",
          message: "Workflow run history could not be read.",
          suggestedAction: "Generate a new AI workflow run and retry.",
          traceId: this.traceId,
          redactedDetail: {
            runsDir,
            reason: error instanceof Error ? error.message : "Unknown workflow history read error"
          }
        })
      );
    }
  }

  public async readWorkflowRun(
    workflowRunId: string
  ): Promise<Result<WorkflowRunRecord, UnifiedError>> {
    const idValidation = validateWorkflowRunId(workflowRunId);
    if (!idValidation.ok) {
      return idValidation;
    }

    try {
      const record = await this.readWorkflowRunRecordFromPath(this.workflowRunPath(workflowRunId));
      return ok(record);
    } catch (error) {
      return err(
        validationError({
          code: "WORKFLOW_RUN_RECORD_MISSING",
          message: "Workflow run record could not be read.",
          suggestedAction: "Select an available workflow run from history and retry.",
          traceId: this.traceId,
          redactedDetail: {
            workflowRunId,
            reason: error instanceof Error ? error.message : "Unknown workflow run read error"
          }
        })
      );
    }
  }

  public async listTextAssetSnapshots(input: {
    assetType: "chapter" | "text";
    assetId: string;
  }): Promise<Result<readonly ChapterVersionSummary[], UnifiedError>> {
    const records = await this.listTextAssetSnapshotRecords(input);
    if (!records.ok) return records;
    return ok(
      records.value.map((record) => ({
        versionId: record.versionId,
        reason: record.reason as ChapterVersionSummary["reason"],
        createdBy: record.createdBy,
        createdAt: record.createdAt,
        parentVersionId: record.parentVersionId ?? null
      }))
    );
  }

  public async listTextAssetSnapshotRecords(input: {
    assetType: "chapter" | "text";
    assetId: string;
  }): Promise<Result<readonly VersionRecord[], UnifiedError>> {
    const assetValidation = validateHistoryAssetId(input.assetType, input.assetId);
    if (!assetValidation.ok) return assetValidation;
    const historyDir = join(
      this.options.projectRoot,
      "history",
      `${input.assetType}s`,
      this.historyAssetKey(input.assetType, input.assetId)
    );
    const recordDir = join(
      this.options.projectRoot,
      "history",
      `${input.assetType}s-records`,
      this.historyAssetKey(input.assetType, input.assetId)
    );
    const pathValidation = await verifyProjectStoragePath(this.pathGuard, recordDir, this.traceId);
    if (!pathValidation.ok) return pathValidation;

    try {
      const entries = await readdir(recordDir, { withFileTypes: true });
      const records = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const recordPath = join(recordDir, entry.name);
            return JSON.parse(await readFile(recordPath, "utf8")) as VersionRecord;
          })
      );

      records.sort((left, right) => {
        const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }

        return right.versionId.localeCompare(left.versionId);
      });

      return ok(records);
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
    assetType: "chapter" | "text";
    assetId: string;
    versionId: string;
  }): Promise<Result<ChapterVersionContent, UnifiedError>> {
    const assetValidation = validateHistoryAssetId(input.assetType, input.assetId);
    if (!assetValidation.ok) return assetValidation;
    const versionValidation = validateVersionId(input.versionId);
    if (!versionValidation.ok) return versionValidation;
    const snapshotPath = join(
      this.options.projectRoot,
      this.snapshotRelativePath(input.assetType, input.assetId, input.versionId)
    );
    const pathValidation = await verifyProjectStoragePath(
      this.pathGuard,
      snapshotPath,
      this.traceId
    );
    if (!pathValidation.ok) return pathValidation;

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
    const extension = assetType === "chapter" ? "md" : assetType === "text" ? "txt" : "json";
    return join(
      "history",
      this.assetHistoryDirectory(assetType),
      this.historyAssetKey(assetType, assetId),
      `${versionId}.${extension}`
    );
  }

  private historyAssetKey(assetType: string, assetId: string): string {
    if (assetType !== "text") {
      return assetId;
    }
    return `asset_${createHash("sha256").update(assetId, "utf8").digest("hex")}`;
  }

  private assetHistoryDirectory(assetType: string): string {
    return assetType === "workflow" ? "workflow" : `${assetType}s`;
  }

  private workflowRunsDirectory(): string {
    return join(this.options.projectRoot, "history", "workflows", "runs");
  }

  private workflowRunPath(workflowRunId: string): string {
    return join(this.workflowRunsDirectory(), `${workflowRunId}.json`);
  }

  private storyAnalysisWorkflowLockInput(workflowRunId: string) {
    return {
      lockPath: this.storyAnalysisLockPath("workflow", workflowRunId),
      pathGuard: this.pathGuard,
      traceId: this.traceId,
      staleAfterMs: this.options.storyAnalysisLock?.staleAfterMs ?? 5 * 60 * 1_000,
      waitTimeoutMs: this.options.storyAnalysisLock?.waitTimeoutMs ?? 30 * 1_000,
      retryDelayMs: this.options.storyAnalysisLock?.retryDelayMs ?? 25
    };
  }

  private storyAnalysisLockPath(scope: "chapter" | "workflow", identity: string): string {
    const key = createHash("sha256")
      .update(`${scope}\u0000${identity}`, "utf8")
      .digest("hex")
      .slice(0, 40);
    return join(
      this.options.projectRoot,
      ".novel-studio",
      "locks",
      "story-analysis",
      `${scope}-${key}.lock`
    );
  }

  private async readWorkflowRunIfPresent(
    path: string
  ): Promise<Result<WorkflowRunRecord | undefined, UnifiedError>> {
    try {
      return ok(await this.readWorkflowRunRecordFromPath(path));
    } catch (error) {
      if (isNodeMissingFileError(error)) return ok(undefined);
      return err(
        validationError({
          code: "WORKFLOW_RUN_CAS_READ_FAILED",
          message: "The existing workflow run could not be checked before writing.",
          suggestedAction: "Inspect the workflow history record and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown workflow CAS read error"
          }
        })
      );
    }
  }

  private async readWorkflowRunRecordFromPath(path: string): Promise<WorkflowRunRecord> {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    const issues = await validateWorkflowRunRecord(value);
    if (issues.length > 0) {
      throw new Error("Workflow run record failed schema validation.");
    }

    return value as WorkflowRunRecord;
  }

  private async verifyStoryAnalysisChecksum(
    path: string,
    expectedChecksum: string | null
  ): Promise<Result<void, UnifiedError>> {
    try {
      const current = await this.readWorkflowRunRecordFromPath(path);
      if (!hasStoryAnalysis(current)) {
        return err(storyAnalysisWorkflowIdConflict(this.traceId));
      }
      const currentChecksum = checksumStoryAnalysis(current.storyAnalysis);
      return currentChecksum === expectedChecksum
        ? ok(undefined)
        : err(storyAnalysisChecksumConflict(this.traceId, expectedChecksum, currentChecksum));
    } catch (error) {
      if (isNodeMissingFileError(error)) {
        return expectedChecksum === null
          ? ok(undefined)
          : err(storyAnalysisChecksumConflict(this.traceId, expectedChecksum, null));
      }
      return err(
        validationError({
          code: "STORY_ANALYSIS_CAS_READ_FAILED",
          message: "Story analysis could not be checked before writing.",
          suggestedAction: "Inspect the workflow run record and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown Story Analysis CAS read error"
          }
        })
      );
    }
  }
}

function validateHistoryAssetId(assetType: string, assetId: string): Result<void, UnifiedError> {
  if (assetType === "text") {
    const segments = assetId.split("/");
    if (
      assetId.length > 0 &&
      !assetId.includes("\\") &&
      !assetId.includes(":") &&
      segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    ) {
      return ok(undefined);
    }
  } else if (/^[A-Za-z0-9_-]+$/.test(assetId)) {
    return ok(undefined);
  }

  return err(
    validationError({
      code: "VERSION_ASSET_ID_INVALID",
      message: "Version asset id is not safe for history storage.",
      suggestedAction: "Use a stable asset id or canonical project-relative text path.",
      traceId: "trace_repository_history"
    })
  );
}

function isNodeMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function validateWorkflowRunId(workflowRunId: string): Result<void, UnifiedError> {
  if (/^[A-Za-z0-9_-]+$/.test(workflowRunId)) {
    return ok(undefined);
  }

  return err(
    validationError({
      code: "WORKFLOW_RUN_ID_INVALID",
      message: "Workflow run id is not a safe history file name.",
      suggestedAction:
        "Use a workflow run id containing only letters, numbers, dashes and underscores.",
      traceId: "trace_repository_history",
      redactedDetail: {
        workflowRunId
      }
    })
  );
}

function validateVersionId(versionId: string): Result<void, UnifiedError> {
  if (/^ver_[A-Za-z0-9_-]+$/u.test(versionId)) return ok(undefined);
  return err(
    validationError({
      code: "VERSION_ID_INVALID",
      message: "Version id is not a safe history file name.",
      suggestedAction: "Select a version recorded in project history.",
      traceId: "trace_repository_history"
    })
  );
}

function toWorkflowRunSummary(record: WorkflowRunRecord): WorkflowRunSummary {
  return {
    workflowRunId: record.workflowRunId,
    workflowTitle: record.workflowTitle,
    status: record.status,
    updatedAt: record.updatedAt,
    modelLabel: `${record.model.displayName} / ${record.model.modelName}`,
    usageLabel: `${record.usage.totalTokens} tokens · ${record.usage.usageStatus}`,
    costLabel: `${record.usage.cost.currency} ${record.usage.cost.amount.toFixed(6)} · ${
      record.usage.cost.status
    }`
  };
}

async function validateWorkflowRunRecord(value: unknown): Promise<ValidationIssue[]> {
  const structural = await validateWithSchema("workflow-run-record", value);
  if (!structural.valid) return structural.issues;
  if (!isRecord(value) || value["storyAnalysis"] === undefined) return [];
  return validateStoryAnalysisBundle(value["storyAnalysis"]).issues;
}

function hasStoryAnalysis(
  record: WorkflowRunRecord
): record is WorkflowRunRecord & { readonly storyAnalysis: Record<string, unknown> } {
  return isRecord(record.storyAnalysis);
}

function toStoryAnalysisHistoryRecord(
  workflowRun: WorkflowRunRecord & { readonly storyAnalysis: Record<string, unknown> }
): StoryAnalysisHistoryRecord {
  return {
    workflowRun,
    storyAnalysis: workflowRun.storyAnalysis as unknown as StoryAnalysisBundle,
    checksum: checksumStoryAnalysis(workflowRun.storyAnalysis)
  };
}

function toStoryAnalysisHistorySummary(
  workflowRun: WorkflowRunRecord & { readonly storyAnalysis: Record<string, unknown> }
): StoryAnalysisHistorySummary {
  const storyAnalysis = workflowRun.storyAnalysis as unknown as StoryAnalysisBundle;
  return {
    workflowRunId: workflowRun.workflowRunId,
    analysisRunId: storyAnalysis.analysisRun.analysisRunId,
    chapterId: storyAnalysis.analysisRun.chapter.chapterId,
    status: storyAnalysis.analysisRun.status,
    updatedAt: workflowRun.updatedAt,
    pendingSuggestionCount: storyAnalysis.records.filter(
      (record) => record.recordType === "change" && record.status === "pending"
    ).length,
    openIssueCount: storyAnalysis.records.filter(
      (record) => record.recordType === "review_issue" && record.status === "open"
    ).length,
    checksum: checksumStoryAnalysis(storyAnalysis)
  };
}

function checksumStoryAnalysis(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type StoryBibleStatus = "active" | "draft" | "archived" | "deleted";

interface StoryBibleStatusSnapshot {
  readonly assetId: string;
  readonly status: StoryBibleStatus;
  readonly revision: number;
}

function createStoryBibleStatusTransition(
  assetId: string,
  beforeContent: string,
  afterContent: string | undefined
): StoryBibleStatusTransitionRecord | undefined {
  if (afterContent === undefined) return undefined;
  const before = parseStoryBibleStatusSnapshot(beforeContent);
  const after = parseStoryBibleStatusSnapshot(afterContent);
  if (
    before === undefined ||
    after === undefined ||
    before.assetId !== assetId ||
    after.assetId !== assetId ||
    before.assetId !== after.assetId ||
    before.status === after.status ||
    after.revision <= before.revision
  ) {
    return undefined;
  }
  return {
    assetId,
    beforeStatus: before.status,
    afterStatus: after.status,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    afterChecksum: `sha256:${createHash("sha256").update(afterContent).digest("hex")}`
  };
}

function parseStoryBibleStatusSnapshot(content: string): StoryBibleStatusSnapshot | undefined {
  try {
    const value = JSON.parse(content) as unknown;
    if (
      !isRecord(value) ||
      (value["schemaVersion"] !== "1.0" && value["schemaVersion"] !== "1.1") ||
      typeof value["id"] !== "string" ||
      !isStoryBibleV11AssetType(value["type"]) ||
      !isStoryBibleStatus(value["status"])
    ) {
      return undefined;
    }
    const revision = value["revision"];
    if (revision === undefined && value["schemaVersion"] === "1.0") {
      return { assetId: value["id"], status: value["status"], revision: 0 };
    }
    return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0
      ? { assetId: value["id"], status: value["status"], revision }
      : undefined;
  } catch {
    return undefined;
  }
}

function isStoryBibleStatus(value: unknown): value is StoryBibleStatus {
  return value === "active" || value === "draft" || value === "archived" || value === "deleted";
}

function isChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function storyAnalysisChecksumConflict(
  traceId: string,
  expectedChecksum: string | null,
  currentChecksum: string | null
): UnifiedError {
  return validationError({
    code: "STORY_ANALYSIS_CHECKSUM_CONFLICT",
    message: "Story analysis changed before it could be saved.",
    suggestedAction: "Reload the analysis record, reapply the transition, and retry.",
    traceId,
    redactedDetail: { expectedChecksum, currentChecksum }
  });
}

function storyAnalysisCasRequired(traceId: string): UnifiedError {
  return validationError({
    code: "STORY_ANALYSIS_CAS_REQUIRED",
    message: "Story Analysis history must be written through its checksum-protected port.",
    suggestedAction: "Use writeStoryAnalysis with the current expected checksum.",
    traceId
  });
}

function storyAnalysisWorkflowIdConflict(traceId: string): UnifiedError {
  return validationError({
    code: "STORY_ANALYSIS_WORKFLOW_ID_CONFLICT",
    message: "The Story Analysis workflow ID is already used by a different workflow record.",
    suggestedAction: "Generate a new Story Analysis identity and retry.",
    traceId
  });
}

function toRedactedValidationIssue(issue: ValidationIssue): {
  readonly instancePath: string;
  readonly schemaPath: string;
  readonly keyword: string;
  readonly message: string;
} {
  return {
    instancePath: issue.instancePath,
    schemaPath: issue.schemaPath,
    keyword: issue.keyword,
    message: issue.message
  };
}
