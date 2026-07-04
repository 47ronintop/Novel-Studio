import { describe, expect, test } from "vitest";

import { createAgentBackedAiWritingWorkflowSession } from "../src/ai-writing-workflow-session.js";
import { createChapterEditorSession } from "../src/chapter-editor-session.js";
import { createLlmAdapter, createMockProvider } from "@novel-studio/llm-adapter";
import { isErr, isOk, ok, type ChapterDocument } from "@novel-studio/shared";
import type { ChapterDraftRepositoryPort } from "../src/chapter-editor-session.js";

const originalChapter = {
  frontmatter: {
    schemaVersion: "1.0",
    id: "ch_m14",
    type: "chapter",
    title: "M14",
    order: 1,
    status: "draft",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z"
  },
  body: "Opening line.\n"
} satisfies ChapterDocument;

const proposedBody = "Opening line.\nAI continuation.\n";

describe("M14 AI writing workflow session", () => {
  test("generates a preview-only suggestion and applies it only after confirmation", async () => {
    const writes: ChapterDocument[] = [];
    const chapterSession = createChapterEditorSession({
      chapterId: "ch_m14",
      repository: createRepository(writes),
      now: () => "2026-07-04T00:00:00.000Z"
    });
    const loaded = await chapterSession.load();
    if (isErr(loaded)) {
      throw new Error(loaded.error.message);
    }

    const aiWorkflow = createAgentBackedAiWritingWorkflowSession({
      chapterEditorSession: chapterSession,
      llmAdapter: createLlmAdapter({
        provider: createMockProvider({
          completions: [
            {
              type: "success",
              content: {
                type: "json",
                value: {
                  proposedBody,
                  summary: "Continues the current scene."
                }
              }
            }
          ]
        }),
        clock: () => "2026-07-04T00:00:00.000Z"
      }),
      now: () => "2026-07-04T00:00:00.000Z",
      createWorkflowRunId: () => "wfrun_m14",
      createSuggestionId: () => "sug_m14",
      createAgentRunId: () => "agentrun_m14",
      createHandoffId: () => "handoff_m14"
    });

    const generated = await aiWorkflow.generateChapterSuggestion({
      instruction: "Continue the chapter."
    });

    expect(isOk(generated)).toBe(true);
    if (isErr(generated)) {
      throw new Error(generated.error.message);
    }
    expect(generated.value).toMatchObject({
      suggestionId: "sug_m14",
      workflowRunId: "wfrun_m14",
      status: "pending-confirmation",
      proposedBody,
      summary: "Continues the current scene."
    });
    expect(generated.value.diffPreview.changes).toEqual([
      {
        kind: "replace",
        value: proposedBody
      }
    ]);
    expect(generated.value.contextTrace.includedRefs).toEqual([
      {
        refType: "chapter",
        refId: "ch_m14",
        tokenEstimate: 4
      }
    ]);
    expect(chapterSession.getState()?.chapter.body).toBe("Opening line.\n");
    expect(chapterSession.getState()?.dirty).toBe(false);
    expect(writes).toEqual([]);

    const applied = aiWorkflow.applyChapterSuggestion("sug_m14");

    expect(isOk(applied)).toBe(true);
    if (isErr(applied)) {
      throw new Error(applied.error.message);
    }
    expect(applied.value.state.chapter.body).toBe(proposedBody);
    expect(applied.value.state.dirty).toBe(true);
    expect(applied.value.state.saveStatus).toBe("Unsaved");
    expect(writes).toEqual([]);
  });
});

function createRepository(writes: ChapterDocument[]): ChapterDraftRepositoryPort {
  return {
    async readChapter() {
      return ok(originalChapter);
    },
    async writeChapter(chapter) {
      writes.push(chapter);
      return ok(chapter);
    }
  };
}
