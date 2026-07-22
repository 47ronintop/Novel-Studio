// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "../src/workspace-shell.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Agent Conversation workspace", () => {
  afterEach(() => document.body.replaceChildren());

  test.each(["workspace", "search", "timeline", "studio"] as const)(
    "keeps one Agent surface when the %s activity is active",
    (activeActivity) => {
      const application = createDesktopApplication();
      const legacyActivityId = ["a", "i"].join("");
      const conversation = {
        conversationId: "conversation-one-surface",
        title: "统一 Agent",
        status: "active" as const,
        updatedAtLabel: "16:00",
        runCount: 1,
        turns: []
      };
      const html = renderToStaticMarkup(
        <WorkspaceShell
          agentConversationWorkspace={oneSurfaceWorkspace(conversation) as never}
          commandPaletteOpen={false}
          commands={application.listCommands()}
          shellState={{
            ...application.getShellState(),
            activeActivity,
            workspaceContext: {
              kind: "creativeProject",
              workspaceId: "project-one-surface",
              projectId: "project-one-surface",
              displayName: "统一 Agent 项目",
              capabilities: [
                "creativeWorkbench",
                "writingContext",
                "creativeSearch",
                "creativeStudio"
              ]
            }
          }}
        />
      );

      expect(html.match(/<textarea[^>]*aria-label="Agent 请求"/g) ?? []).toHaveLength(1);
      expect(html.match(/aria-label="会话输入区"/g) ?? []).toHaveLength(1);
      expect(html.match(/aria-label="AI 对话面板"/g) ?? []).toHaveLength(1);
      expect(html).not.toContain(`data-activity-id="${legacyActivityId}"`);
      expect(html).not.toContain('aria-label="AI 写作工作流"');
    }
  );

  test("keeps the editor central and renders one conversation in the right panel", () => {
    const application = createDesktopApplication();
    const conversation = {
      conversationId: "conversation-01",
      title: "Review the opening",
      status: "active" as const,
      updatedAtLabel: "16:00",
      runCount: 1,
      turns: []
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <WorkspaceShell
          agentConversationWorkspace={{
            navigator: {
              conversations: [conversation],
              selectedConversationId: conversation.conversationId,
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
              loading: false,
              onCreate: () => undefined,
              onArchive: () => undefined,
              onRestore: () => undefined,
              onReturnToActive: () => undefined
            }
          }}
          commandPaletteOpen={false}
          commands={application.listCommands()}
          shellState={{ ...application.getShellState(), activeActivity: "workspace" }}
        />
      );
    });

    const editor = host.querySelector('[aria-label="编辑区"]');
    const aiPanel = host.querySelector('[aria-label="AI 对话面板"]');
    expect(host.querySelector('[aria-label="工作区导航"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Agent 会话导航"]')).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="历史会话"]')?.click());
    expect(host.querySelector('[aria-label="Agent 会话导航"]')).not.toBeNull();
    expect(editor?.querySelector('[aria-label="章节编辑器表面"]')).not.toBeNull();
    expect(editor?.querySelector('[aria-label="Agent 会话主视图"]')).toBeNull();
    expect(aiPanel?.querySelectorAll('[aria-label="Agent 会话主视图"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="Agent 运行检查器"]')).toBeNull();
    expect(host.querySelector('[aria-label="AI 工作流主视图"]')).toBeNull();
    expect(host.textContent).not.toContain("对话式写作助手");

    act(() => root.unmount());
  });

  test("renders plan approval and rejection in the central editor", () => {
    const application = createDesktopApplication();
    const onDecision = vi.fn();
    const conversation = {
      conversationId: "conversation-01",
      title: "Review the opening",
      status: "active" as const,
      updatedAtLabel: "16:00",
      runCount: 1,
      turns: []
    };
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;
    act(() => {
      root = createRoot(host);
      root.render(
        <WorkspaceShell
          agentConversationWorkspace={{
            navigator: {
              conversations: [conversation],
              selectedConversationId: conversation.conversationId,
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
              loading: false,
              onCreate: () => undefined,
              onArchive: () => undefined,
              onRestore: () => undefined,
              onReturnToActive: () => undefined
            },
            mainReview: {
              kind: "plan",
              props: {
                contextMode: "writing",
                plan: readyPlanArtifact(),
                onDecision
              }
            }
          }}
          commandPaletteOpen={false}
          commands={application.listCommands()}
          shellState={{ ...application.getShellState(), activeActivity: "workspace" }}
        />
      );
    });

    const editor = host.querySelector('[aria-label="编辑区"]');
    const aiPanel = host.querySelector('[aria-label="AI 对话面板"]');
    expect(editor?.querySelector('[aria-label="Plan Artifact 审阅"]')).not.toBeNull();
    expect(editor?.textContent).toContain("每次修改前确认");
    expect(editor?.textContent).toContain("本次运行自动修改");
    expect(editor?.textContent).not.toContain("写入前询问");
    expect(editor?.textContent).not.toContain("本次运行自动写入");
    const automaticWrite = Array.from(editor?.querySelectorAll("label") ?? [])
      .find((label) => label.textContent?.includes("本次运行自动修改"))
      ?.querySelector<HTMLInputElement>('input[type="radio"]');
    act(() => automaticWrite?.click());
    expect(editor?.textContent).not.toContain("我理解本次运行可自动修改");
    expect(editor?.querySelector('input[type="checkbox"]')).toBeNull();
    const approve = editor?.querySelector<HTMLButtonElement>('[aria-label="按此方案执行"]');
    expect(approve?.disabled).toBe(false);
    act(() => approve?.click());
    const confirmedWrite = Array.from(editor?.querySelectorAll("label") ?? [])
      .find((label) => label.textContent?.includes("每次修改前确认"))
      ?.querySelector<HTMLInputElement>('input[type="radio"]');
    act(() => confirmedWrite?.click());
    expect(aiPanel?.querySelector('[aria-label="Agent 会话主视图"]')).not.toBeNull();
    act(() => editor?.querySelector<HTMLButtonElement>('[aria-label="拒绝计划"]')?.click());
    act(() => editor?.querySelector<HTMLButtonElement>('[aria-label="按此方案执行"]')?.click());
    expect(onDecision).toHaveBeenCalledWith("approve", {
      executionContextMode: "writing",
      executionWritePolicy: "user_preapproved_run",
      executionWritePolicyAcknowledged: true
    });
    expect(onDecision).toHaveBeenCalledWith("reject");
    expect(onDecision).toHaveBeenCalledWith("approve", {
      executionContextMode: "writing",
      executionWritePolicy: "write_before_confirmation"
    });

    act(() => root?.unmount());
  });

  test.each([
    ["change_set", "变更集差异审阅"],
    ["rollback", "运行撤销冲突审阅"]
  ] as const)("renders %s review in the central editor", (kind, reviewLabel) => {
    const application = createDesktopApplication();
    const conversation = {
      conversationId: "conversation-01",
      title: "Review the opening",
      status: "active" as const,
      updatedAtLabel: "16:00",
      runCount: 1,
      turns: []
    };
    const mainReview =
      kind === "change_set"
        ? { kind, props: changeSetReviewProps() }
        : { kind, props: rollbackReviewProps() };
    const html = renderToStaticMarkup(
      <WorkspaceShell
        agentConversationWorkspace={{
          navigator: {
            conversations: [conversation],
            selectedConversationId: conversation.conversationId,
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
            loading: false,
            onCreate: () => undefined,
            onArchive: () => undefined,
            onRestore: () => undefined,
            onReturnToActive: () => undefined
          },
          mainReview
        }}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={{ ...application.getShellState(), activeActivity: "workspace" }}
      />
    );

    expect(html).toContain(`aria-label="${reviewLabel}"`);
    expect(html).toContain('aria-label="Agent 会话主视图"');
    expect(html).not.toContain('aria-label="章节编辑器表面"');
  });
});

