import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { createDesktopApplication } from "@novel-studio/application";
import { WorkspaceShell } from "../src/index.js";

describe("AI writing workflow UI", () => {
  test("renders workflow controls and suggestion trace", () => {
    const application = createDesktopApplication();
    const html = renderToStaticMarkup(
      <WorkspaceShell
        shellState={application.getShellState()}
        commands={application.listCommands()}
        commandPaletteOpen={false}
        aiWritingWorkflow={{
          status: "suggestion-ready",
          instruction: "续写当前场景",
          summary: "补写了主角推门后的动作。",
          contextTraceLabel: "1 source / 4 tokens",
          observability: {
            workflowRunId: "wfrun_m24",
            workflowTitle: "Continue Chapter",
            contextLabel: "1 source / 4 tokens",
            modelLabel: "Default Model / example-model",
            usageLabel: "24 tokens · estimated",
            costLabel: "USD 0.000000 · estimated",
            generatedAtLabel: "2026-07-05 09:30",
            steps: [
              {
                stepId: "build_context",
                label: "构建上下文",
                kind: "context",
                status: "completed"
              },
              {
                stepId: "write_suggestion",
                label: "运行写作 Agent",
                kind: "agent",
                status: "completed"
              },
              {
                stepId: "confirm_apply",
                label: "等待用户确认",
                kind: "confirmation",
                status: "waiting-confirmation"
              }
            ]
          },
          history: {
            runs: [
              {
                workflowRunId: "wfrun_m25",
                workflowTitle: "Continue Chapter",
                statusLabel: "待确认",
                updatedAtLabel: "2026-07-05 09:30",
                modelLabel: "Default Model / example-model",
                usageLabel: "24 tokens · estimated",
                costLabel: "USD 0.000000 · estimated"
              }
            ],
            selectedRun: {
              workflowRunId: "wfrun_m25",
              workflowTitle: "Continue Chapter",
              statusLabel: "待确认",
              updatedAtLabel: "2026-07-05 09:30",
              contextLabel: "1 source / 4 tokens",
              modelLabel: "Default Model / example-model",
              usageLabel: "24 tokens · estimated",
              costLabel: "USD 0.000000 · estimated",
              steps: [
                {
                  stepId: "build_context",
                  label: "构建上下文",
                  kind: "context",
                  status: "completed"
                },
                {
                  stepId: "write_suggestion",
                  label: "运行写作 Agent",
                  kind: "agent",
                  status: "completed"
                },
                {
                  stepId: "confirm_apply",
                  label: "等待用户确认",
                  kind: "confirmation",
                  status: "waiting-confirmation"
                }
              ]
            }
          },
          onInstructionChange: () => undefined,
          onGenerateSuggestion: () => undefined,
          onApplySuggestion: () => undefined
        }}
      />
    );

    expect(html).toContain('aria-label="AI 写作工作流"');
    expect(html).toContain('aria-label="AI 写作指令"');
    expect(html).toContain('aria-label="生成 AI 建议"');
    expect(html).toContain('aria-label="应用 AI 建议"');
    expect(html).toContain("补写了主角推门后的动作。");
    expect(html).toContain("1 source / 4 tokens");
    expect(html).toContain('aria-label="AI 工作流运行观测"');
    expect(html).toContain("Continue Chapter");
    expect(html).toContain("Default Model / example-model");
    expect(html).toContain("24 tokens · estimated");
    expect(html).toContain("USD 0.000000 · estimated");
    expect(html).toContain("构建上下文");
    expect(html).toContain("运行写作 Agent");
    expect(html).toContain("等待用户确认");
    expect(html).toContain('aria-label="工作流运行历史"');
    expect(html).toContain("待确认");
  });
});
