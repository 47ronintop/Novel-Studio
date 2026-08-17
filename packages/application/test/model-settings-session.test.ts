import { describe, expect, test } from "vitest";

import {
  createUnifiedError,
  isErr,
  isOk,
  ok,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import {
  createModelSettingsSession,
  createModelDiscoverySnapshot,
  MODEL_PROVIDER_CATALOG,
  resolveDefaultModelRuntimeProfile,
  reasoningStrengthForModel,
  type ModelConnectionTester,
  type ModelDiscoveryPort,
  type ModelProfile,
  type ProjectSettings,
  type ProjectSettingsPort
} from "../src/index.js";

const settings = {
  schemaVersion: "1.0",
  autosave: {
    enabled: true,
    intervalMs: 30000
  },
  history: {
    snapshotPolicy: "manual-and-interval",
    intervalMinutes: 10,
    maxSnapshotsPerChapter: null
  },
  models: {
    defaultProfileId: "model_default",
    profiles: [
      {
        id: "model_default",
        provider: "openai-compatible",
        displayName: "Default Model",
        baseUrl: "https://api.example.com/v1",
        apiKeyRef: "secret://model_default/api_key",
        modelName: "example-model",
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1,
        timeoutMs: 60000
      }
    ]
  }
} satisfies ProjectSettings;

const secondaryProfile = {
  id: "model_secondary",
  provider: "openai-compatible",
  displayName: "Secondary Model",
  baseUrl: "https://api.example.com/v1",
  apiKeyRef: "secret://model_secondary/api_key",
  modelName: "example-secondary",
  contextWindow: 32_000,
  temperature: 0.4,
  maxTokens: 2048,
  topP: 1,
  timeoutMs: 60000
} satisfies ModelProfile;

describe("model settings session", () => {
  test("uses model-specific catalog tiers on custom endpoints", () => {
    const result = reasoningStrengthForModel(
      "openai-compatible",
      "gpt-5.5",
      "https://api.hostcentral.cc/v1",
      true
    );

    expect(result).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    });
  });

  test("shows recognized reasoning models on custom endpoints without a Settings opt-in", () => {
    expect(
      reasoningStrengthForModel(
        "openai-compatible",
        "gpt-5.6-terra",
        "https://api.hostcentral.cc/v1"
      )
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    });
    expect(
      reasoningStrengthForModel(
        "openai-compatible",
        "gpt-5.6-luna",
        "https://api.hostcentral.cc/v1"
      )
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max"],
      defaultValue: "medium"
    });
  });

  test("preserves model-specific max and ultra tiers for gpt-5.6-sol", () => {
    expect(
      reasoningStrengthForModel("openai-compatible", "gpt-5.6-sol", "https://api.hostcentral.cc/v1")
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "low"
    });
  });

  test("uses model-specific xAI reasoning tiers on compatible endpoints", () => {
    expect(
      reasoningStrengthForModel("openai-compatible", "grok-3-mini", "https://api.x.ai/v1")
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "high"],
      defaultValue: "high"
    });
    expect(
      reasoningStrengthForModel("openrouter", "x-ai/grok-4", "https://openrouter.ai/api/v1", true)
    ).toEqual({
      status: "available",
      providerParamName: "reasoning",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "high"
    });
  });

  test("does not infer reasoning tiers for an unknown gpt-5.6 alias", () => {
    expect(
      reasoningStrengthForModel(
        "openai-compatible",
        "gpt-5.6-unknown",
        "https://api.hostcentral.cc/v1"
      )
    ).toMatchObject({ status: "hidden" });
  });

  test("keeps undeclared DeepSeek tiers hidden until the generic override is enabled", () => {
    expect(
      reasoningStrengthForModel("deepseek", "deepseek-chat", "https://api.deepseek.com/v1")
    ).toMatchObject({ status: "hidden" });
    expect(
      reasoningStrengthForModel(
        "deepseek",
        "deepseek-reasoner",
        "https://api.deepseek.com/v1",
        true
      )
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high"],
      defaultValue: "medium"
    });
  });

  test("uses provider-native reasoning controls for Anthropic, Gemini, and OpenRouter", () => {
    expect(reasoningStrengthForModel("anthropic", "claude-3-7-sonnet-20250219")).toEqual({
      status: "available",
      providerParamName: "anthropic_thinking_budget",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("anthropic", "claude-sonnet-4-20250514")).toEqual({
      status: "available",
      providerParamName: "anthropic_thinking_budget",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("anthropic", "claude-opus-4-6")).toEqual({
      status: "available",
      providerParamName: "anthropic_effort",
      allowedValues: ["low", "medium", "high", "max"],
      defaultValue: "high"
    });
    expect(reasoningStrengthForModel("google-gemini", "gemini-2.5-flash")).toEqual({
      status: "available",
      providerParamName: "gemini_thinking_budget",
      allowedValues: ["off", "low", "medium", "high"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("google-gemini", "gemini-3-pro-preview")).toEqual({
      status: "available",
      providerParamName: "gemini_thinking_level",
      allowedValues: ["low", "high"],
      defaultValue: "high"
    });
    expect(
      reasoningStrengthForModel(
        "openrouter",
        "anthropic/claude-sonnet-4",
        "https://openrouter.ai/api/v1",
        true
      )
    ).toEqual({
      status: "available",
      providerParamName: "reasoning",
      allowedValues: ["low", "medium", "high"],
      defaultValue: "medium"
    });
  });

  test.each(["zhipu", "tongyi-qianwen", "ollama", "lm-studio", "vllm"])(
    "requires an explicit generic reasoning override for %s",
    (provider) => {
      expect(reasoningStrengthForModel(provider, "unknown-model")).toMatchObject({
        status: "hidden"
      });
      expect(reasoningStrengthForModel(provider, "unknown-model", undefined, true)).toEqual({
        status: "available",
        providerParamName: "reasoning_effort",
        allowedValues: ["none", "low", "medium", "high"],
        defaultValue: "medium"
      });
    }
  );

  test("prefers discovered reasoning metadata over the DeepSeek fallback", () => {
    const snapshot = createModelDiscoverySnapshot({
      profile: {
        id: "model_deepseek",
        provider: "deepseek",
        modelName: "deepseek-reasoner",
        baseUrl: "https://api.deepseek.com/v1",
        reasoningEffortEnabled: false
      },
      models: [
        {
          id: "deepseek-reasoner",
          displayName: "deepseek-reasoner",
          reasoningStrength: {
            status: "available",
            providerParamName: "reasoning_effort",
            allowedValues: ["low", "high", "max"],
            defaultValue: "max"
          }
        }
      ]
    });

    expect(snapshot.reasoningStrength).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "high", "max"],
      defaultValue: "max"
    });
  });

  test("hides native discovery metadata that the selected adapter cannot serialize", () => {
    const unknownModel = createModelDiscoverySnapshot({
      profile: {
        id: "model_anthropic",
        provider: "anthropic",
        modelName: "claude-future",
        reasoningEffortEnabled: false
      },
      models: [
        {
          id: "claude-future",
          displayName: "claude-future",
          reasoningStrength: {
            status: "available",
            providerParamName: "anthropic_effort",
            allowedValues: ["low", "high"],
            defaultValue: "high"
          }
        }
      ]
    });
    const mismatchedProtocol = createModelDiscoverySnapshot({
      profile: {
        id: "model_anthropic",
        provider: "anthropic",
        modelName: "claude-sonnet-4-20250514",
        reasoningEffortEnabled: false
      },
      models: [
        {
          id: "claude-sonnet-4-20250514",
          displayName: "claude-sonnet-4-20250514",
          reasoningStrength: {
            status: "available",
            providerParamName: "anthropic_effort",
            allowedValues: ["low", "high"],
            defaultValue: "high"
          }
        }
      ]
    });

    expect(unknownModel.reasoningStrength).toMatchObject({ status: "hidden" });
    expect(mismatchedProtocol.reasoningStrength).toMatchObject({ status: "hidden" });
  });

  test("uses model-specific reasoning effort values for official OpenAI endpoints", () => {
    expect(reasoningStrengthForModel("openai", "gpt-5", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["minimal", "low", "medium", "high"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("openai", "gpt-5.1", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high"],
      defaultValue: "none"
    });
    expect(reasoningStrengthForModel("openai", "gpt-5.4", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    });
    expect(
      reasoningStrengthForModel("openai", "gpt-5.4-mini", "https://api.openai.com/v1")
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("openai", "gpt-5.5", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("openai", "gpt-5.2", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["low", "medium", "high", "xhigh"],
      defaultValue: "medium"
    });
    expect(reasoningStrengthForModel("openai", "gpt-5-pro", "https://api.openai.com/v1")).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["high"],
      defaultValue: "high"
    });
    expect(
      reasoningStrengthForModel("openai", "gpt-5.6-codex", "https://api.openai.com/v1")
    ).toEqual({
      status: "available",
      providerParamName: "reasoning_effort",
      allowedValues: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      defaultValue: "medium"
    });
  });

  test("lists and saves model profiles through an injected settings port", async () => {
    const writes: ProjectSettings[] = [];
    const port: ProjectSettingsPort = {
      async readSettings() {
        return ok(settings);
      },
      async writeSettings(nextSettings) {
        writes.push(nextSettings);
        return ok(nextSettings);
      }
    };
    const session = createModelSettingsSession({ settingsPort: port });

    const listed = await session.listModelProfiles();
    const saved = await session.saveModelProfile(secondaryProfile, { makeDefault: true });

    expect(isOk(listed)).toBe(true);
    expect(isOk(saved)).toBe(true);
    if (!listed.ok || !saved.ok) {
      return;
    }
    expect(listed.value.profiles.map((profile) => profile.id)).toEqual(["model_default"]);
    expect(saved.value.defaultProfileId).toBe("model_secondary");
    expect(saved.value.profiles.map((profile) => profile.id)).toEqual([
      "model_default",
      "model_secondary"
    ]);
    expect(saved.value.profiles[1]?.contextWindow).toBe(32_000);
    expect(JSON.stringify(writes)).toContain("secret://model_secondary/api_key");
    expect(JSON.stringify(writes)).not.toContain("sk-");
  });

  test("defaults, reads, and saves the chapter completion analysis mode", async () => {
    let currentSettings: ProjectSettings = settings;
    const session = createModelSettingsSession({
      settingsPort: {
        async readSettings() {
          return ok(currentSettings);
        },
        async writeSettings(nextSettings) {
          currentSettings = nextSettings;
          return ok(nextSettings);
        }
      }
    });

    await expect(session.readStoryAnalysisSettings()).resolves.toEqual(
      ok({ completionMode: "prompt", storyBibleMaintenanceMode: "review" })
    );
    await expect(
      session.saveStoryAnalysisSettings({
        completionMode: "background-review",
        storyBibleMaintenanceMode: "safe-auto"
      })
    ).resolves.toEqual(
      ok({ completionMode: "background-review", storyBibleMaintenanceMode: "safe-auto" })
    );
    expect(currentSettings.storyAnalysis).toEqual({
      completionMode: "background-review",
      storyBibleMaintenanceMode: "safe-auto"
    });

    const invalid = await session.saveStoryAnalysisSettings({
      completionMode: "automatic-write"
    } as never);
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_SETTINGS_INVALID" }
    });
    expect(currentSettings.storyAnalysis).toEqual({
      completionMode: "background-review",
      storyBibleMaintenanceMode: "safe-auto"
    });

    const invalidMaintenanceMode = await session.saveStoryAnalysisSettings({
      completionMode: "background-review",
      storyBibleMaintenanceMode: "automatic"
    } as never);
    expect(invalidMaintenanceMode).toMatchObject({
      ok: false,
      error: { code: "STORY_ANALYSIS_SETTINGS_INVALID" }
    });
  });

  test("tests a model profile connection without exposing secret values", async () => {
    const testerCalls: ModelProfile[] = [];
    const tester: ModelConnectionTester = {
      async testConnection(profile) {
        testerCalls.push(profile);
        return ok({
          ok: true,
          provider: profile.provider,
          modelName: profile.modelName,
          detail: "Connection succeeded"
        });
      }
    };
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort(settings),
      connectionTester: tester
    });

    const result = await session.testModelProfileConnection("model_default");

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(testerCalls).toHaveLength(1);
    expect(result.value).toEqual({
      ok: true,
      provider: "openai-compatible",
      modelName: "example-model",
      detail: "Connection succeeded"
    });
    expect(JSON.stringify(result.value)).not.toContain("secret://");
  });

  test("tests and discovers an unsaved model profile override without writing settings", async () => {
    const writes: ProjectSettings[] = [];
    const testedProfiles: ModelProfile[] = [];
    const discoveredProfiles: ModelProfile[] = [];
    const draftProfile: ModelProfile = {
      ...secondaryProfile,
      id: "model_draft",
      apiKeyRef: "secret://model_draft/api_key",
      baseUrl: "https://draft.example.com/v1",
      modelName: "draft-model"
    };
    const session = createModelSettingsSession({
      settingsPort: {
        async readSettings() {
          return ok(settings);
        },
        async writeSettings(nextSettings) {
          writes.push(nextSettings);
          return ok(nextSettings);
        }
      },
      connectionTester: {
        async testConnection(profile) {
          testedProfiles.push(profile);
          return ok({
            ok: true,
            provider: profile.provider,
            modelName: profile.modelName,
            detail: "Connection succeeded"
          });
        }
      },
      discoveryPort: {
        async discoverModels(profile) {
          discoveredProfiles.push(profile);
          return ok(
            createModelDiscoverySnapshot({
              profile,
              models: [{ id: "draft-model", displayName: "draft-model" }]
            })
          );
        }
      }
    });

    const tested = await session.testModelProfileConnection(draftProfile.id, draftProfile);
    const discovered = await session.discoverModelOptions(
      draftProfile.id,
      { forceRefresh: true },
      draftProfile
    );

    expect(tested).toMatchObject({ ok: true });
    expect(discovered).toMatchObject({
      ok: true,
      value: { profileId: "model_draft", status: "loaded" }
    });
    expect(testedProfiles).toEqual([draftProfile]);
    expect(discoveredProfiles).toEqual([draftProfile]);
    expect(writes).toEqual([]);
  });

  test("rejects model profile overrides that borrow another profile's secret reference", async () => {
    const testedProfiles: ModelProfile[] = [];
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort(settings),
      connectionTester: {
        async testConnection(profile) {
          testedProfiles.push(profile);
          return ok({
            ok: true,
            provider: profile.provider,
            modelName: profile.modelName,
            detail: "Connection succeeded"
          });
        }
      }
    });

    const [defaultProfile] = settings.models.profiles;
    expect(defaultProfile).toBeDefined();
    if (defaultProfile === undefined) return;
    const storedOverride = await session.testModelProfileConnection("model_default", {
      ...defaultProfile,
      apiKeyRef: "secret://model_secondary/api_key"
    });
    const newOverride = await session.testModelProfileConnection("model_draft", {
      ...secondaryProfile,
      id: "model_draft",
      apiKeyRef: "secret://model_default/api_key"
    });
    const mismatchedId = await session.testModelProfileConnection("model_draft", {
      ...secondaryProfile,
      id: "model_other",
      apiKeyRef: "secret://model_other/api_key"
    });

    for (const result of [storedOverride, newOverride, mismatchedId]) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "MODEL_PROFILE_OVERRIDE_INVALID" }
      });
    }
    expect(testedProfiles).toEqual([]);
  });

  test("redacts failed model connection details", async () => {
    const tester: ModelConnectionTester = {
      async testConnection(): Promise<Result<never, UnifiedError>> {
        return {
          ok: false,
          error: createUnifiedError({
            code: "LLM_PROVIDER_ERROR",
            category: "LLMAdapterError",
            message: "Provider rejected the request.",
            recoverability: "user-action",
            suggestedAction: "Check the profile.",
            traceId: "trace_model_test",
            redactedDetail: {
              apiKeyRef: "secret://model_default/api_key",
              authorization: "Bearer sk-secret"
            }
          })
        };
      }
    };
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort(settings),
      connectionTester: tester
    });

    const result = await session.testModelProfileConnection("model_default");

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("MODEL_CONNECTION_FAILED");
    expect(JSON.stringify(result.error)).not.toContain("sk-secret");
    expect(JSON.stringify(result.error)).not.toContain("secret://model_default/api_key");
  });

  test("discovers provider models through the injected discovery port", async () => {
    const discoveryCalls: ModelProfile[] = [];
    const discoveryPort: ModelDiscoveryPort = {
      async discoverModels(profile) {
        discoveryCalls.push(profile);
        return ok({
          profileId: profile.id,
          provider: profile.provider,
          status: "loaded",
          models: [
            {
              id: "example-model",
              displayName: "example-model",
              provider: profile.provider,
              contextWindow: 128000
            },
            {
              id: "gpt-5",
              displayName: "gpt-5",
              provider: profile.provider,
              reasoningStrength: {
                status: "available",
                providerParamName: "reasoning_effort",
                allowedValues: ["low", "medium", "high"],
                defaultValue: "medium"
              }
            }
          ],
          reasoningStrength: {
            status: "hidden",
            reason: "Select a whitelisted reasoning model before exposing reasoning controls."
          }
        });
      }
    };
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort(settings),
      discoveryPort
    });

    const result = await session.discoverModelOptions("model_default");

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(discoveryCalls).toHaveLength(1);
    expect(result.value).toMatchObject({
      profileId: "model_default",
      provider: "openai-compatible",
      status: "loaded",
      models: [
        {
          id: "example-model",
          displayName: "example-model",
          provider: "openai-compatible",
          contextWindow: 128000
        },
        {
          id: "gpt-5",
          reasoningStrength: {
            status: "available",
            providerParamName: "reasoning_effort",
            allowedValues: ["low", "medium", "high"],
            defaultValue: "medium"
          }
        }
      ],
      reasoningStrength: {
        status: "hidden"
      }
    });
    expect(JSON.stringify(result.value)).not.toContain("secret://model_default/api_key");
  });

  test("returns fallback discovery state instead of throwing when discovery fails", async () => {
    const discoveryPort: ModelDiscoveryPort = {
      async discoverModels() {
        return {
          ok: false,
          error: createUnifiedError({
            code: "MODEL_DISCOVERY_UPSTREAM_FAILED",
            category: "ModelProviderError",
            message: "Provider rejected sk-secret for secret://model_default/api_key.",
            recoverability: "user-action",
            suggestedAction: "Check the provider endpoint.",
            traceId: "test-model-discovery"
          })
        };
      }
    };
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort(settings),
      discoveryPort
    });

    const result = await session.discoverModelOptions("model_default");

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({
      profileId: "model_default",
      provider: "openai-compatible",
      status: "fallback",
      models: [],
      reasoningStrength: {
        status: "hidden"
      }
    });
    expect(result.value.fallbackReason).toContain("Provider rejected");
    expect(JSON.stringify(result.value)).not.toContain("sk-secret");
    expect(JSON.stringify(result.value)).not.toContain("secret://model_default/api_key");
  });

  test("keeps reasoning strength available in fallback discovery for known OpenAI-compatible models", async () => {
    const discoveryPort: ModelDiscoveryPort = {
      async discoverModels() {
        return {
          ok: false,
          error: createUnifiedError({
            code: "MODEL_DISCOVERY_UPSTREAM_FAILED",
            category: "ModelProviderError",
            message: "Provider does not implement /models.",
            recoverability: "user-action",
            suggestedAction: "Enter the model name manually.",
            traceId: "test-model-discovery"
          })
        };
      }
    };
    const [defaultProfile] = settings.models.profiles;
    expect(defaultProfile).toBeDefined();
    if (defaultProfile === undefined) {
      return;
    }
    const session = createModelSettingsSession({
      settingsPort: staticSettingsPort({
        ...settings,
        models: {
          defaultProfileId: "model_default",
          profiles: [
            {
              ...defaultProfile,
              baseUrl: "https://api.hostcentral.cc/v1",
              modelName: "gpt-5.5",
              reasoningEffortEnabled: true
            }
          ]
        }
      }),
      discoveryPort
    });

    const result = await session.discoverModelOptions("model_default");

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toMatchObject({
      status: "fallback",
      models: [],
      reasoningStrength: {
        status: "available",
        providerParamName: "reasoning_effort",
        allowedValues: ["low", "medium", "high", "xhigh"],
        defaultValue: "medium"
      }
    });
  });

  test("rejects unsupported providers and non-secret key references before writing settings", async () => {
    const writes: ProjectSettings[] = [];
    const port: ProjectSettingsPort = {
      async readSettings() {
        return ok(settings);
      },
      async writeSettings(nextSettings) {
        writes.push(nextSettings);
        return ok(nextSettings);
      }
    };
    const session = createModelSettingsSession({ settingsPort: port });

    const result = await session.saveModelProfile({
      ...secondaryProfile,
      provider: "unsupported-provider",
      apiKeyRef: "sk-plaintext"
    });

    expect(isErr(result)).toBe(true);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("MODEL_PROFILE_INVALID");
    expect(JSON.stringify(result.error)).not.toContain("sk-plaintext");
    expect(writes).toEqual([]);
  });

  test("saves every constitution-required model provider", async () => {
    const writes: ProjectSettings[] = [];
    let currentSettings: ProjectSettings = settings;
    const port: ProjectSettingsPort = {
      async readSettings() {
        return ok(currentSettings);
      },
      async writeSettings(nextSettings) {
        writes.push(nextSettings);
        currentSettings = nextSettings;
        return ok(nextSettings);
      }
    };
    const session = createModelSettingsSession({ settingsPort: port });

    for (const provider of MODEL_PROVIDER_CATALOG) {
      const result = await session.saveModelProfile({
        id: `model_${provider.id.replaceAll("-", "_")}`,
        provider: provider.id,
        displayName: provider.label,
        ...(provider.defaultBaseUrl === undefined ? {} : { baseUrl: provider.defaultBaseUrl }),
        apiKeyRef: `secret://model_${provider.id.replaceAll("-", "_")}/api_key`,
        modelName: provider.defaultModelName,
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1,
        timeoutMs: 60000
      });

      expect(result.ok, provider.id).toBe(true);
    }

    expect(writes).toHaveLength(MODEL_PROVIDER_CATALOG.length);
    expect(currentSettings.models.profiles.map((profile) => profile.provider).sort()).toEqual(
      ["openai-compatible", ...MODEL_PROVIDER_CATALOG.map((provider) => provider.id)].sort()
    );
  });

  test("resolves catalog provider runtime profiles without dropping base URL or parameters", () => {
    const openRouterSettings: ProjectSettings = {
      ...settings,
      models: {
        defaultProfileId: "model_openrouter",
        profiles: [
          {
            id: "model_openrouter",
            provider: "openrouter",
            displayName: "OpenRouter",
            baseUrl: "https://openrouter.ai/api/v1",
            apiKeyRef: "secret://model_openrouter/api_key",
            modelName: "openrouter/auto",
            temperature: 0.3,
            maxTokens: 2048,
            topP: 0.9,
            timeoutMs: 45000
          }
        ]
      }
    };

    const result = resolveDefaultModelRuntimeProfile(openRouterSettings);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      modelProfile: {
        id: "model_openrouter",
        provider: "openrouter",
        displayName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyRef: "secret://model_openrouter/api_key",
        modelName: "openrouter/auto",
        timeoutMs: 45000
      },
      parameters: {
        temperature: 0.3,
        maxTokens: 2048,
        topP: 0.9
      }
    });
  });

  test("preserves an explicitly hidden reasoning capability in the runtime profile", () => {
    const result = resolveDefaultModelRuntimeProfile(settings, null);

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.modelProfile.reasoningCapability).toBeNull();
  });

  test("resolves the default settings profile into an LLM runtime profile", () => {
    const result = resolveDefaultModelRuntimeProfile(settings);

    expect(isOk(result)).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toEqual({
      modelProfile: {
        id: "model_default",
        provider: "openai-compatible",
        displayName: "Default Model",
        baseUrl: "https://api.example.com/v1",
        apiKeyRef: "secret://model_default/api_key",
        modelName: "example-model",
        timeoutMs: 60000
      },
      parameters: {
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1
      }
    });
  });

  test("omits the output-token parameter when the profile defers to the provider", () => {
    const [profile] = settings.models.profiles;
    if (profile === undefined) throw new Error("Expected a default model profile.");
    const { maxTokens, ...profileWithoutCap } = profile;
    void maxTokens;
    const autoSettings: ProjectSettings = {
      ...settings,
      models: {
        ...settings.models,
        profiles: [profileWithoutCap]
      }
    };

    const result = resolveDefaultModelRuntimeProfile(autoSettings);

    expect(isOk(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.parameters).toEqual({ temperature: 0.7, topP: 1 });
  });
});

function staticSettingsPort(value: ProjectSettings): ProjectSettingsPort {
  return {
    async readSettings() {
      return ok(value);
    },
    async writeSettings(nextSettings) {
      return ok(nextSettings);
    }
  };
}
