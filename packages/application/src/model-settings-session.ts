import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";
import type {
  LlmModelProfile,
  LlmParameters,
  LlmReasoningCapability
} from "@novel-studio/llm-adapter";
import { createModelDiscoveryFallback } from "./model-discovery-session.js";
import type {
  ModelDiscoveryPort,
  ModelDiscoveryRequestOptions,
  ModelDiscoverySnapshot
} from "./model-discovery-session.js";
import { isModelProvider, type ModelProvider } from "./model-provider-catalog.js";

export type PromptCachePreference = "auto" | "enabled" | "disabled";

export interface ModelProfile extends JsonObject {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly baseUrl?: string;
  readonly apiKeyRef: string;
  readonly modelName: string;
  /** Verified input context capacity for the configured model; distinct from output maxTokens. */
  readonly contextWindow?: number;
  readonly temperature: number;
  /** Optional output-token cap. Omitted means the provider/model default. */
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly timeoutMs: number;
  readonly frequencyPenalty?: number;
  readonly presencePenalty?: number;
  readonly reasoningEffortEnabled?: boolean;
  /** Missing preferences from older settings use the automatic capability policy. */
  readonly promptCachePreference?: PromptCachePreference;
}

export interface AutosaveSettings extends JsonObject {
  readonly enabled: boolean;
  readonly intervalMs: number;
  readonly createHistorySnapshot?: boolean;
}

export interface HistorySettings extends JsonObject {
  readonly snapshotPolicy:
    "manual-only" | "interval-only" | "manual-and-interval" | "on-save-and-manual";
  readonly intervalMinutes?: number;
  readonly maxSnapshotsPerChapter?: number | null;
}

export type StoryAnalysisCompletionMode = "off" | "prompt" | "background-review";
export type StoryBibleMaintenanceMode = "review" | "safe-auto";

export interface StoryAnalysisSettings extends JsonObject {
  completionMode: StoryAnalysisCompletionMode;
  storyBibleMaintenanceMode: StoryBibleMaintenanceMode;
}

interface StoredStoryAnalysisSettings extends JsonObject {
  completionMode: StoryAnalysisCompletionMode;
  storyBibleMaintenanceMode?: StoryBibleMaintenanceMode;
}

export interface ModelSettings extends JsonObject {
  readonly defaultProfileId: string;
  readonly profiles: ModelProfile[];
}

export interface ProjectSettings extends JsonObject {
  readonly schemaVersion: "1.0";
  readonly autosave: AutosaveSettings;
  readonly history: HistorySettings;
  readonly models: ModelSettings;
  readonly storyAnalysis?: StoredStoryAnalysisSettings;
}

export const DEFAULT_STORY_ANALYSIS_SETTINGS: StoryAnalysisSettings = Object.freeze({
  completionMode: "prompt",
  storyBibleMaintenanceMode: "review"
});

