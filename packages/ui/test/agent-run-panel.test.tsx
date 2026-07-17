// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

import { AgentRunPanel } from "../src/agent-run-panel.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentRunPanel", () => {
  test("does not own the composer, mode controls, write policy, stop, or plan decisions", () => {
    const html = renderPanel({ status: "planning_model" });

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
    expect(createProps()).not.toHaveProperty("operationMode");
    expect(createProps()).not.toHaveProperty("contextMode");
    expect(createProps()).not.toHaveProperty("writePolicy");
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

  test("labels dirty editor context without exposing provider observability or apply controls", () => {
    const html = renderPanel({
      status: "idle",
      providerLabel: "Demo · scripted-agent",
      contextSourceNotice: "使用未保存编辑器内容 · editor_buffer / dirty"
    });

    expect(html).not.toContain("Demo · scripted-agent");
    expect(html).toContain("editor_buffer / dirty");
    expect(html).not.toContain("应用");
  });

  test("collapses completed reads and proposed file changes into one activity summary", () => {
    const events = [
      completedRead(2, "read-01", "已读取第 1 章"),
      completedRead(4, "read-02", "已读取第 2 章"),
      completedRead(6, "read-03", "已读取第 3 章"),
      completedRead(8, "read-04", "已读取第 4 章"),
      completedProposal(10, "write-01", "notes/outline.md"),
      completedProposal(12, "write-02", "chapters/chapter-02.md")
    ].flat();
    const host = renderPanelHost({ events, status: "completed" });
    const summary = host.querySelector<HTMLDetailsElement>('[aria-label="Agent 活动摘要"]');

    expect(summary).not.toBeNull();
    expect(summary?.open).toBe(false);
    expect(summary?.querySelector("summary")?.textContent).toContain("已读取 4 项 · 修改 2 个文件");
    expect(summary?.querySelector("ol")?.textContent).toContain("已读取第 1 章");
    expect(summary?.querySelector("ol")?.textContent).toContain("已读取第 4 章");
    expect(summary?.querySelector("ol")?.textContent).toContain("notes/outline.md");
    expect(summary?.querySelectorAll(":scope > .ns-agent-timeline > ol > li")).toHaveLength(6);
    expect(summary?.querySelector(".ns-agent-timeline-group")).toBeNull();

    disposePanelHost(host);
  });

  test("summarizes previous actions while keeping the current action expanded", () => {
    const events = [
      ...completedRead(2, "read-01", "已读取第 1 章"),
      ...completedRead(4, "read-02", "已读取第 2 章"),
      {
        schemaVersion: "1.0" as const,
        runId: "run-01",
        projectId: "project-01",
        sequence: 6,
        runRevision: 6,
        type: "tool_started" as const,
        createdAt: "2026-07-13T00:00:02.000Z",
        detail: {
          toolCallId: "read-current",
          toolName: "read_story_bible",
          summary: "正在读取人物设定"
        }
      }
    ];
    const host = renderPanelHost({ events, status: "executing_read_tool" });
    const completed = host.querySelector<HTMLDetailsElement>('[aria-label="Agent 活动摘要"]');
    const current = host.querySelector<HTMLElement>('[aria-label="Agent 当前活动"]');

    expect(completed?.open).toBe(false);
    expect(completed?.querySelector("summary")?.textContent).toContain("已读取 2 项");
    expect(current?.textContent).toContain("正在读取人物设定");
    expect(current?.querySelector("details")?.open).toBe(true);

    disposePanelHost(host);
  });

  test("keeps exact persisted tool steps in sequence order and hides raw observability", () => {
    const events = [
      ...completedProposal(8, "write-02", "chapters/chapter-02.md"),
      ...completedRead(2, "read-01", "已读取第 1 章"),
      ...completedProposal(6, "write-01", "notes/outline.md"),
      ...completedRead(4, "read-02", "已读取第 2 章"),
      {
        schemaVersion: "1.0" as const,
        runId: "run-01",
        projectId: "project-01",
        sequence: 20,
        runRevision: 20,
        type: "run_completed" as const,
        createdAt: "2026-07-13T00:00:04.000Z",
        detail: {
          argumentsText: '{"path":"secret.md"}',
          providerFrame: "raw-provider-frame",
          inputTokens: 1234,
          cost: 9.99,
          contextTrace: "hidden-context-trace",
          workflowHistory: "hidden-workflow-history"
        }
      }
    ];
    const host = renderPanelHost({
      events,
      status: "completed",
      providerLabel: "openai-compatible · local-agent"
    });
    const steps = Array.from(
      host.querySelectorAll('[aria-label="Agent 活动摘要"] ol > li'),
      (item) => item.textContent
    );

    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("已读取第 1 章");
    expect(steps[1]).toContain("已读取第 2 章");
    expect(steps[2]).toContain("notes/outline.md");
    expect(steps[3]).toContain("chapters/chapter-02.md");
    expect(host.textContent).not.toContain("openai-compatible");
    expect(host.textContent).not.toContain("raw-provider-frame");
    expect(host.textContent).not.toContain("1234");
    expect(host.textContent).not.toContain("9.99");
    expect(host.textContent).not.toContain("hidden-context-trace");
    expect(host.textContent).not.toContain("hidden-workflow-history");

    disposePanelHost(host);
  });

  test("renders plan steps from the persisted execution record and matches deviations by execution and step IDs", () => {
    const host = renderPanelHost({
      status: "executing_model",
      assistantText: "所有计划步骤都已经完成。",
      events: [
        planDeviationEvent("plan-execution-other", "step-completed", "错误执行记录"),
        planDeviationEvent("plan-execution-01", "step-completed", "额外读取了人物设定")
      ],
      planExecution: planExecutionControl()
    });
    const timeline = host.querySelector('[aria-label="Agent 运行状态"]');
    const steps = timeline?.querySelectorAll('[data-plan-execution-id="plan-execution-01"]');

    expect(steps).toHaveLength(3);
    expect(timeline?.querySelector('[data-plan-step-id="step-running"] details')?.hasAttribute("open")).toBe(true);
    expect(timeline?.querySelector('[data-plan-step-id="step-completed"] details')?.hasAttribute("open")).toBe(false);
    expect(timeline?.querySelector('[data-plan-step-id="step-completed"]')?.textContent).toContain(
      "已完成并验证"
    );
    expect(timeline?.querySelector('[data-plan-step-id="step-completed"]')?.textContent).toContain(
      "额外读取了人物设定"
    );
    expect(timeline?.textContent).not.toContain("错误执行记录");
    expect(timeline?.textContent).not.toContain("所有计划步骤都已经完成");

    disposePanelHost(host);
  });

  test("shows a material deviation card with persisted request facts and separate approve/reject decisions", () => {
    const onDecideRevision = vi.fn();
    const host = renderPanelHost({
      status: "awaiting_plan_revision",
      events: [],
      planExecution: {
        ...planExecutionControl(),
        revisionRequest: {
          requestId: "request-01",
          planExecutionId: "plan-execution-01",
          planId: "plan-01",
          planRevision: 2,
          originalPlan: "只修订当前章节",
          discovery: "人物动机还依赖第二章中的承诺",
          proposal: "把第二章一致性复核加入计划",
          affectedStepIds: ["step-running"]
        },
        onDecideRevision
      }
    });
    const card = host.querySelector<HTMLElement>('[aria-label="计划修订审批"]');

    expect(card?.dataset["requestId"]).toBe("request-01");
    expect(card?.dataset["planExecutionId"]).toBe("plan-execution-01");
    expect(card?.textContent).toContain("只修订当前章节");
    expect(card?.textContent).toContain("人物动机还依赖第二章中的承诺");
    expect(card?.textContent).toContain("把第二章一致性复核加入计划");
    expect(card?.textContent).toContain("核对人物动机");
    act(() => card?.querySelector<HTMLButtonElement>('[aria-label="批准计划修订"]')?.click());
    act(() => card?.querySelector<HTMLButtonElement>('[aria-label="拒绝计划修订"]')?.click());
    expect(onDecideRevision.mock.calls).toEqual([["approve"], ["reject"]]);

    disposePanelHost(host);
  });

  test("renders the run as inline assistant content without another frame or scroller", () => {
    const css = readUiStyles();
    const runRule = css.match(/\.ns-agent-run\s*\{[^}]*\}/s)?.[0] ?? "";
    const wrapperRule = css.match(/\.ns-agent-conversation-run-panel\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(runRule).not.toMatch(/overflow\s*:\s*(?:auto|scroll)/);
    expect(wrapperRule).not.toMatch(/border(?:-top)?\s*:/);
  });

  test("shows automatic-write version points and run undo from persisted execution facts", () => {
    const onUndoRun = vi.fn();
    const execution = renderPanel({
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
    expect(execution).toContain("版本点 versions-01");
    expect(execution).toContain('aria-label="撤销本次运行"');
  });

  test("does not label a manually approved write as automatic", () => {
    const html = renderPanel({
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

function completedProposal(sequence: number, toolCallId: string, relativePath: string) {
  return [
    {
      schemaVersion: "1.0" as const,
      runId: "run-01",
      projectId: "project-01",
      sequence,
      runRevision: sequence,
      type: "tool_started" as const,
      createdAt: "2026-07-13T00:00:00.000Z",
      detail: { toolCallId, toolName: "propose_file_write", relativePath }
    },
    {
      schemaVersion: "1.0" as const,
      runId: "run-01",
      projectId: "project-01",
      sequence: sequence + 1,
      runRevision: sequence + 1,
      type: "tool_completed" as const,
      createdAt: "2026-07-13T00:00:01.000Z",
      detail: {
        toolCallId,
        toolName: "propose_file_write",
        relativePath,
        summary: `已准备修改 ${relativePath}`
      }
    }
  ];
}

function renderPanel(overrides: Record<string, unknown>): string {
  const host = renderPanelHost(overrides);
  const html = host.innerHTML;
  disposePanelHost(host);
  return html;
}

function renderPanelHost(overrides: Record<string, unknown>): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.set(host, root);
  act(() => {
    root.render(<AgentRunPanel {...createProps()} {...overrides} />);
  });
  return host;
}

function disposePanelHost(host: HTMLDivElement): void {
  const root = roots.get(host);
  act(() => root?.unmount());
  roots.delete(host);
  host.remove();
}

function readUiStyles(): string {
  return readFileSync(resolve("packages/ui/src/styles.css"), "utf8");
}

const roots = new WeakMap<HTMLDivElement, Root>();

function createProps() {
  return {
    projectId: "project-01",
    runId: "run-01",
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
    onRefreshContext: () => undefined
  };
}

function planExecutionControl() {
  return {
    record: {
      schemaVersion: "1.0" as const,
      planExecutionId: "plan-execution-01",
      runId: "run-01",
      planId: "plan-01",
      planRevision: 1,
      handoffContextMode: "writing" as const,
      handoffWritePolicy: "write_before_confirmation" as const,
      revision: 4,
      steps: [
        {
          stepId: "step-completed",
          title: "复核当前章节",
          status: "completed" as const,
          startedAt: "2026-07-17T00:00:00.000Z",
          completedAt: "2026-07-17T00:01:00.000Z",
          verification: ["已运行聚焦测试"],
          deviationKind: "minor" as const,
          blockedReason: null,
          checkpointId: "checkpoint-01",
          eventSequence: 4
        },
        {
          stepId: "step-running",
          title: "核对人物动机",
          status: "running" as const,
          startedAt: "2026-07-17T00:02:00.000Z",
          completedAt: null,
          verification: [],
          deviationKind: "material" as const,
          blockedReason: null,
          checkpointId: "checkpoint-02",
          eventSequence: 6
        },
        {
          stepId: "step-pending",
          title: "完成最终复核",
          status: "pending" as const,
          startedAt: null,
          completedAt: null,
          verification: [],
          deviationKind: "none" as const,
          blockedReason: null,
          checkpointId: null,
          eventSequence: null
        }
      ]
    },
    onDecideRevision: () => undefined
  };
}

function planDeviationEvent(planExecutionId: string, stepId: string, summary: string) {
  return {
    schemaVersion: "1.1" as const,
    runId: "run-01",
    projectId: "project-01",
    sequence: planExecutionId === "plan-execution-01" ? 7 : 6,
    runRevision: planExecutionId === "plan-execution-01" ? 7 : 6,
    type: "plan_deviation_recorded" as const,
    createdAt: "2026-07-17T00:03:00.000Z",
    detail: { planExecutionId, stepId, kind: "minor", summary }
  };
}
