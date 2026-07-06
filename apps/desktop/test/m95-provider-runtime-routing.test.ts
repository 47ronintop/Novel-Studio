import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { AiWritingSuggestion } from "@novel-studio/application";
import { createProviderRouter, type LlmProvider, type LlmRequest } from "@novel-studio/llm-adapter";
import type { Result, UnifiedError } from "@novel-studio/shared";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("M95 desktop provider runtime routing", () => {
  test("routes the default DeepSeek model profile through the OpenAI-compatible runtime provider", async () => {
    const projectRoot = await copyFixtureProject();
    const requests: LlmRequest[] = [];
    const compatibleProvider: LlmProvider = {
      id: "openai-compatible",
      async complete(request) {
        requests.push(request);
        return {
          content: {
            type: "json",
            value: {
              proposedBody: "Routed continuation.\n",
              summary: "DeepSeek profile used the compatible runtime provider."
            }
          }
        };
      },
      async *stream() {}
    };
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => "2026-07-06T00:00:00.000Z",
      createAiProvider: () =>
        createProviderRouter({
          providers: {
            "openai-compatible": compatibleProvider
          }
        })
    });

    const loaded = await application.loadActiveChapter();
    assertOk(loaded);

    const generated = await application.generateActiveChapterSuggestion({
      instruction: "Continue with the default public provider profile."
    });

    assertOk<AiWritingSuggestion>(generated);
    expect(requests[0]?.modelProfile).toMatchObject({
      provider: "deepseek",
      modelName: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1"
    });
    expect(generated.value).toMatchObject({
      summary: "DeepSeek profile used the compatible runtime provider.",
      observability: {
        model: {
          provider: "deepseek",
          modelName: "deepseek-chat"
        }
      }
    });
  });
});

async function copyFixtureProject(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-m95-provider-routing-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "settings.json"),
    `${JSON.stringify(createDeepSeekSettings(), null, 2)}\n`
  );
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  return target;
}

function createDeepSeekSettings() {
  return {
    schemaVersion: "1.0",
    autosave: {
      enabled: true,
      intervalMs: 30000,
      createHistorySnapshot: false
    },
    history: {
      snapshotPolicy: "manual-and-interval",
      intervalMinutes: 10,
      maxSnapshotsPerChapter: 20
    },
    models: {
      defaultProfileId: "model_deepseek",
      profiles: [
        {
          id: "model_deepseek",
          provider: "deepseek",
          displayName: "DeepSeek",
          baseUrl: "https://api.deepseek.com/v1",
          apiKeyRef: "secret://model_deepseek/api_key",
          modelName: "deepseek-chat",
          temperature: 0.7,
          maxTokens: 4096,
          topP: 1,
          timeoutMs: 60000
        }
      ]
    }
  };
}

function assertOk<T>(
  result: unknown
): asserts result is Result<T, UnifiedError> & { readonly ok: true } {
  expect(result).toMatchObject({ ok: true });
}
