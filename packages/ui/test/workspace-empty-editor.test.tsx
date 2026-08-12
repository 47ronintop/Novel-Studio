// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { WorkspaceEmptyEditor } from "../src/workspace-empty-editor.js";
import type { ProjectWorkflowProps } from "../src/workspace-shell-types.js";

describe("WorkspaceEmptyEditor", () => {
  afterEach(() => document.body.replaceChildren());

  test("offers brainstorming beside first chapter only for an empty active project", () => {
    const onStart = vi.fn();
    const { host, rerender } = renderEmptyEditor(workflow({ brainstorming: { onStart } }));

    expect(host.querySelector('[aria-label="开始构思"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="新建第一章"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="开始构思"]')?.click());
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      workflow({
        chapters: [
          {
            id: "chapter_1",
            title: "第一章",
            order: 1,
            status: "draft",
            updatedAt: "2026-08-12T00:00:00.000Z"
          }
        ],
        brainstorming: { onStart }
      })
    );
    expect(host.querySelector('[aria-label="开始构思"]')).toBeNull();
    expect(host.querySelector('[aria-label="新建第一章"]')).toBeNull();
  });

  test("keeps a protected draft visible as a disabled brainstorming state", () => {
    const { host } = renderEmptyEditor(
      workflow({
        brainstorming: {
          disabledReason: "请先发送或清空当前 Agent 草稿。",
          onStart: vi.fn()
        }
      })
    );

    expect(host.querySelector<HTMLButtonElement>('[aria-label="开始构思"]')?.disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "请先发送或清空当前 Agent 草稿。"
    );
  });
});

function workflow(overrides: Partial<ProjectWorkflowProps> = {}): ProjectWorkflowProps {
  return {
    projectId: "project_1",
    chapters: [],
    onOpenProject: () => undefined,
    onCreateProject: () => undefined,
    onCreateChapter: () => undefined,
    onSelectChapter: () => undefined,
    ...overrides
  };
}

function renderEmptyEditor(projectWorkflow: ProjectWorkflowProps) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rerender = (next: ProjectWorkflowProps) => {
    act(() => {
      root.render(
        <WorkspaceEmptyEditor
          creativeEditorSurface={true}
          hasActiveProject={true}
          projectWorkflow={next}
        />
      );
    });
  };
  rerender(projectWorkflow);
  return { host, rerender };
}
