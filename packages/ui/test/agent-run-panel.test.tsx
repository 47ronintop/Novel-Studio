// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

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

  test("shows automatic-write risk version points and run undo only for execution", () => {
    const onUndoRun = vi.fn();
    const execution = renderPanel({
      operationMode: "execution",
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: false,
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

    expect(execution).toContain("本次运行自动写入");
    expect(execution).toContain("写入前询问");
    expect(execution).toContain("我理解本次执行可自动修改项目文件");
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
  test("disables send until automatic write access is acknowledged", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;
    act(() => {
      root = createRoot(host);
      root.render(
        <AgentRunPanel
          {...createProps()}
          operationMode="execution"
          status="completed"
          writePolicy="user_preapproved_run"
          writePolicyAcknowledged={false}
        />
      );
    });

    expect(
      host.querySelector<HTMLButtonElement>(".ns-agent-composer .ns-ai-send-button")?.disabled
    ).toBe(true);

    act(() => root?.unmount());
    host.remove();
  });

  test("requires acknowledgement before approving automatic writes for a ready plan", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const onDecidePlan = vi.fn();
    let root: Root | undefined;
    act(() => {
      root = createRoot(host);
      root.render(
        <AgentRunPanel
          {...createProps()}
          onDecidePlan={onDecidePlan}
          planArtifact={readyPlanArtifact()}
          status="plan_ready"
        />
      );
    });

    const policyInputs = Array.from(
      host.querySelectorAll<HTMLInputElement>('.ns-plan-review input[type="radio"]')
    );
    const manual = policyInputs.find((input) =>
      input.closest("label")?.textContent?.includes("写入前询问")
    );
    const automatic = policyInputs.find((input) =>
      input.closest("label")?.textContent?.includes("本次运行自动写入")
    );
    const generalFile = policyInputs.find((input) =>
      input.closest("label")?.textContent?.includes("通用文件")
    );
    const approve = host.querySelector<HTMLButtonElement>('[aria-label="按此方案执行"]');

    expect(manual?.checked).toBe(true);
    expect(automatic).toBeDefined();
    expect(generalFile).toBeDefined();
    expect(approve?.disabled).toBe(false);

    act(() => generalFile?.click());
    act(() => automatic?.click());

    expect(approve?.disabled).toBe(true);
    const acknowledgement = host.querySelector<HTMLInputElement>(
      '.ns-plan-review input[type="checkbox"]'
    );
    expect(acknowledgement).not.toBeNull();

    act(() => acknowledgement?.click());
    expect(approve?.disabled).toBe(false);

    act(() => approve?.click());
    expect(onDecidePlan).toHaveBeenCalledWith("approve", {
      executionContextMode: "general_file",
      executionWritePolicy: "user_preapproved_run",
      executionWritePolicyAcknowledged: true
    });

    act(() => root?.unmount());
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
    ,writePolicy: "write_before_confirmation" as const,
    writePolicyAcknowledged: false,
    onWritePolicyChange: () => undefined,
    onWritePolicyAcknowledgedChange: () => undefined
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
