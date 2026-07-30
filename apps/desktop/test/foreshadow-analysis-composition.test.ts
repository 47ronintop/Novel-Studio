import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { LlmRequest } from "@novel-studio/llm-adapter";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const now = "2026-07-30T00:00:00.000Z";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("foreshadow analysis desktop composition", () => {
  test("reads the active project through read-only repositories and invokes the configured provider", async () => {
    const projectRoot = await copyFixtureProjectWithContextWindow();
    const requests: LlmRequest[] = [];
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => now,
      createAiProvider: () => ({
        id: "mock",
        async complete(request) {
          requests.push(request);
          return {
            content: { type: "json", value: { candidates: [] } },
            usage: {
              inputTokens: 32,
              outputTokens: 4,
              totalTokens: 36,
              usageStatus: "estimated",
              cost: { amount: 0, currency: "USD", status: "estimated" }
            }
          };
        },
        async *stream() {
          yield { type: "delta", value: "" };
        }
      })
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });

      const result = await application.detectForeshadows({ chapterIds: [chapterId] });

      expect(result).toMatchObject({
        ok: true,
        value: {
          chapterIds: [chapterId],
          candidates: [],
          usage: { totalTokens: 36 }
        }
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        traceId: "foreshadow-analysis",
        modelProfile: {
          id: "model_default",
          apiKeyRef: "secret://model_default/api_key"
        }
      });
      expect(JSON.stringify(result)).not.toContain(projectRoot);
      expect(JSON.stringify(result)).not.toContain("secret://model_default/api_key");

      const missing = await createApplicationIpcHandlers(application)[
        "application:story-bible:detect-foreshadows"
      ]({ chapterIds: ["ch_missing"] });
      expect(missing).toMatchObject({
        ok: false,
        error: { code: "CHAPTER_FILE_MISSING" }
      });
      expect(JSON.stringify(missing)).not.toContain(projectRoot);
      expect(JSON.stringify(missing)).not.toContain("ch_missing.md");
    } finally {
      await application.shutdown();
    }
  });

  test("returns an empty valid scan from the default desktop mock provider", async () => {
    const projectRoot = await copyFixtureProjectWithContextWindow();
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => now
    });

    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      await expect(
        application.detectForeshadows({ chapterIds: [chapterId] })
      ).resolves.toMatchObject({
        ok: true,
        value: { chapterIds: [chapterId], candidates: [] }
      });
    } finally {
      await application.shutdown();
    }
  });
});

async function copyFixtureProjectWithContextWindow(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-foreshadow-analysis-"));
  tempRoots.push(target);
  await mkdir(join(target, "chapters"), { recursive: true });
  await writeFile(join(target, "project.json"), await readFile(join(fixtureRoot, "project.json")));
  await writeFile(
    join(target, "chapters", `${chapterId}.md`),
    await readFile(join(fixtureRoot, "chapters", `${chapterId}.md`))
  );

  const settings = JSON.parse(await readFile(join(fixtureRoot, "settings.json"), "utf8")) as {
    models: { profiles: Array<Record<string, unknown>> };
  };
  const defaultProfile = settings.models.profiles[0];
  if (defaultProfile === undefined) {
    throw new Error("Fixture model profile is missing.");
  }
  defaultProfile["contextWindow"] = 128_000;
  await writeFile(join(target, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  return target;
}