function changeSetReviewProps() {
  return {
    changeSet: {
      changeSetId: "change-set-01",
      revision: 1,
      checksum: "checksum-01",
      status: "pending",
      files: []
    },
    runRevision: 2,
    applying: false,
    stale: false,
    selectionPending: false,
    baseHashConflictPaths: [],
    dirtyTargetPaths: [],
    onSelectionChange: () => undefined,
    onApply: () => undefined,
    onReject: () => undefined,
    onReturn: () => undefined
  };
}

function rollbackReviewProps() {
  return {
    review: {
      schemaVersion: "1.0" as const,
      reviewId: "rollback-01",
      runId: "run-01",
      status: "pending" as const,
      sourceVersionGroupIds: ["versions-01"],
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      processedCommandIds: [],
      files: []
    },
    applying: false,
    decisions: {},
    onDecisionChange: () => undefined,
    onApply: () => undefined,
    onRetryFailed: () => undefined,
    onReturn: () => undefined
  };
}

function readyPlanArtifact() {
  return {
    schemaVersion: "1.0" as const,
    planId: "plan-01",
    revision: 1,
    sourceRunId: "run-01",
    status: "ready" as const,
    operationMode: "planning" as const,
    contextMode: "writing" as const,
    goal: "修订当前章节",
    successCriteria: ["章节通过复核"],
    nonGoals: [],
    facts: [],
    assumptions: [],
    openQuestions: [],
    targetRefs: [],
    steps: [{ stepId: "step-01", title: "修订正文", verification: "检查版本差异" }],
    risks: [],
    verification: ["运行测试"],
    sourceRefs: ["chapter:chapter-01"],
    createdAt: "2026-07-13T00:00:00.000Z"
  };
}

function oneSurfaceWorkspace(conversation: {
  readonly conversationId: string;
  readonly title: string;
  readonly status: "active";
  readonly updatedAtLabel: string;
  readonly runCount: number;
  readonly turns: readonly never[];
}) {
  return {
    navigator: {
      conversations: [conversation],
      selectedConversationId: conversation.conversationId,
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
      loading: false,
      composer: {
        request: "检查当前项目",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        writePolicyAcknowledged: false,
        active: false,
        onRequestChange: () => undefined,
        onOperationModeChange: () => undefined,
        onContextModeChange: () => undefined,
        onWritePolicyChange: () => undefined,
        onSend: () => undefined,
        onStop: () => undefined
      },
      onCreate: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      onReturnToActive: () => undefined
    }
  };
}
