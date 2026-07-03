import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import type {
  ProjectMetadata,
  ProjectRepositoryPort,
  ProjectSettings,
  ProjectSnapshot
} from "./ports.js";
import { storageError, validationError } from "./errors.js";
import { validateWithSchema } from "./schema-validation.js";

export interface ProjectFileRepositoryOptions {
  projectRoot: string;
  traceId?: string;
}

export class ProjectFileRepository implements ProjectRepositoryPort {
  private readonly traceId: string;

  public constructor(private readonly options: ProjectFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_project";
  }

  public async openProject(): Promise<Result<ProjectSnapshot, UnifiedError>> {
    const projectResult = await this.readAndValidate<ProjectMetadata>("project.json", "project");
    if (!projectResult.ok) {
      return projectResult;
    }

    const settingsResult = await this.readAndValidate<ProjectSettings>("settings.json", "settings");
    if (!settingsResult.ok) {
      return settingsResult;
    }

    return ok({
      project: projectResult.value,
      settings: settingsResult.value
    });
  }

  private async readAndValidate<T>(
    fileName: string,
    schemaName: string
  ): Promise<Result<T, UnifiedError>> {
    const filePath = join(this.options.projectRoot, fileName);
    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      return err(
        storageError({
          code: "PROJECT_FILE_MISSING",
          message: `${fileName} could not be read.`,
          suggestedAction: `Restore ${fileName} or choose a valid Novel Studio project folder.`,
          traceId: this.traceId,
          redactedDetail: {
            fileName,
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    const validation = await validateWithSchema(schemaName, parsed);
    if (!validation.valid) {
      return err(
        validationError({
          code: "PROJECT_FILE_INVALID",
          message: `${fileName} failed schema validation.`,
          suggestedAction: `Fix ${fileName} and retry opening the project.`,
          traceId: this.traceId,
          redactedDetail: {
            fileName,
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

    return ok(parsed as T);
  }
}
