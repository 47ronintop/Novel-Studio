import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_TARGET_CHARACTER_COUNT = 1_000_000;
const DEFAULT_CHAPTER_COUNT = 20;
const FIXTURE_TIME = "2026-07-04T00:00:00.000Z";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await createPerformanceFixture(options);
}

function parseArgs(args) {
  const targetRoot = args[0];
  if (targetRoot === undefined || targetRoot.startsWith("--")) {
    throw new Error(
      "Usage: node scripts/create-performance-fixture.mjs <target-root> [--target-character-count N] [--chapter-count N]"
    );
  }

  return {
    targetRoot,
    targetCharacterCount: readNumberOption(
      args,
      "--target-character-count",
      DEFAULT_TARGET_CHARACTER_COUNT
    ),
    chapterCount: readNumberOption(args, "--chapter-count", DEFAULT_CHAPTER_COUNT)
  };
}

function readNumberOption(args, name, defaultValue) {
  const index = args.indexOf(name);
  if (index === -1) {
    return defaultValue;
  }

  const rawValue = args[index + 1];
  const parsed = rawValue === undefined ? Number.NaN : Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

async function createPerformanceFixture(options) {
  await mkdir(join(options.targetRoot, "chapters"), { recursive: true });
  await mkdir(join(options.targetRoot, "history"), { recursive: true });
  await mkdir(join(options.targetRoot, "memories"), { recursive: true });
  await mkdir(join(options.targetRoot, "cache"), { recursive: true });

  await writeFile(join(options.targetRoot, "project.json"), `${projectJson(options)}\n`);
  await writeFile(join(options.targetRoot, "settings.json"), `${settingsJson()}\n`);
  await writeFile(
    join(options.targetRoot, "performance-fixture.json"),
    `${JSON.stringify(
      {
        targetCharacterCount: options.targetCharacterCount,
        chapterCount: options.chapterCount
      },
      null,
      2
    )}\n`
  );

  const chapterSizes = distributeCharacters(options.targetCharacterCount, options.chapterCount);
  await Promise.all(
    chapterSizes.map((characterCount, index) =>
      writeFile(
        join(options.targetRoot, "chapters", `ch_perf_${pad(index + 1)}.md`),
        chapterMarkdown(index + 1, characterCount)
      )
    )
  );
}

function projectJson(options) {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      projectId: "prj_performance_fixture",
      title: "Performance Fixture Project",
      projectType: "novel",
      language: "en-US",
      createdAt: FIXTURE_TIME,
      updatedAt: FIXTURE_TIME,
      defaultWorkflowId: "wf_default_review",
      defaultModelProfileId: "model_performance",
      stats: {
        targetWordCount: options.targetCharacterCount,
        currentWordCount: options.targetCharacterCount,
        chapterCount: options.chapterCount
      }
    },
    null,
    2
  );
}

function settingsJson() {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      autosave: {
        enabled: true,
        intervalMs: 30000,
        createHistorySnapshot: false
      },
      history: {
        snapshotPolicy: "manual-and-interval",
        intervalMinutes: 10,
        maxSnapshotsPerChapter: null
      },
      models: {
        defaultProfileId: "model_performance",
        profiles: [
          {
            id: "model_performance",
            provider: "openai-compatible",
            displayName: "Performance Fixture Model",
            baseUrl: "https://api.example.invalid/v1",
            apiKeyRef: "secret://model_performance/api_key",
            modelName: "fixture-model",
            temperature: 0.7,
            maxTokens: 4096,
            topP: 1,
            timeoutMs: 60000,
            frequencyPenalty: 0,
            presencePenalty: 0
          }
        ]
      }
    },
    null,
    2
  );
}

function distributeCharacters(targetCharacterCount, chapterCount) {
  const baseSize = Math.floor(targetCharacterCount / chapterCount);
  const remainder = targetCharacterCount % chapterCount;

  return Array.from({ length: chapterCount }, (_, index) =>
    index < remainder ? baseSize + 1 : baseSize
  );
}

function chapterMarkdown(index, characterCount) {
  const title = `Performance Chapter ${index}`;
  const id = `ch_perf_${pad(index)}`;
  const body = buildBody(characterCount);

  return `---
schemaVersion: "1.0"
id: "${id}"
type: "chapter"
title: "${title}"
order: ${index}
status: "draft"
createdAt: "${FIXTURE_TIME}"
updatedAt: "${FIXTURE_TIME}"
---

${body}
`;
}

function buildBody(characterCount) {
  const seed =
    "Performance fixture paragraph for Novel Studio alpha baseline. It is synthetic and safe. ";
  let body = "";
  while (body.length < characterCount) {
    body += seed;
  }

  return body.slice(0, characterCount);
}

function pad(value) {
  return value.toString().padStart(4, "0");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown performance fixture error.";
  console.error(message);
  process.exitCode = 1;
});
