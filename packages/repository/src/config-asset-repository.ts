import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type JsonObject, type Result, type UnifiedError } from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import type { AssetType, CreatedBy, HistoryRepositoryPort, VersionRecord } from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export type ConfigAssetType = Extract<AssetType, "prompt" | "agent" | "workflow">;

export interface ConfigAssetRepositoryOptions {
  readonly projectRoot: string;
  readonly historyRepository: HistoryRepositoryPort;
  readonly traceId?: string;
}

export interface WriteConfigAssetInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly content: JsonObject;
  readonly createdBy?: CreatedBy;
}

export interface RestoreConfigAssetVersionInput {
  readonly assetType: ConfigAssetType;
  readonly assetId: string;
  readonly versionId: string;
  readonly createdBy?: CreatedBy;
}

export class ConfigAssetRepository {
  private readonly traceId: string;

  public constructor(private readonly options: ConfigAssetRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_config_asset";
  }

  public async readConfigAsset(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<JsonObject, UnifiedError>> {
    const readResult = await this.readConfigAssetText(assetType, assetId);
    if (!readResult.ok) {
      return readResult;
    }

    return this.parseAndValidate(assetType, readResult.value);
  }

  public async writeConfigAsset(
    input: WriteConfigAssetInput
  ): Promise<Result<VersionRecord, UnifiedError>> {
    const validation = await this.validateAsset(input.assetType, input.content);
    if (!validation.ok) {
      return validation;
    }

    const current = await this.readConfigAssetText(input.assetType, input.assetId);
    if (!current.ok) {
      return current;
    }

    const snapshot = await this.options.historyRepository.snapshotTextAsset({
      assetType: input.assetType,
      assetId: input.assetId,
      reason: "manual-save",
      content: current.value,
      createdBy: input.createdBy ?? "user"
    });
    if (!snapshot.ok) {
      return snapshot;
    }

    const writeResult = await writeTextAtomically({
      targetPath: this.assetPath(input.assetType, input.assetId),
      content: `${JSON.stringify(input.content, null, 2)}\n`,
      traceId: this.traceId
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    return snapshot;
  }

  public async restoreConfigAssetVersion(
    input: RestoreConfigAssetVersionInput
  ): Promise<Result<JsonObject, UnifiedError>> {
    const current = await this.readConfigAssetText(input.assetType, input.assetId);
    if (!current.ok) {
      return current;
    }

    const beforeRollback = await this.options.historyRepository.snapshotTextAsset({
      assetType: input.assetType,
      assetId: input.assetId,
      reason: "before-rollback",
      content: current.value,
      createdBy: input.createdBy ?? "user"
    });
    if (!beforeRollback.ok) {
      return beforeRollback;
    }

    let snapshotText: string;
    try {
      snapshotText = await readFile(
        join(
          this.options.projectRoot,
          "history",
          this.historyDirectory(input.assetType),
          input.assetId,
          `${input.versionId}.json`
        ),
        "utf8"
      );
    } catch (error) {
      return err(
        storageError({
          code: "CONFIG_ASSET_VERSION_MISSING",
          message: "Config asset version snapshot could not be read.",
          suggestedAction: "Choose an existing config asset version and retry.",
          traceId: this.traceId,
          redactedDetail: {
            assetType: input.assetType,
            assetId: input.assetId,
            versionId: input.versionId,
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    const parsed = await this.parseAndValidate(input.assetType, snapshotText);
    if (!parsed.ok) {
      return parsed;
    }

    const writeResult = await writeTextAtomically({
      targetPath: this.assetPath(input.assetType, input.assetId),
      content: `${JSON.stringify(parsed.value, null, 2)}\n`,
      traceId: this.traceId
    });
    if (!writeResult.ok) {
      return writeResult;
    }

    return parsed;
  }

  private async readConfigAssetText(
    assetType: ConfigAssetType,
    assetId: string
  ): Promise<Result<string, UnifiedError>> {
    try {
      return ok(await readFile(this.assetPath(assetType, assetId), "utf8"));
    } catch (error) {
      return err(
        storageError({
          code: "CONFIG_ASSET_MISSING",
          message: "Config asset could not be read.",
          suggestedAction: "Restore the config asset file and retry.",
          traceId: this.traceId,
          redactedDetail: {
            assetType,
            assetId,
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }
  }

  private async parseAndValidate(
    assetType: ConfigAssetType,
    content: string
  ): Promise<Result<JsonObject, UnifiedError>> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return err(
        validationError({
          code: "CONFIG_ASSET_INVALID",
          message: "Config asset JSON could not be parsed.",
          suggestedAction: "Fix the config asset JSON and retry.",
          traceId: this.traceId,
          redactedDetail: { assetType }
        })
      );
    }

    if (!isJsonObject(parsed)) {
      return err(
        validationError({
          code: "CONFIG_ASSET_INVALID",
          message: "Config asset must be a JSON object.",
          suggestedAction: "Replace the config asset with a valid JSON object.",
          traceId: this.traceId,
          redactedDetail: { assetType }
        })
      );
    }

    return this.validateAsset(assetType, parsed);
  }

  private async validateAsset(
    assetType: ConfigAssetType,
    content: JsonObject
  ): Promise<Result<JsonObject, UnifiedError>> {
    const validation = await validateWithSchema(this.schemaName(assetType), content);
    if (!validation.valid) {
      return err(
        validationError({
          code: "CONFIG_ASSET_INVALID",
          message: "Config asset failed schema validation.",
          suggestedAction: "Fix the config asset before making it active.",
          traceId: this.traceId,
          redactedDetail: {
            assetType,
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

    return ok(content);
  }

  private assetPath(assetType: ConfigAssetType, assetId: string): string {
    return join(this.options.projectRoot, this.activeDirectory(assetType), `${assetId}.json`);
  }

  private activeDirectory(assetType: ConfigAssetType): string {
    return assetType === "workflow" ? "workflow" : `${assetType}s`;
  }

  private historyDirectory(assetType: ConfigAssetType): string {
    return assetType === "workflow" ? "workflow" : `${assetType}s`;
  }

  private schemaName(assetType: ConfigAssetType): string {
    switch (assetType) {
      case "prompt":
        return "prompt-template";
      case "agent":
        return "agent-config";
      case "workflow":
        return "workflow-definition";
    }
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
