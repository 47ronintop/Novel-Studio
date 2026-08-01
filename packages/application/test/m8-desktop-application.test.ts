import { describe, expect, test } from "vitest";

import { isErr, isOk, ok } from "@novel-studio/shared";

import {
  createDesktopApplication,
  type ConfigStudioSession,
  type EngineeringWorkspaceSession,
  type ModelProfile,
  type ModelSettingsSession
} from "../src/index.js";

describe("desktop application M8 boundary", () => {
  test("exposes injected model settings and config studio sessions", async () => {
    const modelSettingsSession: ModelSettingsSession = {
      async readStoryAnalysisSettings() {
        return ok({ completionMode: "prompt" });
      },
      async saveStoryAnalysisSettings(storyAnalysis) {
        return ok(storyAnalysis);
      },
      async listModelProfiles() {
        return ok({
          defaultProfileId: "model_default",
          profiles: []
        });
      },
      async saveModelProfile() {
        return ok({
          defaultProfileId: "model_default",
          profiles: []
        });
      },
      async testModelProfileConnection() {
        return ok({
          ok: true,
          provider: "mock",
          modelName: "mock-model",
          detail: "Connection succeeded"
        });
      },
      async discoverModelOptions(profileId) {
        return ok({
          profileId,
          provider: "mock",
          status: "fallback",
          models: [],
          fallbackReason: "Discovery is not configured.",
          reasoningStrength: {
            status: "hidden",
            reason: "Select a whitelisted reasoning model before exposing reasoning controls."
          }
        });
      }
    };
    const configStudioSession: ConfigStudioSession = {
      async loadConfigAsset(assetType, assetId) {
        return ok({
          assetType,
          assetId,
          content: {
            schemaVersion: "1.0"
          }
        });
      },
      async saveConfigAsset() {
        return ok({ versionId: "ver_before_save" });
      },
      async restoreConfigAssetVersion(input) {
        return ok({
          assetType: input.assetType,
          assetId: input.assetId,
          content: {
            schemaVersion: "1.0"
          }
        });
      }
    };
    const application = createDesktopApplication({
      modelSettingsSession,
      configStudioSession
    });

    const models = await application.listModelProfiles();
    const config = await application.loadConfigAsset("workflow", "wf_review_chapter");

    expect(isOk(models)).toBe(true);
    expect(isOk(config)).toBe(true);
    if (!models.ok || !config.ok) {
      return;
    }
    expect(models.value.defaultProfileId).toBe("model_default");
    expect(config.value.assetType).toBe("workflow");
  });

  test("returns explicit unavailable errors when M8 sessions are not injected", async () => {
    const application = createDesktopApplication();

    const models = await application.listModelProfiles();
    const config = await application.loadConfigAsset("prompt", "prompt_reviewer_default");

    expect(isErr(models)).toBe(true);
    expect(isErr(config)).toBe(true);
    if (models.ok || config.ok) {
      return;
    }
    expect(models.error.code).toBe("MODEL_SETTINGS_UNAVAILABLE");
    expect(config.error.code).toBe("CONFIG_STUDIO_UNAVAILABLE");
  });

  test("keeps application model settings available in an engineering workspace", async () => {
    const calls: string[] = [];
    const profile: ModelProfile = {
      id: "model_engineering",
      provider: "mock",
      displayName: "Engineering model",
      apiKeyRef: "secret:model_engineering",
      modelName: "mock-model",
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 30_000
    };
    const modelSettingsSession: ModelSettingsSession = {
      async readStoryAnalysisSettings() {
        return ok({ completionMode: "prompt" });
      },
      async saveStoryAnalysisSettings(storyAnalysis) {
        return ok(storyAnalysis);
      },
      async listModelProfiles() {
        calls.push("list");
        return ok({ defaultProfileId: profile.id, profiles: [profile] });
      },
      async discoverModelOptions(profileId) {
        calls.push(`discover:${profileId}`);
        return ok({
          profileId,
          provider: "mock",
          status: "fallback",
          models: [],
          fallbackReason: "Discovery is not configured.",
          reasoningStrength: {
            status: "hidden",
            reason: "The mock provider does not expose reasoning controls."
          }
        });
      },
      async saveModelProfile(savedProfile) {
        calls.push(`save:${savedProfile.id}`);
        return ok({ defaultProfileId: savedProfile.id, profiles: [savedProfile] });
      },
      async testModelProfileConnection(profileId) {
        calls.push(`test:${profileId}`);
        return ok({
          ok: true,
          provider: profile.provider,
          modelName: profile.modelName,
          detail: "Connection succeeded"
        });
      }
    };
    const application = createDesktopApplication({
      modelSettingsSession,
      engineeringWorkspaceSession: {} as EngineeringWorkspaceSession
    });

    await expect(application.listModelProfiles()).resolves.toMatchObject({ ok: true });
    await expect(application.discoverModelOptions(profile.id)).resolves.toMatchObject({ ok: true });
    await expect(application.saveModelProfile(profile)).resolves.toMatchObject({ ok: true });
    await expect(application.testModelProfileConnection(profile.id)).resolves.toMatchObject({
      ok: true
    });
    expect(calls).toEqual([
      "list",
      `discover:${profile.id}`,
      `save:${profile.id}`,
      `test:${profile.id}`
    ]);
  });
});