export function resolveStoryAnalysisSettings(
  settings: Pick<ProjectSettings, "storyAnalysis">
): StoryAnalysisSettings {
  const mode = settings.storyAnalysis?.completionMode;
  const maintenanceMode = settings.storyAnalysis?.storyBibleMaintenanceMode;
  return mode === "off" || mode === "background-review" || mode === "prompt"
    ? {
        completionMode: mode,
        storyBibleMaintenanceMode:
          maintenanceMode === "safe-auto" || maintenanceMode === "review"
            ? maintenanceMode
            : "review"
      }
    : DEFAULT_STORY_ANALYSIS_SETTINGS;
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

export interface ModelRuntimeProfile {
  readonly modelProfile: LlmModelProfile;
  readonly parameters: LlmParameters;
  /** Verified model context window when the runtime resolved one from profile/discovery metadata. */
  readonly contextWindow?: number;
}

export interface ModelSettingsSession {
  readStoryAnalysisSettings(): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
  saveStoryAnalysisSettings(
    settings: StoryAnalysisSettings
  ): Promise<Result<StoryAnalysisSettings, UnifiedError>>;
  listModelProfiles(): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  saveModelProfile(
    profile: ModelProfile,
    options?: { readonly makeDefault?: boolean }
  ): Promise<Result<ModelSettingsSnapshot, UnifiedError>>;
  testModelProfileConnection(
    profileId: string,
    profileOverride?: ModelProfile
  ): Promise<Result<ModelConnectionResult, UnifiedError>>;
  discoverModelOptions(
    profileId: string,
    options?: ModelDiscoveryRequestOptions,
    profileOverride?: ModelProfile
  ): Promise<Result<ModelDiscoverySnapshot, UnifiedError>>;
}

export interface ModelSettingsSessionOptions {
  readonly settingsPort: ProjectSettingsPort;
  readonly connectionTester?: ModelConnectionTester;
  readonly discoveryPort?: ModelDiscoveryPort;
}

export function createModelSettingsSession(
  options: ModelSettingsSessionOptions
): ModelSettingsSession {
  return {
    async readStoryAnalysisSettings() {
      const settings = await options.settingsPort.readSettings();
      return settings.ok ? ok(resolveStoryAnalysisSettings(settings.value)) : settings;
    },

    async saveStoryAnalysisSettings(storyAnalysis) {
      if (!isStoryAnalysisSettings(storyAnalysis)) {
        return err(
          createUnifiedError({
            code: "STORY_ANALYSIS_SETTINGS_INVALID",
            category: "ValidationError",
            message: "Story Analysis settings are invalid.",
            recoverability: "user-action",
            suggestedAction: "Choose off, prompt, or background review.",
            traceId: "application-model-settings"
          })
        );
      }
      const current = await options.settingsPort.readSettings();
      if (!current.ok) return current;
      const saved = await options.settingsPort.writeSettings({
        ...current.value,
        storyAnalysis: {
          completionMode: storyAnalysis.completionMode,
          storyBibleMaintenanceMode: storyAnalysis.storyBibleMaintenanceMode
        }
      });
      return saved.ok ? ok(resolveStoryAnalysisSettings(saved.value)) : saved;
    },

    async listModelProfiles() {
      const settings = await options.settingsPort.readSettings();
      if (!settings.ok) {
        return settings;
      }

      return ok(snapshotFromSettings(settings.value));
    },

    async saveModelProfile(profile, saveOptions = {}) {
      const profileValidation = validateModelProfile(profile);
      if (!profileValidation.ok) {
        return profileValidation;
      }

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

    async testModelProfileConnection(profileId, profileOverride) {
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

      const profileResult = await resolveActionModelProfile(
        options.settingsPort,
        profileId,
        profileOverride
      );
      if (!profileResult.ok) return profileResult;
      const profile = profileResult.value;

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
    },

    async discoverModelOptions(profileId, discoveryOptions, profileOverride) {
      const profileResult = await resolveActionModelProfile(
        options.settingsPort,
        profileId,
        profileOverride
      );
      if (!profileResult.ok) {
        return profileResult;
      }
      const profile = profileResult.value;
      if (options.discoveryPort === undefined) {
        return ok(
          createModelDiscoveryFallback(
            profile,
            "Model discovery is not configured in this runtime. Enter the model name manually."
          )
        );
      }

      const result = await options.discoveryPort.discoverModels(profile, discoveryOptions);
      if (result.ok) {
        return result;
      }

      return ok(createModelDiscoveryFallback(profile, result.error.message));
    }
  };
}

function isStoryAnalysisSettings(value: unknown): value is StoryAnalysisSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    (record["completionMode"] === "off" ||
      record["completionMode"] === "prompt" ||
      record["completionMode"] === "background-review") &&
    (record["storyBibleMaintenanceMode"] === "review" ||
      record["storyBibleMaintenanceMode"] === "safe-auto")
  );
}

export function resolveDefaultModelRuntimeProfile(
  settings: ProjectSettings,
  reasoningCapability?: LlmReasoningCapability | null
): Result<ModelRuntimeProfile, UnifiedError> {
  const profile = settings.models.profiles.find(
    (entry) => entry.id === settings.models.defaultProfileId
  );
  if (profile === undefined) {
    return err(
      createUnifiedError({
        code: "MODEL_PROFILE_NOT_FOUND",
        category: "UserError",
        message: "The default model profile does not exist.",
        recoverability: "user-action",
        suggestedAction: "Choose an existing default model profile in Settings.",
        traceId: "application-model-settings",
        redactedDetail: { defaultProfileId: settings.models.defaultProfileId }
      })
    );
  }

  const validation = validateModelProfile(profile);
  if (!validation.ok) {
    return validation;
  }

  const modelProfileBase: LlmModelProfile = {
    id: profile.id,
    provider: validation.value,
    displayName: profile.displayName,
    modelName: profile.modelName
  };
  const modelProfile: LlmModelProfile = {
    ...modelProfileBase,
    ...(profile.baseUrl === undefined ? {} : { baseUrl: profile.baseUrl }),
    apiKeyRef: profile.apiKeyRef,
    timeoutMs: profile.timeoutMs,
    ...(profile.reasoningEffortEnabled === true ? { reasoningEffortEnabled: true } : {}),
    ...(reasoningCapability === undefined ? {} : { reasoningCapability })
  };
  const parameters: LlmParameters = {
    temperature: profile.temperature,
    ...(profile.maxTokens === undefined ? {} : { maxTokens: profile.maxTokens }),
    ...(profile.topP === undefined ? {} : { topP: profile.topP })
  };

  return ok({
    modelProfile,
    parameters
  });
}

function snapshotFromSettings(settings: ProjectSettings): ModelSettingsSnapshot {
  return {
    defaultProfileId: settings.models.defaultProfileId,
    profiles: settings.models.profiles
  };
}

