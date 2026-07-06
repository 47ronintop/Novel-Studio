import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { writeTextAtomically } from "./atomic-write.js";
import { storageError } from "./errors.js";
import type { UserPreferencesPort, UserPreferencesSnapshot } from "@novel-studio/shared";

export interface UserPreferencesFileRepositoryOptions {
  readonly userDataRoot: string;
  readonly traceId?: string;
}

export class UserPreferencesFileRepository implements UserPreferencesPort {
  private readonly traceId: string;

  public constructor(private readonly options: UserPreferencesFileRepositoryOptions) {
    this.traceId = options.traceId ?? "trace_repository_user_preferences";
  }

  public async readUserPreferences(): Promise<
    Result<UserPreferencesSnapshot | undefined, UnifiedError>
  > {
    try {
      const parsed = JSON.parse(await readFile(this.preferencesPath(), "utf8")) as unknown;
      if (!isUserPreferencesSnapshot(parsed)) {
        return ok(undefined);
      }

      return ok(parsed);
    } catch (error) {
      if (isMissingFileError(error)) {
        return ok(undefined);
      }

      return err(
        storageError({
          code: "USER_PREFERENCES_READ_FAILED",
          message: "User preferences could not be read.",
          suggestedAction: "Check local application data permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown read error"
          }
        })
      );
    }
  }

  public async writeUserPreferences(
    preferences: UserPreferencesSnapshot
  ): Promise<Result<UserPreferencesSnapshot, UnifiedError>> {
    const targetPath = this.preferencesPath();
    try {
      await mkdir(dirname(targetPath), { recursive: true });
    } catch (error) {
      return err(
        storageError({
          code: "USER_PREFERENCES_WRITE_FAILED",
          message: "User preferences directory could not be created.",
          suggestedAction: "Check local application data permissions and retry.",
          traceId: this.traceId,
          redactedDetail: {
            reason: error instanceof Error ? error.message : "Unknown mkdir error"
          }
        })
      );
    }

    const written = await writeTextAtomically({
      targetPath,
      content: `${JSON.stringify(preferences, null, 2)}\n`,
      traceId: this.traceId
    });
    if (!written.ok) {
      return written;
    }

    return ok(preferences);
  }

  private preferencesPath(): string {
    return join(this.options.userDataRoot, "user-preferences.json");
  }
}

function isUserPreferencesSnapshot(value: unknown): value is UserPreferencesSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record["schemaVersion"] === "1.0" && typeof record["onboarding"] === "object";
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
