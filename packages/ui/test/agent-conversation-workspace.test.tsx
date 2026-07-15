// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "../src/workspace-shell.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Agent Conversation workspace", () => {
  afterEach(() => document.body.replaceChildren());

  test("uses one conversation navigator and main view without duplicating the AI assistant", () => {
    const application = createDesktopApplication();
    const conversation = {
      conversationId: "conversation-01",
      title: "Review the opening",
      status: "active" as const,
      updatedAtLabel: "16:00",
      runCount: 1,
      turns: []
    };
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
          }
        }}
        commandPaletteOpen={false}
        commands={application.listCommands()}
        shellState={{ ...application.getShellState(), activeActivity: "ai" }}
      />
    );

    expect(html).toContain('aria-label="Agent 会话导航"');
    expect(html).toContain('aria-label="Agent 会话主视图"');
    expect(html).toContain('aria-label="Agent 运行检查器"');
    expect(html).not.toContain('aria-label="AI 工作流主视图"');
    expect(html).not.toContain("对话式写作助手");
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
            planReview: {
              contextMode: "writing",
              plan: readyPlanArtifact(),
              onDecision
            }
          }}
          commandPaletteOpen={false}
          commands={application.listCommands()}
          shellState={{ ...application.getShellState(), activeActivity: "ai" }}
        />
      );
    });

    const editor = host.querySelector('[aria-label="编辑区"]');
    expect(editor?.querySelector('[aria-label="Plan Artifact 审阅"]')).not.toBeNull();
    act(() => editor?.querySelector<HTMLButtonElement>('[aria-label="拒绝计划"]')?.click());
    act(() => editor?.querySelector<HTMLButtonElement>('[aria-label="按此方案执行"]')?.click());
    expect(onDecision).toHaveBeenCalledWith("reject");
    expect(onDecision).toHaveBeenCalledWith("approve", {
      executionContextMode: "writing",
      executionWritePolicy: "write_before_confirmation"
    });

    act(() => root?.unmount());
  });
});

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
