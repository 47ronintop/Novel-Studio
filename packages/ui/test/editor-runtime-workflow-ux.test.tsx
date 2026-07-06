import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { ChapterEditor, WorkspaceShell } from "../src/index.js";

const chapter = {
  frontmatter: {
    schemaVersion: "1.0" as const,
    id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
    type: "chapter" as const,
    title: "Chapter One",
    order: 1,
    status: "draft" as const,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  },
  body: "Opening line.\n"
};

describe("M52/M53 editor runtime and workflow UX", () => {
  test("renders editor runtime status without filesystem details", () => {
    const html = renderToStaticMarkup(
      <ChapterEditor
        chapter={chapter}
        saveStatus="Unsaved"
        dirty={true}
        versionHistory={[]}
        runtime={{
          adapterLabel: "Textarea Runtime",
          documentMode: "Markdown",
          activeRangeLabel: "Lines 1-1",
          autosaveLabel: "Autosave armed",
          shortcutProfileLabel: "Default shortcuts",
          warnings: ["Large document optimizations inactive"]
        }}
      />
    );

    expect(html).toContain('aria-label="Editor Runtime"');
    expect(html).toContain("Textarea Runtime");
    expect(html).toContain("Markdown");
    expect(html).toContain("Lines 1-1");
    expect(html).toContain("Autosave armed");
    expect(html).toContain("Default shortcuts");
    expect(html).toContain("Large document optimizations inactive");
    expect(html).not.toMatch(/filesystem|node:fs|projectRoot/i);
  });

  test("renders a workflow rail with branch choices for live observability", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "suggestion-ready",
          instruction: "Continue the scene.",
          observability: {
            workflowRunId: "wfrun_branch",
            workflowTitle: "Continue Chapter",
            contextLabel: "2 sources / 120 tokens",
            modelLabel: "Default Model / example-model",
            usageLabel: "120 tokens",
            costLabel: "USD 0.000001",
            generatedAtLabel: "2026-07-06 10:00",
            steps: [
              {
                stepId: "build_context",
                label: "Build context",
                kind: "context",
                status: "completed"
              },
              {
                stepId: "choose_path",
                label: "Choose narrative path",
                kind: "branch",
                status: "completed",
                description: "Agent selected the high-tension continuation.",
                selectedBranchId: "high_tension",
                branchChoices: [
                  {
                    branchId: "quiet_reveal",
                    label: "Quiet reveal",
                    conditionLabel: "Low conflict"
                  },
                  {
                    branchId: "high_tension",
                    label: "High tension",
                    conditionLabel: "Escalate conflict"
                  }
                ]
              }
            ]
          },
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="Workflow rail"');
    expect(html).toContain("Choose narrative path");
    expect(html).toContain("Agent selected the high-tension continuation.");
    expect(html).toContain("Quiet reveal");
    expect(html).toContain("High tension");
    expect(html).toContain("Escalate conflict");
    expect(html).toContain('data-selected-branch="true"');
  });

  test("renders the workflow rail inside selected run history detail", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "failed",
          instruction: "Continue the scene.",
          history: {
            runs: [],
            selectedRun: {
              workflowRunId: "wfrun_history_branch",
              workflowTitle: "Continue Chapter",
              statusLabel: "Failed",
              updatedAtLabel: "2026-07-06 10:10",
              contextLabel: "2 sources / 120 tokens",
              modelLabel: "Default Model / example-model",
              usageLabel: "0 tokens",
              costLabel: "USD 0.000000",
              steps: [
                {
                  stepId: "choose_path",
                  label: "Choose narrative path",
                  kind: "branch",
                  status: "failed",
                  description: "No branch choice was returned.",
                  branchChoices: [
                    {
                      branchId: "quiet_reveal",
                      label: "Quiet reveal",
                      conditionLabel: "Low conflict"
                    }
                  ]
                }
              ],
              errorLabel: "WORKFLOW_BRANCH_MISSING"
            }
          },
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined,
          onRetrySuggestion: () => undefined,
          onCancelStreaming: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="History workflow rail"');
    expect(html).toContain("Choose narrative path");
    expect(html).toContain("No branch choice was returned.");
    expect(html).toContain("Quiet reveal");
    expect(html).toContain("WORKFLOW_BRANCH_MISSING");
  });
});