function upsertProfile(profiles: readonly ModelProfile[], profile: ModelProfile): ModelProfile[] {
  const existingIndex = profiles.findIndex((entry) => entry.id === profile.id);
  if (existingIndex === -1) {
    return [...profiles, profile];
  }

  return profiles.map((entry) => (entry.id === profile.id ? profile : entry));
}

async function resolveActionModelProfile(
  settingsPort: ProjectSettingsPort,
  profileId: string,
  profileOverride?: ModelProfile
): Promise<Result<ModelProfile, UnifiedError>> {
  const settings = await settingsPort.readSettings();
  if (!settings.ok) {
    return settings;
  }
  const storedProfile = settings.value.models.profiles.find((entry) => entry.id === profileId);
  if (profileOverride === undefined) {
    if (storedProfile !== undefined) {
      const validation = validateModelProfile(storedProfile);
      if (!validation.ok) return validation;
      return ok(storedProfile);
    }
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

  if (profileOverride.id !== profileId) {
    return invalidModelProfileOverride(profileId, "profile-id-mismatch");
  }
  const allowedApiKeyRef = storedProfile?.apiKeyRef ?? `secret://${profileId}/api_key`;
  if (profileOverride.apiKeyRef !== allowedApiKeyRef) {
    return invalidModelProfileOverride(profileId, "secret-reference-mismatch");
  }

  const validation = validateModelProfile(profileOverride);
  if (!validation.ok) return validation;

  return ok(profileOverride);
}

function invalidModelProfileOverride(
  profileId: string,
  reason: "profile-id-mismatch" | "secret-reference-mismatch"
): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code: "MODEL_PROFILE_OVERRIDE_INVALID",
      category: "ValidationError",
      message: "The current model profile draft is invalid.",
      recoverability: "user-action",
      suggestedAction: "Check the profile ID and API key, then retry.",
      traceId: "application-model-settings",
      redactedDetail: { profileId, reason }
    })
  );
}

function validateModelProfile(profile: ModelProfile): Result<ModelProvider, UnifiedError> {
  const provider = toSupportedProvider(profile.provider);
  const profileIdValid = isValidModelProfileId(profile.id);
  const secretRefValid = isModelProfileSecretRef(profile.id, profile.apiKeyRef);
  const baseUrlValid = isSafeModelBaseUrl(profile.baseUrl);
  const maxTokensValid =
    profile.maxTokens === undefined ||
    (Number.isSafeInteger(profile.maxTokens) && profile.maxTokens > 0);
  const contextWindowValid =
    profile.contextWindow === undefined ||
    (Number.isSafeInteger(profile.contextWindow) && profile.contextWindow > 0);
  const promptCachePreferenceValid =
    profile.promptCachePreference === undefined ||
    profile.promptCachePreference === "auto" ||
    profile.promptCachePreference === "enabled" ||
    profile.promptCachePreference === "disabled";
  if (
    provider === undefined ||
    !profileIdValid ||
    !secretRefValid ||
    !baseUrlValid ||
    !maxTokensValid ||
    !contextWindowValid ||
    !promptCachePreferenceValid
  ) {
    return err(
      createUnifiedError({
        code: "MODEL_PROFILE_INVALID",
        category: "ValidationError",
        message:
          "Model profile must use a supported provider, a bound secret reference, and a safe Base URL.",
        recoverability: "user-action",
        suggestedAction:
          "Choose a supported provider from the provider matrix and store keys as secret refs.",
        traceId: "application-model-settings",
        redactedDetail: {
          profileId: profile.id,
          provider: profile.provider,
          maxTokens: profile.maxTokens ?? null,
          contextWindow: profile.contextWindow ?? null,
          apiKeyRef: redactJsonValue("apiKeyRef", profile.apiKeyRef)
        }
      })
    );
  }

  return ok(provider);
}

const MODEL_PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MODEL_SECRET_REF_PATTERN = /^secret:\/\/([^/]+)\/(?:api_key|api-key)$/u;

function isValidModelProfileId(profileId: string): boolean {
  return MODEL_PROFILE_ID_PATTERN.test(profileId);
}

function isModelProfileSecretRef(profileId: string, apiKeyRef: string): boolean {
  const match = MODEL_SECRET_REF_PATTERN.exec(apiKeyRef);
  return match !== null && match[1] === profileId;
}

function isSafeModelBaseUrl(baseUrl: unknown): boolean {
  if (baseUrl === undefined) return true;
  if (typeof baseUrl !== "string") return false;
  if (baseUrl.trim().length === 0) return true;
  if (
    [...baseUrl].some((character) => {
      const codePoint = character.codePointAt(0);
      return (codePoint !== undefined && codePoint <= 0x1f) || character === "\u007f";
    })
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return false;
  }

  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== "" ||
    parsed.search !== "" ||
    (parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)))
  ) {
    return false;
  }

  return parsed.hostname.length > 0;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function toSupportedProvider(provider: string): ModelProvider | undefined {
  return isModelProvider(provider) ? provider : undefined;
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
