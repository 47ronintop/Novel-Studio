import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import { writeTextAtomically } from "./atomic-write.js";
import { storageError, validationError } from "./errors.js";
import type { ProjectSettings } from "./ports.js";
import { validateWithSchema } from "./schema-validation.js";

export interface ProjectSettingsRepositoryOptions {
  readonly projectRoot: string;
  readonly traceId?: string;
}

export class ProjectSettingsRepository {
  private readonly traceId: string;

  public constructor(private readonly options: ProjectSettingsRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_settings";
  }

  public async readSettings(): Promise<Result<ProjectSettings, UnifiedError>> {
    const filePath = join(this.options.projectRoot, "settings.json");
    let parsed: unknown;

    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      return err(
        storageError({
          code: "SETTINGS_FILE_MISSING",
          message: "settings.json could not be read.",
          suggestedAction: "Restore settings.json or choose a valid Novel Studio project folder.",
          traceId: this.traceId,
          redactedDetail: {
            fileName: "settings.json",
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }

    return this.validateSettings(parsed);
  }

  public async writeSettings(
    settings: ProjectSettings
  ): Promise<Result<ProjectSettings, UnifiedError>> {
    const validation = await this.validateSettings(settings);
    if (!validation.ok) {
      return validation;
    }

    const writeResult = await writeTextAtomically({
      targetPath: join(this.options.projectRoot, "settings.json"),
      content: `${JSON.stringify(validation.value, null, 2)}\n`,
      traceId: this.traceId
    });

    if (!writeResult.ok) {
      return writeResult;
    }

    return ok(validation.value);
  }

  private async validateSettings(
    settings: unknown
  ): Promise<Result<ProjectSettings, UnifiedError>> {
    const validation = await validateWithSchema("settings", settings);
    if (!validation.valid) {
      return err(
        validationError({
          code: "SETTINGS_FILE_INVALID",
          message: "settings.json failed schema validation.",
          suggestedAction: "Fix project settings and retry.",
          traceId: this.traceId,
          redactedDetail: redactJsonObject({
            fileName: "settings.json",
            issues: validation.issues.map((issue) => ({
              instancePath: issue.instancePath,
              schemaPath: issue.schemaPath,
              keyword: issue.keyword,
              message: issue.message
            }))
          })
        })
      );
    }

    return ok(settings as ProjectSettings);
  }
}

function redactJsonObject(value: JsonObject): JsonObject {
  const redacted: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = redactJsonValue(key, entry);
  }
  return redacted;
}

function redactJsonValue(key: string, value: JsonValue): JsonValue {
  if (isSecretKey(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonValue(key, entry));
  }
  if (isJsonObject(value)) {
    return redactJsonObject(value);
  }
  if (typeof value === "string" && looksLikeSecret(value)) {
    return "[REDACTED]";
  }
  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("apikey") ||
    normalized.includes("api_key") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("authorization")
  );
}

function looksLikeSecret(value: string): boolean {
  return /\bsk-[A-Za-z0-9_-]+/.test(value);
}
