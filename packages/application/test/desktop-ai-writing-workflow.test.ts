import { describe, expect, test } from "vitest";

import { ok } from "@novel-studio/shared";

import { createDesktopApplication } from "../src/desktop-application.js";
import type {
  AiWritingSuggestion,
  AiWritingWorkflowSession
} from "../src/ai-writing-workflow-session.js";

const cleanStyleReview = {
  status: "clean" as const,
  hitCount: 0,
  hits: []
};

const suggestion: AiWritingSuggestion = {
  suggestionId: "sug_m14",
  workflowRunId: "wfrun_m14",
  status: "pending-confirmation",
  proposedBody: "Opening line.\nAI continuation.\n",
  summary: "Continues the current scene.",
  conversationMessages: [],
  styleReview: cleanStyleReview,
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
  },
  observability: {
    workflowRunId: "wfrun_m14",
    workflowTitle: "Continue Chapter",
    generatedAt: "2026-07-04T00:00:00.000Z",
    context: {
      sourceCount: 0,
      tokenEstimate: 0,
      selectionReason: "Continue."
    },
    model: {
      profileId: "mock_m14",
      displayName: "M14 Mock Writer",
      provider: "mock",
      modelName: "mock-writer"
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageStatus: "missing",
      cost: {
        amount: 0,
        currency: "USD",
        status: "unknown"
      }
    },
    steps: []
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
    async *streamChapterSuggestion(request) {
      calls.push(`stream:${request.instruction}`);
      yield ok({
        type: "suggestion",
        suggestion
      });
    },
    async generateSelectionPreview(request) {
      calls.push(`selection:${request.instruction}`);
      return ok({
        previewId: "sug_selection_m74",
        workflowRunId: "wfrun_selection_m74",
        previewOnly: true,
        proposedText: "Selection rewrite.",
        summary: "Selection preview.",
        styleReview: cleanStyleReview,
        review: {
          status: "pending",
          originalText: request.selection.selectedText,
          proposedText: "Selection rewrite.",
          rangeLabel: `${request.selection.startOffset}-${request.selection.endOffset}`,
          compareLabel: `${request.selection.selectedText} -> Selection rewrite.`
        },
        selection: request.selection,
        diffPreview: {
          title: "Selection AI preview",
          changes: [{ kind: "replace", value: "Selection rewrite.\n" }]
        },
        contextTrace: {
          selectionReason: request.instruction,
          includedRefs: [],
          excludedRefs: []
        },
        observability: {
          workflowRunId: "wfrun_selection_m74",
          workflowTitle: "Selection Preview",
          generatedAt: "2026-07-04T00:00:00.000Z",
          context: {
            sourceCount: 0,
            tokenEstimate: 0,
            selectionReason: request.instruction
          },
          model: {
            profileId: "mock_m14",
            displayName: "M14 Mock Writer",
            provider: "mock",
            modelName: "mock-writer"
          },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            usageStatus: "missing",
            cost: {
              amount: 0,
              currency: "USD",
              status: "unknown"
            }
          },
          steps: []
        }
      });
    },
    async applySelectionPreview(previewId) {
      calls.push(`apply-selection:${previewId}`);
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
            body: "Selection rewrite.\n"
          },
          dirty: true,
          saveStatus: "Unsaved"
        },
        versions: []
      });
    },
    async applyChapterSuggestion(suggestionId) {
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
