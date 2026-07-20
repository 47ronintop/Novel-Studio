import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import type {
  AgentConversationMainReview,
  AgentConversationWorkspaceShellProps,
  AiWritingWorkflowProps
} from "../src/workspace-shell-types.js";
import { WorkspaceShell } from "../src/workspace-shell.js";

describe("Change Set central review", () => {
  test("renders the pending revision centrally with one compact conversation summary", () => {
    const application = createDesktopApplication();
    const workflow = createReviewWorkflow();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={reviewWorkspace(workflow)}
        aiWritingWorkflow={workflow}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={reviewShellState(application.getShellState())}
      />
    );

    expect(html).toContain('aria-label="中央审阅摘要"');
    expect(html).toContain('aria-label="变更集差异审阅"');
    expect(html.match(/cs-checksum-r4/g)).toHaveLength(1);
    expect(html.match(/>v4</g)).toHaveLength(1);
    expect(html).toContain("尚未写入");
    expect(html).toContain("chapters/ch_03.md");
    expect(html).toContain("+2");
    expect(html).toContain("-1");
    expect(html).toContain("校验通过");
  });

  test("surfaces hash conflicts without presenting the proposal as written", () => {
    const application = createDesktopApplication();
    const workflow = createReviewWorkflow({
      baseHashConflictPaths: ["chapters/ch_03.md"]
    });
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={reviewWorkspace(workflow)}
        aiWritingWorkflow={workflow}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={reviewShellState(application.getShellState())}
      />
    );

    expect(html).toContain("Base hash 冲突");
    expect(html).toContain("尚未写入");
    expect(html).not.toContain("已写入");
  });

  test("never presents an invalid file as an overall validation pass", () => {
    const application = createDesktopApplication();
    const workflow = createReviewWorkflow({ valid: false });
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={reviewWorkspace(workflow)}
        aiWritingWorkflow={workflow}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={reviewShellState(application.getShellState())}
      />
    );
    const review = html.match(/<section class="ns-diff-review"[\s\S]*?<\/section>/)?.[0];

    expect(review).toBeDefined();
    expect(review).toContain("校验失败");
    expect(review).not.toContain("校验通过");
  });

  test("marks an applied Change Set as written instead of pending", () => {
    const application = createDesktopApplication();
    const workflow = createReviewWorkflow({ status: "applied" });
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={reviewWorkspace(workflow)}
        aiWritingWorkflow={workflow}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={reviewShellState(application.getShellState())}
      />
    );

    expect(html).toContain("已写入");
    expect(html).not.toContain("尚未写入");
  });

  test("prioritizes rollback review with three-way content decisions statuses and retry", () => {
    const application = createDesktopApplication();
    const workflow = createReviewWorkflow();
    const agentRunWithoutChangeSetReview = { ...workflow.agentRun };
    delete agentRunWithoutChangeSetReview.changeSetReview;
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={reviewWorkspace({
          ...workflow,
          agentRun: {
            ...agentRunWithoutChangeSetReview,
            rollbackReview: rollbackReviewFixture()
          }
        } as AiWritingWorkflowProps)}
        aiWritingWorkflow={{
          ...workflow,
          agentRun: {
            ...agentRunWithoutChangeSetReview,
            rollbackReview: rollbackReviewFixture()
          }
        } as AiWritingWorkflowProps}
        chapterEditor={chapterEditor}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={reviewShellState(application.getShellState())}
      />
    );

    expect(html).toContain('aria-label="运行撤销冲突审阅"');
    expect(html).toContain("当前内容");
    expect(html).toContain("AI 最后写入");
    expect(html).toContain("运行前基线");
    expect(html).toContain("保留当前");
    expect(html).toContain("恢复运行前");
    expect(html).toContain("冲突");
    expect(html).toContain("失败");
    expect(html).toContain("已恢复");
    expect(html).toContain("已保留");
    expect(html).toContain("应用所选恢复");
    expect(html).toContain("仅重试失败项");
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

function reviewWorkspace(workflow: AiWritingWorkflowProps): AgentConversationWorkspaceShellProps {
  const agentRun = workflow.agentRun;
  if (agentRun === undefined) throw new Error("Expected an Agent run review fixture.");
  const conversation = {
    conversationId: "conversation-review-01",
    title: "Change Set Review",
    status: "active" as const,
    updatedAtLabel: "10:00",
    runCount: 1,
    turns: []
  };
  const mainReview: AgentConversationMainReview | undefined =
    agentRun.rollbackReview !== undefined
      ? { kind: "rollback", props: agentRun.rollbackReview }
      : agentRun.changeSetReview === undefined
        ? undefined
        : { kind: "change_set", props: agentRun.changeSetReview };
  return {
    navigator: {
      conversations: [conversation],
      selectedConversationId: conversation.conversationId,
      activeConversationId: conversation.conversationId,
      searchQuery: "",
      filter: "active",
      loading: false,
      onSearchQueryChange: () => undefined,
      onFilterChange: () => undefined,
      onCreate: () => undefined,
      onSelect: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined
    },
    view: {
      conversation,
      activeConversationId: conversation.conversationId,
      activeConversationTitle: conversation.title,
      agentRun,
      ...(mainReview === undefined ? {} : { mainReview }),
      loading: false,
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined
    },
    ...(mainReview === undefined ? {} : { mainReview })
  };
}

function reviewShellState(shellState: ReturnType<ReturnType<typeof createDesktopApplication>["getShellState"]>) {
  return {
    ...shellState,
    projectTitle: "Review Project",
    workspaceContext: {
      kind: "creativeProject" as const,
      workspaceId: "project-01",
      projectId: "project-01",
      displayName: "Review Project",
      capabilities: ["creativeWorkbench", "writingContext"] as const
    }
  };
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

function rollbackReviewFixture() {
  return {
    review: {
      schemaVersion: "1.0" as const,
      reviewId: "rollback-review-01",
      runId: "run-01",
      status: "partial_failure" as const,
      sourceVersionGroupIds: ["versions-01"],
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:01:00.000Z",
      processedCommandIds: [],
      files: [
        rollbackFile("notes/conflict.md", "conflict", "当前冲突"),
        rollbackFile("notes/failed.md", "failed", "当前失败"),
        rollbackFile("notes/completed.md", "completed", "运行前内容"),
        rollbackFile("notes/kept.md", "kept", "保留内容")
      ]
    },
    applying: false,
    decisions: {},
    onDecisionChange: () => undefined,
    onApply: () => undefined,
    onRetryFailed: () => undefined,
    onReturn: () => undefined
  };
}

function rollbackFile(relativePath: string, status: string, current: string) {
  return {
    relativePath,
    assetType: "text",
    baselineContent: "运行前内容",
    baselineChecksum: "a".repeat(64),
    baselineVersionId: "ver-before",
    runLastWriteContent: "AI 写入内容",
    runLastWriteChecksum: "b".repeat(64),
    reviewedCurrentContent: current,
    reviewedCurrentChecksum: "c".repeat(64),
    diff: {
      currentToLastWrite: "current -> ai",
      currentToBaseline: "current -> baseline",
      lastWriteToBaseline: "ai -> baseline"
    },
    status
  };
}
