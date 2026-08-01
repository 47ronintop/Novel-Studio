import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { LlmRequest } from "@novel-studio/llm-adapter";
import { AgentUsageFileRepository, StoryBibleFileRepository } from "@novel-studio/repository";

import { createProjectDesktopApplication } from "../src/main/application-composition.js";
import { createApplicationIpcHandlers } from "../src/main/ipc-handlers.js";

const fixtureRoot = join(process.cwd(), "fixtures", "projects", "minimal-chapter");
const chapterId = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";
const now = "2026-07-31T00:00:00.000Z";
const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Story Analysis desktop composition", () => {
  test("uses the active project identity and persists context plus workflow history", async () => {
    const projectRoot = await copyFixtureProjectWithContextWindow();
    const requests: LlmRequest[] = [];
    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => now,
      createAiProvider: () => ({
        id: "story-observer-test",
        async complete(request) {
          requests.push(request);
          return {
            content: { type: "json", value: { observations: [] } },
            usage: {
              inputTokens: 48,
              outputTokens: 4,
              totalTokens: 52,
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

      const analyzed = await application.analyzeChapterStory({
        chapterId,
        trigger: "manual"
      });

      expect(analyzed).toMatchObject({
        ok: true,
        value: {
          storyAnalysis: {
            analysisRun: {
              trigger: "manual",
              chapter: { chapterId },
              status: "completed",
              usage: { inputTokens: 48, outputTokens: 4 }
            },
            observations: [],
            records: []
          }
        }
      });
      if (!analyzed.ok) throw new Error(analyzed.error.message);

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        traceId: "story-analysis",
        mode: "non-streaming",
        responseFormat: { type: "json_object" }
      });

      const analysisRun = analyzed.value.storyAnalysis.analysisRun;
      const contextSnapshot = JSON.parse(
        await readFile(
          join(
            projectRoot,
            "history",
            "agent-runs",
            analysisRun.analysisRunId,
            "context-snapshots",
            `${analysisRun.contextSnapshot.contextSnapshotId}.json`
          ),
          "utf8"
        )
      ) as Record<string, unknown>;
      expect(contextSnapshot).toMatchObject({
        runId: analysisRun.analysisRunId,
        scope: {
          kind: "workspace",
          workspaceKind: "creativeProject",
          workspaceId: "prj_minimal_chapter"
        }
      });

      const persistedWorkflow = JSON.parse(
        await readFile(
          join(
            projectRoot,
            "history",
            "workflows",
            "runs",
            `${analyzed.value.workflowRun.workflowRunId}.json`
          ),
          "utf8"
        )
      ) as Record<string, unknown>;
      expect(persistedWorkflow).toMatchObject({
        workflowId: "wf_story_analysis",
        storyAnalysis: { analysisRun: { analysisRunId: analysisRun.analysisRunId } }
      });
      expect(JSON.stringify(persistedWorkflow)).not.toContain("secret://");
      expect(JSON.stringify(persistedWorkflow)).not.toContain(projectRoot);

      const listed =
        await createApplicationIpcHandlers(application)["application:story-analysis:list"]();
      expect(listed).toMatchObject({
        ok: true,
        value: [
          {
            workflowRunId: analyzed.value.workflowRun.workflowRunId,
            chapterId,
            status: "completed"
          }
        ]
      });
    } finally {
      await application.shutdown();
    }
  });

  test("persists the Story Analysis usage reference and reads it after restart", async () => {
    const projectRoot = await copyFixtureProjectWithContextWindow();
    const userDataRoot = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-usage-"));
    tempRoots.push(userDataRoot);
    const createApplication = () =>
      createProjectDesktopApplication({
        projectRoot,
        userDataRoot,
        chapterId,
        projectTitle: "Minimal Chapter Project",
        now: () => now,
        createAiProvider: () => ({
          id: "story-observer-usage-test",
          async complete() {
            return {
              content: { type: "json", value: { observations: [] } },
              usage: {
                inputTokens: 48,
                outputTokens: 4,
                totalTokens: 52,
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

    const application = createApplication();
    let workflowRunId = "";
    let usageRecordId = "";
    try {
      await expect(application.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      const analyzed = await application.analyzeChapterStory({ chapterId, trigger: "manual" });
      if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.error));
      workflowRunId = analyzed.value.workflowRun.workflowRunId;
      usageRecordId = analyzed.value.storyAnalysis.analysisRun.usage.usageRecordId ?? "";
      expect(usageRecordId).toMatch(/^run_[a-f0-9]{32}:story_observer:1$/u);
    } finally {
      await application.shutdown();
    }

    const usageRepository = new AgentUsageFileRepository({ userDataRoot });
    await expect(usageRepository.readById(usageRecordId)).resolves.toMatchObject({
      ok: true,
      value: {
        usageId: usageRecordId,
        runId: usageRecordId.split(":", 1)[0],
        inputTokens: 48,
        outputTokens: 4
      }
    });

    const restarted = createApplication();
    try {
      await expect(restarted.openProject(projectRoot)).resolves.toMatchObject({ ok: true });
      await expect(restarted.readStoryAnalysis(workflowRunId)).resolves.toMatchObject({
        ok: true,
        value: {
          storyAnalysis: { analysisRun: { usage: { usageRecordId } } }
        }
      });
    } finally {
      await restarted.shutdown();
    }
  });

  test("previews and transactionally applies an accepted Story Bible suggestion", async () => {
    const projectRoot = await copyFixtureProjectWithContextWindow();
    const chapterPath = join(projectRoot, "chapters", `${chapterId}.md`);
    await writeFile(
      chapterPath,
      `${(await readFile(chapterPath, "utf8")).trimEnd()}\n\n林默抵达北站。\n`
    );
    const characterId = `chr_${"a".repeat(32)}`;
    const locationId = `loc_${"b".repeat(32)}`;
    const storyBible = new StoryBibleFileRepository({
      projectRoot,
      now: () => now,
      createAssetId: (type) =>
        type === "character"
          ? characterId
          : type === "world.location"
            ? locationId
            : type === "timeline.events"
              ? "timeline_main"
              : `asset_${"c".repeat(32)}`
    });
    await expect(
      storyBible.createStoryAsset({ type: "world.location", value: { title: "北站" } })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      storyBible.createStoryAsset({ type: "character", value: { title: "林默" } })
    ).resolves.toMatchObject({ ok: true });
    await expect(
      storyBible.createStoryAsset({ type: "timeline.events", value: { title: "主时间线" } })
    ).resolves.toMatchObject({ ok: true });

    const application = createProjectDesktopApplication({
      projectRoot,
      chapterId,
      projectTitle: "Minimal Chapter Project",
      now: () => now,
      projectLockOwnerId: "story-analysis-apply-test",
      createAiProvider: ({ chapterEditorSession }) => ({
        id: "story-observer-apply-test",
        async complete(request) {
          const userMessage = request.messages.find((message) => message.role === "user");
          const payload = JSON.parse(userMessage?.content ?? "{}") as {
            chapter?: { body?: string };
          };
          const body = payload.chapter?.body ?? chapterEditorSession.getSnapshot().body;
          const excerpt = "林默抵达北站";
          const start = body.indexOf(excerpt);
          if (start < 0) throw new Error("Story Analysis evidence fixture is missing.");
          return {
            content: {
              type: "json",
              value: {
                observations: [
                  {
                    domain: "character.location",
                    subjectMention: "林默",
                    expectedType: "character",
                    fact: { kind: "character_location", value: { locationMention: "北站" } },
                    evidence: [{ start, end: start + excerpt.length, excerpt }],
                    epistemicStatus: "narrator_asserted",
                    confidence: 0.99,
                    reason: "章节客观叙述确认人物抵达北站。"
                  }
                ]
              }
            },
            usage: {
              inputTokens: 60,
              outputTokens: 20,
              totalTokens: 80,
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
      const analyzed = await application.analyzeChapterStory({ chapterId, trigger: "manual" });
      if (!analyzed.ok) throw new Error(JSON.stringify(analyzed.error));
      const suggestions = analyzed.value.storyAnalysis.records.filter(
        (record) => record.recordType === "change"
      );
      expect(suggestions).toHaveLength(2);
      expect(suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recordType: "change",
            status: "pending",
            target: expect.objectContaining({ assetId: characterId })
          }),
          expect.objectContaining({
            recordType: "change",
            status: "pending",
            target: expect.objectContaining({ assetId: "timeline_main" })
          })
        ])
      );
      const suggestionIds = suggestions.map((suggestion) => suggestion.suggestionId);
      if (suggestionIds.length !== 2) {
        throw new Error("Expected the character and timeline consistency-group suggestions.");
      }

      const preview = await application.prepareStoryAnalysisApplication({
        workflowRunId: analyzed.value.workflowRun.workflowRunId,
        suggestionIds
      });
      if (!preview.ok) throw new Error(JSON.stringify(preview.error));
      expect(preview).toMatchObject({
        ok: true,
        value: {
          changeSet: { status: "awaiting_approval" }
        }
      });
      expect(
        preview.value.analysis.storyAnalysis.records
          .filter((record) => record.recordType === "change")
          .map((record) => record.status)
      ).toEqual(["accepted", "accepted"]);
      expect(preview.value.changeSet.files.map((file) => file.assetId).sort()).toEqual(
        [characterId, "timeline_main"].sort()
      );

      const applied = await application.applyStoryAnalysisApplication({
        workflowRunId: analyzed.value.workflowRun.workflowRunId,
        suggestionIds,
        changeSetId: preview.value.changeSet.changeSetId,
        revision: preview.value.changeSet.revision,
        checksum: preview.value.changeSet.checksum
      });
      expect(applied).toMatchObject({
        ok: true,
        value: {
          batch: {
            groups: [
              {
                status: "applied"
              }
            ]
          }
        }
      });
      if (!applied.ok) throw new Error(JSON.stringify(applied.error));
      expect(
        applied.value.analysis.storyAnalysis.records
          .filter((record) => record.recordType === "change")
          .map((record) => record.status)
      ).toEqual(["applied", "applied"]);
      expect(
        [...(applied.value.batch.groups[0]?.storyBibleReceipt?.suggestionIds ?? [])].sort()
      ).toEqual([...suggestionIds].sort());

      const updated = await storyBible.readCompatibleStoryAsset(characterId);
      expect(updated).toMatchObject({
        ok: true,
        value: {
          asset: {
            revision: 2,
            details: { currentState: { locationId, asOfChapterId: chapterId } }
          }
        }
      });
      const timeline = await storyBible.readCompatibleStoryAsset("timeline_main");
      expect(timeline).toMatchObject({
        ok: true,
        value: {
          asset: {
            revision: 2,
            details: {
              events: [
                {
                  chapterIds: [chapterId],
                  characterIds: [characterId],
                  stateChanges: [
                    {
                      subjectId: characterId,
                      path: "/details/currentState/locationId",
                      after: locationId
                    }
                  ]
                }
              ]
            }
          }
        }
      });
    } finally {
      await application.shutdown();
    }
  }, 15_000);
});

async function copyFixtureProjectWithContextWindow(): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), "novel-studio-story-analysis-"));
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
  if (defaultProfile === undefined) throw new Error("Fixture model profile is missing.");
  defaultProfile["contextWindow"] = 128_000;
  await writeFile(join(target, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  return target;
}
