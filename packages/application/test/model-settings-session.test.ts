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
  type ModelConnectionTester,
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
  temperature: 0.4,
  maxTokens: 2048,
  topP: 1,
  timeoutMs: 60000
} satisfies ModelProfile;

describe("model settings session", () => {
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
    expect(JSON.stringify(writes)).toContain("secret://model_secondary/api_key");
    expect(JSON.stringify(writes)).not.toContain("sk-");
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
