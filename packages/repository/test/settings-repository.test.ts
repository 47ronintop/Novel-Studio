import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { isErr, isOk } from "@novel-studio/shared";

import { ProjectSettingsRepository, type ProjectSettings } from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("ProjectSettingsRepository", () => {
  test("reads and saves model profiles with apiKeyRef only", async () => {
    const projectRoot = await createSettingsProject();
    const repository = new ProjectSettingsRepository({
      projectRoot,
      traceId: "trace_settings_save"
    });
    const loaded = await repository.readSettings();
    expect(isOk(loaded)).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const nextSettings: ProjectSettings = {
      ...loaded.value,
      models: {
        defaultProfileId: "model_secondary",
        profiles: [
          ...loaded.value.models.profiles,
          {
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
          }
        ]
      }
    };

    const saved = await repository.writeSettings(nextSettings);

    expect(isOk(saved)).toBe(true);
    if (!saved.ok) {
      return;
    }
    const persisted = JSON.parse(await readFile(join(projectRoot, "settings.json"), "utf8")) as {
      models: { defaultProfileId: string; profiles: Array<{ apiKeyRef?: string }> };
    };
    expect(persisted.models.defaultProfileId).toBe("model_secondary");
    expect(JSON.stringify(persisted)).toContain("secret://model_secondary/api_key");
    expect(JSON.stringify(persisted)).not.toContain("sk-");
  });

  test("rejects plaintext apiKey fields without mutating settings.json", async () => {
    const projectRoot = await createSettingsProject();
    const before = await readFile(join(projectRoot, "settings.json"), "utf8");
    const repository = new ProjectSettingsRepository({
      projectRoot,
      traceId: "trace_settings_secret_reject"
    });
    const loaded = await repository.readSettings();
    expect(isOk(loaded)).toBe(true);
    if (!loaded.ok) {
      return;
    }

    const unsafeProfile = {
      id: "model_unsafe",
      provider: "openai-compatible",
      displayName: "Unsafe Model",
      baseUrl: "https://api.example.com/v1",
      apiKeyRef: "secret://model_unsafe/api_key",
      apiKey: "sk-plaintext",
      modelName: "example-unsafe",
      temperature: 0.4,
      maxTokens: 2048,
      topP: 1,
      timeoutMs: 60000
    };
    const unsafeSettings = {
      ...loaded.value,
      models: {
        defaultProfileId: "model_unsafe",
        profiles: [...loaded.value.models.profiles, unsafeProfile]
      }
    };

    const saved = await repository.writeSettings(unsafeSettings);

    expect(isErr(saved)).toBe(true);
    if (saved.ok) {
      return;
    }
    expect(saved.error.code).toBe("SETTINGS_FILE_INVALID");
    expect(JSON.stringify(saved.error.redactedDetail)).not.toContain("sk-plaintext");
    expect(await readFile(join(projectRoot, "settings.json"), "utf8")).toBe(before);
  });
});

async function createSettingsProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "novel-studio-settings-"));
  tempRoots.push(root);
  await mkdir(root, { recursive: true });
  const settings = await readFile(
    join(process.cwd(), "fixtures", "schemas", "valid", "settings.json"),
    "utf8"
  );
  await writeFile(join(root, "settings.json"), settings, "utf8");
  return root;
}
