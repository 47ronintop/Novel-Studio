// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, test } from "vitest";

import { AgentRunPanel } from "../src/agent-run-panel.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentRunPanel", () => {
  test("keeps planning read-only and hides write policy controls", () => {
    const html = renderPanel({ operationMode: "planning", status: "planning_model" });

    expect(html).toContain("规划");
    expect(html).toContain("写作");
    expect(html).not.toContain("写入前询问");
    expect(html).not.toContain("本次运行自动写入");
    expect(html).not.toContain("应用");
    expect(html).toContain("正在读取第 3 章");
  });

  test("renders a pending question with keyboard controls and a stop action", () => {
    const html = renderPanel({
      operationMode: "execution",
      status: "awaiting_user_input",
      pendingUserInput: {
        questionId: "question-01",
        prompt: "保留现有揭示时机？",
        reason: "它会改变执行范围。",
        options: [
          { id: "keep", label: "保留" },
          { id: "move", label: "提前" }
        ],
        allowFreeText: true
      }
    });

    expect(html).toContain('aria-label="回答并继续"');
    expect(html).toContain('aria-label="停止 Agent 运行"');
    expect(html).toContain("保留现有揭示时机？");
  });

  test("labels demo runtime and dirty editor context without exposing apply controls", () => {
    const html = renderPanel({
      status: "idle",
      providerLabel: "Demo · scripted-agent",
      contextSourceNotice: "使用未保存编辑器内容 · editor_buffer / dirty"
    });

    expect(html).toContain("Demo · scripted-agent");
    expect(html).toContain("editor_buffer / dirty");
    expect(html).not.toContain("应用");
  });

  test("aggregates more than three consecutive completed reads while retaining each item", () => {
    const events = [
      completedRead(2, "read-01", "已读取第 1 章"),
      completedRead(4, "read-02", "已读取第 2 章"),
      completedRead(6, "read-03", "已读取第 3 章"),
      completedRead(8, "read-04", "已读取第 4 章")
    ].flat();
    const html = renderPanel({ events });

    expect(html).toContain("已读取 4 项");
    expect(html).toContain("已读取第 1 章");
    expect(html).toContain("已读取第 4 章");
  });
});

function completedRead(sequence: number, toolCallId: string, summary: string) {
  return [
    {
      schemaVersion: "1.0" as const,
      runId: "run-01",
      projectId: "project-01",
      sequence,
      runRevision: sequence,
      type: "tool_started" as const,
      createdAt: "2026-07-13T00:00:00.000Z",
      detail: { toolCallId, toolName: "read_chapter", summary: `正在${summary.slice(1)}` }
    },
    {
      schemaVersion: "1.0" as const,
      runId: "run-01",
      projectId: "project-01",
      sequence: sequence + 1,
      runRevision: sequence + 1,
      type: "tool_completed" as const,
      createdAt: "2026-07-13T00:00:01.000Z",
      detail: { toolCallId, toolName: "read_chapter", summary }
    }
  ];
}

function renderPanel(overrides: Record<string, unknown>): string {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;
  act(() => {
    root = createRoot(host);
    root.render(
      <AgentRunPanel
        {...createProps()}
        {...overrides}
      />
    );
  });
  const html = host.innerHTML;
  act(() => root?.unmount());
  host.remove();
  return html;
}

function createProps() {
  return {
    projectId: "project-01",
    runId: "run-01",
    operationMode: "planning" as const,
    contextMode: "writing" as const,
    status: "planning_model" as const,
    userRequest: "检查第 3 章",
    assistantText: "我会先核对当前章节。",
    events: [
      {
        schemaVersion: "1.0" as const,
        runId: "run-01",
        projectId: "project-01",
        sequence: 2,
        runRevision: 2,
        type: "tool_started" as const,
        createdAt: "2026-07-13T00:00:00.000Z",
        detail: { toolName: "read_chapter", summary: "正在读取第 3 章" }
      }
    ],
    onOperationModeChange: () => undefined,
    onContextModeChange: () => undefined,
    onSend: () => undefined,
    onStop: () => undefined,
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined,
    onDecidePlan: () => undefined
  };
}
