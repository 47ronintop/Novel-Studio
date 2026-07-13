import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import type { AiWritingWorkflowProps } from "../src/workspace-shell-types.js";
import { WorkspaceShell } from "../src/workspace-shell.js";

describe("Change Set summary", () => {
  test("renders the pending revision shared with the main Diff Review", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        aiWritingWorkflow={createReviewWorkflow()}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={application.getShellState()}
      />
    );

    expect(html).toContain('aria-label="Change Set 摘要"');
    expect(html).toContain('aria-label="变更集差异审阅"');
    expect(html.match(/cs-checksum-r4/g)).toHaveLength(2);
    expect(html.match(/>v4</g)).toHaveLength(2);
    expect(html).toContain("尚未写入");
    expect(html).toContain("chapters/ch_03.md");
    expect(html).toContain("+2");
    expect(html).toContain("-1");
    expect(html).toContain("校验通过");
  });

  test("surfaces hash conflicts without presenting the proposal as written", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        aiWritingWorkflow={createReviewWorkflow({
          baseHashConflictPaths: ["chapters/ch_03.md"]
        })}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={application.getShellState()}
      />
    );

    expect(html).toContain("Base hash 冲突");
    expect(html).toContain("尚未写入");
    expect(html).not.toContain("已写入");
  });

  test("never presents an invalid file as an overall validation pass", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        aiWritingWorkflow={createReviewWorkflow({ valid: false })}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={application.getShellState()}
      />
    );
    const summary = html.match(
      /<section class="ns-change-set-summary"[\s\S]*?<\/section>/
    )?.[0];

    expect(summary).toBeDefined();
    expect(summary).toContain("校验失败");
    expect(summary).not.toContain("校验通过");
  });

  test("marks an applied Change Set as written instead of pending", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        aiWritingWorkflow={createReviewWorkflow({ status: "applied" })}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={application.getShellState()}
      />
    );

    expect(html).toContain("已写入");
    expect(html).not.toContain("尚未写入");
  });
});

interface ReviewOverrides {
  readonly baseHashConflictPaths?: readonly string[];
  readonly status?: string;
  readonly valid?: boolean;
}

function createReviewWorkflow(overrides: ReviewOverrides = {}): AiWritingWorkflowProps {
  return {
    status: "idle",
    instruction: "",
    onInstructionChange: () => undefined,
    onGenerateSuggestion: () => undefined,
    onApplySuggestion: () => undefined,
    onRetrySuggestion: () => undefined,
    onCancelStreaming: () => undefined,
    agentRun: {
      projectId: "project-01",
      runId: "run-01",
      operationMode: "execution",
      contextMode: "writing",
      status: "awaiting_write_approval",
      userRequest: "调整第三章",
      assistantText: "候选修改已经准备好。",
      events: [],
      onOperationModeChange: () => undefined,
      onContextModeChange: () => undefined,
      onSend: () => undefined,
      onStop: () => undefined,
      onAnswerUserInput: () => undefined,
      onResume: () => undefined,
      onRetryStep: () => undefined,
      onRefreshContext: () => undefined,
      onDecidePlan: () => undefined,
      changeSetReview: {
        changeSet: {
          ...changeSetFixture,
          status: overrides.status ?? changeSetFixture.status,
          files: changeSetFixture.files.map((file) => ({
            ...file,
            validation: {
              valid: overrides.valid ?? file.validation.valid,
              issues: overrides.valid === false ? ["章节结构无效"] : file.validation.issues
            }
          }))
        },
        runRevision: 12,
        applying: false,
        stale: false,
        selectionPending: false,
        baseHashConflictPaths: overrides.baseHashConflictPaths ?? [],
        dirtyTargetPaths: [],
        onSelectionChange: () => undefined,
        onApply: () => undefined,
        onReject: () => undefined,
        onReturn: () => undefined
      }
    }
  } as unknown as AiWritingWorkflowProps;
}

const changeSetFixture = {
  changeSetId: "change-set-01",
  revision: 4,
  checksum: "cs-checksum-r4",
  status: "pending",
  files: [
    {
      relativePath: "chapters/ch_03.md",
      assetType: "chapter",
      baseChecksum: "base-ch03",
      candidateChecksum: "candidate-ch03",
      selected: true,
      validation: { valid: true, issues: [] },
      hunks: [
        {
          hunkId: "hunk-ch03-p5",
          label: "第 5 段",
          baseText: "她停在门外。",
          candidateText: "她在门外停住，听见里面压低的争执。",
          baseRange: { start: 5, end: 5 },
          candidateRange: { start: 5, end: 5 },
          selected: true,
          additions: 2,
          deletions: 1
        }
      ]
    }
  ]
} as const;

const chapterEditor = {
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_03",
      type: "chapter",
      title: "第三章",
      order: 3,
      status: "draft",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z"
    },
    body: "她停在门外。"
  },
  dirty: false,
  saveStatus: "Saved",
  versionHistory: []
} as const;
