import { describe, expect, test, vi } from "vitest";
import type { ChapterEditorProps, ProjectWorkflowProps } from "@novel-studio/ui";

import { handleChapterAgentExternalUpdate } from "../src/renderer/chapter-agent-external-update.js";

const chapterEditor = (dirty: boolean): ChapterEditorProps => ({
  chapter: {
    frontmatter: {
      schemaVersion: "1.0",
      id: "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0",
      type: "chapter",
      title: "第一章",
      order: 1,
      status: "draft",
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    },
    body: dirty ? "未保存正文" : "已保存正文"
  },
  dirty,
  saveStatus: dirty ? "Unsaved" : "Saved",
  versionHistory: []
});

const workflow = {
  projectId: "project-01",
  chapters: [],
  activeChapterId: undefined
} as unknown as ProjectWorkflowProps;

describe("chapter Agent external updates", () => {
  test("reloads the project snapshot and clean chapter editor for chapter and outline changes", async () => {
    const refreshedEditor = chapterEditor(false);
    const refreshActiveProject = vi.fn(async () => workflow);
    const loadChapter = vi.fn(async () => refreshedEditor);
    const publishedWorkflows: ProjectWorkflowProps[] = [];
    const publishedEditors: ChapterEditorProps[] = [];

    await handleChapterAgentExternalUpdate({
      event: event(["outline/outline.json"]),
      projectWorkflowBridge: { refreshActiveProject },
      chapterBridge: { load: loadChapter },
      readChapterEditor: () => chapterEditor(false),
      publishProjectWorkflow: (next) => publishedWorkflows.push(next),
      publishChapterEditor: (next) => publishedEditors.push(next)
    });

    expect(refreshActiveProject).toHaveBeenCalledOnce();
    expect(loadChapter).toHaveBeenCalledOnce();
    expect(publishedWorkflows).toEqual([workflow]);
    expect(publishedEditors).toEqual([refreshedEditor]);
  });

  test("keeps a dirty chapter buffer and exposes an external-update conflict", async () => {
    const current = chapterEditor(true);
    const loadChapter = vi.fn(async () => chapterEditor(false));
    const publishedEditors: ChapterEditorProps[] = [];

    await handleChapterAgentExternalUpdate({
      event: event([`chapters/${current.chapter.frontmatter.id}.md`]),
      projectWorkflowBridge: { refreshActiveProject: async () => workflow },
      chapterBridge: { load: loadChapter },
      readChapterEditor: () => current,
      publishProjectWorkflow: () => undefined,
      publishChapterEditor: (next) => publishedEditors.push(next)
    });

    expect(loadChapter).not.toHaveBeenCalled();
    expect(publishedEditors).toMatchObject([
      {
        chapter: { body: "未保存正文" },
        dirty: true,
        saveStatus: "Recovery available",
        completionFeedback: { kind: "error" }
      }
    ]);
  });

  test("does not refresh the writing workbench for unrelated files", async () => {
    const refreshActiveProject = vi.fn(async () => workflow);

    await handleChapterAgentExternalUpdate({
      event: event(["notes/agent-log.md"]),
      projectWorkflowBridge: { refreshActiveProject },
      chapterBridge: { load: async () => chapterEditor(false) },
      readChapterEditor: () => chapterEditor(false),
      publishProjectWorkflow: () => undefined,
      publishChapterEditor: () => undefined
    });

    expect(refreshActiveProject).not.toHaveBeenCalled();
  });
});

function event(relativePaths: readonly string[]) {
  return {
    projectId: "project-01",
    reason: "agent-change-set-apply" as const,
    versionGroupId: "vg-01",
    relativePaths
  };
}
