import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type {
  ModelConnectionResult,
  ModelConnectionTester,
  ModelProfile,
  ModelSettingsSnapshot
} from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M15 desktop model profile settings", () => {
  test("lists, saves, defaults, and tests project model profiles through IPC", async () => {
    const projectRoot = await copyFixtureProject();
    const testedProfiles: ModelProfile[] = [];
    const tester: ModelConnectionTester = {
      async testConnection(profile): Promise<Result<ModelConnectionResult, UnifiedError>> {
        testedProfiles.push(profile);
        return {
          ok: true,
          value: {
            ok: true,
            provider: profile.provider,
            modelName: profile.modelName,
            detail: "Profile validated by injected tester"
          }
        };
      }
    };
    const handlers = createApplicationIpcHandlers(
      createProjectDesktopApplication({
        projectRoot,
        chapterId,
        projectTitle: "Minimal Chapter Project",
        modelConnectionTester: tester
      })
    );

    const listed = await handlers["application:settings:list-model-profiles"]();
    assertOk<ModelSettingsSnapshot>(listed);
    expect(listed.value.defaultProfileId).toBe("model_default");

    const saved = await handlers["application:settings:save-model-profile"](
      {
        id: "model_ollama",
        provider: "ollama",
        displayName: "Local Ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKeyRef: "secret://model_ollama/api_key",
        modelName: "llama3.1",
        temperature: 0.2,
        maxTokens: 2048,
        timeoutMs: 30000
      },
      { makeDefault: true }
    );
    assertOk<ModelSettingsSnapshot>(saved);
    expect(saved.value.defaultProfileId).toBe("model_ollama");

    const connection = await handlers["application:settings:test-model-profile"]("model_ollama");
    assertOk<ModelConnectionResult>(connection);
    expect(connection.value).toMatchObject({
      ok: true,
      provider: "ollama",
      modelName: "llama3.1"
    });
    expect(testedProfiles).toHaveLength(1);

    const settingsJson = await readFile(join(projectRoot, "settings.json"), "utf8");
    expect(settingsJson).toContain('"provider": "ollama"');
    expect(settingsJson).toContain('"apiKeyRef": "secret://model_ollama/api_key"');
    expect(settingsJson).not.toMatch(/\bsk-[A-Za-z0-9_-]+/);
  });
});

async function copyFixtureProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-m15-settings-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    await readFile(join(fixtureRoot, "settings.json"))
  );
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  return target;
}

function assertOk<T>(
  result: unknown
): asserts result is Result<T, UnifiedError> & { readonly ok: true } {
  expect(result).toMatchObject({ ok: true });
}
