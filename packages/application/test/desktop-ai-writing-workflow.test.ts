import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";

import { createDesktopApplication } from "../src/desktop-application.js";
import type {
  AiWritingSuggestion,
  AiWritingWorkflowSession
} from "../src/ai-writing-workflow-session.js";

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation.\n",
  summary: "Continues the current scene.",
  diffPreview: {
    title: "AI suggestion",
    changes: [
      {
        kind: "replace",
        value: "Opening line.\nAI continuation.\n"
      }
    ]
  },
  contextTrace: {
    selectionReason: "Continue.",
    includedRefs: [],
    excludedRefs: []
  }
};

describe("M14 desktop AI writing workflow", () => {
  test("routes generation and apply commands through the AI workflow session", async () => {
    const calls: string[] = [];
    const application = createDesktopApplication({
      aiWritingWorkflowSession: createFakeAiSession(calls)
    });

    const generated = await application.generateActiveChapterSuggestion({
      instruction: "Continue."
    });
    const applied = await application.applyActiveChapterSuggestion("sug_m14");

    expect(generated).toEqual(ok(suggestion));
    expect(applied).toEqual(
      ok({
        state: {
          chapter: {
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
            body: "Opening line.\nAI continuation.\n"
          },
          dirty: true,
          saveStatus: "Unsaved"
        },
        versions: []
      })
    );
    expect(calls).toEqual(["generate:Continue.", "apply:sug_m14"]);
  });
});

function createFakeAiSession(calls: string[]): AiWritingWorkflowSession {
  return {
    async generateChapterSuggestion(request) {
      calls.push(`generate:${request.instruction}`);
      return ok(suggestion);
    },
    applyChapterSuggestion(suggestionId) {
      calls.push(`apply:${suggestionId}`);
      return ok({
        state: {
          chapter: {
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
            body: "Opening line.\nAI continuation.\n"
          },
          dirty: true,
          saveStatus: "Unsaved"
        },
        versions: []
      });
    }
  };
}
