// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

import { AgentRunPanel } from "../src/agent-run-panel.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentRunPanel", () => {
  test("does not own the composer, mode controls, write policy, stop, or plan decisions", () => {
    const html = renderPanel({ operationMode: "planning", status: "planning_model" });

    const host = document.createElement("div");
    host.innerHTML = html;
    const panel = host.querySelector(".ns-agent-run");
    expect(panel?.querySelector("textarea")).toBeNull();
    expect(panel?.querySelector(".ns-agent-composer")).toBeNull();
    expect(panel?.querySelector('[aria-label="运行模式"]')).toBeNull();
    expect(panel?.querySelector('[aria-label="上下文模式"]')).toBeNull();
    expect(panel?.querySelector('[aria-label="本次执行写入策略"]')).toBeNull();
    expect(panel?.querySelector('[aria-label="启动 Agent 运行"]')).toBeNull();
    expect(panel?.querySelector('[aria-label="停止 Agent 运行"]')).toBeNull();
    expect(panel?.querySelector('[aria-label="Plan Artifact 审阅"]')).toBeNull();
    expect(html).toContain("正在读取第 3 章");
  });

  test("renders a pending question without duplicating the composer stop action", () => {
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
    expect(html).not.toContain('aria-label="停止 Agent 运行"');
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

  test("shows automatic-write risk version points and run undo only for execution", () => {
    const onUndoRun = vi.fn();
    const execution = renderPanel({
      operationMode: "execution",
      writePolicy: "user_preapproved_run",
      status: "completed",
      canUndoRun: true,
      onUndoRun,
      events: [
        {
          schemaVersion: "1.0",
          runId: "run-01",
          projectId: "project-01",
          sequence: 4,
          runRevision: 4,
          type: "change_set_auto_approved",
          createdAt: "2026-07-13T00:00:00.000Z",
          detail: { changeSetId: "changes-01", revision: 2 }
        },
        {
          schemaVersion: "1.0",
          runId: "run-01",
          projectId: "project-01",
          sequence: 5,
          runRevision: 5,
          type: "write_applied",
          createdAt: "2026-07-13T00:00:01.000Z",
          detail: { versionGroupId: "versions-01" }
        }
      ]
    });
    const planning = renderPanel({
      operationMode: "planning",
      status: "completed",
      canUndoRun: true,
      onUndoRun
    });

    expect(execution).toContain("版本点 versions-01");
    expect(execution).toContain('aria-label="撤销本次运行"');
    expect(planning).not.toContain("本次运行自动写入");
    expect(planning).not.toContain("撤销本次运行");
  });

  test("does not label a manually approved write as automatic", () => {
    const html = renderPanel({
      operationMode: "execution",
      writePolicy: "write_before_confirmation",
      status: "completed",
      events: [
        {
          schemaVersion: "1.0",
          runId: "run-manual",
          projectId: "project-01",
          sequence: 1,
          runRevision: 1,
          type: "write_applied",
          createdAt: "2026-07-13T00:00:01.000Z",
          detail: { versionGroupId: "versions-manual" }
        }
      ]
    });

    expect(html).toContain("版本点 versions-manual");
    expect(html).not.toContain("自动写入已完成");
  });

  test("reports kept files instead of claiming the whole run was undone", () => {
    const html = renderPanel({
      operationMode: "execution",
      status: "completed",
      events: [
        {
          schemaVersion: "1.0",
          runId: "run-kept",
          projectId: "project-01",
          sequence: 8,
          runRevision: 8,
          type: "run_undone",
          createdAt: "2026-07-13T00:00:02.000Z",
          detail: {
            versionGroup: {
              writes: [
                { relativePath: "notes/restored.md", status: "completed" },
                { relativePath: "notes/kept.md", status: "kept" }
              ]
            }
          }
        }
      ]
    });

    expect(html).toContain("撤销审阅已完成");
    expect(html).toContain("保留 1 个文件的当前内容");
    expect(html).not.toContain("本次运行已撤销");
  });

  test("reopens closed Change Set and rollback reviews from the run projection", () => {
    const onOpenChangeSet = vi.fn();
    const onOpenRollback = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <AgentRunPanel
          {...createProps()}
          status="completed"
          changeSetReview={{
            changeSet: {
              changeSetId: "change-set-01",
              revision: 1,
              checksum: "checksum-01",
              status: "awaiting_approval",
              files: []
            },
            runRevision: 2,
            applying: false,
            stale: false,
            selectionPending: false,
            baseHashConflictPaths: [],
            dirtyTargetPaths: [],
            open: false,
            onOpen: onOpenChangeSet,
            onSelectionChange: () => undefined,
            onApply: () => undefined,
            onReject: () => undefined,
            onReturn: () => undefined
          }}
          rollbackReview={{
            review: {
              schemaVersion: "1.0",
              reviewId: "rollback-01",
              runId: "run-01",
              status: "pending",
              sourceVersionGroupIds: ["versions-01"],
              createdAt: "2026-07-15T00:00:00.000Z",
              updatedAt: "2026-07-15T00:00:00.000Z",
              processedCommandIds: [],
              files: []
            },
            applying: false,
            open: false,
            decisions: {},
            onOpen: onOpenRollback,
            onDecisionChange: () => undefined,
            onApply: () => undefined,
            onRetryFailed: () => undefined,
            onReturn: () => undefined
          }}
        />
      );
    });

    act(() => host.querySelector<HTMLElement>('[aria-label="Change Set 摘要"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="重新打开撤销审阅"]')?.click());
    expect(onOpenChangeSet).toHaveBeenCalledOnce();
    expect(onOpenRollback).toHaveBeenCalledOnce();

    act(() => root.unmount());
    host.remove();
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
    onAnswerUserInput: () => undefined,
    onResume: () => undefined,
    onRetryStep: () => undefined,
    onRefreshContext: () => undefined,
    writePolicy: "write_before_confirmation" as const
  };
}
