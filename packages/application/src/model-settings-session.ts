import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export interface ModelProfile {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly apiKeyRef: string;
  readonly modelName: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly topP?: number;
  readonly timeoutMs: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
}

export interface ProjectSettings {
  readonly schemaVersion: "1.0";
  readonly autosave: JsonObject;
  readonly history: JsonObject;
  readonly models: {
    readonly defaultProfileId: string;
    readonly profiles: readonly ModelProfile[];
  };
}

export interface ProjectSettingsPort {
  readSettings(): Promise<Result<ProjectSettings, UnifiedError>>;
  writeSettings(settings: ProjectSettings): Promise<Result<ProjectSettings, UnifiedError>>;
}

export interface ModelConnectionResult {
  readonly ok: boolean;
  readonly provider: string;
  readonly modelName: string;
  readonly detail: string;
}

export interface ModelConnectionTester {
  testConnection(profile: ModelProfile): Promise<Result<ModelConnectionResult, UnifiedError>>;
}

export interface ModelSettingsSnapshot {
  readonly defaultProfileId: string;
  readonly profiles: readonly ModelProfile[];
}

export interface ModelSettingsSession {
  listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  saveModelProfile(
    profile: ModelProfile,
    options?: { readonly makeDefault?: boolean }
  ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  testModelProfileConnection(
    profileId: string
  ): Promise<Result<ModelConnectionResult, UnifiedError>>;
}

export interface ModelSettingsSessionOptions {
  readonly settingsPort: ProjectSettingsPort;
  readonly connectionTester?: ModelConnectionTester;
}

export function createModelSettingsSession(
  options: ModelSettingsSessionOptions
): ModelSettingsSession {
  return {
    async listModelProfiles() {
      const settings = await options.settingsPort.readSettings();
      if (!settings.ok) {
        return settings;
      }

      return ok(snapshotFromSettings(settings.value));
    },

    async saveModelProfile(profile, saveOptions = {}) {
      const settings = await options.settingsPort.readSettings();
      if (!settings.ok) {
        return settings;
      }

      const profiles = upsertProfile(settings.value.models.profiles, profile);
      const nextSettings: ProjectSettings = {
        ...settings.value,
        models: {
          defaultProfileId:
            saveOptions.makeDefault === true ? profile.id : settings.value.models.defaultProfileId,
          profiles
        }
      };
      const saved = await options.settingsPort.writeSettings(nextSettings);
      if (!saved.ok) {
        return saved;
      }

      return ok(snapshotFromSettings(saved.value));
    },

    async testModelProfileConnection(profileId) {
      if (options.connectionTester === undefined) {
        return err(
          createUnifiedError({
            code: "MODEL_CONNECTION_TEST_UNAVAILABLE",
            category: "UserError",
            message: "No model connection tester is configured.",
            recoverability: "user-action",
            suggestedAction: "Open settings in a runtime with an injected model tester.",
            traceId: "application-model-settings"
          })
        );
      }

      const settings = await options.settingsPort.readSettings();
      if (!settings.ok) {
        return settings;
      }
      const profile = settings.value.models.profiles.find((entry) => entry.id === profileId);
      if (profile === undefined) {
        return err(
          createUnifiedError({
            code: "MODEL_PROFILE_NOT_FOUND",
            category: "UserError",
            message: "The requested model profile does not exist.",
            recoverability: "user-action",
            suggestedAction: "Choose an existing model profile and retry.",
            traceId: "application-model-settings",
            redactedDetail: { profileId }
          })
        );
      }

      const result = await options.connectionTester.testConnection(profile);
      if (result.ok) {
        return result;
      }

      return err(
        createUnifiedError({
          code: "MODEL_CONNECTION_FAILED",
          category: "LLMAdapterError",
          message: result.error.message,
          recoverability: result.error.recoverability,
          suggestedAction: result.error.suggestedAction,
          traceId: result.error.traceId,
          redactedDetail: redactJsonObject({
            upstreamCode: result.error.code,
            ...(result.error.redactedDetail ?? {})
          })
        })
      );
    }
  };
}

function snapshotFromSettings(settings: ProjectSettings): ModelSettingsSnapshot {
  return {
    defaultProfileId: settings.models.defaultProfileId,
    profiles: settings.models.profiles
  };
}

function upsertProfile(
  profiles: readonly ModelProfile[],
  profile: ModelProfile
): readonly ModelProfile[] {
  const existingIndex = profiles.findIndex((entry) => entry.id === profile.id);
  if (existingIndex === -1) {
    return [...profiles, profile];
  }

  return profiles.map((entry) => (entry.id === profile.id ? profile : entry));
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
  if (typeof value === "string" && (value.startsWith("secret://") || /\bsk-/.test(value))) {
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
    normalized.includes("authorization") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  );
}
