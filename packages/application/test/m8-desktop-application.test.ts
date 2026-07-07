import { describe, expect, test } from "vitest";

import { isErr, isOk, ok } from "@novel-studio/shared";

import {
  createDesktopApplication,
  type ConfigStudioSession,
  type ModelSettingsSession
} from "../src/index.js";

describe("desktop application M8 boundary", () => {
  test("exposes injected model settings and config studio sessions", async () => {
    const modelSettingsSession: ModelSettingsSession = {
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
});
